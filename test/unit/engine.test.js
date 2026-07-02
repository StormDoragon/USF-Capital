// One real second == one simulated trading year at this speed, which keeps
// the numbers in this file easy to reason about.
process.env.SIM_SPEED = String((86400000 * 252) / 1000);

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { createTestDb } = require('../helpers/testDb');
const engine = require('../../src/services/engine');

const TEST_POOL = {
  id: 999,
  key: 'test-pool',
  annual_drift: 0.1,
  annual_vol: 0.2
};
const ZERO_DRIFT_POOL = { id: 998, key: 'zero-drift', annual_drift: 0, annual_vol: 0.3 };

test('stepIndex with zero shock follows pure drift compounding', () => {
  const next = engine.stepIndex(100, TEST_POOL, 1, 0);
  const expected = 100 * Math.exp((TEST_POOL.annual_drift - 0.5 * TEST_POOL.annual_vol ** 2) * 1);
  assert.equal(Math.abs(next - expected) < 1e-9, true);
});

test('stepIndex applies drift linearly and shock scaled by the square root of elapsed time', () => {
  const z = 1.3;
  const dt = 0.25;

  function expected(pool, dt, z) {
    const drift = (pool.annual_drift - 0.5 * pool.annual_vol * pool.annual_vol) * dt;
    const shock = pool.annual_vol * Math.sqrt(dt) * z;
    return 100 * Math.exp(drift + shock);
  }

  assert.equal(Math.abs(engine.stepIndex(100, TEST_POOL, dt, z) - expected(TEST_POOL, dt, z)) < 1e-9, true);
  assert.equal(Math.abs(engine.stepIndex(100, TEST_POOL, dt * 4, z) - expected(TEST_POOL, dt * 4, z)) < 1e-9, true);

  // Isolate just the volatility term (zero drift pool): quadrupling dt must
  // exactly double the shock's sqrt(dt) contribution to the log-return.
  const shortShock = ZERO_DRIFT_POOL.annual_vol * Math.sqrt(dt) * z;
  const longShock = ZERO_DRIFT_POOL.annual_vol * Math.sqrt(dt * 4) * z;
  assert.equal(Math.abs(longShock / shortShock - 2) < 1e-9, true);
});

test('valueForIndex derives dollar value from the index and floors at zero', () => {
  assert.equal(engine.valueForIndex(100000, 100), 100000);
  assert.equal(engine.valueForIndex(100000, 110), 110000);
  assert.equal(engine.valueForIndex(100000, -50), 0);
});

test('buildBackfillSeries always lands exactly on BASE_INDEX at endDate', () => {
  const endDate = new Date('2026-01-01T00:00:00Z');
  const series = engine.buildBackfillSeries(TEST_POOL, endDate, 30);
  assert.equal(series.length, 31);
  assert.equal(Math.abs(series[series.length - 1].index_value - engine.BASE_INDEX) < 1e-9, true);
  const expectedFirstTs = new Date(endDate.getTime() - 30 * engine.MS_PER_DAY).toISOString();
  assert.equal(series[0].ts, expectedFirstTs);
});

test('backfillPosition, tickPosition and catch-up all touch the database correctly', async (t) => {
  const { db, cleanup } = createTestDb();
  t.after(cleanup);

  // positions/performance_ticks have real foreign keys, so seed a matching
  // pool row and a handful of dummy users to attach test positions to.
  const poolRow = db.prepare(`
    INSERT INTO pools (key, name, tagline, description, risk_profile, annual_drift, annual_vol, target_low, target_high, color, max_alloc_cents, sort_order)
    VALUES ('test-pool', 'Test Pool', 'x', 'x', 'Test', ?, ?, 0.05, 0.1, '#000000', 100000, 99)
  `).run(TEST_POOL.annual_drift, TEST_POOL.annual_vol);
  const pool = Object.assign({}, TEST_POOL, { id: poolRow.lastInsertRowid });

  const userIds = [];
  for (let i = 0; i < 7; i++) {
    const info = db.prepare(`INSERT INTO users (email, password_hash, full_name) VALUES (?, 'x', 'Test User')`)
      .run(`user${i}@example.com`);
    userIds.push(info.lastInsertRowid);
  }

  await t.test('backfillPosition seeds a position that lands exactly on principal', () => {
    const openedAt = new Date('2026-01-01T00:00:00Z');
    const positionId = engine.backfillPosition(db, {
      userId: userIds[0],
      poolId: pool.id,
      pool,
      principalCents: 50000,
      openedAt
    });

    const position = db.prepare('SELECT * FROM positions WHERE id = ?').get(positionId);
    assert.equal(position.current_value_cents, 50000);
    assert.equal(position.principal_cents, 50000);
    assert.equal(position.status, 'active');

    const ticks = db.prepare('SELECT * FROM performance_ticks WHERE position_id = ? ORDER BY ts ASC').all(positionId);
    assert.equal(ticks.length, engine.BACKFILL_DAYS + 1);
    assert.equal(ticks[ticks.length - 1].value_cents, 50000);
    assert.equal(ticks[ticks.length - 1].ts, openedAt.toISOString());
  });

  await t.test('tickPosition advances the position and appends one tick', () => {
    const openedAt = new Date('2026-01-01T00:00:00Z');
    const positionId = engine.backfillPosition(db, {
      userId: userIds[1],
      poolId: pool.id,
      pool,
      principalCents: 10000,
      openedAt
    });
    const before = db.prepare('SELECT COUNT(*) AS c FROM performance_ticks WHERE position_id = ?').get(positionId).c;

    const position = db.prepare('SELECT * FROM positions WHERE id = ?').get(positionId);
    const later = new Date(openedAt.getTime() + 500); // 500ms later == 0.5 sim years at this SIM_SPEED
    const result = engine.tickPosition(db, position, pool, later);

    assert.notEqual(result, null);
    const after = db.prepare('SELECT COUNT(*) AS c FROM performance_ticks WHERE position_id = ?').get(positionId).c;
    assert.equal(after, before + 1);

    const updated = db.prepare('SELECT * FROM positions WHERE id = ?').get(positionId);
    assert.equal(updated.last_tick_at, later.toISOString());

    // Calling tickPosition again with the same timestamp should be a no-op.
    const noop = engine.tickPosition(db, updated, pool, later);
    assert.equal(noop, null);
    const stillCount = db.prepare('SELECT COUNT(*) AS c FROM performance_ticks WHERE position_id = ?').get(positionId).c;
    assert.equal(stillCount, after);
  });

  await t.test('catchUpPosition fills a large offline gap in fixed-size steps ending exactly at now', () => {
    const openedAt = new Date('2026-01-01T00:00:00Z');
    const positionId = engine.backfillPosition(db, {
      userId: userIds[2],
      poolId: pool.id,
      pool,
      principalCents: 20000,
      openedAt
    });
    const position = db.prepare('SELECT * FROM positions WHERE id = ?').get(positionId);

    // Simulate the server having been "offline" for many simulated trading days.
    const now = new Date(openedAt.getTime() + 50); // 50ms real >> one sim-day step (~3.97ms)
    const points = engine.catchUpPosition(db, position, pool, now);

    assert.equal(points.length > 1, true, 'expected multiple catch-up steps, not one big jump');
    assert.equal(points[points.length - 1].ts, now.toISOString());

    const updated = db.prepare('SELECT * FROM positions WHERE id = ?').get(positionId);
    assert.equal(updated.last_tick_at, now.toISOString());

    const tickCount = db.prepare('SELECT COUNT(*) AS c FROM performance_ticks WHERE position_id = ?').get(positionId).c;
    assert.equal(tickCount, engine.BACKFILL_DAYS + 1 + points.length);
  });

  await t.test('runCatchUp and runTickCycle operate across every active position', () => {
    const openedAt = new Date('2026-01-01T00:00:00Z');
    const testPools = [pool];
    const idA = engine.backfillPosition(db, { userId: userIds[3], poolId: pool.id, pool, principalCents: 10000, openedAt });
    const idB = engine.backfillPosition(db, { userId: userIds[4], poolId: pool.id, pool, principalCents: 10000, openedAt });

    const later = new Date(openedAt.getTime() + 10);
    const tickResults = engine.runTickCycle(db, testPools, later);
    const touchedIds = tickResults.map((r) => r.positionId);
    assert.equal(touchedIds.includes(idA), true);
    assert.equal(touchedIds.includes(idB), true);
  });

  await t.test('ensureFreshTicks only advances the given user\'s positions', () => {
    const openedAt = new Date('2026-01-01T00:00:00Z');
    const testPools = [pool];
    const mine = engine.backfillPosition(db, { userId: userIds[5], poolId: pool.id, pool, principalCents: 10000, openedAt });
    const theirs = engine.backfillPosition(db, { userId: userIds[6], poolId: pool.id, pool, principalCents: 10000, openedAt });

    const later = new Date(openedAt.getTime() + 20);
    engine.ensureFreshTicks(db, testPools, userIds[5], later);

    const mineRow = db.prepare('SELECT * FROM positions WHERE id = ?').get(mine);
    const theirsRow = db.prepare('SELECT * FROM positions WHERE id = ?').get(theirs);
    assert.equal(mineRow.last_tick_at, later.toISOString());
    assert.equal(theirsRow.last_tick_at, openedAt.toISOString());
  });
});

test('generateMarketingSeries is deterministic per day and varies by pool', () => {
  const day = new Date('2026-07-02T15:00:00Z');
  const a = engine.generateMarketingSeries(TEST_POOL, { days: 10, endDate: day });
  const b = engine.generateMarketingSeries(TEST_POOL, { days: 10, endDate: day });
  assert.deepEqual(a, b, 'same pool + same day should reproduce identically');

  const otherPool = engine.generateMarketingSeries(ZERO_DRIFT_POOL, { days: 10, endDate: day });
  assert.notDeepEqual(a, otherPool);

  const nextDay = new Date('2026-07-03T15:00:00Z');
  const tomorrow = engine.generateMarketingSeries(TEST_POOL, { days: 10, endDate: nextDay });
  assert.notDeepEqual(a, tomorrow);
});

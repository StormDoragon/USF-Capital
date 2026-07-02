// The simulated performance engine.
//
// Every position's value is driven by a geometric-Brownian-motion "index"
// that starts at 100 the moment the position is opened. Dollar value is
// always derived as: value_cents = round(principal_cents * index / 100).
//
// This is a simulation for a portfolio-demo app. No real market data,
// no real money, ever.

const { mulberry32, stringToSeed, gaussianFactory } = require('./prng');
const { LOCK_YEARS, TRADING_DAYS_PER_YEAR, SIM_SPEED } = require('../config');

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const BACKFILL_DAYS = 60;
const BASE_INDEX = 100;

function addYears(date, years) {
  const d = new Date(date.getTime());
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d;
}

// One GBM step, in years of elapsed *simulated* time.
function stepIndex(index, pool, dtYears, z) {
  if (dtYears <= 0) return index;
  const drift = (pool.annual_drift - 0.5 * pool.annual_vol * pool.annual_vol) * dtYears;
  const shock = pool.annual_vol * Math.sqrt(dtYears) * z;
  return index * Math.exp(drift + shock);
}

function valueForIndex(principalCents, index) {
  return Math.max(0, Math.round(principalCents * (index / BASE_INDEX)));
}

// Builds a synthetic daily index path of `days + 1` points that ends
// *exactly* at BASE_INDEX on `endDate`, so a freshly opened position lands
// exactly on its principal at deposit time while still having rich history.
function buildBackfillSeries(pool, endDate, days = BACKFILL_DAYS, rng = Math.random) {
  const gaussian = gaussianFactory(rng);
  const dtYears = 1 / TRADING_DAYS_PER_YEAR;
  const raw = [BASE_INDEX];
  for (let i = 1; i <= days; i++) {
    raw.push(stepIndex(raw[i - 1], pool, dtYears, gaussian()));
  }
  const scale = BASE_INDEX / raw[raw.length - 1];
  const start = new Date(endDate.getTime() - days * MS_PER_DAY);
  return raw.map((idx, i) => ({
    ts: new Date(start.getTime() + i * MS_PER_DAY).toISOString(),
    index_value: idx * scale
  }));
}

// Opens a new position and backfills its history. Runs inside a transaction.
function backfillPosition(db, { userId, poolId, pool, principalCents, openedAt = new Date() }) {
  const series = buildBackfillSeries(pool, openedAt);
  const maturesAt = addYears(openedAt, LOCK_YEARS);

  const insertPosition = db.prepare(`
    INSERT INTO positions
      (user_id, pool_id, principal_cents, opened_at, matures_at, status,
       current_value_cents, last_index, last_tick_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
  `);
  const insertTick = db.prepare(`
    INSERT INTO performance_ticks (position_id, ts, value_cents, index_value)
    VALUES (?, ?, ?, ?)
  `);

  const run = db.transaction(() => {
    const finalIndex = series[series.length - 1].index_value;
    const info = insertPosition.run(
      userId,
      poolId,
      principalCents,
      openedAt.toISOString(),
      maturesAt.toISOString(),
      principalCents,
      finalIndex,
      openedAt.toISOString()
    );
    const positionId = info.lastInsertRowid;
    for (const point of series) {
      insertTick.run(positionId, point.ts, valueForIndex(principalCents, point.index_value), point.index_value);
    }
    return positionId;
  });

  return run();
}

// Pure computation of the next tick for a position, given how much
// *simulated* time should elapse. Does not touch the database.
function applyTick(position, pool, now, rng = Math.random) {
  const lastTickAt = new Date(position.last_tick_at);
  const elapsedRealMs = now.getTime() - lastTickAt.getTime();
  if (elapsedRealMs <= 0) return null;

  const elapsedSimMs = elapsedRealMs * SIM_SPEED;
  const elapsedTradingDayFraction = elapsedSimMs / MS_PER_DAY;
  const dtYears = elapsedTradingDayFraction / TRADING_DAYS_PER_YEAR;

  const gaussian = gaussianFactory(rng);
  const z = gaussian();
  const nextIndex = stepIndex(position.last_index, pool, dtYears, z);
  const nextValueCents = valueForIndex(position.principal_cents, nextIndex);

  return { ts: now.toISOString(), index_value: nextIndex, value_cents: nextValueCents };
}

// Persists a single live tick for one position.
function tickPosition(db, position, pool, now = new Date()) {
  const result = applyTick(position, pool, now);
  if (!result) return null;

  db.prepare(`
    INSERT INTO performance_ticks (position_id, ts, value_cents, index_value)
    VALUES (?, ?, ?, ?)
  `).run(position.id, result.ts, result.value_cents, result.index_value);

  db.prepare(`
    UPDATE positions SET current_value_cents = ?, last_index = ?, last_tick_at = ?
    WHERE id = ?
  `).run(result.value_cents, result.index_value, result.ts, position.id);

  return result;
}

// Real seconds that correspond to one simulated trading day passing, used
// as the fixed step size for boot-time catch-up.
function realMsPerSimDay() {
  return MS_PER_DAY / SIM_SPEED;
}

// Fills in any daily gaps left by the server being offline, one simulated
// trading day at a time, ending with one final partial tick that lands
// exactly on `now`. Runs as a single transaction per position.
function catchUpPosition(db, position, pool, now = new Date()) {
  const stepRealMs = realMsPerSimDay();
  const points = [];
  let cursor = new Date(position.last_tick_at);
  let index = position.last_index;

  while (now.getTime() - cursor.getTime() > stepRealMs) {
    const stepTime = new Date(cursor.getTime() + stepRealMs);
    const result = applyTick({ ...position, last_index: index, last_tick_at: cursor.toISOString() }, pool, stepTime);
    if (!result) break;
    points.push(result);
    index = result.index_value;
    cursor = stepTime;
  }

  if (now.getTime() - cursor.getTime() > 0) {
    const result = applyTick({ ...position, last_index: index, last_tick_at: cursor.toISOString() }, pool, now);
    if (result) {
      points.push(result);
      index = result.index_value;
      cursor = now;
    }
  }

  if (points.length === 0) return [];

  const insertTick = db.prepare(`
    INSERT INTO performance_ticks (position_id, ts, value_cents, index_value)
    VALUES (?, ?, ?, ?)
  `);
  const run = db.transaction(() => {
    for (const point of points) {
      insertTick.run(position.id, point.ts, point.value_cents, point.index_value);
    }
    const last = points[points.length - 1];
    db.prepare(`
      UPDATE positions SET current_value_cents = ?, last_index = ?, last_tick_at = ?
      WHERE id = ?
    `).run(last.value_cents, last.index_value, last.ts, position.id);
  });
  run();

  return points;
}

// Runs one live tick cycle across every active position. Used both by the
// setInterval loop and directly by tests.
function runTickCycle(db, pools, now = new Date()) {
  const poolsById = new Map(pools.map((p) => [p.id, p]));
  const active = db.prepare(`SELECT * FROM positions WHERE status = 'active'`).all();
  const results = [];
  for (const position of active) {
    const pool = poolsById.get(position.pool_id);
    if (!pool) continue;
    const result = tickPosition(db, position, pool, now);
    if (result) results.push({ positionId: position.id, ...result });
  }
  return results;
}

// Runs catch-up across every active position. Used once at boot.
function runCatchUp(db, pools, now = new Date()) {
  const poolsById = new Map(pools.map((p) => [p.id, p]));
  const active = db.prepare(`SELECT * FROM positions WHERE status = 'active'`).all();
  let total = 0;
  for (const position of active) {
    const pool = poolsById.get(position.pool_id);
    if (!pool) continue;
    total += catchUpPosition(db, position, pool, now).length;
  }
  return total;
}

// Brings just one user's active positions up to date. Used on every
// dashboard/portfolio read so serverless deployments (no long-lived process,
// so no setInterval) still feel live from request to request.
function ensureFreshTicks(db, pools, userId, now = new Date()) {
  const poolsById = new Map(pools.map((p) => [p.id, p]));
  const active = db.prepare(`SELECT * FROM positions WHERE user_id = ? AND status = 'active'`).all(userId);
  for (const position of active) {
    const pool = poolsById.get(position.pool_id);
    if (pool) catchUpPosition(db, position, pool, now);
  }
}

// Deterministic marketing series for the public site — reseeded once per
// UTC calendar day so it looks alive over time but never reshuffles on a
// page reload within the same day.
function generateMarketingSeries(pool, { days = 180, endDate = new Date() } = {}) {
  const dateStr = endDate.toISOString().slice(0, 10);
  const seed = stringToSeed(`${pool.key}|${dateStr}`);
  const rng = mulberry32(seed);
  const series = buildBackfillSeries(pool, endDate, days, rng);
  return series.map((point) => ({
    ts: point.ts,
    index_value: point.index_value
  }));
}

module.exports = {
  MS_PER_DAY,
  BACKFILL_DAYS,
  BASE_INDEX,
  addYears,
  stepIndex,
  valueForIndex,
  buildBackfillSeries,
  backfillPosition,
  applyTick,
  tickPosition,
  realMsPerSimDay,
  catchUpPosition,
  runTickCycle,
  runCatchUp,
  ensureFreshTicks,
  generateMarketingSeries
};

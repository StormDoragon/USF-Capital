const express = require('express');

const { requireAuth, requireKyc } = require('../middleware/auth');
const { moneyLimiter } = require('../middleware/rateLimit');
const engine = require('../services/engine');
const { computePenalty, computePortfolioSummary } = require('../services/portfolio');
const { dollarsToCents } = require('../services/money');
const { logEvent } = require('../services/audit');
const { TOTAL_DEPOSIT_CAP_CENTS } = require('../config');

function loadPositions(db, userId) {
  return db.prepare('SELECT * FROM positions WHERE user_id = ? ORDER BY opened_at DESC').all(userId);
}

function loadSparkline(db, positionId, points = 30) {
  const rows = db.prepare(`
    SELECT ts, value_cents, index_value FROM performance_ticks
    WHERE position_id = ? ORDER BY id DESC LIMIT ?
  `).all(positionId, points);
  return rows.reverse();
}

module.exports = function portfolioRoutes(db, pools) {
  const router = express.Router();
  const poolsById = new Map(pools.map((p) => [p.id, p]));
  const poolsByKey = new Map(pools.map((p) => [p.key, p]));

  router.get('/dashboard', requireAuth, requireKyc, (req, res) => {
    engine.ensureFreshTicks(db, pools, req.user.id);
    const positions = loadPositions(db, req.user.id);
    const summary = computePortfolioSummary(positions);

    const positionViews = positions
      .filter((p) => p.status === 'active')
      .map((p) => ({
        position: p,
        pool: poolsById.get(p.pool_id),
        sparkline: loadSparkline(db, p.id),
        gainCents: p.current_value_cents - p.principal_cents,
        gainPct: p.principal_cents > 0 ? (p.current_value_cents - p.principal_cents) / p.principal_cents : 0
      }));

    const combinedSeries = mergeSeriesByDay(positionViews.map((v) => loadFullSeries(db, v.position.id)));

    const transactions = db.prepare(`
      SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 15
    `).all(req.user.id);

    res.render('dashboard/dashboard', {
      title: 'Your Portfolio',
      summary,
      positionViews,
      combinedSeries,
      transactions,
      cashBalanceCents: req.user.cash_balance_cents,
      remainingCapCents: Math.max(0, TOTAL_DEPOSIT_CAP_CENTS - req.user.total_deposited_cents)
    });
  });

  router.get('/deposit', requireAuth, requireKyc, (req, res) => {
    const positions = loadPositions(db, req.user.id).filter((p) => p.status === 'active');
    const investedByPool = new Map();
    for (const p of positions) {
      investedByPool.set(p.pool_id, (investedByPool.get(p.pool_id) || 0) + p.principal_cents);
    }
    const poolViews = pools.map((pool) => ({
      pool,
      alreadyInvestedCents: investedByPool.get(pool.id) || 0,
      remainingCents: Math.max(0, pool.max_alloc_cents - (investedByPool.get(pool.id) || 0))
    }));
    const remainingCapCents = Math.max(0, TOTAL_DEPOSIT_CAP_CENTS - req.user.total_deposited_cents);

    res.render('dashboard/deposit', {
      title: 'Make a Deposit',
      poolViews,
      remainingCapCents,
      totalCapCents: TOTAL_DEPOSIT_CAP_CENTS,
      errors: [],
      values: {}
    });
  });

  router.post('/deposit', requireAuth, requireKyc, moneyLimiter, (req, res) => {
    const errors = [];
    const allocationsCents = {};
    let totalCents = 0;

    for (const pool of pools) {
      const raw = req.body['amount_' + pool.key];
      const dollars = raw === undefined || raw === '' ? 0 : Number(raw);
      if (Number.isNaN(dollars) || dollars < 0) {
        errors.push(`Please enter a valid amount for ${pool.name}.`);
        continue;
      }
      const cents = dollarsToCents(dollars);
      if (cents > 0) {
        allocationsCents[pool.id] = cents;
        totalCents += cents;
      }
    }

    const paymentMethod = req.body.paymentMethod;
    if (!['card', 'bank', 'crypto'].includes(paymentMethod)) {
      errors.push('Please choose a payment method.');
    }

    if (totalCents <= 0) {
      errors.push('Please enter at least one deposit amount.');
    }

    const remainingCapCents = Math.max(0, TOTAL_DEPOSIT_CAP_CENTS - req.user.total_deposited_cents);
    if (totalCents > remainingCapCents) {
      errors.push(`Your total deposit can’t exceed your remaining lifetime limit of $${(remainingCapCents / 100).toFixed(2)} for this demo.`);
    }

    if (errors.length === 0) {
      const positions = loadPositions(db, req.user.id).filter((p) => p.status === 'active');
      const investedByPool = new Map();
      for (const p of positions) {
        investedByPool.set(p.pool_id, (investedByPool.get(p.pool_id) || 0) + p.principal_cents);
      }
      for (const [poolIdStr, cents] of Object.entries(allocationsCents)) {
        const poolId = Number(poolIdStr);
        const pool = poolsById.get(poolId);
        const already = investedByPool.get(poolId) || 0;
        if (already + cents > pool.max_alloc_cents) {
          errors.push(`${pool.name} has a maximum of $${(pool.max_alloc_cents / 100).toFixed(2)} per investor in this demo.`);
        }
      }
    }

    if (errors.length > 0) {
      const investedByPool = new Map();
      for (const p of loadPositions(db, req.user.id).filter((p) => p.status === 'active')) {
        investedByPool.set(p.pool_id, (investedByPool.get(p.pool_id) || 0) + p.principal_cents);
      }
      const poolViews = pools.map((pool) => ({
        pool,
        alreadyInvestedCents: investedByPool.get(pool.id) || 0,
        remainingCents: Math.max(0, pool.max_alloc_cents - (investedByPool.get(pool.id) || 0))
      }));
      return res.status(400).render('dashboard/deposit', {
        title: 'Make a Deposit',
        poolViews,
        remainingCapCents,
        totalCapCents: TOTAL_DEPOSIT_CAP_CENTS,
        errors,
        values: req.body
      });
    }

    const openedAt = new Date();
    const run = db.transaction(() => {
      for (const [poolIdStr, cents] of Object.entries(allocationsCents)) {
        const poolId = Number(poolIdStr);
        const pool = poolsById.get(poolId);
        const positionId = engine.backfillPosition(db, {
          userId: req.user.id,
          poolId,
          pool,
          principalCents: cents,
          openedAt
        });
        db.prepare(`
          INSERT INTO transactions (user_id, type, pool_id, position_id, amount_cents, meta)
          VALUES (?, 'deposit', ?, ?, ?, ?)
        `).run(req.user.id, poolId, positionId, cents, JSON.stringify({ paymentMethod }));
      }
      db.prepare('UPDATE users SET total_deposited_cents = total_deposited_cents + ? WHERE id = ?')
        .run(totalCents, req.user.id);
    });
    run();

    logEvent(db, { userId: req.user.id, eventType: 'deposit', detail: `$${(totalCents / 100).toFixed(2)} via ${paymentMethod}`, req });
    req.session.flash = { type: 'success', message: 'Your simulated deposit was credited instantly. Your new positions are already tracking performance.' };
    res.redirect('/dashboard');
  });

  router.get('/withdraw', requireAuth, requireKyc, (req, res) => {
    engine.ensureFreshTicks(db, pools, req.user.id);
    const positions = loadPositions(db, req.user.id).filter((p) => p.status === 'active');
    const positionViews = positions.map((p) => ({
      position: p,
      pool: poolsById.get(p.pool_id),
      penalty: computePenalty(p)
    }));
    res.render('dashboard/withdraw', {
      title: 'Withdraw Funds',
      positionViews,
      cashBalanceCents: req.user.cash_balance_cents,
      errors: []
    });
  });

  router.post('/withdraw/:positionId', requireAuth, requireKyc, moneyLimiter, (req, res) => {
    const position = db.prepare('SELECT * FROM positions WHERE id = ? AND user_id = ?')
      .get(req.params.positionId, req.user.id);

    if (!position || position.status !== 'active') {
      req.session.flash = { type: 'error', message: 'That position could not be found or has already been withdrawn.' };
      return res.redirect('/withdraw');
    }

    const pool = poolsById.get(position.pool_id);
    engine.catchUpPosition(db, position, pool, new Date());
    const fresh = db.prepare('SELECT * FROM positions WHERE id = ?').get(position.id);
    const penalty = computePenalty(fresh);

    if (!penalty.matured && req.body.confirm !== 'yes') {
      req.session.flash = { type: 'error', message: 'Please confirm the early-withdrawal penalty before continuing.' };
      return res.redirect('/withdraw');
    }

    const now = new Date().toISOString();
    const run = db.transaction(() => {
      db.prepare(`
        UPDATE positions SET status = 'withdrawn', withdrawn_at = ?, withdrawal_value_cents = ?, penalty_cents = ?
        WHERE id = ?
      `).run(now, penalty.netCents, penalty.penaltyCents, position.id);

      db.prepare('UPDATE users SET cash_balance_cents = cash_balance_cents + ? WHERE id = ?')
        .run(penalty.netCents, req.user.id);

      db.prepare(`
        INSERT INTO transactions (user_id, type, pool_id, position_id, amount_cents, balance_after_cents, meta)
        VALUES (?, 'withdrawal', ?, ?, ?, (SELECT cash_balance_cents FROM users WHERE id = ?), ?)
      `).run(
        req.user.id,
        position.pool_id,
        position.id,
        penalty.netCents,
        req.user.id,
        JSON.stringify({ grossCents: penalty.grossCents, penaltyCents: penalty.penaltyCents, rate: penalty.rate, lockYear: penalty.year, matured: penalty.matured })
      );
    });
    run();

    logEvent(db, {
      userId: req.user.id,
      eventType: 'withdrawal',
      detail: penalty.matured
        ? `Matured withdrawal of $${(penalty.netCents / 100).toFixed(2)} from ${pool.name}`
        : `Early withdrawal from ${pool.name}: $${(penalty.netCents / 100).toFixed(2)} net after ${(penalty.rate * 100).toFixed(0)}% penalty`,
      req
    });

    req.session.flash = {
      type: 'success',
      message: penalty.matured
        ? `Withdrawal complete. $${(penalty.netCents / 100).toFixed(2)} was credited to your cash balance.`
        : `Withdrawal complete. A ${(penalty.rate * 100).toFixed(0)}% early-withdrawal penalty applied — $${(penalty.netCents / 100).toFixed(2)} net was credited to your cash balance.`
    };
    res.redirect('/dashboard');
  });

  router.get('/transactions', requireAuth, requireKyc, (req, res) => {
    const transactions = db.prepare(`
      SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC, id DESC
    `).all(req.user.id);
    res.render('dashboard/transactions', { title: 'Transaction History', transactions });
  });

  return router;

  function loadFullSeries(db, positionId) {
    const rows = db.prepare(`
      SELECT ts, value_cents FROM performance_ticks WHERE position_id = ? ORDER BY id DESC LIMIT 400
    `).all(positionId);
    return rows.reverse();
  }
};

// Merges multiple positions' tick series into one combined portfolio-value
// series by summing whichever position values are known at each timestamp
// (carrying the last known value forward for positions without a tick at
// that exact instant).
function mergeSeriesByDay(seriesList) {
  const allTimestamps = new Set();
  for (const series of seriesList) {
    for (const point of series) allTimestamps.add(point.ts);
  }
  const sorted = Array.from(allTimestamps).sort();
  const cursors = seriesList.map(() => 0);

  return sorted.map((ts) => {
    let total = 0;
    seriesList.forEach((series, i) => {
      while (cursors[i] + 1 < series.length && series[cursors[i] + 1].ts <= ts) {
        cursors[i]++;
      }
      if (series.length > 0 && series[cursors[i]].ts <= ts) {
        total += series[cursors[i]].value_cents;
      }
    });
    return { ts, value_cents: total };
  });
}

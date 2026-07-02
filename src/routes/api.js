const express = require('express');

const { requireAuth, requireKyc } = require('../middleware/auth');
const engine = require('../services/engine');
const { mulberry32, gaussianFactory } = require('../services/prng');
const { computePortfolioSummary } = require('../services/portfolio');

// A handful of decorative FX/index symbols for the homepage ticker. Purely
// illustrative — not real market data.
const TICKER_SYMBOLS = [
  { symbol: 'EUR/USD', base: 1.0850, vol: 0.0006 },
  { symbol: 'GBP/USD', base: 1.2650, vol: 0.0007 },
  { symbol: 'USD/JPY', base: 149.20, vol: 0.06 },
  { symbol: 'USD/CHF', base: 0.8820, vol: 0.0005 },
  { symbol: 'AUD/USD', base: 0.6550, vol: 0.0006 },
  { symbol: 'USFX 500', base: 5123.4, vol: 2.1 },
  { symbol: 'Global Macro Idx', base: 118.6, vol: 0.09 },
  { symbol: 'Digital Assets Idx', base: 342.7, vol: 0.9 }
];

function tickerSnapshot() {
  // Reseeds every 2 seconds so repeated polls in the same window are stable,
  // then drifts forward — enough to look alive without storing anything.
  const bucket = Math.floor(Date.now() / 2000);
  return TICKER_SYMBOLS.map((s) => {
    const rng = mulberry32((bucket * 2654435761) ^ s.symbol.length ^ hashStr(s.symbol));
    const gaussian = gaussianFactory(rng);
    const changePct = gaussian() * (s.vol / s.base) * 0.5;
    const price = s.base * (1 + changePct);
    return {
      symbol: s.symbol,
      price: Number(price.toFixed(price < 10 ? 4 : 2)),
      changePct: Number((changePct * 100).toFixed(3))
    };
  });
}

function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return h >>> 0;
}

module.exports = function apiRoutes(db, pools) {
  const router = express.Router();
  const poolsById = new Map(pools.map((p) => [p.id, p]));

  router.get('/ticker', (req, res) => {
    res.json({ items: tickerSnapshot() });
  });

  router.get('/portfolio', requireAuth, requireKyc, (req, res) => {
    engine.ensureFreshTicks(db, pools, req.user.id);
    const positions = db.prepare(`
      SELECT * FROM positions WHERE user_id = ? AND status = 'active' ORDER BY opened_at DESC
    `).all(req.user.id);
    const summary = computePortfolioSummary(positions);

    const positionPayload = positions.map((p) => {
      const pool = poolsById.get(p.pool_id);
      const sparkline = db.prepare(`
        SELECT ts, value_cents FROM performance_ticks WHERE position_id = ? ORDER BY id DESC LIMIT 60
      `).all(p.id).reverse();
      return {
        id: p.id,
        poolKey: pool ? pool.key : null,
        poolName: pool ? pool.name : 'Unknown pool',
        principalCents: p.principal_cents,
        currentValueCents: p.current_value_cents,
        openedAt: p.opened_at,
        maturesAt: p.matures_at,
        sparkline
      };
    });

    const user = db.prepare('SELECT cash_balance_cents FROM users WHERE id = ?').get(req.user.id);

    res.json({
      summary,
      positions: positionPayload,
      cashBalanceCents: user.cash_balance_cents,
      serverTime: new Date().toISOString()
    });
  });

  return router;
};

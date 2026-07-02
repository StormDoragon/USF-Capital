const express = require('express');
const engine = require('../services/engine');
const { TOTAL_DEPOSIT_CAP_CENTS, LOCK_YEARS } = require('../config');

function computeHeroStat(seriesByPool) {
  const returns = seriesByPool.map(({ series }) => {
    const first = series[0].index_value;
    const last = series[series.length - 1].index_value;
    return last / first - 1;
  });
  const avgReturnPct = returns.reduce((a, b) => a + b, 0) / returns.length;
  return { avgReturnPct, days: seriesByPool[0].series.length - 1 };
}

module.exports = function marketingRoutes(db, pools) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const seriesByPool = pools.map((pool) => ({
      pool,
      series: engine.generateMarketingSeries(pool, { days: 180 })
    }));
    const heroStat = computeHeroStat(seriesByPool);
    res.render('marketing/home', {
      title: 'USF Capital — Simulated Global Investing',
      seriesByPool,
      heroStat,
      totalCapDollars: TOTAL_DEPOSIT_CAP_CENTS / 100,
      lockYears: LOCK_YEARS
    });
  });

  router.get('/how-it-works', (req, res) => {
    res.render('marketing/how-it-works', {
      title: 'How It Works',
      lockYears: LOCK_YEARS,
      totalCapDollars: TOTAL_DEPOSIT_CAP_CENTS / 100
    });
  });

  router.get('/security', (req, res) => {
    res.render('marketing/security', { title: 'Security & Trust' });
  });

  router.get('/pricing', (req, res) => {
    const maxPoolDollars = pools.length ? pools[0].max_alloc_cents / 100 : 0;
    res.render('marketing/pricing', {
      title: 'Pricing & Terms',
      totalCapDollars: TOTAL_DEPOSIT_CAP_CENTS / 100,
      maxPoolDollars,
      lockYears: LOCK_YEARS
    });
  });

  router.get('/disclaimer', (req, res) => {
    res.render('marketing/disclaimer', { title: 'Demo Disclaimer' });
  });

  return router;
};

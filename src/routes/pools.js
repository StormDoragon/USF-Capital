const express = require('express');
const engine = require('../services/engine');

module.exports = function poolsRoutes(db, pools) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const cards = pools.map((pool) => ({
      pool,
      series: engine.generateMarketingSeries(pool, { days: 90 })
    }));
    res.render('marketing/pools', { title: 'Investment Pools', cards });
  });

  router.get('/:key', (req, res, next) => {
    const pool = pools.find((p) => p.key === req.params.key);
    if (!pool) return next();
    const series = engine.generateMarketingSeries(pool, { days: 365 });
    res.render('marketing/pool-detail', { title: pool.name, pool, series });
  });

  return router;
};

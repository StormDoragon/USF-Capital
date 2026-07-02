const { getDb } = require('./index');

// Four simulated pools. All figures are illustrative targets driven by the
// simulation engine below, not real market data or guaranteed returns.
const POOLS = [
  {
    key: 'equity-growth',
    name: 'Global Equity Growth Pool',
    tagline: 'Long-term growth from a simulated basket of world equity indices.',
    description:
      'A simulated blend tracking major global equity indices. Designed to show ' +
      'the highest long-term growth potential of the four pools, with the most ' +
      'up-and-down movement along the way.',
    risk_profile: 'Growth (Higher Risk)',
    annual_drift: 0.11,
    annual_vol: 0.19,
    target_low: 0.08,
    target_high: 0.16,
    color: '#2f6fed',
    max_alloc_cents: 80000,
    sort_order: 1
  },
  {
    key: 'global-macro',
    name: 'Global Macro & FX Pool',
    tagline: 'A simulated multi-currency strategy that aims for steadier, balanced growth.',
    description:
      'A simulated strategy spread across major currency pairs and macro trends. ' +
      'Aims for a smoother ride than pure equities, with moderate simulated growth.',
    risk_profile: 'Balanced (Medium Risk)',
    annual_drift: 0.075,
    annual_vol: 0.12,
    target_low: 0.05,
    target_high: 0.10,
    color: '#17a673',
    max_alloc_cents: 80000,
    sort_order: 2
  },
  {
    key: 'fixed-income',
    name: 'Fixed Income & Rates Pool',
    tagline: 'A simulated bond-like strategy built for stability and capital preservation.',
    description:
      'A simulated allocation modeled on government and investment-grade bond ' +
      'yields. Built to be the calmest, most predictable pool of the four.',
    risk_profile: 'Conservative (Lower Risk)',
    annual_drift: 0.045,
    annual_vol: 0.05,
    target_low: 0.03,
    target_high: 0.06,
    color: '#d4a72c',
    max_alloc_cents: 80000,
    sort_order: 3
  },
  {
    key: 'digital-assets',
    name: 'Digital Assets Index Pool',
    tagline: 'A simulated basket of major digital assets, for the most adventurous allocation.',
    description:
      'A simulated index tracking a basket of major digital assets. This pool has ' +
      'the highest simulated growth potential and, correspondingly, the largest ' +
      'day-to-day swings.',
    risk_profile: 'Aggressive (Highest Risk)',
    annual_drift: 0.16,
    annual_vol: 0.35,
    target_low: 0.10,
    target_high: 0.30,
    color: '#c0392b',
    max_alloc_cents: 80000,
    sort_order: 4
  }
];

function seed() {
  const db = getDb();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO pools
      (key, name, tagline, description, risk_profile, annual_drift, annual_vol,
       target_low, target_high, color, max_alloc_cents, sort_order)
    VALUES
      (@key, @name, @tagline, @description, @risk_profile, @annual_drift, @annual_vol,
       @target_low, @target_high, @color, @max_alloc_cents, @sort_order)
  `);
  const insertAll = db.transaction((pools) => {
    for (const pool of pools) insert.run(pool);
  });
  insertAll(POOLS);
  return db;
}

module.exports = { seed, POOLS };

if (require.main === module) {
  seed();
  console.log(`Seeded ${POOLS.length} pools.`);
}

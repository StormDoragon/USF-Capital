// Central, non-secret platform configuration for the USF Capital demo.

const TOTAL_DEPOSIT_CAP_CENTS = 120000; // $1,200 lifetime deposit cap per user
const LOCK_YEARS = 3; // every position locks for 3 simulated years
const TRADING_DAYS_PER_YEAR = 252;

// Early-withdrawal penalty tiers, keyed by which year of the 3-year lock the
// withdrawal falls in. Year 4+ (i.e. matured) is penalty-free.
const PENALTY_TIERS = {
  1: 0.20,
  2: 0.12,
  3: 0.06
};

const SIM_SPEED = Number(process.env.SIM_SPEED || 8640);
const TICK_INTERVAL_MS = Number(process.env.TICK_INTERVAL_MS || 4000);

const MIN_AGE_YEARS = 18;

module.exports = {
  TOTAL_DEPOSIT_CAP_CENTS,
  LOCK_YEARS,
  TRADING_DAYS_PER_YEAR,
  PENALTY_TIERS,
  SIM_SPEED,
  TICK_INTERVAL_MS,
  MIN_AGE_YEARS
};

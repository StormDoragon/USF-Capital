const { lockYearNumber, isMatured, daysUntil } = require('./dates');
const { PENALTY_TIERS, LOCK_YEARS } = require('../config');

// Computes the early-withdrawal penalty (or lack thereof) for a position
// as of `now`. Penalty rate is tiered by which year of the 3-year lock the
// withdrawal falls in; matured positions (year > LOCK_YEARS) pay nothing.
function computePenalty(position, now = new Date()) {
  const matured = isMatured(position.matures_at, now);
  const year = lockYearNumber(position.opened_at, now);
  const rate = matured ? 0 : (PENALTY_TIERS[year] || 0);
  const grossCents = position.current_value_cents;
  const penaltyCents = Math.round(grossCents * rate);
  const netCents = grossCents - penaltyCents;
  return { year, matured, rate, grossCents, penaltyCents, netCents };
}

// Aggregates a user's active positions into the numbers the dashboard needs.
function computePortfolioSummary(positions, now = new Date()) {
  const active = positions.filter((p) => p.status === 'active');

  const totalValueCents = active.reduce((sum, p) => sum + p.current_value_cents, 0);
  const totalPrincipalCents = active.reduce((sum, p) => sum + p.principal_cents, 0);
  const totalGainCents = totalValueCents - totalPrincipalCents;
  const totalGainPct = totalPrincipalCents > 0 ? totalGainCents / totalPrincipalCents : 0;

  const allocation = active.map((p) => ({
    positionId: p.id,
    poolId: p.pool_id,
    valueCents: p.current_value_cents,
    shareOfTotal: totalValueCents > 0 ? p.current_value_cents / totalValueCents : 0
  }));

  let nextUnlock = null;
  for (const p of active) {
    if (!nextUnlock || new Date(p.matures_at) < new Date(nextUnlock.matures_at)) {
      nextUnlock = p;
    }
  }

  return {
    totalValueCents,
    totalPrincipalCents,
    totalGainCents,
    totalGainPct,
    allocation,
    nextUnlock: nextUnlock
      ? { positionId: nextUnlock.id, poolId: nextUnlock.pool_id, matures_at: nextUnlock.matures_at, daysUntil: daysUntil(nextUnlock.matures_at, now) }
      : null
  };
}

module.exports = { computePenalty, computePortfolioSummary, LOCK_YEARS };

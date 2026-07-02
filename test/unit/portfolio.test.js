const { test } = require('node:test');
const assert = require('node:assert/strict');

const { computePenalty, computePortfolioSummary } = require('../../src/services/portfolio');
const { addYears } = require('../../src/services/engine');
const { PENALTY_TIERS } = require('../../src/config');

function makePosition(overrides = {}) {
  const opened = overrides.opened_at || new Date('2024-01-01T00:00:00Z');
  return Object.assign({
    id: 1,
    pool_id: 1,
    principal_cents: 10000,
    current_value_cents: 11000,
    opened_at: opened.toISOString ? opened.toISOString() : opened,
    matures_at: addYears(opened, 3).toISOString(),
    status: 'active'
  }, overrides);
}

test('computePenalty applies the year-1 tier rate', () => {
  const opened = new Date('2024-01-01T00:00:00Z');
  const position = makePosition({ opened_at: opened, current_value_cents: 12000 });
  const now = addYears(opened, 0);
  const result = computePenalty(position, now);
  assert.equal(result.year, 1);
  assert.equal(result.matured, false);
  assert.equal(result.rate, PENALTY_TIERS[1]);
  assert.equal(result.penaltyCents, Math.round(12000 * PENALTY_TIERS[1]));
  assert.equal(result.netCents, 12000 - result.penaltyCents);
});

test('computePenalty applies decreasing tiers across years 2 and 3', () => {
  const opened = new Date('2024-01-01T00:00:00Z');
  const position = makePosition({ opened_at: opened, current_value_cents: 20000 });

  const year2 = computePenalty(position, addYears(opened, 1));
  assert.equal(year2.year, 2);
  assert.equal(year2.rate, PENALTY_TIERS[2]);

  const year3 = computePenalty(position, addYears(opened, 2));
  assert.equal(year3.year, 3);
  assert.equal(year3.rate, PENALTY_TIERS[3]);
});

test('computePenalty waives the penalty once matured', () => {
  const opened = new Date('2024-01-01T00:00:00Z');
  const position = makePosition({ opened_at: opened, current_value_cents: 15000 });
  const matured = computePenalty(position, addYears(opened, 3));
  assert.equal(matured.matured, true);
  assert.equal(matured.rate, 0);
  assert.equal(matured.penaltyCents, 0);
  assert.equal(matured.netCents, 15000);
});

test('computePortfolioSummary aggregates value, gain and allocation shares', () => {
  const positions = [
    makePosition({ id: 1, pool_id: 1, principal_cents: 10000, current_value_cents: 12000 }),
    makePosition({ id: 2, pool_id: 2, principal_cents: 20000, current_value_cents: 18000 }),
    makePosition({ id: 3, pool_id: 1, principal_cents: 5000, current_value_cents: 5000, status: 'withdrawn' })
  ];

  const summary = computePortfolioSummary(positions);
  assert.equal(summary.totalPrincipalCents, 30000);
  assert.equal(summary.totalValueCents, 30000);
  assert.equal(summary.totalGainCents, 0);
  assert.equal(summary.allocation.length, 2); // withdrawn position excluded
  const shareSum = summary.allocation.reduce((a, s) => a + s.shareOfTotal, 0);
  assert.equal(Math.abs(shareSum - 1) < 1e-9, true);
});

test('computePortfolioSummary picks the soonest-maturing active position as nextUnlock', () => {
  const opened1 = new Date('2024-01-01T00:00:00Z');
  const opened2 = new Date('2023-01-01T00:00:00Z');
  const positions = [
    makePosition({ id: 1, opened_at: opened1, matures_at: addYears(opened1, 3).toISOString() }),
    makePosition({ id: 2, opened_at: opened2, matures_at: addYears(opened2, 3).toISOString() })
  ];
  const summary = computePortfolioSummary(positions, new Date('2024-06-01T00:00:00Z'));
  assert.equal(summary.nextUnlock.positionId, 2); // matures a year earlier
});

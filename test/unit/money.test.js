const { test } = require('node:test');
const assert = require('node:assert/strict');

const { dollarsToCents, centsToDollars, formatCents, percentOfCents, clampCents } = require('../../src/services/money');

test('dollarsToCents converts and rounds correctly', () => {
  assert.equal(dollarsToCents(10), 1000);
  assert.equal(dollarsToCents(10.005), 1001);
  assert.equal(dollarsToCents(0.1), 10);
  assert.equal(dollarsToCents('25.50'), 2550);
});

test('centsToDollars is the inverse of dollarsToCents', () => {
  assert.equal(centsToDollars(1234), 12.34);
  assert.equal(centsToDollars(0), 0);
});

test('formatCents produces localized currency strings', () => {
  assert.equal(formatCents(123456), '$1,234.56');
  assert.equal(formatCents(0), '$0.00');
  assert.equal(formatCents(-5000), '-$50.00');
});

test('percentOfCents rounds to the nearest cent', () => {
  assert.equal(percentOfCents(10000, 0.2), 2000);
  assert.equal(percentOfCents(333, 0.5), 167); // 166.5 rounds up
});

test('clampCents bounds a value within [min, max]', () => {
  assert.equal(clampCents(500, 0, 1000), 500);
  assert.equal(clampCents(-50, 0, 1000), 0);
  assert.equal(clampCents(5000, 0, 1000), 1000);
});

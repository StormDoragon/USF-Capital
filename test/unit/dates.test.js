const { test } = require('node:test');
const assert = require('node:assert/strict');

const { calculateAge, lockYearNumber, isMatured, daysUntil } = require('../../src/services/dates');
const { addYears } = require('../../src/services/engine');
const { LOCK_YEARS } = require('../../src/config');

test('calculateAge handles birthdays not yet reached this year', () => {
  const now = new Date('2026-07-02T00:00:00Z');
  assert.equal(calculateAge('2000-07-02', now), 26); // birthday is today
  assert.equal(calculateAge('2000-07-03', now), 25); // birthday is tomorrow
  assert.equal(calculateAge('2000-01-01', now), 26); // birthday already passed
});

test('lockYearNumber walks through each year of the 3-year lock', () => {
  const opened = new Date('2024-01-01T00:00:00Z');

  assert.equal(lockYearNumber(opened, addYears(opened, 0)), 1);
  assert.equal(lockYearNumber(opened, new Date(addYears(opened, 1).getTime() - 1)), 1);
  assert.equal(lockYearNumber(opened, addYears(opened, 1)), 2);
  assert.equal(lockYearNumber(opened, new Date(addYears(opened, 2).getTime() - 1)), 2);
  assert.equal(lockYearNumber(opened, addYears(opened, 2)), 3);
  assert.equal(lockYearNumber(opened, new Date(addYears(opened, 3).getTime() - 1)), 3);
  assert.equal(lockYearNumber(opened, addYears(opened, 3)), LOCK_YEARS + 1); // matured
  assert.equal(lockYearNumber(opened, addYears(opened, 5)), LOCK_YEARS + 1);
});

test('isMatured flips exactly at matures_at', () => {
  const maturesAt = new Date('2027-01-01T00:00:00Z');
  assert.equal(isMatured(maturesAt, new Date(maturesAt.getTime() - 1)), false);
  assert.equal(isMatured(maturesAt, maturesAt), true);
  assert.equal(isMatured(maturesAt, new Date(maturesAt.getTime() + 1)), true);
});

test('daysUntil rounds up to whole days remaining', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const target = new Date('2026-01-03T00:00:00Z');
  assert.equal(daysUntil(target, now), 2);
  const soon = new Date(now.getTime() + 3 * 60 * 60 * 1000); // 3 hours away
  assert.equal(daysUntil(soon, now), 1);
});

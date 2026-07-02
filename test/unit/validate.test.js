const { test } = require('node:test');
const assert = require('node:assert/strict');

const { isValidEmail, checkPasswordPolicy, isValidDob, isAdult, isNonEmptyString } = require('../../src/services/validate');

test('isValidEmail accepts well-formed addresses and rejects the rest', () => {
  assert.equal(isValidEmail('jane@example.com'), true);
  assert.equal(isValidEmail('jane.doe+demo@example.co.uk'), true);
  assert.equal(isValidEmail('not-an-email'), false);
  assert.equal(isValidEmail('missing@domain'), false);
  assert.equal(isValidEmail(''), false);
  assert.equal(isValidEmail(undefined), false);
});

test('checkPasswordPolicy enforces length, letter and digit', () => {
  assert.equal(checkPasswordPolicy('Password123').valid, true);
  assert.equal(checkPasswordPolicy('short1A').valid, false);
  assert.equal(checkPasswordPolicy('nodigitshere').valid, false);
  assert.equal(checkPasswordPolicy('1234567890').valid, false);
  const result = checkPasswordPolicy('a');
  assert.equal(result.errors.length > 0, true);
});

test('isValidDob rejects future or malformed dates', () => {
  assert.equal(isValidDob('1990-01-01'), true);
  assert.equal(isValidDob('2999-01-01'), false);
  assert.equal(isValidDob('not-a-date'), false);
});

test('isAdult gates on the 18-year threshold, including exact birthdays', () => {
  const now = new Date('2026-07-02T12:00:00Z');
  assert.equal(isAdult('2008-07-01', now), true); // turned 18 yesterday
  assert.equal(isAdult('2008-07-02', now), true); // turns 18 exactly today
  assert.equal(isAdult('2008-07-03', now), false); // turns 18 tomorrow
  assert.equal(isAdult('2015-01-01', now), false); // clearly a minor
});

test('isNonEmptyString enforces trimmed length bounds', () => {
  assert.equal(isNonEmptyString('Jane Doe'), true);
  assert.equal(isNonEmptyString('   '), false);
  assert.equal(isNonEmptyString(''), false);
  assert.equal(isNonEmptyString('x'.repeat(300), 200), false);
  assert.equal(isNonEmptyString(42), false);
});

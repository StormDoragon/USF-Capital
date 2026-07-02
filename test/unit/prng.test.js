const { test } = require('node:test');
const assert = require('node:assert/strict');

const { mulberry32, stringToSeed, gaussianFactory } = require('../../src/services/prng');

test('mulberry32 is deterministic for a given seed', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  const seqA = [a(), a(), a(), a()];
  const seqB = [b(), b(), b(), b()];
  assert.deepEqual(seqA, seqB);
});

test('mulberry32 produces values within [0, 1)', () => {
  const rng = mulberry32(123456);
  for (let i = 0; i < 500; i++) {
    const v = rng();
    assert.equal(v >= 0 && v < 1, true);
  }
});

test('mulberry32 seeded differently diverges', () => {
  const a = mulberry32(1);
  const b = mulberry32(2);
  const seqA = [a(), a(), a()];
  const seqB = [b(), b(), b()];
  assert.notDeepEqual(seqA, seqB);
});

test('stringToSeed is deterministic and sensitive to input', () => {
  assert.equal(stringToSeed('equity-growth|2026-07-02'), stringToSeed('equity-growth|2026-07-02'));
  assert.notEqual(stringToSeed('equity-growth|2026-07-02'), stringToSeed('equity-growth|2026-07-03'));
  assert.notEqual(stringToSeed('pool-a'), stringToSeed('pool-b'));
});

test('gaussianFactory yields a roughly standard-normal distribution', () => {
  const rng = mulberry32(7);
  const gaussian = gaussianFactory(rng);
  const N = 20000;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < N; i++) {
    const z = gaussian();
    sum += z;
    sumSq += z * z;
  }
  const mean = sum / N;
  const variance = sumSq / N - mean * mean;
  assert.equal(Math.abs(mean) < 0.05, true, `mean too far from 0: ${mean}`);
  assert.equal(Math.abs(variance - 1) < 0.1, true, `variance too far from 1: ${variance}`);
});

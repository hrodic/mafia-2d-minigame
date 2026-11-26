// Deterministic PRNG tests: world generation reproducibility depends on these.
import { test, assert, assertEqual, assertDeepEqual } from './harness.js';
import { createMulberry32, hashChunkSeed, withSeed } from '../src/core/rng.js';

test('rng: mulberry32 is deterministic for a given seed', () => {
  const a = createMulberry32(123456);
  const b = createMulberry32(123456);
  const seqA = Array.from({ length: 8 }, () => a());
  const seqB = Array.from({ length: 8 }, () => b());
  assertDeepEqual(seqA, seqB);
});

test('rng: different seeds produce different sequences', () => {
  const a = createMulberry32(1);
  const b = createMulberry32(2);
  const seqA = Array.from({ length: 6 }, () => a());
  const seqB = Array.from({ length: 6 }, () => b());
  assert(seqA.some((value, i) => value !== seqB[i]));
});

test('rng: values stay within [0, 1)', () => {
  const rand = createMulberry32(42);
  for (let i = 0; i < 500; i++) {
    const value = rand();
    assert(value >= 0 && value < 1, `out of range: ${value}`);
  }
});

test('rng: chunk seed hashing is stable and position-sensitive', () => {
  assertEqual(hashChunkSeed(99, 3, 4), hashChunkSeed(99, 3, 4));
  assert(hashChunkSeed(99, 3, 4) !== hashChunkSeed(99, 4, 3), 'cx/cy must not be symmetric');
  assert(hashChunkSeed(99, 0, 0) !== hashChunkSeed(100, 0, 0), 'base seed must matter');
  assertEqual(hashChunkSeed(99, -2, -7), hashChunkSeed(99, -2, -7));
});

test('rng: withSeed is reproducible and restores Math.random', () => {
  const original = Math.random;
  let first;
  let second;
  withSeed(7, () => {
    first = Math.random();
  });
  withSeed(7, () => {
    second = Math.random();
  });
  assertEqual(first, second);
  assert(Math.random === original, 'Math.random must be restored');
});

test('rng: withSeed(null) runs without swapping Math.random', () => {
  const original = Math.random;
  let ran = false;
  withSeed(null, () => {
    ran = true;
  });
  assert(ran);
  assert(Math.random === original);
});

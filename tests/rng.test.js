// Deterministic PRNG tests: world generation reproducibility depends on these.
import { test, assert, assertEqual, assertDeepEqual } from './harness.js';
import { createMulberry32, hashChunkSeed, randomWorldSeed, parseWorldSeed } from '../src/core/rng.js';
import { DistrictChunk } from '../src/world/chunk.js';

test('rng: seeded worldgen never reassigns Math.random', () => {
  const descriptor = Object.getOwnPropertyDescriptor(Math, 'random');
  Object.defineProperty(Math, 'random', {
    value: () => {
      throw new Error('Math.random used during seeded worldgen');
    },
    writable: false,
    configurable: true,
  });
  try {
    const chunk = new DistrictChunk(0, 0, { seed: 123, gridSize: 15, incomeTier: 'HIGH' });
    assert(chunk.income > 0);
  } finally {
    Object.defineProperty(Math, 'random', descriptor);
  }
});

test('rng: unseeded worldgen still uses the global random source', () => {
  const descriptor = Object.getOwnPropertyDescriptor(Math, 'random');
  Object.defineProperty(Math, 'random', {
    value: () => 0.5,
    writable: true,
    configurable: true,
  });
  try {
    const chunk = new DistrictChunk(0, 0, { seed: null, gridSize: 15, incomeTier: 'HIGH' });
    assertEqual(chunk.income, 1750);
  } finally {
    Object.defineProperty(Math, 'random', descriptor);
  }
});

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

test('rng: randomWorldSeed stays in the supported integer range', () => {
  for (let i = 0; i < 200; i++) {
    const seed = randomWorldSeed();
    assert(Number.isInteger(seed), `seed not integer: ${seed}`);
    assert(seed >= 1 && seed <= 2147483647, `seed out of range: ${seed}`);
  }
});

test('rng: parseWorldSeed accepts blank/invalid as random and valid integers as seeds', () => {
  assertEqual(parseWorldSeed(''), null);
  assertEqual(parseWorldSeed('   '), null);
  assertEqual(parseWorldSeed(undefined), null);
  assertEqual(parseWorldSeed('abc'), null);
  assertEqual(parseWorldSeed('12.5'), null);
  assertEqual(parseWorldSeed('-3'), null);
  assertEqual(parseWorldSeed('2147483648'), null);
  assertEqual(parseWorldSeed('0'), 0);
  assertEqual(parseWorldSeed('12345'), 12345);
  assertEqual(parseWorldSeed(777), 777);
});

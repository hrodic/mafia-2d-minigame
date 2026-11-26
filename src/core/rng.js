// Deterministic PRNG helpers.
//
// `withSeed` temporarily swaps Math.random so legacy world-generation code is
// reproducible; it is replaced by an explicit injected rng in Phase 2.

export function createMulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashChunkSeed(baseSeed, cx, cy) {
  let h = (baseSeed ^ Math.imul(cx + 512, 374761393) ^ Math.imul(cy + 512, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export function withSeed(seed, fn) {
  if (seed === null || seed === undefined) return fn();
  const origRandom = Math.random;
  Math.random = createMulberry32(seed);
  try {
    return fn();
  } finally {
    Math.random = origRandom;
  }
}

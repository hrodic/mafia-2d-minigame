// Deterministic PRNG helpers.
//
// World generation receives an explicit PRNG (createMulberry32) derived from the world
// seed; it never swaps the browser-global Math.random. Unseeded worlds fall back to
// Math.random at the call site.

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

const MAX_WORLD_SEED = 2147483647;

/** Random base seed for a fresh match (1..2147483647). */
export function randomWorldSeed() {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    return (crypto.getRandomValues(new Uint32Array(1))[0] % MAX_WORLD_SEED) + 1;
  }
  return Math.floor(Math.random() * MAX_WORLD_SEED) + 1;
}

/**
 * Parse a user-entered seed. Blank/invalid returns null (caller generates one).
 * 0 is a valid explicit seed; the supported range is 0..2147483647.
 */
export function parseWorldSeed(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const seed = Number(text);
  if (!Number.isInteger(seed) || seed < 0 || seed > MAX_WORLD_SEED) return null;
  return seed;
}

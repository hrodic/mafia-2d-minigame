// Golden world-generation hashes. These lock the exact seeded output (terrain,
// props, income, faction) so refactors of the RNG/generation pipeline can be proven
// behavior-preserving. If generation is intentionally changed, update the hashes in
// the same commit with a note explaining why.
import { test, assert, assertEqual } from './harness.js';
import { Faction } from '../src/config/enums.js';
import { DistrictChunk } from '../src/world/chunk.js';

const GENERATION = {
  gridSize: 15,
  incomeTier: 'HIGH',
  activeFactions: [Faction.PLAYER, Faction.RIVAL_1, Faction.RIVAL_2, Faction.RIVAL_3],
};

function hashChunk(chunk) {
  let h = 2166136261 >>> 0;
  const mul = (n) => {
    h = Math.imul(h ^ (n >>> 0), 16777619) >>> 0;
  };
  const str = (s) => {
    for (let i = 0; i < s.length; i++) mul(s.charCodeAt(i));
  };
  const grids = [
    chunk.ground,
    chunk.elevation,
    chunk.buildingStyle,
    chunk.props,
    chunk.propColors,
    chunk.propVertical,
    chunk.propCurbSide,
  ];
  for (const grid of grids) {
    for (const row of grid) {
      for (const value of row) {
        str(String(value));
        mul(44); // separator
      }
    }
  }
  for (const value of Array.from(chunk.solidMask)) mul(value);
  mul(chunk.income);
  str(String(chunk.faction));
  return (h >>> 0).toString(16).padStart(8, '0');
}

function chunkHash(seed, cx, cy) {
  return hashChunk(new DistrictChunk(cx, cy, { ...GENERATION, seed }));
}

test('golden: seeded chunks keep their exact generated output', () => {
  // [seed, cx, cy, expected FNV-1a hash of all tile/prop/income/faction data]
  // Updated for the intentional income-tier rebalance (High 1000-1500).
  const cases = [
    [123456789, 0, 0, '4585485d'],
    [123456789, 3, 7, 'a2a54c54'],
    [123456789, -2, 5, '375e4490'],
    [42, 14, 14, 'd384c387'],
    [987654321, 7, 3, '3eb4ceea'],
    [1, 0, 0, '4430b34d'],
  ];
  for (const [seed, cx, cy, expected] of cases) {
    assertEqual(chunkHash(seed, cx, cy), expected, `seed ${seed} chunk ${cx},${cy}`);
  }
});

test('golden: repeat generation is byte-identical', () => {
  for (const [cx, cy] of [[0, 0], [3, 7], [14, 14], [-2, 5]]) {
    assertEqual(chunkHash(555, cx, cy), chunkHash(555, cx, cy));
  }
});

test('golden: different seeds produce different cities', () => {
  assert(chunkHash(100, 2, 4) !== chunkHash(101, 2, 4));
});

test('golden: the hash covers income and faction assignment', () => {
  for (const [seed, cx, cy] of [[123456789, 0, 0], [42, 14, 14]]) {
    const a = new DistrictChunk(cx, cy, { ...GENERATION, seed });
    const b = new DistrictChunk(cx, cy, { ...GENERATION, seed });
    b.income += 1;
    assert(hashChunk(a) !== hashChunk(b), 'income must affect the hash');
    b.income -= 1;
    b.faction = b.faction === Faction.PLAYER ? Faction.RIVAL_1 : Faction.PLAYER;
    assert(hashChunk(a) !== hashChunk(b), 'faction must affect the hash');
  }
});

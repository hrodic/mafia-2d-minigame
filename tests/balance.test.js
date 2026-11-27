// Balance tables are the tuning surface. These tests lock the current gameplay values;
// when a tuning change is intentional, update the expected values here in the same commit.
import { test, assert, assertEqual, assertDeepEqual } from './harness.js';
import { UnitRank } from '../src/config/enums.js';
import { MAX_PISTOL_RANGE } from '../src/config/constants.js';
import {
  RANK_STATS,
  UNIT_CAPS,
  CORRUPTION,
  INCOME_TIERS,
  SLASH,
  PISTOL,
  COST_SOLDIER,
  COST_CAPTAIN,
  COST_UNDERBOSS,
  COST_BOSS_ARMOR,
  UPKEEP_SOLDIER,
  UPKEEP_CAPTAIN,
  UPKEEP_UNDERBOSS,
  BOSS_MAX_HP,
  MAX_BOSS_ARMOR,
  getGridUnitCaps,
  clampMatchUnitCaps,
  defaultMatchUnitCaps,
} from '../src/config/balance.js';

const EXPECTED_RANKS = {
  [UnitRank.BOSS]: {
    hp: 800,
    startArmor: 0,
    maxArmor: 300,
    minDmg: 30,
    maxDmg: 40,
    speedAi: 140,
    speedHuman: 140,
    speedJitter: 0,
    radius: 13.5,
    capturePerTick: 1,
    cost: 0,
    upkeep: 0,
  },
  [UnitRank.UNDERBOSS]: {
    hp: 800,
    startArmor: 120,
    maxArmor: 120,
    minDmg: 25,
    maxDmg: 35,
    speedAi: 150,
    speedHuman: 150,
    speedJitter: 0,
    radius: 12.8,
    capturePerTick: 1,
    cost: 4000,
    upkeep: 600,
  },
  [UnitRank.CAPTAIN]: {
    hp: 600,
    startArmor: 0,
    maxArmor: 0,
    minDmg: 20,
    maxDmg: 30,
    speedAi: 160,
    speedHuman: 160,
    speedJitter: 0,
    radius: 12,
    capturePerTick: 0.5,
    cost: 2500,
    upkeep: 300,
  },
  [UnitRank.SOLDIER]: {
    hp: 300,
    startArmor: 0,
    maxArmor: 0,
    minDmg: 15,
    maxDmg: 25,
    speedAi: 170,
    speedHuman: 170,
    speedJitter: 0,
    radius: 11,
    capturePerTick: 0.2,
    cost: 1000,
    upkeep: 100,
  },
};

test('balance: rank stats keep the original gameplay values', () => {
  for (const [rank, expected] of Object.entries(EXPECTED_RANKS)) {
    for (const [key, value] of Object.entries(expected)) {
      assertEqual(RANK_STATS[rank][key], value, `${rank}.${key}`);
    }
  }
});

test('balance: cost/upkeep/HP aliases derive from rank stats', () => {
  assertEqual(COST_SOLDIER, RANK_STATS[UnitRank.SOLDIER].cost);
  assertEqual(COST_CAPTAIN, RANK_STATS[UnitRank.CAPTAIN].cost);
  assertEqual(COST_UNDERBOSS, RANK_STATS[UnitRank.UNDERBOSS].cost);
  assertEqual(UPKEEP_SOLDIER, RANK_STATS[UnitRank.SOLDIER].upkeep);
  assertEqual(UPKEEP_CAPTAIN, RANK_STATS[UnitRank.CAPTAIN].upkeep);
  assertEqual(UPKEEP_UNDERBOSS, RANK_STATS[UnitRank.UNDERBOSS].upkeep);
  assertEqual(BOSS_MAX_HP, RANK_STATS[UnitRank.BOSS].hp);
  assertEqual(MAX_BOSS_ARMOR, RANK_STATS[UnitRank.BOSS].maxArmor);
  assertEqual(COST_BOSS_ARMOR, 3500);
});

test('balance: unit caps scale by grid side and tier minimums are locked', () => {
  assertDeepEqual(UNIT_CAPS, {
    underbossPerSide: 1,
    captainPerSide: 2,
    soldierPerSide: 10,
    minUnderbosses: 1,
    minCaptains: 2,
    minSoldiers: 10,
    humanCapFraction: 1,
  });
  assertDeepEqual(getGridUnitCaps(5), {
    maxUnderbosses: 5,
    maxCaptains: 10,
    maxSoldiers: 50,
  });
  assertDeepEqual(getGridUnitCaps(15), {
    maxUnderbosses: 15,
    maxCaptains: 30,
    maxSoldiers: 150,
  });
  assertDeepEqual(getGridUnitCaps(25), {
    maxUnderbosses: 25,
    maxCaptains: 50,
    maxSoldiers: 250,
  });
  assertDeepEqual(clampMatchUnitCaps(15, { maxSoldiers: 140 }), {
    maxUnderbosses: 15,
    maxCaptains: 30,
    maxSoldiers: 140,
  });
  assertDeepEqual(
    clampMatchUnitCaps(15, { maxSoldiers: 999, maxCaptains: 1, maxUnderbosses: 0 }),
    { maxUnderbosses: 1, maxCaptains: 2, maxSoldiers: 150 }
  );
  assertDeepEqual(defaultMatchUnitCaps(10), {
    maxSoldiers: 100,
    maxCaptains: 20,
    maxUnderbosses: 10,
  });
  assertDeepEqual(defaultMatchUnitCaps(15), {
    maxSoldiers: 150,
    maxCaptains: 30,
    maxUnderbosses: 15,
  });
});

test('balance: non-boss AI ranks use their rank speed, bosses use 140 for sprint headroom', () => {
  const speedByRank = {
    [UnitRank.BOSS]: 140,
    [UnitRank.UNDERBOSS]: 150,
    [UnitRank.CAPTAIN]: 160,
    [UnitRank.SOLDIER]: 170,
  };
  for (const rank of Object.values(UnitRank)) {
    const expected = speedByRank[rank];
    assertEqual(RANK_STATS[rank].speedAi, expected, `${rank}.speedAi`);
    assertEqual(RANK_STATS[rank].speedHuman, expected, `${rank}.speedHuman`);
    assertEqual(RANK_STATS[rank].speedJitter, 0, `${rank}.speedJitter`);
  }
});

test('balance: income tiers and corruption steps are locked', () => {
  assertDeepEqual(INCOME_TIERS, {
    LOW: { label: 'Low', min: 500, max: 1000 },
    MID: { label: 'Mid', min: 1000, max: 1500 },
    HIGH: { label: 'High', min: 1500, max: 2000 },
  });
  assertDeepEqual(CORRUPTION, {
    neighborhoodsPerStep: 10,
    unitsPerStep: 25,
    percentPerStep: 1,
  });
});

test('balance: knife rules tier reach, targets, arcs and cooldowns', () => {
  const common = { knockback: 10, anim: 0.18 };
  assertDeepEqual(SLASH.humanBoss, { reach: 52, maxTargets: 3, arc: 150 / 360, ...common, cooldown: 0.8 });
  assertDeepEqual(SLASH.aiBoss, { reach: 52, maxTargets: 3, arc: 150 / 360, ...common, cooldown: 0.8 });
  assertDeepEqual(SLASH.aiMelee, { reach: 46, maxTargets: 1, arc: 90 / 360, ...common, cooldown: 1.5 });
  assertDeepEqual(SLASH.aiMeleeByRank, {
    [UnitRank.UNDERBOSS]: { reach: 50, maxTargets: 3, arc: 120 / 360, ...common, cooldown: 1.0 },
    [UnitRank.CAPTAIN]: { reach: 48, maxTargets: 2, arc: 100 / 360, ...common, cooldown: 1.2 },
    [UnitRank.SOLDIER]: { reach: 46, maxTargets: 1, arc: 90 / 360, ...common, cooldown: 1.5 },
  });
  assertEqual(SLASH.player, undefined);
  assertEqual(SLASH.rivalBoss, undefined);
});

test('balance: pistol stats, magazine and accuracy bands are locked', () => {
  assertEqual(PISTOL.minDmg, 50);
  assertEqual(PISTOL.maxDmg, 80);
  assertEqual(PISTOL.knockbackMin, 10);
  assertEqual(PISTOL.knockbackMax, 15);
  assertEqual(PISTOL.magazine, 10);
  assertEqual(PISTOL.fireCooldown, 0.2);
  assertEqual(PISTOL.reloadTime, 5);
  assertEqual(PISTOL.outOfRange.failChance, 1);
  assertEqual(PISTOL.outOfRange.dmgMult, 0);
  assertEqual(PISTOL.outOfRange.label, '0% chance');

  const expected = [
    [100, 0.1, 0.8],
    [200, 0.2, 0.9],
    [300, 0.3, 1],
    [400, 0.4, 1],
    [500, 0.5, 1],
    [MAX_PISTOL_RANGE, 0.6, 1],
  ];
  assertEqual(MAX_PISTOL_RANGE, 600);
  assertEqual(PISTOL.accuracyBands.length, expected.length);
  let previous = -Infinity;
  for (let i = 0; i < expected.length; i++) {
    const band = PISTOL.accuracyBands[i];
    const [maxDist, failChance, dmgMult] = expected[i];
    assertEqual(band.maxDist, maxDist, `band ${i} maxDist`);
    assertEqual(band.failChance, failChance, `band ${i} failChance`);
    assertEqual(band.dmgMult, dmgMult, `band ${i} dmgMult`);
    assert(band.maxDist > previous, 'bands must be sorted');
    previous = band.maxDist;
    assert(band.label && band.color, `band ${i} display metadata`);
    assertEqual(band.label, `${Math.round((1 - band.failChance) * 100)}% chance`, `band ${i} label`);
    assertEqual(band.inclusive, true, `band ${i} must include its maxDist`);
  }
});

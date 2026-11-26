// Balance tables are the tuning surface. These tests lock the current gameplay values;
// when a tuning change is intentional, update the expected values here in the same commit.
import { test, assert, assertEqual, assertDeepEqual } from './harness.js';
import { UnitRank } from '../src/config/enums.js';
import { MAX_PISTOL_RANGE } from '../src/config/constants.js';
import {
  RANK_STATS,
  UNIT_CAPS,
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
  UNIT_ATTACK_COOLDOWN,
} from '../src/config/balance.js';

const EXPECTED_RANKS = {
  [UnitRank.BOSS]: {
    hp: 400,
    startArmor: 0,
    maxArmor: 300,
    minDmg: 20,
    maxDmg: 40,
    speedAi: 140,
    speedHuman: 140,
    speedJitter: 0,
    radius: 13.5,
    captureRate: 0.375,
    cost: 0,
    upkeep: 0,
  },
  [UnitRank.UNDERBOSS]: {
    hp: 480,
    startArmor: 120,
    maxArmor: 120,
    minDmg: 26,
    maxDmg: 38,
    speedAi: 150,
    speedHuman: 150,
    speedJitter: 0,
    radius: 12.8,
    captureRate: 0.24,
    cost: 3800,
    upkeep: 150,
  },
  [UnitRank.CAPTAIN]: {
    hp: 340,
    startArmor: 0,
    maxArmor: 0,
    minDmg: 18,
    maxDmg: 28,
    speedAi: 150,
    speedHuman: 150,
    speedJitter: 0,
    radius: 12,
    captureRate: 0.18,
    cost: 2200,
    upkeep: 100,
  },
  [UnitRank.SOLDIER]: {
    hp: 180,
    startArmor: 0,
    maxArmor: 0,
    minDmg: 10,
    maxDmg: 18,
    speedAi: 150,
    speedHuman: 150,
    speedJitter: 0,
    radius: 11,
    captureRate: 0.12,
    cost: 1200,
    upkeep: 50,
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

test('balance: unit caps and attack pacing are unchanged', () => {
  assertDeepEqual(UNIT_CAPS, {
    minNeighborhoods: 25,
    underbossFraction: 0.05,
    captainFraction: 0.1,
    humanCapFraction: 0.5,
  });
  assertEqual(UNIT_ATTACK_COOLDOWN, 1.0);
});

test('balance: non-boss AI ranks use 150, bosses use 140 for sprint headroom', () => {
  for (const rank of Object.values(UnitRank)) {
    const expected = rank === UnitRank.BOSS ? 140 : 150;
    assertEqual(RANK_STATS[rank].speedAi, expected, `${rank}.speedAi`);
    assertEqual(RANK_STATS[rank].speedHuman, expected, `${rank}.speedHuman`);
    assertEqual(RANK_STATS[rank].speedJitter, 0, `${rank}.speedJitter`);
  }
});

test('balance: one human slash rule, distinct AI slash rules', () => {
  assertDeepEqual(SLASH.humanBoss, {
    reach: 52,
    maxTargets: 3,
    arc: 0.42,
    closeRange: 30,
    knockback: 14,
    cooldown: 0.34,
    anim: 0.18,
  });
  assertDeepEqual(SLASH.aiBoss, {
    reach: 52,
    maxTargets: 3,
    arc: null,
    closeRange: null,
    knockback: 12,
    cooldown: 1.0,
    anim: 0.18,
  });
  assertDeepEqual(SLASH.aiMelee, {
    reach: 46,
    maxTargets: 1,
    arc: null,
    closeRange: null,
    knockback: 0,
    cooldown: 1.0,
    anim: 0.18,
  });
  assertEqual(SLASH.player, undefined);
  assertEqual(SLASH.rivalBoss, undefined);
});

test('balance: pistol stats and accuracy bands are ordered and covered', () => {
  assertEqual(PISTOL.minDmg, 40);
  assertEqual(PISTOL.maxDmg, 80);
  assertEqual(PISTOL.knockback, 16);
  assertEqual(PISTOL.cooldownAi, UNIT_ATTACK_COOLDOWN);
  assertEqual(PISTOL.cooldownHuman, 0.65);
  assertEqual(PISTOL.outOfRange.failChance, 1);
  assertEqual(PISTOL.outOfRange.dmgMult, 0);
  assertEqual(PISTOL.outOfRange.label, '0% chance');

  const expected = [
    [50, 0, 0.25],
    [100, 0, 0.5],
    [MAX_PISTOL_RANGE * 0.25, 0, 1],
    [MAX_PISTOL_RANGE * 0.5, 0.05, 1],
    [MAX_PISTOL_RANGE * 0.75, 0.1, 1],
    [MAX_PISTOL_RANGE * 0.9, 0.25, 1],
    [Infinity, 0.5, 1],
  ];
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
  }
  assertEqual(PISTOL.accuracyBands[0].inclusive, true);
  for (let i = 1; i < PISTOL.accuracyBands.length; i++) {
    assert(!PISTOL.accuracyBands[i].inclusive, `band ${i} must be exclusive`);
  }
});

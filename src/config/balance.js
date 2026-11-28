// Static balance data: the single tuning surface for gameplay numbers.
// Presentation-only values (effect lifetimes, UI sizes) and AI decision logic stay
// in their own modules. Characterisation tests lock the current values.

import { UnitRank } from './enums.js';
import { MAX_PISTOL_RANGE, MAX_MP9_RANGE } from './constants.js';

export const INCOME_TIERS = {
  LOW: { label: 'Low', min: 250, max: 500 },
  MID: { label: 'Mid', min: 500, max: 1000 },
  HIGH: { label: 'High', min: 1000, max: 1500 },
};

// Non-boss AI ranks use per-rank speeds; human-controlled bosses still use speedHuman.
export const RANK_STATS = {
  [UnitRank.BOSS]: {
    hp: 800,
    startArmor: 0,
    maxArmor: 300,
    minDmg: 30,
    maxDmg: 40,
    speedAi: 130,
    speedHuman: 130,
    speedJitter: 0,
    radius: 13.5,
    capturePerTick: 1,
    regenPerSecond: 5,
    cost: 0,
    upkeep: 0,
  },
  [UnitRank.UNDERBOSS]: {
    hp: 800,
    startArmor: 120,
    maxArmor: 120,
    minDmg: 25,
    maxDmg: 35,
    speedAi: 135,
    speedHuman: 135,
    speedJitter: 0,
    radius: 12.8,
    capturePerTick: 1,
    regenPerSecond: 4,
    cost: 2000,
    upkeep: 300,
  },
  [UnitRank.CAPTAIN]: {
    hp: 600,
    startArmor: 0,
    maxArmor: 0,
    minDmg: 20,
    maxDmg: 30,
    speedAi: 140,
    speedHuman: 140,
    speedJitter: 0,
    radius: 12,
    capturePerTick: 0.5,
    regenPerSecond: 2,
    cost: 1250,
    upkeep: 150,
  },
  [UnitRank.SOLDIER]: {
    hp: 300,
    startArmor: 0,
    maxArmor: 0,
    minDmg: 15,
    maxDmg: 25,
    speedAi: 150,
    speedHuman: 150,
    speedJitter: 0,
    radius: 11,
    capturePerTick: 0.2,
    regenPerSecond: 1,
    cost: 500,
    upkeep: 50,
  },
};

export const CORRUPTION = {
  neighborhoodsPerStep: 10,
  unitsPerStep: 25,
  percentPerStep: 1,
};

export const AI_TACTICS = {
  bossRetreatHpFraction: 0.35,
  bossRetreatMinEnemies: 3,
  bossRetreatDuration: 2.2,
  bossRetreatDistance: 280,
  flankDistance: 90,
  flankDuration: 0.9,
  rangedBackoffDistance: 110,
  rangedBackoffStep: 80,
  rangedBackoffDuration: 0.6,
  bossMeleeCommitDistance: 110,
  rangedAggroBuffer: 100,
  meleeAggroRange: 500,
  bossDangerInterval: 0.2,
  bossMeleeThreatRange: 420,
  bossSupportRadius: 500,
};

/** Bosses are 25% heavier when pushing/resisting pushes; every other rank is 1. */
export function getPushMass(rank) {
  return rank === UnitRank.BOSS ? 1.25 : 1;
}

export const PUSH_SPEED_FACTOR = 0.3;

export const UNIT_CAPS = {
  underbossPerSide: 1,
  captainPerSide: 2,
  soldierPerSide: 10,
  minUnderbosses: 1,
  minCaptains: 2,
  minSoldiers: 10,
  // Humans and AI both start at the full ceiling; lowering a slider is opt-in.
  humanCapFraction: 1,
};

/** Hard caps for a square city grid: underbosses ×1, captains ×2, soldiers ×10 per side. */
export function getGridUnitCaps(gridSize) {
  const side = Math.max(5, Math.min(25, Math.floor(Number(gridSize) || 5)));
  return {
    maxUnderbosses: Math.max(UNIT_CAPS.minUnderbosses, side * UNIT_CAPS.underbossPerSide),
    maxCaptains: Math.max(UNIT_CAPS.minCaptains, side * UNIT_CAPS.captainPerSide),
    maxSoldiers: Math.max(UNIT_CAPS.minSoldiers, side * UNIT_CAPS.soldierPerSide),
  };
}

/** Default spawn caps at a fraction of each rank's hard cap, never below its minimum. */
export function defaultSpawnCaps(caps, fraction) {
  const scale = (max, min) => Math.min(max, Math.max(min, Math.round(max * fraction)));
  return {
    [UnitRank.SOLDIER]: scale(caps.maxSoldiers, UNIT_CAPS.minSoldiers),
    [UnitRank.CAPTAIN]: scale(caps.maxCaptains, UNIT_CAPS.minCaptains),
    [UnitRank.UNDERBOSS]: scale(caps.maxUnderbosses, UNIT_CAPS.minUnderbosses),
  };
}

/** Clamp player-chosen match maxima between static rank minimums and the grid ceiling. */
export function clampMatchUnitCaps(gridSize, requested = {}) {
  const hard = getGridUnitCaps(gridSize);
  const source = requested || {};
  const clamp = (value, max, min) => {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : max;
  };
  return {
    maxSoldiers: clamp(source.maxSoldiers, hard.maxSoldiers, UNIT_CAPS.minSoldiers),
    maxCaptains: clamp(source.maxCaptains, hard.maxCaptains, UNIT_CAPS.minCaptains),
    maxUnderbosses: clamp(source.maxUnderbosses, hard.maxUnderbosses, UNIT_CAPS.minUnderbosses),
  };
}

/** Grid-derived defaults for the setup sliders: the full ceiling, never below its minimum. */
export function defaultMatchUnitCaps(gridSize, fraction = UNIT_CAPS.humanCapFraction) {
  const hard = getGridUnitCaps(gridSize);
  const scale = (max, min) => Math.min(max, Math.max(min, Math.round(max * fraction)));
  return {
    maxSoldiers: scale(hard.maxSoldiers, UNIT_CAPS.minSoldiers),
    maxCaptains: scale(hard.maxCaptains, UNIT_CAPS.minCaptains),
    maxUnderbosses: scale(hard.maxUnderbosses, UNIT_CAPS.minUnderbosses),
  };
}

// Every slash shares one knockback and one swing animation. Reach, target count,
// frontal arc and cooldown differ by rank. `arc` is the cone's half-angle as a
// fraction of 180 degrees, so the full cone is 2 x arc x 180 degrees.
const SLASH_COMMON = {
  knockback: 10,
  anim: 0.18,
};

export const SLASH = {
  humanBoss: {
    reach: 52,
    maxTargets: 3,
    arc: 150 / 360,
    ...SLASH_COMMON,
    cooldown: 0.8,
  },
  aiBoss: {
    reach: 52,
    maxTargets: 3,
    arc: 150 / 360,
    ...SLASH_COMMON,
    cooldown: 0.8,
  },
  aiMelee: {
    reach: 46,
    maxTargets: 1,
    arc: 90 / 360,
    ...SLASH_COMMON,
    cooldown: 1.5,
  },
  aiMeleeByRank: {
    [UnitRank.UNDERBOSS]: { reach: 50, maxTargets: 3, arc: 120 / 360, ...SLASH_COMMON, cooldown: 1.0 },
    [UnitRank.CAPTAIN]: { reach: 48, maxTargets: 2, arc: 100 / 360, ...SLASH_COMMON, cooldown: 1.2 },
    [UnitRank.SOLDIER]: { reach: 46, maxTargets: 1, arc: 90 / 360, ...SLASH_COMMON, cooldown: 1.5 },
  },
};

export const PISTOL = {
  minDmg: 50,
  maxDmg: 80,
  knockbackMin: 10,
  knockbackMax: 15,
  magazine: 10,
  fireCooldown: 0.2,
  reloadTime: 4,
  range: MAX_PISTOL_RANGE,
  outOfRange: {
    failChance: 1,
    dmgMult: 0,
    label: '0% chance',
    color: '#71717a',
  },
  accuracyBands: [
    { maxDist: 100, inclusive: true, failChance: 0.1, dmgMult: 0.8, label: '90% chance', color: '#f97316' },
    { maxDist: 200, inclusive: true, failChance: 0.2, dmgMult: 0.9, label: '80% chance', color: '#fb923c' },
    { maxDist: 300, inclusive: true, failChance: 0.3, dmgMult: 1, label: '70% chance', color: '#a3e635' },
    { maxDist: 400, inclusive: true, failChance: 0.4, dmgMult: 1, label: '60% chance', color: '#fbbf24' },
    { maxDist: 500, inclusive: true, failChance: 0.5, dmgMult: 1, label: '50% chance', color: '#fb923c' },
    {
      maxDist: MAX_PISTOL_RANGE,
      inclusive: true,
      failChance: 0.6,
      dmgMult: 1,
      label: '40% chance',
      color: '#f43f5e',
    },
  ],
};

// Boss-only automatic SMG upgrade. Same damage as the pistol, double the
// magazine and rate of fire, pistol accuracy to 600 px, then a low-probability
// 600-700 px tail.
export const MP9 = {
  minDmg: PISTOL.minDmg,
  maxDmg: PISTOL.maxDmg,
  knockbackMin: PISTOL.knockbackMin,
  knockbackMax: PISTOL.knockbackMax,
  magazine: 20,
  fireCooldown: 0.1,
  reloadTime: 4,
  range: MAX_MP9_RANGE,
  outOfRange: { ...PISTOL.outOfRange },
  accuracyBands: [
    ...PISTOL.accuracyBands,
    {
      maxDist: MAX_MP9_RANGE,
      inclusive: true,
      failChance: 0.7,
      dmgMult: 1,
      label: '30% chance',
      color: '#f43f5e',
    },
  ],
};

export const WEAPONS = {
  pistol: PISTOL,
  mp9: MP9,
};

export const CRITICAL = {
  // Base chance for every weapon. A hit from the target's rear 120° cone adds
  // backBonus to the chance. Critical damage is multiplied before armor absorbs.
  chance: 0.05,
  backBonus: 0.15,
  backArcCos: 0.5,
  multiplier: 2,
};

export const COST_BOSS_ARMOR = 2000;
export const COST_BOSS_GLOCK = 1000;
export const COST_BOSS_MP9 = 4000;
export const COST_BOSS_AMMO = 20;
export const AMMO_ROUNDS_PER_PURCHASE = 20;
export const PISTOL_MAG_CAP = 20;
export const MP9_MAG_CAP = 10;
export const START_PISTOL_MAGS = 0;
export const MP9_INCLUDED_MAGS = 0;
export const AI_MP9_MIN_CREW = 5;
export const AI_MP9_MIN_TURFS = 3;

export const COST_SOLDIER = RANK_STATS[UnitRank.SOLDIER].cost;
export const COST_CAPTAIN = RANK_STATS[UnitRank.CAPTAIN].cost;
export const COST_UNDERBOSS = RANK_STATS[UnitRank.UNDERBOSS].cost;

export const UPKEEP_SOLDIER = RANK_STATS[UnitRank.SOLDIER].upkeep;
export const UPKEEP_CAPTAIN = RANK_STATS[UnitRank.CAPTAIN].upkeep;
export const UPKEEP_UNDERBOSS = RANK_STATS[UnitRank.UNDERBOSS].upkeep;

export const BOSS_MAX_HP = RANK_STATS[UnitRank.BOSS].hp;
export const MAX_BOSS_ARMOR = RANK_STATS[UnitRank.BOSS].maxArmor;

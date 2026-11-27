// Static balance data: the single tuning surface for gameplay numbers.
// Presentation-only values (effect lifetimes, UI sizes) and AI decision logic stay
// in their own modules. Characterisation tests lock the current values.

import { UnitRank } from './enums.js';
import { MAX_PISTOL_RANGE } from './constants.js';

export const INCOME_TIERS = {
  LOW: { label: 'Low', min: 500, max: 1000 },
  MID: { label: 'Mid', min: 1000, max: 1500 },
  HIGH: { label: 'High', min: 1500, max: 2000 },
};

export const UNIT_ATTACK_COOLDOWN = 1.0;

// All AI-controlled ranks share one 150 px/s base for now. Role/tier speed can
// diverge later; human-controlled bosses still use speedHuman.
export const RANK_STATS = {
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
    upkeep: 380,
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
    upkeep: 220,
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
    upkeep: 120,
  },
};

export const CORRUPTION = {
  neighborhoodsPerStep: 10,
  unitsPerStep: 25,
  percentPerStep: 1,
};

export const UNIT_CAPS = {
  underbossPerSide: 1,
  captainPerSide: 2,
  soldierPerSide: 10,
  minUnderbosses: 1,
  minCaptains: 2,
  minSoldiers: 10,
  humanCapFraction: 0.5,
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

/** Default spawn caps at a fraction of each tier's hard cap, never below its minimum. */
export function defaultSpawnCaps(caps, fraction) {
  const scale = (max, min) => Math.min(max, Math.max(min, Math.round(max * fraction)));
  return {
    [UnitRank.SOLDIER]: scale(caps.maxSoldiers, UNIT_CAPS.minSoldiers),
    [UnitRank.CAPTAIN]: scale(caps.maxCaptains, UNIT_CAPS.minCaptains),
    [UnitRank.UNDERBOSS]: scale(caps.maxUnderbosses, UNIT_CAPS.minUnderbosses),
  };
}

/** Clamp player-chosen match maxima between static tier minimums and the grid ceiling. */
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

/** Grid-derived defaults for the setup sliders: half of each ceiling, never below its minimum. */
export function defaultMatchUnitCaps(gridSize, fraction = UNIT_CAPS.humanCapFraction) {
  const hard = getGridUnitCaps(gridSize);
  const scale = (max, min) => Math.min(max, Math.max(min, Math.round(max * fraction)));
  return {
    maxSoldiers: scale(hard.maxSoldiers, UNIT_CAPS.minSoldiers),
    maxCaptains: scale(hard.maxCaptains, UNIT_CAPS.minCaptains),
    maxUnderbosses: scale(hard.maxUnderbosses, UNIT_CAPS.minUnderbosses),
  };
}

export const SLASH = {
  // One rule set for every human-controlled boss (local player or remote guest).
  humanBoss: {
    reach: 52,
    maxTargets: 3,
    arc: 0.42,
    closeRange: 30,
    knockback: 14,
    cooldown: 0.34,
    anim: 0.18,
  },
  aiBoss: {
    reach: 52,
    maxTargets: 3,
    arc: null,
    closeRange: null,
    knockback: 12,
    cooldown: UNIT_ATTACK_COOLDOWN,
    anim: 0.18,
  },
  aiMelee: {
    reach: 46,
    maxTargets: 1,
    arc: null,
    closeRange: null,
    knockback: 0,
    cooldown: UNIT_ATTACK_COOLDOWN,
    anim: 0.18,
  },
};

export const PISTOL = {
  minDmg: 40,
  maxDmg: 80,
  knockback: 16,
  cooldownAi: UNIT_ATTACK_COOLDOWN,
  cooldownHuman: 0.65,
  outOfRange: {
    failChance: 1,
    dmgMult: 0,
    label: '0% chance',
    color: '#71717a',
  },
  accuracyBands: [
    {
      maxDist: 50,
      inclusive: true,
      failChance: 0,
      dmgMult: 0.25,
      label: '100% chance',
      color: '#f97316',
    },
    { maxDist: 100, failChance: 0, dmgMult: 0.5, label: '100% chance', color: '#fb923c' },
    {
      maxDist: MAX_PISTOL_RANGE * 0.25,
      failChance: 0,
      dmgMult: 1,
      label: '100% chance',
      color: '#34d399',
    },
    {
      maxDist: MAX_PISTOL_RANGE * 0.5,
      failChance: 0.05,
      dmgMult: 1,
      label: '95% chance',
      color: '#a3e635',
    },
    {
      maxDist: MAX_PISTOL_RANGE * 0.75,
      failChance: 0.1,
      dmgMult: 1,
      label: '90% chance',
      color: '#fbbf24',
    },
    {
      maxDist: MAX_PISTOL_RANGE * 0.9,
      failChance: 0.25,
      dmgMult: 1,
      label: '75% chance',
      color: '#fb923c',
    },
    {
      maxDist: Infinity,
      failChance: 0.5,
      dmgMult: 1,
      label: '50% chance',
      color: '#f43f5e',
    },
  ],
};

export const COST_BOSS_ARMOR = 3500;

export const COST_SOLDIER = RANK_STATS[UnitRank.SOLDIER].cost;
export const COST_CAPTAIN = RANK_STATS[UnitRank.CAPTAIN].cost;
export const COST_UNDERBOSS = RANK_STATS[UnitRank.UNDERBOSS].cost;

export const UPKEEP_SOLDIER = RANK_STATS[UnitRank.SOLDIER].upkeep;
export const UPKEEP_CAPTAIN = RANK_STATS[UnitRank.CAPTAIN].upkeep;
export const UPKEEP_UNDERBOSS = RANK_STATS[UnitRank.UNDERBOSS].upkeep;

export const BOSS_MAX_HP = RANK_STATS[UnitRank.BOSS].hp;
export const MAX_BOSS_ARMOR = RANK_STATS[UnitRank.BOSS].maxArmor;

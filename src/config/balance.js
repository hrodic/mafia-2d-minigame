// Static balance data: the single tuning surface for gameplay numbers.
// Presentation-only values (effect lifetimes, UI sizes) and AI decision logic stay
// in their own modules. Characterisation tests lock the current values.

import { UnitRank } from './enums.js';
import { MAX_PISTOL_RANGE } from './constants.js';

export const INCOME_TIERS = {
  LOW: { label: 'Low', min: 250, max: 500 },
  MID: { label: 'Mid', min: 500, max: 1000 },
  HIGH: { label: 'High', min: 1000, max: 1500 },
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
    speedAi: 150,
    speedHuman: 225,
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

export const UNIT_CAPS = {
  minNeighborhoods: 25,
  underbossFraction: 0.05,
  captainFraction: 0.1,
  humanCapFraction: 0.5,
};

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
    label: 'OUT OF RANGE',
    color: '#71717a',
  },
  accuracyBands: [
    {
      maxDist: 50,
      inclusive: true,
      failChance: 0,
      dmgMult: 0.25,
      label: 'POINT-BLANK · -75% DMG',
      color: '#f97316',
    },
    { maxDist: 100, failChance: 0, dmgMult: 0.5, label: 'CLOSE · -50% DMG', color: '#fb923c' },
    {
      maxDist: MAX_PISTOL_RANGE * 0.25,
      failChance: 0,
      dmgMult: 1,
      label: '100% ACC · FULL DMG',
      color: '#34d399',
    },
    {
      maxDist: MAX_PISTOL_RANGE * 0.5,
      failChance: 0.05,
      dmgMult: 1,
      label: '95% ACC (5% MISS)',
      color: '#a3e635',
    },
    {
      maxDist: MAX_PISTOL_RANGE * 0.75,
      failChance: 0.1,
      dmgMult: 1,
      label: '90% ACC (10% MISS)',
      color: '#fbbf24',
    },
    {
      maxDist: MAX_PISTOL_RANGE * 0.9,
      failChance: 0.25,
      dmgMult: 1,
      label: '75% ACC (25% MISS)',
      color: '#fb923c',
    },
    {
      maxDist: Infinity,
      failChance: 0.5,
      dmgMult: 1,
      label: '50% ACC (50% MISS)',
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

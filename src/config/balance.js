// Static balance data: neighborhood income, unit costs/upkeep, boss survivability
// and attack pacing. Values are identical to the original inline constants.

export const INCOME_TIERS = {
  LOW: { label: 'Low', min: 250, max: 500 },
  MID: { label: 'Mid', min: 500, max: 1000 },
  HIGH: { label: 'High', min: 1000, max: 1500 },
};

export const COST_SOLDIER = 1200;
export const COST_CAPTAIN = 2200;
export const COST_UNDERBOSS = 3800;
export const COST_BOSS_ARMOR = 3500;

export const BOSS_MAX_HP = 400;
export const MAX_BOSS_ARMOR = 300;

export const UPKEEP_SOLDIER = 50;
export const UPKEEP_CAPTAIN = 100;
export const UPKEEP_UNDERBOSS = 150;

export const UNIT_ATTACK_COOLDOWN = 1.0;

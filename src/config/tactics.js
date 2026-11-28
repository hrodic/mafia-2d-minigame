// Faction tactical command constants shared by state, simulation, net and UI.
// Numeric codes are stable: they travel inside snapshots and commands.
// Pure constants and tiny factories only; no imports, no side effects.

export const GLOBAL_STANCE = Object.freeze({
  DEFEND: 1,
  EXPAND: 2,
});

export const LOCAL_ORDER = Object.freeze({
  GUARD: 1,
  ATTACK: 2,
});

export const GLOBAL_STANCE_LABELS = Object.freeze({
  [GLOBAL_STANCE.DEFEND]: 'Defend',
  [GLOBAL_STANCE.EXPAND]: 'Expand',
});

export const LOCAL_ORDER_LABELS = Object.freeze({
  [LOCAL_ORDER.GUARD]: 'Guard',
  [LOCAL_ORDER.ATTACK]: 'Attack',
});

export const TACTICS = Object.freeze({
  updateInterval: 0.25,
  auraEnterRadius: 325,
  auraExitRadius: 360,
  localFocusRadius: 360,
  focusSwitchTicks: 2,
  guardRecallRadius: 1000,
  guardMeleeMinDistance: 50,
  guardMeleeMaxDistance: 150,
  guardUnderbossMinDistance: 200,
  guardUnderbossMaxDistance: 300,
  guardIdleRadius: 14,
});

/** @param {number} value */
export function isGlobalStance(value) {
  return value === GLOBAL_STANCE.DEFEND || value === GLOBAL_STANCE.EXPAND;
}

/** @param {number} value */
export function isLocalOrder(value) {
  return value === LOCAL_ORDER.GUARD || value === LOCAL_ORDER.ATTACK;
}

/** Fresh per-faction tactical record. Expand + Attack preserve prior behavior. */
export function createFactionTactics() {
  return {
    globalStance: GLOBAL_STANCE.EXPAND,
    localOrder: LOCAL_ORDER.ATTACK,
    bossId: null,
    bossX: 0,
    bossY: 0,
    bossInDanger: false,
    threatenedChunks: [],
    localFocusId: null,
    localFocus: null,
    focusCandidateId: null,
    focusCandidateTicks: 0,
    revision: 0,
    updatedAt: 0,
  };
}

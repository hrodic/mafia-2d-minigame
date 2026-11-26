// Shared mutable game state for the current match.
//
// Phase 1 convention: every cross-module mutable value lives here as a property of
// this single `state` object. This is a mechanical consolidation of the globals that
// used to sit in main.js; it becomes a `createGameState()` factory in Phase 3.
//
// `state.world` is null until main.js assigns the CityMap instance (CityMap is still
// defined in main.js until Step 1.4 extracts it).

import { Faction, UnitRank } from '../config/enums.js';
import { BOSS_MAX_HP, MAX_BOSS_ARMOR } from '../config/balance.js';
import { DEFAULT_GRID_SIZE, DEFAULT_TICK_DURATION, TILE_SIZE } from '../config/constants.js';
import { ALL_FACTION_SLOTS } from '../config/organizations.js';

export const state = {
  // --- world / entities -----------------------------------------------------
  world: null,
  npcs: [],
  floatingTexts: [],
  spatialBuckets: new Map(),
  bucketPool: [],
  nextNpcId: 1,
  astarBudgetThisFrame: 0,

  // --- factions / economy ---------------------------------------------------
  treasuries: {
    [Faction.PLAYER]: 3000,
    [Faction.RIVAL_1]: 3000,
    [Faction.RIVAL_2]: 3000,
    [Faction.RIVAL_3]: 3000,
  },
  factionAlive: {
    [Faction.PLAYER]: true,
    [Faction.RIVAL_1]: true,
    [Faction.RIVAL_2]: true,
    [Faction.RIVAL_3]: true,
  },

  // --- local player boss ----------------------------------------------------
  player: {
    x: 1.5 * TILE_SIZE,
    y: 1.5 * TILE_SIZE,
    targetX: null,
    targetY: null,
    speed: 225,
    facing: 0,
    hp: BOSS_MAX_HP,
    maxHp: BOSS_MAX_HP,
    armor: 0,
    maxArmor: MAX_BOSS_ARMOR,
    armorCooldown: 0,
    sprintTimer: 0,
    sprintCooldown: 0,
    isSprinting: false,
    minDmg: 20,
    maxDmg: 40,
    alive: true,
    attackCooldown: 0,
    slashAnimTimer: 0,
    muzzleFlashTimer: 0,
    hitFlashTimer: 0,
  },
  camera: {
    x: 1.5 * TILE_SIZE,
    y: 1.5 * TILE_SIZE,
  },
  mouse: {
    screenX: null,
    screenY: null,
    inside: false,
  },
  keys: new Set(),

  // --- match configuration --------------------------------------------------
  activeFactions: [...ALL_FACTION_SLOTS],
  selectedFactionOrgs: ['COSA_NOSTRA', 'BRATVA', 'TRIADS', 'CARTEL'],
  activeFactionCount: 4,
  currentGridSize: DEFAULT_GRID_SIZE,
  tickDuration: DEFAULT_TICK_DURATION,
  currentIncomeTier: 'HIGH',
  currentWorldSeed: null,

  // --- recruitment ----------------------------------------------------------
  playerSpawnCaps: {
    [UnitRank.SOLDIER]: 96,
    [UnitRank.CAPTAIN]: 11,
    [UnitRank.UNDERBOSS]: 6,
  },
  // Per-faction recruitment preferences (used by remote human players in multiplayer)
  factionRecruitmentPrefs: {
    [Faction.PLAYER]: { autoSoldier: true, autoCaptain: true, autoUnderboss: true, caps: { [UnitRank.SOLDIER]: 96, [UnitRank.CAPTAIN]: 11, [UnitRank.UNDERBOSS]: 6 } },
    [Faction.RIVAL_1]: { autoSoldier: true, autoCaptain: true, autoUnderboss: true, caps: { [UnitRank.SOLDIER]: 192, [UnitRank.CAPTAIN]: 22, [UnitRank.UNDERBOSS]: 11 } },
    [Faction.RIVAL_2]: { autoSoldier: true, autoCaptain: true, autoUnderboss: true, caps: { [UnitRank.SOLDIER]: 192, [UnitRank.CAPTAIN]: 22, [UnitRank.UNDERBOSS]: 11 } },
    [Faction.RIVAL_3]: { autoSoldier: true, autoCaptain: true, autoUnderboss: true, caps: { [UnitRank.SOLDIER]: 192, [UnitRank.CAPTAIN]: 22, [UnitRank.UNDERBOSS]: 11 } },
  },
  autoRecruitSoldier: true,
  autoRecruitCaptain: true,
  autoRecruitUnderboss: true,

  // --- match / UI flags & timers -------------------------------------------
  gameStarted: false,
  isSpectating: false,
  showBorders: true,
  allowClickExpand: false,
  gameOver: false,
  victoryShown: false,
  tickTimer: 0,
  gameHour: 12,
  hudUpdateTimer: 0,
  minimapCacheTimer: 1.0,

  // --- multiplayer bridge (assigned by main.js after mpNet init) ------------
  net: null,
};

// ---------------------------------------------------------------------------
// Local faction / boss selectors (moved from main.js)
// ---------------------------------------------------------------------------

export function getLocalFaction() {
  return state.net && state.net.isActive() ? state.net.localFaction : Faction.PLAYER;
}

export function getLocalBoss() {
  const faction = getLocalFaction();
  if (faction === Faction.PLAYER) return state.player;
  const bossNpc = state.npcs.find((n) => n.faction === faction && n.rank === UnitRank.BOSS);
  return (
    bossNpc || {
      x: state.camera.x,
      y: state.camera.y,
      facing: 0,
      hp: 0,
      maxHp: BOSS_MAX_HP,
      armor: 0,
      maxArmor: MAX_BOSS_ARMOR,
      alive: false,
      armorCooldown: 0,
      sprintTimer: 0,
      sprintCooldown: 0,
      isSprinting: false,
    }
  );
}

export function isLocalBossAlive() {
  const faction = getLocalFaction();
  if (faction === Faction.PLAYER) return state.player.alive;
  return state.factionAlive[faction] && state.npcs.some((n) => n.faction === faction && n.rank === UnitRank.BOSS);
}

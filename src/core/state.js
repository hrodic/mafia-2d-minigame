// Shared mutable game state for the current match.
//
// Every cross-module mutable value lives here as a property of this single `state`
// object. `createGameState()` is the single source for a fresh match; `initWorld`
// copies it onto the exported singleton so importers keep the same object identity.
//
// `state.world` is null until main.js assigns the CityMap instance, and `state.net`
// is null until main.js assigns the multiplayer bridge.

import { Faction, UnitRank } from '../config/enums.js';
import { BOSS_MAX_HP, INCOME_TIERS, MAX_BOSS_ARMOR, RANK_STATS } from '../config/balance.js';
import { DEFAULT_GRID_SIZE, DEFAULT_TICK_DURATION, TILE_SIZE } from '../config/constants.js';
import {
  ALL_FACTION_SLOTS,
  clampFactionCount,
  ensureUniqueOrgs,
  getActiveFactionSlots,
} from '../config/organizations.js';

const DEFAULT_ORG_ROSTER = ['COSA_NOSTRA', 'BRATVA', 'TRIADS', 'CARTEL'];

/**
 * Build a complete fresh state object for a new match.
 *
 * `config` mirrors the `initWorld` arguments: `gridSize`, `tickDuration`,
 * `incomeTier`, `factionCount`, `orgRoster`, `seed`, `autoStart`, plus the
 * long-lived `world` and `net` references that a reset must preserve.
 */
export function createGameState(config = {}) {
  const currentGridSize = Math.max(5, Math.min(25, config.gridSize ?? DEFAULT_GRID_SIZE));
  const tickDuration = Math.max(10, Math.min(30, config.tickDuration ?? DEFAULT_TICK_DURATION));
  const currentIncomeTier = INCOME_TIERS[config.incomeTier] ? config.incomeTier : 'HIGH';
  const activeFactionCount = clampFactionCount(config.factionCount);
  const selectedFactionOrgs = ensureUniqueOrgs(config.orgRoster ?? DEFAULT_ORG_ROSTER);
  const activeFactions = getActiveFactionSlots(activeFactionCount);

  const treasuries = {};
  const factionAlive = {};
  const factionKills = {};
  for (const faction of ALL_FACTION_SLOTS) {
    const isActive = activeFactions.includes(faction);
    treasuries[faction] = isActive ? 3000 : 0;
    factionAlive[faction] = isActive;
    factionKills[faction] = 0;
  }

  const playerSpawnX = 1.5 * TILE_SIZE;
  const playerSpawnY = 1.5 * TILE_SIZE;
  const bossStats = RANK_STATS[UnitRank.BOSS];

  return {
    // --- world / entities ---------------------------------------------------
    world: config.world ?? null,
    npcs: [],
    floatingTexts: [],
    spatialBuckets: new Map(),
    bucketPool: [],
    nextNpcId: 1,
    astarBudgetThisFrame: 0,

    // --- factions / economy -------------------------------------------------
    treasuries,
    factionAlive,
    factionKills,

    // --- local player boss --------------------------------------------------
    player: {
      id: 0,
      faction: Faction.PLAYER,
      rank: UnitRank.BOSS,
      control: 'local',
      x: playerSpawnX,
      y: playerSpawnY,
      targetX: null,
      targetY: null,
      path: null,
      pathTimer: 0,
      bodyRadius: bossStats.radius,
      speed: bossStats.speedHuman,
      facing: 0,
      hp: bossStats.hp,
      maxHp: bossStats.hp,
      armor: bossStats.startArmor,
      maxArmor: bossStats.maxArmor,
      armorCooldown: 0,
      sprintTimer: 0,
      sprintCooldown: 0,
      isSprinting: false,
      minDmg: bossStats.minDmg,
      maxDmg: bossStats.maxDmg,
      alive: true,
      attackCooldown: 0,
      slashAnimTimer: 0,
      muzzleFlashTimer: 0,
      hitFlashTimer: 0,
    },
    camera: {
      x: playerSpawnX,
      y: playerSpawnY,
    },
    mouse: {
      screenX: null,
      screenY: null,
      inside: false,
    },
    keys: new Set(),
    sprintButtonHeld: false,

    // --- match configuration ------------------------------------------------
    activeFactions,
    selectedFactionOrgs,
    activeFactionCount,
    currentGridSize,
    tickDuration,
    currentIncomeTier,
    currentWorldSeed: config.seed ?? null,

    // --- recruitment --------------------------------------------------------
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

    // --- match / UI flags & timers -----------------------------------------
    gameStarted: Boolean(config.autoStart),
    isSpectating: false,
    gameOver: false,
    victoryShown: false,
    tickTimer: 0,
    gameHour: 12,
    hudUpdateTimer: 0,
    minimapCacheTimer: 1.0,

    // --- multiplayer bridge (assigned by main.js after mpNet init) ----------
    net: config.net ?? null,
  };
}

// The exported singleton keeps its identity for every importer across match resets.
export const state = createGameState();

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

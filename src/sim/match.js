// Match setup: builds a fresh city, factions, economy and rival bosses.

import { Faction, UnitRank } from '../config/enums.js';
import { TILE_SIZE } from '../config/constants.js';
import { BOSS_MAX_HP, INCOME_TIERS } from '../config/balance.js';
import {
  ALL_FACTION_SLOTS,
  ALL_ORG_IDS,
  FACTION_META,
  ORGANIZATIONS,
  ensureUniqueOrgs,
  clampFactionCount,
  getActiveFactionSlots,
} from '../config/organizations.js';
import { state, getLocalBoss } from '../core/state.js';
import { emit } from '../core/events.js';
import { resetDefaultPlayerSpawnCaps, spawnUnitInChunk } from './units.js';


export function initWorld(
  gridSize = state.currentGridSize,
  autoStart = true,
  selectedTickSeconds = state.tickDuration,
  selectedIncomeTier = state.currentIncomeTier,
  factionCount = state.activeFactionCount,
  orgRoster = state.selectedFactionOrgs,
  seedOverride = null
) {
  state.currentWorldSeed = seedOverride;
  state.currentGridSize = Math.max(5, Math.min(25, gridSize));
  state.tickDuration = Math.max(10, Math.min(30, selectedTickSeconds));
  state.currentIncomeTier = INCOME_TIERS[selectedIncomeTier] ? selectedIncomeTier : 'HIGH';
  state.activeFactionCount = clampFactionCount(factionCount);
  state.selectedFactionOrgs = ensureUniqueOrgs(orgRoster);
  state.activeFactions = getActiveFactionSlots(state.activeFactionCount);

  state.activeFactions.forEach((slot, idx) => {
    const orgId = state.selectedFactionOrgs[idx] || ALL_ORG_IDS[idx];
    FACTION_META[slot] = { ...ORGANIZATIONS[orgId] };
  });

  state.world.generation = {
    seed: state.currentWorldSeed,
    gridSize: state.currentGridSize,
    incomeTier: state.currentIncomeTier,
    activeFactions: state.activeFactions,
  };
  state.world.clear();
  state.npcs.length = 0;
  state.spatialBuckets.clear();
  state.gameStarted = autoStart;
  state.isSpectating = false;
  state.gameOver = false;
  state.victoryShown = false;
  state.tickTimer = 0;
  state.hudUpdateTimer = 0;
  state.minimapCacheTimer = 1.0;
  state.gameHour = 12;
  state.nextNpcId = 1;

  for (const f of ALL_FACTION_SLOTS) {
    const isActive = state.activeFactions.includes(f);
    state.treasuries[f] = isActive ? 3000 : 0;
    state.factionAlive[f] = isActive;
  }

  for (let cy = 0; cy < state.currentGridSize; cy++) {
    for (let cx = 0; cx < state.currentGridSize; cx++) {
      state.world.generateChunk(cx, cy);
    }
  }

  resetDefaultPlayerSpawnCaps();

  state.player.x = 1.5 * TILE_SIZE;
  state.player.y = 1.5 * TILE_SIZE;
  state.player.targetX = null;
  state.player.targetY = null;
  state.player.path = null;
  state.player.pathTimer = 0;
  state.player.hp = BOSS_MAX_HP;
  state.player.maxHp = BOSS_MAX_HP;
  state.player.armor = 0;
  state.player.armorCooldown = 0;
  state.player.sprintTimer = 0;
  state.player.sprintCooldown = 0;
  state.player.isSprinting = false;
  state.player.alive = true;
  state.player.attackCooldown = 0;
  state.player.slashAnimTimer = 0;
  state.player.muzzleFlashTimer = 0;
  state.player.hitFlashTimer = 0;

  const last = state.currentGridSize - 1;
  const cornerCoords = {
    [Faction.RIVAL_1]: { cx: last, cy: 0 },
    [Faction.RIVAL_2]: { cx: 0, cy: last },
    [Faction.RIVAL_3]: { cx: last, cy: last },
  };

  for (const slot of state.activeFactions) {
    if (slot === Faction.PLAYER) continue;
    const pos = cornerCoords[slot];
    const hq = state.world.getChunk(pos.cx, pos.cy);
    if (hq) {
      spawnUnitInChunk(slot, hq, UnitRank.BOSS);
    }
  }

  const localBoss = getLocalBoss();
  state.camera.x = localBoss.x;
  state.camera.y = localBoss.y;

  emit('match:initialized', {
    tickDuration: state.tickDuration,
    worldSeed: state.currentWorldSeed,
  });
}

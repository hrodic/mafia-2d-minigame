// Faction tactical command layer: global stance and local order state.
//
// This module is headless. It refreshes shared facts on a fixed 250 ms cadence:
// boss position/danger, threatened owned chunks, the local focus enemy and the
// per-unit boss-aura flag. AI behavior reads these facts from `state`; the
// command layer never drives presentation.

import { Faction, UnitRank } from '../config/enums.js';
import { AI_TACTICS } from '../config/balance.js';
import { CHUNK_PX } from '../config/constants.js';
import {
  LOCAL_ORDER,
  TACTICS,
  isGlobalStance,
  isLocalOrder,
} from '../config/tactics.js';
import { state, getUnitById } from '../core/state.js';
import { packChunkKey } from '../world/city.js';
import { scanNearby } from './ai.js';
import { hasLivingEnemyOnChunk } from './territory.js';

function bossForFaction(faction) {
  if (faction === Faction.PLAYER) {
    return state.player && state.player.alive ? state.player : null;
  }
  for (let i = 0; i < state.npcs.length; i++) {
    const unit = state.npcs[i];
    if (unit && unit.faction === faction && unit.rank === UnitRank.BOSS && unit.hp > 0) {
      return unit;
    }
  }
  return null;
}

function isLivingEnemy(unit, faction) {
  return Boolean(unit) && unit.faction !== faction && unit.hp > 0;
}

/**
 * Nearest enemy on the boss's chunk, else the nearest enemy within
 * `TACTICS.localFocusRadius` pixels.
 */
export function findLocalFocus(boss) {
  if (!boss) return null;
  const bossCx = Math.floor(boss.x / CHUNK_PX);
  const bossCy = Math.floor(boss.y / CHUNK_PX);

  // Phase 1: enemies standing on the boss's current chunk.
  let bestId = null;
  let bestDist = Infinity;
  const bucket = state.spatialBuckets.get(packChunkKey(bossCx, bossCy));
  if (bucket) {
    for (let i = 0; i < bucket.length; i++) {
      const other = bucket[i];
      if (!isLivingEnemy(other, boss.faction)) continue;
      const d = Math.hypot(other.x - boss.x, other.y - boss.y);
      if (d < bestDist) {
        bestDist = d;
        bestId = other.id;
      }
    }
  }

  const player = state.player;
  const playerIsEnemy = Boolean(player) && player.alive && player.faction !== boss.faction;
  if (playerIsEnemy) {
    const inBossChunk =
      Math.floor(player.x / CHUNK_PX) === bossCx && Math.floor(player.y / CHUNK_PX) === bossCy;
    if (inBossChunk) {
      const d = Math.hypot(player.x - boss.x, player.y - boss.y);
      if (d < bestDist) {
        bestDist = d;
        bestId = player.id;
      }
    }
  }
  if (bestId !== null) return bestId;

  // Phase 2: nearest enemy within the local focus radius.
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nearby = state.spatialBuckets.get(packChunkKey(bossCx + dx, bossCy + dy));
      if (!nearby) continue;
      for (let i = 0; i < nearby.length; i++) {
        const other = nearby[i];
        if (!isLivingEnemy(other, boss.faction)) continue;
        const d = Math.hypot(other.x - boss.x, other.y - boss.y);
        if (d <= TACTICS.localFocusRadius && d < bestDist) {
          bestDist = d;
          bestId = other.id;
        }
      }
    }
  }

  if (playerIsEnemy) {
    const d = Math.hypot(player.x - boss.x, player.y - boss.y);
    if (d <= TACTICS.localFocusRadius && d < bestDist) {
      bestId = player.id;
    }
  }

  return bestId;
}

function refreshThreatenedChunks(record, faction) {
  record.threatenedChunks.length = 0;
  if (!state.world || !state.world.chunks) return;
  for (const chunk of state.world.chunks.values()) {
    if (chunk.faction !== faction) continue;
    if (hasLivingEnemyOnChunk(chunk, faction)) record.threatenedChunks.push(chunk);
  }
}

/**
 * Keep the current local focus until a different candidate has survived
 * `focusSwitchTicks` refreshes (~0.5 s at 4 Hz). Acquisition and loss are
 * immediate so guards react to the first threat and drop a dead target.
 */
function refreshLocalFocus(record, candidateId) {
  const current = record.localFocus;
  if (
    record.localFocusId !== null &&
    (!current || current.hp <= 0 || current.alive === false)
  ) {
    record.localFocusId = null;
    record.localFocus = null;
    record.focusCandidateId = null;
    record.focusCandidateTicks = 0;
  }

  if (candidateId === record.localFocusId) {
    record.focusCandidateId = null;
    record.focusCandidateTicks = 0;
    return;
  }

  if (record.localFocusId === null || candidateId === null) {
    record.localFocusId = candidateId;
    record.localFocus = candidateId !== null ? getUnitById(candidateId) : null;
    record.focusCandidateId = null;
    record.focusCandidateTicks = 0;
    return;
  }

  if (record.focusCandidateId === candidateId) {
    record.focusCandidateTicks += 1;
  } else {
    record.focusCandidateId = candidateId;
    record.focusCandidateTicks = 1;
  }
  if (record.focusCandidateTicks >= TACTICS.focusSwitchTicks) {
    record.localFocusId = candidateId;
    record.localFocus = getUnitById(candidateId);
    record.focusCandidateId = null;
    record.focusCandidateTicks = 0;
  }
}

function refreshFaction(faction) {
  const record = state.factionTactics[faction];
  if (!record) return null;
  const boss = bossForFaction(faction);

  if (boss) {
    record.bossId = boss.id;
    record.bossX = boss.x;
    record.bossY = boss.y;
    const hpFraction = boss.maxHp > 0 ? boss.hp / boss.maxHp : 0;
    const scan = scanNearby(boss);
    record.bossInDanger =
      hpFraction <= AI_TACTICS.bossRetreatHpFraction ||
      (scan.nearbyEnemyCount >= AI_TACTICS.bossRetreatMinEnemies &&
        scan.nearbyEnemyCount > scan.nearbyAllyCount);
    const candidateId = findLocalFocus(boss);
    refreshLocalFocus(record, candidateId);
  } else {
    record.bossId = null;
    record.bossInDanger = false;
    record.localFocusId = null;
    record.localFocus = null;
    record.focusCandidateId = null;
    record.focusCandidateTicks = 0;
  }

  refreshThreatenedChunks(record, faction);
  record.updatedAt += TACTICS.updateInterval;
  record.revision = (record.revision || 0) + 1;
  return boss;
}

function refreshAuraFlags(bosses) {
  for (let i = 0; i < state.npcs.length; i++) {
    const unit = state.npcs[i];
    if (!unit || unit.rank === UnitRank.BOSS) {
      if (unit) {
        unit.inBossAura = false;
        unit.guardAssigned = false;
      }
      continue;
    }
    const boss = bosses.get(unit.faction);
    if (!boss) {
      unit.inBossAura = false;
      unit.guardAssigned = false;
      continue;
    }
    const distance = Math.hypot(unit.x - boss.x, unit.y - boss.y);
    const wasInside = Boolean(unit.inBossAura);
    unit.inBossAura = wasInside
      ? distance <= TACTICS.auraExitRadius
      : distance <= TACTICS.auraEnterRadius;

    const record = state.factionTactics[unit.faction];
    const guardOrder = Boolean(record) && record.localOrder === LOCAL_ORDER.GUARD;
    const collapsing = Boolean(record) &&
      record.localOrder === LOCAL_ORDER.ATTACK &&
      record.bossInDanger;

    if (unit.inBossAura) {
      unit.guardAssigned = guardOrder || collapsing;
    } else if (unit.guardAssigned) {
      const stillGuarding = guardOrder || collapsing;
      if (!stillGuarding || distance > TACTICS.guardRecallRadius) {
        unit.guardAssigned = false;
      }
    }
  }
}

/**
 * Advance the tactical command layer. Called once per fixed simulation step;
 * the internal accumulator limits the actual refresh to `TACTICS.updateInterval`.
 */
export function updateFactionTactics(dt) {
  if (!state.gameStarted) return;
  state.tacticsTimer = (state.tacticsTimer || 0) + dt;
  if (state.tacticsTimer + 1e-9 < TACTICS.updateInterval) return;
  state.tacticsTimer -= TACTICS.updateInterval;
  if (state.tacticsTimer < 0) state.tacticsTimer = 0;

  const bosses = new Map();
  for (const faction of state.activeFactions) {
    const boss = refreshFaction(faction);
    bosses.set(faction, boss);
  }
  refreshAuraFlags(bosses);
}

/** Set the global stance for a faction. Returns false for unknown codes. */
export function setGlobalStance(faction, stance) {
  if (!isGlobalStance(stance)) return false;
  const record = state.factionTactics[faction];
  if (!record) return false;
  record.globalStance = stance;
  return true;
}

/** Set the local order for a faction. Returns false for unknown codes. */
export function setLocalOrder(faction, order) {
  if (!isLocalOrder(order)) return false;
  const record = state.factionTactics[faction];
  if (!record) return false;
  record.localOrder = order;
  return true;
}

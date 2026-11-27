// Territory capture, faction elimination and victory/defeat transitions.
// Emits facts; presentation lives in subscribers (see EVENTS.md).

import { Faction, UnitRank } from '../config/enums.js';
import { RANK_STATS } from '../config/balance.js';
import { CHUNK_PX } from '../config/constants.js';
import { packChunkKey } from '../world/city.js';
import { state, getLocalFaction } from '../core/state.js';
import { emit } from '../core/events.js';

export const CAPTURE_PER_TICK = {
  [UnitRank.BOSS]: RANK_STATS[UnitRank.BOSS].capturePerTick,
  [UnitRank.UNDERBOSS]: RANK_STATS[UnitRank.UNDERBOSS].capturePerTick,
  [UnitRank.CAPTAIN]: RANK_STATS[UnitRank.CAPTAIN].capturePerTick,
  [UnitRank.SOLDIER]: RANK_STATS[UnitRank.SOLDIER].capturePerTick,
};

export function getCapturePerTick(rank) {
  return CAPTURE_PER_TICK[rank] ?? CAPTURE_PER_TICK[UnitRank.SOLDIER];
}

/** Any living unit of another faction standing on the chunk? */
export function hasLivingEnemyOnChunk(chunk, faction) {
  const buckets = state.spatialBuckets;
  if (buckets && typeof buckets.get === 'function') {
    // Production path: the per-step spatial hash is authoritative, including empty chunks.
    const bucket = buckets.get(packChunkKey(chunk.cx, chunk.cy));
    if (bucket) {
      for (const unit of bucket) {
        if (unit.hp > 0 && unit.faction !== faction) return true;
      }
    }
  } else {
    for (const unit of state.npcs) {
      if (!unit || unit.hp <= 0 || unit.faction === faction) continue;
      if (
        Math.floor(unit.x / CHUNK_PX) === chunk.cx &&
        Math.floor(unit.y / CHUNK_PX) === chunk.cy
      ) {
        return true;
      }
    }
  }

  const player = state.player;
  if (player && player.alive && player.faction !== faction) {
    if (
      Math.floor(player.x / CHUNK_PX) === chunk.cx &&
      Math.floor(player.y / CHUNK_PX) === chunk.cy
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Advance capture progress for a faction; returns true when the chunk flips.
 * `pointsPerTick` is scaled by the current tick duration, so a unit worth 1
 * captures a neighborhood in one tick regardless of how long a tick lasts.
 * Capturing enemy turf requires the turf to be clear of enemy units; neutral
 * turf (including defeated factions' former turf) never resists.
 */
export function progressCapture(chunk, faction, dt, pointsPerTick) {
  if (!chunk || chunk.faction === faction) return false;
  if (!state.factionAlive[faction]) return false;

  if (chunk.faction !== Faction.NEUTRAL && hasLivingEnemyOnChunk(chunk, faction)) {
    chunk.captureProgress = 0;
    chunk.capturingFaction = null;
    return false;
  }

  if (chunk.capturingFaction !== faction) {
    chunk.capturingFaction = faction;
    chunk.captureProgress = 0;
  }
  const tickSeconds = Math.max(1, Number(state.tickDuration) || 1);
  chunk.captureProgress += (pointsPerTick * dt) / tickSeconds;
  if (chunk.captureProgress >= 1) {
    chunk.faction = faction;
    chunk.captureProgress = 0;
    chunk.capturingFaction = null;
    emit('chunk:captured', { chunk, faction });
    return true;
  }
  return false;
}

export function checkVictoryCondition() {
  const myFac = getLocalFaction();
  if (state.victoryShown || state.gameOver || !state.factionAlive[myFac]) return;
  const anyRivalAlive = state.activeFactions.some((f) => f !== myFac && state.factionAlive[f]);

  if (!anyRivalAlive) {
    state.victoryShown = true;
    const myBlocks = Array.from(state.world.chunks.values()).filter((c) => c.faction === myFac).length;
    const survivingCrew = state.npcs.filter((n) => n.faction === myFac).length;
    emit('match:victory', {
      faction: myFac,
      blocks: myBlocks,
      totalBlocks: state.world.chunks.size,
      cash: state.treasuries[myFac],
      crew: survivingCrew,
    });
  }
}

export function eliminateFaction(faction) {
  if (!state.factionAlive[faction]) return;
  state.factionAlive[faction] = false;
  state.treasuries[faction] = 0;

  for (const chunk of state.world.chunks.values()) {
    if (chunk.faction === faction) {
      chunk.faction = Faction.NEUTRAL;
      chunk.captureProgress = 0;
      chunk.capturingFaction = null;
    }
    if (chunk.capturingFaction === faction) {
      chunk.captureProgress = 0;
      chunk.capturingFaction = null;
    }
  }

  if (faction === Faction.PLAYER) {
    state.player.alive = false;
  }

  if (faction === getLocalFaction()) {
    state.gameOver = true;
    emit('match:defeat', { faction });
  } else {
    emit('faction:eliminated', { faction });
    checkVictoryCondition();
  }
}

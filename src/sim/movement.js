// Unit movement helpers: collision radii, occupancy rules, friendly pushing and
// NPC sprint state. Shared by the local player, AI and remote-controlled bosses.

import { Faction, UnitRank } from '../config/enums.js';
import { CHUNK_PX, SPRINT_MAX_DURATION, SPRINT_COOLDOWN_DURATION, SPRINT_SPEED_MULTIPLIER } from '../config/constants.js';
import { state } from '../core/state.js';
import { packChunkKey } from '../world/city.js';


export function getEntityCollisionRadius(rank) {
  if (rank === UnitRank.BOSS) return 13.5;
  if (rank === UnitRank.UNDERBOSS) return 12.8;
  if (rank === UnitRank.CAPTAIN) return 12.0;
  return 11.0;
}

export function canOccupyPosition(wx, wy, radius, ignoreNpcId = -1, ignorePlayer = false, moverFaction = null) {
  if (!state.world.canMoveTo(wx, wy, radius)) return false;

  if (!ignorePlayer && state.player.alive) {
    const pRad = getEntityCollisionRadius(UnitRank.BOSS);
    const sameFaction = moverFaction !== null && moverFaction === Faction.PLAYER;
    const minDist = sameFaction ? (radius + pRad) * 0.45 : radius + pRad - 1.0;
    const dx = wx - state.player.x;
    const dy = wy - state.player.y;
    if (dx * dx + dy * dy < minDist * minDist) return false;
  }

  const cx = Math.floor(wx / CHUNK_PX);
  const cy = Math.floor(wy / CHUNK_PX);

  if (state.spatialBuckets.size > 0) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = state.spatialBuckets.get(packChunkKey(cx + dx, cy + dy));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const other = bucket[i];
          if (other.id === ignoreNpcId) continue;
          const oRad = getEntityCollisionRadius(other.rank);
          const sameFaction = moverFaction !== null && moverFaction === other.faction;
          const minDist = sameFaction ? (radius + oRad) * 0.45 : radius + oRad - 1.0;
          const ox = wx - other.x;
          const oy = wy - other.y;
          if (ox * ox + oy * oy < minDist * minDist) return false;
        }
      }
    }
  }
  return true;
}

export function isPushingFriendly(wx, wy, radius, faction, ignoreNpcId = -1, ignorePlayer = false) {
  if (!ignorePlayer && state.player.alive && faction === Faction.PLAYER) {
    const minDist = radius + getEntityCollisionRadius(UnitRank.BOSS);
    const dx = wx - state.player.x;
    const dy = wy - state.player.y;
    if (dx * dx + dy * dy < minDist * minDist) return true;
  }
  const cx = Math.floor(wx / CHUNK_PX);
  const cy = Math.floor(wy / CHUNK_PX);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const bucket = state.spatialBuckets.get(packChunkKey(cx + dx, cy + dy));
      if (!bucket) continue;
      for (let i = 0; i < bucket.length; i++) {
        const other = bucket[i];
        if (other.id === ignoreNpcId || other.faction !== faction) continue;
        const minDist = radius + getEntityCollisionRadius(other.rank);
        const ox = wx - other.x;
        const oy = wy - other.y;
        if (ox * ox + oy * oy < minDist * minDist) return true;
      }
    }
  }
  return false;
}

export function updateNpcBossSprint(bossNpc, wantsSprint, dt) {
  if (bossNpc.sprintCooldown > 0) {
    bossNpc.sprintCooldown = Math.max(0, bossNpc.sprintCooldown - dt);
    bossNpc.isSprinting = false;
  } else if (wantsSprint) {
    bossNpc.isSprinting = true;
    bossNpc.sprintTimer += dt;
    if (bossNpc.sprintTimer >= SPRINT_MAX_DURATION) {
      bossNpc.isSprinting = false;
      bossNpc.sprintTimer = 0;
      bossNpc.sprintCooldown = SPRINT_COOLDOWN_DURATION;
    }
  } else {
    if (bossNpc.isSprinting && bossNpc.sprintTimer > 0) {
      bossNpc.sprintCooldown = SPRINT_COOLDOWN_DURATION * (bossNpc.sprintTimer / SPRINT_MAX_DURATION);
    }
    bossNpc.isSprinting = false;
    bossNpc.sprintTimer = 0;
  }
  return bossNpc.isSprinting ? SPRINT_SPEED_MULTIPLIER : 1.0;
}

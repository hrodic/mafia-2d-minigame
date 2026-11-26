// Unit movement helpers: collision radii, occupancy rules, friendly pushing and
// NPC sprint state. Shared by the local player, AI and remote-controlled bosses.

import { Faction, UnitRank } from '../config/enums.js';
import { CHUNK_PX, SPRINT_MAX_DURATION, SPRINT_COOLDOWN_DURATION, SPRINT_SPEED_MULTIPLIER } from '../config/constants.js';
import { state } from '../core/state.js';
import { packChunkKey } from '../world/city.js';
import { progressCapture, getCaptureRate, onChunkCaptured } from './territory.js';
import { computeTilePath } from '../world/pathfinding.js';


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

export function computeSteeringPath(entity, targetX, targetY, dt, maxNodes = 400) {
  entity.pathTimer = Math.max(0, (entity.pathTimer || 0) - dt);
  if (!entity.path || entity.path.length === 0) {
    if (entity.pathTimer > 0) return { x: targetX, y: targetY };
    entity.path = computeTilePath(state.world, entity.x, entity.y, targetX, targetY, maxNodes);
    entity.pathTimer = 0.8;
  }
  if (!entity.path || entity.path.length === 0) return { x: targetX, y: targetY };
  let next = entity.path[0];
  if (Math.hypot(next.x - entity.x, next.y - entity.y) < 18) {
    entity.path.shift();
    next = entity.path[0] || { x: targetX, y: targetY };
  }
  return next;
}

export function updateHumanControlledRivalBoss(bossNpc, dt) {
  const peerInput = state.net ? state.net.getPeerInput(bossNpc.humanPeerId) : null;
  let moveX = peerInput ? peerInput.mx : 0;
  let moveY = peerInput ? peerInput.my : 0;
  const wantsSprint = peerInput ? peerInput.sprint : false;

  if (moveX !== 0 || moveY !== 0) {
    bossNpc.targetX = null;
    bossNpc.targetY = null;
    bossNpc.path = null;
    bossNpc.pathTimer = 0;
    const len = Math.hypot(moveX, moveY);
    moveX /= len;
    moveY /= len;
  } else if (bossNpc.targetX !== null && bossNpc.targetY !== null) {
    const steer = computeSteeringPath(bossNpc, bossNpc.targetX, bossNpc.targetY, dt);
    const dx = steer.x - bossNpc.x;
    const dy = steer.y - bossNpc.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 6 && (!bossNpc.path || bossNpc.path.length === 0)) {
      bossNpc.targetX = null;
      bossNpc.targetY = null;
      bossNpc.path = null;
    } else if (dist > 0.01) {
      moveX = dx / dist;
      moveY = dy / dist;
      bossNpc.facing = Math.atan2(moveY, moveX);
    }
  }

  if (peerInput && typeof peerInput.facing === 'number') {
    bossNpc.facing = peerInput.facing;
  }

  const bRadius = getEntityCollisionRadius(UnitRank.BOSS);
  const pushingCrew = isPushingFriendly(bossNpc.x, bossNpc.y, bRadius, bossNpc.faction, bossNpc.id, false);
  const sprintMult = updateNpcBossSprint(bossNpc, wantsSprint && (moveX !== 0 || moveY !== 0), dt);
  const currentSpeed = (pushingCrew ? bossNpc.speed * 0.45 : bossNpc.speed) * sprintMult;

  if (moveX !== 0) {
    const nextX = bossNpc.x + moveX * currentSpeed * dt;
    if (canOccupyPosition(nextX, bossNpc.y, bRadius, bossNpc.id, false, bossNpc.faction)) {
      bossNpc.x = nextX;
    }
  }
  if (moveY !== 0) {
    const nextY = bossNpc.y + moveY * currentSpeed * dt;
    if (canOccupyPosition(bossNpc.x, nextY, bRadius, bossNpc.id, false, bossNpc.faction)) {
      bossNpc.y = nextY;
    }
  }

  const bTile = state.world.worldToTile(bossNpc.x, bossNpc.y);
  const currentChunk = state.world.getChunk(bTile.cx, bTile.cy);
  if (progressCapture(currentChunk, bossNpc.faction, dt, getCaptureRate(UnitRank.BOSS))) {
    onChunkCaptured(currentChunk, bossNpc.faction);
  }
}

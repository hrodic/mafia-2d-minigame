// Unit movement helpers: collision radii, occupancy rules, friendly pushing and
// NPC sprint state. Shared by the local player, AI and remote-controlled bosses.

import { Faction, UnitRank } from '../config/enums.js';
import { CHUNK_PX, SPRINT_MAX_DURATION, SPRINT_COOLDOWN_DURATION, SPRINT_SPEED_MULTIPLIER, WALK_PHASE_PER_PX } from '../config/constants.js';
import { RANK_STATS } from '../config/balance.js';
import { state } from '../core/state.js';
import { perf } from '../core/perf.js';
import { packChunkKey } from '../world/city.js';
import { progressCapture, getCapturePerTick } from './territory.js';
import { computeTilePath } from '../world/pathfinding.js';


export function getEntityCollisionRadius(rank) {
  return (RANK_STATS[rank] || RANK_STATS[UnitRank.SOLDIER]).radius;
}

export function canOccupyPosition(wx, wy, radius, ignoreNpcId = -1, ignorePlayer = false, moverFaction = null) {
  if (perf.enabled) perf.inc('collisionChecks');
  if (!state.world.canMoveTo(wx, wy, radius)) {
    if (perf.enabled) perf.inc('collisionRejectedWorld');
    return false;
  }

  if (!ignorePlayer && state.player.alive) {
    const sameFaction = moverFaction !== null && moverFaction === Faction.PLAYER;
    if (!sameFaction) {
      const pRad = state.player.bodyRadius ?? getEntityCollisionRadius(UnitRank.BOSS);
      const minDist = radius + pRad - 1.0;
      const dx = wx - state.player.x;
      const dy = wy - state.player.y;
      if (dx * dx + dy * dy < minDist * minDist) {
        if (perf.enabled) perf.inc('collisionRejectedUnit');
        return false;
      }
    }
  }

  const cx = Math.floor(wx / CHUNK_PX);
  const cy = Math.floor(wy / CHUNK_PX);
  let candidates = 0;

  if (state.spatialBuckets.size > 0) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = state.spatialBuckets.get(packChunkKey(cx + dx, cy + dy));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const other = bucket[i];
          if (other.id === ignoreNpcId) continue;
          const sameFaction = moverFaction !== null && moverFaction === other.faction;
          // Same-faction units may push through each other (boss included);
          // other factions always block.
          if (sameFaction) continue;
          if (perf.enabled) candidates++;
          const oRad = other.bodyRadius ?? getEntityCollisionRadius(other.rank);
          const minDist = radius + oRad - 1.0;
          const ox = wx - other.x;
          const oy = wy - other.y;
          if (ox * ox + oy * oy < minDist * minDist) {
            if (perf.enabled) {
              perf.add('collisionUnitCandidates', candidates);
              perf.inc('collisionRejectedUnit');
            }
            return false;
          }
        }
      }
    }
  }
  if (perf.enabled && candidates > 0) perf.add('collisionUnitCandidates', candidates);
  return true;
}

export function isPushingFriendly(wx, wy, radius, faction, ignoreNpcId = -1, ignorePlayer = false) {
  if (perf.enabled) perf.inc('pushChecks');
  if (!ignorePlayer && state.player.alive && faction === Faction.PLAYER) {
    const minDist = radius + (state.player.bodyRadius ?? getEntityCollisionRadius(UnitRank.BOSS));
    const dx = wx - state.player.x;
    const dy = wy - state.player.y;
    if (dx * dx + dy * dy < minDist * minDist) return true;
  }
  if (state.spatialBuckets.size === 0) return false;
  const cx = Math.floor(wx / CHUNK_PX);
  const cy = Math.floor(wy / CHUNK_PX);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const bucket = state.spatialBuckets.get(packChunkKey(cx + dx, cy + dy));
      if (!bucket) continue;
      for (let i = 0; i < bucket.length; i++) {
        const other = bucket[i];
        if (other.id === ignoreNpcId || other.faction !== faction) continue;
        const minDist = radius + (other.bodyRadius ?? getEntityCollisionRadius(other.rank));
        const ox = wx - other.x;
        const oy = wy - other.y;
        if (ox * ox + oy * oy < minDist * minDist) return true;
      }
    }
  }
  return false;
}

export function updateUnitSprint(unit, wantsSprint, dt) {
  if (unit.sprintCooldown > 0) {
    unit.sprintCooldown = Math.max(0, unit.sprintCooldown - dt);
    unit.isSprinting = false;
  } else if (wantsSprint) {
    unit.isSprinting = true;
    unit.sprintTimer += dt;
    if (unit.sprintTimer >= SPRINT_MAX_DURATION) {
      unit.isSprinting = false;
      unit.sprintTimer = 0;
      unit.sprintCooldown = SPRINT_COOLDOWN_DURATION;
    }
  } else {
    if (unit.isSprinting && unit.sprintTimer > 0) {
      unit.sprintCooldown = SPRINT_COOLDOWN_DURATION * (unit.sprintTimer / SPRINT_MAX_DURATION);
    }
    unit.isSprinting = false;
    unit.sprintTimer = 0;
  }
  return unit.isSprinting ? SPRINT_SPEED_MULTIPLIER : 1.0;
}

/**
 * Move any unit for one step. Input carries the direction and control-specific flags;
 * collision, friendly pushing and sprint are shared by the player, AI and guest bosses.
 */
export function moveUnit(unit, input = {}, dt = 0) {
  if (perf.enabled) perf.inc('moveUnitCalls');
  const startX = unit.x;
  const startY = unit.y;
  const rawX = input.mx || 0;
  const rawY = input.my || 0;
  const len = Math.hypot(rawX, rawY);
  const hasInput = len > 0;
  const dirX = hasInput ? rawX / len : 0;
  const dirY = hasInput ? rawY / len : 0;

  const wantsSprint = Boolean(input.sprint) && hasInput && unit.rank === UnitRank.BOSS;
  const sprintMult = updateUnitSprint(unit, wantsSprint, dt);

  const isPlayer = unit === state.player;
  const radius =
    unit.bodyRadius ??
    getEntityCollisionRadius(unit.rank ?? (isPlayer ? UnitRank.BOSS : UnitRank.SOLDIER));
  const faction = unit.faction ?? (isPlayer ? Faction.PLAYER : null);
  const ignorePlayer = input.ignorePlayer ?? isPlayer;
  const ignoreNpcId = input.ignoreNpcId ?? (isPlayer ? -1 : unit.id);

  const pushingCrew = hasInput
    ? isPushingFriendly(unit.x, unit.y, radius, faction, ignoreNpcId, ignorePlayer)
    : false;
  if (!hasInput && perf.enabled) perf.inc('moveUnitIdle');
  const speed = (pushingCrew ? unit.speed * 0.45 : unit.speed) * sprintMult;

  let moved = false;
  if (dirX !== 0) {
    const nextX = unit.x + dirX * speed * dt;
    if (canOccupyPosition(nextX, unit.y, radius, ignoreNpcId, ignorePlayer, faction)) {
      unit.x = nextX;
      moved = true;
    }
  }
  if (dirY !== 0) {
    const nextY = unit.y + dirY * speed * dt;
    if (canOccupyPosition(unit.x, nextY, radius, ignoreNpcId, ignorePlayer, faction)) {
      unit.y = nextY;
      moved = true;
    }
  }

  if (!moved && hasInput && input.dodge) {
    const angle = Math.atan2(dirY, dirX);
    const perpAngle = angle + (Math.PI / 2) * (input.dodgeDir ?? unit.dodgeDir ?? 1);
    const px = unit.x + Math.cos(perpAngle) * speed * dt;
    const py = unit.y + Math.sin(perpAngle) * speed * dt;
    if (canOccupyPosition(px, py, radius, ignoreNpcId, ignorePlayer, faction)) {
      unit.x = px;
      unit.y = py;
      moved = true;
    }
  }

  const stepSq = (unit.x - startX) ** 2 + (unit.y - startY) ** 2;
  if (stepSq > 0.0001) {
    unit.isMoving = true;
    unit.walkPhase = ((unit.walkPhase || 0) + Math.sqrt(stepSq) * WALK_PHASE_PER_PX) % (Math.PI * 2);
  } else {
    unit.isMoving = false;
  }

  return { moved, dirX, dirY, speed, sprintMult };
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

  moveUnit(
    bossNpc,
    {
      mx: moveX,
      my: moveY,
      sprint: wantsSprint,
      ignorePlayer: false,
      ignoreNpcId: bossNpc.id,
    },
    dt
  );

  const bTile = state.world.worldToTile(bossNpc.x, bossNpc.y);
  const currentChunk = state.world.getChunk(bTile.cx, bTile.cy);
  progressCapture(currentChunk, bossNpc.faction, dt, getCapturePerTick(bossNpc.rank));
}

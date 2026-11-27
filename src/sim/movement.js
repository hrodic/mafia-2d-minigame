// Unit movement helpers: collision radii, occupancy rules, friendly pushing and
// NPC sprint state. Shared by the local player, AI and remote-controlled bosses.

import { Faction, UnitRank } from '../config/enums.js';
import { CHUNK_PX, SPRINT_MAX_DURATION, SPRINT_COOLDOWN_DURATION, SPRINT_SPEED_MULTIPLIER, WALK_PHASE_PER_PX } from '../config/constants.js';
import { RANK_STATS, getPushMass, PUSH_SPEED_FACTOR } from '../config/balance.js';
import { state } from '../core/state.js';
import { perf } from '../core/perf.js';
import { COLLISION_CELL_PX, packCollisionCell } from '../core/spatial.js';
import { packChunkKey } from '../world/city.js';
import { progressCapture, getCapturePerTick } from './territory.js';
import { computeTilePath } from '../world/pathfinding.js';


export function getEntityCollisionRadius(rank) {
  return (RANK_STATS[rank] || RANK_STATS[UnitRank.SOLDIER]).radius;
}

const UNIT_SEPARATION_SKIN = 1.0;
const MAX_PUSH_CORRECTION = 2.0;
const MAX_PUSH_DEPTH = 3;
const pushVisited = new Set();
const pushMoves = [];

function isHumanBossEntity(unit) {
  return unit === state.player || Boolean(unit && unit.humanPeerId);
}

/** Full spacing around human bosses; half spacing between friendly NPCs. */
function friendlySeparation(radiusA, radiusB, entityA, entityB) {
  const aHuman = entityA === state.player || Boolean(entityA && entityA.humanPeerId);
  const bHuman = entityB === state.player || Boolean(entityB && entityB.humanPeerId);
  if (aHuman || bHuman) {
    return radiusA + radiusB - UNIT_SEPARATION_SKIN;
  }
  return (radiusA + radiusB) * 0.5;
}

const moveNearbyScratch = [];
const moveAlliesScratch = [];

/**
 * Fill `out` with units from the 3x3 chunk neighbourhood around a point.
 * `moveUnit` builds this once per step and reuses it for push + axis checks.
 */
export function gatherNearbyUnits(wx, wy, out = moveNearbyScratch, unit = null) {
  out.length = 0;
  const collisionBuckets = state.collisionBuckets;
  if (collisionBuckets && collisionBuckets.size > 0) {
    const cx = Math.floor(wx / COLLISION_CELL_PX);
    const cy = Math.floor(wy / COLLISION_CELL_PX);
    let useGrid = unit === state.player || !unit;
    if (unit && unit !== state.player) {
      const ownBucket = collisionBuckets.get(packCollisionCell(cx, cy));
      useGrid = Boolean(ownBucket && ownBucket.includes(unit));
    }
    if (useGrid) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const bucket = collisionBuckets.get(packCollisionCell(cx + dx, cy + dy));
          if (!bucket) continue;
          for (let i = 0; i < bucket.length; i++) out.push(bucket[i]);
        }
      }
      return out;
    }
  }

  if (state.spatialBuckets.size === 0) return out;
  const cx = Math.floor(wx / CHUNK_PX);
  const cy = Math.floor(wy / CHUNK_PX);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const bucket = state.spatialBuckets.get(packChunkKey(cx + dx, cy + dy));
      if (!bucket) continue;
      for (let i = 0; i < bucket.length; i++) out.push(bucket[i]);
    }
  }
  return out;
}

function gatherFactionAllies(nearby, faction, ignoreNpcId, out) {
  out.length = 0;
  if (!nearby) return out;
  for (let i = 0; i < nearby.length; i++) {
    const other = nearby[i];
    if (other.id === ignoreNpcId || other.faction !== faction) continue;
    out.push(other);
  }
  return out;
}

export function canOccupyPosition(
  wx,
  wy,
  radius,
  ignoreNpcId = -1,
  ignorePlayer = false,
  moverFaction = null,
  nearbyUnits = null,
  ignoreEntity = null,
  moverEntity = null
) {
  if (perf.enabled) perf.inc('collisionChecks');
  if (!state.world.canMoveTo(wx, wy, radius)) {
    if (perf.enabled) perf.inc('collisionRejectedWorld');
    return false;
  }

  if (!ignorePlayer && state.player.alive) {
    const pRad = state.player.bodyRadius ?? getEntityCollisionRadius(UnitRank.BOSS);
    const minDist = radius + pRad - UNIT_SEPARATION_SKIN;
    const dx = wx - state.player.x;
    const dy = wy - state.player.y;
    if (dx * dx + dy * dy < minDist * minDist) {
      if (perf.enabled) perf.inc('collisionRejectedUnit');
      return false;
    }
  }

  const cx = Math.floor(wx / CHUNK_PX);
  const cy = Math.floor(wy / CHUNK_PX);
  let candidates = 0;

  if (nearbyUnits) {
    for (let i = 0; i < nearbyUnits.length; i++) {
      const other = nearbyUnits[i];
      if (other.id === ignoreNpcId || other === ignoreEntity) continue;
      if (perf.enabled) candidates++;
      const oRad = other.bodyRadius ?? getEntityCollisionRadius(other.rank);
      const sameFaction = moverFaction !== null && moverFaction === other.faction;
      const minDist = sameFaction
        ? friendlySeparation(radius, oRad, moverEntity, other)
        : radius + oRad - UNIT_SEPARATION_SKIN;
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
  } else if (state.spatialBuckets.size > 0) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = state.spatialBuckets.get(packChunkKey(cx + dx, cy + dy));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const other = bucket[i];
          if (other.id === ignoreNpcId || other === ignoreEntity) continue;
          if (perf.enabled) candidates++;
          const oRad = other.bodyRadius ?? getEntityCollisionRadius(other.rank);
          const sameFaction = moverFaction !== null && moverFaction === other.faction;
          const minDist = sameFaction
            ? friendlySeparation(radius, oRad, moverEntity, other)
            : radius + oRad - UNIT_SEPARATION_SKIN;
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

export function isPushingFriendly(
  wx,
  wy,
  radius,
  faction,
  ignoreNpcId = -1,
  ignorePlayer = false,
  nearbyUnits = null
) {
  if (perf.enabled) perf.inc('pushChecks');
  if (!ignorePlayer && state.player.alive && faction === Faction.PLAYER) {
    const minDist = radius + (state.player.bodyRadius ?? getEntityCollisionRadius(UnitRank.BOSS));
    const dx = wx - state.player.x;
    const dy = wy - state.player.y;
    if (dx * dx + dy * dy < minDist * minDist) return true;
  }

  if (nearbyUnits) {
    for (let i = 0; i < nearbyUnits.length; i++) {
      const other = nearbyUnits[i];
      if (other.id === ignoreNpcId || other.faction !== faction) continue;
      const minDist = radius + (other.bodyRadius ?? getEntityCollisionRadius(other.rank));
      const ox = wx - other.x;
      const oy = wy - other.y;
      if (ox * ox + oy * oy < minDist * minDist) return true;
    }
    return false;
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

function findOverlappingAlly(
  mover,
  wx,
  wy,
  radius,
  faction,
  nearby,
  ignoreNpcId,
  dirX,
  dirY,
  visited = null,
  allowHuman = false
) {
  if (!nearby || nearby.length === 0) return null;
  let best = null;
  let bestDistSq = Infinity;
  for (let i = 0; i < nearby.length; i++) {
    const other = nearby[i];
    if (other === mover || other.id === ignoreNpcId) continue;
    if (other.faction !== faction) continue;
    if (!allowHuman && other.humanPeerId) continue;
    if (visited && visited.has(other.id)) continue;
    const oRad = other.bodyRadius ?? getEntityCollisionRadius(other.rank);
    const minDist = friendlySeparation(radius, oRad, mover, other);
    const dx = wx - other.x;
    const dy = wy - other.y;
    const distSq = dx * dx + dy * dy;
    if (distSq >= minDist * minDist) continue;
    // Only push units in the direction the mover is travelling.
    if ((other.x - mover.x) * dirX + (other.y - mover.y) * dirY <= 0) continue;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = other;
    }
  }
  return best;
}

function rollbackPushMoves() {
  for (let i = pushMoves.length - 1; i >= 0; i--) {
    const move = pushMoves[i];
    move.unit.x = move.x;
    move.unit.y = move.y;
    move.unit.isMoving = move.isMoving;
    move.unit.walkPhase = move.walkPhase;
  }
  pushMoves.length = 0;
}

/**
 * Stage 2 push: move one friendly unit out of the destination, recursively
 * making room through up to MAX_PUSH_DEPTH allies. If any link is blocked,
 * every move in the chain is rolled back.
 */
function tryPushAlly(mover, ally, dirX, dirY, step, radius, nearby, allies, depth) {
  if (depth >= MAX_PUSH_DEPTH || pushVisited.has(ally.id)) return false;
  pushVisited.add(ally.id);

  const allyRadius = ally.bodyRadius ?? getEntityCollisionRadius(ally.rank);
  const destX = mover.x + dirX * step;
  const destY = mover.y + dirY * step;
  const dx = ally.x - destX;
  const dy = ally.y - destY;
  const minDist = friendlySeparation(radius, allyRadius, mover, ally);
  const distSq = dx * dx + dy * dy;
  if (distSq >= minDist * minDist) return true;

  const dist = Math.sqrt(distSq);
  const overlap = Math.max(0, minDist - dist);
  const correction = Math.min(overlap, MAX_PUSH_CORRECTION);
  const pushRatio = getPushMass(mover.rank) / getPushMass(ally.rank);
  const pushDist = (step + correction) * pushRatio;
  const tx = ally.x + dirX * pushDist;
  const ty = ally.y + dirY * pushDist;

  // Make room for this unit first, then re-check its target.
  const next = findOverlappingAlly(
    ally,
    tx,
    ty,
    allyRadius,
    ally.faction,
    allies,
    ally.id,
    dirX,
    dirY,
    pushVisited
  );
  if (next && !tryPushAlly(ally, next, dirX, dirY, pushDist, allyRadius, nearby, allies, depth + 1)) {
    return false;
  }

  // Ignore the immediate pusher: the pair is separating and may still touch.
  if (!canOccupyPosition(tx, ty, allyRadius, ally.id, false, ally.faction, nearby, mover, ally)) {
    rollbackPushMoves();
    return false;
  }

  pushMoves.push({
    unit: ally,
    x: ally.x,
    y: ally.y,
    isMoving: ally.isMoving,
    walkPhase: ally.walkPhase,
  });
  ally.x = tx;
  ally.y = ty;
  ally.isMoving = true;
  ally.walkPhase =
    ((ally.walkPhase || 0) + pushDist * WALK_PHASE_PER_PX) % (Math.PI * 2);
  return true;
}

function tryAxisMove(
  unit,
  dirX,
  dirY,
  step,
  radius,
  ignoreNpcId,
  ignorePlayer,
  faction,
  nearby,
  allies,
  canPush
) {
  const nx = unit.x + dirX * step;
  const ny = unit.y + dirY * step;

  if (canPush) {
    const ally = findOverlappingAlly(
      unit,
      nx,
      ny,
      radius,
      faction,
      allies,
      ignoreNpcId,
      dirX,
      dirY
    );
    if (ally) {
      pushVisited.clear();
      pushMoves.length = 0;
      if (!tryPushAlly(unit, ally, dirX, dirY, step, radius, nearby, allies, 0)) {
        return false;
      }
    }
  }

  if (!canOccupyPosition(nx, ny, radius, ignoreNpcId, ignorePlayer, faction, nearby, null, unit)) {
    return false;
  }
  unit.x = nx;
  unit.y = ny;
  return true;
}

function trySideStep(unit, dirX, dirY, step, radius, ignoreNpcId, ignorePlayer, faction, nearby) {
  const preferred = unit.dodgeDir || (unit.id % 2 ? 1 : -1);
  for (const side of [preferred, -preferred]) {
    const perpX = -dirY * side;
    const perpY = dirX * side;
    const candidates = [
      [(dirX + perpX) * Math.SQRT1_2, (dirY + perpY) * Math.SQRT1_2],
      [perpX, perpY],
    ];
    for (const [cx, cy] of candidates) {
      const nx = unit.x + cx * step;
      const ny = unit.y + cy * step;
      if (canOccupyPosition(nx, ny, radius, ignoreNpcId, ignorePlayer, faction, nearby, null, unit)) {
        unit.x = nx;
        unit.y = ny;
        return true;
      }
    }
  }
  return false;
}

const DEPENETRATION_INTERVAL = 0.5;
const MAX_DEPENETRATION_STEP = 1.0;

/**
 * Low-frequency, O(n²) stale-overlap cleanup. Runs at 2 Hz and only moves
 * units that are actually overlapping; squared distances avoid sqrt until
 * an overlap is found. Human bosses are never moved.
 */
export function separateStaleOverlaps(dt) {
  state.depenetrationTimer = (state.depenetrationTimer || 0) + dt;
  if (state.depenetrationTimer < DEPENETRATION_INTERVAL) return;
  state.depenetrationTimer -= DEPENETRATION_INTERVAL;
  if (state.depenetrationTimer < 0) state.depenetrationTimer = 0;

  const units = state.player.alive ? [state.player, ...state.npcs] : state.npcs;
  let overlapPairs = 0;
  let moves = 0;

  for (let i = 0; i < units.length; i++) {
    const a = units[i];
    if (!a || a.hp <= 0 || a.alive === false) continue;
    const ar = a.bodyRadius ?? getEntityCollisionRadius(a.rank);
    const aHuman = isHumanBossEntity(a);
    for (let j = i + 1; j < units.length; j++) {
      const b = units[j];
      if (!b || b.hp <= 0 || b.alive === false || b.faction !== a.faction) continue;
      const bHuman = isHumanBossEntity(b);
      if (aHuman && bHuman) continue;

      const br = b.bodyRadius ?? getEntityCollisionRadius(b.rank);
      const minDist = friendlySeparation(ar, br, a, b);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distSq = dx * dx + dy * dy;
      if (distSq >= minDist * minDist) continue;
      overlapPairs++;

      let nx;
      let ny;
      let dist;
      if (distSq < 0.000001) {
        const angle = ((a.id * 37 + b.id * 17) % 360) * (Math.PI / 180);
        nx = Math.cos(angle);
        ny = Math.sin(angle);
        dist = 0;
      } else {
        dist = Math.sqrt(distSq);
        nx = dx / dist;
        ny = dy / dist;
      }
      const overlap = minDist - dist;
      const stepA = aHuman
        ? 0
        : bHuman
          ? Math.min(overlap, MAX_DEPENETRATION_STEP)
          : Math.min(overlap * 0.5, MAX_DEPENETRATION_STEP);
      const stepB = bHuman
        ? 0
        : aHuman
          ? Math.min(overlap, MAX_DEPENETRATION_STEP)
          : Math.min(overlap * 0.5, MAX_DEPENETRATION_STEP);

      if (stepA > 0) {
        const tx = a.x - nx * stepA;
        const ty = a.y - ny * stepA;
        const ignorePlayer = b === state.player;
        if (canOccupyPosition(tx, ty, ar, a.id, ignorePlayer, a.faction, null, b, a)) {
          a.x = tx;
          a.y = ty;
          a.isMoving = true;
          a.walkPhase =
            ((a.walkPhase || 0) + stepA * WALK_PHASE_PER_PX) % (Math.PI * 2);
          moves++;
        }
      }
      if (stepB > 0) {
        const tx = b.x + nx * stepB;
        const ty = b.y + ny * stepB;
        const ignorePlayer = a === state.player;
        if (canOccupyPosition(tx, ty, br, b.id, ignorePlayer, b.faction, null, a, b)) {
          b.x = tx;
          b.y = ty;
          b.isMoving = true;
          b.walkPhase =
            ((b.walkPhase || 0) + stepB * WALK_PHASE_PER_PX) % (Math.PI * 2);
          moves++;
        }
      }
    }
  }

  if (perf.enabled) {
    perf.inc('depenetrationPasses');
    perf.add('depenetrationPairs', overlapPairs);
    perf.add('depenetrationMoves', moves);
  }
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

  const nearby = hasInput
    ? gatherNearbyUnits(unit.x, unit.y, moveNearbyScratch, unit)
    : null;
  const allies = hasInput
    ? gatherFactionAllies(nearby, faction, ignoreNpcId, moveAlliesScratch)
    : null;
  const pushingCrew = hasInput
    ? isPushingFriendly(unit.x, unit.y, radius, faction, ignoreNpcId, ignorePlayer, allies)
    : false;
  if (!hasInput && perf.enabled) perf.inc('moveUnitIdle');
  const speed = (pushingCrew ? unit.speed * PUSH_SPEED_FACTOR : unit.speed) * sprintMult;

  let moved = false;
  let sideStepped = false;
  const moveStep = speed * dt;

  if (hasInput && pushingCrew && !isPlayer && !unit.humanPeerId) {
    const aheadX = unit.x + dirX * moveStep;
    const aheadY = unit.y + dirY * moveStep;
    const blocker = findOverlappingAlly(
      unit,
      aheadX,
      aheadY,
      radius,
      faction,
      allies,
      ignoreNpcId,
      dirX,
      dirY,
      null,
      true
    );
    if (blocker) {
      sideStepped = trySideStep(
        unit,
        dirX,
        dirY,
        moveStep,
        radius,
        ignoreNpcId,
        ignorePlayer,
        faction,
        nearby
      );
      moved = sideStepped;
    }
  }

  if (!sideStepped && dirX !== 0) {
    moved =
      tryAxisMove(
        unit,
        dirX,
        0,
        moveStep,
        radius,
        ignoreNpcId,
        ignorePlayer,
        faction,
        nearby,
        allies,
        pushingCrew
      ) || moved;
  }
  if (!sideStepped && dirY !== 0) {
    moved =
      tryAxisMove(
        unit,
        0,
        dirY,
        moveStep,
        radius,
        ignoreNpcId,
        ignorePlayer,
        faction,
        nearby,
        allies,
        pushingCrew
      ) || moved;
  }

  if (!moved && hasInput && input.dodge) {
    const angle = Math.atan2(dirY, dirX);
    const perpAngle = angle + (Math.PI / 2) * (input.dodgeDir ?? unit.dodgeDir ?? 1);
    const px = unit.x + Math.cos(perpAngle) * moveStep;
    const py = unit.y + Math.sin(perpAngle) * moveStep;
    if (canOccupyPosition(px, py, radius, ignoreNpcId, ignorePlayer, faction, nearby, null, unit)) {
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

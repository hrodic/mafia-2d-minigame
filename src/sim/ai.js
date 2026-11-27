// NPC AI: perception, armor, attacks, patrol goals, A* steering and capture.
// Headless gameplay logic; presentation goes through events.

import { Faction, UnitRank } from '../config/enums.js';
import { CHUNK_SIZE, CHUNK_PX, TILE_SIZE } from '../config/constants.js';
import { SLASH } from '../config/balance.js';
import { FACTION_META } from '../config/organizations.js';
import { state } from '../core/state.js';
import { emit } from '../core/events.js';
import { packChunkKey } from '../world/city.js';
import { computeTilePath, MAX_ASTAR_PER_FRAME } from '../world/pathfinding.js';
import { moveUnit } from './movement.js';
import { progressCapture, getCaptureRate } from './territory.js';
import {
  performBossKnifeSlash,
  performBossPistolShot,
  performSlash,
  tryBuyNpcBossArmor,
} from './combat.js';

/** Scan the 3x3 chunk neighbourhood for the nearest enemy and nearby counts. */
export function scanNearby(u) {
  const uCx = Math.floor(u.x / CHUNK_PX);
  const uCy = Math.floor(u.y / CHUNK_PX);
  let nearestEnemy = null;
  let nearestEnemyDist = Infinity;
  let nearbyEnemyCount = 0;
  let nearbyAllyCount = 0;

  if (state.player.alive && state.player.faction !== u.faction && u.faction !== Faction.PLAYER) {
    const d = Math.hypot(state.player.x - u.x, state.player.y - u.y);
    if (d < 420) nearbyEnemyCount++;
    if (d < nearestEnemyDist) {
      nearestEnemyDist = d;
      nearestEnemy = { isPlayer: true, entity: state.player, x: state.player.x, y: state.player.y };
    }
  }

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const bucket = state.spatialBuckets.get(packChunkKey(uCx + dx, uCy + dy));
      if (!bucket) continue;
      for (let b = 0; b < bucket.length; b++) {
        const other = bucket[b];
        if (other.id === u.id) continue;
        const d = Math.hypot(other.x - u.x, other.y - u.y);
        if (other.faction === u.faction) {
          if (d < 360) nearbyAllyCount++;
        } else {
          if (d < 420) nearbyEnemyCount++;
          if (d < nearestEnemyDist) {
            nearestEnemyDist = d;
            nearestEnemy = { isPlayer: false, entity: other, x: other.x, y: other.y };
          }
        }
      }
    }
  }

  return { uCx, uCy, nearestEnemy, nearestEnemyDist, nearbyEnemyCount, nearbyAllyCount };
}

/** Pick the nearest non-owned chunk in a 7x7 neighborhood, with a global fallback. */
export function choosePatrolChunk(u, uCx, uCy) {
  let targetChunk = null;
  let bestChunkDist = Infinity;
  for (let cy = uCy - 3; cy <= uCy + 3; cy++) {
    for (let cx = uCx - 3; cx <= uCx + 3; cx++) {
      const c = state.world.getChunk(cx, cy);
      if (!c || c.faction === u.faction) continue;
      const d = Math.hypot((cx + 0.5) * CHUNK_PX - u.x, (cy + 0.5) * CHUNK_PX - u.y);
      if (d < bestChunkDist) {
        bestChunkDist = d;
        targetChunk = c;
      }
    }
  }
  if (!targetChunk) {
    for (const c of state.world.chunks.values()) {
      if (c.faction !== u.faction) {
        targetChunk = c;
        break;
      }
    }
  }
  return targetChunk;
}

/** One AI step for a non-remote, non-player unit. */
export function updateNpcAi(u, dt) {
  u.aiTimer -= dt;
  u.pathTimer -= dt;

  const { uCx, uCy, nearestEnemy, nearestEnemyDist, nearbyEnemyCount, nearbyAllyCount } =
    scanNearby(u);

  if (u.rank === UnitRank.BOSS) {
    tryBuyNpcBossArmor(u, nearbyEnemyCount, nearbyAllyCount);
  }

  const isRangedShooter = u.rank === UnitRank.BOSS || u.rank === UnitRank.UNDERBOSS;
  const aggroRange = isRangedShooter ? 680 : 480;
  const melee = SLASH.aiMeleeByRank[u.rank] || SLASH.aiMelee;

  if (nearestEnemy && nearestEnemyDist <= aggroRange) {
    u.goalX = nearestEnemy.x;
    u.goalY = nearestEnemy.y;

    if (nearestEnemyDist <= melee.reach) {
      u.facing = Math.atan2(nearestEnemy.y - u.y, nearestEnemy.x - u.x);
      if (u.rank === UnitRank.BOSS) {
        performBossKnifeSlash(u);
      } else if (u.attackCooldown <= 0) {
        performSlash(u, {
          profile: melee,
          targets: [nearestEnemy.entity],
          playerDamageColor: FACTION_META[u.faction].accent,
        });
      }
    } else if (
      isRangedShooter &&
      nearestEnemyDist >= 110 &&
      nearestEnemyDist <= 640 &&
      u.attackCooldown <= 0
    ) {
      performBossPistolShot(u, false, nearestEnemy.x, nearestEnemy.y);
    }
  } else if (u.aiTimer <= 0) {
    u.aiTimer = 1.6 + Math.random() * 1.8;
    const targetChunk = choosePatrolChunk(u, uCx, uCy);
    if (targetChunk) {
      const gx =
        targetChunk.cx * CHUNK_PX +
        (1 + Math.floor(Math.random() * (CHUNK_SIZE - 2)) + 0.5) * TILE_SIZE;
      const gy =
        targetChunk.cy * CHUNK_PX +
        (1 + Math.floor(Math.random() * (CHUNK_SIZE - 2)) + 0.5) * TILE_SIZE;
      const snapped = state.world.findNearestWalkablePoint(gx, gy, u.bodyRadius);
      if (snapped) {
        u.goalX = snapped.x;
        u.goalY = snapped.y;
      }
    }
  }

  // Steering / A* movement
  const distToGoal = Math.hypot(u.goalX - u.x, u.goalY - u.y);
  let moveX = 0;
  let moveY = 0;
  if (distToGoal > 28) {
    if (
      (!u.path || u.path.length === 0 || u.pathTimer <= 0) &&
      state.astarBudgetThisFrame < MAX_ASTAR_PER_FRAME
    ) {
      state.astarBudgetThisFrame++;
      u.pathTimer = 0.85 + Math.random() * 0.45;
      u.path = computeTilePath(state.world, u.x, u.y, u.goalX, u.goalY, 160);
    }

    let steerX = u.goalX;
    let steerY = u.goalY;
    if (u.path && u.path.length > 0) {
      steerX = u.path[0].x;
      steerY = u.path[0].y;
      if (Math.hypot(steerX - u.x, steerY - u.y) < 18) {
        u.path.shift();
        if (u.path.length > 0) {
          steerX = u.path[0].x;
          steerY = u.path[0].y;
        }
      }
    }

    const angle = Math.atan2(steerY - u.y, steerX - u.x);
    u.facing = angle;
    moveX = Math.cos(angle);
    moveY = Math.sin(angle);
  }

  moveUnit(
    u,
    {
      mx: moveX,
      my: moveY,
      sprint: false,
      ignorePlayer: false,
      ignoreNpcId: u.id,
      dodge: true,
      dodgeDir: u.dodgeDir,
    },
    dt
  );

  // Territory capture by NPCs
  const uTile = state.world.worldToTile(u.x, u.y);
  const uChunk = state.world.getChunk(uTile.cx, uTile.cy);
  progressCapture(uChunk, u.faction, dt, getCaptureRate(u.rank));
}

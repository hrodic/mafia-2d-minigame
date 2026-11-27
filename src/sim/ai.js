// NPC AI: perception, armor, attacks, patrol goals, A* steering and capture.
// Headless gameplay logic; presentation goes through events.

import { Faction, UnitRank } from '../config/enums.js';
import { CHUNK_SIZE, CHUNK_PX, TILE_SIZE } from '../config/constants.js';
import { SLASH, AI_TACTICS } from '../config/balance.js';
import { FACTION_META } from '../config/organizations.js';
import { state } from '../core/state.js';
import { emit } from '../core/events.js';
import { packChunkKey } from '../world/city.js';
import { computeTilePath, MAX_ASTAR_PER_FRAME } from '../world/pathfinding.js';
import { moveUnit } from './movement.js';
import { progressCapture, getCapturePerTick } from './territory.js';
import {
  hasClearShot,
  hasFriendlyInShotPath,
  getWeaponStats,
  performBossKnifeSlash,
  performBossPistolShot,
  performSlash,
  tryBuyNpcBossArmor,
  tryBuyNpcBossEquipment,
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

/** Pick a point away from the threat, preferring own turf when possible. */
function chooseRetreatPoint(u, enemy) {
  if (!state.world.findNearestWalkablePoint) return null;
  const away = Math.atan2(u.y - enemy.y, u.x - enemy.x);
  const distance = AI_TACTICS.bossRetreatDistance;
  let best = null;
  let bestScore = -Infinity;
  for (const offset of [0, 0.55, -0.55, 1.1, -1.1]) {
    const angle = away + offset;
    const gx = u.x + Math.cos(angle) * distance;
    const gy = u.y + Math.sin(angle) * distance;
    const snapped = state.world.findNearestWalkablePoint(gx, gy, u.bodyRadius);
    if (!snapped) continue;
    const travel = Math.hypot(snapped.x - u.x, snapped.y - u.y);
    if (travel < distance * 0.35) continue;
    let score = travel - Math.abs(offset) * 40;
    if (state.world.worldToTile && state.world.getChunk) {
      const tile = state.world.worldToTile(snapped.x, snapped.y);
      const chunk = state.world.getChunk(tile.cx, tile.cy);
      if (chunk && chunk.faction === u.faction) score += 80;
    }
    if (score > bestScore) {
      bestScore = score;
      best = { x: snapped.x, y: snapped.y };
    }
  }
  return best;
}

/** Pick a lateral point that leaves the current firing line. */
function chooseFlankPoint(u, enemy) {
  if (!state.world.findNearestWalkablePoint) return null;
  const forward = Math.atan2(enemy.y - u.y, enemy.x - u.x);
  const preferred = u.flankSide || (u.id % 2 === 0 ? 1 : -1);
  const radius = AI_TACTICS.flankDistance;
  for (const side of [preferred, -preferred]) {
    const angle = forward + side * (Math.PI / 2);
    const gx = u.x + Math.cos(angle) * radius;
    const gy = u.y + Math.sin(angle) * radius;
    const snapped = state.world.findNearestWalkablePoint(gx, gy, u.bodyRadius);
    if (!snapped) continue;
    if (Math.hypot(snapped.x - u.x, snapped.y - u.y) < radius * 0.45) continue;
    return { x: snapped.x, y: snapped.y, side };
  }
  // Both sides blocked: back off to break the line and re-open a route.
  const angle = forward + Math.PI;
  const gx = u.x + Math.cos(angle) * radius * 0.8;
  const gy = u.y + Math.sin(angle) * radius * 0.8;
  const snapped = state.world.findNearestWalkablePoint(gx, gy, u.bodyRadius);
  if (snapped && Math.hypot(snapped.x - u.x, snapped.y - u.y) > radius * 0.4) {
    return { x: snapped.x, y: snapped.y, side: 0 };
  }
  return null;
}

/** Pick a point away from a too-close enemy so a ranged unit can keep firing. */
function chooseBackoffPoint(u, enemy, distance) {
  if (!state.world.findNearestWalkablePoint) return null;
  const away = Math.atan2(u.y - enemy.y, u.x - enemy.x);
  for (const offset of [0, 0.5, -0.5, 1.0, -1.0]) {
    const angle = away + offset;
    const gx = u.x + Math.cos(angle) * distance;
    const gy = u.y + Math.sin(angle) * distance;
    const snapped = state.world.findNearestWalkablePoint(gx, gy, u.bodyRadius);
    if (!snapped) continue;
    if (Math.hypot(snapped.x - u.x, snapped.y - u.y) < distance * 0.4) continue;
    return snapped;
  }
  return null;
}

/** One AI step for a non-remote, non-player unit. */
export function updateNpcAi(u, dt) {
  u.aiTimer -= dt;
  u.pathTimer -= dt;
  u.retreatTimer = Math.max(0, (u.retreatTimer || 0) - dt);
  u.flankTimer = Math.max(0, (u.flankTimer || 0) - dt);
  u.backoffTimer = Math.max(0, (u.backoffTimer || 0) - dt);
  u.shopTimer = Math.max(0, (u.shopTimer || 0) - dt);

  if (u.rank === UnitRank.BOSS && !u.humanPeerId && u.shopTimer <= 0) {
    u.shopTimer = 1;
    tryBuyNpcBossEquipment(u);
  }

  const { uCx, uCy, nearestEnemy, nearestEnemyDist, nearbyEnemyCount, nearbyAllyCount } =
    scanNearby(u);

  if (u.rank === UnitRank.BOSS) {
    tryBuyNpcBossArmor(u, nearbyEnemyCount, nearbyAllyCount);
  }

  // Only bosses and underbosses carry a gun; captains and soldiers are knife-only.
  const isRangedShooter = u.rank === UnitRank.BOSS || u.rank === UnitRank.UNDERBOSS;
  const rangedWeapon = isRangedShooter ? getWeaponStats(u) : null;
  const aggroRange = isRangedShooter ? 680 : 480;
  const melee = SLASH.aiMeleeByRank[u.rank] || SLASH.aiMelee;

  let bossInDanger = false;
  if (u.rank === UnitRank.BOSS && nearestEnemy) {
    const hpFraction = u.maxHp > 0 ? u.hp / u.maxHp : 1;
    const critical = hpFraction <= AI_TACTICS.bossRetreatHpFraction;
    const outnumbered =
      nearbyEnemyCount >= AI_TACTICS.bossRetreatMinEnemies &&
      nearbyEnemyCount > nearbyAllyCount;
    bossInDanger = critical || outnumbered;
  }

  let retreating = u.rank === UnitRank.BOSS && u.retreatTimer > 0;
  if (!retreating && bossInDanger) {
    const point = chooseRetreatPoint(u, nearestEnemy);
    if (point) {
      u.retreatX = point.x;
      u.retreatY = point.y;
      u.retreatTimer = AI_TACTICS.bossRetreatDuration;
      u.flankTimer = 0;
      u.path = null;
      u.pathTimer = 0;
      retreating = true;
    }
  }

  if (retreating) {
    u.goalX = u.retreatX;
    u.goalY = u.retreatY;
    u.backoffTimer = 0;
  } else if (nearestEnemy && nearestEnemyDist <= aggroRange) {
    const canFireNow =
      isRangedShooter &&
      Boolean(rangedWeapon) &&
      (u.ammo ?? 0) > 0 &&
      !(u.reloadTimer > 0);
    const bossWantsMelee =
      u.rank === UnitRank.BOSS &&
      !bossInDanger &&
      nearestEnemyDist <= AI_TACTICS.bossMeleeCommitDistance;
    const tooClose =
      canFireNow &&
      !bossWantsMelee &&
      nearestEnemyDist > melee.reach &&
      nearestEnemyDist < AI_TACTICS.rangedBackoffDistance;
    if (!tooClose) u.backoffTimer = 0;
    if (bossWantsMelee) u.flankTimer = 0;
    if (tooClose && u.backoffTimer <= 0) {
      const point = chooseBackoffPoint(u, nearestEnemy, AI_TACTICS.rangedBackoffStep);
      if (point) {
        u.backoffX = point.x;
        u.backoffY = point.y;
        u.backoffTimer = AI_TACTICS.rangedBackoffDuration;
      }
    }
    const backingOff = tooClose && u.backoffTimer > 0;
    const flanking = u.flankTimer > 0;

    if (backingOff) {
      u.goalX = u.backoffX;
      u.goalY = u.backoffY;
    } else {
      u.goalX = flanking ? u.flankX : nearestEnemy.x;
      u.goalY = flanking ? u.flankY : nearestEnemy.y;
    }
    if (bossWantsMelee) {
      u.backoffTimer = 0;
      u.goalX = nearestEnemy.x;
      u.goalY = nearestEnemy.y;
    }

    if (nearestEnemyDist <= melee.reach) {
      // Knives have no friendly-fire restriction: always take the free hit.
      u.flankTimer = 0;
      u.backoffTimer = 0;
      u.goalX = nearestEnemy.x;
      u.goalY = nearestEnemy.y;
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
      rangedWeapon &&
      nearestEnemyDist <= rangedWeapon.range &&
      u.attackCooldown <= 0 &&
      (u.ammo ?? 1) > 0 &&
      !(u.reloadTimer > 0)
    ) {
      const clear = hasClearShot(u, nearestEnemy.x, nearestEnemy.y);
      const friendBlocked = clear && hasFriendlyInShotPath(u, nearestEnemy.x, nearestEnemy.y);
      if (clear && !friendBlocked) {
        performBossPistolShot(u, false, nearestEnemy.x, nearestEnemy.y);
      } else if (friendBlocked && !flanking && !backingOff) {
        const point = chooseFlankPoint(u, nearestEnemy);
        if (point) {
          u.flankX = point.x;
          u.flankY = point.y;
          u.flankTimer = AI_TACTICS.flankDuration;
          u.flankSide = point.side === 0 ? 1 : -point.side;
          u.goalX = point.x;
          u.goalY = point.y;
          u.path = null;
          u.pathTimer = 0;
        }
      }
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
      sprint: retreating,
      ignorePlayer: false,
      ignoreNpcId: u.id,
      dodge: true,
      dodgeDir: u.dodgeDir,
    },
    dt
  );

  // Territory capture by NPCs
  if (!retreating) {
    const uTile = state.world.worldToTile(u.x, u.y);
    const uChunk = state.world.getChunk(uTile.cx, uTile.cy);
    progressCapture(uChunk, u.faction, dt, getCapturePerTick(u.rank));
  }
}

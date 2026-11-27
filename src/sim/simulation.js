// Simulation step: host/single-player world update and guest presentation loop.

import { Faction, UnitRank } from '../config/enums.js';
import { state } from '../core/state.js';
import { rebuildSpatialBuckets } from '../core/spatial.js';
import {
  moveUnit,
  updateHumanControlledRivalBoss,
  computeSteeringPath,
} from './movement.js';
import { progressCapture, getCapturePerTick } from './territory.js';
import { processHourlyTick } from './economy.js';
import { updateNpcAi } from './ai.js';
import { tickWeapon } from './combat.js';

/** One fixed host/single-player simulation step. No presentation work here. */
export function update(dt) {
  if (!state.gameStarted) return;

  state.astarBudgetThisFrame = 0;
  rebuildSpatialBuckets();

  if (state.player.attackCooldown > 0) state.player.attackCooldown = Math.max(0, state.player.attackCooldown - dt);
  tickWeapon(state.player, dt);
  if (state.player.slashAnimTimer > 0) state.player.slashAnimTimer = Math.max(0, state.player.slashAnimTimer - dt);
  if (state.player.muzzleFlashTimer > 0) state.player.muzzleFlashTimer = Math.max(0, state.player.muzzleFlashTimer - dt);
  if (state.player.hitFlashTimer > 0) state.player.hitFlashTimer = Math.max(0, state.player.hitFlashTimer - dt);
  if (state.player.armorCooldown > 0) state.player.armorCooldown = Math.max(0, state.player.armorCooldown - dt);

  if (state.player.alive) {
    let moveX = 0;
    let moveY = 0;
    if (state.keys.has('w') || state.keys.has('arrowup')) moveY -= 1;
    if (state.keys.has('s') || state.keys.has('arrowdown')) moveY += 1;
    if (state.keys.has('a') || state.keys.has('arrowleft')) moveX -= 1;
    if (state.keys.has('d') || state.keys.has('arrowright')) moveX += 1;

    if (moveX !== 0 || moveY !== 0) {
      state.player.targetX = null;
      state.player.targetY = null;
      state.player.path = null;
      state.player.pathTimer = 0;
    } else if (state.player.targetX !== null && state.player.targetY !== null) {
      const steer = computeSteeringPath(state.player, state.player.targetX, state.player.targetY, dt);
      const dx = steer.x - state.player.x;
      const dy = steer.y - state.player.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 6 && (!state.player.path || state.player.path.length === 0)) {
        state.player.targetX = null;
        state.player.targetY = null;
        state.player.path = null;
      } else if (dist > 0.01) {
        moveX = dx / dist;
        moveY = dy / dist;
        state.player.facing = Math.atan2(moveY, moveX);
      }
    }

    if (moveX !== 0 || moveY !== 0) {
      state.player.facing = Math.atan2(moveY, moveX);
    }

    const wantsSprint = state.keys.has('shift') || state.sprintButtonHeld;
    moveUnit(
      state.player,
      {
        mx: moveX,
        my: moveY,
        sprint: wantsSprint,
        ignorePlayer: true,
        ignoreNpcId: -1,
      },
      dt
    );

    const pTile = state.world.worldToTile(state.player.x, state.player.y);
    const pChunk = state.world.getChunk(pTile.cx, pTile.cy);
    progressCapture(pChunk, Faction.PLAYER, dt, getCapturePerTick(state.player.rank));
  }

  // Update NPCs & Human-Controlled Rival Bosses
  for (let i = state.npcs.length - 1; i >= 0; i--) {
    const u = state.npcs[i];
    if (!u) continue;

    if (u.attackCooldown > 0) u.attackCooldown = Math.max(0, u.attackCooldown - dt);
    tickWeapon(u, dt);
    if (u.slashAnimTimer > 0) u.slashAnimTimer = Math.max(0, u.slashAnimTimer - dt);
    if (u.muzzleFlashTimer > 0) u.muzzleFlashTimer = Math.max(0, u.muzzleFlashTimer - dt);
    if (u.hitFlashTimer > 0) u.hitFlashTimer = Math.max(0, u.hitFlashTimer - dt);
    if (u.armorCooldown > 0) u.armorCooldown = Math.max(0, u.armorCooldown - dt);

    if (u.rank === UnitRank.BOSS && u.humanPeerId) {
      updateHumanControlledRivalBoss(u, dt);
      continue;
    }

    updateNpcAi(u, dt);
  }

  // Hourly Economy & Auto-Recruitment Tick
  state.tickTimer += dt;
  if (state.tickTimer >= state.tickDuration) {
    state.tickTimer -= state.tickDuration;
    processHourlyTick();
  }

  if (state.net && state.net.isHost()) {
    state.net.updateHost(dt);
  }
}

// Simulation step: host/single-player world update and guest presentation loop.

import { Faction, UnitRank } from '../config/enums.js';
import {
  SPRINT_MAX_DURATION,
  SPRINT_COOLDOWN_DURATION,
  SPRINT_SPEED_MULTIPLIER,
} from '../config/constants.js';
import { state, getLocalBoss, isLocalBossAlive } from '../core/state.js';
import { rebuildSpatialBuckets } from '../core/spatial.js';
import { canvas } from '../render/canvas.js';
import { stepGuestPresentation } from '../render/interpolation.js';
import { updateVisualParticles } from '../render/effects.js';
import {
  canOccupyPosition,
  isPushingFriendly,
  getEntityCollisionRadius,
  updateHumanControlledRivalBoss,
  computeSteeringPath,
} from './movement.js';
import { progressCapture, getCaptureRate } from './territory.js';
import { processHourlyTick } from './economy.js';
import { updateNpcAi } from './ai.js';


function updateSpectatorCamera(dt) {
  let mx = 0;
  let my = 0;
  if (state.keys.has('w') || state.keys.has('arrowup')) my -= 1;
  if (state.keys.has('s') || state.keys.has('arrowdown')) my += 1;
  if (state.keys.has('a') || state.keys.has('arrowleft')) mx -= 1;
  if (state.keys.has('d') || state.keys.has('arrowright')) mx += 1;
  if (mx !== 0 || my !== 0) {
    const len = Math.hypot(mx, my);
    const panSpeed = state.keys.has('shift') ? 820 : 480;
    state.camera.x += (mx / len) * panSpeed * dt;
    state.camera.y += (my / len) * panSpeed * dt;
  }
}

export function update(dt) {
  if (!state.gameStarted) return;

  if (state.net && state.net.isGuest()) {
    state.net.updateGuest(dt);
    stepGuestPresentation(dt);
    updateVisualParticles(dt);

    const localBoss = getLocalBoss();
    if (localBoss && isLocalBossAlive() && !state.isSpectating) {
      state.camera.x += (localBoss.x - state.camera.x) * Math.min(1, dt * 12);
      state.camera.y += (localBoss.y - state.camera.y) * Math.min(1, dt * 12);
    } else {
      updateSpectatorCamera(dt);
    }

    state.tickTimer += dt;
    if (state.tickTimer >= state.tickDuration) state.tickTimer %= state.tickDuration;
    return;
  }

  state.astarBudgetThisFrame = 0;
  rebuildSpatialBuckets();
  updateVisualParticles(dt);

  if (state.player.attackCooldown > 0) state.player.attackCooldown = Math.max(0, state.player.attackCooldown - dt);
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
      const len = Math.hypot(moveX, moveY);
      moveX /= len;
      moveY /= len;
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

    if (state.mouse.inside && canvas && canvas.width > 0) {
      const rect = canvas.getBoundingClientRect();
      const aimWx = state.camera.x - rect.width / 2 + state.mouse.screenX;
      const aimWy = state.camera.y - rect.height / 2 + state.mouse.screenY;
      state.player.facing = Math.atan2(aimWy - state.player.y, aimWx - state.player.x);
    } else if (moveX !== 0 || moveY !== 0) {
      state.player.facing = Math.atan2(moveY, moveX);
    }

    const isMoving = moveX !== 0 || moveY !== 0;
    const wantsSprint = (state.keys.has('shift') || state.sprintButtonHeld) && isMoving;
    if (state.player.sprintCooldown > 0) {
      state.player.sprintCooldown = Math.max(0, state.player.sprintCooldown - dt);
      state.player.isSprinting = false;
    } else if (wantsSprint) {
      state.player.isSprinting = true;
      state.player.sprintTimer += dt;
      if (state.player.sprintTimer >= SPRINT_MAX_DURATION) {
        state.player.isSprinting = false;
        state.player.sprintTimer = 0;
        state.player.sprintCooldown = SPRINT_COOLDOWN_DURATION;
      }
    } else {
      if (state.player.isSprinting && state.player.sprintTimer > 0) {
        state.player.sprintCooldown = SPRINT_COOLDOWN_DURATION * (state.player.sprintTimer / SPRINT_MAX_DURATION);
      }
      state.player.isSprinting = false;
      state.player.sprintTimer = 0;
    }

    const pRad = getEntityCollisionRadius(UnitRank.BOSS);
    const pushingCrew = isPushingFriendly(state.player.x, state.player.y, pRad, Faction.PLAYER, -1, true);
    const sprintMult = state.player.isSprinting ? SPRINT_SPEED_MULTIPLIER : 1.0;
    const currentSpeed = (pushingCrew ? state.player.speed * 0.45 : state.player.speed) * sprintMult;

    if (moveX !== 0) {
      const nx = state.player.x + moveX * currentSpeed * dt;
      if (canOccupyPosition(nx, state.player.y, pRad, -1, true, Faction.PLAYER)) {
        state.player.x = nx;
      }
    }
    if (moveY !== 0) {
      const ny = state.player.y + moveY * currentSpeed * dt;
      if (canOccupyPosition(state.player.x, ny, pRad, -1, true, Faction.PLAYER)) {
        state.player.y = ny;
      }
    }

    const pTile = state.world.worldToTile(state.player.x, state.player.y);
    const pChunk = state.world.getChunk(pTile.cx, pTile.cy);
    progressCapture(pChunk, Faction.PLAYER, dt, getCaptureRate(UnitRank.BOSS));

    state.camera.x += (state.player.x - state.camera.x) * Math.min(1, dt * 12);
    state.camera.y += (state.player.y - state.camera.y) * Math.min(1, dt * 12);
  } else {
    updateSpectatorCamera(dt);
  }

  // Update NPCs & Human-Controlled Rival Bosses
  for (let i = state.npcs.length - 1; i >= 0; i--) {
    const u = state.npcs[i];
    if (!u) continue;

    if (u.attackCooldown > 0) u.attackCooldown = Math.max(0, u.attackCooldown - dt);
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

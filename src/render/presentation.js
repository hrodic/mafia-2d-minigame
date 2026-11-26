// Presentation orchestration: guest smoothing, camera follow/spectate and particles.
// Runs once per rendered frame, never inside the fixed simulation loop.

import { state, getLocalBoss, isLocalBossAlive } from '../core/state.js';
import { getPistolAim } from '../sim/combat.js';
import { canvas } from './canvas.js';
import { stepGuestPresentation } from './interpolation.js';
import { updateVisualParticles } from './effects.js';

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

/** Host/single-player mouse aim: turn the boss toward the cursor in world space. */
export function updateLocalAim() {
  if (!state.mouse.inside || !canvas || canvas.width <= 0) return;
  const rect = canvas.getBoundingClientRect();
  const aimWx = state.camera.x - rect.width / 2 + state.mouse.screenX;
  const aimWy = state.camera.y - rect.height / 2 + state.mouse.screenY;
  state.player.facing = getPistolAim(state.player.x, state.player.y, aimWx, aimWy).angle;
}

/** Guest-only frame step: stream input, smooth snapshots and advance presentation. */
export function updateGuest(dt) {
  if (!state.gameStarted) return;
  state.net.updateGuest(dt);
  stepGuestPresentation(dt);

  state.tickTimer += dt;
  if (state.tickTimer >= state.tickDuration) state.tickTimer %= state.tickDuration;

  updatePresentation(dt);
}

/** Camera, particles and spectator pan; uses render dt for both host and guest. */
export function updatePresentation(dt) {
  if (!state.gameStarted) return;
  updateVisualParticles(dt);

  const localBoss = getLocalBoss();
  if (localBoss && isLocalBossAlive() && !state.isSpectating) {
    state.camera.x += (localBoss.x - state.camera.x) * Math.min(1, dt * 12);
    state.camera.y += (localBoss.y - state.camera.y) * Math.min(1, dt * 12);
  } else {
    updateSpectatorCamera(dt);
  }
}

// Presentation cadence for the HUD. Lives in the UI layer so sim/ stays free of
// runtime hooks. Called once per frame by the main loop.

import { state } from '../core/state.js';

export const HUD_REFRESH_INTERVAL = 0.25;

/** Advance the HUD timer; refresh at 4 Hz. Returns true when a refresh ran. */
export function updateHudCadence(dt, refreshHUD) {
  state.hudUpdateTimer += dt;
  if (state.hudUpdateTimer < HUD_REFRESH_INTERVAL) return false;
  state.hudUpdateTimer = 0;
  refreshHUD();
  return true;
}

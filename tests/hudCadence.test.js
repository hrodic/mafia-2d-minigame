// HUD cadence tests: presentation refresh lives in the UI loop, not the simulation.
import { test, assert, assertEqual } from './harness.js';
import { state } from '../src/core/state.js';
import { HUD_REFRESH_INTERVAL, updateHudCadence } from '../src/ui/hudCadence.js';

test('hud cadence: refreshes every 250ms and resets the timer', () => {
  const saved = state.hudUpdateTimer;
  state.hudUpdateTimer = 0;
  let calls = 0;
  try {
    assertEqual(HUD_REFRESH_INTERVAL, 0.25);
    assertEqual(updateHudCadence(0.1, () => calls++), false);
    assertEqual(state.hudUpdateTimer, 0.1);
    assertEqual(updateHudCadence(0.1, () => calls++), false);
    assertEqual(calls, 0);
    assertEqual(updateHudCadence(0.05, () => calls++), true);
    assertEqual(calls, 1);
    assertEqual(state.hudUpdateTimer, 0);

    assertEqual(updateHudCadence(0.3, () => calls++), true);
    assertEqual(calls, 2);
  } finally {
    state.hudUpdateTimer = saved;
  }
});

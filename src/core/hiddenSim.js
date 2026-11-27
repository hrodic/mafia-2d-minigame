// @ts-check
// Hidden-tab host simulation fallback. Browsers throttle requestAnimationFrame in
// background tabs, so the host can keep the authoritative simulation moving with a
// timer while hidden. Rendering/HUD stay on the normal rAF path.

import { MAX_FRAME_DELTA, SIM_DT, MAX_SIM_STEPS } from '../config/constants.js';
import { advanceFixedStep } from './fixedStep.js';

/**
 * @typedef {Object} HiddenSimOptions
 * @property {(dt: number) => void} update
 * @property {() => boolean} isGameStarted
 * @property {() => boolean} isGuest
 * @property {number} [intervalMs]
 * @property {() => number} [now]
 * @property {(fn: () => void, ms: number) => any} [setIntervalFn]
 * @property {(id: any) => void} [clearIntervalFn]
 */

/**
 * @param {HiddenSimOptions} options
 * @returns {{ start: () => boolean, stop: () => void, isRunning: () => boolean }}
 */
export function createHiddenSim({
  update,
  isGameStarted,
  isGuest,
  intervalMs = 16,
  now = () => performance.now(),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}) {
  /** @type {any} */
  let timer = null;
  let lastTime = 0;
  let accumulator = 0;

  function stop() {
    if (timer !== null) {
      clearIntervalFn(timer);
      timer = null;
    }
    accumulator = 0;
  }

  function start() {
    if (timer !== null || !isGameStarted() || isGuest()) return false;
    lastTime = now();
    timer = setIntervalFn(() => {
      if (!isGameStarted() || isGuest()) {
        stop();
        return;
      }
      const current = now();
      const frameDt = Math.min(MAX_FRAME_DELTA, Math.max(0, (current - lastTime) / 1000));
      lastTime = current;
      const advanced = advanceFixedStep(accumulator, frameDt, SIM_DT, MAX_SIM_STEPS, update);
      accumulator = advanced.accumulator;
    }, intervalMs);
    return true;
  }

  return {
    start,
    stop,
    isRunning: () => timer !== null,
  };
}

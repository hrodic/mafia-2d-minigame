// Hidden-tab host simulation fallback tests.
import { test, assert, assertEqual } from './harness.js';
import { SIM_DT } from '../src/config/constants.js';
import { createHiddenSim } from '../src/core/hiddenSim.js';

test('hiddenSim: starts only for an active non-guest game and stops cleanly', () => {
  let started = true;
  let guest = false;
  let cleared = 0;
  const sim = createHiddenSim({
    update: () => {},
    isGameStarted: () => started,
    isGuest: () => guest,
    setIntervalFn: () => 7,
    clearIntervalFn: (id) => { cleared = id; },
  });

  assertEqual(sim.start(), true);
  assertEqual(sim.start(), false);
  assertEqual(sim.isRunning(), true);
  sim.stop();
  assertEqual(cleared, 7);
  assertEqual(sim.isRunning(), false);

  guest = true;
  assertEqual(sim.start(), false);

  guest = false;
  started = false;
  assertEqual(sim.start(), false);
});

test('hiddenSim: timer advances fixed simulation steps without rendering', () => {
  let started = true;
  let now = 0;
  let tick = null;
  const steps = [];
  const sim = createHiddenSim({
    update: (dt) => steps.push(dt),
    isGameStarted: () => started,
    isGuest: () => false,
    now: () => now,
    setIntervalFn: (fn, ms) => {
      assertEqual(ms, 16);
      tick = fn;
      return 9;
    },
    clearIntervalFn: () => {},
  });

  assertEqual(sim.start(), true);
  now = 20;
  tick();
  assertEqual(steps.length, 2);
  assertEqual(steps[0], SIM_DT);
  assertEqual(steps[1], SIM_DT);

  now = 40;
  tick();
  assertEqual(steps.length, 4);
});

test('hiddenSim: timer stops itself when the match ends', () => {
  let started = true;
  let tick = null;
  let cleared = 0;
  const sim = createHiddenSim({
    update: () => {},
    isGameStarted: () => started,
    isGuest: () => false,
    now: () => 0,
    setIntervalFn: (fn) => { tick = fn; return 11; },
    clearIntervalFn: (id) => { cleared = id; },
  });

  assertEqual(sim.start(), true);
  started = false;
  tick();
  assertEqual(cleared, 11);
  assertEqual(sim.isRunning(), false);
});

// Guest presentation tests: per-frame interpolation and animation timer decay.
import { test, assert, assertEqual } from './harness.js';
import { state } from '../src/core/state.js';
import { stepGuestPresentation } from '../src/render/interpolation.js';

const KEYS = ['player', 'npcs'];

function withEntities(player, npcs, fn) {
  const saved = {};
  for (const key of KEYS) saved[key] = state[key];
  state.player = player;
  state.npcs = npcs;
  try {
    return fn();
  } finally {
    for (const key of KEYS) state[key] = saved[key];
  }
}

function makeEntity(overrides = {}) {
  return {
    x: 0,
    y: 0,
    slashAnimTimer: 0.18,
    muzzleFlashTimer: 0.11,
    hitFlashTimer: 0.15,
    ...overrides,
  };
}

test('interpolation: positions ease toward the latest snapshot target each frame', () => {
  const player = makeEntity({ x: 0, y: 0, netX: 100, netY: 200 });
  withEntities(player, [], () => {
    stepGuestPresentation(1 / 60);
    assert(player.x > 0 && player.x < 100, `player x should ease, got ${player.x}`);
    assert(player.y > 0 && player.y < 200, `player y should ease, got ${player.y}`);
    for (let i = 0; i < 30; i++) stepGuestPresentation(1 / 60);
    assert(Math.abs(player.x - 100) < 1, `x should converge, got ${player.x}`);
    assert(Math.abs(player.y - 200) < 1, `y should converge, got ${player.y}`);
  });
});

test('interpolation: entities without a snapshot target stay put', () => {
  const player = makeEntity({ x: 12, y: 34 });
  withEntities(player, [], () => {
    stepGuestPresentation(1 / 60);
    assertEqual(player.x, 12);
    assertEqual(player.y, 34);
  });
});

test('interpolation: animation timers decay to zero instead of freezing', () => {
  const player = makeEntity();
  withEntities(player, [], () => {
    for (let i = 0; i < 20; i++) stepGuestPresentation(1 / 60);
    assertEqual(player.slashAnimTimer, 0);
    assertEqual(player.muzzleFlashTimer, 0);
    assertEqual(player.hitFlashTimer, 0);
  });
});

test('interpolation: every NPC is interpolated and decays its timers', () => {
  const a = makeEntity({ x: 0, y: 0, netX: 50, netY: 25 });
  const b = makeEntity({ x: 10, y: 10, netX: 20, netY: 30 });
  withEntities(makeEntity(), [a, b], () => {
    for (let i = 0; i < 40; i++) stepGuestPresentation(1 / 60);
    assert(Math.abs(a.x - 50) < 1, `a.x=${a.x}`);
    assert(Math.abs(a.y - 25) < 1, `a.y=${a.y}`);
    assert(Math.abs(b.x - 20) < 1, `b.x=${b.x}`);
    assert(Math.abs(b.y - 30) < 1, `b.y=${b.y}`);
    assertEqual(a.slashAnimTimer, 0);
    assertEqual(b.muzzleFlashTimer, 0);
  });
});

test('interpolation: guest movement advances the walk phase and idles when settled', () => {
  const player = makeEntity({ x: 0, y: 0, netX: 100, netY: 0 });
  withEntities(player, [], () => {
    stepGuestPresentation(1 / 60);
    assertEqual(player.isMoving, true);
    assert(player.walkPhase > 0, `walkPhase should advance, got ${player.walkPhase}`);

    for (let i = 0; i < 120; i++) stepGuestPresentation(1 / 60);
    assertEqual(player.isMoving, false);
    const settledPhase = player.walkPhase;
    stepGuestPresentation(1 / 60);
    assertEqual(player.walkPhase, settledPhase);
  });
});

test('interpolation: a zero or negative delta leaves entities untouched', () => {
  const player = makeEntity({ x: 5, y: 5, netX: 100, netY: 100 });
  withEntities(player, [], () => {
    stepGuestPresentation(0);
    assertEqual(player.x, 5);
    assertEqual(player.y, 5);
    assertEqual(player.slashAnimTimer, 0.18);
  });
});

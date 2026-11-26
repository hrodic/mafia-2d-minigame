// Simulation orchestration tests: host movement/tick cadence, guest early-return,
// host snapshot driving and an AI smoke test.
import { test, assert, assertEqual } from './harness.js';
import { Faction, UnitRank, PropType } from '../src/config/enums.js';
import { CHUNK_SIZE, TILE_SIZE } from '../src/config/constants.js';
import { state } from '../src/core/state.js';
import { runtime } from '../src/core/runtime.js';
import { on } from '../src/core/events.js';
import { isSoundEnabled, setSoundEnabled } from '../src/audio/engine.js';
import { resetEffects } from '../src/render/effects.js';
import { update } from '../src/sim/simulation.js';

const STATE_KEYS = [
  'world',
  'player',
  'npcs',
  'treasuries',
  'factionAlive',
  'activeFactions',
  'keys',
  'camera',
  'gameStarted',
  'gameOver',
  'isSpectating',
  'tickTimer',
  'tickDuration',
  'hudUpdateTimer',
  'minimapCacheTimer',
  'gameHour',
  'net',
  'spatialBuckets',
  'bucketPool',
  'floatingTexts',
  'autoRecruitSoldier',
  'autoRecruitCaptain',
  'autoRecruitUnderboss',
  'playerSpawnCaps',
  'factionRecruitmentPrefs',
];

function makeWorld(options = {}) {
  const walkable = options.walkable || (() => true);
  const props = Array.from({ length: CHUNK_SIZE }, () => Array(CHUNK_SIZE).fill(PropType.NONE));
  const chunk = {
    cx: 0,
    cy: 0,
    faction: options.chunkFaction || Faction.PLAYER,
    income: options.income ?? 1000,
    captureProgress: 0,
    capturingFaction: null,
    props,
    propVertical: Array.from({ length: CHUNK_SIZE }, () => Array(CHUNK_SIZE).fill(false)),
    propCurbSide: Array.from({ length: CHUNK_SIZE }, () => Array(CHUNK_SIZE).fill('N')),
  };
  return {
    canMoveTo: () => true,
    isWalkable: walkable,
    isTileNavigable: () => true,
    findNearestWalkablePoint: (x, y) => ({ x, y }),
    worldToTile(x, y) {
      const gx = Math.floor(x / TILE_SIZE);
      const gy = Math.floor(y / TILE_SIZE);
      return {
        cx: Math.floor(gx / CHUNK_SIZE),
        cy: Math.floor(gy / CHUNK_SIZE),
        lx: ((gx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE,
        ly: ((gy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE,
      };
    },
    getChunk() {
      return chunk;
    },
    chunks: new Map([[`0,0`, chunk]]),
    generation: null,
  };
}

function makePlayer(overrides = {}) {
  return {
    x: 100,
    y: 100,
    hp: 400,
    maxHp: 400,
    armor: 0,
    maxArmor: 300,
    alive: true,
    facing: 0,
    speed: 225,
    minDmg: 20,
    maxDmg: 40,
    attackCooldown: 0,
    slashAnimTimer: 0,
    muzzleFlashTimer: 0,
    hitFlashTimer: 0,
    armorCooldown: 0,
    sprintTimer: 0,
    sprintCooldown: 0,
    isSprinting: false,
    targetX: null,
    targetY: null,
    ...overrides,
  };
}

function makeNpc(overrides = {}) {
  return {
    id: 1,
    faction: Faction.RIVAL_1,
    rank: UnitRank.SOLDIER,
    x: 200,
    y: 0,
    bodyRadius: 11,
    speed: 128,
    hp: 180,
    maxHp: 180,
    armor: 0,
    maxArmor: 0,
    armorCooldown: 0,
    sprintTimer: 0,
    sprintCooldown: 0,
    isSprinting: false,
    minDmg: 10,
    maxDmg: 18,
    facing: 0,
    attackCooldown: 0,
    slashAnimTimer: 0,
    muzzleFlashTimer: 0,
    hitFlashTimer: 0,
    goalX: 200,
    goalY: 0,
    path: null,
    pathTimer: 0,
    aiTimer: 0,
    dodgeDir: 1,
    ...overrides,
  };
}

function withSimState(opts, fn) {
  const saved = {};
  for (const key of STATE_KEYS) saved[key] = state[key];

  state.world = opts.world || makeWorld();
  state.player = opts.player || makePlayer();
  state.npcs = opts.npcs || [];
  state.treasuries = { ...saved.treasuries, ...(opts.treasuries || {}) };
  state.factionAlive = { ...saved.factionAlive, ...(opts.factionAlive || {}) };
  state.activeFactions = [...(opts.activeFactions || [Faction.PLAYER, Faction.RIVAL_1, Faction.RIVAL_2, Faction.RIVAL_3])];
  state.keys = new Set(opts.keys || []);
  state.camera = { x: 0, y: 0 };
  state.gameStarted = opts.gameStarted ?? true;
  state.gameOver = false;
  state.isSpectating = false;
  state.tickTimer = opts.tickTimer ?? 0;
  state.tickDuration = opts.tickDuration ?? 100;
  state.hudUpdateTimer = opts.hudUpdateTimer ?? 0;
  state.minimapCacheTimer = 0;
  state.gameHour = opts.gameHour ?? 12;
  state.net = opts.net || null;
  state.spatialBuckets = new Map();
  state.bucketPool = [];
  state.floatingTexts = [];
  state.autoRecruitSoldier = false;
  state.autoRecruitCaptain = false;
  state.autoRecruitUnderboss = false;
  state.playerSpawnCaps = { ...saved.playerSpawnCaps };
  state.factionRecruitmentPrefs = JSON.parse(JSON.stringify(saved.factionRecruitmentPrefs));
  resetEffects();

  let hudCalls = 0;
  const originalHud = runtime.updateHUD;
  runtime.updateHUD = () => {
    hudCalls++;
  };
  const sound = isSoundEnabled();
  setSoundEnabled(false);

  try {
    return fn({ hudCalls: () => hudCalls });
  } finally {
    runtime.updateHUD = originalHud;
    setSoundEnabled(sound);
    for (const key of STATE_KEYS) state[key] = saved[key];
    resetEffects();
  }
}

test('simulation: host movement, timers and HUD cadence', () => {
  withSimState({ keys: ['d'], hudUpdateTimer: 0.24, player: makePlayer({ attackCooldown: 0.5 }) }, ({ hudCalls }) => {
    update(0.1);
    assert(state.player.x > 100, `player should move right, x=${state.player.x}`);
    assertEqual(state.player.y, 100);
    assertEqual(state.player.attackCooldown.toFixed(1), '0.4');
    assertEqual(hudCalls(), 1, 'HUD should refresh at the 250ms cadence');
    assertEqual(state.hudUpdateTimer, 0);
    assert(state.camera.x > 0, 'camera should follow the boss');
  });
});

test('simulation: sprint multiplies speed and drains the burst timer', () => {
  withSimState({ keys: ['d', 'shift'] }, () => {
    update(0.1);
    assert(state.player.x > 100 + 30, `sprint should be faster, x=${state.player.x}`);
    assertEqual(state.player.isSprinting, true);
    assertEqual(state.player.sprintTimer.toFixed(1), '0.1');
  });
});

test('simulation: hourly tick fires from update and pays income', () => {
  withSimState(
    {
      tickTimer: 9.95,
      tickDuration: 10,
      treasuries: { [Faction.PLAYER]: 0 },
      activeFactions: [Faction.PLAYER],
    },
    ({ hudCalls }) => {
      update(0.1);
      assertEqual(state.gameHour, 13);
      assert(state.tickTimer < 0.1, `tick timer should wrap, got ${state.tickTimer}`);
      assertEqual(state.treasuries[Faction.PLAYER], 1000);
      assert(hudCalls() >= 1, 'tick should refresh the HUD');
    }
  );
});

test('simulation: guest update forwards input, follows the local boss and decays timers', () => {
  const boss = makeNpc({ rank: UnitRank.BOSS, faction: Faction.RIVAL_1, x: 500, y: 500, slashAnimTimer: 0.18 });
  const calls = { input: 0 };
  const net = {
    isActive: () => true,
    localFaction: Faction.RIVAL_1,
    isGuest: () => true,
    isHost: () => false,
    updateGuest: () => {
      calls.input++;
    },
    updateHost: () => {},
  };
  withSimState(
    {
      net,
      npcs: [boss],
      keys: ['d'],
      player: makePlayer({ x: 100, y: 100 }),
      hudUpdateTimer: 0.2,
      tickTimer: 5,
      tickDuration: 10,
    },
    ({ hudCalls }) => {
      update(0.1);
      assertEqual(calls.input, 1, 'guest input should be streamed');
      assertEqual(state.player.x, 100, 'guest must not simulate the host player');
      assert(state.camera.x > 0, 'guest camera should follow the local boss');
      assert(boss.slashAnimTimer < 0.18, 'guest animation timers must decay');
      assertEqual(hudCalls(), 1);
    }
  );
});

test('simulation: host update drives the network snapshot timer', () => {
  let hostCalls = 0;
  const net = {
    isActive: () => true,
    localFaction: Faction.PLAYER,
    isGuest: () => false,
    isHost: () => true,
    updateHost: () => {
      hostCalls++;
    },
    updateGuest: () => {},
    getPeerInput: () => null,
  };
  withSimState({ net }, () => {
    update(0.1);
    assertEqual(hostCalls, 1);
  });
});

test('simulation: NPC AI runs and spatial buckets are rebuilt', () => {
  const npc = makeNpc({ x: 200, y: 0 });
  withSimState({ npcs: [npc] }, () => {
    for (let i = 0; i < 5; i++) update(0.05);
    assertEqual(state.spatialBuckets.size, 1, 'spatial buckets should include the NPC');
    assert(npc.x !== 200 || npc.y !== 0, 'NPC should move/patrol');
    assert(state.world.chunks.get('0,0').faction === Faction.PLAYER);
  });
});

test('simulation: non-boss melee emits slash:performed', () => {
  const player = makePlayer({ x: 100, y: 100 });
  const npc = makeNpc({ x: 130, y: 100, faction: Faction.RIVAL_1 });
  withSimState({ player, npcs: [npc] }, () => {
    const slashes = [];
    const unsubscribe = on('slash:performed', (payload) => slashes.push(payload));
    try {
      update(0.016);
      assertEqual(slashes.length, 1);
      assertEqual(slashes[0].hitCount, 1);
      assertEqual(slashes[0].isPlayer, false);
      assertEqual(slashes[0].x, 130);
      assert(state.player.hp < 400, 'the melee should still damage the player');
    } finally {
      unsubscribe();
    }
  });
});

test('simulation: click-to-move walks the player toward the waypoint', () => {
  withSimState({ player: makePlayer({ x: 100, y: 100, targetX: 300, targetY: 100 }) }, () => {
    for (let i = 0; i < 5; i++) update(0.1);
    assert(state.player.x > 100, `player should follow the waypoint, x=${state.player.x}`);
  });
});

test('simulation: update is a no-op before the match starts', () => {
  withSimState({ gameStarted: false }, ({ hudCalls }) => {
    update(1);
    assertEqual(hudCalls(), 0);
    assertEqual(state.player.x, 100);
  });
});

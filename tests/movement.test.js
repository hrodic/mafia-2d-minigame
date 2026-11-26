// Movement/collision helper tests: entity radii, occupancy rules, friendly pushing
// and NPC boss sprint state.
import { test, assert, assertEqual, assertClose } from './harness.js';
import { Faction, UnitRank } from '../src/config/enums.js';
import { CHUNK_PX, SPRINT_COOLDOWN_DURATION, SPRINT_MAX_DURATION } from '../src/config/constants.js';
import { state } from '../src/core/state.js';
import { packChunkKey } from '../src/world/city.js';
import {
  getEntityCollisionRadius,
  canOccupyPosition,
  isPushingFriendly,
  updateUnitSprint,
  moveUnit,
  updateHumanControlledRivalBoss,
} from '../src/sim/movement.js';

const OPEN_WORLD = { canMoveTo: () => true };
const BLOCKED_WORLD = { canMoveTo: () => false };

function withState(patch, fn) {
  const saved = {};
  for (const key of Object.keys(patch)) saved[key] = state[key];
  Object.assign(state, patch);
  try {
    return fn();
  } finally {
    for (const key of Object.keys(saved)) state[key] = saved[key];
  }
}

function basePatch(extra = {}) {
  return {
    world: OPEN_WORLD,
    player: { x: 0, y: 0, alive: true },
    npcs: [],
    spatialBuckets: new Map(),
    ...extra,
  };
}

function npcBucket(units) {
  const buckets = new Map();
  buckets.set(packChunkKey(0, 0), units);
  return buckets;
}

test('movement: collision radii match the unit hierarchy', () => {
  assertEqual(getEntityCollisionRadius(UnitRank.BOSS), 13.5);
  assertEqual(getEntityCollisionRadius(UnitRank.UNDERBOSS), 12.8);
  assertEqual(getEntityCollisionRadius(UnitRank.CAPTAIN), 12.0);
  assertEqual(getEntityCollisionRadius(UnitRank.SOLDIER), 11.0);
});

test('movement: world collision vetoes occupancy', () => {
  withState(basePatch({ world: BLOCKED_WORLD }), () => {
    assertEqual(canOccupyPosition(10, 0, 11), false);
  });
});

test('movement: the player blocks enemies but not friendly crew', () => {
  withState(basePatch(), () => {
    assertEqual(canOccupyPosition(10, 0, 11, -1, false, Faction.RIVAL_1), false);
    assertEqual(canOccupyPosition(15, 0, 11, -1, false, Faction.RIVAL_1), false);
    assertEqual(canOccupyPosition(10, 0, 11, -1, true, Faction.RIVAL_1), true);
    // Same faction keeps a much smaller personal-space radius (~11px).
    assertEqual(canOccupyPosition(15, 0, 11, -1, false, Faction.PLAYER), true);
    assertEqual(canOccupyPosition(5, 0, 11, -1, false, Faction.PLAYER), false);
  });
  withState(basePatch({ player: { x: 0, y: 0, alive: false } }), () => {
    assertEqual(canOccupyPosition(10, 0, 11, -1, false, Faction.RIVAL_1), true);
  });
});

test('movement: NPCs block enemies, allow friendly overlap and honour ignoreNpcId', () => {
  const ally = { id: 7, x: 0, y: 0, rank: UnitRank.SOLDIER, faction: Faction.RIVAL_1 };
  const enemy = { id: 8, x: 0, y: 0, rank: UnitRank.SOLDIER, faction: Faction.PLAYER };
  withState(basePatch({ spatialBuckets: npcBucket([ally]) }), () => {
    assertEqual(canOccupyPosition(10, 0, 11, -1, true, Faction.RIVAL_1), true);
    assertEqual(canOccupyPosition(5, 0, 11, -1, true, Faction.RIVAL_1), false);
    assertEqual(canOccupyPosition(5, 0, 11, 7, true, Faction.RIVAL_1), true);
  });
  withState(basePatch({ spatialBuckets: npcBucket([enemy]) }), () => {
    assertEqual(canOccupyPosition(10, 0, 11, -1, true, Faction.RIVAL_1), false);
    assertEqual(canOccupyPosition(10, 0, 11, 8, true, Faction.RIVAL_1), true);
  });
});

test('movement: only enemy NPCs are scanned outside the 3x3 chunk neighbourhood', () => {
  const far = { id: 9, x: CHUNK_PX * 5, y: 0, rank: UnitRank.SOLDIER, faction: Faction.RIVAL_1 };
  withState(basePatch({ spatialBuckets: npcBucket([far]) }), () => {
    assertEqual(canOccupyPosition(10, 0, 11, -1, true, Faction.RIVAL_1), true);
  });
});

test('movement: friendly pushing detects nearby friends only', () => {
  withState(basePatch(), () => {
    assertEqual(isPushingFriendly(10, 0, 11, Faction.PLAYER), true);
    assertEqual(isPushingFriendly(10, 0, 11, Faction.PLAYER, -1, true), false);
    assertEqual(isPushingFriendly(10, 0, 11, Faction.RIVAL_1), false);
  });
  const ally = { id: 3, x: 0, y: 0, rank: UnitRank.SOLDIER, faction: Faction.RIVAL_1 };
  const enemy = { id: 4, x: 0, y: 0, rank: UnitRank.SOLDIER, faction: Faction.PLAYER };
  withState(basePatch({ spatialBuckets: npcBucket([ally]) }), () => {
    assertEqual(isPushingFriendly(10, 0, 11, Faction.RIVAL_1), true);
    assertEqual(isPushingFriendly(10, 0, 11, Faction.RIVAL_1, 3), false);
    assertEqual(isPushingFriendly(10, 0, 11, Faction.PLAYER, -1, true), false);
  });
  withState(basePatch({ spatialBuckets: npcBucket([enemy]) }), () => {
    // Enemy NPCs are not friendly; the alive player is ignored for non-player factions.
    assertEqual(isPushingFriendly(10, 0, 11, Faction.RIVAL_1), false);
  });
});

test('movement: unit sprint drains, triggers cooldown and returns the multiplier', () => {
  const boss = { sprintCooldown: 0, sprintTimer: 0, isSprinting: false };
  assertEqual(updateUnitSprint(boss, true, SPRINT_MAX_DURATION * 0.5), 1.6);
  assertEqual(boss.isSprinting, true);
  assertEqual(updateUnitSprint(boss, true, SPRINT_MAX_DURATION * 0.5), 1.0);
  assertEqual(boss.isSprinting, false);
  assertEqual(boss.sprintTimer, 0);
  assertEqual(boss.sprintCooldown, SPRINT_COOLDOWN_DURATION);
  assertEqual(updateUnitSprint(boss, false, 1), 1.0);
  assertEqual(boss.sprintCooldown, SPRINT_COOLDOWN_DURATION - 1);
});

test('movement: releasing sprint early converts remaining burst into cooldown', () => {
  const boss = { sprintCooldown: 0, sprintTimer: 0, isSprinting: false };
  updateUnitSprint(boss, true, 1);
  assertEqual(boss.isSprinting, true);
  updateUnitSprint(boss, false, 0.1);
  assertEqual(boss.isSprinting, false);
  assertEqual(boss.sprintTimer, 0);
  assertEqual(boss.sprintCooldown, SPRINT_COOLDOWN_DURATION * 0.5);
});

test('movement: standing still never starts a cooldown', () => {
  const boss = { sprintCooldown: 0, sprintTimer: 0, isSprinting: false };
  assertEqual(updateUnitSprint(boss, false, 1), 1.0);
  assertEqual(boss.sprintCooldown, 0);
  assertEqual(boss.isSprinting, false);
});

function makeMovableUnit(overrides = {}) {
  return {
    id: 0,
    faction: Faction.PLAYER,
    rank: UnitRank.BOSS,
    control: 'local',
    bodyRadius: 13.5,
    x: 0,
    y: 0,
    speed: 225,
    sprintTimer: 0,
    sprintCooldown: 0,
    isSprinting: false,
    ...overrides,
  };
}

test('movement: moveUnit applies base speed, sprint and body radius to any unit', () => {
  const unit = makeMovableUnit();
  withState(basePatch({ player: { ...unit, alive: true } }), () => {
    const result = moveUnit(
      unit,
      { mx: 1, my: 0, sprint: true, ignorePlayer: true, ignoreNpcId: -1 },
      0.1
    );
    assertEqual(result.moved, true);
    assertEqual(unit.x, 36);
    assertEqual(unit.y, 0);
    assertEqual(unit.isSprinting, true);
    assertEqual(result.sprintMult, 1.6);
  });
});

test('movement: moveUnit normalizes diagonal input', () => {
  const unit = makeMovableUnit({ speed: 200 });
  withState(basePatch({ player: { ...unit, alive: true } }), () => {
    moveUnit(unit, { mx: 1, my: 1, ignorePlayer: true, ignoreNpcId: -1 }, 0.1);
    assertClose(unit.x, (200 * 0.1) / Math.SQRT2);
    assertClose(unit.y, (200 * 0.1) / Math.SQRT2);
  });
});

test('movement: moveUnit dodges perpendicular when blocked and dodge is enabled', () => {
  const unit = makeMovableUnit({
    id: 5,
    faction: Faction.RIVAL_1,
    rank: UnitRank.SOLDIER,
    bodyRadius: 11,
    speed: 150,
    dodgeDir: 1,
  });
  const world = { canMoveTo: (x, y) => y > 0 };
  withState(basePatch({ world, player: { x: -1000, y: -1000, alive: false } }), () => {
    const result = moveUnit(
      unit,
      {
        mx: 1,
        my: 0,
        ignorePlayer: false,
        ignoreNpcId: unit.id,
        dodge: true,
        dodgeDir: unit.dodgeDir,
      },
      0.1
    );
    assertEqual(result.moved, true);
    assertClose(unit.x, 0);
    assert(unit.y > 0, `dodge should move perpendicular, y=${unit.y}`);
  });
});

test('movement: moveUnit without dodge stays blocked', () => {
  const unit = makeMovableUnit({
    id: 6,
    faction: Faction.RIVAL_1,
    rank: UnitRank.SOLDIER,
    bodyRadius: 11,
    speed: 150,
  });
  const world = { canMoveTo: (x, y) => y > 0 };
  withState(basePatch({ world, player: { x: -1000, y: -1000, alive: false } }), () => {
    const result = moveUnit(
      unit,
      { mx: 1, my: 0, ignorePlayer: false, ignoreNpcId: unit.id, dodge: false },
      0.1
    );
    assertEqual(result.moved, false);
    assertEqual(unit.x, 0);
    assertEqual(unit.y, 0);
  });
});

function makeBossWorld(chunkFaction = Faction.NEUTRAL) {
  const chunk = {
    cx: 0,
    cy: 0,
    faction: chunkFaction,
    captureProgress: 0,
    capturingFaction: null,
    income: 1000,
  };
  return {
    canMoveTo: () => true,
    isTileNavigable: () => true,
    worldToTile: () => ({ cx: 0, cy: 0, lx: 0, ly: 0 }),
    getChunk: () => chunk,
    chunks: new Map([['0,0', chunk]]),
    findNearestWalkablePoint: (x, y) => ({ x, y }),
  };
}

function makeRemoteBoss(overrides = {}) {
  return {
    id: 1,
    faction: Faction.RIVAL_1,
    rank: UnitRank.BOSS,
    x: 100,
    y: 100,
    speed: 225,
    bodyRadius: 13.5,
    targetX: null,
    targetY: null,
    sprintTimer: 0,
    sprintCooldown: 0,
    isSprinting: false,
    facing: 0,
    ...overrides,
  };
}

test('movement: a remote boss follows streamed peer input', () => {
  const boss = makeRemoteBoss();
  const world = makeBossWorld(Faction.RIVAL_1);
  const net = {
    getPeerInput: () => ({ mx: 1, my: 0, sprint: false, facing: 0.75 }),
  };
  withState(
    basePatch({
      world,
      net,
      player: { x: -1000, y: -1000, alive: false },
      spatialBuckets: new Map(),
    }),
    () => {
      updateHumanControlledRivalBoss(boss, 0.1);
      assert(boss.x > 100, `boss should move right, x=${boss.x}`);
      assertEqual(boss.y, 100);
      assertEqual(boss.facing, 0.75);
    }
  );
});

test('movement: remote boss sprint raises speed', () => {
  const boss = makeRemoteBoss();
  const world = makeBossWorld(Faction.RIVAL_1);
  const net = { getPeerInput: () => ({ mx: 1, my: 0, sprint: true, facing: 0 }) };
  withState(
    basePatch({ world, net, player: { x: -1000, y: -1000, alive: false }, spatialBuckets: new Map() }),
    () => {
      updateHumanControlledRivalBoss(boss, 0.1);
      assertEqual(boss.isSprinting, true);
      assert(boss.x > 130, `sprinting boss should cover more ground, x=${boss.x}`);
    }
  );
});

test('movement: a remote boss follows a waypoint when input is idle', () => {
  const boss = makeRemoteBoss({ targetX: 200, targetY: 100 });
  const world = makeBossWorld(Faction.RIVAL_1);
  withState(
    basePatch({ world, player: { x: -1000, y: -1000, alive: false }, spatialBuckets: new Map() }),
    () => {
      updateHumanControlledRivalBoss(boss, 0.1);
      assert(boss.x > 100, `boss should follow the waypoint, x=${boss.x}`);
      assert(Math.abs(boss.facing) < 0.6, `boss should roughly face the waypoint, facing=${boss.facing}`);
    }
  );
});

test('movement: a remote boss captures the chunk it stands on', () => {
  const boss = makeRemoteBoss({ x: 50, y: 50 });
  const world = makeBossWorld(Faction.NEUTRAL);
  withState(
    basePatch({ world, player: { x: -1000, y: -1000, alive: false }, spatialBuckets: new Map() }),
    () => {
      updateHumanControlledRivalBoss(boss, 1);
      assertEqual(world.chunks.get('0,0').capturingFaction, Faction.RIVAL_1);
      assertEqual(world.chunks.get('0,0').captureProgress, 0.375);
      updateHumanControlledRivalBoss(boss, 1);
      updateHumanControlledRivalBoss(boss, 1);
      assertEqual(world.chunks.get('0,0').faction, Faction.RIVAL_1);
    }
  );
});

test('movement: remote waypoints path around walls instead of getting stuck', () => {
  const blocked = new Set();
  for (let y = 0; y < 10; y++) blocked.add(`${6},${y}`); // gap at (6,10)
  const chunk = {
    cx: 0,
    cy: 0,
    faction: Faction.RIVAL_1,
    captureProgress: 0,
    capturingFaction: null,
    income: 1000,
  };
  const world = {
    canMoveTo: (wx, wy) => !blocked.has(`${Math.floor(wx / 44)},${Math.floor(wy / 44)}`),
    isTileNavigable: (gx, gy) => !blocked.has(`${gx},${gy}`),
    findNearestWalkablePoint: (wx, wy) => ({ x: wx, y: wy }),
    worldToTile: (wx, wy) => {
      const gx = Math.floor(wx / 44);
      const gy = Math.floor(wy / 44);
      return { cx: Math.floor(gx / 15), cy: Math.floor(gy / 15), lx: gx % 15, ly: gy % 15 };
    },
    getChunk: () => chunk,
    chunks: new Map([['0,0', chunk]]),
  };
  const boss = makeRemoteBoss({ x: 2.5 * 44, y: 5.5 * 44, targetX: 10.5 * 44, targetY: 5.5 * 44 });
  withState(
    basePatch({ world, player: { x: -1000, y: -1000, alive: false }, spatialBuckets: new Map() }),
    () => {
      let detoured = false;
      for (let i = 0; i < 400; i++) {
        updateHumanControlledRivalBoss(boss, 0.05);
        if (boss.y > 400) detoured = true;
      }
      assert(detoured, 'boss should detour through the wall gap (y around 462)');
      const dist = Math.hypot(10.5 * 44 - boss.x, 5.5 * 44 - boss.y);
      assert(dist < 60, `boss should reach the waypoint, distance=${dist.toFixed(1)}`);
    }
  );
});

test('movement: keyboard input cancels an active waypoint path', () => {
  const boss = makeRemoteBoss({ targetX: 500, targetY: 500, path: [{ x: 200, y: 200 }], pathTimer: 0.5 });
  const net = { getPeerInput: () => ({ mx: 1, my: 0, sprint: false, facing: 0 }) };
  withState(
    basePatch({
      world: makeBossWorld(Faction.RIVAL_1),
      net,
      player: { x: -1000, y: -1000, alive: false },
      spatialBuckets: new Map(),
    }),
    () => {
      updateHumanControlledRivalBoss(boss, 0.1);
      assertEqual(boss.targetX, null);
      assertEqual(boss.targetY, null);
      assertEqual(boss.path, null);
      assert(boss.x > 100);
    }
  );
});

// Movement/collision helper tests: entity radii, occupancy rules, friendly pushing
// and NPC boss sprint state.
import { test, assert, assertEqual, assertClose } from './harness.js';
import { Faction, UnitRank, PropType } from '../src/config/enums.js';
import { CHUNK_PX, TILE_SIZE, SPRINT_COOLDOWN_DURATION, SPRINT_MAX_DURATION } from '../src/config/constants.js';
import { state } from '../src/core/state.js';
import { perf } from '../src/core/perf.js';
import { packChunkKey, CityMap } from '../src/world/city.js';
import {
  getEntityCollisionRadius,
  canOccupyPosition,
  isPushingFriendly,
  updateUnitSprint,
  moveUnit,
  updateHumanControlledRivalBoss,
  separateStaleOverlaps,
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

test('movement: the player occupies space for enemies and allies', () => {
  withState(basePatch(), () => {
    assertEqual(canOccupyPosition(10, 0, 11, -1, false, Faction.RIVAL_1), false);
    assertEqual(canOccupyPosition(15, 0, 11, -1, false, Faction.RIVAL_1), false);
    assertEqual(canOccupyPosition(10, 0, 11, -1, true, Faction.RIVAL_1), true);
    // Same faction no longer overlaps the player.
    assertEqual(canOccupyPosition(15, 0, 11, -1, false, Faction.PLAYER), false);
    assertEqual(canOccupyPosition(5, 0, 11, -1, false, Faction.PLAYER), false);
    assertEqual(canOccupyPosition(25, 0, 11, -1, false, Faction.PLAYER), true);
  });
  withState(basePatch({ player: { x: 0, y: 0, alive: false } }), () => {
    assertEqual(canOccupyPosition(10, 0, 11, -1, false, Faction.RIVAL_1), true);
  });
});

test('movement: NPCs block enemies and allies unless ignored', () => {
  const ally = { id: 7, x: 0, y: 0, rank: UnitRank.SOLDIER, faction: Faction.RIVAL_1 };
  const enemy = { id: 8, x: 0, y: 0, rank: UnitRank.SOLDIER, faction: Faction.PLAYER };
  withState(basePatch({ spatialBuckets: npcBucket([ally]) }), () => {
    assertEqual(canOccupyPosition(10, 0, 11, -1, true, Faction.RIVAL_1), false);
    assertEqual(canOccupyPosition(5, 0, 11, -1, true, Faction.RIVAL_1), false);
    assertEqual(
      canOccupyPosition(15, 0, 11, -1, true, Faction.RIVAL_1),
      true,
      'friendly NPCs may use the halved separation'
    );
    assertEqual(canOccupyPosition(5, 0, 11, 7, true, Faction.RIVAL_1), true);
  });
  withState(basePatch({ spatialBuckets: npcBucket([enemy]) }), () => {
    assertEqual(canOccupyPosition(10, 0, 11, -1, true, Faction.RIVAL_1), false);
    assertEqual(canOccupyPosition(10, 0, 11, 8, true, Faction.RIVAL_1), true);
  });
});

test('movement: same-faction units block each other, enemies stay hostile', () => {
  const boss = { id: 20, x: 100, y: 100, rank: UnitRank.BOSS, faction: Faction.RIVAL_1 };
  const unit = { id: 21, x: 100, y: 100, rank: UnitRank.SOLDIER, faction: Faction.RIVAL_1 };
  withState(basePatch({ spatialBuckets: npcBucket([boss, unit]) }), () => {
    // A soldier cannot stand inside its boss.
    assertEqual(canOccupyPosition(100, 100, 11, unit.id, true, Faction.RIVAL_1), false);
    // A boss cannot stand inside its soldier.
    assertEqual(canOccupyPosition(100, 100, 13.5, boss.id, true, Faction.RIVAL_1), false);
    // Enemy factions still hard-block.
    assertEqual(canOccupyPosition(100, 100, 11, unit.id, true, Faction.RIVAL_2), false);
  });
});

test('movement: only nearby units are scanned for collision', () => {
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

test('movement: only bosses can sprint', () => {
  const soldier = makeMovableUnit({ rank: UnitRank.SOLDIER, speed: 100, x: 0, y: 0 });
  withState(basePatch({ player: { ...soldier, alive: true } }), () => {
    const result = moveUnit(
      soldier,
      { mx: 1, my: 0, sprint: true, ignorePlayer: true, ignoreNpcId: -1 },
      0.1
    );
    assertEqual(result.moved, true);
    assertEqual(soldier.isSprinting, false);
    assertEqual(result.sprintMult, 1.0);
    assertEqual(soldier.x, 10, 'soldier should move at base speed');
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

test('movement: an ally is pushed slowly and separation is preserved', () => {
  const mover = makeMovableUnit({
    id: 2,
    faction: Faction.RIVAL_1,
    rank: UnitRank.SOLDIER,
    bodyRadius: 11,
    speed: 100,
    x: 0,
    y: 0,
  });
  const ally = {
    id: 3,
    faction: Faction.RIVAL_1,
    rank: UnitRank.SOLDIER,
    bodyRadius: 11,
    x: 12,
    y: 0,
    walkPhase: 0,
  };
  const world = { canMoveTo: (x, y) => Math.abs(y) < 0.001 };
  withState(
    basePatch({
      world,
      spatialBuckets: npcBucket([mover, ally]),
      player: { x: -1000, y: -1000, alive: false },
    }),
    () => {
      const result = moveUnit(
        mover,
        { mx: 1, my: 0, ignorePlayer: true, ignoreNpcId: mover.id },
        0.1
      );
      assertEqual(result.moved, true);
      assertEqual(result.speed, 30, 'pushing speed should be 30%');
      assert(mover.x > 0, 'the pusher should advance');
      assert(ally.x > 12, 'the ally should be pushed forward');
      const separation = Math.hypot(ally.x - mover.x, ally.y - mover.y);
      assert(separation >= 10.99, `ally/pusher separation too small: ${separation}`);
    }
  );
});

test('movement: AI sidesteps a friendly before trying to push', () => {
  const mover = makeMovableUnit({
    id: 2,
    faction: Faction.RIVAL_1,
    rank: UnitRank.SOLDIER,
    bodyRadius: 11,
    speed: 100,
    x: 0,
    y: 0,
  });
  const ally = {
    id: 3,
    faction: Faction.RIVAL_1,
    rank: UnitRank.SOLDIER,
    bodyRadius: 11,
    x: 12,
    y: 0,
  };
  withState(
    basePatch({
      spatialBuckets: npcBucket([mover, ally]),
      player: { x: -1000, y: -1000, alive: false },
    }),
    () => {
      const result = moveUnit(
        mover,
        { mx: 1, my: 0, ignorePlayer: true, ignoreNpcId: mover.id },
        0.1
      );
      assertEqual(result.moved, true);
      assertEqual(ally.x, 12, 'side-stepping should not push the ally');
      assert(Math.abs(mover.y) > 0, 'mover should step sideways');
    }
  );
});

test('movement: a blocked ally prevents the pusher from advancing', () => {
  const mover = makeMovableUnit({
    id: 2,
    faction: Faction.RIVAL_1,
    rank: UnitRank.SOLDIER,
    bodyRadius: 11,
    speed: 100,
    x: 0,
    y: 0,
  });
  const ally = {
    id: 3,
    faction: Faction.RIVAL_1,
    rank: UnitRank.SOLDIER,
    bodyRadius: 11,
    x: 12,
    y: 0,
  };
  const world = { canMoveTo: (x, y) => Math.abs(y) < 0.001 && x <= 13 };
  withState(
    basePatch({
      world,
      spatialBuckets: npcBucket([mover, ally]),
      player: { x: -1000, y: -1000, alive: false },
    }),
    () => {
      const result = moveUnit(
        mover,
        { mx: 1, my: 0, ignorePlayer: true, ignoreNpcId: mover.id },
        0.1
      );
      assertEqual(result.moved, false);
      assertEqual(mover.x, 0, 'the pusher must not enter the blocked ally’s space');
      assertEqual(ally.x, 12, 'the blocked ally must stay put');
    }
  );
});

test('movement: pushing works in both directions', () => {
  const front = {
    id: 2,
    faction: Faction.RIVAL_1,
    rank: UnitRank.SOLDIER,
    bodyRadius: 11,
    x: 0,
    y: 0,
  };
  const back = makeMovableUnit({
    id: 3,
    faction: Faction.RIVAL_1,
    rank: UnitRank.SOLDIER,
    bodyRadius: 11,
    speed: 100,
    x: 12,
    y: 0,
  });
  const world = { canMoveTo: (x, y) => Math.abs(y) < 0.001 };
  withState(
    basePatch({
      world,
      spatialBuckets: npcBucket([front, back]),
      player: { x: -1000, y: -1000, alive: false },
    }),
    () => {
      const result = moveUnit(
        back,
        { mx: -1, my: 0, ignorePlayer: true, ignoreNpcId: back.id },
        0.1
      );
      assertEqual(result.moved, true);
      assert(back.x < 12, 'the pushing unit should advance');
      assert(front.x < 0, 'the front unit should be pushed backward');
      const separation = Math.hypot(front.x - back.x, front.y - back.y);
      assert(separation >= 10.99, `separation too small: ${separation}`);
    }
  );
});

test('movement: a push chain moves multiple allies and keeps separation', () => {
  const a = makeMovableUnit({
    id: 2,
    faction: Faction.RIVAL_1,
    rank: UnitRank.SOLDIER,
    bodyRadius: 11,
    speed: 100,
    x: 0,
    y: 0,
  });
  const b = {
    id: 3,
    faction: Faction.RIVAL_1,
    rank: UnitRank.SOLDIER,
    bodyRadius: 11,
    x: 12,
    y: 0,
  };
  const c = {
    id: 4,
    faction: Faction.RIVAL_1,
    rank: UnitRank.SOLDIER,
    bodyRadius: 11,
    x: 24,
    y: 0,
  };
  const world = { canMoveTo: (x, y) => Math.abs(y) < 0.001 };
  withState(
    basePatch({
      world,
      spatialBuckets: npcBucket([a, b, c]),
      player: { x: -1000, y: -1000, alive: false },
    }),
    () => {
      const result = moveUnit(
        a,
        { mx: 1, my: 0, ignorePlayer: true, ignoreNpcId: a.id },
        0.1
      );
      assertEqual(result.moved, true);
      assert(a.x > 0, 'pusher should advance');
      assert(b.x > 12, 'first ally should be pushed');
      assert(c.x > 24, 'second ally should be pushed');
      assert(Math.hypot(b.x - a.x, b.y - a.y) >= 10.99, 'A/B separation');
      assert(Math.hypot(c.x - b.x, c.y - b.y) >= 10.99, 'B/C separation');
    }
  );
});

test('movement: a blocked chain rolls every ally back', () => {
  const a = makeMovableUnit({
    id: 2,
    faction: Faction.RIVAL_1,
    rank: UnitRank.SOLDIER,
    bodyRadius: 11,
    speed: 100,
    x: 0,
    y: 0,
  });
  const b = {
    id: 3,
    faction: Faction.RIVAL_1,
    rank: UnitRank.SOLDIER,
    bodyRadius: 11,
    x: 12,
    y: 0,
  };
  const c = {
    id: 4,
    faction: Faction.RIVAL_1,
    rank: UnitRank.SOLDIER,
    bodyRadius: 11,
    x: 24,
    y: 0,
  };
  const world = { canMoveTo: (x, y) => Math.abs(y) < 0.001 && x <= 25 };
  withState(
    basePatch({
      world,
      spatialBuckets: npcBucket([a, b, c]),
      player: { x: -1000, y: -1000, alive: false },
    }),
    () => {
      const result = moveUnit(
        a,
        { mx: 1, my: 0, ignorePlayer: true, ignoreNpcId: a.id },
        0.1
      );
      assertEqual(result.moved, false);
      assertEqual(a.x, 0);
      assertEqual(b.x, 12);
      assertEqual(c.x, 24);
    }
  );
});

test('movement: boss mass pushes farther and resists pushes', () => {
  const world = { canMoveTo: (x, y) => Math.abs(y) < 0.001 };
  const bossPusher = makeMovableUnit({
    id: 2,
    faction: Faction.RIVAL_1,
    rank: UnitRank.BOSS,
    bodyRadius: 13.5,
    speed: 100,
    x: 0,
    y: 0,
  });
  const soldierAlly = {
    id: 3,
    faction: Faction.RIVAL_1,
    rank: UnitRank.SOLDIER,
    bodyRadius: 11,
    x: 12,
    y: 0,
  };
  let bossPush = 0;
  withState(
    basePatch({
      world,
      spatialBuckets: npcBucket([bossPusher, soldierAlly]),
      player: { x: -1000, y: -1000, alive: false },
    }),
    () => {
      moveUnit(
        bossPusher,
        { mx: 1, my: 0, ignorePlayer: true, ignoreNpcId: bossPusher.id },
        0.1
      );
      bossPush = soldierAlly.x - 12;
    }
  );

  const soldierPusher = makeMovableUnit({
    id: 2,
    faction: Faction.RIVAL_1,
    rank: UnitRank.SOLDIER,
    bodyRadius: 11,
    speed: 100,
    x: 0,
    y: 0,
  });
  const bossAlly = {
    id: 3,
    faction: Faction.RIVAL_1,
    rank: UnitRank.BOSS,
    bodyRadius: 13.5,
    x: 12,
    y: 0,
  };
  let bossResist = 0;
  withState(
    basePatch({
      world,
      spatialBuckets: npcBucket([soldierPusher, bossAlly]),
      player: { x: -1000, y: -1000, alive: false },
    }),
    () => {
      moveUnit(
        soldierPusher,
        { mx: 1, my: 0, ignorePlayer: true, ignoreNpcId: soldierPusher.id },
        0.1
      );
      bossResist = bossAlly.x - 12;
    }
  );

  assert(bossPush > 0, 'boss should push the soldier');
  assert(bossResist > 0, 'soldier should still move the boss');
  assert(bossPush > bossResist, `boss should push farther (${bossPush} vs ${bossResist})`);
});

test('movement: stale overlap cleanup separates friendly NPCs', () => {
  const a = {
    id: 2,
    faction: Faction.RIVAL_1,
    rank: UnitRank.SOLDIER,
    bodyRadius: 11,
    hp: 100,
    x: 0,
    y: 0,
  };
  const b = {
    id: 3,
    faction: Faction.RIVAL_1,
    rank: UnitRank.SOLDIER,
    bodyRadius: 11,
    hp: 100,
    x: 2,
    y: 0,
  };
  withState(
    basePatch({
      npcs: [a, b],
      spatialBuckets: npcBucket([a, b]),
      player: { x: -1000, y: -1000, alive: false },
      depenetrationTimer: 0,
    }),
    () => {
      const before = Math.hypot(b.x - a.x, b.y - a.y);
      separateStaleOverlaps(0.6);
      const after = Math.hypot(b.x - a.x, b.y - a.y);
      assert(after > before, `stale overlap should separate (${before} -> ${after})`);
    }
  );
});

test('movement: depenetration never moves a human boss', () => {
  const humanBoss = {
    id: 4,
    faction: Faction.RIVAL_1,
    rank: UnitRank.BOSS,
    bodyRadius: 13.5,
    hp: 100,
    humanPeerId: 'peer-1',
    x: 0,
    y: 0,
  };
  const ally = {
    id: 5,
    faction: Faction.RIVAL_1,
    rank: UnitRank.SOLDIER,
    bodyRadius: 11,
    hp: 100,
    x: 2,
    y: 0,
  };
  withState(
    basePatch({
      npcs: [humanBoss, ally],
      spatialBuckets: npcBucket([humanBoss, ally]),
      player: { x: -1000, y: -1000, alive: false },
      depenetrationTimer: 0,
    }),
    () => {
      separateStaleOverlaps(0.6);
      assertEqual(humanBoss.x, 0, 'human boss must stay put');
      assert(ally.x > 2, 'NPC should be pushed out of the human boss space');
    }
  );
});

test('movement: human-controlled bosses are not pushed by allies', () => {
  const mover = makeMovableUnit({
    id: 2,
    faction: Faction.RIVAL_1,
    rank: UnitRank.SOLDIER,
    bodyRadius: 11,
    speed: 100,
    x: 20,
    y: 0,
  });
  const humanBoss = {
    id: 4,
    faction: Faction.RIVAL_1,
    rank: UnitRank.BOSS,
    bodyRadius: 13.5,
    x: 0,
    y: 0,
    humanPeerId: 'peer-1',
  };
  withState(
    basePatch({
      spatialBuckets: npcBucket([mover, humanBoss]),
      player: { x: -1000, y: -1000, alive: false },
    }),
    () => {
      const result = moveUnit(
        mover,
        { mx: -1, my: 0, ignorePlayer: true, ignoreNpcId: mover.id },
        0.1
      );
      assertEqual(result.moved, false);
      assertEqual(humanBoss.x, 0, 'human-controlled boss must not be pushed');
    }
  );
});

test('movement: moveUnit applies base speed, sprint and body radius to the boss', () => {
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

test('movement: idle moveUnit skips push and collision scans', () => {
  const unit = makeMovableUnit({
    id: 2,
    faction: Faction.RIVAL_1,
    rank: UnitRank.SOLDIER,
    bodyRadius: 11,
    speed: 150,
  });
  const ally = {
    id: 3,
    faction: Faction.RIVAL_1,
    rank: UnitRank.SOLDIER,
    bodyRadius: 11,
    x: 0,
    y: 0,
  };
  perf.enabled = true;
  perf.reset();
  try {
    withState(
      basePatch({
        spatialBuckets: npcBucket([ally]),
        player: { x: -1000, y: -1000, alive: false },
      }),
      () => {
        moveUnit(unit, { mx: 0, my: 0 }, 0.1);
      }
    );
    const snapshot = perf.snapshot();
    assertEqual(snapshot.moveUnitIdle, 1);
    assertEqual(snapshot.pushChecks || 0, 0);
    assertEqual(snapshot.collisionChecks || 0, 0);
  } finally {
    perf.enabled = false;
    perf.reset();
  }
});

test('movement: generated chunks cache car collision rects', () => {
  const map = new CityMap({
    seed: 4242,
    gridSize: 15,
    incomeTier: 'HIGH',
    activeFactions: [Faction.PLAYER],
  });
  let found = null;
  for (let cy = 0; cy < 5 && !found; cy++) {
    for (let cx = 0; cx < 5 && !found; cx++) {
      const chunk = map.generateChunk(cx, cy);
      for (let ly = 0; ly < chunk.props.length && !found; ly++) {
        for (let lx = 0; lx < chunk.props[ly].length; lx++) {
          if (chunk.props[ly][lx] === PropType.CAR) {
            found = { chunk, ly, lx };
            break;
          }
        }
      }
    }
  }
  assert(found, 'generated chunks should contain a car');
  const rect = found.chunk.propRects[found.ly][found.lx];
  assert(rect, 'car tile should have a cached collision rect');
  assertEqual(
    map.canMoveTo(rect.x + rect.w / 2, rect.y + rect.h / 2, 11),
    false,
    'the cached car rect should still block movement'
  );
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
    basePatch({
      world,
      player: { x: -1000, y: -1000, alive: false },
      spatialBuckets: new Map(),
      tickDuration: 10,
    }),
    () => {
      updateHumanControlledRivalBoss(boss, 5);
      assertEqual(world.chunks.get('0,0').capturingFaction, Faction.RIVAL_1);
      assertEqual(world.chunks.get('0,0').captureProgress, 0.5);
      updateHumanControlledRivalBoss(boss, 5);
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
    canMoveTo: (wx, wy) => !blocked.has(`${Math.floor(wx / TILE_SIZE)},${Math.floor(wy / TILE_SIZE)}`),
    isTileNavigable: (gx, gy) => !blocked.has(`${gx},${gy}`),
    findNearestWalkablePoint: (wx, wy) => ({ x: wx, y: wy }),
    worldToTile: (wx, wy) => {
      const gx = Math.floor(wx / TILE_SIZE);
      const gy = Math.floor(wy / TILE_SIZE);
      return { cx: Math.floor(gx / 15), cy: Math.floor(gy / 15), lx: gx % 15, ly: gy % 15 };
    },
    getChunk: () => chunk,
    chunks: new Map([['0,0', chunk]]),
  };
  const boss = makeRemoteBoss({ x: 2.5 * TILE_SIZE, y: 5.5 * TILE_SIZE, targetX: 10.5 * TILE_SIZE, targetY: 5.5 * TILE_SIZE });
  withState(
    basePatch({ world, player: { x: -1000, y: -1000, alive: false }, spatialBuckets: new Map() }),
    () => {
      let detoured = false;
      for (let i = 0; i < 400; i++) {
        updateHumanControlledRivalBoss(boss, 0.05);
        if (boss.y > 400) detoured = true;
      }
      assert(detoured, 'boss should detour through the wall gap (y around 462)');
      const dist = Math.hypot(10.5 * TILE_SIZE - boss.x, 5.5 * TILE_SIZE - boss.y);
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

test('movement: walk state advances only while the unit actually moves', () => {
  const unit = {
    x: 100,
    y: 100,
    speed: 100,
    bodyRadius: 11,
    rank: UnitRank.SOLDIER,
    faction: Faction.RIVAL_1,
    sprintCooldown: 0,
    sprintTimer: 0,
  };
  withState(basePatch(), () => {
    const moved = moveUnit(unit, { mx: 1, my: 0 }, 0.1);
    assert(moved.moved, 'unit should move');
    assertEqual(unit.isMoving, true);
    assert(unit.walkPhase > 0, `walkPhase should advance, got ${unit.walkPhase}`);
    const phase = unit.walkPhase;

    moveUnit(unit, { mx: 0, my: 0 }, 0.1);
    assertEqual(unit.isMoving, false);
    assertEqual(unit.walkPhase, phase, 'idle units must not advance their walk phase');
  });
});

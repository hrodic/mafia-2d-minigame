// Movement/collision helper tests: entity radii, occupancy rules, friendly pushing
// and NPC boss sprint state.
import { test, assert, assertEqual } from './harness.js';
import { Faction, UnitRank } from '../src/config/enums.js';
import { CHUNK_PX, SPRINT_COOLDOWN_DURATION, SPRINT_MAX_DURATION } from '../src/config/constants.js';
import { state } from '../src/core/state.js';
import { packChunkKey } from '../src/world/city.js';
import {
  getEntityCollisionRadius,
  canOccupyPosition,
  isPushingFriendly,
  updateNpcBossSprint,
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

test('movement: NPC sprint drains, triggers cooldown and returns the multiplier', () => {
  const boss = { sprintCooldown: 0, sprintTimer: 0, isSprinting: false };
  assertEqual(updateNpcBossSprint(boss, true, SPRINT_MAX_DURATION * 0.5), 1.6);
  assertEqual(boss.isSprinting, true);
  assertEqual(updateNpcBossSprint(boss, true, SPRINT_MAX_DURATION * 0.5), 1.0);
  assertEqual(boss.isSprinting, false);
  assertEqual(boss.sprintTimer, 0);
  assertEqual(boss.sprintCooldown, SPRINT_COOLDOWN_DURATION);
  assertEqual(updateNpcBossSprint(boss, false, 1), 1.0);
  assertEqual(boss.sprintCooldown, SPRINT_COOLDOWN_DURATION - 1);
});

test('movement: releasing sprint early converts remaining burst into cooldown', () => {
  const boss = { sprintCooldown: 0, sprintTimer: 0, isSprinting: false };
  updateNpcBossSprint(boss, true, 1);
  assertEqual(boss.isSprinting, true);
  updateNpcBossSprint(boss, false, 0.1);
  assertEqual(boss.isSprinting, false);
  assertEqual(boss.sprintTimer, 0);
  assertEqual(boss.sprintCooldown, SPRINT_COOLDOWN_DURATION * 0.5);
});

test('movement: standing still never starts a cooldown', () => {
  const boss = { sprintCooldown: 0, sprintTimer: 0, isSprinting: false };
  assertEqual(updateNpcBossSprint(boss, false, 1), 1.0);
  assertEqual(boss.sprintCooldown, 0);
  assertEqual(boss.isSprinting, false);
});

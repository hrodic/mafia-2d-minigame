// State module tests: initial match state shape + local faction/boss selectors.
// The state object is a singleton; tests save/restore the fields they mutate.
import { test, assert, assertEqual, assertDeepEqual } from './harness.js';
import { Faction, UnitRank } from '../src/config/enums.js';
import { BOSS_MAX_HP, MAX_BOSS_ARMOR } from '../src/config/balance.js';
import { DEFAULT_GRID_SIZE, DEFAULT_TICK_DURATION } from '../src/config/constants.js';
import {
  state,
  getLocalFaction,
  getLocalBoss,
  isLocalBossAlive,
} from '../src/core/state.js';

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

test('state: world starts empty and is assigned later by the game', () => {
  assert(state.world === null || typeof state.world === 'object');
});

test('state: treasuries and factionAlive are initialized for all 4 slots', () => {
  for (const faction of [Faction.PLAYER, Faction.RIVAL_1, Faction.RIVAL_2, Faction.RIVAL_3]) {
    assertEqual(state.treasuries[faction], 3000);
    assertEqual(state.factionAlive[faction], true);
  }
});

test('state: player boss starts at full health with correct base stats', () => {
  assertEqual(state.player.hp, BOSS_MAX_HP);
  assertEqual(state.player.maxHp, BOSS_MAX_HP);
  assertEqual(state.player.armor, 0);
  assertEqual(state.player.maxArmor, MAX_BOSS_ARMOR);
  assertEqual(state.player.speed, 225);
  assertEqual(state.player.minDmg, 20);
  assertEqual(state.player.maxDmg, 40);
  assertEqual(state.player.alive, true);
});

test('state: camera starts on the player and mouse is outside', () => {
  assertEqual(state.camera.x, state.player.x);
  assertEqual(state.camera.y, state.player.y);
  assertEqual(state.mouse.inside, false);
});

test('state: collections and match flags have the expected initial values', () => {
  assert(Array.isArray(state.npcs));
  assertEqual(state.npcs.length, 0);
  assert(Array.isArray(state.floatingTexts));
  assert(state.spatialBuckets instanceof Map);
  assert(Array.isArray(state.bucketPool));
  assert(state.keys instanceof Set);
  assertEqual(state.gameStarted, false);
  assertEqual(state.gameOver, false);
  assertEqual(state.victoryShown, false);
  assertEqual(state.gameHour, 12);
  assertEqual(state.tickTimer, 0);
  assertEqual(state.nextNpcId, 1);
  assertEqual(state.currentGridSize, DEFAULT_GRID_SIZE);
  assertEqual(state.tickDuration, DEFAULT_TICK_DURATION);
  assertEqual(state.currentIncomeTier, 'HIGH');
  assertEqual(state.activeFactionCount, 4);
  assertDeepEqual(state.activeFactions, [Faction.PLAYER, Faction.RIVAL_1, Faction.RIVAL_2, Faction.RIVAL_3]);
});

test('state: spawn caps and recruitment prefs are initialized', () => {
  assertEqual(state.playerSpawnCaps[UnitRank.SOLDIER], 96);
  assertEqual(state.playerSpawnCaps[UnitRank.CAPTAIN], 11);
  assertEqual(state.playerSpawnCaps[UnitRank.UNDERBOSS], 6);
  for (const faction of [Faction.PLAYER, Faction.RIVAL_1, Faction.RIVAL_2, Faction.RIVAL_3]) {
    assert(state.factionRecruitmentPrefs[faction], `missing prefs for ${faction}`);
  }
});

test('state: getLocalFaction defaults to PLAYER without an active net layer', () => {
  withState({ net: null }, () => {
    assertEqual(getLocalFaction(), Faction.PLAYER);
  });
  withState({ net: { isActive: () => false, localFaction: Faction.RIVAL_2 } }, () => {
    assertEqual(getLocalFaction(), Faction.PLAYER);
  });
});

test('state: getLocalFaction follows an active net layer', () => {
  withState({ net: { isActive: () => true, localFaction: Faction.RIVAL_1 } }, () => {
    assertEqual(getLocalFaction(), Faction.RIVAL_1);
  });
});

test('state: getLocalBoss returns the player for the PLAYER faction', () => {
  withState({ net: null }, () => {
    assert(getLocalBoss() === state.player);
  });
});

test('state: getLocalBoss finds the rival boss NPC', () => {
  const bossNpc = { id: 77, faction: Faction.RIVAL_2, rank: UnitRank.BOSS, x: 10, y: 20 };
  withState({ net: null, npcs: [bossNpc] }, () => {
    assertEqual(getLocalFaction(), Faction.PLAYER);
    withState({ net: { isActive: () => true, localFaction: Faction.RIVAL_2 } }, () => {
      assert(getLocalBoss() === bossNpc);
    });
  });
});

test('state: getLocalBoss falls back to a dead boss placeholder at the camera', () => {
  withState({ net: null, npcs: [] }, () => {
    withState({ net: { isActive: () => true, localFaction: Faction.RIVAL_3 } }, () => {
      const fallback = getLocalBoss();
      assert(fallback !== state.player);
      assertEqual(fallback.x, state.camera.x);
      assertEqual(fallback.y, state.camera.y);
      assertEqual(fallback.hp, 0);
      assertEqual(fallback.maxHp, BOSS_MAX_HP);
      assertEqual(fallback.maxArmor, MAX_BOSS_ARMOR);
      assertEqual(fallback.alive, false);
    });
  });
});

test('state: isLocalBossAlive tracks the player flag for PLAYER', () => {
  withState({ net: null, player: { ...state.player, alive: true } }, () => {
    assertEqual(isLocalBossAlive(), true);
  });
  withState({ net: null, player: { ...state.player, alive: false } }, () => {
    assertEqual(isLocalBossAlive(), false);
  });
});

test('state: isLocalBossAlive requires faction alive AND a boss NPC for rivals', () => {
  const bossNpc = { id: 1, faction: Faction.RIVAL_1, rank: UnitRank.BOSS };
  const net = { isActive: () => true, localFaction: Faction.RIVAL_1 };
  withState({ net, npcs: [bossNpc], factionAlive: { ...state.factionAlive, [Faction.RIVAL_1]: true } }, () => {
    assertEqual(isLocalBossAlive(), true);
  });
  withState({ net, npcs: [], factionAlive: { ...state.factionAlive, [Faction.RIVAL_1]: true } }, () => {
    assertEqual(isLocalBossAlive(), false);
  });
  withState({ net, npcs: [bossNpc], factionAlive: { ...state.factionAlive, [Faction.RIVAL_1]: false } }, () => {
    assertEqual(isLocalBossAlive(), false);
  });
});

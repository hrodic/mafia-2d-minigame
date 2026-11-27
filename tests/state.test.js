// State module tests: initial match state shape + local faction/boss selectors.
// The state object is a singleton; tests save/restore the fields they mutate.
import { test, assert, assertEqual, assertDeepEqual } from './harness.js';
import { Faction, UnitRank } from '../src/config/enums.js';
import { BOSS_MAX_HP, MAX_BOSS_ARMOR, RANK_STATS } from '../src/config/balance.js';
import { DEFAULT_GRID_SIZE, DEFAULT_TICK_DURATION, TILE_SIZE } from '../src/config/constants.js';
import {
  state,
  createGameState,
  forEachUnit,
  getUnitById,
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
  assertEqual(state.player.speed, 140);
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
  assertEqual(state.gameHour, 19);
  assertEqual(state.tickTimer, 0);
  assertEqual(state.nextNpcId, 1);
  assertEqual(state.currentGridSize, DEFAULT_GRID_SIZE);
  assertEqual(state.tickDuration, DEFAULT_TICK_DURATION);
  assertEqual(state.currentIncomeTier, 'HIGH');
  assertEqual(state.activeFactionCount, 4);
  assertDeepEqual(state.activeFactions, [Faction.PLAYER, Faction.RIVAL_1, Faction.RIVAL_2, Faction.RIVAL_3]);
});

test('state: match unit caps are clamped between tier minimums and the grid ceiling', () => {
  const fresh = createGameState({
    gridSize: 10,
    unitCaps: { maxSoldiers: 80, maxCaptains: 99, maxUnderbosses: 4 },
  });
  assertDeepEqual(fresh.matchUnitCaps, {
    maxSoldiers: 80,
    maxCaptains: 20,
    maxUnderbosses: 4,
  });
  assertEqual(fresh.playerSpawnCaps[UnitRank.SOLDIER], 40);
  assertEqual(fresh.playerSpawnCaps[UnitRank.CAPTAIN], 10);
  assertEqual(fresh.playerSpawnCaps[UnitRank.UNDERBOSS], 2);
});

test('state: spawn caps and recruitment prefs are initialized', () => {
  assertEqual(state.playerSpawnCaps[UnitRank.SOLDIER], 75);
  assertEqual(state.playerSpawnCaps[UnitRank.CAPTAIN], 15);
  assertEqual(state.playerSpawnCaps[UnitRank.UNDERBOSS], 8);
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

test('state: getLocalBoss reuses the dead-boss placeholder at the camera', () => {
  withState(
    {
      net: { isActive: () => true, localFaction: Faction.RIVAL_3 },
      npcs: [],
      camera: { x: 12, y: 34 },
    },
    () => {
      const first = getLocalBoss();
      const second = getLocalBoss();
      assert(first === second, 'dead-boss placeholder must not allocate per call');
      assertEqual(first.x, 12);
      assertEqual(first.y, 34);

      state.camera.x = 99;
      state.camera.y = 88;
      const third = getLocalBoss();
      assert(third === first);
      assertEqual(third.x, 99);
      assertEqual(third.y, 88);
    }
  );
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

// --- createGameState: match reset factory ----------------------------------

test('state factory: fresh default state matches the exported initial values', () => {
  const fresh = createGameState();
  assert(fresh !== state, 'factory must return a new object');
  assertEqual(fresh.world, null);
  assertEqual(fresh.net, null);
  assertEqual(fresh.npcs.length, 0);
  assertEqual(fresh.floatingTexts.length, 0);
  assert(fresh.spatialBuckets instanceof Map);
  assertEqual(fresh.spatialBuckets.size, 0);
  assert(Array.isArray(fresh.bucketPool));
  assertEqual(fresh.bucketPool.length, 0);
  assertEqual(fresh.nextNpcId, 1);
  assertEqual(fresh.astarBudgetThisFrame, 0);
  assertEqual(fresh.gameStarted, false);
  assertEqual(fresh.isSpectating, false);
  assertEqual(fresh.gameOver, false);
  assertEqual(fresh.victoryShown, false);
  assertEqual(fresh.tickTimer, 0);
  assertEqual(fresh.gameHour, 19);
  assertEqual(fresh.hudUpdateTimer, 0);
  assertEqual(fresh.minimapCacheTimer, 1.0);
  assertEqual(fresh.currentGridSize, DEFAULT_GRID_SIZE);
  assertEqual(fresh.tickDuration, DEFAULT_TICK_DURATION);
  assertEqual(fresh.currentIncomeTier, 'HIGH');
  assertEqual(fresh.currentWorldSeed, null);
  assertEqual(fresh.activeFactionCount, 4);
  assertDeepEqual(fresh.activeFactions, [
    Faction.PLAYER,
    Faction.RIVAL_1,
    Faction.RIVAL_2,
    Faction.RIVAL_3,
  ]);
  assertDeepEqual(fresh.selectedFactionOrgs, ['COSA_NOSTRA', 'BRATVA', 'TRIADS', 'CARTEL']);
});

test('state factory: exported singleton is built from the same field set', () => {
  const fresh = createGameState();
  assertDeepEqual(Object.keys(fresh).sort(), Object.keys(state).sort());
  assertDeepEqual(Object.keys(fresh.player).sort(), Object.keys(state.player).sort());
});

test('state: the player is not stored in the NPC collection', () => {
  const fresh = createGameState();
  assert(!fresh.npcs.includes(fresh.player));
});

test('state: forEachUnit visits the living player then NPCs, skipping a dead player', () => {
  const player = { ...createGameState().player };
  const npcA = { id: 1 };
  const npcB = { id: 2 };

  withState({ player, npcs: [npcA, npcB] }, () => {
    const seen = [];
    forEachUnit((unit) => seen.push(unit.id));
    assertDeepEqual(seen, [0, 1, 2]);
  });

  withState({ player: { ...player, alive: false }, npcs: [npcA] }, () => {
    const seen = [];
    forEachUnit((unit) => seen.push(unit.id));
    assertDeepEqual(seen, [1]);
  });
});

test('state: getUnitById resolves the player id 0, NPCs and misses', () => {
  const npc = { id: 7 };
  withState({ player: { ...createGameState().player }, npcs: [npc] }, () => {
    assert(getUnitById(0) === state.player);
    assert(getUnitById(7) === npc);
    assertEqual(getUnitById(99), null);
  });
});

test('state factory: player carries the boss unit identity fields', () => {
  const fresh = createGameState();
  assertEqual(fresh.player.id, 0);
  assertEqual(fresh.player.faction, Faction.PLAYER);
  assertEqual(fresh.player.rank, UnitRank.BOSS);
  assertEqual(fresh.player.control, 'local');
  assertEqual(fresh.player.bodyRadius, RANK_STATS[UnitRank.BOSS].radius);
  assert(fresh.player.id < fresh.nextNpcId, 'player id must not collide with the NPC id counter');
});

test('state factory: player combat stats derive from the boss rank row', () => {
  const fresh = createGameState();
  const boss = RANK_STATS[UnitRank.BOSS];
  assertEqual(fresh.player.speed, boss.speedHuman);
  assertEqual(fresh.player.hp, boss.hp);
  assertEqual(fresh.player.maxHp, boss.hp);
  assertEqual(fresh.player.armor, boss.startArmor);
  assertEqual(fresh.player.maxArmor, boss.maxArmor);
  assertEqual(fresh.player.minDmg, boss.minDmg);
  assertEqual(fresh.player.maxDmg, boss.maxDmg);
  assertEqual(fresh.player.bodyRadius, boss.radius);
});

test('state factory: default player is at full health in the top-left corner', () => {
  const fresh = createGameState({ autoStart: true });
  assertEqual(fresh.gameStarted, true);
  assertEqual(fresh.player.x, 1.5 * TILE_SIZE);
  assertEqual(fresh.player.y, 1.5 * TILE_SIZE);
  assertEqual(fresh.player.hp, BOSS_MAX_HP);
  assertEqual(fresh.player.maxHp, BOSS_MAX_HP);
  assertEqual(fresh.player.armor, 0);
  assertEqual(fresh.player.maxArmor, MAX_BOSS_ARMOR);
  assertEqual(fresh.player.alive, true);
  assertEqual(fresh.player.targetX, null);
  assertEqual(fresh.player.targetY, null);
  assertEqual(fresh.player.path, null);
  assertEqual(fresh.player.pathTimer, 0);
  assertEqual(fresh.player.attackCooldown, 0);
  assertEqual(fresh.player.slashAnimTimer, 0);
  assertEqual(fresh.player.muzzleFlashTimer, 0);
  assertEqual(fresh.player.hitFlashTimer, 0);
  assertEqual(fresh.player.sprintTimer, 0);
  assertEqual(fresh.player.sprintCooldown, 0);
  assertEqual(fresh.player.isSprinting, false);
  assertEqual(fresh.camera.x, fresh.player.x);
  assertEqual(fresh.camera.y, fresh.player.y);
  assertEqual(fresh.mouse.inside, false);
  assertEqual(fresh.keys.size, 0);
});

test('state factory: applies and clamps match configuration', () => {
  const fresh = createGameState({
    gridSize: 100,
    tickDuration: 1,
    incomeTier: 'ULTRA',
    factionCount: 2,
    orgRoster: ['BRATVA', 'BRATVA', 'NOPE', 'CARTEL'],
    seed: 4242,
    autoStart: true,
  });
  assertEqual(fresh.currentGridSize, 25);
  assertEqual(fresh.tickDuration, 10);
  assertEqual(fresh.currentIncomeTier, 'HIGH');
  assertEqual(fresh.activeFactionCount, 2);
  assertDeepEqual(fresh.activeFactions, [Faction.PLAYER, Faction.RIVAL_3]);
  assertDeepEqual(fresh.selectedFactionOrgs, ['BRATVA', 'COSA_NOSTRA', 'YAKUZA', 'CARTEL']);
  assertEqual(fresh.currentWorldSeed, 4242);
  assertEqual(fresh.gameStarted, true);
});

test('state factory: active factions get cash and inactive slots are zeroed', () => {
  const fresh = createGameState({ factionCount: 2, orgRoster: ['COSA_NOSTRA', 'BRATVA'] });
  assertEqual(fresh.treasuries[Faction.PLAYER], 3000);
  assertEqual(fresh.treasuries[Faction.RIVAL_3], 3000);
  assertEqual(fresh.treasuries[Faction.RIVAL_1], 0);
  assertEqual(fresh.treasuries[Faction.RIVAL_2], 0);
  assertEqual(fresh.factionAlive[Faction.PLAYER], true);
  assertEqual(fresh.factionAlive[Faction.RIVAL_3], true);
  assertEqual(fresh.factionAlive[Faction.RIVAL_1], false);
  assertEqual(fresh.factionAlive[Faction.RIVAL_2], false);
  for (const faction of [Faction.PLAYER, Faction.RIVAL_1, Faction.RIVAL_2, Faction.RIVAL_3]) {
    assertEqual(fresh.factionKills[faction], 0);
  }
});

test('state factory: caps and recruitment preferences reset to defaults', () => {
  const fresh = createGameState();
  assertEqual(fresh.playerSpawnCaps[UnitRank.SOLDIER], 75);
  assertEqual(fresh.playerSpawnCaps[UnitRank.CAPTAIN], 15);
  assertEqual(fresh.playerSpawnCaps[UnitRank.UNDERBOSS], 8);
  for (const faction of [Faction.PLAYER, Faction.RIVAL_1, Faction.RIVAL_2, Faction.RIVAL_3]) {
    const prefs = fresh.factionRecruitmentPrefs[faction];
    assert(prefs, `missing prefs for ${faction}`);
    assertEqual(prefs.autoSoldier, true);
    assertEqual(prefs.autoCaptain, true);
    assertEqual(prefs.autoUnderboss, true);
  }
  assertEqual(fresh.autoRecruitSoldier, true);
  assertEqual(fresh.autoRecruitCaptain, true);
  assertEqual(fresh.autoRecruitUnderboss, true);
});

test('state factory: each call returns independent nested containers', () => {
  const first = createGameState();
  const second = createGameState();
  assert(first.npcs !== second.npcs);
  assert(first.floatingTexts !== second.floatingTexts);
  assert(first.spatialBuckets !== second.spatialBuckets);
  assert(first.bucketPool !== second.bucketPool);
  assert(first.treasuries !== second.treasuries);
  assert(first.factionAlive !== second.factionAlive);
  assert(first.factionKills !== second.factionKills);
  assert(first.player !== second.player);
  assert(first.camera !== second.camera);
  assert(first.mouse !== second.mouse);
  assert(first.keys !== second.keys);
  assert(first.playerSpawnCaps !== second.playerSpawnCaps);
  assert(first.factionRecruitmentPrefs !== second.factionRecruitmentPrefs);

  first.treasuries[Faction.PLAYER] = 1;
  first.player.hp = 1;
  first.npcs.push({ id: 1 });
  first.keys.add('w');
  assertEqual(second.treasuries[Faction.PLAYER], 3000);
  assertEqual(second.player.hp, BOSS_MAX_HP);
  assertEqual(second.npcs.length, 0);
  assertEqual(second.keys.size, 0);
});

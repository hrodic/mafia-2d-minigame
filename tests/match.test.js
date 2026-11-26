// Match setup tests: initWorld configuration, resets, factions and boss spawning.
import { test, assert, assertEqual, assertDeepEqual } from './harness.js';
import { Faction, UnitRank } from '../src/config/enums.js';
import { INCOME_TIERS } from '../src/config/balance.js';
import { FACTION_META, ORGANIZATIONS } from '../src/config/organizations.js';
import { state } from '../src/core/state.js';
import { on } from '../src/core/events.js';
import { resetEffects } from '../src/render/effects.js';
import { CityMap } from '../src/world/city.js';
import { initWorld } from '../src/sim/match.js';

const STATE_KEYS = [
  'world',
  'npcs',
  'spatialBuckets',
  'gameStarted',
  'isSpectating',
  'gameOver',
  'victoryShown',
  'tickTimer',
  'hudUpdateTimer',
  'minimapCacheTimer',
  'gameHour',
  'nextNpcId',
  'currentWorldSeed',
  'currentGridSize',
  'tickDuration',
  'currentIncomeTier',
  'activeFactionCount',
  'selectedFactionOrgs',
  'activeFactions',
  'treasuries',
  'factionAlive',
  'factionKills',
  'playerSpawnCaps',
  'factionRecruitmentPrefs',
  'player',
  'camera',
  'net',
  'floatingTexts',
  'bucketPool',
  'keys',
  'mouse',
  'sprintButtonHeld',
];

function withMatchState(fn) {
  const saved = {};
  for (const key of STATE_KEYS) saved[key] = state[key];
  const savedMeta = {};
  for (const faction of [Faction.PLAYER, Faction.RIVAL_1, Faction.RIVAL_2, Faction.RIVAL_3]) {
    savedMeta[faction] = state.factionAlive ? { ...FACTION_META[faction] } : null;
  }

  state.world = new CityMap();
  state.npcs = [];
  state.spatialBuckets = new Map();
  state.floatingTexts = [];
  state.net = null;
  state.player = { ...saved.player };
  state.treasuries = { ...saved.treasuries };
  state.factionAlive = { ...saved.factionAlive };
  state.playerSpawnCaps = { ...saved.playerSpawnCaps };
  state.factionRecruitmentPrefs = JSON.parse(JSON.stringify(saved.factionRecruitmentPrefs));

  const events = [];
  const unsubscribers = [
    on('match:initialized', (payload) => events.push({ type: 'match:initialized', payload })),
    // Mirror production wiring so the effects-reset assertion stays meaningful.
    on('match:initialized', resetEffects),
  ];

  try {
    return fn({ events });
  } finally {
    for (const unsubscribe of unsubscribers) unsubscribe();
    for (const key of STATE_KEYS) state[key] = saved[key];
    for (const faction of Object.keys(savedMeta)) {
      if (savedMeta[faction]) FACTION_META[faction] = savedMeta[faction];
    }
  }
}

test('match: initWorld configures a 2-faction 5x5 match deterministically', () => {
  withMatchState(({ events }) => {
    initWorld(5, false, 12, 'LOW', 2, ['COSA_NOSTRA', 'BRATVA'], 12345);

    assertEqual(state.currentGridSize, 5);
    assertEqual(state.tickDuration, 12);
    assertEqual(state.currentIncomeTier, 'LOW');
    assertEqual(state.activeFactionCount, 2);
    assertDeepEqual(state.activeFactions, [Faction.PLAYER, Faction.RIVAL_3]);
    assertEqual(state.currentWorldSeed, 12345);
    assertEqual(state.world.chunks.size, 25);
    assertEqual(state.world.generation.seed, 12345);
    assertEqual(state.world.generation.gridSize, 5);
    assertEqual(state.world.generation.incomeTier, 'LOW');

    assertEqual(FACTION_META[Faction.PLAYER].id, 'COSA_NOSTRA');
    assertEqual(FACTION_META[Faction.RIVAL_3].id, 'BRATVA');
    assertEqual(FACTION_META[Faction.PLAYER].name, ORGANIZATIONS.COSA_NOSTRA.name);
    assertEqual(FACTION_META[Faction.RIVAL_3].name, ORGANIZATIONS.BRATVA.name);

    const started = events.filter((entry) => entry.type === 'match:initialized');
    assertEqual(started.length, 1);
    assertEqual(started[0].payload.tickDuration, 12);
    assertEqual(started[0].payload.worldSeed, 12345);
  });
});

test('match: active factions get starting cash, inactive slots are dead', () => {
  withMatchState(() => {
    initWorld(5, false, 10, 'HIGH', 2, ['YAKUZA', 'TRIADS'], 7);
    assertEqual(state.treasuries[Faction.PLAYER], 3000);
    assertEqual(state.treasuries[Faction.RIVAL_3], 3000);
    assertEqual(state.treasuries[Faction.RIVAL_1], 0);
    assertEqual(state.treasuries[Faction.RIVAL_2], 0);
    assertEqual(state.factionAlive[Faction.PLAYER], true);
    assertEqual(state.factionAlive[Faction.RIVAL_3], true);
    assertEqual(state.factionAlive[Faction.RIVAL_1], false);
    assertEqual(state.factionAlive[Faction.RIVAL_2], false);
  });
});

test('match: the player boss is reset and spawns at the top-left corner', () => {
  withMatchState(() => {
    initWorld(5, true, 10, 'HIGH', 4, ['COSA_NOSTRA', 'BRATVA', 'TRIADS', 'CARTEL'], 99);
    assertEqual(state.player.hp, 400);
    assertEqual(state.player.maxHp, 400);
    assertEqual(state.player.armor, 0);
    assertEqual(state.player.alive, true);
    assertEqual(state.player.attackCooldown, 0);
    assertEqual(state.player.x, 1.5 * 44);
    assertEqual(state.player.y, 1.5 * 44);
    assertEqual(state.gameStarted, true);
    assertEqual(state.gameOver, false);
    assertEqual(state.victoryShown, false);
    assertEqual(state.isSpectating, false);
    assertEqual(state.gameHour, 12);
    assertEqual(state.tickTimer, 0);
    assertEqual(state.nextNpcId, 1 + 3, 'three rival bosses should have spawned');
    assertEqual(state.camera.x, state.player.x);
    assertEqual(state.camera.y, state.player.y);
  });
});

test('match: every active rival gets exactly one boss at its corner', () => {
  withMatchState(() => {
    initWorld(5, false, 10, 'HIGH', 4, ['COSA_NOSTRA', 'BRATVA', 'TRIADS', 'CARTEL'], 31415);
    const bosses = state.npcs.filter((u) => u.rank === UnitRank.BOSS);
    assertEqual(bosses.length, 3);
    for (const faction of [Faction.RIVAL_1, Faction.RIVAL_2, Faction.RIVAL_3]) {
      const boss = bosses.find((u) => u.faction === faction);
      assert(boss, `missing boss for ${faction}`);
      assertEqual(boss.humanPeerId, null);
    }
  });
});

test('match: neighborhood income uses the selected tier', () => {
  withMatchState(() => {
    initWorld(5, false, 10, 'MID', 2, ['COSA_NOSTRA', 'BRATVA'], 2024);
    const tier = INCOME_TIERS.MID;
    for (const chunk of state.world.chunks.values()) {
      assert(
        chunk.income >= tier.min && chunk.income <= tier.max,
        `income ${chunk.income} outside ${tier.min}-${tier.max}`
      );
    }
  });
});

test('match: initWorld clears stale entities and effects', () => {
  withMatchState(() => {
    state.npcs.push({ id: 1 });
    state.floatingTexts.push({ text: 'old' });
    initWorld(5, false, 10, 'HIGH', 2, ['COSA_NOSTRA', 'BRATVA'], 5);
    assertEqual(state.npcs.length, 1); // the freshly spawned rival boss only
    assertEqual(state.floatingTexts.length, 0);
  });
});

test('match: initWorld preserves the imported state, world and net identities', () => {
  withMatchState(() => {
    const importedState = state;
    const world = state.world;
    const net = {
      isActive: () => true,
      isHost: () => true,
      isHumanFaction: () => false,
      getPeerForFaction: () => null,
    };
    state.net = net;

    initWorld(5, false, 10, 'HIGH', 2, ['COSA_NOSTRA', 'BRATVA'], 77);

    assert(state === importedState, 'exported state identity must be preserved');
    assert(state.world === world, 'CityMap instance must be preserved');
    assert(state.net === net, 'net bridge must be preserved');
    assert(!state.npcs.includes(state.player), 'player stays outside the NPC collection');
  });
});

test('match: initWorld resets stale flags, timers, economy, caps and player state', () => {
  withMatchState(() => {
    state.gameStarted = true;
    state.isSpectating = true;
    state.gameOver = true;
    state.victoryShown = true;
    state.tickTimer = 9;
    state.gameHour = 3;
    state.hudUpdateTimer = 4;
    state.minimapCacheTimer = 0.2;
    state.nextNpcId = 500;
    state.astarBudgetThisFrame = 12;
    state.treasuries[Faction.PLAYER] = 1;
    state.treasuries[Faction.RIVAL_3] = 2;
    state.factionAlive[Faction.PLAYER] = false;
    state.factionKills[Faction.PLAYER] = 7;
    state.playerSpawnCaps[UnitRank.SOLDIER] = 1;
    Object.assign(state.player, {
      x: -100,
      y: -100,
      targetX: 5,
      targetY: 6,
      path: [{ x: 1, y: 1 }],
      pathTimer: 3,
      hp: 1,
      maxHp: 1,
      armor: 2,
      armorCooldown: 4,
      sprintTimer: 5,
      sprintCooldown: 6,
      isSprinting: true,
      alive: false,
      attackCooldown: 7,
      slashAnimTimer: 8,
      muzzleFlashTimer: 9,
      hitFlashTimer: 10,
    });
    state.camera.x = -50;
    state.camera.y = -60;
    state.bucketPool = [...state.bucketPool, []];
    state.floatingTexts.push({ text: 'stale' });
    state.spatialBuckets.set('stale', []);
    state.keys = new Set(['w']);
    state.mouse = { screenX: 1, screenY: 2, inside: true };

    initWorld(5, false, 10, 'HIGH', 2, ['COSA_NOSTRA', 'BRATVA'], 123);

    assertEqual(state.gameStarted, false);
    assertEqual(state.isSpectating, false);
    assertEqual(state.gameOver, false);
    assertEqual(state.victoryShown, false);
    assertEqual(state.tickTimer, 0);
    assertEqual(state.gameHour, 12);
    assertEqual(state.hudUpdateTimer, 0);
    assertEqual(state.minimapCacheTimer, 1.0);
    assertEqual(state.nextNpcId, 1 + 1, 'one active rival boss should have spawned');
    assertEqual(state.astarBudgetThisFrame, 0);

    assertEqual(state.treasuries[Faction.PLAYER], 3000);
    assertEqual(state.treasuries[Faction.RIVAL_3], 3000);
    assertEqual(state.treasuries[Faction.RIVAL_1], 0);
    assertEqual(state.factionAlive[Faction.PLAYER], true);
    assertEqual(state.factionAlive[Faction.RIVAL_3], true);
    assertEqual(state.factionAlive[Faction.RIVAL_1], false);
    assertEqual(state.factionKills[Faction.PLAYER], 0);

    // 5x5 = 25 blocks: 22 soldiers, 2 captains, 1 underboss; human caps are 50%.
    assertEqual(state.playerSpawnCaps[UnitRank.SOLDIER], 11);
    assertEqual(state.playerSpawnCaps[UnitRank.CAPTAIN], 1);
    assertEqual(state.playerSpawnCaps[UnitRank.UNDERBOSS], 1);

    assertEqual(state.player.x, 1.5 * 44);
    assertEqual(state.player.y, 1.5 * 44);
    assertEqual(state.player.targetX, null);
    assertEqual(state.player.targetY, null);
    assertEqual(state.player.path, null);
    assertEqual(state.player.pathTimer, 0);
    assertEqual(state.player.hp, 400);
    assertEqual(state.player.maxHp, 400);
    assertEqual(state.player.armor, 0);
    assertEqual(state.player.armorCooldown, 0);
    assertEqual(state.player.sprintTimer, 0);
    assertEqual(state.player.sprintCooldown, 0);
    assertEqual(state.player.isSprinting, false);
    assertEqual(state.player.alive, true);
    assertEqual(state.player.attackCooldown, 0);
    assertEqual(state.player.slashAnimTimer, 0);
    assertEqual(state.player.muzzleFlashTimer, 0);
    assertEqual(state.player.hitFlashTimer, 0);

    assertEqual(state.floatingTexts.length, 0);
    assertEqual(state.bucketPool.length, 0);
    assertEqual(state.spatialBuckets.size, 0);
    assertEqual(state.keys.size, 0);
    assertEqual(state.mouse.inside, false);
  });
});

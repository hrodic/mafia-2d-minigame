// Tactical command layer tests: faction defaults, order codes, danger, threats,
// local focus and boss-aura hysteresis (headless).
import { test, assert, assertEqual, assertDeepEqual } from './harness.js';
import { Faction, UnitRank } from '../src/config/enums.js';
import { CHUNK_PX } from '../src/config/constants.js';
import {
  GLOBAL_STANCE,
  LOCAL_ORDER,
  createFactionTactics,
  isGlobalStance,
  isLocalOrder,
} from '../src/config/tactics.js';
import { state } from '../src/core/state.js';
import { packChunkKey } from '../src/world/city.js';
import {
  findLocalFocus,
  setGlobalStance,
  setLocalOrder,
  updateFactionTactics,
} from '../src/sim/tactics.js';

const STATE_KEYS = [
  'world',
  'player',
  'npcs',
  'spatialBuckets',
  'factionTactics',
  'activeFactions',
  'gameStarted',
  'tacticsTimer',
];

const ALL = [Faction.PLAYER, Faction.RIVAL_1, Faction.RIVAL_2, Faction.RIVAL_3];

function makeWorld(chunks = []) {
  const map = new Map();
  for (const chunk of chunks) map.set(packChunkKey(chunk.cx, chunk.cy), chunk);
  return { chunks: map };
}

function withTacticsState(opts, fn) {
  const saved = {};
  for (const key of STATE_KEYS) saved[key] = state[key];
  state.world = opts.world || makeWorld();
  state.player = opts.player || {
    id: 0,
    x: 5000,
    y: 5000,
    faction: Faction.PLAYER,
    alive: true,
    hp: 400,
    maxHp: 400,
  };
  state.npcs = opts.npcs || [];
  state.spatialBuckets = opts.buckets || new Map();
  state.activeFactions = opts.activeFactions || [Faction.RIVAL_1];
  state.factionTactics = {};
  for (const faction of ALL) state.factionTactics[faction] = createFactionTactics();
  state.gameStarted = true;
  state.tacticsTimer = opts.tacticsTimer || 0;
  try {
    return fn();
  } finally {
    for (const key of STATE_KEYS) state[key] = saved[key];
  }
}

function unit(overrides = {}) {
  return {
    id: 1,
    x: 100,
    y: 100,
    faction: Faction.RIVAL_1,
    rank: UnitRank.SOLDIER,
    hp: 10,
    maxHp: 10,
    ...overrides,
  };
}

test('tactics: defaults are Expand and Attack, and every faction starts there', () => {
  const fresh = createFactionTactics();
  assertEqual(fresh.globalStance, GLOBAL_STANCE.EXPAND);
  assertEqual(fresh.localOrder, LOCAL_ORDER.ATTACK);
  assertDeepEqual(fresh.threatenedChunks, []);
  assertEqual(fresh.bossInDanger, false);

  withTacticsState({}, () => {
    for (const faction of ALL) {
      assertEqual(state.factionTactics[faction].globalStance, GLOBAL_STANCE.EXPAND);
      assertEqual(state.factionTactics[faction].localOrder, LOCAL_ORDER.ATTACK);
    }
  });
});

test('tactics: order setters accept stable codes and reject anything else', () => {
  withTacticsState({}, () => {
    assert(setGlobalStance(Faction.PLAYER, GLOBAL_STANCE.DEFEND), 'defend accepted');
    assertEqual(state.factionTactics[Faction.PLAYER].globalStance, GLOBAL_STANCE.DEFEND);
    assert(setGlobalStance(Faction.PLAYER, GLOBAL_STANCE.EXPAND), 'expand accepted');
    assertEqual(state.factionTactics[Faction.PLAYER].globalStance, GLOBAL_STANCE.EXPAND);
    assert(!setGlobalStance(Faction.PLAYER, 9), 'unknown stance rejected');
    assert(!setGlobalStance('NOPE', GLOBAL_STANCE.DEFEND), 'unknown faction rejected');

    assert(setLocalOrder(Faction.PLAYER, LOCAL_ORDER.GUARD), 'guard accepted');
    assertEqual(state.factionTactics[Faction.PLAYER].localOrder, LOCAL_ORDER.GUARD);
    assert(setLocalOrder(Faction.PLAYER, LOCAL_ORDER.ATTACK), 'attack accepted');
    assert(!setLocalOrder(Faction.PLAYER, 0), 'unknown order rejected');
    assert(!setLocalOrder(Faction.PLAYER, 'guard'), 'string order rejected');

    assert(isGlobalStance(GLOBAL_STANCE.DEFEND));
    assert(isGlobalStance(GLOBAL_STANCE.EXPAND));
    assert(!isGlobalStance(0));
    assert(!isGlobalStance(3));
    assert(isLocalOrder(LOCAL_ORDER.GUARD));
    assert(isLocalOrder(LOCAL_ORDER.ATTACK));
    assert(!isLocalOrder(0));
    assert(!isLocalOrder(3));
  });
});

test('tactics: the refresh cadence is 250 ms', () => {
  const boss = unit({ id: 1, rank: UnitRank.BOSS, hp: 400, maxHp: 400 });
  const soldier = unit({ id: 2, x: boss.x + 470 });
  withTacticsState(
    {
      npcs: [boss, soldier],
      buckets: new Map([[packChunkKey(0, 0), [boss, soldier]]]),
    },
    () => {
      updateFactionTactics(0.1);
      assertEqual(soldier.inBossAura, undefined, 'no refresh before 250 ms');
      updateFactionTactics(0.15);
      assertEqual(soldier.inBossAura, true, 'exactly 250 ms refreshes the aura');
    }
  );
});

test('tactics: boss aura uses 480 px enter and 540 px exit hysteresis', () => {
  const boss = unit({ id: 1, rank: UnitRank.BOSS, hp: 400, maxHp: 400 });
  const soldier = unit({ id: 2, x: boss.x + 470 });
  withTacticsState(
    {
      npcs: [boss, soldier],
      buckets: new Map([[packChunkKey(0, 0), [boss, soldier]]]),
    },
    () => {
      updateFactionTactics(0.25);
      assertEqual(soldier.inBossAura, true, 'enters below 480 px');

      soldier.x = boss.x + 520;
      updateFactionTactics(0.25);
      assertEqual(soldier.inBossAura, true, 'stays inside up to 540 px');

      soldier.x = boss.x + 550;
      updateFactionTactics(0.25);
      assertEqual(soldier.inBossAura, false, 'leaves beyond 540 px');

      soldier.x = boss.x + 500;
      updateFactionTactics(0.25);
      assertEqual(soldier.inBossAura, false, 'does not re-enter between 480 and 540');
    }
  );
});

test('tactics: boss danger covers critical HP and outnumbering', () => {
  const criticalBoss = unit({ id: 1, rank: UnitRank.BOSS, hp: 100, maxHp: 400 });
  withTacticsState(
    {
      npcs: [criticalBoss],
      buckets: new Map([[packChunkKey(0, 0), [criticalBoss]]]),
    },
    () => {
      updateFactionTactics(0.25);
      assertEqual(state.factionTactics[Faction.RIVAL_1].bossInDanger, true);
    }
  );

  const healthyBoss = unit({ id: 1, rank: UnitRank.BOSS, hp: 400, maxHp: 400 });
  const enemies = [
    unit({ id: 2, x: 120, faction: Faction.RIVAL_2 }),
    unit({ id: 3, x: 130, faction: Faction.RIVAL_2 }),
    unit({ id: 4, x: 140, faction: Faction.RIVAL_2 }),
  ];
  const ally = unit({ id: 5, x: 90 });
  withTacticsState(
    {
      npcs: [healthyBoss, ...enemies, ally],
      buckets: new Map([[packChunkKey(0, 0), [healthyBoss, ...enemies, ally]]]),
    },
    () => {
      updateFactionTactics(0.25);
      assertEqual(state.factionTactics[Faction.RIVAL_1].bossInDanger, true);
    }
  );

  const allies = [unit({ id: 5, x: 90 }), unit({ id: 6, x: 80 }), unit({ id: 7, x: 70 })];
  withTacticsState(
    {
      npcs: [healthyBoss, ...enemies, ...allies],
      buckets: new Map([[packChunkKey(0, 0), [healthyBoss, ...enemies, ...allies]]]),
    },
    () => {
      updateFactionTactics(0.25);
      assertEqual(state.factionTactics[Faction.RIVAL_1].bossInDanger, false);
    }
  );
});

test('tactics: threatened chunks are owned chunks holding living enemies', () => {
  const boss = unit({ id: 1, rank: UnitRank.BOSS, hp: 400, maxHp: 400, x: 100, y: 100 });
  const enemy = unit({ id: 2, x: 200, y: 100, faction: Faction.RIVAL_2 });
  const threatenedOwned = { cx: 0, cy: 0, faction: Faction.RIVAL_1 };
  const calmOwned = { cx: 1, cy: 0, faction: Faction.RIVAL_1 };
  const foreignOwned = { cx: 2, cy: 0, faction: Faction.RIVAL_2 };
  withTacticsState(
    {
      world: makeWorld([threatenedOwned, calmOwned, foreignOwned]),
      npcs: [boss, enemy],
      buckets: new Map([[packChunkKey(0, 0), [boss, enemy]]]),
    },
    () => {
      updateFactionTactics(0.25);
      const record = state.factionTactics[Faction.RIVAL_1];
      assertEqual(record.threatenedChunks.length, 1);
      assertEqual(record.threatenedChunks[0], threatenedOwned);
    }
  );
});

test('tactics: local focus prefers the boss chunk, then the 360 px radius', () => {
  const boss = unit({ id: 1, rank: UnitRank.BOSS, hp: 400, maxHp: 400, x: 950, y: 100 });
  const sameChunk = unit({ id: 2, x: 100, y: 100, faction: Faction.RIVAL_2 });
  const nextChunk = unit({ id: 3, x: 1000, y: 100, faction: Faction.RIVAL_2 });
  withTacticsState(
    {
      npcs: [boss, sameChunk, nextChunk],
      buckets: new Map([
        [packChunkKey(0, 0), [boss, sameChunk]],
        [packChunkKey(1, 0), [nextChunk]],
      ]),
    },
    () => {
      assertEqual(findLocalFocus(boss), sameChunk.id, 'same-chunk enemy wins');
    }
  );

  withTacticsState(
    {
      npcs: [boss, nextChunk],
      buckets: new Map([
        [packChunkKey(0, 0), [boss]],
        [packChunkKey(1, 0), [nextChunk]],
      ]),
    },
    () => {
      assertEqual(findLocalFocus(boss), nextChunk.id, 'nearest enemy within 360 px');
    }
  );

  const far = unit({ id: 4, x: 4000, y: 4000, faction: Faction.RIVAL_2 });
  withTacticsState(
    {
      npcs: [boss, far],
      buckets: new Map([[packChunkKey(0, 0), [boss]]]),
    },
    () => {
      assertEqual(findLocalFocus(boss), null, 'no focus without a nearby enemy');
    }
  );
});

test('tactics: a missing boss clears danger and focus but keeps threatened turf', () => {
  const enemy = unit({ id: 2, x: 200, y: 100, faction: Faction.RIVAL_2 });
  const owned = { cx: 0, cy: 0, faction: Faction.RIVAL_1 };
  withTacticsState(
    {
      world: makeWorld([owned]),
      npcs: [enemy],
      buckets: new Map([[packChunkKey(0, 0), [enemy]]]),
    },
    () => {
      state.factionTactics[Faction.RIVAL_1].bossInDanger = true;
      state.factionTactics[Faction.RIVAL_1].localFocusId = 99;
      updateFactionTactics(0.25);
      const record = state.factionTactics[Faction.RIVAL_1];
      assertEqual(record.bossId, null);
      assertEqual(record.bossInDanger, false);
      assertEqual(record.localFocusId, null);
      assertEqual(record.threatenedChunks.length, 1);
    }
  );
});

test('tactics: chunk math keeps finding the boss chunk across a border', () => {
  const boss = unit({ id: 1, rank: UnitRank.BOSS, x: CHUNK_PX - 10, y: 100 });
  const nextChunk = unit({ id: 2, x: CHUNK_PX + 10, y: 100, faction: Faction.RIVAL_2 });
  withTacticsState(
    {
      npcs: [boss, nextChunk],
      buckets: new Map([
        [packChunkKey(0, 0), [boss]],
        [packChunkKey(1, 0), [nextChunk]],
      ]),
    },
    () => {
      assertEqual(findLocalFocus(boss), nextChunk.id);
    }
  );
});

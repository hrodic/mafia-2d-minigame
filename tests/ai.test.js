// AI decision tests: perception counts and patrol target selection (headless).
import { test, assert, assertEqual } from './harness.js';
import { Faction, UnitRank } from '../src/config/enums.js';
import { state } from '../src/core/state.js';
import { packChunkKey } from '../src/world/city.js';
import { scanNearby, choosePatrolChunk } from '../src/sim/ai.js';

const STATE_KEYS = ['world', 'player', 'npcs', 'spatialBuckets'];

function withAiState(opts, fn) {
  const saved = {};
  for (const key of STATE_KEYS) saved[key] = state[key];
  state.world = opts.world || { chunks: new Map(), getChunk: () => null };
  state.player = opts.player || { x: 100, y: 100, faction: Faction.PLAYER, alive: true };
  state.npcs = opts.npcs || [];
  state.spatialBuckets = opts.spatialBuckets || new Map();
  try {
    return fn();
  } finally {
    for (const key of STATE_KEYS) state[key] = saved[key];
  }
}

function npc(overrides = {}) {
  return {
    id: 1,
    x: 130,
    y: 100,
    faction: Faction.RIVAL_1,
    rank: UnitRank.SOLDIER,
    bodyRadius: 11,
    ...overrides,
  };
}

test('ai: scan finds the nearest enemy and counts allies/enemies', () => {
  const unit = npc();
  const ally = npc({ id: 2, x: 120, y: 100 });
  const enemyNpc = npc({ id: 3, x: 110, y: 100, faction: Faction.RIVAL_2 });
  withAiState(
    {
      npcs: [unit, ally, enemyNpc],
      spatialBuckets: new Map([[packChunkKey(0, 0), [unit, ally, enemyNpc]]]),
    },
    () => {
      const scan = scanNearby(unit);
      assertEqual(scan.nearbyAllyCount, 1);
      assertEqual(scan.nearbyEnemyCount, 2);
      assertEqual(scan.nearestEnemy.entity, enemyNpc);
      assertEqual(scan.nearestEnemy.isPlayer, false);
      assertEqual(scan.nearestEnemyDist, 20);
    }
  );
});

test('ai: a player is the nearest enemy when no rival is closer', () => {
  const unit = npc();
  withAiState(
    {
      npcs: [unit],
      spatialBuckets: new Map([[packChunkKey(0, 0), [unit]]]),
    },
    () => {
      const scan = scanNearby(unit);
      assertEqual(scan.nearestEnemy.isPlayer, true);
      assertEqual(scan.nearestEnemy.entity, state.player);
      assertEqual(scan.nearestEnemyDist, 30);
      assertEqual(scan.nearbyEnemyCount, 1);
    }
  );
});

test('ai: patrol chooses the nearest non-owned chunk in scan range', () => {
  const chunks = [
    { cx: 0, cy: 0, faction: Faction.RIVAL_1 },
    { cx: 1, cy: 0, faction: Faction.PLAYER },
    { cx: 0, cy: 1, faction: Faction.NEUTRAL },
    { cx: 2, cy: 0, faction: Faction.NEUTRAL },
  ];
  const map = new Map(chunks.map((c) => [`${c.cx},${c.cy}`, c]));
  const unit = npc();
  withAiState(
    {
      world: {
        chunks: map,
        getChunk: (cx, cy) => map.get(`${cx},${cy}`) || null,
      },
    },
    () => {
      const target = choosePatrolChunk(unit, 0, 0);
      assert(target);
      assertEqual(target.cx, 1);
      assertEqual(target.cy, 0);
    }
  );
});

test('ai: patrol falls back to any non-owned chunk', () => {
  const chunks = [
    { cx: 0, cy: 0, faction: Faction.RIVAL_1 },
    { cx: 20, cy: 20, faction: Faction.NEUTRAL },
  ];
  const map = new Map(chunks.map((c) => [`${c.cx},${c.cy}`, c]));
  const unit = npc();
  withAiState(
    {
      world: {
        chunks: map,
        getChunk: (cx, cy) => map.get(`${cx},${cy}`) || null,
      },
    },
    () => {
      const target = choosePatrolChunk(unit, 0, 0);
      assertEqual(target.cx, 20);
      assertEqual(target.cy, 20);
    }
  );
});

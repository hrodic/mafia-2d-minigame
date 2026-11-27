// Health regeneration tests: friendly turf, damage suppression and rank rates.
import { test, assert, assertEqual, assertClose } from './harness.js';
import { Faction, UnitRank } from '../src/config/enums.js';
import { RANK_STATS } from '../src/config/balance.js';
import { state } from '../src/core/state.js';
import { getRegenPerSecond, regenUnit } from '../src/sim/regen.js';

const STATE_KEYS = ['world'];

function withTerritory(faction, fn, chunkFaction = null) {
  const saved = state.world;
  const chunk = chunkFaction === null ? { faction } : chunkFaction;
  state.world = {
    worldToTile: () => ({ cx: 0, cy: 0, lx: 0, ly: 0 }),
    getChunk: () => chunk,
  };
  try {
    return fn();
  } finally {
    state.world = saved;
  }
}

function makeUnit(rank, overrides = {}) {
  return {
    faction: Faction.PLAYER,
    rank,
    x: 100,
    y: 100,
    hp: 100,
    maxHp: 1000,
    hitFlashTimer: 0,
    alive: true,
    ...overrides,
  };
}

test('regen: rates match the rank hierarchy', () => {
  assertEqual(RANK_STATS[UnitRank.BOSS].regenPerSecond, 5);
  assertEqual(RANK_STATS[UnitRank.UNDERBOSS].regenPerSecond, 4);
  assertEqual(RANK_STATS[UnitRank.CAPTAIN].regenPerSecond, 2);
  assertEqual(RANK_STATS[UnitRank.SOLDIER].regenPerSecond, 1);
  assertEqual(getRegenPerSecond(UnitRank.BOSS), 5);
  assertEqual(getRegenPerSecond(UnitRank.UNDERBOSS), 4);
  assertEqual(getRegenPerSecond(UnitRank.CAPTAIN), 2);
  assertEqual(getRegenPerSecond(UnitRank.SOLDIER), 1);
  assertEqual(getRegenPerSecond('UNKNOWN'), 1);
});

test('regen: only friendly turf heals', () => {
  withTerritory(Faction.PLAYER, () => {
    const unit = makeUnit(UnitRank.BOSS);
    assertClose(regenUnit(unit, 1), 5, 1e-9);
    assertClose(unit.hp, 105, 1e-9);
  });
  withTerritory(Faction.NEUTRAL, () => {
    const unit = makeUnit(UnitRank.BOSS);
    assertEqual(regenUnit(unit, 1), 0);
    assertEqual(unit.hp, 100);
  });
  withTerritory(Faction.RIVAL_1, () => {
    const unit = makeUnit(UnitRank.BOSS);
    assertEqual(regenUnit(unit, 1), 0);
    assertEqual(unit.hp, 100);
  });
});

test('regen: the hit-flash window suppresses healing', () => {
  withTerritory(Faction.PLAYER, () => {
    const unit = makeUnit(UnitRank.SOLDIER, { hitFlashTimer: 0.18 });
    assertEqual(regenUnit(unit, 0.5), 0);
    assertEqual(unit.hp, 100);
    unit.hitFlashTimer = 0;
    assertClose(regenUnit(unit, 0.5), 0.5, 1e-9);
    assertClose(unit.hp, 100.5, 1e-9);
  });
});

test('regen: different ranks heal at different rates and clamp at max', () => {
  const cases = [
    [UnitRank.BOSS, 5],
    [UnitRank.UNDERBOSS, 4],
    [UnitRank.CAPTAIN, 2],
    [UnitRank.SOLDIER, 1],
  ];
  withTerritory(Faction.PLAYER, () => {
    for (const [rank, rate] of cases) {
      const unit = makeUnit(rank);
      assertClose(regenUnit(unit, 1), rate, 1e-9, `${rank} rate`);
      assertClose(unit.hp, 100 + rate, 1e-9, `${rank} hp`);
    }
    const nearlyFull = makeUnit(UnitRank.BOSS, { hp: 999, maxHp: 1000, hitFlashTimer: 0 });
    assertClose(regenUnit(nearlyFull, 1), 1, 1e-9);
    assertEqual(nearlyFull.hp, 1000);
  });
});

test('regen: full HP and dead units are skipped', () => {
  withTerritory(Faction.PLAYER, () => {
    const full = makeUnit(UnitRank.BOSS, { hp: 1000, maxHp: 1000, hitFlashTimer: 0 });
    assertEqual(regenUnit(full, 1), 0);
    const dead = makeUnit(UnitRank.BOSS, { hp: 0, alive: false, hitFlashTimer: 0 });
    assertEqual(regenUnit(dead, 1), 0);
  });
});

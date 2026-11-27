// Config tests: enums, balance tables, organizations and helper invariants.
import { test, assert, assertEqual, assertDeepEqual } from './harness.js';
import {
  CHUNK_SIZE,
  TILE_SIZE,
  CHUNK_PX,
  DEFAULT_GRID_SIZE,
  DEFAULT_TICK_DURATION,
  MAX_PISTOL_RANGE,
  HIT_FLASH_DURATION,
  SIM_DT,
  MAX_FRAME_DELTA,
  MAX_SIM_STEPS,
} from '../src/config/constants.js';
import { INCOME_TIERS } from '../src/config/balance.js';
import { TileType, PropType, Faction, UnitRank } from '../src/config/enums.js';
import {
  ORGANIZATIONS,
  ALL_ORG_IDS,
  FACTION_META,
  ALL_FACTION_SLOTS,
  RANK_LABELS,
  ensureUniqueOrgs,
  getActiveFactionSlots,
  clampFactionCount,
} from '../src/config/organizations.js';

test('config: geometry constants are consistent', () => {
  assertEqual(CHUNK_PX, CHUNK_SIZE * TILE_SIZE);
  assert(CHUNK_SIZE > 0 && TILE_SIZE > 0);
  assertEqual(DEFAULT_GRID_SIZE, 15);
  assertEqual(DEFAULT_TICK_DURATION, 10);
  assertEqual(MAX_PISTOL_RANGE, 600);
  assertEqual(HIT_FLASH_DURATION, 0.16);
  assertEqual(SIM_DT, 1 / 120);
  assertEqual(MAX_FRAME_DELTA, 0.25);
  assert(MAX_SIM_STEPS >= 1 && MAX_SIM_STEPS <= 15, `unexpected max steps: ${MAX_SIM_STEPS}`);
});

test('config: enums have unique values', () => {
  for (const enumDef of [TileType, PropType, Faction, UnitRank]) {
    const values = Object.values(enumDef);
    assertEqual(new Set(values).size, values.length);
  }
});

test('config: faction count clamps to 2..4 (invalid falls back to 4)', () => {
  assertEqual(clampFactionCount(2), 2);
  assertEqual(clampFactionCount(3), 3);
  assertEqual(clampFactionCount(4), 4);
  assertEqual(clampFactionCount('3'), 3);
  assertEqual(clampFactionCount(1), 2);
  assertEqual(clampFactionCount(9), 4);
  assertEqual(clampFactionCount(undefined), 4);
  assertEqual(clampFactionCount(0), 4);
});

test('config: active faction slots derive from the clamped count', () => {
  assertDeepEqual(getActiveFactionSlots(2), [Faction.PLAYER, Faction.RIVAL_3]);
  assertDeepEqual(getActiveFactionSlots(3), [Faction.PLAYER, Faction.RIVAL_1, Faction.RIVAL_2]);
  assertDeepEqual(getActiveFactionSlots(4), ALL_FACTION_SLOTS);
  assertDeepEqual(getActiveFactionSlots(1), getActiveFactionSlots(2));
  assertDeepEqual(getActiveFactionSlots(9), ALL_FACTION_SLOTS);
});

test('config: income tiers are ordered and valid', () => {
  assert(INCOME_TIERS.LOW.min < INCOME_TIERS.MID.min);
  assert(INCOME_TIERS.MID.min < INCOME_TIERS.HIGH.min);
  for (const [key, tier] of Object.entries(INCOME_TIERS)) {
    assert(tier.max >= tier.min, `${key} has max < min`);
    assert(tier.label, `${key} is missing a label`);
  }
});

test('config: every organization is complete', () => {
  assertEqual(ALL_ORG_IDS.length, 6);
  assertDeepEqual(RANK_LABELS, {
    BOSS: 'Boss',
    UNDERBOSS: 'Underboss',
    CAPTAIN: 'Captain',
    SOLDIER: 'Soldier',
  });
  assertEqual(ORGANIZATIONS.COSA_NOSTRA.ranks.BOSS, 'Don');
  assertEqual(ORGANIZATIONS.BRATVA.ranks.BOSS, 'Pakhan');
  assertEqual(ORGANIZATIONS.TRIADS.ranks.BOSS, 'Shan Chu');
  for (const id of ALL_ORG_IDS) {
    const org = ORGANIZATIONS[id];
    assert(org, `missing organization ${id}`);
    assertEqual(org.id, id);
    assert(org.name && org.short && org.badge && org.coat && org.accent);
    for (const rank of Object.values(UnitRank)) {
      assert(org.ranks[rank], `${id} is missing rank name ${rank}`);
    }
  }
});

test('config: faction meta covers neutral and every faction slot', () => {
  assert(FACTION_META[Faction.NEUTRAL], 'neutral meta missing');
  for (const faction of ALL_FACTION_SLOTS) {
    const meta = FACTION_META[faction];
    assert(meta, `faction meta missing for ${faction}`);
    assert(meta.ranks.BOSS && meta.badge && meta.coat && meta.accent);
  }
  assertEqual(ALL_FACTION_SLOTS.length, 4);
});

test('organizations: ensureUniqueOrgs returns 4 unique valid orgs', () => {
  const cases = [
    ['COSA_NOSTRA', 'BRATVA', 'TRIADS', 'CARTEL'],
    ['COSA_NOSTRA', 'COSA_NOSTRA', 'COSA_NOSTRA', 'COSA_NOSTRA'],
    ['BRATVA', undefined, 'NOPE', 'BRATVA'],
    ['CARTEL', 'COSA_NOSTRA', 'BRATVA', 'TRIADS'],
    [],
    undefined,
    null,
  ];
  for (const input of cases) {
    const result = ensureUniqueOrgs(input);
    assertEqual(result.length, 4);
    assertEqual(new Set(result).size, 4);
    for (const id of result) {
      assert(ORGANIZATIONS[id], `invalid org id returned: ${id}`);
    }
  }
});

test('organizations: ensureUniqueOrgs keeps a valid input order', () => {
  const input = ['CARTEL', 'BRATVA', 'COSA_NOSTRA', 'TRIADS'];
  assertDeepEqual(ensureUniqueOrgs(input), input);
});

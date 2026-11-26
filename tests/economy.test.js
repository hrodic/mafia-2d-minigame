// Economy tests: faction upkeep, neighborhood income and the hourly tick.
import { test, assert, assertEqual } from './harness.js';
import { Faction, UnitRank } from '../src/config/enums.js';
import { UPKEEP_SOLDIER, UPKEEP_CAPTAIN, UPKEEP_UNDERBOSS, COST_SOLDIER } from '../src/config/balance.js';
import { ALL_FACTION_SLOTS } from '../src/config/organizations.js';
import { state } from '../src/core/state.js';
import { on } from '../src/core/events.js';
import { CityMap } from '../src/world/city.js';
import { onUnitRecruited } from '../src/render/recruitFx.js';
import {
  calculateFactionUpkeep,
  recalculateHourlyIncome,
  processHourlyTick,
} from '../src/sim/economy.js';

const STATE_KEYS = [
  'activeFactions',
  'factionAlive',
  'treasuries',
  'npcs',
  'world',
  'playerSpawnCaps',
  'factionRecruitmentPrefs',
  'autoRecruitSoldier',
  'autoRecruitCaptain',
  'autoRecruitUnderboss',
  'gameHour',
  'minimapCacheTimer',
  'net',
  'currentGridSize',
  'floatingTexts',
  'spatialBuckets',
  'player',
];

function withEconomyState(opts, fn) {
  const saved = {};
  for (const key of STATE_KEYS) saved[key] = state[key];

  const map =
    opts.map ||
    new CityMap({ seed: 918273, gridSize: 15, incomeTier: 'HIGH', activeFactions: ALL_FACTION_SLOTS });
  if (opts.prepareMap) opts.prepareMap(map);

  state.world = map;
  state.activeFactions = [...ALL_FACTION_SLOTS];
  state.factionAlive = { ...saved.factionAlive, ...(opts.factionAlive || {}) };
  state.treasuries = { ...saved.treasuries, ...(opts.treasuries || {}) };
  state.npcs = opts.npcs ? opts.npcs.map((unit) => ({ ...unit })) : [];
  state.player = { ...saved.player, x: 0, y: 0, alive: false, ...(opts.player || {}) };
  state.playerSpawnCaps = { ...saved.playerSpawnCaps, ...(opts.playerSpawnCaps || {}) };
  state.factionRecruitmentPrefs = JSON.parse(JSON.stringify(saved.factionRecruitmentPrefs));
  state.autoRecruitSoldier = opts.autoSoldier ?? false;
  state.autoRecruitCaptain = opts.autoCaptain ?? false;
  state.autoRecruitUnderboss = opts.autoUnderboss ?? false;
  state.gameHour = opts.gameHour ?? 12;
  state.minimapCacheTimer = 0;
  state.net = opts.net || null;
  state.currentGridSize = 15;
  state.floatingTexts = [];
  state.spatialBuckets = new Map();

  const events = [];
  const unsubscribers = [
    on('hour:tick', (payload) => events.push({ type: 'hour:tick', payload })),
    on('unit:recruited', onUnitRecruited),
  ];
  try {
    return fn({ map, events });
  } finally {
    for (const unsubscribe of unsubscribers) unsubscribe();
    for (const key of STATE_KEYS) state[key] = saved[key];
  }
}

function withChunk(map, cx, cy, faction, income) {
  const chunk = map.generateChunk(cx, cy);
  chunk.faction = faction;
  if (income !== undefined) chunk.income = income;
  return chunk;
}

function eventsOf(events, type) {
  return events.filter((entry) => entry.type === type);
}

test('economy: upkeep totals sum per rank and ignore bosses/unknown factions', () => {
  withEconomyState(
    {
      npcs: [
        { faction: Faction.PLAYER, rank: UnitRank.SOLDIER },
        { faction: Faction.PLAYER, rank: UnitRank.SOLDIER },
        { faction: Faction.PLAYER, rank: UnitRank.CAPTAIN },
        { faction: Faction.PLAYER, rank: UnitRank.UNDERBOSS },
        { faction: Faction.PLAYER, rank: UnitRank.BOSS },
        { faction: Faction.RIVAL_1, rank: UnitRank.CAPTAIN },
        { faction: 'UNKNOWN', rank: UnitRank.SOLDIER },
      ],
    },
    () => {
      const totals = calculateFactionUpkeep();
      assertEqual(
        totals[Faction.PLAYER],
        UPKEEP_SOLDIER * 2 + UPKEEP_CAPTAIN + UPKEEP_UNDERBOSS
      );
      assertEqual(totals[Faction.RIVAL_1], UPKEEP_CAPTAIN);
      assertEqual(totals[Faction.RIVAL_2], 0);
      assertEqual(totals[Faction.RIVAL_3], 0);
    }
  );
});

test('economy: hourly income sums owned neighborhoods only', () => {
  withEconomyState(
    {
      prepareMap: (map) => {
        withChunk(map, 0, 0, Faction.PLAYER, 1000);
        withChunk(map, 1, 0, Faction.PLAYER, 250);
        withChunk(map, 2, 0, Faction.RIVAL_1, 500);
        withChunk(map, 3, 0, Faction.NEUTRAL, 999);
      },
    },
    () => {
      const totals = recalculateHourlyIncome();
      assertEqual(totals[Faction.PLAYER], 1250);
      assertEqual(totals[Faction.RIVAL_1], 500);
      assertEqual(totals[Faction.RIVAL_2], 0);
      assertEqual(totals[Faction.RIVAL_3], 0);
    }
  );
});

test('economy: the hourly tick advances the clock and pays net income', () => {
  withEconomyState(
    {
      prepareMap: (map) => {
        withChunk(map, 0, 0, Faction.PLAYER, 1000);
        withChunk(map, 14, 0, Faction.RIVAL_1, 500);
      },
      treasuries: {
        [Faction.PLAYER]: 400,
        [Faction.RIVAL_1]: 400,
        [Faction.RIVAL_2]: 0,
        [Faction.RIVAL_3]: 0,
      },
      npcs: [
        { faction: Faction.PLAYER, rank: UnitRank.SOLDIER },
        { faction: Faction.RIVAL_1, rank: UnitRank.CAPTAIN },
      ],
    },
    ({ events }) => {
      processHourlyTick();
      assertEqual(state.gameHour, 13);
      assertEqual(state.treasuries[Faction.PLAYER], 400 + 1000 - UPKEEP_SOLDIER);
      assertEqual(state.treasuries[Faction.RIVAL_1], 400 + 500 - UPKEEP_CAPTAIN);
      assertEqual(state.treasuries[Faction.RIVAL_2], 0);
      assertEqual(state.minimapCacheTimer, 1.0);

      const ticks = eventsOf(events, 'hour:tick');
      assertEqual(ticks.length, 1);
      assertEqual(ticks[0].payload.hour, 13);
      assertEqual(ticks[0].payload.income[Faction.PLAYER], 1000);
      assertEqual(ticks[0].payload.income[Faction.RIVAL_1], 500);
      assertEqual(ticks[0].payload.upkeep[Faction.PLAYER], UPKEEP_SOLDIER);
      assertEqual(ticks[0].payload.upkeep[Faction.RIVAL_1], UPKEEP_CAPTAIN);
      assertEqual(ticks[0].payload.treasuries[Faction.PLAYER], 400 + 1000 - UPKEEP_SOLDIER);
    }
  );
});

test('economy: the clock wraps from 23:00 to 00:00', () => {
  withEconomyState({ gameHour: 23 }, () => {
    processHourlyTick();
    assertEqual(state.gameHour, 0);
  });
});

test('economy: dead factions are skipped by payment and recruitment', () => {
  withEconomyState(
    {
      prepareMap: (map) => {
        withChunk(map, 0, 0, Faction.PLAYER, 1000);
        withChunk(map, 1, 0, Faction.RIVAL_2, 300);
      },
      factionAlive: { [Faction.RIVAL_2]: false },
      treasuries: { [Faction.RIVAL_2]: 100 },
      autoSoldier: false,
    },
    () => {
      processHourlyTick();
      assertEqual(state.treasuries[Faction.PLAYER], 3000 + 1000);
      assertEqual(state.treasuries[Faction.RIVAL_2], 100);
      assertEqual(state.npcs.filter((u) => u.faction === Faction.RIVAL_2).length, 0);
    }
  );
});

test('economy: auto-recruit hires with tick income until funds run out', () => {
  withEconomyState(
    {
      prepareMap: (map) => {
        withChunk(map, 0, 0, Faction.PLAYER, 1000);
      },
      treasuries: { [Faction.PLAYER]: 500 },
      autoSoldier: true,
    },
    ({ events }) => {
      processHourlyTick();
      assertEqual(state.npcs.length, 1);
      assertEqual(state.npcs[0].rank, UnitRank.SOLDIER);
      assertEqual(state.treasuries[Faction.PLAYER], 500 + 1000 - COST_SOLDIER);
      assertEqual(state.floatingTexts.length, 1);
      assertEqual(eventsOf(events, 'hour:tick').length, 1);
    }
  );
});

test('economy: disabled auto-recruit leaves the crew untouched', () => {
  withEconomyState(
    {
      prepareMap: (map) => {
        withChunk(map, 0, 0, Faction.PLAYER, 1000);
      },
      treasuries: { [Faction.PLAYER]: 5000 },
      autoSoldier: false,
      autoCaptain: false,
      autoUnderboss: false,
    },
    () => {
      processHourlyTick();
      assertEqual(state.npcs.length, 0);
      assertEqual(state.treasuries[Faction.PLAYER], 6000);
    }
  );
});

test('economy: a faction with no turf earns nothing but still pays upkeep', () => {
  withEconomyState(
    {
      treasuries: { [Faction.PLAYER]: 500 },
      npcs: [{ faction: Faction.PLAYER, rank: UnitRank.UNDERBOSS }],
    },
    () => {
      processHourlyTick();
      assertEqual(state.treasuries[Faction.PLAYER], 500 - UPKEEP_UNDERBOSS);
    }
  );
});

// Unit recruitment tests: caps, spawn stats, costs, treasury and recruit limits.
import { test, assert, assertEqual, assertDeepEqual } from './harness.js';
import { Faction, UnitRank } from '../src/config/enums.js';
import {
  COST_SOLDIER,
  COST_CAPTAIN,
  COST_UNDERBOSS,
  BOSS_MAX_HP,
  MAX_BOSS_ARMOR,
} from '../src/config/balance.js';
import { ALL_FACTION_SLOTS } from '../src/config/organizations.js';
import { state } from '../src/core/state.js';
import { on } from '../src/core/events.js';
import { CityMap } from '../src/world/city.js';
import { onUnitRecruited } from '../src/render/recruitFx.js';
import {
  getUnitCaps,
  resetDefaultPlayerSpawnCaps,
  clampPlayerSpawnCaps,
  spawnUnitInChunk,
  recruitUnit,
} from '../src/sim/units.js';

const STATE_KEYS = [
  'world',
  'npcs',
  'nextNpcId',
  'treasuries',
  'factionAlive',
  'player',
  'playerSpawnCaps',
  'factionRecruitmentPrefs',
  'net',
  'currentGridSize',
  'floatingTexts',
  'spatialBuckets',
];

function withUnitsState(opts, fn) {
  const saved = {};
  for (const key of STATE_KEYS) saved[key] = state[key];

  const map =
    opts.map ||
    new CityMap({ seed: 424242, gridSize: 15, incomeTier: 'HIGH', activeFactions: ALL_FACTION_SLOTS });
  state.world = map;
  state.npcs = [];
  state.nextNpcId = 1;
  state.treasuries = { ...saved.treasuries, ...(opts.treasuries || {}) };
  state.factionAlive = { ...saved.factionAlive, ...(opts.factionAlive || {}) };
  state.player = { ...saved.player, x: 0, y: 0, alive: false, ...(opts.player || {}) };
  state.playerSpawnCaps = { ...saved.playerSpawnCaps, ...(opts.playerSpawnCaps || {}) };
  state.factionRecruitmentPrefs = JSON.parse(JSON.stringify(saved.factionRecruitmentPrefs));
  state.net = opts.net || null;
  state.currentGridSize = opts.currentGridSize ?? 15;
  state.floatingTexts = [];
  state.spatialBuckets = new Map();

  const events = [];
  const unsubscribers = [
    on('unit:recruited', (payload) => events.push({ type: 'unit:recruited', payload })),
    // Mirror production wiring so the floating-text assertion stays meaningful.
    on('unit:recruited', onUnitRecruited),
  ];

  try {
    return fn({ map, events });
  } finally {
    for (const unsubscribe of unsubscribers) unsubscribe();
    for (const key of STATE_KEYS) state[key] = saved[key];
  }
}

function ownedChunk(map, faction = Faction.PLAYER, cx = 0, cy = 0) {
  const chunk = map.generateChunk(cx, cy);
  chunk.faction = faction;
  return chunk;
}

function eventsOf(events, type) {
  return events.filter((entry) => entry.type === type);
}

test('units: caps scale with the number of neighborhoods', () => {
  withUnitsState({ map: { chunks: { size: 100 } } }, () => {
    assertDeepEqual(getUnitCaps(), {
      totalNeighborhoods: 100,
      maxSoldiers: 85,
      maxCaptains: 10,
      maxUnderbosses: 5,
    });
  });
  withUnitsState({ map: { chunks: { size: 0 } }, currentGridSize: 10 }, () => {
    assertEqual(getUnitCaps().totalNeighborhoods, 100);
  });
  withUnitsState({ map: { chunks: { size: 0 } }, currentGridSize: 3 }, () => {
    assertEqual(getUnitCaps().totalNeighborhoods, 25);
  });
});

test('units: clamp keeps player spawn caps within hard limits and above 1', () => {
  withUnitsState(
    {
      map: { chunks: { size: 100 } },
      playerSpawnCaps: { [UnitRank.SOLDIER]: 999, [UnitRank.CAPTAIN]: 0, [UnitRank.UNDERBOSS]: 5 },
    },
    () => {
      clampPlayerSpawnCaps();
      assertEqual(state.playerSpawnCaps[UnitRank.SOLDIER], 85);
      assertEqual(state.playerSpawnCaps[UnitRank.CAPTAIN], 1);
      assertEqual(state.playerSpawnCaps[UnitRank.UNDERBOSS], 5);
    }
  );
});

test('units: default caps give humans half and AI the full quota', () => {
  withUnitsState(
    {
      map: { chunks: { size: 100 } },
      net: { isHumanFaction: (faction) => faction === Faction.RIVAL_1 },
    },
    () => {
      resetDefaultPlayerSpawnCaps();
      assertEqual(state.playerSpawnCaps[UnitRank.SOLDIER], 43);
      assertEqual(state.playerSpawnCaps[UnitRank.CAPTAIN], 5);
      assertEqual(state.playerSpawnCaps[UnitRank.UNDERBOSS], 3);

      const prefs = state.factionRecruitmentPrefs;
      assertEqual(prefs[Faction.PLAYER].caps[UnitRank.SOLDIER], 43);
      assertEqual(prefs[Faction.RIVAL_1].caps[UnitRank.SOLDIER], 43);
      assertEqual(prefs[Faction.RIVAL_2].caps[UnitRank.SOLDIER], 85);
      assertEqual(prefs[Faction.RIVAL_2].caps[UnitRank.CAPTAIN], 10);
      assertEqual(prefs[Faction.RIVAL_2].caps[UnitRank.UNDERBOSS], 5);
      assertEqual(prefs[Faction.RIVAL_3].autoSoldier, true);
    }
  );
});

test('units: soldiers and captains spawn with the correct stats', () => {
  withUnitsState({}, ({ map }) => {
    const chunk = map.generateChunk(0, 0);
    const soldier = spawnUnitInChunk(Faction.PLAYER, chunk, UnitRank.SOLDIER);
    assert(soldier, 'soldier should spawn on a road tile');
    assertEqual(soldier.faction, Faction.PLAYER);
    assertEqual(soldier.rank, UnitRank.SOLDIER);
    assertEqual(soldier.hp, 180);
    assertEqual(soldier.maxHp, 180);
    assertEqual(soldier.minDmg, 10);
    assertEqual(soldier.maxDmg, 18);
    assertEqual(soldier.armor, 0);
    assertEqual(soldier.maxArmor, 0);
    assertEqual(soldier.bodyRadius, 11);
    assertEqual(soldier.id, 1);
    assertEqual(state.npcs.length, 1);

    const captain = spawnUnitInChunk(Faction.PLAYER, chunk, UnitRank.CAPTAIN);
    assertEqual(captain.hp, 340);
    assertEqual(captain.minDmg, 18);
    assertEqual(captain.maxDmg, 28);
    assertEqual(captain.bodyRadius, 12);
    assertEqual(captain.id, 2);
  });
});

test('units: underbosses spawn with armor and higher damage', () => {
  withUnitsState({}, ({ map }) => {
    const chunk = map.generateChunk(0, 0);
    const underboss = spawnUnitInChunk(Faction.PLAYER, chunk, UnitRank.UNDERBOSS);
    assertEqual(underboss.hp, 480);
    assertEqual(underboss.armor, 120);
    assertEqual(underboss.maxArmor, 120);
    assertEqual(underboss.minDmg, 26);
    assertEqual(underboss.maxDmg, 38);
    assertEqual(underboss.bodyRadius, 12.8);
  });
});

test('units: bosses spawn at 140 whether AI or human-controlled', () => {
  withUnitsState({}, ({ map }) => {
    const chunk = map.generateChunk(14, 0);
    const boss = spawnUnitInChunk(Faction.RIVAL_1, chunk, UnitRank.BOSS);
    assertEqual(boss.hp, BOSS_MAX_HP);
    assertEqual(boss.maxArmor, MAX_BOSS_ARMOR);
    assertEqual(boss.bodyRadius, 13.5);
    assertEqual(boss.speed, 140);
    assertEqual(boss.humanPeerId, null);
  });
  withUnitsState({ net: { getPeerForFaction: () => 'peer-x' } }, ({ map }) => {
    const chunk = map.generateChunk(14, 0);
    const boss = spawnUnitInChunk(Faction.RIVAL_1, chunk, UnitRank.BOSS);
    assertEqual(boss.speed, 140);
    assertEqual(boss.humanPeerId, 'peer-x');
  });
});

test('units: recruiting charges the treasury and spawns a unit', () => {
  withUnitsState({ treasuries: { [Faction.PLAYER]: 10000 } }, ({ map, events }) => {
    ownedChunk(map, Faction.PLAYER);
    assertEqual(recruitUnit(Faction.PLAYER, UnitRank.SOLDIER), true);
    assertEqual(state.treasuries[Faction.PLAYER], 10000 - COST_SOLDIER);
    assertEqual(state.npcs.length, 1);
    assertEqual(state.npcs[0].rank, UnitRank.SOLDIER);
    assertEqual(state.floatingTexts.length, 1);

    const recruited = eventsOf(events, 'unit:recruited');
    assertEqual(recruited.length, 1);
    assertEqual(recruited[0].payload.unit, state.npcs[0]);
    assertEqual(recruited[0].payload.faction, Faction.PLAYER);
    assertEqual(recruited[0].payload.rank, UnitRank.SOLDIER);
    assertEqual(recruited[0].payload.cost, COST_SOLDIER);

    assertEqual(recruitUnit(Faction.PLAYER, UnitRank.SOLDIER, true), true);
    assertEqual(state.floatingTexts.length, 1, 'silent recruit should not float text');
    assertEqual(eventsOf(events, 'unit:recruited').length, 1, 'silent recruit should not emit');
    assertEqual(state.treasuries[Faction.PLAYER], 10000 - COST_SOLDIER * 2);
  });
});

test('units: captain and underboss recruitment costs match the balance table', () => {
  withUnitsState({ treasuries: { [Faction.PLAYER]: 10000 } }, ({ map }) => {
    ownedChunk(map, Faction.PLAYER);
    assertEqual(recruitUnit(Faction.PLAYER, UnitRank.CAPTAIN), true);
    assertEqual(state.treasuries[Faction.PLAYER], 10000 - COST_CAPTAIN);
    assertEqual(recruitUnit(Faction.PLAYER, UnitRank.UNDERBOSS), true);
    assertEqual(state.treasuries[Faction.PLAYER], 10000 - COST_CAPTAIN - COST_UNDERBOSS);
  });
});

test('units: recruitment refuses dead factions, poverty and no turf', () => {
  withUnitsState(
    { factionAlive: { [Faction.PLAYER]: false }, treasuries: { [Faction.PLAYER]: 10000 } },
    ({ map }) => {
      ownedChunk(map, Faction.PLAYER);
      assertEqual(recruitUnit(Faction.PLAYER, UnitRank.SOLDIER), false);
    }
  );
  withUnitsState({ treasuries: { [Faction.PLAYER]: 100 } }, ({ map }) => {
    ownedChunk(map, Faction.PLAYER);
    assertEqual(recruitUnit(Faction.PLAYER, UnitRank.SOLDIER), false);
    assertEqual(state.treasuries[Faction.PLAYER], 100);
  });
  withUnitsState({ treasuries: { [Faction.PLAYER]: 10000 } }, ({ map }) => {
    ownedChunk(map, Faction.NEUTRAL);
    assertEqual(recruitUnit(Faction.PLAYER, UnitRank.SOLDIER), false);
  });
});

test('units: the player spawn cap stops recruitment', () => {
  withUnitsState(
    { treasuries: { [Faction.PLAYER]: 10000 }, playerSpawnCaps: { [UnitRank.SOLDIER]: 1 } },
    ({ map }) => {
      ownedChunk(map, Faction.PLAYER);
      assertEqual(recruitUnit(Faction.PLAYER, UnitRank.SOLDIER), true);
      assertEqual(recruitUnit(Faction.PLAYER, UnitRank.SOLDIER), false);
      assertEqual(state.treasuries[Faction.PLAYER], 10000 - COST_SOLDIER);
    }
  );
});

test('units: remote-human pref caps are honoured', () => {
  withUnitsState(
    {
      treasuries: { [Faction.RIVAL_1]: 10000 },
      net: { isHumanFaction: (faction) => faction === Faction.RIVAL_1 },
    },
    ({ map }) => {
      ownedChunk(map, Faction.RIVAL_1, 14, 0);
      state.factionRecruitmentPrefs[Faction.RIVAL_1].caps[UnitRank.SOLDIER] = 1;
      assertEqual(recruitUnit(Faction.RIVAL_1, UnitRank.SOLDIER), true);
      assertEqual(recruitUnit(Faction.RIVAL_1, UnitRank.SOLDIER), false);
    }
  );
});

test('units: cached counts and owned chunks are updated without rescanning', () => {
  withUnitsState({ treasuries: { [Faction.PLAYER]: 10000 } }, ({ map }) => {
    const chunk = ownedChunk(map, Faction.PLAYER);
    const cachedCounts = {
      [Faction.PLAYER]: { soldiers: 0, captains: 0, underbosses: 0 },
    };
    const cachedOwnedChunks = [chunk];
    assertEqual(recruitUnit(Faction.PLAYER, UnitRank.SOLDIER, true, cachedCounts, cachedOwnedChunks), true);
    assertEqual(cachedCounts[Faction.PLAYER].soldiers, 1);
    assertEqual(cachedOwnedChunks.length, 1);
  });
});

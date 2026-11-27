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
import { CHUNK_PX } from '../src/config/constants.js';
import { GLOBAL_STANCE, createFactionTactics } from '../src/config/tactics.js';
import { state } from '../src/core/state.js';
import { on } from '../src/core/events.js';
import { CityMap, packChunkKey } from '../src/world/city.js';
import {
  COLLISION_CELL_PX,
  packCollisionCell,
} from '../src/core/spatial.js';
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
  'matchUnitCaps',
  'net',
  'currentGridSize',
  'floatingTexts',
  'spatialBuckets',
  'collisionBuckets',
  'collisionBucketPool',
  'factionTactics',
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
  state.matchUnitCaps = opts.matchUnitCaps ? { ...opts.matchUnitCaps } : null;
  state.net = opts.net || null;
  state.currentGridSize = opts.currentGridSize ?? 15;
  state.floatingTexts = [];
  state.spatialBuckets = new Map();
  state.collisionBuckets = new Map();
  state.collisionBucketPool = [];
  state.factionTactics = {};
  for (const faction of ALL_FACTION_SLOTS) state.factionTactics[faction] = createFactionTactics();

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

function enemyAt(id, x, y) {
  return {
    id,
    faction: Faction.RIVAL_1,
    rank: UnitRank.SOLDIER,
    hp: 10,
    maxHp: 10,
    x,
    y,
  };
}

function spawnedChunk(map, unit) {
  const tile = map.worldToTile(unit.x, unit.y);
  return { cx: tile.cx, cy: tile.cy };
}

test('units: caps scale with the number of neighborhoods', () => {
  withUnitsState({ map: { chunks: { size: 100 } } }, () => {
    assertDeepEqual(getUnitCaps(), {
      totalNeighborhoods: 100,
      maxSoldiers: 100,
      maxCaptains: 20,
      maxUnderbosses: 10,
    });
  });
  withUnitsState({ map: { chunks: { size: 0 } }, currentGridSize: 10 }, () => {
    assertEqual(getUnitCaps().totalNeighborhoods, 100);
  });
  withUnitsState({ map: { chunks: { size: 0 } }, currentGridSize: 3 }, () => {
    assertEqual(getUnitCaps().totalNeighborhoods, 25);
  });
});

test('units: tier caps scale by grid side with tier minimums', () => {
  withUnitsState({ map: { chunks: { size: 25 } } }, () => {
    assertDeepEqual(getUnitCaps(), {
      totalNeighborhoods: 25,
      maxSoldiers: 50,
      maxCaptains: 10,
      maxUnderbosses: 5,
    });
  });

  withUnitsState({ map: { chunks: { size: 625 } } }, () => {
    assertDeepEqual(getUnitCaps(), {
      totalNeighborhoods: 625,
      maxSoldiers: 250,
      maxCaptains: 50,
      maxUnderbosses: 25,
    });
  });

  withUnitsState(
    {
      map: { chunks: { size: 25 } },
      playerSpawnCaps: {
        [UnitRank.SOLDIER]: 0,
        [UnitRank.CAPTAIN]: 0,
        [UnitRank.UNDERBOSS]: 0,
      },
    },
    () => {
      clampPlayerSpawnCaps();
      assertEqual(state.playerSpawnCaps[UnitRank.SOLDIER], 10);
      assertEqual(state.playerSpawnCaps[UnitRank.CAPTAIN], 2);
      assertEqual(state.playerSpawnCaps[UnitRank.UNDERBOSS], 1);
    }
  );
});

test('units: match-configured caps lower the grid ceiling', () => {
  withUnitsState(
    {
      map: { chunks: { size: 225 } },
      matchUnitCaps: { maxSoldiers: 140, maxCaptains: 20, maxUnderbosses: 10 },
    },
    () => {
      assertDeepEqual(getUnitCaps(), {
        totalNeighborhoods: 225,
        maxSoldiers: 140,
        maxCaptains: 20,
        maxUnderbosses: 10,
      });
    }
  );

  withUnitsState(
    {
      map: { chunks: { size: 225 } },
      matchUnitCaps: { maxSoldiers: 999, maxCaptains: 999, maxUnderbosses: 999 },
    },
    () => {
      assertDeepEqual(getUnitCaps(), {
        totalNeighborhoods: 225,
        maxSoldiers: 150,
        maxCaptains: 30,
        maxUnderbosses: 15,
      });
    }
  );
});

test('units: clamp keeps player spawn caps within hard limits and above 1', () => {
  withUnitsState(
    {
      map: { chunks: { size: 100 } },
      playerSpawnCaps: { [UnitRank.SOLDIER]: 999, [UnitRank.CAPTAIN]: 0, [UnitRank.UNDERBOSS]: 5 },
    },
    () => {
      clampPlayerSpawnCaps();
      assertEqual(state.playerSpawnCaps[UnitRank.SOLDIER], 100);
      assertEqual(state.playerSpawnCaps[UnitRank.CAPTAIN], 2);
      assertEqual(state.playerSpawnCaps[UnitRank.UNDERBOSS], 5);
    }
  );
});

test('units: default caps give every faction the full quota', () => {
  withUnitsState(
    {
      map: { chunks: { size: 100 } },
      net: { isHumanFaction: (faction) => faction === Faction.RIVAL_1 },
    },
    () => {
      resetDefaultPlayerSpawnCaps();
      assertEqual(state.playerSpawnCaps[UnitRank.SOLDIER], 100);
      assertEqual(state.playerSpawnCaps[UnitRank.CAPTAIN], 20);
      assertEqual(state.playerSpawnCaps[UnitRank.UNDERBOSS], 10);

      const prefs = state.factionRecruitmentPrefs;
      assertEqual(prefs[Faction.PLAYER].caps[UnitRank.SOLDIER], 100);
      assertEqual(prefs[Faction.RIVAL_1].caps[UnitRank.SOLDIER], 100);
      assertEqual(prefs[Faction.RIVAL_2].caps[UnitRank.SOLDIER], 100);
      assertEqual(prefs[Faction.RIVAL_2].caps[UnitRank.CAPTAIN], 20);
      assertEqual(prefs[Faction.RIVAL_2].caps[UnitRank.UNDERBOSS], 10);
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
    assertEqual(soldier.hp, 300);
    assertEqual(soldier.maxHp, 300);
    assertEqual(soldier.minDmg, 15);
    assertEqual(soldier.maxDmg, 25);
    assertEqual(soldier.armor, 0);
    assertEqual(soldier.maxArmor, 0);
    assertEqual(soldier.bodyRadius, 11);
    assertEqual(soldier.id, 1);
    assertEqual(soldier.ammo, undefined, 'soldiers do not carry pistol ammo');
    assertEqual(soldier.reloadTimer, undefined, 'soldiers have no reload state');
    assertEqual(state.npcs.length, 1);

    const captain = spawnUnitInChunk(Faction.PLAYER, chunk, UnitRank.CAPTAIN);
    assertEqual(captain.hp, 600);
    assertEqual(captain.minDmg, 20);
    assertEqual(captain.maxDmg, 30);
    assertEqual(captain.bodyRadius, 12);
    assertEqual(captain.id, 2);
    assertEqual(captain.ammo, undefined, 'captains do not carry pistol ammo');
    assertEqual(captain.reloadTimer, undefined, 'captains have no reload state');
  });
});

test('units: underbosses spawn with armor and higher damage', () => {
  withUnitsState({}, ({ map }) => {
    const chunk = map.generateChunk(0, 0);
    const underboss = spawnUnitInChunk(Faction.PLAYER, chunk, UnitRank.UNDERBOSS);
    assertEqual(underboss.hp, 800);
    assertEqual(underboss.armor, 120);
    assertEqual(underboss.maxArmor, 120);
    assertEqual(underboss.minDmg, 25);
    assertEqual(underboss.maxDmg, 35);
    assertEqual(underboss.bodyRadius, 12.8);
    assertEqual(underboss.ammo, 10);
    assertEqual(underboss.reloadTimer, 0);
  });
});

test('units: bosses spawn unarmed at 130 whether AI or human-controlled', () => {
  withUnitsState({}, ({ map }) => {
    const chunk = map.generateChunk(14, 0);
    const boss = spawnUnitInChunk(Faction.RIVAL_1, chunk, UnitRank.BOSS);
    assertEqual(boss.hp, BOSS_MAX_HP);
    assertEqual(boss.maxArmor, MAX_BOSS_ARMOR);
    assertEqual(boss.bodyRadius, 13.5);
    assertEqual(boss.speed, 130);
    assertEqual(boss.humanPeerId, null);
    assertEqual(boss.weapon, 'none');
    assertEqual(boss.pistolOwned, false);
    assertEqual(boss.ammo, 0);
    assertEqual(boss.reloadTimer, 0);
  });
  withUnitsState({ net: { getPeerForFaction: () => 'peer-x' } }, ({ map }) => {
    const chunk = map.generateChunk(14, 0);
    const boss = spawnUnitInChunk(Faction.RIVAL_1, chunk, UnitRank.BOSS);
    assertEqual(boss.speed, 130);
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

test('units: defend reinforcements spawn near the threat and avoid 3+ enemy blocks', () => {
  withUnitsState({ treasuries: { [Faction.PLAYER]: 10000 } }, ({ map }) => {
    const threatened = ownedChunk(map, Faction.PLAYER, 0, 0);
    const safeNear = ownedChunk(map, Faction.PLAYER, 1, 0);
    ownedChunk(map, Faction.PLAYER, 10, 10);
    const enemies = [enemyAt(101, 100, 100), enemyAt(102, 120, 100), enemyAt(103, 140, 100)];
    state.npcs.push(...enemies);
    state.spatialBuckets.set(packChunkKey(0, 0), enemies);

    const record = state.factionTactics[Faction.PLAYER];
    record.globalStance = GLOBAL_STANCE.DEFEND;
    record.threatenedChunks = [threatened];

    assertEqual(recruitUnit(Faction.PLAYER, UnitRank.SOLDIER), true);
    const unit = state.npcs[state.npcs.length - 1];
    const spawn = spawnedChunk(map, unit);
    assertEqual(spawn.cx, safeNear.cx);
    assertEqual(spawn.cy, safeNear.cy);
  });
});

test('units: defend reinforcements spawn on a safe threatened block', () => {
  withUnitsState({ treasuries: { [Faction.PLAYER]: 10000 } }, ({ map }) => {
    const threatened = ownedChunk(map, Faction.PLAYER, 0, 0);
    ownedChunk(map, Faction.PLAYER, 10, 10);

    const record = state.factionTactics[Faction.PLAYER];
    record.globalStance = GLOBAL_STANCE.DEFEND;
    record.threatenedChunks = [threatened];

    assertEqual(recruitUnit(Faction.PLAYER, UnitRank.SOLDIER), true);
    const spawn = spawnedChunk(map, state.npcs[state.npcs.length - 1]);
    assertEqual(spawn.cx, 0);
    assertEqual(spawn.cy, 0);
  });
});

test('units: defend reinforcements without a threat spawn on the nearest owned border', () => {
  withUnitsState({ treasuries: { [Faction.PLAYER]: 10000 } }, ({ map }) => {
    const near = ownedChunk(map, Faction.PLAYER, 0, 0);
    ownedChunk(map, Faction.PLAYER, 10, 10);

    const record = state.factionTactics[Faction.PLAYER];
    record.globalStance = GLOBAL_STANCE.DEFEND;
    record.bossX = near.cx * CHUNK_PX + CHUNK_PX / 2;
    record.bossY = near.cy * CHUNK_PX + CHUNK_PX / 2;

    assertEqual(recruitUnit(Faction.PLAYER, UnitRank.SOLDIER), true);
    const spawn = spawnedChunk(map, state.npcs[state.npcs.length - 1]);
    assertEqual(spawn.cx, 0);
    assertEqual(spawn.cy, 0);
  });
});
test('units: spawning immediately indexes the new unit in spatial buckets', () => {
  withUnitsState({}, ({ map }) => {
    const chunk = ownedChunk(map, Faction.RIVAL_1, 0, 0);
    const unit = spawnUnitInChunk(Faction.RIVAL_1, chunk, UnitRank.SOLDIER);
    assert(unit, 'unit should spawn');
    const bucket = state.spatialBuckets.get(packChunkKey(0, 0));
    assert(bucket && bucket.includes(unit), 'new unit should be visible to same-step collision');
    const cellBucket = state.collisionBuckets.get(
      packCollisionCell(
        Math.floor(unit.x / COLLISION_CELL_PX),
        Math.floor(unit.y / COLLISION_CELL_PX)
      )
    );
    assert(cellBucket && cellBucket.includes(unit), 'new unit should enter the fine collision grid');
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
    { treasuries: { [Faction.PLAYER]: 20000 }, playerSpawnCaps: { [UnitRank.SOLDIER]: 10 } },
    ({ map }) => {
      ownedChunk(map, Faction.PLAYER);
      for (let i = 0; i < 10; i++) {
        assertEqual(recruitUnit(Faction.PLAYER, UnitRank.SOLDIER), true, `soldier ${i + 1}`);
      }
      assertEqual(recruitUnit(Faction.PLAYER, UnitRank.SOLDIER), false);
      assertEqual(state.treasuries[Faction.PLAYER], 20000 - COST_SOLDIER * 10);
    }
  );
});

test('units: remote-human pref caps are honoured', () => {
  withUnitsState(
    {
      treasuries: { [Faction.RIVAL_1]: 20000 },
      net: { isHumanFaction: (faction) => faction === Faction.RIVAL_1 },
    },
    ({ map }) => {
      ownedChunk(map, Faction.RIVAL_1, 14, 0);
      state.factionRecruitmentPrefs[Faction.RIVAL_1].caps[UnitRank.SOLDIER] = 10;
      for (let i = 0; i < 10; i++) {
        assertEqual(recruitUnit(Faction.RIVAL_1, UnitRank.SOLDIER), true, `soldier ${i + 1}`);
      }
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

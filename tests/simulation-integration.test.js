// Simulation integration tests: long fixed-step run, unit/tick sanity, capture and
// boss elimination. These use a real CityMap and initWorld rather than the focused
// per-module fixtures in simulation.test.js.
import { test, assert, assertEqual } from './harness.js';
import { Faction, UnitRank } from '../src/config/enums.js';
import { SIM_DT } from '../src/config/constants.js';
import { FACTION_META } from '../src/config/organizations.js';
import { state } from '../src/core/state.js';
import { CityMap } from '../src/world/city.js';
import { initWorld } from '../src/sim/match.js';
import { update } from '../src/sim/simulation.js';
import { applyDamageToNpc } from '../src/sim/combat.js';

const STATE_KEYS = [
  'world',
  'player',
  'npcs',
  'floatingTexts',
  'spatialBuckets',
  'bucketPool',
  'nextNpcId',
  'treasuries',
  'factionAlive',
  'factionKills',
  'factionDeaths',
  'camera',
  'mouse',
  'keys',
  'sprintButtonHeld',
  'activeFactions',
  'selectedFactionOrgs',
  'activeFactionCount',
  'currentGridSize',
  'tickDuration',
  'currentIncomeTier',
  'currentWorldSeed',
  'playerSpawnCaps',
  'factionRecruitmentPrefs',
  'autoRecruitSoldier',
  'autoRecruitCaptain',
  'autoRecruitUnderboss',
  'gameStarted',
  'isSpectating',
  'gameOver',
  'victoryShown',
  'tickTimer',
  'gameHour',
  'hudUpdateTimer',
  'minimapCacheTimer',
  'net',
];

const ORGS = ['COSA_NOSTRA', 'BRATVA', 'TRIADS', 'CARTEL'];

function withIntegrationState(fn) {
  const saved = {};
  for (const key of STATE_KEYS) saved[key] = state[key];
  const savedMeta = {};
  for (const faction of [Faction.PLAYER, Faction.RIVAL_1, Faction.RIVAL_2, Faction.RIVAL_3]) {
    savedMeta[faction] = { ...FACTION_META[faction] };
  }

  state.world = new CityMap();
  state.npcs = [];
  state.floatingTexts = [];
  state.spatialBuckets = new Map();
  state.bucketPool = [];
  state.keys = new Set();
  state.net = null;

  try {
    return fn();
  } finally {
    for (const key of STATE_KEYS) state[key] = saved[key];
    for (const faction of Object.keys(savedMeta)) FACTION_META[faction] = savedMeta[faction];
  }
}

function startIntegrationMatch(seed, factionCount = 4) {
  initWorld(5, true, 10, 'HIGH', factionCount, ORGS, seed);
  state.net = null;
  state.autoRecruitSoldier = false;
  state.autoRecruitCaptain = false;
  state.autoRecruitUnderboss = false;
}

function assertFiniteUnit(unit) {
  assert(Number.isFinite(unit.x) && Number.isFinite(unit.y), `unit ${unit.id} has non-finite position`);
  assert(Number.isFinite(unit.hp), `unit ${unit.id} has non-finite hp`);
  assert(Number.isFinite(unit.armor), `unit ${unit.id} has non-finite armor`);
  assert(Number.isFinite(unit.attackCooldown), `unit ${unit.id} has non-finite attack cooldown`);
  assert(Number.isFinite(unit.slashAnimTimer), `unit ${unit.id} has non-finite slash timer`);
  assert(Number.isFinite(unit.sprintTimer), `unit ${unit.id} has non-finite sprint timer`);
  assert(Number.isFinite(unit.sprintCooldown), `unit ${unit.id} has non-finite sprint cooldown`);
}

test('integration: 600 fixed steps keep units valid, walkable and shop-active', () => {
  withIntegrationState(() => {
    startIntegrationMatch(4242, 4);

    for (let i = 0; i < 600; i++) update(SIM_DT);

    const units = [state.player, ...state.npcs];
    for (const unit of units) {
      assertFiniteUnit(unit);
      assert(
        state.world.isWalkable(unit.x, unit.y),
        `unit ${unit.id} left the walkable map at ${unit.x.toFixed(1)},${unit.y.toFixed(1)}`
      );
    }

    const rivalBosses = state.npcs.filter((unit) => unit.rank === UnitRank.BOSS);
    assert(rivalBosses.length > 0, 'expected at least one rival boss');
    for (const boss of rivalBosses) {
      assertEqual(boss.weapon, 'pistol', `${boss.faction} boss should buy the Glock`);
      assertEqual(boss.pistolOwned, true, `${boss.faction} boss Glock ownership`);
      assert(
        boss.ammo > 0 || (boss.reloadTimer || 0) > 0,
        `${boss.faction} boss should buy ammo and reload`
      );
    }

    for (const faction of state.activeFactions) {
      assert(Number.isFinite(state.treasuries[faction]), `${faction} treasury is not finite`);
    }
    assertEqual(state.player.weapon, 'none', 'idle player buys nothing automatically');
    assertEqual(state.player.pistolOwned, false);
    assert(Number.isFinite(state.tickTimer));
    assert(Math.abs(state.tickTimer - 5) < 0.05, `tickTimer=${state.tickTimer}`);
    assertEqual(state.gameHour, 19);
    assertEqual(state.gameOver, false);
  });
});

test('integration: capture completes through the fixed update', () => {
  withIntegrationState(() => {
    startIntegrationMatch(777, 2);
    const tile = state.world.worldToTile(state.player.x, state.player.y);
    const chunk = state.world.getChunk(tile.cx, tile.cy);
    chunk.faction = Faction.NEUTRAL;
    chunk.capturingFaction = Faction.PLAYER;
    chunk.captureProgress = 0.999;

    update(0.1);

    assertEqual(chunk.faction, Faction.PLAYER);
    assertEqual(chunk.captureProgress, 0);
    assertEqual(chunk.capturingFaction, null);
  });
});

test('integration: killing a rival boss eliminates its faction', () => {
  withIntegrationState(() => {
    startIntegrationMatch(999, 4);
    const boss = state.npcs.find((n) => n.rank === UnitRank.BOSS);
    assert(boss, 'expected a rival boss');
    const faction = boss.faction;
    assertEqual(state.factionAlive[faction], true);

    applyDamageToNpc(boss, 99999, '#fff', '', null, Faction.PLAYER);

    assertEqual(state.factionAlive[faction], false);
    assertEqual(state.treasuries[faction], 0);
    assert(!state.npcs.includes(boss), 'dead boss should leave the roster');
  });
});


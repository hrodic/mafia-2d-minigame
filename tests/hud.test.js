// HUD tests: top-bar values, armor/sprint states, standings and recruit labels.
import { test, assert, assertEqual } from './harness.js';
import { Faction, UnitRank } from '../src/config/enums.js';
import { BOSS_MAX_HP } from '../src/config/balance.js';
import { state } from '../src/core/state.js';
import { updateHUD, syncRecruitButtonLabels } from '../src/ui/hud.js';

const KEYS = [
  'world',
  'player',
  'npcs',
  'treasuries',
  'factionAlive',
  'factionKills',
  'activeFactions',
  'gameHour',
  'tickTimer',
  'tickDuration',
  'autoRecruitSoldier',
  'autoRecruitCaptain',
  'autoRecruitUnderboss',
  'playerSpawnCaps',
  'net',
];

function makeWorld() {
  const chunks = new Map();
  chunks.set('0,0', { cx: 0, cy: 0, faction: Faction.PLAYER, income: 1000 });
  chunks.set('1,0', { cx: 1, cy: 0, faction: Faction.RIVAL_1, income: 500 });
  return { chunks };
}

function makePlayer(overrides = {}) {
  return {
    id: 0,
    faction: Faction.PLAYER,
    rank: UnitRank.BOSS,
    control: 'local',
    bodyRadius: 13.5,
    x: 0,
    y: 0,
    hp: 200,
    maxHp: BOSS_MAX_HP,
    armor: 0,
    maxArmor: 300,
    alive: true,
    sprintCooldown: 0,
    sprintTimer: 0,
    isSprinting: false,
    ...overrides,
  };
}

function withHudState(opts, fn) {
  const saved = {};
  for (const key of KEYS) saved[key] = state[key];

  state.world = opts.world || makeWorld();
  state.player = opts.player || makePlayer();
  state.npcs = opts.npcs || [];
  state.treasuries = { ...saved.treasuries, ...(opts.treasuries || {}) };
  state.factionAlive = { ...saved.factionAlive, ...(opts.factionAlive || {}) };
  state.factionKills = { ...saved.factionKills, ...(opts.factionKills || {}) };
  state.activeFactions = [Faction.PLAYER, Faction.RIVAL_1, Faction.RIVAL_2, Faction.RIVAL_3];
  state.gameHour = opts.gameHour ?? 5;
  state.tickTimer = opts.tickTimer ?? 5;
  state.tickDuration = opts.tickDuration ?? 10;
  state.autoRecruitSoldier = true;
  state.autoRecruitCaptain = true;
  state.autoRecruitUnderboss = true;
  state.playerSpawnCaps = { ...saved.playerSpawnCaps, ...(opts.playerSpawnCaps || {}) };
  state.net = null;

  try {
    return fn();
  } finally {
    for (const key of KEYS) state[key] = saved[key];
  }
}

test('hud: updateHUD writes HP, armor, cash, clock and territory stats', () => {
  withHudState(
    {
      player: makePlayer({ hp: 200, armor: 100 }),
      treasuries: { [Faction.PLAYER]: 1234 },
      npcs: [
        { faction: Faction.PLAYER, rank: UnitRank.SOLDIER },
        { faction: Faction.RIVAL_1, rank: UnitRank.CAPTAIN },
      ],
    },
    () => {
      updateHUD();
      assertEqual(document.getElementById('hp-text').textContent, '200/400');
      assertEqual(document.getElementById('hp-bar-fill').style.width, '50%');
      assertEqual(document.getElementById('armor-text').textContent, '100');
      assert(!document.getElementById('armor-hud-box').classList.contains('hidden'));
      assertEqual(document.getElementById('cash-text').textContent, '$1,234');
      assertEqual(document.getElementById('hour-text').textContent, '05:00');
      assertEqual(document.getElementById('tick-bar-fill').style.width, '50%');
      const stats = document.getElementById('stats-badge').textContent;
      assert(stats.includes('Turf: 1/2'), stats);
      assert(stats.includes('Crew: 2'), stats);
      const board = document.getElementById('faction-board').textContent;
      assert(board.includes('Cosa Nostra'), board);
      assert(board.includes('(You)'), board);
      assert(board.includes('Bratva'), board);
    }
  );
});

test('hud: leaderboard exposes turf, crew and kills with clear labels', () => {
  withHudState(
    {
      factionKills: { [Faction.PLAYER]: 4, [Faction.RIVAL_1]: 2 },
      npcs: [{ faction: Faction.PLAYER, rank: UnitRank.SOLDIER }],
    },
    () => {
      updateHUD();
      const board = document.getElementById('faction-board').textContent;
      assert(board.includes('Faction Leaderboard'), board);
      assert(board.includes('Turf'), board);
      assert(board.includes('Crew'), board);
      assert(board.includes('Kills'), board);
      assert(board.includes('4'), board);
      assert(board.includes('2'), board);
    }
  );
});

test('hud: armor hides when depleted and sprint states are labelled', () => {
  withHudState({ player: makePlayer({ armor: 0, sprintCooldown: 2 }) }, () => {
    updateHUD();
    assert(document.getElementById('armor-hud-box').classList.contains('hidden'));
    assertEqual(document.getElementById('sprint-text').textContent, '2.0s');
    assertEqual(document.getElementById('sprint-bar-fill').style.width, '50%');
  });
  withHudState({ player: makePlayer({ isSprinting: true, sprintTimer: 1 }) }, () => {
    updateHUD();
    assertEqual(document.getElementById('sprint-text').textContent, 'RUN');
  });
  withHudState({}, () => {
    updateHUD();
    assertEqual(document.getElementById('sprint-text').textContent, 'RDY');
    assertEqual(document.getElementById('sprint-bar-fill').style.width, '100%');
  });
});

test('hud: a dead local boss shows zero HP and no armor', () => {
  withHudState({ player: makePlayer({ alive: false, hp: 0, armor: 100 }) }, () => {
    updateHUD();
    assertEqual(document.getElementById('hp-text').textContent, '0/400');
    assert(document.getElementById('armor-hud-box').classList.contains('hidden'));
  });
});

test('hud: recruit labels reflect toggles and caps', () => {
  withHudState(
    {
      world: { chunks: { size: 225 } },
      playerSpawnCaps: {
        [UnitRank.SOLDIER]: 11,
        [UnitRank.CAPTAIN]: 2,
        [UnitRank.UNDERBOSS]: 1,
      },
    },
    () => {
      syncRecruitButtonLabels();
      const soldier = document.getElementById('btn-toggle-soldier').textContent;
      assert(soldier.includes('Soldato'), soldier);
      assert(soldier.includes('ON'), soldier);
      assertEqual(document.getElementById('cap-soldier-label').textContent, '11/192');
      assertEqual(document.getElementById('cap-captain-label').textContent, '2/22');
      assertEqual(document.getElementById('cap-underboss-label').textContent, '1/11');
    }
  );
});

// HUD tests: top-bar values, armor/sprint states, standings and recruit labels.
import { test, assert, assertEqual } from './harness.js';
import { Faction, UnitRank } from '../src/config/enums.js';
import { BOSS_MAX_HP } from '../src/config/balance.js';
import { state } from '../src/core/state.js';
import {
  updateHUD,
  syncRecruitButtonLabels,
  toggleCrewPanel,
  toggleFactionBoard,
  setRecruitCapMin,
  setRecruitCapMax,
} from '../src/ui/hud.js';

const KEYS = [
  'world',
  'player',
  'npcs',
  'treasuries',
  'factionAlive',
  'factionKills',
  'factionDeaths',
  'activeFactions',
  'gameHour',
  'tickTimer',
  'tickDuration',
  'autoRecruitSoldier',
  'autoRecruitCaptain',
  'autoRecruitUnderboss',
  'playerSpawnCaps',
  'matchUnitCaps',
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
  state.factionDeaths = { ...saved.factionDeaths, ...(opts.factionDeaths || {}) };
  state.activeFactions = [Faction.PLAYER, Faction.RIVAL_1, Faction.RIVAL_2, Faction.RIVAL_3];
  state.gameHour = opts.gameHour ?? 5;
  state.tickTimer = opts.tickTimer ?? 5;
  state.tickDuration = opts.tickDuration ?? 10;
  state.autoRecruitSoldier = true;
  state.autoRecruitCaptain = true;
  state.autoRecruitUnderboss = true;
  state.playerSpawnCaps = { ...saved.playerSpawnCaps, ...(opts.playerSpawnCaps || {}) };
  state.matchUnitCaps = opts.matchUnitCaps ? { ...opts.matchUnitCaps } : null;
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
      assertEqual(document.getElementById('hp-text').textContent, '200/800');
      assertEqual(document.getElementById('hp-bar-fill').style.transform, 'scaleX(0.25)');
      assertEqual(document.getElementById('hp-bar-fill').style.width, '');
      assertEqual(document.getElementById('armor-text').textContent, '100');
      assert(!document.getElementById('armor-hud-box').classList.contains('hidden'));
      assertEqual(document.getElementById('armor-bar-fill').style.transform, 'scaleX(0.333333)');
      assertEqual(document.getElementById('cash-text').textContent, '$1,234');
      assertEqual(document.getElementById('hour-text').textContent, '05:00');
      assertEqual(document.getElementById('tick-bar-fill').style.transform, 'scaleX(0.5)');
      assertEqual(document.getElementById('tick-bar-fill').style.width, '');
      const stats = document.getElementById('stats-badge').textContent;
      assert(stats.includes('Turf: 1/2'), stats);
      assert(stats.includes('Crew: 2'), stats);
      assertEqual(document.getElementById('mgmt-total-upkeep').textContent, '-$50/hr');
      assertEqual(document.getElementById('mgmt-total-gross').textContent, '+$1,000/hr');
      assertEqual(document.getElementById('mgmt-total-turf').textContent, '1/2');
      assertEqual(document.getElementById('mgmt-total-crew').textContent, '2');
      assertEqual(document.getElementById('mgmt-total-corruption').textContent, '$0 (0%)');
      assertEqual(document.getElementById('mgmt-corruption-breakdown').textContent, 'Turf 0% · Crew 0%');
      assertEqual(document.getElementById('mgmt-total-net').textContent, '+$950/hr');
      const board = document.getElementById('faction-board').textContent;
      assert(board.includes('Cosa Nostra'), board);
      assert(board.includes('(You)'), board);
      assert(board.includes('Bratva'), board);
    }
  );
});

test('hud: leaderboard exposes turf, kills and deaths with clear labels', () => {
  withHudState(
    {
      factionKills: { [Faction.PLAYER]: 4, [Faction.RIVAL_1]: 2 },
      factionDeaths: { [Faction.PLAYER]: 1, [Faction.RIVAL_1]: 3 },
      npcs: [{ faction: Faction.PLAYER, rank: UnitRank.SOLDIER }],
    },
    () => {
      updateHUD();
      const board = document.getElementById('faction-board').textContent;
      assert(board.includes('Faction Leaderboard'), board);
      assert(board.includes('Turf'), board);
      assert(board.includes('Kills'), board);
      assert(board.includes('Deaths'), board);
      assert(!board.includes('Crew'), 'leaderboard should not expose crew counts');
      assert(board.includes('4'), board);
      assert(board.includes('3'), board);
    }
  );
});

test('hud: leaderboard escapes peer aliases instead of parsing HTML', () => {
  withHudState({}, () => {
    state.net = {
      isActive: () => true,
      getAliasForFaction: (f) => (f === Faction.PLAYER ? '<img src=x>' : null),
    };
    updateHUD();
    const board = document.getElementById('faction-board');
    assertEqual(board.querySelector('img'), null);
    assert(board.textContent.includes('<img src=x>'), board.textContent);
  });
});

test('hud: faction leaderboard collapses to its header and restores', () => {
  withHudState({}, () => {
    updateHUD();
    const body = document.getElementById('faction-board-body');
    const button = document.getElementById('btn-faction-collapse');
    toggleFactionBoard(true);
    assert(body.classList.contains('hidden'));
    assertEqual(button.getAttribute('aria-expanded'), 'false');
    assertEqual(button.textContent, '▾');
    toggleFactionBoard(false);
    assert(!body.classList.contains('hidden'));
    assertEqual(button.getAttribute('aria-expanded'), 'true');
    assertEqual(button.textContent, '▴');
  });
});

test('hud: corruption breakdown combines turf and crew penalties', () => {
  const chunks = new Map();
  for (let i = 0; i < 10; i++) {
    chunks.set(`p${i}`, { faction: Faction.PLAYER, income: 100 });
  }
  withHudState(
    {
      world: { chunks },
      npcs: Array.from({ length: 24 }, () => ({
        faction: Faction.PLAYER,
        rank: UnitRank.SOLDIER,
      })),
      treasuries: { [Faction.PLAYER]: 5000 },
    },
    () => {
      updateHUD();
      assertEqual(document.getElementById('mgmt-total-turf').textContent, '10/10');
      assertEqual(document.getElementById('mgmt-total-crew').textContent, '25');
      assertEqual(document.getElementById('mgmt-total-gross').textContent, '+$1,000/hr');
      assertEqual(document.getElementById('mgmt-total-upkeep').textContent, '-$1,200/hr');
      assertEqual(document.getElementById('mgmt-total-corruption').textContent, '-$20 (2%)');
      assertEqual(document.getElementById('mgmt-corruption-breakdown').textContent, 'Turf 1% · Crew 1%');
      assertEqual(document.getElementById('mgmt-total-net').textContent, '-$220/hr');
    }
  );
});

test('hud: negative cash is formatted and marked', () => {
  withHudState({ treasuries: { [Faction.PLAYER]: -450 } }, () => {
    updateHUD();
    assertEqual(document.getElementById('cash-text').textContent, '-$450');
    assert(document.getElementById('cash-text').classList.contains('is-negative'));
  });
});

test('hud: armor hides when depleted and sprint states are labelled', () => {
  withHudState({ player: makePlayer({ armor: 0, sprintCooldown: 2 }) }, () => {
    updateHUD();
    assert(document.getElementById('armor-hud-box').classList.contains('hidden'));
    assertEqual(document.getElementById('sprint-text').textContent, '2.0s');
    assertEqual(document.getElementById('sprint-bar-fill').style.transform, 'scaleX(0.5)');
    assertEqual(document.getElementById('sprint-bar-fill').style.width, '');
  });
  withHudState({ player: makePlayer({ isSprinting: true, sprintTimer: 1 }) }, () => {
    updateHUD();
    assertEqual(document.getElementById('sprint-text').textContent, 'RUN');
  });
  withHudState({}, () => {
    updateHUD();
    assertEqual(document.getElementById('sprint-text').textContent, 'RDY');
    assertEqual(document.getElementById('sprint-bar-fill').style.transform, 'scaleX(1)');
  });
});

test('hud: a dead local boss shows zero HP and no armor', () => {
  withHudState({ player: makePlayer({ alive: false, hp: 0, armor: 100 }) }, () => {
    updateHUD();
    assertEqual(document.getElementById('hp-text').textContent, '0/800');
    assert(document.getElementById('armor-hud-box').classList.contains('hidden'));
  });
});

test('hud: rank headers show living crew counts', () => {
  withHudState(
    {
      npcs: [
        { faction: Faction.PLAYER, rank: UnitRank.SOLDIER },
        { faction: Faction.PLAYER, rank: UnitRank.SOLDIER },
        { faction: Faction.PLAYER, rank: UnitRank.SOLDIER },
        { faction: Faction.PLAYER, rank: UnitRank.CAPTAIN },
        { faction: Faction.RIVAL_1, rank: UnitRank.SOLDIER },
      ],
    },
    () => {
      updateHUD();
      assertEqual(document.getElementById('mgmt-alive-soldier').textContent, '(3 alive)');
      assertEqual(document.getElementById('mgmt-alive-captain').textContent, '(1 alive)');
      assertEqual(document.getElementById('mgmt-alive-underboss').textContent, '(0 alive)');
    }
  );
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
      const soldier = document.getElementById('btn-toggle-soldier');
      assertEqual(soldier.getAttribute('aria-checked'), 'true');
      assert(soldier.classList.contains('is-on'));
      assertEqual(document.getElementById('mgmt-rank-soldier').textContent, 'Soldato');
      assertEqual(document.getElementById('mgmt-auto-soldier').textContent, 'ON');
      assertEqual(document.getElementById('cap-soldier-label').textContent, '11/150');
      assertEqual(document.getElementById('cap-captain-label').textContent, '2/30');
      assertEqual(document.getElementById('cap-underboss-label').textContent, '1/15');

      state.autoRecruitSoldier = false;
      syncRecruitButtonLabels();
      assertEqual(soldier.getAttribute('aria-checked'), 'false');
      assert(!soldier.classList.contains('is-on'));
      assertEqual(document.getElementById('mgmt-auto-soldier').textContent, 'OFF');
    }
  );
});

test('hud: recruit cap controls disable at limits and when unaffordable', () => {
  withHudState(
    {
      world: { chunks: { size: 225 } },
      playerSpawnCaps: {
        [UnitRank.SOLDIER]: 192,
        [UnitRank.CAPTAIN]: 2,
        [UnitRank.UNDERBOSS]: 1,
      },
      treasuries: { [Faction.PLAYER]: 1000 },
    },
    () => {
      syncRecruitButtonLabels();
      assertEqual(document.getElementById('btn-cap-soldier-inc').disabled, true);
      assertEqual(document.getElementById('btn-cap-soldier-max').disabled, true);
      assertEqual(document.getElementById('btn-cap-soldier-dec').disabled, false);
      assertEqual(document.getElementById('btn-cap-soldier-min').disabled, false);
      assertEqual(document.getElementById('btn-cap-captain-inc').disabled, false);
      assertEqual(document.getElementById('btn-cap-captain-max').disabled, false);
      assertEqual(document.getElementById('btn-cap-underboss-inc').disabled, false);
      assertEqual(document.getElementById('btn-cap-underboss-max').disabled, false);
      assertEqual(document.getElementById('btn-cap-underboss-dec').disabled, true);
      assertEqual(document.getElementById('btn-cap-underboss-min').disabled, true);
    }
  );

  withHudState(
    {
      world: { chunks: { size: 225 } },
      playerSpawnCaps: {
        [UnitRank.SOLDIER]: 11,
        [UnitRank.CAPTAIN]: 2,
        [UnitRank.UNDERBOSS]: 1,
      },
      treasuries: { [Faction.PLAYER]: 10000 },
    },
    () => {
      syncRecruitButtonLabels();
      assertEqual(document.getElementById('btn-cap-soldier-inc').disabled, false);
      assertEqual(document.getElementById('btn-cap-captain-inc').disabled, false);
      assertEqual(document.getElementById('btn-cap-underboss-inc').disabled, false);
      assertEqual(document.getElementById('btn-cap-captain-dec').disabled, true);
      assertEqual(document.getElementById('btn-cap-captain-min').disabled, true);
      assertEqual(document.getElementById('btn-cap-underboss-dec').disabled, true);
    }
  );
});

test('hud: cap controls ignore cash because they set target states', () => {
  withHudState(
    {
      world: { chunks: { size: 225 } },
      playerSpawnCaps: {
        [UnitRank.SOLDIER]: 11,
        [UnitRank.CAPTAIN]: 2,
        [UnitRank.UNDERBOSS]: 1,
      },
      treasuries: { [Faction.PLAYER]: 0 },
    },
    () => {
      syncRecruitButtonLabels();
      assertEqual(document.getElementById('btn-cap-soldier-inc').disabled, false);
      assertEqual(document.getElementById('btn-cap-captain-inc').disabled, false);
      assertEqual(document.getElementById('btn-cap-underboss-inc').disabled, false);
    }
  );
});

test('hud: crew cap shortcuts jump to min and max in one action', () => {
  withHudState(
    {
      world: { chunks: { size: 225 } },
      playerSpawnCaps: {
        [UnitRank.SOLDIER]: 11,
        [UnitRank.CAPTAIN]: 2,
        [UnitRank.UNDERBOSS]: 1,
      },
      treasuries: { [Faction.PLAYER]: 10000 },
    },
    () => {
      setRecruitCapMin(UnitRank.SOLDIER);
      assertEqual(state.playerSpawnCaps[UnitRank.SOLDIER], 10);
      assertEqual(document.getElementById('btn-cap-soldier-dec').disabled, true);
      assertEqual(document.getElementById('btn-cap-soldier-min').disabled, true);

      setRecruitCapMax(UnitRank.SOLDIER);
      assertEqual(state.playerSpawnCaps[UnitRank.SOLDIER], 150);
      assertEqual(document.getElementById('btn-cap-soldier-inc').disabled, true);
      assertEqual(document.getElementById('btn-cap-soldier-max').disabled, true);
    }
  );
});

test('hud: crew panel collapses to the summary line and restores', () => {
  const panel = document.getElementById('management-panel');
  const body = document.getElementById('management-body');
  const button = document.getElementById('btn-management-collapse');

  body.classList.remove('hidden');
  panel.classList.remove('is-collapsed');
  button.setAttribute('aria-expanded', 'true');
  toggleCrewPanel(true);
  assert(body.classList.contains('hidden'));
  assert(panel.classList.contains('is-collapsed'));
  assertEqual(button.getAttribute('aria-expanded'), 'false');
  assertEqual(button.textContent, '▾');

  toggleCrewPanel(false);
  assert(!body.classList.contains('hidden'));
  assert(!panel.classList.contains('is-collapsed'));
  assertEqual(button.getAttribute('aria-expanded'), 'true');
  assertEqual(button.textContent, '▴');
});

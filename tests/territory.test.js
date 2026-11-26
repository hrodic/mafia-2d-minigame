// Territory tests: capture progress, faction elimination and victory handling.
import { test, assert, assertEqual } from './harness.js';
import { Faction, UnitRank } from '../src/config/enums.js';
import { state } from '../src/core/state.js';
import { runtime } from '../src/core/runtime.js';
import {
  CAPTURE_RATES,
  getCaptureRate,
  progressCapture,
  onChunkCaptured,
  checkVictoryCondition,
  eliminateFaction,
} from '../src/sim/territory.js';

const STATE_KEYS = [
  'world',
  'factionAlive',
  'treasuries',
  'npcs',
  'player',
  'gameOver',
  'victoryShown',
  'activeFactions',
  'net',
  'minimapCacheTimer',
  'floatingTexts',
];

function makeWorld(chunks = []) {
  const map = new Map();
  for (const chunk of chunks) map.set(`${chunk.cx},${chunk.cy}`, chunk);
  return { chunks: map };
}

function makeChunk(cx, cy, faction = Faction.NEUTRAL) {
  return { cx, cy, faction, captureProgress: 0, capturingFaction: null, income: 1000 };
}

function withTerritoryState(opts, fn) {
  const saved = {};
  for (const key of STATE_KEYS) saved[key] = state[key];

  state.world = opts.world || makeWorld([makeChunk(0, 0, Faction.PLAYER)]);
  state.factionAlive = { ...saved.factionAlive, ...(opts.factionAlive || {}) };
  state.treasuries = { ...saved.treasuries, ...(opts.treasuries || {}) };
  state.npcs = opts.npcs || [];
  state.player = { ...saved.player, alive: true, ...(opts.player || {}) };
  state.gameOver = opts.gameOver ?? false;
  state.victoryShown = opts.victoryShown ?? false;
  state.activeFactions = [...(opts.activeFactions || [Faction.PLAYER, Faction.RIVAL_1, Faction.RIVAL_2, Faction.RIVAL_3])];
  state.net = opts.net || null;
  state.minimapCacheTimer = 0;
  state.floatingTexts = [];

  const calls = { victory: [], defeat: 0, eliminated: [], hud: 0 };
  const original = {
    onVictory: runtime.onVictory,
    onDefeat: runtime.onDefeat,
    onFactionEliminated: runtime.onFactionEliminated,
    updateHUD: runtime.updateHUD,
  };
  runtime.onVictory = (summary) => calls.victory.push(summary);
  runtime.onDefeat = () => {
    calls.defeat++;
  };
  runtime.onFactionEliminated = (faction) => calls.eliminated.push(faction);
  runtime.updateHUD = () => {
    calls.hud++;
  };

  try {
    return fn({ calls });
  } finally {
    runtime.onVictory = original.onVictory;
    runtime.onDefeat = original.onDefeat;
    runtime.onFactionEliminated = original.onFactionEliminated;
    runtime.updateHUD = original.updateHUD;
    for (const key of STATE_KEYS) state[key] = saved[key];
  }
}

test('territory: capture rates match the unit hierarchy', () => {
  assertEqual(CAPTURE_RATES[UnitRank.BOSS], 0.375);
  assertEqual(getCaptureRate(UnitRank.BOSS), 0.375);
  assertEqual(getCaptureRate(UnitRank.UNDERBOSS), 0.24);
  assertEqual(getCaptureRate(UnitRank.CAPTAIN), 0.18);
  assertEqual(getCaptureRate(UnitRank.SOLDIER), 0.12);
  assertEqual(getCaptureRate('UNKNOWN'), 0.12);
});

test('territory: capture fills progress and flips the chunk when complete', () => {
  withTerritoryState({}, () => {
    const chunk = makeChunk(0, 0, Faction.NEUTRAL);
    assertEqual(progressCapture(chunk, Faction.PLAYER, 1, 0.375), false);
    assertEqual(chunk.captureProgress, 0.375);
    assertEqual(chunk.capturingFaction, Faction.PLAYER);
    assertEqual(progressCapture(chunk, Faction.PLAYER, 1, 0.375), false);
    assertEqual(progressCapture(chunk, Faction.PLAYER, 1, 0.375), true);
    assertEqual(chunk.faction, Faction.PLAYER);
    assertEqual(chunk.captureProgress, 0);
    assertEqual(chunk.capturingFaction, null);
  });
});

test('territory: a different capturer resets progress', () => {
  withTerritoryState({}, () => {
    const chunk = makeChunk(0, 0, Faction.NEUTRAL);
    progressCapture(chunk, Faction.PLAYER, 1, 0.375);
    assertEqual(chunk.captureProgress, 0.375);
    progressCapture(chunk, Faction.RIVAL_1, 0.5, 0.24);
    assertEqual(chunk.capturingFaction, Faction.RIVAL_1);
    assertEqual(chunk.captureProgress, 0.12);
  });
});

test('territory: own chunks and dead factions cannot capture', () => {
  withTerritoryState({ factionAlive: { [Faction.RIVAL_1]: false } }, () => {
    const own = makeChunk(0, 0, Faction.PLAYER);
    assertEqual(progressCapture(own, Faction.PLAYER, 1, 0.375), false);
    assertEqual(own.captureProgress, 0);

    const neutral = makeChunk(1, 0, Faction.NEUTRAL);
    assertEqual(progressCapture(neutral, Faction.RIVAL_1, 1, 0.375), false);
    assertEqual(neutral.captureProgress, 0);
  });
});

test('territory: captured chunks float a turf label and refresh presentation', () => {
  withTerritoryState({}, ({ calls }) => {
    const chunk = makeChunk(2, 3, Faction.PLAYER);
    onChunkCaptured(chunk, Faction.PLAYER);
    assertEqual(state.floatingTexts.length, 1);
    assert(state.floatingTexts[0].text.includes('TURF'));
    assertEqual(state.floatingTexts[0].color, '#34d399');
    assertEqual(state.minimapCacheTimer, 1.0);
    assertEqual(calls.hud, 1);
  });
});

test('territory: eliminating a rival neutralizes their turf and captures', () => {
  const owned = makeChunk(1, 0, Faction.RIVAL_1);
  const capturing = makeChunk(2, 0, Faction.PLAYER);
  capturing.capturingFaction = Faction.RIVAL_1;
  capturing.captureProgress = 0.5;
  withTerritoryState(
    {
      world: makeWorld([makeChunk(0, 0, Faction.PLAYER), owned, capturing]),
      treasuries: { [Faction.RIVAL_1]: 500 },
    },
    ({ calls }) => {
      eliminateFaction(Faction.RIVAL_1);
      assertEqual(state.factionAlive[Faction.RIVAL_1], false);
      assertEqual(state.treasuries[Faction.RIVAL_1], 0);
      assertEqual(owned.faction, Faction.NEUTRAL);
      assertEqual(owned.captureProgress, 0);
      assertEqual(owned.capturingFaction, null);
      assertEqual(capturing.capturingFaction, null);
      assertEqual(capturing.captureProgress, 0);
      assertEqual(calls.eliminated.length, 1);
      assertEqual(calls.eliminated[0], Faction.RIVAL_1);
      assertEqual(calls.defeat, 0);
      assertEqual(state.gameOver, false);
      assertEqual(calls.hud, 1);
    }
  );
});

test('territory: eliminating the local boss ends the match in defeat', () => {
  withTerritoryState({ player: { alive: true } }, ({ calls }) => {
    eliminateFaction(Faction.PLAYER);
    assertEqual(state.player.alive, false);
    assertEqual(state.gameOver, true);
    assertEqual(calls.defeat, 1);
    assertEqual(calls.eliminated.length, 0);
    assertEqual(calls.victory.length, 0);
  });
});

test('territory: victory fires once when the last rival falls', () => {
  withTerritoryState(
    {
      treasuries: { [Faction.PLAYER]: 4321 },
      npcs: [
        { faction: Faction.PLAYER, rank: UnitRank.SOLDIER },
        { faction: Faction.PLAYER, rank: UnitRank.CAPTAIN },
      ],
    },
    ({ calls }) => {
      eliminateFaction(Faction.RIVAL_1);
      assertEqual(calls.victory.length, 0);
      eliminateFaction(Faction.RIVAL_2);
      assertEqual(calls.victory.length, 0);
      eliminateFaction(Faction.RIVAL_3);
      assertEqual(calls.victory.length, 1, 'victory should fire when the last rival is eliminated');
      assertEqual(state.victoryShown, true);
      const summary = calls.victory[0];
      assert(summary.includes('Cosa Nostra'), `summary missing org name: ${summary}`);
      assert(summary.includes('1/1 neighborhoods'), `summary missing turf count: ${summary}`);
      assert(summary.includes('$4,321'), `summary missing treasury: ${summary}`);
      assert(summary.includes('2 surviving crew'), `summary missing crew count: ${summary}`);

      eliminateFaction(Faction.PLAYER);
      assertEqual(calls.victory.length, 1, 'victory must not repeat');
    }
  );
});

test('territory: no victory while a rival is alive or the local boss is dead', () => {
  withTerritoryState({}, ({ calls }) => {
    checkVictoryCondition();
    assertEqual(calls.victory.length, 0);
  });
  withTerritoryState(
    {
      factionAlive: {
        [Faction.RIVAL_1]: false,
        [Faction.RIVAL_2]: false,
        [Faction.RIVAL_3]: false,
      },
      gameOver: true,
    },
    ({ calls }) => {
      checkVictoryCondition();
      assertEqual(calls.victory.length, 0);
    }
  );
});

test('territory: multiplayer guest wins for its own rival syndicate', () => {
  withTerritoryState(
    {
      net: { isActive: () => true, localFaction: Faction.RIVAL_1 },
      factionAlive: {
        [Faction.PLAYER]: false,
        [Faction.RIVAL_1]: true,
        [Faction.RIVAL_2]: false,
        [Faction.RIVAL_3]: false,
      },
    },
    ({ calls }) => {
      checkVictoryCondition();
      assertEqual(calls.victory.length, 1);
      assert(calls.victory[0].includes('Bratva'), calls.victory[0]);
    }
  );
});

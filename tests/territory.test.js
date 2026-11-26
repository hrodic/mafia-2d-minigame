// Territory tests: capture progress, faction elimination and victory handling.
import { test, assert, assertEqual } from './harness.js';
import { Faction, UnitRank } from '../src/config/enums.js';
import { state } from '../src/core/state.js';
import { on } from '../src/core/events.js';
import { onChunkCaptured } from '../src/render/territoryFx.js';
import {
  CAPTURE_RATES,
  getCaptureRate,
  progressCapture,
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

const CAPTURED_EVENTS = ['chunk:captured', 'faction:eliminated', 'match:victory', 'match:defeat'];

function eventsOf(events, type) {
  return events.filter((entry) => entry.type === type);
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

  const events = [];
  const unsubscribers = [
    ...CAPTURED_EVENTS.map((type) => on(type, (payload) => events.push({ type, payload }))),
    // Mirror production wiring so the capture floating-text assertion stays meaningful.
    on('chunk:captured', onChunkCaptured),
  ];

  try {
    return fn({ events });
  } finally {
    for (const unsubscribe of unsubscribers) unsubscribe();
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
  withTerritoryState({}, ({ events }) => {
    const chunk = makeChunk(0, 0, Faction.NEUTRAL);
    assertEqual(progressCapture(chunk, Faction.PLAYER, 1, 0.375), false);
    assertEqual(chunk.captureProgress, 0.375);
    assertEqual(chunk.capturingFaction, Faction.PLAYER);
    assertEqual(progressCapture(chunk, Faction.PLAYER, 1, 0.375), false);
    assertEqual(progressCapture(chunk, Faction.PLAYER, 1, 0.375), true);
    assertEqual(chunk.faction, Faction.PLAYER);
    assertEqual(chunk.captureProgress, 0);
    assertEqual(chunk.capturingFaction, null);

    const captures = eventsOf(events, 'chunk:captured');
    assertEqual(captures.length, 1);
    assertEqual(captures[0].payload.chunk, chunk);
    assertEqual(captures[0].payload.faction, Faction.PLAYER);
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
  withTerritoryState({}, ({ events }) => {
    const chunk = makeChunk(2, 3, Faction.NEUTRAL);
    assertEqual(progressCapture(chunk, Faction.PLAYER, 3, 0.375), true);
    assertEqual(state.floatingTexts.length, 1);
    assert(state.floatingTexts[0].text.includes('TURF'));
    assertEqual(state.floatingTexts[0].color, '#34d399');
    assertEqual(state.minimapCacheTimer, 1.0);
    assertEqual(eventsOf(events, 'chunk:captured').length, 1);
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
    ({ events }) => {
      eliminateFaction(Faction.RIVAL_1);
      assertEqual(state.factionAlive[Faction.RIVAL_1], false);
      assertEqual(state.treasuries[Faction.RIVAL_1], 0);
      assertEqual(owned.faction, Faction.NEUTRAL);
      assertEqual(owned.captureProgress, 0);
      assertEqual(owned.capturingFaction, null);
      assertEqual(capturing.capturingFaction, null);
      assertEqual(capturing.captureProgress, 0);
      assertEqual(state.gameOver, false);

      const eliminations = eventsOf(events, 'faction:eliminated');
      assertEqual(eliminations.length, 1);
      assertEqual(eliminations[0].payload.faction, Faction.RIVAL_1);
      assertEqual(eventsOf(events, 'match:victory').length, 0);
      assertEqual(eventsOf(events, 'match:defeat').length, 0);
    }
  );
});

test('territory: eliminating the local boss ends the match in defeat', () => {
  withTerritoryState({ player: { alive: true } }, ({ events }) => {
    eliminateFaction(Faction.PLAYER);
    assertEqual(state.player.alive, false);
    assertEqual(state.gameOver, true);

    const defeats = eventsOf(events, 'match:defeat');
    assertEqual(defeats.length, 1);
    assertEqual(defeats[0].payload.faction, Faction.PLAYER);
    assertEqual(eventsOf(events, 'faction:eliminated').length, 0);
    assertEqual(eventsOf(events, 'match:victory').length, 0);
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
    ({ events }) => {
      eliminateFaction(Faction.RIVAL_1);
      assertEqual(eventsOf(events, 'match:victory').length, 0);
      eliminateFaction(Faction.RIVAL_2);
      assertEqual(eventsOf(events, 'match:victory').length, 0);
      eliminateFaction(Faction.RIVAL_3);

      const victories = eventsOf(events, 'match:victory');
      assertEqual(victories.length, 1, 'victory should fire when the last rival is eliminated');
      assertEqual(state.victoryShown, true);
      assertEqual(victories[0].payload.faction, Faction.PLAYER);
      assertEqual(victories[0].payload.blocks, 1);
      assertEqual(victories[0].payload.totalBlocks, 1);
      assertEqual(victories[0].payload.cash, 4321);
      assertEqual(victories[0].payload.crew, 2);

      eliminateFaction(Faction.PLAYER);
      assertEqual(eventsOf(events, 'match:victory').length, 1, 'victory must not repeat');
    }
  );
});

test('territory: no victory while a rival is alive or the local boss is dead', () => {
  withTerritoryState({}, ({ events }) => {
    checkVictoryCondition();
    assertEqual(eventsOf(events, 'match:victory').length, 0);
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
    ({ events }) => {
      checkVictoryCondition();
      assertEqual(eventsOf(events, 'match:victory').length, 0);
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
    ({ events }) => {
      checkVictoryCondition();
      const victories = eventsOf(events, 'match:victory');
      assertEqual(victories.length, 1);
      assertEqual(victories[0].payload.faction, Faction.RIVAL_1);
    }
  );
});

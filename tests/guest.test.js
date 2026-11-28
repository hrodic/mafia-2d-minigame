// Guest controller tests: lobby handshake, rejection, init and hello routing.
import { test, assert, assertEqual, assertDeepEqual } from './harness.js';
import { state } from '../src/core/state.js';
import { createGuestController } from '../src/net/guest.js';
import { MSG } from '../src/net/protocol.js';
import { createFactionTactics } from '../src/config/tactics.js';

function makeController() {
  const calls = {
    rejected: [],
    lobby: 0,
    worlds: [],
    initialized: 0,
    disconnected: 0,
    hello: [],
  };
  let mode = 'JOIN';
  let selfPeerId = 'g1';
  let matchStarted = false;
  let localFaction = 'PLAYER';

  const controller = createGuestController({
    getMode: () => mode,
    isRoomActive: () => true,
    getSelfPeerId: () => selfPeerId,
    setSelfPeerId: (id) => { selfPeerId = id; },
    getMatchStarted: () => matchStarted,
    setMatchStarted: (started) => { matchStarted = started; },
    setLocalFaction: (faction) => { localFaction = faction; },
    getSendLobby: () => (data, target) => calls.hello.push([data, target]),
    getSendInput: () => () => {},
    getSendCmd: () => () => {},
    onRejected: (reason) => calls.rejected.push(reason),
    onLobbyState: () => { calls.lobby++; },
    initializeWorld: (payload) => calls.worlds.push(payload),
    onMatchInitialized: () => { calls.initialized++; },
    onHostDisconnected: () => { calls.disconnected++; },
  });

  return {
    controller,
    calls,
    getState: () => ({ mode, selfPeerId, matchStarted, localFaction }),
    setMatchStarted: (started) => { matchStarted = started; },
  };
}

const SNAPSHOT_STATE_KEYS = [
  'npcs',
  'player',
  'world',
  'activeFactions',
  'treasuries',
  'factionKills',
  'factionDeaths',
  'factionAlive',
  'gameHour',
  'tickTimer',
  'minimapCacheTimer',
  'factionTactics',
];

function withSnapshotState(fn) {
  const saved = {};
  for (const key of SNAPSHOT_STATE_KEYS) saved[key] = state[key];
  state.npcs = [
    {
      id: 'u1',
      faction: 'RIVAL_1',
      rank: 'SOLDIER',
      x: 1,
      y: 2,
      facing: 0,
      hp: 50,
      maxHp: 100,
      armor: 0,
      maxArmor: 0,
      slashAnimTimer: 0,
      muzzleFlashTimer: 0,
      humanPeerId: null,
    },
  ];
  state.player = { id: 0 };
  state.world = { chunks: new Map() };
  state.activeFactions = ['PLAYER', 'RIVAL_1'];
  state.treasuries = {};
  state.factionKills = {};
  state.factionDeaths = {};
  state.factionAlive = { PLAYER: true, RIVAL_1: true };
  state.gameHour = 1;
  state.tickTimer = 0;
  state.minimapCacheTimer = 0;
  state.factionTactics = {
    PLAYER: createFactionTactics(),
    RIVAL_1: createFactionTactics(),
  };
  try {
    return fn();
  } finally {
    for (const key of SNAPSHOT_STATE_KEYS) state[key] = saved[key];
  }
}

function npcRow(id, rank, x, y) {
  return [id, 'RIVAL_1', rank, x, y, 0, 50, 100, 0, 0, 0, 0, ''];
}

test('guest: lobby state updates roster, settings, self id and host peer', () => {
  const { controller, calls, getState } = makeController();
  const roster = [{ peerId: 'host', isHost: true }, { peerId: 'g2', isHost: false }];
  const settings = { gridSize: 15, tickSeconds: 10, incomeTier: 'HIGH' };

  controller.handleLobby({ type: MSG.LOBBY_STATE, payload: { yourPeerId: 'g2', roster, settings } }, 'host');

  assertEqual(getState().selfPeerId, 'g2');
  assertDeepEqual(controller.getRoster(), roster);
  assertDeepEqual(controller.getSettings(), settings);
  assertEqual(controller.getHostPeerId(), 'host');
  assertEqual(calls.lobby, 1);
});

test('guest: rejection routes the host reason to the UI callback', () => {
  const { controller, calls } = makeController();
  controller.handleLobby({ type: MSG.REJECT, payload: { reason: 'Lobby is full' } }, 'host');
  assertDeepEqual(calls.rejected, ['Lobby is full']);

  controller.handleLobby({ type: MSG.REJECT, payload: {} }, 'host');
  assertDeepEqual(calls.rejected, ['Lobby is full', 'Connection rejected by host.']);
});

test('guest: initial match applies the seat, starts the world and marks the match started', () => {
  const { controller, calls, getState } = makeController();
  const payload = {
    yourPeerId: 'g2',
    assignments: { g2: { faction: 'RIVAL_1', isHost: false } },
    gridSize: 15,
    tickSeconds: 10,
    incomeTier: 'HIGH',
    factionCount: 2,
    orgRoster: ['COSA_NOSTRA', 'BRATVA'],
    worldSeed: 12345,
    unitCaps: { maxSoldiers: 80, maxCaptains: 16, maxUnderbosses: 8 },
  };

  controller.handleInit({ type: MSG.INIT_MATCH, payload }, 'host');

  assertEqual(getState().matchStarted, true);
  assertEqual(getState().localFaction, 'RIVAL_1');
  assertEqual(controller.getHostPeerId(), 'host');
  assertDeepEqual(calls.worlds, [payload]);
  assertEqual(calls.initialized, 1);
});

test('guest: peer join sends HELLO and host leave triggers disconnect only for the host', () => {
  const { controller, calls } = makeController();
  controller.setGuestName('Luca');
  controller.handlePeerJoin('host');

  assertEqual(calls.hello.length, 1);
  assertEqual(calls.hello[0][0].type, MSG.HELLO);
  assertEqual(calls.hello[0][0].payload.name, 'Luca');
  assertEqual(calls.hello[0][1], 'host');

  controller.handleLobby({ type: MSG.LOBBY_STATE, payload: {} }, 'host');
  controller.handlePeerLeave('other');
  assertEqual(calls.disconnected, 0);
  controller.handlePeerLeave('host');
  assertEqual(calls.disconnected, 1);
});

test('guest: snapshot apply reuses existing units, creates new ones and removes dead ids', () => {
  withSnapshotState(() => {
    const { controller, setMatchStarted } = makeController();
    controller.handleLobby({ type: MSG.LOBBY_STATE, payload: {} }, 'host');
    setMatchStarted(true);

    controller.handleSnapshot(
      {
        type: MSG.SNAPSHOT,
        seq: 1,
        payload: { npcs: [npcRow('u1', 'SOLDIER', 10, 20), npcRow('u2', 'CAPTAIN', 30, 40)] },
      },
      'host'
    );

    const u1 = state.npcs.find((u) => u.id === 'u1');
    const u2 = state.npcs.find((u) => u.id === 'u2');
    assert(u1, 'existing unit should be reused');
    assert(u2, 'new unit should be created');
    assertEqual(u1.netX, 10);
    assertEqual(u1.netY, 20);
    assertEqual(u2.netX, 30);
    assertEqual(u2.netY, 40);
    assertEqual(u2.x, 30);
    assertEqual(u2.y, 40);

    controller.handleSnapshot(
      { type: MSG.SNAPSHOT, seq: 2, payload: { npcs: [npcRow('u2', 'CAPTAIN', 35, 45)] } },
      'host'
    );

    assertEqual(state.npcs.some((u) => u.id === 'u1'), false);
    assertEqual(state.npcs.length, 1);
    assertEqual(state.npcs[0].netX, 35);
  });
});

test('guest: non-host, stale and malformed snapshots are ignored', () => {
  withSnapshotState(() => {
    const { controller, setMatchStarted } = makeController();
    controller.handleLobby({ type: MSG.LOBBY_STATE, payload: {} }, 'host');
    setMatchStarted(true);

    controller.handleSnapshot(
      { type: MSG.SNAPSHOT, seq: 2, payload: { npcs: [npcRow('u1', 'SOLDIER', 10, 20)] } },
      'host'
    );
    assertEqual(state.npcs.find((u) => u.id === 'u1').netX, 10);

    // Older sequence.
    controller.handleSnapshot(
      { type: MSG.SNAPSHOT, seq: 1, payload: { npcs: [npcRow('u1', 'SOLDIER', 99, 99)] } },
      'host'
    );
    assertEqual(state.npcs.find((u) => u.id === 'u1').netX, 10);

    // Wrong sender.
    controller.handleSnapshot(
      { type: MSG.SNAPSHOT, seq: 3, payload: { npcs: [npcRow('u1', 'SOLDIER', 77, 77)] } },
      'other'
    );
    assertEqual(state.npcs.find((u) => u.id === 'u1').netX, 10);

    // Malformed payload.
    controller.handleSnapshot({ type: MSG.SNAPSHOT, seq: 4, payload: null }, 'host');
    assertEqual(state.npcs.find((u) => u.id === 'u1').netX, 10);
  });
});

test('guest: snapshot chunks generate unknown chunks and refresh the radar', () => {
  withSnapshotState(() => {
    const chunks = new Map();
    state.world = {
      chunks,
      getChunk: (cx, cy) => chunks.get(`${cx},${cy}`) || null,
      generateChunk: (cx, cy, faction) => {
        const chunk = { cx, cy, faction, captureProgress: 0, capturingFaction: null };
        chunks.set(`${cx},${cy}`, chunk);
        return chunk;
      },
    };
    state.minimapCacheTimer = 0;

    const { controller, setMatchStarted } = makeController();
    controller.handleLobby({ type: MSG.LOBBY_STATE, payload: {} }, 'host');
    setMatchStarted(true);
    controller.handleSnapshot(
      {
        type: MSG.SNAPSHOT,
        seq: 1,
        payload: { chunks: [[4, 5, 'RIVAL_1', 0.42, 'PLAYER']] },
      },
      'host'
    );

    const chunk = chunks.get('4,5');
    assert(chunk, 'unknown chunk should be generated');
    assertEqual(chunk.faction, 'RIVAL_1');
    assertEqual(chunk.captureProgress, 0.42);
    assertEqual(chunk.capturingFaction, 'PLAYER');
    assertEqual(state.minimapCacheTimer, 1.0);
  });
});

test('guest: snapshot applies faction global stance and local order codes', () => {
  withSnapshotState(() => {
    const { controller, setMatchStarted } = makeController();
    controller.handleLobby({ type: MSG.LOBBY_STATE, payload: {} }, 'host');
    setMatchStarted(true);

    controller.handleSnapshot(
      {
        type: MSG.SNAPSHOT,
        seq: 1,
        payload: { tactics: { PLAYER: [1, 1], RIVAL_1: [2, 2] } },
      },
      'host'
    );

    assertEqual(state.factionTactics.PLAYER.globalStance, 1);
    assertEqual(state.factionTactics.PLAYER.localOrder, 1);
    assertEqual(state.factionTactics.RIVAL_1.globalStance, 2);
    assertEqual(state.factionTactics.RIVAL_1.localOrder, 2);
  });
});

test('guest: reset clears the host, roster, settings and sequence state', () => {
  const { controller } = makeController();
  controller.handleLobby(
    { type: MSG.LOBBY_STATE, payload: { roster: [{ peerId: 'host' }], settings: { gridSize: 15 } } },
    'host'
  );
  controller.reset();

  assertEqual(controller.getHostPeerId(), '');
  assertDeepEqual(controller.getRoster(), []);
  assertEqual(controller.getSettings(), null);
});

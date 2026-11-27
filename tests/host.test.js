// Host controller tests: lobby admission, rejection, input routing and AI takeover.
import { test, assert, assertEqual, assertDeepEqual } from './harness.js';
import { Faction, UnitRank } from '../src/config/enums.js';
import { GAME_VERSION } from '../src/config/version.js';
import { state } from '../src/core/state.js';
import { createHostController } from '../src/net/host.js';
import { MSG } from '../src/net/protocol.js';

function makeHost(initialConfig = {}) {
  const calls = {
    sent: [],
    notified: [],
    worlds: [],
    launched: 0,
  };
  let config = {
    gridSize: 15,
    tickSeconds: 10,
    incomeTier: 'HIGH',
    factionCount: 4,
    orgRoster: ['COSA_NOSTRA', 'BRATVA', 'TRIADS', 'CARTEL'],
    ...initialConfig,
  };
  let matchStarted = false;
  let localFaction = 'PLAYER';

  const controller = createHostController({
    getMode: () => 'HOST',
    isRoomActive: () => true,
    getSelfPeerId: () => 'host',
    getConfig: () => config,
    getMatchStarted: () => matchStarted,
    setMatchStarted: (started) => { matchStarted = started; },
    setLocalFaction: (faction) => { localFaction = faction; },
    getSendLobby: () => (data, target) => calls.sent.push([data, target]),
    getSendInit: () => (data, target) => calls.sent.push([data, target]),
    getSendSnap: () => () => {},
    getSendEvent: () => () => {},
    initializeWorld: (payload) => calls.worlds.push(payload),
    onMatchLaunched: () => { calls.launched++; },
    notify: (message) => calls.notified.push(message),
  });

  controller.initHost('Host Boss');
  return {
    controller,
    calls,
    getState: () => ({ matchStarted, localFaction }),
    setMatchStarted: (started) => { matchStarted = started; },
    setConfig: (next) => { config = { ...config, ...next }; },
  };
}

test('host: HELLO admits a guest, seats it and broadcasts lobby state', () => {
  const { controller, calls } = makeHost();
  controller.handleLobby({ v: GAME_VERSION, type: MSG.HELLO, payload: { name: 'Guest Boss' } }, 'g1');

  assertEqual(controller.getPeerForFaction(Faction.RIVAL_1), 'g1');
  assertEqual(controller.getAliasForFaction(Faction.RIVAL_1), 'Guest Boss');
  assertEqual(controller.isHumanFaction(Faction.RIVAL_1), true);
  assertDeepEqual(calls.notified, ['Guest Boss joined the lobby!']);
  assert(calls.sent.some(([data]) => data.type === MSG.LOBBY_STATE));
  assert(calls.sent.some(([data, target]) => data.type === MSG.LOBBY_STATE && target === 'g1'));
});

test('host: launch forwards crew limits to the world and guests', () => {
  const { controller, calls } = makeHost();
  const savedWorld = state.world;
  const savedPlayer = state.player;
  const savedNpcs = state.npcs;
  state.world = { chunks: new Map() };
  state.player = {
    x: 0, y: 0, facing: 0, hp: 100, maxHp: 100, armor: 0, maxArmor: 0,
    alive: true, slashAnimTimer: 0, muzzleFlashTimer: 0,
  };
  state.npcs = [];
  try {
    controller.handleLobby({ v: GAME_VERSION, type: MSG.HELLO, payload: { name: 'Guest Boss' } }, 'g1');

    const unitCaps = { maxSoldiers: 80, maxCaptains: 16, maxUnderbosses: 8 };
    controller.launchMatch({
      gridSize: 10,
      tickSeconds: 10,
      incomeTier: 'HIGH',
      factionCount: 2,
      orgRoster: ['COSA_NOSTRA', 'BRATVA'],
      unitCaps,
      seedOverride: 12345,
    });

    assertDeepEqual(calls.worlds[0].unitCaps, unitCaps);
    const init = calls.sent.find(([data]) => data.type === MSG.INIT_MATCH);
    assert(init, 'INIT_MATCH should be sent to the guest');
    assertDeepEqual(init[0].payload.unitCaps, unitCaps);
  } finally {
    state.world = savedWorld;
    state.player = savedPlayer;
    state.npcs = savedNpcs;
  }
});

test('host: version mismatch is rejected without admitting the peer', () => {
  const { controller, calls } = makeHost();
  controller.handleLobby({ v: '0.0.0', type: MSG.HELLO, payload: { name: 'Old Client' } }, 'g1');

  assertEqual(controller.getPeerForFaction(Faction.RIVAL_1), null);
  assertEqual(calls.sent.length, 1);
  assertEqual(calls.sent[0][0].type, MSG.REJECT);
  assert(calls.sent[0][0].payload.reason.includes('Version mismatch'));
});

test('host: lobby capacity rejects extra guests', () => {
  const { controller, calls } = makeHost({ factionCount: 2 });
  controller.handleLobby({ v: GAME_VERSION, type: MSG.HELLO, payload: { name: 'Guest One' } }, 'g1');
  controller.handleLobby({ v: GAME_VERSION, type: MSG.HELLO, payload: { name: 'Guest Two' } }, 'g2');

  assertEqual(controller.getAliasForFaction(Faction.RIVAL_3), 'Guest One');
  assert(calls.sent.some(([data]) => data.type === MSG.REJECT && data.payload.reason === 'Lobby is full'));
  assertEqual(controller.getPeerForFaction(Faction.RIVAL_1), null);
});

test('host: remote input is clamped and stored', () => {
  const { controller, setMatchStarted } = makeHost();
  controller.handleLobby({ v: GAME_VERSION, type: MSG.HELLO, payload: { name: 'Guest Boss' } }, 'g1');
  setMatchStarted(true);

  controller.handleInput(
    { type: MSG.INPUT, payload: { mx: 5, my: -5, sprint: 1, facing: 2 } },
    'g1'
  );

  const input = controller.getPeerInput('g1');
  assertEqual(input.mx, 1);
  assertEqual(input.my, -1);
  assertEqual(input.sprint, true);
  assertEqual(input.facing, 2);
});

test('host: duplicate HELLO refreshes lobby state without duplicating the guest', () => {
  const { controller, calls } = makeHost();
  const hello = { v: GAME_VERSION, type: MSG.HELLO, payload: { name: 'Guest Boss' } };

  controller.handleLobby(hello, 'g1');
  const joinedBefore = calls.notified.filter((message) => message.includes('joined')).length;
  const sentBefore = calls.sent.length;

  controller.handleLobby(hello, 'g1');

  assertEqual(calls.notified.filter((message) => message.includes('joined')).length, joinedBefore);
  assert(calls.sent.length > sentBefore, 'duplicate HELLO should resend lobby state');
  assertEqual(calls.sent[calls.sent.length - 1][0].type, MSG.LOBBY_STATE);
  assertEqual(controller.getPeerForFaction(Faction.RIVAL_1), 'g1');
});

test('host: commands from seated peers are dispatched; unknown peers are ignored', () => {
  const { controller, setMatchStarted } = makeHost();
  controller.handleLobby(
    { v: GAME_VERSION, type: MSG.HELLO, payload: { name: 'Guest Boss' } },
    'g1'
  );
  setMatchStarted(true);

  const savedWorld = state.world;
  const savedNpcs = state.npcs;
  try {
    state.world = { findNearestWalkablePoint: (x, y) => ({ x, y }) };
    state.npcs = [
      {
        id: 'boss1',
        faction: Faction.RIVAL_1,
        rank: UnitRank.BOSS,
        targetX: null,
        targetY: null,
        path: null,
        pathTimer: 0,
      },
    ];

    controller.handleCommand(
      { type: MSG.CMD, payload: { cmd: 'MOVE_TO', x: 12, y: 34 } },
      'g1'
    );
    assertEqual(state.npcs[0].targetX, 12);
    assertEqual(state.npcs[0].targetY, 34);

    controller.handleCommand(
      { type: MSG.CMD, payload: { cmd: 'MOVE_TO', x: 99, y: 99 } },
      'unknown-peer'
    );
    assertEqual(state.npcs[0].targetX, 12);
    assertEqual(state.npcs[0].targetY, 34);
  } finally {
    state.world = savedWorld;
    state.npcs = savedNpcs;
  }
});

test('host: peer leave before launch frees the seat; mid-match returns the boss to AI', () => {
  const { controller, calls, setMatchStarted } = makeHost();
  controller.handleLobby({ v: GAME_VERSION, type: MSG.HELLO, payload: { name: 'Guest Boss' } }, 'g1');

  controller.handlePeerLeave('g1');
  assert(calls.notified.includes('Guest Boss left the lobby.'));
  assertEqual(controller.getPeerForFaction(Faction.RIVAL_1), null);

  controller.handleLobby({ v: GAME_VERSION, type: MSG.HELLO, payload: { name: 'Fighter' } }, 'g2');
  setMatchStarted(true);
  const savedNpcs = state.npcs;
  state.npcs = [{ faction: Faction.RIVAL_1, rank: 'BOSS', humanPeerId: 'g2', speed: 140 }];
  try {
    controller.handlePeerLeave('g2');
    assertEqual(state.npcs[0].humanPeerId, null);
    assertEqual(state.npcs[0].speed, 152);
    assert(calls.notified.some((message) => message.includes('AI took control')));
  } finally {
    state.npcs = savedNpcs;
  }
});

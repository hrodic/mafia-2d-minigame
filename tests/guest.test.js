// Guest controller tests: lobby handshake, rejection, init and hello routing.
import { test, assertEqual, assertDeepEqual } from './harness.js';
import { createGuestController } from '../src/net/guest.js';
import { MSG } from '../src/net/protocol.js';

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
  };
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

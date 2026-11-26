// UI-agnostic lobby tests: seat assignment, capacity, roster snapshots, guest seat.
import { test, assertEqual, assertDeepEqual } from './harness.js';
import { getActiveFactionSlots } from '../src/config/organizations.js';
import {
  getSeatedPeers,
  reassignHostSeats,
  getOpenHumanCapacity,
  buildLobbyRosterSnapshot,
  findGuestSeat,
} from '../src/net/lobby.js';

const CFG4 = {
  factionCount: 4,
  orgRoster: ['COSA_NOSTRA', 'BRATVA', 'TRIADS', 'CARTEL'],
};

function makePeers() {
  return new Map([
    ['host', { peerId: 'host', name: 'Host', faction: null, slotIdx: -1, isHost: true }],
    ['g1', { peerId: 'g1', name: 'Guest 1', faction: null, slotIdx: -1, isHost: false }],
    ['g2', { peerId: 'g2', name: 'Guest 2', faction: null, slotIdx: -1, isHost: false }],
  ]);
}

test('lobby: host takes slot 0 and guests fill open slots in order', () => {
  const peers = makePeers();
  const closed = [false, false, false, false];
  const slots = reassignHostSeats({
    peers,
    selfPeerId: 'host',
    config: CFG4,
    slotClosedAsAI: closed,
  });

  assertDeepEqual(slots, getActiveFactionSlots(4));
  assertEqual(peers.get('host').slotIdx, 0);
  assertEqual(peers.get('host').faction, slots[0]);
  assertEqual(peers.get('g1').slotIdx, 1);
  assertEqual(peers.get('g1').faction, slots[1]);
  assertEqual(peers.get('g2').slotIdx, 2);
  assertEqual(peers.get('g2').faction, slots[2]);
});

test('lobby: closed AI slots are skipped and extra guests are unseated', () => {
  const peers = makePeers();
  const closed = [false, true, true, false];
  const slots = reassignHostSeats({
    peers,
    selfPeerId: 'host',
    config: CFG4,
    slotClosedAsAI: closed,
  });

  assertEqual(peers.get('g1').slotIdx, 3);
  assertEqual(peers.get('g1').faction, slots[3]);
  assertEqual(peers.get('g2').slotIdx, -1);
  assertEqual(peers.get('g2').faction, null);
});

test('lobby: slots beyond the active faction count reopen', () => {
  const peers = new Map([
    ['host', { peerId: 'host', name: 'Host', faction: null, slotIdx: -1, isHost: true }],
    ['g1', { peerId: 'g1', name: 'Guest 1', faction: null, slotIdx: -1, isHost: false }],
  ]);
  const closed = [false, true, true, true];
  reassignHostSeats({
    peers,
    selfPeerId: 'host',
    config: { factionCount: 2, orgRoster: ['COSA_NOSTRA', 'BRATVA'] },
    slotClosedAsAI: closed,
  });

  assertDeepEqual(closed, [false, true, false, false]);
  assertEqual(peers.get('g1').slotIdx, -1);
  assertEqual(peers.get('g1').faction, null);
});

test('lobby: human capacity counts the host plus open slots', () => {
  assertEqual(getOpenHumanCapacity({ factionCount: 4 }, [false, false, false, false]), 4);
  assertEqual(getOpenHumanCapacity({ factionCount: 4 }, [false, false, true, true]), 2);
  assertEqual(getOpenHumanCapacity({ factionCount: 2 }, [false, true, true, true]), 1);
});

test('lobby: roster snapshot mixes seated humans and AI slots', () => {
  const peers = makePeers();
  const closed = [false, false, true, true];
  const slots = reassignHostSeats({
    peers,
    selfPeerId: 'host',
    config: CFG4,
    slotClosedAsAI: closed,
  });
  const roster = buildLobbyRosterSnapshot({
    config: CFG4,
    peers,
    slotClosedAsAI: closed,
  });

  assertEqual(roster.length, 4);
  assertDeepEqual(roster[0], {
    peerId: 'host',
    name: 'Host',
    faction: slots[0],
    slotIdx: 0,
    isHost: true,
    isAI: false,
  });
  assertEqual(roster[1].peerId, 'g1');
  assertEqual(roster[1].isAI, false);

  assertEqual(roster[2].peerId, 'AI_2');
  assertEqual(roster[2].name, 'AI (Shan Chu)');
  assertEqual(roster[2].faction, slots[2]);
  assertEqual(roster[2].isAI, true);

  assertEqual(roster[3].peerId, 'AI_3');
  assertEqual(roster[3].name, 'AI (Patrón)');
  assertEqual(roster[3].faction, slots[3]);
  assertEqual(roster[3].isAI, true);
});

test('lobby: seated peers exclude unseated slots', () => {
  const seated = getSeatedPeers(
    new Map([
      ['a', { peerId: 'a', faction: null }],
      ['b', { peerId: 'b', faction: 'PLAYER' }],
    ])
  );
  assertEqual(seated.length, 1);
  assertEqual(seated[0].peerId, 'b');
});

test('lobby: guest seat matches self, falls back to the first human guest', () => {
  const host = { peerId: 'host', isHost: true, isAI: false };
  const g1 = { peerId: 'g1', isHost: false, isAI: false };
  const g2 = { peerId: 'g2', isHost: false, isAI: false };
  const roster = [host, g1, g2];

  assertEqual(findGuestSeat(roster, 'g2'), g2);
  assertEqual(findGuestSeat(roster, 'missing'), g1);
  assertEqual(findGuestSeat([{ peerId: 'AI_1', isHost: false, isAI: true }], 'missing'), null);
});

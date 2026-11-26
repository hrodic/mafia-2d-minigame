// Lobby DOM tests: host/guest rosters, AI/open slots, start button and safe names.
import { test, assert, assertEqual, assertDeepEqual } from './harness.js';
import { getActiveFactionSlots } from '../src/config/organizations.js';
import { renderHostLobby, renderGuestLobby } from '../src/ui/lobbyUI.js';

const CFG4 = {
  factionCount: 4,
  orgRoster: ['COSA_NOSTRA', 'BRATVA', 'TRIADS', 'CARTEL'],
};

function withLobbyFixtures(fn) {
  const roster = document.createElement('div');
  roster.id = 'mp-host-roster';
  const count = document.createElement('span');
  count.id = 'mp-host-player-count';
  const start = document.createElement('button');
  start.id = 'btn-start-game';
  const assigned = document.createElement('div');
  assigned.id = 'mp-guest-assigned-faction';
  const settings = document.createElement('div');
  settings.id = 'mp-guest-settings-summary';
  const guestRoster = document.createElement('div');
  guestRoster.id = 'mp-guest-roster';

  document.body.append(roster, count, start, assigned, settings, guestRoster);
  try {
    return fn({ roster, count, start, assigned, settings, guestRoster });
  } finally {
    [roster, count, start, assigned, settings, guestRoster].forEach((el) => el.remove());
  }
}

function seatedHostAndGuest(slots) {
  return [
    { peerId: 'host', name: 'Host Boss', faction: slots[0], slotIdx: 0, isHost: true },
    { peerId: 'g1', name: 'Guest Boss', faction: slots[1], slotIdx: 1, isHost: false },
  ];
}

test('lobbyUI: host roster renders humans, AI slots and open slots', () => {
  withLobbyFixtures(({ roster, count, start }) => {
    const slots = getActiveFactionSlots(4);
    const toggles = [];
    renderHostLobby({
      config: CFG4,
      slots,
      seatedPeers: seatedHostAndGuest(slots),
      slotClosedAsAI: [false, false, true, false],
      openHumans: 3,
      hasRoom: true,
      onToggleSlot: (idx) => toggles.push(idx),
    });

    assertEqual(roster.children.length, 4);
    assert(roster.textContent.includes('Host Boss'));
    assert(roster.textContent.includes('Guest Boss'));
    assert(roster.textContent.includes('AI Syndicate'));
    assert(roster.textContent.includes('Open Slot (Cartel)'));
    assertEqual(count.textContent, '2/3 Humans · 1 AI');
    assertEqual(start.disabled, true);
    assert(start.textContent.includes('Waiting for Open Slots'));

    const buttons = roster.querySelectorAll('.mp-slot-toggle');
    assertEqual(buttons.length, 2);
    buttons[0].click();
    buttons[1].click();
    assertDeepEqual(toggles, [2, 3]);
  });
});

test('lobbyUI: host roster escapes peer names instead of parsing HTML', () => {
  withLobbyFixtures(({ roster }) => {
    const slots = getActiveFactionSlots(4);
    const malicious = '<img src=x onerror="window.__lobbyXss=1">';
    const peers = seatedHostAndGuest(slots);
    peers[1].name = malicious;

    renderHostLobby({
      config: CFG4,
      slots,
      seatedPeers: peers,
      slotClosedAsAI: [false, false, false, false],
      openHumans: 4,
      hasRoom: true,
      onToggleSlot: () => {},
    });

    assertEqual(roster.querySelector('img'), null);
    assert(roster.textContent.includes(malicious));
  });
});

test('lobbyUI: start button reflects room, player count and filled slots', () => {
  withLobbyFixtures(({ start }) => {
    const slots = getActiveFactionSlots(4);
    const peers = seatedHostAndGuest(slots);
    const base = {
      config: CFG4,
      slots,
      seatedPeers: peers,
      openHumans: 3,
      onToggleSlot: () => {},
    };

    renderHostLobby({ ...base, slotClosedAsAI: [false, false, true, false], hasRoom: false });
    assertEqual(start.disabled, true);
    assertEqual(start.textContent, 'Create Room First');

    renderHostLobby({
      ...base,
      seatedPeers: [peers[0]],
      slotClosedAsAI: [false, false, false, false],
      openHumans: 4,
      hasRoom: true,
    });
    assertEqual(start.disabled, true);
    assert(start.textContent.includes('Waiting for Players (1/4 Humans)'));

    renderHostLobby({ ...base, slotClosedAsAI: [false, false, true, true], openHumans: 2, hasRoom: true });
    assertEqual(start.disabled, false);
    assertEqual(start.textContent, 'Launch Multiplayer (2 Humans + 2 AI)');
  });
});

test('lobbyUI: guest roster renders assignment and safe player names', () => {
  withLobbyFixtures(({ assigned, settings, guestRoster }) => {
    const malicious = '<img src=x onerror="window.__guestXss=1">';
    const guest = {
      peerId: 'g1',
      name: malicious,
      faction: 'RIVAL_1',
      slotIdx: 1,
      isHost: false,
      isAI: false,
    };
    const roster = [
      { peerId: 'host', name: 'Host Boss', faction: 'PLAYER', slotIdx: 0, isHost: true, isAI: false },
      guest,
      { peerId: 'AI_2', name: 'AI (Shan Chu)', faction: 'RIVAL_2', slotIdx: 2, isHost: false, isAI: true },
    ];
    const guestSettings = {
      gridSize: 15,
      tickSeconds: 10,
      incomeTier: 'HIGH',
      orgRoster: CFG4.orgRoster,
    };

    renderGuestLobby({ roster, settings: guestSettings, me: guest });

    assertEqual(assigned.textContent, 'Russian Bratva (Pakhan)');
    assertEqual(settings.textContent, 'Map: 15×15 · Tick: 10s · Income: HIGH');
    assertEqual(guestRoster.children.length, 3);
    assertEqual(guestRoster.querySelector('img'), null);
    assert(guestRoster.textContent.includes(malicious));
    assert(guestRoster.textContent.includes('AI (Shan Chu)'));
  });
});

test('lobbyUI: guest without a seat shows the assigning placeholder', () => {
  withLobbyFixtures(({ assigned, guestRoster }) => {
    renderGuestLobby({ roster: [], settings: null, me: null });
    assertEqual(assigned.textContent, 'Assigning seat...');
    assertEqual(guestRoster.children.length, 0);
  });
});

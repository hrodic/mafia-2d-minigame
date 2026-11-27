// Wire protocol tests: message constants, version gate, snapshot encode/decode.
import { test, assertEqual, assertDeepEqual, assert } from './harness.js';
import { GAME_VERSION } from '../src/config/version.js';
import {
  MSG,
  EVENT_KIND,
  envelope,
  isVersionCompatible,
  encodeSnapshot,
  decodeSnapshot,
} from '../src/net/protocol.js';

function makeState() {
  return {
    gameHour: 7,
    tickTimer: 3.14159,
    treasuries: { PLAYER: 1234.6, RIVAL_1: -0.4 },
    factionAlive: { PLAYER: true, RIVAL_1: false },
    factionKills: { PLAYER: 2 },
    factionDeaths: { PLAYER: 1, RIVAL_1: 4 },
    player: {
      x: 10.04,
      y: 20.05,
      facing: 1.234,
      hp: 99.6,
      maxHp: 100,
      armor: 12.2,
      maxArmor: 300,
      alive: true,
      slashAnimTimer: 0.1,
      muzzleFlashTimer: 0,
      ammo: 7,
      reloadTimer: 2.34,
      weapon: 'pistol',
      pistolOwned: true,
      mp9Owned: false,
      spareMags: 2,
      pistolMags: 2,
      mp9Mags: 0,
    },
    world: {
      chunks: new Map([
        [1, { cx: 1, cy: 2, faction: 'PLAYER', captureProgress: 0.456, capturingFaction: 'RIVAL_1' }],
        [2, { cx: 2, cy: 3, faction: 'NEUTRAL', captureProgress: 0, capturingFaction: null }],
      ]),
    },
    npcs: [
      {
        id: 'u1',
        faction: 'RIVAL_1',
        rank: 'BOSS',
        x: 1.26,
        y: 2.34,
        facing: -0.5,
        hp: 49.4,
        maxHp: 50,
        armor: 0,
        maxArmor: 100,
        slashAnimTimer: 0,
        muzzleFlashTimer: 0.05,
        humanPeerId: 'peer1',
        ammo: 3,
        reloadTimer: 4.06,
        weapon: 'mp9',
        pistolOwned: true,
        mp9Owned: true,
        spareMags: 1,
        pistolMags: 3,
        mp9Mags: 1,
      },
      {
        id: 'u2',
        faction: 'PLAYER',
        rank: 'SOLDIER',
        x: 3,
        y: 4,
        facing: 0,
        hp: 10,
        maxHp: 10,
        armor: 5,
        maxArmor: 5,
        slashAnimTimer: 0.2,
        muzzleFlashTimer: 0,
        humanPeerId: null,
        ammo: 10,
        reloadTimer: 0,
        weapon: 'pistol',
      },
    ],
  };
}

test('protocol: message constants are stable wire values', () => {
  assertEqual(MSG.HELLO, 'HELLO');
  assertEqual(MSG.LOBBY_STATE, 'LOBBY_STATE');
  assertEqual(MSG.REJECT, 'REJECT');
  assertEqual(MSG.INIT_MATCH, 'INIT_MATCH');
  assertEqual(MSG.SNAPSHOT, 'SNAPSHOT');
  assertEqual(MSG.INPUT, 'INPUT');
  assertEqual(MSG.CMD, 'CMD');
  assertEqual(MSG.EVENT, 'EVENT');
  assertEqual(EVENT_KIND.SHOT, 'SHOT');
});

test('protocol: envelope stamps the current game version', () => {
  const env = envelope(MSG.HELLO, 3, { name: 'Luca' });
  assertDeepEqual(env, {
    v: GAME_VERSION,
    type: 'HELLO',
    seq: 3,
    payload: { name: 'Luca' },
  });
  assert(isVersionCompatible(env), 'current version must be compatible');
});

test('protocol: version gate rejects mismatches and missing envelopes', () => {
  assert(!isVersionCompatible({ v: '0.0.0' }));
  assert(!isVersionCompatible({ type: MSG.HELLO }));
  assert(!isVersionCompatible(null));
});

test('protocol: encodeSnapshot rounds and preserves the wire arrays', () => {
  const snap = encodeSnapshot(makeState());

  assertEqual(snap.gameHour, 7);
  assertEqual(snap.tickTimer, 3.14);
  assertDeepEqual(snap.treasuries, { PLAYER: 1234.6, RIVAL_1: -0.4 });
  assertDeepEqual(snap.factionAlive, { PLAYER: true, RIVAL_1: false });
  assertDeepEqual(snap.kills, { PLAYER: 2 });
  assertDeepEqual(snap.deaths, { PLAYER: 1, RIVAL_1: 4 });

  assertDeepEqual(snap.playerBoss, {
    x: 10,
    y: 20.1,
    facing: 1.23,
    hp: 100,
    maxHp: 100,
    armor: 12,
    maxArmor: 300,
    alive: true,
    slash: 1,
    shoot: 0,
    ammo: 7,
    reload: 2.3,
    weapon: 1,
    pistol: 1,
    mp9: 0,
    mags: 2,
    pistolMags: 2,
    mp9Mags: 0,
  });

  assertDeepEqual(snap.chunks, [
    [1, 2, 'PLAYER', 0.46, 'RIVAL_1'],
    [2, 3, 'NEUTRAL', 0, ''],
  ]);
  assertDeepEqual(snap.npcs, [
    ['u1', 'RIVAL_1', 'BOSS', 1.3, 2.3, -0.5, 49, 50, 0, 100, 0, 1, 'peer1', 3, 4.1, 2, 1, 1, 1, 3, 1],
    ['u2', 'PLAYER', 'SOLDIER', 3, 4, 0, 10, 10, 5, 5, 1, 0, '', 10, 0, 1, 0, 0, -1, -1, -1],
  ]);
});

test('protocol: decodeSnapshot accepts wire objects and rejects primitives', () => {
  const payload = { gameHour: 1 };
  assertEqual(decodeSnapshot(payload), payload);
  assertEqual(decodeSnapshot(null), null);
  assertEqual(decodeSnapshot(0), null);
  assertEqual(decodeSnapshot('snapshot'), null);
  assertEqual(decodeSnapshot(undefined), null);
});

// Invite-code parsing/formatting and stable app namespace.
import { test, assertEqual, assert } from './harness.js';
import {
  formatInviteCode,
  buildInviteUrl,
  parseInviteInput,
  readInviteFromLocation,
} from '../src/net/invite.js';
import { APP_ID } from '../src/net/transport.js';

test('invite: formats a short grouped room:secret code', () => {
  assertEqual(formatInviteCode('MUGN', '5DG9DU'), 'MUGN-5DG9DU');
  assertEqual(formatInviteCode('mugn', '5dg9du'), 'MUGN-5DG9DU');
});

test('invite: builds a fragment link so the secret is not sent to the server', () => {
  const url = buildInviteUrl('https://example.test', '/game/', 'MUGN-5DG9DU');
  assertEqual(url, 'https://example.test/game/#code=MUGN-5DG9DU');
  assert(!url.includes('secret='), url);
});

test('invite: parses new codes, legacy pairs and full links', () => {
  assertEqual(parseInviteInput('MUGN-5DG9DU').roomCode, 'MUGN');
  assertEqual(parseInviteInput('MUGN-5DG9DU').secret, '5DG9DU');
  assertEqual(parseInviteInput('mugn 5dg9du').roomCode, 'MUGN');
  assertEqual(parseInviteInput('MUGN:5DG9DU').secret, '5DG9DU');

  const legacy = parseInviteInput('https://example.test/?room=MUGNVG&secret=5DG9DUZV');
  assertEqual(legacy.roomCode, 'MUGNVG');
  assertEqual(legacy.secret, '5DG9DUZV');

  const fragment = parseInviteInput('https://example.test/game/#code=MUGN-5DG9DU');
  assertEqual(fragment.roomCode, 'MUGN');
  assertEqual(fragment.secret, '5DG9DU');

  const rawHash = parseInviteInput('#MUGN-5DG9DU');
  assertEqual(rawHash.roomCode, 'MUGN');
  assertEqual(rawHash.secret, '5DG9DU');
});

test('invite: rejects malformed codes instead of guessing', () => {
  assertEqual(parseInviteInput('').roomCode, '');
  assertEqual(parseInviteInput('HELLO').roomCode, '');
  assertEqual(parseInviteInput('MUGN-123').secret, '');
  assertEqual(parseInviteInput('https://example.test/').roomCode, '');
});

test('invite: reads a prefilled invite from the hash first', () => {
  assertEqual(
    readInviteFromLocation({ hash: '#code=MUGN-5DG9DU', search: '' }).roomCode,
    'MUGN'
  );
  assertEqual(
    readInviteFromLocation({ hash: '', search: '?room=MUGNVG&secret=5DG9DUZV' }).roomCode,
    'MUGNVG'
  );
  assertEqual(readInviteFromLocation({ hash: '', search: '' }).roomCode, '');
});

test('transport: app id is stable and version-free', () => {
  assertEqual(APP_ID, 'io.github.hrodic.mafia2d');
});

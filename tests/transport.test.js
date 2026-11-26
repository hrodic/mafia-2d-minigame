// Transport API normalization tests.
// Trystero 0.27 hands callbacks `{ peerId }` and takes `{ target }` send options,
// while the local bus keeps the legacy tuple/string shape.
import { test, assertEqual, assertDeepEqual } from './harness.js';
import { normalizeActionBinding, peerIdFrom, wrapTrysteroRoom } from '../src/net/transport.js';

test('transport: peerIdFrom accepts strings and 0.27 event objects', () => {
  assertEqual(peerIdFrom('abc'), 'abc');
  assertEqual(peerIdFrom({ peerId: 'def', userId: 'u' }), 'def');
  assertEqual(peerIdFrom({ userId: 'u' }), '');
  assertEqual(peerIdFrom(null), '');
});

test('transport: modern action send maps a target string to { target }', () => {
  const calls = [];
  const fake = {
    send: (data, options) => {
      calls.push([data, options]);
      return Promise.resolve();
    },
    onMessage: () => {},
  };
  const [send] = normalizeActionBinding(fake);
  send({ ok: true }, 'peer-1');
  send({ ok: true });
  assertDeepEqual(calls[0], [{ ok: true }, { target: 'peer-1' }]);
  assertDeepEqual(calls[1], [{ ok: true }, undefined]);
});

test('transport: modern action receive unwraps the peer context', () => {
  let handler = null;
  const fake = {
    send: () => {},
    onMessage: (fn) => { handler = fn; },
  };
  const [, receive] = normalizeActionBinding(fake);
  let received = null;
  receive((data, peerId) => { received = [data, peerId]; });
  handler({ n: 1 }, { peerId: 'peer-2', userId: 'u' });
  assertDeepEqual(received, [{ n: 1 }, 'peer-2']);
});

test('transport: legacy array actions keep the positional target', () => {
  const calls = [];
  const fake = [
    (data, target) => { calls.push([data, target]); },
    (fn) => { fn({ n: 2 }, 'peer-3'); },
  ];
  const [send, receive] = normalizeActionBinding(fake);
  send({ n: 3 }, 'peer-4');
  let received = null;
  receive((data, peerId) => { received = [data, peerId]; });
  assertDeepEqual(calls[0], [{ n: 3 }, 'peer-4']);
  assertDeepEqual(received, [{ n: 2 }, 'peer-3']);
});

test('transport: wrapped room normalizes peer join/leave and keeps selfId', () => {
  let joinHandler = null;
  let leaveHandler = null;
  const fake = {
    makeAction: () => [{}, () => {}],
    onPeerJoin: (fn) => { joinHandler = fn; },
    onPeerLeave: (fn) => { leaveHandler = fn; },
    onError: () => {},
    leave: () => {},
  };
  const room = wrapTrysteroRoom(fake, 'self-1');
  assertEqual(room.selfId, 'self-1');

  const joined = [];
  const left = [];
  room.onPeerJoin((id) => joined.push(id));
  room.onPeerLeave((id) => left.push(id));
  joinHandler({ peerId: 'peer-5', userId: 'u' });
  leaveHandler({ peerId: 'peer-6', userId: 'u' });
  assertDeepEqual(joined, ['peer-5']);
  assertDeepEqual(left, ['peer-6']);
});

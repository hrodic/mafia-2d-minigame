// Event bus contract (EVENTS.md): synchronous, isolated, snapshot dispatch.
import { test, assert, assertEqual, assertDeepEqual, assertThrows } from './harness.js';
import { on, off, emit, clear } from '../src/core/events.js';

function fresh() {
  clear();
}

test('events: on receives the emitted payload by reference', () => {
  fresh();
  const payload = { amount: 7 };
  let received = null;
  on('unit:damaged', (value) => {
    received = value;
  });
  emit('unit:damaged', payload);
  assert(received === payload, 'payload reference must be preserved');
});

test('events: subscribers only receive their own event type', () => {
  fresh();
  let a = 0;
  let b = 0;
  on('type:a', () => a++);
  on('type:b', () => b++);
  emit('type:a', {});
  assertEqual(a, 1);
  assertEqual(b, 0);
});

test('events: subscribers run in subscription order', () => {
  fresh();
  const order = [];
  on('ordered', () => order.push(1));
  on('ordered', () => order.push(2));
  on('ordered', () => order.push(3));
  emit('ordered', {});
  assertDeepEqual(order, [1, 2, 3]);
});

test('events: on returns an idempotent unsubscribe', () => {
  fresh();
  let calls = 0;
  const unsubscribe = on('temp', () => calls++);
  unsubscribe();
  unsubscribe();
  emit('temp', {});
  assertEqual(calls, 0);
});

test('events: off removes only the specified handler', () => {
  fresh();
  let a = 0;
  let b = 0;
  const handlerA = () => a++;
  const handlerB = () => b++;
  on('mixed', handlerA);
  on('mixed', handlerB);
  off('mixed', handlerA);
  emit('mixed', {});
  assertEqual(a, 0);
  assertEqual(b, 1);
});

test('events: emit and off are no-ops without subscribers', () => {
  fresh();
  emit('nobody', { x: 1 });
  off('nobody', () => {});
  assert(true);
});

test('events: a throwing subscriber is isolated and logged', () => {
  fresh();
  const originalError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args);
  try {
    let after = 0;
    on('explode', () => {
      throw new Error('boom');
    });
    on('explode', () => after++);
    emit('explode', {});
    assertEqual(after, 1, 'later subscribers must still run');
    assertEqual(logged.length, 1, 'the failure must be logged once');
    assert(String(logged[0][0]).includes('explode'), 'log must name the event type');
    assert(String(logged[0][1] && logged[0][1].message).includes('boom'));
  } finally {
    console.error = originalError;
  }
});

test('events: subscribing during emit only affects the next emit', () => {
  fresh();
  let added = 0;
  let firstRuns = 0;
  const late = () => added++;
  on('grow', () => {
    firstRuns++;
    on('grow', late);
  });
  emit('grow', {});
  assertEqual(firstRuns, 1);
  assertEqual(added, 0, 'new subscriber must not run in the current dispatch');
  emit('grow', {});
  assertEqual(added, 1, 'new subscriber runs on the next dispatch');
});

test('events: unsubscribing during emit does not skip other handlers', () => {
  fresh();
  let a = 0;
  let b = 0;
  let unsubscribe = null;
  const handlerA = () => {
    a++;
    unsubscribe();
  };
  const handlerB = () => b++;
  unsubscribe = on('shrink', handlerA);
  on('shrink', handlerB);
  emit('shrink', {});
  assertEqual(a, 1);
  assertEqual(b, 1);
  emit('shrink', {});
  assertEqual(a, 1, 'unsubscribed handler must not run again');
  assertEqual(b, 2);
});

test('events: duplicate subscription is idempotent', () => {
  fresh();
  let calls = 0;
  const handler = () => calls++;
  on('dupe', handler);
  on('dupe', handler);
  emit('dupe', {});
  assertEqual(calls, 1);
});

test('events: clear removes every subscriber', () => {
  fresh();
  let calls = 0;
  on('one', () => calls++);
  on('two', () => calls++);
  clear();
  emit('one', {});
  emit('two', {});
  assertEqual(calls, 0);
  on('one', () => calls++);
  emit('one', {});
  assertEqual(calls, 1, 'the bus must still work after clear');
});

test('events: an unsubscribe after clear is safe', () => {
  fresh();
  let calls = 0;
  const unsubscribe = on('gone', () => calls++);
  clear();
  unsubscribe();
  emit('gone', {});
  assertEqual(calls, 0);
});

test('events: invalid types and handlers throw', () => {
  fresh();
  assertThrows(() => on('', () => {}), 'non-empty');
  assertThrows(() => on('x', null), 'function');
  assertThrows(() => emit(''), 'non-empty');
  assertThrows(() => off(null, () => {}), 'non-empty');
  assertThrows(() => off('x', 42), 'function');
});

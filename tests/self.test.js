// Self-tests for the test harness itself: proves assertion helpers behave.
import {
  test,
  assert,
  assertEqual,
  assertDeepEqual,
  assertClose,
  assertThrows,
  deepEqual,
} from './harness.js';

test('harness: assert accepts truthy values', () => {
  assert(true);
  assert(1);
  assert('x');
  assert({});
});

test('harness: assert rejects falsy values', () => {
  assertThrows(() => assert(false), 'assertion failed');
  assertThrows(() => assert(0), 'assertion failed');
  assertThrows(() => assert(''), 'assertion failed');
  assertThrows(() => assert(null), 'assertion failed');
});

test('harness: assertEqual compares primitives', () => {
  assertEqual(2 + 2, 4);
  assertEqual('a', 'a');
  assertEqual(NaN, NaN, 'NaN is considered equal');
});

test('harness: assertEqual reports mismatches', () => {
  assertThrows(() => assertEqual(1, 2), 'expected equality');
  assertThrows(() => assertEqual('a', 'b', 'custom message'), 'custom message');
});

test('harness: deepEqual compares nested structures', () => {
  assert(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }));
  assert(!deepEqual({ a: 1 }, { a: 2 }));
  assert(!deepEqual([1, 2], [1, 2, 3]));
  assert(!deepEqual({ a: 1 }, { a: 1, b: 2 }));
  assert(!deepEqual(1, '1'));
});

test('harness: assertDeepEqual compares structures', () => {
  assertDeepEqual({ a: [1, 2], b: { c: true } }, { a: [1, 2], b: { c: true } });
  assertThrows(() => assertDeepEqual({ a: 1 }, { a: 2 }), 'expected deep equality');
});

test('harness: assertClose handles floating point values', () => {
  assertClose(0.1 + 0.2, 0.3, 1e-9);
  assertThrows(() => assertClose(1, 1.1, 1e-3), 'expected close values');
});

test('harness: assertThrows verifies thrown messages', () => {
  assertThrows(() => {
    throw new Error('boom 42');
  }, 'boom');
  assertThrows(() => assertThrows(() => {}, 'anything'), 'expected function to throw');
});

test('harness: async tests are awaited', async () => {
  await new Promise((resolve) => setTimeout(resolve, 1));
  assert(true);
});

// Minimal zero-dependency test harness for the browser.
// No npm, no frameworks: tests are plain ES modules registered with test().
// runner.js imports every *.test.js module, then calls runAll().

const tests = [];

export function test(name, fn) {
  tests.push({ name, fn });
}

export function assert(condition, message = 'assertion failed') {
  if (!condition) throw new Error(message);
}

export function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const key of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!deepEqual(a[key], b[key])) return false;
  }
  return true;
}

export function assertEqual(actual, expected, message = '') {
  if (!Object.is(actual, expected)) {
    throw new Error(
      `${message || 'expected equality'}: expected ${format(expected)}, got ${format(actual)}`
    );
  }
}

export function assertDeepEqual(actual, expected, message = '') {
  if (!deepEqual(actual, expected)) {
    throw new Error(
      `${message || 'expected deep equality'}: expected ${format(expected)}, got ${format(actual)}`
    );
  }
}

export function assertClose(actual, expected, epsilon = 1e-9, message = '') {
  if (!(Math.abs(actual - expected) <= epsilon)) {
    throw new Error(
      `${message || 'expected close values'}: expected ${format(expected)} ± ${epsilon}, got ${format(actual)}`
    );
  }
}

export function assertThrows(fn, messagePart = '') {
  let threw = false;
  let caught = null;
  try {
    fn();
  } catch (err) {
    threw = true;
    caught = err;
  }
  if (!threw) throw new Error('expected function to throw, but it did not');
  const message = String((caught && caught.message) || caught);
  if (messagePart && !message.includes(messagePart)) {
    throw new Error(`expected thrown message to include ${format(messagePart)}, got ${format(message)}`);
  }
  return caught;
}

function format(value) {
  try {
    return JSON.stringify(value);
  } catch (_) {
    return String(value);
  }
}

function renderFatal(root, err) {
  const row = document.createElement('div');
  row.className = 'test-row fail';
  const mark = document.createElement('span');
  mark.className = 'test-mark';
  mark.textContent = '✗';
  const label = document.createElement('span');
  label.textContent = 'FATAL: test runner crashed';
  const detail = document.createElement('pre');
  detail.className = 'test-error';
  detail.textContent = err && err.stack ? err.stack : String(err);
  row.append(mark, label, detail);
  root.append(row);
}

export async function runAll(root = document.getElementById('test-results')) {
  const summaryEl = document.getElementById('test-summary');
  const started = performance.now();
  let passed = 0;
  const failures = [];

  if (root) root.textContent = '';

  for (const entry of tests) {
    const row = document.createElement('div');
    row.className = 'test-row';
    const mark = document.createElement('span');
    mark.className = 'test-mark';
    const label = document.createElement('span');
    label.textContent = entry.name;
    row.append(mark, label);
    if (root) root.append(row);

    try {
      await entry.fn();
      passed++;
      mark.textContent = '✓';
      row.classList.add('pass');
    } catch (err) {
      failures.push({ name: entry.name, error: err });
      mark.textContent = '✗';
      row.classList.add('fail');
      const detail = document.createElement('pre');
      detail.className = 'test-error';
      detail.textContent = err && err.stack ? err.stack : String(err);
      row.append(detail);
    }
  }

  const total = tests.length;
  const failed = failures.length;
  const durationMs = Math.round(performance.now() - started);
  const status = failed === 0 && total > 0 ? 'PASS' : 'FAIL';

  document.title = `${status} — ${passed}/${total} tests`;
  if (summaryEl) {
    summaryEl.textContent =
      `${status}: ${passed}/${total} passed` +
      (failed ? `, ${failed} failed` : '') +
      ` (${durationMs} ms)`;
    summaryEl.className = `summary ${failed === 0 ? 'pass' : 'fail'}`;
  }

  window.__TEST_RESULTS__ = {
    status,
    passed,
    failed,
    total,
    durationMs,
    failures: failures.map((f) => ({
      name: f.name,
      message: String((f.error && f.error.message) || f.error),
    })),
  };

  return window.__TEST_RESULTS__;
}

export function getRegisteredTests() {
  return tests.slice();
}

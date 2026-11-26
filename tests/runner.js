// Test manifest: import every test module here, then run the suite.
// When new modules are extracted during the refactor, add their tests below.
import { runAll } from './harness.js';
import './self.test.js';
import './rng.test.js';
import './events.test.js';
import './version.test.js';
import './config.test.js';
import './balance.test.js';
import './state.test.js';
import './fixedStep.test.js';
import './ui.test.js';
import './world.test.js';
import './world-golden.test.js';
import './geometry.test.js';
import './pathfinding.test.js';
import './audio.test.js';
import './effects.test.js';
import './movement.test.js';
import './units.test.js';
import './economy.test.js';
import './territory.test.js';
import './combat.test.js';
import './commands.test.js';
import './phase3.test.js';
import './interpolation.test.js';
import './match.test.js';
import './simulation.test.js';
import './ai.test.js';
import './render.test.js';
import './backdrop.test.js';
import './minimapLayout.test.js';
import './hud.test.js';
import './hudCadence.test.js';
import './actionBar.test.js';
import './menus.test.js';
import './transport.test.js';
import './protocol.test.js';
import './lobby.test.js';

runAll().catch((err) => {
  const root = document.getElementById('test-results');
  const summary = document.getElementById('test-summary');
  if (summary) {
    summary.textContent = `FAIL: test runner crashed — ${(err && err.message) || err}`;
    summary.className = 'summary fail';
  }
  if (root) {
    const pre = document.createElement('pre');
    pre.className = 'test-error';
    pre.textContent = err && err.stack ? err.stack : String(err);
    root.append(pre);
  }
  document.title = 'FAIL — test runner crashed';
  window.__TEST_RESULTS__ = {
    status: 'FAIL',
    passed: 0,
    failed: 1,
    total: 1,
    failures: [{ name: 'runner', message: String((err && err.message) || err) }],
  };
});

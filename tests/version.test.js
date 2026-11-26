// Version single-source tests: one GAME_VERSION drives title and labels.
import { test, assert, assertEqual } from './harness.js';
import { GAME_VERSION } from '../src/config/version.js';
import { applyVersionLabels } from '../src/ui/version.js';

function withVersionFixtures(fn) {
  const originalTitle = document.title;
  const hud = document.createElement('span');
  hud.id = 'hud-version-label';
  const modal = document.createElement('span');
  modal.id = 'modal-version-label';
  document.body.append(hud, modal);
  try {
    fn(hud, modal);
  } finally {
    hud.remove();
    modal.remove();
    document.title = originalTitle;
  }
}

test('version: GAME_VERSION is a non-empty string', () => {
  assert(typeof GAME_VERSION === 'string' && GAME_VERSION.length > 0);
  assert(
    /^\d+\.\d+\.\d+$/.test(GAME_VERSION),
    `GAME_VERSION must be SemVer MAJOR.MINOR.PATCH, got ${GAME_VERSION}`
  );
});

test('version: applyVersionLabels writes the title and both labels', () => {
  withVersionFixtures((hud, modal) => {
    applyVersionLabels('TEST.VERSION');
    assertEqual(document.title, "Hrodic's Mafia 2D — TEST.VERSION");
    assertEqual(hud.textContent, 'TEST.VERSION');
    assertEqual(modal.textContent, 'TEST.VERSION');
  });
});

test('version: applyVersionLabels defaults to GAME_VERSION', () => {
  withVersionFixtures((hud, modal) => {
    applyVersionLabels();
    assertEqual(hud.textContent, GAME_VERSION);
    assertEqual(modal.textContent, GAME_VERSION);
    assert(document.title.endsWith(GAME_VERSION));
  });
});

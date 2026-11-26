// Menu tests: toast, banners, map-size preview and faction slot rendering.
import { test, assert, assertEqual } from './harness.js';
import { state } from '../src/core/state.js';
import {
  showToast,
  renderFactionSlotsUI,
  updateMapSizePreview,
  resetMatchUI,
  showVictoryBanner,
  showDefeatBanner,
  setWorldSeedDisplay,
} from '../src/ui/menus.js';

test('menus: showToast writes the message and makes it visible', () => {
  showToast('hello world');
  const toast = document.getElementById('toast');
  assertEqual(toast.textContent, 'hello world');
  assertEqual(toast.style.opacity, '1');
});

test('menus: resetMatchUI hides banners and sets the tick tooltip', () => {
  document.getElementById('defeat-banner').classList.remove('hidden');
  document.getElementById('victory-banner').classList.remove('hidden');
  document.getElementById('spectator-banner').classList.remove('hidden');
  resetMatchUI(12);
  assert(document.getElementById('defeat-banner').classList.contains('hidden'));
  assert(document.getElementById('victory-banner').classList.contains('hidden'));
  assert(document.getElementById('spectator-banner').classList.contains('hidden'));
  assertEqual(
    document.getElementById('hour-hud-box').title,
    'Every 12 seconds an hour passes: blocks pay & toggled units spawn'
  );
});

test('menus: victory and defeat banners show their content', () => {
  document.getElementById('victory-banner').classList.add('hidden');
  showVictoryBanner('All rivals down.');
  assertEqual(document.getElementById('victory-summary').textContent, 'All rivals down.');
  assert(!document.getElementById('victory-banner').classList.contains('hidden'));

  document.getElementById('defeat-banner').classList.add('hidden');
  showDefeatBanner();
  assert(!document.getElementById('defeat-banner').classList.contains('hidden'));
});

test('menus: seed display shows the current seed and hides when absent', () => {
  const hud = document.getElementById('world-seed-hud');
  const last = document.getElementById('last-world-seed');
  setWorldSeedDisplay(12345);
  assert(!hud.classList.contains('hidden'));
  assert(hud.textContent.includes('12345'), hud.textContent);
  assertEqual(last.textContent, 'Last: 12345');

  setWorldSeedDisplay(null);
  assert(hud.classList.contains('hidden'));
  assertEqual(last.textContent, 'Last: —');
});

test('menus: map size preview updates display and caps', () => {
  updateMapSizePreview(10);
  assertEqual(document.getElementById('map-size-slider').value, '10');
  assertEqual(document.getElementById('map-size-display').textContent, '10×10');
  const preview = document.getElementById('map-cap-preview').textContent;
  assert(preview.includes('100 Neighborhoods'), preview);
  assert(preview.includes('Cap:'), preview);

  updateMapSizePreview(15);
  assertEqual(document.getElementById('map-size-display').textContent, '15×15 (Default)');
});

test('menus: faction slots render the active seats and selected organizations', () => {
  const savedCount = state.activeFactionCount;
  const savedOrgs = state.selectedFactionOrgs;
  const savedNet = state.net;
  try {
    state.activeFactionCount = 2;
    state.selectedFactionOrgs = ['BRATVA', 'CARTEL', 'TRIADS', 'YAKUZA'];
    state.net = null;
    renderFactionSlotsUI();
    const selects = document.querySelectorAll('#faction-slots-container .faction-org-select');
    assertEqual(selects.length, 2);
    assertEqual(selects[0].value, 'BRATVA');
    assertEqual(selects[1].value, 'CARTEL');
    assertEqual(selects[0].options.length, 6);
  } finally {
    state.activeFactionCount = savedCount;
    state.selectedFactionOrgs = savedOrgs;
    state.net = savedNet;
    document.getElementById('faction-slots-container').innerHTML = '';
  }
});

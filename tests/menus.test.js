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
  toggleHudInfo,
  setManualTab,
  setSetupUnitCap,
  updateMatchImpactSummary,
} from '../src/ui/menus.js';

test('menus: showToast writes the message and makes it visible', () => {
  showToast('hello world');
  const toast = document.getElementById('toast');
  assertEqual(toast.textContent, 'hello world');
  assertEqual(toast.style.opacity, '1');
});

test('menus: session info popover toggles visibility and aria-expanded', () => {
  const button = document.createElement('button');
  button.id = 'btn-hud-info';
  button.setAttribute('aria-expanded', 'false');
  const popover = document.createElement('div');
  popover.id = 'hud-info-popover';
  popover.className = 'hud-info-popover hidden';
  popover.hidden = true;
  document.body.append(button, popover);

  try {
    toggleHudInfo(false);
    assert(popover.classList.contains('hidden'));
    assertEqual(button.getAttribute('aria-expanded'), 'false');

    toggleHudInfo(true);
    assert(!popover.classList.contains('hidden'));
    assertEqual(popover.hidden, false);
    assertEqual(button.getAttribute('aria-expanded'), 'true');

    toggleHudInfo();
    assert(popover.classList.contains('hidden'));
    assertEqual(popover.hidden, true);
    assertEqual(button.getAttribute('aria-expanded'), 'false');
  } finally {
    button.remove();
    popover.remove();
  }
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

test('menus: field manual tabs switch aria-selected and panel visibility', () => {
  const names = ['controls', 'hierarchy', 'multiplayer'];
  const buttons = names.map((name) => {
    const button = document.createElement('button');
    button.className = 'manual-tab';
    button.dataset.manualTab = name;
    button.setAttribute('aria-selected', name === 'controls' ? 'true' : 'false');
    return button;
  });
  const panels = names.map((name) => {
    const panel = document.createElement('div');
    panel.className = `manual-panel${name === 'controls' ? '' : ' hidden'}`;
    panel.id = `manual-panel-${name}`;
    return panel;
  });
  document.body.append(...buttons, ...panels);
  try {
    setManualTab('hierarchy');
    assertEqual(buttons[0].getAttribute('aria-selected'), 'false');
    assertEqual(buttons[1].getAttribute('aria-selected'), 'true');
    assert(panels[0].classList.contains('hidden'));
    assert(!panels[1].classList.contains('hidden'));
    assert(panels[2].classList.contains('hidden'));

    setManualTab('multiplayer');
    assertEqual(buttons[1].getAttribute('aria-selected'), 'false');
    assertEqual(buttons[2].getAttribute('aria-selected'), 'true');
    assert(panels[1].classList.contains('hidden'));
    assert(!panels[2].classList.contains('hidden'));
  } finally {
    for (const el of [...buttons, ...panels]) el.remove();
  }
});

test('menus: match impact summary follows grid, tick and income choices', () => {
  const savedTier = state.currentIncomeTier;
  const savedCaps = state.matchUnitCaps;
  try {
    state.matchUnitCaps = null;
    state.currentIncomeTier = 'HIGH';
    updateMapSizePreview(10);
    const summary = document.getElementById('match-impact-summary').textContent;
    assert(summary.includes('100 Neighborhoods'), summary);
    assert(summary.includes('100S'), summary);
    assert(summary.includes('20C'), summary);
    assert(summary.includes('10U'), summary);
    assert(summary.includes('10s tick'), summary);
    assert(summary.includes('$1,000'), summary);

    state.currentIncomeTier = 'LOW';
    updateMatchImpactSummary();
    assert(document.getElementById('match-impact-summary').textContent.includes('$250'));
  } finally {
    state.currentIncomeTier = savedTier;
    state.matchUnitCaps = savedCaps;
    updateMapSizePreview(15);
  }
});

test('menus: crew limits follow the grid ceiling and can be lowered', () => {
  const saved = { ...state.matchUnitCaps };
  try {
    state.matchUnitCaps = { maxSoldiers: 150, maxCaptains: 30, maxUnderbosses: 15 };
    updateMapSizePreview(15);

    const soldier = document.getElementById('setup-cap-soldier');
    assertEqual(soldier.max, '150');
    soldier.value = '140';
    setSetupUnitCap('soldier', 140);
    assertEqual(state.matchUnitCaps.maxSoldiers, 140);
    assertEqual(document.getElementById('setup-cap-soldier-value').textContent, '140');
    assert(document.getElementById('match-impact-summary').textContent.includes('140S'));

    updateMapSizePreview(5);
    assertEqual(soldier.max, '50');
    assertEqual(soldier.value, '50');
    assertEqual(state.matchUnitCaps.maxSoldiers, 50);
    assertEqual(document.getElementById('setup-cap-captain').max, '10');
    assertEqual(document.getElementById('setup-cap-captain').value, '10');
    assertEqual(document.getElementById('setup-cap-underboss').max, '5');
    assertEqual(document.getElementById('setup-cap-underboss').value, '5');
  } finally {
    state.matchUnitCaps = saved;
    document.getElementById('setup-cap-soldier').value = String(saved.maxSoldiers);
    document.getElementById('setup-cap-captain').value = String(saved.maxCaptains);
    document.getElementById('setup-cap-underboss').value = String(saved.maxUnderbosses);
    updateMapSizePreview(15);
    state.matchUnitCaps = saved;
  }
});

test('menus: map size preview updates display and caps', () => {
  updateMapSizePreview(10);
  assertEqual(document.getElementById('map-size-slider').value, '10');
  assertEqual(document.getElementById('map-size-display').textContent, '10×10');
  const preview = document.getElementById('map-cap-preview').textContent;
  assert(preview.includes('100 Neighborhoods'), preview);
  assert(preview.includes('100S · 20C · 10U'), preview);

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

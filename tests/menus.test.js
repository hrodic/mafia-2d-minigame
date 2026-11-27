// Menu tests: toast, banners, map-size preview and faction slot rendering.
import { test, assert, assertEqual, assertDeepEqual } from './harness.js';
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
  setSetupTab,
  setSetupUnitCap,
  applyMatchPreset,
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

test('menus: setup tabs toggle panels, CTA and the Play shortcut target', () => {
  const ids = [
    'setup-panel-manual',
    'setup-panel-play',
    'mp-host-panel',
    'mp-join-panel',
    'match-settings-wrapper',
    'setup-cta-bar',
    'btn-start-game',
    'setup-scroll',
  ];
  const els = ids.map((id) => {
    const el = document.createElement('div');
    el.id = id;
    document.body.append(el);
    return el;
  });
  const tabs = ['manual', 'single', 'host', 'join'].map((tab) => {
    const button = document.createElement('button');
    button.className = 'setup-tab';
    button.dataset.setupTab = tab;
    button.setAttribute('aria-selected', tab === 'manual' ? 'true' : 'false');
    document.body.append(button);
    return button;
  });
  const scroller = els[ids.indexOf('setup-scroll')];
  scroller.style.height = '20px';
  scroller.style.overflowY = 'auto';
  scroller.innerHTML = '<div style="height:200px"></div>';
  try {
    setSetupTab('manual');
    assert(!els[0].classList.contains('hidden'), 'manual panel visible');
    assert(els[1].classList.contains('hidden'), 'play panel hidden on manual');
    assert(els[5].classList.contains('hidden'), 'CTA hidden on manual');
    assertEqual(tabs[0].getAttribute('aria-selected'), 'true');
    els[7].scrollTop = 100;

    setSetupTab('single');
    assert(els[0].classList.contains('hidden'));
    assert(!els[1].classList.contains('hidden'), 'play panel visible on single');
    assert(!els[4].classList.contains('hidden'), 'settings visible on single');
    assert(!els[5].classList.contains('hidden'), 'CTA visible on single');
    assertEqual(els[6].textContent, 'Launch Turf War');
    assertEqual(els[7].scrollTop, 0, 'tab switch should reset the scroll position');
    assertEqual(tabs[1].getAttribute('aria-selected'), 'true');

    setSetupTab('host');
    assert(!els[2].classList.contains('hidden'), 'host panel visible on host');
    assert(els[3].classList.contains('hidden'), 'join panel hidden on host');
    assert(!els[4].classList.contains('hidden'), 'settings visible on host');

    setSetupTab('join');
    assert(els[2].classList.contains('hidden'), 'host panel hidden on join');
    assert(!els[3].classList.contains('hidden'), 'join panel visible on join');
    assert(els[4].classList.contains('hidden'), 'settings hidden on join');
    assert(els[5].classList.contains('hidden'), 'CTA hidden on join');
    assertEqual(tabs[3].getAttribute('aria-selected'), 'true');
  } finally {
    for (const el of [...els, ...tabs]) el.remove();
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
    assert(summary.includes('100 neighborhoods'), summary);
    assert(summary.includes('50 Street Enforcers'), summary);
    assert(summary.includes('10 Middle Management'), summary);
    assert(summary.includes('5 Second-in-Command'), summary);
    assert(summary.includes('10s ticks'), summary);
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
    assert(document.getElementById('match-impact-summary').textContent.includes('140 Street Enforcers'));

    updateMapSizePreview(5);
    assertEqual(soldier.max, '50');
    assertEqual(soldier.value, '25');
    assertEqual(state.matchUnitCaps.maxSoldiers, 25);
    assertEqual(document.getElementById('setup-cap-captain').max, '10');
    assertEqual(document.getElementById('setup-cap-captain').value, '5');
    assertEqual(document.getElementById('setup-cap-underboss').max, '5');
    assertEqual(document.getElementById('setup-cap-underboss').value, '3');
  } finally {
    state.matchUnitCaps = saved;
    document.getElementById('setup-cap-soldier').value = String(saved.maxSoldiers);
    document.getElementById('setup-cap-captain').value = String(saved.maxCaptains);
    document.getElementById('setup-cap-underboss').value = String(saved.maxUnderbosses);
    updateMapSizePreview(15);
    state.matchUnitCaps = saved;
  }
});

test('menus: presets apply grid, tick and income together', () => {
  const savedTier = state.currentIncomeTier;
  const savedCaps = state.matchUnitCaps;
  try {
    applyMatchPreset('turbo');
    assertEqual(document.getElementById('map-size-slider').value, '10');
    assertEqual(document.getElementById('tick-speed-slider').value, '10');
    assertEqual(state.currentIncomeTier, 'HIGH');
    assertDeepEqual(state.matchUnitCaps, { maxSoldiers: 50, maxCaptains: 10, maxUnderbosses: 5 });
    assertEqual(document.getElementById('setup-cap-soldier').value, '50');
    assert(document.getElementById('match-impact-summary').textContent.includes('100 neighborhoods'));
    assert(document.getElementById('match-impact-summary').textContent.includes('50 Street Enforcers'));
    assert(document.getElementById('match-impact-summary').textContent.includes('10s ticks'));
    assert(document.getElementById('match-impact-summary').textContent.includes('$1,000'));
    assertEqual(
      document.querySelector('.match-preset[data-preset="turbo"]').getAttribute('aria-pressed'),
      'true'
    );

    applyMatchPreset('normal');
    assertEqual(document.getElementById('map-size-slider').value, '15');
    assertEqual(document.getElementById('tick-speed-slider').value, '15');
    assertEqual(state.currentIncomeTier, 'MID');
    assertDeepEqual(state.matchUnitCaps, { maxSoldiers: 75, maxCaptains: 15, maxUnderbosses: 8 });
    assert(document.getElementById('match-impact-summary').textContent.includes('225 neighborhoods'));
    assert(document.getElementById('match-impact-summary').textContent.includes('75 Street Enforcers'));
    assert(document.getElementById('match-impact-summary').textContent.includes('8 Second-in-Command'));
    assert(document.getElementById('match-impact-summary').textContent.includes('15s ticks'));
    assert(document.getElementById('match-impact-summary').textContent.includes('$500'));

    applyMatchPreset('long');
    assertEqual(document.getElementById('map-size-slider').value, '20');
    assertEqual(document.getElementById('tick-speed-slider').value, '25');
    assertEqual(state.currentIncomeTier, 'LOW');
    assertDeepEqual(state.matchUnitCaps, { maxSoldiers: 100, maxCaptains: 20, maxUnderbosses: 10 });
    assert(document.getElementById('match-impact-summary').textContent.includes('400 neighborhoods'));
    assert(document.getElementById('match-impact-summary').textContent.includes('100 Street Enforcers'));
    assert(document.getElementById('match-impact-summary').textContent.includes('25s ticks'));
    assert(document.getElementById('match-impact-summary').textContent.includes('$250'));
    assertEqual(
      document.querySelector('.match-preset[data-preset="long"]').getAttribute('aria-pressed'),
      'true'
    );
  } finally {
    state.currentIncomeTier = savedTier;
    state.matchUnitCaps = savedCaps;
    updateMapSizePreview(15);
  }
});

test('menus: map size preview updates display and caps', () => {
  updateMapSizePreview(10);
  assertEqual(document.getElementById('map-size-slider').value, '10');
  assertEqual(document.getElementById('map-size-display').textContent, '10×10');
  const preview = document.getElementById('map-cap-preview').textContent;
  assert(preview.includes('100 neighborhoods'), preview);
  assert(preview.includes('100 Street Enforcers · 20 Middle Management · 10 Second-in-Command'), preview);

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

// Setup modal, lobby buttons, banners, toasts and map-size controls.

import { UnitRank } from '../config/enums.js';
import { INCOME_TIERS, UNIT_CAPS, clampMatchUnitCaps, defaultMatchUnitCaps, getGridUnitCaps } from '../config/balance.js';
import { ORGANIZATIONS, ALL_ORG_IDS, ensureUniqueOrgs } from '../config/organizations.js';
import { state } from '../core/state.js';
import { parseWorldSeed, randomWorldSeed } from '../core/rng.js';
import { getAudioCtx } from '../audio/engine.js';
import { initWorld } from '../sim/match.js';


let toastTimeout = null;
export function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    el.style.opacity = '0';
  }, 2400);
}

function readRequestedSeed() {
  const input = document.getElementById('world-seed-input');
  return parseWorldSeed(input ? input.value : null);
}

export function setWorldSeedDisplay(seed = state.currentWorldSeed) {
  const hud = document.getElementById('world-seed-hud');
  if (hud) {
    if (seed === null || seed === undefined) {
      hud.classList.add('hidden');
    } else {
      hud.textContent = `SEED ${seed}`;
      hud.classList.remove('hidden');
    }
  }
  const last = document.getElementById('last-world-seed');
  if (last) last.textContent = `Last: ${seed ?? '—'}`;
}

/** Open/close the compact session-info popover. Pass a boolean to force state. */
export function toggleHudInfo(forceOpen) {
  const button = document.getElementById('btn-hud-info');
  const popover = document.getElementById('hud-info-popover');
  if (!button || !popover) return;
  const open = typeof forceOpen === 'boolean'
    ? forceOpen
    : popover.classList.contains('hidden');
  popover.classList.toggle('hidden', !open);
  popover.hidden = !open;
  button.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function fallbackCopy(value) {
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
    showToast(`Seed ${value} copied`);
  } catch (_) {
    showToast('Copy failed — select the seed manually');
  }
  textarea.remove();
}

function copySeed(value) {
  if (value === null || value === undefined) {
    showToast('No world seed yet');
    return;
  }
  const text = String(value);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard
      .writeText(text)
      .then(() => showToast(`Seed ${text} copied`))
      .catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}

export function renderFactionSlotsUI() {
  state.selectedFactionOrgs = ensureUniqueOrgs(state.selectedFactionOrgs);
  const container = document.getElementById('faction-slots-container');
  const seatLabels = ['Seat 1 (Host)', 'Seat 2', 'Seat 3', 'Seat 4'];
  let html = '';

  for (let i = 0; i < state.activeFactionCount; i++) {
    const currentOrgId = state.selectedFactionOrgs[i];
    const org = ORGANIZATIONS[currentOrgId];
    let optionsHtml = '';
    for (const id of ALL_ORG_IDS) {
      const o = ORGANIZATIONS[id];
      optionsHtml += `<option value="${id}" ${id === currentOrgId ? 'selected' : ''}>${o.name} (${o.ranks.BOSS})</option>`;
    }
    html += `
      <div class="flex items-center justify-between gap-2 bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5">
        <div class="flex items-center gap-2 text-[11px]">
          <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${org.badge}"></span>
          <span class="font-bold text-zinc-300">${seatLabels[i]}</span>
        </div>
        <select data-slot-idx="${i}" class="faction-org-select bg-zinc-950 border border-zinc-700 text-zinc-200 text-[11px] rounded px-2 py-1 focus:outline-none focus:border-amber-500">
          ${optionsHtml}
        </select>
      </div>
    `;
  }

  container.innerHTML = html;
  container.querySelectorAll('.faction-org-select').forEach((sel) => {
    sel.addEventListener('change', (e) => {
      const idx = Number(e.target.getAttribute('data-slot-idx'));
      const chosen = e.target.value;
      const prev = state.selectedFactionOrgs[idx];
      const conflictIdx = state.selectedFactionOrgs.findIndex((id, k) => k !== idx && id === chosen);
      if (conflictIdx !== -1) {
        state.selectedFactionOrgs[conflictIdx] = prev;
      }
      state.selectedFactionOrgs[idx] = chosen;
      renderFactionSlotsUI();
      if (state.net && state.net.mode === 'HOST') {
        state.net.updateHostLobbyUI();
        state.net.broadcastHostLobbyState();
      }
    });
  });
}

const CAP_TIERS = [
  { key: 'soldier', maxKey: 'maxSoldiers', min: UNIT_CAPS.minSoldiers },
  { key: 'captain', maxKey: 'maxCaptains', min: UNIT_CAPS.minCaptains },
  { key: 'underboss', maxKey: 'maxUnderbosses', min: UNIT_CAPS.minUnderbosses },
];

const MATCH_PRESETS = {
  turbo: { gridSize: 10, tickSeconds: 10, incomeTier: 'HIGH' },
  normal: { gridSize: 15, tickSeconds: 15, incomeTier: 'MID' },
  long: { gridSize: 20, tickSeconds: 25, incomeTier: 'LOW' },
};

function tickSpeedLabel(seconds) {
  return seconds <= 12 ? `${seconds}s (Turbo)` : seconds <= 22 ? `${seconds}s (Normal)` : `${seconds}s (Slow)`;
}

function renderIncomeTier() {
  const tier = INCOME_TIERS[state.currentIncomeTier];
  if (!tier) return;
  const display = document.getElementById('income-tier-display');
  if (display) display.textContent = `$${tier.min.toLocaleString()}–$${tier.max.toLocaleString()} / tick`;
  document.querySelectorAll('.income-tier-btn').forEach((btn) => {
    const active = btn.getAttribute('data-income') === state.currentIncomeTier;
    btn.className = active
      ? 'income-tier-btn bg-emerald-500/20 border border-emerald-500 text-emerald-300 py-2 px-2 rounded-lg text-center transition'
      : 'income-tier-btn bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 py-2 px-2 rounded-lg text-center transition';
  });
}

function syncPresetButtons() {
  const sizeSlider = document.getElementById('map-size-slider');
  const tickSlider = document.getElementById('tick-speed-slider');
  const gridSize = Math.max(5, Math.min(25, Number(sizeSlider ? sizeSlider.value : 15) || 15));
  const tickSeconds = Math.max(10, Math.min(30, Number(tickSlider ? tickSlider.value : 10) || 10));
  document.querySelectorAll('.match-preset').forEach((btn) => {
    const preset = MATCH_PRESETS[btn.dataset.preset];
    const active = Boolean(preset)
      && preset.gridSize === gridSize
      && preset.tickSeconds === tickSeconds
      && preset.incomeTier === state.currentIncomeTier;
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

/** Apply a ready-made grid / tick / income combination. */
export function applyMatchPreset(name) {
  const preset = MATCH_PRESETS[name];
  if (!preset) return;
  updateMapSizePreview(preset.gridSize);

  const tickSlider = document.getElementById('tick-speed-slider');
  if (tickSlider) tickSlider.value = String(preset.tickSeconds);
  const tickDisplay = document.getElementById('tick-speed-display');
  if (tickDisplay) tickDisplay.textContent = tickSpeedLabel(preset.tickSeconds);

  state.currentIncomeTier = preset.incomeTier;
  renderIncomeTier();
  updateMatchImpactSummary();
  if (state.net && state.net.mode === 'HOST') state.net.broadcastHostLobbyState();
}

/** Clamp the chosen crew limits to the current grid and refresh the setup sliders. */
function renderSetupCapControls() {
  const sizeSlider = document.getElementById('map-size-slider');
  const n = Math.max(5, Math.min(25, Number(sizeSlider ? sizeSlider.value : 15) || 15));
  const hard = getGridUnitCaps(n);
  state.matchUnitCaps = clampMatchUnitCaps(n, state.matchUnitCaps || {});
  for (const tier of CAP_TIERS) {
    const input = document.getElementById(`setup-cap-${tier.key}`);
    if (!input) continue;
    const max = hard[tier.maxKey];
    input.min = String(tier.min);
    input.max = String(max);
    input.value = String(state.matchUnitCaps[tier.maxKey]);
    const valueEl = document.getElementById(`setup-cap-${tier.key}-value`);
    if (valueEl) valueEl.textContent = String(state.matchUnitCaps[tier.maxKey]);
    const maxEl = document.getElementById(`setup-cap-${tier.key}-max`);
    if (maxEl) maxEl.textContent = ` / ${max}`;
    const ceilingEl = document.getElementById(`setup-cap-${tier.key}-ceiling`);
    if (ceilingEl) ceilingEl.textContent = `grid max ${max}`;
  }
  updateMatchImpactSummary();
}

/** Set one tier maximum from the setup slider, clamped to the grid ceiling. */
export function setSetupUnitCap(key, value) {
  const tier = CAP_TIERS.find((entry) => entry.key === key);
  if (!tier) return;
  state.matchUnitCaps = {
    ...state.matchUnitCaps,
    [tier.maxKey]: Number(value),
  };
  renderSetupCapControls();
}

/** One-line preview of the match shape under the current setup choices. */
export function updateMatchImpactSummary() {
  const el = document.getElementById('match-impact-summary');
  if (!el) return;
  const sizeSlider = document.getElementById('map-size-slider');
  const n = Math.max(5, Math.min(25, Number(sizeSlider ? sizeSlider.value : 15) || 15));
  const total = n * n;
  const caps = clampMatchUnitCaps(n, state.matchUnitCaps || {});
  const tickSlider = document.getElementById('tick-speed-slider');
  const tick = Math.max(10, Math.min(30, Number(tickSlider ? tickSlider.value : 10) || 10));
  const tier = INCOME_TIERS[state.currentIncomeTier] || INCOME_TIERS.HIGH;
  const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  const textEl = document.getElementById('match-impact-text') || el;
  textEl.textContent =
    `${total} neighborhoods · ${plural(caps.maxSoldiers, 'Street Enforcer', 'Street Enforcers')} · ` +
    `${plural(caps.maxCaptains, 'Middle Management', 'Middle Management')} · ` +
    `${plural(caps.maxUnderbosses, 'Second-in-Command', 'Second-in-Command')} · ` +
    `${tick}s ticks · $${tier.min.toLocaleString()}–$${tier.max.toLocaleString()}/tick`;
  syncPresetButtons();
}

/** Top-level setup tabs: Field Manual, Single Player, Host and Join. */
export function setSetupTab(tab) {
  const next = ['manual', 'single', 'host', 'join'].includes(tab) ? tab : 'manual';
  if (state.net) {
    if (next === 'single') state.net.setMode('SINGLE');
    else if (next === 'host') state.net.setMode('HOST');
    else if (next === 'join') state.net.setMode('JOIN');
  }

  document.querySelectorAll('.setup-tab').forEach((btn) => {
    const active = btn.dataset.setupTab === next;
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
    btn.setAttribute('tabindex', active ? '0' : '-1');
  });

  const manualPanel = document.getElementById('setup-panel-manual');
  const playPanel = document.getElementById('setup-panel-play');
  const hostPanel = document.getElementById('mp-host-panel');
  const joinPanel = document.getElementById('mp-join-panel');
  const settings = document.getElementById('match-settings-wrapper');
  const cta = document.getElementById('setup-cta-bar');
  const start = document.getElementById('btn-start-game');
  const scroller = document.getElementById('setup-scroll');

  if (manualPanel) manualPanel.classList.toggle('hidden', next !== 'manual');
  if (playPanel) playPanel.classList.toggle('hidden', next === 'manual');
  if (hostPanel) hostPanel.classList.toggle('hidden', next !== 'host');
  if (joinPanel) joinPanel.classList.toggle('hidden', next !== 'join');
  if (settings) settings.classList.toggle('hidden', next === 'join');
  if (cta) cta.classList.toggle('hidden', next === 'manual' || next === 'join');
  if (scroller) scroller.scrollTop = 0;
  if (start && next === 'single') {
    start.disabled = false;
    start.textContent = 'Launch Turf War';
  }
}

export function updateMapSizePreview(val) {
  const n = Math.max(5, Math.min(25, Number(val) || 15));
  document.getElementById('map-size-slider').value = n;
  document.getElementById('map-size-display').textContent = n === 15 ? '15×15 (Default)' : `${n}×${n}`;
  const total = n * n;
  const caps = getGridUnitCaps(n);
  const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  document.getElementById('map-cap-preview').innerHTML =
    `<span>${total} neighborhoods</span>` +
    `<span class="font-mono text-emerald-400">Max: ${plural(caps.maxSoldiers, 'Street Enforcer', 'Street Enforcers')} · ` +
    `${plural(caps.maxCaptains, 'Middle Management', 'Middle Management')} · ` +
    `${plural(caps.maxUnderbosses, 'Second-in-Command', 'Second-in-Command')}</span>`;

  document.querySelectorAll('.size-preset-btn').forEach((btn) => {
    const active = Number(btn.getAttribute('data-size')) === n;
    btn.className = active
      ? 'size-preset-btn bg-amber-500/20 border border-amber-500 text-amber-300 py-1 rounded text-[11px] font-mono font-bold transition'
      : 'size-preset-btn bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 py-1 rounded text-[11px] font-mono font-bold transition';
  });
  state.matchUnitCaps = defaultMatchUnitCaps(n);
  renderSetupCapControls();
}

function openSetupMenu() {
  state.net.cleanup(true);
  state.net.setMode('SINGLE');
  state.gameStarted = false;
  document.getElementById('defeat-banner').classList.add('hidden');
  document.getElementById('victory-banner').classList.add('hidden');
  document.getElementById('spectator-banner').classList.add('hidden');
  document.getElementById('disconnect-banner').classList.add('hidden');
  document.getElementById('setup-modal').classList.remove('hidden');
  setWorldSeedDisplay();
  renderSetupCapControls();
  setSetupTab('manual');
}


export function resetMatchUI(tickSeconds) {
  document.getElementById('defeat-banner').classList.add('hidden');
  document.getElementById('victory-banner').classList.add('hidden');
  document.getElementById('spectator-banner').classList.add('hidden');
  document.getElementById('hour-hud-box').title =
    `Every ${tickSeconds} seconds an hour passes: blocks pay & toggled units spawn`;
}

export function showVictoryBanner(summary) {
  document.getElementById('victory-summary').textContent = summary;
  document.getElementById('victory-banner').classList.remove('hidden');
}

export function showDefeatBanner() {
  document.getElementById('defeat-banner').classList.remove('hidden');
}

export function initMenus() {
document.getElementById('btn-hud-info')?.addEventListener('click', () => toggleHudInfo());
document.getElementById('btn-random-seed')?.addEventListener('click', () => {
  const input = document.getElementById('world-seed-input');
  if (input) input.value = String(randomWorldSeed());
});
document.getElementById('btn-copy-seed')?.addEventListener('click', () => {
  copySeed(readRequestedSeed() ?? state.currentWorldSeed);
});
document.getElementById('world-seed-hud')?.addEventListener('click', () => {
  copySeed(state.currentWorldSeed);
});

document.querySelectorAll('.setup-tab').forEach((btn) => {
  btn.addEventListener('click', () => setSetupTab(btn.dataset.setupTab));
});
document.getElementById('btn-manual-play')?.addEventListener('click', () => setSetupTab('single'));
document.querySelectorAll('.match-preset').forEach((btn) => {
  btn.addEventListener('click', () => applyMatchPreset(btn.dataset.preset));
});

document.querySelectorAll('.fcount-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.activeFactionCount = Number(btn.getAttribute('data-fcount')) || 4;
    document.querySelectorAll('.fcount-btn').forEach((b) => {
      const active = Number(b.getAttribute('data-fcount')) === state.activeFactionCount;
      b.className = active
        ? 'fcount-btn bg-amber-500/20 border border-amber-500 text-amber-300 px-2.5 py-0.5 rounded text-[11px] font-mono font-bold transition'
        : 'fcount-btn bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 px-2.5 py-0.5 rounded text-[11px] font-mono font-bold transition';
    });
    renderFactionSlotsUI();
    if (state.net && state.net.mode === 'HOST') {
      state.net.updateHostLobbyUI();
      state.net.broadcastHostLobbyState();
    }
  });
});

document.getElementById('map-size-slider').addEventListener('input', (e) => {
  updateMapSizePreview(e.target.value);
  if (state.net && state.net.mode === 'HOST') state.net.broadcastHostLobbyState();
});

document.querySelectorAll('.size-preset-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    updateMapSizePreview(btn.getAttribute('data-size'));
    if (state.net && state.net.mode === 'HOST') state.net.broadcastHostLobbyState();
  });
});

for (const tier of CAP_TIERS) {
  const input = document.getElementById(`setup-cap-${tier.key}`);
  if (!input) continue;
  input.addEventListener('input', () => {
    setSetupUnitCap(tier.key, input.value);
    if (state.net && state.net.mode === 'HOST') state.net.broadcastHostLobbyState();
  });
}

document.getElementById('tick-speed-slider').addEventListener('input', (e) => {
  const sec = Number(e.target.value) || 10;
  document.getElementById('tick-speed-display').textContent = tickSpeedLabel(sec);
  updateMatchImpactSummary();
  if (state.net && state.net.mode === 'HOST') state.net.broadcastHostLobbyState();
});

document.querySelectorAll('.income-tier-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.currentIncomeTier = btn.getAttribute('data-income') || 'HIGH';
    renderIncomeTier();
    updateMatchImpactSummary();
    if (state.net && state.net.mode === 'HOST') state.net.broadcastHostLobbyState();
  });
});

document.getElementById('btn-mp-create-room').addEventListener('click', () => {
  getAudioCtx();
  state.net.createHostRoom();
});

document.getElementById('btn-mp-copy-invite').addEventListener('click', () => {
  const codeText = document.getElementById('mp-room-code-display').textContent.trim();
  if (!codeText || codeText === '—') return;
  const [rCode, rSec] = codeText.split(':');
  const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(rCode)}&secret=${encodeURIComponent(rSec)}`;
  const ta = document.createElement('textarea');
  ta.value = inviteUrl;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    showToast('Invitation link copied to clipboard!');
  } catch (_) {
    showToast(`Room Code: ${codeText}`);
  }
  document.body.removeChild(ta);
});

document.getElementById('btn-mp-close-room').addEventListener('click', () => {
  state.net.cleanup(false);
  document.getElementById('mp-host-status').textContent = 'Offline';
  state.net.updateHostLobbyUI();
});

document.getElementById('btn-mp-join-room').addEventListener('click', () => {
  getAudioCtx();
  state.net.joinGuestRoom();
});

document.getElementById('btn-mp-leave-lobby').addEventListener('click', () => {
  state.net.cleanup(false);
  document.getElementById('mp-join-status').textContent = 'Disconnected';
});

document.getElementById('btn-start-game').addEventListener('click', () => {
  getAudioCtx();
  const gridSize = Number(document.getElementById('map-size-slider').value) || 15;
  const tickSeconds = Number(document.getElementById('tick-speed-slider').value) || 10;
  const unitCaps = clampMatchUnitCaps(gridSize, state.matchUnitCaps);
  const requestedSeed = readRequestedSeed();

  if (state.net && state.net.mode === 'HOST') {
    document.getElementById('setup-modal').classList.add('hidden');
    state.net.launchMultiplayerMatch(
      gridSize,
      tickSeconds,
      state.currentIncomeTier,
      state.activeFactionCount,
      state.selectedFactionOrgs,
      unitCaps,
      requestedSeed
    );
    setWorldSeedDisplay();
    return;
  }

  const worldSeed = requestedSeed ?? randomWorldSeed();
  state.net.cleanup(true);
  document.getElementById('setup-modal').classList.add('hidden');
  initWorld(
    gridSize,
    true,
    tickSeconds,
    state.currentIncomeTier,
    state.activeFactionCount,
    state.selectedFactionOrgs,
    worldSeed,
    unitCaps
  );
  setWorldSeedDisplay(worldSeed);
});

document.getElementById('btn-reset').addEventListener('click', openSetupMenu);
document.getElementById('btn-victory-restart').addEventListener('click', openSetupMenu);
document.getElementById('btn-restart-match').addEventListener('click', openSetupMenu);
document.getElementById('btn-spectate-new-game').addEventListener('click', openSetupMenu);
document.getElementById('btn-disconnect-return').addEventListener('click', openSetupMenu);

document.getElementById('btn-victory-continue').addEventListener('click', () => {
  document.getElementById('victory-banner').classList.add('hidden');
});

applyMatchPreset('normal');
setSetupTab('manual');

document.getElementById('btn-spectate-match').addEventListener('click', () => {
  state.isSpectating = true;
  document.getElementById('defeat-banner').classList.add('hidden');
  document.getElementById('spectator-banner').classList.remove('hidden');
});
}


// Setup modal, lobby buttons, banners, toasts and map-size controls.

import { INCOME_TIERS } from '../config/balance.js';
import { ORGANIZATIONS, ALL_ORG_IDS, ensureUniqueOrgs } from '../config/organizations.js';
import { state } from '../core/state.js';
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

export function updateMapSizePreview(val) {
  const n = Math.max(5, Math.min(25, Number(val) || 15));
  document.getElementById('map-size-slider').value = n;
  document.getElementById('map-size-display').textContent = n === 15 ? '15×15 (Default)' : `${n}×${n}`;
  const total = n * n;
  const maxU = Math.max(1, Math.floor(total * 0.05));
  const maxC = Math.max(1, Math.floor(total * 0.10));
  const maxS = Math.max(1, total - maxC - maxU);
  document.getElementById('map-cap-preview').innerHTML = `<span>${total} Neighborhoods</span><span class="font-mono text-emerald-400">Cap: ${maxS}S · ${maxC}C · ${maxU}U</span>`;

  document.querySelectorAll('.size-preset-btn').forEach((btn) => {
    const active = Number(btn.getAttribute('data-size')) === n;
    btn.className = active
      ? 'size-preset-btn bg-amber-500/20 border border-amber-500 text-amber-300 py-1 rounded text-[11px] font-mono font-bold transition'
      : 'size-preset-btn bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 py-1 rounded text-[11px] font-mono font-bold transition';
  });
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
document.querySelectorAll('.game-mode-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.net.setMode(btn.getAttribute('data-mode'));
  });
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

document.getElementById('tick-speed-slider').addEventListener('input', (e) => {
  const sec = Number(e.target.value) || 10;
  const label = sec <= 12 ? `${sec}s (Turbo)` : sec <= 22 ? `${sec}s (Normal)` : `${sec}s (Slow)`;
  document.getElementById('tick-speed-display').textContent = label;
  if (state.net && state.net.mode === 'HOST') state.net.broadcastHostLobbyState();
});

document.querySelectorAll('.income-tier-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.currentIncomeTier = btn.getAttribute('data-income') || 'HIGH';
    const tier = INCOME_TIERS[state.currentIncomeTier];
    document.getElementById('income-tier-display').textContent = `$${tier.min.toLocaleString()}–$${tier.max.toLocaleString()} / tick`;
    document.querySelectorAll('.income-tier-btn').forEach((b) => {
      const active = b.getAttribute('data-income') === state.currentIncomeTier;
      b.className = active
        ? 'income-tier-btn bg-emerald-500/20 border border-emerald-500 text-emerald-300 py-2 px-2 rounded-lg text-center transition'
        : 'income-tier-btn bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 py-2 px-2 rounded-lg text-center transition';
    });
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

  if (state.net && state.net.mode === 'HOST') {
    document.getElementById('setup-modal').classList.add('hidden');
    state.net.launchMultiplayerMatch(gridSize, tickSeconds, state.currentIncomeTier, state.activeFactionCount, state.selectedFactionOrgs);
    return;
  }

  state.net.cleanup(true);
  document.getElementById('setup-modal').classList.add('hidden');
  initWorld(gridSize, true, tickSeconds, state.currentIncomeTier, state.activeFactionCount, state.selectedFactionOrgs, null);
});

document.getElementById('btn-reset').addEventListener('click', openSetupMenu);
document.getElementById('btn-victory-restart').addEventListener('click', openSetupMenu);
document.getElementById('btn-restart-match').addEventListener('click', openSetupMenu);
document.getElementById('btn-spectate-new-game').addEventListener('click', openSetupMenu);
document.getElementById('btn-disconnect-return').addEventListener('click', openSetupMenu);

document.getElementById('btn-victory-continue').addEventListener('click', () => {
  document.getElementById('victory-banner').classList.add('hidden');
});

document.getElementById('btn-spectate-match').addEventListener('click', () => {
  state.isSpectating = true;
  document.getElementById('defeat-banner').classList.add('hidden');
  document.getElementById('spectator-banner').classList.remove('hidden');
});
}


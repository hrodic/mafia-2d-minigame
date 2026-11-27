// Lobby DOM rendering. Network/lobby rules stay in net/lobby.js; this module
// receives plain data and writes safe DOM nodes. Peer names are never inserted
// through innerHTML.

import { ORGANIZATIONS } from '../config/organizations.js';

function make(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function makeBadge(org, sizeClass = 'w-2.5 h-2.5', extraClass = '') {
  const badge = make('span', `${sizeClass} rounded-full flex-shrink-0 ${extraClass}`.trim());
  badge.style.background = org.badge;
  return badge;
}

function occupantRow(occupant, org) {
  const row = make(
    'div',
    'flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-[11px]'
  );
  const info = make('div', 'flex items-center gap-2 truncate');
  info.append(makeBadge(org));
  info.append(make('span', 'font-bold text-white truncate', occupant.name));
  info.append(make('span', 'text-zinc-400', `(${org.short})`));
  const role = make(
    'span',
    `font-mono text-[10px] font-bold ${occupant.isHost ? 'text-amber-300' : 'text-emerald-400'}`,
    occupant.isHost ? 'HOST' : 'PLAYER'
  );
  row.append(info, role);
  return row;
}

function aiRow(idx, org, onToggleSlot) {
  const row = make(
    'div',
    'flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-[11px]'
  );
  const info = make('div', 'flex items-center gap-2 truncate');
  info.append(makeBadge(org));
  info.append(make('span', 'font-semibold text-purple-300', 'AI Syndicate'));
  info.append(make('span', 'text-zinc-400', `(${org.short})`));
  const btn = make(
    'button',
    'mp-slot-toggle bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 text-zinc-200 text-[10px] font-bold px-2 py-0.5 rounded transition',
    'Open Player'
  );
  btn.type = 'button';
  btn.setAttribute('data-toggle-slot', String(idx));
  btn.addEventListener('click', () => onToggleSlot(idx));
  row.append(info, btn);
  return row;
}

function openSlotRow(idx, org, onToggleSlot) {
  const row = make(
    'div',
    'flex items-center justify-between bg-zinc-900/40 border border-dashed border-zinc-800 rounded-lg px-2.5 py-1.5 text-[11px]'
  );
  const info = make('div', 'flex items-center gap-2 truncate');
  info.append(makeBadge(org, 'w-2.5 h-2.5', 'opacity-50'));
  info.append(make('span', 'text-zinc-500 italic', `Open Slot (${org.short})`));
  const btn = make(
    'button',
    'mp-slot-toggle bg-purple-950/80 hover:bg-purple-900 border border-purple-500/50 text-purple-200 text-[10px] font-bold px-2 py-0.5 rounded transition',
    'Close → AI'
  );
  btn.type = 'button';
  btn.setAttribute('data-toggle-slot', String(idx));
  btn.addEventListener('click', () => onToggleSlot(idx));
  row.append(info, btn);
  return row;
}

export function renderHostLobby({
  config,
  slots,
  seatedPeers,
  slotClosedAsAI,
  openHumans,
  hasRoom,
  onToggleSlot,
}) {
  const rosterEl = document.getElementById('mp-host-roster');
  const countEl = document.getElementById('mp-host-player-count');
  const startBtn = document.getElementById('btn-start-game');
  if (!rosterEl) return;

  const toggleSlot = typeof onToggleSlot === 'function' ? onToggleSlot : () => {};
  rosterEl.textContent = '';
  let aiCount = 0;

  for (let idx = 0; idx < config.factionCount; idx++) {
    const slotFaction = slots[idx];
    const org = ORGANIZATIONS[config.orgRoster[idx]] || ORGANIZATIONS.COSA_NOSTRA;
    const occupant = seatedPeers.find((p) => p.faction === slotFaction);

    if (occupant) {
      rosterEl.append(occupantRow(occupant, org));
    } else if (slotClosedAsAI[idx]) {
      aiCount++;
      rosterEl.append(aiRow(idx, org, toggleSlot));
    } else {
      rosterEl.append(openSlotRow(idx, org, toggleSlot));
    }
  }

  const humanCount = seatedPeers.length;
  if (countEl) {
    countEl.textContent = `${humanCount}/${openHumans} Humans · ${aiCount} AI`;
  }

  if (startBtn) {
    const allOpenFilled = humanCount >= 2 && humanCount === openHumans;
    startBtn.disabled = !hasRoom || !allOpenFilled;
    if (!hasRoom) {
      startBtn.textContent = 'Create Room First';
    } else if (humanCount < 2) {
      startBtn.textContent = `Waiting for Players (${humanCount}/${openHumans} Humans)...`;
    } else if (!allOpenFilled) {
      startBtn.textContent = `Waiting for Open Slots (${humanCount}/${openHumans}) or Close → AI`;
    } else {
      startBtn.textContent = `Launch Multiplayer (${humanCount} Humans + ${aiCount} AI)`;
    }
  }
}

export function renderGuestLobby({ roster, settings, me }) {
  const assignedEl = document.getElementById('mp-guest-assigned-faction');
  const settingsEl = document.getElementById('mp-guest-settings-summary');
  const rosterEl = document.getElementById('mp-guest-roster');

  if (assignedEl) {
    assignedEl.textContent = '';
    if (me && settings) {
      const org = ORGANIZATIONS[settings.orgRoster?.[me.slotIdx]] || ORGANIZATIONS.BRATVA;
      const label = make('span', '', `${org.name} (${org.ranks.BOSS})`);
      label.style.color = org.accent;
      assignedEl.append(label);
    } else {
      assignedEl.textContent = 'Assigning seat...';
    }
  }

  if (settingsEl && settings) {
    const caps = settings.unitCaps;
    const capText = caps
      ? ` · Crew max: ${caps.maxSoldiers}S/${caps.maxCaptains}C/${caps.maxUnderbosses}U`
      : '';
    settingsEl.textContent = `Map: ${settings.gridSize}×${settings.gridSize} · Tick: ${settings.tickSeconds}s · Income: ${settings.incomeTier}${capText}`;
  }

  if (!rosterEl) return;
  rosterEl.textContent = '';

  for (const p of roster) {
    const org = ORGANIZATIONS[settings?.orgRoster?.[p.slotIdx]] || ORGANIZATIONS.COSA_NOSTRA;
    const row = make(
      'div',
      'flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1 text-[11px]'
    );
    const info = make('div', 'flex items-center gap-2 truncate');
    info.append(makeBadge(org, 'w-2 h-2'));
    info.append(make('span', 'font-bold text-zinc-200 truncate', p.name));
    info.append(make('span', 'text-zinc-500', `(${org.short})`));
    const role = make(
      'span',
      `font-mono text-[10px] ${p.isHost ? 'text-amber-300' : p.isAI ? 'text-purple-300' : 'text-emerald-400'}`,
      p.isHost ? 'HOST' : p.isAI ? 'AI' : 'PLAYER'
    );
    row.append(info, role);
    rosterEl.append(row);
  }
}

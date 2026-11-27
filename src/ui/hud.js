// HUD: top-bar stats, recruit controls, sprint/timer bars and standings board.

import { Faction, UnitRank } from '../config/enums.js';
import {
  BOSS_MAX_HP,
  MAX_BOSS_ARMOR,
  COST_SOLDIER,
  COST_CAPTAIN,
  COST_UNDERBOSS,
  UPKEEP_SOLDIER,
  UPKEEP_CAPTAIN,
  UPKEEP_UNDERBOSS,
} from '../config/balance.js';
import { SPRINT_MAX_DURATION, SPRINT_COOLDOWN_DURATION } from '../config/constants.js';
import { FACTION_META } from '../config/organizations.js';
import { state, forEachUnit, getLocalFaction, getLocalBoss, isLocalBossAlive } from '../core/state.js';
import { clampPlayerSpawnCaps, getUnitCaps, getUnitCapMin } from '../sim/units.js';
import { calculateFactionUpkeep, calculateCorruption, applyCorruption, recalculateHourlyIncome } from '../sim/economy.js';


function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function setBarFill(el, ratio) {
  if (!el) return;
  const value = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
  el.style.transform = `scaleX(${value})`;
}

function setCapButtonState(el, disabled) {
  if (!el) return;
  el.disabled = disabled;
  el.setAttribute('aria-disabled', disabled ? 'true' : 'false');
}

function syncCapButtons() {
  const { maxSoldiers, maxCaptains, maxUnderbosses } = getUnitCaps();
  const entries = [
    ['soldier', UnitRank.SOLDIER, maxSoldiers],
    ['captain', UnitRank.CAPTAIN, maxCaptains],
    ['underboss', UnitRank.UNDERBOSS, maxUnderbosses],
  ];
  for (const [key, rank, max] of entries) {
    const value = state.playerSpawnCaps[rank];
    const min = getUnitCapMin(rank);
    const atMin = value <= min;
    const atMax = value >= max;
    setCapButtonState(document.getElementById(`btn-cap-${key}-min`), atMin);
    setCapButtonState(document.getElementById(`btn-cap-${key}-dec`), atMin);
    setCapButtonState(document.getElementById(`btn-cap-${key}-max`), atMax);
    setCapButtonState(document.getElementById(`btn-cap-${key}-inc`), atMax);
  }
}

export function setRecruitCapMin(rank) {
  state.playerSpawnCaps[rank] = getUnitCapMin(rank);
  syncRecruitButtonLabels();
}

export function setRecruitCapMax(rank) {
  const { maxSoldiers, maxCaptains, maxUnderbosses } = getUnitCaps();
  const max = rank === UnitRank.SOLDIER
    ? maxSoldiers
    : rank === UnitRank.CAPTAIN
      ? maxCaptains
      : maxUnderbosses;
  state.playerSpawnCaps[rank] = max;
  syncRecruitButtonLabels();
}

/** Collapse/expand the faction leaderboard while keeping its header visible. */
export function toggleFactionBoard(forceCollapsed) {
  const panel = document.getElementById('faction-board');
  const body = document.getElementById('faction-board-body');
  const button = document.getElementById('btn-faction-collapse');
  if (!panel || !body || !button) return;
  const collapsed = typeof forceCollapsed === 'boolean'
    ? forceCollapsed
    : !body.classList.contains('hidden');
  body.classList.toggle('hidden', collapsed);
  panel.classList.toggle('is-collapsed', collapsed);
  button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  button.setAttribute('aria-label', collapsed ? 'Expand faction leaderboard' : 'Collapse faction leaderboard');
  button.textContent = collapsed ? '▾' : '▴';
}

/** Collapse/expand the crew panel while keeping its summary visible. */
export function toggleCrewPanel(forceCollapsed) {
  const panel = document.getElementById('management-panel');
  const body = document.getElementById('management-body');
  const button = document.getElementById('btn-management-collapse');
  if (!panel || !body || !button) return;
  const collapsed = typeof forceCollapsed === 'boolean'
    ? forceCollapsed
    : !body.classList.contains('hidden');
  body.classList.toggle('hidden', collapsed);
  panel.classList.toggle('is-collapsed', collapsed);
  button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  button.setAttribute('aria-label', collapsed ? 'Expand crew management' : 'Collapse crew management');
  button.textContent = collapsed ? '▾' : '▴';
}

const hudEls = {
  statsBadge: document.getElementById('stats-badge'),
  hpBarFill: document.getElementById('hp-bar-fill'),
  hpText: document.getElementById('hp-text'),
  cashText: document.getElementById('cash-text'),
  hourText: document.getElementById('hour-text'),
  tickBarFill: document.getElementById('tick-bar-fill'),
  armorBox: document.getElementById('armor-hud-box'),
  armorBarFill: document.getElementById('armor-bar-fill'),
  armorText: document.getElementById('armor-text'),
  sprintBar: document.getElementById('sprint-bar-fill'),
  sprintText: document.getElementById('sprint-text'),
  factionBoard: document.getElementById('faction-board'),
  factionBoardBody: document.getElementById('faction-board-body'),
  factionCountLabel: document.getElementById('faction-count-label'),
  totalTurf: document.getElementById('mgmt-total-turf'),
  totalCrew: document.getElementById('mgmt-total-crew'),
  totalGross: document.getElementById('mgmt-total-gross'),
  totalUpkeep: document.getElementById('mgmt-total-upkeep'),
  totalCorruption: document.getElementById('mgmt-total-corruption'),
  corruptionBreakdown: document.getElementById('mgmt-corruption-breakdown'),
  totalNet: document.getElementById('mgmt-total-net'),
};

function syncRankAliveCounts() {
  const myFac = getLocalFaction();
  const counts = {
    [UnitRank.SOLDIER]: 0,
    [UnitRank.CAPTAIN]: 0,
    [UnitRank.UNDERBOSS]: 0,
  };
  for (const unit of state.npcs) {
    if (unit.faction === myFac && counts[unit.rank] !== undefined) counts[unit.rank]++;
  }
  for (const [key, rank] of [
    ['soldier', UnitRank.SOLDIER],
    ['captain', UnitRank.CAPTAIN],
    ['underboss', UnitRank.UNDERBOSS],
  ]) {
    const el = document.getElementById(`mgmt-alive-${key}`);
    if (!el) continue;
    const alive = counts[rank];
    el.textContent = `(${alive} alive)`;
    el.classList.toggle('is-zero', alive === 0);
  }
}

export function syncRecruitButtonLabels() {
  clampPlayerSpawnCaps();
  const myFac = getLocalFaction();
  const { maxSoldiers, maxCaptains, maxUnderbosses } = getUnitCaps();
  const pRanks = FACTION_META[myFac].ranks;
  const setSwitch = (buttonId, labelId, on, rankName) => {
    const button = document.getElementById(buttonId);
    if (button) {
      button.setAttribute('aria-checked', on ? 'true' : 'false');
      button.classList.toggle('is-on', on);
      button.setAttribute('aria-label', `Auto-spawn ${rankName}`);
    }
    const label = document.getElementById(labelId);
    if (label) label.textContent = on ? 'ON' : 'OFF';
  };
  setSwitch('btn-toggle-soldier', 'mgmt-auto-soldier', state.autoRecruitSoldier, pRanks.SOLDIER);
  setSwitch('btn-toggle-captain', 'mgmt-auto-captain', state.autoRecruitCaptain, pRanks.CAPTAIN);
  setSwitch('btn-toggle-underboss', 'mgmt-auto-underboss', state.autoRecruitUnderboss, pRanks.UNDERBOSS);
  document.getElementById('mgmt-rank-soldier').textContent = pRanks.SOLDIER;
  document.getElementById('mgmt-rank-captain').textContent = pRanks.CAPTAIN;
  document.getElementById('mgmt-rank-underboss').textContent = pRanks.UNDERBOSS;

  const setEconomy = (key, cost, upkeep) => {
    const price = document.getElementById(`mgmt-price-${key}`);
    const upkeepEl = document.getElementById(`mgmt-upkeep-${key}`);
    if (price) price.textContent = `$${cost.toLocaleString()}`;
    if (upkeepEl) upkeepEl.textContent = `-$${upkeep}/hr upkeep`;
  };
  setEconomy('soldier', COST_SOLDIER, UPKEEP_SOLDIER);
  setEconomy('captain', COST_CAPTAIN, UPKEEP_CAPTAIN);
  setEconomy('underboss', COST_UNDERBOSS, UPKEEP_UNDERBOSS);

  const setCapLabel = (key, rank, max) => {
    const el = document.getElementById(`cap-${key}-label`);
    if (!el) return;
    const min = getUnitCapMin(rank);
    el.textContent = `${state.playerSpawnCaps[rank]}/${max}`;
    el.title = `${pRanks[rank]} spawn cap · min ${min}, max ${max}`;
    el.setAttribute(
      'aria-label',
      `${pRanks[rank]} spawn cap ${state.playerSpawnCaps[rank]} of ${max}, minimum ${min}`
    );
    if (el.parentElement) {
      el.parentElement.title = `${pRanks[rank]} spawn cap · ${min}–${max}`;
    }
  };
  setCapLabel('soldier', UnitRank.SOLDIER, maxSoldiers);
  setCapLabel('captain', UnitRank.CAPTAIN, maxCaptains);
  setCapLabel('underboss', UnitRank.UNDERBOSS, maxUnderbosses);

  syncCapButtons();
  syncRankAliveCounts();
}

export function updateHUD() {
  const myFac = getLocalFaction();
  const myBoss = getLocalBoss();
  const myAlive = isLocalBossAlive();

  const hpVal = myAlive ? Math.max(0, Math.round(myBoss.hp)) : 0;
  const maxHpVal = myBoss.maxHp || BOSS_MAX_HP;
  setBarFill(hudEls.hpBarFill, hpVal / maxHpVal);
  hudEls.hpText.textContent = `${hpVal}/${maxHpVal}`;

  const armorVal = myAlive ? Math.max(0, Math.round(myBoss.armor || 0)) : 0;
  if (armorVal > 0) {
    hudEls.armorBox.classList.remove('hidden');
    hudEls.armorBox.classList.add('flex');
    setBarFill(hudEls.armorBarFill, armorVal / MAX_BOSS_ARMOR);
    hudEls.armorText.textContent = `${armorVal}`;
  } else {
    hudEls.armorBox.classList.add('hidden');
    hudEls.armorBox.classList.remove('flex');
  }

  const myCash = state.treasuries[myFac] || 0;
  hudEls.cashText.textContent = myCash < 0
    ? `-$${Math.abs(myCash).toLocaleString()}`
    : `$${myCash.toLocaleString()}`;
  hudEls.cashText.classList.toggle('is-negative', myCash < 0);
  syncCapButtons();
  syncRankAliveCounts();

  if (myBoss.sprintCooldown > 0) {
    setBarFill(
      hudEls.sprintBar,
      (SPRINT_COOLDOWN_DURATION - myBoss.sprintCooldown) / SPRINT_COOLDOWN_DURATION
    );
    hudEls.sprintText.textContent = `${myBoss.sprintCooldown.toFixed(1)}s`;
  } else if (myBoss.isSprinting) {
    setBarFill(
      hudEls.sprintBar,
      (SPRINT_MAX_DURATION - myBoss.sprintTimer) / SPRINT_MAX_DURATION
    );
    hudEls.sprintText.textContent = 'RUN';
  } else {
    setBarFill(hudEls.sprintBar, 1);
    hudEls.sprintText.textContent = 'RDY';
  }

  const hourStr = String(state.gameHour).padStart(2, '0') + ':00';
  hudEls.hourText.textContent = hourStr;
  setBarFill(hudEls.tickBarFill, state.tickTimer / (state.tickDuration || 1));

  const incomeTotals = recalculateHourlyIncome();
  const upkeepTotals = calculateFactionUpkeep();
  const corruptionTotals = calculateCorruption();
  const myCorruption = corruptionTotals[myFac] || { turf: 0, crew: 0, total: 0 };
  const myEffectiveIncome = applyCorruption(incomeTotals[myFac] || 0, myCorruption.total);
  const myCorruptionLoss = Math.max(0, (incomeTotals[myFac] || 0) - myEffectiveIncome);
  if (hudEls.totalUpkeep) {
    const upkeep = upkeepTotals[myFac] || 0;
    hudEls.totalUpkeep.textContent = upkeep > 0
      ? `-$${upkeep.toLocaleString()}/hr`
      : '$0/hr';
  }
  if (hudEls.totalGross) {
    hudEls.totalGross.textContent = `+$${(incomeTotals[myFac] || 0).toLocaleString()}/hr`;
  }
  if (hudEls.totalCorruption) {
    hudEls.totalCorruption.textContent = myCorruptionLoss > 0
      ? `-$${myCorruptionLoss.toLocaleString()} (${myCorruption.total}%)`
      : `$0 (${myCorruption.total}%)`;
  }
  if (hudEls.corruptionBreakdown) {
    hudEls.corruptionBreakdown.textContent =
      `Turf ${myCorruption.turf}% · Crew ${myCorruption.crew}%`;
  }
  const blockCounts = {
    [Faction.PLAYER]: 0,
    [Faction.RIVAL_1]: 0,
    [Faction.RIVAL_2]: 0,
    [Faction.RIVAL_3]: 0,
  };
  const crewCounts = {
    [Faction.PLAYER]: 0,
    [Faction.RIVAL_1]: 0,
    [Faction.RIVAL_2]: 0,
    [Faction.RIVAL_3]: 0,
  };
  const killCounts = state.factionKills || {};
  const deathCounts = state.factionDeaths || {};

  for (const chunk of state.world.chunks.values()) {
    if (blockCounts[chunk.faction] !== undefined) blockCounts[chunk.faction]++;
  }
  forEachUnit((unit) => {
    if (crewCounts[unit.faction] !== undefined) crewCounts[unit.faction]++;
  });

  const totalBlocks = Math.max(1, state.world.chunks.size);
  const myNetIncome = myEffectiveIncome - (upkeepTotals[myFac] || 0);
  const netText = myNetIncome < 0
    ? `-$${Math.abs(myNetIncome).toLocaleString()}/hr`
    : `+$${myNetIncome.toLocaleString()}/hr`;
  if (hudEls.totalTurf) {
    hudEls.totalTurf.textContent = `${blockCounts[myFac] || 0}/${totalBlocks}`;
  }
  if (hudEls.totalCrew) {
    hudEls.totalCrew.textContent = `${crewCounts[myFac] || 0}`;
  }
  if (hudEls.totalNet) {
    hudEls.totalNet.textContent = netText;
    hudEls.totalNet.classList.toggle('is-positive', myNetIncome >= 0);
    hudEls.totalNet.classList.toggle('is-negative', myNetIncome < 0);
  }
  hudEls.statsBadge.textContent = `Turf: ${blockCounts[myFac] || 0}/${totalBlocks} | Crew: ${crewCounts[myFac] || 0} | Net: ${netText}`;

  if (hudEls.factionCountLabel) {
    hudEls.factionCountLabel.textContent = `${state.activeFactions.length} syndicates`;
  }

  let boardHtml = `
      <div class="grid grid-cols-[1fr_2.4rem_2.3rem_2.6rem] gap-1 mt-1 text-[9px] font-bold uppercase tracking-wider text-zinc-500">
        <span>Syndicate</span>
        <span class="text-right" title="Neighborhoods controlled">Turf</span>
        <span class="text-right" title="Enemy units killed">Kills</span>
        <span class="text-right" title="Units lost">Deaths</span>
      </div>
    `;
  const ranked = [...state.activeFactions].sort(
    (a, b) =>
      (blockCounts[b] || 0) - (blockCounts[a] || 0) ||
      (killCounts[b] || 0) - (killCounts[a] || 0) ||
      (deathCounts[a] || 0) - (deathCounts[b] || 0)
  );
  ranked.forEach((f, index) => {
    const meta = FACTION_META[f];
    const alive = state.factionAlive[f];
    const isMe = f === myFac;
    const alias = state.net && state.net.isActive() ? state.net.getAliasForFaction(f) : null;
    const displayName = alias ? `${meta.short} · ${escapeHtml(alias)}` : meta.short;
    boardHtml += `
      <div class="grid grid-cols-[1fr_2.4rem_2.3rem_2.6rem] items-center gap-1 ${!alive ? 'opacity-45 line-through' : ''} ${isMe ? 'bg-amber-500/5 -mx-1 px-1 rounded' : ''}">
        <div class="flex items-center gap-1.5 min-w-0">
          <span class="text-[9px] font-mono text-zinc-600 w-3">${index + 1}</span>
          <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${meta.badge}"></span>
          <span class="font-bold truncate ${isMe ? 'text-amber-300' : 'text-zinc-200'}">${displayName}${isMe ? ' (You)' : ''}</span>
        </div>
        <span class="text-right font-mono text-[11px] text-zinc-300">${blockCounts[f] || 0}</span>
        <span class="text-right font-mono text-[11px] ${killCounts[f] ? 'text-emerald-300' : 'text-zinc-500'}">${killCounts[f] || 0}</span>
        <span class="text-right font-mono text-[11px] ${deathCounts[f] ? 'text-rose-300' : 'text-zinc-500'}">${deathCounts[f] || 0}</span>
      </div>
    `;
  });
  if (hudEls.factionBoardBody) hudEls.factionBoardBody.innerHTML = boardHtml;
}

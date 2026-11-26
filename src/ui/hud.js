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
import { clampPlayerSpawnCaps, getUnitCaps } from '../sim/units.js';
import { calculateFactionUpkeep, recalculateHourlyIncome } from '../sim/economy.js';


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
  totalUpkeep: document.getElementById('mgmt-total-upkeep'),
};

export function syncRecruitButtonLabels() {
  clampPlayerSpawnCaps();
  const myFac = getLocalFaction();
  const { maxSoldiers, maxCaptains, maxUnderbosses } = getUnitCaps();
  const pRanks = FACTION_META[myFac].ranks;
  const btnS = document.getElementById('btn-toggle-soldier');
  const btnC = document.getElementById('btn-toggle-captain');
  const btnU = document.getElementById('btn-toggle-underboss');
  btnS.textContent = `Auto ${pRanks.SOLDIER}: ${state.autoRecruitSoldier ? 'ON' : 'OFF'}`;
  btnC.textContent = `Auto ${pRanks.CAPTAIN}: ${state.autoRecruitCaptain ? 'ON' : 'OFF'}`;
  btnU.textContent = `Auto ${pRanks.UNDERBOSS}: ${state.autoRecruitUnderboss ? 'ON' : 'OFF'}`;

  const costS = document.getElementById('mgmt-cost-soldier');
  const costC = document.getElementById('mgmt-cost-captain');
  const costU = document.getElementById('mgmt-cost-underboss');
  if (costS) costS.textContent = `$${COST_SOLDIER.toLocaleString()} · $${UPKEEP_SOLDIER}/hr upkeep`;
  if (costC) costC.textContent = `$${COST_CAPTAIN.toLocaleString()} · $${UPKEEP_CAPTAIN}/hr upkeep`;
  if (costU) costU.textContent = `$${COST_UNDERBOSS.toLocaleString()} · $${UPKEEP_UNDERBOSS}/hr upkeep`;

  document.getElementById('cap-soldier-label').textContent =
    `${state.playerSpawnCaps[UnitRank.SOLDIER]}/${maxSoldiers}`;
  document.getElementById('cap-captain-label').textContent =
    `${state.playerSpawnCaps[UnitRank.CAPTAIN]}/${maxCaptains}`;
  document.getElementById('cap-underboss-label').textContent =
    `${state.playerSpawnCaps[UnitRank.UNDERBOSS]}/${maxUnderbosses}`;
}

export function updateHUD() {
  const myFac = getLocalFaction();
  const myBoss = getLocalBoss();
  const myAlive = isLocalBossAlive();

  const hpVal = myAlive ? Math.max(0, Math.round(myBoss.hp)) : 0;
  const maxHpVal = myBoss.maxHp || BOSS_MAX_HP;
  hudEls.hpBarFill.style.width = `${Math.round((hpVal / maxHpVal) * 100)}%`;
  hudEls.hpText.textContent = `${hpVal}/${maxHpVal}`;

  const armorVal = myAlive ? Math.max(0, Math.round(myBoss.armor || 0)) : 0;
  if (armorVal > 0) {
    hudEls.armorBox.classList.remove('hidden');
    hudEls.armorBox.classList.add('flex');
    hudEls.armorBarFill.style.width = `${Math.round((armorVal / MAX_BOSS_ARMOR) * 100)}%`;
    hudEls.armorText.textContent = `${armorVal}`;
  } else {
    hudEls.armorBox.classList.add('hidden');
    hudEls.armorBox.classList.remove('flex');
  }

  const myCash = state.treasuries[myFac] || 0;
  hudEls.cashText.textContent = `$${myCash.toLocaleString()}`;

  if (myBoss.sprintCooldown > 0) {
    const pct = Math.round(((SPRINT_COOLDOWN_DURATION - myBoss.sprintCooldown) / SPRINT_COOLDOWN_DURATION) * 100);
    hudEls.sprintBar.style.width = `${pct}%`;
    hudEls.sprintText.textContent = `${myBoss.sprintCooldown.toFixed(1)}s`;
  } else if (myBoss.isSprinting) {
    const pct = Math.round(((SPRINT_MAX_DURATION - myBoss.sprintTimer) / SPRINT_MAX_DURATION) * 100);
    hudEls.sprintBar.style.width = `${pct}%`;
    hudEls.sprintText.textContent = 'RUN';
  } else {
    hudEls.sprintBar.style.width = '100%';
    hudEls.sprintText.textContent = 'RDY';
  }

  const hourStr = String(state.gameHour).padStart(2, '0') + ':00';
  hudEls.hourText.textContent = hourStr;
  hudEls.tickBarFill.style.width = `${Math.min(100, Math.round((state.tickTimer / state.tickDuration) * 100))}%`;

  const incomeTotals = recalculateHourlyIncome();
  const upkeepTotals = calculateFactionUpkeep();
  if (hudEls.totalUpkeep) {
    hudEls.totalUpkeep.textContent = `$${(upkeepTotals[myFac] || 0).toLocaleString()}/hr`;
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

  for (const chunk of state.world.chunks.values()) {
    if (blockCounts[chunk.faction] !== undefined) blockCounts[chunk.faction]++;
  }
  forEachUnit((unit) => {
    if (crewCounts[unit.faction] !== undefined) crewCounts[unit.faction]++;
  });

  const totalBlocks = Math.max(1, state.world.chunks.size);
  const myNetIncome = (incomeTotals[myFac] || 0) - (upkeepTotals[myFac] || 0);
  hudEls.statsBadge.textContent = `Turf: ${blockCounts[myFac] || 0}/${totalBlocks} | Crew: ${crewCounts[myFac] || 0} | Net: ${myNetIncome >= 0 ? '+' : ''}$${myNetIncome.toLocaleString()}/hr`;

  let boardHtml = `
    <div class="border-b border-zinc-800 pb-1.5">
      <div class="flex items-center justify-between gap-2">
        <span class="text-[10px] font-bold uppercase tracking-wider text-zinc-300">Faction Leaderboard</span>
        <span class="text-[9px] font-mono text-zinc-600">${state.activeFactions.length} syndicates</span>
      </div>
      <div class="grid grid-cols-[1fr_2.6rem_2.4rem_2.4rem] gap-1 mt-1 text-[9px] font-bold uppercase tracking-wider text-zinc-500">
        <span>Syndicate</span>
        <span class="text-right" title="Neighborhoods controlled">Turf</span>
        <span class="text-right" title="Living crew members">Crew</span>
        <span class="text-right" title="Enemy units killed">Kills</span>
      </div>
    </div>`;
  const ranked = [...state.activeFactions].sort(
    (a, b) =>
      (blockCounts[b] || 0) - (blockCounts[a] || 0) ||
      (killCounts[b] || 0) - (killCounts[a] || 0) ||
      (crewCounts[b] || 0) - (crewCounts[a] || 0)
  );
  ranked.forEach((f, index) => {
    const meta = FACTION_META[f];
    const alive = state.factionAlive[f];
    const isMe = f === myFac;
    const alias = state.net && state.net.isActive() ? state.net.getAliasForFaction(f) : null;
    const displayName = alias ? `${meta.short} · ${alias}` : meta.short;
    boardHtml += `
      <div class="grid grid-cols-[1fr_2.6rem_2.4rem_2.4rem] items-center gap-1 ${!alive ? 'opacity-45 line-through' : ''} ${isMe ? 'bg-amber-500/5 -mx-1 px-1 rounded' : ''}">
        <div class="flex items-center gap-1.5 min-w-0">
          <span class="text-[9px] font-mono text-zinc-600 w-3">${index + 1}</span>
          <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${meta.badge}"></span>
          <span class="font-bold truncate ${isMe ? 'text-amber-300' : 'text-zinc-200'}">${displayName}${isMe ? ' (You)' : ''}</span>
        </div>
        <span class="text-right font-mono text-[11px] text-zinc-300">${blockCounts[f] || 0}</span>
        <span class="text-right font-mono text-[11px] text-zinc-300">${crewCounts[f] || 0}</span>
        <span class="text-right font-mono text-[11px] ${killCounts[f] ? 'text-rose-300' : 'text-zinc-500'}">${killCounts[f] || 0}</span>
      </div>
    `;
  });
  hudEls.factionBoard.innerHTML = boardHtml;
}

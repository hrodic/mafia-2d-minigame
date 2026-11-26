// HUD: top-bar stats, recruit controls, sprint/timer bars and standings board.

import { Faction, UnitRank } from '../config/enums.js';
import {
  BOSS_MAX_HP,
  MAX_BOSS_ARMOR,
  COST_SOLDIER,
  COST_CAPTAIN,
  COST_UNDERBOSS,
} from '../config/balance.js';
import { SPRINT_MAX_DURATION, SPRINT_COOLDOWN_DURATION } from '../config/constants.js';
import { FACTION_META } from '../config/organizations.js';
import { state, getLocalFaction, getLocalBoss, isLocalBossAlive } from '../core/state.js';
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
};

export function syncRecruitButtonLabels() {
  clampPlayerSpawnCaps();
  const myFac = getLocalFaction();
  const { maxSoldiers, maxCaptains, maxUnderbosses } = getUnitCaps();
  const pRanks = FACTION_META[myFac].ranks;
  const btnS = document.getElementById('btn-toggle-soldier');
  const btnC = document.getElementById('btn-toggle-captain');
  const btnU = document.getElementById('btn-toggle-underboss');
  btnS.textContent = `Auto ${pRanks.SOLDIER}: ${state.autoRecruitSoldier ? 'ON' : 'OFF'} ($${COST_SOLDIER.toLocaleString()})`;
  btnC.textContent = `Auto ${pRanks.CAPTAIN}: ${state.autoRecruitCaptain ? 'ON' : 'OFF'} ($${COST_CAPTAIN.toLocaleString()})`;
  btnU.textContent = `Auto ${pRanks.UNDERBOSS}: ${state.autoRecruitUnderboss ? 'ON' : 'OFF'} ($${COST_UNDERBOSS.toLocaleString()})`;

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

  for (const chunk of state.world.chunks.values()) {
    if (blockCounts[chunk.faction] !== undefined) blockCounts[chunk.faction]++;
  }
  for (let i = 0; i < state.npcs.length; i++) {
    const u = state.npcs[i];
    if (crewCounts[u.faction] !== undefined) crewCounts[u.faction]++;
  }
  if (state.player.alive) crewCounts[Faction.PLAYER]++;

  const totalBlocks = Math.max(1, state.world.chunks.size);
  const myNetIncome = (incomeTotals[myFac] || 0) - (upkeepTotals[myFac] || 0);
  hudEls.statsBadge.textContent = `Turf: ${blockCounts[myFac] || 0}/${totalBlocks} | Crew: ${crewCounts[myFac] || 0} | Net: ${myNetIncome >= 0 ? '+' : ''}$${myNetIncome.toLocaleString()}/hr`;

  let boardHtml = `<div class="text-[10px] font-bold uppercase tracking-wider text-zinc-400 border-b border-zinc-800 pb-1 flex justify-between"><span>Syndicate Standings</span><span>Turf · Crew</span></div>`;
  for (const f of state.activeFactions) {
    const meta = FACTION_META[f];
    const alive = state.factionAlive[f];
    const isMe = f === myFac;
    const alias = state.net && state.net.isActive() ? state.net.getAliasForFaction(f) : null;
    const displayName = alias ? `${meta.short} · ${alias}` : meta.short;
    boardHtml += `
      <div class="flex items-center justify-between gap-2 ${!alive ? 'opacity-45 line-through' : ''}">
        <div class="flex items-center gap-1.5 truncate">
          <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${meta.badge}"></span>
          <span class="font-bold truncate ${isMe ? 'text-amber-300' : 'text-zinc-200'}">${displayName}${isMe ? ' (You)' : ''}</span>
        </div>
        <span class="font-mono text-[11px] text-zinc-300 flex-shrink-0">${blockCounts[f]} · ${crewCounts[f]}</span>
      </div>
    `;
  }
  hudEls.factionBoard.innerHTML = boardHtml;
}

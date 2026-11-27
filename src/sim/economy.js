// Faction economy: upkeep, hourly neighborhood income and the recruitment tick.

import { Faction, UnitRank } from '../config/enums.js';
import { UPKEEP_SOLDIER, UPKEEP_CAPTAIN, UPKEEP_UNDERBOSS } from '../config/balance.js';
import { state } from '../core/state.js';
import { emit } from '../core/events.js';
import { recruitUnit } from './units.js';


export function calculateFactionUpkeep() {
  const totals = {
    [Faction.PLAYER]: 0,
    [Faction.RIVAL_1]: 0,
    [Faction.RIVAL_2]: 0,
    [Faction.RIVAL_3]: 0,
  };
  for (let i = 0; i < state.npcs.length; i++) {
    const u = state.npcs[i];
    if (totals[u.faction] === undefined) continue;
    if (u.rank === UnitRank.SOLDIER) totals[u.faction] += UPKEEP_SOLDIER;
    else if (u.rank === UnitRank.CAPTAIN) totals[u.faction] += UPKEEP_CAPTAIN;
    else if (u.rank === UnitRank.UNDERBOSS) totals[u.faction] += UPKEEP_UNDERBOSS;
  }
  return totals;
}

export function recalculateHourlyIncome() {
  const totals = {
    [Faction.PLAYER]: 0,
    [Faction.RIVAL_1]: 0,
    [Faction.RIVAL_2]: 0,
    [Faction.RIVAL_3]: 0,
  };
  for (const chunk of state.world.chunks.values()) {
    if (totals[chunk.faction] !== undefined) {
      totals[chunk.faction] += chunk.income;
    }
  }
  return totals;
}

export function processHourlyTick() {
  state.gameHour = (state.gameHour + 1) % 24;
  const incomeTotals = recalculateHourlyIncome();
  const upkeepTotals = calculateFactionUpkeep();

  for (const f of state.activeFactions) {
    if (!state.factionAlive[f]) continue;
    const net = (incomeTotals[f] || 0) - (upkeepTotals[f] || 0);
    state.treasuries[f] += net;
  }

  const cachedCounts = {};
  const cachedOwned = {};
  for (const f of state.activeFactions) {
    cachedCounts[f] = { soldiers: 0, captains: 0, underbosses: 0 };
    cachedOwned[f] = [];
  }
  for (let i = 0; i < state.npcs.length; i++) {
    const u = state.npcs[i];
    const bucket = cachedCounts[u.faction];
    if (!bucket) continue;
    if (u.rank === UnitRank.SOLDIER) bucket.soldiers++;
    else if (u.rank === UnitRank.CAPTAIN) bucket.captains++;
    else if (u.rank === UnitRank.UNDERBOSS) bucket.underbosses++;
  }
  for (const chunk of state.world.chunks.values()) {
    if (cachedOwned[chunk.faction]) {
      cachedOwned[chunk.faction].push(chunk);
    }
  }

  for (const f of state.activeFactions) {
    if (!state.factionAlive[f]) continue;
    const isHostPlayer = f === Faction.PLAYER;
    const isRemoteHuman = !isHostPlayer && state.net && state.net.isHumanFaction(f);

    let wantUnderboss = true;
    let wantCaptain = true;
    let wantSoldier = true;

    if (isHostPlayer) {
      wantUnderboss = state.autoRecruitUnderboss;
      wantCaptain = state.autoRecruitCaptain;
      wantSoldier = state.autoRecruitSoldier;
    } else if (isRemoteHuman) {
      const prefs = state.factionRecruitmentPrefs[f];
      if (prefs) {
        wantUnderboss = prefs.autoUnderboss;
        wantCaptain = prefs.autoCaptain;
        wantSoldier = prefs.autoSoldier;
      }
    }

    let recruitGuard = 0;
    if (wantUnderboss) {
      while (recruitGuard++ < 3 && recruitUnit(f, UnitRank.UNDERBOSS, !isHostPlayer, cachedCounts, cachedOwned[f])) {}
    }
    recruitGuard = 0;
    if (wantCaptain) {
      while (recruitGuard++ < 4 && recruitUnit(f, UnitRank.CAPTAIN, !isHostPlayer, cachedCounts, cachedOwned[f])) {}
    }
    recruitGuard = 0;
    if (wantSoldier) {
      while (recruitGuard++ < 8 && recruitUnit(f, UnitRank.SOLDIER, !isHostPlayer, cachedCounts, cachedOwned[f])) {}
    }
  }

  state.minimapCacheTimer = 1.0;
  emit('hour:tick', {
    hour: state.gameHour,
    income: incomeTotals,
    upkeep: upkeepTotals,
    treasuries: { ...state.treasuries },
  });
}

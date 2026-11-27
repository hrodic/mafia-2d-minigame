// Faction economy: upkeep, hourly neighborhood income and the recruitment tick.

import { Faction, UnitRank } from '../config/enums.js';
import { UPKEEP_SOLDIER, UPKEEP_CAPTAIN, UPKEEP_UNDERBOSS, CORRUPTION } from '../config/balance.js';
import { state, forEachUnit } from '../core/state.js';
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

/** Corruption percentages from neighborhood count and living unit count. */
export function calculateCorruption() {
  const neighborhoods = {
    [Faction.PLAYER]: 0,
    [Faction.RIVAL_1]: 0,
    [Faction.RIVAL_2]: 0,
    [Faction.RIVAL_3]: 0,
  };
  const units = { ...neighborhoods };
  for (const chunk of state.world.chunks.values()) {
    if (neighborhoods[chunk.faction] !== undefined) neighborhoods[chunk.faction]++;
  }
  forEachUnit((unit) => {
    if (units[unit.faction] !== undefined) units[unit.faction]++;
  });

  const result = {};
  for (const faction of Object.keys(neighborhoods)) {
    const turf = Math.floor(neighborhoods[faction] / CORRUPTION.neighborhoodsPerStep)
      * CORRUPTION.percentPerStep;
    const crew = Math.floor(units[faction] / CORRUPTION.unitsPerStep)
      * CORRUPTION.percentPerStep;
    result[faction] = { turf, crew, total: turf + crew };
  }
  return result;
}

/** Apply total corruption as an income penalty, rounded to whole dollars. */
export function applyCorruption(income, totalPercent) {
  const percent = Math.max(0, Math.min(100, totalPercent || 0));
  return Math.round(income * (1 - percent / 100));
}

export function processHourlyTick() {
  state.gameHour = (state.gameHour + 1) % 24;
  const incomeTotals = recalculateHourlyIncome();
  const upkeepTotals = calculateFactionUpkeep();
  const corruption = calculateCorruption();
  const effectiveIncome = {};

  for (const f of state.activeFactions) {
    if (!state.factionAlive[f]) continue;
    effectiveIncome[f] = applyCorruption(incomeTotals[f] || 0, corruption[f]?.total || 0);
    const net = effectiveIncome[f] - (upkeepTotals[f] || 0);
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
    income: effectiveIncome,
    grossIncome: incomeTotals,
    corruption,
    upkeep: upkeepTotals,
    treasuries: { ...state.treasuries },
  });
}

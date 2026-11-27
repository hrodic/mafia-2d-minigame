// Match setup: builds a fresh city, factions, economy and rival bosses.

import { Faction, UnitRank } from '../config/enums.js';
import {
  ALL_ORG_IDS,
  FACTION_META,
  ORGANIZATIONS,
} from '../config/organizations.js';
import { state, createGameState, getLocalBoss } from '../core/state.js';
import { emit } from '../core/events.js';
import { resetDefaultPlayerSpawnCaps, spawnUnitInChunk } from './units.js';


export function initWorld(
  gridSize = state.currentGridSize,
  autoStart = true,
  selectedTickSeconds = state.tickDuration,
  selectedIncomeTier = state.currentIncomeTier,
  factionCount = state.activeFactionCount,
  orgRoster = state.selectedFactionOrgs,
  seedOverride = null,
  unitCaps = state.matchUnitCaps
) {
  Object.assign(
    state,
    createGameState({
      gridSize,
      autoStart,
      tickDuration: selectedTickSeconds,
      incomeTier: selectedIncomeTier,
      factionCount,
      orgRoster,
      seed: seedOverride,
      unitCaps,
      world: state.world,
      net: state.net,
    })
  );

  state.activeFactions.forEach((slot, idx) => {
    const orgId = state.selectedFactionOrgs[idx] || ALL_ORG_IDS[idx];
    FACTION_META[slot] = { ...ORGANIZATIONS[orgId] };
  });

  state.world.generation = {
    seed: state.currentWorldSeed,
    gridSize: state.currentGridSize,
    incomeTier: state.currentIncomeTier,
    activeFactions: state.activeFactions,
  };
  state.world.clear();

  for (let cy = 0; cy < state.currentGridSize; cy++) {
    for (let cx = 0; cx < state.currentGridSize; cx++) {
      state.world.generateChunk(cx, cy);
    }
  }

  resetDefaultPlayerSpawnCaps();

  const last = state.currentGridSize - 1;
  const cornerCoords = {
    [Faction.RIVAL_1]: { cx: last, cy: 0 },
    [Faction.RIVAL_2]: { cx: 0, cy: last },
    [Faction.RIVAL_3]: { cx: last, cy: last },
  };

  for (const slot of state.activeFactions) {
    if (slot === Faction.PLAYER) continue;
    const pos = cornerCoords[slot];
    const hq = state.world.getChunk(pos.cx, pos.cy);
    if (hq) {
      spawnUnitInChunk(slot, hq, UnitRank.BOSS);
    }
  }

  const localBoss = getLocalBoss();
  state.camera.x = localBoss.x;
  state.camera.y = localBoss.y;

  emit('match:initialized', {
    tickDuration: state.tickDuration,
    worldSeed: state.currentWorldSeed,
  });
}

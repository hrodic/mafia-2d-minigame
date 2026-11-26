// Territory capture, faction elimination and victory/defeat transitions.
// Presentation side effects go through core/runtime.js hooks.

import { Faction, UnitRank } from '../config/enums.js';
import { CHUNK_PX } from '../config/constants.js';
import { FACTION_META } from '../config/organizations.js';
import { state, getLocalFaction } from '../core/state.js';
import { runtime } from '../core/runtime.js';
import { addFloatingText } from '../render/effects.js';

export const CAPTURE_RATES = {
  [UnitRank.BOSS]: 0.375,
  [UnitRank.UNDERBOSS]: 0.24,
  [UnitRank.CAPTAIN]: 0.18,
  [UnitRank.SOLDIER]: 0.12,
};

export function getCaptureRate(rank) {
  return CAPTURE_RATES[rank] ?? CAPTURE_RATES[UnitRank.SOLDIER];
}

/** Advance capture progress for a faction; returns true when the chunk flips. */
export function progressCapture(chunk, faction, dt, rate) {
  if (!chunk || chunk.faction === faction) return false;
  if (!state.factionAlive[faction]) return false;
  if (chunk.capturingFaction !== faction) {
    chunk.capturingFaction = faction;
    chunk.captureProgress = 0;
  }
  chunk.captureProgress += dt * rate;
  if (chunk.captureProgress >= 1) {
    chunk.faction = faction;
    chunk.captureProgress = 0;
    chunk.capturingFaction = null;
    return true;
  }
  return false;
}

/** Presentation for a freshly captured chunk (floating label, radar, HUD). */
export function onChunkCaptured(chunk, faction) {
  addFloatingText(
    chunk.cx * CHUNK_PX + CHUNK_PX / 2,
    chunk.cy * CHUNK_PX + 28,
    `${FACTION_META[faction].short} TURF`,
    FACTION_META[faction].accent
  );
  state.minimapCacheTimer = 1.0;
  runtime.updateHUD();
}

export function checkVictoryCondition() {
  const myFac = getLocalFaction();
  if (state.victoryShown || state.gameOver || !state.factionAlive[myFac]) return;
  const anyRivalAlive = state.activeFactions.some((f) => f !== myFac && state.factionAlive[f]);

  if (!anyRivalAlive) {
    state.victoryShown = true;
    const myBlocks = Array.from(state.world.chunks.values()).filter((c) => c.faction === myFac).length;
    const survivingCrew = state.npcs.filter((n) => n.faction === myFac).length;
    const myOrg = FACTION_META[myFac];
    runtime.onVictory(
      `All rival Supreme Leaders have been eliminated! ${myOrg.name} (${myOrg.ranks.BOSS}) rules ${myBlocks}/${state.world.chunks.size} neighborhoods with $${state.treasuries[myFac].toLocaleString()} in cash and ${survivingCrew} surviving crew.`
    );
  }
}

export function eliminateFaction(faction) {
  if (!state.factionAlive[faction]) return;
  state.factionAlive[faction] = false;
  state.treasuries[faction] = 0;

  for (const chunk of state.world.chunks.values()) {
    if (chunk.faction === faction) {
      chunk.faction = Faction.NEUTRAL;
      chunk.captureProgress = 0;
      chunk.capturingFaction = null;
    }
    if (chunk.capturingFaction === faction) {
      chunk.captureProgress = 0;
      chunk.capturingFaction = null;
    }
  }

  if (faction === Faction.PLAYER) {
    state.player.alive = false;
  }

  if (faction === getLocalFaction()) {
    state.gameOver = true;
    runtime.onDefeat();
  } else {
    runtime.onFactionEliminated(faction);
    checkVictoryCondition();
  }
  runtime.updateHUD();
}

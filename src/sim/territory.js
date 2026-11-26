// Territory capture, faction elimination and victory/defeat transitions.
// Emits facts; presentation lives in subscribers (see EVENTS.md).

import { Faction, UnitRank } from '../config/enums.js';
import { RANK_STATS } from '../config/balance.js';
import { state, getLocalFaction } from '../core/state.js';
import { emit } from '../core/events.js';

export const CAPTURE_RATES = {
  [UnitRank.BOSS]: RANK_STATS[UnitRank.BOSS].captureRate,
  [UnitRank.UNDERBOSS]: RANK_STATS[UnitRank.UNDERBOSS].captureRate,
  [UnitRank.CAPTAIN]: RANK_STATS[UnitRank.CAPTAIN].captureRate,
  [UnitRank.SOLDIER]: RANK_STATS[UnitRank.SOLDIER].captureRate,
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
    emit('chunk:captured', { chunk, faction });
    return true;
  }
  return false;
}

export function checkVictoryCondition() {
  const myFac = getLocalFaction();
  if (state.victoryShown || state.gameOver || !state.factionAlive[myFac]) return;
  const anyRivalAlive = state.activeFactions.some((f) => f !== myFac && state.factionAlive[f]);

  if (!anyRivalAlive) {
    state.victoryShown = true;
    const myBlocks = Array.from(state.world.chunks.values()).filter((c) => c.faction === myFac).length;
    const survivingCrew = state.npcs.filter((n) => n.faction === myFac).length;
    emit('match:victory', {
      faction: myFac,
      blocks: myBlocks,
      totalBlocks: state.world.chunks.size,
      cash: state.treasuries[myFac],
      crew: survivingCrew,
    });
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
    emit('match:defeat', { faction });
  } else {
    emit('faction:eliminated', { faction });
    checkVictoryCondition();
  }
}

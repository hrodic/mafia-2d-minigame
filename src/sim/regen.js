// Health regeneration: friendly-turf only, suppressed while the hit flash is active.
// Kept as a tiny O(1) helper: full-health units exit before any world lookup, and the
// damage check reuses `hitFlashTimer` instead of adding another per-unit timer.

import { UnitRank } from '../config/enums.js';
import { RANK_STATS } from '../config/balance.js';
import { state } from '../core/state.js';

export function getRegenPerSecond(rank) {
  return (RANK_STATS[rank] || RANK_STATS[UnitRank.SOLDIER]).regenPerSecond;
}

/** Heal a wounded, living unit standing on its own faction's turf. */
export function regenUnit(unit, dt) {
  if (!unit || unit.alive === false || !(unit.hp < unit.maxHp)) return 0;
  // `hitFlashTimer` is already decremented by the simulation for every unit, so a unit
  // that just took damage is skipped with one number comparison and no new state.
  if (unit.hitFlashTimer > 0) return 0;

  const world = state.world;
  if (!world || !world.worldToTile) return 0;
  const tile = world.worldToTile(unit.x, unit.y);
  const chunk = world.getChunk(tile.cx, tile.cy);
  if (!chunk || chunk.faction !== unit.faction) return 0;

  const amount = getRegenPerSecond(unit.rank) * dt;
  const before = unit.hp;
  unit.hp = Math.min(unit.maxHp, unit.hp + amount);
  return unit.hp - before;
}

// Guest-side presentation smoothing.
//
// Snapshots arrive ~12x/second, but rendering runs every frame. This module:
//  - interpolates entity positions toward the latest authoritative target
//    (netX/netY) every frame instead of jumping once per snapshot, and
//  - decays the short-lived animation timers that snapshots re-arm, so slash
//    swings, muzzle flashes and hit flashes actually finish instead of freezing.

import { state } from '../core/state.js';

const POSITION_SMOOTHING_PER_SECOND = 14;
const TIMER_FIELDS = ['slashAnimTimer', 'muzzleFlashTimer', 'hitFlashTimer'];

export function stepGuestPresentation(dt) {
  if (!(dt > 0)) return;
  const smooth = Math.min(1, dt * POSITION_SMOOTHING_PER_SECOND);
  applyEntity(state.player, smooth, dt);
  for (let i = 0; i < state.npcs.length; i++) {
    applyEntity(state.npcs[i], smooth, dt);
  }
}

function applyEntity(entity, smooth, dt) {
  if (!entity) return;
  if (typeof entity.netX === 'number' && typeof entity.netY === 'number') {
    entity.x += (entity.netX - entity.x) * smooth;
    entity.y += (entity.netY - entity.y) * smooth;
  }
  for (let i = 0; i < TIMER_FIELDS.length; i++) {
    const field = TIMER_FIELDS[i];
    if (entity[field] > 0) entity[field] = Math.max(0, entity[field] - dt);
  }
}

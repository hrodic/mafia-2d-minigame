// Event subscribers translating combat facts into sound effects.
// Wired once in main.js; the simulation only emits events (see EVENTS.md).

import { sfx } from './sfx.js';

export function onUnitDied({ isBoss, x, y }) {
  sfx.playDeath(isBoss, x, y);
}

export function onSlashPerformed({ hitCount, x, y }) {
  sfx.playSlash(hitCount > 0, x, y);
}

export function onShotStarted({ shooterX, shooterY }) {
  sfx.playGunshot(shooterX, shooterY);
}

export function onShotFired({ impact }) {
  if (impact && impact.blocked) {
    sfx.playRicochet(impact.x, impact.y);
  }
}

export function onArmorEquipped({ unit }) {
  sfx.playArmorEquip(unit.x, unit.y);
}

// Event subscribers translating combat facts into visual effects.
// Wired once in main.js; the simulation only emits events (see EVENTS.md).

import { UnitRank } from '../config/enums.js';
import {
  addFloatingText,
  bulletTracers,
  shellCasings,
  spawnBloodSplash,
  spawnDeadBody,
  spawnMuzzleFlash,
  spawnSlashArc,
  spawnSparks,
} from './effects.js';

export function onUnitDamaged(event) {
  const { unit, absorbed, remaining, isPlayer, isKill, hitAngle, textColor, suffix } = event;

  if (remaining > 0) {
    const intensity = isPlayer ? 1.35 : unit.rank === UnitRank.BOSS ? 1.45 : 1.2;
    spawnBloodSplash(unit.x, unit.y, intensity, isKill, hitAngle);
  } else {
    spawnSparks(unit.x, unit.y - 12);
  }

  const yOffset = isPlayer ? 30 : 28;
  if (absorbed > 0 && remaining === 0) {
    addFloatingText(unit.x, unit.y - yOffset, `-${absorbed} 🛡️`, '#38bdf8');
  } else if (absorbed > 0 && remaining > 0) {
    addFloatingText(
      unit.x,
      unit.y - yOffset,
      `-${absorbed}🛡️ -${remaining} ${suffix}`.trim(),
      textColor
    );
  } else {
    addFloatingText(unit.x, unit.y - yOffset, `-${remaining} ${suffix}`.trim(), textColor);
  }
}

export function onArmorBroken({ unit, isPlayer }) {
  addFloatingText(unit.x, unit.y - (isPlayer ? 44 : 42), 'ARMOR BROKEN!', '#7dd3fc');
}

export function onUnitDied({ faction, rank, x, y, facing, fallAngle, isBoss, isPlayer }) {
  spawnDeadBody(x, y, faction, rank, facing, fallAngle);
  if (!isPlayer) {
    addFloatingText(x, y - (isBoss ? 44 : 38), isBoss ? 'BOSS KILLED!' : 'ELIMINATED', '#f43f5e');
  }
}

export function onArmorEquipped({ unit, amount, textOffset = 34 }) {
  addFloatingText(unit.x, unit.y - textOffset, `+${amount} ARMOR 🛡️`, '#38bdf8');
}

export function onSlashPerformed({ x, y, facing, color, hitCount, isPlayer }) {
  spawnSlashArc(x, y, facing, color);
  if (isPlayer && hitCount === 0) {
    addFloatingText(
      x + Math.cos(facing) * 20,
      y + Math.sin(facing) * 20 - 16,
      'Slash!',
      '#a1a1aa'
    );
  }
}

export function onShotStarted({ muzzleX, muzzleY, angle }) {
  spawnMuzzleFlash(muzzleX, muzzleY, angle);

  // Cosmetic randomness stays in the subscriber so the simulation's RNG sequence
  // is unchanged (this runs synchronously at the same point as before).
  const ejectAngle = angle + Math.PI * 0.55 + (Math.random() - 0.5) * 0.3;
  shellCasings.push({
    x: muzzleX,
    y: muzzleY,
    z: 12,
    vx: Math.cos(ejectAngle) * (16 + Math.random() * 14),
    vy: Math.sin(ejectAngle) * (16 + Math.random() * 14),
    vz: 55 + Math.random() * 25,
    rot: Math.random() * Math.PI,
    vrot: (Math.random() - 0.5) * 24,
    life: 0.75,
  });
}

export function onShotFired({ x1, y1, x2, y2, color, missed, targetX, targetY, impact }) {
  if (missed && targetX !== null && targetY !== null) {
    addFloatingText(targetX, targetY - 34, 'MISS!', '#a1a1aa');
  }
  if (impact && impact.blocked) {
    spawnSparks(impact.x, impact.y);
  }
  bulletTracers.push({ x1, y1, x2, y2, color, life: 0.16, maxLife: 0.16 });
}

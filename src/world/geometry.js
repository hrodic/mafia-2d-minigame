// Single source for street-prop footprints (world coordinates).
// Used by collision, bullet raycast and drawing so they cannot drift.

import { PropType } from '../config/enums.js';

export function getCarFootprint(tileWx, tileWy, vertical = false, curbSide = 'N') {
  const x = vertical ? (curbSide === 'W' ? tileWx + 21 : tileWx + 5) : tileWx + 5;
  const y = vertical ? tileWy + 5 : (curbSide === 'N' ? tileWy + 21 : tileWy + 5);
  const w = vertical ? 18 : 34;
  const h = vertical ? 34 : 18;
  return { x, y, w, h };
}

export function getDumpsterFootprint(tileWx, tileWy) {
  return { x: tileWx + 9, y: tileWy + 10, w: 26, h: 22 };
}

export function getPropFootprint(prop, tileWx, tileWy, vertical = false, curbSide = 'N') {
  if (prop === PropType.CAR) return getCarFootprint(tileWx, tileWy, vertical, curbSide);
  if (prop === PropType.DUMPSTER) return getDumpsterFootprint(tileWx, tileWy);
  return null;
}

export function rectContains(rect, x, y) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

export function circleIntersectsRect(rect, x, y, radius) {
  const closestX = Math.max(rect.x, Math.min(x, rect.x + rect.w));
  const closestY = Math.max(rect.y, Math.min(y, rect.y + rect.h));
  const dx = x - closestX;
  const dy = y - closestY;
  return dx * dx + dy * dy < radius * radius;
}

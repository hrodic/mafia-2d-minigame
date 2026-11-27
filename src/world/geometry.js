// Single source for street-prop footprints (world coordinates).
// Used by collision, bullet raycast and drawing so they cannot drift.

import { PropType } from '../config/enums.js';
import { TILE_SIZE } from '../config/constants.js';

export const CAR_LENGTH = 68;
export const CAR_WIDTH = 36;

export function getCarFootprint(tileWx, tileWy, vertical = false, curbSide = 'N') {
  if (vertical) {
    const x = curbSide === 'W' ? tileWx + TILE_SIZE - CAR_WIDTH - 5 : tileWx + 5;
    const y = tileWy + (TILE_SIZE - CAR_LENGTH) / 2;
    return { x, y, w: CAR_WIDTH, h: CAR_LENGTH };
  }
  const x = tileWx + (TILE_SIZE - CAR_LENGTH) / 2;
  const y = curbSide === 'N' ? tileWy + TILE_SIZE - CAR_WIDTH - 5 : tileWy + 5;
  return { x, y, w: CAR_LENGTH, h: CAR_WIDTH };
}

export function getDumpsterFootprint(tileWx, tileWy) {
  return {
    x: tileWx + (TILE_SIZE - 18) / 2,
    y: tileWy + (TILE_SIZE - 13) / 2,
    w: 18,
    h: 13,
  };
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

// Static world drawing: buildings (pseudo-3D roofs/walls) and street props.

import { TILE_SIZE } from '../config/constants.js';
import { PropType } from '../config/enums.js';
import { createMulberry32 } from '../core/rng.js';
import { state } from '../core/state.js';
import { ctx } from './canvas.js';
import { lampIntensityAt } from './weather.js';
import { getPropFootprint } from '../world/geometry.js';

const BUILDING_SPRITE_PAD = 12;

function currentHour() {
  return (state.gameHour || 0) + (state.tickTimer || 0) / (state.tickDuration || 15);
}

let lampGlowSprite = null;

function getLampGlowSprite() {
  if (lampGlowSprite) return lampGlowSprite;
  if (typeof document === 'undefined') return null;
  const size = 256;
  const spriteCanvas = document.createElement('canvas');
  spriteCanvas.width = size;
  spriteCanvas.height = size;
  const g = spriteCanvas.getContext('2d');
  if (!g) return null;
  const half = size / 2;
  const gradient = g.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, 'rgba(253, 224, 71, 0.38)');
  gradient.addColorStop(0.45, 'rgba(245, 158, 11, 0.18)');
  gradient.addColorStop(1, 'rgba(245, 158, 11, 0)');
  g.fillStyle = gradient;
  g.fillRect(0, 0, size, size);
  lampGlowSprite = spriteCanvas;
  return spriteCanvas;
}

/** Warm light pools for visible streetlights, drawn before buildings and units. */
export function drawStreetlightGlows(items) {
  if (!items || items.length === 0) return;
  const intensity = lampIntensityAt(currentHour());
  if (intensity <= 0.01) return;
  const sprite = getLampGlowSprite();
  if (!sprite) return;
  const half = sprite.width / 2;
  ctx.save();
  ctx.globalAlpha = intensity;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const cx = item.wx + TILE_SIZE / 2;
    const cy = item.wy + TILE_SIZE * 0.6;
    ctx.drawImage(sprite, cx - half, cy - half);
  }
  ctx.restore();
}

/** Deterministic per-window hash used by facade lighting. */
function hashWindow(seed, wx, wy, row, col) {
  let h = (seed
    ^ Math.imul(wx + 512, 374761393)
    ^ Math.imul(wy + 512, 668265263)
    ^ Math.imul(row + 1, 2246822519)
    ^ Math.imul(col + 1, 3266489917)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** 15-25% of facade windows are lit, with the exact share drifting by in-game hour. */
export function isWindowLit(seed, wx, wy, row, col, hour) {
  const hash = hashWindow(seed, wx, wy, row, col);
  const threshold = 20 + 5 * Math.sin(hour * 0.7 + (hash % 628) / 100);
  return (hash % 100) < threshold;
}

/** Subtle amber flicker for a lit window. */
export function windowLightAlpha(hash, hour, tickTimer, tickDuration = 15) {
  const elapsed = hour * tickDuration + tickTimer;
  const flicker = 0.5 + 0.5 * Math.sin(elapsed * (Math.PI * 2 / 10) + (hash % 1000) * 0.01);
  return 0.35 + flicker * 0.45;
}

export function createAsphaltGrainTile(seed = 1) {
  if (typeof document === 'undefined') return null;
  const size = 64;
  const tile = document.createElement('canvas');
  tile.width = size;
  tile.height = size;
  const g = tile.getContext('2d');
  if (!g) return null;
  const rng = createMulberry32((seed ^ 0x9e3779b9) >>> 0);
  for (let i = 0; i < 240; i++) {
    const x = Math.floor(rng() * size);
    const y = Math.floor(rng() * size);
    const w = rng() < 0.2 ? 2 : 1;
    g.fillStyle = rng() < 0.55 ? 'rgba(255, 255, 255, 0.025)' : 'rgba(0, 0, 0, 0.18)';
    g.fillRect(x, y, w, 1);
  }
  return tile;
}

function paintRoofDetails(g, item) {
  const seed = ((item.seed ?? 0)
    ^ Math.imul(item.wx + 512, 374761393)
    ^ Math.imul(item.wy + 512, 668265263)) >>> 0;
  const rng = createMulberry32(seed);
  const roll = rng();
  if (roll > 0.62) return;
  const count = roll < 0.16 ? 2 : 1;
  for (let i = 0; i < count; i++) {
    const x = 6 + Math.floor(rng() * (TILE_SIZE - 18));
    const y = 6 + Math.floor(rng() * (TILE_SIZE - 18));
    const kind = Math.floor(rng() * 3);
    if (kind === 0) {
      g.fillStyle = 'rgba(30, 41, 59, 0.75)';
      g.fillRect(x, y, 11, 7);
      g.fillStyle = 'rgba(148, 163, 184, 0.2)';
      g.fillRect(x + 1, y + 1, 9, 1);
      g.fillStyle = 'rgba(15, 23, 42, 0.45)';
      g.fillRect(x + 2, y + 3, 7, 1);
      g.fillRect(x + 2, y + 5, 7, 1);
    } else if (kind === 1) {
      g.fillStyle = 'rgba(45, 70, 95, 0.65)';
      g.fillRect(x, y, 10, 8);
      g.strokeStyle = 'rgba(148, 197, 235, 0.25)';
      g.lineWidth = 1;
      g.strokeRect(x + 0.5, y + 0.5, 9, 7);
      g.fillStyle = 'rgba(186, 230, 253, 0.14)';
      g.fillRect(x + 2, y + 2, 6, 1);
    } else {
      g.fillStyle = 'rgba(24, 24, 27, 0.75)';
      g.fillRect(x, y, 8, 8);
      g.strokeStyle = 'rgba(113, 113, 122, 0.45)';
      g.lineWidth = 1;
      g.strokeRect(x + 0.5, y + 0.5, 7, 7);
      g.fillStyle = 'rgba(161, 161, 170, 0.28)';
      g.fillRect(x + 2, y + 2, 4, 1);
    }
  }
}

function paintBuildingSprite(g, item, wallHeight) {
  const { style, hasSouthBuilding, hasEastBuilding, hasWestBuilding } = item;
  const wallY = TILE_SIZE;

  g.fillStyle = 'rgba(0, 0, 0, 0.3)';
  g.fillRect(4, wallY + wallHeight - 1, TILE_SIZE + 2, 5);

  if (!hasSouthBuilding) {
    g.fillStyle = style === 0 ? '#1e293b' : style === 1 ? '#292524' : '#1f2937';
    g.fillRect(0, wallY, TILE_SIZE, wallHeight);

    g.fillStyle = 'rgba(251, 191, 36, 0.06)';
    g.fillRect(3, wallY + 2, TILE_SIZE - 6, Math.max(0, wallHeight - 4));

    g.fillStyle = 'rgba(15, 23, 42, 0.62)';
    for (let wyOff = 8; wyOff < wallHeight - 5; wyOff += 15) {
      g.fillRect(12, wallY + wyOff, 12, 7);
      g.fillRect(39, wallY + wyOff, 12, 7);
    }

    g.fillStyle = 'rgba(0, 0, 0, 0.22)';
    g.fillRect(0, wallY + wallHeight - 3, TILE_SIZE, 3);
    g.fillStyle = 'rgba(255, 255, 255, 0.08)';
    g.fillRect(0, wallY, TILE_SIZE, 1);
  }

  g.fillStyle = style === 0 ? '#334155' : style === 1 ? '#44403c' : '#374151';
  g.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
  paintRoofDetails(g, item);

  g.strokeStyle = 'rgba(15, 23, 42, 0.55)';
  g.lineWidth = 1.5;
  if (!hasEastBuilding) {
    g.beginPath();
    g.moveTo(TILE_SIZE, 0);
    g.lineTo(TILE_SIZE, TILE_SIZE);
    g.stroke();
  }
  if (!hasWestBuilding) {
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(0, TILE_SIZE);
    g.stroke();
  }

  g.fillStyle = 'rgba(255, 255, 255, 0.1)';
  g.fillRect(0, 0, TILE_SIZE, 1);
  g.fillRect(0, 0, 1, TILE_SIZE);
}

function getBuildingSprite(item) {
  if (item.sprite) return item.sprite;
  if (typeof document === 'undefined') return null;
  const wallHeight = Math.max(0, item.elev * 15);
  const sprite = document.createElement('canvas');
  sprite.width = TILE_SIZE + BUILDING_SPRITE_PAD * 2;
  sprite.height = TILE_SIZE + wallHeight + BUILDING_SPRITE_PAD * 2;
  const g = sprite.getContext('2d');
  if (!g) return null;
  g.translate(BUILDING_SPRITE_PAD, BUILDING_SPRITE_PAD);
  paintBuildingSprite(g, item, wallHeight);
  item.sprite = sprite;
  return sprite;
}

function drawWindowLights(item, wallHeight) {
  const wallTop = item.wy + TILE_SIZE - wallHeight;
  const hour = state.gameHour || 0;
  const tickTimer = state.tickTimer || 0;
  let row = 0;
  for (let wyOff = 8; wyOff < wallHeight - 5; wyOff += 15, row++) {
    for (let col = 0; col < 2; col++) {
      const hash = hashWindow(item.seed ?? 0, item.wx, item.wy, row, col);
      if (!isWindowLit(item.seed ?? 0, item.wx, item.wy, row, col, hour)) continue;
      const alpha = windowLightAlpha(hash, hour, tickTimer, state.tickDuration || 15);
      ctx.fillStyle = `rgba(245, 194, 107, ${alpha.toFixed(2)})`;
      ctx.fillRect(item.wx + (col === 0 ? 12 : 39), wallTop + wyOff, 12, 7);
    }
  }
}

export function drawBuilding(item) {
  const wallHeight = Math.max(0, item.elev * 15);
  const sprite = getBuildingSprite(item);
  if (!sprite) return;
  ctx.drawImage(sprite, item.wx - BUILDING_SPRITE_PAD, item.wy - wallHeight - BUILDING_SPRITE_PAD);
  if (!item.hasSouthBuilding && wallHeight > 0) drawWindowLights(item, wallHeight);
}

export function drawProp(item) {
  const { wx, wy, prop, color, vertical, curbSide } = item;
  const rect = getPropFootprint(prop, wx, wy, vertical, curbSide);
  if (prop === PropType.CAR && rect) {
    const { x: rx, y: ry, w: rw, h: rh } = rect;
    const horizontal = !vertical;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
    ctx.beginPath();
    ctx.roundRect(rx + 2, ry + 4, rw, rh, 7);
    ctx.fill();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(rx, ry, rw, rh, 7);
    ctx.fill();

    const cabinX = horizontal ? rx + rw * 0.28 : rx + 4;
    const cabinY = horizontal ? ry + 4 : ry + rh * 0.28;
    const cabinW = horizontal ? rw * 0.44 : rw - 8;
    const cabinH = horizontal ? rh - 8 : rh * 0.44;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.48)';
    ctx.beginPath();
    ctx.roundRect(cabinX, cabinY, cabinW, cabinH, 4);
    ctx.fill();

    ctx.fillStyle = 'rgba(125, 211, 252, 0.26)';
    if (horizontal) {
      ctx.fillRect(cabinX + 2, ry + 6, 5, rh - 12);
      ctx.fillRect(cabinX + cabinW - 7, ry + 6, 5, rh - 12);
    } else {
      ctx.fillRect(rx + 6, cabinY + 2, rw - 12, 5);
      ctx.fillRect(rx + 6, cabinY + cabinH - 7, rw - 12, 5);
    }

    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.fillRect(rx + 5, ry + 2, Math.max(0, rw - 10), 1);

    ctx.fillStyle = 'rgba(9, 9, 11, 0.65)';
    if (horizontal) {
      ctx.fillRect(rx + 9, ry - 1, 6, 3);
      ctx.fillRect(rx + rw - 15, ry - 1, 6, 3);
      ctx.fillRect(rx + 9, ry + rh - 2, 6, 3);
      ctx.fillRect(rx + rw - 15, ry + rh - 2, 6, 3);
    } else {
      ctx.fillRect(rx - 1, ry + 9, 3, 6);
      ctx.fillRect(rx + rw - 2, ry + 9, 3, 6);
      ctx.fillRect(rx - 1, ry + rh - 15, 3, 6);
      ctx.fillRect(rx + rw - 2, ry + rh - 15, 3, 6);
    }

    ctx.fillStyle = 'rgba(254, 240, 138, 0.9)';
    if (horizontal) ctx.fillRect(rx + 1, ry + rh * 0.35, 2, 5);
    else ctx.fillRect(rx + rw * 0.35, ry + 1, 5, 2);
    ctx.fillStyle = 'rgba(248, 113, 113, 0.9)';
    if (horizontal) ctx.fillRect(rx + rw - 3, ry + rh * 0.35, 2, 5);
    else ctx.fillRect(rx + rw * 0.35, ry + rh - 3, 5, 2);
  } else if (prop === PropType.DUMPSTER && rect) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(rect.x + 1, rect.y + 2, rect.w, rect.h);
    ctx.fillStyle = '#14532d';
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 2);
    ctx.fill();
    ctx.fillStyle = '#09090b';
    ctx.fillRect(rect.x + 1, rect.y + 1, rect.w - 2, 3);
    ctx.fillStyle = 'rgba(74, 222, 128, 0.18)';
    ctx.fillRect(rect.x + 1, rect.y + rect.h - 2, rect.w - 2, 1);
  } else if (prop === PropType.STREETLIGHT) {
    const cx = wx + TILE_SIZE / 2;
    const intensity = lampIntensityAt(currentHour());
    ctx.fillStyle = '#52525b';
    ctx.fillRect(cx - 2, wy + 6, 4, 28);
    ctx.fillStyle = '#94a3b8';
    ctx.beginPath();
    ctx.arc(cx, wy + 6, 3.5, 0, Math.PI * 2);
    ctx.fill();
    if (intensity > 0.01) {
      ctx.save();
      ctx.globalAlpha = intensity;
      ctx.fillStyle = '#fef08a';
      ctx.beginPath();
      ctx.arc(cx, wy + 6, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  } else if (prop === PropType.TREE) {
    const cx = wx + TILE_SIZE / 2;
    const cy = wy + TILE_SIZE * 0.62;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 6, 11, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#713f12';
    ctx.fillRect(cx - 2, cy - 10, 4, 12);
    ctx.fillStyle = '#15803d';
    ctx.beginPath();
    ctx.arc(cx, cy - 13, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#166534';
    ctx.beginPath();
    ctx.arc(cx - 3, cy - 15, 7, 0, Math.PI * 2);
    ctx.fill();
  }
}

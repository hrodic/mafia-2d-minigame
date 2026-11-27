// Screen-space noir rain. Kept deliberately small: a fixed pool of line segments
// updated and drawn in one path, so the overlay stays cheap.

import { createMulberry32 } from '../core/rng.js';

export const RAIN_DROP_COUNT = 72;

let drops = [];
let rainRng = createMulberry32(1);
let rainWidth = 0;
let rainHeight = 0;
let lastHour = null;
let rainActive = false;
let scheduleRng = createMulberry32(1);

export function isDayHour(hour) {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  return h >= 8 && h <= 21;
}

export function rainChanceForHour(hour) {
  return isDayHour(hour) ? 0.25 : 0.5;
}

/** 0 during day, 1 during night, with one-hour fades across 07→08 and 21→22. */
export function lampIntensityAt(hour) {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 8 && h < 21) return 0;
  if (h >= 22 || h < 7) return 1;
  if (h >= 7 && h < 8) return 1 - (h - 7);
  return h - 21;
}

/** Warm day light fades in as the lamps fade out. */
export function sunIntensityAt(hour) {
  return 1 - lampIntensityAt(hour);
}

export function drawAmbientLight(ctx, width, height, hour) {
  const night = lampIntensityAt(hour);
  const sun = 1 - night;
  ctx.save();
  if (sun > 0.01) {
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = `rgba(255, 214, 160, ${(0.1 * sun).toFixed(3)})`;
    ctx.fillRect(0, 0, width, height);
  }
  if (night > 0.01) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(18, 30, 52, ${(0.48 * night).toFixed(3)})`;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.restore();
}

/** Decide rain only when the day/night period flips, not every hour. */
export function updateRainSchedule(hour) {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  if (lastHour === null) {
    rainActive = scheduleRng() < rainChanceForHour(h);
    lastHour = h;
    return rainActive;
  }
  if (h === lastHour) return rainActive;
  if (isDayHour(lastHour) !== isDayHour(h)) {
    rainActive = scheduleRng() < rainChanceForHour(h);
  }
  lastHour = h;
  return rainActive;
}

export function isRaining() {
  return rainActive;
}

export function resetWeather(seed = 1) {
  lastHour = null;
  rainActive = false;
  scheduleRng = createMulberry32((seed ^ 0x85ebca6b) >>> 0);
}

function makeDrop(rng, width, height, initial) {
  return {
    x: rng() * width,
    y: initial ? rng() * height : -rng() * 80,
    len: 9 + rng() * 8,
    speed: 380 + rng() * 260,
    drift: 120 + rng() * 90,
  };
}

function ensureDrops(width, height) {
  if (drops.length === RAIN_DROP_COUNT && rainWidth === width && rainHeight === height) return;
  rainWidth = width;
  rainHeight = height;
  rainRng = createMulberry32(0x9e3779b9);
  drops = Array.from({ length: RAIN_DROP_COUNT }, () => makeDrop(rainRng, width, height, true));
}

/**
 * Advance and draw the diagonal rain pass in screen space.
 * Returns the number of line segments drawn (0 when disabled).
 */
export function updateAndDrawRain(ctx, width, height, dt, enabled = true) {
  if (!enabled || width <= 0 || height <= 0) return 0;
  ensureDrops(width, height);
  const step = Math.min(Math.max(dt, 0), 0.05);

  ctx.save();
  ctx.strokeStyle = 'rgba(174, 194, 224, 0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < drops.length; i++) {
    const drop = drops[i];
    drop.x -= drop.drift * step;
    drop.y += drop.speed * step;
    if (drop.y > height + drop.len || drop.x < -drop.len * 2) {
      drops[i] = makeDrop(rainRng, width, height, false);
      continue;
    }
    ctx.moveTo(drop.x, drop.y);
    ctx.lineTo(drop.x - drop.len * 0.38, drop.y + drop.len);
  }
  ctx.stroke();
  ctx.restore();
  return drops.length;
}

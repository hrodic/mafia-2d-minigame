// Visual-only effects: blood, decals, corpses, tracers, casings, sparks and
// floating combat text. The simulation only calls the spawn helpers.

import { Faction, UnitRank } from '../config/enums.js';
import { FACTION_META } from '../config/organizations.js';
import { state } from '../core/state.js';


export const bloodParticles = [];
export const bloodDecals = [];
export const bulletTracers = [];
export const shellCasings = [];
export const sparks = [];
export const slashArcs = [];
export const muzzleFlashes = [];
export const deadBodies = [];
export const MAX_BLOOD_DECALS = 220;
export const MAX_DEAD_BODIES = 65;
const MAX_FLOATING_TEXTS = 48;

export function spawnBloodSplash(x, y, intensity = 1, isKill = false, dirAngle = null) {
  const count = isKill ? 26 : Math.round(12 * intensity);
  for (let i = 0; i < count; i++) {
    const spread = dirAngle !== null ? (Math.random() - 0.5) * 1.35 : Math.random() * Math.PI * 2;
    const angle = dirAngle !== null ? dirAngle + spread : spread;
    const speed = (isKill ? 75 : 48) + Math.random() * (isKill ? 185 : 110);
    const shadeRoll = Math.random();
    const color =
      shadeRoll > 0.55 ? '#ef4444' : shadeRoll > 0.22 ? '#b91c1c' : '#450a0a';
    bloodParticles.push({
      x: x + (Math.random() - 0.5) * 8,
      y: y + (Math.random() - 0.5) * 8,
      z: 10 + Math.random() * 16,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      vz: 65 + Math.random() * 125,
      radius: 1.6 + Math.random() * (isKill ? 3.4 : 2.3),
      color,
      life: 0.55 + Math.random() * 0.45,
    });
  }

  const poolCount = isKill ? 4 : 2;
  for (let p = 0; p < poolCount; p++) {
    const offsetDist = dirAngle !== null ? (6 + Math.random() * 18) : (Math.random() - 0.5) * (isKill ? 28 : 16);
    const offsetAng = dirAngle !== null ? dirAngle + (Math.random() - 0.5) * 0.8 : Math.random() * Math.PI * 2;
    bloodDecals.push({
      x: x + Math.cos(offsetAng) * offsetDist,
      y: y + Math.sin(offsetAng) * offsetDist * 0.72,
      rx: (isKill ? 8.5 : 4.5) + Math.random() * (isKill ? 10 : 4.5),
      ry: (isKill ? 5 : 2.6) + Math.random() * (isKill ? 5.5 : 2.6),
      rot: Math.random() * Math.PI,
      color: Math.random() > 0.38 ? 'rgba(127, 29, 29, 0.78)' : 'rgba(69, 10, 10, 0.85)',
      life: 16 + Math.random() * 6,
      maxLife: 22,
    });
  }
  if (bloodDecals.length > MAX_BLOOD_DECALS) {
    bloodDecals.splice(0, bloodDecals.length - MAX_BLOOD_DECALS);
  }
}

export function spawnDeadBody(x, y, faction, rank, facing, fallAngle = facing) {
  const meta = FACTION_META[faction] || FACTION_META[Faction.NEUTRAL];
  const collapseDir = Math.cos(fallAngle) >= 0 ? 1 : -1;
  deadBodies.push({
    x,
    y,
    coatColor: meta.coat,
    accentColor: meta.accent,
    isBoss: rank === UnitRank.BOSS,
    isUnderboss: rank === UnitRank.UNDERBOSS,
    isCaptain: rank === UnitRank.CAPTAIN,
    collapseDir,
    tiltAngle: (Math.random() - 0.5) * 0.42,
    poolRadius: 4,
    maxPoolRadius: rank === UnitRank.BOSS ? 22 : 16,
    life: 14.0,
    maxLife: 14.0,
  });
  if (deadBodies.length > MAX_DEAD_BODIES) {
    deadBodies.shift();
  }
}

export function spawnSlashArc(x, y, facing, color = '#f43f5e', arc = 150 / 360) {
  slashArcs.push({
    x,
    y: y - 13,
    facing,
    color,
    halfArc: Math.PI * arc,
    life: 0.22,
    maxLife: 0.22,
  });
}

export function spawnMuzzleFlash(x, y, facing) {
  muzzleFlashes.push({
    x,
    y,
    facing,
    life: 0.11,
    maxLife: 0.11,
  });
}

export function spawnSparks(x, y) {
  for (let i = 0; i < 6; i++) {
    const a = Math.random() * Math.PI * 2;
    const spd = 60 + Math.random() * 120;
    sparks.push({
      x,
      y,
      vx: Math.cos(a) * spd,
      vy: Math.sin(a) * spd,
      life: 0.18 + Math.random() * 0.12,
    });
  }
}

export function addFloatingText(x, y, text, color = '#fbbf24') {
  if (state.floatingTexts.length >= MAX_FLOATING_TEXTS) {
    state.floatingTexts.shift();
  }
  state.floatingTexts.push({ x, y, text, color, life: 0.9, vy: -30 });
}

export function updateVisualParticles(dt) {
  for (let i = bloodParticles.length - 1; i >= 0; i--) {
    const p = bloodParticles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;
    p.vz -= 420 * dt;
    if (p.z <= 0) {
      p.z = 0;
      p.vx *= 0.3;
      p.vy *= 0.3;
      p.vz = 0;
    }
    p.life -= dt;
    if (p.life <= 0) bloodParticles.splice(i, 1);
  }

  for (let i = bloodDecals.length - 1; i >= 0; i--) {
    bloodDecals[i].life -= dt;
    if (bloodDecals[i].life <= 0) bloodDecals.splice(i, 1);
  }

  for (let i = deadBodies.length - 1; i >= 0; i--) {
    const b = deadBodies[i];
    if (b.poolRadius < b.maxPoolRadius) {
      b.poolRadius = Math.min(b.maxPoolRadius, b.poolRadius + dt * 5.5);
    }
    b.life -= dt;
    if (b.life <= 0) deadBodies.splice(i, 1);
  }

  for (let i = bulletTracers.length - 1; i >= 0; i--) {
    bulletTracers[i].life -= dt;
    if (bulletTracers[i].life <= 0) bulletTracers.splice(i, 1);
  }

  for (let i = slashArcs.length - 1; i >= 0; i--) {
    slashArcs[i].life -= dt;
    if (slashArcs[i].life <= 0) slashArcs.splice(i, 1);
  }

  for (let i = muzzleFlashes.length - 1; i >= 0; i--) {
    muzzleFlashes[i].life -= dt;
    if (muzzleFlashes[i].life <= 0) muzzleFlashes.splice(i, 1);
  }

  for (let i = shellCasings.length - 1; i >= 0; i--) {
    const c = shellCasings[i];
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    c.z += c.vz * dt;
    c.vz -= 380 * dt;
    c.rot += c.vrot * dt;
    if (c.z <= 0) {
      c.z = 0;
      c.vx *= 0.4;
      c.vy *= 0.4;
      c.vz = 0;
      c.vrot = 0;
    }
    c.life -= dt;
    if (c.life <= 0) shellCasings.splice(i, 1);
  }

  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.life -= dt;
    if (s.life <= 0) sparks.splice(i, 1);
  }

  for (let i = state.floatingTexts.length - 1; i >= 0; i--) {
    const ft = state.floatingTexts[i];
    ft.y += ft.vy * dt;
    ft.life -= dt;
    if (ft.life <= 0) state.floatingTexts.splice(i, 1);
  }
}

export function resetEffects() {
  bloodParticles.length = 0;
  bloodDecals.length = 0;
  bulletTracers.length = 0;
  shellCasings.length = 0;
  sparks.length = 0;
  slashArcs.length = 0;
  muzzleFlashes.length = 0;
  deadBodies.length = 0;
  state.floatingTexts.length = 0;
}


// Visual effects tests: spawn counts, caps, lifetimes and reset behaviour.
import { test, assert, assertEqual, assertClose } from './harness.js';
import { Faction, UnitRank } from '../src/config/enums.js';
import { state } from '../src/core/state.js';
import {
  bloodParticles,
  bloodDecals,
  bulletTracers,
  shellCasings,
  sparks,
  slashArcs,
  muzzleFlashes,
  deadBodies,
  MAX_BLOOD_DECALS,
  MAX_DEAD_BODIES,
  spawnBloodSplash,
  spawnDeadBody,
  spawnSlashArc,
  spawnMuzzleFlash,
  spawnSparks,
  addFloatingText,
  updateVisualParticles,
  resetEffects,
} from '../src/render/effects.js';

function fresh() {
  resetEffects();
}

test('effects: reset clears every effect collection', () => {
  spawnBloodSplash(0, 0, 1, true);
  spawnDeadBody(0, 0, Faction.PLAYER, UnitRank.SOLDIER, 0);
  spawnSlashArc(0, 0, 0);
  spawnMuzzleFlash(0, 0, 0);
  spawnSparks(0, 0);
  addFloatingText(0, 0, 'hi');
  bulletTracers.push({ x1: 0, y1: 0, x2: 1, y2: 1, life: 0.1, maxLife: 0.1 });
  shellCasings.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rot: 0, vrot: 0, life: 1 });

  resetEffects();

  assertEqual(bloodParticles.length, 0);
  assertEqual(bloodDecals.length, 0);
  assertEqual(bulletTracers.length, 0);
  assertEqual(shellCasings.length, 0);
  assertEqual(sparks.length, 0);
  assertEqual(slashArcs.length, 0);
  assertEqual(muzzleFlashes.length, 0);
  assertEqual(deadBodies.length, 0);
  assertEqual(state.floatingTexts.length, 0);
});

test('effects: blood splash spawns droplets and ground decals', () => {
  fresh();
  spawnBloodSplash(100, 100, 1, false);
  assertEqual(bloodParticles.length, 12);
  assert(bloodDecals.length >= 2);
  for (const p of bloodParticles) {
    assert(p.life > 0 && p.radius > 0);
    assert(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
  }
});

test('effects: kill splashes are bigger than normal hits', () => {
  fresh();
  spawnBloodSplash(100, 100, 1, true);
  assertEqual(bloodParticles.length, 26);
  assertEqual(bloodDecals.length, 4);
});

test('effects: blood decals are capped', () => {
  fresh();
  for (let i = 0; i < 80; i++) spawnBloodSplash(0, 0, 1, true);
  assertEqual(bloodDecals.length, MAX_BLOOD_DECALS);
  assertEqual(bloodDecals[0].life, 40);
  assert(bloodParticles.length > 0);
});

test('effects: dead bodies are capped', () => {
  fresh();
  for (let i = 0; i < MAX_DEAD_BODIES + 10; i++) {
    spawnDeadBody(i, i, Faction.PLAYER, UnitRank.SOLDIER, 0);
  }
  assertEqual(deadBodies.length, MAX_DEAD_BODIES);
  const body = deadBodies[deadBodies.length - 1];
  assertEqual(body.life, 30);
  assert(body.maxPoolRadius > body.poolRadius);
});

test('effects: sparks, slash arcs and muzzle flashes spawn with lifetimes', () => {
  fresh();
  spawnSparks(0, 0);
  assertEqual(sparks.length, 6);
  spawnSlashArc(1, 2, 0.5, '#fff');
  assertEqual(slashArcs.length, 1);
  assertEqual(slashArcs[0].life, 0.22);
  assertClose(slashArcs[0].halfArc, Math.PI * (150 / 360), 1e-9);
  spawnSlashArc(1, 2, 0.5, '#fff', 90 / 360);
  assertClose(slashArcs[1].halfArc, Math.PI * (90 / 360), 1e-9);
  spawnMuzzleFlash(1, 2, 0.5);
  assertEqual(muzzleFlashes.length, 1);
  assertEqual(muzzleFlashes[0].life, 0.11);
});

test('effects: floating texts are capped and keep the newest', () => {
  fresh();
  for (let i = 0; i < 60; i++) addFloatingText(0, 0, `text-${i}`);
  assertEqual(state.floatingTexts.length, 48);
  assertEqual(state.floatingTexts[state.floatingTexts.length - 1].text, 'text-59');
});

test('effects: short-lived effects expire after updates', () => {
  fresh();
  spawnSlashArc(0, 0, 0);
  spawnMuzzleFlash(0, 0, 0);
  spawnSparks(0, 0);
  addFloatingText(0, 0, 'expire');
  bulletTracers.push({ x1: 0, y1: 0, x2: 1, y2: 1, life: 0.16, maxLife: 0.16 });

  updateVisualParticles(0.3);
  assertEqual(slashArcs.length, 0);
  assertEqual(muzzleFlashes.length, 0);
  assertEqual(sparks.length, 0);
  assertEqual(bulletTracers.length, 0);
  assertEqual(state.floatingTexts.length, 1); // 0.9 - 0.3 = 0.6 left

  updateVisualParticles(1.0);
  assertEqual(state.floatingTexts.length, 0);
});

test('effects: blood particles and decals expire at different rates', () => {
  fresh();
  spawnBloodSplash(0, 0, 1, false);
  assertEqual(bloodDecals.length, 2);

  updateVisualParticles(2.0);
  assertEqual(bloodParticles.length, 0);
  assert(bloodDecals.length > 0, 'decals should outlive droplets');

  updateVisualParticles(40);
  assertEqual(bloodDecals.length, 0);
});

test('effects: dead bodies fade and their pool grows over time', () => {
  fresh();
  spawnDeadBody(0, 0, Faction.PLAYER, UnitRank.SOLDIER, 0);
  const before = deadBodies[0].poolRadius;
  updateVisualParticles(0.5);
  const after = deadBodies[0].poolRadius;
  assert(after > before, `pool should grow: ${before} -> ${after}`);
  updateVisualParticles(30);
  assertEqual(deadBodies.length, 0);
});

test('effects: updating empty collections is safe', () => {
  fresh();
  updateVisualParticles(1);
  assertEqual(bloodParticles.length, 0);
  assertEqual(state.floatingTexts.length, 0);
});

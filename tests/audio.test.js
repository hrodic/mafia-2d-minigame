// Audio layer tests: distance attenuation, sound/music toggle API, noise generation.
// (Actual sound output can only be checked manually.)
import { test, assert, assertEqual, assertClose } from './harness.js';
import { sfx, getSfxDistanceGain, SFX_FULL_VOLUME_RADIUS, SFX_MAX_HEAR_RADIUS } from '../src/audio/sfx.js';
import {
  isSoundEnabled,
  setSoundEnabled,
  getMusicState,
  cycleMusicTrack,
  getNoiseBuffer,
} from '../src/audio/engine.js';

test('audio: attenuation is full volume inside the inner radius', () => {
  const listener = { x: 0, y: 0 };
  assertEqual(SFX_FULL_VOLUME_RADIUS, 100);
  assertEqual(SFX_MAX_HEAR_RADIUS, 1000);
  assertClose(getSfxDistanceGain(0, 0, listener), 1);
  assertClose(getSfxDistanceGain(99, 0, listener), 1);
  assertClose(getSfxDistanceGain(0, 100, listener), 1);
});

test('audio: attenuation fades linearly to zero at the max radius', () => {
  const listener = { x: 0, y: 0 };
  assertClose(getSfxDistanceGain(550, 0, listener), 0.45, 1e-9);
  assertClose(getSfxDistanceGain(800, 0, listener), 0.2, 1e-9);
  assertClose(getSfxDistanceGain(1000, 0, listener), 0, 1e-9);
  assertClose(getSfxDistanceGain(1500, 0, listener), 0, 1e-9);
});

test('audio: attenuation without a position is unaffected', () => {
  assertClose(getSfxDistanceGain(undefined, 5, { x: 0, y: 0 }), 1);
  assertClose(getSfxDistanceGain(5, null, { x: 0, y: 0 }), 1);
});

test('audio: sfx exposes the expected sound effects', () => {
  for (const name of [
    'playSlash',
    'playArmorEquip',
    'playGunshot',
    'playRicochet',
    'playDeath',
    'playFactionEliminated',
    'playVictory',
  ]) {
    assertEqual(typeof sfx[name], 'function', `missing sfx.${name}`);
  }
});

test('audio: sound toggle returns and stores the new state', () => {
  const before = isSoundEnabled();
  try {
    assertEqual(setSoundEnabled(!before), !before);
    assertEqual(isSoundEnabled(), !before);
    assertEqual(setSoundEnabled(before), before);
  } finally {
    setSoundEnabled(before);
  }
});

test('audio: music cycles Noir I -> Noir II -> OFF -> Noir I', () => {
  for (let i = 0; i < 4 && !(getMusicState().enabled && getMusicState().track === 0); i++) {
    cycleMusicTrack();
  }
  assertEqual(getMusicState().enabled, true);
  assertEqual(getMusicState().track, 0);

  let state = cycleMusicTrack();
  assertEqual(state.enabled, true);
  assertEqual(state.track, 1);

  state = cycleMusicTrack();
  assertEqual(state.enabled, false);
  assertEqual(state.track, 1);

  state = cycleMusicTrack();
  assertEqual(state.enabled, true);
  assertEqual(state.track, 0);
});

test('audio: noise buffer generation follows the context sample rate', () => {
  // Use a real (offline) AudioContext so the cached buffer is a genuine AudioBuffer;
  // a plain mock would later break the music engine when it reuses the cache.
  const ctx = new OfflineAudioContext(1, 1, 8000);
  const buffer = getNoiseBuffer(ctx);
  assertEqual(buffer.length, 4000);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < 50; i++) {
    assert(data[i] >= -1 && data[i] <= 1, `noise sample out of range: ${data[i]}`);
  }
});

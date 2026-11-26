// Synthesized sound effects with distance attenuation from the local camera.

import { getAudioCtx, getAudioDest, getMasterGainValue, getNoiseBuffer } from './engine.js';
import { state } from '../core/state.js';


export const SFX_FULL_VOLUME_RADIUS = 100;
export const SFX_MAX_HEAR_RADIUS = 1000;

export function getSfxDistanceGain(wx, wy, listener = state.camera) {
  if (wx === undefined || wy === undefined || wx === null || wy === null) return 1.0;
  const dist = Math.hypot(wx - listener.x, wy - listener.y);
  if (dist <= SFX_FULL_VOLUME_RADIUS) return 1.0;
  if (dist >= SFX_MAX_HEAR_RADIUS) return 0.0;
  return 1.0 - dist / SFX_MAX_HEAR_RADIUS;
}

function createAttenuatedSfxNode(ctx, wx, wy) {
  const atten = getSfxDistanceGain(wx, wy);
  if (atten <= 0.005) return null;
  const node = ctx.createGain();
  node.gain.value = (getMasterGainValue()) * atten;
  node.connect(ctx.destination);
  return node;
}

export const sfx = {
  playSlash(hit = false, wx = null, wy = null) {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const dest = createAttenuatedSfxNode(ctx, wx, wy);
    if (!dest) return;
    const now = ctx.currentTime;

    const airNoise = ctx.createBufferSource();
    airNoise.buffer = getNoiseBuffer(ctx);
    const airFilter = ctx.createBiquadFilter();
    airFilter.type = 'bandpass';
    airFilter.frequency.setValueAtTime(2800, now);
    airFilter.frequency.exponentialRampToValueAtTime(1050, now + 0.05);
    airFilter.Q.value = 1.9;

    const airGain = ctx.createGain();
    airGain.gain.setValueAtTime(0.001, now);
    airGain.gain.linearRampToValueAtTime(hit ? 0.11 : 0.085, now + 0.007);
    airGain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);

    airNoise.connect(airFilter);
    airFilter.connect(airGain);
    airGain.connect(dest);
    airNoise.start(now);
    airNoise.stop(now + 0.06);

    if (hit) {
      const cutNoise = ctx.createBufferSource();
      cutNoise.buffer = getNoiseBuffer(ctx);
      const cutFilter = ctx.createBiquadFilter();
      cutFilter.type = 'highpass';
      cutFilter.frequency.setValueAtTime(2100, now + 0.008);
      cutFilter.frequency.exponentialRampToValueAtTime(900, now + 0.07);

      const cutGain = ctx.createGain();
      cutGain.gain.setValueAtTime(0.001, now + 0.008);
      cutGain.gain.linearRampToValueAtTime(0.15, now + 0.014);
      cutGain.gain.exponentialRampToValueAtTime(0.001, now + 0.075);

      cutNoise.connect(cutFilter);
      cutFilter.connect(cutGain);
      cutGain.connect(dest);
      cutNoise.start(now + 0.008);
      cutNoise.stop(now + 0.08);
    }
  },

  playArmorEquip(wx = null, wy = null) {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const dest = createAttenuatedSfxNode(ctx, wx, wy);
    if (!dest) return;
    const now = ctx.currentTime;

    const strap = ctx.createBufferSource();
    strap.buffer = getNoiseBuffer(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1900, now);
    bp.Q.value = 1.6;
    const sGain = ctx.createGain();
    sGain.gain.setValueAtTime(0.24, now);
    sGain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    strap.connect(bp);
    bp.connect(sGain);
    sGain.connect(dest);
    strap.start(now);
    strap.stop(now + 0.12);

    const clack = ctx.createOscillator();
    const cGain = ctx.createGain();
    clack.type = 'triangle';
    clack.frequency.setValueAtTime(520, now + 0.07);
    clack.frequency.exponentialRampToValueAtTime(180, now + 0.15);
    cGain.gain.setValueAtTime(0.28, now + 0.07);
    cGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    clack.connect(cGain);
    cGain.connect(dest);
    clack.start(now + 0.07);
    clack.stop(now + 0.17);
  },

  playGunshot(wx = null, wy = null) {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const dest = createAttenuatedSfxNode(ctx, wx, wy);
    if (!dest) return;
    const now = ctx.currentTime;

    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i * 2) / 256 - 1;
      curve[i] = Math.tanh(x * 3.2);
    }
    shaper.curve = curve;
    shaper.connect(dest);

    const crackNoise = ctx.createBufferSource();
    crackNoise.buffer = getNoiseBuffer(ctx);
    const crackFilter = ctx.createBiquadFilter();
    crackFilter.type = 'bandpass';
    crackFilter.frequency.setValueAtTime(2400, now);
    crackFilter.Q.value = 0.75;

    const crackGain = ctx.createGain();
    crackGain.gain.setValueAtTime(1.15, now);
    crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.028);

    crackNoise.connect(crackFilter);
    crackFilter.connect(crackGain);
    crackGain.connect(shaper);
    crackNoise.start(now);
    crackNoise.stop(now + 0.032);

    const punch = ctx.createOscillator();
    const pGain = ctx.createGain();
    punch.type = 'triangle';
    punch.frequency.setValueAtTime(340, now);
    punch.frequency.exponentialRampToValueAtTime(38, now + 0.09);
    pGain.gain.setValueAtTime(0.85, now);
    pGain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    punch.connect(pGain);
    pGain.connect(shaper);
    punch.start(now);
    punch.stop(now + 0.12);

    const blastNoise = ctx.createBufferSource();
    blastNoise.buffer = getNoiseBuffer(ctx);
    const blastFilter = ctx.createBiquadFilter();
    blastFilter.type = 'lowpass';
    blastFilter.frequency.setValueAtTime(5600, now);
    blastFilter.frequency.exponentialRampToValueAtTime(420, now + 0.14);
    blastFilter.frequency.exponentialRampToValueAtTime(160, now + 0.42);

    const blastGain = ctx.createGain();
    blastGain.gain.setValueAtTime(0.75, now);
    blastGain.gain.exponentialRampToValueAtTime(0.14, now + 0.08);
    blastGain.gain.exponentialRampToValueAtTime(0.001, now + 0.44);

    blastNoise.connect(blastFilter);
    blastFilter.connect(blastGain);
    blastGain.connect(shaper);
    blastNoise.start(now);
    blastNoise.stop(now + 0.45);
  },

  playRicochet(wx = null, wy = null) {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const dest = createAttenuatedSfxNode(ctx, wx, wy);
    if (!dest) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    const startFreq = 2600 + Math.random() * 900;
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(620, now + 0.18);
    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);
    osc.connect(gain);
    gain.connect(dest);
    osc.start(now);
    osc.stop(now + 0.2);
  },

  playDeath(isBoss = false, wx = null, wy = null) {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const dest = createAttenuatedSfxNode(ctx, wx, wy);
    if (!dest) return;
    const now = ctx.currentTime;
    const dur = isBoss ? 0.78 : 0.54;

    const osc = ctx.createOscillator();
    const oscSub = ctx.createOscillator();
    osc.type = 'sawtooth';
    oscSub.type = 'triangle';
    const baseFreq = isBoss ? 190 : 235 + Math.random() * 60;
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.linearRampToValueAtTime(baseFreq * 1.15, now + 0.055);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.38, now + dur);

    oscSub.frequency.setValueAtTime(baseFreq * 0.5, now);
    oscSub.frequency.exponentialRampToValueAtTime(baseFreq * 0.22, now + dur);

    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.setValueAtTime(760, now);
    f1.Q.value = 2.6;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(isBoss ? 0.56 : 0.46, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    osc.connect(f1);
    oscSub.connect(f1);
    f1.connect(gain);
    gain.connect(dest);

    osc.start(now);
    oscSub.start(now);
    osc.stop(now + dur + 0.02);
    oscSub.stop(now + dur + 0.02);
  },

  playFactionEliminated() {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const dest = getAudioDest();

    [220, 185, 146.83].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      const t = now + i * 0.14;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.22, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(t);
      osc.stop(t + 0.36);
    });
  },

  playVictory() {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const dest = getAudioDest();

    [329.63, 415.3, 493.88, 659.25].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const t = now + i * 0.12;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.24, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(t);
      osc.stop(t + 0.56);
    });
  },
};

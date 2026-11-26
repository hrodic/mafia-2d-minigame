// Web Audio engine: context/gain setup and the procedural dark-noir music scheduler.


let soundEnabled = true;
let musicEnabled = true;
let currentMusicTrack = 0;
let audioCtx = null;
let masterGain = null;
let musicGain = null;

export function ensureAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    audioCtx = new AudioContextClass();

    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.72;
    masterGain.connect(audioCtx.destination);

    musicGain = audioCtx.createGain();
    musicGain.gain.value = musicEnabled ? 0.27 : 0.0;
    musicGain.connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  if (musicEnabled && !musicEngine.isPlaying) {
    musicEngine.start();
  }
  return audioCtx;
}

export function getAudioCtx() {
  const ctx = ensureAudioContext();
  if (!soundEnabled) return null;
  return ctx;
}

export function getAudioDest() {
  return masterGain || audioCtx.destination;
}

const noiseBufferCache = new WeakMap();

const musicEngine = {
  isPlaying: false,
  timerId: null,
  step: 0,
  nextNoteTime: 0,

  tracks: [
    {
      name: 'Noir I',
      tempo: 92,
      bassPattern: [
        73.42, 0, 0, 87.31,
        110.00, 0, 116.54, 0,
        110.00, 0, 87.31, 0,
        69.30, 0, 82.41, 0,
      ],
      leadPattern: [
        293.66, 0, 0, 0, 349.23, 0, 440.00, 0,
        466.16, 0, 440.00, 0, 349.23, 0, 0, 0,
        277.18, 0, 0, 329.63, 0, 349.23, 0, 329.63,
        293.66, 0, 0, 0, 0, 0, 0, 0,
      ],
      kickPattern:  [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0],
      snarePattern: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1],
      hatPattern:   [1, 0, 1, 2, 1, 0, 1, 0, 1, 0, 1, 2, 1, 0, 1, 0],
      chords: [146.83, 138.59],
      leadCutoff: 1350,
      bassCutoff: 520,
    },
    {
      name: 'Noir II',
      tempo: 98,
      bassPattern: [
        65.41, 0, 98.00, 0,
        77.78, 0, 87.31, 98.00,
        65.41, 0, 98.00, 0,
        103.83, 0, 98.00, 61.74,
      ],
      leadPattern: [
        0, 0, 392.00, 0, 311.13, 0, 293.66, 0,
        261.63, 0, 0, 0, 246.94, 0, 261.63, 0,
        311.13, 0, 349.23, 0, 392.00, 0, 415.30, 0,
        392.00, 0, 311.13, 0, 261.63, 0, 0, 0,
      ],
      kickPattern:  [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0],
      snarePattern: [0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0],
      hatPattern:   [2, 0, 1, 0, 1, 0, 1, 0, 2, 0, 1, 0, 1, 1, 1, 0],
      chords: [130.81, 138.59],
      leadCutoff: 1180,
      bassCutoff: 480,
    },
  ],

  getNoiseBuffer(ctx) {
    let buf = noiseBufferCache.get(ctx);
    if (!buf) {
      const len = ctx.sampleRate * 0.5;
      buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      noiseBufferCache.set(ctx, buf);
    }
    return buf;
  },

  scheduleKick(ctx, time) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(110, time);
    osc.frequency.exponentialRampToValueAtTime(34, time + 0.16);
    gain.gain.setValueAtTime(0.55, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.2);
    osc.connect(gain);
    gain.connect(musicGain);
    osc.start(time);
    osc.stop(time + 0.21);
  },

  scheduleSnare(ctx, time, brush = false) {
    const noise = ctx.createBufferSource();
    noise.buffer = this.getNoiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1250, time);
    filter.Q.value = 1.1;

    const nGain = ctx.createGain();
    const level = brush ? 0.12 : 0.24;
    nGain.gain.setValueAtTime(level, time);
    nGain.gain.exponentialRampToValueAtTime(0.001, time + (brush ? 0.11 : 0.18));
    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(musicGain);
    noise.start(time);
    noise.stop(time + 0.19);
  },

  scheduleHat(ctx, time, open = false) {
    const noise = ctx.createBufferSource();
    noise.buffer = this.getNoiseBuffer(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(6400, time);

    const gain = ctx.createGain();
    const dur = open ? 0.18 : 0.05;
    gain.gain.setValueAtTime(open ? 0.09 : 0.055, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
    noise.connect(hp);
    hp.connect(gain);
    gain.connect(musicGain);
    noise.start(time);
    noise.stop(time + dur + 0.01);
  },

  scheduleBass(ctx, time, freq, stepDur, cutoff = 500) {
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = 'triangle';
    osc2.type = 'sawtooth';
    osc1.frequency.setValueAtTime(freq, time);
    osc2.frequency.setValueAtTime(freq, time);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, time);
    filter.frequency.exponentialRampToValueAtTime(140, time + stepDur * 1.5);
    filter.Q.value = 2.8;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.32, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + stepDur * 1.65);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(musicGain);

    osc1.start(time);
    osc2.start(time);
    osc1.stop(time + stepDur * 1.7);
    osc2.stop(time + stepDur * 1.7);
  },

  scheduleLead(ctx, time, freq, stepDur, cutoff = 1300) {
    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    oscA.type = 'sawtooth';
    oscB.type = 'triangle';
    oscA.frequency.setValueAtTime(freq, time);
    oscB.frequency.setValueAtTime(freq * 1.004, time);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, time);
    filter.frequency.exponentialRampToValueAtTime(420, time + stepDur * 2.4);
    filter.Q.value = 2.4;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(0.14, time + 0.045);
    gain.gain.exponentialRampToValueAtTime(0.001, time + stepDur * 2.6);

    oscA.connect(filter);
    oscB.connect(filter);
    filter.connect(gain);
    gain.connect(musicGain);

    oscA.start(time);
    oscB.start(time);
    oscA.stop(time + stepDur * 2.7);
    oscB.stop(time + stepDur * 2.7);
  },

  scheduleChordPad(ctx, time, rootFreq, stepDur) {
    const ratios = [1, 1.1892, 1.4983, 1.7818];
    ratios.forEach((r) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(rootFreq * r, time);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, time);
      gain.gain.linearRampToValueAtTime(0.042, time + 0.12);
      gain.gain.exponentialRampToValueAtTime(0.0008, time + stepDur * 14);

      osc.connect(gain);
      gain.connect(musicGain);
      osc.start(time);
      osc.stop(time + stepDur * 14.5);
    });
  },

  scheduler() {
    if (!musicEnabled || !audioCtx || audioCtx.state !== 'running') return;
    if (this.nextNoteTime < audioCtx.currentTime - 0.25) {
      this.nextNoteTime = audioCtx.currentTime + 0.04;
    }
    const track = this.tracks[currentMusicTrack] || this.tracks[0];
    const stepDur = 60 / track.tempo / 4;
    let guard = 0;
    while (this.nextNoteTime < audioCtx.currentTime + 0.16 && guard < 4) {
      guard++;
      const s16 = this.step % 16;
      const s32 = this.step % 32;
      const s64 = this.step % 64;

      if (track.kickPattern[s16]) this.scheduleKick(audioCtx, this.nextNoteTime);
      if (track.snarePattern[s16]) {
        this.scheduleSnare(audioCtx, this.nextNoteTime, s16 === 7 || s16 === 15);
      }
      if (track.hatPattern[s16]) {
        this.scheduleHat(audioCtx, this.nextNoteTime, track.hatPattern[s16] === 2);
      }

      const bassFreq = track.bassPattern[s16];
      if (bassFreq > 0) {
        this.scheduleBass(audioCtx, this.nextNoteTime, bassFreq, stepDur, track.bassCutoff);
      }

      const leadFreq = track.leadPattern[s32];
      if (leadFreq > 0) {
        this.scheduleLead(audioCtx, this.nextNoteTime, leadFreq, stepDur, track.leadCutoff);
      }

      if (s64 === 0 || s64 === 32) {
        this.scheduleChordPad(
          audioCtx,
          this.nextNoteTime,
          s64 === 0 ? track.chords[0] : track.chords[1],
          stepDur
        );
      }

      this.nextNoteTime += stepDur;
      this.step++;
    }
  },

  start() {
    if (this.isPlaying || !audioCtx) return;
    this.isPlaying = true;
    this.nextNoteTime = audioCtx.currentTime + 0.05;
    this.timerId = setInterval(() => this.scheduler(), 35);
  },

  stop() {
    this.isPlaying = false;
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  },
};

export function isSoundEnabled() {
  return soundEnabled;
}

export function setSoundEnabled(enabled) {
  soundEnabled = Boolean(enabled);
  return soundEnabled;
}

export function getMusicState() {
  return { enabled: musicEnabled, track: currentMusicTrack };
}

export function cycleMusicTrack() {
  if (musicEnabled && currentMusicTrack === 0) {
    currentMusicTrack = 1;
  } else if (musicEnabled && currentMusicTrack === 1) {
    musicEnabled = false;
    if (musicGain && audioCtx) musicGain.gain.value = 0;
  } else {
    musicEnabled = true;
    currentMusicTrack = 0;
    if (musicGain && audioCtx) musicGain.gain.value = 0.27;
    if (!musicEngine.isPlaying) musicEngine.start();
  }
  return getMusicState();
}

export function getMasterGainValue() {
  return masterGain ? masterGain.gain.value : 0.72;
}

export function getNoiseBuffer(ctx) {
  return musicEngine.getNoiseBuffer(ctx);
}


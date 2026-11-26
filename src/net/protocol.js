// Multiplayer wire protocol: message types, versioned envelopes, and the
// snapshot shape shared by host and guests. Keep this module free of state
// mutation and presentation; it only describes what goes on the wire.

import { GAME_VERSION } from '../config/version.js';

export const MSG = Object.freeze({
  HELLO: 'HELLO',
  LOBBY_STATE: 'LOBBY_STATE',
  REJECT: 'REJECT',
  INIT_MATCH: 'INIT_MATCH',
  SNAPSHOT: 'SNAPSHOT',
  INPUT: 'INPUT',
  CMD: 'CMD',
  EVENT: 'EVENT',
});

export const EVENT_KIND = Object.freeze({
  SHOT: 'SHOT',
});

export function envelope(type, seq, payload) {
  return { v: GAME_VERSION, type, seq, payload };
}

export function isVersionCompatible(env) {
  return Boolean(env) && env.v === GAME_VERSION;
}

// Host -> guest snapshot. Reads state but never mutates it.
export function encodeSnapshot(state) {
  const chunkStates = [];
  for (const c of state.world.chunks.values()) {
    chunkStates.push([c.cx, c.cy, c.faction, Math.round(c.captureProgress * 100) / 100, c.capturingFaction || '']);
  }

  const npcStates = state.npcs.map((u) => [
    u.id,
    u.faction,
    u.rank,
    Math.round(u.x * 10) / 10,
    Math.round(u.y * 10) / 10,
    Math.round(u.facing * 100) / 100,
    Math.round(u.hp),
    u.maxHp,
    Math.round(u.armor || 0),
    u.maxArmor || 0,
    u.slashAnimTimer > 0 ? 1 : 0,
    u.muzzleFlashTimer > 0 ? 1 : 0,
    u.humanPeerId || '',
  ]);

  return {
    gameHour: state.gameHour,
    tickTimer: Math.round(state.tickTimer * 100) / 100,
    treasuries: { ...state.treasuries },
    factionAlive: { ...state.factionAlive },
    kills: { ...state.factionKills },
    playerBoss: {
      x: Math.round(state.player.x * 10) / 10,
      y: Math.round(state.player.y * 10) / 10,
      facing: Math.round(state.player.facing * 100) / 100,
      hp: Math.round(state.player.hp),
      maxHp: state.player.maxHp,
      armor: Math.round(state.player.armor),
      maxArmor: state.player.maxArmor,
      alive: state.player.alive,
      slash: state.player.slashAnimTimer > 0 ? 1 : 0,
      shoot: state.player.muzzleFlashTimer > 0 ? 1 : 0,
    },
    chunks: chunkStates,
    npcs: npcStates,
  };
}

// Guest -> apply boundary. Accepts the plain object/array payload from the wire.
export function decodeSnapshot(payload) {
  if (!payload || typeof payload !== 'object') return null;
  return payload;
}

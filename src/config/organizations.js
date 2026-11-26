// Syndicate organizations (cosmetic identity + rank names) and the faction meta
// used by the renderer/HUD. `FACTION_META` is intentionally mutable: `initWorld`
// assigns one organization per active faction slot.

import { Faction } from './enums.js';

export const ORGANIZATIONS = {
  COSA_NOSTRA: {
    id: 'COSA_NOSTRA',
    name: 'Cosa Nostra',
    origin: 'Sicily & USA',
    short: 'Cosa Nostra',
    ranks: {
      BOSS: 'Don',
      UNDERBOSS: 'Sottocapo',
      CAPTAIN: 'Caporegime',
      SOLDIER: 'Soldato',
    },
    tint: 'rgba(16, 185, 129, 0.14)',
    border: 'rgba(16, 185, 129, 0.85)',
    badge: '#10b981',
    coat: '#065f46',
    accent: '#34d399',
  },
  BRATVA: {
    id: 'BRATVA',
    name: 'Russian Bratva',
    origin: 'Russia / Post-Soviet',
    short: 'Bratva',
    ranks: {
      BOSS: 'Pakhan',
      UNDERBOSS: 'Avtoritet',
      CAPTAIN: 'Brigadier',
      SOLDIER: 'Boyevik',
    },
    tint: 'rgba(59, 130, 246, 0.14)',
    border: 'rgba(59, 130, 246, 0.85)',
    badge: '#3b82f6',
    coat: '#1e3a8a',
    accent: '#60a5fa',
  },
  YAKUZA: {
    id: 'YAKUZA',
    name: 'Yakuza',
    origin: 'Japan',
    short: 'Yakuza',
    ranks: {
      BOSS: 'Oyabun',
      UNDERBOSS: 'Wakagashira',
      CAPTAIN: 'Shateigashira',
      SOLDIER: 'Kobun',
    },
    tint: 'rgba(244, 63, 94, 0.14)',
    border: 'rgba(244, 63, 94, 0.85)',
    badge: '#f43f5e',
    coat: '#881337',
    accent: '#fb7185',
  },
  TRIADS: {
    id: 'TRIADS',
    name: 'Chinese Triads',
    origin: 'Hong Kong / China',
    short: 'Triads',
    ranks: {
      BOSS: 'Shan Chu',
      UNDERBOSS: 'Fu Shan Chu',
      CAPTAIN: 'Hung Kwan',
      SOLDIER: 'Sei Kau Tsai',
    },
    tint: 'rgba(245, 158, 11, 0.14)',
    border: 'rgba(245, 158, 11, 0.85)',
    badge: '#f59e0b',
    coat: '#78350f',
    accent: '#fbbf24',
  },
  NDRANGHETA: {
    id: 'NDRANGHETA',
    name: "'Ndrangheta",
    origin: 'Calabria, Italy',
    short: "'Ndrangheta",
    ranks: {
      BOSS: 'Capobastone',
      UNDERBOSS: 'Contabile',
      CAPTAIN: 'Caposocietà',
      SOLDIER: 'Picciotto',
    },
    tint: 'rgba(168, 85, 247, 0.14)',
    border: 'rgba(168, 85, 247, 0.85)',
    badge: '#a855f7',
    coat: '#581c87',
    accent: '#c084fc',
  },
  CARTEL: {
    id: 'CARTEL',
    name: 'Mexican Cartels',
    origin: 'Mexico',
    short: 'Cartel',
    ranks: {
      BOSS: 'Patrón',
      UNDERBOSS: 'Lugarteniente',
      CAPTAIN: 'Jefe de Plaza',
      SOLDIER: 'Sicario',
    },
    tint: 'rgba(249, 115, 22, 0.14)',
    border: 'rgba(249, 115, 22, 0.85)',
    badge: '#f97316',
    coat: '#7c2d12',
    accent: '#fb923c',
  },
};

export const ALL_ORG_IDS = Object.keys(ORGANIZATIONS);

export const FACTION_META = {
  [Faction.NEUTRAL]: {
    name: 'Neutral',
    short: 'Neutral',
    ranks: { BOSS: 'Boss', UNDERBOSS: '2IC', CAPTAIN: 'Captain', SOLDIER: 'Enforcer' },
    tint: 'rgba(113, 113, 122, 0.04)',
    border: 'rgba(113, 113, 122, 0.32)',
    badge: '#52525b',
    coat: '#52525b',
    accent: '#a1a1aa',
  },
  [Faction.PLAYER]: { ...ORGANIZATIONS.COSA_NOSTRA },
  [Faction.RIVAL_1]: { ...ORGANIZATIONS.BRATVA },
  [Faction.RIVAL_2]: { ...ORGANIZATIONS.TRIADS },
  [Faction.RIVAL_3]: { ...ORGANIZATIONS.CARTEL },
};

export const ALL_FACTION_SLOTS = [
  Faction.PLAYER,
  Faction.RIVAL_1,
  Faction.RIVAL_2,
  Faction.RIVAL_3,
];

/** Clamp a requested player count to the supported 2..4 range. */
export function clampFactionCount(count) {
  return Math.max(2, Math.min(4, Number(count) || 4));
}

/**
 * Active slots for a match. 2P keeps the host and the last rival; 3P uses the first
 * three slots; 4P uses all. Single source for setup and multiplayer lobby seats.
 */
export function getActiveFactionSlots(count) {
  const n = clampFactionCount(count);
  if (n === 2) return [Faction.PLAYER, Faction.RIVAL_3];
  if (n === 3) return [Faction.PLAYER, Faction.RIVAL_1, Faction.RIVAL_2];
  return [...ALL_FACTION_SLOTS];
}

/**
 * Return exactly 4 org ids, filling missing/duplicate/invalid entries with the first
 * unused organization. Used by both match setup and the multiplayer lobby.
 */
export function ensureUniqueOrgs(list) {
  const used = new Set();
  const result = [];
  for (let i = 0; i < 4; i++) {
    let candidate = list?.[i];
    if (!candidate || !ORGANIZATIONS[candidate] || used.has(candidate)) {
      candidate = ALL_ORG_IDS.find((id) => !used.has(id)) || ALL_ORG_IDS[0];
    }
    used.add(candidate);
    result.push(candidate);
  }
  return result;
}

// Event subscribers translating territory facts into presentation.
// Wired once in main.js; sim/territory.js only emits events (see EVENTS.md).

import { CHUNK_PX } from '../config/constants.js';
import { FACTION_META } from '../config/organizations.js';
import { state } from '../core/state.js';
import { addFloatingText } from './effects.js';

export function onChunkCaptured({ chunk, faction }) {
  addFloatingText(
    chunk.cx * CHUNK_PX + CHUNK_PX / 2,
    chunk.cy * CHUNK_PX + 28,
    `${FACTION_META[faction].short} TURF`,
    FACTION_META[faction].accent
  );
  state.minimapCacheTimer = 1.0;
}

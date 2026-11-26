// Event subscribers translating recruitment facts into visual feedback.
// Wired once in main.js; sim/units.js only emits events (see EVENTS.md).

import { FACTION_META } from '../config/organizations.js';
import { addFloatingText } from './effects.js';

export function onUnitRecruited({ unit, faction, rank, cost }) {
  const rankLabel = (FACTION_META[faction].ranks[rank] || rank).toUpperCase();
  addFloatingText(
    unit.x,
    unit.y - 26,
    `+${rankLabel} ($${cost.toLocaleString()})`,
    FACTION_META[faction].accent
  );
}

// Input boundary: guests stream the command to the host; everyone else runs it locally.

import { getLocalFaction, state } from '../core/state.js';
import { dispatchCommand } from '../sim/commands.js';

export function sendOrDispatchCommand(payload, faction = getLocalFaction()) {
  if (state.net && state.net.isGuest()) {
    state.net.sendCommand(payload);
    return true;
  }
  return dispatchCommand(faction, payload);
}

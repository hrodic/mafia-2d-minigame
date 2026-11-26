// UI-agnostic lobby rules: host seat assignment, human capacity, roster snapshots
// and guest seat lookup. DOM rendering stays in mpNet until ui/lobbyUI.js is
// extracted.

import { ORGANIZATIONS, getActiveFactionSlots } from '../config/organizations.js';

export function getSeatedPeers(peers) {
  return Array.from(peers.values()).filter((p) => p.faction !== null);
}

export function reassignHostSeats({ peers, selfPeerId, config, slotClosedAsAI }) {
  const slots = getActiveFactionSlots(config.factionCount);

  for (let i = 1; i < 4; i++) {
    if (i >= config.factionCount) slotClosedAsAI[i] = false;
  }

  const hostPeer = peers.get(selfPeerId);
  if (hostPeer) {
    hostPeer.faction = slots[0];
    hostPeer.slotIdx = 0;
  }

  const guestPeers = Array.from(peers.values()).filter((p) => !p.isHost);
  const availableSlotIndices = [];
  for (let idx = 1; idx < config.factionCount; idx++) {
    if (!slotClosedAsAI[idx]) availableSlotIndices.push(idx);
  }

  guestPeers.forEach((gp, i) => {
    if (i < availableSlotIndices.length) {
      const slotIdx = availableSlotIndices[i];
      gp.slotIdx = slotIdx;
      gp.faction = slots[slotIdx];
    } else {
      gp.slotIdx = -1;
      gp.faction = null;
    }
  });

  return slots;
}

export function getOpenHumanCapacity(config, slotClosedAsAI) {
  let open = 1; // Host
  for (let idx = 1; idx < config.factionCount; idx++) {
    if (!slotClosedAsAI[idx]) open++;
  }
  return open;
}

export function buildLobbyRosterSnapshot({ config, peers, slotClosedAsAI }) {
  const slots = getActiveFactionSlots(config.factionCount);
  const seatedPeers = getSeatedPeers(peers);
  const roster = [];

  for (let idx = 0; idx < config.factionCount; idx++) {
    const slotFaction = slots[idx];
    const occupant = seatedPeers.find((p) => p.faction === slotFaction);
    if (occupant) {
      roster.push({
        peerId: occupant.peerId,
        name: occupant.name,
        faction: occupant.faction,
        slotIdx: occupant.slotIdx,
        isHost: occupant.isHost,
        isAI: false,
      });
    } else if (idx > 0 && slotClosedAsAI[idx]) {
      const org = ORGANIZATIONS[config.orgRoster[idx]];
      roster.push({
        peerId: `AI_${idx}`,
        name: `AI (${org.ranks.BOSS})`,
        faction: slotFaction,
        slotIdx: idx,
        isHost: false,
        isAI: true,
      });
    }
  }

  return roster;
}

export function findGuestSeat(roster, selfPeerId) {
  return (
    roster.find((p) => p.peerId === selfPeerId) ||
    roster.find((p) => !p.isHost && !p.isAI) ||
    null
  );
}

// Host-side multiplayer controller: lobby admission, seats, match launch,
// snapshot broadcast, remote input/commands and peer-leave AI takeover.
// Transport/channel access and UI toasts are injected by mpNet.

import { Faction, UnitRank } from '../config/enums.js';
import { GAME_VERSION } from '../config/version.js';
import { RANK_STATS } from '../config/balance.js';
import { FACTION_META } from '../config/organizations.js';
import { state } from '../core/state.js';
import { randomWorldSeed } from '../core/rng.js';
import { dispatchCommand } from '../sim/commands.js';
import { renderHostLobby } from '../ui/lobbyUI.js';
import { MSG, envelope, isVersionCompatible, encodeSnapshot } from './protocol.js';
import {
  getSeatedPeers,
  reassignHostSeats,
  getOpenHumanCapacity,
  buildLobbyRosterSnapshot,
} from './lobby.js';

export function createHostController(deps) {
  const {
    getMode,
    isRoomActive,
    getSelfPeerId,
    getConfig,
    getMatchStarted,
    setMatchStarted,
    setLocalFaction,
    getSendLobby,
    getSendInit,
    getSendSnap,
    getSendEvent,
    initializeWorld,
    onMatchLaunched,
    notify,
  } = deps;

  const peers = new Map(); // peerId -> { peerId, name, faction, slotIdx, isHost, lastInput }
  const slotClosedAsAI = [false, false, false, false];
  let snapshotSeq = 0;
  let snapshotTimer = 0;

  function reset() {
    peers.clear();
    for (let i = 0; i < slotClosedAsAI.length; i++) slotClosedAsAI[i] = false;
    snapshotSeq = 0;
    snapshotTimer = 0;
  }

  function initHost(hostName) {
    reset();
    const selfPeerId = getSelfPeerId();
    peers.set(selfPeerId, {
      peerId: selfPeerId,
      name: hostName,
      faction: Faction.PLAYER,
      slotIdx: 0,
      isHost: true,
      lastInput: { mx: 0, my: 0, sprint: false, facing: 0, fire: false },
      lastInputAt: 0,
      lastCmdSeq: 0,
    });
  }

  function updateLobbyUI() {
    if (getMode() !== 'HOST') return;
    const config = getConfig();
    const slots = reassignHostSeats({
      peers,
      selfPeerId: getSelfPeerId(),
      config,
      slotClosedAsAI,
    });
    const seatedPeers = getSeatedPeers(peers);
    const openHumans = getOpenHumanCapacity(config, slotClosedAsAI);

    renderHostLobby({
      config,
      slots,
      seatedPeers,
      slotClosedAsAI,
      openHumans,
      hasRoom: isRoomActive(),
      onToggleSlot: (idx) => {
        if (idx >= 1 && idx < 4) {
          slotClosedAsAI[idx] = !slotClosedAsAI[idx];
          updateLobbyUI();
          broadcastLobbyState();
        }
      },
    });
  }

  function broadcastLobbyState() {
    const sendLobby = getSendLobby();
    if (!isRoomActive() || getMode() !== 'HOST' || !sendLobby) return;
    const config = getConfig();
    reassignHostSeats({ peers, selfPeerId: getSelfPeerId(), config, slotClosedAsAI });
    const roster = buildLobbyRosterSnapshot({ config, peers, slotClosedAsAI });
    sendLobby(envelope(MSG.LOBBY_STATE, 0, { roster, settings: config }));
  }

  function sendLobbyStateToPeer(targetPeerId) {
    const sendLobby = getSendLobby();
    if (!isRoomActive() || getMode() !== 'HOST' || !sendLobby) return;
    const config = getConfig();
    reassignHostSeats({ peers, selfPeerId: getSelfPeerId(), config, slotClosedAsAI });
    const roster = buildLobbyRosterSnapshot({ config, peers, slotClosedAsAI });
    sendLobby(
      envelope(MSG.LOBBY_STATE, 0, {
        yourPeerId: targetPeerId,
        roster,
        settings: config,
      }),
      targetPeerId
    );
  }

  function handleLobby(env, peerId) {
    if (!env || getMode() !== 'HOST') return;
    const sendLobby = getSendLobby();
    if (!sendLobby) return;

    if (env.type === MSG.HELLO) {
      if (!isVersionCompatible(env)) {
        sendLobby(envelope(MSG.REJECT, 0, { reason: `Version mismatch (Host is ${GAME_VERSION})` }), peerId);
        return;
      }
      if (getMatchStarted()) {
        sendLobby(envelope(MSG.REJECT, 0, { reason: 'Match already in progress' }), peerId);
        return;
      }
      if (peers.has(peerId)) {
        sendLobbyStateToPeer(peerId);
        return;
      }

      const config = getConfig();
      reassignHostSeats({ peers, selfPeerId: getSelfPeerId(), config, slotClosedAsAI });
      const openCapacity = getOpenHumanCapacity(config, slotClosedAsAI);
      if (peers.size >= openCapacity) {
        sendLobby(envelope(MSG.REJECT, 0, { reason: 'Lobby is full' }), peerId);
        return;
      }

      const guestName = String(env.payload?.name || 'Guest Boss').slice(0, 16);
      peers.set(peerId, {
        peerId,
        name: guestName,
        faction: null,
        slotIdx: -1,
        isHost: false,
        lastInput: { mx: 0, my: 0, sprint: false, facing: 0, fire: false },
        lastInputAt: 0,
        lastCmdSeq: 0,
      });
      reassignHostSeats({ peers, selfPeerId: getSelfPeerId(), config, slotClosedAsAI });
      updateLobbyUI();
      sendLobbyStateToPeer(peerId);
      broadcastLobbyState();
      notify(`${guestName} joined the lobby!`);
    }
  }

  function handlePeerLeave(peerId) {
    if (getMode() !== 'HOST') return;
    const peer = peers.get(peerId);
    if (!peer || peer.isHost) return;

    const leftFaction = peer.faction;
    const leftName = peer.name;
    peers.delete(peerId);

    if (getMatchStarted() && leftFaction) {
      const bossNpc = state.npcs.find((n) => n.faction === leftFaction && n.rank === UnitRank.BOSS);
      if (bossNpc) {
        bossNpc.humanPeerId = null;
        bossNpc.speed = RANK_STATS[UnitRank.BOSS].speedAi;
      }
      notify(`${leftName} disconnected. AI took control of ${FACTION_META[leftFaction].short}.`);
      return;
    }

    reassignHostSeats({
      peers,
      selfPeerId: getSelfPeerId(),
      config: getConfig(),
      slotClosedAsAI,
    });
    updateLobbyUI();
    broadcastLobbyState();
    notify(`${leftName} left the lobby.`);
  }

  function handleInput(env, peerId) {
    if (!env || getMode() !== 'HOST' || !getMatchStarted()) return;
    const peer = peers.get(peerId);
    if (peer && env.type === MSG.INPUT && env.payload) {
      peer.lastInput = {
        mx: Math.max(-1, Math.min(1, Number(env.payload.mx) || 0)),
        my: Math.max(-1, Math.min(1, Number(env.payload.my) || 0)),
        sprint: Boolean(env.payload.sprint),
        facing: Number(env.payload.facing) || 0,
        fire: Boolean(env.payload.fire),
      };
      peer.lastInputAt = performance.now();
    }
  }

  function handleCommand(env, peerId) {
    if (!env || getMode() !== 'HOST' || !getMatchStarted()) return;
    const peer = peers.get(peerId);
    if (peer && peer.faction && env.type === MSG.CMD) {
      // The local bus can deliver the same packet twice; command seq is the
      // idempotency key, so purchases/switch commands never apply twice.
      if (Number.isFinite(env.seq)) {
        if (env.seq <= (peer.lastCmdSeq || 0)) return;
        peer.lastCmdSeq = env.seq;
      }
      dispatchCommand(peer.faction, env.payload);
    }
  }

  function launchMatch({ gridSize, tickSeconds, incomeTier, factionCount, orgRoster, unitCaps, seedOverride = null }) {
    if (getMode() !== 'HOST' || !isRoomActive()) return;
    reassignHostSeats({
      peers,
      selfPeerId: getSelfPeerId(),
      config: getConfig(),
      slotClosedAsAI,
    });

    const worldSeed = seedOverride ?? randomWorldSeed();
    setLocalFaction(Faction.PLAYER);
    setMatchStarted(true);
    snapshotSeq = 0;
    snapshotTimer = 0;

    initializeWorld({ gridSize, tickSeconds, incomeTier, factionCount, orgRoster, unitCaps, worldSeed });
    onMatchLaunched();

    // Guest command sequences restart at 1 for the new match.
    for (const p of peers.values()) p.lastCmdSeq = 0;

    const assignments = {};
    for (const p of peers.values()) {
      if (p.faction) {
        assignments[p.peerId] = {
          peerId: p.peerId,
          name: p.name,
          faction: p.faction,
          slotIdx: p.slotIdx,
          isHost: p.isHost,
        };
      }
    }

    const initialSnapshot = encodeSnapshot(state);
    const sendInit = getSendInit();
    if (!sendInit) return;
    for (const p of peers.values()) {
      if (!p.isHost && p.faction) {
        sendInit(
          envelope(MSG.INIT_MATCH, 1, {
            yourPeerId: p.peerId,
            gridSize,
            tickSeconds,
            incomeTier,
            factionCount,
            orgRoster,
            unitCaps,
            worldSeed,
            assignments,
            snapshot: initialSnapshot,
          }),
          p.peerId
        );
      }
    }
  }

  function update(dt) {
    snapshotTimer += dt;
    if (snapshotTimer >= 0.085) {
      snapshotTimer = 0;
      snapshotSeq++;
      const sendSnap = getSendSnap();
      if (sendSnap) {
        sendSnap(envelope(MSG.SNAPSHOT, snapshotSeq, encodeSnapshot(state)));
      }
    }
  }

  function broadcastEvent(payload) {
    if (getMode() !== 'HOST' || !getMatchStarted()) return;
    const sendEvent = getSendEvent();
    if (!sendEvent) return;
    sendEvent(envelope(MSG.EVENT, snapshotSeq, payload));
  }

  function getPeerInput(peerId) {
    const peer = peers.get(peerId);
    if (!peer) return null;
    // A guest that stops streaming (hidden tab, lost focus, crash) must not
    // keep driving its boss with a stale direction forever.
    if (!peer.lastInputAt || performance.now() - peer.lastInputAt > 500) {
      return {
        mx: 0,
        my: 0,
        sprint: false,
        facing: peer.lastInput ? peer.lastInput.facing : 0,
        fire: false,
      };
    }
    return peer.lastInput;
  }

  function isHumanFaction(faction) {
    for (const p of peers.values()) {
      if (p.faction === faction) return true;
    }
    return false;
  }

  function getPeerForFaction(faction) {
    for (const p of peers.values()) {
      if (p.faction === faction && !p.isHost) return p.peerId;
    }
    return null;
  }

  function getAliasForFaction(faction) {
    for (const p of peers.values()) {
      if (p.faction === faction) return p.name;
    }
    return null;
  }

  return {
    reset,
    initHost,
    updateLobbyUI,
    broadcastLobbyState,
    handleLobby,
    handlePeerLeave,
    handleInput,
    handleCommand,
    launchMatch,
    update,
    broadcastEvent,
    getPeerInput,
    isHumanFaction,
    getPeerForFaction,
    getAliasForFaction,
  };
}

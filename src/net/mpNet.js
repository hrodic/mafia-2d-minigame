// Host-authoritative multiplayer: lobby, snapshots, guest input and action
// commands. Transport (Trystero + local bus) lives in ./transport.js; Phase 4
// continues the protocol/lobby/host/guest split.

import { Faction } from '../config/enums.js';
import { FACTION_META, ensureUniqueOrgs } from '../config/organizations.js';
import { state, getLocalBoss } from '../core/state.js';
import { initWorld } from '../sim/match.js';
import { showToast } from '../ui/menus.js';
import { renderGuestLobby } from '../ui/lobbyUI.js';
import { connectSignalingRoom, randomToken } from './transport.js';
import { findGuestSeat } from './lobby.js';
import { createGuestController } from './guest.js';
import { createHostController } from './host.js';


export const mpNet = (() => {
  let mode = 'SINGLE'; // 'SINGLE' | 'HOST' | 'JOIN'
  let room = null;
  let roomCode = '';
  let roomSecret = '';
  let selfPeerId = '';
  let localFaction = Faction.PLAYER;
  let matchStarted = false;
  let isJoining = false;

  let sendLobby = null;
  let sendInit = null;
  let sendSnap = null;
  let sendInput = null;
  let sendCmd = null;
  let sendEvent = null;

  // Controllers are created below once the composition helpers exist.
  let host = null;
  let guest = null;

  function getCurrentHostConfig() {
    return {
      gridSize: Number(document.getElementById('map-size-slider')?.value || 15),
      tickSeconds: Number(document.getElementById('tick-speed-slider')?.value || 10),
      incomeTier: state.currentIncomeTier,
      factionCount: state.activeFactionCount,
      orgRoster: ensureUniqueOrgs(state.selectedFactionOrgs),
    };
  }

  function initializeWorld(payload) {
    initWorld(
      payload.gridSize,
      true,
      payload.tickSeconds,
      payload.incomeTier,
      payload.factionCount,
      payload.orgRoster,
      payload.worldSeed
    );
  }

  function attachSignalingErrorHandler(activeRoom, statusEl, errEl) {
    if (typeof activeRoom.onError !== 'function') return;
    activeRoom.onError((err) => {
      if (err?.code !== 'relay-failed') return;
      const message = 'Signaling unavailable: all configured relays failed. Check your connection and retry.';
      if (statusEl) statusEl.textContent = 'Signaling error';
      if (errEl) {
        errEl.textContent = message;
        errEl.classList.remove('hidden');
      }
      showToast(message);
    });
  }

  function updateHostLobbyUI() {
    if (host) host.updateLobbyUI();
  }

  function renderGuestLobbyUI() {
    const roster = guest ? guest.getRoster() : [];
    const settings = guest ? guest.getSettings() : null;
    const me = findGuestSeat(roster, selfPeerId);
    if (me && settings) {
      localFaction = me.faction || Faction.RIVAL_1;
    }
    renderGuestLobby({ roster, settings, me });
  }

  function broadcastHostLobbyState() {
    if (host) host.broadcastLobbyState();
  }

  function setupChannels(activeRoom) {
    function bindAction(ns) {
      const res = activeRoom.makeAction(ns);
      if (Array.isArray(res)) return res;
      if (res && typeof res === 'object') {
        return [
          res.send || res[0],
          res.receive || res.get || res.onMessage || res[1],
        ];
      }
      throw new Error(`Invalid action binding for ${ns}`);
    }

    const [txLobby, rxLobby] = bindAction('lobby');
    const [txInit, rxInit] = bindAction('init');
    const [txSnap, rxSnap] = bindAction('snap');
    const [txInput, rxInput] = bindAction('input');
    const [txCmd, rxCmd] = bindAction('cmd');
    const [txEvent, rxEvent] = bindAction('event');

    sendLobby = txLobby;
    sendInit = txInit;
    sendSnap = txSnap;
    sendInput = txInput;
    sendCmd = txCmd;
    sendEvent = txEvent;

    if (typeof activeRoom.onPeerJoin === 'function') {
      activeRoom.onPeerJoin((peerId) => {
        if (mode === 'JOIN' && guest) guest.handlePeerJoin(peerId);
      });
    }

    if (typeof activeRoom.onPeerLeave === 'function') {
      activeRoom.onPeerLeave((peerId) => {
        if (mode === 'HOST' && host) {
          host.handlePeerLeave(peerId);
        } else if (mode === 'JOIN' && guest) {
          guest.handlePeerLeave(peerId);
        }
      });
    }

    rxLobby((env, peerId) => {
      if (!env) return;
      if (mode === 'HOST' && host) {
        host.handleLobby(env, peerId);
      } else if (mode === 'JOIN' && guest) {
        guest.handleLobby(env, peerId);
      }
    });

    rxInit((env, peerId) => {
      if (guest) guest.handleInit(env, peerId);
    });

    rxSnap((env, peerId) => {
      if (guest) guest.handleSnapshot(env, peerId);
    });

    rxInput((env, peerId) => {
      if (host) host.handleInput(env, peerId);
    });

    rxCmd((env, peerId) => {
      if (host) host.handleCommand(env, peerId);
    });

    rxEvent((env, peerId) => {
      if (guest) guest.handleEvent(env, peerId);
    });
  }

  async function createHostRoom() {
    const statusEl = document.getElementById('mp-host-status');
    const errEl = document.getElementById('mp-host-error');
    errEl.classList.add('hidden');
    statusEl.textContent = 'Creating...';

    try {
      cleanup(false);
      mode = 'HOST';
      roomCode = randomToken(6);
      roomSecret = randomToken(8);
      const rawName = document.getElementById('mp-host-name')?.value?.trim();
      const hostName = rawName ? rawName.slice(0, 16) : 'Host Boss';

      const activeRoom = await connectSignalingRoom(roomCode, roomSecret);
      room = activeRoom;
      selfPeerId = activeRoom.selfId;
      attachSignalingErrorHandler(activeRoom, statusEl, errEl);
      if (host) host.initHost(hostName);

      setupChannels(activeRoom);

      document.getElementById('mp-room-code-display').textContent = `${roomCode}:${roomSecret}`;
      document.getElementById('mp-host-room-details').classList.remove('hidden');
      statusEl.textContent = 'Room Open';
      updateHostLobbyUI();
      showToast(`Room ${roomCode} created! Share the invitation link.`);
    } catch (err) {
      statusEl.textContent = 'Failed';
      errEl.textContent = `Signaling Error: ${err?.message || err}`;
      errEl.classList.remove('hidden');
    }
  }

  async function joinGuestRoom() {
    if (isJoining || room) return;
    const statusEl = document.getElementById('mp-join-status');
    const errEl = document.getElementById('mp-join-error');
    const rawInput = document.getElementById('mp-join-input')?.value?.trim() || '';
    errEl.classList.add('hidden');

    let parsedCode = '';
    let parsedSecret = '';
    if (rawInput.includes('room=')) {
      try {
        const urlObj = new URL(rawInput.startsWith('http') ? rawInput : `${window.location.origin}/?${rawInput.replace(/^\?/, '')}`);
        parsedCode = (urlObj.searchParams.get('room') || '').toUpperCase();
        parsedSecret = (urlObj.searchParams.get('secret') || '').toUpperCase();
      } catch (_) {}
    } else if (rawInput.includes(':')) {
      const parts = rawInput.split(':');
      parsedCode = (parts[0] || '').trim().toUpperCase();
      parsedSecret = (parts[1] || '').trim().toUpperCase();
    }

    if (!parsedCode || !parsedSecret) {
      errEl.textContent = 'Enter a valid invitation link or RoomCode:Secret.';
      errEl.classList.remove('hidden');
      return;
    }

    isJoining = true;
    statusEl.textContent = 'Connecting...';
    const joinBtn = document.getElementById('btn-mp-join-room');
    if (joinBtn) {
      joinBtn.disabled = true;
      joinBtn.textContent = 'Connecting...';
    }

    try {
      cleanup(false);
      mode = 'JOIN';
      roomCode = parsedCode;
      roomSecret = parsedSecret;

      const rawName = document.getElementById('mp-guest-name')?.value?.trim();
      const guestName = rawName ? rawName.slice(0, 16) : 'Guest Boss';

      const activeRoom = await connectSignalingRoom(roomCode, roomSecret);
      room = activeRoom;
      selfPeerId = activeRoom.selfId;
      attachSignalingErrorHandler(activeRoom, statusEl, errEl);
      if (guest) guest.setGuestName(guestName);
      setupChannels(activeRoom);
      if (guest) guest.startHello(guestName);
    } catch (err) {
      isJoining = false;
      statusEl.textContent = 'Failed';
      errEl.textContent = `Connection Error: ${err?.message || err}`;
      errEl.classList.remove('hidden');
      if (joinBtn) {
        joinBtn.disabled = false;
        joinBtn.textContent = 'Connect';
      }
    }
  }

  function launchMultiplayerMatch(gridSize, tickSeconds, incomeTier, factionCount, orgRoster, seedOverride = null) {
    if (host) {
      host.launchMatch({ gridSize, tickSeconds, incomeTier, factionCount, orgRoster, seedOverride });
    }
  }

  function flushGuestInput() {
    if (guest) guest.flushInput();
  }

  function sendCommand(payload) {
    if (guest) guest.sendCommand(payload);
  }

  function broadcastEvent(payload) {
    if (host) host.broadcastEvent(payload);
  }

  function updateHost(dt) {
    if (host) host.update(dt);
  }

  function updateGuest(dt) {
    if (guest) guest.update(dt);
  }

  function handleHostDisconnected() {
    matchStarted = false;
    state.gameStarted = false;
    document.getElementById('disconnect-banner').classList.remove('hidden');
  }

  function cleanup(resetMode = true) {
    if (room) {
      try { room.leave(); } catch (_) {}
      room = null;
    }
    if (host) host.reset();
    sendLobby = null;
    sendInit = null;
    sendSnap = null;
    sendInput = null;
    sendCmd = null;
    sendEvent = null;
    matchStarted = false;
    isJoining = false;
    if (guest) guest.reset();
    localFaction = Faction.PLAYER;
    document.getElementById('mp-hud-badge').classList.add('hidden');
    document.getElementById('mp-host-room-details')?.classList.add('hidden');
    document.getElementById('mp-guest-lobby-box')?.classList.add('hidden');
    const joinBtn = document.getElementById('btn-mp-join-room');
    const joinInput = document.getElementById('mp-join-input');
    if (joinBtn) {
      joinBtn.disabled = false;
      joinBtn.textContent = 'Connect';
    }
    if (joinInput) joinInput.disabled = false;
    if (resetMode) {
      mode = 'SINGLE';
    }
  }

  function setMode(newMode) {
    if (mode !== newMode) {
      cleanup(false);
    }
    mode = newMode;
    document.querySelectorAll('.game-mode-btn').forEach((btn) => {
      const active = btn.getAttribute('data-mode') === newMode;
      btn.className = active
        ? 'game-mode-btn bg-amber-500/20 border border-amber-500 text-amber-300 py-2 px-3 rounded-lg text-xs font-extrabold uppercase tracking-wider transition'
        : 'game-mode-btn bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 py-2 px-3 rounded-lg text-xs font-extrabold uppercase tracking-wider transition';
    });

    const hostPanel = document.getElementById('mp-host-panel');
    const joinPanel = document.getElementById('mp-join-panel');
    const settingsWrap = document.getElementById('match-settings-wrapper');
    const startBtn = document.getElementById('btn-start-game');

    hostPanel.classList.toggle('hidden', newMode !== 'HOST');
    joinPanel.classList.toggle('hidden', newMode !== 'JOIN');
    settingsWrap.classList.toggle('hidden', newMode === 'JOIN');

    if (newMode === 'SINGLE') {
      startBtn.classList.remove('hidden');
      startBtn.disabled = false;
      startBtn.textContent = 'Launch Turf War';
    } else if (newMode === 'HOST') {
      startBtn.classList.remove('hidden');
      updateHostLobbyUI();
    } else if (newMode === 'JOIN') {
      startBtn.classList.add('hidden');
    }
  }

  host = createHostController({
    getMode: () => mode,
    isRoomActive: () => Boolean(room),
    getSelfPeerId: () => selfPeerId,
    getConfig: getCurrentHostConfig,
    getMatchStarted: () => matchStarted,
    setMatchStarted: (started) => { matchStarted = started; },
    setLocalFaction: (faction) => { localFaction = faction; },
    getSendLobby: () => sendLobby,
    getSendInit: () => sendInit,
    getSendSnap: () => sendSnap,
    getSendEvent: () => sendEvent,
    initializeWorld,
    onMatchLaunched: () => {
      const badge = document.getElementById('mp-hud-badge');
      if (badge) {
        badge.textContent = `MP HOST (${roomCode})`;
        badge.classList.remove('hidden');
      }
    },
    notify: (message) => showToast(message),
  });

  guest = createGuestController({
    getMode: () => mode,
    isRoomActive: () => Boolean(room),
    getSelfPeerId: () => selfPeerId,
    setSelfPeerId: (id) => { selfPeerId = id; },
    getMatchStarted: () => matchStarted,
    setMatchStarted: (started) => { matchStarted = started; },
    setLocalFaction: (faction) => { localFaction = faction; },
    getSendLobby: () => sendLobby,
    getSendInput: () => sendInput,
    getSendCmd: () => sendCmd,
    onRejected: (reason) => {
      isJoining = false;
      const errEl = document.getElementById('mp-join-error');
      if (errEl) {
        errEl.textContent = reason;
        errEl.classList.remove('hidden');
      }
      const statusEl = document.getElementById('mp-join-status');
      if (statusEl) statusEl.textContent = 'Rejected';
      const joinBtn = document.getElementById('btn-mp-join-room');
      const joinInput = document.getElementById('mp-join-input');
      if (joinBtn) {
        joinBtn.disabled = false;
        joinBtn.textContent = 'Connect';
      }
      if (joinInput) joinInput.disabled = false;
      cleanup(false);
    },
    onLobbyState: () => {
      isJoining = false;
      const statusEl = document.getElementById('mp-join-status');
      const errEl = document.getElementById('mp-join-error');
      const box = document.getElementById('mp-guest-lobby-box');
      if (statusEl) statusEl.textContent = 'Connected';
      if (errEl) errEl.classList.add('hidden');
      if (box) box.classList.remove('hidden');
      const joinBtn = document.getElementById('btn-mp-join-room');
      const joinInput = document.getElementById('mp-join-input');
      if (joinBtn) {
        joinBtn.disabled = true;
        joinBtn.textContent = 'Joined';
      }
      if (joinInput) joinInput.disabled = true;
      renderGuestLobbyUI();
    },
    initializeWorld,
    onMatchInitialized: () => {
      document.getElementById('setup-modal').classList.add('hidden');
      const badge = document.getElementById('mp-hud-badge');
      if (badge) {
        badge.textContent = `MP GUEST (${roomCode})`;
        badge.classList.remove('hidden');
      }
      const localBoss = getLocalBoss();
      state.camera.x = localBoss.x;
      state.camera.y = localBoss.y;
      showToast(`Joined match as ${FACTION_META[localFaction].name} (${FACTION_META[localFaction].ranks.BOSS})!`);
    },
    onHostDisconnected: () => handleHostDisconnected(),
  });

  return {
    get mode() { return mode; },
    get localFaction() { return localFaction; },
    isActive: () => mode !== 'SINGLE' && matchStarted,
    isHost: () => mode === 'HOST' && matchStarted,
    isGuest: () => mode === 'JOIN' && matchStarted,
    isHumanFaction: (f) => {
      if (f === Faction.PLAYER) return true;
      if (mode === 'HOST' && host) {
        return host.isHumanFaction(f);
      } else if (mode === 'JOIN' && guest) {
        return guest.getRoster().some((p) => p.faction === f && !p.isAI);
      }
      return false;
    },
    getPeerForFaction: (f) => (host ? host.getPeerForFaction(f) : null),
    getAliasForFaction: (f) => {
      if (mode === 'HOST' && host) {
        return host.getAliasForFaction(f);
      } else if (mode === 'JOIN' && guest) {
        const entry = guest.getRoster().find((p) => p.faction === f && !p.isAI);
        if (entry) return entry.name;
      }
      return null;
    },
    getPeerInput: (peerId) => (host ? host.getPeerInput(peerId) : null),
    setMode,
    createHostRoom,
    joinGuestRoom,
    launchMultiplayerMatch,
    flushGuestInput,
    sendCommand,
    broadcastEvent,
    updateHost,
    updateGuest,
    updateHostLobbyUI,
    broadcastHostLobbyState,
    cleanup,
  };
})();

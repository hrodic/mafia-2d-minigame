// Host-authoritative multiplayer: lobby, snapshots, guest input and action
// commands. Transport (Trystero + local bus) lives in ./transport.js; Phase 4
// continues the protocol/lobby/host/guest split.

import { Faction, UnitRank } from '../config/enums.js';
import { GAME_VERSION } from '../config/version.js';
import { RANK_STATS } from '../config/balance.js';
import { ORGANIZATIONS, FACTION_META, ensureUniqueOrgs } from '../config/organizations.js';
import { state, getLocalBoss, getUnitById } from '../core/state.js';
import { randomWorldSeed } from '../core/rng.js';
import { initWorld } from '../sim/match.js';
import { eliminateFaction } from '../sim/territory.js';
import { getEntityCollisionRadius } from '../sim/movement.js';
import { dispatchCommand } from '../sim/commands.js';
import { spawnDeadBody, bulletTracers } from '../render/effects.js';
import { canvas } from '../render/canvas.js';
import { sfx } from '../audio/sfx.js';
import { showToast } from '../ui/menus.js';
import { connectSignalingRoom, randomToken } from './transport.js';
import {
  MSG,
  EVENT_KIND,
  envelope,
  isVersionCompatible,
  encodeSnapshot,
  decodeSnapshot,
} from './protocol.js';
import {
  getSeatedPeers,
  reassignHostSeats,
  getOpenHumanCapacity,
  buildLobbyRosterSnapshot,
  findGuestSeat,
} from './lobby.js';


export const mpNet = (() => {
  let mode = 'SINGLE'; // 'SINGLE' | 'HOST' | 'JOIN'
  let room = null;
  let roomCode = '';
  let roomSecret = '';
  let selfPeerId = '';
  let hostPeerId = '';
  let localFaction = Faction.PLAYER;
  let matchStarted = false;
  let isJoining = false;

  let sendLobby = null;
  let sendInit = null;
  let sendSnap = null;
  let sendInput = null;
  let sendCmd = null;
  let sendEvent = null;

  // Host-only state
  const peers = new Map(); // peerId -> { peerId, name, faction, slotIdx, isHost, lastInput }
  const slotClosedAsAI = [false, false, false, false];
  let snapshotSeq = 0;
  let snapshotTimer = 0;

  // Guest-only state
  let guestLobbyRoster = [];
  let guestSettings = null;
  let lastSnapshotSeq = 0;
  let guestInputSeq = 0;
  let guestCmdSeq = 0;
  let inputSendTimer = 0;

  function getCurrentHostConfig() {
    return {
      gridSize: Number(document.getElementById('map-size-slider')?.value || 15),
      tickSeconds: Number(document.getElementById('tick-speed-slider')?.value || 10),
      incomeTier: state.currentIncomeTier,
      factionCount: state.activeFactionCount,
      orgRoster: ensureUniqueOrgs(state.selectedFactionOrgs),
    };
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
    if (mode !== 'HOST') return;
    const cfg = getCurrentHostConfig();
    const slots = reassignHostSeats({ peers, selfPeerId, config: cfg, slotClosedAsAI });
    const rosterEl = document.getElementById('mp-host-roster');
    const countEl = document.getElementById('mp-host-player-count');
    const startBtn = document.getElementById('btn-start-game');

    const seatedPeers = getSeatedPeers(peers);
    let aiCount = 0;
    let html = '';

    for (let idx = 0; idx < cfg.factionCount; idx++) {
      const slotFaction = slots[idx];
      const org = ORGANIZATIONS[cfg.orgRoster[idx]] || ORGANIZATIONS.COSA_NOSTRA;
      const occupant = seatedPeers.find((p) => p.faction === slotFaction);

      if (occupant) {
        html += `
          <div class="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-[11px]">
            <div class="flex items-center gap-2 truncate">
              <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${org.badge}"></span>
              <span class="font-bold text-white truncate">${occupant.name}</span>
              <span class="text-zinc-400">(${org.short})</span>
            </div>
            <span class="font-mono text-[10px] font-bold ${occupant.isHost ? 'text-amber-300' : 'text-emerald-400'}">
              ${occupant.isHost ? 'HOST' : 'PLAYER'}
            </span>
          </div>
        `;
      } else if (slotClosedAsAI[idx]) {
        aiCount++;
        html += `
          <div class="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-[11px]">
            <div class="flex items-center gap-2 truncate">
              <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${org.badge}"></span>
              <span class="font-semibold text-purple-300">AI Syndicate</span>
              <span class="text-zinc-400">(${org.short})</span>
            </div>
            <button type="button" data-toggle-slot="${idx}" class="mp-slot-toggle bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 text-zinc-200 text-[10px] font-bold px-2 py-0.5 rounded transition">
              Open Player
            </button>
          </div>
        `;
      } else {
        html += `
          <div class="flex items-center justify-between bg-zinc-900/40 border border-dashed border-zinc-800 rounded-lg px-2.5 py-1.5 text-[11px]">
            <div class="flex items-center gap-2 truncate">
              <span class="w-2.5 h-2.5 rounded-full opacity-50 flex-shrink-0" style="background:${org.badge}"></span>
              <span class="text-zinc-500 italic">Open Slot (${org.short})</span>
            </div>
            <button type="button" data-toggle-slot="${idx}" class="mp-slot-toggle bg-purple-950/80 hover:bg-purple-900 border border-purple-500/50 text-purple-200 text-[10px] font-bold px-2 py-0.5 rounded transition">
              Close → AI
            </button>
          </div>
        `;
      }
    }

    rosterEl.innerHTML = html;
    rosterEl.querySelectorAll('.mp-slot-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sIdx = Number(btn.getAttribute('data-toggle-slot'));
        if (sIdx >= 1 && sIdx < 4) {
          slotClosedAsAI[sIdx] = !slotClosedAsAI[sIdx];
          updateHostLobbyUI();
          broadcastHostLobbyState();
        }
      });
    });

    const humanCount = seatedPeers.length;
    const openHumans = getOpenHumanCapacity(cfg, slotClosedAsAI);
    countEl.textContent = `${humanCount}/${openHumans} Humans · ${aiCount} AI`;

    if (startBtn && mode === 'HOST') {
      const allOpenFilled = humanCount >= 2 && humanCount === openHumans;
      startBtn.disabled = !room || !allOpenFilled;
      if (!room) {
        startBtn.textContent = 'Create Room First';
      } else if (humanCount < 2) {
        startBtn.textContent = `Waiting for Players (${humanCount}/${openHumans} Humans)...`;
      } else if (!allOpenFilled) {
        startBtn.textContent = `Waiting for Open Slots (${humanCount}/${openHumans}) or Close → AI`;
      } else {
        startBtn.textContent = `Launch Multiplayer (${humanCount} Humans + ${aiCount} AI)`;
      }
    }
  }

  function renderGuestLobbyUI() {
    const assignedEl = document.getElementById('mp-guest-assigned-faction');
    const settingsEl = document.getElementById('mp-guest-settings-summary');
    const rosterEl = document.getElementById('mp-guest-roster');

    const me = findGuestSeat(guestLobbyRoster, selfPeerId);
    if (me && guestSettings) {
      localFaction = me.faction || Faction.RIVAL_1;
      const org = ORGANIZATIONS[guestSettings.orgRoster?.[me.slotIdx]] || ORGANIZATIONS.BRATVA;
      assignedEl.innerHTML = `<span style="color:${org.accent}">${org.name} (${org.ranks.BOSS})</span>`;
    } else {
      assignedEl.textContent = 'Assigning seat...';
    }

    if (guestSettings) {
      settingsEl.textContent = `Map: ${guestSettings.gridSize}×${guestSettings.gridSize} · Tick: ${guestSettings.tickSeconds}s · Income: ${guestSettings.incomeTier}`;
    }

    let html = '';
    for (const p of guestLobbyRoster) {
      const org = ORGANIZATIONS[guestSettings?.orgRoster?.[p.slotIdx]] || ORGANIZATIONS.COSA_NOSTRA;
      html += `
        <div class="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1 text-[11px]">
          <div class="flex items-center gap-2 truncate">
            <span class="w-2 h-2 rounded-full" style="background:${org.badge}"></span>
            <span class="font-bold text-zinc-200 truncate">${p.name}</span>
            <span class="text-zinc-500">(${org.short})</span>
          </div>
          <span class="font-mono text-[10px] ${p.isHost ? 'text-amber-300' : p.isAI ? 'text-purple-300' : 'text-emerald-400'}">
            ${p.isHost ? 'HOST' : p.isAI ? 'AI' : 'PLAYER'}
          </span>
        </div>
      `;
    }
    rosterEl.innerHTML = html;
  }

  function broadcastHostLobbyState() {
    if (!room || mode !== 'HOST' || !sendLobby) return;
    const cfg = getCurrentHostConfig();
    reassignHostSeats({ peers, selfPeerId, config: cfg, slotClosedAsAI });
    const roster = buildLobbyRosterSnapshot({ config: cfg, peers, slotClosedAsAI });
    sendLobby(envelope(MSG.LOBBY_STATE, 0, { roster, settings: cfg }));
  }

  function sendLobbyStateToPeer(targetPeerId) {
    if (!room || mode !== 'HOST' || !sendLobby) return;
    const cfg = getCurrentHostConfig();
    reassignHostSeats({ peers, selfPeerId, config: cfg, slotClosedAsAI });
    const roster = buildLobbyRosterSnapshot({ config: cfg, peers, slotClosedAsAI });
    sendLobby(
      envelope(MSG.LOBBY_STATE, 0, {
        yourPeerId: targetPeerId,
        roster,
        settings: cfg,
      }),
      targetPeerId
    );
  }

  function applyAuthoritativeSnapshot(payload) {
    const snap = decodeSnapshot(payload);
    if (!snap) return;
    state.gameHour = snap.gameHour ?? state.gameHour;
    state.tickTimer = snap.tickTimer ?? state.tickTimer;

    if (snap.treasuries) Object.assign(state.treasuries, snap.treasuries);
    if (snap.kills) Object.assign(state.factionKills, snap.kills);
    if (snap.factionAlive) {
      for (const f of state.activeFactions) {
        const wasAlive = state.factionAlive[f];
        const nowAlive = Boolean(snap.factionAlive[f]);
        if (wasAlive && !nowAlive) {
          eliminateFaction(f);
        }
        state.factionAlive[f] = nowAlive;
      }
    }

    if (snap.playerBoss) {
      const pb = snap.playerBoss;
      // Store the authoritative target; the guest update interpolates per frame.
      state.player.netX = pb.x;
      state.player.netY = pb.y;
      state.player.facing = pb.facing;
      state.player.hp = pb.hp;
      state.player.maxHp = pb.maxHp;
      state.player.armor = pb.armor;
      state.player.maxArmor = pb.maxArmor;
      state.player.alive = pb.alive;
      if (pb.slash) state.player.slashAnimTimer = 0.18;
      if (pb.shoot) state.player.muzzleFlashTimer = 0.11;
    }

    if (Array.isArray(snap.chunks)) {
      let dirtyMinimap = false;
      for (let i = 0; i < snap.chunks.length; i++) {
        const [cx, cy, fac, prog, capFac] = snap.chunks[i];
        let chunk = state.world.getChunk(cx, cy);
        if (!chunk) {
          chunk = state.world.generateChunk(cx, cy, fac);
          dirtyMinimap = true;
        }
        if (chunk.faction !== fac) {
          chunk.faction = fac;
          dirtyMinimap = true;
        }
        chunk.captureProgress = prog;
        chunk.capturingFaction = capFac || null;
      }
      if (dirtyMinimap) state.minimapCacheTimer = 1.0;
    }

    if (Array.isArray(snap.npcs)) {
      const seenIds = new Set();
      for (let i = 0; i < snap.npcs.length; i++) {
        const [id, fac, rank, x, y, facing, hp, maxHp, armor, maxArmor, slash, shoot, hPeer] = snap.npcs[i];
        // The local player travels on playerBoss; never apply it twice from npcs.
        if (id === state.player.id) continue;
        seenIds.add(id);
        const stats = RANK_STATS[rank] || RANK_STATS[UnitRank.SOLDIER];
        const isHumanBoss = rank === UnitRank.BOSS && Boolean(hPeer);
        let unit = getUnitById(id);
        if (!unit) {
          unit = {
            id,
            faction: fac,
            rank,
            humanPeerId: hPeer || null,
            x,
            y,
            netX: x,
            netY: y,
            targetX: null,
            targetY: null,
            bodyRadius: getEntityCollisionRadius(rank),
            speed: isHumanBoss ? stats.speedHuman : stats.speedAi,
            hp,
            maxHp,
            armor,
            maxArmor,
            armorCooldown: 0,
            sprintTimer: 0,
            sprintCooldown: 0,
            isSprinting: false,
            minDmg: stats.minDmg,
            maxDmg: stats.maxDmg,
            facing,
            goalX: x,
            goalY: y,
            path: null,
            pathTimer: 0,
            aiTimer: 0,
            attackCooldown: 0,
            slashAnimTimer: 0,
            muzzleFlashTimer: 0,
            hitFlashTimer: 0,
            dodgeDir: 1,
            lastCheckX: x,
            lastCheckY: y,
            stuckTimer: 0,
          };
          state.npcs.push(unit);
        } else {
          unit.speed = isHumanBoss ? stats.speedHuman : stats.speedAi;
          unit.netX = x;
          unit.netY = y;
          unit.facing = facing;
          unit.hp = hp;
          unit.maxHp = maxHp;
          unit.armor = armor;
          unit.maxArmor = maxArmor;
          unit.humanPeerId = hPeer || null;
          if (slash) unit.slashAnimTimer = 0.18;
          if (shoot) unit.muzzleFlashTimer = 0.11;
        }
      }

      for (let i = state.npcs.length - 1; i >= 0; i--) {
        if (!seenIds.has(state.npcs[i].id)) {
          const dead = state.npcs[i];
          spawnDeadBody(dead.x, dead.y, dead.faction, dead.rank, dead.facing, dead.facing);
          state.npcs.splice(i, 1);
        }
      }
    }
  }

  function applyInitialMatchState(payload) {
    if (!payload) return;
    if (payload.yourPeerId) {
      selfPeerId = payload.yourPeerId;
    }
    const assignments = payload.assignments || {};
    const mySeat =
      assignments[selfPeerId] ||
      Object.values(assignments).find((a) => !a.isHost);
    if (mySeat && mySeat.faction) {
      localFaction = mySeat.faction;
    }

    matchStarted = true;
    lastSnapshotSeq = 0;
    guestInputSeq = 0;
    guestCmdSeq = 0;

    document.getElementById('setup-modal').classList.add('hidden');
    const badge = document.getElementById('mp-hud-badge');
    badge.textContent = `MP GUEST (${roomCode})`;
    badge.classList.remove('hidden');

    initWorld(
      payload.gridSize,
      true,
      payload.tickSeconds,
      payload.incomeTier,
      payload.factionCount,
      payload.orgRoster,
      payload.worldSeed
    );

    if (payload.snapshot) {
      applyAuthoritativeSnapshot(payload.snapshot);
    }

    const localBoss = getLocalBoss();
    state.camera.x = localBoss.x;
    state.camera.y = localBoss.y;
    showToast(`Joined match as ${FACTION_META[localFaction].name} (${FACTION_META[localFaction].ranks.BOSS})!`);
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
        if (mode === 'JOIN' && !hostPeerId && sendLobby) {
          const rawName = document.getElementById('mp-guest-name')?.value?.trim();
          const guestName = rawName ? rawName.slice(0, 16) : 'Guest Boss';
          sendLobby(envelope(MSG.HELLO, 0, { name: guestName }), peerId);
        }
      });
    }

    if (typeof activeRoom.onPeerLeave === 'function') {
      activeRoom.onPeerLeave((peerId) => {
        if (mode === 'HOST') {
          const peer = peers.get(peerId);
          if (peer && !peer.isHost) {
            const leftFaction = peer.faction;
            const leftName = peer.name;
            peers.delete(peerId);
            if (matchStarted && leftFaction) {
              const bossNpc = state.npcs.find((n) => n.faction === leftFaction && n.rank === UnitRank.BOSS);
              if (bossNpc) {
                bossNpc.humanPeerId = null;
                bossNpc.speed = 152;
              }
              showToast(`${leftName} disconnected. AI took control of ${FACTION_META[leftFaction].short}.`);
            } else {
              reassignHostSeats({ peers, selfPeerId, config: getCurrentHostConfig(), slotClosedAsAI });
              updateHostLobbyUI();
              broadcastHostLobbyState();
              showToast(`${leftName} left the lobby.`);
            }
          }
        } else if (mode === 'JOIN' && peerId === hostPeerId) {
          handleHostDisconnected();
        }
      });
    }

    rxLobby((env, peerId) => {
      if (!env) return;
      if (mode === 'HOST') {
        if (env.type === MSG.HELLO) {
          if (!isVersionCompatible(env)) {
            sendLobby(envelope(MSG.REJECT, 0, { reason: `Version mismatch (Host is ${GAME_VERSION})` }), peerId);
            return;
          }
          if (matchStarted) {
            sendLobby(envelope(MSG.REJECT, 0, { reason: 'Match already in progress' }), peerId);
            return;
          }
          if (peers.has(peerId)) {
            sendLobbyStateToPeer(peerId);
            return;
          }
          const cfg = getCurrentHostConfig();
          reassignHostSeats({ peers, selfPeerId, config: cfg, slotClosedAsAI });
          const openCapacity = getOpenHumanCapacity(cfg, slotClosedAsAI);
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
            lastInput: { mx: 0, my: 0, sprint: false, facing: 0 },
            lastInputAt: 0,
          });
          reassignHostSeats({ peers, selfPeerId, config: cfg, slotClosedAsAI });
          updateHostLobbyUI();
          sendLobbyStateToPeer(peerId);
          broadcastHostLobbyState();
          showToast(`${guestName} joined the lobby!`);
        }
      } else if (mode === 'JOIN') {
        if (!hostPeerId) hostPeerId = peerId;
        if (env.type === MSG.REJECT) {
          isJoining = false;
          const errEl = document.getElementById('mp-join-error');
          errEl.textContent = env.payload?.reason || 'Connection rejected by host.';
          errEl.classList.remove('hidden');
          document.getElementById('mp-join-status').textContent = 'Rejected';
          const joinBtn = document.getElementById('btn-mp-join-room');
          const joinInput = document.getElementById('mp-join-input');
          if (joinBtn) {
            joinBtn.disabled = false;
            joinBtn.textContent = 'Connect';
          }
          if (joinInput) joinInput.disabled = false;
          cleanup(false);
          return;
        }
        if (env.type === MSG.LOBBY_STATE) {
          isJoining = false;
          if (env.payload?.yourPeerId) {
            selfPeerId = env.payload.yourPeerId;
          }
          guestLobbyRoster = env.payload?.roster || [];
          guestSettings = env.payload?.settings || null;
          document.getElementById('mp-join-status').textContent = 'Connected';
          document.getElementById('mp-join-error').classList.add('hidden');
          document.getElementById('mp-guest-lobby-box').classList.remove('hidden');
          const joinBtn = document.getElementById('btn-mp-join-room');
          const joinInput = document.getElementById('mp-join-input');
          if (joinBtn) {
            joinBtn.disabled = true;
            joinBtn.textContent = 'Joined';
          }
          if (joinInput) joinInput.disabled = true;
          renderGuestLobbyUI();
        }
      }
    });

    rxInit((env, peerId) => {
      if (!env || mode !== 'JOIN') return;
      if (env.type === MSG.INIT_MATCH) {
        hostPeerId = peerId;
        applyInitialMatchState(env.payload);
      }
    });

    rxSnap((env, peerId) => {
      if (!env || mode !== 'JOIN' || !matchStarted) return;
      if (hostPeerId && peerId !== hostPeerId) return;
      if (env.type === MSG.SNAPSHOT && env.seq > lastSnapshotSeq) {
        lastSnapshotSeq = env.seq;
        applyAuthoritativeSnapshot(env.payload);
      }
    });

    rxInput((env, peerId) => {
      if (!env || mode !== 'HOST' || !matchStarted) return;
      const peer = peers.get(peerId);
      if (peer && env.type === MSG.INPUT && env.payload) {
        peer.lastInput = {
          mx: Math.max(-1, Math.min(1, Number(env.payload.mx) || 0)),
          my: Math.max(-1, Math.min(1, Number(env.payload.my) || 0)),
          sprint: Boolean(env.payload.sprint),
          facing: Number(env.payload.facing) || 0,
        };
        peer.lastInputAt = performance.now();
      }
    });

    rxCmd((env, peerId) => {
      if (!env || mode !== 'HOST' || !matchStarted) return;
      const peer = peers.get(peerId);
      if (peer && peer.faction && env.type === MSG.CMD) {
        dispatchCommand(peer.faction, env.payload);
      }
    });

    rxEvent((env, peerId) => {
      if (!env || mode !== 'JOIN' || !matchStarted) return;
      if (hostPeerId && peerId !== hostPeerId) return;
      if (env.type === MSG.EVENT && env.payload?.kind === EVENT_KIND.SHOT) {
        const { x1, y1, x2, y2, color } = env.payload;
        bulletTracers.push({ x1, y1, x2, y2, color, life: 0.16, maxLife: 0.16 });
        sfx.playGunshot(x1, y1);
      }
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
      peers.clear();
      peers.set(selfPeerId, {
        peerId: selfPeerId,
        name: hostName,
        faction: Faction.PLAYER,
        slotIdx: 0,
        isHost: true,
        lastInput: { mx: 0, my: 0, sprint: false, facing: 0 },
        lastInputAt: 0,
      });

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
      hostPeerId = '';

      const activeRoom = await connectSignalingRoom(roomCode, roomSecret);
      room = activeRoom;
      selfPeerId = activeRoom.selfId;
      attachSignalingErrorHandler(activeRoom, statusEl, errEl);
      setupChannels(activeRoom);

      const rawName = document.getElementById('mp-guest-name')?.value?.trim();
      const guestName = rawName ? rawName.slice(0, 16) : 'Guest Boss';

      // Announce presence to host immediately and retry briefly if peer discovery is still settling
      let helloAttempts = 0;
      const sendHelloOnce = () => {
        if (mode !== 'JOIN' || !room || hostPeerId) return;
        helloAttempts++;
        sendLobby(envelope(MSG.HELLO, helloAttempts, { name: guestName }));
        if (helloAttempts < 6) {
          setTimeout(sendHelloOnce, 800);
        }
      };
      setTimeout(sendHelloOnce, 180);
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
    if (mode !== 'HOST' || !room) return;
    reassignHostSeats({ peers, selfPeerId, config: getCurrentHostConfig(), slotClosedAsAI });
    const worldSeed = seedOverride ?? randomWorldSeed();
    localFaction = Faction.PLAYER;
    matchStarted = true;
    snapshotSeq = 0;
    snapshotTimer = 0;

    initWorld(gridSize, true, tickSeconds, incomeTier, factionCount, orgRoster, worldSeed);

    const badge = document.getElementById('mp-hud-badge');
    badge.textContent = `MP HOST (${roomCode})`;
    badge.classList.remove('hidden');

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
    for (const p of peers.values()) {
      if (!p.isHost && p.faction && sendInit) {
        sendInit(
          envelope(MSG.INIT_MATCH, 1, {
            yourPeerId: p.peerId,
            gridSize,
            tickSeconds,
            incomeTier,
            factionCount,
            orgRoster,
            worldSeed,
            assignments,
            snapshot: initialSnapshot,
          }),
          p.peerId
        );
      }
    }
  }

  function flushGuestInput() {
    if (mode !== 'JOIN' || !matchStarted || !sendInput || !hostPeerId) return;
    let mx = 0;
    let my = 0;
    if (state.keys.has('w') || state.keys.has('arrowup')) my -= 1;
    if (state.keys.has('s') || state.keys.has('arrowdown')) my += 1;
    if (state.keys.has('a') || state.keys.has('arrowleft')) mx -= 1;
    if (state.keys.has('d') || state.keys.has('arrowright')) mx += 1;
    const sprint = state.keys.has('shift') || state.sprintButtonHeld;

    const localBoss = getLocalBoss();
    let facing = localBoss ? localBoss.facing : 0;
    if (state.mouse.inside && canvas.width > 0 && localBoss) {
      const rect = canvas.getBoundingClientRect();
      const aimWx = state.camera.x - rect.width / 2 + state.mouse.screenX;
      const aimWy = state.camera.y - rect.height / 2 + state.mouse.screenY;
      facing = Math.atan2(aimWy - localBoss.y, aimWx - localBoss.x);
    }

    guestInputSeq++;
    sendInput(envelope(MSG.INPUT, guestInputSeq, { mx, my, sprint, facing }), hostPeerId);
  }

  function sendCommand(payload) {
    if (mode !== 'JOIN' || !matchStarted || !sendCmd || !hostPeerId) return;
    guestCmdSeq++;
    sendCmd(envelope(MSG.CMD, guestCmdSeq, payload), hostPeerId);
  }

  function broadcastEvent(payload) {
    if (mode !== 'HOST' || !matchStarted || !sendEvent) return;
    sendEvent(envelope(MSG.EVENT, snapshotSeq, payload));
  }

  function updateHost(dt) {
    snapshotTimer += dt;
    if (snapshotTimer >= 0.085) {
      snapshotTimer = 0;
      snapshotSeq++;
      if (sendSnap) {
        sendSnap(envelope(MSG.SNAPSHOT, snapshotSeq, encodeSnapshot(state)));
      }
    }
  }

  function updateGuest(dt) {
    inputSendTimer += dt;
    if (inputSendTimer >= 0.06) {
      inputSendTimer = 0;
      flushGuestInput();
    }
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
    peers.clear();
    sendLobby = null;
    sendInit = null;
    sendSnap = null;
    sendInput = null;
    sendCmd = null;
    sendEvent = null;
    matchStarted = false;
    isJoining = false;
    hostPeerId = '';
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

  return {
    get mode() { return mode; },
    get localFaction() { return localFaction; },
    isActive: () => mode !== 'SINGLE' && matchStarted,
    isHost: () => mode === 'HOST' && matchStarted,
    isGuest: () => mode === 'JOIN' && matchStarted,
    isHumanFaction: (f) => {
      if (f === Faction.PLAYER) return true;
      if (mode === 'HOST') {
        for (const p of peers.values()) {
          if (p.faction === f) return true;
        }
      } else if (mode === 'JOIN') {
        return guestLobbyRoster.some((p) => p.faction === f && !p.isAI);
      }
      return false;
    },
    getPeerForFaction: (f) => {
      for (const p of peers.values()) {
        if (p.faction === f && !p.isHost) return p.peerId;
      }
      return null;
    },
    getAliasForFaction: (f) => {
      if (mode === 'HOST') {
        for (const p of peers.values()) {
          if (p.faction === f) return p.name;
        }
      } else if (mode === 'JOIN') {
        const entry = guestLobbyRoster.find((p) => p.faction === f && !p.isAI);
        if (entry) return entry.name;
      }
      return null;
    },
    getPeerInput: (peerId) => {
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
        };
      }
      return peer.lastInput;
    },
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

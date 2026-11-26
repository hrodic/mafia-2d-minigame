// Host-authoritative multiplayer: transport, lobby, snapshots, guest input and
// action commands. The IIFE keeps the original module structure for Phase 1;
// Phase 4 splits it into transport/protocol/lobby/host/guest modules.

import { Faction, UnitRank } from '../config/enums.js';
import { GAME_VERSION } from '../config/version.js';
import { RANK_STATS } from '../config/balance.js';
import { ORGANIZATIONS, FACTION_META, ensureUniqueOrgs, getActiveFactionSlots } from '../config/organizations.js';
import { state, getLocalBoss } from '../core/state.js';
import { randomWorldSeed } from '../core/rng.js';
import { initWorld } from '../sim/match.js';
import { eliminateFaction } from '../sim/territory.js';
import { getEntityCollisionRadius } from '../sim/movement.js';
import { getUnitCaps } from '../sim/units.js';
import {
  executeBossSlashForFaction,
  performBossPistolShot,
  executeBuyArmorForFaction,
} from '../sim/combat.js';
import { spawnDeadBody, bulletTracers } from '../render/effects.js';
import { canvas } from '../render/canvas.js';
import { sfx } from '../audio/sfx.js';
import { showToast } from '../ui/menus.js';


export const mpNet = (() => {
  const APP_ID = 'hrodic-mafia-2d-p2p-v26';
  const TRYSTERO_URLS = [
    'https://esm.sh/@trystero-p2p/nostr@0.27.0?bundle',
    'https://esm.sh/@trystero-p2p/mqtt@0.27.0?bundle',
    'https://cdn.jsdelivr.net/npm/@trystero-p2p/nostr@0.27.0/+esm',
  ];

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

  function randomToken(len = 8) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < len; i++) {
      out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
  }

  function envelope(type, seq, payload) {
    return { v: GAME_VERSION, type, seq, payload };
  }

  function getCurrentHostConfig() {
    return {
      gridSize: Number(document.getElementById('map-size-slider')?.value || 15),
      tickSeconds: Number(document.getElementById('tick-speed-slider')?.value || 10),
      incomeTier: state.currentIncomeTier,
      factionCount: state.activeFactionCount,
      orgRoster: ensureUniqueOrgs(state.selectedFactionOrgs),
    };
  }

  // CSP-Safe Same-Origin BroadcastChannel + localStorage Room Transport
  function createLocalBusRoom(fullRoomId) {
    const channelName = `hrodic_mp_${fullRoomId}`;
    const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(channelName) : null;
    const myId = `TAB_${randomToken(10)}`;
    const mountTs = Date.now();
    const actionHandlers = new Map();
    const joinHandlers = [];
    const leaveHandlers = [];
    const knownTabs = new Set();

    function dispatchIncoming(raw) {
      if (!raw || raw.sender === myId) return;
      if (raw.ts && raw.ts < mountTs - 2000) return;
      if (raw.target && raw.target !== myId) return;

      if (!knownTabs.has(raw.sender)) {
        knownTabs.add(raw.sender);
        joinHandlers.forEach((cb) => cb(raw.sender));
      }

      if (raw.sys === 'PING') {
        postPacket({ sys: 'PONG', target: raw.sender });
        return;
      }
      if (raw.sys === 'LEAVE') {
        knownTabs.delete(raw.sender);
        leaveHandlers.forEach((cb) => cb(raw.sender));
        return;
      }
      if (raw.ns && actionHandlers.has(raw.ns)) {
        actionHandlers.get(raw.ns).forEach((cb) => cb(raw.data, raw.sender));
      }
    }

    function postPacket(pkt) {
      const full = { ...pkt, sender: myId, ts: Date.now() };
      if (bc) {
        try { bc.postMessage(full); } catch (_) {}
      }
      try {
        localStorage.setItem(`${channelName}_pkt`, JSON.stringify({ ...full, nonce: Math.random() }));
      } catch (_) {}
    }

    if (bc) {
      bc.onmessage = (e) => dispatchIncoming(e.data);
    }
    const onStorage = (e) => {
      if (e.key === `${channelName}_pkt` && e.newValue) {
        try { dispatchIncoming(JSON.parse(e.newValue)); } catch (_) {}
      }
    };
    window.addEventListener('storage', onStorage);

    const onUnload = () => postPacket({ sys: 'LEAVE' });
    window.addEventListener('beforeunload', onUnload);

    setTimeout(() => postPacket({ sys: 'PING' }), 60);

    return {
      selfId: myId,
      makeAction(ns) {
        if (!actionHandlers.has(ns)) actionHandlers.set(ns, []);
        const sendFn = (data, targetPeer = null) => {
          postPacket({ ns, data, target: typeof targetPeer === 'string' ? targetPeer : null });
        };
        const recvFn = (cb) => {
          actionHandlers.get(ns).push(cb);
        };
        return [sendFn, recvFn];
      },
      onPeerJoin(cb) {
        joinHandlers.push(cb);
        knownTabs.forEach((id) => cb(id));
      },
      onPeerLeave(cb) {
        leaveHandlers.push(cb);
      },
      leave() {
        postPacket({ sys: 'LEAVE' });
        window.removeEventListener('storage', onStorage);
        window.removeEventListener('beforeunload', onUnload);
        if (bc) {
          try { bc.close(); } catch (_) {}
        }
      },
    };
  }

  async function connectSignalingRoom(code, secret) {
    const fullRoomId = `${APP_ID}-${code}-${secret}`;
    const isEmbeddedSandbox = window.self !== window.top;

    if (!isEmbeddedSandbox) {
      for (const url of TRYSTERO_URLS) {
        try {
          const mod = await Promise.race([
            import(url),
            new Promise((_, rej) => setTimeout(() => rej(new Error('Signaling CDN timeout')), 6500)),
          ]);
          const joinFn = mod.joinRoom || mod.default?.joinRoom;
          if (typeof joinFn === 'function') {
            const rtcRoom = joinFn({ appId: APP_ID, password: secret }, fullRoomId);
            selfPeerId = typeof mod.selfId === 'string' ? mod.selfId : `RTC_${randomToken(10)}`;
            return rtcRoom;
          }
        } catch (_) {
          // Fallback to next strategy or local bus
        }
      }
    }

    const localRoom = createLocalBusRoom(fullRoomId);
    selfPeerId = localRoom.selfId;
    return localRoom;
  }

  function reassignHostSeats() {
    const cfg = getCurrentHostConfig();
    const slots = getActiveFactionSlots(cfg.factionCount);

    for (let i = 1; i < 4; i++) {
      if (i >= cfg.factionCount) slotClosedAsAI[i] = false;
    }

    const hostPeer = peers.get(selfPeerId);
    if (hostPeer) {
      hostPeer.faction = slots[0];
      hostPeer.slotIdx = 0;
    }

    const guestPeers = Array.from(peers.values()).filter((p) => !p.isHost);
    const availableSlotIndices = [];
    for (let idx = 1; idx < cfg.factionCount; idx++) {
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
  }

  function getOpenHumanCapacity() {
    const cfg = getCurrentHostConfig();
    let open = 1; // Host
    for (let idx = 1; idx < cfg.factionCount; idx++) {
      if (!slotClosedAsAI[idx]) open++;
    }
    return open;
  }

  function updateHostLobbyUI() {
    if (mode !== 'HOST') return;
    reassignHostSeats();
    const cfg = getCurrentHostConfig();
    const slots = getActiveFactionSlots(cfg.factionCount);
    const rosterEl = document.getElementById('mp-host-roster');
    const countEl = document.getElementById('mp-host-player-count');
    const startBtn = document.getElementById('btn-start-game');

    const seatedPeers = Array.from(peers.values()).filter((p) => p.faction !== null);
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
    const openHumans = getOpenHumanCapacity();
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

    const me =
      guestLobbyRoster.find((p) => p.peerId === selfPeerId) ||
      guestLobbyRoster.find((p) => !p.isHost && !p.isAI);
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

  function buildLobbyRosterSnapshot(cfg) {
    const slots = getActiveFactionSlots(cfg.factionCount);
    const seatedPeers = Array.from(peers.values()).filter((p) => p.faction !== null);
    const roster = [];
    for (let idx = 0; idx < cfg.factionCount; idx++) {
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
        const org = ORGANIZATIONS[cfg.orgRoster[idx]];
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

  function broadcastHostLobbyState() {
    if (!room || mode !== 'HOST' || !sendLobby) return;
    reassignHostSeats();
    const cfg = getCurrentHostConfig();
    const roster = buildLobbyRosterSnapshot(cfg);
    sendLobby(envelope('LOBBY_STATE', 0, { roster, settings: cfg }));
  }

  function sendLobbyStateToPeer(targetPeerId) {
    if (!room || mode !== 'HOST' || !sendLobby) return;
    reassignHostSeats();
    const cfg = getCurrentHostConfig();
    const roster = buildLobbyRosterSnapshot(cfg);
    sendLobby(
      envelope('LOBBY_STATE', 0, {
        yourPeerId: targetPeerId,
        roster,
        settings: cfg,
      }),
      targetPeerId
    );
  }

  function processRemoteCommand(peer, payload) {
    if (!peer || !peer.faction || !payload || !matchStarted) return;
    const fac = peer.faction;

    if (payload.cmd === 'MOVE_TO') {
      const bossNpc = state.npcs.find((n) => n.faction === fac && n.rank === UnitRank.BOSS);
      if (bossNpc && typeof payload.x === 'number' && typeof payload.y === 'number') {
        const snapped = state.world.findNearestWalkablePoint(payload.x, payload.y, 12);
        if (snapped) {
          bossNpc.targetX = snapped.x;
          bossNpc.targetY = snapped.y;
        }
      }
    } else if (payload.cmd === 'SLASH') {
      executeBossSlashForFaction(fac);
    } else if (payload.cmd === 'SHOOT') {
      const bossNpc = state.npcs.find((n) => n.faction === fac && n.rank === UnitRank.BOSS);
      if (bossNpc && typeof payload.tx === 'number' && typeof payload.ty === 'number') {
        performBossPistolShot(bossNpc, false, payload.tx, payload.ty);
      }
    } else if (payload.cmd === 'BUY_ARMOR') {
      executeBuyArmorForFaction(fac);
    } else if (payload.cmd === 'RECRUIT_PREF') {
      const prefs = state.factionRecruitmentPrefs[fac];
      if (prefs) {
        if (typeof payload.autoSoldier === 'boolean') prefs.autoSoldier = payload.autoSoldier;
        if (typeof payload.autoCaptain === 'boolean') prefs.autoCaptain = payload.autoCaptain;
        if (typeof payload.autoUnderboss === 'boolean') prefs.autoUnderboss = payload.autoUnderboss;
        if (payload.caps && typeof payload.caps === 'object') {
          const { maxSoldiers, maxCaptains, maxUnderbosses } = getUnitCaps();
          if (typeof payload.caps[UnitRank.SOLDIER] === 'number') {
            prefs.caps[UnitRank.SOLDIER] = Math.max(1, Math.min(maxSoldiers, payload.caps[UnitRank.SOLDIER]));
          }
          if (typeof payload.caps[UnitRank.CAPTAIN] === 'number') {
            prefs.caps[UnitRank.CAPTAIN] = Math.max(1, Math.min(maxCaptains, payload.caps[UnitRank.CAPTAIN]));
          }
          if (typeof payload.caps[UnitRank.UNDERBOSS] === 'number') {
            prefs.caps[UnitRank.UNDERBOSS] = Math.max(1, Math.min(maxUnderbosses, payload.caps[UnitRank.UNDERBOSS]));
          }
        }
      }
    }
  }

  function buildSnapshotPayload() {
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

  function applyAuthoritativeSnapshot(snap) {
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
        seenIds.add(id);
        const stats = RANK_STATS[rank] || RANK_STATS[UnitRank.SOLDIER];
        const isHumanBoss = rank === UnitRank.BOSS && Boolean(hPeer);
        let unit = state.npcs.find((n) => n.id === id);
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
          sendLobby(envelope('HELLO', 0, { name: guestName }), peerId);
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
              reassignHostSeats();
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
        if (env.type === 'HELLO') {
          if (env.v !== GAME_VERSION) {
            sendLobby(envelope('REJECT', 0, { reason: `Version mismatch (Host is ${GAME_VERSION})` }), peerId);
            return;
          }
          if (matchStarted) {
            sendLobby(envelope('REJECT', 0, { reason: 'Match already in progress' }), peerId);
            return;
          }
          if (peers.has(peerId)) {
            sendLobbyStateToPeer(peerId);
            return;
          }
          reassignHostSeats();
          const openCapacity = getOpenHumanCapacity();
          if (peers.size >= openCapacity) {
            sendLobby(envelope('REJECT', 0, { reason: 'Lobby is full' }), peerId);
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
          reassignHostSeats();
          updateHostLobbyUI();
          sendLobbyStateToPeer(peerId);
          broadcastHostLobbyState();
          showToast(`${guestName} joined the lobby!`);
        }
      } else if (mode === 'JOIN') {
        if (!hostPeerId) hostPeerId = peerId;
        if (env.type === 'REJECT') {
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
        if (env.type === 'LOBBY_STATE') {
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
      if (env.type === 'INIT_MATCH') {
        hostPeerId = peerId;
        applyInitialMatchState(env.payload);
      }
    });

    rxSnap((env, peerId) => {
      if (!env || mode !== 'JOIN' || !matchStarted) return;
      if (hostPeerId && peerId !== hostPeerId) return;
      if (env.type === 'SNAPSHOT' && env.seq > lastSnapshotSeq) {
        lastSnapshotSeq = env.seq;
        applyAuthoritativeSnapshot(env.payload);
      }
    });

    rxInput((env, peerId) => {
      if (!env || mode !== 'HOST' || !matchStarted) return;
      const peer = peers.get(peerId);
      if (peer && env.type === 'INPUT' && env.payload) {
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
      if (peer && env.type === 'CMD') {
        processRemoteCommand(peer, env.payload);
      }
    });

    rxEvent((env, peerId) => {
      if (!env || mode !== 'JOIN' || !matchStarted) return;
      if (hostPeerId && peerId !== hostPeerId) return;
      if (env.type === 'EVENT' && env.payload?.kind === 'SHOT') {
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
      setupChannels(activeRoom);

      const rawName = document.getElementById('mp-guest-name')?.value?.trim();
      const guestName = rawName ? rawName.slice(0, 16) : 'Guest Boss';

      // Announce presence to host immediately and retry briefly if peer discovery is still settling
      let helloAttempts = 0;
      const sendHelloOnce = () => {
        if (mode !== 'JOIN' || !room || hostPeerId) return;
        helloAttempts++;
        sendLobby(envelope('HELLO', helloAttempts, { name: guestName }));
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
    reassignHostSeats();
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

    const initialSnapshot = buildSnapshotPayload();
    for (const p of peers.values()) {
      if (!p.isHost && p.faction && sendInit) {
        sendInit(
          envelope('INIT_MATCH', 1, {
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
    sendInput(envelope('INPUT', guestInputSeq, { mx, my, sprint, facing }), hostPeerId);
  }

  function sendCommand(payload) {
    if (mode !== 'JOIN' || !matchStarted || !sendCmd || !hostPeerId) return;
    guestCmdSeq++;
    sendCmd(envelope('CMD', guestCmdSeq, payload), hostPeerId);
  }

  function broadcastEvent(payload) {
    if (mode !== 'HOST' || !matchStarted || !sendEvent) return;
    sendEvent(envelope('EVENT', snapshotSeq, payload));
  }

  function updateHost(dt) {
    snapshotTimer += dt;
    if (snapshotTimer >= 0.085) {
      snapshotTimer = 0;
      snapshotSeq++;
      if (sendSnap) {
        sendSnap(envelope('SNAPSHOT', snapshotSeq, buildSnapshotPayload()));
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

// Extracted modules (Phase 1). Game logic still lives in this file; imports grow as
// each subsystem is moved out.
import {
  CHUNK_SIZE,
  TILE_SIZE,
  CHUNK_PX,
  DEFAULT_GRID_SIZE,
  DEFAULT_TICK_DURATION,
  MAX_PISTOL_RANGE,
  SPRINT_MAX_DURATION,
  SPRINT_COOLDOWN_DURATION,
  SPRINT_SPEED_MULTIPLIER,
} from './config/constants.js';
import {
  INCOME_TIERS,
  COST_SOLDIER,
  COST_CAPTAIN,
  COST_UNDERBOSS,
  COST_BOSS_ARMOR,
  BOSS_MAX_HP,
  MAX_BOSS_ARMOR,
  UPKEEP_SOLDIER,
  UPKEEP_CAPTAIN,
  UPKEEP_UNDERBOSS,
  UNIT_ATTACK_COOLDOWN,
} from './config/balance.js';
import { TileType, PropType, Faction, UnitRank } from './config/enums.js';
import {
  ORGANIZATIONS,
  ALL_ORG_IDS,
  FACTION_META,
  ALL_FACTION_SLOTS,
  ensureUniqueOrgs,
} from './config/organizations.js';
import { createMulberry32, hashChunkSeed, withSeed } from './core/rng.js';
import { state, getLocalFaction, getLocalBoss, isLocalBossAlive } from './core/state.js';
import { CityMap, packChunkKey } from './world/city.js';
import { computeTilePath, MAX_ASTAR_PER_FRAME } from './world/pathfinding.js';
import { rebuildSpatialBuckets } from './core/spatial.js';
import { stepGuestPresentation } from './render/interpolation.js';
import { canvas, ctx, minimapCanvas, minimapCtx } from './render/canvas.js';
import { render, resizeCanvas } from './render/renderer.js';
import { ensureAudioContext, getAudioCtx, isSoundEnabled, setSoundEnabled, cycleMusicTrack } from './audio/engine.js';
import { sfx } from './audio/sfx.js';
import {
  bloodParticles,
  bloodDecals,
  bulletTracers,
  shellCasings,
  sparks,
  slashArcs,
  muzzleFlashes,
  deadBodies,
  spawnBloodSplash,
  spawnDeadBody,
  spawnSlashArc,
  spawnMuzzleFlash,
  spawnSparks,
  addFloatingText,
  updateVisualParticles,
  resetEffects,
} from './render/effects.js';
import {
  getEntityCollisionRadius,
  canOccupyPosition,
  isPushingFriendly,
  updateNpcBossSprint,
  updateHumanControlledRivalBoss,
} from './sim/movement.js';
import {
  getUnitCaps,
  resetDefaultPlayerSpawnCaps,
  clampPlayerSpawnCaps,
  spawnUnitInChunk,
  recruitUnit,
} from './sim/units.js';
import { runtime } from './core/runtime.js';
import { calculateFactionUpkeep, recalculateHourlyIncome, processHourlyTick } from './sim/economy.js';
import { progressCapture, getCaptureRate, onChunkCaptured, eliminateFaction } from './sim/territory.js';
import {
  rollDamage,
  applyDamageToNpc,
  executeBossSlashForFaction,
  performKnifeSlash,
  performBossKnifeSlash,
  getPistolAccuracyInfo,
  performBossPistolShot,
  damagePlayerBoss,
  executeBuyArmorForFaction,
  buyBossArmor,
  tryBuyNpcBossArmor,
} from './sim/combat.js';
import { initWorld } from './sim/match.js';
import { update } from './sim/simulation.js';


    // =========================================================================
    // 3. GAME STATE HELPERS (shared state object lives in core/state.js)
    // =========================================================================




    // =========================================================================


    // =========================================================================
    // 6. GAME STATE, ENTITIES, LOCAL FACTION ABSTRACTION & COLLISION SOLVER
    // =========================================================================
    state.world = new CityMap();



    const hudEls = {
      statsBadge: document.getElementById('stats-badge'),
      hpBarFill: document.getElementById('hp-bar-fill'),
      hpText: document.getElementById('hp-text'),
      cashText: document.getElementById('cash-text'),
      hourText: document.getElementById('hour-text'),
      tickBarFill: document.getElementById('tick-bar-fill'),
      armorBtn: document.getElementById('btn-buy-armor'),
      armorBox: document.getElementById('armor-hud-box'),
      armorBarFill: document.getElementById('armor-bar-fill'),
      armorText: document.getElementById('armor-text'),
      sprintBar: document.getElementById('sprint-bar-fill'),
      sprintText: document.getElementById('sprint-text'),
      factionBoard: document.getElementById('faction-board'),
      minimapCoords: document.getElementById('minimap-coords'),
    };





    let toastTimeout = null;
    function showToast(msg) {
      const el = document.getElementById('toast');
      el.textContent = msg;
      el.style.opacity = '1';
      clearTimeout(toastTimeout);
      toastTimeout = setTimeout(() => {
        el.style.opacity = '0';
      }, 2400);
    }





    function syncRecruitButtonLabels() {
      clampPlayerSpawnCaps();
      const myFac = getLocalFaction();
      const { maxSoldiers, maxCaptains, maxUnderbosses } = getUnitCaps();
      const pRanks = FACTION_META[myFac].ranks;
      const btnS = document.getElementById('btn-toggle-soldier');
      const btnC = document.getElementById('btn-toggle-captain');
      const btnU = document.getElementById('btn-toggle-underboss');
      btnS.textContent = `Auto ${pRanks.SOLDIER}: ${state.autoRecruitSoldier ? 'ON' : 'OFF'} ($${COST_SOLDIER.toLocaleString()})`;
      btnC.textContent = `Auto ${pRanks.CAPTAIN}: ${state.autoRecruitCaptain ? 'ON' : 'OFF'} ($${COST_CAPTAIN.toLocaleString()})`;
      btnU.textContent = `Auto ${pRanks.UNDERBOSS}: ${state.autoRecruitUnderboss ? 'ON' : 'OFF'} ($${COST_UNDERBOSS.toLocaleString()})`;

      document.getElementById('cap-soldier-label').textContent =
        `${state.playerSpawnCaps[UnitRank.SOLDIER]}/${maxSoldiers}`;
      document.getElementById('cap-captain-label').textContent =
        `${state.playerSpawnCaps[UnitRank.CAPTAIN]}/${maxCaptains}`;
      document.getElementById('cap-underboss-label').textContent =
        `${state.playerSpawnCaps[UnitRank.UNDERBOSS]}/${maxUnderbosses}`;
    }



    // =========================================================================
    // 8. BOSS ARMOR, SMART NPC BOSS UPGRADES & INPUT HANDLING
    // =========================================================================



    window.addEventListener('keydown', (e) => {
      getAudioCtx();
      const k = e.key.toLowerCase();
      const wasDown = state.keys.has(k);
      state.keys.add(k);
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) {
        e.preventDefault();
      }
      if (!wasDown && typeof mpNet !== 'undefined' && mpNet.isGuest()) {
        if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(k)) {
          mpNet.flushGuestInput();
        }
      }
      if (k === ' ' || k === 'f') performKnifeSlash();
      if (k === 'q') buyBossArmor();
    });
    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      state.keys.delete(k);
      if (typeof mpNet !== 'undefined' && mpNet.isGuest()) {
        if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(k)) {
          mpNet.flushGuestInput();
        }
      }
    });

    // Losing focus can swallow keyup events; clear held keys and send a stop so the
    // guest boss never keeps walking into a wall after alt-tab/HUD clicks.
    function releaseAllKeys() {
      if (state.keys.size === 0) return;
      state.keys.clear();
      if (typeof mpNet !== 'undefined' && mpNet.isGuest()) {
        mpNet.flushGuestInput();
      }
    }
    window.addEventListener('blur', releaseAllKeys);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) releaseAllKeys();
    });

    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      state.mouse.screenX = e.clientX - rect.left;
      state.mouse.screenY = e.clientY - rect.top;
      state.mouse.inside = true;
    });

    canvas.addEventListener('mouseleave', () => {
      state.mouse.inside = false;
    });

    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    function screenToWorld(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const sx = clientX - rect.left;
      const sy = clientY - rect.top;
      return {
        wx: state.camera.x - rect.width / 2 + sx,
        wy: state.camera.y - rect.height / 2 + sy,
      };
    }

    canvas.addEventListener('mousedown', (e) => {
      getAudioCtx();
      if (!state.gameStarted) return;
      const { wx, wy } = screenToWorld(e.clientX, e.clientY);

      if (e.button === 2) {
        if (typeof mpNet !== 'undefined' && mpNet.isGuest()) {
          if (isLocalBossAlive()) {
            mpNet.sendCommand({ cmd: 'SHOOT', tx: wx, ty: wy });
          }
          return;
        }
        if (state.player.alive && !state.gameOver) {
          performBossPistolShot(state.player, true, wx, wy);
        }
        return;
      }

      if (e.button !== 0) return;

      const { cx, cy } = state.world.worldToTile(wx, wy);
      const chunk = state.world.getChunk(cx, cy);

      if (!chunk) {
        if (state.allowClickExpand) {
          if (typeof mpNet !== 'undefined' && mpNet.isGuest()) {
            mpNet.sendCommand({ cmd: 'BUILD_BLOCK', cx, cy });
            return;
          }
          const myFac = getLocalFaction();
          const newChunk = state.world.generateChunk(cx, cy, myFac);
          addFloatingText(
            newChunk.cx * CHUNK_PX + CHUNK_PX / 2,
            newChunk.cy * CHUNK_PX + CHUNK_PX / 2,
            `NEW BLOCK (${newChunk.incomeLabel})`,
            FACTION_META[myFac].accent
          );
          updateHUD();
        } else {
          showToast('Enable "Click-Build" or use "+ Expand Ring" to add blocks');
        }
        return;
      }

      if (typeof mpNet !== 'undefined' && mpNet.isGuest()) {
        if (!isLocalBossAlive()) {
          state.camera.x = wx;
          state.camera.y = wy;
          return;
        }
        const snapped = state.world.findNearestWalkablePoint(wx, wy, 12);
        if (snapped) {
          mpNet.sendCommand({ cmd: 'MOVE_TO', x: snapped.x, y: snapped.y });
        }
        return;
      }

      if (state.gameOver || !state.player.alive) {
        state.camera.x = wx;
        state.camera.y = wy;
        return;
      }

      const snapped = state.world.findNearestWalkablePoint(wx, wy, 12);
      if (snapped) {
        state.player.targetX = snapped.x;
        state.player.targetY = snapped.y;
      } else {
        showToast('Blocked by building');
      }
    });

    minimapCanvas.addEventListener('click', (e) => {
      getAudioCtx();
      if (!state.gameStarted || state.world.chunks.size === 0) return;
      const rect = minimapCanvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      let minCx = Infinity, maxCx = -Infinity, minCy = Infinity, maxCy = -Infinity;
      for (const chunk of state.world.chunks.values()) {
        if (chunk.cx < minCx) minCx = chunk.cx;
        if (chunk.cx > maxCx) maxCx = chunk.cx;
        if (chunk.cy < minCy) minCy = chunk.cy;
        if (chunk.cy > maxCy) maxCy = chunk.cy;
      }
      const cols = Math.max(1, maxCx - minCx + 1);
      const rows = Math.max(1, maxCy - minCy + 1);
      const pad = 6;
      const innerW = minimapCanvas.width - pad * 2;
      const innerH = minimapCanvas.height - pad * 2;
      const cellSize = Math.min(innerW / cols, innerH / rows);
      const offsetX = pad + (innerW - cellSize * cols) / 2;
      const offsetY = pad + (innerH - cellSize * rows) / 2;

      const worldX = (minCx + (mx - offsetX) / cellSize) * CHUNK_PX;
      const worldY = (minCy + (my - offsetY) / cellSize) * CHUNK_PX;

      if (typeof mpNet !== 'undefined' && mpNet.isGuest()) {
        if (!isLocalBossAlive()) {
          state.camera.x = worldX;
          state.camera.y = worldY;
          return;
        }
        const snapped = state.world.findNearestWalkablePoint(worldX, worldY, 12);
        if (snapped) {
          mpNet.sendCommand({ cmd: 'MOVE_TO', x: snapped.x, y: snapped.y });
          showToast('Boss waypoint set via Radar');
        }
        return;
      }

      if (state.gameOver || !state.player.alive) {
        state.camera.x = worldX;
        state.camera.y = worldY;
        return;
      }

      const snapped = state.world.findNearestWalkablePoint(worldX, worldY, 12);
      if (snapped) {
        state.player.targetX = snapped.x;
        state.player.targetY = snapped.y;
        showToast('Boss waypoint set via Radar');
      }
    });



    function updateHUD() {
      const myFac = getLocalFaction();
      const myBoss = getLocalBoss();
      const myAlive = isLocalBossAlive();

      const hpVal = myAlive ? Math.max(0, Math.round(myBoss.hp)) : 0;
      const maxHpVal = myBoss.maxHp || BOSS_MAX_HP;
      hudEls.hpBarFill.style.width = `${Math.round((hpVal / maxHpVal) * 100)}%`;
      hudEls.hpText.textContent = `${hpVal}/${maxHpVal}`;

      const armorVal = myAlive ? Math.max(0, Math.round(myBoss.armor || 0)) : 0;
      if (armorVal > 0) {
        hudEls.armorBox.classList.remove('hidden');
        hudEls.armorBox.classList.add('flex');
        hudEls.armorBarFill.style.width = `${Math.round((armorVal / MAX_BOSS_ARMOR) * 100)}%`;
        hudEls.armorText.textContent = `${armorVal}`;
      } else {
        hudEls.armorBox.classList.add('hidden');
        hudEls.armorBox.classList.remove('flex');
      }

      const myCash = state.treasuries[myFac] || 0;
      hudEls.cashText.textContent = `$${myCash.toLocaleString()}`;

      if (myBoss.sprintCooldown > 0) {
        const pct = Math.round(((SPRINT_COOLDOWN_DURATION - myBoss.sprintCooldown) / SPRINT_COOLDOWN_DURATION) * 100);
        hudEls.sprintBar.style.width = `${pct}%`;
        hudEls.sprintText.textContent = `${myBoss.sprintCooldown.toFixed(1)}s`;
      } else if (myBoss.isSprinting) {
        const pct = Math.round(((SPRINT_MAX_DURATION - myBoss.sprintTimer) / SPRINT_MAX_DURATION) * 100);
        hudEls.sprintBar.style.width = `${pct}%`;
        hudEls.sprintText.textContent = 'RUN';
      } else {
        hudEls.sprintBar.style.width = '100%';
        hudEls.sprintText.textContent = 'RDY';
      }

      const hourStr = String(state.gameHour).padStart(2, '0') + ':00';
      hudEls.hourText.textContent = hourStr;
      hudEls.tickBarFill.style.width = `${Math.min(100, Math.round((state.tickTimer / state.tickDuration) * 100))}%`;

      const incomeTotals = recalculateHourlyIncome();
      const upkeepTotals = calculateFactionUpkeep();
      const blockCounts = {
        [Faction.PLAYER]: 0,
        [Faction.RIVAL_1]: 0,
        [Faction.RIVAL_2]: 0,
        [Faction.RIVAL_3]: 0,
      };
      const crewCounts = {
        [Faction.PLAYER]: 0,
        [Faction.RIVAL_1]: 0,
        [Faction.RIVAL_2]: 0,
        [Faction.RIVAL_3]: 0,
      };

      for (const chunk of state.world.chunks.values()) {
        if (blockCounts[chunk.faction] !== undefined) blockCounts[chunk.faction]++;
      }
      for (let i = 0; i < state.npcs.length; i++) {
        const u = state.npcs[i];
        if (crewCounts[u.faction] !== undefined) crewCounts[u.faction]++;
      }
      if (state.player.alive) crewCounts[Faction.PLAYER]++;

      const totalBlocks = Math.max(1, state.world.chunks.size);
      const myNetIncome = (incomeTotals[myFac] || 0) - (upkeepTotals[myFac] || 0);
      hudEls.statsBadge.textContent = `Turf: ${blockCounts[myFac] || 0}/${totalBlocks} | Crew: ${crewCounts[myFac] || 0} | Net: ${myNetIncome >= 0 ? '+' : ''}$${myNetIncome.toLocaleString()}/hr`;

      let boardHtml = `<div class="text-[10px] font-bold uppercase tracking-wider text-zinc-400 border-b border-zinc-800 pb-1 flex justify-between"><span>Syndicate Standings</span><span>Turf · Crew</span></div>`;
      for (const f of state.activeFactions) {
        const meta = FACTION_META[f];
        const alive = state.factionAlive[f];
        const isMe = f === myFac;
        const alias = typeof mpNet !== 'undefined' && mpNet.isActive() ? mpNet.getAliasForFaction(f) : null;
        const displayName = alias ? `${meta.short} · ${alias}` : meta.short;
        boardHtml += `
          <div class="flex items-center justify-between gap-2 ${!alive ? 'opacity-45 line-through' : ''}">
            <div class="flex items-center gap-1.5 truncate">
              <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${meta.badge}"></span>
              <span class="font-bold truncate ${isMe ? 'text-amber-300' : 'text-zinc-200'}">${displayName}${isMe ? ' (You)' : ''}</span>
            </div>
            <span class="font-mono text-[11px] text-zinc-300 flex-shrink-0">${blockCounts[f]} · ${crewCounts[f]}</span>
          </div>
        `;
      }
      hudEls.factionBoard.innerHTML = boardHtml;
    }

    // =========================================================================
    // 11. HOST-AUTHORITATIVE WEBRTC & LOCAL MULTIPLAYER MODULE (mpNet)
    // =========================================================================
    const mpNet = (() => {
      const GAME_VERSION = 'BETA.2026.11.26';
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
      const interpTargets = new Map();

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

      function getActiveSlotsForCount(count) {
        if (count === 2) return [Faction.PLAYER, Faction.RIVAL_3];
        if (count === 3) return [Faction.PLAYER, Faction.RIVAL_1, Faction.RIVAL_2];
        return [Faction.PLAYER, Faction.RIVAL_1, Faction.RIVAL_2, Faction.RIVAL_3];
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
        const slots = getActiveSlotsForCount(cfg.factionCount);

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
        const slots = getActiveSlotsForCount(cfg.factionCount);
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
        const slots = getActiveSlotsForCount(cfg.factionCount);
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
        } else if (payload.cmd === 'EXPAND_RING') {
          if (state.factionAlive[fac]) {
            const added = state.world.expandPerimeterRing(fac);
            if (added > 0) {
              state.minimapCacheTimer = 1.0;
              showToast(`${FACTION_META[fac].short} expanded city perimeter (+${added} blocks)`);
            }
          }
        } else if (payload.cmd === 'BUILD_BLOCK') {
          if (state.factionAlive[fac] && typeof payload.cx === 'number' && typeof payload.cy === 'number') {
            if (!state.world.hasChunk(payload.cx, payload.cy)) {
              state.world.generateChunk(payload.cx, payload.cy, fac);
              state.minimapCacheTimer = 1.0;
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
                speed: 150,
                hp,
                maxHp,
                armor,
                maxArmor,
                armorCooldown: 0,
                sprintTimer: 0,
                sprintCooldown: 0,
                isSprinting: false,
                minDmg: 20,
                maxDmg: 40,
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

      function launchMultiplayerMatch(gridSize, tickSeconds, incomeTier, factionCount, orgRoster) {
        if (mode !== 'HOST' || !room) return;
        reassignHostSeats();
        const worldSeed = Math.floor(Math.random() * 2147483647) + 1;
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
        const sprint = state.keys.has('shift');

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
        interpTargets.clear();
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

    // Net bridge (Convention 2): lets core/state.js selectors see the net layer
    // without a circular import. The legacy `mpNet` guards are migrated in Step 1.10.
    state.net = mpNet;

    // Presentation hooks used by simulation modules (Phase 2 replaces this with events).
    runtime.updateHUD = updateHUD;
    runtime.showToast = showToast;
    runtime.syncRecruitButtonLabels = syncRecruitButtonLabels;
    runtime.resetMatchUI = (tickSeconds) => {
      document.getElementById('defeat-banner').classList.add('hidden');
      document.getElementById('victory-banner').classList.add('hidden');
      document.getElementById('spectator-banner').classList.add('hidden');
      document.getElementById('hour-hud-box').title =
        `Every ${tickSeconds} seconds an hour passes: blocks pay & toggled units spawn`;
    };
    runtime.onDefeat = () => {
      document.getElementById('defeat-banner').classList.remove('hidden');
    };
    runtime.onFactionEliminated = (faction) => {
      sfx.playFactionEliminated();
      const meta = FACTION_META[faction];
      showToast(`${meta.name}'s ${meta.ranks.BOSS} killed! Their turf is now Neutral.`);
    };
    runtime.onVictory = (summary) => {
      sfx.playVictory();
      document.getElementById('victory-summary').textContent = summary;
      document.getElementById('victory-banner').classList.remove('hidden');
    };

    // =========================================================================
    // 12. SETUP MODAL CONTROLS, HUD BUTTON BINDINGS & MAIN GAME LOOP
    // =========================================================================
    function renderFactionSlotsUI() {
      state.selectedFactionOrgs = ensureUniqueOrgs(state.selectedFactionOrgs);
      const container = document.getElementById('faction-slots-container');
      const seatLabels = ['Seat 1 (Host)', 'Seat 2', 'Seat 3', 'Seat 4'];
      let html = '';

      for (let i = 0; i < state.activeFactionCount; i++) {
        const currentOrgId = state.selectedFactionOrgs[i];
        const org = ORGANIZATIONS[currentOrgId];
        let optionsHtml = '';
        for (const id of ALL_ORG_IDS) {
          const o = ORGANIZATIONS[id];
          optionsHtml += `<option value="${id}" ${id === currentOrgId ? 'selected' : ''}>${o.name} (${o.ranks.BOSS})</option>`;
        }
        html += `
          <div class="flex items-center justify-between gap-2 bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5">
            <div class="flex items-center gap-2 text-[11px]">
              <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${org.badge}"></span>
              <span class="font-bold text-zinc-300">${seatLabels[i]}</span>
            </div>
            <select data-slot-idx="${i}" class="faction-org-select bg-zinc-950 border border-zinc-700 text-zinc-200 text-[11px] rounded px-2 py-1 focus:outline-none focus:border-amber-500">
              ${optionsHtml}
            </select>
          </div>
        `;
      }

      container.innerHTML = html;
      container.querySelectorAll('.faction-org-select').forEach((sel) => {
        sel.addEventListener('change', (e) => {
          const idx = Number(e.target.getAttribute('data-slot-idx'));
          const chosen = e.target.value;
          const prev = state.selectedFactionOrgs[idx];
          const conflictIdx = state.selectedFactionOrgs.findIndex((id, k) => k !== idx && id === chosen);
          if (conflictIdx !== -1) {
            state.selectedFactionOrgs[conflictIdx] = prev;
          }
          state.selectedFactionOrgs[idx] = chosen;
          renderFactionSlotsUI();
          if (mpNet.mode === 'HOST') {
            mpNet.updateHostLobbyUI();
            mpNet.broadcastHostLobbyState();
          }
        });
      });
    }

    function updateMapSizePreview(val) {
      const n = Math.max(5, Math.min(25, Number(val) || 15));
      document.getElementById('map-size-slider').value = n;
      document.getElementById('map-size-display').textContent = n === 15 ? '15×15 (Default)' : `${n}×${n}`;
      const total = n * n;
      const maxU = Math.max(1, Math.floor(total * 0.05));
      const maxC = Math.max(1, Math.floor(total * 0.10));
      const maxS = Math.max(1, total - maxC - maxU);
      document.getElementById('map-cap-preview').innerHTML = `<span>${total} Neighborhoods</span><span class="font-mono text-emerald-400">Cap: ${maxS}S · ${maxC}C · ${maxU}U</span>`;

      document.querySelectorAll('.size-preset-btn').forEach((btn) => {
        const active = Number(btn.getAttribute('data-size')) === n;
        btn.className = active
          ? 'size-preset-btn bg-amber-500/20 border border-amber-500 text-amber-300 py-1 rounded text-[11px] font-mono font-bold transition'
          : 'size-preset-btn bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 py-1 rounded text-[11px] font-mono font-bold transition';
      });
    }

    document.querySelectorAll('.game-mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        mpNet.setMode(btn.getAttribute('data-mode'));
      });
    });

    document.querySelectorAll('.fcount-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.activeFactionCount = Number(btn.getAttribute('data-fcount')) || 4;
        document.querySelectorAll('.fcount-btn').forEach((b) => {
          const active = Number(b.getAttribute('data-fcount')) === state.activeFactionCount;
          b.className = active
            ? 'fcount-btn bg-amber-500/20 border border-amber-500 text-amber-300 px-2.5 py-0.5 rounded text-[11px] font-mono font-bold transition'
            : 'fcount-btn bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 px-2.5 py-0.5 rounded text-[11px] font-mono font-bold transition';
        });
        renderFactionSlotsUI();
        if (mpNet.mode === 'HOST') {
          mpNet.updateHostLobbyUI();
          mpNet.broadcastHostLobbyState();
        }
      });
    });

    document.getElementById('map-size-slider').addEventListener('input', (e) => {
      updateMapSizePreview(e.target.value);
      if (mpNet.mode === 'HOST') mpNet.broadcastHostLobbyState();
    });

    document.querySelectorAll('.size-preset-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        updateMapSizePreview(btn.getAttribute('data-size'));
        if (mpNet.mode === 'HOST') mpNet.broadcastHostLobbyState();
      });
    });

    document.getElementById('tick-speed-slider').addEventListener('input', (e) => {
      const sec = Number(e.target.value) || 10;
      const label = sec <= 12 ? `${sec}s (Turbo)` : sec <= 22 ? `${sec}s (Normal)` : `${sec}s (Slow)`;
      document.getElementById('tick-speed-display').textContent = label;
      if (mpNet.mode === 'HOST') mpNet.broadcastHostLobbyState();
    });

    document.querySelectorAll('.income-tier-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.currentIncomeTier = btn.getAttribute('data-income') || 'HIGH';
        const tier = INCOME_TIERS[state.currentIncomeTier];
        document.getElementById('income-tier-display').textContent = `$${tier.min.toLocaleString()}–$${tier.max.toLocaleString()} / tick`;
        document.querySelectorAll('.income-tier-btn').forEach((b) => {
          const active = b.getAttribute('data-income') === state.currentIncomeTier;
          b.className = active
            ? 'income-tier-btn bg-emerald-500/20 border border-emerald-500 text-emerald-300 py-2 px-2 rounded-lg text-center transition'
            : 'income-tier-btn bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 py-2 px-2 rounded-lg text-center transition';
        });
        if (mpNet.mode === 'HOST') mpNet.broadcastHostLobbyState();
      });
    });

    document.getElementById('btn-mp-create-room').addEventListener('click', () => {
      getAudioCtx();
      mpNet.createHostRoom();
    });

    document.getElementById('btn-mp-copy-invite').addEventListener('click', () => {
      const codeText = document.getElementById('mp-room-code-display').textContent.trim();
      if (!codeText || codeText === '—') return;
      const [rCode, rSec] = codeText.split(':');
      const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(rCode)}&secret=${encodeURIComponent(rSec)}`;
      const ta = document.createElement('textarea');
      ta.value = inviteUrl;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        showToast('Invitation link copied to clipboard!');
      } catch (_) {
        showToast(`Room Code: ${codeText}`);
      }
      document.body.removeChild(ta);
    });

    document.getElementById('btn-mp-close-room').addEventListener('click', () => {
      mpNet.cleanup(false);
      document.getElementById('mp-host-status').textContent = 'Offline';
      mpNet.updateHostLobbyUI();
    });

    document.getElementById('btn-mp-join-room').addEventListener('click', () => {
      getAudioCtx();
      mpNet.joinGuestRoom();
    });

    document.getElementById('btn-mp-leave-lobby').addEventListener('click', () => {
      mpNet.cleanup(false);
      document.getElementById('mp-join-status').textContent = 'Disconnected';
    });

    document.getElementById('btn-start-game').addEventListener('click', () => {
      getAudioCtx();
      const gridSize = Number(document.getElementById('map-size-slider').value) || 15;
      const tickSeconds = Number(document.getElementById('tick-speed-slider').value) || 10;

      if (mpNet.mode === 'HOST') {
        document.getElementById('setup-modal').classList.add('hidden');
        mpNet.launchMultiplayerMatch(gridSize, tickSeconds, state.currentIncomeTier, state.activeFactionCount, state.selectedFactionOrgs);
        return;
      }

      mpNet.cleanup(true);
      document.getElementById('setup-modal').classList.add('hidden');
      initWorld(gridSize, true, tickSeconds, state.currentIncomeTier, state.activeFactionCount, state.selectedFactionOrgs, null);
    });

    // Top HUD Action Buttons
    function pushRecruitPrefsToHost() {
      if (mpNet.isGuest()) {
        mpNet.sendCommand({
          cmd: 'RECRUIT_PREF',
          autoSoldier: state.autoRecruitSoldier,
          autoCaptain: state.autoRecruitCaptain,
          autoUnderboss: state.autoRecruitUnderboss,
          caps: { ...state.playerSpawnCaps },
        });
      }
    }

    document.getElementById('btn-toggle-soldier').addEventListener('click', () => {
      state.autoRecruitSoldier = !state.autoRecruitSoldier;
      syncRecruitButtonLabels();
      pushRecruitPrefsToHost();
    });
    document.getElementById('btn-cap-soldier-dec').addEventListener('click', () => {
      state.playerSpawnCaps[UnitRank.SOLDIER]--;
      syncRecruitButtonLabels();
      pushRecruitPrefsToHost();
    });
    document.getElementById('btn-cap-soldier-inc').addEventListener('click', () => {
      state.playerSpawnCaps[UnitRank.SOLDIER]++;
      syncRecruitButtonLabels();
      pushRecruitPrefsToHost();
    });

    document.getElementById('btn-toggle-captain').addEventListener('click', () => {
      state.autoRecruitCaptain = !state.autoRecruitCaptain;
      syncRecruitButtonLabels();
      pushRecruitPrefsToHost();
    });
    document.getElementById('btn-cap-captain-dec').addEventListener('click', () => {
      state.playerSpawnCaps[UnitRank.CAPTAIN]--;
      syncRecruitButtonLabels();
      pushRecruitPrefsToHost();
    });
    document.getElementById('btn-cap-captain-inc').addEventListener('click', () => {
      state.playerSpawnCaps[UnitRank.CAPTAIN]++;
      syncRecruitButtonLabels();
      pushRecruitPrefsToHost();
    });

    document.getElementById('btn-toggle-underboss').addEventListener('click', () => {
      state.autoRecruitUnderboss = !state.autoRecruitUnderboss;
      syncRecruitButtonLabels();
      pushRecruitPrefsToHost();
    });
    document.getElementById('btn-cap-underboss-dec').addEventListener('click', () => {
      state.playerSpawnCaps[UnitRank.UNDERBOSS]--;
      syncRecruitButtonLabels();
      pushRecruitPrefsToHost();
    });
    document.getElementById('btn-cap-underboss-inc').addEventListener('click', () => {
      state.playerSpawnCaps[UnitRank.UNDERBOSS]++;
      syncRecruitButtonLabels();
      pushRecruitPrefsToHost();
    });

    document.getElementById('btn-buy-armor').addEventListener('click', () => buyBossArmor());
    document.getElementById('btn-slash').addEventListener('click', () => performKnifeSlash());
    document.getElementById('btn-pistol').addEventListener('click', () => {
      getAudioCtx();
      const myBoss = getLocalBoss();
      if (!myBoss || !isLocalBossAlive()) return;
      const tx = myBoss.x + Math.cos(myBoss.facing) * 260;
      const ty = myBoss.y + Math.sin(myBoss.facing) * 260;
      if (mpNet.isGuest()) {
        mpNet.sendCommand({ cmd: 'SHOOT', tx, ty });
      } else {
        performBossPistolShot(state.player, true, tx, ty);
      }
    });

    document.getElementById('btn-toggle-expand-click').addEventListener('click', (e) => {
      state.allowClickExpand = !state.allowClickExpand;
      e.target.textContent = `Click-Build: ${state.allowClickExpand ? 'ON' : 'OFF'}`;
    });

    document.getElementById('btn-expand-ring').addEventListener('click', () => {
      if (!state.gameStarted) return;
      if (mpNet.isGuest()) {
        mpNet.sendCommand({ cmd: 'EXPAND_RING' });
        return;
      }
      const added = state.world.expandPerimeterRing(Faction.PLAYER);
      if (added > 0) {
        state.minimapCacheTimer = 1.0;
        showToast(`Expanded city perimeter (+${added} neighborhoods)`);
        updateHUD();
      }
    });

    document.getElementById('btn-toggle-grid').addEventListener('click', (e) => {
      state.showBorders = !state.showBorders;
      e.target.textContent = `Borders: ${state.showBorders ? 'ON' : 'OFF'}`;
    });

    document.getElementById('btn-toggle-music').addEventListener('click', (e) => {
      ensureAudioContext();
      const music = cycleMusicTrack();
      e.target.textContent = !music.enabled
        ? '🎷 Music: OFF'
        : music.track === 0
        ? '🎷 Noir I: ON'
        : '🎷 Noir II: ON';
    });

    document.getElementById('btn-toggle-sound').addEventListener('click', (e) => {
      const enabled = setSoundEnabled(!isSoundEnabled());
      e.target.textContent = '🔊 SFX: ' + (enabled ? 'ON' : 'OFF');
    });

    function openSetupMenu() {
      mpNet.cleanup(true);
      mpNet.setMode('SINGLE');
      state.gameStarted = false;
      document.getElementById('defeat-banner').classList.add('hidden');
      document.getElementById('victory-banner').classList.add('hidden');
      document.getElementById('spectator-banner').classList.add('hidden');
      document.getElementById('disconnect-banner').classList.add('hidden');
      document.getElementById('setup-modal').classList.remove('hidden');
    }

    document.getElementById('btn-reset').addEventListener('click', openSetupMenu);
    document.getElementById('btn-victory-restart').addEventListener('click', openSetupMenu);
    document.getElementById('btn-restart-match').addEventListener('click', openSetupMenu);
    document.getElementById('btn-spectate-new-game').addEventListener('click', openSetupMenu);
    document.getElementById('btn-disconnect-return').addEventListener('click', openSetupMenu);

    document.getElementById('btn-victory-continue').addEventListener('click', () => {
      document.getElementById('victory-banner').classList.add('hidden');
    });

    document.getElementById('btn-spectate-match').addEventListener('click', () => {
      state.isSpectating = true;
      document.getElementById('defeat-banner').classList.add('hidden');
      document.getElementById('spectator-banner').classList.remove('hidden');
    });

    // Main RequestAnimationFrame Loop
    let lastFrameTime = performance.now();
    function gameLoop(now) {
      const dt = Math.min(0.05, Math.max(0.001, (now - lastFrameTime) / 1000));
      lastFrameTime = now;

      if (state.gameStarted) {
        update(dt);
        render();
      }

      requestAnimationFrame(gameLoop);
    }

    // Bootstrap Setup UI & Invite URL Auto-Detection
    renderFactionSlotsUI();
    updateMapSizePreview(DEFAULT_GRID_SIZE);

    const urlParams = new URLSearchParams(window.location.search);
    const inviteRoom = urlParams.get('room');
    const inviteSecret = urlParams.get('secret');
    if (inviteRoom && inviteSecret) {
      mpNet.setMode('JOIN');
      document.getElementById('mp-join-input').value = `${inviteRoom}:${inviteSecret}`;
    }

    window.addEventListener('load', () => {
      resizeCanvas();
      lastFrameTime = performance.now();
      requestAnimationFrame(gameLoop);
    });
  

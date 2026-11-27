// Guest-side multiplayer controller: join handshake, lobby state, initial match
// application, authoritative snapshots, host events, and input/command streaming.
// The controller owns guest state but receives transport/channel callbacks from
// mpNet so it never imports the composition root.

import { UnitRank } from '../config/enums.js';
import { RANK_STATS } from '../config/balance.js';
import { state, getLocalBoss } from '../core/state.js';
import { eliminateFaction } from '../sim/territory.js';
import { getEntityCollisionRadius } from '../sim/movement.js';
import { spawnDeadBody, bulletTracers } from '../render/effects.js';
import { canvas } from '../render/canvas.js';
import { sfx } from '../audio/sfx.js';
import { MSG, EVENT_KIND, envelope, decodeSnapshot } from './protocol.js';

export function createGuestController(deps) {
  const {
    getMode,
    isRoomActive,
    getSelfPeerId,
    setSelfPeerId,
    getMatchStarted,
    setMatchStarted,
    setLocalFaction,
    getSendLobby,
    getSendInput,
    getSendCmd,
    onRejected,
    onLobbyState,
    initializeWorld,
    onMatchInitialized,
    onHostDisconnected,
  } = deps;

  let hostPeerId = '';
  let guestLobbyRoster = [];
  let guestSettings = null;
  let lastSnapshotSeq = 0;
  let guestInputSeq = 0;
  let guestCmdSeq = 0;
  let inputSendTimer = 0;
  let guestName = 'Guest Boss';
  let helloTimer = null;

  function reset() {
    if (helloTimer !== null) {
      clearTimeout(helloTimer);
      helloTimer = null;
    }
    hostPeerId = '';
    guestLobbyRoster = [];
    guestSettings = null;
    lastSnapshotSeq = 0;
    guestInputSeq = 0;
    guestCmdSeq = 0;
    inputSendTimer = 0;
    guestName = 'Guest Boss';
  }

  function setGuestName(name) {
    guestName = name ? name.slice(0, 16) : 'Guest Boss';
  }

  function sendHello(seq) {
    const sendLobby = getSendLobby();
    if (sendLobby) sendLobby(envelope(MSG.HELLO, seq, { name: guestName }));
  }

  function handlePeerJoin(peerId) {
    if (getMode() !== 'JOIN' || hostPeerId) return;
    const sendLobby = getSendLobby();
    if (sendLobby) sendLobby(envelope(MSG.HELLO, 0, { name: guestName }), peerId);
  }

  function startHello(name) {
    setGuestName(name);
    if (helloTimer !== null) clearTimeout(helloTimer);
    let helloAttempts = 0;
    const sendHelloOnce = () => {
      helloTimer = null;
      if (getMode() !== 'JOIN' || !isRoomActive() || hostPeerId) return;
      helloAttempts++;
      sendHello(helloAttempts);
      if (helloAttempts < 6) helloTimer = setTimeout(sendHelloOnce, 800);
    };
    helloTimer = setTimeout(sendHelloOnce, 180);
  }

  function handleLobby(env, peerId) {
    if (!env || getMode() !== 'JOIN') return;
    if (!hostPeerId) hostPeerId = peerId;

    if (env.type === MSG.REJECT) {
      onRejected(env.payload?.reason || 'Connection rejected by host.');
      return;
    }

    if (env.type === MSG.LOBBY_STATE) {
      if (env.payload?.yourPeerId) setSelfPeerId(env.payload.yourPeerId);
      guestLobbyRoster = env.payload?.roster || [];
      guestSettings = env.payload?.settings || null;
      onLobbyState();
    }
  }

  function handleInit(env, peerId) {
    if (!env || getMode() !== 'JOIN') return;
    if (env.type === MSG.INIT_MATCH) {
      hostPeerId = peerId;
      applyInitialMatchState(env.payload);
    }
  }

  function handleSnapshot(env, peerId) {
    if (!env || getMode() !== 'JOIN' || !getMatchStarted()) return;
    if (hostPeerId && peerId !== hostPeerId) return;
    if (env.type === MSG.SNAPSHOT && env.seq > lastSnapshotSeq) {
      lastSnapshotSeq = env.seq;
      applyAuthoritativeSnapshot(env.payload);
    }
  }

  function handleEvent(env, peerId) {
    if (!env || getMode() !== 'JOIN' || !getMatchStarted()) return;
    if (hostPeerId && peerId !== hostPeerId) return;
    if (env.type === MSG.EVENT && env.payload?.kind === EVENT_KIND.SHOT) {
      const { x1, y1, x2, y2, color } = env.payload;
      bulletTracers.push({ x1, y1, x2, y2, color, life: 0.16, maxLife: 0.16 });
      sfx.playGunshot(x1, y1);
    }
  }

  function handlePeerLeave(peerId) {
    if (getMode() === 'JOIN' && peerId === hostPeerId) {
      onHostDisconnected();
    }
  }

  function applyInitialMatchState(payload) {
    if (!payload) return;
    if (payload.yourPeerId) setSelfPeerId(payload.yourPeerId);

    const assignments = payload.assignments || {};
    const mySeat =
      assignments[getSelfPeerId()] ||
      Object.values(assignments).find((a) => !a.isHost);
    if (mySeat && mySeat.faction) setLocalFaction(mySeat.faction);

    setMatchStarted(true);
    lastSnapshotSeq = 0;
    guestInputSeq = 0;
    guestCmdSeq = 0;

    initializeWorld(payload);
    if (payload.snapshot) applyAuthoritativeSnapshot(payload.snapshot);
    onMatchInitialized();
  }

  function applyAuthoritativeSnapshot(payload) {
    const snap = decodeSnapshot(payload);
    if (!snap) return;
    state.gameHour = snap.gameHour ?? state.gameHour;
    state.tickTimer = snap.tickTimer ?? state.tickTimer;

    if (snap.treasuries) Object.assign(state.treasuries, snap.treasuries);
    if (snap.kills) Object.assign(state.factionKills, snap.kills);
    if (snap.deaths) Object.assign(state.factionDeaths, snap.deaths);
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

    if (snap.tactics) {
      for (const f of state.activeFactions) {
        const record = state.factionTactics[f];
        const wire = snap.tactics[f];
        if (!record || !Array.isArray(wire)) continue;
        record.globalStance = wire[0];
        record.localOrder = wire[1];
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
      if (typeof pb.ammo === 'number') state.player.ammo = pb.ammo;
      state.player.reloadTimer = pb.reload || 0;
      state.player.weapon = pb.weapon === 2 ? 'mp9' : pb.weapon === 1 ? 'pistol' : 'none';
      state.player.pistolOwned = Boolean(pb.pistol);
      state.player.mp9Owned = Boolean(pb.mp9);
      state.player.spareMags = typeof pb.mags === 'number' && pb.mags >= 0 ? pb.mags : null;
      state.player.pistolMags = typeof pb.pistolMags === 'number' && pb.pistolMags >= 0 ? pb.pistolMags : null;
      state.player.mp9Mags = typeof pb.mp9Mags === 'number' && pb.mp9Mags >= 0 ? pb.mp9Mags : null;
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
      const unitById = new Map();
      for (const unit of state.npcs) unitById.set(unit.id, unit);

      const seenIds = new Set();
      for (let i = 0; i < snap.npcs.length; i++) {
        const [id, fac, rank, x, y, facing, hp, maxHp, armor, maxArmor, slash, shoot, hPeer, ammo, reload, weaponFlag, pistolOwnedFlag, mp9Flag, magsFlag, pistolMagsFlag, mp9MagsFlag] =
          snap.npcs[i];
        // The local player travels on playerBoss; never apply it twice from npcs.
        if (id === state.player.id) continue;
        seenIds.add(id);
        const stats = RANK_STATS[rank] || RANK_STATS[UnitRank.SOLDIER];
        const isHumanBoss = rank === UnitRank.BOSS && Boolean(hPeer);
        let unit = unitById.get(id);
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
            ...(rank === UnitRank.BOSS || rank === UnitRank.UNDERBOSS
              ? {
                  weapon: weaponFlag === 2 ? 'mp9' : weaponFlag === 1 ? 'pistol' : 'none',
                  pistolOwned: Boolean(pistolOwnedFlag),
                  mp9Owned: Boolean(mp9Flag),
                  ammo: ammo ?? 0,
                  reloadTimer: reload || 0,
                  spareMags: typeof magsFlag === 'number' && magsFlag >= 0 ? magsFlag : null,
                  pistolMags: typeof pistolMagsFlag === 'number' && pistolMagsFlag >= 0 ? pistolMagsFlag : null,
                  mp9Mags: typeof mp9MagsFlag === 'number' && mp9MagsFlag >= 0 ? mp9MagsFlag : null,
                }
              : {}),
            dodgeDir: 1,
            lastCheckX: x,
            lastCheckY: y,
            stuckTimer: 0,
          };
          state.npcs.push(unit);
          unitById.set(id, unit);
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
          if (rank === UnitRank.BOSS || rank === UnitRank.UNDERBOSS) {
            if (typeof ammo === 'number') unit.ammo = ammo;
            unit.reloadTimer = reload || 0;
            unit.weapon = weaponFlag === 2 ? 'mp9' : weaponFlag === 1 ? 'pistol' : 'none';
            unit.pistolOwned = Boolean(pistolOwnedFlag);
            unit.mp9Owned = Boolean(mp9Flag);
            unit.spareMags = typeof magsFlag === 'number' && magsFlag >= 0 ? magsFlag : null;
            unit.pistolMags = typeof pistolMagsFlag === 'number' && pistolMagsFlag >= 0 ? pistolMagsFlag : null;
            unit.mp9Mags = typeof mp9MagsFlag === 'number' && mp9MagsFlag >= 0 ? mp9MagsFlag : null;
          }
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

  function flushInput() {
    if (getMode() !== 'JOIN' || !getMatchStarted() || !getSendInput() || !hostPeerId) return;
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
    getSendInput()(
      envelope(MSG.INPUT, guestInputSeq, { mx, my, sprint, facing, fire: Boolean(state.mouseFiring) }),
      hostPeerId
    );
  }

  function sendCommand(payload) {
    if (getMode() !== 'JOIN' || !getMatchStarted() || !getSendCmd() || !hostPeerId) return;
    guestCmdSeq++;
    getSendCmd()(envelope(MSG.CMD, guestCmdSeq, payload), hostPeerId);
  }

  function update(dt) {
    inputSendTimer += dt;
    if (inputSendTimer >= 0.06) {
      inputSendTimer = 0;
      flushInput();
    }
  }

  return {
    reset,
    setGuestName,
    startHello,
    handlePeerJoin,
    handleLobby,
    handleInit,
    handleSnapshot,
    handleEvent,
    handlePeerLeave,
    flushInput,
    sendCommand,
    update,
    getHostPeerId: () => hostPeerId,
    getRoster: () => guestLobbyRoster,
    getSettings: () => guestSettings,
  };
}

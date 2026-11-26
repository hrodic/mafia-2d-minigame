// Unit caps, spawning and recruitment. Pure simulation logic (no DOM).

import { Faction, UnitRank } from '../config/enums.js';
import { CHUNK_SIZE, CHUNK_PX, TILE_SIZE } from '../config/constants.js';
import { RANK_STATS, UNIT_CAPS } from '../config/balance.js';
import { ALL_FACTION_SLOTS } from '../config/organizations.js';
import { state } from '../core/state.js';
import { emit } from '../core/events.js';
import { canOccupyPosition } from './movement.js';


export function getUnitCaps() {
  const totalNeighborhoods = Math.max(
    UNIT_CAPS.minNeighborhoods,
    state.world.chunks.size || state.currentGridSize * state.currentGridSize
  );
  const maxUnderbosses = Math.max(1, Math.floor(totalNeighborhoods * UNIT_CAPS.underbossFraction));
  const maxCaptains = Math.max(1, Math.floor(totalNeighborhoods * UNIT_CAPS.captainFraction));
  const maxSoldiers = Math.max(1, totalNeighborhoods - maxCaptains - maxUnderbosses);
  return { totalNeighborhoods, maxSoldiers, maxCaptains, maxUnderbosses };
}

export function resetDefaultPlayerSpawnCaps() {
  const { maxSoldiers, maxCaptains, maxUnderbosses } = getUnitCaps();
  const humanCap = UNIT_CAPS.humanCapFraction;
  state.playerSpawnCaps[UnitRank.SOLDIER] = Math.min(maxSoldiers, Math.max(1, Math.round(maxSoldiers * humanCap)));
  state.playerSpawnCaps[UnitRank.CAPTAIN] = Math.min(maxCaptains, Math.max(1, Math.round(maxCaptains * humanCap)));
  state.playerSpawnCaps[UnitRank.UNDERBOSS] = Math.min(maxUnderbosses, Math.max(1, Math.round(maxUnderbosses * humanCap)));
  for (const f of ALL_FACTION_SLOTS) {
    const isHumanRemote = f !== Faction.PLAYER && state.net && state.net.isHumanFaction(f);
    const mult = f === Faction.PLAYER || isHumanRemote ? humanCap : 1.0;
    state.factionRecruitmentPrefs[f] = {
      autoSoldier: true,
      autoCaptain: true,
      autoUnderboss: true,
      caps: {
        [UnitRank.SOLDIER]: Math.min(maxSoldiers, Math.max(1, Math.round(maxSoldiers * mult))),
        [UnitRank.CAPTAIN]: Math.min(maxCaptains, Math.max(1, Math.round(maxCaptains * mult))),
        [UnitRank.UNDERBOSS]: Math.min(maxUnderbosses, Math.max(1, Math.round(maxUnderbosses * mult))),
      },
    };
  }
}

export function clampPlayerSpawnCaps() {
  const { maxSoldiers, maxCaptains, maxUnderbosses } = getUnitCaps();
  state.playerSpawnCaps[UnitRank.SOLDIER] = Math.max(1, Math.min(maxSoldiers, state.playerSpawnCaps[UnitRank.SOLDIER]));
  state.playerSpawnCaps[UnitRank.CAPTAIN] = Math.max(1, Math.min(maxCaptains, state.playerSpawnCaps[UnitRank.CAPTAIN]));
  state.playerSpawnCaps[UnitRank.UNDERBOSS] = Math.max(1, Math.min(maxUnderbosses, state.playerSpawnCaps[UnitRank.UNDERBOSS]));
}

export function spawnUnitInChunk(faction, chunk, rank = UnitRank.SOLDIER) {
  const IN = CHUNK_SIZE - 2;
  const MID = Math.floor(CHUNK_SIZE / 2);
  const spots = [
    [1, 1], [IN, 1], [1, IN], [IN, IN],
    [MID, 1], [MID + 1, IN], [1, MID], [IN, MID + 1],
    [1, 2], [IN, 2], [1, IN - 1], [IN, IN - 1],
    [0, 1], [CHUNK_SIZE - 1, 1], [0, IN], [CHUNK_SIZE - 1, IN],
    [1, 0], [IN, 0], [1, CHUNK_SIZE - 1], [IN, CHUNK_SIZE - 1],
  ];

  const stats = RANK_STATS[rank] || RANK_STATS[UnitRank.SOLDIER];
  const bodyRadius = stats.radius;

  for (let attempt = 0; attempt < spots.length; attempt++) {
    const [lx, ly] = spots[(attempt + state.nextNpcId) % spots.length];
    const wx = chunk.cx * CHUNK_PX + (lx + 0.5) * TILE_SIZE;
    const wy = chunk.cy * CHUNK_PX + (ly + 0.5) * TILE_SIZE;

    if (canOccupyPosition(wx, wy, bodyRadius)) {
      const assignedPeerId =
        rank === UnitRank.BOSS && state.net ? state.net.getPeerForFaction(faction) : null;
      const speed =
        rank === UnitRank.BOSS && assignedPeerId
          ? stats.speedHuman
          : stats.speedAi + Math.random() * stats.speedJitter;

      const unit = {
        id: state.nextNpcId++,
        faction,
        rank,
        humanPeerId: assignedPeerId,
        x: wx,
        y: wy,
        targetX: null,
        targetY: null,
        bodyRadius,
        speed,
        hp: stats.hp,
        maxHp: stats.hp,
        armor: stats.startArmor,
        maxArmor: stats.maxArmor,
        armorCooldown: 0,
        sprintTimer: 0,
        sprintCooldown: 0,
        isSprinting: false,
        minDmg: stats.minDmg,
        maxDmg: stats.maxDmg,
        facing: Math.random() * Math.PI * 2,
        goalX: wx,
        goalY: wy,
        path: null,
        pathTimer: 0,
        aiTimer: 0,
        attackCooldown: 0,
        slashAnimTimer: 0,
        muzzleFlashTimer: 0,
        hitFlashTimer: 0,
        dodgeDir: Math.random() > 0.5 ? 1 : -1,
        lastCheckX: wx,
        lastCheckY: wy,
        stuckTimer: 0,
      };
      state.npcs.push(unit);
      return unit;
    }
  }
  return null;
}

export function recruitUnit(faction, rank, silent = false, cachedCounts = null, cachedOwnedChunks = null) {
  if (!state.factionAlive[faction]) return false;
  const stats = RANK_STATS[rank] || RANK_STATS[UnitRank.SOLDIER];
  const cost = stats.cost;
  if (state.treasuries[faction] < cost) return false;

  const { maxSoldiers, maxCaptains, maxUnderbosses } = getUnitCaps();
  const countKey =
    rank === UnitRank.UNDERBOSS
      ? 'underbosses'
      : rank === UnitRank.CAPTAIN
      ? 'captains'
      : 'soldiers';
  const currentCount = cachedCounts
    ? cachedCounts[faction][countKey]
    : state.npcs.filter((n) => n.faction === faction && n.rank === rank).length;
  const hardLimit =
    rank === UnitRank.UNDERBOSS
      ? maxUnderbosses
      : rank === UnitRank.CAPTAIN
      ? maxCaptains
      : maxSoldiers;

  let limit = hardLimit;
  if (faction === Faction.PLAYER) {
    limit = Math.max(1, Math.min(hardLimit, state.playerSpawnCaps[rank] || hardLimit));
  } else if (state.net && state.net.isHumanFaction(faction)) {
    const prefCap = state.factionRecruitmentPrefs[faction]?.caps?.[rank];
    if (prefCap) limit = Math.max(1, Math.min(hardLimit, prefCap));
  }
  if (currentCount >= limit) return false;

  let ownedChunks = cachedOwnedChunks;
  if (!ownedChunks) {
    ownedChunks = [];
    for (const c of state.world.chunks.values()) {
      if (c.faction === faction) ownedChunks.push(c);
    }
  }
  if (ownedChunks.length === 0) return false;

  let spawnChunk = ownedChunks[Math.floor(Math.random() * ownedChunks.length)];
  if (faction === Faction.PLAYER && state.player.alive) {
    const pTile = state.world.worldToTile(state.player.x, state.player.y);
    const pChunk = state.world.getChunk(pTile.cx, pTile.cy);
    if (pChunk && pChunk.faction === Faction.PLAYER) {
      spawnChunk = pChunk;
    }
  } else {
    const boss = state.npcs.find((n) => n.faction === faction && n.rank === UnitRank.BOSS);
    if (boss) {
      const bTile = state.world.worldToTile(boss.x, boss.y);
      const bChunk = state.world.getChunk(bTile.cx, bTile.cy);
      if (bChunk && bChunk.faction === faction) {
        spawnChunk = bChunk;
      }
    }
  }

  state.treasuries[faction] -= cost;
  const unit = spawnUnitInChunk(faction, spawnChunk, rank);
  if (unit) {
    if (cachedCounts) cachedCounts[faction][countKey]++;
    if (!silent) {
      emit('unit:recruited', { unit, faction, rank, cost });
    }
    return true;
  } else {
    state.treasuries[faction] += cost;
    return false;
  }
}

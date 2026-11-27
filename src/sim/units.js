// Unit caps, spawning and recruitment. Pure simulation logic (no DOM).

import { Faction, UnitRank } from '../config/enums.js';
import { CHUNK_SIZE, CHUNK_PX, TILE_SIZE } from '../config/constants.js';
import { RANK_STATS, PISTOL, START_PISTOL_MAGS, UNIT_CAPS, clampMatchUnitCaps, defaultSpawnCaps } from '../config/balance.js';
import { GLOBAL_STANCE } from '../config/tactics.js';
import { ALL_FACTION_SLOTS } from '../config/organizations.js';
import { state } from '../core/state.js';
import { emit } from '../core/events.js';
import { canOccupyPosition } from './movement.js';
import { countLivingEnemiesOnChunk } from './territory.js';


export function getUnitCaps() {
  const chunkCount = state.world && state.world.chunks ? state.world.chunks.size : 0;
  const gridSize = chunkCount > 0
    ? Math.round(Math.sqrt(chunkCount))
    : Math.max(5, Math.min(25, state.currentGridSize || 15));
  const caps = clampMatchUnitCaps(gridSize, state.matchUnitCaps || {});
  return {
    totalNeighborhoods: Math.max(25, gridSize * gridSize),
    ...caps,
  };
}

/** Lowest selectable spawn cap for a rank. */
export function getUnitCapMin(rank) {
  if (rank === UnitRank.UNDERBOSS) return UNIT_CAPS.minUnderbosses;
  if (rank === UnitRank.CAPTAIN) return UNIT_CAPS.minCaptains;
  return UNIT_CAPS.minSoldiers;
}

/** Highest selectable spawn cap for a rank at the current grid size. */
export function getUnitCapMax(rank) {
  const { maxSoldiers, maxCaptains, maxUnderbosses } = getUnitCaps();
  if (rank === UnitRank.UNDERBOSS) return maxUnderbosses;
  if (rank === UnitRank.CAPTAIN) return maxCaptains;
  return maxSoldiers;
}

/** Clamp any requested cap into the rank's allowed range. */
export function clampUnitCap(rank, value) {
  const min = getUnitCapMin(rank);
  const max = getUnitCapMax(rank);
  const n = Math.floor(Number(value));
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
}

export function resetDefaultPlayerSpawnCaps() {
  const caps = getUnitCaps();
  const playerDefaults = defaultSpawnCaps(caps, UNIT_CAPS.humanCapFraction);
  const aiDefaults = defaultSpawnCaps(caps, 1);
  for (const rank of [UnitRank.SOLDIER, UnitRank.CAPTAIN, UnitRank.UNDERBOSS]) {
    state.playerSpawnCaps[rank] = playerDefaults[rank];
  }
  for (const f of ALL_FACTION_SLOTS) {
    const isHumanRemote = f !== Faction.PLAYER && state.net && state.net.isHumanFaction(f);
    const defaults = f === Faction.PLAYER || isHumanRemote ? playerDefaults : aiDefaults;
    state.factionRecruitmentPrefs[f] = {
      autoSoldier: true,
      autoCaptain: true,
      autoUnderboss: true,
      caps: { ...defaults },
    };
  }
}

export function clampPlayerSpawnCaps() {
  for (const rank of [UnitRank.SOLDIER, UnitRank.CAPTAIN, UnitRank.UNDERBOSS]) {
    state.playerSpawnCaps[rank] = clampUnitCap(rank, state.playerSpawnCaps[rank]);
  }
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
        inBossAura: false,
        guardSlotAngle: null,
        attackCooldown: 0,
        slashAnimTimer: 0,
        muzzleFlashTimer: 0,
        hitFlashTimer: 0,
        ...(rank === UnitRank.UNDERBOSS
          ? { weapon: 'pistol', ammo: PISTOL.magazine, reloadTimer: 0, mp9Owned: false }
          : {}),
        ...(rank === UnitRank.BOSS
          ? {
              weapon: 'none',
              pistolOwned: false,
              mp9Owned: false,
              ammo: 0,
              spareMags: START_PISTOL_MAGS,
              pistolAmmo: 0,
              pistolMags: START_PISTOL_MAGS,
              mp9Ammo: 0,
              mp9Mags: 0,
              reloadTimer: 0,
              shopTimer: 0,
            }
          : {}),
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

const DEFEND_SPAWN_ENEMY_LIMIT = 3;

const SPAWN_NEIGHBOR_OFFSETS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function distanceToChunkPoint(chunk, x, y) {
  return Math.hypot((chunk.cx + 0.5) * CHUNK_PX - x, (chunk.cy + 0.5) * CHUNK_PX - y);
}

function isOwnedBorderChunk(chunk, faction) {
  for (const [dx, dy] of SPAWN_NEIGHBOR_OFFSETS) {
    const neighbor = state.world.getChunk(chunk.cx + dx, chunk.cy + dy);
    if (neighbor && neighbor.faction !== faction) return true;
  }
  return false;
}

function factionBossPosition(faction) {
  if (faction === Faction.PLAYER && state.player && state.player.alive) return state.player;
  for (let i = 0; i < state.npcs.length; i++) {
    const unit = state.npcs[i];
    if (unit && unit.faction === faction && unit.rank === UnitRank.BOSS) return unit;
  }
  return null;
}

/**
 * Defend reinforcement placement: friendly turf near the threat, never a block
 * already holding 3+ enemies when a safe alternative exists. Returns null when
 * the faction is not defending, so the caller keeps the normal spawn rule.
 */
function chooseDefendSpawnChunk(faction, ownedChunks) {
  const record = state.factionTactics && state.factionTactics[faction];
  if (!record || record.globalStance !== GLOBAL_STANCE.DEFEND) return null;

  const safe = ownedChunks.filter(
    (chunk) => countLivingEnemiesOnChunk(chunk, faction) < DEFEND_SPAWN_ENEMY_LIMIT
  );
  const pool = safe.length > 0 ? safe : ownedChunks;
  if (pool.length === 0) return null;

  const boss = factionBossPosition(faction);
  const anchorX = boss ? boss.x : record.bossX;
  const anchorY = boss ? boss.y : record.bossY;

  const threatened = (record.threatenedChunks || []).filter(
    (chunk) => chunk.faction === faction
  );
  if (threatened.length > 0) {
    let threat = null;
    let threatDist = Infinity;
    for (const chunk of threatened) {
      const d = distanceToChunkPoint(chunk, anchorX, anchorY);
      if (d < threatDist) {
        threatDist = d;
        threat = chunk;
      }
    }
    if (threat && safe.includes(threat)) return threat;
    if (threat) {
      const tx = (threat.cx + 0.5) * CHUNK_PX;
      const ty = (threat.cy + 0.5) * CHUNK_PX;
      let best = null;
      let bestDist = Infinity;
      for (const chunk of pool) {
        const d = distanceToChunkPoint(chunk, tx, ty);
        if (d < bestDist) {
          bestDist = d;
          best = chunk;
        }
      }
      return best;
    }
  }

  let border = null;
  let borderDist = Infinity;
  let any = null;
  let anyDist = Infinity;
  for (const chunk of pool) {
    const d = distanceToChunkPoint(chunk, anchorX, anchorY);
    if (d < anyDist) {
      anyDist = d;
      any = chunk;
    }
    if (isOwnedBorderChunk(chunk, faction) && d < borderDist) {
      borderDist = d;
      border = chunk;
    }
  }
  return border || any;
}

export function recruitUnit(faction, rank, silent = false, cachedCounts = null, cachedOwnedChunks = null) {  if (!state.factionAlive[faction]) return false;
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
  const hardMin = getUnitCapMin(rank);
  if (faction === Faction.PLAYER) {
    limit = Math.max(hardMin, Math.min(hardLimit, state.playerSpawnCaps[rank] || hardLimit));
  } else if (state.net && state.net.isHumanFaction(faction)) {
    const prefCap = state.factionRecruitmentPrefs[faction]?.caps?.[rank];
    if (prefCap) limit = Math.max(hardMin, Math.min(hardLimit, prefCap));
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
  const defendChunk = chooseDefendSpawnChunk(faction, ownedChunks);
  if (defendChunk) {
    spawnChunk = defendChunk;
  } else if (faction === Faction.PLAYER && state.player.alive) {
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

// Command dispatch: one gameplay entry point for local input and remote guests.
// The host/single-player runs these directly; guests stream the same payloads.

import { Faction, UnitRank } from '../config/enums.js';
import { state } from '../core/state.js';
import {
  buyBossArmor,
  buyBossAmmo,
  buyBossGlock,
  buyBossMp9,
  executeBossSlashForFaction,
  executeBuyArmorForFaction,
  executeBuyAmmoForFaction,
  executeBuyGlockForFaction,
  executeBuyMp9ForFaction,
  performBossPistolShot,
  startReload,
  switchBossWeapon,
} from './combat.js';
import { clampUnitCap } from './units.js';
import { setGlobalStance, setLocalOrder } from './tactics.js';

export function getBossForFaction(faction) {
  if (faction === Faction.PLAYER) return state.player;
  return state.npcs.find((n) => n.faction === faction && n.rank === UnitRank.BOSS) || null;
}

function applyRecruitPrefs(faction, payload) {
  if (faction === Faction.PLAYER) {
    if (typeof payload.autoSoldier === 'boolean') state.autoRecruitSoldier = payload.autoSoldier;
    if (typeof payload.autoCaptain === 'boolean') state.autoRecruitCaptain = payload.autoCaptain;
    if (typeof payload.autoUnderboss === 'boolean') state.autoRecruitUnderboss = payload.autoUnderboss;
    if (payload.caps && typeof payload.caps === 'object') {
      if (typeof payload.caps[UnitRank.SOLDIER] === 'number') {
        state.playerSpawnCaps[UnitRank.SOLDIER] = clampUnitCap(UnitRank.SOLDIER, payload.caps[UnitRank.SOLDIER]);
      }
      if (typeof payload.caps[UnitRank.CAPTAIN] === 'number') {
        state.playerSpawnCaps[UnitRank.CAPTAIN] = clampUnitCap(UnitRank.CAPTAIN, payload.caps[UnitRank.CAPTAIN]);
      }
      if (typeof payload.caps[UnitRank.UNDERBOSS] === 'number') {
        state.playerSpawnCaps[UnitRank.UNDERBOSS] = clampUnitCap(UnitRank.UNDERBOSS, payload.caps[UnitRank.UNDERBOSS]);
      }
    }
    return true;
  }

  const prefs = state.factionRecruitmentPrefs[faction];
  if (!prefs) return false;
  if (typeof payload.autoSoldier === 'boolean') prefs.autoSoldier = payload.autoSoldier;
  if (typeof payload.autoCaptain === 'boolean') prefs.autoCaptain = payload.autoCaptain;
  if (typeof payload.autoUnderboss === 'boolean') prefs.autoUnderboss = payload.autoUnderboss;
  if (payload.caps && typeof payload.caps === 'object') {
    if (typeof payload.caps[UnitRank.SOLDIER] === 'number') {
      prefs.caps[UnitRank.SOLDIER] = clampUnitCap(UnitRank.SOLDIER, payload.caps[UnitRank.SOLDIER]);
    }
    if (typeof payload.caps[UnitRank.CAPTAIN] === 'number') {
      prefs.caps[UnitRank.CAPTAIN] = clampUnitCap(UnitRank.CAPTAIN, payload.caps[UnitRank.CAPTAIN]);
    }
    if (typeof payload.caps[UnitRank.UNDERBOSS] === 'number') {
      prefs.caps[UnitRank.UNDERBOSS] = clampUnitCap(UnitRank.UNDERBOSS, payload.caps[UnitRank.UNDERBOSS]);
    }
  }
  return true;
}

/** Run one command for a faction. Returns true when the command was handled. */
export function dispatchCommand(faction, payload) {
  if (!payload || typeof payload.cmd !== 'string') return false;

  switch (payload.cmd) {
    case 'MOVE_TO': {
      const boss = getBossForFaction(faction);
      if (!boss || !Number.isFinite(payload.x) || !Number.isFinite(payload.y)) return false;
      if (faction === Faction.PLAYER && !state.player.alive) return false;
      const snapped = state.world.findNearestWalkablePoint(payload.x, payload.y, 12);
      if (!snapped) return false;
      boss.targetX = snapped.x;
      boss.targetY = snapped.y;
      // Every click-to-move is authoritative: discard any older A* route so the
      // next movement step recomputes toward the new target immediately.
      boss.path = null;
      boss.pathTimer = 0;
      return true;
    }
    case 'SLASH':
      return executeBossSlashForFaction(faction);
    case 'SHOOT': {
      const boss = getBossForFaction(faction);
      if (!boss || !Number.isFinite(payload.tx) || !Number.isFinite(payload.ty)) return false;
      if (faction === Faction.PLAYER && !state.player.alive) return false;
      return performBossPistolShot(boss, faction === Faction.PLAYER, payload.tx, payload.ty);
    }
    case 'RELOAD': {
      const boss = getBossForFaction(faction);
      if (!boss) return false;
      if (faction === Faction.PLAYER && !state.player.alive) return false;
      return startReload(boss);
    }
    case 'BUY_ARMOR':
      if (faction === Faction.PLAYER) {
        buyBossArmor();
        return true;
      }
      return executeBuyArmorForFaction(faction);
    case 'BUY_MP9':
      if (faction === Faction.PLAYER) {
        buyBossMp9();
        return true;
      }
      return executeBuyMp9ForFaction(faction);
    case 'BUY_GLOCK':
      if (faction === Faction.PLAYER) {
        buyBossGlock();
        return true;
      }
      return executeBuyGlockForFaction(faction);
    case 'BUY_AMMO':
      if (faction === Faction.PLAYER) {
        buyBossAmmo();
        return true;
      }
      return executeBuyAmmoForFaction(faction);
    case 'SWITCH_WEAPON': {
      const boss = getBossForFaction(faction);
      if (!boss) return false;
      if (faction === Faction.PLAYER && !state.player.alive) return false;
      return switchBossWeapon(boss, payload.weapon);
    }
    case 'RECRUIT_PREF':
      return applyRecruitPrefs(faction, payload);
    case 'SET_GLOBAL_STANCE':
      return setGlobalStance(faction, payload.stance ?? payload.value);
    case 'SET_LOCAL_ORDER':
      return setLocalOrder(faction, payload.order ?? payload.value);
    default:
      return false;
  }
}

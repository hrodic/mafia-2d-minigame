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


    // =========================================================================
    // 3. GAME STATE HELPERS (shared state object lives in core/state.js)
    // =========================================================================



    function rollDamage(min, max) {
      return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    // =========================================================================


    // =========================================================================
    // 6. GAME STATE, ENTITIES, LOCAL FACTION ABSTRACTION & COLLISION SOLVER
    // =========================================================================
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    const minimapCanvas = document.getElementById('minimapCanvas');
    const minimapCtx = minimapCanvas.getContext('2d');
    state.world = new CityMap();


    const minimapCacheCanvas = document.createElement('canvas');
    minimapCacheCanvas.width = minimapCanvas.width;
    minimapCacheCanvas.height = minimapCanvas.height;
    const minimapCacheCtx = minimapCacheCanvas.getContext('2d');

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

    function initWorld(
      gridSize = state.currentGridSize,
      autoStart = true,
      selectedTickSeconds = state.tickDuration,
      selectedIncomeTier = state.currentIncomeTier,
      factionCount = state.activeFactionCount,
      orgRoster = state.selectedFactionOrgs,
      seedOverride = null
    ) {
      state.currentWorldSeed = seedOverride;
      state.currentGridSize = Math.max(5, Math.min(25, gridSize));
      state.tickDuration = Math.max(10, Math.min(30, selectedTickSeconds));
      state.currentIncomeTier = INCOME_TIERS[selectedIncomeTier] ? selectedIncomeTier : 'HIGH';
      state.activeFactionCount = Math.max(2, Math.min(4, Number(factionCount) || 4));
      state.selectedFactionOrgs = ensureUniqueOrgs(orgRoster);

      if (state.activeFactionCount === 2) {
        state.activeFactions = [Faction.PLAYER, Faction.RIVAL_3];
      } else if (state.activeFactionCount === 3) {
        state.activeFactions = [Faction.PLAYER, Faction.RIVAL_1, Faction.RIVAL_2];
      } else {
        state.activeFactions = [Faction.PLAYER, Faction.RIVAL_1, Faction.RIVAL_2, Faction.RIVAL_3];
      }

      state.activeFactions.forEach((slot, idx) => {
        const orgId = state.selectedFactionOrgs[idx] || ALL_ORG_IDS[idx];
        FACTION_META[slot] = { ...ORGANIZATIONS[orgId] };
      });

      state.world.generation = {
        seed: state.currentWorldSeed,
        gridSize: state.currentGridSize,
        incomeTier: state.currentIncomeTier,
        activeFactions: state.activeFactions,
      };
      state.world.clear();
      state.npcs.length = 0;
      resetEffects();
      state.spatialBuckets.clear();
      state.gameStarted = autoStart;
      state.isSpectating = false;
      state.gameOver = false;
      state.victoryShown = false;
      state.tickTimer = 0;
      state.hudUpdateTimer = 0;
      state.minimapCacheTimer = 1.0;
      state.gameHour = 12;
      state.nextNpcId = 1;

      document.getElementById('defeat-banner').classList.add('hidden');
      document.getElementById('victory-banner').classList.add('hidden');
      document.getElementById('spectator-banner').classList.add('hidden');
      document.getElementById('hour-hud-box').title =
        `Every ${state.tickDuration} seconds an hour passes: blocks pay & toggled units spawn`;

      for (const f of ALL_FACTION_SLOTS) {
        const isActive = state.activeFactions.includes(f);
        state.treasuries[f] = isActive ? 3000 : 0;
        state.factionAlive[f] = isActive;
      }

      for (let cy = 0; cy < state.currentGridSize; cy++) {
        for (let cx = 0; cx < state.currentGridSize; cx++) {
          state.world.generateChunk(cx, cy);
        }
      }

      resetDefaultPlayerSpawnCaps();
      syncRecruitButtonLabels();

      state.player.x = 1.5 * TILE_SIZE;
      state.player.y = 1.5 * TILE_SIZE;
      state.player.targetX = null;
      state.player.targetY = null;
      state.player.hp = BOSS_MAX_HP;
      state.player.maxHp = BOSS_MAX_HP;
      state.player.armor = 0;
      state.player.armorCooldown = 0;
      state.player.sprintTimer = 0;
      state.player.sprintCooldown = 0;
      state.player.isSprinting = false;
      state.player.alive = true;
      state.player.attackCooldown = 0;
      state.player.slashAnimTimer = 0;
      state.player.muzzleFlashTimer = 0;
      state.player.hitFlashTimer = 0;

      const last = state.currentGridSize - 1;
      const cornerCoords = {
        [Faction.RIVAL_1]: { cx: last, cy: 0 },
        [Faction.RIVAL_2]: { cx: 0, cy: last },
        [Faction.RIVAL_3]: { cx: last, cy: last },
      };

      for (const slot of state.activeFactions) {
        if (slot === Faction.PLAYER) continue;
        const pos = cornerCoords[slot];
        const hq = state.world.getChunk(pos.cx, pos.cy);
        if (hq) {
          spawnUnitInChunk(slot, hq, UnitRank.BOSS);
        }
      }

      const localBoss = getLocalBoss();
      state.camera.x = localBoss.x;
      state.camera.y = localBoss.y;

      recalculateHourlyIncome();
      updateHUD();
      resizeCanvas();
      if (autoStart) render();
    }

    // =========================================================================
    // 7. SHARED DAMAGE HELPER, BOSS MELEE SLASH & 9MM PISTOL ATTACK
    // =========================================================================
    function applyDamageToNpc(target, dmg, textColor = '#fbbf24', suffix = '', hitAngle = null) {
      if (!target) return false;
      target.hitFlashTimer = 0.16;

      let remainingDmg = dmg;
      let absorbed = 0;
      if (target.armor && target.armor > 0) {
        absorbed = Math.min(target.armor, remainingDmg);
        target.armor -= absorbed;
        remainingDmg -= absorbed;
      }

      if (remainingDmg > 0) {
        target.hp -= remainingDmg;
      }

      const isKill = target.hp <= 0;
      if (remainingDmg > 0) {
        spawnBloodSplash(target.x, target.y, target.rank === UnitRank.BOSS ? 1.45 : 1.2, isKill, hitAngle);
      } else {
        spawnSparks(target.x, target.y - 12);
      }

      if (absorbed > 0 && remainingDmg === 0) {
        addFloatingText(target.x, target.y - 28, `-${absorbed} 🛡️`, '#38bdf8');
      } else if (absorbed > 0 && remainingDmg > 0) {
        addFloatingText(target.x, target.y - 28, `-${absorbed}🛡️ -${remainingDmg} ${suffix}`.trim(), textColor);
      } else {
        addFloatingText(target.x, target.y - 28, `-${remainingDmg} ${suffix}`.trim(), textColor);
      }

      if (absorbed > 0 && target.armor <= 0) {
        target.armor = 0;
        addFloatingText(target.x, target.y - 42, 'ARMOR BROKEN!', '#7dd3fc');
      }

      if (isKill) {
        const deadIdx = state.npcs.indexOf(target);
        if (deadIdx !== -1) {
          const deadFaction = target.faction;
          const wasBoss = target.rank === UnitRank.BOSS;
          spawnDeadBody(target.x, target.y, deadFaction, target.rank, target.facing, hitAngle ?? target.facing);
          state.npcs.splice(deadIdx, 1);
          if (wasBoss) {
            sfx.playDeath(true, target.x, target.y);
            addFloatingText(target.x, target.y - 44, 'BOSS KILLED!', '#f43f5e');
            eliminateFaction(deadFaction);
          } else {
            sfx.playDeath(false, target.x, target.y);
            addFloatingText(target.x, target.y - 38, 'ELIMINATED', '#f43f5e');
          }
        }
      }
      return isKill;
    }

    function executeBossSlashForFaction(faction) {
      if (faction === Faction.PLAYER) {
        performKnifeSlash();
        return;
      }
      const bossNpc = state.npcs.find((n) => n.faction === faction && n.rank === UnitRank.BOSS);
      if (!bossNpc || bossNpc.attackCooldown > 0) return;

      bossNpc.attackCooldown = 0.34;
      bossNpc.slashAnimTimer = 0.18;
      spawnSlashArc(bossNpc.x, bossNpc.y, bossNpc.facing, FACTION_META[faction].accent);

      const reach = 52;
      const maxTargets = 3;
      const candidates = [];

      if (state.player.alive && faction !== Faction.PLAYER) {
        const dx = state.player.x - bossNpc.x;
        const dy = state.player.y - bossNpc.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= reach) {
          let angleDiff = Math.abs(Math.atan2(dy, dx) - bossNpc.facing);
          if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;
          if (angleDiff <= Math.PI * 0.45 || dist < 32) {
            candidates.push({ isPlayer: true, entity: state.player, dist, dx, dy });
          }
        }
      }

      for (let i = 0; i < state.npcs.length; i++) {
        const other = state.npcs[i];
        if (other.faction === faction) continue;
        const dx = other.x - bossNpc.x;
        const dy = other.y - bossNpc.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= reach) {
          let angleDiff = Math.abs(Math.atan2(dy, dx) - bossNpc.facing);
          if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;
          if (angleDiff <= Math.PI * 0.45 || dist < 32) {
            candidates.push({ isPlayer: false, entity: other, dist, dx, dy });
          }
        }
      }

      candidates.sort((a, b) => a.dist - b.dist);
      const targets = candidates.slice(0, maxTargets);
      sfx.playSlash(targets.length > 0, bossNpc.x, bossNpc.y);

      for (const item of targets) {
        const dmg = rollDamage(bossNpc.minDmg, bossNpc.maxDmg);
        const strikeAngle = item.dist > 0.01 ? Math.atan2(item.dy, item.dx) : bossNpc.facing;
        if (item.isPlayer) {
          damagePlayerBoss(dmg, '#f43f5e', '', strikeAngle);
        } else {
          const knockX = item.entity.x + Math.cos(strikeAngle) * 14;
          const knockY = item.entity.y + Math.sin(strikeAngle) * 14;
          const nRad = getEntityCollisionRadius(item.entity.rank);
          if (canOccupyPosition(knockX, knockY, nRad, item.entity.id, false)) {
            item.entity.x = knockX;
            item.entity.y = knockY;
          }
          applyDamageToNpc(item.entity, dmg, FACTION_META[faction].accent, '', strikeAngle);
        }
      }
    }

    function performKnifeSlash() {
      if (!state.gameStarted) return;
      if (typeof mpNet !== 'undefined' && mpNet.isGuest()) {
        if (!isLocalBossAlive()) return;
        mpNet.sendCommand({ cmd: 'SLASH' });
        return;
      }
      if (!state.player.alive || state.player.attackCooldown > 0) return;

      state.player.attackCooldown = 0.34;
      state.player.slashAnimTimer = 0.18;
      spawnSlashArc(state.player.x, state.player.y, state.player.facing, '#f43f5e');

      const reach = 52;
      const maxTargets = 3;
      const candidates = [];

      for (let i = 0; i < state.npcs.length; i++) {
        const npc = state.npcs[i];
        if (npc.faction === Faction.PLAYER) continue;
        const dx = npc.x - state.player.x;
        const dy = npc.y - state.player.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= reach) {
          const angleToNpc = Math.atan2(dy, dx);
          let angleDiff = Math.abs(angleToNpc - state.player.facing);
          if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;
          if (angleDiff <= Math.PI * 0.42 || dist < 30) {
            candidates.push({ npc, dist, dx, dy });
          }
        }
      }

      candidates.sort((a, b) => a.dist - b.dist);
      const targets = candidates.slice(0, maxTargets);
      const hitCount = targets.length;
      sfx.playSlash(hitCount > 0, state.player.x, state.player.y);

      for (const item of targets) {
        const { npc, dist, dx, dy } = item;
        const dmg = rollDamage(state.player.minDmg, state.player.maxDmg);

        const pushAngle = dist > 0.01 ? Math.atan2(dy, dx) : state.player.facing;
        const knockX = npc.x + Math.cos(pushAngle) * 14;
        const knockY = npc.y + Math.sin(pushAngle) * 14;
        const nRad = getEntityCollisionRadius(npc.rank);
        if (canOccupyPosition(knockX, knockY, nRad, npc.id, false)) {
          npc.x = knockX;
          npc.y = knockY;
        }

        applyDamageToNpc(npc, dmg, '#fbbf24', '', pushAngle);
      }

      if (hitCount === 0) {
        addFloatingText(
          state.player.x + Math.cos(state.player.facing) * 20,
          state.player.y + Math.sin(state.player.facing) * 20 - 16,
          'Slash!',
          '#a1a1aa'
        );
      }
    }

    function performBossKnifeSlash(bossNpc) {
      if (bossNpc.attackCooldown > 0) return false;
      bossNpc.attackCooldown = UNIT_ATTACK_COOLDOWN;
      bossNpc.slashAnimTimer = 0.18;

      const reach = 52;
      const maxTargets = 3;
      const candidates = [];

      if (state.player.alive && bossNpc.faction !== Faction.PLAYER) {
        const dx = state.player.x - bossNpc.x;
        const dy = state.player.y - bossNpc.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= reach) {
          candidates.push({ isPlayer: true, entity: state.player, dist, dx, dy });
        }
      }

      for (let i = 0; i < state.npcs.length; i++) {
        const other = state.npcs[i];
        if (other.faction === bossNpc.faction) continue;
        const dx = other.x - bossNpc.x;
        const dy = other.y - bossNpc.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= reach) {
          candidates.push({ isPlayer: false, entity: other, dist, dx, dy });
        }
      }

      candidates.sort((a, b) => a.dist - b.dist);
      const targets = candidates.slice(0, maxTargets);
      if (targets.length === 0) return false;

      bossNpc.facing = Math.atan2(targets[0].dy, targets[0].dx);
      spawnSlashArc(bossNpc.x, bossNpc.y, bossNpc.facing, FACTION_META[bossNpc.faction].accent);
      sfx.playSlash(true, bossNpc.x, bossNpc.y);

      for (const item of targets) {
        const dmg = rollDamage(bossNpc.minDmg, bossNpc.maxDmg);
        const pushAngle = item.dist > 0.01 ? Math.atan2(item.dy, item.dx) : bossNpc.facing;
        if (item.isPlayer) {
          damagePlayerBoss(dmg, '#f43f5e', '🔪', pushAngle);
        } else {
          const knockX = item.entity.x + Math.cos(pushAngle) * 12;
          const knockY = item.entity.y + Math.sin(pushAngle) * 12;
          const nRad = getEntityCollisionRadius(item.entity.rank);
          if (canOccupyPosition(knockX, knockY, nRad, item.entity.id, false)) {
            item.entity.x = knockX;
            item.entity.y = knockY;
          }
          applyDamageToNpc(item.entity, dmg, FACTION_META[bossNpc.faction].accent, '🔪', pushAngle);
        }
      }
      return true;
    }

    function traceBulletRay(x0, y0, angle, maxDist) {
      const step = 8;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      for (let d = 14; d <= maxDist; d += step) {
        const px = x0 + cos * d;
        const py = y0 + sin * d;
        if (!state.world.isWalkable(px, py)) {
          return { blocked: true, dist: d, x: px, y: py };
        }
        const { cx, cy, lx, ly } = state.world.worldToTile(px, py);
        const chunk = state.world.getChunk(cx, cy);
        if (!chunk) return { blocked: true, dist: d, x: px, y: py };
        const prop = chunk.props[ly][lx];
        if (prop === PropType.CAR) {
          const tileWx = (cx * CHUNK_SIZE + lx) * TILE_SIZE;
          const tileWy = (cy * CHUNK_SIZE + ly) * TILE_SIZE;
          const isVert = chunk.propVertical[ly][lx];
          const side = chunk.propCurbSide[ly][lx];
          const rx = isVert ? (side === 'W' ? tileWx + 21 : tileWx + 5) : tileWx + 5;
          const ry = isVert ? tileWy + 5 : (side === 'N' ? tileWy + 21 : tileWy + 5);
          const rw = isVert ? 18 : 34;
          const rh = isVert ? 34 : 18;
          if (px >= rx && px <= rx + rw && py >= ry && py <= ry + rh) {
            return { blocked: true, dist: d, x: px, y: py };
          }
        } else if (prop === PropType.DUMPSTER) {
          const tileWx = (cx * CHUNK_SIZE + lx) * TILE_SIZE;
          const tileWy = (cy * CHUNK_SIZE + ly) * TILE_SIZE;
          if (px >= tileWx + 9 && px <= tileWx + 35 && py >= tileWy + 10 && py <= tileWy + 32) {
            return { blocked: true, dist: d, x: px, y: py };
          }
        }
      }
      return { blocked: false, dist: maxDist, x: x0 + cos * maxDist, y: y0 + sin * maxDist };
    }

    function getPistolAccuracyInfo(dist) {
      if (dist > MAX_PISTOL_RANGE) {
        return { failChance: 1, dmgMult: 0, label: 'OUT OF RANGE', color: '#71717a' };
      }
      if (dist <= 50) {
        return { failChance: 0, dmgMult: 0.25, label: 'POINT-BLANK · -75% DMG', color: '#f97316' };
      }
      if (dist < 100) {
        return { failChance: 0, dmgMult: 0.5, label: 'CLOSE · -50% DMG', color: '#fb923c' };
      }
      if (dist < MAX_PISTOL_RANGE * 0.25) {
        return { failChance: 0, dmgMult: 1, label: '100% ACC · FULL DMG', color: '#34d399' };
      }
      if (dist < MAX_PISTOL_RANGE * 0.50) {
        return { failChance: 0.05, dmgMult: 1, label: '95% ACC (5% MISS)', color: '#a3e635' };
      }
      if (dist < MAX_PISTOL_RANGE * 0.75) {
        return { failChance: 0.10, dmgMult: 1, label: '90% ACC (10% MISS)', color: '#fbbf24' };
      }
      if (dist < MAX_PISTOL_RANGE * 0.90) {
        return { failChance: 0.25, dmgMult: 1, label: '75% ACC (25% MISS)', color: '#fb923c' };
      }
      return { failChance: 0.50, dmgMult: 1, label: '50% ACC (50% MISS)', color: '#f43f5e' };
    }

    function performBossPistolShot(shooter, isPlayerShooter, targetX, targetY) {
      if (shooter.attackCooldown > 0) return false;

      const dx = targetX - shooter.x;
      const dy = targetY - shooter.y;
      const angle = Math.atan2(dy, dx);
      shooter.facing = angle;
      const isHumanShooter = isPlayerShooter || Boolean(shooter.humanPeerId);
      shooter.attackCooldown = isHumanShooter ? 0.65 : UNIT_ATTACK_COOLDOWN;
      shooter.muzzleFlashTimer = 0.09;

      const shooterFaction = isPlayerShooter ? Faction.PLAYER : shooter.faction;
      const muzzleX = shooter.x + Math.cos(angle) * 18;
      const muzzleY = shooter.y - 14 + Math.sin(angle) * 6;
      spawnMuzzleFlash(muzzleX, muzzleY, angle);

      const ejectAngle = angle + Math.PI * 0.55 + (Math.random() - 0.5) * 0.3;
      shellCasings.push({
        x: shooter.x + Math.cos(angle) * 8,
        y: shooter.y - 10,
        z: 14,
        vx: Math.cos(ejectAngle) * (45 + Math.random() * 35),
        vy: Math.sin(ejectAngle) * (45 + Math.random() * 35),
        vz: 75 + Math.random() * 35,
        rot: Math.random() * Math.PI,
        vrot: (Math.random() - 0.5) * 24,
        life: 0.75,
      });

      sfx.playGunshot(shooter.x, shooter.y);

      const envHit = traceBulletRay(shooter.x, shooter.y, angle, MAX_PISTOL_RANGE);
      const maxRayDist = envHit.dist;

      let bestTarget = null;
      let bestTargetIsPlayer = false;
      let bestProjDist = maxRayDist;

      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      for (let i = 0; i < state.npcs.length; i++) {
        const npc = state.npcs[i];
        if (npc.faction === shooterFaction) continue;
        const rx = npc.x - shooter.x;
        const ry = npc.y - shooter.y;
        const proj = rx * cos + ry * sin;
        if (proj < 16 || proj > bestProjDist) continue;
        const perp = Math.abs(-rx * sin + ry * cos);
        const hitRadius = getEntityCollisionRadius(npc.rank) + 4;
        if (perp <= hitRadius) {
          bestProjDist = proj;
          bestTarget = npc;
          bestTargetIsPlayer = false;
        }
      }

      if (!isPlayerShooter && state.player.alive && shooterFaction !== Faction.PLAYER) {
        const rx = state.player.x - shooter.x;
        const ry = state.player.y - shooter.y;
        const proj = rx * cos + ry * sin;
        if (proj >= 16 && proj <= bestProjDist) {
          const perp = Math.abs(-rx * sin + ry * cos);
          const hitRadius = getEntityCollisionRadius(UnitRank.BOSS) + 4;
          if (perp <= hitRadius) {
            bestProjDist = proj;
            bestTarget = state.player;
            bestTargetIsPlayer = true;
          }
        }
      }

      let shotMissed = false;
      if (bestTarget) {
        const { failChance } = getPistolAccuracyInfo(bestProjDist);
        if (failChance > 0 && Math.random() < failChance) {
          shotMissed = true;
        }
      }

      let endX = shooter.x + cos * bestProjDist;
      let endY = (shooter.y - 10) + sin * bestProjDist;

      if (bestTarget && shotMissed) {
        const missDir = Math.random() < 0.5 ? 1 : -1;
        const deflectAngle = angle + missDir * (0.045 + Math.random() * 0.035);
        const missRay = traceBulletRay(shooter.x, shooter.y, deflectAngle, MAX_PISTOL_RANGE);
        endX = missRay.x;
        endY = missRay.y - 10;

        addFloatingText(bestTarget.x, bestTarget.y - 34, 'MISS!', '#a1a1aa');
        if (missRay.blocked) {
          spawnSparks(missRay.x, missRay.y);
          sfx.playRicochet(missRay.x, missRay.y);
        }
      }

      const tracerColor = isPlayerShooter ? '#fde047' : FACTION_META[shooterFaction].accent;
      bulletTracers.push({
        x1: muzzleX,
        y1: muzzleY,
        x2: endX,
        y2: endY,
        color: tracerColor,
        life: 0.16,
        maxLife: 0.16,
      });

      if (typeof mpNet !== 'undefined' && mpNet.isHost()) {
        mpNet.broadcastEvent({
          kind: 'SHOT',
          x1: Math.round(muzzleX),
          y1: Math.round(muzzleY),
          x2: Math.round(endX),
          y2: Math.round(endY),
          color: tracerColor,
        });
      }

      if (bestTarget && !shotMissed) {
        let dmg = rollDamage(40, 80);
        const { dmgMult } = getPistolAccuracyInfo(bestProjDist);
        if (dmgMult < 1) {
          dmg = Math.max(1, Math.round(dmg * dmgMult));
        }
        if (bestTargetIsPlayer) {
          damagePlayerBoss(dmg, `${FACTION_META[shooterFaction].accent}`, '🔫', angle);
        } else {
          const knockX = bestTarget.x + cos * 16;
          const knockY = bestTarget.y + sin * 16;
          const nRad = getEntityCollisionRadius(bestTarget.rank);
          if (canOccupyPosition(knockX, knockY, nRad, bestTarget.id, false)) {
            bestTarget.x = knockX;
            bestTarget.y = knockY;
          }
          applyDamageToNpc(
            bestTarget,
            dmg,
            isPlayerShooter ? '#fde047' : FACTION_META[shooterFaction].accent,
            '',
            angle
          );
        }
      } else if (!bestTarget && envHit.blocked) {
        spawnSparks(envHit.x, envHit.y);
        sfx.playRicochet(envHit.x, envHit.y);
      }

      return true;
    }

    // =========================================================================
    // 8. BOSS ARMOR, SMART NPC BOSS UPGRADES & INPUT HANDLING
    // =========================================================================
    function damagePlayerBoss(dmg, textColor = '#f43f5e', suffix = '', hitAngle = null) {
      if (!state.player.alive) return;
      state.player.hitFlashTimer = 0.15;

      let remainingDmg = dmg;
      let absorbed = 0;
      if (state.player.armor > 0) {
        absorbed = Math.min(state.player.armor, remainingDmg);
        state.player.armor -= absorbed;
        remainingDmg -= absorbed;
      }

      if (remainingDmg > 0) {
        state.player.hp -= remainingDmg;
      }

      const isKill = state.player.hp <= 0 && state.player.alive;
      if (remainingDmg > 0) {
        spawnBloodSplash(state.player.x, state.player.y, 1.35, isKill, hitAngle);
      } else {
        spawnSparks(state.player.x, state.player.y - 12);
      }

      if (absorbed > 0 && remainingDmg === 0) {
        addFloatingText(state.player.x, state.player.y - 30, `-${absorbed} 🛡️`, '#38bdf8');
      } else if (absorbed > 0 && remainingDmg > 0) {
        addFloatingText(state.player.x, state.player.y - 30, `-${absorbed}🛡️ -${remainingDmg} ${suffix}`, '#f43f5e');
      } else {
        addFloatingText(state.player.x, state.player.y - 30, `-${remainingDmg} ${suffix}`.trim(), textColor);
      }

      if (absorbed > 0 && state.player.armor <= 0) {
        state.player.armor = 0;
        addFloatingText(state.player.x, state.player.y - 44, 'ARMOR BROKEN!', '#7dd3fc');
      }

      if (isKill) {
        spawnDeadBody(state.player.x, state.player.y, Faction.PLAYER, UnitRank.BOSS, state.player.facing, hitAngle ?? state.player.facing);
        sfx.playDeath(true, state.player.x, state.player.y);
        eliminateFaction(Faction.PLAYER);
      }
    }

    function executeBuyArmorForFaction(faction) {
      if (!state.factionAlive[faction]) return false;
      if (faction === Faction.PLAYER) {
        if (!state.player.alive || state.player.armorCooldown > 0 || state.player.armor >= MAX_BOSS_ARMOR) return false;
        if (state.treasuries[Faction.PLAYER] < COST_BOSS_ARMOR) return false;
        state.treasuries[Faction.PLAYER] -= COST_BOSS_ARMOR;
        state.player.armor = MAX_BOSS_ARMOR;
        state.player.armorCooldown = state.tickDuration;
        sfx.playArmorEquip(state.player.x, state.player.y);
        addFloatingText(state.player.x, state.player.y - 34, `+${MAX_BOSS_ARMOR} ARMOR 🛡️`, '#38bdf8');
        return true;
      } else {
        const bossNpc = state.npcs.find((n) => n.faction === faction && n.rank === UnitRank.BOSS);
        if (!bossNpc || (bossNpc.armorCooldown || 0) > 0 || (bossNpc.armor || 0) >= MAX_BOSS_ARMOR) return false;
        if (state.treasuries[faction] < COST_BOSS_ARMOR) return false;
        state.treasuries[faction] -= COST_BOSS_ARMOR;
        bossNpc.armor = MAX_BOSS_ARMOR;
        bossNpc.armorCooldown = state.tickDuration;
        sfx.playArmorEquip(bossNpc.x, bossNpc.y);
        addFloatingText(bossNpc.x, bossNpc.y - 34, `+${MAX_BOSS_ARMOR} ARMOR 🛡️`, '#38bdf8');
        return true;
      }
    }

    function buyBossArmor() {
      getAudioCtx();
      if (!state.gameStarted) return;
      if (typeof mpNet !== 'undefined' && mpNet.isGuest()) {
        if (!isLocalBossAlive()) {
          showToast('Your Boss must be alive to equip armor!');
          return;
        }
        mpNet.sendCommand({ cmd: 'BUY_ARMOR' });
        return;
      }
      if (!state.player.alive || !state.factionAlive[Faction.PLAYER]) {
        showToast('Your Boss must be alive to equip armor!');
        return;
      }
      if (state.player.armorCooldown > 0) {
        showToast(`Armor restock on cooldown (${state.player.armorCooldown.toFixed(1)}s until next tick)!`);
        return;
      }
      if (state.player.armor >= MAX_BOSS_ARMOR) {
        showToast(`Kevlar Armor is already at full capacity (${MAX_BOSS_ARMOR} HP)!`);
        return;
      }
      if (state.treasuries[Faction.PLAYER] < COST_BOSS_ARMOR) {
        showToast(`Need $${COST_BOSS_ARMOR.toLocaleString()} for Boss Kevlar Armor!`);
        return;
      }

      if (executeBuyArmorForFaction(Faction.PLAYER)) {
        showToast(`Equipped Kevlar Armor! Next purchase available in ${state.tickDuration}s.`);
        updateHUD();
      }
    }

    function tryBuyNpcBossArmor(bossNpc, nearbyEnemies = 0, nearbyAllies = 0) {
      if (!bossNpc || bossNpc.rank !== UnitRank.BOSS || bossNpc.humanPeerId) return false;
      const faction = bossNpc.faction;
      if (!state.factionAlive[faction]) return false;
      if ((bossNpc.armorCooldown || 0) > 0) return false;
      if (state.treasuries[faction] < COST_BOSS_ARMOR) return false;

      const currentArmor = bossNpc.armor || 0;
      const isHpWounded = bossNpc.hp < bossNpc.maxHp * 0.85;
      const isUnderThreat = nearbyEnemies > 0;
      const isOutnumbered = nearbyEnemies > nearbyAllies;

      const needsSurvivalRefresh = (isHpWounded || isUnderThreat || isOutnumbered) && currentArmor < 80;
      const needsInitialVest = currentArmor === 0;

      if (!needsSurvivalRefresh && !needsInitialVest) return false;

      state.treasuries[faction] -= COST_BOSS_ARMOR;
      bossNpc.armor = MAX_BOSS_ARMOR;
      bossNpc.armorCooldown = state.tickDuration;
      sfx.playArmorEquip(bossNpc.x, bossNpc.y);
      addFloatingText(bossNpc.x, bossNpc.y - 36, `+${MAX_BOSS_ARMOR} ARMOR 🛡️`, '#38bdf8');
      return true;
    }


    function updateHumanControlledRivalBoss(bossNpc, dt) {
      const peerInput = typeof mpNet !== 'undefined' ? mpNet.getPeerInput(bossNpc.humanPeerId) : null;
      let moveX = peerInput ? peerInput.mx : 0;
      let moveY = peerInput ? peerInput.my : 0;
      const wantsSprint = peerInput ? peerInput.sprint : false;

      if (moveX !== 0 || moveY !== 0) {
        bossNpc.targetX = null;
        bossNpc.targetY = null;
        const len = Math.hypot(moveX, moveY);
        moveX /= len;
        moveY /= len;
      } else if (bossNpc.targetX !== null && bossNpc.targetY !== null) {
        const dx = bossNpc.targetX - bossNpc.x;
        const dy = bossNpc.targetY - bossNpc.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 6) {
          bossNpc.targetX = null;
          bossNpc.targetY = null;
        } else {
          moveX = dx / dist;
          moveY = dy / dist;
          bossNpc.facing = Math.atan2(moveY, moveX);
        }
      }

      if (peerInput && typeof peerInput.facing === 'number') {
        bossNpc.facing = peerInput.facing;
      }

      const bRadius = getEntityCollisionRadius(UnitRank.BOSS);
      const pushingCrew = isPushingFriendly(bossNpc.x, bossNpc.y, bRadius, bossNpc.faction, bossNpc.id, false);
      const sprintMult = updateNpcBossSprint(bossNpc, wantsSprint && (moveX !== 0 || moveY !== 0), dt);
      const currentSpeed = (pushingCrew ? bossNpc.speed * 0.45 : bossNpc.speed) * sprintMult;

      if (moveX !== 0) {
        const nextX = bossNpc.x + moveX * currentSpeed * dt;
        if (canOccupyPosition(nextX, bossNpc.y, bRadius, bossNpc.id, false, bossNpc.faction)) {
          bossNpc.x = nextX;
        }
      }
      if (moveY !== 0) {
        const nextY = bossNpc.y + moveY * currentSpeed * dt;
        if (canOccupyPosition(bossNpc.x, nextY, bRadius, bossNpc.id, false, bossNpc.faction)) {
          bossNpc.y = nextY;
        }
      }

      const bTile = state.world.worldToTile(bossNpc.x, bossNpc.y);
      const currentChunk = state.world.getChunk(bTile.cx, bTile.cy);
      if (progressCapture(currentChunk, bossNpc.faction, dt, getCaptureRate(UnitRank.BOSS))) {
        onChunkCaptured(currentChunk, bossNpc.faction);
      }
    }

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

    // =========================================================================
    // 9. SIMULATION UPDATE (PLAYER, AI STEERING, COMBAT, HOURLY TICK)
    // =========================================================================


    function updateSpectatorCamera(dt) {
      let mx = 0;
      let my = 0;
      if (state.keys.has('w') || state.keys.has('arrowup')) my -= 1;
      if (state.keys.has('s') || state.keys.has('arrowdown')) my += 1;
      if (state.keys.has('a') || state.keys.has('arrowleft')) mx -= 1;
      if (state.keys.has('d') || state.keys.has('arrowright')) mx += 1;
      if (mx !== 0 || my !== 0) {
        const len = Math.hypot(mx, my);
        const panSpeed = state.keys.has('shift') ? 820 : 480;
        state.camera.x += (mx / len) * panSpeed * dt;
        state.camera.y += (my / len) * panSpeed * dt;
      }
    }


    function update(dt) {
      if (!state.gameStarted) return;

      if (typeof mpNet !== 'undefined' && mpNet.isGuest()) {
        mpNet.updateGuest(dt);
        updateVisualParticles(dt);

        const localBoss = getLocalBoss();
        if (localBoss && isLocalBossAlive() && !state.isSpectating) {
          state.camera.x += (localBoss.x - state.camera.x) * Math.min(1, dt * 12);
          state.camera.y += (localBoss.y - state.camera.y) * Math.min(1, dt * 12);
        } else {
          updateSpectatorCamera(dt);
        }

        state.tickTimer += dt;
        if (state.tickTimer >= state.tickDuration) state.tickTimer %= state.tickDuration;
        state.hudUpdateTimer += dt;
        if (state.hudUpdateTimer >= 0.25) {
          state.hudUpdateTimer = 0;
          updateHUD();
        }
        return;
      }

      state.astarBudgetThisFrame = 0;
      rebuildSpatialBuckets();
      updateVisualParticles(dt);

      if (state.player.attackCooldown > 0) state.player.attackCooldown = Math.max(0, state.player.attackCooldown - dt);
      if (state.player.slashAnimTimer > 0) state.player.slashAnimTimer = Math.max(0, state.player.slashAnimTimer - dt);
      if (state.player.muzzleFlashTimer > 0) state.player.muzzleFlashTimer = Math.max(0, state.player.muzzleFlashTimer - dt);
      if (state.player.hitFlashTimer > 0) state.player.hitFlashTimer = Math.max(0, state.player.hitFlashTimer - dt);
      if (state.player.armorCooldown > 0) state.player.armorCooldown = Math.max(0, state.player.armorCooldown - dt);

      if (state.player.alive) {
        let moveX = 0;
        let moveY = 0;
        if (state.keys.has('w') || state.keys.has('arrowup')) moveY -= 1;
        if (state.keys.has('s') || state.keys.has('arrowdown')) moveY += 1;
        if (state.keys.has('a') || state.keys.has('arrowleft')) moveX -= 1;
        if (state.keys.has('d') || state.keys.has('arrowright')) moveX += 1;

        if (moveX !== 0 || moveY !== 0) {
          state.player.targetX = null;
          state.player.targetY = null;
          const len = Math.hypot(moveX, moveY);
          moveX /= len;
          moveY /= len;
        } else if (state.player.targetX !== null && state.player.targetY !== null) {
          const dx = state.player.targetX - state.player.x;
          const dy = state.player.targetY - state.player.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 6) {
            state.player.targetX = null;
            state.player.targetY = null;
          } else {
            moveX = dx / dist;
            moveY = dy / dist;
            state.player.facing = Math.atan2(moveY, moveX);
          }
        }

        if (state.mouse.inside && canvas.width > 0) {
          const rect = canvas.getBoundingClientRect();
          const aimWx = state.camera.x - rect.width / 2 + state.mouse.screenX;
          const aimWy = state.camera.y - rect.height / 2 + state.mouse.screenY;
          state.player.facing = Math.atan2(aimWy - state.player.y, aimWx - state.player.x);
        } else if (moveX !== 0 || moveY !== 0) {
          state.player.facing = Math.atan2(moveY, moveX);
        }

        const isMoving = moveX !== 0 || moveY !== 0;
        const wantsSprint = state.keys.has('shift') && isMoving;
        if (state.player.sprintCooldown > 0) {
          state.player.sprintCooldown = Math.max(0, state.player.sprintCooldown - dt);
          state.player.isSprinting = false;
        } else if (wantsSprint) {
          state.player.isSprinting = true;
          state.player.sprintTimer += dt;
          if (state.player.sprintTimer >= SPRINT_MAX_DURATION) {
            state.player.isSprinting = false;
            state.player.sprintTimer = 0;
            state.player.sprintCooldown = SPRINT_COOLDOWN_DURATION;
          }
        } else {
          if (state.player.isSprinting && state.player.sprintTimer > 0) {
            state.player.sprintCooldown = SPRINT_COOLDOWN_DURATION * (state.player.sprintTimer / SPRINT_MAX_DURATION);
          }
          state.player.isSprinting = false;
          state.player.sprintTimer = 0;
        }

        const pRad = getEntityCollisionRadius(UnitRank.BOSS);
        const pushingCrew = isPushingFriendly(state.player.x, state.player.y, pRad, Faction.PLAYER, -1, true);
        const sprintMult = state.player.isSprinting ? SPRINT_SPEED_MULTIPLIER : 1.0;
        const currentSpeed = (pushingCrew ? state.player.speed * 0.45 : state.player.speed) * sprintMult;

        if (moveX !== 0) {
          const nx = state.player.x + moveX * currentSpeed * dt;
          if (canOccupyPosition(nx, state.player.y, pRad, -1, true, Faction.PLAYER)) {
            state.player.x = nx;
          }
        }
        if (moveY !== 0) {
          const ny = state.player.y + moveY * currentSpeed * dt;
          if (canOccupyPosition(state.player.x, ny, pRad, -1, true, Faction.PLAYER)) {
            state.player.y = ny;
          }
        }

        const pTile = state.world.worldToTile(state.player.x, state.player.y);
        const pChunk = state.world.getChunk(pTile.cx, pTile.cy);
        if (progressCapture(pChunk, Faction.PLAYER, dt, getCaptureRate(UnitRank.BOSS))) {
          onChunkCaptured(pChunk, Faction.PLAYER);
        }

        state.camera.x += (state.player.x - state.camera.x) * Math.min(1, dt * 12);
        state.camera.y += (state.player.y - state.camera.y) * Math.min(1, dt * 12);
      } else {
        updateSpectatorCamera(dt);
      }

      // Update NPCs & Human-Controlled Rival Bosses
      for (let i = state.npcs.length - 1; i >= 0; i--) {
        const u = state.npcs[i];
        if (!u) continue;

        if (u.attackCooldown > 0) u.attackCooldown = Math.max(0, u.attackCooldown - dt);
        if (u.slashAnimTimer > 0) u.slashAnimTimer = Math.max(0, u.slashAnimTimer - dt);
        if (u.muzzleFlashTimer > 0) u.muzzleFlashTimer = Math.max(0, u.muzzleFlashTimer - dt);
        if (u.hitFlashTimer > 0) u.hitFlashTimer = Math.max(0, u.hitFlashTimer - dt);
        if (u.armorCooldown > 0) u.armorCooldown = Math.max(0, u.armorCooldown - dt);

        if (u.rank === UnitRank.BOSS && u.humanPeerId) {
          updateHumanControlledRivalBoss(u, dt);
          continue;
        }

        u.aiTimer -= dt;
        u.pathTimer -= dt;

        // Scan nearby entities in 3x3 chunk neighborhood
        const uCx = Math.floor(u.x / CHUNK_PX);
        const uCy = Math.floor(u.y / CHUNK_PX);
        let nearestEnemy = null;
        let nearestEnemyDist = Infinity;
        let nearbyEnemyCount = 0;
        let nearbyAllyCount = 0;

        if (state.player.alive && state.player.faction !== u.faction && u.faction !== Faction.PLAYER) {
          const d = Math.hypot(state.player.x - u.x, state.player.y - u.y);
          if (d < 420) nearbyEnemyCount++;
          if (d < nearestEnemyDist) {
            nearestEnemyDist = d;
            nearestEnemy = { isPlayer: true, entity: state.player, x: state.player.x, y: state.player.y };
          }
        }

        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const bucket = state.spatialBuckets.get(packChunkKey(uCx + dx, uCy + dy));
            if (!bucket) continue;
            for (let b = 0; b < bucket.length; b++) {
              const other = bucket[b];
              if (other.id === u.id) continue;
              const d = Math.hypot(other.x - u.x, other.y - u.y);
              if (other.faction === u.faction) {
                if (d < 360) nearbyAllyCount++;
              } else {
                if (d < 420) nearbyEnemyCount++;
                if (d < nearestEnemyDist) {
                  nearestEnemyDist = d;
                  nearestEnemy = { isPlayer: false, entity: other, x: other.x, y: other.y };
                }
              }
            }
          }
        }

        if (u.rank === UnitRank.BOSS) {
          tryBuyNpcBossArmor(u, nearbyEnemyCount, nearbyAllyCount);
        }

        const isRangedShooter = u.rank === UnitRank.BOSS || u.rank === UnitRank.UNDERBOSS;
        const aggroRange = isRangedShooter ? 680 : 480;

        if (nearestEnemy && nearestEnemyDist <= aggroRange) {
          u.goalX = nearestEnemy.x;
          u.goalY = nearestEnemy.y;

          if (nearestEnemyDist <= 46) {
            u.facing = Math.atan2(nearestEnemy.y - u.y, nearestEnemy.x - u.x);
            if (u.rank === UnitRank.BOSS) {
              performBossKnifeSlash(u);
            } else if (u.attackCooldown <= 0) {
              u.attackCooldown = UNIT_ATTACK_COOLDOWN;
              u.slashAnimTimer = 0.18;
              spawnSlashArc(u.x, u.y, u.facing, FACTION_META[u.faction].accent);
              sfx.playSlash(true, u.x, u.y);
              const dmg = rollDamage(u.minDmg, u.maxDmg);
              if (nearestEnemy.isPlayer) {
                damagePlayerBoss(dmg, FACTION_META[u.faction].accent, '', u.facing);
              } else {
                applyDamageToNpc(nearestEnemy.entity, dmg, FACTION_META[u.faction].accent, '', u.facing);
              }
            }
          } else if (isRangedShooter && nearestEnemyDist >= 110 && nearestEnemyDist <= 640 && u.attackCooldown <= 0) {
            performBossPistolShot(u, false, nearestEnemy.x, nearestEnemy.y);
          }
        } else if (u.aiTimer <= 0) {
          u.aiTimer = 1.6 + Math.random() * 1.8;
          // Pick a nearby neutral or enemy chunk to patrol/capture
          let targetChunk = null;
          let bestChunkDist = Infinity;
          for (let cy = uCy - 3; cy <= uCy + 3; cy++) {
            for (let cx = uCx - 3; cx <= uCx + 3; cx++) {
              const c = state.world.getChunk(cx, cy);
              if (!c || c.faction === u.faction) continue;
              const d = Math.hypot((cx + 0.5) * CHUNK_PX - u.x, (cy + 0.5) * CHUNK_PX - u.y);
              if (d < bestChunkDist) {
                bestChunkDist = d;
                targetChunk = c;
              }
            }
          }
          if (!targetChunk) {
            for (const c of state.world.chunks.values()) {
              if (c.faction !== u.faction) {
                targetChunk = c;
                break;
              }
            }
          }
          if (targetChunk) {
            const gx = targetChunk.cx * CHUNK_PX + (1 + Math.floor(Math.random() * (CHUNK_SIZE - 2)) + 0.5) * TILE_SIZE;
            const gy = targetChunk.cy * CHUNK_PX + (1 + Math.floor(Math.random() * (CHUNK_SIZE - 2)) + 0.5) * TILE_SIZE;
            const snapped = state.world.findNearestWalkablePoint(gx, gy, u.bodyRadius);
            if (snapped) {
              u.goalX = snapped.x;
              u.goalY = snapped.y;
            }
          }
        }

        // Steering / A* movement
        const distToGoal = Math.hypot(u.goalX - u.x, u.goalY - u.y);
        if (distToGoal > 28) {
          if ((!u.path || u.path.length === 0 || u.pathTimer <= 0) && state.astarBudgetThisFrame < MAX_ASTAR_PER_FRAME) {
            state.astarBudgetThisFrame++;
            u.pathTimer = 0.85 + Math.random() * 0.45;
            u.path = computeTilePath(state.world, u.x, u.y, u.goalX, u.goalY, 160);
          }

          let steerX = u.goalX;
          let steerY = u.goalY;
          if (u.path && u.path.length > 0) {
            steerX = u.path[0].x;
            steerY = u.path[0].y;
            if (Math.hypot(steerX - u.x, steerY - u.y) < 18) {
              u.path.shift();
              if (u.path.length > 0) {
                steerX = u.path[0].x;
                steerY = u.path[0].y;
              }
            }
          }

          const angle = Math.atan2(steerY - u.y, steerX - u.x);
          u.facing = angle;
          const vx = Math.cos(angle);
          const vy = Math.sin(angle);
          const pushingCrew = isPushingFriendly(u.x, u.y, u.bodyRadius, u.faction, u.id, false);
          const spd = pushingCrew ? u.speed * 0.45 : u.speed;

          let moved = false;
          const nx = u.x + vx * spd * dt;
          if (canOccupyPosition(nx, u.y, u.bodyRadius, u.id, false, u.faction)) {
            u.x = nx;
            moved = true;
          }
          const ny = u.y + vy * spd * dt;
          if (canOccupyPosition(u.x, ny, u.bodyRadius, u.id, false, u.faction)) {
            u.y = ny;
            moved = true;
          }
          if (!moved) {
            const perpAngle = angle + (Math.PI / 2) * u.dodgeDir;
            const px = u.x + Math.cos(perpAngle) * spd * dt;
            const py = u.y + Math.sin(perpAngle) * spd * dt;
            if (canOccupyPosition(px, py, u.bodyRadius, u.id, false, u.faction)) {
              u.x = px;
              u.y = py;
            }
          }
        }

        // Territory capture by NPCs
        const uTile = state.world.worldToTile(u.x, u.y);
        const uChunk = state.world.getChunk(uTile.cx, uTile.cy);
        if (progressCapture(uChunk, u.faction, dt, getCaptureRate(u.rank))) {
          onChunkCaptured(uChunk, u.faction);
        }
      }

      // Hourly Economy & Auto-Recruitment Tick
      state.tickTimer += dt;
      if (state.tickTimer >= state.tickDuration) {
        state.tickTimer -= state.tickDuration;
        processHourlyTick();
      }

      state.hudUpdateTimer += dt;
      if (state.hudUpdateTimer >= 0.25) {
        state.hudUpdateTimer = 0;
        updateHUD();
      }

      if (typeof mpNet !== 'undefined' && mpNet.isHost()) {
        mpNet.updateHost(dt);
      }
    }

    // =========================================================================
    // 10. RENDERING ENGINE (BUILDINGS, PROPS, DIRECTIONAL CHARACTERS, CORPSES)
    // =========================================================================
    function drawBuilding(item) {
      const { wx, wy, elev, style, hasSouthBuilding, hasEastBuilding, hasWestBuilding } = item;
      const wallHeight = elev * 10;
      const roofY = wy - wallHeight;

      if (!hasSouthBuilding) {
        ctx.fillStyle = style === 0 ? '#1e293b' : style === 1 ? '#292524' : '#1f2937';
        ctx.fillRect(wx, wy + TILE_SIZE - wallHeight, TILE_SIZE, wallHeight);

        ctx.fillStyle = 'rgba(253, 224, 71, 0.28)';
        for (let wyOff = 6; wyOff < wallHeight - 4; wyOff += 10) {
          ctx.fillRect(wx + 8, wy + TILE_SIZE - wallHeight + wyOff, 8, 5);
          ctx.fillRect(wx + 26, wy + TILE_SIZE - wallHeight + wyOff, 8, 5);
        }
      }

      ctx.fillStyle = style === 0 ? '#334155' : style === 1 ? '#44403c' : '#374151';
      ctx.fillRect(wx, roofY, TILE_SIZE, TILE_SIZE);

      ctx.strokeStyle = 'rgba(15, 23, 42, 0.55)';
      ctx.lineWidth = 1.5;
      if (!hasEastBuilding) {
        ctx.beginPath();
        ctx.moveTo(wx + TILE_SIZE, roofY);
        ctx.lineTo(wx + TILE_SIZE, roofY + TILE_SIZE);
        ctx.stroke();
      }
      if (!hasWestBuilding) {
        ctx.beginPath();
        ctx.moveTo(wx, roofY);
        ctx.lineTo(wx, roofY + TILE_SIZE);
        ctx.stroke();
      }
    }

    function drawProp(item) {
      const { wx, wy, prop, color, vertical, curbSide } = item;
      if (prop === PropType.CAR) {
        const rx = vertical ? (curbSide === 'W' ? wx + 21 : wx + 5) : wx + 5;
        const ry = vertical ? wy + 5 : (curbSide === 'N' ? wy + 21 : wy + 5);
        const rw = vertical ? 18 : 34;
        const rh = vertical ? 34 : 18;

        ctx.fillStyle = 'rgba(0,0,0,0.42)';
        ctx.fillRect(rx + 2, ry + 3, rw, rh);

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(rx, ry, rw, rh, 4);
        ctx.fill();

        ctx.fillStyle = 'rgba(148, 163, 184, 0.45)';
        if (vertical) {
          ctx.fillRect(rx + 3, ry + 6, rw - 6, 6);
          ctx.fillRect(rx + 3, ry + rh - 11, rw - 6, 5);
        } else {
          ctx.fillRect(rx + 6, ry + 3, 6, rh - 6);
          ctx.fillRect(rx + rw - 11, ry + 3, 5, rh - 6);
        }
      } else if (prop === PropType.DUMPSTER) {
        ctx.fillStyle = 'rgba(0,0,0,0.38)';
        ctx.fillRect(wx + 11, wy + 13, 26, 22);
        ctx.fillStyle = '#14532d';
        ctx.fillRect(wx + 9, wy + 10, 26, 22);
        ctx.fillStyle = '#09090b';
        ctx.fillRect(wx + 10, wy + 11, 24, 6);
      } else if (prop === PropType.STREETLIGHT) {
        ctx.fillStyle = '#52525b';
        ctx.fillRect(wx + 20, wy + 4, 4, 24);
        ctx.fillStyle = '#fef08a';
        ctx.beginPath();
        ctx.arc(wx + 22, wy + 4, 3.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (prop === PropType.TREE) {
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.ellipse(wx + 22, wy + 28, 11, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#713f12';
        ctx.fillRect(wx + 20, wy + 16, 4, 12);
        ctx.fillStyle = '#15803d';
        ctx.beginPath();
        ctx.arc(wx + 22, wy + 13, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#166534';
        ctx.beginPath();
        ctx.arc(wx + 19, wy + 11, 7, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function drawDeadBody(body) {
      const alpha = Math.min(1, body.life / 2.5);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(body.x, body.y);

      // Expanding dark crimson blood pool beneath fallen body
      ctx.fillStyle = 'rgba(127, 29, 29, 0.82)';
      ctx.beginPath();
      ctx.ellipse(body.collapseDir * 3, 2, body.poolRadius, body.poolRadius * 0.56, body.tiltAngle, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = 'rgba(69, 10, 10, 0.9)';
      ctx.beginPath();
      ctx.ellipse(body.collapseDir * 2, 2, body.poolRadius * 0.62, body.poolRadius * 0.34, body.tiltAngle, 0, Math.PI * 2);
      ctx.fill();

      // Sideways collapsed character silhouette
      ctx.save();
      ctx.rotate(body.collapseDir * (Math.PI * 0.46) + body.tiltAngle);

      // Legs
      ctx.fillStyle = '#09090b';
      ctx.fillRect(-5, 3, 4, 12);
      ctx.fillRect(1, 3, 4, 12);

      // Suit torso
      ctx.fillStyle = body.coatColor;
      ctx.beginPath();
      ctx.roundRect(-8, -11, 16, 16, 4);
      ctx.fill();

      // Shirt & tie
      ctx.fillStyle = '#e4e4e7';
      ctx.fillRect(-2, -10, 4, 9);
      ctx.fillStyle = body.accentColor;
      ctx.fillRect(-1, -9, 2, 7);

      // Head with closed eyes
      ctx.fillStyle = '#eab38f';
      ctx.beginPath();
      ctx.arc(0, -17, 6.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#18181b';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-3.2, -17);
      ctx.lineTo(-1.0, -17);
      ctx.moveTo(1.0, -17);
      ctx.lineTo(3.2, -17);
      ctx.stroke();

      ctx.restore();

      // Knocked-off fedora hat resting nearby on the asphalt
      const hatX = -body.collapseDir * 17;
      const hatY = 5;
      ctx.fillStyle = body.isBoss ? '#18181b' : '#27272a';
      ctx.beginPath();
      ctx.ellipse(hatX, hatY, 8, 3.2, -0.25 * body.collapseDir, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(hatX - 4.5, hatY - 4.5, 9, 4.5);
      ctx.fillStyle = body.accentColor;
      ctx.fillRect(hatX - 4.5, hatY - 1.5, 9, 1.5);

      ctx.restore();
    }

    function drawCharacter(x, y, config) {
      const {
        coatColor,
        accentColor,
        label,
        hp,
        maxHp,
        armor = 0,
        maxArmor = 0,
        facing = 0,
        isBoss = false,
        isUnderboss = false,
        isCaptain = false,
        isAttacking = false,
        slashProgress = 0,
        isShooting = false,
        hitFlash = false,
      } = config;

      const cosF = Math.cos(facing);
      const sinF = Math.sin(facing);
      const facingUp = sinF < -0.45;
      const horizShift = Math.max(-1, Math.min(1, cosF));

      ctx.save();
      ctx.translate(x, y);

      // Ground contact shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
      ctx.beginPath();
      ctx.ellipse(0, 2, isBoss ? 13 : 11, 5.5, 0, 0, Math.PI * 2);
      ctx.fill();

      // Legs
      ctx.fillStyle = '#09090b';
      ctx.fillRect(-5.5, -10, 4.5, 11);
      ctx.fillRect(1, -10, 4.5, 11);

      // Suit coat torso
      ctx.fillStyle = hitFlash ? '#ffffff' : coatColor;
      ctx.beginPath();
      ctx.roundRect(-9.5, -26, 19, 18, 5);
      ctx.fill();

      // Kevlar vest overlay if armored
      if (armor > 0) {
        ctx.fillStyle = 'rgba(14, 165, 233, 0.35)';
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.roundRect(-8.5, -25, 17, 14, 3);
        ctx.fill();
        ctx.stroke();
      }

      if (!facingUp) {
        // Shirt & tie shifted horizontally with facing direction
        const lapelX = horizShift * 2.4;
        ctx.fillStyle = '#f4f4f5';
        ctx.beginPath();
        ctx.moveTo(lapelX - 3, -25);
        ctx.lineTo(lapelX + 3, -25);
        ctx.lineTo(lapelX, -14);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = accentColor;
        ctx.fillRect(lapelX - 1, -24, 2, 9);
      } else {
        // Back coat center seam when moving away (up)
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(0, -24);
        ctx.lineTo(0, -9);
        ctx.stroke();
      }

      // Head
      ctx.fillStyle = hitFlash ? '#ffffff' : '#f1c29b';
      ctx.beginPath();
      ctx.arc(0, -31.5, 6.8, 0, Math.PI * 2);
      ctx.fill();

      // Coherent Directional Eyes (Right -> right, Left -> left, Down -> center, Up -> hidden)
      if (!facingUp) {
        const eyeOffsetX = horizShift * 2.5;
        const eyeY = -31.2 + Math.max(0, sinF) * 0.8;

        // Eye whites
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(eyeOffsetX - 2.2, eyeY, 1.45, 1.15, 0, 0, Math.PI * 2);
        ctx.ellipse(eyeOffsetX + 2.2, eyeY, 1.45, 1.15, 0, 0, Math.PI * 2);
        ctx.fill();

        // Dark pupils tracking look direction
        const pupilShiftX = horizShift * 0.55;
        ctx.fillStyle = '#09090b';
        ctx.beginPath();
        ctx.arc(eyeOffsetX - 2.2 + pupilShiftX, eyeY, 0.85, 0, Math.PI * 2);
        ctx.arc(eyeOffsetX + 2.2 + pupilShiftX, eyeY, 0.85, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Back of hair when facing up
        ctx.fillStyle = '#18181b';
        ctx.beginPath();
        ctx.arc(0, -31.2, 6.6, Math.PI * 0.1, Math.PI * 0.9);
        ctx.fill();
      }

      // Fedora Hat (Bosses & Lieutenants)
      if (isBoss || isUnderboss || isCaptain) {
        ctx.fillStyle = isBoss ? '#09090b' : '#18181b';
        ctx.beginPath();
        ctx.ellipse(0, -36.5, isBoss ? 11.5 : 10, 3.6, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.roundRect(isBoss ? -6.5 : -5.5, -42.5, isBoss ? 13 : 11, 6.5, 2.5);
        ctx.fill();

        ctx.fillStyle = accentColor;
        ctx.fillRect(isBoss ? -6.5 : -5.5, -38.2, isBoss ? 13 : 11, 1.8);
      }

      // Weapon Rendering:
      // Bosses & 2ICs have 9mm Pistol as main weapon, stow it to swing a Machete during slash,
      // and re-equip the pistol immediately after the slash completes.
      const hasPistolMain = isBoss || isUnderboss;
      if (isAttacking) {
        // Sweep machete coherently along the exact slash arc (facing - 0.95 -> facing + 0.95)
        const swingAngle = facing - 0.95 + slashProgress * 1.9;
        ctx.save();
        ctx.translate(0, -17);
        ctx.rotate(swingAngle);

        // Subtle thin curved blade trail
        ctx.strokeStyle = 'rgba(244, 63, 94, 0.52)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(0, 0, 21, -0.55, 0.08);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
        ctx.lineWidth = 1.0;
        ctx.beginPath();
        ctx.arc(0, 0, 22.5, -0.45, 0.05);
        ctx.stroke();

        // Machete grip & broad steel blade
        ctx.fillStyle = '#451a03';
        ctx.fillRect(6, -1.5, 5, 3);
        ctx.fillStyle = '#e4e4e7';
        ctx.beginPath();
        ctx.moveTo(11, -1.6);
        ctx.lineTo(24, -2.4);
        ctx.lineTo(26, 0.5);
        ctx.lineTo(11, 1.6);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else if (hasPistolMain) {
        // 9mm Pistol equipped in hand
        ctx.save();
        ctx.translate(0, -17);
        ctx.rotate(facing);
        ctx.fillStyle = '#27272a';
        ctx.fillRect(7, -1.8, 10, 3.4);
        ctx.fillStyle = '#71717a';
        ctx.fillRect(8, -1.3, 8, 1.2);
        if (isShooting) {
          ctx.fillStyle = '#fef08a';
          ctx.beginPath();
          ctx.arc(19, 0, 4.2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      } else {
        // Switchblade / bat ready for Captains & Enforcers
        ctx.save();
        ctx.translate(0, -17);
        ctx.rotate(facing);
        ctx.fillStyle = '#d4d4d8';
        ctx.fillRect(7, -1.1, 8, 2.2);
        ctx.restore();
      }

      ctx.restore();

      // Overhead Rank/Boss Label, Armor Bar & HP Bar (anchored cleanly at state.world x, y)
      const hasArmor = armor > 0 && maxArmor > 0;
      const barW = isBoss ? 36 : 28;
      const barH = 3.5;
      const barTopY = y + (hasArmor ? -53 : -48);

      if (hasArmor) {
        ctx.fillStyle = 'rgba(9, 9, 11, 0.85)';
        ctx.fillRect(x - barW / 2 - 1, barTopY - 1, barW + 2, barH + 2);
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(x - barW / 2, barTopY, barW * Math.max(0, Math.min(1, armor / maxArmor)), barH);
      }

      const hpY = hasArmor ? barTopY + 5 : barTopY;
      ctx.fillStyle = 'rgba(9, 9, 11, 0.85)';
      ctx.fillRect(x - barW / 2 - 1, hpY - 1, barW + 2, barH + 2);

      const hpRatio = Math.max(0, Math.min(1, hp / Math.max(1, maxHp)));
      ctx.fillStyle = hpRatio > 0.5 ? '#10b981' : hpRatio > 0.25 ? '#f59e0b' : '#ef4444';
      ctx.fillRect(x - barW / 2, hpY, barW * hpRatio, barH);

      if (label) {
        ctx.font = isBoss ? 'bold 10px Inter, sans-serif' : '700 9px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(9, 9, 11, 0.85)';
        ctx.fillText(label, x + 1, barTopY - 3);
        ctx.fillStyle = isBoss ? '#fef08a' : accentColor;
        ctx.fillText(label, x, barTopY - 4);
      }
    }

    function resizeCanvas() {
      const parent = canvas.parentElement;
      const rect = parent ? parent.getBoundingClientRect() : canvas.getBoundingClientRect();
      const w = Math.max(320, Math.floor(rect.width || window.innerWidth));
      const h = Math.max(240, Math.floor(rect.height || window.innerHeight - 52));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    }
    window.addEventListener('resize', resizeCanvas);

    const renderables = [];

    function render() {
      resizeCanvas();
      const viewW = canvas.width;
      const viewH = canvas.height;
      const camLeft = state.camera.x - viewW / 2;
      const camTop = state.camera.y - viewH / 2;
      const camRight = camLeft + viewW;
      const camBottom = camTop + viewH;

      ctx.fillStyle = '#09090b';
      ctx.fillRect(0, 0, viewW, viewH);

      ctx.save();
      ctx.translate(-camLeft, -camTop);

      const minCx = Math.floor(camLeft / CHUNK_PX) - 1;
      const maxCx = Math.floor(camRight / CHUNK_PX) + 1;
      const minCy = Math.floor(camTop / CHUNK_PX) - 1;
      const maxCy = Math.floor(camBottom / CHUNK_PX) + 1;

      renderables.length = 0;

      // 1. Ground tiles + Faction territory overlays & borders
      for (let cy = minCy; cy <= maxCy; cy++) {
        for (let cx = minCx; cx <= maxCx; cx++) {
          const chunk = state.world.getChunk(cx, cy);
          if (!chunk) continue;
          const ox = cx * CHUNK_PX;
          const oy = cy * CHUNK_PX;

          chunk.drawGroundDirect(ctx, ox, oy, camLeft, camRight, camTop, camBottom);

          const meta = FACTION_META[chunk.faction] || FACTION_META[Faction.NEUTRAL];
          if (chunk.faction !== Faction.NEUTRAL) {
            ctx.fillStyle = meta.tint;
            ctx.fillRect(ox, oy, CHUNK_PX, CHUNK_PX);
          }

          if (state.showBorders) {
            ctx.strokeStyle = meta.border;
            ctx.lineWidth = chunk.faction === Faction.NEUTRAL ? 1 : 2.2;
            ctx.strokeRect(ox + 1, oy + 1, CHUNK_PX - 2, CHUNK_PX - 2);
          }

          // Capture progress bar in chunk center
          if (chunk.captureProgress > 0 && chunk.capturingFaction) {
            const capMeta = FACTION_META[chunk.capturingFaction];
            const bx = ox + CHUNK_PX / 2 - 44;
            const by = oy + 14;
            ctx.fillStyle = 'rgba(9, 9, 11, 0.85)';
            ctx.fillRect(bx, by, 88, 7);
            ctx.fillStyle = capMeta.badge;
            ctx.fillRect(bx + 1, by + 1, 86 * Math.min(1, chunk.captureProgress), 5);
          }

          for (let i = 0; i < chunk.buildingRenderList.length; i++) {
            const b = chunk.buildingRenderList[i];
            if (b.wx + TILE_SIZE >= camLeft && b.wx <= camRight && b.wy + TILE_SIZE >= camTop && b.wy - 44 <= camBottom) {
              renderables.push(b);
            }
          }
          for (let i = 0; i < chunk.propRenderList.length; i++) {
            const p = chunk.propRenderList[i];
            if (p.wx + TILE_SIZE >= camLeft && p.wx <= camRight && p.wy + TILE_SIZE >= camTop && p.wy - 30 <= camBottom) {
              renderables.push(p);
            }
          }
        }
      }

      // 2. Ground blood decals & persistent dead bodies
      for (let i = 0; i < bloodDecals.length; i++) {
        const d = bloodDecals[i];
        if (d.x < camLeft - 40 || d.x > camRight + 40 || d.y < camTop - 40 || d.y > camBottom + 40) continue;
        ctx.save();
        ctx.globalAlpha = Math.min(1, d.life / 3.0);
        ctx.fillStyle = d.color;
        ctx.beginPath();
        ctx.ellipse(d.x, d.y, d.rx, d.ry, d.rot, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      for (let i = 0; i < deadBodies.length; i++) {
        const b = deadBodies[i];
        if (b.x < camLeft - 50 || b.x > camRight + 50 || b.y < camTop - 50 || b.y > camBottom + 50) continue;
        drawDeadBody(b);
      }

      // 3. Waypoint marker & 1000px Pistol Range Ring for Local Boss
      const localBoss = getLocalBoss();
      if (localBoss && isLocalBossAlive()) {
        if (localBoss.targetX !== null && localBoss.targetY !== null) {
          ctx.strokeStyle = 'rgba(251, 191, 36, 0.75)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(localBoss.targetX, localBoss.targetY, 10, 0, Math.PI * 2);
          ctx.stroke();
        }

        if (state.mouse.inside) {
          const rect = canvas.getBoundingClientRect();
          const aimWx = state.camera.x - rect.width / 2 + state.mouse.screenX;
          const aimWy = state.camera.y - rect.height / 2 + state.mouse.screenY;
          const aimDist = Math.hypot(aimWx - localBoss.x, aimWy - localBoss.y);
          const accInfo = getPistolAccuracyInfo(aimDist);

          ctx.save();
          ctx.strokeStyle = 'rgba(251, 191, 36, 0.14)';
          ctx.setLineDash([6, 6]);
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(localBoss.x, localBoss.y, MAX_PISTOL_RANGE, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();

          ctx.font = 'bold 10px monospace';
          ctx.textAlign = 'left';
          ctx.fillStyle = accInfo.color;
          ctx.fillText(accInfo.label, aimWx + 12, aimWy - 8);
        }
      }

      // 4. Collect active characters into depth-sorted render list
      if (state.player.alive) {
        renderables.push({ type: 'player', sortY: state.player.y });
      }
      for (let i = 0; i < state.npcs.length; i++) {
        const u = state.npcs[i];
        if (u.x < camLeft - 60 || u.x > camRight + 60 || u.y < camTop - 60 || u.y > camBottom + 60) continue;
        renderables.push({ type: 'npc', sortY: u.y, unit: u });
      }

      renderables.sort((a, b) => a.sortY - b.sortY);

      for (let i = 0; i < renderables.length; i++) {
        const item = renderables[i];
        if (item.type === 'building') {
          drawBuilding(item);
        } else if (item.type === 'prop') {
          drawProp(item);
        } else if (item.type === 'player') {
          const pMeta = FACTION_META[Faction.PLAYER];
          const hostName = typeof mpNet !== 'undefined' && mpNet.isActive() ? mpNet.getAliasForFaction(Faction.PLAYER) : null;
          drawCharacter(state.player.x, state.player.y, {
            coatColor: pMeta.coat,
            accentColor: pMeta.accent,
            label: hostName ? `${hostName} (${pMeta.ranks.BOSS})` : `${pMeta.ranks.BOSS} (YOU)`,
            hp: state.player.hp,
            maxHp: state.player.maxHp,
            armor: state.player.armor,
            maxArmor: state.player.maxArmor,
            facing: state.player.facing,
            isBoss: true,
            isAttacking: state.player.slashAnimTimer > 0,
            slashProgress: state.player.slashAnimTimer > 0 ? 1 - state.player.slashAnimTimer / 0.18 : 0,
            isShooting: state.player.muzzleFlashTimer > 0,
            hitFlash: state.player.hitFlashTimer > 0,
          });
        } else if (item.type === 'npc') {
          const u = item.unit;
          const meta = FACTION_META[u.faction] || FACTION_META[Faction.NEUTRAL];
          const isBoss = u.rank === UnitRank.BOSS;
          const isMyRemoteBoss = isBoss && u.faction === getLocalFaction();
          const alias = isBoss && typeof mpNet !== 'undefined' && mpNet.isActive() ? mpNet.getAliasForFaction(u.faction) : null;
          const rankName = meta.ranks[u.rank] || u.rank;
          const label = isMyRemoteBoss
            ? `${rankName} (YOU)`
            : alias
            ? `${alias} (${rankName})`
            : isBoss
            ? `${meta.short} ${rankName}`
            : rankName;

          drawCharacter(u.x, u.y, {
            coatColor: meta.coat,
            accentColor: meta.accent,
            label,
            hp: u.hp,
            maxHp: u.maxHp,
            armor: u.armor,
            maxArmor: u.maxArmor,
            facing: u.facing,
            isBoss,
            isUnderboss: u.rank === UnitRank.UNDERBOSS,
            isCaptain: u.rank === UnitRank.CAPTAIN,
            isAttacking: u.slashAnimTimer > 0,
            slashProgress: u.slashAnimTimer > 0 ? 1 - u.slashAnimTimer / 0.18 : 0,
            isShooting: u.muzzleFlashTimer > 0,
            hitFlash: u.hitFlashTimer > 0,
          });
        }
      }

      // 5. Subtle residual slash arcs, muzzle blasts, tracers, blood droplets & floating texts
      for (let i = 0; i < slashArcs.length; i++) {
        const s = slashArcs[i];
        const t = Math.max(0, s.life / s.maxLife);
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.facing);
        ctx.globalAlpha = t * 0.45;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(0, 0, 20, -0.75, 0.75);
        ctx.stroke();

        ctx.globalAlpha = t * 0.55;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.arc(0, 0, 22, -0.6, 0.6);
        ctx.stroke();
        ctx.restore();
      }

      for (let i = 0; i < muzzleFlashes.length; i++) {
        const m = muzzleFlashes[i];
        const t = Math.max(0, m.life / m.maxLife);
        ctx.save();
        ctx.translate(m.x, m.y);
        ctx.rotate(m.facing);
        ctx.globalAlpha = t * 0.85;
        ctx.fillStyle = '#fef08a';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(14 * t, -4 * t);
        ctx.lineTo(18 * t, 0);
        ctx.lineTo(14 * t, 4 * t);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      for (let i = 0; i < bulletTracers.length; i++) {
        const tr = bulletTracers[i];
        const alpha = Math.max(0, tr.life / tr.maxLife);
        ctx.save();
        ctx.globalAlpha = alpha * 0.85;
        ctx.strokeStyle = tr.color;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(tr.x1, tr.y1);
        ctx.lineTo(tr.x2, tr.y2);
        ctx.stroke();

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(tr.x1, tr.y1);
        ctx.lineTo(tr.x2, tr.y2);
        ctx.stroke();
        ctx.restore();
      }

      for (let i = 0; i < bloodParticles.length; i++) {
        const p = bloodParticles[i];
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y - p.z * 0.45, p.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      for (let i = 0; i < sparks.length; i++) {
        const s = sparks[i];
        ctx.fillStyle = '#fde047';
        ctx.fillRect(s.x - 1.5, s.y - 1.5, 3, 3);
      }

      for (let i = 0; i < state.floatingTexts.length; i++) {
        const ft = state.floatingTexts[i];
        ctx.save();
        ctx.globalAlpha = Math.min(1, ft.life * 1.4);
        ctx.font = 'bold 11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(9, 9, 11, 0.88)';
        ctx.fillText(ft.text, ft.x + 1, ft.y + 1);
        ctx.fillStyle = ft.color;
        ctx.fillText(ft.text, ft.x, ft.y);
        ctx.restore();
      }

      ctx.restore();
      renderMinimap();
    }

    function renderMinimap() {
      if (state.world.chunks.size === 0) return;

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

      state.minimapCacheTimer += 0.016;
      if (state.minimapCacheTimer >= 0.4) {
        state.minimapCacheTimer = 0;
        minimapCacheCtx.fillStyle = '#09090b';
        minimapCacheCtx.fillRect(0, 0, minimapCacheCanvas.width, minimapCacheCanvas.height);

        for (const chunk of state.world.chunks.values()) {
          const rx = offsetX + (chunk.cx - minCx) * cellSize;
          const ry = offsetY + (chunk.cy - minCy) * cellSize;
          const meta = FACTION_META[chunk.faction] || FACTION_META[Faction.NEUTRAL];
          minimapCacheCtx.fillStyle = chunk.faction === Faction.NEUTRAL ? '#27272a' : meta.badge;
          minimapCacheCtx.fillRect(rx + 0.5, ry + 0.5, Math.max(1, cellSize - 1), Math.max(1, cellSize - 1));
        }
      }

      minimapCtx.drawImage(minimapCacheCanvas, 0, 0);

      // Draw unit & boss dots
      for (let i = 0; i < state.npcs.length; i++) {
        const u = state.npcs[i];
        const mx = offsetX + (u.x / CHUNK_PX - minCx) * cellSize;
        const my = offsetY + (u.y / CHUNK_PX - minCy) * cellSize;
        minimapCtx.fillStyle = u.rank === UnitRank.BOSS ? '#ffffff' : (FACTION_META[u.faction]?.accent || '#a1a1aa');
        const r = u.rank === UnitRank.BOSS ? 2.5 : 1.2;
        minimapCtx.fillRect(mx - r, my - r, r * 2, r * 2);
      }

      if (state.player.alive) {
        const px = offsetX + (state.player.x / CHUNK_PX - minCx) * cellSize;
        const py = offsetY + (state.player.y / CHUNK_PX - minCy) * cellSize;
        minimapCtx.fillStyle = '#fef08a';
        minimapCtx.beginPath();
        minimapCtx.arc(px, py, 2.8, 0, Math.PI * 2);
        minimapCtx.fill();
      }

      // Camera viewport rectangle
      const camLeftCx = (state.camera.x - canvas.width / 2) / CHUNK_PX - minCx;
      const camTopCy = (state.camera.y - canvas.height / 2) / CHUNK_PX - minCy;
      const camW = (canvas.width / CHUNK_PX) * cellSize;
      const camH = (canvas.height / CHUNK_PX) * cellSize;
      minimapCtx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
      minimapCtx.lineWidth = 1;
      minimapCtx.strokeRect(offsetX + camLeftCx * cellSize, offsetY + camTopCy * cellSize, camW, camH);

      const localBoss = getLocalBoss();
      const bTile = state.world.worldToTile(localBoss.x, localBoss.y);
      hudEls.minimapCoords.textContent = `(${bTile.cx}, ${bTile.cy})`;
    }

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
          state.player.x += (pb.x - state.player.x) * 0.45;
          state.player.y += (pb.y - state.player.y) * 0.45;
          state.player.facing = pb.facing;
          state.player.hp = pb.hp;
          state.player.maxHp = pb.maxHp;
          state.player.armor = pb.armor;
          state.player.maxArmor = pb.maxArmor;
          state.player.alive = pb.alive;
          if (pb.slash) state.player.slashAnimTimer = 0.14;
          if (pb.shoot) state.player.muzzleFlashTimer = 0.08;
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
              unit.x += (x - unit.x) * 0.45;
              unit.y += (y - unit.y) * 0.45;
              unit.facing = facing;
              unit.hp = hp;
              unit.maxHp = maxHp;
              unit.armor = armor;
              unit.maxArmor = maxArmor;
              unit.humanPeerId = hPeer || null;
              if (slash) unit.slashAnimTimer = 0.14;
              if (shoot) unit.muzzleFlashTimer = 0.08;
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
        getPeerInput: (peerId) => peers.get(peerId)?.lastInput || null,
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
  

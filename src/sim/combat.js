// Combat: shared damage/armor pipeline, melee slashes, pistol raycast and armor purchases.

import { Faction, UnitRank } from '../config/enums.js';
import { CHUNK_SIZE, TILE_SIZE, MAX_PISTOL_RANGE } from '../config/constants.js';
import { UNIT_ATTACK_COOLDOWN, COST_BOSS_ARMOR, MAX_BOSS_ARMOR } from '../config/balance.js';
import { FACTION_META } from '../config/organizations.js';
import { getPropFootprint, rectContains } from '../world/geometry.js';
import { state, isLocalBossAlive } from '../core/state.js';
import { emit } from '../core/events.js';
import { canOccupyPosition, getEntityCollisionRadius } from './movement.js';
import { eliminateFaction } from './territory.js';


export function rollDamage(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function applyDamageToNpc(target, dmg, textColor = '#fbbf24', suffix = '', hitAngle = null) {
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
  emit('unit:damaged', {
    unit: target,
    amount: dmg,
    absorbed,
    remaining: remainingDmg,
    isKill,
    isPlayer: false,
    hitAngle,
    textColor,
    suffix,
  });

  if (absorbed > 0 && target.armor <= 0) {
    target.armor = 0;
    emit('armor:broken', { unit: target, isPlayer: false });
  }

  if (isKill) {
    const deadIdx = state.npcs.indexOf(target);
    if (deadIdx !== -1) {
      const deadFaction = target.faction;
      const wasBoss = target.rank === UnitRank.BOSS;
      const fallAngle = hitAngle ?? target.facing;
      state.npcs.splice(deadIdx, 1);
      emit('unit:died', {
        unit: target,
        faction: deadFaction,
        rank: target.rank,
        x: target.x,
        y: target.y,
        facing: target.facing,
        fallAngle,
        isBoss: wasBoss,
        isPlayer: false,
      });
      if (wasBoss) {
        eliminateFaction(deadFaction);
      }
    }
  }
  return isKill;
}

export function executeBossSlashForFaction(faction) {
  if (faction === Faction.PLAYER) {
    performKnifeSlash();
    return;
  }
  const bossNpc = state.npcs.find((n) => n.faction === faction && n.rank === UnitRank.BOSS);
  if (!bossNpc || bossNpc.attackCooldown > 0) return;

  bossNpc.attackCooldown = 0.34;
  bossNpc.slashAnimTimer = 0.18;

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
  emit('slash:performed', {
    x: bossNpc.x,
    y: bossNpc.y,
    facing: bossNpc.facing,
    color: FACTION_META[faction].accent,
    hitCount: targets.length,
    isPlayer: false,
  });

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

export function performKnifeSlash() {
  if (!state.gameStarted) return;
  if (state.net && state.net.isGuest()) {
    if (!isLocalBossAlive()) return;
    state.net.sendCommand({ cmd: 'SLASH' });
    return;
  }
  if (!state.player.alive || state.player.attackCooldown > 0) return;

  state.player.attackCooldown = 0.34;
  state.player.slashAnimTimer = 0.18;

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
  emit('slash:performed', {
    x: state.player.x,
    y: state.player.y,
    facing: state.player.facing,
    color: '#f43f5e',
    hitCount,
    isPlayer: true,
  });

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
}

export function performBossKnifeSlash(bossNpc) {
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
  emit('slash:performed', {
    x: bossNpc.x,
    y: bossNpc.y,
    facing: bossNpc.facing,
    color: FACTION_META[bossNpc.faction].accent,
    hitCount: targets.length,
    isPlayer: false,
  });

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

export function traceBulletRay(x0, y0, angle, maxDist) {
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
    if (!prop) continue;
    const rect = getPropFootprint(
      prop,
      (cx * CHUNK_SIZE + lx) * TILE_SIZE,
      (cy * CHUNK_SIZE + ly) * TILE_SIZE,
      chunk.propVertical[ly][lx],
      chunk.propCurbSide[ly][lx]
    );
    if (rect && rectContains(rect, px, py)) {
      return { blocked: true, dist: d, x: px, y: py };
    }
  }
  return { blocked: false, dist: maxDist, x: x0 + cos * maxDist, y: y0 + sin * maxDist };
}

export function getPistolAccuracyInfo(dist) {
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

export function performBossPistolShot(shooter, isPlayerShooter, targetX, targetY) {
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
  emit('shot:started', {
    shooter,
    shooterX: shooter.x,
    shooterY: shooter.y,
    muzzleX,
    muzzleY,
    angle,
    shooterFaction,
    isPlayerShooter,
  });

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
  let missTargetX = null;
  let missTargetY = null;
  let impact = { blocked: false, x: null, y: null };

  if (bestTarget && shotMissed) {
    const missDir = Math.random() < 0.5 ? 1 : -1;
    const deflectAngle = angle + missDir * (0.045 + Math.random() * 0.035);
    const missRay = traceBulletRay(shooter.x, shooter.y, deflectAngle, MAX_PISTOL_RANGE);
    endX = missRay.x;
    endY = missRay.y - 10;
    missTargetX = bestTarget.x;
    missTargetY = bestTarget.y;
    if (missRay.blocked) {
      impact = { blocked: true, x: missRay.x, y: missRay.y };
    }
  } else if (!bestTarget && envHit.blocked) {
    impact = { blocked: true, x: envHit.x, y: envHit.y };
  }

  const tracerColor = isPlayerShooter ? '#fde047' : FACTION_META[shooterFaction].accent;
  emit('shot:fired', {
    shooterFaction,
    isPlayerShooter,
    x1: muzzleX,
    y1: muzzleY,
    x2: endX,
    y2: endY,
    color: tracerColor,
    missed: shotMissed,
    targetX: missTargetX,
    targetY: missTargetY,
    impact,
  });

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
  }

  return true;
}

export function damagePlayerBoss(dmg, textColor = '#f43f5e', suffix = '', hitAngle = null) {
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
  emit('unit:damaged', {
    unit: state.player,
    amount: dmg,
    absorbed,
    remaining: remainingDmg,
    isKill,
    isPlayer: true,
    hitAngle,
    textColor,
    suffix,
  });

  if (absorbed > 0 && state.player.armor <= 0) {
    state.player.armor = 0;
    emit('armor:broken', { unit: state.player, isPlayer: true });
  }

  if (isKill) {
    emit('unit:died', {
      unit: state.player,
      faction: Faction.PLAYER,
      rank: UnitRank.BOSS,
      x: state.player.x,
      y: state.player.y,
      facing: state.player.facing,
      fallAngle: hitAngle ?? state.player.facing,
      isBoss: true,
      isPlayer: true,
    });
    eliminateFaction(Faction.PLAYER);
  }
}

export function executeBuyArmorForFaction(faction) {
  if (!state.factionAlive[faction]) return false;
  if (faction === Faction.PLAYER) {
    if (!state.player.alive || state.player.armorCooldown > 0 || state.player.armor >= MAX_BOSS_ARMOR) return false;
    if (state.treasuries[Faction.PLAYER] < COST_BOSS_ARMOR) return false;
    state.treasuries[Faction.PLAYER] -= COST_BOSS_ARMOR;
    state.player.armor = MAX_BOSS_ARMOR;
    state.player.armorCooldown = state.tickDuration;
    emit('armor:equipped', {
      unit: state.player,
      amount: MAX_BOSS_ARMOR,
      faction: Faction.PLAYER,
      isPlayer: true,
      textOffset: 34,
    });
    return true;
  } else {
    const bossNpc = state.npcs.find((n) => n.faction === faction && n.rank === UnitRank.BOSS);
    if (!bossNpc || (bossNpc.armorCooldown || 0) > 0 || (bossNpc.armor || 0) >= MAX_BOSS_ARMOR) return false;
    if (state.treasuries[faction] < COST_BOSS_ARMOR) return false;
    state.treasuries[faction] -= COST_BOSS_ARMOR;
    bossNpc.armor = MAX_BOSS_ARMOR;
    bossNpc.armorCooldown = state.tickDuration;
    emit('armor:equipped', {
      unit: bossNpc,
      amount: MAX_BOSS_ARMOR,
      faction,
      isPlayer: false,
      textOffset: 34,
    });
    return true;
  }
}

export function buyBossArmor() {
  if (!state.gameStarted) return;
  if (state.net && state.net.isGuest()) {
    if (!isLocalBossAlive()) {
      emit('ui:toast', { message: 'Your Boss must be alive to equip armor!' });
      return;
    }
    state.net.sendCommand({ cmd: 'BUY_ARMOR' });
    return;
  }
  if (!state.player.alive || !state.factionAlive[Faction.PLAYER]) {
    emit('ui:toast', { message: 'Your Boss must be alive to equip armor!' });
    return;
  }
  if (state.player.armorCooldown > 0) {
    emit('ui:toast', {
      message: `Armor restock on cooldown (${state.player.armorCooldown.toFixed(1)}s until next tick)!`,
    });
    return;
  }
  if (state.player.armor >= MAX_BOSS_ARMOR) {
    emit('ui:toast', {
      message: `Kevlar Armor is already at full capacity (${MAX_BOSS_ARMOR} HP)!`,
    });
    return;
  }
  if (state.treasuries[Faction.PLAYER] < COST_BOSS_ARMOR) {
    emit('ui:toast', {
      message: `Need $${COST_BOSS_ARMOR.toLocaleString()} for Boss Kevlar Armor!`,
    });
    return;
  }

  if (executeBuyArmorForFaction(Faction.PLAYER)) {
    emit('ui:toast', {
      message: `Equipped Kevlar Armor! Next purchase available in ${state.tickDuration}s.`,
    });
  }
}

export function tryBuyNpcBossArmor(bossNpc, nearbyEnemies = 0, nearbyAllies = 0) {
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
  emit('armor:equipped', {
    unit: bossNpc,
    amount: MAX_BOSS_ARMOR,
    faction,
    isPlayer: false,
    textOffset: 36,
  });
  return true;
}

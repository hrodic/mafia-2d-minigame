// Combat: shared damage/armor pipeline, melee slashes, pistol raycast and armor purchases.

import { Faction, UnitRank, PropType } from '../config/enums.js';
import { CHUNK_SIZE, TILE_SIZE, MAX_PISTOL_RANGE, HIT_FLASH_DURATION } from '../config/constants.js';
import { COST_BOSS_ARMOR, MAX_BOSS_ARMOR, PISTOL, CRITICAL, SLASH } from '../config/balance.js';
import { FACTION_META } from '../config/organizations.js';
import { getPropFootprint, rectContains } from '../world/geometry.js';
import { state, forEachUnit } from '../core/state.js';
import { emit } from '../core/events.js';
import { canOccupyPosition, getEntityCollisionRadius } from './movement.js';
import { eliminateFaction } from './territory.js';


export function rollDamage(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** True when the strike comes from inside the target's rear cone. */
export function isBackHit(target, strikeAngle) {
  if (!target || typeof target.facing !== 'number') return false;
  return Math.cos(target.facing - strikeAngle) > CRITICAL.backArcCos;
}

/** Roll one hit's critical chance: 5% base, 20% from behind. */
export function rollCriticalHit(target, strikeAngle) {
  const chance = CRITICAL.chance + (isBackHit(target, strikeAngle) ? CRITICAL.backBonus : 0);
  return Math.random() < chance;
}

function applyCriticalDamage(dmg, isCrit) {
  return isCrit ? Math.max(1, Math.round(dmg * CRITICAL.multiplier)) : dmg;
}

function creditKill(killerFaction, victimFaction) {
  if (!killerFaction || killerFaction === victimFaction) return;
  if (state.factionKills[killerFaction] !== undefined) state.factionKills[killerFaction]++;
}

function creditDeath(victimFaction) {
  if (state.factionDeaths[victimFaction] !== undefined) state.factionDeaths[victimFaction]++;
}

export function applyDamageToNpc(
  target,
  dmg,
  textColor = '#fbbf24',
  suffix = '',
  hitAngle = null,
  killerFaction = null,
  isCrit = false
) {
  if (!target) return false;
  const isPlayer = target === state.player;
  if (isPlayer && !target.alive) return false;

  target.hitFlashTimer = HIT_FLASH_DURATION;

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
    isPlayer,
    isCrit,
    hitAngle,
    textColor,
    suffix,
  });

  if (absorbed > 0 && target.armor <= 0) {
    target.armor = 0;
    emit('armor:broken', { unit: target, isPlayer });
  }

  if (isKill) {
    const deadFaction = target.faction;
    const wasBoss = target.rank === UnitRank.BOSS;
    const fallAngle = hitAngle ?? target.facing;
    let deadIdx = -1;
    if (!isPlayer) {
      deadIdx = state.npcs.indexOf(target);
      // Non-player targets that are not in the roster do not emit death.
      if (deadIdx === -1) return isKill;
    }

    creditKill(killerFaction, deadFaction);
    creditDeath(deadFaction);
    if (deadIdx !== -1) state.npcs.splice(deadIdx, 1);
    emit('unit:died', {
      unit: target,
      faction: deadFaction,
      rank: target.rank,
      x: target.x,
      y: target.y,
      facing: target.facing,
      fallAngle,
      isBoss: wasBoss,
      isPlayer,
    });
    if (wasBoss) {
      eliminateFaction(deadFaction);
    }
  }
  return isKill;
}

function collectSlashTargets(attacker, profile, explicitTargets = null) {
  const candidates = [];

  const consider = (entity) => {
    if (!entity || entity === attacker) return;
    if (entity.faction === attacker.faction) return;
    if (entity === state.player && !state.player.alive) return;

    const dx = entity.x - attacker.x;
    const dy = entity.y - attacker.y;
    const dist = Math.hypot(dx, dy);
    if (dist > profile.reach) return;

    if (profile.arc != null) {
      const angleToTarget = Math.atan2(dy, dx);
      let angleDiff = Math.abs(angleToTarget - attacker.facing);
      if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;
      if (angleDiff > Math.PI * profile.arc) return;
    }

    candidates.push({ entity, isPlayer: entity === state.player, dist, dx, dy });
  };

  if (explicitTargets) {
    for (const entity of explicitTargets) consider(entity);
  } else {
    forEachUnit(consider);
  }

  candidates.sort((a, b) => a.dist - b.dist);
  return candidates.slice(0, profile.maxTargets);
}

/**
 * One melee slash pipeline for the player, remote-human bosses and AI.
 * The profile carries reach/arc/knockback/cooldown; params carry the remaining
 * presentation and target-selection differences.
 */
export function performSlash(attacker, params = {}) {
  if (!attacker || attacker.attackCooldown > 0) return false;
  const profile = params.profile || SLASH.aiMelee;
  const isPlayer = attacker === state.player;

  attacker.attackCooldown = profile.cooldown;
  attacker.slashAnimTimer = profile.anim;

  const targets = collectSlashTargets(attacker, profile, params.targets || null);

  if (params.faceNearest && targets.length > 0) {
    attacker.facing = Math.atan2(targets[0].dy, targets[0].dx);
  }

  const hitCount = targets.length;
  if (hitCount > 0 || params.emitWhenEmpty !== false) {
    emit('slash:performed', {
      x: attacker.x,
      y: attacker.y,
      facing: attacker.facing,
      arc: profile.arc,
      color: params.eventColor ?? (isPlayer ? '#f43f5e' : FACTION_META[attacker.faction].accent),
      hitCount,
      isPlayer,
    });
  }

  const playerDamageColor = params.playerDamageColor ?? '#f43f5e';
  const npcDamageColor =
    params.npcDamageColor ?? (isPlayer ? '#fbbf24' : FACTION_META[attacker.faction].accent);
  const suffix = params.suffix ?? '';

  for (const item of targets) {
    const strikeAngle = item.dist > 0.01 ? Math.atan2(item.dy, item.dx) : attacker.facing;
    const isCrit = rollCriticalHit(item.entity, strikeAngle);
    const dmg = applyCriticalDamage(rollDamage(attacker.minDmg, attacker.maxDmg), isCrit);

    if (item.isPlayer) {
      damagePlayerBoss(dmg, playerDamageColor, suffix, strikeAngle, attacker.faction, isCrit);
      continue;
    }

    const knockX = item.entity.x + Math.cos(strikeAngle) * profile.knockback;
    const knockY = item.entity.y + Math.sin(strikeAngle) * profile.knockback;
    const nRad = getEntityCollisionRadius(item.entity.rank);
    if (canOccupyPosition(knockX, knockY, nRad, item.entity.id, false)) {
      item.entity.x = knockX;
      item.entity.y = knockY;
    }
    applyDamageToNpc(item.entity, dmg, npcDamageColor, suffix, strikeAngle, attacker.faction, isCrit);
  }

  return hitCount > 0;
}

export function executeBossSlashForFaction(faction) {
  if (faction === Faction.PLAYER) return performKnifeSlash();
  const bossNpc = state.npcs.find((n) => n.faction === faction && n.rank === UnitRank.BOSS);
  if (!bossNpc) return false;
  return performSlash(bossNpc, { profile: SLASH.humanBoss });
}

export function performKnifeSlash() {
  if (!state.gameStarted) return false;
  if (!state.player.alive) return false;
  return performSlash(state.player, { profile: SLASH.humanBoss });
}

export function performBossKnifeSlash(bossNpc) {
  if (!bossNpc) return false;
  return performSlash(bossNpc, {
    profile: SLASH.aiBoss,
    suffix: '🔪',
    emitWhenEmpty: false,
    faceNearest: true,
  });
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
    if (!prop || prop === PropType.DUMPSTER) continue;
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
  if (dist > MAX_PISTOL_RANGE) return PISTOL.outOfRange;
  for (const band of PISTOL.accuracyBands) {
    if (band.inclusive ? dist <= band.maxDist : dist < band.maxDist) return band;
  }
  return PISTOL.outOfRange;
}

export function getPistolAim(shooterX, shooterY, targetX, targetY) {
  const centerAngle = Math.atan2(targetY - shooterY, targetX - shooterX);
  const muzzleX = shooterX + Math.cos(centerAngle) * 18;
  const muzzleY = shooterY - 14 + Math.sin(centerAngle) * 6;
  const dx = targetX - muzzleX;
  const dy = targetY - muzzleY;
  const angle = dx * dx + dy * dy > 0.0001 ? Math.atan2(dy, dx) : centerAngle;
  return { angle, centerAngle, muzzleX, muzzleY };
}

/**
 * True when a pistol shot from `shooter` reaches the target without hitting
 * geometry. Uses the same ray as bullets, so AI never wastes rounds on walls.
 */
export function hasClearShot(shooter, targetX, targetY) {
  const dist = Math.hypot(targetX - shooter.x, targetY - shooter.y);
  if (dist <= 0.01) return true;
  const { angle, muzzleX, muzzleY } = getPistolAim(shooter.x, shooter.y, targetX, targetY);
  return !traceBulletRay(muzzleX, muzzleY, angle, Math.max(1, dist - 4)).blocked;
}

/** Advance reload state; refills the magazine when the reload completes. */
export function tickWeapon(unit, dt) {
  if (!unit || !(unit.reloadTimer > 0)) return;
  unit.reloadTimer = Math.max(0, unit.reloadTimer - dt);
  if (unit.reloadTimer === 0) unit.ammo = PISTOL.magazine;
}

export function performBossPistolShot(shooter, isPlayerShooter, targetX, targetY) {
  if (!shooter || shooter.attackCooldown > 0) return false;
  if (shooter.ammo == null) shooter.ammo = PISTOL.magazine;
  if (shooter.ammo <= 0 || (shooter.reloadTimer || 0) > 0) return false;

  const { angle, muzzleX, muzzleY } = getPistolAim(shooter.x, shooter.y, targetX, targetY);
  shooter.facing = angle;
  shooter.attackCooldown = PISTOL.fireCooldown;
  shooter.ammo -= 1;
  if (shooter.ammo <= 0) shooter.reloadTimer = PISTOL.reloadTime;
  shooter.muzzleFlashTimer = 0.09;

  const shooterFaction = isPlayerShooter ? Faction.PLAYER : shooter.faction;
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

  const envHit = traceBulletRay(muzzleX, muzzleY, angle, MAX_PISTOL_RANGE);
  const maxRayDist = envHit.dist;

  let bestTarget = null;
  let bestTargetIsPlayer = false;
  let bestProjDist = maxRayDist;

  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  for (let i = 0; i < state.npcs.length; i++) {
    const npc = state.npcs[i];
    if (npc.faction === shooterFaction) continue;
    const rx = npc.x - muzzleX;
    const ry = npc.y - muzzleY;
    const proj = rx * cos + ry * sin;
    if (proj < 0 || proj > bestProjDist) continue;
    const perp = Math.abs(-rx * sin + ry * cos);
    const hitRadius = getEntityCollisionRadius(npc.rank) + 4;
    if (perp <= hitRadius) {
      bestProjDist = proj;
      bestTarget = npc;
      bestTargetIsPlayer = false;
    }
  }

  if (!isPlayerShooter && state.player.alive && shooterFaction !== Faction.PLAYER) {
    const rx = state.player.x - muzzleX;
    const ry = state.player.y - muzzleY;
    const proj = rx * cos + ry * sin;
    if (proj >= 0 && proj <= bestProjDist) {
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

  let endX = muzzleX + cos * bestProjDist;
  let endY = muzzleY + sin * bestProjDist;
  let missTargetX = null;
  let missTargetY = null;
  let impact = { blocked: false, x: null, y: null };

  if (bestTarget && shotMissed) {
    const missDir = Math.random() < 0.5 ? 1 : -1;
    const deflectAngle = angle + missDir * (0.045 + Math.random() * 0.035);
    const missRay = traceBulletRay(muzzleX, muzzleY, deflectAngle, MAX_PISTOL_RANGE);
    endX = missRay.x;
    endY = missRay.y;
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
    let dmg = rollDamage(PISTOL.minDmg, PISTOL.maxDmg);
    const { dmgMult } = getPistolAccuracyInfo(bestProjDist);
    if (dmgMult < 1) {
      dmg = Math.max(1, Math.round(dmg * dmgMult));
    }
    const isCrit = rollCriticalHit(bestTarget, angle);
    dmg = applyCriticalDamage(dmg, isCrit);
    if (bestTargetIsPlayer) {
      damagePlayerBoss(dmg, `${FACTION_META[shooterFaction].accent}`, '🔫', angle, shooterFaction, isCrit);
    } else {
      const knockback =
        PISTOL.knockbackMin + Math.random() * (PISTOL.knockbackMax - PISTOL.knockbackMin);
      const knockX = bestTarget.x + cos * knockback;
      const knockY = bestTarget.y + sin * knockback;
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
        angle,
        shooterFaction,
        isCrit
      );
    }
  }

  return true;
}

export function damagePlayerBoss(dmg, textColor = '#f43f5e', suffix = '', hitAngle = null, killerFaction = null, isCrit = false) {
  return applyDamageToNpc(state.player, dmg, textColor, suffix, hitAngle, killerFaction, isCrit);
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

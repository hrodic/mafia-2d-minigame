// Frame renderer: viewport culling, depth sorting, world/character/effect layers.

import { CHUNK_PX, TILE_SIZE, MAX_PISTOL_RANGE } from '../config/constants.js';
import { Faction, UnitRank, PropType } from '../config/enums.js';
import { SLASH } from '../config/balance.js';
import { FACTION_META } from '../config/organizations.js';
import { state, getLocalFaction, getLocalBoss, isLocalBossAlive } from '../core/state.js';
import { getPistolAccuracyInfo, getPistolAim } from '../sim/combat.js';
import {
  bloodParticles,
  bloodDecals,
  bulletTracers,
  slashArcs,
  muzzleFlashes,
  deadBodies,
  sparks,
  shellCasings,
} from './effects.js';
import { canvas, ctx } from './canvas.js';
import { drawBuilding, drawProp, drawStreetlightGlows, createAsphaltGrainTile } from './world.js';
import { drawCharacter, drawDeadBody } from './characters.js';
import { drawCityBackdrop } from './backdrop.js';
import { renderMinimap } from './minimap.js';
import { updateAndDrawRain, updateRainSchedule, isRaining, drawAmbientLight } from './weather.js';


export function resizeCanvas() {
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
const ambientLamps = [];
const groundCacheQueue = [];
const MAX_GROUND_CACHES = 16;
let grainTile = null;
let grainTileSeed = null;

function getGrainTile() {
  const seed = state.currentWorldSeed ?? 0;
  if (seed !== grainTileSeed) {
    grainTileSeed = seed;
    grainTile = createAsphaltGrainTile(seed);
  }
  return grainTile;
}

/** Cache one visible chunk's ground as a single offscreen image, with an LRU cap. */
function getChunkGroundCache(chunk) {
  if (chunk.groundCache) return chunk.groundCache;
  if (typeof document === 'undefined') return null;
  const cache = document.createElement('canvas');
  cache.width = CHUNK_PX;
  cache.height = CHUNK_PX;
  const g = cache.getContext('2d');
  if (!g) return null;
  chunk.drawGroundDirect(g, 0, 0, 0, CHUNK_PX, 0, CHUNK_PX, getGrainTile());
  chunk.groundCache = cache;
  groundCacheQueue.push(chunk);
  if (groundCacheQueue.length > MAX_GROUND_CACHES) {
    const oldest = groundCacheQueue.shift();
    if (oldest && oldest !== chunk) oldest.groundCache = null;
  }
  return cache;
}

export function render(dt = 1 / 60) {
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

  // Decorative city outside the generated/playable chunks.
  drawCityBackdrop(ctx, camLeft, camTop, viewW, viewH);

  const minCx = Math.floor(camLeft / CHUNK_PX) - 1;
  const maxCx = Math.floor(camRight / CHUNK_PX) + 1;
  const minCy = Math.floor(camTop / CHUNK_PX) - 1;
  const maxCy = Math.floor(camBottom / CHUNK_PX) + 1;

  renderables.length = 0;
  ambientLamps.length = 0;

  // 1. Ground tiles + Faction territory overlays & borders
  for (let cy = minCy; cy <= maxCy; cy++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      const chunk = state.world.getChunk(cx, cy);
      if (!chunk) continue;
      const ox = cx * CHUNK_PX;
      const oy = cy * CHUNK_PX;

      const groundCache = getChunkGroundCache(chunk);
      if (groundCache) ctx.drawImage(groundCache, ox, oy);
      else chunk.drawGroundDirect(ctx, ox, oy, camLeft, camRight, camTop, camBottom);

      const meta = FACTION_META[chunk.faction] || FACTION_META[Faction.NEUTRAL];
      if (chunk.faction !== Faction.NEUTRAL) {
        ctx.fillStyle = meta.tint;
        ctx.fillRect(ox, oy, CHUNK_PX, CHUNK_PX);
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
        if (b.wx + TILE_SIZE >= camLeft && b.wx <= camRight && b.wy + TILE_SIZE >= camTop && b.wy - TILE_SIZE * 1.5 <= camBottom) {
          renderables.push(b);
        }
      }
      for (let i = 0; i < chunk.propRenderList.length; i++) {
        const p = chunk.propRenderList[i];
        if (p.wx + TILE_SIZE >= camLeft && p.wx <= camRight && p.wy + TILE_SIZE >= camTop && p.wy - TILE_SIZE <= camBottom) {
          if (p.prop === PropType.STREETLIGHT) ambientLamps.push(p);
          renderables.push(p);
        }
      }
    }
  }

  // 1b. Warm lamp pools stay under buildings, props and units for ambient depth.
  drawStreetlightGlows(ambientLamps);

  // 2. Ground blood decals & persistent dead bodies
  for (let i = 0; i < bloodDecals.length; i++) {
    const d = bloodDecals[i];
    if (d.x < camLeft - 40 || d.x > camRight + 40 || d.y < camTop - 40 || d.y > camBottom + 40) continue;
    ctx.save();
    ctx.globalAlpha = Math.min(1, d.life / 5.0);
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
      const aim = getPistolAim(localBoss.x, localBoss.y, aimWx, aimWy);
      const aimDist = Math.hypot(aimWx - aim.muzzleX, aimWy - aim.muzzleY);
      const accInfo = getPistolAccuracyInfo(aimDist);

      ctx.save();
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.14)';
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(localBoss.x, localBoss.y, MAX_PISTOL_RANGE, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // Aim guide starts at the same muzzle and uses the same angle as the bullet.
      const guideLength = Math.min(aimDist, MAX_PISTOL_RANGE);
      ctx.save();
      ctx.strokeStyle = accInfo.color;
      ctx.globalAlpha = 0.5;
      ctx.setLineDash([5, 5]);
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(aim.muzzleX, aim.muzzleY);
      ctx.lineTo(
        aim.muzzleX + Math.cos(aim.angle) * guideLength,
        aim.muzzleY + Math.sin(aim.angle) * guideLength
      );
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = accInfo.color;
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(aimWx, aimWy, 4, 0, Math.PI * 2);
      ctx.moveTo(aimWx - 9, aimWy);
      ctx.lineTo(aimWx - 3, aimWy);
      ctx.moveTo(aimWx + 3, aimWy);
      ctx.lineTo(aimWx + 9, aimWy);
      ctx.moveTo(aimWx, aimWy - 9);
      ctx.lineTo(aimWx, aimWy - 3);
      ctx.moveTo(aimWx, aimWy + 3);
      ctx.lineTo(aimWx, aimWy + 9);
      ctx.stroke();
      ctx.restore();

      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = accInfo.color;
      ctx.fillText(accInfo.label, aimWx + 12, aimWy - 10);
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
      const hostName = state.net && state.net.isActive() ? state.net.getAliasForFaction(Faction.PLAYER) : null;
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
        slashArc: SLASH.humanBoss.arc,
        isShooting: state.player.muzzleFlashTimer > 0,
        hitFlash: state.player.hitFlashTimer > 0,
        isMoving: state.player.isMoving,
        walkPhase: state.player.walkPhase || 0,
      });
    } else if (item.type === 'npc') {
      const u = item.unit;
      const meta = FACTION_META[u.faction] || FACTION_META[Faction.NEUTRAL];
      const isBoss = u.rank === UnitRank.BOSS;
      const slashProfile = isBoss
        ? SLASH.humanBoss
        : SLASH.aiMeleeByRank[u.rank] || SLASH.aiMelee;
      const isMyRemoteBoss = isBoss && u.faction === getLocalFaction();
      const alias = isBoss && state.net && state.net.isActive() ? state.net.getAliasForFaction(u.faction) : null;
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
        slashArc: slashProfile.arc,
        isShooting: u.muzzleFlashTimer > 0,
        hitFlash: u.hitFlashTimer > 0,
        isMoving: u.isMoving,
        walkPhase: u.walkPhase || 0,
      });
    }
  }

  // 4b. Turf income labels (visible overlay, drawn above buildings/characters).
  ctx.save();
  ctx.font = 'bold 10px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let cy = minCy; cy <= maxCy; cy++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      const chunk = state.world.getChunk(cx, cy);
      if (!chunk) continue;
      const meta = FACTION_META[chunk.faction] || FACTION_META[Faction.NEUTRAL];
      const label = chunk.incomeLabel;
      const centerX = cx * CHUNK_PX + CHUNK_PX / 2;
      const labelY = cy * CHUNK_PX + 29;
      const halfWidth = ctx.measureText(label).width / 2;
      const pillW = halfWidth * 2 + 12;
      const pillH = 16;
      ctx.beginPath();
      ctx.roundRect(centerX - pillW / 2, labelY - pillH / 2, pillW, pillH, 5);
      ctx.fillStyle = 'rgba(9, 9, 11, 0.82)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.34)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = chunk.faction === Faction.NEUTRAL ? '#d4d4d8' : meta.accent;
      ctx.fillText(label, centerX, labelY);
    }
  }
  ctx.restore();

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
    ctx.arc(0, 0, 20, -s.halfArc, s.halfArc);
    ctx.stroke();

    ctx.globalAlpha = t * 0.55;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.arc(0, 0, 22, -s.halfArc * 0.8, s.halfArc * 0.8);
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

  for (let i = 0; i < shellCasings.length; i++) {
    const casing = shellCasings[i];
    ctx.save();
    ctx.translate(casing.x, casing.y - casing.z * 0.45);
    ctx.rotate(casing.rot);
    ctx.fillStyle = '#d4a017';
    ctx.fillRect(-1.6, -0.8, 3.2, 1.6);
    ctx.restore();
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
  const atmosphereHour = (state.gameHour || 0) + (state.tickTimer || 0) / (state.tickDuration || 15);
  drawAmbientLight(ctx, viewW, viewH, atmosphereHour);
  updateRainSchedule(state.gameHour || 0);
  updateAndDrawRain(ctx, viewW, viewH, dt, isRaining());
  renderMinimap(dt);
}

// Frame renderer: viewport culling, depth sorting, world/character/effect layers.

import { CHUNK_PX, TILE_SIZE, MAX_PISTOL_RANGE } from '../config/constants.js';
import { Faction, UnitRank } from '../config/enums.js';
import { FACTION_META } from '../config/organizations.js';
import { state, getLocalFaction, getLocalBoss, isLocalBossAlive } from '../core/state.js';
import { getPistolAccuracyInfo } from '../sim/combat.js';
import {
  bloodParticles,
  bloodDecals,
  bulletTracers,
  slashArcs,
  muzzleFlashes,
  deadBodies,
  sparks,
} from './effects.js';
import { canvas, ctx } from './canvas.js';
import { drawBuilding, drawProp } from './world.js';
import { drawCharacter, drawDeadBody } from './characters.js';
import { renderMinimap } from './minimap.js';


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

export function render() {
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
        isShooting: state.player.muzzleFlashTimer > 0,
        hitFlash: state.player.hitFlashTimer > 0,
      });
    } else if (item.type === 'npc') {
      const u = item.unit;
      const meta = FACTION_META[u.faction] || FACTION_META[Faction.NEUTRAL];
      const isBoss = u.rank === UnitRank.BOSS;
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

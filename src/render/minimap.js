// City radar: cached faction territory layer plus live unit dots and viewport.

import { Faction, UnitRank } from '../config/enums.js';
import { CHUNK_PX } from '../config/constants.js';
import { FACTION_META } from '../config/organizations.js';
import { state, getLocalBoss } from '../core/state.js';
import { canvas, minimapCanvas, minimapCtx } from './canvas.js';

const minimapCacheCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
const minimapCacheCtx = minimapCacheCanvas ? minimapCacheCanvas.getContext('2d') : null;
if (minimapCacheCanvas && minimapCanvas) {
  minimapCacheCanvas.width = minimapCanvas.width;
  minimapCacheCanvas.height = minimapCanvas.height;
}
const coordsEl = typeof document !== 'undefined' ? document.getElementById('minimap-coords') : null;


export function renderMinimap() {
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
  if (coordsEl) coordsEl.textContent = `(${bTile.cx}, ${bTile.cy})`;
}

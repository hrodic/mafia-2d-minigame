// City radar: cached faction territory layer plus live unit dots and viewport.

import { Faction, UnitRank } from '../config/enums.js';
import { CHUNK_PX } from '../config/constants.js';
import { FACTION_META } from '../config/organizations.js';
import { state, getLocalBoss } from '../core/state.js';
import { canvas, minimapCanvas, minimapCtx } from './canvas.js';
import {
  getMinimapLayout,
  chunkToMinimap,
  worldToMinimap,
} from './minimapLayout.js';

const minimapCacheCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
const minimapCacheCtx = minimapCacheCanvas ? minimapCacheCanvas.getContext('2d') : null;
if (minimapCacheCanvas && minimapCanvas) {
  minimapCacheCanvas.width = minimapCanvas.width;
  minimapCacheCanvas.height = minimapCanvas.height;
}
const coordsEl = typeof document !== 'undefined' ? document.getElementById('minimap-coords') : null;
let hoverCell = null;
let minimapExpanded = false;

/** Resize the radar between its default 168px and expanded 336px backing store. */
export function setMinimapExpanded(expanded) {
  minimapExpanded = Boolean(expanded);
  const size = minimapExpanded ? 336 : 168;
  if (minimapCanvas) {
    minimapCanvas.width = size;
    minimapCanvas.height = size;
  }
  if (minimapCacheCanvas) {
    minimapCacheCanvas.width = size;
    minimapCacheCanvas.height = size;
  }
  state.minimapCacheTimer = 1;
  return minimapExpanded;
}

export function isMinimapExpanded() {
  return minimapExpanded;
}

export function toggleMinimapExpanded() {
  return setMinimapExpanded(!minimapExpanded);
}

/** Highlight one radar cell while the pointer is over the minimap. */
export function setMinimapHover(cell) {
  hoverCell = cell && Number.isFinite(cell.cx) && Number.isFinite(cell.cy)
    ? { cx: cell.cx, cy: cell.cy }
    : null;
}


export function renderMinimap(dt = 1 / 60) {
  if (state.world.chunks.size === 0) return;

  const layout = getMinimapLayout(
    state.world.chunks.values(),
    minimapCanvas.width,
    minimapCanvas.height
  );
  if (!layout) return;
  const { cellSize } = layout;

  state.minimapCacheTimer += dt;
  if (state.minimapCacheTimer >= 0.4) {
    state.minimapCacheTimer = 0;
    minimapCacheCtx.fillStyle = '#09090b';
    minimapCacheCtx.fillRect(0, 0, minimapCacheCanvas.width, minimapCacheCanvas.height);

    for (const chunk of state.world.chunks.values()) {
      const pos = chunkToMinimap(layout, chunk.cx, chunk.cy);
      const rx = pos.x;
      const ry = pos.y;
      const meta = FACTION_META[chunk.faction] || FACTION_META[Faction.NEUTRAL];
      minimapCacheCtx.fillStyle = chunk.faction === Faction.NEUTRAL ? '#34343a' : meta.badge;
      minimapCacheCtx.fillRect(rx, ry, cellSize, cellSize);
    }

    // Crisp 1px gridlines on top of the cached territory colors.
    minimapCacheCtx.strokeStyle = 'rgba(255, 255, 255, 0.11)';
    minimapCacheCtx.lineWidth = 1;
    minimapCacheCtx.beginPath();
    for (let i = 0; i <= layout.cols; i++) {
      const x = Math.round(layout.offsetX + i * cellSize) + 0.5;
      minimapCacheCtx.moveTo(x, layout.offsetY);
      minimapCacheCtx.lineTo(x, layout.offsetY + layout.rows * cellSize);
    }
    for (let i = 0; i <= layout.rows; i++) {
      const y = Math.round(layout.offsetY + i * cellSize) + 0.5;
      minimapCacheCtx.moveTo(layout.offsetX, y);
      minimapCacheCtx.lineTo(layout.offsetX + layout.cols * cellSize, y);
    }
    minimapCacheCtx.stroke();
  }

  minimapCtx.drawImage(minimapCacheCanvas, 0, 0);

  if (hoverCell) {
    const pos = chunkToMinimap(layout, hoverCell.cx, hoverCell.cy);
    minimapCtx.save();
    minimapCtx.fillStyle = 'rgba(251, 191, 36, 0.22)';
    minimapCtx.fillRect(pos.x, pos.y, cellSize, cellSize);
    minimapCtx.strokeStyle = 'rgba(251, 191, 36, 0.95)';
    minimapCtx.lineWidth = 1;
    minimapCtx.strokeRect(
      Math.round(pos.x) + 0.5,
      Math.round(pos.y) + 0.5,
      Math.max(1, Math.round(cellSize) - 1),
      Math.max(1, Math.round(cellSize) - 1)
    );
    minimapCtx.restore();
  }

  // Draw unit & boss dots
  for (let i = 0; i < state.npcs.length; i++) {
    const u = state.npcs[i];
    const pos = worldToMinimap(layout, u.x, u.y);
    const mx = pos.x;
    const my = pos.y;
    minimapCtx.fillStyle = u.rank === UnitRank.BOSS ? '#ffffff' : (FACTION_META[u.faction]?.accent || '#a1a1aa');
    const r = u.rank === UnitRank.BOSS ? 3.0 : 1.5;
    minimapCtx.fillRect(mx - r, my - r, r * 2, r * 2);
  }

  if (state.player.alive) {
    const pos = worldToMinimap(layout, state.player.x, state.player.y);
    const px = pos.x;
    const py = pos.y;
    minimapCtx.save();
    minimapCtx.shadowColor = '#fbbf24';
    minimapCtx.shadowBlur = 10;
    minimapCtx.fillStyle = '#fff7d6';
    minimapCtx.beginPath();
    minimapCtx.arc(px, py, 3.2, 0, Math.PI * 2);
    minimapCtx.fill();
    minimapCtx.strokeStyle = '#fbbf24';
    minimapCtx.lineWidth = 1.5;
    minimapCtx.stroke();
    minimapCtx.restore();
  }

  // Camera viewport reticle: white core over a warm glow.
  const camTopLeft = worldToMinimap(
    layout,
    state.camera.x - canvas.width / 2,
    state.camera.y - canvas.height / 2
  );
  const camW = (canvas.width / CHUNK_PX) * cellSize;
  const camH = (canvas.height / CHUNK_PX) * cellSize;
  minimapCtx.save();
  minimapCtx.shadowColor = '#fbbf24';
  minimapCtx.shadowBlur = 8;
  minimapCtx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  minimapCtx.lineWidth = 1.5;
  minimapCtx.strokeRect(camTopLeft.x, camTopLeft.y, camW, camH);
  minimapCtx.strokeStyle = 'rgba(251, 191, 36, 0.75)';
  minimapCtx.lineWidth = 1;
  minimapCtx.strokeRect(camTopLeft.x, camTopLeft.y, camW, camH);
  minimapCtx.restore();

  const localBoss = getLocalBoss();
  const bTile = state.world.worldToTile(localBoss.x, localBoss.y);
  if (coordsEl) coordsEl.textContent = `(${bTile.cx}, ${bTile.cy})`;
}

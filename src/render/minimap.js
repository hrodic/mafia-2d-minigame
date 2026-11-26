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


export function renderMinimap() {
  if (state.world.chunks.size === 0) return;

  const layout = getMinimapLayout(
    state.world.chunks.values(),
    minimapCanvas.width,
    minimapCanvas.height
  );
  if (!layout) return;
  const { cellSize } = layout;

  state.minimapCacheTimer += 0.016;
  if (state.minimapCacheTimer >= 0.4) {
    state.minimapCacheTimer = 0;
    minimapCacheCtx.fillStyle = '#09090b';
    minimapCacheCtx.fillRect(0, 0, minimapCacheCanvas.width, minimapCacheCanvas.height);

    for (const chunk of state.world.chunks.values()) {
      const pos = chunkToMinimap(layout, chunk.cx, chunk.cy);
      const rx = pos.x;
      const ry = pos.y;
      const meta = FACTION_META[chunk.faction] || FACTION_META[Faction.NEUTRAL];
      minimapCacheCtx.fillStyle = chunk.faction === Faction.NEUTRAL ? '#27272a' : meta.badge;
      minimapCacheCtx.fillRect(rx + 0.5, ry + 0.5, Math.max(1, cellSize - 1), Math.max(1, cellSize - 1));
    }
  }

  minimapCtx.drawImage(minimapCacheCanvas, 0, 0);

  // Draw unit & boss dots
  for (let i = 0; i < state.npcs.length; i++) {
    const u = state.npcs[i];
    const pos = worldToMinimap(layout, u.x, u.y);
    const mx = pos.x;
    const my = pos.y;
    minimapCtx.fillStyle = u.rank === UnitRank.BOSS ? '#ffffff' : (FACTION_META[u.faction]?.accent || '#a1a1aa');
    const r = u.rank === UnitRank.BOSS ? 2.5 : 1.2;
    minimapCtx.fillRect(mx - r, my - r, r * 2, r * 2);
  }

  if (state.player.alive) {
    const pos = worldToMinimap(layout, state.player.x, state.player.y);
    const px = pos.x;
    const py = pos.y;
    minimapCtx.fillStyle = '#fef08a';
    minimapCtx.beginPath();
    minimapCtx.arc(px, py, 2.8, 0, Math.PI * 2);
    minimapCtx.fill();
  }

  // Camera viewport rectangle
  const camTopLeft = worldToMinimap(
    layout,
    state.camera.x - canvas.width / 2,
    state.camera.y - canvas.height / 2
  );
  const camW = (canvas.width / CHUNK_PX) * cellSize;
  const camH = (canvas.height / CHUNK_PX) * cellSize;
  minimapCtx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
  minimapCtx.lineWidth = 1;
  minimapCtx.strokeRect(camTopLeft.x, camTopLeft.y, camW, camH);

  const localBoss = getLocalBoss();
  const bTile = state.world.worldToTile(localBoss.x, localBoss.y);
  if (coordsEl) coordsEl.textContent = `(${bTile.cx}, ${bTile.cy})`;
}

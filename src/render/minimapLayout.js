// Single source for radar layout math shared by drawing (render/minimap.js)
// and click mapping (ui/input.js).

import { CHUNK_PX } from '../config/constants.js';

export const MINIMAP_PADDING = 6;

export function getChunkBounds(chunks) {
  let minCx = Infinity;
  let maxCx = -Infinity;
  let minCy = Infinity;
  let maxCy = -Infinity;
  for (const chunk of chunks) {
    if (chunk.cx < minCx) minCx = chunk.cx;
    if (chunk.cx > maxCx) maxCx = chunk.cx;
    if (chunk.cy < minCy) minCy = chunk.cy;
    if (chunk.cy > maxCy) maxCy = chunk.cy;
  }
  if (!Number.isFinite(minCx) || !Number.isFinite(minCy)) return null;
  return {
    minCx,
    minCy,
    maxCx,
    maxCy,
    cols: Math.max(1, maxCx - minCx + 1),
    rows: Math.max(1, maxCy - minCy + 1),
  };
}

export function computeMinimapLayout(width, height, bounds, pad = MINIMAP_PADDING) {
  if (!bounds) return null;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const cellSize = Math.min(innerW / bounds.cols, innerH / bounds.rows);
  const offsetX = pad + (innerW - cellSize * bounds.cols) / 2;
  const offsetY = pad + (innerH - cellSize * bounds.rows) / 2;
  return { ...bounds, width, height, pad, cellSize, offsetX, offsetY };
}

export function getMinimapLayout(chunks, width, height, pad = MINIMAP_PADDING) {
  return computeMinimapLayout(width, height, getChunkBounds(chunks), pad);
}

export function chunkToMinimap(layout, cx, cy) {
  return {
    x: layout.offsetX + (cx - layout.minCx) * layout.cellSize,
    y: layout.offsetY + (cy - layout.minCy) * layout.cellSize,
  };
}

export function worldToMinimap(layout, wx, wy) {
  return chunkToMinimap(layout, wx / CHUNK_PX, wy / CHUNK_PX);
}

export function minimapToWorld(layout, mx, my) {
  const cx = layout.minCx + (mx - layout.offsetX) / layout.cellSize;
  const cy = layout.minCy + (my - layout.offsetY) / layout.cellSize;
  return { cx, cy, x: cx * CHUNK_PX, y: cy * CHUNK_PX };
}

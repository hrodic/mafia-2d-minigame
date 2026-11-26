// City map: chunk storage, tile queries, collision and perimeter expansion.

import { CHUNK_SIZE, TILE_SIZE } from '../config/constants.js';
import { TileType } from '../config/enums.js';
import { DistrictChunk } from './chunk.js';
import { getPropFootprint, circleIntersectsRect } from './geometry.js';


export function packChunkKey(cx, cy) {
  return ((cx + 512) << 12) | (cy + 512);
}

export class CityMap {
  constructor(generation = null) {
    this.chunks = new Map();
    this.generation = generation;
    this._lastCx = 999999;
    this._lastCy = 999999;
    this._lastChunk = null;
  }

  clear() {
    this.chunks.clear();
    this._lastCx = 999999;
    this._lastCy = 999999;
    this._lastChunk = null;
  }

  getChunk(cx, cy) {
    if (cx === this._lastCx && cy === this._lastCy) return this._lastChunk;
    const c = this.chunks.get(packChunkKey(cx, cy));
    this._lastCx = cx;
    this._lastCy = cy;
    this._lastChunk = c;
    return c;
  }

  hasChunk(cx, cy) {
    return this.chunks.has(packChunkKey(cx, cy));
  }

  generateChunk(cx, cy, forcedFaction = null) {
    const key = packChunkKey(cx, cy);
    if (this.chunks.has(key)) return this.chunks.get(key);
    const chunk = new DistrictChunk(cx, cy, this.generation || {}, forcedFaction);
    this.chunks.set(key, chunk);
    this._lastCx = cx;
    this._lastCy = cy;
    this._lastChunk = chunk;
    return chunk;
  }

  worldToTile(wx, wy) {
    const gx = Math.floor(wx / TILE_SIZE);
    const gy = Math.floor(wy / TILE_SIZE);
    const cx = Math.floor(gx / CHUNK_SIZE);
    const cy = Math.floor(gy / CHUNK_SIZE);
    const lx = ((gx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const ly = ((gy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    return { cx, cy, lx, ly };
  }

  isWalkable(wx, wy) {
    const { cx, cy, lx, ly } = this.worldToTile(wx, wy);
    const chunk = this.getChunk(cx, cy);
    if (!chunk) return false;
    return chunk.ground[ly][lx] !== TileType.BUILDING;
  }

  isTileNavigable(gx, gy) {
    const cx = Math.floor(gx / CHUNK_SIZE);
    const cy = Math.floor(gy / CHUNK_SIZE);
    const chunk = this.getChunk(cx, cy);
    if (!chunk) return false;
    const lx = ((gx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const ly = ((gy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    return chunk.solidMask[ly * CHUNK_SIZE + lx] === 0;
  }

  findNearestWalkablePoint(wx, wy, bodyRad = 12) {
    if (this.canMoveTo(wx, wy, bodyRad)) return { x: wx, y: wy };
    const baseGx = Math.floor(wx / TILE_SIZE);
    const baseGy = Math.floor(wy / TILE_SIZE);
    for (let r = 1; r <= 8; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const tx = (baseGx + dx + 0.5) * TILE_SIZE;
          const ty = (baseGy + dy + 0.5) * TILE_SIZE;
          if (this.canMoveTo(tx, ty, bodyRad)) {
            return { x: tx, y: ty };
          }
        }
      }
    }
    return null;
  }

  canMoveTo(wx, wy, radius = 12) {
    const diag = radius * 0.72;
    const oxList = [0, radius, -radius, 0, 0, diag, -diag, diag, -diag];
    const oyList = [0, 0, 0, radius, -radius, diag, diag, -diag, -diag];

    for (let i = 0; i < 9; i++) {
      const px = wx + oxList[i];
      const py = wy + oyList[i];
      const gx = Math.floor(px / TILE_SIZE);
      const gy = Math.floor(py / TILE_SIZE);
      const cx = Math.floor(gx / CHUNK_SIZE);
      const cy = Math.floor(gy / CHUNK_SIZE);
      const chunk = this.getChunk(cx, cy);
      if (!chunk) return false;
      const lx = ((gx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
      const ly = ((gy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
      if (chunk.ground[ly][lx] === TileType.BUILDING) return false;
    }

    const minGx = Math.floor((wx - radius - 8) / TILE_SIZE);
    const maxGx = Math.floor((wx + radius + 8) / TILE_SIZE);
    const minGy = Math.floor((wy - radius - 8) / TILE_SIZE);
    const maxGy = Math.floor((wy + radius + 8) / TILE_SIZE);

    for (let gy = minGy; gy <= maxGy; gy++) {
      for (let gx = minGx; gx <= maxGx; gx++) {
        const cx = Math.floor(gx / CHUNK_SIZE);
        const cy = Math.floor(gy / CHUNK_SIZE);
        const chunk = this.getChunk(cx, cy);
        if (!chunk) continue;
        const lx = ((gx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
        const ly = ((gy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
        const prop = chunk.props[ly][lx];
        if (!prop) continue;
        const rect = getPropFootprint(
          prop,
          gx * TILE_SIZE,
          gy * TILE_SIZE,
          chunk.propVertical[ly][lx],
          chunk.propCurbSide[ly][lx]
        );
        if (rect && circleIntersectsRect(rect, wx, wy, radius)) return false;
      }
    }
    return true;
  }
}

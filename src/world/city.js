// City map: chunk storage, tile queries, collision and perimeter expansion.

import { CHUNK_SIZE, TILE_SIZE } from '../config/constants.js';
import { TileType, PropType, Faction } from '../config/enums.js';
import { DistrictChunk } from './chunk.js';


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
        if (prop === PropType.NONE) continue;

        if (prop === PropType.CAR) {
          const tileWx = gx * TILE_SIZE;
          const tileWy = gy * TILE_SIZE;
          const isVert = chunk.propVertical[ly][lx];
          const side = chunk.propCurbSide[ly][lx];
          const rx = isVert ? (side === 'W' ? tileWx + 21 : tileWx + 5) : tileWx + 5;
          const ry = isVert ? tileWy + 5 : (side === 'N' ? tileWy + 21 : tileWy + 5);
          const rw = isVert ? 18 : 34;
          const rh = isVert ? 34 : 18;

          const closestX = Math.max(rx, Math.min(wx, rx + rw));
          const closestY = Math.max(ry, Math.min(wy, ry + rh));
          const dx = wx - closestX;
          const dy = wy - closestY;
          if (dx * dx + dy * dy < radius * radius) return false;
        } else if (prop === PropType.DUMPSTER) {
          const tileWx = gx * TILE_SIZE;
          const tileWy = gy * TILE_SIZE;
          const rx = tileWx + 9;
          const ry = tileWy + 10;
          const rw = 26;
          const rh = 22;
          const closestX = Math.max(rx, Math.min(wx, rx + rw));
          const closestY = Math.max(ry, Math.min(wy, ry + rh));
          const dx = wx - closestX;
          const dy = wy - closestY;
          if (dx * dx + dy * dy < radius * radius) return false;
        }
      }
    }
    return true;
  }

  expandPerimeterRing(faction = Faction.PLAYER) {
    let minCx = Infinity, maxCx = -Infinity, minCy = Infinity, maxCy = -Infinity;
    for (const chunk of this.chunks.values()) {
      if (chunk.cx < minCx) minCx = chunk.cx;
      if (chunk.cx > maxCx) maxCx = chunk.cx;
      if (chunk.cy < minCy) minCy = chunk.cy;
      if (chunk.cy > maxCy) maxCy = chunk.cy;
    }
    let added = 0;
    for (let cy = minCy - 1; cy <= maxCy + 1; cy++) {
      for (let cx = minCx - 1; cx <= maxCx + 1; cx++) {
        if (!this.hasChunk(cx, cy)) {
          this.generateChunk(cx, cy, faction);
          added++;
        }
      }
    }
    return added;
  }
}

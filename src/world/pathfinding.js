// Tile-level A* pathfinding with a per-frame exploration budget.
//
// Optimizations:
// - packed integer tile keys (no string keys),
// - reusable search containers (no per-query allocation of the containers),
// - binary min-heap open set,
// - straight-line LOS pre-check that skips A* on clear short paths.
//
// `perf` counters are disabled in normal play and enabled by the long-sim harness.

import { TILE_SIZE } from '../config/constants.js';
import { perf } from '../core/perf.js';

export const MAX_ASTAR_PER_FRAME = 10;
export const LOS_MAX_TILES = 16;

const astarHeap = [];
const astarClosed = new Set();
const astarCameFrom = new Map();
const astarGScore = new Map();
let astarSeq = 0;

function nodeLess(a, b) {
  if (a.f !== b.f) return a.f < b.f;
  if (a.h !== b.h) return a.h < b.h;
  return a.seq < b.seq;
}

function heapPush(node) {
  let i = astarHeap.length;
  astarHeap.push(node);
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (!nodeLess(astarHeap[i], astarHeap[parent])) break;
    const tmp = astarHeap[i];
    astarHeap[i] = astarHeap[parent];
    astarHeap[parent] = tmp;
    i = parent;
  }
}

function heapPop() {
  const root = astarHeap[0];
  const last = astarHeap.pop();
  if (astarHeap.length === 0) return root;
  astarHeap[0] = last;
  let i = 0;
  const size = astarHeap.length;
  while (true) {
    const left = i * 2 + 1;
    if (left >= size) break;
    const right = left + 1;
    let smallest = left;
    if (right < size && nodeLess(astarHeap[right], astarHeap[left])) smallest = right;
    if (!nodeLess(astarHeap[smallest], astarHeap[i])) break;
    const tmp = astarHeap[i];
    astarHeap[i] = astarHeap[smallest];
    astarHeap[smallest] = tmp;
    i = smallest;
  }
  return root;
}

/**
 * Fast tile-line check. Returns:
 *   1  clear
 *   0  blocked
 *  -1  longer than maxTiles
 *
 * Diagonal steps require both orthogonal side tiles to be navigable, matching
 * the A* corner rule.
 */
export function hasLineOfSight(map, x0, y0, x1, y1, maxTiles = LOS_MAX_TILES) {
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let steps = 0;

  while (true) {
    if (!map.isTileNavigable(x, y)) return 0;
    if (x === x1 && y === y1) return 1;
    if (steps >= maxTiles) return -1;
    steps += 1;

    const e2 = 2 * err;
    let stepX = 0;
    let stepY = 0;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
      stepX = sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
      stepY = sy;
    }
    if (stepX !== 0 && stepY !== 0) {
      if (!map.isTileNavigable(x, y - stepY) || !map.isTileNavigable(x - stepX, y)) {
        return 0;
      }
    }
  }
}

export function computeTilePath(map, startWx, startWy, goalWx, goalWy, maxNodes = 180) {
  perf.inc('astarCalls');

  let startGx = Math.floor(startWx / TILE_SIZE);
  let startGy = Math.floor(startWy / TILE_SIZE);
  let goalGx = Math.floor(goalWx / TILE_SIZE);
  let goalGy = Math.floor(goalWy / TILE_SIZE);

  if (!map.isTileNavigable(goalGx, goalGy)) {
    const snapped = map.findNearestWalkablePoint(goalWx, goalWy, 12);
    if (!snapped) {
      perf.inc('astarSnapFailed');
      return null;
    }
    goalGx = Math.floor(snapped.x / TILE_SIZE);
    goalGy = Math.floor(snapped.y / TILE_SIZE);
  }

  if (!map.isTileNavigable(startGx, startGy)) {
    const snappedStart = map.findNearestWalkablePoint(startWx, startWy, 11);
    if (!snappedStart) {
      perf.inc('astarSnapFailed');
      return null;
    }
    startGx = Math.floor(snappedStart.x / TILE_SIZE);
    startGy = Math.floor(snappedStart.y / TILE_SIZE);
  }

  if (startGx === goalGx && startGy === goalGy) {
    perf.inc('astarSameTile');
    return [{ x: (goalGx + 0.5) * TILE_SIZE, y: (goalGy + 0.5) * TILE_SIZE }];
  }

  perf.inc('losChecks');
  const los = hasLineOfSight(map, startGx, startGy, goalGx, goalGy);
  if (los === 1) {
    perf.inc('losHits');
    return [{ x: (goalGx + 0.5) * TILE_SIZE, y: (goalGy + 0.5) * TILE_SIZE }];
  }
  perf.inc(los === 0 ? 'losBlocked' : 'losTooLong');

  perf.inc('astarSearches');
  astarHeap.length = 0;
  astarClosed.clear();
  astarCameFrom.clear();
  astarGScore.clear();
  astarSeq = 0;

  const pack = (gx, gy) => ((gx + 2048) << 12) | (gy + 2048);
  const startKey = pack(startGx, startGy);
  const goalKey = pack(goalGx, goalGy);

  astarGScore.set(startKey, 0);
  const startH = Math.hypot(goalGx - startGx, goalGy - startGy);
  heapPush({ gx: startGx, gy: startGy, key: startKey, f: startH, h: startH, seq: astarSeq++ });

  let bestKey = startKey;
  let bestDist = startH;
  let explored = 0;

  while (astarHeap.length > 0 && explored < maxNodes) {
    const current = heapPop();

    if (current.key === goalKey) {
      bestKey = goalKey;
      break;
    }

    if (astarClosed.has(current.key)) continue;
    astarClosed.add(current.key);
    explored++;

    const curG = astarGScore.get(current.key);

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const stepCost = dx !== 0 && dy !== 0 ? 1.414 : 1;
        const nx = current.gx + dx;
        const ny = current.gy + dy;

        if (!map.isTileNavigable(nx, ny)) continue;
        if (dx !== 0 && dy !== 0) {
          if (
            !map.isTileNavigable(current.gx + dx, current.gy) ||
            !map.isTileNavigable(current.gx, current.gy + dy)
          ) {
            continue;
          }
        }

        const nKey = pack(nx, ny);
        if (astarClosed.has(nKey)) continue;

        const tentativeG = curG + stepCost;
        const prevG = astarGScore.get(nKey);
        if (prevG === undefined || tentativeG < prevG) {
          astarCameFrom.set(nKey, current.key);
          astarGScore.set(nKey, tentativeG);
          const h = Math.hypot(goalGx - nx, goalGy - ny);
          if (h < bestDist) {
            bestDist = h;
            bestKey = nKey;
          }
          heapPush({
            gx: nx,
            gy: ny,
            key: nKey,
            f: tentativeG + h * 1.15,
            h,
            seq: astarSeq++,
          });
        }
      }
    }
  }

  perf.add('astarNodes', explored);

  if (bestKey === startKey) {
    perf.inc('astarNoPath');
    return null;
  }

  perf.inc('astarPathFound');
  const path = [];
  let curr = bestKey;
  while (curr !== undefined && curr !== startKey) {
    const gx = (curr >> 12) - 2048;
    const gy = (curr & 0xfff) - 2048;
    path.push({ x: (gx + 0.5) * TILE_SIZE, y: (gy + 0.5) * TILE_SIZE });
    curr = astarCameFrom.get(curr);
  }
  path.reverse();
  perf.add('astarWaypoints', path.length);
  return path;
}

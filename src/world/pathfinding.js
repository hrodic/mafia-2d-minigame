// Tile-level A* pathfinding with a per-frame exploration budget.

import { TILE_SIZE } from '../config/constants.js';

export const MAX_ASTAR_PER_FRAME = 10;


// Tile-level A* pathfinder
const astarOpen = [];
const astarClosed = new Set();
const astarCameFrom = new Map();
const astarGScore = new Map();

export function computeTilePath(map, startWx, startWy, goalWx, goalWy, maxNodes = 180) {
  let startGx = Math.floor(startWx / TILE_SIZE);
  let startGy = Math.floor(startWy / TILE_SIZE);
  let goalGx = Math.floor(goalWx / TILE_SIZE);
  let goalGy = Math.floor(goalWy / TILE_SIZE);

  if (!map.isTileNavigable(goalGx, goalGy)) {
    const snapped = map.findNearestWalkablePoint(goalWx, goalWy, 12);
    if (!snapped) return null;
    goalGx = Math.floor(snapped.x / TILE_SIZE);
    goalGy = Math.floor(snapped.y / TILE_SIZE);
  }

  if (!map.isTileNavigable(startGx, startGy)) {
    const snappedStart = map.findNearestWalkablePoint(startWx, startWy, 11);
    if (!snappedStart) return null;
    startGx = Math.floor(snappedStart.x / TILE_SIZE);
    startGy = Math.floor(snappedStart.y / TILE_SIZE);
  }

  if (startGx === goalGx && startGy === goalGy) {
    return [{ x: (goalGx + 0.5) * TILE_SIZE, y: (goalGy + 0.5) * TILE_SIZE }];
  }

  astarOpen.length = 0;
  astarClosed.clear();
  astarCameFrom.clear();
  astarGScore.clear();

  const pack = (gx, gy) => ((gx + 2048) << 12) | (gy + 2048);
  const startKey = pack(startGx, startGy);
  const goalKey = pack(goalGx, goalGy);

  astarGScore.set(startKey, 0);
  astarOpen.push({
    gx: startGx,
    gy: startGy,
    key: startKey,
    f: Math.hypot(goalGx - startGx, goalGy - startGy),
  });

  let bestKey = startKey;
  let bestDist = Math.hypot(goalGx - startGx, goalGy - startGy);
  let explored = 0;

  const dirs = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, 1.414], [-1, 1, 1.414], [1, -1, 1.414], [-1, -1, 1.414],
  ];

  while (astarOpen.length > 0 && explored < maxNodes) {
    let lowestIdx = 0;
    for (let i = 1; i < astarOpen.length; i++) {
      if (astarOpen[i].f < astarOpen[lowestIdx].f) lowestIdx = i;
    }
    const current = astarOpen[lowestIdx];
    astarOpen[lowestIdx] = astarOpen[astarOpen.length - 1];
    astarOpen.pop();

    if (current.key === goalKey) {
      bestKey = goalKey;
      break;
    }

    if (astarClosed.has(current.key)) continue;
    astarClosed.add(current.key);
    explored++;

    const curG = astarGScore.get(current.key);

    for (let d = 0; d < dirs.length; d++) {
      const dx = dirs[d][0];
      const dy = dirs[d][1];
      const stepCost = dirs[d][2];
      const nx = current.gx + dx;
      const ny = current.gy + dy;

      if (!map.isTileNavigable(nx, ny)) continue;
      if (dx !== 0 && dy !== 0) {
        if (!map.isTileNavigable(current.gx + dx, current.gy) || !map.isTileNavigable(current.gx, current.gy + dy)) {
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
        astarOpen.push({ gx: nx, gy: ny, key: nKey, f: tentativeG + h * 1.15 });
      }
    }
  }

  if (bestKey === startKey) return null;

  const path = [];
  let curr = bestKey;
  while (curr !== undefined && curr !== startKey) {
    const gx = (curr >> 12) - 2048;
    const gy = (curr & 0xfff) - 2048;
    path.push({ x: (gx + 0.5) * TILE_SIZE, y: (gy + 0.5) * TILE_SIZE });
    curr = astarCameFrom.get(curr);
  }
  path.reverse();
  return path;
}

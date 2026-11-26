// A* pathfinding tests against a synthetic tile map (pure logic, no rendering).
import { test, assert, assertEqual } from './harness.js';
import { TILE_SIZE } from '../src/config/constants.js';
import { computeTilePath, MAX_ASTAR_PER_FRAME } from '../src/world/pathfinding.js';

function tileKey(x, y) {
  return `${x},${y}`;
}

function worldOf(tileX, tileY) {
  return { x: (tileX + 0.5) * TILE_SIZE, y: (tileY + 0.5) * TILE_SIZE };
}

function makeMap(blocked = new Set(), width = 60, height = 60) {
  const isOpen = (x, y) =>
    x >= 0 && y >= 0 && x < width && y < height && !blocked.has(tileKey(x, y));
  return {
    isTileNavigable: isOpen,
    findNearestWalkablePoint: (wx, wy) => {
      const baseGx = Math.floor(wx / TILE_SIZE);
      const baseGy = Math.floor(wy / TILE_SIZE);
      for (let r = 1; r <= 8; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
            if (isOpen(baseGx + dx, baseGy + dy)) {
              return worldOf(baseGx + dx, baseGy + dy);
            }
          }
        }
      }
      return null;
    },
  };
}

function tileOf(point) {
  return { x: Math.floor(point.x / TILE_SIZE), y: Math.floor(point.y / TILE_SIZE) };
}

function assertPathIsNavigable(map, path) {
  assert(Array.isArray(path) && path.length > 0, 'path should not be empty');
  for (const point of path) {
    const tile = tileOf(point);
    assert(map.isTileNavigable(tile.x, tile.y), `waypoint ${tile.x},${tile.y} is blocked`);
  }
}

test('pathfinding: budget constant is exported', () => {
  assertEqual(MAX_ASTAR_PER_FRAME, 10);
});

test('pathfinding: finds a direct path on an open grid', () => {
  const map = makeMap();
  const start = worldOf(2, 2);
  const goal = worldOf(10, 2);
  const path = computeTilePath(map, start.x, start.y, goal.x, goal.y);
  assertPathIsNavigable(map, path);
  const last = path[path.length - 1];
  assertEqual(last.x, goal.x);
  assertEqual(last.y, goal.y);
  const first = tileOf(path[0]);
  assert(first.x >= 2 && first.x <= 3, `first waypoint too far: ${first.x},${first.y}`);
});

test('pathfinding: start equal to goal returns one waypoint', () => {
  const map = makeMap();
  const p = worldOf(4, 4);
  const path = computeTilePath(map, p.x, p.y, p.x, p.y);
  assertEqual(path.length, 1);
  assertEqual(path[0].x, p.x);
  assertEqual(path[0].y, p.y);
});

test('pathfinding: routes through the only gap in a wall', () => {
  const blocked = new Set();
  for (let y = 0; y < 20; y++) {
    if (y !== 10) blocked.add(tileKey(6, y));
  }
  const map = makeMap(blocked);
  const start = worldOf(2, 5);
  const goal = worldOf(10, 5);
  const path = computeTilePath(map, start.x, start.y, goal.x, goal.y, 400);
  assertPathIsNavigable(map, path);
  const tiles = path.map(tileOf);
  assert(
    tiles.some((t) => t.x === 6 && t.y === 10),
    'path must pass through the wall gap at 6,10'
  );
});

test('pathfinding: snaps a blocked goal to a walkable neighbour', () => {
  const blocked = new Set([tileKey(6, 5)]);
  const map = makeMap(blocked);
  const start = worldOf(2, 5);
  const blockedGoal = worldOf(6, 5);
  const path = computeTilePath(map, start.x, start.y, blockedGoal.x, blockedGoal.y);
  assertPathIsNavigable(map, path);
  const last = tileOf(path[path.length - 1]);
  assert(map.isTileNavigable(last.x, last.y), 'final waypoint must be walkable after snapping');
  assert(!(last.x === 6 && last.y === 5), 'path must not end inside the blocked goal tile');
});

test('pathfinding: never cuts blocked diagonal corners', () => {
  const blocked = new Set([tileKey(6, 5), tileKey(5, 6)]);
  const map = makeMap(blocked);
  const start = worldOf(5, 5);
  const goal = worldOf(6, 6);
  const path = computeTilePath(map, start.x, start.y, goal.x, goal.y, 400);
  assertPathIsNavigable(map, path);
  for (let i = 1; i < path.length; i++) {
    const a = tileOf(path[i - 1]);
    const b = tileOf(path[i]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dx !== 0 && dy !== 0) {
      assert(
        map.isTileNavigable(a.x + dx, a.y) && map.isTileNavigable(a.x, a.y + dy),
        `diagonal step ${a.x},${a.y} -> ${b.x},${b.y} cuts a blocked corner`
      );
    }
  }
});

test('pathfinding: respects the maxNodes budget without throwing', () => {
  const map = makeMap();
  const start = worldOf(1, 1);
  const goal = worldOf(50, 50);
  const path = computeTilePath(map, start.x, start.y, goal.x, goal.y, 2);
  assert(path === null || Array.isArray(path));
  if (Array.isArray(path)) assertPathIsNavigable(map, path);
});

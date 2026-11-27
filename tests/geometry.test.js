// Prop footprint geometry: one source for collision, raycast and drawing.
import { test, assert, assertEqual, assertDeepEqual } from './harness.js';
import { PropType, TileType } from '../src/config/enums.js';
import { CHUNK_SIZE, TILE_SIZE } from '../src/config/constants.js';
import { CityMap, packChunkKey } from '../src/world/city.js';
import {
  getCarFootprint,
  getDumpsterFootprint,
  getPropFootprint,
  rectContains,
  circleIntersectsRect,
} from '../src/world/geometry.js';

test('geometry: car footprints follow orientation and curb side', () => {
  assertDeepEqual(getCarFootprint(100, 200, false, 'N'), { x: 99, y: 225, w: 68, h: 36 });
  assertDeepEqual(getCarFootprint(100, 200, false, 'S'), { x: 99, y: 205, w: 68, h: 36 });
  assertDeepEqual(getCarFootprint(100, 200, true, 'W'), { x: 125, y: 199, w: 36, h: 68 });
  assertDeepEqual(getCarFootprint(100, 200, true, 'E'), { x: 105, y: 199, w: 36, h: 68 });
});

test('geometry: dumpster footprint is smaller and matches the drawn rect', () => {
  assertDeepEqual(getDumpsterFootprint(100, 200), { x: 124, y: 226.5, w: 18, h: 13 });
  assertDeepEqual(getPropFootprint(PropType.DUMPSTER, 100, 200), { x: 124, y: 226.5, w: 18, h: 13 });
  assertEqual(getPropFootprint(PropType.TREE, 100, 200), null);
  assertEqual(getPropFootprint(PropType.NONE, 100, 200), null);
});

test('geometry: rect containment is inclusive; circle hit uses a strict radius', () => {
  const rect = { x: 10, y: 20, w: 30, h: 40 };
  assertEqual(rectContains(rect, 10, 20), true);
  assertEqual(rectContains(rect, 40, 60), true);
  assertEqual(rectContains(rect, 41, 60), false);
  assertEqual(rectContains(rect, 10, 61), false);

  assertEqual(circleIntersectsRect(rect, 25, 40, 1), true);
  assertEqual(circleIntersectsRect(rect, 40.5, 40, 1), true);
  assertEqual(circleIntersectsRect(rect, 41, 40, 1), false);
  assertEqual(circleIntersectsRect(rect, 42, 40, 1), false);
});

test('geometry: CityMap collision blocks the car footprint and allows clear road', () => {
  const map = new CityMap();
  const ground = Array.from({ length: CHUNK_SIZE }, () => Array(CHUNK_SIZE).fill(TileType.ASPHALT));
  const props = Array.from({ length: CHUNK_SIZE }, () => Array(CHUNK_SIZE).fill(PropType.NONE));
  const propVertical = Array.from({ length: CHUNK_SIZE }, () => Array(CHUNK_SIZE).fill(false));
  const propCurbSide = Array.from({ length: CHUNK_SIZE }, () => Array(CHUNK_SIZE).fill('N'));
  props[0][0] = PropType.CAR;
  propVertical[0][0] = true;
  propCurbSide[0][0] = 'W';
  map.chunks.set(packChunkKey(0, 0), {
    cx: 0,
    cy: 0,
    ground,
    props,
    propVertical,
    propCurbSide,
    solidMask: new Uint8Array(CHUNK_SIZE * CHUNK_SIZE),
  });

  const car = getCarFootprint(0, 0, true, 'W');
  assertEqual(map.canMoveTo(car.x + 1, car.y + 1, 1), false);
  assertEqual(map.canMoveTo(5 * TILE_SIZE, 5 * TILE_SIZE, 5), true);
});

// Minimap layout tests: shared bounds/cell math for drawing and click mapping.
import { test, assert, assertClose, assertEqual } from './harness.js';
import { CHUNK_PX } from '../src/config/constants.js';
import {
  MINIMAP_PADDING,
  getChunkBounds,
  computeMinimapLayout,
  getMinimapLayout,
  chunkToMinimap,
  worldToMinimap,
  minimapToWorld,
} from '../src/render/minimapLayout.js';

function chunk(cx, cy) {
  return { cx, cy };
}

test('minimap layout: bounds cover the chunk grid', () => {
  assertEqual(getChunkBounds([]), null);
  const bounds = getChunkBounds([chunk(2, 3), chunk(5, 4), chunk(1, 7)]);
  assertEqual(bounds.minCx, 1);
  assertEqual(bounds.maxCx, 5);
  assertEqual(bounds.minCy, 3);
  assertEqual(bounds.maxCy, 7);
  assertEqual(bounds.cols, 5);
  assertEqual(bounds.rows, 5);
});

test('minimap layout: square grids are centered with the shared padding', () => {
  const layout = getMinimapLayout([chunk(0, 0), chunk(4, 4)], 140, 140);
  assert(layout);
  assertEqual(MINIMAP_PADDING, 6);
  assertEqual(layout.pad, 6);
  assertEqual(layout.cols, 5);
  assertEqual(layout.rows, 5);
  assertClose(layout.cellSize, 128 / 5);
  assertClose(layout.offsetX, 6);
  assertClose(layout.offsetY, 6);
});

test('minimap layout: rectangular grids letterbox on the short axis', () => {
  const layout = getMinimapLayout([chunk(0, 0), chunk(3, 1)], 140, 140);
  assertEqual(layout.cellSize, 32);
  assertClose(layout.offsetX, 6);
  assertClose(layout.offsetY, 38);
});

test('minimap layout: chunk and world mapping share one transform', () => {
  const layout = computeMinimapLayout(140, 140, {
    minCx: 1,
    minCy: 2,
    maxCx: 5,
    maxCy: 6,
    cols: 5,
    rows: 5,
  });
  const topLeft = chunkToMinimap(layout, 1, 2);
  assertClose(topLeft.x, layout.offsetX);
  assertClose(topLeft.y, layout.offsetY);

  const world = { x: 3.5 * CHUNK_PX, y: 4.25 * CHUNK_PX };
  const screen = worldToMinimap(layout, world.x, world.y);
  const roundTrip = minimapToWorld(layout, screen.x, screen.y);
  assertClose(roundTrip.x, world.x, 1e-6);
  assertClose(roundTrip.y, world.y, 1e-6);
  assertClose(roundTrip.cx, 3.5, 1e-9);
  assertClose(roundTrip.cy, 4.25, 1e-9);
});

test('minimap layout: empty chunk sets produce no layout', () => {
  assertEqual(getMinimapLayout([], 140, 140), null);
  assertEqual(computeMinimapLayout(140, 140, null), null);
});

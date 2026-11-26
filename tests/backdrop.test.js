// City backdrop tests: subtle, deterministic decoration outside the playable map.
import { test, assert, assertEqual } from './harness.js';
import { createCityBackdropCanvas, drawCityBackdrop } from '../src/render/backdrop.js';

test('backdrop: pattern canvas is deterministic and subtle', () => {
  const a = createCityBackdropCanvas();
  const b = createCityBackdropCanvas();
  assert(a && b, 'backdrop canvas should exist');
  assertEqual(a.width, 192);
  assertEqual(a.height, 192);

  const dataA = a.getContext('2d').getImageData(0, 0, 192, 192).data;
  const dataB = b.getContext('2d').getImageData(0, 0, 192, 192).data;
  let brightness = 0;
  for (let i = 0; i < dataA.length; i += 4) {
    brightness += dataA[i] + dataA[i + 1] + dataA[i + 2];
  }
  const average = brightness / ((dataA.length / 4) * 3);
  assert(average > 0 && average < 40, `backdrop should be subtle, average=${average}`);
  for (let i = 0; i < dataA.length; i += 97) assertEqual(dataA[i], dataB[i]);
});

test('backdrop: draw fills the requested world rect', () => {
  const target = document.createElement('canvas');
  target.width = 64;
  target.height = 64;
  const ctx = target.getContext('2d');
  ctx.fillStyle = '#ff0000';
  ctx.fillRect(0, 0, 64, 64);

  drawCityBackdrop(ctx, 0, 0, 64, 64);
  const pixel = ctx.getImageData(32, 32, 1, 1).data;
  assert(pixel[3] > 0, 'backdrop must be opaque');
  assert(pixel[0] < 100, `backdrop should replace the red fill, r=${pixel[0]}`);
});

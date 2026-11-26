// Subtle, deterministic city decoration drawn behind the generated map.
// It fills the world around the playable chunks, so the camera never sees a flat void.

const PATTERN_SIZE = 192;
const patternCache = new WeakMap();

export function createCityBackdropCanvas() {
  const surface = document.createElement('canvas');
  surface.width = PATTERN_SIZE;
  surface.height = PATTERN_SIZE;
  const g = surface.getContext('2d');

  g.fillStyle = '#060608';
  g.fillRect(0, 0, PATTERN_SIZE, PATTERN_SIZE);

  // Four-by-four blocks with 12px streets between them.
  const cell = PATTERN_SIZE / 4;
  for (let by = 0; by < 4; by++) {
    for (let bx = 0; bx < 4; bx++) {
      const x = bx * cell + 6;
      const y = by * cell + 6;
      const w = cell - 12;
      const h = cell - 12;

      g.fillStyle = '#0a0a10';
      g.fillRect(x, y, w, h);
      g.strokeStyle = '#0d0d15';
      g.lineWidth = 1;
      g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

      // Faint roof details / windows.
      g.fillStyle = '#141b28';
      for (let wy = y + 7; wy < y + h - 5; wy += 13) {
        for (let wx = x + 7; wx < x + w - 5; wx += 15) {
          if ((wx + wy) % 3 === 0) g.fillRect(wx, wy, 3, 2);
        }
      }
    }
  }

  // Sparse street markings.
  g.fillStyle = '#11111a';
  for (let i = 0; i < 4; i++) {
    const at = i * cell;
    g.fillRect(at + 18, 0, 3, 5);
    g.fillRect(at + 18, PATTERN_SIZE - 5, 3, 5);
    g.fillRect(0, at + 18, 5, 3);
    g.fillRect(PATTERN_SIZE - 5, at + 18, 5, 3);
  }

  return surface;
}

/** Fill a world-space rect with the cached backdrop pattern. */
export function drawCityBackdrop(ctx, left, top, width, height) {
  if (!ctx || typeof document === 'undefined') return;
  let pattern = patternCache.get(ctx);
  if (!pattern) {
    pattern = ctx.createPattern(createCityBackdropCanvas(), 'repeat');
    if (!pattern) return;
    patternCache.set(ctx, pattern);
  }
  ctx.save();
  ctx.fillStyle = pattern;
  ctx.fillRect(left, top, width, height);
  ctx.restore();
}

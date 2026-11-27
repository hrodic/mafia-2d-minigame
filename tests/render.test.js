// Render layer tests: canvas sizing, primitive drawing and full-frame smoke tests.
import { test, assert, assertEqual } from './harness.js';
import { Faction, UnitRank } from '../src/config/enums.js';
import { ALL_FACTION_SLOTS } from '../src/config/organizations.js';
import { TILE_SIZE, CHUNK_PX } from '../src/config/constants.js';
import { state } from '../src/core/state.js';
import { CityMap } from '../src/world/city.js';
import { ASPHALT_COLOR } from '../src/world/chunk.js';
import { canvas, ctx, minimapCanvas } from '../src/render/canvas.js';
import { resetEffects } from '../src/render/effects.js';
import { resizeCanvas, render } from '../src/render/renderer.js';
import { drawBuilding, drawProp, drawStreetlightGlows, isWindowLit, windowLightAlpha } from '../src/render/world.js';
import { updateAndDrawRain, updateRainSchedule, resetWeather, isRaining, isDayHour, rainChanceForHour, lampIntensityAt, sunIntensityAt, drawAmbientLight } from '../src/render/weather.js';
import { drawCharacter, drawDeadBody } from '../src/render/characters.js';
import { renderMinimap } from '../src/render/minimap.js';

const STATE_KEYS = [
  'world',
  'player',
  'camera',
  'npcs',
  'mouse',
  'minimapCacheTimer',
  'floatingTexts',
  'net',
  'currentWorldSeed',
  'gameHour',
  'tickTimer',
  'tickDuration',
];
const GENERATION = {
  seed: 5150,
  gridSize: 15,
  incomeTier: 'HIGH',
  activeFactions: ALL_FACTION_SLOTS,
};

function makePlayer(overrides = {}) {
  return {
    x: 330,
    y: 330,
    hp: 400,
    maxHp: 400,
    armor: 0,
    maxArmor: 300,
    alive: true,
    facing: 0,
    speed: 225,
    minDmg: 20,
    maxDmg: 40,
    attackCooldown: 0,
    slashAnimTimer: 0,
    muzzleFlashTimer: 0,
    hitFlashTimer: 0,
    armorCooldown: 0,
    sprintTimer: 0,
    sprintCooldown: 0,
    isSprinting: false,
    targetX: null,
    targetY: null,
    ...overrides,
  };
}

function withRenderState(opts, fn) {
  const saved = {};
  for (const key of STATE_KEYS) saved[key] = state[key];

  const map = opts.map || new CityMap(GENERATION);
  if (opts.prepareMap) opts.prepareMap(map);
  state.world = map;
  state.player = opts.player || makePlayer();
  state.camera = { x: state.player.x, y: state.player.y };
  state.npcs = opts.npcs || [];
  state.mouse = { screenX: null, screenY: null, inside: false };
  state.minimapCacheTimer = 1.0;
  state.floatingTexts = [];
  state.net = null;
  state.currentWorldSeed = 5150;
  state.gameHour = 12;
  state.tickTimer = 0;
  state.tickDuration = 15;
  resetEffects();

  try {
    return fn({ map });
  } finally {
    for (const key of STATE_KEYS) state[key] = saved[key];
    resetEffects();
  }
}

test('render: resizeCanvas sizes the canvas to at least the minimum', () => {
  withRenderState({}, () => {
    resizeCanvas();
    assert(canvas.width >= 320, `canvas width ${canvas.width}`);
    assert(canvas.height >= 240, `canvas height ${canvas.height}`);
  });
});

test('render: buildings and every prop type draw without throwing', () => {
  withRenderState(
    {
      prepareMap: (map) => {
        map.generateChunk(0, 0);
        map.generateChunk(1, 0);
      },
    },
    ({ map }) => {
      const chunk = map.getChunk(0, 0);
      assert(chunk.buildingRenderList.length > 0, 'chunk should have buildings');
      for (let i = 0; i < Math.min(4, chunk.buildingRenderList.length); i++) {
        drawBuilding(chunk.buildingRenderList[i]);
      }
      for (let i = 0; i < Math.min(4, chunk.propRenderList.length); i++) {
        drawProp(chunk.propRenderList[i]);
      }
      for (const prop of [1, 2, 3, 4, 5]) {
        drawProp({ wx: 10, wy: 10, prop, color: '#18181b', vertical: prop % 2 === 0, curbSide: 'N' });
      }
    }
  );
});

test('render: streetlight glows and dark asphalt establish ambient contrast', () => {
  assertEqual(ASPHALT_COLOR, '#111318');
  withRenderState({}, () => {
    const x = 120;
    const y = 120;
    state.gameHour = 23;
    state.tickTimer = 0;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const before = ctx.getImageData(x, y, 1, 1).data;
    drawStreetlightGlows([{ wx: x - 22, wy: y - 26 }]);
    const after = ctx.getImageData(x, y, 1, 1).data;
    const beforeSum = before[0] + before[1] + before[2] + before[3];
    const afterSum = after[0] + after[1] + after[2] + after[3];
    assert(afterSum > beforeSum, 'lamp glow should warm the ground pixels at night');
  });
});

test('render: lamps turn off by day and ambient light turns sunny', () => {
  assertEqual(lampIntensityAt(7), 1);
  assertEqual(lampIntensityAt(7.5), 0.5);
  assertEqual(lampIntensityAt(8), 0);
  assertEqual(lampIntensityAt(12), 0);
  assertEqual(lampIntensityAt(21), 0);
  assertEqual(lampIntensityAt(21.5), 0.5);
  assertEqual(lampIntensityAt(22), 1);
  assertEqual(lampIntensityAt(2), 1);
  assertEqual(sunIntensityAt(12), 1);

  const fills = [];
  const fakeCtx = {
    fillStyle: '',
    globalCompositeOperation: 'source-over',
    save() {},
    restore() {},
    fillRect() { fills.push(this.fillStyle); },
  };
  drawAmbientLight(fakeCtx, 800, 600, 12);
  assertEqual(fills.length, 1);
  assert(fills[0].startsWith('rgba(255, 214, 160'), fills[0]);
  fills.length = 0;
  drawAmbientLight(fakeCtx, 800, 600, 23);
  assertEqual(fills.length, 1);
  assert(fills[0].startsWith('rgba(18, 30, 52'), fills[0]);

  withRenderState({}, () => {
    const x = 120;
    const y = 120;
    state.gameHour = 12;
    state.tickTimer = 0;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawStreetlightGlows([{ wx: x - 22, wy: y - 26 }]);
    assertEqual(ctx.getImageData(x, y, 1, 1).data[3], 0, 'daytime lamps should not glow');
    state.gameHour = 23;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawStreetlightGlows([{ wx: x - 22, wy: y - 26 }]);
    assert(ctx.getImageData(x, y, 1, 1).data[3] > 0, 'night lamps should glow');
  });
});

test('render: chunk ground layers and building sprites are cached', () => {
  withRenderState(
    {
      prepareMap: (map) => {
        map.generateChunk(0, 0);
      },
    },
    ({ map }) => {
      const chunk = map.getChunk(0, 0);
      const building = chunk.buildingRenderList[0];
      drawBuilding(building);
      assert(building.sprite, 'building sprite should be cached');
      const firstSprite = building.sprite;
      drawBuilding(building);
      assertEqual(building.sprite, firstSprite, 'building sprite should be reused');

      render();
      assert(chunk.groundCache, 'ground cache should be built on first render');
      const firstGround = chunk.groundCache;
      render();
      assertEqual(chunk.groundCache, firstGround, 'ground cache should be reused');
    }
  );
});

test('render: facade window lighting stays between 15 and 25 percent', () => {
  let lit = 0;
  for (let i = 0; i < 500; i++) {
    if (isWindowLit(5150, i * TILE_SIZE, (i % 7) * TILE_SIZE, i % 5, i % 3, 0)) lit++;
  }
  assert(lit >= 75 && lit <= 125, `lit windows ${lit}/500`);
  for (let i = 0; i < 20; i++) {
    const alpha = windowLightAlpha(i * 97, i % 24, i / 3);
    assert(alpha >= 0.35 && alpha <= 0.85, `window alpha ${alpha}`);
  }
  const slowA = windowLightAlpha(12345, 0, 0, 15);
  const slowB = windowLightAlpha(12345, 0, 10, 15);
  assert(Math.abs(slowA - slowB) < 0.01, 'window flicker should take about 10 seconds');
});

test('render: rain covers both halves of the viewport', () => {
  const xs = [];
  const fakeCtx = {
    strokeStyle: '',
    lineWidth: 1,
    save() {},
    restore() {},
    beginPath() {},
    stroke() {},
    moveTo(x) { xs.push(x); },
    lineTo() {},
  };
  for (let frame = 0; frame < 300; frame++) {
    xs.length = 0;
    updateAndDrawRain(fakeCtx, 800, 600, 1 / 60, true);
  }
  const left = xs.filter((x) => x < 400).length;
  const right = xs.filter((x) => x >= 400).length;
  assert(left >= 20 && right >= 20, `rain distribution left=${left} right=${right}`);
});

test('render: rain decisions happen only at day/night boundaries', () => {
  assert(isDayHour(8) && isDayHour(21));
  assert(!isDayHour(22) && !isDayHour(7));
  assertEqual(rainChanceForHour(12), 0.25);
  assertEqual(rainChanceForHour(23), 0.5);

  let changes = 0;
  for (let seed = 0; seed < 30; seed++) {
    resetWeather(seed);
    const day = updateRainSchedule(8);
    assertEqual(updateRainSchedule(9), day);
    assertEqual(updateRainSchedule(21), day);
    const night = updateRainSchedule(22);
    assertEqual(updateRainSchedule(23), night);
    assertEqual(updateRainSchedule(7), night);
    assertEqual(isRaining(), night);
    if (day !== night) changes++;
  }
  assert(changes > 0, 'night decisions should sometimes differ from day decisions');
});

test('render: rain overlay is capped and can be suppressed by the schedule flag', () => {
  const counts = { moves: 0, lines: 0 };
  const fakeCtx = {
    strokeStyle: '',
    lineWidth: 1,
    save() {},
    restore() {},
    beginPath() {},
    moveTo() { counts.moves++; },
    lineTo() { counts.lines++; },
    stroke() {},
  };
  let segments = 0;
  for (let i = 0; i < 120; i++) {
    segments = updateAndDrawRain(fakeCtx, 800, 600, 1 / 60, true);
  }
  assert(segments >= 60 && segments <= 80, `rain segments ${segments}`);
  assertEqual(counts.moves, counts.lines);
  assertEqual(updateAndDrawRain(fakeCtx, 800, 600, 1 / 60, false), 0);
});

test('render: characters draw in all visual states and corpses do not throw', () => {
  withRenderState({}, () => {
    const base = {
      coatColor: '#065f46',
      accentColor: '#34d399',
      label: 'Don',
      hp: 400,
      maxHp: 400,
      armor: 0,
      maxArmor: 300,
      facing: 0,
      isBoss: true,
      isAttacking: false,
      slashProgress: 0,
      isShooting: false,
      hitFlash: false,
    };
    drawCharacter(100, 100, base);
    drawCharacter(100, 100, { ...base, facing: Math.PI / 2, isAttacking: true, slashProgress: 0.5 });
    drawCharacter(100, 100, { ...base, isBoss: false, isUnderboss: true, armor: 120, isShooting: true });
    drawCharacter(100, 100, { ...base, isBoss: false, isCaptain: true, facing: -Math.PI / 2, hitFlash: true });
    drawCharacter(100, 100, { ...base, isBoss: false, facing: Math.PI });
    drawCharacter(100, 100, { ...base, hp: 50, facing: -Math.PI });
    drawDeadBody({
      x: 100,
      y: 100,
      coatColor: '#065f46',
      accentColor: '#34d399',
      isBoss: true,
      collapseDir: 1,
      tiltAngle: 0.1,
      poolRadius: 4,
      maxPoolRadius: 22,
      life: 14,
      maxLife: 14,
    });
    assert(true);
  });
});

test('render: a full frame renders a city and updates the radar coordinates', () => {
  withRenderState(
    {
      prepareMap: (map) => {
        map.generateChunk(0, 0);
      },
    },
    () => {
      render();
      const pixel = canvas.getContext('2d').getImageData(0, 0, 1, 1).data;
      assert(pixel[3] > 0, 'canvas should not be fully transparent');
      const coords = document.getElementById('minimap-coords').textContent;
      assert(/^\(\d+, \d+\)$/.test(coords), `unexpected coords: ${coords}`);
      assertEqual(coords, '(0, 0)');
    }
  );
});

test('render: the aim label shows only the chance percentage', () => {
  withRenderState(
    {
      prepareMap: (map) => map.generateChunk(0, 0),
    },
    () => {
      state.mouse = {
        screenX: canvas.width / 2 + 120,
        screenY: canvas.height / 2,
        inside: true,
      };
      const ctx = canvas.getContext('2d');
      const originalFillText = ctx.fillText.bind(ctx);
      const texts = [];
      ctx.fillText = (text, x, y) => {
        texts.push(String(text));
        return originalFillText(text, x, y);
      };
      try {
        render();
      } finally {
        ctx.fillText = originalFillText;
      }
      assert(
        texts.some((text) => /^\d+% chance$/.test(text)),
        `expected a simplified chance label; got ${texts.join(' | ')}`
      );
      assert(
        !texts.some((text) => /ACC|MISS|DMG|OUT OF RANGE/.test(text)),
        `old accuracy label text should be gone; got ${texts.join(' | ')}`
      );
    }
  );
});

test('render: visible chunks draw their income labels', () => {
  withRenderState(
    {
      prepareMap: (map) => map.generateChunk(0, 0),
    },
    () => {
      const ctx = canvas.getContext('2d');
      const originalFillText = ctx.fillText.bind(ctx);
      const texts = [];
      ctx.fillText = (text, x, y) => {
        texts.push(text);
        return originalFillText(text, x, y);
      };
      try {
        render();
      } finally {
        ctx.fillText = originalFillText;
      }
      const chunk = state.world.getChunk(0, 0);
      assert(
        texts.includes(chunk.incomeLabel),
        `expected ${chunk.incomeLabel} to be drawn; got ${texts.join(' | ')}`
      );
    }
  );
});

test('render: the radar follows the boss into another chunk', () => {
  withRenderState(
    {
      prepareMap: (map) => {
        map.generateChunk(0, 0);
        map.generateChunk(1, 0);
      },
      player: makePlayer({ x: CHUNK_PX + 50, y: 100 }),
    },
    () => {
      renderMinimap();
      assertEqual(document.getElementById('minimap-coords').textContent, '(1, 0)');
      const pixel = minimapCanvas.getContext('2d').getImageData(10, 10, 1, 1).data;
      assert(pixel[3] > 0, 'minimap should be painted');
    }
  );
});

test('render: radar cache timer advances by the supplied frame dt', () => {
  withRenderState(
    {
      prepareMap: (map) => map.generateChunk(0, 0),
    },
    () => {
      state.minimapCacheTimer = 0.2;
      renderMinimap(0.1);
      assertEqual(state.minimapCacheTimer.toFixed(1), '0.3');
    }
  );
});

test('render: a local rival boss renders with its multiplayer alias', () => {
  withRenderState(
    {
      prepareMap: (map) => map.generateChunk(0, 0),
      npcs: [
        {
          id: 42,
          faction: Faction.RIVAL_1,
          rank: UnitRank.BOSS,
          x: 330,
          y: 330,
          bodyRadius: 13.5,
          hp: 400,
          maxHp: 400,
          armor: 0,
          maxArmor: 300,
          facing: 0,
          slashAnimTimer: 0,
          muzzleFlashTimer: 0,
          hitFlashTimer: 0,
        },
      ],
    },
    () => {
      state.net = {
        isActive: () => true,
        localFaction: Faction.RIVAL_1,
        getAliasForFaction: (faction) => (faction === Faction.RIVAL_1 ? 'GuestTest' : null),
      };
      render();
      assert(true);
    }
  );
});

test('render: rendering an empty world is safe', () => {
  withRenderState({ map: new CityMap() }, () => {
    render();
    assert(true);
  });
});

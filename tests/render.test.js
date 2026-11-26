// Render layer tests: canvas sizing, primitive drawing and full-frame smoke tests.
import { test, assert, assertEqual } from './harness.js';
import { Faction, UnitRank } from '../src/config/enums.js';
import { ALL_FACTION_SLOTS } from '../src/config/organizations.js';
import { state } from '../src/core/state.js';
import { CityMap } from '../src/world/city.js';
import { canvas, minimapCanvas } from '../src/render/canvas.js';
import { resetEffects } from '../src/render/effects.js';
import { resizeCanvas, render } from '../src/render/renderer.js';
import { drawBuilding, drawProp } from '../src/render/world.js';
import { drawCharacter, drawDeadBody } from '../src/render/characters.js';
import { renderMinimap } from '../src/render/minimap.js';

const STATE_KEYS = ['world', 'player', 'camera', 'npcs', 'showBorders', 'mouse', 'minimapCacheTimer', 'floatingTexts', 'net'];
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
  state.showBorders = true;
  state.mouse = { screenX: null, screenY: null, inside: false };
  state.minimapCacheTimer = 1.0;
  state.floatingTexts = [];
  state.net = null;
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

test('render: the radar follows the boss into another chunk', () => {
  withRenderState(
    {
      prepareMap: (map) => {
        map.generateChunk(0, 0);
        map.generateChunk(1, 0);
      },
      player: makePlayer({ x: 700, y: 100 }),
    },
    () => {
      renderMinimap();
      assertEqual(document.getElementById('minimap-coords').textContent, '(1, 0)');
      const pixel = minimapCanvas.getContext('2d').getImageData(10, 10, 1, 1).data;
      assert(pixel[3] > 0, 'minimap should be painted');
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

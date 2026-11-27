// World layer tests: deterministic chunk generation, city queries/collision,
// ring expansion and the spatial index. Written before the extraction (TDD).
import { test, assert, assertEqual, assertDeepEqual } from './harness.js';
import { Faction, TileType, PropType } from '../src/config/enums.js';
import { INCOME_TIERS } from '../src/config/balance.js';
import { CHUNK_SIZE, TILE_SIZE } from '../src/config/constants.js';
import { DistrictChunk } from '../src/world/chunk.js';
import { CityMap, packChunkKey } from '../src/world/city.js';
import { rebuildSpatialBuckets } from '../src/core/spatial.js';

const ALL_FACTIONS = [Faction.PLAYER, Faction.RIVAL_1, Faction.RIVAL_2, Faction.RIVAL_3];
const GENERATION = {
  seed: 123456789,
  gridSize: 15,
  incomeTier: 'HIGH',
  activeFactions: ALL_FACTIONS,
};

function chunkSignature(chunk) {
  return JSON.stringify({
    ground: chunk.ground,
    elevation: chunk.elevation,
    buildingStyle: chunk.buildingStyle,
    props: chunk.props,
    propColors: chunk.propColors,
    propVertical: chunk.propVertical,
    propCurbSide: chunk.propCurbSide,
    income: chunk.income,
    faction: chunk.faction,
    solidMask: Array.from(chunk.solidMask),
  });
}

function findTile(chunk, predicate) {
  for (let ly = 0; ly < CHUNK_SIZE; ly++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      if (predicate(chunk.ground[ly][lx], chunk.props[ly][lx], lx, ly)) {
        return { lx, ly };
      }
    }
  }
  return null;
}

function tileCenterWorld(map, cx, cy, lx, ly) {
  return {
    x: (cx * CHUNK_SIZE + lx + 0.5) * TILE_SIZE,
    y: (cy * CHUNK_SIZE + ly + 0.5) * TILE_SIZE,
  };
}

test('world: same seed and coords generate identical chunks', () => {
  const a = new DistrictChunk(2, 3, GENERATION);
  const b = new DistrictChunk(2, 3, GENERATION);
  assertEqual(chunkSignature(a), chunkSignature(b));
});

test('world: different seeds change the generated city', () => {
  const coords = [[0, 0], [1, 0], [0, 1], [1, 1], [2, 2], [3, 3]];
  const seedA = coords.map(([cx, cy]) => chunkSignature(new DistrictChunk(cx, cy, { ...GENERATION, seed: 1 })));
  const seedB = coords.map(([cx, cy]) => chunkSignature(new DistrictChunk(cx, cy, { ...GENERATION, seed: 2 })));
  assert(seedA.some((sig, i) => sig !== seedB[i]), 'seeds 1 and 2 generated identical chunks');
});

test('world: neighborhood income stays inside the selected tier', () => {
  for (const tierName of Object.keys(INCOME_TIERS)) {
    const tier = INCOME_TIERS[tierName];
    for (let cx = 0; cx < 4; cx++) {
      const chunk = new DistrictChunk(cx, 2, { ...GENERATION, incomeTier: tierName });
      assert(chunk.income >= tier.min && chunk.income <= tier.max, `${tierName}: ${chunk.income}`);
      assertEqual(chunk.incomeLabel, `$${chunk.income.toLocaleString()}/hr`);
    }
  }
});

test('world: starting corners are assigned to the right factions', () => {
  const last = GENERATION.gridSize - 1;
  assertEqual(new DistrictChunk(0, 0, GENERATION).faction, Faction.PLAYER);
  assertEqual(new DistrictChunk(last, 0, GENERATION).faction, Faction.RIVAL_1);
  assertEqual(new DistrictChunk(0, last, GENERATION).faction, Faction.RIVAL_2);
  assertEqual(new DistrictChunk(last, last, GENERATION).faction, Faction.RIVAL_3);
  assertEqual(new DistrictChunk(5, 5, GENERATION).faction, Faction.NEUTRAL);
});

test('world: inactive rival slots do not own corners', () => {
  const generation = { ...GENERATION, activeFactions: [Faction.PLAYER, Faction.RIVAL_3] };
  const last = generation.gridSize - 1;
  assertEqual(new DistrictChunk(last, 0, generation).faction, Faction.NEUTRAL);
  assertEqual(new DistrictChunk(0, last, generation).faction, Faction.NEUTRAL);
  assertEqual(new DistrictChunk(last, last, generation).faction, Faction.RIVAL_3);
});

test('world: solid mask matches buildings and blocking props', () => {
  const chunk = new DistrictChunk(4, 4, GENERATION);
  for (let ly = 0; ly < CHUNK_SIZE; ly++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const ground = chunk.ground[ly][lx];
      const prop = chunk.props[ly][lx];
      const expected =
        ground === TileType.BUILDING || prop === PropType.CAR ? 1 : 0;
      assertEqual(chunk.solidMask[ly * CHUNK_SIZE + lx], expected, `tile ${lx},${ly}`);
    }
  }
});

test('world: CityMap caches generated chunks and reports ownership', () => {
  const map = new CityMap(GENERATION);
  assertEqual(map.hasChunk(0, 0), false);
  const chunk = map.generateChunk(0, 0);
  assertEqual(map.hasChunk(0, 0), true);
  assert(map.generateChunk(0, 0) === chunk, 'generateChunk must return the cached instance');
  assertEqual(map.chunks.size, 1);
  assertEqual(map.getChunk(0, 0), chunk);
  assertEqual(map.getChunk(9, 9), undefined);
});

test('world: worldToTile handles chunk offsets and negative coordinates', () => {
  const map = new CityMap(GENERATION);
  assertDeepEqual(map.worldToTile(0, 0), { cx: 0, cy: 0, lx: 0, ly: 0 });
  assertDeepEqual(map.worldToTile(-1, -1), { cx: -1, cy: -1, lx: CHUNK_SIZE - 1, ly: CHUNK_SIZE - 1 });
  const span = CHUNK_SIZE * TILE_SIZE;
  assertDeepEqual(map.worldToTile(span, span), { cx: 1, cy: 1, lx: 0, ly: 0 });
  assertDeepEqual(map.worldToTile(span + TILE_SIZE * 2, TILE_SIZE), { cx: 1, cy: 0, lx: 2, ly: 1 });
});

test('world: walkability and navigation distinguish buildings from streets', () => {
  const map = new CityMap(GENERATION);
  const chunk = map.generateChunk(0, 0);
  const building = findTile(chunk, (ground) => ground === TileType.BUILDING);
  const street = findTile(chunk, (ground) => ground !== TileType.BUILDING);
  assert(building && street, 'chunk must contain both buildings and streets');

  const b = tileCenterWorld(map, 0, 0, building.lx, building.ly);
  const s = tileCenterWorld(map, 0, 0, street.lx, street.ly);
  assertEqual(map.isWalkable(b.x, b.y), false);
  assertEqual(map.isWalkable(s.x, s.y), true);
  assertEqual(map.isTileNavigable(0 * CHUNK_SIZE + building.lx, 0 * CHUNK_SIZE + building.ly), false);
  assertEqual(map.canMoveTo(b.x, b.y, 11), false);
});

test('world: canMoveTo allows a clear road, cars block and containers do not', () => {
  const map = new CityMap(GENERATION);
  const chunk = map.generateChunk(0, 0);
  const corner = tileCenterWorld(map, 0, 0, 0, 0);
  assertEqual(chunk.ground[0][0], TileType.ASPHALT);
  assertEqual(map.canMoveTo(corner.x, corner.y, 11), true);

  const dumpster = findTile(chunk, (ground, prop) => prop === PropType.DUMPSTER);
  if (dumpster) {
    const d = tileCenterWorld(map, 0, 0, dumpster.lx, dumpster.ly);
    assertEqual(map.canMoveTo(d.x, d.y, 11), true);
    const nearBuilding = [
      [1, 0], [-1, 0], [0, 1], [0, -1],
    ].some(([dx, dy]) => {
      const nx = dumpster.lx + dx;
      const ny = dumpster.ly + dy;
      return nx >= 0 && ny >= 0 && nx < CHUNK_SIZE && ny < CHUNK_SIZE
        && chunk.ground[ny][nx] === TileType.BUILDING;
    });
    assert(nearBuilding, 'containers should sit next to a building');
  }
});

test('world: findNearestWalkablePoint escapes a building tile', () => {
  const map = new CityMap(GENERATION);
  const chunk = map.generateChunk(0, 0);
  const building = findTile(chunk, (ground) => ground === TileType.BUILDING);
  assert(building);
  const inside = tileCenterWorld(map, 0, 0, building.lx, building.ly);
  const snapped = map.findNearestWalkablePoint(inside.x, inside.y, 12);
  assert(snapped, 'expected a nearby walkable point');
  assertEqual(map.canMoveTo(snapped.x, snapped.y, 12), true);
});

test('world: clear() drops chunks and the lookup cache', () => {
  const map = new CityMap(GENERATION);
  map.generateChunk(0, 0);
  map.clear();
  assertEqual(map.chunks.size, 0);
  assertEqual(map.getChunk(0, 0), undefined);
});

test('world: packChunkKey is unique across neighbours', () => {
  const keys = [
    packChunkKey(0, 0),
    packChunkKey(1, 0),
    packChunkKey(0, 1),
    packChunkKey(-1, -1),
    packChunkKey(-1, 0),
    packChunkKey(0, -1),
  ];
  assertEqual(new Set(keys).size, keys.length);
});

test('world: spatial buckets group units by chunk and recycle arrays', () => {
  const buckets = new Map();
  const pool = [];
  const span = CHUNK_SIZE * TILE_SIZE;
  const a = { id: 1, x: 10, y: 10 };
  const b = { id: 2, x: span + 10, y: 10 };
  const c = { id: 3, x: 10, y: span + 10 };

  rebuildSpatialBuckets([a, b, c], buckets, pool);
  assertEqual(buckets.size, 3);
  assertEqual(buckets.get(packChunkKey(0, 0))[0], a);
  assertEqual(buckets.get(packChunkKey(1, 0))[0], b);
  assertEqual(buckets.get(packChunkKey(0, 1))[0], c);

  rebuildSpatialBuckets([a], buckets, pool);
  assertEqual(buckets.size, 1);
  assertEqual(buckets.get(packChunkKey(0, 0))[0], a);
  assert(pool.length >= 2, 'recycled buckets should return to the pool');
});

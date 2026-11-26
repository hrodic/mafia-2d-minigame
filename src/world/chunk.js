// District blocks: seeded 15x15 urban layouts with buildings, props and render lists.

import { CHUNK_SIZE, TILE_SIZE, CHUNK_PX, DEFAULT_GRID_SIZE } from '../config/constants.js';
import { TileType, PropType, Faction } from '../config/enums.js';
import { INCOME_TIERS } from '../config/balance.js';
import { ALL_FACTION_SLOTS } from '../config/organizations.js';
import { hashChunkSeed, createMulberry32 } from '../core/rng.js';

const CAR_PALETTE = ['#18181b', '#27272a', '#e4e4e7', '#1e293b', '#3f3f46', '#7f1d1d'];


export class DistrictChunk {
  constructor(cx, cy, generation = {}, forcedFaction = null) {
    this.cx = cx;
    this.cy = cy;
    this.generation = {
      seed: generation.seed ?? null,
      gridSize: generation.gridSize ?? DEFAULT_GRID_SIZE,
      incomeTier: generation.incomeTier ?? 'HIGH',
      activeFactions: generation.activeFactions ?? ALL_FACTION_SLOTS,
    };
    this.key = `${cx},${cy}`;

    this.ground = Array.from({ length: CHUNK_SIZE }, () => Array(CHUNK_SIZE).fill(TileType.ASPHALT));
    this.elevation = Array.from({ length: CHUNK_SIZE }, () => Array(CHUNK_SIZE).fill(0));
    this.buildingStyle = Array.from({ length: CHUNK_SIZE }, () => Array(CHUNK_SIZE).fill(0));
    this.props = Array.from({ length: CHUNK_SIZE }, () => Array(CHUNK_SIZE).fill(PropType.NONE));
    this.propColors = Array.from({ length: CHUNK_SIZE }, () => Array(CHUNK_SIZE).fill('#18181b'));
    this.propVertical = Array.from({ length: CHUNK_SIZE }, () => Array(CHUNK_SIZE).fill(false));
    this.propCurbSide = Array.from({ length: CHUNK_SIZE }, () => Array(CHUNK_SIZE).fill('N'));
    this.solidMask = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    this.faction = forcedFaction || this.determineInitialFaction(cx, cy);
    this.captureProgress = 0;
    this.capturingFaction = null;
    this.buildingRenderList = [];
    this.propRenderList = [];

    const chunkSeed = this.generation.seed !== null ? hashChunkSeed(this.generation.seed, cx, cy) : null;
    const rng = chunkSeed !== null ? createMulberry32(chunkSeed) : Math.random;
    const tier = INCOME_TIERS[this.generation.incomeTier] || INCOME_TIERS.HIGH;
    this.income = tier.min + Math.floor(rng() * (tier.max - tier.min + 1));
    this.incomeLabel = `$${this.income.toLocaleString()}/hr`;
    this.generateUrbanBlock(rng);

    this.buildSolidMask();
    this.buildStaticRenderLists();
  }

  buildStaticRenderLists() {
    const chunkOriginX = this.cx * CHUNK_PX;
    const chunkOriginY = this.cy * CHUNK_PX;
    this.buildingRenderList.length = 0;
    this.propRenderList.length = 0;

    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const tile = this.ground[ly][lx];
        const wx = chunkOriginX + lx * TILE_SIZE;
        const wy = chunkOriginY + ly * TILE_SIZE;

        if (tile === TileType.BUILDING) {
          this.buildingRenderList.push({
            type: 'building',
            sortY: wy + TILE_SIZE,
            wx,
            wy,
            elev: this.elevation[ly][lx],
            style: this.buildingStyle[ly][lx],
            hasSouthBuilding: ly + 1 < CHUNK_SIZE && this.ground[ly + 1][lx] === TileType.BUILDING,
            hasEastBuilding: lx + 1 < CHUNK_SIZE && this.ground[ly][lx + 1] === TileType.BUILDING,
            hasWestBuilding: lx - 1 >= 0 && this.ground[ly][lx - 1] === TileType.BUILDING,
          });
        }

        const prop = this.props[ly][lx];
        if (prop !== PropType.NONE) {
          let propSortY = wy + TILE_SIZE * 0.72;
          if (prop === PropType.CAR) {
            propSortY = this.propVertical[ly][lx] ? wy + 39 : wy + 28;
          } else if (prop === PropType.STREETLIGHT || prop === PropType.TREE) {
            propSortY = wy + 26;
          } else if (prop === PropType.DUMPSTER) {
            propSortY = wy + 32;
          }
          this.propRenderList.push({
            type: 'prop',
            sortY: propSortY,
            wx,
            wy,
            prop,
            color: this.propColors[ly][lx],
            vertical: this.propVertical[ly][lx],
            curbSide: this.propCurbSide[ly][lx],
          });
        }
      }
    }
  }

  buildSolidMask() {
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const idx = ly * CHUNK_SIZE + lx;
        const g = this.ground[ly][lx];
        const p = this.props[ly][lx];
        this.solidMask[idx] =
          g === TileType.BUILDING || p === PropType.CAR || p === PropType.DUMPSTER ? 1 : 0;
      }
    }
  }

  determineInitialFaction(cx, cy) {
    const last = this.generation.gridSize - 1;
    if (cx === 0 && cy === 0 && this.generation.activeFactions.includes(Faction.PLAYER)) return Faction.PLAYER;
    if (cx === last && cy === 0 && this.generation.activeFactions.includes(Faction.RIVAL_1)) return Faction.RIVAL_1;
    if (cx === 0 && cy === last && this.generation.activeFactions.includes(Faction.RIVAL_2)) return Faction.RIVAL_2;
    if (cx === last && cy === last && this.generation.activeFactions.includes(Faction.RIVAL_3)) return Faction.RIVAL_3;
    return Faction.NEUTRAL;
  }

  drawGroundDirect(targetCtx, originX, originY, viewLeft, viewRight, viewTop, viewBottom) {
    const minLx = Math.max(0, Math.floor((viewLeft - originX) / TILE_SIZE));
    const maxLx = Math.min(CHUNK_SIZE - 1, Math.floor((viewRight - originX) / TILE_SIZE));
    const minLy = Math.max(0, Math.floor((viewTop - originY) / TILE_SIZE));
    const maxLy = Math.min(CHUNK_SIZE - 1, Math.floor((viewBottom - originY) / TILE_SIZE));
    if (minLx > maxLx || minLy > maxLy) return;

    for (let ly = minLy; ly <= maxLy; ly++) {
      for (let lx = minLx; lx <= maxLx; lx++) {
        const tile = this.ground[ly][lx];
        const wx = originX + lx * TILE_SIZE;
        const wy = originY + ly * TILE_SIZE;

        if (tile === TileType.ASPHALT) {
          targetCtx.fillStyle = '#18181b';
          targetCtx.fillRect(wx, wy, TILE_SIZE, TILE_SIZE);

          if ((ly === 0 || ly === CHUNK_SIZE - 1) && lx > 1 && lx < CHUNK_SIZE - 2 && lx % 2 === 0) {
            targetCtx.fillStyle = '#ca8a04';
            targetCtx.fillRect(wx + 10, wy + TILE_SIZE / 2 - 1.5, 22, 3);
          }
          if ((lx === 0 || lx === CHUNK_SIZE - 1) && ly > 1 && ly < CHUNK_SIZE - 2 && ly % 2 === 0) {
            targetCtx.fillStyle = '#ca8a04';
            targetCtx.fillRect(wx + TILE_SIZE / 2 - 1.5, wy + 10, 3, 22);
          }

          if ((lx === 0 || lx === CHUNK_SIZE - 1) && (ly === 1 || ly === CHUNK_SIZE - 2)) {
            targetCtx.fillStyle = 'rgba(244, 244, 245, 0.32)';
            for (let s = 4; s < TILE_SIZE - 4; s += 8) {
              targetCtx.fillRect(wx + s, wy + 4, 4, TILE_SIZE - 8);
            }
          }

          if (this.props[ly][lx] === PropType.CAR) {
            const side = this.propCurbSide[ly][lx];
            targetCtx.fillStyle = 'rgba(9, 9, 11, 0.45)';
            if (side === 'N') targetCtx.fillRect(wx + 2, wy + 18, TILE_SIZE - 4, 24);
            else if (side === 'S') targetCtx.fillRect(wx + 2, wy + 2, TILE_SIZE - 4, 24);
            else if (side === 'W') targetCtx.fillRect(wx + 18, wy + 2, 24, TILE_SIZE - 4);
            else if (side === 'E') targetCtx.fillRect(wx + 2, wy + 2, 24, TILE_SIZE - 4);
          }
        } else {
          const curbLift = 4;
          targetCtx.fillStyle = '#3f3f46';
          targetCtx.fillRect(wx, wy + TILE_SIZE - curbLift, TILE_SIZE, curbLift);

          if (tile === TileType.SIDEWALK || tile === TileType.BUILDING) {
            targetCtx.fillStyle = '#64748b';
          } else if (tile === TileType.PLAZA) {
            targetCtx.fillStyle = '#78716c';
          } else {
            targetCtx.fillStyle = '#27272a';
          }
          targetCtx.fillRect(wx, wy - curbLift, TILE_SIZE, TILE_SIZE);
        }
      }
    }
  }

  generateUrbanBlock(rng) {
    const LAST = CHUNK_SIZE - 1;
    const IN = CHUNK_SIZE - 2;

    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const isRoad = lx === 0 || lx === LAST || ly === 0 || ly === LAST;
        if (!isRoad) {
          this.ground[ly][lx] = TileType.SIDEWALK;
          this.elevation[ly][lx] = 1;
        }
      }
    }

    const placeBuildingRect = (x0, y0, x1, y1, elevOverride = null, styleOverride = null) => {
      const elev = elevOverride !== null ? elevOverride : 2 + Math.floor(rng() * 3);
      const style = styleOverride !== null ? styleOverride : Math.floor(rng() * 3);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          this.ground[y][x] = TileType.BUILDING;
          this.elevation[y][x] = elev;
          this.buildingStyle[y][x] = style;
        }
      }
    };

    const carvePlazaRect = (x0, y0, x1, y1) => {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          this.ground[y][x] = TileType.PLAZA;
          this.elevation[y][x] = 1;
        }
      }
    };

    const carveAlleyRect = (x0, y0, x1, y1) => {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          this.ground[y][x] = TileType.ALLEY;
          this.elevation[y][x] = 1;
        }
      }
    };

    const archetype = Math.floor(rng() * 6);

    if (archetype === 0) {
      placeBuildingRect(2, 2, 5, 5);
      placeBuildingRect(9, 2, 12, 5);
      placeBuildingRect(2, 9, 5, 12);
      placeBuildingRect(9, 9, 12, 12);
      carveAlleyRect(6, 2, 8, 12);
      carveAlleyRect(2, 6, 12, 8);
      carvePlazaRect(5, 5, 9, 9);
      placeBuildingRect(7, 7, 7, 7, 2, 1);
    } else if (archetype === 1) {
      placeBuildingRect(2, 2, 4, 5);
      placeBuildingRect(6, 2, 8, 5);
      placeBuildingRect(10, 2, 12, 5);
      placeBuildingRect(2, 8, 4, 12);
      placeBuildingRect(6, 8, 8, 12);
      placeBuildingRect(10, 8, 12, 12);
      carveAlleyRect(5, 2, 5, 12);
      carveAlleyRect(9, 2, 9, 12);
      carveAlleyRect(2, 6, 12, 7);
    } else if (archetype === 2) {
      placeBuildingRect(2, 2, 7, 4);
      placeBuildingRect(9, 2, 12, 5);
      placeBuildingRect(2, 6, 5, 9);
      placeBuildingRect(7, 6, 12, 8);
      placeBuildingRect(2, 11, 6, 12);
      placeBuildingRect(8, 10, 12, 12);
      carveAlleyRect(8, 2, 8, 5);
      carveAlleyRect(6, 6, 6, 9);
      carveAlleyRect(7, 10, 7, 12);
    } else if (archetype === 3) {
      placeBuildingRect(2, 2, 5, 12, 4, 0);
      placeBuildingRect(9, 2, 12, 12, 4, 2);
      carvePlazaRect(6, 2, 8, 12);
      carveAlleyRect(7, 2, 7, 12);
      placeBuildingRect(6, 4, 6, 4, 2, 1);
      placeBuildingRect(8, 10, 8, 10, 2, 1);
    } else if (archetype === 4) {
      carvePlazaRect(2, 2, 12, 12);
      placeBuildingRect(2, 2, 4, 3, 2, 1);
      placeBuildingRect(10, 2, 12, 3, 2, 1);
      placeBuildingRect(2, 11, 4, 12, 2, 1);
      placeBuildingRect(10, 11, 12, 12, 2, 1);
      placeBuildingRect(6, 6, 8, 8, 3, 0);
    } else {
      placeBuildingRect(2, 2, 12, 5, 3, 2);
      placeBuildingRect(2, 7, 6, 12, 3, 2);
      carveAlleyRect(2, 6, 12, 6);
      carvePlazaRect(8, 7, 12, 12);
      placeBuildingRect(10, 9, 12, 12, 2, 1);
    }

    const parkingBays = [
      { x: 4, y: 1, vert: false, side: 'N' },
      { x: 10, y: 1, vert: false, side: 'N' },
      { x: 4, y: IN, vert: false, side: 'S' },
      { x: 10, y: IN, vert: false, side: 'S' },
      { x: 1, y: 4, vert: true, side: 'W' },
      { x: 1, y: 10, vert: true, side: 'W' },
      { x: IN, y: 4, vert: true, side: 'E' },
      { x: IN, y: 10, vert: true, side: 'E' },
    ];
    for (let i = parkingBays.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [parkingBays[i], parkingBays[j]] = [parkingBays[j], parkingBays[i]];
    }
    const targetCars = 2 + Math.floor(rng() * 2);
    let placedCars = 0;
    for (const bay of parkingBays) {
      if (placedCars >= targetCars) break;
      if (this.ground[bay.y][bay.x] === TileType.SIDEWALK && this.props[bay.y][bay.x] === PropType.NONE) {
        this.ground[bay.y][bay.x] = TileType.ASPHALT;
        this.elevation[bay.y][bay.x] = 0;
        this.props[bay.y][bay.x] = PropType.CAR;
        this.propColors[bay.y][bay.x] = CAR_PALETTE[Math.floor(rng() * CAR_PALETTE.length)];
        this.propVertical[bay.y][bay.x] = bay.vert;
        this.propCurbSide[bay.y][bay.x] = bay.side;
        placedCars++;
      }
    }

    const lampSpots = [[1, 1], [IN, 1], [1, IN], [IN, IN]];
    for (const [lx, ly] of lampSpots) {
      if (this.ground[ly][lx] === TileType.SIDEWALK && rng() < 0.78) {
        this.props[ly][lx] = PropType.STREETLIGHT;
      }
    }

    for (let ly = 1; ly < LAST; ly++) {
      for (let lx = 1; lx < LAST; lx++) {
        if (this.props[ly][lx] !== PropType.NONE) continue;
        const g = this.ground[ly][lx];
        if (g === TileType.ALLEY && rng() < 0.07) {
          this.props[ly][lx] = PropType.DUMPSTER;
        } else if (
          (g === TileType.SIDEWALK || g === TileType.PLAZA) &&
          (lx === 1 || lx === IN || ly === 1 || ly === IN) &&
          rng() < 0.08
        ) {
          this.props[ly][lx] = PropType.TREE;
        }
      }
    }
  }
}

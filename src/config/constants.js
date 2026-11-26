// World geometry, map defaults and global movement tuning.
// Pure constants: no imports, no side effects.

export const CHUNK_SIZE = 15;
export const TILE_SIZE = 44;
export const CHUNK_PX = CHUNK_SIZE * TILE_SIZE;

export const DEFAULT_GRID_SIZE = 15;
export const DEFAULT_TICK_DURATION = 10;

export const MAX_PISTOL_RANGE = 1000;

// Brief visual damage feedback shared by every unit and the local boss.
export const HIT_FLASH_DURATION = 0.16;

export const SPRINT_MAX_DURATION = 2.0;
export const SPRINT_COOLDOWN_DURATION = 4.0;
export const SPRINT_SPEED_MULTIPLIER = 1.6;

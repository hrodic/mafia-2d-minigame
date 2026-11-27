// World geometry, map defaults and global movement tuning.
// Pure constants: no imports, no side effects.

export const CHUNK_SIZE = 15;
export const TILE_SIZE = 66;
export const CHUNK_PX = CHUNK_SIZE * TILE_SIZE;

export const DEFAULT_GRID_SIZE = 15;
export const DEFAULT_TICK_DURATION = 10;

// Fixed simulation step and catch-up guard for the main loop.
export const SIM_DT = 1 / 120;
export const MAX_FRAME_DELTA = 0.25;
export const MAX_SIM_STEPS = 8;

export const MAX_PISTOL_RANGE = 600;

// Brief visual damage feedback shared by every unit and the local boss.
export const HIT_FLASH_DURATION = 0.16;

export const SPRINT_MAX_DURATION = 2.0;
export const SPRINT_COOLDOWN_DURATION = 4.0;
export const SPRINT_SPEED_MULTIPLIER = 1.6;
export const WALK_PHASE_PER_PX = 0.12;

// Shared canvas references. Guarded so non-game pages (tests) can import modules
// that reference the canvas without crashing.

export const canvas = typeof document !== 'undefined' ? document.getElementById('gameCanvas') : null;
export const ctx = canvas ? canvas.getContext('2d') : null;
export const minimapCanvas = typeof document !== 'undefined' ? document.getElementById('minimapCanvas') : null;
export const minimapCtx = minimapCanvas ? minimapCanvas.getContext('2d') : null;


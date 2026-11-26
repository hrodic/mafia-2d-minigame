// Transitional hooks from simulation modules to presentation layers (Phase 1).
// They are wired by main.js and replaced by the event bus in Phase 2.

export const runtime = {
  updateHUD: () => {},
  syncRecruitButtonLabels: () => {},
  resetMatchUI: () => {},
  onVictory: () => {},
  onDefeat: () => {},
  onFactionEliminated: () => {},
};


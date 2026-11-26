// Composition root: wires systems together, owns the net bridge / presentation
// hooks and runs the requestAnimationFrame loop. Keep this file thin.

import { DEFAULT_GRID_SIZE } from './config/constants.js';
import { FACTION_META } from './config/organizations.js';
import { state } from './core/state.js';
import { runtime } from './core/runtime.js';
import { on } from './core/events.js';
import { CityMap } from './world/city.js';
import { render, resizeCanvas } from './render/renderer.js';
import * as combatFx from './render/combatFx.js';
import * as recruitFx from './render/recruitFx.js';
import { updateHUD, syncRecruitButtonLabels } from './ui/hud.js';
import {
  initMenus,
  showToast,
  renderFactionSlotsUI,
  updateMapSizePreview,
  resetMatchUI,
  showVictoryBanner,
  showDefeatBanner,
} from './ui/menus.js';
import { initInput } from './ui/input.js';
import { mpNet } from './net/mpNet.js';
import { sfx } from './audio/sfx.js';
import * as combatSfx from './audio/combatSfx.js';
import { update } from './sim/simulation.js';

// One shared CityMap instance; match setup (sim/match.js) fills it per game.
state.world = new CityMap();

// Net bridge: state selectors (getLocalFaction/Boss) read state.net. Wired before
// UI initialization so lobby/input handlers can rely on it.
state.net = mpNet;

// Presentation hooks used by simulation modules. Phase 2 replaces these with the
// event bus; keeping them here makes sim/ headless-importable.
runtime.updateHUD = updateHUD;
runtime.syncRecruitButtonLabels = syncRecruitButtonLabels;
runtime.resetMatchUI = resetMatchUI;
runtime.onDefeat = showDefeatBanner;
runtime.onFactionEliminated = (faction) => {
  sfx.playFactionEliminated();
  const meta = FACTION_META[faction];
  showToast(`${meta.name}'s ${meta.ranks.BOSS} killed! Their turf is now Neutral.`);
};
runtime.onVictory = (summary) => {
  sfx.playVictory();
  showVictoryBanner(summary);
};

// Combat facts -> presentation subscribers. sim/combat.js only emits events.
on('unit:damaged', combatFx.onUnitDamaged);
on('unit:died', combatFx.onUnitDied);
on('unit:died', combatSfx.onUnitDied);
on('armor:broken', combatFx.onArmorBroken);
on('armor:equipped', combatFx.onArmorEquipped);
on('armor:equipped', combatSfx.onArmorEquipped);
on('armor:equipped', (event) => {
  if (event.isPlayer) updateHUD();
});
on('slash:performed', combatFx.onSlashPerformed);
on('slash:performed', combatSfx.onSlashPerformed);
on('shot:started', combatFx.onShotStarted);
on('shot:started', combatSfx.onShotStarted);
on('shot:fired', combatFx.onShotFired);
on('shot:fired', combatSfx.onShotFired);
on('shot:fired', (event) => {
  if (!state.net || !state.net.isHost()) return;
  state.net.broadcastEvent({
    kind: 'SHOT',
    x1: Math.round(event.x1),
    y1: Math.round(event.y1),
    x2: Math.round(event.x2),
    y2: Math.round(event.y2),
    color: event.color,
  });
});
on('ui:toast', ({ message }) => showToast(message));
on('unit:recruited', recruitFx.onUnitRecruited);
on('hour:tick', updateHUD);

// Main loop. Variable timestep for now (fixed timestep is Phase 3).
let lastFrameTime = performance.now();
function gameLoop(now) {
  const dt = Math.min(0.05, Math.max(0.001, (now - lastFrameTime) / 1000));
  lastFrameTime = now;

  if (state.gameStarted) {
    update(dt);
    render();
  }

  requestAnimationFrame(gameLoop);
}

// Bootstrap UI, input bindings and invite-link auto-detection.
initMenus();
initInput();
renderFactionSlotsUI();
updateMapSizePreview(DEFAULT_GRID_SIZE);

const urlParams = new URLSearchParams(window.location.search);
const inviteRoom = urlParams.get('room');
const inviteSecret = urlParams.get('secret');
if (inviteRoom && inviteSecret) {
  mpNet.setMode('JOIN');
  document.getElementById('mp-join-input').value = `${inviteRoom}:${inviteSecret}`;
}

window.addEventListener('load', () => {
  resizeCanvas();
  lastFrameTime = performance.now();
  requestAnimationFrame(gameLoop);
});

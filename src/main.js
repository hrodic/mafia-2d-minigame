// Composition root: wires systems together, owns the net bridge / presentation
// hooks and runs the requestAnimationFrame loop. Keep this file thin.

import {
  DEFAULT_GRID_SIZE,
  SIM_DT,
  MAX_FRAME_DELTA,
  MAX_SIM_STEPS,
} from './config/constants.js';
import { FACTION_META } from './config/organizations.js';
import { state } from './core/state.js';
import { on } from './core/events.js';
import { advanceFixedStep } from './core/fixedStep.js';
import { CityMap } from './world/city.js';
import { render, resizeCanvas } from './render/renderer.js';
import { resetEffects } from './render/effects.js';
import * as combatFx from './render/combatFx.js';
import * as recruitFx from './render/recruitFx.js';
import * as territoryFx from './render/territoryFx.js';
import { updateHUD, syncRecruitButtonLabels } from './ui/hud.js';
import {
  initMenus,
  showToast,
  renderFactionSlotsUI,
  updateMapSizePreview,
  resetMatchUI,
  showVictoryBanner,
  showDefeatBanner,
  setWorldSeedDisplay,
} from './ui/menus.js';
import { initInput } from './ui/input.js';
import { applyVersionLabels } from './ui/version.js';
import { updateHudCadence } from './ui/hudCadence.js';
import { updateActionBar } from './ui/actionBar.js';
import { mpNet } from './net/mpNet.js';
import { sfx } from './audio/sfx.js';
import * as combatSfx from './audio/combatSfx.js';
import { update } from './sim/simulation.js';
import { updateGuest, updatePresentation, updateLocalAim } from './render/presentation.js';

// One shared CityMap instance; match setup (sim/match.js) fills it per game.
state.world = new CityMap();

// Net bridge: state selectors (getLocalFaction/Boss) read state.net. Wired before
// UI initialization so lobby/input handlers can rely on it.
state.net = mpNet;

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
on('chunk:captured', territoryFx.onChunkCaptured);
on('chunk:captured', updateHUD);
on('faction:eliminated', (event) => {
  sfx.playFactionEliminated();
  const meta = FACTION_META[event.faction];
  showToast(`${meta.name}'s ${meta.ranks.BOSS} killed! Their turf is now Neutral.`);
});
on('faction:eliminated', updateHUD);
on('match:victory', ({ faction, blocks, totalBlocks, cash, crew }) => {
  sfx.playVictory();
  const meta = FACTION_META[faction];
  showVictoryBanner(
    `All rival Supreme Leaders have been eliminated! ${meta.name} (${meta.ranks.BOSS}) rules ` +
      `${blocks}/${totalBlocks} neighborhoods with $${cash.toLocaleString()} in cash and ` +
      `${crew} surviving crew.`
  );
});
on('match:defeat', () => showDefeatBanner());
on('match:defeat', updateHUD);
on('match:initialized', resetEffects);
on('match:initialized', ({ tickDuration }) => resetMatchUI(tickDuration));
on('match:initialized', ({ worldSeed }) => setWorldSeedDisplay(worldSeed));
on('match:initialized', syncRecruitButtonLabels);
on('match:initialized', updateHUD);

// Main loop: fixed simulation steps, one presentation/render pass per frame.
let lastFrameTime = performance.now();
let simAccumulator = 0;

function gameLoop(now) {
  const frameDt = Math.min(MAX_FRAME_DELTA, Math.max(0, (now - lastFrameTime) / 1000));
  lastFrameTime = now;

  if (!state.gameStarted) {
    simAccumulator = 0;
    requestAnimationFrame(gameLoop);
    return;
  }

  if (state.net && state.net.isGuest()) {
    simAccumulator = 0;
    updateGuest(frameDt);
  } else {
    const advanced = advanceFixedStep(
      simAccumulator,
      frameDt,
      SIM_DT,
      MAX_SIM_STEPS,
      update
    );
    simAccumulator = advanced.accumulator;
    updateLocalAim();
    updatePresentation(frameDt);
  }

  updateHudCadence(frameDt, updateHUD);
  updateActionBar();
  render(frameDt);
  requestAnimationFrame(gameLoop);
}

// Bootstrap UI, input bindings and invite-link auto-detection.
applyVersionLabels();
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
  simAccumulator = 0;
  requestAnimationFrame(gameLoop);
});

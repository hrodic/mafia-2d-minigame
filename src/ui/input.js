// Gameplay input: keyboard, mouse, minimap and HUD action buttons.

import { CHUNK_PX } from '../config/constants.js';
import { Faction, UnitRank } from '../config/enums.js';
import { FACTION_META } from '../config/organizations.js';
import { state, getLocalFaction, getLocalBoss, isLocalBossAlive } from '../core/state.js';
import {
  getAudioCtx,
  ensureAudioContext,
  cycleMusicTrack,
  isSoundEnabled,
  setSoundEnabled,
} from '../audio/engine.js';
import { canvas, minimapCanvas } from '../render/canvas.js';
import { addFloatingText } from '../render/effects.js';
import { performKnifeSlash, buyBossArmor, performBossPistolShot } from '../sim/combat.js';
import { updateHUD, syncRecruitButtonLabels } from './hud.js';
import { showToast } from './menus.js';

export function initInput() {
window.addEventListener('keydown', (e) => {
  getAudioCtx();
  const k = e.key.toLowerCase();
  const wasDown = state.keys.has(k);
  state.keys.add(k);
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) {
    e.preventDefault();
  }
  if (!wasDown && state.net && state.net.isGuest()) {
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(k)) {
      state.net.flushGuestInput();
    }
  }
  if (k === ' ' || k === 'f') performKnifeSlash();
  if (k === 'q') buyBossArmor();
});
window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  state.keys.delete(k);
  if (state.net && state.net.isGuest()) {
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(k)) {
      state.net.flushGuestInput();
    }
  }
});

// Losing focus can swallow keyup events; clear held keys and send a stop so the
// guest boss never keeps walking into a wall after alt-tab/HUD clicks.
function releaseAllKeys() {
  if (state.keys.size === 0) return;
  state.keys.clear();
  if (state.net && state.net.isGuest()) {
    state.net.flushGuestInput();
  }
}
window.addEventListener('blur', releaseAllKeys);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) releaseAllKeys();
});

canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  state.mouse.screenX = e.clientX - rect.left;
  state.mouse.screenY = e.clientY - rect.top;
  state.mouse.inside = true;
});

canvas.addEventListener('mouseleave', () => {
  state.mouse.inside = false;
});

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
});

function screenToWorld(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const sx = clientX - rect.left;
  const sy = clientY - rect.top;
  return {
    wx: state.camera.x - rect.width / 2 + sx,
    wy: state.camera.y - rect.height / 2 + sy,
  };
}

canvas.addEventListener('mousedown', (e) => {
  getAudioCtx();
  if (!state.gameStarted) return;
  const { wx, wy } = screenToWorld(e.clientX, e.clientY);

  if (e.button === 2) {
    if (state.net && state.net.isGuest()) {
      if (isLocalBossAlive()) {
        state.net.sendCommand({ cmd: 'SHOOT', tx: wx, ty: wy });
      }
      return;
    }
    if (state.player.alive && !state.gameOver) {
      performBossPistolShot(state.player, true, wx, wy);
    }
    return;
  }

  if (e.button !== 0) return;

  const { cx, cy } = state.world.worldToTile(wx, wy);
  const chunk = state.world.getChunk(cx, cy);

  if (!chunk) {
    if (state.allowClickExpand) {
      if (state.net && state.net.isGuest()) {
        state.net.sendCommand({ cmd: 'BUILD_BLOCK', cx, cy });
        return;
      }
      const myFac = getLocalFaction();
      const newChunk = state.world.generateChunk(cx, cy, myFac);
      addFloatingText(
        newChunk.cx * CHUNK_PX + CHUNK_PX / 2,
        newChunk.cy * CHUNK_PX + CHUNK_PX / 2,
        `NEW BLOCK (${newChunk.incomeLabel})`,
        FACTION_META[myFac].accent
      );
      updateHUD();
    } else {
      showToast('Enable "Click-Build" or use "+ Expand Ring" to add blocks');
    }
    return;
  }

  if (state.net && state.net.isGuest()) {
    if (!isLocalBossAlive()) {
      state.camera.x = wx;
      state.camera.y = wy;
      return;
    }
    const snapped = state.world.findNearestWalkablePoint(wx, wy, 12);
    if (snapped) {
      state.net.sendCommand({ cmd: 'MOVE_TO', x: snapped.x, y: snapped.y });
    }
    return;
  }

  if (state.gameOver || !state.player.alive) {
    state.camera.x = wx;
    state.camera.y = wy;
    return;
  }

  const snapped = state.world.findNearestWalkablePoint(wx, wy, 12);
  if (snapped) {
    state.player.targetX = snapped.x;
    state.player.targetY = snapped.y;
  } else {
    showToast('Blocked by building');
  }
});

minimapCanvas.addEventListener('click', (e) => {
  getAudioCtx();
  if (!state.gameStarted || state.world.chunks.size === 0) return;
  const rect = minimapCanvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  let minCx = Infinity, maxCx = -Infinity, minCy = Infinity, maxCy = -Infinity;
  for (const chunk of state.world.chunks.values()) {
    if (chunk.cx < minCx) minCx = chunk.cx;
    if (chunk.cx > maxCx) maxCx = chunk.cx;
    if (chunk.cy < minCy) minCy = chunk.cy;
    if (chunk.cy > maxCy) maxCy = chunk.cy;
  }
  const cols = Math.max(1, maxCx - minCx + 1);
  const rows = Math.max(1, maxCy - minCy + 1);
  const pad = 6;
  const innerW = minimapCanvas.width - pad * 2;
  const innerH = minimapCanvas.height - pad * 2;
  const cellSize = Math.min(innerW / cols, innerH / rows);
  const offsetX = pad + (innerW - cellSize * cols) / 2;
  const offsetY = pad + (innerH - cellSize * rows) / 2;

  const worldX = (minCx + (mx - offsetX) / cellSize) * CHUNK_PX;
  const worldY = (minCy + (my - offsetY) / cellSize) * CHUNK_PX;

  if (state.net && state.net.isGuest()) {
    if (!isLocalBossAlive()) {
      state.camera.x = worldX;
      state.camera.y = worldY;
      return;
    }
    const snapped = state.world.findNearestWalkablePoint(worldX, worldY, 12);
    if (snapped) {
      state.net.sendCommand({ cmd: 'MOVE_TO', x: snapped.x, y: snapped.y });
      showToast('Boss waypoint set via Radar');
    }
    return;
  }

  if (state.gameOver || !state.player.alive) {
    state.camera.x = worldX;
    state.camera.y = worldY;
    return;
  }

  const snapped = state.world.findNearestWalkablePoint(worldX, worldY, 12);
  if (snapped) {
    state.player.targetX = snapped.x;
    state.player.targetY = snapped.y;
    showToast('Boss waypoint set via Radar');
  }
});

// Top HUD Action Buttons
function pushRecruitPrefsToHost() {
  if (state.net && state.net.isGuest()) {
    state.net.sendCommand({
      cmd: 'RECRUIT_PREF',
      autoSoldier: state.autoRecruitSoldier,
      autoCaptain: state.autoRecruitCaptain,
      autoUnderboss: state.autoRecruitUnderboss,
      caps: { ...state.playerSpawnCaps },
    });
  }
}

document.getElementById('btn-toggle-soldier').addEventListener('click', () => {
  state.autoRecruitSoldier = !state.autoRecruitSoldier;
  syncRecruitButtonLabels();
  pushRecruitPrefsToHost();
});
document.getElementById('btn-cap-soldier-dec').addEventListener('click', () => {
  state.playerSpawnCaps[UnitRank.SOLDIER]--;
  syncRecruitButtonLabels();
  pushRecruitPrefsToHost();
});
document.getElementById('btn-cap-soldier-inc').addEventListener('click', () => {
  state.playerSpawnCaps[UnitRank.SOLDIER]++;
  syncRecruitButtonLabels();
  pushRecruitPrefsToHost();
});

document.getElementById('btn-toggle-captain').addEventListener('click', () => {
  state.autoRecruitCaptain = !state.autoRecruitCaptain;
  syncRecruitButtonLabels();
  pushRecruitPrefsToHost();
});
document.getElementById('btn-cap-captain-dec').addEventListener('click', () => {
  state.playerSpawnCaps[UnitRank.CAPTAIN]--;
  syncRecruitButtonLabels();
  pushRecruitPrefsToHost();
});
document.getElementById('btn-cap-captain-inc').addEventListener('click', () => {
  state.playerSpawnCaps[UnitRank.CAPTAIN]++;
  syncRecruitButtonLabels();
  pushRecruitPrefsToHost();
});

document.getElementById('btn-toggle-underboss').addEventListener('click', () => {
  state.autoRecruitUnderboss = !state.autoRecruitUnderboss;
  syncRecruitButtonLabels();
  pushRecruitPrefsToHost();
});
document.getElementById('btn-cap-underboss-dec').addEventListener('click', () => {
  state.playerSpawnCaps[UnitRank.UNDERBOSS]--;
  syncRecruitButtonLabels();
  pushRecruitPrefsToHost();
});
document.getElementById('btn-cap-underboss-inc').addEventListener('click', () => {
  state.playerSpawnCaps[UnitRank.UNDERBOSS]++;
  syncRecruitButtonLabels();
  pushRecruitPrefsToHost();
});

document.getElementById('btn-buy-armor').addEventListener('click', () => buyBossArmor());
document.getElementById('btn-slash').addEventListener('click', () => performKnifeSlash());
document.getElementById('btn-pistol').addEventListener('click', () => {
  getAudioCtx();
  const myBoss = getLocalBoss();
  if (!myBoss || !isLocalBossAlive()) return;
  const tx = myBoss.x + Math.cos(myBoss.facing) * 260;
  const ty = myBoss.y + Math.sin(myBoss.facing) * 260;
  if (state.net && state.net.isGuest()) {
    state.net.sendCommand({ cmd: 'SHOOT', tx, ty });
  } else {
    performBossPistolShot(state.player, true, tx, ty);
  }
});

document.getElementById('btn-toggle-expand-click').addEventListener('click', (e) => {
  state.allowClickExpand = !state.allowClickExpand;
  e.target.textContent = `Click-Build: ${state.allowClickExpand ? 'ON' : 'OFF'}`;
});

document.getElementById('btn-expand-ring').addEventListener('click', () => {
  if (!state.gameStarted) return;
  if (state.net && state.net.isGuest()) {
    state.net.sendCommand({ cmd: 'EXPAND_RING' });
    return;
  }
  const added = state.world.expandPerimeterRing(Faction.PLAYER);
  if (added > 0) {
    state.minimapCacheTimer = 1.0;
    showToast(`Expanded city perimeter (+${added} neighborhoods)`);
    updateHUD();
  }
});

document.getElementById('btn-toggle-grid').addEventListener('click', (e) => {
  state.showBorders = !state.showBorders;
  e.target.textContent = `Borders: ${state.showBorders ? 'ON' : 'OFF'}`;
});

document.getElementById('btn-toggle-music').addEventListener('click', (e) => {
  ensureAudioContext();
  const music = cycleMusicTrack();
  e.target.textContent = !music.enabled
    ? '🎷 Music: OFF'
    : music.track === 0
    ? '🎷 Noir I: ON'
    : '🎷 Noir II: ON';
});

document.getElementById('btn-toggle-sound').addEventListener('click', (e) => {
  const enabled = setSoundEnabled(!isSoundEnabled());
  e.target.textContent = '🔊 SFX: ' + (enabled ? 'ON' : 'OFF');
});
}


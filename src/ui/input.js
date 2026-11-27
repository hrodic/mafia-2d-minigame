// Gameplay input: keyboard, mouse, minimap and HUD action buttons.

import { UnitRank } from '../config/enums.js';
import { state, getLocalBoss, isLocalBossAlive } from '../core/state.js';
import { on } from '../core/events.js';
import {
  getAudioCtx,
  ensureAudioContext,
  cycleMusicTrack,
  isSoundEnabled,
  setSoundEnabled,
} from '../audio/engine.js';
import { canvas, minimapCanvas } from '../render/canvas.js';
import { getMinimapLayout, minimapToWorld, minimapCellAt } from '../render/minimapLayout.js';
import { setMinimapHover, toggleMinimapExpanded } from '../render/minimap.js';
import { sendOrDispatchCommand } from './commandBridge.js';
import {
  syncRecruitButtonLabels,
  toggleCrewPanel,
  toggleFactionBoard,
  setRecruitCapMin,
  setRecruitCapMax,
} from './hud.js';
import { showToast } from './menus.js';

export function initInput() {
function requestSlash() {
  if (!state.gameStarted || !isLocalBossAlive()) return;
  sendOrDispatchCommand({ cmd: 'SLASH' });
}

function requestBuyArmor() {
  if (!state.gameStarted) return;
  if (state.net && state.net.isGuest() && !isLocalBossAlive()) {
    showToast('Your Boss must be alive to equip armor!');
    return;
  }
  sendOrDispatchCommand({ cmd: 'BUY_ARMOR' });
}

function requestShoot(tx, ty) {
  if (!state.gameStarted || state.gameOver || !isLocalBossAlive()) return;
  sendOrDispatchCommand({ cmd: 'SHOOT', tx, ty });
}

function requestReload() {
  if (!state.gameStarted || !isLocalBossAlive()) return;
  sendOrDispatchCommand({ cmd: 'RELOAD' });
}

function requestBuyMp9() {
  if (!state.gameStarted) return;
  if (state.net && state.net.isGuest() && !isLocalBossAlive()) {
    showToast('Your Boss must be alive to buy the MP9!');
    return;
  }
  sendOrDispatchCommand({ cmd: 'BUY_MP9' });
}

function requestBuyGlock() {
  if (!state.gameStarted) return;
  if (state.net && state.net.isGuest() && !isLocalBossAlive()) {
    showToast('Your Boss must be alive to buy the Glock 19!');
    return;
  }
  sendOrDispatchCommand({ cmd: 'BUY_GLOCK' });
}

function requestBuyAmmo() {
  if (!state.gameStarted) return;
  if (state.net && state.net.isGuest() && !isLocalBossAlive()) {
    showToast('Your Boss must be alive to buy ammo!');
    return;
  }
  sendOrDispatchCommand({ cmd: 'BUY_AMMO' });
}

function requestSwitchWeapon() {
  if (!state.gameStarted || !isLocalBossAlive()) return;
  const boss = getLocalBoss();
  if (!boss || !boss.pistolOwned) {
    showToast('Buy the Glock 19 first (B).');
    return;
  }
  if (!boss.mp9Owned) {
    showToast('Buy the MP9 first (B).');
    return;
  }
  sendOrDispatchCommand({
    cmd: 'SWITCH_WEAPON',
    weapon: boss.weapon === 'mp9' ? 'pistol' : 'mp9',
  });
}

function setBuyMenuOpen(open) {
  const next = Boolean(open && state.gameStarted);
  state.buyMenuOpen = next;
  const menu = document.getElementById('buy-menu');
  const button = document.getElementById('btn-buy-menu');
  if (menu) menu.classList.toggle('hidden', !next);
  if (button) button.setAttribute('aria-expanded', next ? 'true' : 'false');
}

function toggleBuyMenu() {
  if (!state.gameStarted) return;
  setBuyMenuOpen(!state.buyMenuOpen);
}

function buyFromMenu(action) {
  action();
}

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
  if (k === ' ' || k === 'f') requestSlash();
  if (k === 'q') requestBuyArmor();
  if (k === 't' && !wasDown) requestBuyAmmo();
  if (k === 'r' && !wasDown) requestReload();
  if (k === 'e' && !wasDown) requestSwitchWeapon();
  if (k === 'b' && !wasDown) {
    toggleBuyMenu();
  } else if (state.buyMenuOpen && !wasDown) {
    if (e.key === '1') buyFromMenu(requestBuyArmor);
    else if (e.key === '2') buyFromMenu(requestBuyAmmo);
    else if (e.key === '3') buyFromMenu(requestBuyGlock);
    else if (e.key === '4') buyFromMenu(requestBuyMp9);
    else setBuyMenuOpen(false);
  }
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
  const hadInput = state.keys.size > 0 || state.sprintButtonHeld || state.mouseFiring;
  state.keys.clear();
  state.sprintButtonHeld = false;
  state.mouseFiring = false;
  if (hadInput && state.net && state.net.isGuest()) {
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

window.addEventListener('mouseup', (e) => {
  if (e.button !== 2 || !state.mouseFiring) return;
  state.mouseFiring = false;
  if (state.net && state.net.isGuest()) state.net.flushGuestInput();
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
  const rect = canvas.getBoundingClientRect();
  state.mouse.screenX = e.clientX - rect.left;
  state.mouse.screenY = e.clientY - rect.top;
  state.mouse.inside = true;
  const { wx, wy } = screenToWorld(e.clientX, e.clientY);

  if (e.button === 2) {
    state.mouseFiring = true;
    requestShoot(wx, wy);
    return;
  }

  if (e.button !== 0) return;

  const { cx, cy } = state.world.worldToTile(wx, wy);
  const chunk = state.world.getChunk(cx, cy);

  if (!chunk) {
    return;
  }

  if (state.net && state.net.isGuest()) {
    if (!isLocalBossAlive()) {
      state.camera.x = wx;
      state.camera.y = wy;
      return;
    }
  } else if (state.gameOver || !state.player.alive) {
    state.camera.x = wx;
    state.camera.y = wy;
    return;
  }

  const snapped = state.world.findNearestWalkablePoint(wx, wy, 12);
  if (snapped) {
    sendOrDispatchCommand({ cmd: 'MOVE_TO', x: snapped.x, y: snapped.y });
  } else if (!state.net || !state.net.isGuest()) {
    showToast('Blocked by building');
  }
});

minimapCanvas.addEventListener('mousemove', (e) => {
  if (!state.gameStarted || state.world.chunks.size === 0) {
    setMinimapHover(null);
    return;
  }
  const rect = minimapCanvas.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    setMinimapHover(null);
    return;
  }
  const mx = (e.clientX - rect.left) * (minimapCanvas.width / rect.width);
  const my = (e.clientY - rect.top) * (minimapCanvas.height / rect.height);
  const layout = getMinimapLayout(
    state.world.chunks.values(),
    minimapCanvas.width,
    minimapCanvas.height
  );
  setMinimapHover(minimapCellAt(layout, mx, my));
});

minimapCanvas.addEventListener('mouseleave', () => setMinimapHover(null));

minimapCanvas.addEventListener('click', (e) => {
  getAudioCtx();
  if (!state.gameStarted || state.world.chunks.size === 0) return;
  const rect = minimapCanvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const mx = (e.clientX - rect.left) * (minimapCanvas.width / rect.width);
  const my = (e.clientY - rect.top) * (minimapCanvas.height / rect.height);
  const layout = getMinimapLayout(state.world.chunks.values(), minimapCanvas.width, minimapCanvas.height);
  if (!layout) return;
  const { x: worldX, y: worldY } = minimapToWorld(layout, mx, my);

  if (state.net && state.net.isGuest()) {
    if (!isLocalBossAlive()) {
      state.camera.x = worldX;
      state.camera.y = worldY;
      return;
    }
  } else if (state.gameOver || !state.player.alive) {
    state.camera.x = worldX;
    state.camera.y = worldY;
    return;
  }

  const snapped = state.world.findNearestWalkablePoint(worldX, worldY, 12);
  if (snapped) {
    sendOrDispatchCommand({ cmd: 'MOVE_TO', x: snapped.x, y: snapped.y });
    showToast('Boss waypoint set via Radar');
  }
});

// Top HUD Action Buttons
function pushRecruitPrefs() {
  sendOrDispatchCommand({
    cmd: 'RECRUIT_PREF',
    autoSoldier: state.autoRecruitSoldier,
    autoCaptain: state.autoRecruitCaptain,
    autoUnderboss: state.autoRecruitUnderboss,
    caps: { ...state.playerSpawnCaps },
  });
}

function bindCapPresets(key, rank) {
  document.getElementById(`btn-cap-${key}-min`)?.addEventListener('click', () => {
    setRecruitCapMin(rank);
    pushRecruitPrefs();
  });
  document.getElementById(`btn-cap-${key}-max`)?.addEventListener('click', () => {
    setRecruitCapMax(rank);
    pushRecruitPrefs();
  });
}
bindCapPresets('soldier', UnitRank.SOLDIER);
bindCapPresets('captain', UnitRank.CAPTAIN);
bindCapPresets('underboss', UnitRank.UNDERBOSS);

document.getElementById('btn-management-collapse')?.addEventListener('click', () => toggleCrewPanel());
document.getElementById('btn-faction-collapse')?.addEventListener('click', () => toggleFactionBoard());
document.getElementById('btn-radar-expand')?.addEventListener('click', (e) => {
  const expanded = toggleMinimapExpanded();
  const panel = document.getElementById('radar-panel');
  if (panel) panel.classList.toggle('is-expanded', expanded);
  e.currentTarget.textContent = expanded ? 'â¤¡' : 'â¤¢';
  e.currentTarget.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  e.currentTarget.setAttribute('aria-label', expanded ? 'Shrink radar' : 'Expand radar');
  e.currentTarget.title = expanded ? 'Shrink radar' : 'Expand radar';
});
document.getElementById('btn-toggle-soldier').addEventListener('click', () => {
  state.autoRecruitSoldier = !state.autoRecruitSoldier;
  syncRecruitButtonLabels();
  pushRecruitPrefs();
});
document.getElementById('btn-cap-soldier-dec').addEventListener('click', () => {
  state.playerSpawnCaps[UnitRank.SOLDIER]--;
  syncRecruitButtonLabels();
  pushRecruitPrefs();
});
document.getElementById('btn-cap-soldier-inc').addEventListener('click', () => {
  state.playerSpawnCaps[UnitRank.SOLDIER]++;
  syncRecruitButtonLabels();
  pushRecruitPrefs();
});

document.getElementById('btn-toggle-captain').addEventListener('click', () => {
  state.autoRecruitCaptain = !state.autoRecruitCaptain;
  syncRecruitButtonLabels();
  pushRecruitPrefs();
});
document.getElementById('btn-cap-captain-dec').addEventListener('click', () => {
  state.playerSpawnCaps[UnitRank.CAPTAIN]--;
  syncRecruitButtonLabels();
  pushRecruitPrefs();
});
document.getElementById('btn-cap-captain-inc').addEventListener('click', () => {
  state.playerSpawnCaps[UnitRank.CAPTAIN]++;
  syncRecruitButtonLabels();
  pushRecruitPrefs();
});

document.getElementById('btn-toggle-underboss').addEventListener('click', () => {
  state.autoRecruitUnderboss = !state.autoRecruitUnderboss;
  syncRecruitButtonLabels();
  pushRecruitPrefs();
});
document.getElementById('btn-cap-underboss-dec').addEventListener('click', () => {
  state.playerSpawnCaps[UnitRank.UNDERBOSS]--;
  syncRecruitButtonLabels();
  pushRecruitPrefs();
});
document.getElementById('btn-cap-underboss-inc').addEventListener('click', () => {
  state.playerSpawnCaps[UnitRank.UNDERBOSS]++;
  syncRecruitButtonLabels();
  pushRecruitPrefs();
});

document.getElementById('btn-buy-armor').addEventListener('click', () => {
  getAudioCtx();
  buyFromMenu(requestBuyArmor);
});
document.getElementById('btn-buy-ammo')?.addEventListener('click', () => {
  getAudioCtx();
  buyFromMenu(requestBuyAmmo);
});
document.getElementById('btn-buy-glock')?.addEventListener('click', () => {
  getAudioCtx();
  buyFromMenu(requestBuyGlock);
});
document.getElementById('btn-buy-mp9')?.addEventListener('click', () => {
  getAudioCtx();
  buyFromMenu(requestBuyMp9);
});
document.getElementById('btn-buy-menu')?.addEventListener('click', () => {
  getAudioCtx();
  toggleBuyMenu();
});
document.getElementById('btn-slash').addEventListener('click', () => requestSlash());
document.getElementById('btn-pistol').addEventListener('click', () => {
  getAudioCtx();
  const boss = getLocalBoss();
  if (!boss || !boss.pistolOwned) {
    setBuyMenuOpen(true);
    return;
  }
  requestSwitchWeapon();
});

const sprintButton = document.getElementById('btn-sprint');
if (sprintButton) {
  const startSprint = (event) => {
    event.preventDefault();
    getAudioCtx();
    state.sprintButtonHeld = true;
    if (state.net && state.net.isGuest()) state.net.flushGuestInput();
  };
  const stopSprint = () => {
    if (!state.sprintButtonHeld) return;
    state.sprintButtonHeld = false;
    if (state.net && state.net.isGuest()) state.net.flushGuestInput();
  };
  sprintButton.addEventListener('pointerdown', startSprint);
  for (const type of ['pointerup', 'pointercancel', 'pointerleave', 'blur']) {
    sprintButton.addEventListener(type, stopSprint);
  }
}

document.getElementById('btn-toggle-music').addEventListener('click', (e) => {
  ensureAudioContext();
  const music = cycleMusicTrack();
  e.target.textContent = !music.enabled
    ? 'ðŸŽ· Music: OFF'
    : music.track === 0
    ? 'ðŸŽ· Noir I: ON'
    : 'ðŸŽ· Noir II: ON';
});

document.getElementById('btn-toggle-sound').addEventListener('click', (e) => {
  const enabled = setSoundEnabled(!isSoundEnabled());
  e.target.textContent = 'ðŸ”Š SFX: ' + (enabled ? 'ON' : 'OFF');
});

on('match:initialized', () => setBuyMenuOpen(false));
}



// Bottom action bar: ability readiness, cooldown overlays and secondary costs.

import { SLASH, PISTOL, COST_BOSS_ARMOR, MAX_BOSS_ARMOR } from '../config/balance.js';
import { SPRINT_COOLDOWN_DURATION } from '../config/constants.js';
import { state, getLocalBoss, getLocalFaction, isLocalBossAlive } from '../core/state.js';

const els = {
  slash: document.getElementById('btn-slash'),
  pistol: document.getElementById('btn-pistol'),
  armor: document.getElementById('btn-buy-armor'),
  sprint: document.getElementById('btn-sprint'),
  slashCd: document.getElementById('cooldown-slash'),
  pistolCd: document.getElementById('cooldown-pistol'),
  armorCd: document.getElementById('cooldown-armor'),
  sprintCd: document.getElementById('cooldown-sprint'),
  slashStatus: document.getElementById('action-status-slash'),
  pistolStatus: document.getElementById('action-status-pistol'),
  pistolAmmo: document.getElementById('ammo-pistol'),
  pistolLabel: document.getElementById('action-label-pistol'),
  armorStatus: document.getElementById('action-status-armor'),
  sprintStatus: document.getElementById('sprint-text'),
};

function setDisabled(el, disabled) {
  if (!el) return;
  el.classList.toggle('is-disabled', disabled);
  el.disabled = disabled;
  el.setAttribute('aria-disabled', disabled ? 'true' : 'false');
}

function setCooldown(el, remaining, total) {
  if (!el) return;
  const ratio = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
  el.style.setProperty('--progress', ratio.toFixed(4));
}

function setState(el, state) {
  if (el) el.dataset.state = state;
}

function setStatus(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}

export function updateActionBar() {
  const boss = getLocalBoss();
  const started = Boolean(state.gameStarted);
  const alive = started && Boolean(boss) && isLocalBossAlive();
  const cash = state.treasuries[getLocalFaction()] || 0;

  const attackCd = boss ? Math.max(0, boss.attackCooldown || 0) : 0;
  const ammo = boss && Number.isFinite(boss.ammo) ? Math.max(0, Math.floor(boss.ammo)) : PISTOL.magazine;
  const reloadCd = boss ? Math.max(0, boss.reloadTimer || 0) : 0;
  const armorCd = boss ? Math.max(0, boss.armorCooldown || 0) : 0;
  const sprintCd = boss ? Math.max(0, boss.sprintCooldown || 0) : 0;
  const armorVal = boss ? Math.max(0, boss.armor || 0) : 0;
  const armorFull = armorVal >= MAX_BOSS_ARMOR;

  const attackState = !alive ? 'disabled' : attackCd > 0 ? 'cooldown' : 'ready';
  setDisabled(els.slash, !alive || attackCd > 0);
  setCooldown(els.slashCd, attackCd, SLASH.humanBoss.cooldown);
  setState(els.slash, attackState);
  setStatus(els.slashStatus, attackCd > 0 ? `${attackCd.toFixed(1)}s` : 'READY');

  const pistolState = !alive
    ? 'disabled'
    : reloadCd > 0 || ammo <= 0 || attackCd > 0
      ? 'cooldown'
      : 'ready';
  setDisabled(els.pistol, !alive || attackCd > 0 || reloadCd > 0 || ammo <= 0);
  setCooldown(
    els.pistolCd,
    reloadCd > 0 ? reloadCd : attackCd,
    reloadCd > 0 ? PISTOL.reloadTime : PISTOL.fireCooldown
  );
  setState(els.pistol, pistolState);
  setStatus(els.pistolStatus, reloadCd > 0 ? `${reloadCd.toFixed(1)}s` : attackCd > 0 ? `${attackCd.toFixed(1)}s` : 'READY');
  if (els.pistolLabel) els.pistolLabel.textContent = reloadCd > 0 ? 'RELOADING' : 'Pistol';
  if (els.pistolAmmo) {
    els.pistolAmmo.textContent = String(ammo);
    els.pistolAmmo.classList.toggle('is-low', reloadCd <= 0 && ammo > 0 && ammo <= 3);
    els.pistolAmmo.classList.toggle('is-empty', ammo <= 0 && reloadCd <= 0);
    els.pistolAmmo.classList.toggle('is-reloading', reloadCd > 0);
  }

  const armorState = !alive
    ? 'disabled'
    : armorFull
      ? 'full'
      : armorCd > 0
        ? 'cooldown'
        : cash >= COST_BOSS_ARMOR
          ? 'affordable'
          : 'unaffordable';
  setDisabled(els.armor, !alive || armorFull || armorCd > 0 || cash < COST_BOSS_ARMOR);
  setCooldown(els.armorCd, armorCd, state.tickDuration);
  setState(els.armor, armorState);
  setStatus(els.armorStatus, armorFull ? 'FULL' : `$${COST_BOSS_ARMOR.toLocaleString()}`);

  const sprintActive = Boolean(boss && boss.isSprinting);
  const sprintState = !alive
    ? 'disabled'
    : sprintActive
      ? 'active'
      : sprintCd > 0
        ? 'cooldown'
        : 'ready';
  setDisabled(els.sprint, !alive);
  setCooldown(els.sprintCd, sprintCd, SPRINT_COOLDOWN_DURATION);
  setState(els.sprint, sprintState);
  setStatus(els.sprintStatus, sprintActive ? 'RUN' : sprintCd > 0 ? `${sprintCd.toFixed(1)}s` : 'RDY');
  if (els.sprint) els.sprint.classList.toggle('is-active', sprintActive);
}

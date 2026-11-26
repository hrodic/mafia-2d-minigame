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
  el.style.height = `${(ratio * 100).toFixed(1)}%`;
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
  const armorCd = boss ? Math.max(0, boss.armorCooldown || 0) : 0;
  const sprintCd = boss ? Math.max(0, boss.sprintCooldown || 0) : 0;
  const armorVal = boss ? Math.max(0, boss.armor || 0) : 0;
  const armorFull = armorVal >= MAX_BOSS_ARMOR;

  setDisabled(els.slash, !alive || attackCd > 0);
  setCooldown(els.slashCd, attackCd, SLASH.player.cooldown);
  setStatus(els.slashStatus, attackCd > 0 ? `${attackCd.toFixed(1)}s` : 'READY');

  setDisabled(els.pistol, !alive || attackCd > 0);
  setCooldown(els.pistolCd, attackCd, PISTOL.cooldownHuman);
  setStatus(els.pistolStatus, attackCd > 0 ? `${attackCd.toFixed(1)}s` : 'READY');

  setDisabled(els.armor, !alive || armorFull || armorCd > 0 || cash < COST_BOSS_ARMOR);
  setCooldown(els.armorCd, armorCd, state.tickDuration);
  setStatus(els.armorStatus, armorFull ? 'FULL' : `$${COST_BOSS_ARMOR.toLocaleString()}`);

  const sprintActive = Boolean(boss && boss.isSprinting);
  setDisabled(els.sprint, !alive);
  setCooldown(els.sprintCd, sprintCd, SPRINT_COOLDOWN_DURATION);
  setStatus(els.sprintStatus, sprintActive ? 'RUN' : sprintCd > 0 ? `${sprintCd.toFixed(1)}s` : 'RDY');
  if (els.sprint) els.sprint.classList.toggle('is-active', sprintActive);
}

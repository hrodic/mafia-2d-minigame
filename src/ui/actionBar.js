// Bottom action bar: ability readiness, cooldown overlays and secondary costs.

import {
  SLASH,
  WEAPONS,
  COST_BOSS_ARMOR,
  COST_BOSS_GLOCK,
  COST_BOSS_MP9,
  COST_BOSS_AMMO,
  AMMO_ROUNDS_PER_PURCHASE,
  PISTOL_MAG_CAP,
  MP9_MAG_CAP,
  MAX_BOSS_ARMOR,
} from '../config/balance.js';
import { SPRINT_COOLDOWN_DURATION } from '../config/constants.js';
import { state, getLocalBoss, getLocalFaction, isLocalBossAlive } from '../core/state.js';
import { isOnFriendlyTurf } from '../sim/combat.js';

const els = {
  slash: document.getElementById('btn-slash'),
  pistol: document.getElementById('btn-pistol'),
  buyMenu: document.getElementById('btn-buy-menu'),
  armor: document.getElementById('btn-buy-armor'),
  ammo: document.getElementById('btn-buy-ammo'),
  glock: document.getElementById('btn-buy-glock'),
  mp9: document.getElementById('btn-buy-mp9'),
  sprint: document.getElementById('btn-sprint'),
  slashCd: document.getElementById('cooldown-slash'),
  pistolCd: document.getElementById('cooldown-pistol'),
  armorCd: document.getElementById('cooldown-armor'),
  sprintCd: document.getElementById('cooldown-sprint'),
  slashStatus: document.getElementById('action-status-slash'),
  pistolStatus: document.getElementById('action-status-pistol'),
  pistolAmmo: document.getElementById('ammo-pistol'),
  pistolMags: document.getElementById('mags-pistol'),
  pistolLabel: document.getElementById('action-label-pistol'),
  pistolIcon: document.getElementById('weapon-icon-pistol'),
  mp9Icon: document.getElementById('weapon-icon-mp9'),
  buyStatus: document.getElementById('action-status-buy'),
  buyLock: document.getElementById('buy-menu-lock'),
  armorStatus: document.getElementById('action-status-armor'),
  ammoStatus: document.getElementById('action-status-ammo'),
  glockStatus: document.getElementById('action-status-glock'),
  mp9Status: document.getElementById('action-status-mp9'),
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
  const weapon = WEAPONS[boss?.weapon] || null;
  const hasGun = Boolean(weapon);
  const isMp9 = weapon === WEAPONS.mp9;
  const pistolOwned = Boolean(boss && boss.pistolOwned);
  const ammo = boss && Number.isFinite(boss.ammo)
    ? Math.max(0, Math.floor(boss.ammo))
    : weapon
      ? weapon.magazine
      : 0;
  const mags = boss && Number.isFinite(boss.spareMags)
    ? Math.max(0, Math.floor(boss.spareMags))
    : weapon
      ? null
      : 0;
  const magsCap = isMp9 ? MP9_MAG_CAP : PISTOL_MAG_CAP;
  const mp9Owned = Boolean(boss && boss.mp9Owned);
  const canBuyAmmo = hasGun && mags !== null && mags < magsCap;
  const reloadCd = boss ? Math.max(0, boss.reloadTimer || 0) : 0;
  const armorCd = boss ? Math.max(0, boss.armorCooldown || 0) : 0;
  const sprintCd = boss ? Math.max(0, boss.sprintCooldown || 0) : 0;
  const armorVal = boss ? Math.max(0, boss.armor || 0) : 0;
  const armorFull = armorVal >= MAX_BOSS_ARMOR;
  const friendly = Boolean(boss) && isOnFriendlyTurf(boss);
  const shopLocked = Boolean(alive && boss && !friendly);

  const attackState = !alive ? 'disabled' : attackCd > 0 ? 'cooldown' : 'ready';
  setDisabled(els.slash, !alive || attackCd > 0);
  setCooldown(els.slashCd, attackCd, SLASH.humanBoss.cooldown);
  setState(els.slash, attackState);
  setStatus(els.slashStatus, attackCd > 0 ? `${attackCd.toFixed(1)}s` : 'READY');

  const outOfAmmo = ammo <= 0 && mags !== null && mags <= 0;
  const pistolState = !alive
    ? 'disabled'
    : !hasGun || reloadCd > 0 || ammo <= 0 || attackCd > 0
      ? 'cooldown'
      : 'ready';
  setDisabled(els.pistol, !alive);
  setCooldown(
    els.pistolCd,
    reloadCd > 0 ? reloadCd : attackCd,
    reloadCd > 0 && weapon ? weapon.reloadTime : weapon ? weapon.fireCooldown : 1
  );
  setState(els.pistol, pistolState);
  setStatus(
    els.pistolStatus,
    !hasGun
      ? 'EMPTY'
      : reloadCd > 0
        ? `${reloadCd.toFixed(1)}s`
        : outOfAmmo
          ? 'NO AMMO'
          : attackCd > 0
            ? `${attackCd.toFixed(1)}s`
            : 'READY'
  );
  if (els.pistolLabel) {
    els.pistolLabel.textContent = !hasGun
      ? 'EMPTY'
      : reloadCd > 0
        ? 'RELOADING'
        : isMp9
          ? 'MP9'
          : 'Glock 19';
  }
  if (els.pistol) {
    const tip = !pistolOwned
      ? 'No ranged weapon — buy the Glock 19 (B → 3)'
      : isMp9
        ? 'MP9 SMG — 20 rounds, hold RMB for 0.1s automatic fire, 4s reload (E switches, R reloads)'
        : 'Glock 19 9mm — 10 rounds, 0.2s cadence, 4s reload (E switches after buying the MP9)';
    els.pistol.dataset.tip = mp9Owned ? `${tip} · click to switch` : tip;
  }
  if (els.pistolAmmo) {
    els.pistolAmmo.textContent = String(ammo);
    els.pistolAmmo.classList.toggle('is-low', reloadCd <= 0 && ammo > 0 && ammo <= 3);
    els.pistolAmmo.classList.toggle('is-empty', ammo <= 0 && reloadCd <= 0);
    els.pistolAmmo.classList.toggle('is-reloading', reloadCd > 0);
  }
  if (els.pistolMags) {
    els.pistolMags.textContent = mags == null ? '∞' : `×${mags}`;
    els.pistolMags.title = mags == null
      ? 'Unlimited magazines'
      : `${mags}/${magsCap} spare magazines`;
    els.pistolMags.classList.toggle('is-low', mags === 1);
    els.pistolMags.classList.toggle('is-empty', mags === 0);
  }
  if (els.pistolIcon) els.pistolIcon.classList.toggle('hidden', isMp9 || !hasGun);
  if (els.mp9Icon) els.mp9Icon.classList.toggle('hidden', !isMp9);

  setDisabled(els.buyMenu, !alive);
  setState(els.buyMenu, !alive ? 'disabled' : 'ready');
  setStatus(els.buyStatus, 'BUY');
  if (els.buyLock) els.buyLock.classList.toggle('hidden', !shopLocked);

  const armorState = !alive || shopLocked
    ? 'disabled'
    : armorFull
      ? 'full'
      : armorCd > 0
        ? 'cooldown'
        : cash >= COST_BOSS_ARMOR
          ? 'affordable'
          : 'unaffordable';
  setDisabled(els.armor, !alive || shopLocked || armorFull || armorCd > 0 || cash < COST_BOSS_ARMOR);
  setCooldown(els.armorCd, armorCd, state.tickDuration);
  setState(els.armor, armorState);
  setStatus(
    els.armorStatus,
    armorFull ? 'FULL' : shopLocked ? 'OWN TURF' : `$${COST_BOSS_ARMOR.toLocaleString()}`
  );

  const ammoState = !alive || shopLocked
    ? 'disabled'
    : !hasGun
      ? 'disabled'
      : !canBuyAmmo
        ? 'full'
        : cash >= COST_BOSS_AMMO
          ? 'affordable'
          : 'unaffordable';
  setDisabled(els.ammo, !alive || shopLocked || !hasGun || !canBuyAmmo || cash < COST_BOSS_AMMO);
  setState(els.ammo, ammoState);
  setStatus(
    els.ammoStatus,
    !hasGun
      ? 'NO GUN'
      : shopLocked
        ? 'OWN TURF'
        : !canBuyAmmo
          ? 'MAX'
          : `${AMMO_ROUNDS_PER_PURCHASE} rds · $${COST_BOSS_AMMO.toLocaleString()}`
  );

  const glockState = !alive || shopLocked
    ? 'disabled'
    : pistolOwned
      ? 'full'
      : cash >= COST_BOSS_GLOCK
        ? 'affordable'
        : 'unaffordable';
  setDisabled(els.glock, !alive || shopLocked || pistolOwned || cash < COST_BOSS_GLOCK);
  setState(els.glock, glockState);
  setStatus(
    els.glockStatus,
    pistolOwned ? 'OWNED' : shopLocked ? 'OWN TURF' : `$${COST_BOSS_GLOCK.toLocaleString()}`
  );

  const mp9State = !alive || shopLocked
    ? 'disabled'
    : mp9Owned
      ? 'full'
      : !pistolOwned
        ? 'disabled'
        : cash >= COST_BOSS_MP9
          ? 'affordable'
          : 'unaffordable';
  setDisabled(els.mp9, !alive || shopLocked || !pistolOwned || mp9Owned || cash < COST_BOSS_MP9);
  setState(els.mp9, mp9State);
  setStatus(
    els.mp9Status,
    mp9Owned ? 'OWNED' : !pistolOwned ? 'LOCKED' : shopLocked ? 'OWN TURF' : `$${COST_BOSS_MP9.toLocaleString()}`
  );

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

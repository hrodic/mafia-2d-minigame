// Action bar tests: cooldown overlays, disabled states and secondary costs.
import { test, assert, assertEqual } from './harness.js';
import { Faction } from '../src/config/enums.js';
import { state } from '../src/core/state.js';
import { updateActionBar } from '../src/ui/actionBar.js';

const STATE_KEYS = ['gameStarted', 'player', 'treasuries', 'factionAlive', 'net', 'tickDuration'];

function withActionState(opts, fn) {
  const saved = {};
  for (const key of STATE_KEYS) saved[key] = state[key];
  state.net = null;
  state.gameStarted = true;
  state.tickDuration = 10;
  state.factionAlive = { ...saved.factionAlive, [Faction.PLAYER]: true };
  state.treasuries = { ...saved.treasuries, [Faction.PLAYER]: opts.cash ?? 0 };
  state.player = {
    alive: opts.alive ?? true,
    hp: 400,
    maxHp: 400,
    armor: opts.armor ?? 0,
    maxArmor: 300,
    attackCooldown: opts.attackCooldown ?? 0,
    armorCooldown: opts.armorCooldown ?? 0,
    sprintCooldown: opts.sprintCooldown ?? 0,
    sprintTimer: opts.sprintTimer ?? 0,
    isSprinting: opts.isSprinting ?? false,
  };
  try {
    return fn();
  } finally {
    for (const key of STATE_KEYS) state[key] = saved[key];
  }
}

const $ = (id) => document.getElementById(id);

test('action bar: cooling abilities show overlays and disabled states', () => {
  withActionState({ attackCooldown: 0.17, armorCooldown: 5, sprintCooldown: 2, cash: 0 }, () => {
    updateActionBar();
    assert($('btn-slash').classList.contains('is-disabled'), 'slash should be cooling');
    assert(parseFloat($('cooldown-slash').style.height) > 0, 'slash cooldown overlay');
    assert($('btn-pistol').classList.contains('is-disabled'), 'pistol should be cooling');
    assert(parseFloat($('cooldown-pistol').style.height) > 0, 'pistol cooldown overlay');
    assert($('btn-buy-armor').classList.contains('is-disabled'), 'armor should be disabled');
    assert(parseFloat($('cooldown-armor').style.height) > 0, 'armor cooldown overlay');
    assert(parseFloat($('cooldown-sprint').style.height) > 0, 'sprint cooldown overlay');
    assert($('action-status-armor').textContent.includes('$3,500'), $('action-status-armor').textContent);
  });
});

test('action bar: ready abilities clear overlays and expose costs', () => {
  withActionState({ cash: 3500, armor: 0 }, () => {
    updateActionBar();
    assert(!$('btn-slash').classList.contains('is-disabled'), 'slash ready');
    assertEqual($('cooldown-slash').style.height, '0%');
    assert(!$('btn-pistol').classList.contains('is-disabled'), 'pistol ready');
    assertEqual($('cooldown-pistol').style.height, '0%');
    assert(!$('btn-buy-armor').classList.contains('is-disabled'), 'armor affordable');
    assert($('action-status-armor').textContent.includes('$3,500'));
    assert(!$('btn-sprint').classList.contains('is-disabled'), 'sprint ready');
    assertEqual($('cooldown-sprint').style.height, '0%');
  });
});

test('action bar: full armor and death disable actions', () => {
  withActionState({ cash: 9999, armor: 300 }, () => {
    updateActionBar();
    assert($('btn-buy-armor').classList.contains('is-disabled'), 'full armor disables purchase');
    assertEqual($('action-status-armor').textContent, 'FULL');
  });
  withActionState({ alive: false }, () => {
    updateActionBar();
    for (const id of ['btn-slash', 'btn-pistol', 'btn-buy-armor', 'btn-sprint']) {
      assert($(id).classList.contains('is-disabled'), `${id} disabled when dead`);
    }
  });
});

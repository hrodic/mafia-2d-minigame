// Action bar tests: cooldown overlays, disabled states and secondary costs.
import { test, assert, assertEqual } from './harness.js';
import { Faction } from '../src/config/enums.js';
import { GLOBAL_STANCE, LOCAL_ORDER, createFactionTactics } from '../src/config/tactics.js';
import { state } from '../src/core/state.js';
import { updateActionBar } from '../src/ui/actionBar.js';

const STATE_KEYS = [
  'gameStarted',
  'player',
  'treasuries',
  'factionAlive',
  'net',
  'tickDuration',
  'world',
  'factionTactics',
];

function withActionState(opts, fn) {
  const saved = {};
  for (const key of STATE_KEYS) saved[key] = state[key];
  state.net = null;
  state.world = {
    worldToTile: () => ({ cx: 0, cy: 0 }),
    getChunk: () => ({ faction: (opts.friendly ?? true) ? Faction.PLAYER : Faction.RIVAL_1 }),
  };
  state.gameStarted = true;
  state.tickDuration = 10;
  state.factionAlive = { ...saved.factionAlive, [Faction.PLAYER]: true };
  state.treasuries = { ...saved.treasuries, [Faction.PLAYER]: opts.cash ?? 0 };
  state.factionTactics = {
    [Faction.PLAYER]: createFactionTactics(),
    [Faction.RIVAL_1]: createFactionTactics(),
    [Faction.RIVAL_2]: createFactionTactics(),
    [Faction.RIVAL_3]: createFactionTactics(),
  };
  state.player = {
    faction: Faction.PLAYER,
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
    ammo: opts.ammo ?? 10,
    spareMags: opts.spareMags ?? 0,
    pistolMags: opts.pistolMags ?? 0,
    mp9Mags: opts.mp9Mags ?? 0,
    reloadTimer: opts.reloadTimer ?? 0,
    weapon: opts.weapon ?? 'pistol',
    pistolOwned: opts.pistolOwned ?? true,
    mp9Owned: opts.mp9Owned ?? false,
  };
  try {
    return fn();
  } finally {
    for (const key of STATE_KEYS) state[key] = saved[key];
  }
}

const $ = (id) => document.getElementById(id);

function progress(id) {
  return parseFloat($(id).style.getPropertyValue('--progress'));
}

test('action bar: cooling abilities use transform progress and cooldown state', () => {
  withActionState({ attackCooldown: 0.17, armorCooldown: 5, sprintCooldown: 2, cash: 0 }, () => {
    updateActionBar();
    assert($('btn-slash').classList.contains('is-disabled'), 'slash should be cooling');
    assert(progress('cooldown-slash') > 0, 'slash cooldown progress');
    assertEqual($('cooldown-slash').style.height, '');
    assertEqual($('btn-slash').dataset.state, 'cooldown');
    assert(!$('btn-pistol').classList.contains('is-disabled'), 'weapon button stays clickable to switch');
    assert(progress('cooldown-pistol') > 0, 'pistol cooldown progress');
    assertEqual($('btn-pistol').dataset.state, 'cooldown');
    assert($('btn-buy-armor').classList.contains('is-disabled'), 'armor should be disabled');
    assert(progress('cooldown-armor') > 0, 'armor cooldown progress');
    assertEqual($('btn-buy-armor').dataset.state, 'cooldown');
    assert(progress('cooldown-sprint') > 0, 'sprint cooldown progress');
    assertEqual($('btn-sprint').dataset.state, 'cooldown');
    assert($('action-status-armor').textContent.includes('$2,000'), $('action-status-armor').textContent);
  });
});

test('action bar: ready abilities clear progress, expose costs and affordable armor', () => {
  withActionState({ cash: 3500, armor: 0 }, () => {
    updateActionBar();
    assert(!$('btn-slash').classList.contains('is-disabled'), 'slash ready');
    assertEqual(progress('cooldown-slash'), 0);
    assertEqual($('btn-slash').dataset.state, 'ready');
    assert(!$('btn-pistol').classList.contains('is-disabled'), 'pistol ready');
    assertEqual(progress('cooldown-pistol'), 0);
    assertEqual($('btn-pistol').dataset.state, 'ready');
    assert(!$('btn-buy-armor').classList.contains('is-disabled'), 'armor affordable');
    assertEqual($('btn-buy-armor').dataset.state, 'affordable');
    assert($('action-status-armor').textContent.includes('$2,000'));
    assert(!$('btn-sprint').classList.contains('is-disabled'), 'sprint ready');
    assertEqual(progress('cooldown-sprint'), 0);
    assertEqual($('btn-sprint').dataset.state, 'ready');
  });
});

test('action bar: pistol shows bullets left and the reload state', () => {
  withActionState({ ammo: 7 }, () => {
    updateActionBar();
    assertEqual($('ammo-pistol').textContent, '7');
    assertEqual($('action-status-pistol').textContent, 'READY');
    assert(!$('btn-pistol').classList.contains('is-disabled'), 'pistol ready with ammo');
  });
  withActionState({ ammo: 2 }, () => {
    updateActionBar();
    assertEqual($('ammo-pistol').textContent, '2');
    assert($('ammo-pistol').classList.contains('is-low'), 'low ammo should be highlighted');
  });
  withActionState({ ammo: 0, reloadTimer: 3 }, () => {
    updateActionBar();
    assertEqual($('ammo-pistol').textContent, '0');
    assert($('ammo-pistol').classList.contains('is-reloading'));
    assertEqual($('action-label-pistol').textContent, 'RELOADING');
    assertEqual($('action-status-pistol').textContent, '3.0s');
    assert(progress('cooldown-pistol') > 0, 'reload progress should fill the button');
    assertEqual($('btn-pistol').dataset.state, 'cooldown');
    assert(!$('btn-pistol').classList.contains('is-disabled'), 'reloading still allows switching weapons');
  });
  withActionState({ ammo: 10 }, () => {
    updateActionBar();
    assertEqual($('action-label-pistol').textContent, 'Glock 19');
  });
});

test('action bar: armor is unaffordable below cost and full at max armor', () => {
  withActionState({ cash: 0, armor: 0 }, () => {
    updateActionBar();
    assertEqual($('btn-buy-armor').dataset.state, 'unaffordable');
    assert($('btn-buy-armor').classList.contains('is-disabled'));
  });
  withActionState({ cash: 9999, armor: 300 }, () => {
    updateActionBar();
    assertEqual($('btn-buy-armor').dataset.state, 'full');
  });
});

test('action bar: MP9 purchase button and equipped weapon state', () => {
  withActionState({ cash: 4000, weapon: 'pistol' }, () => {
    updateActionBar();
    assert(!$('btn-buy-mp9').classList.contains('is-disabled'), 'MP9 affordable');
    assertEqual($('btn-buy-mp9').dataset.state, 'affordable');
    assert($('action-status-mp9').textContent.includes('$4,000'));
  });
  withActionState({ cash: 0, weapon: 'pistol' }, () => {
    updateActionBar();
    assert($('btn-buy-mp9').classList.contains('is-disabled'), 'MP9 unaffordable');
    assertEqual($('btn-buy-mp9').dataset.state, 'unaffordable');
  });
  withActionState({ cash: 0, weapon: 'mp9', mp9Owned: true, ammo: 20, spareMags: 2, mp9Mags: 2 }, () => {
    updateActionBar();
    assertEqual($('action-label-pistol').textContent, 'MP9');
    assertEqual($('ammo-pistol').textContent, '20');
    assertEqual($('mags-pistol').textContent, '×2');
    assertEqual($('btn-buy-mp9').dataset.state, 'full');
    assertEqual($('action-status-mp9').textContent, 'OWNED');
    assert($('btn-buy-mp9').classList.contains('is-disabled'), 'owned MP9 disables purchase');
  });
});

test('action bar: ammo shop shows 20-round bundles and hits the reserve caps', () => {
  withActionState({ cash: 600, pistolMags: 5, spareMags: 5 }, () => {
    updateActionBar();
    assert(!$('btn-buy-ammo').classList.contains('is-disabled'), 'ammo affordable');
    assertEqual($('btn-buy-ammo').dataset.state, 'affordable');
    assert($('action-status-ammo').textContent.includes('20 rds'));
  });
  withActionState({ cash: 9999, pistolMags: 20, spareMags: 20, weapon: 'pistol' }, () => {
    updateActionBar();
    assert($('btn-buy-ammo').classList.contains('is-disabled'), 'pistol reserve full');
    assertEqual($('btn-buy-ammo').dataset.state, 'full');
    assertEqual($('action-status-ammo').textContent, 'MAX');
    assertEqual($('mags-pistol').textContent, '×20');
  });
});

test('action bar: an unarmed boss shows no gun and locks the MP9 behind the Glock', () => {
  withActionState(
    { cash: 1000, weapon: 'none', pistolOwned: false, mp9Owned: false, ammo: 0, spareMags: 0, pistolMags: 0 },
    () => {
      updateActionBar();
      assertEqual($('action-label-pistol').textContent, 'EMPTY');
      assertEqual($('ammo-pistol').textContent, '0');
      assertEqual($('mags-pistol').textContent, '×0');
      assertEqual($('action-status-pistol').textContent, 'EMPTY');
      assert(!$('btn-buy-glock').classList.contains('is-disabled'), 'Glock affordable');
      assertEqual($('btn-buy-glock').dataset.state, 'affordable');
      assert($('btn-buy-mp9').classList.contains('is-disabled'), 'MP9 locked');
      assertEqual($('action-status-mp9').textContent, 'LOCKED');
      assert($('btn-buy-ammo').classList.contains('is-disabled'), 'no ammo without a gun');
      assertEqual($('action-status-ammo').textContent, 'NO GUN');
    }
  );
  withActionState(
    { cash: 0, weapon: 'pistol', pistolOwned: true, ammo: 0, spareMags: 0, pistolMags: 0 },
    () => {
      updateActionBar();
      assertEqual($('action-label-pistol').textContent, 'Glock 19');
      assertEqual($('btn-buy-glock').dataset.state, 'full');
      assertEqual($('action-status-glock').textContent, 'OWNED');
      assertEqual($('btn-buy-mp9').dataset.state, 'unaffordable');
    }
  );
});

test('action bar: shops lock outside friendly turf', () => {
  withActionState(
    {
      cash: 9999,
      weapon: 'pistol',
      pistolOwned: true,
      ammo: 5,
      spareMags: 1,
      pistolMags: 1,
      friendly: false,
    },
    () => {
      updateActionBar();
      assert($('btn-buy-armor').classList.contains('is-disabled'), 'armor locked off turf');
      assert($('btn-buy-ammo').classList.contains('is-disabled'), 'ammo locked off turf');
      assert($('btn-buy-glock').classList.contains('is-disabled'), 'Glock locked off turf');
      assert($('btn-buy-mp9').classList.contains('is-disabled'), 'MP9 locked off turf');
      assertEqual($('action-status-glock').textContent, 'OWNED');
      assertEqual($('action-status-ammo').textContent, 'OWN TURF');
      assert(!$('buy-menu-lock').classList.contains('hidden'), 'shop hint must show off turf');
    }
  );
});

test('action bar: full armor and death disable actions', () => {
  withActionState({ cash: 9999, armor: 300 }, () => {
    updateActionBar();
    assert($('btn-buy-armor').classList.contains('is-disabled'), 'full armor disables purchase');
    assertEqual($('action-status-armor').textContent, 'FULL');
  });
  withActionState({ alive: false }, () => {
    updateActionBar();
    for (const id of ['btn-slash', 'btn-pistol', 'btn-buy-menu', 'btn-buy-ammo', 'btn-buy-glock', 'btn-buy-mp9', 'btn-buy-armor', 'btn-sprint', 'btn-order-global', 'btn-order-local']) {
      assert($(id).classList.contains('is-disabled'), `${id} disabled when dead`);
    }
  });
});

test('action bar: order buttons show the local faction posture', () => {
  withActionState({}, () => {
    updateActionBar();
    assertEqual($('order-global-value').textContent, 'Expand');
    assertEqual($('order-local-value').textContent, 'Attack');
    assertEqual($('btn-order-global').dataset.state, 'expand');
    assertEqual($('btn-order-local').dataset.state, 'attack');

    state.factionTactics[Faction.PLAYER].globalStance = GLOBAL_STANCE.DEFEND;
    state.factionTactics[Faction.PLAYER].localOrder = LOCAL_ORDER.GUARD;
    updateActionBar();
    assertEqual($('order-global-value').textContent, 'Defend');
    assertEqual($('order-local-value').textContent, 'Guard');
    assertEqual($('btn-order-global').dataset.state, 'defend');
    assertEqual($('btn-order-local').dataset.state, 'guard');
  });
});

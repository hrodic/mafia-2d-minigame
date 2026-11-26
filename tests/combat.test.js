// Combat tests: damage/armor, slash/pistol, accuracy, raycast and armor purchases.
import { test, assert, assertEqual } from './harness.js';
import { Faction, UnitRank, PropType } from '../src/config/enums.js';
import { CHUNK_SIZE, TILE_SIZE, MAX_PISTOL_RANGE } from '../src/config/constants.js';
import {
  BOSS_MAX_HP,
  MAX_BOSS_ARMOR,
  COST_BOSS_ARMOR,
  UNIT_ATTACK_COOLDOWN,
} from '../src/config/balance.js';
import { state } from '../src/core/state.js';
import { on } from '../src/core/events.js';
import { bloodParticles, bulletTracers, shellCasings, resetEffects } from '../src/render/effects.js';
import {
  onUnitDamaged,
  onUnitDied,
  onArmorBroken,
  onArmorEquipped,
  onSlashPerformed,
  onShotStarted,
  onShotFired,
} from '../src/render/combatFx.js';
import {
  applyDamageToNpc,
  executeBossSlashForFaction,
  performKnifeSlash,
  performBossKnifeSlash,
  traceBulletRay,
  getPistolAccuracyInfo,
  performBossPistolShot,
  damagePlayerBoss,
  executeBuyArmorForFaction,
  buyBossArmor,
  tryBuyNpcBossArmor,
  rollDamage,
} from '../src/sim/combat.js';

let nextId = 1;

function makeWorld(options = {}) {
  const walkable = options.walkable || (() => true);
  const props = Array.from({ length: CHUNK_SIZE }, () => Array(CHUNK_SIZE).fill(PropType.NONE));
  const chunk = {
    cx: 0,
    cy: 0,
    faction: Faction.NEUTRAL,
    income: 0,
    captureProgress: 0,
    capturingFaction: null,
    props,
    propVertical: Array.from({ length: CHUNK_SIZE }, () => Array(CHUNK_SIZE).fill(false)),
    propCurbSide: Array.from({ length: CHUNK_SIZE }, () => Array(CHUNK_SIZE).fill('N')),
  };
  return {
    canMoveTo: () => true,
    isWalkable: walkable,
    worldToTile(x, y) {
      const gx = Math.floor(x / TILE_SIZE);
      const gy = Math.floor(y / TILE_SIZE);
      return {
        cx: Math.floor(gx / CHUNK_SIZE),
        cy: Math.floor(gy / CHUNK_SIZE),
        lx: ((gx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE,
        ly: ((gy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE,
      };
    },
    getChunk() {
      return chunk;
    },
    chunks: new Map([[`0,0`, chunk]]),
  };
}

function makePlayer(overrides = {}) {
  return {
    x: 0,
    y: 0,
    hp: BOSS_MAX_HP,
    maxHp: BOSS_MAX_HP,
    armor: 0,
    maxArmor: MAX_BOSS_ARMOR,
    alive: true,
    facing: 0,
    speed: 225,
    minDmg: 20,
    maxDmg: 40,
    attackCooldown: 0,
    slashAnimTimer: 0,
    muzzleFlashTimer: 0,
    hitFlashTimer: 0,
    armorCooldown: 0,
    sprintTimer: 0,
    sprintCooldown: 0,
    isSprinting: false,
    targetX: null,
    targetY: null,
    ...overrides,
  };
}

function makeNpc(overrides = {}) {
  return {
    id: nextId++,
    faction: Faction.RIVAL_1,
    rank: UnitRank.SOLDIER,
    x: 100,
    y: 0,
    bodyRadius: 11,
    speed: 128,
    hp: 180,
    maxHp: 180,
    armor: 0,
    maxArmor: 0,
    armorCooldown: 0,
    sprintTimer: 0,
    sprintCooldown: 0,
    isSprinting: false,
    minDmg: 10,
    maxDmg: 18,
    facing: 0,
    attackCooldown: 0,
    slashAnimTimer: 0,
    muzzleFlashTimer: 0,
    hitFlashTimer: 0,
    ...overrides,
  };
}

const STATE_KEYS = [
  'world',
  'player',
  'npcs',
  'treasuries',
  'factionAlive',
  'gameOver',
  'victoryShown',
  'activeFactions',
  'net',
  'gameStarted',
  'tickDuration',
  'floatingTexts',
  'spatialBuckets',
  'camera',
  'keys',
];

const CAPTURED_EVENTS = [
  'unit:damaged',
  'unit:died',
  'armor:broken',
  'armor:equipped',
  'slash:performed',
  'shot:started',
  'shot:fired',
  'ui:toast',
  'faction:eliminated',
  'match:victory',
  'match:defeat',
];

function eventsOf(events, type) {
  return events.filter((entry) => entry.type === type);
}

function withCombatState(opts, fn) {
  const saved = {};
  for (const key of STATE_KEYS) saved[key] = state[key];

  state.world = opts.world || makeWorld();
  state.player = opts.player || makePlayer();
  state.npcs = opts.npcs || [];
  state.treasuries = { ...saved.treasuries, ...(opts.treasuries || {}) };
  state.factionAlive = { ...saved.factionAlive, ...(opts.factionAlive || {}) };
  state.gameOver = false;
  state.victoryShown = false;
  state.activeFactions = [Faction.PLAYER, Faction.RIVAL_1, Faction.RIVAL_2, Faction.RIVAL_3];
  state.net = opts.net || null;
  state.gameStarted = true;
  state.tickDuration = 10;
  state.floatingTexts = [];
  state.spatialBuckets = new Map();
  state.camera = { x: 0, y: 0 };
  state.keys = new Set();
  resetEffects();

  const events = [];
  const unsubscribers = [
    ...CAPTURED_EVENTS.map((type) => on(type, (payload) => events.push({ type, payload }))),
    // Mirror production wiring so visual/RNG behavior stays identical under test.
    on('unit:damaged', onUnitDamaged),
    on('unit:died', onUnitDied),
    on('armor:broken', onArmorBroken),
    on('armor:equipped', onArmorEquipped),
    on('slash:performed', onSlashPerformed),
    on('shot:started', onShotStarted),
    on('shot:fired', onShotFired),
  ];

  try {
    return fn({ events });
  } finally {
    for (const unsubscribe of unsubscribers) unsubscribe();
    for (const key of STATE_KEYS) state[key] = saved[key];
    resetEffects();
  }
}

test('combat: accuracy bands follow distance falloff', () => {
  assertEqual(getPistolAccuracyInfo(MAX_PISTOL_RANGE + 1).failChance, 1);
  assertEqual(getPistolAccuracyInfo(MAX_PISTOL_RANGE + 1).dmgMult, 0);
  assertEqual(getPistolAccuracyInfo(50).dmgMult, 0.25);
  assertEqual(getPistolAccuracyInfo(99).dmgMult, 0.5);
  const mid = getPistolAccuracyInfo(200);
  assertEqual(mid.failChance, 0);
  assertEqual(mid.dmgMult, 1);
  assertEqual(getPistolAccuracyInfo(300).failChance, 0.05);
  assertEqual(getPistolAccuracyInfo(600).failChance, 0.1);
  assertEqual(getPistolAccuracyInfo(800).failChance, 0.25);
  assertEqual(getPistolAccuracyInfo(950).failChance, 0.5);
});

test('combat: damage rolls stay inside the requested range', () => {
  for (let i = 0; i < 100; i++) {
    const dmg = rollDamage(10, 20);
    assert(dmg >= 10 && dmg <= 20, `roll out of range: ${dmg}`);
  }
});

test('combat: raycast reports clear paths and building impacts', () => {
  withCombatState({ world: makeWorld() }, () => {
    const hit = traceBulletRay(0, 0, 0, MAX_PISTOL_RANGE);
    assertEqual(hit.blocked, false);
    assertEqual(hit.dist, MAX_PISTOL_RANGE);
  });
  withCombatState({ world: makeWorld({ walkable: (x) => x < 100 }) }, () => {
    const hit = traceBulletRay(0, 0, 0, MAX_PISTOL_RANGE);
    assertEqual(hit.blocked, true);
    assert(hit.dist >= 100 && hit.dist < 120, `unexpected impact dist ${hit.dist}`);
  });
});

test('combat: car footprints block bullet rays', () => {
  const world = makeWorld();
  const chunk = world.getChunk();
  chunk.props[0][0] = PropType.CAR;
  chunk.propVertical[0][0] = true;
  chunk.propCurbSide[0][0] = 'W';
  withCombatState({ world }, () => {
    const hit = traceBulletRay(0, 10, 0, MAX_PISTOL_RANGE);
    assertEqual(hit.blocked, true);
    assert(hit.x >= 21 && hit.x <= 39, `car ray hit x=${hit.x}`);
  });
});

test('combat: armor absorbs damage before HP', () => {
  withCombatState({}, ({ events }) => {
    const target = makeNpc({ hp: 100, maxHp: 100, armor: 50, maxArmor: 50 });
    state.npcs = [target];
    assertEqual(applyDamageToNpc(target, 30), false);
    assertEqual(target.armor, 20);
    assertEqual(target.hp, 100);
    assertEqual(applyDamageToNpc(target, 30), false);
    assertEqual(target.armor, 0);
    assertEqual(target.hp, 90);
    assert(state.floatingTexts.length > 0);

    const hits = eventsOf(events, 'unit:damaged');
    assertEqual(hits.length, 2);
    assertEqual(hits[0].payload.absorbed, 30);
    assertEqual(hits[0].payload.remaining, 0);
    assertEqual(hits[0].payload.isPlayer, false);
    assertEqual(hits[1].payload.absorbed, 20);
    assertEqual(hits[1].payload.remaining, 10);
    assertEqual(hits[1].payload.isKill, false);

    const broken = eventsOf(events, 'armor:broken');
    assertEqual(broken.length, 1);
    assertEqual(broken[0].payload.isPlayer, false);
  });
});

test('combat: lethal damage removes the unit and spawns gore', () => {
  withCombatState({}, ({ events }) => {
    const target = makeNpc({ hp: 10, x: 0, y: 0 });
    state.npcs = [target];
    assertEqual(applyDamageToNpc(target, 50), true);
    assertEqual(state.npcs.length, 0);
    assert(bloodParticles.length > 0);

    const hits = eventsOf(events, 'unit:damaged');
    assertEqual(hits.length, 1);
    assertEqual(hits[0].payload.isKill, true);
    const deaths = eventsOf(events, 'unit:died');
    assertEqual(deaths.length, 1);
    assertEqual(deaths[0].payload.faction, Faction.RIVAL_1);
    assertEqual(deaths[0].payload.rank, UnitRank.SOLDIER);
    assertEqual(deaths[0].payload.isBoss, false);
    assertEqual(deaths[0].payload.isPlayer, false);
  });
});

test('combat: killing a boss eliminates the syndicate', () => {
  withCombatState({}, ({ events }) => {
    const boss = makeNpc({ rank: UnitRank.BOSS, hp: 10, x: 0, y: 0 });
    state.npcs = [boss];
    assertEqual(applyDamageToNpc(boss, 20), true);
    assertEqual(state.factionAlive[Faction.RIVAL_1], false);

    const eliminations = eventsOf(events, 'faction:eliminated');
    assertEqual(eliminations.length, 1);
    assertEqual(eliminations[0].payload.faction, Faction.RIVAL_1);
    assertEqual(eventsOf(events, 'match:victory').length, 0);

    const deaths = eventsOf(events, 'unit:died');
    assertEqual(deaths.length, 1);
    assertEqual(deaths[0].payload.isBoss, true);
    assertEqual(deaths[0].payload.faction, Faction.RIVAL_1);
  });
});

test('combat: boss damage is absorbed by armor and death is a defeat', () => {
  withCombatState({ player: makePlayer({ armor: 100 }) }, ({ events }) => {
    damagePlayerBoss(40);
    assertEqual(state.player.armor, 60);
    assertEqual(state.player.hp, BOSS_MAX_HP);

    const hits = eventsOf(events, 'unit:damaged');
    assertEqual(hits.length, 1);
    assertEqual(hits[0].payload.isPlayer, true);
    assertEqual(hits[0].payload.absorbed, 40);
    assertEqual(hits[0].payload.remaining, 0);

    damagePlayerBoss(500);
    assertEqual(state.player.alive, false);
    assertEqual(state.gameOver, true);

    const defeats = eventsOf(events, 'match:defeat');
    assertEqual(defeats.length, 1);
    assertEqual(defeats[0].payload.faction, Faction.PLAYER);

    const deaths = eventsOf(events, 'unit:died');
    assertEqual(deaths.length, 1);
    assertEqual(deaths[0].payload.isPlayer, true);
    assertEqual(deaths[0].payload.isBoss, true);
    assertEqual(deaths[0].payload.faction, Faction.PLAYER);
  });
});

test('combat: buying armor charges once and starts a cooldown', () => {
  withCombatState({ treasuries: { [Faction.PLAYER]: COST_BOSS_ARMOR } }, ({ events }) => {
    assertEqual(executeBuyArmorForFaction(Faction.PLAYER), true);
    assertEqual(state.treasuries[Faction.PLAYER], 0);
    assertEqual(state.player.armor, MAX_BOSS_ARMOR);
    assertEqual(state.player.armorCooldown, state.tickDuration);
    assertEqual(executeBuyArmorForFaction(Faction.PLAYER), false);

    const equipped = eventsOf(events, 'armor:equipped');
    assertEqual(equipped.length, 1);
    assertEqual(equipped[0].payload.isPlayer, true);
    assertEqual(equipped[0].payload.faction, Faction.PLAYER);
    assertEqual(equipped[0].payload.amount, MAX_BOSS_ARMOR);
  });
});

test('combat: rival bosses can buy armor from their treasury', () => {
  withCombatState(
    {
      npcs: [makeNpc({ rank: UnitRank.BOSS, faction: Faction.RIVAL_1, x: 0, y: 0 })],
      treasuries: { [Faction.RIVAL_1]: COST_BOSS_ARMOR },
    },
    ({ events }) => {
      const boss = state.npcs[0];
      assertEqual(executeBuyArmorForFaction(Faction.RIVAL_1), true);
      assertEqual(boss.armor, MAX_BOSS_ARMOR);
      assertEqual(boss.armorCooldown, state.tickDuration);
      assertEqual(state.treasuries[Faction.RIVAL_1], 0);

      const equipped = eventsOf(events, 'armor:equipped');
      assertEqual(equipped.length, 1);
      assertEqual(equipped[0].payload.isPlayer, false);
      assertEqual(equipped[0].payload.faction, Faction.RIVAL_1);
      assertEqual(equipped[0].payload.textOffset, 34);
    }
  );
});

test('combat: guest armor purchase is forwarded to the host', () => {
  const sent = [];
  withCombatState({ net: { isActive: () => true, localFaction: Faction.PLAYER, isGuest: () => true, sendCommand: (cmd) => sent.push(cmd) } }, () => {
    buyBossArmor();
    assertEqual(sent.length, 1);
    assertEqual(sent[0].cmd, 'BUY_ARMOR');
  });
});

test('combat: armor purchase failures explain themselves', () => {
  withCombatState({ treasuries: { [Faction.PLAYER]: 100 } }, ({ events }) => {
    buyBossArmor();
    const toasts = eventsOf(events, 'ui:toast').map((entry) => entry.payload.message);
    assert(toasts.some((msg) => msg.includes('Need $3,500')), toasts.join(' | '));
  });
  withCombatState({ treasuries: { [Faction.PLAYER]: COST_BOSS_ARMOR }, player: makePlayer({ armor: 300, maxArmor: 300 }) }, ({ events }) => {
    buyBossArmor();
    const toasts = eventsOf(events, 'ui:toast').map((entry) => entry.payload.message);
    assert(toasts.some((msg) => msg.includes('already at full capacity')), toasts.join(' | '));
  });
  withCombatState({ treasuries: { [Faction.PLAYER]: COST_BOSS_ARMOR } }, ({ events }) => {
    buyBossArmor();
    const toasts = eventsOf(events, 'ui:toast').map((entry) => entry.payload.message);
    assert(toasts.some((msg) => msg.includes('Equipped Kevlar Armor')), toasts.join(' | '));
    assertEqual(eventsOf(events, 'armor:equipped').length, 1);
  });
});

test('combat: NPC boss armor logic reacts to wounds, threats and cooldowns', () => {
  withCombatState({ treasuries: { [Faction.RIVAL_1]: COST_BOSS_ARMOR } }, ({ events }) => {
    const boss = makeNpc({ rank: UnitRank.BOSS, armor: 0, hp: 480, maxHp: 480 });
    state.npcs = [boss];
    assertEqual(tryBuyNpcBossArmor(boss, 0, 0), true);
    assertEqual(boss.armor, MAX_BOSS_ARMOR);
    const equipped = eventsOf(events, 'armor:equipped');
    assertEqual(equipped.length, 1);
    assertEqual(equipped[0].payload.textOffset, 36);
    assertEqual(equipped[0].payload.isPlayer, false);
  });
  withCombatState({ treasuries: { [Faction.RIVAL_1]: COST_BOSS_ARMOR } }, () => {
    const boss = makeNpc({ rank: UnitRank.BOSS, armor: 50, hp: 480, maxHp: 480 });
    state.npcs = [boss];
    assertEqual(tryBuyNpcBossArmor(boss, 0, 0), false);
    assertEqual(tryBuyNpcBossArmor(boss, 1, 0), true);
  });
  withCombatState({ treasuries: { [Faction.RIVAL_1]: COST_BOSS_ARMOR } }, () => {
    const boss = makeNpc({ rank: UnitRank.BOSS, armor: 0, humanPeerId: 'peer' });
    state.npcs = [boss];
    assertEqual(tryBuyNpcBossArmor(boss, 1, 0), false);
  });
});

test('combat: guest slash is sent as a command', () => {
  const sent = [];
  withCombatState(
    { net: { isActive: () => true, localFaction: Faction.PLAYER, isGuest: () => true, sendCommand: (cmd) => sent.push(cmd) } },
    () => {
      performKnifeSlash();
      assertEqual(sent.length, 1);
      assertEqual(sent[0].cmd, 'SLASH');
      assertEqual(state.player.attackCooldown, 0);
    }
  );
});

test('combat: player slash damages targets in front and respects cooldown', () => {
  withCombatState(
    { player: makePlayer({ facing: 0 }), npcs: [makeNpc({ x: 30, y: 0, hp: 100, maxHp: 100 })] },
    ({ events }) => {
      const npc = state.npcs[0];
      performKnifeSlash();
      assert(npc.hp < 100, `npc should be hit, hp=${npc.hp}`);
      assertEqual(state.player.attackCooldown, 0.34);
      const hp = npc.hp;
      performKnifeSlash();
      assertEqual(npc.hp, hp, 'second slash during cooldown must not hit');

      const slashes = eventsOf(events, 'slash:performed');
      assertEqual(slashes.length, 1);
      assertEqual(slashes[0].payload.hitCount, 1);
      assertEqual(slashes[0].payload.isPlayer, true);
      assertEqual(eventsOf(events, 'unit:damaged').length, 1);
    }
  );
});

test('combat: player slash ignores targets out of reach', () => {
  withCombatState(
    { player: makePlayer({ facing: 0 }), npcs: [makeNpc({ x: 200, y: 0, hp: 100, maxHp: 100 })] },
    ({ events }) => {
      performKnifeSlash();
      assertEqual(state.npcs[0].hp, 100);
      const slashes = eventsOf(events, 'slash:performed');
      assertEqual(slashes.length, 1);
      assertEqual(slashes[0].payload.hitCount, 0);
      assertEqual(eventsOf(events, 'unit:damaged').length, 0);
    }
  );
});

test('combat: rival boss slash uses the shared cooldown and hits the player', () => {
  withCombatState(
    {
      player: makePlayer({ x: 30, y: 0 }),
      npcs: [makeNpc({ rank: UnitRank.BOSS, x: 0, y: 0, facing: 0, minDmg: 20, maxDmg: 40 })],
    },
    () => {
      const boss = state.npcs[0];
      assertEqual(performBossKnifeSlash(boss), true);
      assert(state.player.hp < BOSS_MAX_HP);
      assertEqual(boss.attackCooldown, UNIT_ATTACK_COOLDOWN);
    }
  );
});

test('combat: rival pistol hits the player at mid range', () => {
  withCombatState(
    {
      player: makePlayer({ x: 200, y: 0 }),
      npcs: [makeNpc({ rank: UnitRank.BOSS, x: 0, y: 0, attackCooldown: 0 })],
    },
    ({ events }) => {
      const shooter = state.npcs[0];
      assertEqual(performBossPistolShot(shooter, false, 200, 0), true);
      assert(state.player.hp < BOSS_MAX_HP);
      assertEqual(shooter.attackCooldown, UNIT_ATTACK_COOLDOWN);
      assertEqual(bulletTracers.length, 1);
      assertEqual(shellCasings.length, 1);

      assertEqual(eventsOf(events, 'shot:started').length, 1);
      const shots = eventsOf(events, 'shot:fired');
      assertEqual(shots.length, 1);
      assertEqual(shots[0].payload.missed, false);
      assertEqual(shots[0].payload.impact.blocked, false);
      assertEqual(shots[0].payload.isPlayerShooter, false);
    }
  );
});

test('combat: walls stop bullets', () => {
  withCombatState(
    {
      world: makeWorld({ walkable: (x) => x < 100 }),
      player: makePlayer({ x: 200, y: 0 }),
      npcs: [makeNpc({ rank: UnitRank.BOSS, x: 0, y: 0 })],
    },
    ({ events }) => {
      performBossPistolShot(state.npcs[0], false, 200, 0);
      assertEqual(state.player.hp, BOSS_MAX_HP);
      const shots = eventsOf(events, 'shot:fired');
      assertEqual(shots.length, 1);
      assertEqual(shots[0].payload.impact.blocked, true);
    }
  );
});

test('combat: player pistol fires faster and damages rival units', () => {
  withCombatState(
    {
      player: makePlayer({ x: 0, y: 0 }),
      npcs: [makeNpc({ x: 200, y: 0, hp: 100, maxHp: 100 })],
    },
    ({ events }) => {
      const target = state.npcs[0];
      assertEqual(performBossPistolShot(state.player, true, 200, 0), true);
      assert(target.hp < 100);
      assertEqual(state.player.attackCooldown, 0.65);

      assertEqual(eventsOf(events, 'shot:started').length, 1);
      assertEqual(eventsOf(events, 'shot:fired')[0].payload.isPlayerShooter, true);
      assertEqual(eventsOf(events, 'unit:damaged').length, 1);
    }
  );
});

test('combat: faction slash delegates to boss melee and triggers the player path', () => {
  withCombatState(
    {
      player: makePlayer({ x: 30, y: 0 }),
      npcs: [makeNpc({ rank: UnitRank.BOSS, faction: Faction.RIVAL_1, x: 0, y: 0, facing: 0 })],
    },
    ({ events }) => {
      executeBossSlashForFaction(Faction.RIVAL_1);
      assert(state.player.hp < BOSS_MAX_HP);
      assertEqual(state.npcs[0].attackCooldown, 0.34);
      const rivalSlashes = eventsOf(events, 'slash:performed');
      assertEqual(rivalSlashes.length, 1);
      assertEqual(rivalSlashes[0].payload.isPlayer, false);
      assertEqual(rivalSlashes[0].payload.hitCount, 1);
    }
  );
  withCombatState({ player: makePlayer({ facing: 0 }), npcs: [makeNpc({ x: 30, y: 0, hp: 100, maxHp: 100 })] }, ({ events }) => {
    executeBossSlashForFaction(Faction.PLAYER);
    assert(state.npcs[0].hp < 100);
    const playerSlashes = eventsOf(events, 'slash:performed');
    assertEqual(playerSlashes.length, 1);
    assertEqual(playerSlashes[0].payload.isPlayer, true);
  });
});

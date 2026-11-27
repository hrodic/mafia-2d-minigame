// Combat tests: damage/armor, slash/pistol, accuracy, raycast and armor purchases.
import { test, assert, assertEqual, assertClose } from './harness.js';
import { Faction, UnitRank, PropType } from '../src/config/enums.js';
import { CHUNK_SIZE, TILE_SIZE, MAX_PISTOL_RANGE, HIT_FLASH_DURATION } from '../src/config/constants.js';
import {
  BOSS_MAX_HP,
  MAX_BOSS_ARMOR,
  COST_BOSS_ARMOR,
  PISTOL,
  SLASH,
} from '../src/config/balance.js';
import { FACTION_META } from '../src/config/organizations.js';
import { state } from '../src/core/state.js';
import { on } from '../src/core/events.js';
import {
  bloodParticles,
  bulletTracers,
  shellCasings,
  resetEffects,
  updateVisualParticles,
} from '../src/render/effects.js';
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
  performSlash,
  traceBulletRay,
  getPistolAccuracyInfo,
  getPistolAim,
  performBossPistolShot,
  tickWeapon,
  damagePlayerBoss,
  executeBuyArmorForFaction,
  buyBossArmor,
  tryBuyNpcBossArmor,
  rollDamage,
} from '../src/sim/combat.js';

let nextId = 1;

function withFixedRandom(value, fn) {
  const original = Math.random;
  Math.random = () => value;
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

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
    id: 0,
    faction: Faction.PLAYER,
    rank: UnitRank.BOSS,
    control: 'local',
    bodyRadius: 13.5,
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
    ammo: PISTOL.magazine,
    reloadTimer: 0,
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
    ammo: PISTOL.magazine,
    reloadTimer: 0,
    ...overrides,
  };
}

const STATE_KEYS = [
  'world',
  'player',
  'npcs',
  'treasuries',
  'factionAlive',
  'factionKills',
  'factionDeaths',
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
  state.factionKills = { ...saved.factionKills, ...(opts.factionKills || {}) };
  state.factionDeaths = { ...saved.factionDeaths, ...(opts.factionDeaths || {}) };
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
  assertEqual(getPistolAccuracyInfo(50).dmgMult, 0.8);
  assertEqual(getPistolAccuracyInfo(100).dmgMult, 0.8);
  assertEqual(getPistolAccuracyInfo(101).dmgMult, 0.9);
  const mid = getPistolAccuracyInfo(200);
  assertEqual(mid.failChance, 0.2);
  assertEqual(mid.dmgMult, 0.9);
  assertEqual(getPistolAccuracyInfo(201).dmgMult, 1);
  assertEqual(getPistolAccuracyInfo(300).failChance, 0.3);
  assertEqual(getPistolAccuracyInfo(400).failChance, 0.4);
  assertEqual(getPistolAccuracyInfo(500).failChance, 0.5);
  assertEqual(getPistolAccuracyInfo(600).failChance, 0.6);
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
    assertEqual(target.hitFlashTimer, HIT_FLASH_DURATION);
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

test('combat: kills credit the attacking faction', () => {
  withCombatState({}, () => {
    const enemy = makeNpc({ hp: 10, faction: Faction.RIVAL_1 });
    state.npcs = [enemy];
    applyDamageToNpc(enemy, 50, '#fbbf24', '', null, Faction.PLAYER);
    assertEqual(state.factionKills[Faction.PLAYER], 1);
    assertEqual(state.factionKills[Faction.RIVAL_1], 0);
    assertEqual(state.factionDeaths[Faction.RIVAL_1], 1);
    assertEqual(state.factionDeaths[Faction.PLAYER], 0);
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

    damagePlayerBoss(BOSS_MAX_HP + 100);
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

test('combat: the player goes through the shared damage pipeline', () => {
  withCombatState({}, ({ events }) => {
    state.player.hp = 30;
    state.player.armor = 50;
    state.npcs = [];

    const absorbedHit = applyDamageToNpc(state.player, 40, '#f43f5e', '', 0, Faction.RIVAL_1);
    assertEqual(absorbedHit, false);
    assertEqual(state.player.armor, 10);
    assertEqual(state.player.hp, 30);
    assertEqual(state.player.hitFlashTimer, HIT_FLASH_DURATION);
    assertEqual(state.npcs.length, 0);

    const hits = eventsOf(events, 'unit:damaged');
    assertEqual(hits.length, 1);
    assertEqual(hits[0].payload.isPlayer, true);
    assertEqual(hits[0].payload.absorbed, 40);
    assertEqual(hits[0].payload.remaining, 0);

    const lethalHit = applyDamageToNpc(state.player, 100, '#f43f5e', '', 0, Faction.RIVAL_1);
    assertEqual(lethalHit, true);
    assertEqual(state.player.alive, false);
    assertEqual(state.gameOver, true);
    assertEqual(state.npcs.length, 0);
    assertEqual(state.factionKills[Faction.RIVAL_1], 1);

    const deaths = eventsOf(events, 'unit:died');
    assertEqual(deaths.length, 1);
    assertEqual(deaths[0].payload.isPlayer, true);
    assertEqual(deaths[0].payload.isBoss, true);
    assertEqual(deaths[0].payload.faction, Faction.PLAYER);
    assertEqual(eventsOf(events, 'match:defeat').length, 1);

    // A dead player ignores further damage and never re-emits death/defeat.
    assertEqual(applyDamageToNpc(state.player, 100, '#f43f5e', '', 0, Faction.RIVAL_1), false);
    assertEqual(eventsOf(events, 'unit:damaged').length, 2);
    assertEqual(eventsOf(events, 'unit:died').length, 1);
    assertEqual(eventsOf(events, 'match:defeat').length, 1);
  });
});

test('combat: damagePlayerBoss credits the killer exactly once', () => {
  withCombatState({}, ({ events }) => {
    state.player.hp = 5;
    damagePlayerBoss(50, '#f43f5e', '', 0, Faction.RIVAL_2);
    assertEqual(state.player.alive, false);
    assertEqual(state.factionKills[Faction.RIVAL_2], 1);
    assertEqual(eventsOf(events, 'unit:died').length, 1);
    assertEqual(eventsOf(events, 'match:defeat').length, 1);

    damagePlayerBoss(50, '#f43f5e', '', 0, Faction.RIVAL_2);
    assertEqual(state.factionKills[Faction.RIVAL_2], 1);
    assertEqual(eventsOf(events, 'unit:died').length, 1);
    assertEqual(eventsOf(events, 'match:defeat').length, 1);
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

test('combat: player slash damages targets in front and respects cooldown', () => {
  withCombatState(
    { player: makePlayer({ facing: 0 }), npcs: [makeNpc({ x: 30, y: 0, hp: 100, maxHp: 100 })] },
    ({ events }) => {
      const npc = state.npcs[0];
      performKnifeSlash();
      assert(npc.hp < 100, `npc should be hit, hp=${npc.hp}`);
      assertEqual(state.player.attackCooldown, 0.8);
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

test('combat: knife never hits a target behind the attacker, even point blank', () => {
  withCombatState(
    { player: makePlayer({ facing: 0 }), npcs: [makeNpc({ x: -20, y: 0, hp: 100, maxHp: 100 })] },
    ({ events }) => {
      performKnifeSlash();
      assertEqual(state.npcs[0].hp, 100);
      assertEqual(eventsOf(events, 'unit:damaged').length, 0);
      assertEqual(eventsOf(events, 'slash:performed')[0].payload.hitCount, 0);
    }
  );

  withCombatState(
    {
      player: makePlayer({ x: 1000, y: 0 }),
      npcs: [
        makeNpc({ id: 40, rank: UnitRank.SOLDIER, faction: Faction.RIVAL_1, x: 0, y: 0, facing: 0 }),
        makeNpc({ id: 41, faction: Faction.RIVAL_2, x: -20, y: 0, hp: 100, maxHp: 100 }),
      ],
    },
    () => {
      const attacker = state.npcs.find((n) => n.id === 40);
      const behind = state.npcs.find((n) => n.id === 41);
      performSlash(attacker, { profile: SLASH.aiMeleeByRank[UnitRank.SOLDIER], targets: [behind] });
      assertEqual(behind.hp, 100, 'AI melee must not hit behind itself');
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
      assertEqual(boss.attackCooldown, 0.8);
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
      withFixedRandom(0.99, () => {
        assertEqual(performBossPistolShot(shooter, false, 200, 0), true);
      });
      assert(state.player.hp < BOSS_MAX_HP);
      assertEqual(shooter.attackCooldown, 0.2);
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

test('combat: shell casings land close to the shooter', () => {
  resetEffects();
  onShotStarted({ shooterX: 0, shooterY: 0, muzzleX: 0, muzzleY: 0, angle: 0 });
  assertEqual(shellCasings.length, 1);
  const casing = shellCasings[0];
  let landed = false;
  for (let i = 0; i < 120; i++) {
    updateVisualParticles(0.01);
    if (casing.z === 0) {
      landed = true;
      break;
    }
  }
  assert(landed, 'casing should land');
  const dist = Math.hypot(casing.x, casing.y);
  assert(dist < 30, `casing landed too far from the shooter: ${dist.toFixed(1)}px`);
  resetEffects();
});

test('combat: pistol tracer starts at the muzzle and points at the aim target', () => {
  withCombatState(
    { npcs: [makeNpc({ faction: Faction.RIVAL_2, x: 200, y: 0, hp: 1000, maxHp: 1000 })] },
    ({ events }) => {
      const aim = getPistolAim(state.player.x, state.player.y, 200, 0);
      withFixedRandom(0.99, () => {
        performBossPistolShot(state.player, true, 200, 0);
      });
      const shot = eventsOf(events, 'shot:fired')[0].payload;
      assertClose(shot.x1, aim.muzzleX);
      assertClose(shot.y1, aim.muzzleY);
      assertClose(shot.x2, 200, 1e-6);
      assertClose(shot.y2, 0, 1e-6);
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
      withFixedRandom(0.99, () => {
        assertEqual(performBossPistolShot(state.player, true, 200, 0), true);
      });
      assert(target.hp < 100);
      assertEqual(state.player.attackCooldown, 0.2);

      assertEqual(eventsOf(events, 'shot:started').length, 1);
      assertEqual(eventsOf(events, 'shot:fired')[0].payload.isPlayerShooter, true);
      assertEqual(eventsOf(events, 'unit:damaged').length, 1);
    }
  );
});

test('combat: pistol fires 10 rounds on a 0.2s cadence then reloads for 5s', () => {
  withCombatState({ player: makePlayer() }, () => {
    const p = state.player;
    const fire = () => performBossPistolShot(p, true, p.x + 300, p.y);
    assertEqual(p.ammo, PISTOL.magazine);

    p.attackCooldown = 0;
    assertEqual(fire(), true);
    assertEqual(p.attackCooldown, PISTOL.fireCooldown);
    assertEqual(p.ammo, PISTOL.magazine - 1);
    assertEqual(fire(), false, 'cadence must block an immediate refire');

    for (let i = 0; i < PISTOL.magazine - 1; i++) {
      p.attackCooldown = 0;
      assertEqual(fire(), true, `shot ${i + 2} should fire`);
    }
    assertEqual(p.ammo, 0);
    assertEqual(p.reloadTimer, PISTOL.reloadTime);
    assertEqual(fire(), false, 'an empty magazine must not fire');

    tickWeapon(p, PISTOL.reloadTime - 0.1);
    assertClose(p.reloadTimer, 0.1, 1e-9);
    assertEqual(p.ammo, 0, 'magazine refills only when the reload completes');

    tickWeapon(p, 0.1);
    assertEqual(p.reloadTimer, 0);
    assertEqual(p.ammo, PISTOL.magazine);

    p.attackCooldown = 0;
    assertEqual(fire(), true, 'can fire again after reloading');
  });
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
      assertEqual(state.npcs[0].attackCooldown, 0.8);
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

test('combat: player slash keeps its arc, knockback, cooldown and presentation', () => {
  withCombatState(
    {
      player: makePlayer({ facing: 0 }),
      npcs: [
        makeNpc({ id: 1, x: 30, y: 0, hp: 100, maxHp: 100 }),
        makeNpc({ id: 2, x: -30, y: 0, hp: 100, maxHp: 100 }),
      ],
    },
    ({ events }) => {
      performKnifeSlash();
      const front = state.npcs.find((n) => n.id === 1);
      const behind = state.npcs.find((n) => n.id === 2);
      assert(front.hp < 100, `front target should be hit, hp=${front.hp}`);
      assertEqual(behind.hp, 100);
      assertEqual(front.x, 40, 'knockback must stay at 10');
      assertEqual(state.player.attackCooldown, 0.8);
      assertEqual(state.player.slashAnimTimer, 0.18);

      const hit = eventsOf(events, 'unit:damaged')[0];
      assertEqual(hit.payload.textColor, '#fbbf24');
      assertEqual(hit.payload.suffix, '');
      const slash = eventsOf(events, 'slash:performed')[0];
      assertEqual(slash.payload.color, '#f43f5e');
      assertEqual(slash.payload.arc, SLASH.humanBoss.arc);
      assertEqual(slash.payload.hitCount, 1);
      assertEqual(slash.payload.isPlayer, true);
    }
  );
});

test('combat: remote faction slash uses the shared human arc, never the back', () => {
  withCombatState(
    {
      player: makePlayer({ x: 1000, y: 0 }),
      npcs: [
        makeNpc({ id: 10, rank: UnitRank.BOSS, faction: Faction.RIVAL_1, x: 0, y: 0, facing: 0 }),
        makeNpc({ id: 11, faction: Faction.RIVAL_2, x: 0, y: 35, hp: 100, maxHp: 100 }),
        makeNpc({ id: 12, faction: Faction.RIVAL_2, x: 0, y: 25, hp: 100, maxHp: 100 }),
        makeNpc({ id: 13, faction: Faction.RIVAL_2, x: 30, y: 0, hp: 100, maxHp: 100 }),
      ],
    },
    ({ events }) => {
      executeBossSlashForFaction(Faction.RIVAL_1);
      const boss = state.npcs.find((n) => n.id === 10);
      assertEqual(state.npcs.find((n) => n.id === 11).hp, 100, '90deg at range 35 is outside the human arc');
      assertEqual(state.npcs.find((n) => n.id === 12).hp, 100, 'range 25 is still behind the arc');
      assert(state.npcs.find((n) => n.id === 13).hp < 100, 'in-front target at range 30 is hit');
      assertEqual(boss.attackCooldown, 0.8);
      assertEqual(eventsOf(events, 'unit:damaged').length, 1);
      const hit = eventsOf(events, 'unit:damaged')[0];
      assertEqual(hit.payload.textColor, FACTION_META[Faction.RIVAL_1].accent);
      assertEqual(hit.payload.suffix, '');
      const slash = eventsOf(events, 'slash:performed')[0];
      assertEqual(slash.payload.color, FACTION_META[Faction.RIVAL_1].accent);
      assertEqual(slash.payload.hitCount, 1);
      assertEqual(slash.payload.isPlayer, false);
    }
  );
});

test('combat: local and remote humans use identical slash rules', () => {
  const angle = (78 * Math.PI) / 180;
  const targetX = Math.cos(angle) * 40;
  const targetY = Math.sin(angle) * 40;

  withCombatState(
    {
      player: makePlayer({ facing: 0 }),
      npcs: [makeNpc({ x: targetX, y: targetY, hp: 100, maxHp: 100 })],
    },
    ({ events }) => {
      performKnifeSlash();
      assertEqual(state.npcs[0].hp, 100, 'local human must miss at 78deg and range 40');
      assertEqual(state.player.attackCooldown, 0.8);
      assertEqual(eventsOf(events, 'slash:performed')[0].payload.hitCount, 0);
    }
  );

  withCombatState(
    {
      player: makePlayer({ x: 1000, y: 0 }),
      npcs: [
        makeNpc({ id: 1, rank: UnitRank.BOSS, faction: Faction.RIVAL_1, x: 0, y: 0, facing: 0 }),
        makeNpc({ id: 2, faction: Faction.RIVAL_2, x: targetX, y: targetY, hp: 100, maxHp: 100 }),
      ],
    },
    ({ events }) => {
      executeBossSlashForFaction(Faction.RIVAL_1);
      assertEqual(state.npcs.find((n) => n.id === 2).hp, 100, 'remote human must miss at the same angle');
      assertEqual(state.npcs.find((n) => n.id === 1).attackCooldown, 0.8);
      assertEqual(eventsOf(events, 'slash:performed')[0].payload.hitCount, 0);
    }
  );
});

test('combat: underboss cleaves 3, captain 2 and soldier 1 in one swing', () => {
  const cases = [
    [UnitRank.UNDERBOSS, 3],
    [UnitRank.CAPTAIN, 2],
    [UnitRank.SOLDIER, 1],
  ];
  for (const [rank, expectedHits] of cases) {
    withCombatState(
      {
        player: makePlayer({ x: 1000, y: 1000 }),
        npcs: [
          makeNpc({ id: 100, rank, faction: Faction.RIVAL_1, x: 0, y: 0, facing: 0 }),
          makeNpc({ id: 101, faction: Faction.RIVAL_2, x: 20, y: 0, hp: 100, maxHp: 100 }),
          makeNpc({ id: 102, faction: Faction.RIVAL_2, x: 22, y: 0, hp: 100, maxHp: 100 }),
          makeNpc({ id: 103, faction: Faction.RIVAL_2, x: 24, y: 0, hp: 100, maxHp: 100 }),
        ],
      },
      () => {
        const attacker = state.npcs.find((n) => n.id === 100);
        performSlash(attacker, { profile: SLASH.aiMeleeByRank[rank] });
        const hits = state.npcs.filter((n) => n.id > 100 && n.hp < 100).length;
        assertEqual(hits, expectedHits, `${rank} should hit ${expectedHits} target(s)`);
      }
    );
  }
});

test('combat: crew slash arcs narrow by tier', () => {
  function targetHits(rank, degrees) {
    const angle = (degrees * Math.PI) / 180;
    let hit = null;
    withCombatState(
      {
        player: makePlayer({ x: 1000, y: 1000 }),
        npcs: [
          makeNpc({ id: 100, rank, faction: Faction.RIVAL_1, x: 0, y: 0, facing: 0 }),
          makeNpc({
            id: 101,
            faction: Faction.RIVAL_2,
            x: Math.cos(angle) * 20,
            y: Math.sin(angle) * 20,
            hp: 100,
            maxHp: 100,
          }),
        ],
      },
      () => {
        const attacker = state.npcs.find((n) => n.id === 100);
        const target = state.npcs.find((n) => n.id === 101);
        performSlash(attacker, {
          profile: SLASH.aiMeleeByRank[rank],
          targets: [target],
        });
        hit = target.hp < 100;
      }
    );
    return hit;
  }

  assertEqual(targetHits(UnitRank.UNDERBOSS, 55), true, '120° cone hits at 55°');
  assertEqual(targetHits(UnitRank.CAPTAIN, 55), false, '100° cone misses at 55°');
  assertEqual(targetHits(UnitRank.SOLDIER, 55), false, '90° cone misses at 55°');
  assertEqual(targetHits(UnitRank.SOLDIER, 40), true, '90° cone hits at 40°');
});

test('combat: AI boss slash faces a target inside the arc and uses the knife suffix', () => {
  withCombatState(
    {
      player: makePlayer({ x: 1000, y: 0 }),
      npcs: [
        makeNpc({ id: 20, rank: UnitRank.BOSS, faction: Faction.RIVAL_1, x: 0, y: 0, facing: 0 }),
        makeNpc({ id: 21, faction: Faction.RIVAL_2, x: 25, y: 25, hp: 100, maxHp: 100 }),
      ],
    },
    ({ events }) => {
      const boss = state.npcs.find((n) => n.id === 20);
      assertEqual(performBossKnifeSlash(boss), true);
      const target = state.npcs.find((n) => n.id === 21);
      assert(target.hp < 100, `AI boss should hit its target, hp=${target.hp}`);
      assertEqual(boss.facing, Math.PI / 4);
      assertEqual(boss.attackCooldown, 0.8);

      const hit = eventsOf(events, 'unit:damaged')[0];
      assertEqual(hit.payload.textColor, FACTION_META[Faction.RIVAL_1].accent);
      assertEqual(hit.payload.suffix, '🔪');
      const slash = eventsOf(events, 'slash:performed')[0];
      assertEqual(slash.payload.hitCount, 1);
      assertEqual(slash.payload.isPlayer, false);
    }
  );
});

test('combat: AI boss slash with no target still starts cooldown and stays silent', () => {
  withCombatState(
    {
      player: makePlayer({ alive: false }),
      npcs: [makeNpc({ id: 30, rank: UnitRank.BOSS, faction: Faction.RIVAL_1, x: 0, y: 0 })],
    },
    ({ events }) => {
      const boss = state.npcs[0];
      assertEqual(performBossKnifeSlash(boss), false);
      assertEqual(boss.attackCooldown, 0.8);
      assertEqual(eventsOf(events, 'slash:performed').length, 0);
    }
  );
});

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
import { runtime } from '../src/core/runtime.js';
import { isSoundEnabled, setSoundEnabled } from '../src/audio/engine.js';
import { bloodParticles, bulletTracers, shellCasings, resetEffects } from '../src/render/effects.js';
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

  const calls = { toast: [], hud: 0, defeat: 0, eliminated: [], victory: [] };
  const original = {
    showToast: runtime.showToast,
    updateHUD: runtime.updateHUD,
    onDefeat: runtime.onDefeat,
    onFactionEliminated: runtime.onFactionEliminated,
    onVictory: runtime.onVictory,
  };
  runtime.showToast = (msg) => calls.toast.push(msg);
  runtime.updateHUD = () => {
    calls.hud++;
  };
  runtime.onDefeat = () => {
    calls.defeat++;
  };
  runtime.onFactionEliminated = (faction) => calls.eliminated.push(faction);
  runtime.onVictory = (summary) => calls.victory.push(summary);

  const sound = isSoundEnabled();
  setSoundEnabled(false);

  try {
    return fn({ calls });
  } finally {
    setSoundEnabled(sound);
    runtime.showToast = original.showToast;
    runtime.updateHUD = original.updateHUD;
    runtime.onDefeat = original.onDefeat;
    runtime.onFactionEliminated = original.onFactionEliminated;
    runtime.onVictory = original.onVictory;
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

test('combat: armor absorbs damage before HP', () => {
  withCombatState({}, () => {
    const target = makeNpc({ hp: 100, maxHp: 100, armor: 50, maxArmor: 50 });
    state.npcs = [target];
    assertEqual(applyDamageToNpc(target, 30), false);
    assertEqual(target.armor, 20);
    assertEqual(target.hp, 100);
    assertEqual(applyDamageToNpc(target, 30), false);
    assertEqual(target.armor, 0);
    assertEqual(target.hp, 90);
    assert(state.floatingTexts.length > 0);
  });
});

test('combat: lethal damage removes the unit and spawns gore', () => {
  withCombatState({}, () => {
    const target = makeNpc({ hp: 10, x: 0, y: 0 });
    state.npcs = [target];
    assertEqual(applyDamageToNpc(target, 50), true);
    assertEqual(state.npcs.length, 0);
    assert(bloodParticles.length > 0);
  });
});

test('combat: killing a boss eliminates the syndicate', () => {
  withCombatState({}, ({ calls }) => {
    const boss = makeNpc({ rank: UnitRank.BOSS, hp: 10, x: 0, y: 0 });
    state.npcs = [boss];
    assertEqual(applyDamageToNpc(boss, 20), true);
    assertEqual(state.factionAlive[Faction.RIVAL_1], false);
    assertEqual(calls.eliminated.length, 1);
    assertEqual(calls.eliminated[0], Faction.RIVAL_1);
    assertEqual(calls.victory.length, 0);
  });
});

test('combat: boss damage is absorbed by armor and death is a defeat', () => {
  withCombatState({ player: makePlayer({ armor: 100 }) }, ({ calls }) => {
    damagePlayerBoss(40);
    assertEqual(state.player.armor, 60);
    assertEqual(state.player.hp, BOSS_MAX_HP);
    damagePlayerBoss(500);
    assertEqual(state.player.alive, false);
    assertEqual(state.gameOver, true);
    assertEqual(calls.defeat, 1);
  });
});

test('combat: buying armor charges once and starts a cooldown', () => {
  withCombatState({ treasuries: { [Faction.PLAYER]: COST_BOSS_ARMOR } }, () => {
    assertEqual(executeBuyArmorForFaction(Faction.PLAYER), true);
    assertEqual(state.treasuries[Faction.PLAYER], 0);
    assertEqual(state.player.armor, MAX_BOSS_ARMOR);
    assertEqual(state.player.armorCooldown, state.tickDuration);
    assertEqual(executeBuyArmorForFaction(Faction.PLAYER), false);
  });
});

test('combat: rival bosses can buy armor from their treasury', () => {
  withCombatState(
    {
      npcs: [makeNpc({ rank: UnitRank.BOSS, faction: Faction.RIVAL_1, x: 0, y: 0 })],
      treasuries: { [Faction.RIVAL_1]: COST_BOSS_ARMOR },
    },
    () => {
      const boss = state.npcs[0];
      assertEqual(executeBuyArmorForFaction(Faction.RIVAL_1), true);
      assertEqual(boss.armor, MAX_BOSS_ARMOR);
      assertEqual(boss.armorCooldown, state.tickDuration);
      assertEqual(state.treasuries[Faction.RIVAL_1], 0);
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
  withCombatState({ treasuries: { [Faction.PLAYER]: 100 } }, ({ calls }) => {
    buyBossArmor();
    assert(calls.toast.some((msg) => msg.includes('Need $3,500')), calls.toast.join(' | '));
  });
  withCombatState({ treasuries: { [Faction.PLAYER]: COST_BOSS_ARMOR }, player: makePlayer({ armor: 300, maxArmor: 300 }) }, ({ calls }) => {
    buyBossArmor();
    assert(calls.toast.some((msg) => msg.includes('already at full capacity')), calls.toast.join(' | '));
  });
  withCombatState({ treasuries: { [Faction.PLAYER]: COST_BOSS_ARMOR } }, ({ calls }) => {
    buyBossArmor();
    assert(calls.toast.some((msg) => msg.includes('Equipped Kevlar Armor')), calls.toast.join(' | '));
    assertEqual(calls.hud, 1);
  });
});

test('combat: NPC boss armor logic reacts to wounds, threats and cooldowns', () => {
  withCombatState({ treasuries: { [Faction.RIVAL_1]: COST_BOSS_ARMOR } }, () => {
    const boss = makeNpc({ rank: UnitRank.BOSS, armor: 0, hp: 480, maxHp: 480 });
    state.npcs = [boss];
    assertEqual(tryBuyNpcBossArmor(boss, 0, 0), true);
    assertEqual(boss.armor, MAX_BOSS_ARMOR);
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
    () => {
      const npc = state.npcs[0];
      performKnifeSlash();
      assert(npc.hp < 100, `npc should be hit, hp=${npc.hp}`);
      assertEqual(state.player.attackCooldown, 0.34);
      const hp = npc.hp;
      performKnifeSlash();
      assertEqual(npc.hp, hp, 'second slash during cooldown must not hit');
    }
  );
});

test('combat: player slash ignores targets out of reach', () => {
  withCombatState(
    { player: makePlayer({ facing: 0 }), npcs: [makeNpc({ x: 200, y: 0, hp: 100, maxHp: 100 })] },
    () => {
      performKnifeSlash();
      assertEqual(state.npcs[0].hp, 100);
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
    () => {
      const shooter = state.npcs[0];
      assertEqual(performBossPistolShot(shooter, false, 200, 0), true);
      assert(state.player.hp < BOSS_MAX_HP);
      assertEqual(shooter.attackCooldown, UNIT_ATTACK_COOLDOWN);
      assertEqual(bulletTracers.length, 1);
      assertEqual(shellCasings.length, 1);
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
    () => {
      performBossPistolShot(state.npcs[0], false, 200, 0);
      assertEqual(state.player.hp, BOSS_MAX_HP);
    }
  );
});

test('combat: player pistol fires faster and damages rival units', () => {
  withCombatState(
    {
      player: makePlayer({ x: 0, y: 0 }),
      npcs: [makeNpc({ x: 200, y: 0, hp: 100, maxHp: 100 })],
    },
    () => {
      const target = state.npcs[0];
      assertEqual(performBossPistolShot(state.player, true, 200, 0), true);
      assert(target.hp < 100);
      assertEqual(state.player.attackCooldown, 0.65);
    }
  );
});

test('combat: faction slash delegates to boss melee and triggers the player path', () => {
  withCombatState(
    {
      player: makePlayer({ x: 30, y: 0 }),
      npcs: [makeNpc({ rank: UnitRank.BOSS, faction: Faction.RIVAL_1, x: 0, y: 0, facing: 0 })],
    },
    () => {
      executeBossSlashForFaction(Faction.RIVAL_1);
      assert(state.player.hp < BOSS_MAX_HP);
      assertEqual(state.npcs[0].attackCooldown, 0.34);
    }
  );
  withCombatState({ player: makePlayer({ facing: 0 }), npcs: [makeNpc({ x: 30, y: 0, hp: 100, maxHp: 100 })] }, () => {
    executeBossSlashForFaction(Faction.PLAYER);
    assert(state.npcs[0].hp < 100);
  });
});

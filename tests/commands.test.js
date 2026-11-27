// Command dispatch tests: local and remote actions share one sim entry point.
import { test, assert, assertEqual } from './harness.js';
import { Faction, UnitRank, PropType } from '../src/config/enums.js';
import { CHUNK_SIZE } from '../src/config/constants.js';
import { state } from '../src/core/state.js';
import { dispatchCommand } from '../src/sim/commands.js';
import { sendOrDispatchCommand } from '../src/ui/commandBridge.js';

function withFixedRandom(value, fn) {
  const original = Math.random;
  Math.random = () => value;
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

const STATE_KEYS = [
  'world',
  'player',
  'npcs',
  'spatialBuckets',
  'treasuries',
  'factionAlive',
  'activeFactions',
  'currentGridSize',
  'tickDuration',
  'gameStarted',
  'gameOver',
  'net',
  'autoRecruitSoldier',
  'autoRecruitCaptain',
  'autoRecruitUnderboss',
  'playerSpawnCaps',
  'factionRecruitmentPrefs',
  'matchUnitCaps',
];

function makeWorld() {
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
    isWalkable: () => true,
    worldToTile: () => ({ cx: 0, cy: 0, lx: 0, ly: 0 }),
    getChunk: () => chunk,
    chunks: new Map([['0,0', chunk]]),
    findNearestWalkablePoint: (x, y) => ({ x, y }),
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
    speed: 225,
    hp: 400,
    maxHp: 400,
    armor: 0,
    maxArmor: 300,
    minDmg: 20,
    maxDmg: 40,
    facing: 0,
    alive: true,
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

function makeBoss(overrides = {}) {
  return {
    id: 1,
    faction: Faction.RIVAL_1,
    rank: UnitRank.BOSS,
    humanPeerId: null,
    x: 100,
    y: 100,
    bodyRadius: 13.5,
    speed: 225,
    hp: 400,
    maxHp: 400,
    armor: 0,
    maxArmor: 300,
    minDmg: 20,
    maxDmg: 40,
    facing: 0,
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

function withCommandState(opts, fn) {
  const saved = {};
  for (const key of STATE_KEYS) saved[key] = state[key];

  state.world = opts.world || makeWorld();
  state.player = opts.player || makePlayer();
  state.npcs = opts.npcs || [];
  state.spatialBuckets = new Map();
  state.treasuries = { ...saved.treasuries, ...(opts.treasuries || {}) };
  state.factionAlive = { ...saved.factionAlive, ...(opts.factionAlive || {}) };
  state.activeFactions = [Faction.PLAYER, Faction.RIVAL_1, Faction.RIVAL_2, Faction.RIVAL_3];
  state.currentGridSize = 15;
  state.tickDuration = 10;
  state.gameStarted = true;
  state.gameOver = false;
  state.net = opts.net || null;
  state.autoRecruitSoldier = true;
  state.autoRecruitCaptain = true;
  state.autoRecruitUnderboss = true;
  state.playerSpawnCaps = { ...saved.playerSpawnCaps, ...(opts.playerSpawnCaps || {}) };
  state.factionRecruitmentPrefs = JSON.parse(JSON.stringify(saved.factionRecruitmentPrefs));
  state.matchUnitCaps = opts.matchUnitCaps ? { ...opts.matchUnitCaps } : null;

  try {
    return fn();
  } finally {
    for (const key of STATE_KEYS) state[key] = saved[key];
  }
}

test('commands: MOVE_TO routes the player and a remote faction boss', () => {
  withCommandState({ npcs: [makeBoss()] }, () => {
    state.player.path = [{ x: 999, y: 999 }];
    state.player.pathTimer = 0.8;
    assertEqual(dispatchCommand(Faction.PLAYER, { cmd: 'MOVE_TO', x: 40, y: 50 }), true);
    assertEqual(state.player.targetX, 40);
    assertEqual(state.player.targetY, 50);
    assertEqual(state.player.path, null);
    assertEqual(state.player.pathTimer, 0);

    state.npcs[0].path = [{ x: 999, y: 999 }];
    state.npcs[0].pathTimer = 0.8;
    assertEqual(dispatchCommand(Faction.RIVAL_1, { cmd: 'MOVE_TO', x: 60, y: 70 }), true);
    assertEqual(state.npcs[0].targetX, 60);
    assertEqual(state.npcs[0].targetY, 70);
    assertEqual(state.npcs[0].path, null);
    assertEqual(state.npcs[0].pathTimer, 0);
  });
});

test('commands: SLASH routes through the player and remote boss paths', () => {
  withCommandState(
    { npcs: [makeBoss({ faction: Faction.RIVAL_2, x: 30, y: 0, hp: 100, maxHp: 100 })] },
    () => {
      state.player.facing = 0;
      assertEqual(dispatchCommand(Faction.PLAYER, { cmd: 'SLASH' }), true);
      assert(state.npcs[0].hp < 100, `target should be slashed, hp=${state.npcs[0].hp}`);
      assertEqual(state.player.attackCooldown, 0.8);
    }
  );

  withCommandState(
    { player: makePlayer({ x: 30, y: 0 }), npcs: [makeBoss({ x: 0, y: 0, facing: 0 })] },
    () => {
      assertEqual(dispatchCommand(Faction.RIVAL_1, { cmd: 'SLASH' }), true);
      assert(state.player.hp < 400, `player should be slashed, hp=${state.player.hp}`);
      assertEqual(state.npcs[0].attackCooldown, 0.8);
    }
  );
});

test('commands: SHOOT routes the player and a remote faction boss', () => {
  withCommandState(
    { npcs: [makeBoss({ faction: Faction.RIVAL_2, x: 200, y: 0, hp: 100, maxHp: 100 })] },
    () => {
      withFixedRandom(0.99, () => {
        assertEqual(dispatchCommand(Faction.PLAYER, { cmd: 'SHOOT', tx: 200, ty: 0 }), true);
      });
      assert(state.npcs[0].hp < 100, `target should be shot, hp=${state.npcs[0].hp}`);
      assertEqual(state.player.attackCooldown, 0.2);
    }
  );

  withCommandState(
    { player: makePlayer({ x: 200, y: 0 }), npcs: [makeBoss({ x: 0, y: 0, humanPeerId: 'peer' })] },
    () => {
      withFixedRandom(0.99, () => {
        assertEqual(dispatchCommand(Faction.RIVAL_1, { cmd: 'SHOOT', tx: 200, ty: 0 }), true);
      });
      assert(state.player.hp < 400, `player should be shot, hp=${state.player.hp}`);
      assertEqual(state.npcs[0].attackCooldown, 0.2);
    }
  );
});

test('commands: BUY_ARMOR charges the player and remote factions', () => {
  withCommandState({ treasuries: { [Faction.PLAYER]: 3500 } }, () => {
    assertEqual(dispatchCommand(Faction.PLAYER, { cmd: 'BUY_ARMOR' }), true);
    assertEqual(state.player.armor, 300);
    assertEqual(state.treasuries[Faction.PLAYER], 0);
  });

  withCommandState({ treasuries: { [Faction.RIVAL_1]: 3500 }, npcs: [makeBoss()] }, () => {
    assertEqual(dispatchCommand(Faction.RIVAL_1, { cmd: 'BUY_ARMOR' }), true);
    assertEqual(state.npcs[0].armor, 300);
    assertEqual(state.treasuries[Faction.RIVAL_1], 0);
  });
});

test('commands: RECRUIT_PREF updates the player caps and remote faction prefs', () => {
  withCommandState({}, () => {
    const caps = {
      [UnitRank.SOLDIER]: 999,
      [UnitRank.CAPTAIN]: 999,
      [UnitRank.UNDERBOSS]: 999,
    };
    assertEqual(
      dispatchCommand(Faction.PLAYER, {
        cmd: 'RECRUIT_PREF',
        autoSoldier: false,
        autoCaptain: false,
        autoUnderboss: false,
        caps,
      }),
      true
    );
    assertEqual(state.autoRecruitSoldier, false);
    assertEqual(state.autoRecruitCaptain, false);
    assertEqual(state.autoRecruitUnderboss, false);
    // The test world has one chunk, so the 5x5 minimum grid applies: 50 soldiers, 10 captains, 5 underbosses.
    assertEqual(state.playerSpawnCaps[UnitRank.SOLDIER], 50);
    assertEqual(state.playerSpawnCaps[UnitRank.CAPTAIN], 10);
    assertEqual(state.playerSpawnCaps[UnitRank.UNDERBOSS], 5);

    assertEqual(
      dispatchCommand(Faction.RIVAL_1, {
        cmd: 'RECRUIT_PREF',
        autoSoldier: false,
        autoCaptain: true,
        autoUnderboss: false,
        caps: {
          [UnitRank.SOLDIER]: 999,
          [UnitRank.CAPTAIN]: 999,
          [UnitRank.UNDERBOSS]: 999,
        },
      }),
      true
    );
    const prefs = state.factionRecruitmentPrefs[Faction.RIVAL_1];
    assertEqual(prefs.autoSoldier, false);
    assertEqual(prefs.autoCaptain, true);
    assertEqual(prefs.autoUnderboss, false);
    assertEqual(prefs.caps[UnitRank.SOLDIER], 50);
    assertEqual(prefs.caps[UnitRank.CAPTAIN], 10);
    assertEqual(prefs.caps[UnitRank.UNDERBOSS], 5);
  });
});

test('commands: unknown or malformed payloads are ignored', () => {
  withCommandState({}, () => {
    assertEqual(dispatchCommand(Faction.PLAYER, null), false);
    assertEqual(dispatchCommand(Faction.PLAYER, { cmd: 'NOPE' }), false);
    assertEqual(dispatchCommand(Faction.PLAYER, { cmd: 'MOVE_TO', x: 1 }), false);
    assertEqual(dispatchCommand(Faction.PLAYER, { cmd: 'SHOOT', tx: 1 }), false);
  });
});

test('commands: local and remote human commands produce equivalent outcomes', () => {
  let local;
  let remote;

  withCommandState({ npcs: [makeBoss()] }, () => {
    dispatchCommand(Faction.PLAYER, { cmd: 'MOVE_TO', x: 40, y: 50 });
    local = { x: state.player.targetX, y: state.player.targetY };
  });
  withCommandState({ npcs: [makeBoss()] }, () => {
    dispatchCommand(Faction.RIVAL_1, { cmd: 'MOVE_TO', x: 40, y: 50 });
    remote = { x: state.npcs[0].targetX, y: state.npcs[0].targetY };
  });
  assertEqual(local.x, remote.x);
  assertEqual(local.y, remote.y);

  withCommandState(
    {
      player: makePlayer({ facing: 0, minDmg: 20, maxDmg: 20 }),
      npcs: [makeBoss({ faction: Faction.RIVAL_2, x: 30, y: 0, hp: 1000, maxHp: 1000 })],
    },
    () => {
      const target = state.npcs[0];
      withFixedRandom(0.99, () => {
        dispatchCommand(Faction.PLAYER, { cmd: 'SLASH' });
      });
      local = { damage: 1000 - target.hp, cooldown: state.player.attackCooldown };
    }
  );
  withCommandState(
    {
      player: makePlayer({ x: 30, y: 0, hp: 1000, maxHp: 1000 }),
      npcs: [makeBoss({ x: 0, y: 0, facing: 0, minDmg: 20, maxDmg: 20 })],
    },
    () => {
      withFixedRandom(0.99, () => {
        dispatchCommand(Faction.RIVAL_1, { cmd: 'SLASH' });
      });
      remote = { damage: 1000 - state.player.hp, cooldown: state.npcs[0].attackCooldown };
    }
  );
  assertEqual(local.damage, 20);
  assertEqual(remote.damage, 20);
  assertEqual(local.cooldown, remote.cooldown);

  withCommandState(
    { npcs: [makeBoss({ faction: Faction.RIVAL_2, x: 200, y: 0, hp: 1000, maxHp: 1000 })] },
    () => {
      const target = state.npcs[0];
      withFixedRandom(0.99, () => {
        dispatchCommand(Faction.PLAYER, { cmd: 'SHOOT', tx: 200, ty: 0 });
      });
      local = { hit: target.hp < 1000, cooldown: state.player.attackCooldown };
    }
  );
  withCommandState(
    {
      player: makePlayer({ x: 200, y: 0, hp: 1000, maxHp: 1000 }),
      npcs: [makeBoss({ x: 0, y: 0, humanPeerId: 'peer' })],
    },
    () => {
      withFixedRandom(0.99, () => {
        dispatchCommand(Faction.RIVAL_1, { cmd: 'SHOOT', tx: 200, ty: 0 });
      });
      remote = { hit: state.player.hp < 1000, cooldown: state.npcs[0].attackCooldown };
    }
  );
  assertEqual(local.hit, true);
  assertEqual(remote.hit, true);
  assertEqual(local.cooldown, 0.2);
  assertEqual(remote.cooldown, 0.2);

  withCommandState({ treasuries: { [Faction.PLAYER]: 3500 } }, () => {
    dispatchCommand(Faction.PLAYER, { cmd: 'BUY_ARMOR' });
    local = { armor: state.player.armor, treasury: state.treasuries[Faction.PLAYER] };
  });
  withCommandState(
    { treasuries: { [Faction.RIVAL_1]: 3500 }, npcs: [makeBoss()] },
    () => {
      dispatchCommand(Faction.RIVAL_1, { cmd: 'BUY_ARMOR' });
      remote = { armor: state.npcs[0].armor, treasury: state.treasuries[Faction.RIVAL_1] };
    }
  );
  assertEqual(local.armor, 300);
  assertEqual(remote.armor, 300);
  assertEqual(local.treasury, remote.treasury);

  const payload = {
    cmd: 'RECRUIT_PREF',
    autoSoldier: false,
    autoCaptain: true,
    autoUnderboss: false,
    caps: { [UnitRank.SOLDIER]: 999, [UnitRank.CAPTAIN]: 999, [UnitRank.UNDERBOSS]: 999 },
  };
  withCommandState({}, () => {
    dispatchCommand(Faction.PLAYER, payload);
    local = { auto: state.autoRecruitSoldier, caps: { ...state.playerSpawnCaps } };
  });
  withCommandState({}, () => {
    dispatchCommand(Faction.RIVAL_1, payload);
    const prefs = state.factionRecruitmentPrefs[Faction.RIVAL_1];
    remote = { auto: prefs.autoSoldier, caps: { ...prefs.caps } };
  });
  assertEqual(local.auto, remote.auto);
  assertEqual(local.caps[UnitRank.SOLDIER], remote.caps[UnitRank.SOLDIER]);
  assertEqual(local.caps[UnitRank.CAPTAIN], remote.caps[UnitRank.CAPTAIN]);
  assertEqual(local.caps[UnitRank.UNDERBOSS], remote.caps[UnitRank.UNDERBOSS]);
});

test('commands: guests stream commands while local play dispatches them', () => {
  const sent = [];
  withCommandState(
    {
      net: {
        isGuest: () => true,
        isActive: () => true,
        localFaction: Faction.RIVAL_1,
        sendCommand: (payload) => sent.push(payload),
      },
    },
    () => {
      assertEqual(sendOrDispatchCommand({ cmd: 'MOVE_TO', x: 11, y: 22 }), true);
      assertEqual(sent.length, 1);
      assertEqual(sent[0].cmd, 'MOVE_TO');
      assertEqual(state.player.targetX, null);
    }
  );

  withCommandState({ net: null }, () => {
    assertEqual(sendOrDispatchCommand({ cmd: 'MOVE_TO', x: 33, y: 44 }), true);
    assertEqual(state.player.targetX, 33);
    assertEqual(state.player.targetY, 44);
  });
});

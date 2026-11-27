// AI decision tests: perception counts and patrol target selection (headless).
import { test, assert, assertEqual } from './harness.js';
import { Faction, UnitRank } from '../src/config/enums.js';
import { FACTION_META } from '../src/config/organizations.js';
import { state } from '../src/core/state.js';
import { on } from '../src/core/events.js';
import { packChunkKey } from '../src/world/city.js';
import { scanNearby, choosePatrolChunk, updateNpcAi } from '../src/sim/ai.js';

const STATE_KEYS = ['world', 'player', 'npcs', 'spatialBuckets', 'treasuries'];

function withAiState(opts, fn) {
  const saved = {};
  for (const key of STATE_KEYS) saved[key] = state[key];
  state.world = opts.world || { chunks: new Map(), getChunk: () => null };
  state.player = opts.player || { x: 100, y: 100, faction: Faction.PLAYER, alive: true };
  state.npcs = opts.npcs || [];
  state.spatialBuckets = opts.spatialBuckets || new Map();
  state.treasuries = saved.treasuries;
  if (opts.treasuries) {
    state.treasuries = { ...saved.treasuries, ...opts.treasuries };
  }
  try {
    return fn();
  } finally {
    for (const key of STATE_KEYS) state[key] = saved[key];
  }
}

function npc(overrides = {}) {
  return {
    id: 1,
    x: 130,
    y: 100,
    faction: Faction.RIVAL_1,
    rank: UnitRank.SOLDIER,
    bodyRadius: 11,
    ammo: 10,
    reloadTimer: 0,
    ...overrides,
  };
}

test('ai: scan finds the nearest enemy and counts allies/enemies', () => {
  const unit = npc();
  const ally = npc({ id: 2, x: 120, y: 100 });
  const enemyNpc = npc({ id: 3, x: 110, y: 100, faction: Faction.RIVAL_2 });
  withAiState(
    {
      npcs: [unit, ally, enemyNpc],
      spatialBuckets: new Map([[packChunkKey(0, 0), [unit, ally, enemyNpc]]]),
    },
    () => {
      const scan = scanNearby(unit);
      assertEqual(scan.nearbyAllyCount, 1);
      assertEqual(scan.nearbyEnemyCount, 2);
      assertEqual(scan.nearestEnemy.entity, enemyNpc);
      assertEqual(scan.nearestEnemy.isPlayer, false);
      assertEqual(scan.nearestEnemyDist, 20);
    }
  );
});

test('ai: a player is the nearest enemy when no rival is closer', () => {
  const unit = npc();
  withAiState(
    {
      npcs: [unit],
      spatialBuckets: new Map([[packChunkKey(0, 0), [unit]]]),
    },
    () => {
      const scan = scanNearby(unit);
      assertEqual(scan.nearestEnemy.isPlayer, true);
      assertEqual(scan.nearestEnemy.entity, state.player);
      assertEqual(scan.nearestEnemyDist, 30);
      assertEqual(scan.nearbyEnemyCount, 1);
    }
  );
});

test('ai: patrol chooses the nearest non-owned chunk in scan range', () => {
  const chunks = [
    { cx: 0, cy: 0, faction: Faction.RIVAL_1 },
    { cx: 1, cy: 0, faction: Faction.PLAYER },
    { cx: 0, cy: 1, faction: Faction.NEUTRAL },
    { cx: 2, cy: 0, faction: Faction.NEUTRAL },
  ];
  const map = new Map(chunks.map((c) => [`${c.cx},${c.cy}`, c]));
  const unit = npc();
  withAiState(
    {
      world: {
        chunks: map,
        getChunk: (cx, cy) => map.get(`${cx},${cy}`) || null,
      },
    },
    () => {
      const target = choosePatrolChunk(unit, 0, 0);
      assert(target);
      assertEqual(target.cx, 1);
      assertEqual(target.cy, 0);
    }
  );
});

test('ai: melee soldier attacks an adjacent player with accent color and full cooldown', () => {
  const unit = npc({
    id: 42,
    rank: UnitRank.SOLDIER,
    faction: Faction.RIVAL_1,
    x: 0,
    y: 0,
    hp: 180,
    maxHp: 180,
    speed: 128,
    minDmg: 10,
    maxDmg: 10,
    attackCooldown: 0,
    goalX: 0,
    goalY: 0,
    aiTimer: 1,
    pathTimer: 1,
    dodgeDir: 1,
  });
  const player = {
    id: 0,
    faction: Faction.PLAYER,
    rank: UnitRank.BOSS,
    control: 'local',
    bodyRadius: 13.5,
    x: 10,
    y: 0,
    hp: 400,
    maxHp: 400,
    armor: 0,
    alive: true,
    facing: 0,
    hitFlashTimer: 0,
  };
  const events = [];
  const unsubscribe = on('slash:performed', (payload) => events.push({ type: 'slash:performed', payload }));
  const unsubscribeHit = on('unit:damaged', (payload) => events.push({ type: 'unit:damaged', payload }));
  try {
    withAiState(
      {
        world: { chunks: new Map(), worldToTile: () => ({ cx: 0, cy: 0 }), getChunk: () => null },
        player,
        npcs: [unit],
        spatialBuckets: new Map(),
      },
      () => {
        updateNpcAi(unit, 0.016);
        assert(state.player.hp < 400, `player should be slashed, hp=${state.player.hp}`);
        assertEqual(unit.attackCooldown, 1.5);
        assertEqual(unit.slashAnimTimer, 0.18);
        assertEqual(events.length, 2);
        assertEqual(events[0].type, 'slash:performed');
        assertEqual(events[0].payload.color, FACTION_META[Faction.RIVAL_1].accent);
        assertEqual(events[0].payload.hitCount, 1);
        assertEqual(events[1].type, 'unit:damaged');
        assertEqual(events[1].payload.textColor, FACTION_META[Faction.RIVAL_1].accent);
        assertEqual(events[1].payload.suffix, '');
      }
    );
  } finally {
    unsubscribe();
    unsubscribeHit();
  }
});

function pistolTestWorld() {
  return {
    chunks: new Map(),
    isWalkable: () => true,
    isTileNavigable: () => true,
    canMoveTo: () => true,
    worldToTile: () => ({ cx: 0, cy: 0, lx: 0, ly: 0 }),
    getChunk: () => ({
      faction: Faction.NEUTRAL,
      props: [[0]],
      propVertical: [[0]],
      propCurbSide: [[0]],
    }),
    findNearestWalkablePoint: (x, y) => ({ x, y }),
  };
}

function walledPistolTestWorld() {
  return { ...pistolTestWorld(), isWalkable: (x) => x >= 100 };
}

function pistolTestPlayer(overrides = {}) {
  return {
    id: 0,
    faction: Faction.PLAYER,
    rank: UnitRank.BOSS,
    control: 'local',
    bodyRadius: 13.5,
    x: 200,
    y: 0,
    hp: 400,
    maxHp: 400,
    armor: 0,
    alive: true,
    facing: 0,
    hitFlashTimer: 0,
    ...overrides,
  };
}

function remoteUnit(rank, id = 42) {
  return npc({
    id,
    rank,
    x: 0,
    y: 0,
    hp: 180,
    maxHp: 180,
    attackCooldown: 0,
    aiTimer: 1,
    pathTimer: 1,
    goalX: 0,
    goalY: 0,
    dodgeDir: 1,
  });
}

function madeBoss(overrides = {}) {
  const boss = remoteUnit(UnitRank.BOSS, 80);
  return Object.assign(boss, {
    x: 500,
    y: 500,
    hp: 800,
    maxHp: 800,
    armor: 300,
    maxArmor: 300,
    armorCooldown: 0,
    bodyRadius: 13.5,
    speed: 140,
    facing: 0,
    sprintTimer: 0,
    sprintCooldown: 0,
    isSprinting: false,
    ...overrides,
  });
}

test('ai: only bosses and underbosses fire the pistol', () => {
  for (const rank of [UnitRank.BOSS, UnitRank.UNDERBOSS]) {
    const unit = remoteUnit(rank);
    withAiState(
      {
        world: pistolTestWorld(),
        player: pistolTestPlayer(),
        npcs: [unit],
        spatialBuckets: new Map([[packChunkKey(0, 0), [unit]]]),
      },
      () => {
        updateNpcAi(unit, 0.016);
        assertEqual(unit.ammo, 9, `${rank} should spend one round`);
        assertEqual(unit.attackCooldown, 0.2, `${rank} should start the fire cadence`);
      }
    );
  }

  for (const rank of [UnitRank.CAPTAIN, UnitRank.SOLDIER]) {
    const unit = remoteUnit(rank);
    withAiState(
      {
        world: pistolTestWorld(),
        player: pistolTestPlayer(),
        npcs: [unit],
        spatialBuckets: new Map([[packChunkKey(0, 0), [unit]]]),
      },
      () => {
        updateNpcAi(unit, 0.016);
        assertEqual(unit.ammo, 10, `${rank} must not fire`);
        assertEqual(unit.attackCooldown, 0, `${rank} must not start a shot cooldown`);
        assertEqual(state.player.hp, 400, `${rank} must not damage the player at range`);
      }
    );
  }

  const blocked = remoteUnit(UnitRank.UNDERBOSS, 44);
  withAiState(
    {
      world: walledPistolTestWorld(),
      player: pistolTestPlayer(),
      npcs: [blocked],
      spatialBuckets: new Map([[packChunkKey(0, 0), [blocked]]]),
    },
    () => {
      updateNpcAi(blocked, 0.016);
      assertEqual(blocked.ammo, 10, 'a building between shooter and target must block the shot');
      assertEqual(blocked.attackCooldown, 0, 'blocked line of sight must not start a cooldown');
      assertEqual(state.player.hp, 400, 'blocked line of sight must not damage the player');
    }
  );
});

test('ai: shooters hold fire when an ally is in the bullet path', () => {
  const shooter = remoteUnit(UnitRank.UNDERBOSS, 60);
  const ally = remoteUnit(UnitRank.SOLDIER, 61);
  ally.x = 100;
  ally.y = 0;
  withAiState(
    {
      world: pistolTestWorld(),
      player: pistolTestPlayer(),
      npcs: [shooter, ally],
      spatialBuckets: new Map([[packChunkKey(0, 0), [shooter, ally]]]),
    },
    () => {
      updateNpcAi(shooter, 0.016);
      assertEqual(shooter.ammo, 10, 'ally in the path must block the shot');
      assertEqual(shooter.attackCooldown, 0, 'blocked friendly fire must not start a cooldown');
      assertEqual(state.player.hp, 400, 'no damage should be dealt');
    }
  );

  const shooter2 = remoteUnit(UnitRank.UNDERBOSS, 62);
  const allyBehind = remoteUnit(UnitRank.SOLDIER, 63);
  allyBehind.x = 260;
  allyBehind.y = 0;
  withAiState(
    {
      world: pistolTestWorld(),
      player: pistolTestPlayer(),
      npcs: [shooter2, allyBehind],
      spatialBuckets: new Map([[packChunkKey(0, 0), [shooter2, allyBehind]]]),
    },
    () => {
      updateNpcAi(shooter2, 0.016);
      assertEqual(shooter2.ammo, 9, 'ally behind the target does not block the shot');
      assertEqual(shooter2.attackCooldown, 0.2);
    }
  );
});

test('ai: wounded unarmored bosses sprint away instead of suiciding', () => {
  const boss = madeBoss({ hp: 100, armor: 0, armorCooldown: 0, speed: 140 });
  withAiState(
    {
      world: pistolTestWorld(),
      player: pistolTestPlayer({ x: 600, y: 500 }),
      npcs: [boss],
      spatialBuckets: new Map([[packChunkKey(0, 0), [boss]]]),
      treasuries: { [Faction.RIVAL_1]: 0 },
    },
    () => {
      updateNpcAi(boss, 0.016);
      assert(boss.retreatTimer > 0, 'wounded unarmored boss should commit to a retreat');
      assert(boss.goalX < boss.x, `retreat goal should move away from the player, goalX=${boss.goalX}`);
      assertEqual(boss.isSprinting, true, 'retreat should use the sprint burst');
    }
  );
});

test('ai: outnumbered unarmored bosses retreat even at full HP', () => {
  const boss = madeBoss({ hp: 800, armor: 0, armorCooldown: 0 });
  const squad = [
    remoteUnit(UnitRank.SOLDIER, 81),
    remoteUnit(UnitRank.SOLDIER, 82),
  ];
  squad[0].faction = Faction.RIVAL_2;
  squad[0].x = 600;
  squad[0].y = 480;
  squad[1].faction = Faction.RIVAL_2;
  squad[1].x = 600;
  squad[1].y = 520;
  withAiState(
    {
      world: pistolTestWorld(),
      player: pistolTestPlayer({ x: 600, y: 500 }),
      npcs: [boss, ...squad],
      spatialBuckets: new Map([[packChunkKey(0, 0), [boss, ...squad]]]),
      treasuries: { [Faction.RIVAL_1]: 0 },
    },
    () => {
      updateNpcAi(boss, 0.016);
      assert(boss.retreatTimer > 0, 'outnumbered unarmored boss should retreat');
      assertEqual(boss.isSprinting, true);
    }
  );
});

test('ai: bosses buy armor before retreating when they can afford it', () => {
  const boss = madeBoss({ hp: 100, armor: 0, armorCooldown: 0 });
  withAiState(
    {
      world: pistolTestWorld(),
      player: pistolTestPlayer({ x: 600, y: 500 }),
      npcs: [boss],
      spatialBuckets: new Map([[packChunkKey(0, 0), [boss]]]),
      treasuries: { [Faction.RIVAL_1]: 4000 },
    },
    () => {
      updateNpcAi(boss, 0.016);
      assertEqual(boss.armor, 300, 'boss should refresh armor when threatened');
      assertEqual(boss.retreatTimer, 0, 'armored boss should not abandon the fight');
    }
  );
});

test('ai: pistol shooters sidestep when an ally blocks the line of fire', () => {
  const shooter = remoteUnit(UnitRank.UNDERBOSS, 90);
  shooter.speed = 150;
  shooter.facing = 0;
  const ally = remoteUnit(UnitRank.SOLDIER, 91);
  ally.x = 100;
  ally.y = 0;
  withAiState(
    {
      world: pistolTestWorld(),
      player: pistolTestPlayer(),
      npcs: [shooter, ally],
      spatialBuckets: new Map([[packChunkKey(0, 0), [shooter, ally]]]),
    },
    () => {
      updateNpcAi(shooter, 0.016);
      assertEqual(shooter.ammo, 10, 'blocked shooter must not spend a round');
      assert(shooter.flankTimer > 0, 'blocked shooter should commit to a sidestep');
      assert(Math.abs(shooter.goalY) > 30, `sidestep should leave the firing line, goalY=${shooter.goalY}`);

      ally.x = 260;
      ally.y = 0;
      updateNpcAi(shooter, 0.016);
      assertEqual(shooter.ammo, 9, 'shooter should fire once the lane is clear');
    }
  );
});

test('ai: close-range knife attacks ignore intervening allies', () => {
  const shooter = remoteUnit(UnitRank.UNDERBOSS, 92);
  shooter.speed = 150;
  shooter.minDmg = 25;
  shooter.maxDmg = 35;
  const ally = remoteUnit(UnitRank.SOLDIER, 93);
  ally.x = 20;
  ally.y = 0;
  withAiState(
    {
      world: pistolTestWorld(),
      player: pistolTestPlayer({ x: 40, y: 0 }),
      npcs: [shooter, ally],
      spatialBuckets: new Map([[packChunkKey(0, 0), [shooter, ally]]]),
    },
    () => {
      updateNpcAi(shooter, 0.016);
      assert(state.player.hp < 400, `knife should still hit the enemy, hp=${state.player.hp}`);
      assertEqual(ally.hp, 180, 'knife must not damage the ally');
    }
  );
});

test('ai: patrol falls back to any non-owned chunk', () => {
  const chunks = [
    { cx: 0, cy: 0, faction: Faction.RIVAL_1 },
    { cx: 20, cy: 20, faction: Faction.NEUTRAL },
  ];
  const map = new Map(chunks.map((c) => [`${c.cx},${c.cy}`, c]));
  const unit = npc();
  withAiState(
    {
      world: {
        chunks: map,
        getChunk: (cx, cy) => map.get(`${cx},${cy}`) || null,
      },
    },
    () => {
      const target = choosePatrolChunk(unit, 0, 0);
      assertEqual(target.cx, 20);
      assertEqual(target.cy, 20);
    }
  );
});

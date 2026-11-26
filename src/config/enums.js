// Shared enums. Values are stable identifiers (strings/numbers) and must stay
// unchanged while the multiplayer protocol still serializes them.

export const TileType = {
  ASPHALT: 0,
  SIDEWALK: 1,
  BUILDING: 2,
  ALLEY: 3,
  PLAZA: 4,
};

export const PropType = {
  NONE: 0,
  STREETLIGHT: 1,
  HYDRANT: 2,
  CAR: 3,
  DUMPSTER: 4,
  TREE: 5,
};

export const Faction = {
  NEUTRAL: 'NEUTRAL',
  PLAYER: 'PLAYER',
  RIVAL_1: 'RIVAL_1',
  RIVAL_2: 'RIVAL_2',
  RIVAL_3: 'RIVAL_3',
};

export const UnitRank = {
  SOLDIER: 'SOLDIER',
  CAPTAIN: 'CAPTAIN',
  UNDERBOSS: 'UNDERBOSS',
  BOSS: 'BOSS',
};

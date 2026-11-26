---
name: mafia-multiplayer-debug
description: "Use when debugging Hrodic's Mafia 2D multiplayer: two-tab mp-harness, host/guest snapshots, frozen guest movement, stale input, interpolation, lobby/room issues."
---

# Multiplayer debug

Host is authoritative; guests send input/commands and interpolate snapshots. Verify with the
local bus, not external relays.

## Harness

1. Serve the repo: `tools/serve.ps1 -Port 8123`.
2. Open `tests/mp-harness.html` in two tabs (the iframe forces the same-origin
   BroadcastChannel bus).
3. Tab A: HOST -> name -> create room; copy the code.
4. Tab B: JOIN -> name -> paste the code.
5. Host: wait for `2/` players, close unused AI slots, Start.
6. Guest: badge shows `MP GUEST`; move (WASD + click), slash/pistol, capture.
7. Check both consoles and screenshots.

## Inspect truth

```js
const { state } = await import('./src/core/state.js');
const boss = state.npcs.find(u => u.faction === 'RIVAL_1' && u.rank === 'BOSS');
state.net.getPeerInput(boss.humanPeerId); // host: last guest input
state.keys;                              // guest: held keys
({ x: boss.x, netX: boss.netX, path: boss.path, targetX: boss.targetX });
```

Compare host vs guest: `humanPeerId`, last input age, `x/netX`, `path/targetX`, timers.

## Known causes

- Guest frozen against walls: waypoint used a straight line -> require A* path following.
- Guest pinned/drifting: lost `keyup` -> clear keys on blur/visibilitychange; the host
  ignores peer input older than 500 ms.
- Animations frozen: snapshots re-arm timers; decay them per frame in
  `render/interpolation.js`.
- Jitter: snapshots applied to `x/y` instead of `netX/netY`; apply targets and smooth at
  render rate (`dt * 14`).
- Host tab backgrounded: rAF throttled to ~1 fps; keep it visible or use two windows.
- Audio throws after tests: cache noise buffers per `AudioContext` (WeakMap).

Do not change protocol/snapshot shape without checking `ARCHITECTURE.md` and both tabs.

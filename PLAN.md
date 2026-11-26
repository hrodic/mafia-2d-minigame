# PLAN.md — status & next steps

Workflow contract: `AGENTS.md`. Design/module map: `ARCHITECTURE.md`. Event bus:
`EVENTS.md`. This file owns phase status and the executable plan; do not duplicate the
architecture description here.

## Status

- **Phase 0 — DONE:** docs, zero-dependency browser test harness, smoke checklist.
- **Phase 1 — DONE:** full ES-module split; `src/main.js` is a thin composition root.
- **Phase 2 — DONE (`0.4.0`; suite green):**
  - event bus + combat/units/economy/territory/match migration; runtime hooks removed
  - prop/minimap/slot/version dedup; data-driven balance tables
  - explicit worldgen RNG; shareable SP/host seeds
  - AI extracted to `sim/ai.js`
  - HUD cadence moved to `ui/hudCadence.js`
  - UI/UX overhaul: primary status, crew management, action bar, leaderboard + kills
- **Phase 3 — IN PROGRESS (`0.4.6`; 3.1–3.4 done):** unified entity model, commands,
  fixed timestep. Balance pass: one human slash rule; all AI ranks base speed 150.
- **Phases 4–5 — pending:** netcode hardening, quality gates.

Work on `refactor/phase-3-unified-entity` (verify with `git branch --show-current`). Use
the `AGENTS.md` verification loop; bump `GAME_VERSION` for every commit-sized step.

## Phase 3 — Unified entity model, state factory, commands, fixed timestep

Goal: remove the player special case, one code path per mechanic, clean match reset.
**Riskiest phase: do these as small verified steps in order; gameplay must feel identical
after each one.** Run MP checks after any `sim/`, `net/` or shared-state step.

**3.1 `createGameState(config)` — DONE (`0.4.2`).** In `core/state.js`: return a fresh state object with
today's initial values. `initWorld` builds config, copies fresh values onto the exported
`state` (identity preserved for importers), generates chunks, spawns bosses. Remove
scattered manual resets. Verify New Game / restart flows.

**3.2 Player unit fields — DONE (`0.4.3`).** Added `id: 0`, `faction: Faction.PLAYER`,
`rank: UnitRank.BOSS`, `control: 'local'`, `bodyRadius` to the player object (still
separate for now). Fixes the latent `player.faction` undefined read.

**3.3 Unify damage — DONE (`0.4.4`).** `damagePlayerBoss` now delegates to
`applyDamageToNpc`; the player stays outside `npcs` and elimination runs on death. One
damage pipeline. Verified both directions (you kill, you die).

**3.4 Unify slash — DONE (`0.4.5`).** One `performSlash(attacker, params)`; player, rival
boss, AI boss and AI melee delegate. Human controls share one `SLASH.humanBoss` profile
(cooldown `0.34`, arc `0.42`, knockback `14`); AI keeps its own profiles (`1.0` cooldown,
no arc, knockback `12`). Hit flash is the shared `HIT_FLASH_DURATION` (`0.16s`).

**3.5 Unify movement + sprint.** One `moveUnit(unit, input, dt)` and one sprint updater
used by local player, AI steering result and remote-human boss. Verify solo, AI bosses,
MP guest.

**3.6 Fold player into `state.npcs`.** Player becomes a unit with `control: 'local'`;
`state.player` aliases it. Audit every site that iterates npcs or special-cases the player:
- upkeep, HUD crew/leaderboard, recruit filters, victory crew count
- spatial buckets; `canOccupyPosition` / `isPushingFriendly` player cases (keep same-faction
  pass-through semantics)
- AI enemy scan, pistol target scan, slash candidates
- snapshot build/apply and guest dead-body diffing
- render player label `(YOU)`, minimap dot, camera, `getLocalBoss`, defeat/spectator,
  `initWorld`
Keep the wire format unchanged (`playerBoss` may stay separate if simplest). Full smoke +
two-tab MP.

**3.7 `sim/commands.js`.** `dispatchCommand(faction, payload)` generalizes
`processRemoteCommand`. Local UI/input builds the same command objects and dispatches when
host/single; guests call `state.net.sendCommand(payload)`. The `isGuest` branch lives only
at the input→command boundary. Commands now: move, slash, shoot, armor, recruit prefs
(build/expand were removed in `0.3.0`). Verify solo + MP.

**3.8 Fixed timestep.** Accumulator in `main.js`: `SIM_DT = 1/60`, clamp frame delta
(~0.25s), N sim steps per rAF, render once. Guest interpolation/camera/HUD cadence use
render dt. Replace minimap's hardcoded `+= 0.016` with real dt. Verify feel (speeds,
cooldowns) + MP.

**3.9 Tests.** Headless simulation smoke: seeded state, 600 steps, no NaN, units walkable,
tick math, capture completes, boss death eliminates faction. Command dispatch tests
(local == remote outcomes). Full checklist.

## Phase 4 — Netcode hardening

Each step is one verified commit with the two-tab MP check. Split `mpNet.js` carefully;
never commit a half-split net module.

1. Split `net/mpNet.js`: `transport.js` (Trystero loader + local bus), `protocol.js`
   (envelope, version, snapshot encode/decode), `lobby.js` (peers/seats/roster, UI-agnostic),
   `host.js`, `guest.js`; extract lobby DOM to `ui/lobbyUI.js`.
2. Snapshot apply O(n²) fix: build `Map<id, unit>` once; reuse unit objects; set-diff deaths.
3. Chunk deltas: INIT_MATCH full chunks; snapshots only dirty faction/capture state;
   full resync ~5s. Guest generates unknown chunks from seed.
4. Security: never interpolate peer names into `innerHTML` (lobby, standings, labels); use
   `textContent`/DOM construction. Canvas `fillText` is safe.
5. Hidden-host resilience: `document.hidden` → `setInterval(~16ms)` simulation fallback;
   return to rAF when visible (no worker).
6. Bump `GAME_VERSION` for wire changes.
7. Verify: full MP checklist, invite links, version rejection, disconnect/AI takeover,
   hidden-host continued simulation.

## Phase 5 — Quality gates & docs

1. Expand tests: snapshot encode/decode, delta apply, capture rates, caps/clamps,
   elimination/victory, malformed remote commands ignored.
2. JSDoc public APIs + `// @ts-check` where clean; add `jsconfig.json` (`checkJs`, strict
   null checks where feasible). No npm.
3. Refresh README/architecture docs, deploy steps, how to add content via balance tables.
4. Validate the deployed GitHub Pages URL (module MIME, relative paths, CDNs, invites).

## Pitfalls / known bugs

- `player.faction` was read but undefined — fix in 3.2.
- Peer names in `innerHTML` — XSS risk; Phase 4.
- Guest snapshot apply can re-run elimination DOM/SFX; make guest effects idempotent in
  Phase 4.
- `getLocalBoss()` allocates a fallback object when the boss is dead — clean up in Phase 3.
- Minimap cache timer uses hardcoded `0.016` — fix with real dt in 3.8.
- Background host tabs throttle rAF and stall MP — Phase 4.
- ESM: relative imports need `.js`; no top-level reads in cycles; modules are deferred;
  `file://` is blocked. Test over http.
- Do not change gameplay numbers during Phase 3 except encoding existing differences as
  parameters.
- A* uses a linear open list; fine at current node counts; optimize only if profiling says so.

## Out of scope

- No npm/build/bundler/TypeScript transpilation, frameworks or asset pipeline.
- No gameplay rebalancing or new features unless explicitly requested.
- No Web Workers or server infrastructure.
- Keep Tailwind and Trystero on their CDNs.

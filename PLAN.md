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
- **Phase 3 — DONE (`0.4.11`):** shared unit contract, commands, fixed timestep, 600-step
  headless smoke + command-equivalence tests. Balance pass: one human slash rule; non-boss
  AI ranks base speed 150; bosses 140 (sprint is their mobility edge).
- **Phase 4 — IN PROGRESS (`0.4.12`):** netcode hardening; transport extracted.
- **Phase 5 — pending:** quality gates.

Phase 3 is complete on `refactor/phase-3-unified-entity`. Phase 4 is in progress on
`refactor/phase-4-netcode`; use the `AGENTS.md` verification loop and bump `GAME_VERSION`
for every commit-sized step.

## Phase 3 — DONE (`0.4.11`)

Delivered: `createGameState()` reset factory; shared unit contract with the player as a
local singleton outside `state.npcs`; one damage/slash/movement pipeline; unified local +
remote command dispatch; fixed `1/120` timestep with render-time presentation; `sim/`
fully headless; seeded 600-step headless, command-equivalence and fixed-step tests.
Implementation details live in `ARCHITECTURE.md`; step history is in git.

## Phase 4 — Netcode hardening

Each step is one verified commit with the two-tab MP check. Split `mpNet.js` carefully;
never commit a half-split net module.

1. Split `net/mpNet.js`:
   - **DONE (`0.4.12`):** `transport.js` — Trystero 0.27 loader/API shim, curated public
     relay pool, and the same-origin local bus. Fixes the dead `nostr.chaima.info` default
     and the 0.27 peer-context/send-target mismatch without changing the wire protocol.
   - **NEXT:** `protocol.js` (envelope, version, snapshot encode/decode), `lobby.js`
     (peers/seats/roster, UI-agnostic), `host.js`, `guest.js`; extract lobby DOM to
     `ui/lobbyUI.js`.
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

- Peer names in `innerHTML` — XSS risk; Phase 4.
- Guest snapshot apply can re-run elimination DOM/SFX; make guest effects idempotent in
  Phase 4.
- Background host tabs throttle rAF and stall MP — Phase 4.
- ESM: relative imports need `.js`; no top-level reads in cycles; modules are deferred;
  `file://` is blocked. Test over http.
- A* uses a linear open list; fine at current node counts; optimize only if profiling says so.
- Prefer no gameplay-number changes during structural refactors unless intentional; lock
  balance changes in `tests/balance.test.js`.

## Out of scope

- No npm/build/bundler/TypeScript transpilation, frameworks or asset pipeline.
- No gameplay rebalancing or new features unless explicitly requested.
- No Web Workers or server infrastructure.
- Keep Tailwind and Trystero on their CDNs.

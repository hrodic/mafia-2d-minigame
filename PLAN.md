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
  AI ranks base speed 150; bosses 140 (sprint is their mobility edge). Current speeds:
  Boss 130, Underboss 135, Captain 140, Soldier 150.
- **Phase 4 — DONE (`0.4.19`):** netcode hardening; step 1 split complete; snapshot apply
  is O(n); hidden-host fallback added. Chunk deltas and NAT/TURN work moved to the future
  ideas section.
- **Phase 5 — DONE (`0.4.22`):** quality gates and docs; tests/typecheck/build tooling
  documented and enforced; deploy/smoke guidance refreshed. Deployed Pages validation moved
  to the future ideas section by owner decision.
- **Current work — `0.8.0` branch (in progress):** boss survival priority, no ranged/melee
  dead zone, Glock/MP9 shop, economy/music/blood tuning, and the tactical command layer.
  Command-layer steps 1–3 are live: faction global/local order state, Orders UI, commands,
  snapshot sync, **Global Defend** (owned-turf patrol + safe reinforcement placement) and
  **Local Guard** (scattered 50–150 px melee / 200–300 px gunner ring, focus debounce,
  250 ms post cache, Attack danger collapse, self-defense, guard recall). Defaults
  **Expand + Attack** preserve the pre-command behavior. A* quick wins are in:
  binary heap, 16-tile LOS pre-check, optional perf counters; `scanNearby` now uses
  squared distances and boss-only group counts. Collision safe pass is in: idle
  `moveUnit` skips push/collision scans, body radii are cached, car rects are
  precomputed per chunk, and `moveUnit` shares one 3×3 neighbourhood scan across
  push and axis collision. Stage 1 push is in: same-faction units keep minimum
  separation, a moving unit slowly pushes one ally, and a blocked ally blocks the
  pusher. Stage 2 chain push is in: up to 3 allies are pushed as a chain with full
  rollback if any link is blocked. Friendly NPC separation is halved for tighter
  alleys, and AI units try a diagonal/pure side-step before pushing. Push speed is
  30%; bosses have 1.25 push mass and resist pushes. Low-frequency depenetration
  cleans stale overlaps. The push model is complete. The collision broad-phase now
  uses a 64 px unit grid, cutting dense-fight candidate scans dramatically; the next
  measured targets are `scanNearby` and `canMoveTo`.
  Version stays `0.8.0` for the whole branch by owner decision.

Phases 3, 4 and 5 are complete. `refactor/phase-5-quality` has merged into `master`. `0.8.0`
is the active feature branch; future ideas and optional tasks are listed below.

## Phase 3 — DONE (`0.4.11`)

Delivered: `createGameState()` reset factory; shared unit contract with the player as a
local singleton outside `state.npcs`; one damage/slash/movement pipeline; unified local +
remote command dispatch; fixed `1/120` timestep with render-time presentation; `sim/`
fully headless; seeded 600-step headless, command-equivalence and fixed-step tests.
Implementation details live in `ARCHITECTURE.md`; step history is in git.

## Phase 4 — DONE (`0.4.19`)

Delivered:

1. **Net split (`0.4.12`–`0.4.17`):** `transport.js`, `protocol.js`, `lobby.js`,
   `ui/lobbyUI.js`, `guest.js`, `host.js`; `mpNet.js` is now a composition facade.
2. **Snapshot apply (`0.4.18`):** one per-snapshot `Map<id, unit>`, object reuse, new-unit
   insertion and set-diff deaths; apply is O(n) instead of O(n²).
3. **Security (`0.4.15`):** lobby and HUD standings build safe DOM; peer names are never
   parsed as HTML. Canvas `fillText` is safe.
4. **Hidden-host resilience (`0.4.19`):** `core/hiddenSim.js` runs fixed steps from a 16 ms
   timer while `document.hidden`; rAF resumes and the accumulator resets when visible.
   Guests never simulate. Browsers may still throttle background timers.
5. **Versioning:** `GAME_VERSION` is bumped for every commit-sized step.

## Phase 5 — DONE (`0.4.22`)

Delivered:

1. **Tests (`0.4.20`):** targeted guest snapshot ordering/sender/malformed checks,
   unknown-chunk generation, duplicate host HELLO and remote command routing. Removed the
   duplicate balance assertions from `config.test.js`; capture rates, caps/clamps,
   elimination/victory and malformed commands were already covered.
2. **Type checking (`0.4.21`):** `jsconfig.json` with `// @ts-check` opt-in, JSDoc on clean
   core/net modules, and `tools/typecheck.ps1` using an ignored native `tsc.exe`. No npm or
   transpilation.
3. **Docs/deploy (`0.4.22`):** README/architecture/deploy/smoke docs refreshed; `docs/` is
   pure esbuild output and never hand-edited; static validation tooling is listed in
   `AGENTS.md`, `README.md` and the zero-build skill.
4. **Closure (no version bump):** deployed Pages validation moved to FUTURE by owner
   decision. Planning/status documentation changes do not require a patch release.

## FUTURE — TO BE DECIDED

These are outside the closed phases and are not scheduled.

### Deployed GitHub Pages validation

- Run after merge with Pages set to the published branch and folder `/docs`.
- Check module MIME/types, relative paths, CDN loading, invite links and multiplayer.
- Confirm `/docs/` loads, `/docs/tests/...` returns 404, no tests/source are served through
  the site, and the console is clean.

### Chunk deltas

- Current: every snapshot carries full chunk state.
- Idea: `INIT_MATCH` full chunks; snapshots only dirty faction/capture state; full resync
  ~5s; guest generates unknown chunks from the seed.
- Revisit after measuring snapshot size/rate on a large map.
- Tradeoffs: bandwidth/CPU win; dirty-tracking and resync complexity; wire change and
  protocol/version bump.

### NAT / TURN connectivity

- Current: Trystero uses STUN only; Nostr relays are signaling only.
- Idea: surface `peer-connect-failed` with a clear message; optional `turnConfig` with no
  default credentials; optional `?netdebug=1` panel for relay sockets, peer connection
  type, RTT and `turnConfigured`.
- Hosted/self-hosted options: Cloudflare Realtime TURN, Metered Open Relay, coturn/eturnal/
  Pion TURN.
- Tradeoffs: helps strict-NAT peers; adds a service, credentials, bandwidth/latency and
  credential-handling risk. Do not commit long-lived TURN credentials to a public page.
- Decision needed before implementation.

## Pitfalls / known bugs

- Hidden host timers can still be throttled by the browser; keep the host tab visible when
  possible. `core/hiddenSim.js` is a mitigation, not a guarantee.
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

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
- **Phase 4 — DONE (`0.4.19`):** netcode hardening; step 1 split complete; snapshot apply
  is O(n); hidden-host fallback added. Chunk deltas and NAT/TURN work moved to the future
  ideas section.
- **Phase 5 — NEXT:** quality gates and docs.

Phase 3 is complete on `refactor/phase-3-unified-entity`. Phase 4 is complete on
`refactor/phase-4-netcode`. Phase 5 is next; use the `AGENTS.md` verification loop and bump
`GAME_VERSION` for every commit-sized step.

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

Post-merge verification: full MP checklist, invite links, version rejection, disconnect/AI
takeover and hidden-host continued simulation on the deployed build.

## FUTURE — TO BE DECIDED

These are intentionally outside Phase 4 and are not scheduled.

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

## Phase 5 — NEXT: Quality gates & docs

1. Expand tests: snapshot encode/decode, delta apply, capture rates, caps/clamps,
   elimination/victory, malformed remote commands ignored.
2. JSDoc public APIs + `// @ts-check` where clean; add `jsconfig.json` (`checkJs`, strict
   null checks where feasible). No npm.
3. Refresh README/architecture docs, deploy steps, how to add content via balance tables.
4. Validate the deployed GitHub Pages URL (module MIME, relative paths, CDNs, invites).

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

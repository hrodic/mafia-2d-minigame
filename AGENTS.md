# AGENTS.md — working contract

Onboarding and rules for any AI or human contributor continuing this project. Read
`README.md`, then `ARCHITECTURE.md`, then `PLAN.md` before changing code.

## Project status

- **Phase 1 (modularization) is complete**: `src/main.js` is an 81-line composition root;
  all systems live under `src/` as native ES modules.
- **179 browser tests pass** (`tests/tests.html`).
- **Phase 2 (decoupling & dedup) is next** — see `PLAN.md`.

## Hard rules from the owner

1. **Always work on a branch** (e.g. `refactor/...`), never directly on `master`.
2. **Do not commit or push unless the owner explicitly asks.** Leave changes in the
   working tree and report what changed.
3. **Pause after each phase** (and after each agreed checkpoint) so the owner can
   manually validate before continuing.
4. **Golden rule: every commit must leave the game playable, deployable to GitHub Pages,
   and the test suite green.** If a step cannot meet this, split it.
5. **Zero-build is non-negotiable**: no npm, no bundler, no TypeScript transpilation, no
   asset pipeline. Native ES modules + relative `.js` imports; Tailwind and Trystero stay
   on their CDNs.

## Verification loop (run after every change)

0. Static health check (fast, catches missing imports / unregistered suites before the
   browser):
   ```sh
   powershell -ExecutionPolicy Bypass -File tools/check.ps1
   ```
   Must print `OK: …`.
1. Start a static server from the repo root:
   ```sh
   powershell -ExecutionPolicy Bypass -File tools/serve.ps1 -Port 8123
   ```
   (or any static server; ES modules require http, not `file://`).
2. Open `http://localhost:8123/tests/tests.html` → page title must be **PASS**.
   If you add a suite, register it in `tests/runner.js` (the check script enforces this).
3. Quick smoke: `http://localhost:8123/` → launch single player → move (WASD + click) →
   slash/pistol → capture a block → wait one tick → no console errors.
4. For any change touching `sim/`, `net/` or shared state, run the multiplayer check:
   open `tests/mp-harness.html` in **two tabs** (or the deployed URL in two browsers),
   host a room, join, launch, verify guest movement/commands and snapshots.
5. Full manual checklist: `tests/SMOKE.md`.

**Golden worldgen tests**: `tests/world-golden.test.js` pins seeded chunk hashes. If a
refactor (e.g. Phase 2 explicit RNG) changes them unexpectedly, generation broke — fix
the code, do not update the hashes. Update hashes only for an intentional gen change.

### Environment notes

- Windows + PowerShell. `python`/`node` are not assumed; `tools/serve.ps1` is a
  dependency-free threaded server. The in-app browser tools and the `browse` MCP can be
  used for live verification.
- **Background tabs are throttled by browsers.** A host tab in the background simulates
  at ~1 fps, making guests look frozen/slow. Keep the host tab visible, or test with two
  windows/computers. This is a documented limitation, not a game bug.
- Browser console/screenshot checks are the fastest way to catch wiring mistakes; several
  past bugs were missing imports only visible at runtime.

## Where to change what

| Task | Files |
|---|---|
| New unit stat / cost / cap | `src/config/balance.js`, `src/sim/units.js` |
| New organization / faction colors | `src/config/organizations.js` |
| World generation / props / collision | `src/world/chunk.js`, `src/world/city.js` |
| AI behavior | `src/sim/simulation.js` (AI block; Phase 2 moves it to `sim/ai.js`) |
| Combat/weapons/armor | `src/sim/combat.js` |
| Capture / victory / defeat | `src/sim/territory.js` |
| Economy / recruitment tick | `src/sim/economy.js`, `src/sim/units.js` |
| Remote-human boss / waypoints | `src/sim/movement.js` |
| HUD | `src/ui/hud.js` |
| Setup modal / banners / toasts | `src/ui/menus.js` |
| Keyboard/mouse/HUD buttons | `src/ui/input.js` |
| Snapshot/lobby/transport | `src/net/mpNet.js` |
| Rendering / minimap / effects | `src/render/*` |
| Audio | `src/audio/*` |
| Wiring/hooks/loop | `src/main.js`, `src/core/runtime.js` |

## Invariants to preserve

- `sim/` must not import `ui/`, `render/`, `audio/` or `net/`, and must not touch the DOM.
  Use `core/runtime.js` hooks until Phase 2 introduces the event bus.
- The host is authoritative. Guests never simulate gameplay; they stream input/commands
  and interpolate snapshots.
- World generation is deterministic from the seed; host and guests must build the same map.
- `state.net` is the bridge used by `core/state.js` selectors. It is set in `main.js` before
  UI/input initialization.
- Gameplay numbers are intentionally unchanged by refactors. Do not rebalance unless asked.
- Keep `GAME_VERSION` (`src/net/mpNet.js`) in sync with the title/modal version until Phase 2
  centralizes it.

## Known pitfalls

- **ESM cycles**: never read imported bindings at module top level in a cycle; prefer
  parameter passing or a bridge.
- **Bulk renames**: a global token rename can corrupt quoted DOM ids (e.g.
  `mp-host-player-count`), object keys/shorthands and spreads. Audit quoted literals and
  keys afterwards.
- **PowerShell extraction**: `ReadAllLines`/`WriteAllLines` preserve UTF-8 but scripts must
  avoid emoji/backticks pitfalls; assertions and bottom-up line removals prevent silent
  corruption. Backticks are PowerShell escapes; use single-quoted here-strings for JS.
- **Stale input**: lost `keyup` events (focus loss) used to pin guests against walls. Keys
  are now cleared on blur/visibility change and the host ignores input older than 500 ms.
- **Waypoints**: remote/local waypoint movement uses A*; a direct line is only a fallback.
  Keyboard input cancels the path.
- **Audio buffers**: noise buffers are cached per AudioContext (a shared buffer from another
  context breaks playback in Chrome).

## Definition of done (per change)

- Game loads over http with no console errors.
- `tests/tests.html` green.
- Quick smoke passes; multiplayer check if relevant.
- No gameplay regressions; README/ARCHITECTURE updated when structure changes.
- Report changed files and verification results; do not commit unless asked.

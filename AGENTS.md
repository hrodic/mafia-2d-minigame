# AGENTS.md

Rules for AI/human contributors. One source of truth per topic:

- `README.md` — what the game is, controls, run/deploy.
- `ARCHITECTURE.md` — layers, modules, data flow, invariants.
- `PLAN.md` — phase status and the next step.
- `EVENTS.md` — Phase 2 event-bus contract.
- `.opencode/skills/` — task skills (zero-build refactor, multiplayer debug).

Precedence: explicit user instruction > this file > other docs. Never invent a path,
command, number or test result; read the file or run the check.

## Hard rules

1. Work on a branch (`refactor/...`). NEVER edit `master` directly.
2. NEVER commit or push unless the owner explicitly asks. Leave changes in the working tree.
3. Pause after each phase/checkpoint so the owner can validate before the next step.
4. Every change MUST leave the game playable, GitHub Pages-deployable, and tests green.
   If a step cannot, split it.
5. Zero-build is non-negotiable: no npm, bundler, transpiler, or asset pipeline. Native ES
   modules with relative `.js` imports; Tailwind and Trystero stay on their CDNs.

## Commands (Windows/PowerShell; `python`/`node` not assumed)

| Task | Command / URL |
|---|---|
| Static check | `powershell -ExecutionPolicy Bypass -File tools/check.ps1` → `OK: ...` |
| Dev server | `powershell -ExecutionPolicy Bypass -File tools/serve.ps1 -Port 8123` |
| Tests | `http://localhost:8123/tests/tests.html` → title `PASS` |
| Single-player smoke | `http://localhost:8123/` |
| Multiplayer smoke | `tests/mp-harness.html` in two tabs |
| Manual checklist | `tests/SMOKE.md` |

## Verification (after every change)

1. `tools/check.ps1` prints `OK: ...` (imports, runner manifest, DOM ids).
2. Tests page title is `PASS`; check the browser console, not just the summary.
3. Game loads over http, starts, moves, slashes/shoots; no console errors.
4. If `sim/`, `net/` or shared state changed: two-tab MP check (lobby, launch, guest
   movement/commands, snapshots).
5. Added a test file? Register it in `tests/runner.js`; the check script enforces this.
6. Golden test failed after a refactor? Generation broke. Fix the code; update
   `tests/world-golden.test.js` hashes only for an intentional generation change.

## Where to change what

| Task | Files |
|---|---|
| Unit stats / costs / caps | `src/config/balance.js`, `src/sim/units.js` |
| Organizations / faction colors | `src/config/organizations.js` |
| Worldgen / props / collision | `src/world/chunk.js`, `src/world/city.js` |
| AI behavior | `src/sim/simulation.js` (Phase 2 moves it to `src/sim/ai.js`) |
| Combat / weapons / armor | `src/sim/combat.js` |
| Capture / victory / defeat | `src/sim/territory.js` |
| Economy / recruitment tick | `src/sim/economy.js`, `src/sim/units.js` |
| Remote-human boss / waypoints | `src/sim/movement.js` |
| HUD | `src/ui/hud.js` |
| Setup modal / banners / toasts | `src/ui/menus.js` |
| Keyboard / mouse / HUD buttons | `src/ui/input.js` |
| Snapshots / lobby / transport | `src/net/mpNet.js` |
| Rendering / minimap / effects | `src/render/*` |
| Audio | `src/audio/*` |
| Wiring / hooks / loop | `src/main.js`, `src/core/runtime.js` |

## Invariants

- `sim/` is headless: never import `ui/`, `render/`, `audio/` or `net/`; never touch the
  DOM. Use `core/runtime.js` hooks until the event bus replaces them.
- Host is authoritative. Guests never simulate; they stream input/commands and interpolate
  snapshots.
- Worldgen is deterministic from the seed; host and guests must build the same city.
- `state.net` is the bridge for `core/state.js` selectors; `main.js` sets it before UI init.
- Do not rebalance or change gameplay numbers during refactors unless asked.
- Keep `GAME_VERSION` (`src/net/mpNet.js`) aligned with the title/modal version.
- ESM cycles: never read an imported binding at module top level; pass parameters or use a
  bridge.
- Prefer extending existing helpers/config over inventing new abstractions.

## Pitfalls that cause real bugs

- Background tabs throttle rAF (~1 fps): keep the host tab visible, or use two windows.
- Bulk renames corrupt quoted DOM ids, object keys/shorthands and spreads; audit literals.
- Missing imports often surface only at runtime; always load the game, not just tests.
- Guest stuck/pinned: keys clear on blur/visibilitychange and the host ignores peer input
  older than 500 ms. Keep both behaviors.
- Audio: cache noise buffers per `AudioContext` (a cross-context buffer breaks Chrome).

## Done

Static check OK, tests `PASS`, smoke clean, docs updated if structure changed. Report changed
files and verification results. Do not commit.

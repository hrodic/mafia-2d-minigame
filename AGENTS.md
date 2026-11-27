# AGENTS.md

Rules for AI/human contributors. One source of truth per topic:

- `README.md` — what the game is, controls, run/deploy.
- `ARCHITECTURE.md` — layers, modules, data flow, invariants.
- `PLAN.md` — phase status and future ideas. **Current phase: none (Phases 0–5 complete).**
- `EVENTS.md` — event-bus contract (implemented).
- `.opencode/skills/` — task skills (zero-build refactor, multiplayer debug).

Precedence: explicit user instruction > this file > other docs. Never invent a path,
command, number or test result; read the file or run the check.

## Hard rules

1. Work on a branch (`refactor/...`). NEVER edit `master` directly.
2. NEVER commit or push unless the owner explicitly asks. Leave changes in the working tree.
3. Pause after each phase/checkpoint so the owner can validate before the next step.
4. Every change MUST leave the game playable, GitHub Pages-deployable, and tests green.
   If a step cannot, split it.
5. The source stays zero-build: no npm install, bundler or asset pipeline in `src/`.
   Native ES modules with relative `.js` imports; Tailwind and Trystero stay on their CDNs.
   `docs/` is a generated GitHub Pages artifact produced by `tools/build-pages.ps1`, which
   runs a local esbuild binary to minify each module **without bundling**. Never hand-edit
   `docs/`; rebuild it from `src/`.

## Generated Pages artifact (`docs/`)

`docs/` is **pure output** of `tools/build-pages.ps1` (esbuild minify, no bundling). It is
not source. Never edit, add or delete anything under `docs/` by hand; never put tests there;
never use it for debugging. Change `index.html`, `styles.css` or `src/`, run the build
script, and commit the regenerated `docs/` directory. If the artifact is wrong, fix the
source or build script and rebuild; do not patch `docs/`.

## Static validation tooling

Run these before every commit:

1. `tools/check.ps1` — imports, test registry, DOM ids, skill metadata, `docs/` shape and
   the `sim/` headless ratchet.
2. `tools/typecheck.ps1` — native TypeScript compiler against `jsconfig.json`
   (`// @ts-check` modules only).
3. `tests/tests.html` — browser test suite; title must be `PASS`.
4. `tools/build-pages.ps1` + `http://localhost:8123/docs/` — when `src/`, `index.html` or
   `styles.css` changed.
5. `tests/mp-harness.html` in two tabs — when `sim/`, `net/` or shared state changed.

## Versioning (SemVer)

`GAME_VERSION` in `src/config/version.js` is the single source (`MAJOR.MINOR.PATCH`).

- Every commit-sized step that changes source, tests, config or the shipped artifact bumps
  the version in the same commit.
- Do not bump for intermediate iterations within the same branch/commit-sized change. Bump
  once when the change is ready to commit/merge.
- Planning/status documentation-only edits (`PLAN.md`, `AGENTS.md`, `ARCHITECTURE.md`, README
  wording) do not bump the version.
- **MINOR** for a new user-visible capability; **PATCH** for fixes, refactors, tests,
  performance or internal changes.
- Intentional balance tuning updates `tests/balance.test.js` expected values in the same
  commit.
- `1.0.0` is the first stable release; while `0.x`, breaking changes may still land in a
  MINOR.
- Peers must run the same `GAME_VERSION`: it gates the multiplayer handshake.
- **Before pushing a MINOR version bump**, run the standalone 120s Turbo simulation in
  `tests/long-sim.html` at least once and confirm `PASS`. It is recommended as the release
  sanity check for each MINOR bump.

## Commands (Windows/PowerShell; `python`/`node` not assumed)

| Task | Command / URL |
|---|---|
| Full static gate | `tools/check.ps1` + `tools/typecheck.ps1` + `tests/tests.html` |
| Static check | `powershell -ExecutionPolicy Bypass -File tools/check.ps1` → `OK: ...` |
| Type check | `powershell -ExecutionPolicy Bypass -File tools/typecheck.ps1` → `Type check OK` |
| Build Pages artifact | `powershell -ExecutionPolicy Bypass -File tools/build-pages.ps1` → `Built docs/: ...` |
| Dev server | `powershell -ExecutionPolicy Bypass -File tools/serve.ps1 -Port 8123` |
| Tests | `http://localhost:8123/tests/tests.html` → title `PASS` |
| Single-player smoke | `http://localhost:8123/` |
| Built artifact smoke | `http://localhost:8123/docs/` |
| Multiplayer smoke | `tests/mp-harness.html` in two tabs |
| 120s turbo simulation | `http://localhost:8123/tests/long-sim.html` (standalone) |
| Manual checklist | `tests/SMOKE.md` |

## Verification (after every change)

1. `tools/check.ps1` prints `OK: ...` (imports, runner manifest, DOM ids, skill
   frontmatter, generated `docs/` shape and the `sim/` layering ratchet).
2. `tools/typecheck.ps1` prints `Type check OK` (downloads the ignored native `tsc.exe`).
3. Tests page title is `PASS`; check the browser console, not just the summary.
4. Game loads over http, starts, moves, slashes/shoots; no console errors.
5. If `src/`, `index.html` or `styles.css` changed: run `tools/build-pages.ps1`, confirm
   `Built docs/`, smoke `http://localhost:8123/docs/`, and verify `docs/` contains no tests.
6. If `sim/`, `net/` or shared state changed: two-tab MP check (lobby, launch, guest
   movement/commands, snapshots).
7. Added a test file? Register it in `tests/runner.js`; the check script enforces this.
8. Golden test failed after a refactor? Generation broke. Fix the code; update
   `tests/world-golden.test.js` hashes only for an intentional generation change.
9. Before pushing a MINOR version bump, run `tests/long-sim.html` (120s Turbo) once and
   confirm `PASS` alongside the normal gates.

## Where to change what

| Task | Files |
|---|---|
| Unit stats / costs / caps | `src/config/balance.js`, `src/sim/units.js` |
| Balance tuning (weapons / accuracy / ranks) | `src/config/balance.js` |
| Organizations / faction colors | `src/config/organizations.js` |
| Player-count slot mapping | `src/config/organizations.js` (`getActiveFactionSlots`) |
| Worldgen / props / collision | `src/world/chunk.js`, `src/world/city.js`, `src/world/geometry.js` |
| AI behavior | `src/sim/ai.js` |
| Combat / weapons / armor | `src/sim/combat.js` |
| Combat presentation (effects / SFX) | `src/render/combatFx.js`, `src/audio/combatSfx.js` |
| Capture / victory / defeat | `src/sim/territory.js` |
| Territory presentation (turf text / banners / SFX) | `src/render/territoryFx.js`, `src/main.js` |
| Economy / recruitment tick | `src/sim/economy.js`, `src/sim/units.js` |
| Recruitment feedback (floating text) | `src/render/recruitFx.js` |
| Remote-human boss / waypoints | `src/sim/movement.js` |
| HUD | `src/ui/hud.js` |
| Combat action bar / cooldowns | `src/ui/actionBar.js` |
| Setup modal / banners / toasts | `src/ui/menus.js` |
| Keyboard / mouse / HUD buttons | `src/ui/input.js` |
| Local/remote commands | `src/sim/commands.js`, `src/ui/commandBridge.js` |
| Snapshots / lobby / transport | `src/net/*` (`mpNet.js` composition facade) |
| Hidden-host fallback | `src/core/hiddenSim.js`, `src/main.js` |
| World seed (generate / parse / UI) | `src/core/rng.js`, `src/ui/menus.js`, `src/sim/match.js`, `src/net/mpNet.js` |
| Rendering / minimap / effects | `src/render/*` |
| Radar layout math | `src/render/minimapLayout.js` |
| Audio | `src/audio/*` |
| Wiring / hooks / loop | `src/main.js`, `src/ui/hudCadence.js` |
| Match setup reset (effects / UI / labels / HUD) | `src/main.js` (`match:initialized` subscribers) |
| Event bus / presentation events | `src/core/events.js`, `EVENTS.md` |
| GitHub Pages artifact | `docs/` — generated by `tools/build-pages.ps1`; never hand-edit |

## Invariants

- `sim/` is headless: never import `ui/`, `render/`, `audio/` or `net/`; never touch the
  DOM. Emit facts and let subscribers in `main.js` handle presentation; there are no runtime
  hooks. `tools/check.ps1` enforces this ratchet and currently reports `sim headless`; do not
  add new presentation imports to `sim/`.
- Events are discrete cross-layer facts: never emit per frame or per NPC per frame, and
  never route authoritative state or replication through events. Continuous visuals read
  `state`; snapshots stay authoritative. See `EVENTS.md`.
- Event subscribers are presentation-only: no gameplay mutation, no event cascades, no heavy
  work in the simulation frame.
- Host is authoritative. Guests never simulate; they stream input/commands and interpolate
  snapshots.
- Worldgen is deterministic from the seed and uses an explicit per-chunk PRNG; never
  reassign `Math.random` and never call `Math.random()` in `src/world/`.
- `state.net` is the bridge for `core/state.js` selectors; `main.js` sets it before UI init.
- Do not rebalance or change gameplay numbers during refactors unless asked.
- Keep `GAME_VERSION` in `src/config/version.js` as the single source; the title, HUD/modal
  labels and net handshake read it. Never hardcode it elsewhere.
- ESM cycles: never read an imported binding at module top level; pass parameters or use a
  bridge.
- Prefer extending existing helpers/config over inventing new abstractions.

## Pitfalls that cause real bugs

- Background tabs throttle rAF (~1 fps): keep the host tab visible, or use two windows.
- Bulk renames corrupt quoted DOM ids, object keys/shorthands and spreads; audit literals.
- Missing imports often surface only at runtime; always load the game, not just tests.
  `tools/check.ps1` catches unresolved imports and `canvas.*` without the canvas import,
  but also exercise the **guest** flow after extracting/refactoring `net/`.
- Guest stuck/pinned: keys clear on blur/visibilitychange and the host ignores peer input
  older than 500 ms. Keep both behaviors.
- Event subscriptions are global: wire once in `main.js`; keep unsubscribers for
  match-scoped handlers and call `clear()` on a full reset to avoid duplicate effects.
- Audio: cache noise buffers per `AudioContext` (a cross-context buffer breaks Chrome).

## Done

Static check OK, tests `PASS`, smoke clean, docs updated if structure changed, version
bumped per policy. Report changed files and verification results. Do not commit.


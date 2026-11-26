# Refactor Plan - handoff copy

This is the living plan. Read `AGENTS.md` for the working contract and
`ARCHITECTURE.md` for the current design.

## Status

- Phase 0 - DONE (docs, zero-dependency test harness, smoke checklist)
- Phase 1 - DONE (full modular split; tests green; `src/main.js` is a thin composition root)
- Versioning: SemVer started at `0.1.0`; bump PATCH/MINOR on every commit-sized step
- Phase 2 - COMPLETE
  - Step 1 DONE: `core/events.js` event bus + `tests/events.test.js` (additive; hooks intact)
  - Step 2 DONE: combat migrated to events (`sim/combat.js` emits only; presentation in
    `render/combatFx.js` + `audio/combatSfx.js`; net SHOT broadcast moved to `main.js`).
    `tools/check.ps1` now enforces the `sim/` layering ratchet.
  - Fix: guest movement crash (`canvas` missing import in `net/mpNet.js`); static guard
    added so `canvas.*` usage requires the canvas import. Guest movement re-verified.
  - Step 3 DONE: units migrated (`unit:recruited` -> `render/recruitFx.js`); allowlist debt
    shrank.
  - Step 4 DONE: economy migrated (`hour:tick` -> HUD subscriber); runtime import removed.
  - Step 5 DONE: territory migrated (`chunk:captured`, `faction:eliminated`,
    `match:victory`, `match:defeat`); `render/territoryFx.js` + main subscribers; runtime
    hooks removed from `runtime.js`.
  - Step 6 DONE: match setup migrated to `match:initialized` (effects/UI/labels/HUD
    subscribers). Allowlist debt is now only `simulation.js` (canvas aim, per-frame
    particles, guest presentation; Phase 3).
  - Step 7 DONE: `GAME_VERSION` single source in `src/config/version.js`; title/HUD/modal
    labels applied by `src/ui/version.js`; static check rejects duplicated literals.
  - Step 8 DONE: SemVer baseline `0.1.0`; patch/minor bump policy documented and enforced
    (format + single source).
  - Step 9 DONE (`0.1.1`): prop footprints centralized in `src/world/geometry.js`; collision,
    bullet raycast and drawing share it; characterization tests added.
  - Step 10 DONE (`0.1.2`): radar bounds/cell/offset + world<->map mapping centralized in
    `src/render/minimapLayout.js`; drawing and click mapping share it.
  - Step 11 DONE (`0.1.3`): active faction slots centralized in
    `getActiveFactionSlots`/`clampFactionCount`; match setup and MP lobby seats share it.
  - Step 12 DONE (`0.1.4`): data-driven balance tables (`RANK_STATS`, `UNIT_CAPS`, `SLASH`,
    `PISTOL`/accuracy bands) drive spawn, collision/capture, combat and caps; values locked
    by `tests/balance.test.js`.
  - Step 13 DONE (`0.1.5`): worldgen uses an explicit per-chunk PRNG; `withSeed` removed
    and `Math.random()` is blocked in `src/world/` by the static check. Golden maps unchanged.
  - Step 14 DONE (`0.2.0`): shareable world seeds. SP/Host choose a seed (blank = random);
    guests adopt the host seed. Header badge + setup copy/reuse; seed in `match:initialized`.
  - Step 15 DONE (`0.2.1`): AI extracted to `sim/ai.js` (`scanNearby`,
    `choosePatrolChunk`, `updateNpcAi`), with headless tests; `simulation.js` is orchestration.
  - Step 16 DONE (`0.2.2`): HUD cadence moved to `src/ui/hudCadence.js`; `core/runtime.js`
    deleted. Phase 2 complete.
  - Post-Phase-2 UX (`0.3.0`): removed Borders, Click-Build and Expand Ring controls/logic.
  - Post-Phase-2 visuals (`0.3.1`): subtle city backdrop outside chunks; radar enlarged to
    168px with larger unit markers.
  - Next: Phase 3 (unified entity/command pipeline, fixed timestep)
  - Guardrails: benefits/tradeoffs/use-skip rules and the many-NPC + multiplayer
    performance budget are documented in `EVENTS.md`
- Phases 3-5 - pending (unified entity model/commands/fixed timestep, net hardening, quality)

Safety nets in place before Phase 2:
- `tests/world-golden.test.js` pins seeded chunk hashes (guards the explicit-RNG refactor).
- `tools/check.ps1` statically verifies imports, test registration, DOM ids and skills.
- `EVENTS.md` defines the event-bus API, catalog and subscriber map (bus implemented).

Every step must keep the game playable, deployable, and the tests green. Pause after each
phase for owner validation. Do not commit/push without approval; always work on a branch.

## Deviations from the original plan (Phase 1)

- Extraction order was dependency-driven: config -> state -> world -> audio -> effects ->
  movement -> units -> economy -> territory -> combat -> match -> simulation -> render ->
  HUD -> menus -> input -> net. `render/canvas.js` was extracted early because simulation
  needs the canvas for aiming; `render/interpolation.js` was added for guest smoothing.
- A transitional `core/runtime.js` hook bridge lets `sim/` refresh HUD/toasts/banners/SFX
  without importing `main.js`. Phase 2 replaces it with the event bus.
- `net/mpNet.js` is still one module after Phase 1, as planned; Phase 4 splits it.
- Fixes made during Phase 1 that must be preserved: A* waypoint following for click-to-move
  and remote bosses; stale-key release on blur + 500 ms stale peer-input timeout;
  per-AudioContext noise-buffer cache; guest animation timer decay and per-frame
  interpolation; shell casings are now rendered.
- The old code-map line ranges are obsolete; use `ARCHITECTURE.md`.

## Phase 2 starting point

1. Event bus + migration **DONE** (combat, units, economy, territory, match).
2. Deduplication **DONE** (prop geometry, minimap layout, faction slots, `GAME_VERSION`).
3. Data-driven balance tables **DONE** (`RANK_STATS`, `UNIT_CAPS`, `SLASH`, `PISTOL`).
4. Explicit worldgen RNG **DONE** (`withSeed` removed; `Math.random()` blocked in `src/world/`).
5. **DONE:** AI decisions extracted to `sim/ai.js`.
6. Extend tests and keep the game playable/tests green after every commit.

---

> Historical plan below. The **Status** section above is authoritative; items in the original
> text may already be done.# Mafia 2D — Architecture Refactor Plan (executor handoff)

Execute phases **in order, one at a time**. Do not skip verification steps.

## GOLDEN RULE — never break the game

**Every step (every commit) must leave the game playable, deployable to GitHub Pages,
and the automated tests green.** The user manually tests along the way; at ANY commit
they must be able to deploy and play.

**Workflow constraints (from the user):**
- **Always work on a branch** (never directly on `master`).
- **Never commit or push without explicit user approval.** Leave changes in the working
  tree and stop after each phase.
- **Pause after every phase** and let the user manually validate before starting the
  next phase. The phase is not "done" until the user says so.

- Work in small, commit-sized steps. Never leave the repo in a half-wired state at a
  commit. If a step is too big to verify confidently, split it.
- **Definition of done for EVERY step:**
  1. **Quick smoke** passes (see below) — game loads and plays over http.
  2. `tests/tests.html` opens and ALL automated tests pass (the suite grows as modules
     are extracted; it must never be red at a commit).
  3. No new console errors.
  4. Commit with a descriptive message.
- **Quick smoke (~1 min):** serve over http → page loads, setup modal renders → launch
  single player → move (WASD + click) → slash → pistol shot → capture one block →
  one economy tick fires → open `tests/tests.html` → all green.
- **MP quick check (two tabs):** required additionally for any step touching `sim/`,
  `net/`, or state shared with multiplayer: host + join via local bus, launch, guest
  moves and shoots, guest recruit toggle reaches host.
- **Full smoke checklist** (Section 3) runs at the END of every phase.
- Phases below are sequences of such steps. Phase 1 uses a strangler pattern: the whole
  script first moves intact into one module, then pieces are extracted one at a time,
  each extraction leaving a working game.

## 0. Context & hard constraints

- Repo: `C:\Users\rodri\Desktop\projects\mafia-2d-minigame` — "Hrodic's Mafia 2D",
  a top-down mafia turf-war game. Currently **everything lives in `index.html`**
  (~6,578 lines: HTML + CSS + one classic `<script>`).
- **ZERO-BUILD / ZERO-INFRA is a hard requirement.** Deploy target is GitHub Pages:
  pure static files only. **No npm, no bundler, no transpilation, no node_modules.**
  - Use **native ES modules** (`<script type="module">`) with **relative imports that
    include the `.js` extension** (e.g. `import { state } from './core/state.js'`).
  - Tailwind stays as the CDN `<script src="https://cdn.tailwindcss.com">` (runtime, no build).
  - Trystero stays a runtime dynamic `import()` from esm.sh/jsDelivr (already in code).
  - Tests are a **zero-dependency browser page** (`tests/tests.html`), not vitest/jest.
  - Type safety via JSDoc + `// @ts-check` + `jsconfig.json` (editor-only, no tooling).
- Local dev after Phase 1 requires a static server (`python -m http.server` or VS Code
  Live Server). `file://` will NOT work with ES modules — document this in README.
- Keep all existing DOM element **ids unchanged** until a phase explicitly moves markup.
- Keep the MP protocol version string `BETA.2026.11.26` unchanged until Phase 4 changes
  the wire format; bump it there (single source of truth).
- Preserve behavior: this is a refactor, not a rebalance. All gameplay numbers stay
  identical unless a step explicitly says otherwise.

## 1. Current code map (index.html line ranges)

| Lines | Content |
|---|---|
| 1–578 | HTML: HUD header, canvases, setup/lobby modal, victory/defeat/disconnect banners, toast |
| 579–621 | Audio context, master/music gains, `ensureAudioContext/getAudioCtx/getAudioDest` |
| 623–877 | `musicEngine` (2 procedural noir tracks, scheduler) |
| 879–1150 | SFX distance attenuation + `sfx` object (slash/armor/gunshot/ricochet/death/eliminated/victory) |
| 1152–1264 | FX arrays (blood, decals, tracers, casings, sparks, arcs, flashes, bodies) + spawn functions |
| 1266–1511 | Constants, `createMulberry32/hashChunkSeed/withSeed`, income tiers, costs, enums (`TileType/PropType/Faction/UnitRank`), `ORGANIZATIONS`, `FACTION_META`, org-selection state, `getUnitCaps`, `rollDamage` |
| 1516–1828 | `DistrictChunk` (seeded generation, solid mask, render lists, `drawGroundDirect`) |
| 1833–2002 | `packChunkKey`, `CityMap` (chunk store, tile queries, `canMoveTo`, `expandPerimeterRing`) |
| 2004–2085 | Canvas refs, `world`, treasuries/factionAlive/player/camera/mouse/npcs/etc. globals, `getLocalFaction/getLocalBoss/isLocalBossAlive` |
| 2087–2207 | A* tile pathfinder (`computeTilePath`, reused global buffers) |
| 2209–2257 | Minimap cache canvas, `hudEls`, UI flags, spawn caps, recruitment prefs, timers |
| 2259–2404 | Cap reset/clamp, upkeep, collision radius, `canOccupyPosition`, `isPushingFriendly`, floating text, toast, income recalc |
| 2406–2742 | `spawnUnitInChunk`, `recruitUnit`, `checkVictoryCondition`, `eliminateFaction`, `syncRecruitButtonLabels`, `initWorld` |
| 2744–3200 | Combat: `applyDamageToNpc`, 3 slash variants, `traceBulletRay`, accuracy info, `performBossPistolShot` |
| 3202–3422 | `damagePlayerBoss`, armor buy (3 variants), NPC sprint, `updateHumanControlledRivalBoss` |
| 3424–3600 | Keyboard/mouse/minimap input handlers, `screenToWorld` |
| 3602–4147 | `rebuildSpatialBuckets`, `updateVisualParticles`, spectator camera, `processHourlyTick`, **`update(dt)`** (player + NPC AI + steering + capture + tick) |
| 4149–4991 | Rendering: `drawBuilding/drawProp/drawDeadBody/drawCharacter`, `resizeCanvas`, `render`, `renderMinimap`, `updateHUD` |
| 4993–6197 | **`mpNet` IIFE**: transport (Trystero + local bus), lobby, host/guest netcode |
| 6199–6578 | `ensureUniqueOrgs`, setup UI renderers/bindings, HUD button bindings, `openSetupMenu`, `gameLoop`, bootstrap |

## 2. Target architecture

```
index.html            markup only + <script type="module" src="./src/main.js">
styles.css            extracted <style> block
src/
  main.js             composition root: wiring, mode flow, fixed-timestep loop (Phase 3)
  config/
    constants.js      sizes, tick, sprint, ranges, GAME_VERSION (single source)
    enums.js          TileType, PropType, Faction, UnitRank
    balance.js        Phase 2: RANK_STATS + weapon tables (costs/upkeep/income tiers first)
    organizations.js  ORGANIZATIONS, FACTION_META, ALL_ORG_IDS, ALL_FACTION_SLOTS, ensureUniqueOrgs
  core/
    rng.js            mulberry32, hashChunkSeed (Phase 2: remove withSeed)
    events.js         Phase 2: tiny pub/sub bus
    state.js          ALL shared mutable game state as properties of one `state` object
    spatial.js        spatial buckets (rebuild/query)
  world/
    chunk.js          DistrictChunk: seeded generation + tile data
    city.js           CityMap: chunk store, tile queries, canMoveTo, expansion
    geometry.js       Phase 2: prop footprints (car/dumpster rects) — single source
    pathfinding.js    A* (Phase 2: binary heap), map injected
  sim/                NO DOM / audio / net imports. Emits events (Phase 2+).
    match.js          initWorld / match setup
    simulation.js     update(dt) orchestrator
    units.js          spawnUnitInChunk, recruitUnit
    movement.js       collision radius, canOccupyPosition, isPushingFriendly, sprint,
                      updateHumanControlledRivalBoss, (Phase 3: unified moveUnit)
    combat.js         damage, slash, pistol, armor
    ai.js             Phase 2: NPC decision logic extracted from update()
    territory.js      capture, eliminateFaction, checkVictoryCondition
    economy.js        getUnitCaps, upkeep, income, processHourlyTick, cap reset/clamp
    commands.js       Phase 3: unified command dispatcher (local + remote)
  net/
    mpNet.js          Phase 1: whole IIFE as a module. Phase 4 splits into:
    transport.js      Trystero loader + local-bus fallback
    protocol.js       envelopes, version, snapshot encode/decode
    lobby.js          seats/roster state machine
    host.js           command intake, snapshot broadcast, events
    guest.js          snapshot apply/interpolation, input streaming
  render/
    renderer.js       canvas refs, resizeCanvas, render() orchestration
    world.js          drawBuilding/drawProp (+ chunk.drawGroundDirect in Phase 2)
    characters.js     drawCharacter/drawDeadBody
    effects.js        FX arrays + spawn/update API + floating texts
    minimap.js        minimap render + shared layout math
    camera.js         spectator pan (+ follow logic)
  audio/
    engine.js         context, gains, musicEngine; exported toggle/cycle API
    sfx.js            sfx object; listener position read from state.camera
  ui/
    hud.js            hudEls, updateHUD, syncRecruitButtonLabels
    menus.js          setup modal renderers/bindings, banners, toast, openSetupMenu
    lobbyUI.js        Phase 4: host/guest lobby DOM (extracted from mpNet)
    input.js          keyboard/mouse/minimap handlers, HUD action buttons, screenToWorld
tests/
  tests.html          zero-dep runner (created Phase 0, grows every phase)
  *.test.js
  SMOKE.md            manual checklist
jsconfig.json         Phase 5: checkJs + JSDoc support
README.md             Phase 0 rewrite; Phase 5 architecture section
```

### Dependency rule (the core of the refactor)

```
ui/input ──commands──▶ sim ◀──commands── net/host
                        │ events (Phase 2+)
                        ▼
          render/effects · audio · ui/hud · net broadcast
render ◀── reads state        net/guest ──writes──▶ state
```

- `sim/`, `world/`, `core/`, `config/` must NEVER import `ui/`, `render/`, `audio/`,
  `net/` and never touch `document`/`window` (except `core/state.js` holding plain data).
- `main.js` is the only composition root: it imports everything and wires it.
- ESM circular imports: avoid them. If unavoidable, cross-module references must occur
  only inside functions called after load — never read an imported binding at module
  top level in a cycle.

### Two mechanical conventions used throughout Phase 1

1. **Shared state object.** All cross-module mutable globals become properties of one
   exported object in `src/core/state.js`:
   ```js
   export const state = {
     world, treasuries, factionAlive, player, camera, mouse, npcs, floatingTexts,
     spatialBuckets, bucketPool, keys,
     activeFactions, selectedFactionOrgs, activeFactionCount, currentGridSize,
     tickDuration, currentIncomeTier, currentWorldSeed,
     playerSpawnCaps, factionRecruitmentPrefs,
     autoRecruitSoldier, autoRecruitCaptain, autoRecruitUnderboss,
     gameStarted, isSpectating, showBorders, allowClickExpand,
     gameOver, victoryShown, tickTimer, gameHour, hudUpdateTimer,
     nextNpcId, astarBudgetThisFrame, minimapCacheTimer,
     net: null, // set by main.js (convention 2)
   };
   ```
   Every module does `import { state } from '.../core/state.js'` and uses `state.player`,
   `state.tickTimer += dt`, etc. Objects/arrays keep identity (mutate properties, don't
   reassign the property unless the original code reassigned the global — then
   `state.activeFactions = [...]` is fine because everyone reads through `state`).
   - `FACTION_META` stays a `const` object in `config/organizations.js` (initWorld only
     assigns properties `FACTION_META[slot] = ...`, identity is stable).
   - Audio state (`soundEnabled`, `musicEnabled`, `currentMusicTrack`, gains) becomes
     private to `audio/engine.js` behind an API (`setSoundEnabled`, `cycleMusicTrack`,
     `ensureAudioContext`, ...). UI handlers call the API instead of mutating globals.
   - FX arrays live in `render/effects.js`, exported, with `resetEffects()` used by
     `initWorld`. `mpNet` guest code calls exported spawn functions instead of pushing
     into raw arrays where practical (pushing into exported arrays is also acceptable
     in Phase 1).
   - Canvas/ctx/minimap refs + `hudEls` live in `render/renderer.js` / `ui/hud.js`
     respectively and are exported where other modules need them (input needs canvas).
2. **Net bridge.** Game code must not import `mpNet` (avoids the sim↔net cycle).
   `main.js` sets `state.net = mpNet` at startup. Mechanically replace:
   - `typeof mpNet !== 'undefined' && mpNet.X(...)` → `state.net && state.net.X(...)`
   - bare `mpNet.X(...)` in game/UI code → `state.net.X(...)` (keep null-guards where
     the original had them; in practice `state.net` is always set before gameplay).
   `net/mpNet.js` imports game functions/state directly (one direction only).

## 3. Phase 0 — Documentation & baseline

1. Rewrite `README.md`: game overview/goals, gameplay & hierarchy tables, controls,
   tech stack (Canvas 2D, Tailwind CDN, Web Audio synthesis, Trystero P2P + local bus,
   host-authoritative snapshots ~12 Hz / input ~16 Hz, seeded mulberry32 worldgen),
   how to run (static server requirement after Phase 1), current single-file code map,
   known limitations. (Content was already drafted in conversation — reuse it.)
2. Create the manual smoke checklist below as `tests/SMOKE.md` (or README section).
3. Create `tests/tests.html`: a zero-dependency test runner page (plain JS: `assert`,
   `test(name, fn)`, green/red result list, imports test modules via
   `<script type="module">`). Start with trivially-passing sanity tests so the suite
   exists and is green from day one. It grows with every extraction step.
4. Play through the checklist once on the CURRENT monolith to establish a baseline;
   open tests.html → green.
5. Commit: `docs: document game, tech stack, baseline + test harness`.

### Smoke checklist (run after EVERY phase)

- [ ] Serve over http; open page; no console errors; setup modal renders (Tailwind works).
- [ ] Single player: launch 15×15 default; boss moves (WASD + click-to-move + minimap);
      sprint works with cooldown; slash (Space/F) kills soldiers; right-click pistol
      fires with tracer/accuracy label; Q buys armor; blood/corpses/floating text show.
- [ ] Capture a neutral block (progress bar → tint change); income tick fires after 10s;
      auto-recruit spawns crew; caps +/- buttons and toggles work; standings board updates.
- [ ] Expand Ring adds blocks; Click-Build toggle works; Borders toggle works.
- [ ] Kill a rival boss → toast + their turf neutral; kill all → victory banner;
      let your boss die → defeat banner → spectate pans camera → New Game returns to menu.
- [ ] Music cycles Noir I → Noir II → OFF; SFX toggle works.
- [ ] Multiplayer (two tabs, same origin → local bus): Host creates room, guest joins via
      `RoomCode:Secret`; lobby seats/AI toggles sync; launch; guest boss moves/attacks via
      host simulation; guest recruit toggles reach host; guest disconnect → AI takeover
      toast; host disconnect → guest disconnect banner.
- [ ] Invite URL `?room=CODE&secret=SECRET` auto-fills join panel.
- [ ] New Game from HUD resets cleanly (no stale units/turf/timers).

## 4. Phase 1 — Mechanical ES-module split (NO behavior change)

Goal: `index.html` becomes markup + module entry; all JS lives in `src/` per the tree.
Only allowed logic edits: the two conventions from Section 2 (state object, net bridge)
and passing generation context into `DistrictChunk`.

**Strangler sequence — each numbered step is ONE commit ending in a playable game,
green tests, and quick smoke passed.** Until a piece is extracted, it simply stays in
`src/main.js`; extracted modules import `state`/config, and `main.js` imports them.
Never extract a module and leave its old copy active in `main.js` (double definitions).

**Step 1.1 — Whole-script move (game still identical).**
Move the `<style>` block to `styles.css` (link it). Copy the ENTIRE inline `<script>`
verbatim into `src/main.js`; replace it in `index.html` with
`<script type="module" src="./src/main.js"></script>`. Keep Tailwind CDN + all markup/ids.
Everything still shares one module scope, so behavior is unchanged (there are no inline
HTML event handlers; module scripts are deferred, DOM is ready — the `load` listener may
stay). Quick smoke + commit. From now on, local dev needs http (document in README).

**Step 1.2 — config/ + core/rng.js.**
Extract `config/constants.js` (CHUNK_SIZE…DEFAULT_TICK_DURATION, SPRINT_*,
MAX_PISTOL_RANGE, SFX radii, MAX_* caps), `config/enums.js` (TileType/PropType/Faction/
UnitRank), `config/organizations.js` (ORGANIZATIONS, FACTION_META, ALL_ORG_IDS,
ALL_FACTION_SLOTS, `ensureUniqueOrgs`), `config/balance.js` (INCOME_TIERS, COST_*,
UPKEEP_*, BOSS_MAX_HP, MAX_BOSS_ARMOR, UNIT_ATTACK_COOLDOWN — flat constants for now),
`core/rng.js` (createMulberry32, hashChunkSeed, withSeed — kept until Phase 2).
`main.js` imports them; delete the moved definitions. Add tests: RNG determinism,
`ensureUniqueOrgs` uniqueness. Quick smoke + tests + commit.

**Step 1.3 — core/state.js (single atomic commit).**
Create the `state` object per Convention 1 and move ALL shared mutable globals into it;
mechanically rewrite every reference in `main.js` (still one file, so this is a
self-contained rename: `player.x` → `state.player.x`, `tickTimer += dt` →
`state.tickTimer += dt`, etc.). Keep object identities; `FACTION_META` stays in
organizations.js (property mutation only). Move `getLocalFaction/getLocalBoss/
isLocalBossAlive` into state.js. `mpNet` is still inside main.js — leave it.
Quick smoke (careful: this touches everything) + tests + commit.

**Step 1.4 — world/ + core/spatial.js.**
`world/chunk.js`: DistrictChunk; constructor takes `{ seed, gridSize, incomeTier,
activeFactions }` instead of reading globals (CityMap.generateChunk passes from state).
Keep `drawGroundDirect` as a method for now. `world/city.js`: packChunkKey + CityMap.
`world/pathfinding.js`: computeTilePath + reused buffers (algorithm identical).
`core/spatial.js`: rebuildSpatialBuckets. Add tests: same-seed chunk determinism,
walkability, A* path around buildings. Quick smoke + tests + commit.

**Step 1.5 — audio/.**
`audio/engine.js`: context/gains/musicEngine + exported API (ensureAudioContext,
getAudioCtx, getAudioDest, setSoundEnabled, cycleMusicTrack, …); audio globals become
module-private; main.js handlers call the API. `audio/sfx.js`: attenuation + sfx
(reads state.camera). Quick smoke (sound/music toggles!) + tests + commit.

**Step 1.6 — render/effects.js.**
FX arrays, spawn* functions, addFloatingText, updateVisualParticles, `resetEffects()`
(used by initWorld). Exported arrays may still be pushed into by main.js/mpNet code.
Quick smoke (combat visuals) + tests + commit.

**Step 1.7 — sim/ extraction (one commit per file, each verified).**
Order: `sim/movement.js` (collision radius, canOccupyPosition, isPushingFriendly,
updateNpcBossSprint, updateHumanControlledRivalBoss) → `sim/economy.js` (getUnitCaps,
cap reset/clamp, upkeep, income recalc, processHourlyTick) → `sim/units.js`
(spawnUnitInChunk, recruitUnit, rollDamage) → `sim/territory.js` (checkVictoryCondition,
eliminateFaction — DOM/sfx calls stay inline until Phase 2) → `sim/combat.js` (all
damage/slash/pistol/armor functions) → `sim/match.js` (initWorld) → `sim/simulation.js`
(update(dt) + NPC loop). After economy/units: add tests for upkeep/income math,
accuracy bands, recruitment caps. Quick smoke after EACH; MP quick check after
combat/simulation. Commit each.

**Step 1.8 — render/ (one commit per file or small group).**
`render/renderer.js` (canvas/ctx/minimap refs exported, resizeCanvas, renderables,
render), `render/world.js` (drawBuilding/drawProp), `render/characters.js`
(drawCharacter/drawDeadBody), `render/minimap.js` (cache + renderMinimap),
`render/camera.js` (updateSpectatorCamera). Quick smoke + commit.

**Step 1.9 — ui/ (one commit per file).**
`ui/hud.js` (hudEls, updateHUD, syncRecruitButtonLabels), `ui/menus.js` (showToast,
renderFactionSlotsUI, updateMapSizePreview, setup-modal bindings, openSetupMenu, banner
bindings), `ui/input.js` (key/mouse/minimap handlers, screenToWorld, HUD action buttons,
pushRecruitPrefsToHost). Quick smoke + commit.

**Step 1.10 — net/mpNet.js + net bridge.**
Convert the IIFE to a module exporting the same public API; it imports state/sim/
effects/audio/ui directly. In main.js set `state.net = mpNet`; apply Convention 2
(`typeof mpNet !== 'undefined' && mpNet.X` → `state.net && state.net.X`, etc.).
**Full MP quick check + full smoke checklist** (this is the riskiest step). Commit.

**Step 1.11 — main.js becomes pure wiring.**
Only bootstrap/wiring/loop should remain (invite-URL detection, resize listener, rAF
loop, state.net assignment). Sweep for leftover bare globals and missing `.js`
extensions; verify no top-level reads in import cycles. Full smoke checklist. Commit.
Then deploy to GitHub Pages and smoke-test the deployed URL (validates paths/MIME early).

## 5. Phase 2 — Decouple side effects & deduplicate

Goal: `sim/` becomes DOM-free and audio-free; duplication removed; balance data-driven.
**Each numbered step is one verified commit** (quick smoke + tests green; MP quick check
for steps touching sim). If a step feels too large, split it — never commit red.

1. **core/events.js**: tiny bus (`on(evt, fn)`, `emit(evt, payload)`), no deps.
2. Define events and move side effects out of sim into subscribers (wire in `main.js`):
   - `damage` {x, y, amount, absorbed, killed, hitAngle, targetKind} → effects
     (blood/sparks), hud floating texts, audio.
   - `unitDied` / `bossDied` {unit} → effects (dead body), audio (death), territory
     elimination stays in sim but emits `factionEliminated` → ui banners/toast, audio,
     net broadcast.
   - `slash` {x, y, facing, color, hit} → effects arc + audio.
   - `shot` {muzzle, end, color, shooter, missed, envHit} → effects (tracer, casing,
     flash, sparks), audio (gunshot/ricochet), net/host SHOT broadcast (replaces the
     inline `mpNet.broadcastEvent` in combat).
   - `armorEquipped` / `armorBroken` {unit} → audio + floating text.
   - `turfCaptured` {chunk, faction} → floating text + minimap dirty flag + HUD refresh.
   - `recruited` {unit, cost} → floating text (silent flag respected).
   - `hourTick` {hour} → HUD refresh + minimap dirty.
   - `victory` {summary} / `defeat` {faction} → ui banners + audio.
   - `toast` {msg} → ui/menus.
   Sim functions now ONLY mutate state + emit. `updateHUD()` calls inside sim
   (eliminateFaction, capture, tick) are removed; HUD subscribes / polls as today.
3. **world/geometry.js**: single source for car/dumpster footprint rects; use it in
   `city.canMoveTo`, `combat.traceBulletRay`, `render/world.drawProp` (and chunk parking
   shadow if applicable). Verify identical collision behavior.
4. **render/minimap.js**: export `getMinimapLayout()`; use in both renderMinimap and the
   minimap click handler (ui/input).
5. **Faction slots**: one `getActiveSlotsForCount(count)` helper (config or state) used
   by `initWorld` AND mpNet lobby. **GAME_VERSION**: move to `config/constants.js`;
   ui sets the header/modal badge text from it; mpNet imports it.
6. **config/balance.js**: build `RANK_STATS` table:
   `{ hp, startArmor, maxArmor, minDmg, maxDmg, speed (ai/human), bodyRadius, cost,
   upkeep, capShare, captureRate }` for BOSS/UNDERBOSS/CAPTAIN/SOLDIER, plus weapon
   constants (slash reach 52 / maxTargets 3 / cooldowns 0.34 & 1.0 / knockback 14 & 12;
   pistol range 1000 / dmg 40–80 / human cooldown 0.65 / accuracy bands). Replace the
   inline ternaries in `spawnUnitInChunk`, capture rates in simulation, combat constants.
   Values must remain EXACTLY as today.
7. **Explicit RNG**: remove `withSeed` (Math.random monkey-patch). `DistrictChunk`
   generation takes an `rng` function (mulberry32 from chunk seed); `CityMap` passes it.
   Gameplay randomness may keep `Math.random` for now (host-only), but route combat
   damage rolls through `rollDamage(rng, min, max)` with an injectable rng defaulting to
   Math.random so tests can seed it.
8. **sim/ai.js**: extract NPC decision block (aggro scan, target selection, patrol chunk
   choice, armor-buy decision) from `update()` into functions; `simulation.js` keeps
   orchestration + movement application. No behavior change.
9. **render/world.js**: move `drawGroundDirect` off DistrictChunk into the renderer
   (chunk keeps pure data). 
10. Extend `tests/tests.html`: RNG determinism, chunk generation determinism (same seed →
    identical tiles), pathfinding around buildings, accuracy band table, upkeep/income
    math. (Harness exists since Phase 0; suite must be green at every commit.)
11. Full smoke checklist + tests pass. Commit: `refactor: event-driven sim, dedup, data-driven balance`.

## 6. Phase 3 — Unified entity model, state factory, commands, fixed timestep

Goal: remove the player special-case; one code path per mechanic; clean match reset.
**This is the riskiest phase — do it as the small verified commits below, in order.
The game must play identically after each one.**

**Step 3.1 — createGameState(config)** in `core/state.js`: returns a fresh state object
(today's initial values). `initWorld` becomes: build config → copy fresh values onto the
exported `state` (identity preserved for importers) → generate chunks → spawn bosses.
No scattered manual resets. Verify New Game / restart flows + commit.

**Step 3.2 — Give the player unit fields.** Add `id: 0, faction: Faction.PLAYER,
rank: UnitRank.BOSS, control: 'local', bodyRadius` to the player object (it stays a
separate object for now). Fixes the latent `player.faction` undefined read. Verify + commit.

**Step 3.3 — Unify damage.** Make `damagePlayerBoss` delegate to `applyDamageToNpc`
(handle the player case: not in npcs array, elimination on death). One damage pipeline.
Verify (both directions: you kill, you die) + commit.

**Step 3.4 — Unify slash.** One `performSlash(attacker, params)`; the 3 existing variants
delegate to it. Preserve the small differences as parameters (human cooldown 0.34 vs AI
1.0, arc 0.42 vs 0.45, knockback 14 vs 12). Verify + commit.

**Step 3.5 — Unify movement + sprint.** One `moveUnit(unit, input, dt)` + one sprint
updater used by local player, AI steering result, and remote-human boss. Verify
(all three control types: solo, AI bosses, MP guest) + commit.

**Step 3.6 — Fold player into npcs.** The local boss becomes a unit in `state.npcs` with
`control: 'local'`; `state.player` becomes an alias to that unit. **Audit EVERY site
that iterates npcs or special-cases the player** (checklist):
- upkeep calc, crew counts (HUD standings), recruit count filters, victory crew count
- spatial buckets rebuild; `canOccupyPosition` / `isPushingFriendly` player special cases
  (now just another unit; keep same-faction pass-through semantics)
- AI enemy scan (`player.alive` block), pistol target scan, slash candidate lists
- snapshot build (`playerBoss` section) + guest apply; guest dead-body diffing
- render (player renderable + label "(YOU)"), minimap player dot, camera follow,
  `getLocalBoss`, defeat/spectator triggers, `initWorld` spawn/reset
Keep the wire format unchanged (`playerBoss` still serialized separately if simplest).
Full smoke checklist + two-tab MP + tests. Commit.

**Step 3.7 — sim/commands.js.** `dispatchCommand(faction, payload)` generalizes
`processRemoteCommand`. Local UI/input handlers build the SAME command objects and
dispatch when host/single; when guest, `state.net.sendCommand(payload)`. The isGuest
branch lives ONLY at the input→command boundary; remove it from combat/input internals.
Verify solo + MP (every command: move, slash, shoot, armor, recruit prefs, expand,
build) + commit.

**Step 3.8 — Fixed timestep.** Accumulator in main.js: `SIM_DT = 1/60`, clamp frame delta
(max ~0.25s), N sim steps per rAF, render once. Guest interpolation/camera/HUD timers use
render dt. Fix minimap's hardcoded `+= 0.016` → real dt. Verify feel (speeds/cooldowns
unchanged) + MP + commit.

**Step 3.9 — Tests.** Headless simulation smoke test (seeded state, 600 steps: no NaN,
units walkable, tick math, capture completes, boss death eliminates faction). Command
dispatch tests (local == remote outcomes). Full checklist. Commit.

## 7. Phase 4 — Netcode hardening

**Each numbered step is one verified commit with the MP quick check passed** (two-tab
local bus at minimum). Split the mpNet decomposition (step 1) into sub-commits — e.g.
transport first, then protocol, then lobby/host/guest, then lobbyUI — each leaving
multiplayer fully working. Never commit a half-split mpNet.

1. Split `net/mpNet.js` into `transport.js` (Trystero URLs/loader + `createLocalBusRoom`),
   `protocol.js` (envelope, GAME_VERSION import, snapshot encode/decode),
   `lobby.js` (peers/seats/roster logic, UI-agnostic), `host.js`, `guest.js`.
   Extract lobby DOM into `ui/lobbyUI.js` (subscribe to lobby state; no DOM in net/).
2. **Snapshot apply O(n²) fix**: build `Map<id, unit>` once per snapshot; reuse unit
   objects; remove dead units via set diff (as today).
3. **Chunk deltas**: INIT_MATCH carries full chunk list; periodic snapshots carry only
   chunks whose faction/captureProgress/capturingFaction changed since last send (host
   tracks dirty set; capture progress changes mark dirty). Full resync every ~5s as
   safety. Guest applies deltas; unknown chunk → generate from seed as today.
4. **Security**: peer names must never go into `innerHTML` unescaped. Use `textContent`
   / DOM construction in lobby UI, standings board, labels (canvas fillText is safe).
   Audit every template string that interpolates network data.
5. **Hidden-host resilience**: when `document.hidden`, drive the host loop with
   `setInterval` (~16ms) fallback so backgrounded host tabs don't stall the match;
   return to rAF on visibility. (No Web Worker needed; keep zero-infra.)
6. Bump `GAME_VERSION` (wire format changed) — update constants + HTML badges via ui.
7. Verify: two-tab MP full checklist, invite URL, version-mismatch rejection, peer
   disconnect mid-match (AI takeover), host disconnect banner, hidden-tab host keeps
   simulating (guest in foreground tab observes continued motion).
8. Commit: `refactor: protocol module, delta snapshots, netcode hardening`.

## 8. Phase 5 — Quality gates & docs

1. Expand `tests/`: snapshot encode/decode round-trip, delta apply, territory capture
   rates per rank, recruitment caps/clamps, victory/elimination flow, command validation
   (malformed remote payloads ignored). Runner: plain JS, green/red list in tests.html,
   zero dependencies.
2. JSDoc types on public module APIs + `// @ts-check` where clean; add `jsconfig.json`
   (`checkJs: true`, strict null checks as feasible). No npm involved.
3. README: final architecture diagram, module map, dependency rule, how to run tests,
   how to deploy (GitHub Pages, root `index.html`), how to add content (new org/rank/
   weapon via balance tables).
4. Deploy to GitHub Pages; run smoke checklist against the deployed URL (module MIME,
   relative paths, Trystero CDN, invite links).
5. Commit: `chore: tests, typed APIs, architecture docs`.

## 9. Pitfalls & known bugs (fix at the indicated phase)

- `player.faction` is read (line ~3959) but never defined — latent bug; Phase 3 removes it.
- Peer names → `innerHTML` (lobby roster, standings, guest assigned faction): XSS vector;
  Phase 4 (may fix earlier in ui if trivial — use textContent).
- `eliminateFaction` triggered from guest snapshot apply re-runs DOM/toast/sfx side
  effects and double-sets factionAlive; Phase 2 events + Phase 4 guest apply must make
  guest-side elimination effects event-driven and idempotent.
- `withSeed` patches global Math.random — Phase 2 removes.
- A* open list is a linear-scan array; fine at 180 nodes; optional binary heap in Phase 2.
- `getLocalBoss()` allocates a fallback object every call when boss dead — Phase 3 cleanup.
- Minimap cache timer advances by hardcoded 0.016 per render — Phase 3.
- Host tab backgrounded → rAF throttled → whole MP match stalls — Phase 4.
- ESM gotchas: imports need `.js`; no top-level reads in import cycles; module scripts
  are deferred (DOM ready); `file://` blocked — always test over http.
- Do NOT change gameplay numbers during Phases 1–3 except where a step says to encode
  existing differences as parameters.

## 10. Out of scope (do not do)

- No npm/build/bundler/TypeScript transpilation, no frameworks, no asset pipeline.
- No gameplay rebalancing, new features, or visual redesign.
- No Web Workers / server infrastructure.
- No changes to Tailwind CDN usage (precompiled CSS is a possible future task, not now).
# Architecture

Hrodic's Mafia 2D is a zero-build static browser game. This document explains how the
code is organized, how the main systems interact, and where to add features safely.

## Hard constraints

- **Zero-build source, no npm install.** Development serves the repository root directly;
  GitHub Pages publishes the generated `docs/` artifact. Everything uses **native ES
  modules** with relative imports that include the `.js` extension. `tools/build-pages.ps1`
  minifies each module with a local esbuild binary (no bundling) and copies `index.html`,
  `styles.css` and `.nojekyll` into `docs/`.
- Third-party code is loaded at runtime from CDNs: Tailwind (`cdn.tailwindcss.com`) and
  Trystero (esm.sh/jsDelivr). No local runtime dependencies.
- The game must stay playable and the test suite green at every commit.

## Directory layout

```
index.html                 markup shell (HUD, canvases, modals, banners)
styles.css                 custom CSS (Tailwind remains on its CDN)
src/
  main.js                  thin composition root: net bridge, event wiring, loop, bootstrap
  config/
    constants.js           tile/chunk sizes, tick/sprint/pistol tuning
    version.js             GAME_VERSION single source (title/labels/net handshake)
    enums.js               TileType, PropType, Faction, UnitRank
    balance.js             RANK_STATS, UNIT_CAPS, SLASH, PISTOL, income/cost tables
    organizations.js       6 organizations, FACTION_META, slot helpers, ensureUniqueOrgs
  core/
    rng.js                 mulberry32, chunk seed hashing, explicit per-chunk RNG
    state.js               `createGameState()` reset factory, shared `state`, selectors
    fixedStep.js           accumulator: fixed sim steps + catch-up guard
    hiddenSim.js           hidden-tab host simulation fallback (no rendering)
    events.js              synchronous, isolated event bus (sim -> presentation facts)
    spatial.js             per-chunk spatial buckets for neighbour queries
  world/
    chunk.js               DistrictChunk: seeded 15×15 block generation
    city.js                CityMap: chunk store, tile queries, collision, ring expansion
    geometry.js            prop footprints (collision + raycast + drawing source)
    pathfinding.js         A* over tiles with a per-frame budget
  sim/                     headless gameplay logic (no DOM, no audio)
    match.js               initWorld: city/factions/economy/bosses for a new match
    simulation.js          update(dt): headless host/single-player fixed sim step
    ai.js                  NPC perception, attacks, patrol goals, A* steering, capture
    movement.js            moveUnit/sprint, collision, remote-human boss, waypoint steering
    units.js               caps, spawning, recruitment
    combat.js              damage/armor, slashes, pistol raycast, armor purchases
    regen.js               friendly-turf HP regeneration, suppressed by hit flash
    territory.js           capture progress, elimination, victory
    economy.js             upkeep, income, hourly tick and auto-recruitment
    commands.js            dispatchCommand: local + remote action entry point
  net/
    transport.js           Trystero 0.27 loader + curated Nostr relays + local bus
    invite.js              short invite code formatting/parsing + fragment links
    protocol.js            message types, versioned envelope, snapshot encode/decode
    lobby.js               UI-agnostic seats, capacity and roster snapshots
    guest.js               guest join/lobby/snapshot/input controller
    host.js                host lobby/snapshot/input controller
    mpNet.js               composition root for host + guest multiplayer
  render/
    canvas.js              shared canvas/context references (guarded for tests)
    renderer.js            frame orchestration: culling, depth sort, layers, ground LRU cache
    world.js               cached building sprites, roof details, window lights, props
    weather.js             day/night lamps, ambient tint, capped noir rain
    characters.js          characters + corpses
    effects.js             blood/decals/tracers/casings/sparks/floating text
    backdrop.js            subtle city pattern outside the playable chunks
    combatFx.js            event subscribers: combat facts -> visual effects
    recruitFx.js           event subscriber: unit:recruited -> floating text
    territoryFx.js         event subscriber: chunk:captured -> turf text + radar
    minimap.js             cached radar layer + live dots/viewport
    minimapLayout.js       bounds/cell math shared by radar drawing + click mapping
    interpolation.js       guest-side position smoothing + animation timer decay
    presentation.js        guest frame step, local aim, camera/spectate, particles
  audio/
    engine.js              AudioContext, gains, procedural noir music scheduler
    sfx.js                 synthesized SFX with distance attenuation
    combatSfx.js           event subscribers: combat facts -> SFX
  ui/
    hud.js                 primary status, crew management, leaderboard
    lobbyUI.js             host/guest lobby renderers (safe DOM, no peer-name innerHTML)
    actionBar.js           bottom combat bar: readiness, cooldowns, costs
    hudCadence.js          presentation cadence (4 Hz HUD refresh) driven by main.js
    version.js             applies GAME_VERSION to title + HUD/modal labels
    menus.js               setup modal tabs, crew limits, lobby buttons, toast, map-size controls
    input.js               keyboard/mouse/minimap + HUD action bindings
    commandBridge.js       input boundary: guests stream, host/single dispatch
    support.js             top-bar Tip me -> Ko-fi popup (fallback link)
tests/
  tests.html               zero-dependency test runner page
  harness.js               test/assert helpers + results UI
  *.test.js                suites (config, state, world, sim, render, UI, net-adjacent)
  mp-harness.html          iframe harness that forces the same-origin local bus
  SMOKE.md                 manual smoke checklist (per commit / per phase)
docs/                      generated GitHub Pages artifact (never hand-edit)
tools/
  serve.ps1                dependency-free PowerShell static server for local dev
  check.ps1                static health check (imports, test registry, duplicate ids)
  typecheck.ps1            native tsc.exe check via jsconfig.json; compiler is ignored
  build-pages.ps1          minify src -> docs with esbuild (no bundling); binary is ignored
.editorconfig              editor whitespace/line-ending rules
jsconfig.json              editor type-check config (checkJs opt-in via // @ts-check)
.nojekyll                  GitHub Pages: serve files untouched
EVENTS.md                  event-bus contract (implemented)
ARCHITECTURE.md            this document
AGENTS.md                  contributor workflow contract
.opencode/skills/          task skills: SKILL.md + references/ (OpenCode discovery)
PLAN.md                    phased refactor plan and status
```

## Layering and dependency direction

```
config → core → world → sim / render / audio / net → ui → main
```

- `sim/` must never import `ui/`, `render/`, `audio/` or `net/`, and must not touch the
  DOM. It mutates `state` and emits events; presentation subscribes in `main.js`.
- `render/` reads state and draws; it does not mutate gameplay state.
- `ui/` owns the DOM and translates input into state changes/commands.
- `net/` owns the multiplayer state machine and drives `sim/match`/`sim/simulation` on
  the host.
- `main.js` is the only place that wires all layers together.

ESM cycles are avoided. If one is unavoidable, cross-module references must only happen
inside functions called after module evaluation (never at top level).

## Composition root and lifecycle

`src/main.js`:

1. Creates the single `CityMap` instance (`state.world`).
2. Sets `state.net = mpNet` (the net bridge; see below).
3. Wires event subscribers and the HUD cadence (`ui/hudCadence.js`).
4. Starts the rAF loop when `state.gameStarted`: fixed `1/120` simulation steps through an
   accumulator (frame delta clamped to `0.25s`, max `8` catch-up steps), then one
   presentation pass (camera/particles) and one render with render dt. Guests skip fixed
   steps and run `updateGuest(renderDt)` once per frame.
5. When the tab is hidden, `core/hiddenSim.js` runs host/single-player fixed steps from a
   timer without rendering; rAF resumes and the accumulator resets when visible. Guests
   never simulate. Browsers may still throttle background timers.
6. Boots UI/input (`applyVersionLabels`, `initMenus`, `initInput`) and setup renderers.
7. Reads short invite codes from the URL fragment (`#code=...`) and legacy
   `?room=&secret=` links, then pre-fills the join panel.

### Net bridge

`core/state.js` selectors (`getLocalFaction`, `getLocalBoss`, `isLocalBossAlive`) read
`state.net`. This lets gameplay code work identically in single-player and multiplayer
without importing the net module (which would create a cycle).

### HUD cadence

`ui/hudCadence.js` owns the 4 Hz HUD refresh. `main.js` calls it once per frame after
`update(dt)` and before `render()`. The simulation no longer owns presentation cadence.

Combat, units, economy, territory, match and AI use events for discrete presentation;
`core/runtime.js` has been removed. `sim/simulation.js` is headless; guest smoothing, aim,
camera and particles live in `render/presentation.js`.

### Event bus (Phase 2)

`core/events.js` is a synchronous, isolated bus. `main.js` wires subscribers once; `sim/`
emits and never imports presentation layers. Combat, units, economy, territory and match are
migrated: visuals live in `render/combatFx.js`, `render/recruitFx.js`,
`render/territoryFx.js`; audio in `audio/combatSfx.js`; toasts/HUD/banners/net/match reset in
`main.js`. Benefits, tradeoffs, when to use/skip, and the full performance budget are in
`EVENTS.md`.

`tools/check.ps1` enforces this as a ratchet: `sim/` may not import `render/`, `audio/`,
`ui/` or `net/`. Phase 3 cleared the last allowlist; the check now reports `sim headless`.

The non-negotiable rule: **discrete facts only** — never per-frame or per-NPC-per-frame.
Continuous visuals (positions, HP bars, timers, interpolation) are read from `state` during
render. Events never carry authoritative state or replication; snapshots remain the source
of truth.

## State model

`core/state.js` owns one exported `state` object plus a `createGameState(config)`
factory that is the single source for a fresh match. `config` carries the setup values
(grid, tick, income tier, faction count, org roster, seed, auto-start) and the long-lived
`world`/`net` references. `initWorld` builds that config, copies the fresh values onto the
exported singleton with `Object.assign` — importers keep the same identity, and the
`CityMap`/net bridge survive — then regenerates chunks and spawns bosses.

The match state holds:

- world/entities: `world`, `npcs`, `floatingTexts`, `spatialBuckets`, `nextNpcId`
- factions/economy: `treasuries`, `factionAlive`, `factionKills`, `factionDeaths`
- local boss: `player` (unit identity fields `id`/`faction`/`rank`/`control`/`bodyRadius`),
  `camera`, `mouse`, `keys`
- match config: `activeFactions`, `selectedFactionOrgs`, `activeFactionCount`,
  `currentGridSize`, `tickDuration`, `currentIncomeTier`, `currentWorldSeed`
- recruitment: caps + per-faction preferences
- flags/timers: `gameStarted`, `gameOver`, `victoryShown`, `gameHour`, `tickTimer`,
  `hudUpdateTimer`, `minimapCacheTimer`, `isSpectating`, ...
- `net`: the multiplayer module (set by `main.js`)

The local player is a singleton (`state.player`) rather than an entry in `state.npcs`;
both share the same unit shape (`id`/`faction`/`rank`/`control`/`bodyRadius`). Systems that
need every combatant use the explicit `forEachUnit` view or `getUnitById`; NPC-only systems
keep using `state.npcs`, so crew/upkeep/recruitment counts cannot accidentally include the
player. `playerBoss` remains the single player channel on the wire.

`sim/match.js:initWorld` sets the world generation context, builds chunks, spawns rival
bosses and positions the camera. At the end it emits `match:initialized`
(`{ tickDuration, worldSeed }`); `main.js` subscribers reset effects, setup UI, recruit
labels, seed display and HUD.

## World

- **DistrictChunk** (`world/chunk.js`) generates a 15×15 block from six archetypes with
  buildings, alleys, plazas, cars, dumpsters, streetlights and trees. Generation is
  deterministic from a world seed + chunk coordinates via an explicit
  `createMulberry32(hashChunkSeed(...))` stream (no global `Math.random` mutation), so host
  and guests build identical cities. Chunks precompute a solid mask and static render lists.
- **CityMap** (`world/city.js`) stores chunks, answers tile queries
  (`worldToTile`, `isWalkable`, `isTileNavigable`), does radius collision
  (`canMoveTo`), snaps to nearest walkable points, and expands perimeter rings.
- **Pathfinding** (`world/pathfinding.js`) is A* over tiles with a per-frame exploration
  budget (`MAX_ASTAR_PER_FRAME`). It is used by the NPC AI and by waypoint movement
  (local player and remote bosses).
- **Spatial index** (`core/spatial.js`) buckets entities by chunk; neighbors are scanned
  in a 3×3 chunk neighborhood.
- **Prop geometry** (`world/geometry.js`) is the single source for car/dumpster footprints,
  used by collision (`CityMap.canMoveTo`), bullet raycast (`sim/combat.js`) and drawing
  (`render/world.js`), so the three cannot drift.

## Simulation

`sim/simulation.js` separates simulation from presentation:

- **Host/single `update(SIM_DT)`:** resets the A* budget, rebuilds spatial buckets, ticks
  player timers, handles player input/aim and capture; movement/sprint go through the
  shared `moveUnit`/`updateUnitSprint`. Then for each NPC either updates a remote-human boss
  (`updateHumanControlledRivalBoss`) or runs `updateNpcAi` (perception, armor, attacks,
  patrol, A* steering, capture), then regenerates it on friendly turf; the player regenerates
  after the NPC loop so a same-frame hit suppresses it; then runs the hourly economy tick and
  `net.updateHost`.
- **Guest `updateGuest(renderDt)`:** streams input (`net.updateGuest`), runs guest
  presentation (`stepGuestPresentation`: interpolate `netX/netY`, decay animation timers),
  advances the HUD timer bar, then calls `updatePresentation`.
- **`updatePresentation(renderDt)`:** camera follow/spectate and visual particles. It runs
  once per rendered frame on host and guest, never inside the fixed sim loop.

`initWorld` builds a fresh match; `update` is the only per-frame simulator entry point.
Per-frame presentation stays state-driven: combat/capture/economy emit discrete events on
transitions only, never positions, timers or per-NPC updates.

### AI
`sim/ai.js`: `scanNearby` (nearest enemy + ally/enemy counts in the 3×3 spatial buckets),
boss armor purchase, melee for every rank and pistol fire for bosses/underbosses when the
bullet path is clear (`hasClearShot`) and no ally is in the way (`hasFriendlyInShotPath`),
`choosePatrolChunk` (nearest non-owned chunk with
a global fallback), A* path following/steering, obstacle dodge and capture. Wounded or
outnumbered unarmored bosses buy armor when possible, otherwise sprint to a retreat point;
blocked pistol shooters sidestep their firing lane, back off when both flanks are blocked,
and always knife at close range (knives have no friendly-fire restriction). `updateNpcAi(u,
dt)` is headless; remote-human bosses bypass it. `simulation.js` remains the fixed-step
orchestration loop; presentation is separate.

## Systems

### Units and recruitment
`sim/units.js` owns per-rank caps scaled by the grid side (underbosses ×1, captains ×2,
soldiers ×10; selectable minimums 1/2/10), unit stat tables (inline ternaries today),
spawning near the boss/owned turf, and recruitment (cost, caps, treasury, cached counts).
Setup lets the player lower each rank's maximum under the grid ceiling; `state.matchUnitCaps`
carries that choice into the match and multiplayer host/guest init. Caps clamp player and
remote-human preferences to the configured range; every faction (human or AI) starts at the
full quota until the player lowers a slider. It emits `unit:recruited`;
`render/recruitFx.js` draws the `+RANK ($cost)` text. Rival bosses controlled by a human
peer have `humanPeerId`; all bosses use speed `130` (AI and human), while non-boss AI ranks
use their per-rank speeds (`135` Underboss, `140` Captain, `150` Soldier). Same-faction units may push through each other (boss included); other factions
always collide.

### Combat
`sim/combat.js`: one armor→HP damage pipeline for units and the player
(`damagePlayerBoss` delegates to `applyDamageToNpc`), death/elimination, one
`performSlash` pipeline with player/rival/AI wrappers that share one knockback while
keeping per-rank reach, arc and cooldowns, a pistol raycast with distance accuracy/damage
bands, magazine reload (auto at 0 or manual with R, 4 s), pistol friendly fire and
ally-aware AI hold-fire, a per-hit critical roll (5% base, +15% from the rear cone, 2×
damage), and
point-blank damage falloff, and armor purchases (player, rival AI). It emits facts only;
`render/combatFx.js` draws blood/corpses/text/arcs/tracers and `audio/combatSfx.js` plays
the combat SFX. The host's `shot:fired` subscriber broadcasts ephemeral tracers to guests.

### Economy
`sim/economy.js`: income totals from owned chunks, corruption penalties (1% per 10
neighborhoods and 1% per 25 living units), upkeep per unit, the hourly tick (pay effective
income minus upkeep, auto-recruit underbosses/captains/soldiers within caps), skipping dead
factions. It emits `hour:tick` with `{ hour, income, grossIncome, corruption, upkeep,
treasuries }`; the HUD subscribes.

### Territory
`sim/territory.js`: capture starts/resets/completes at rank-based points per tick
(Boss/Underboss 1 → Captain .5 → Soldier .2, scaled by the configured tick length and
stacked across units), blocks capture while living enemies stand on enemy turf, neutralizes
a dead faction's turf, and emits `chunk:captured`, `faction:eliminated`, `match:victory` or
`match:defeat`.
`render/territoryFx.js` draws the turf label/radar refresh; HUD, banners, SFX and toasts
subscribe in `main.js`.

### Balance data
`config/balance.js` is the gameplay tuning surface: `RANK_STATS` (HP, armor, damage,
AI/human speed, radius, capture points per tick, regen per second, cost/upkeep), `UNIT_CAPS`, `CORRUPTION`, `SLASH`
profiles, and
`PISTOL` stats + accuracy bands. `config/constants.js` owns world/map defaults, sprint,
pistol range, hit flash, the fixed sim step and catch-up limits. Non-boss AI ranks use
their rank speed (Underboss `135`, Captain `140`, Soldier `150`); bosses use `130` for both AI and human control, so sprint is the boss
mobility advantage. Local and remote humans and AI bosses share one `SLASH.humanBoss`/`SLASH.aiBoss`
rule set; crew melee reads `SLASH.aiMeleeByRank` for per-rank reach, arc and cooldown. The local player's HP, damage, speed and
radius derive from `RANK_STATS.BOSS`. Systems read the tables at spawn/attack time and copy
derived stats onto units (state is snapshotted). Presentation feel and AI decision
thresholds are deliberately not here.

## Networking

`net/mpNet.js` (a composition facade; transport, protocol, lobby rules and host/guest
controllers live in their own modules):

- **Transport (`net/transport.js`):** Trystero 0.27 (`@trystero-p2p/nostr`, or `mqtt` as a
  CDN fallback) for cross-machine WebRTC, plus a same-origin **BroadcastChannel +
  localStorage bus** for multi-tab play and embedded iframes. Trystero uses only public
  Nostr relays for signaling; gameplay traffic stays peer-to-peer. The app id is a stable
  reverse-domain namespace (`io.github.hrodic.mafia2d`); short invite codes are parsed by
  `net/invite.js` and secrets travel in the URL fragment, never the HTTP query.
- **Protocol (`net/protocol.js`):** message type constants, the versioned envelope/version
  gate, and snapshot encode/decode. The wire shape is unchanged; the module has no state
  mutation or presentation imports.
- **Lobby rules (`net/lobby.js`):** UI-agnostic host seat assignment, human capacity,
  roster snapshots and guest seat lookup.
- **Lobby UI (`ui/lobbyUI.js`):** host/guest roster rendering, AI/open-slot controls and
  start-button state. Rows are built with DOM nodes and `textContent`; peer names are never
  parsed as HTML.
- **Guest controller (`net/guest.js`):** join HELLO retry, lobby/init/snapshot/event
  handling, authoritative snapshot application, input/command streaming and host-disconnect
  detection. It receives channel getters and UI callbacks from `mpNet.js` instead of
  importing it.
- **Host controller (`net/host.js`):** lobby admission/rejection, seats and AI slots, match
  launch and INIT_MATCH, snapshot/event broadcast, remote input/command handling and
  peer-leave AI takeover. It receives channel getters, config and UI callbacks from
  `mpNet.js`.
- **Relays:** an explicit curated `RELAY_URLS` pool (10–12 public relays) replaces
  Trystero's large default pool. All listed relays are used and Trystero fails over when one
  is down. Gameplay does not depend on any single relay.
- **API normalization:** Trystero 0.27 exposes `{ peerId }` callback contexts and
  `{ target }` send options. `transport.js` wraps rooms/actions into the stable shape used by
  `mpNet.js` (`send(data, targetPeerId)`, `receive(cb(data, peerId))`, `selfId`), so the local
  bus and Trystero share one interface. A total relay failure surfaces through `onError`.
- **Lobby:** host creates a room code + secret; guests join by code or invite link.
  Seats map peers to factions; unused seats can be closed as AI. Version gate rejects
  mismatched clients.
- **Channels:** `lobby`, `init` (initial match state), `snap` (snapshots), `input`
  (guest movement/aim ~16 Hz), `cmd` (guest actions: move, slash, shoot, reload, armor, recruit
  prefs), `event` (e.g. SHOT tracer broadcast).
- **Authority:** the host runs the simulation and broadcasts full-state snapshots ~12 Hz;
  guests interpolate positions (`render/interpolation.js`) and send input/commands.
  Peer input older than 500 ms is treated as neutral (no ghost movement). Disconnects
  hand the boss back to AI.
- **Events vs state:** snapshots are authoritative. Events are ephemeral host facts and are
  not replayed on guests; guests derive presentation from snapshots/interpolation. Never
  emit per NPC while applying a snapshot.
- **Determinism:** the world seed is sent in `INIT_MATCH`; guests generate the same city.

Known net limitations: full-state snapshots. A hidden host now has a timer-driven fixed-step
fallback, but browsers can still throttle background timers. Snapshot apply uses a
per-snapshot unit index (O(n) lookups). Chunk deltas and NAT/TURN work are tracked in
`PLAN.md` under FUTURE — TO BE DECIDED.

## Rendering

`render/renderer.js` culls chunks/tiles to the viewport, collects ground/buildings/props
and characters into a depth-sorted list, and draws layers: a subtle world-space city
backdrop (outside the playable chunks), ground + faction tint, capture bars, turf income
labels, blood decals/corpses, waypoint and muzzle-accurate aim/reticle UI, characters (with
HP/armor bars and rank labels), then effects (slash arcs, muzzle flashes, tracers, blood,
sparks, casings, floating text). Character walk animation is distance-driven: `moveUnit`
and guest interpolation advance `walkPhase`/`isMoving`, and `drawCharacter` uses one sine
per visible moving unit for foot swing and a small body bob (no new timers or per-unit
render state). Static ground is cached per visible chunk in an LRU of
offscreen canvases (asphalt grain, curbs, markings); building walls/roofs/roof props are
cached per building sprite and drawn in the same depth order, with dynamically lit facade
windows layered on top. `render/weather.js` draws the capped diagonal rain pass in screen
space whenever the day/night schedule says rain. Rain is re-decided only when the
day/night period flips (25% day, 50% night). The same continuous hour drives the lamp
intensity (off 08–21, on 22–07, one-hour dusk/dawn fades) and a screen-space ambient tint:
warm sunny light by day, cool blue by night.
`render/minimap.js` caches the faction territory layer and overlays units (every boss —
player, AI or remote human — is the same white-glowing circle filled with its faction
accent; crew stay small squares), the camera rect and chunk coordinates;
`render/minimapLayout.js` owns the shared bounds/cell/
offset and world<->map mapping (also used by radar clicks). The radar canvas is 168px by
default and expands to 336px.

## Audio

`audio/engine.js` owns the AudioContext, master/music gains and a procedural noir music
scheduler (two tracks; per-context noise buffer cache). `audio/sfx.js` synthesizes all
SFX (slash, gunshot, ricochet, armor, death, elimination, victory) and attenuates by
distance from the camera.

## UI

- `ui/hud.js`: primary boss/economy status, collapsible crew management panel (per-rank
  living counts, caps, recruit costs, turf/crew/gross/upkeep/net totals), collapsible faction leaderboard
  (turf, kills, deaths).
- `ui/actionBar.js`: bottom-center combat bar. Slash/pistol/armor/sprint show ready/cooling
  states, cooldown overlays, costs and shortcuts; the pistol badge shows rounds left and
  switches to a 4s reload fill at 0 (R reloads early); sprint is boss-only, hold-to-run,
  and guest input includes the held state.
- `ui/hudCadence.js`: 4 Hz HUD refresh from the main loop.
- `ui/menus.js`: setup modal tabs (Field Manual first, then Single/Host/Join), grid-derived
  crew-limit sliders, lobby buttons, start-game flow, `openSetupMenu`, banners and
  toasts; exports `initMenus`.
- `ui/input.js`: keyboard/mouse/minimap handlers, HUD action buttons; releases held keys
  on blur/visibility loss; exports `initInput`.
- `ui/commandBridge.js`: the only guest/local branch for actions. Guests stream the command
  payload through `state.net.sendCommand`; host/single call `sim/commands.js` directly.
- `ui/support.js`: the top-bar **Tip me** link opens the official Ko-fi popup; the floating
  launcher is hidden in CSS and the link falls back to ko-fi.com/hrodic.
- `sim/commands.js`: `dispatchCommand(faction, payload)` for move, slash, shoot, reload, armor and
  recruit prefs. Local input and the host's remote-command receiver share it.

## Testing

- `tests/tests.html` is a zero-dependency runner (no npm). `tests/runner.js` imports all
  `*.test.js` suites; `harness.js` provides assertions and renders results. The page title
  becomes `PASS`/`FAIL`; a watchdog reports module-load failures.
- Tests use the real modules. `tests/tests.html` includes hidden canvases and HUD fixtures
  so render/HUD/menu tests can run headlessly. State is saved/restored per test.
- `tests/mp-harness.html` embeds the game in an iframe to force the local bus; open it in
  two tabs for deterministic host/guest testing without external relays.
- Coverage includes config/RNG, transport API normalization (Trystero 0.27 vs local bus),
  protocol envelope/version/snapshot encoding, lobby seats/capacity/rosters, lobby DOM
  rendering/safe names, guest handshake/init routing, snapshot apply reuse/create/remove,
  snapshot ordering/sender/malformed guards, unknown-chunk generation, host admission and
  duplicate HELLO, remote command gating, AI takeover, hidden-tab simulation fallback,
  event bus, state selectors, chunk determinism, collision,
  pathfinding (including wall detours and no corner cutting), units/recruitment, economy,
  territory, combat math/accuracy/armor/aim geometry, effects and casings, interpolation,
  match setup, fixed-step accumulation, command dispatch/equivalence, 600-step headless
  simulation, HUD, menus, support link and rendering.
- **Golden tests** (`tests/world-golden.test.js`) pin an FNV-1a hash of each seeded chunk's
  tiles, props, income and faction. They prove that RNG/generation refactors (Phase 2) do
  not alter maps; update the expected hashes only for an intentional generation change.
- **Static health check** (`tools/check.ps1`, no npm): verifies required files exist,
  every relative `.js` import resolves, no bare static imports exist, every `*.test.js`
  suite is registered in `tests/runner.js`, `index.html` has no duplicate ids, each
  `.opencode/skills/<id>/SKILL.md` has valid frontmatter and existing references, the
  `sim/` headless ratchet, and that modules using `canvas.*` import the canvas singleton.
  `tests/runner.js` is the manifest — a new suite that is not imported there silently
  does not run. `tools/typecheck.ps1` downloads an ignored native TypeScript compiler and
  checks the `jsconfig.json` program; only `// @ts-check` modules are type-checked.

## Conventions

- Native ESM, relative `.js` imports, no bare specifiers, no npm.
- Editor type checking uses `jsconfig.json`; clean modules opt in with `// @ts-check` and
  JSDoc. There is no TypeScript build step or transpilation.
- **SemVer:** `GAME_VERSION` in `config/version.js` is the single source. Every
  commit-sized step bumps PATCH (fix/refactor/docs/tests/perf) or MINOR (new capability);
  `1.0.0` is the first stable release. The same value gates multiplayer.
- 2-space indentation in `src/` modules; keep modules focused.
- Gameplay numbers live in `config/balance.js` (rank stats, caps, slash/pistol tables,
  accuracy bands, costs/upkeep). Do not inline gameplay numbers in systems; presentation
  feel and AI decision logic stay in their own modules.
- Never import UI/render/audio/net from `sim/`; emit events and keep presentation in
  subscribers (`main.js`). There are no runtime hooks.
- Keep the game playable and tests green after every change.

## Known limitations / next phases

- **Phase 2:** event bus migration, dedup, balance tables, explicit RNG, AI extraction and
  HUD cadence move are done; `core/runtime.js` is gone.
- Phase 3 complete: player boss shares the unit contract but stays a local singleton
  outside `npcs`; `forEachUnit`/`getUnitById` cover all-combatant systems. One
  damage/slash/movement pipeline, `createGameState()` reset factory, unified command
  dispatcher for local+remote, fixed `1/120` simulation with render-time presentation,
  and seeded headless/command-equivalence tests.
- Phase 4 complete: `transport.js`, `protocol.js`, `lobby.js`, `ui/lobbyUI.js`, `guest.js`
  and `host.js` extracted; safe lobby/HUD peer names; O(n) snapshot apply; hidden-host
  simulation fallback.
- Phase 5 complete: targeted tests and dedup, `jsconfig`/`// @ts-check` typing with
  `tools/typecheck.ps1`, `docs/` deploy guidance and generated-artifact rules.
- No active phase. Deployed Pages validation and optional netcode ideas are tracked under
  FUTURE in `PLAN.md`.

See `PLAN.md` for phase history and future ideas; `AGENTS.md` for the workflow contract.

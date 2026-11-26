# Hrodic's Mafia 2D — BETA.2026.11.26

A top-down 2D mafia turf-war game. You play a syndicate **Boss** in a procedurally
generated city: capture neighborhoods block by block, earn hourly income, auto-recruit
a crew of enforcers, captains and underbosses, and eliminate every rival Boss to rule
the city. Play solo against AI syndicates, or host/join a **2–4 player P2P multiplayer**
match where each human controls a rival syndicate.

**Zero-build static game** — no npm, no bundler, no server: plain HTML, CSS and
JavaScript, deployable to GitHub Pages as-is.

## Gameplay

- **Procedural city** — grid of 5×5 to 25×25 "district chunks" (each 15×15 tiles,
  44 px/tile). Six block archetypes with buildings, alleys, plazas, parked cars,
  dumpsters, streetlights and trees. Seeded generation (mulberry32) so multiplayer
  peers build identical cities from a shared world seed.
- **4-tier syndicate hierarchy** (names vary per organization):

  | Rank | HP | Cost | Upkeep | Weapons | Cap |
  |---|---|---|---|---|---|
  | Boss (you) | 400 (+300 kevlar) | — | — | Pistol + knife | 1 |
  | Underboss / 2IC | 480 + 120 armor | $3,800 | $150/hr | Pistol + blade | 5% of blocks |
  | Captain | 340 | $2,200 | $100/hr | Melee | 10% of blocks |
  | Soldier | 180 | $1,200 | $50/hr | Melee | remaining 85% |

- **6 organizations** — Cosa Nostra, Bratva, Yakuza, Triads, 'Ndrangheta, Cartels;
  2–4 unique syndicates per match, each with its own colors and rank titles.
- **Economy tick** — every 10–30 s (configurable) an "hour" passes: owned blocks pay
  $250–$1,500 (income tier), upkeep is deducted, and auto-recruitment fills crew up to
  per-rank caps.
- **Combat** — knife slash (52 px arc, up to 3 targets, knockback), 9 mm pistol
  (1,000 px raycast with distance-based accuracy & point-blank damage falloff,
  ricochets, tracers, shell casings), kevlar armor ($3,500, once per tick),
  sprint (1.6× for 2 s, 4 s cooldown).
- **Territory** — standing in a neutral/enemy block captures it (rate depends on rank).
  Killing a Boss eliminates their syndicate: turf turns neutral, crew fights on.
  Victory when all rival Bosses are dead; defeat lets you spectate or restart.
- **City expansion** — "+ Expand Ring" or optional click-to-build outside the map.
- **Fully synthesized audio** — Web Audio SFX with distance attenuation plus two
  procedural dark-noir music tracks (no audio assets).

## Controls

| Input | Action |
|---|---|
| WASD / Arrows | Move boss |
| Left-click street / minimap | Waypoint movement (click-to-move) |
| Shift | Sprint |
| Space / F | Knife slash |
| Right-click | Pistol shot at cursor |
| Q | Buy kevlar armor |
| HUD buttons | Auto-recruit toggles & caps, armor, slash, pistol, expand, borders, music, SFX, new game |

## Technology

- **Vanilla JavaScript** — no build step, no framework, no dependencies installed.
- **Canvas 2D** renderer: viewport culling, y-sorted depth rendering, pseudo-3D
  building elevation, directional characters, particles/decals/corpses, cached minimap.
- **Tailwind CSS via CDN** (`cdn.tailwindcss.com`) for all UI styling.
- **Web Audio API** for synthesized SFX and a step-sequenced music engine.
- **Multiplayer (host-authoritative P2P)**:
  - Signaling/transport via [Trystero](https://github.com/dmotz/trystero)
    (`@trystero-p2p/nostr` / `mqtt` loaded from esm.sh/jsDelivr at runtime), with a
    same-origin **BroadcastChannel + localStorage fallback bus** for multi-tab play
    (also used inside embedded iframes).
  - Lobby with room code + secret invite links, human/AI seat toggling, version gate.
  - Host simulates everything; broadcasts full-state snapshots ~12 Hz; guests stream
    input ~16 Hz and send action commands (move, slash, shoot, armor, recruit prefs,
    expand/build). Guests interpolate entity positions; AI takes over if a peer drops.
- **Deterministic world gen** — mulberry32 PRNG + per-chunk seed hashing; A* tile
  pathfinding with a per-frame budget; spatial hash buckets for neighborhood queries.

## Running

Any static file server works; there is nothing to install or build:

```sh
# from the repo root, pick one:
python -m http.server 8000
# or use the VS Code "Live Server" extension, or any static host
```

Then open `http://localhost:8000/`.

> **Why a server?** The game and tests use native ES modules. Browsers block module
> loading from `file://`, so `http://` is required (GitHub Pages provides it).

Multiplayer needs network access for the Trystero CDN; multi-tab local play works
offline on the same origin.

## Testing

Automated tests are a **zero-dependency browser page** — no npm, no test framework:

```
http://localhost:8000/tests/tests.html
```

It prints a green/red list and sets the page title to `PASS`/`FAIL`. The suite grows
with the refactor; it must be green at every commit. See `tests/SMOKE.md` for the manual
smoke checklist (quick smoke per commit, full checklist per phase), and
`tests/mp-harness.html` for deterministic two-tab multiplayer testing over the local bus.

## Repository layout

Native ES modules, no build step. `index.html` is the shell; `styles.css` holds custom
CSS; `src/main.js` is a thin composition root.

```
index.html            markup only + module entry
styles.css            custom CSS (Tailwind stays on its CDN)
src/
  main.js             composition root: net bridge, runtime hooks, loop, bootstrap
  config/             constants.js · enums.js · balance.js · organizations.js
  core/               rng.js · state.js · runtime.js · spatial.js
  world/              chunk.js · city.js · pathfinding.js
  sim/                match.js · simulation.js · movement.js · units.js ·
                      combat.js · territory.js · economy.js
  net/                mpNet.js (transport, lobby, host/guest snapshots)
  render/             canvas.js · renderer.js · world.js · characters.js ·
                      effects.js · minimap.js · interpolation.js
  audio/              engine.js (music) · sfx.js
  ui/                 hud.js · menus.js · input.js
tests/                tests.html · *.test.js · mp-harness.html · SMOKE.md
```

## Architecture

- **Dependency direction:** `config → core → world → sim/render/audio/net → ui → main`.
  `sim/` is DOM-free and audio-free; state mutations flow out through the transitional
  `core/runtime.js` hooks (HUD refresh, toasts, banners, SFX), wired once in `main.js`.
  Phase 2 replaces these hooks with an event bus so the simulation is fully headless.
- **Shared state:** one `state` object (`core/state.js`). Selectors
  `getLocalFaction` / `getLocalBoss` resolve local vs. remote-controlled bosses through
  `state.net`, so gameplay code does not branch on multiplayer mode.
- **World:** seeded `DistrictChunk` generation (mulberry32 + per-chunk hashing) gives
  peers identical cities; `CityMap` owns tile queries/collision; A* powers both AI and
  click-to-move (remote and local).
- **Simulation:** `sim/simulation.js` orchestrates movement, AI, combat, capture and the
  hourly economy for the host/single-player. Guests run only presentation interpolation
  (`render/interpolation.js`) and stream input/commands to the host.
- **Net:** `net/mpNet.js` is the host-authoritative module (Trystero WebRTC with a
  same-origin BroadcastChannel/localStorage fallback). Phase 4 splits it into
  transport/protocol/lobby/host/guest and hardens the snapshot format.
- **Rendering/UI:** `render/` reads state and draws; `ui/hud|menus|input` own the DOM.
  `main.js` wires everything and runs `update → render` each frame.
- **Zero infrastructure:** native ES modules with relative `.js` imports, Tailwind via
  CDN, Trystero via runtime CDN import, deployable as static files.

## Testing

Automated tests are a **zero-dependency browser page** — no npm, no test framework:

```
http://localhost:8000/tests/tests.html
```

It prints a green/red list and sets the page title to `PASS`/`FAIL`; the suite currently
covers config/RNG, state, world generation, pathfinding, units, movement, economy,
territory, combat, effects, interpolation, match setup, simulation orchestration, HUD,
menus and rendering. See `tests/SMOKE.md` for the manual smoke checklist and
`tests/mp-harness.html` for deterministic two-tab multiplayer testing over the local bus.

### Known limitations (next phases)

- Presentation side effects still flow through `runtime` hooks instead of a typed event
  bus (Phase 2).
- The player boss remains a special-cased object; damage/slash/movement paths still have
  some duplication (Phase 3 folds it into the unit model).
- Variable-timestep loop tied to rAF (Phase 3 introduces a fixed timestep).
- `withSeed()` still temporarily swaps `Math.random`; prop geometry is duplicated in
  collision/raycast/drawing (Phase 2).
- Network snapshots send full state ~12 Hz and apply in O(n²); lobby peer names are still
  injected into `innerHTML` (Phase 4 hardens the protocol and sanitizes names).
- Background host tabs are throttled by browsers; keep the host visible for smooth
  two-tab testing, or use two computers/windows.

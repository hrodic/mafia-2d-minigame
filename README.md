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

> **Why a server?** The test page uses ES modules and, during the architecture
> refactor, the game itself moves to native ES modules too. Browsers block module
> loading from `file://`, so `http://` is required from then on.

Multiplayer needs network access for the Trystero CDN; multi-tab local play works
offline on the same origin.

## Testing

Automated tests are a **zero-dependency browser page** — no npm, no test framework:

```
http://localhost:8000/tests/tests.html
```

It prints a green/red list and sets the page title to `PASS`/`FAIL`. The suite grows
with the refactor; it must be green at every commit. See `tests/SMOKE.md` for the manual
smoke checklist (quick smoke per commit, full checklist per phase).

## Repository layout

The architecture refactor is in progress: the game script now lives in `src/main.js` as a
native ES module and custom CSS in `styles.css`; the module split is being extracted step
by step, with the game kept playable and tests green at every step. Target layout:

```
index.html            markup only + module entry
styles.css            extracted custom CSS
src/
  main.js             bootstrap / wiring / loop
  config/             constants, enums, organizations, balance tables
  core/               rng, state, events, spatial index
  world/              districts, city map, collision, pathfinding
  sim/                simulation, units, movement, combat, AI, territory, economy
  net/                transport, protocol, lobby, host, guest
  render/             renderer, world, characters, effects, minimap, camera
  audio/              music engine, synthesized SFX
  ui/                 HUD, menus, lobby UI, input bindings
tests/                tests.html, test modules, SMOKE.md
```

## Current code map

`index.html` now holds markup only (HUD, canvases, modals, banners) and loads
`styles.css` + `src/main.js` (type="module"). `src/main.js` is the original script moved
intact; the split into `src/` modules is in progress.

| `src/main.js` lines | Section |
|---|---|
| — | `index.html`: markup; `styles.css`: custom CSS |
| 2–573 | Audio: context, noise/music engine, synthesized SFX |
| 574–687 | Visual FX: blood, decals, tracers, casings, sparks, corpses |
| 688–934 | Constants, enums, organizations, seeded PRNG |
| 935–1251 | `DistrictChunk`: seeded urban block generation + ground rendering |
| 1252–1425 | `CityMap`: chunk store, tile queries, collision, ring expansion |
| 1426–2165 | Game state globals, A* pathfinder, economy/recruitment, `initWorld` |
| 2166–2623 | Combat: damage, slash variants, pistol raycast |
| 2624–3023 | Armor, remote-human boss control, keyboard/mouse/minimap input |
| 3024–3570 | Simulation `update()`: player, NPC AI, steering, capture, hourly tick |
| 3571–4414 | Rendering: world, characters, effects, minimap, HUD |
| 4415–5620 | `mpNet`: transport, lobby, host/guest netcode |
| 5621–5998 | Setup UI bindings, HUD buttons, main loop, bootstrap |

### Known architectural limitations (being fixed)

- One module with ~40 shared mutable globals; simulation, rendering, DOM, audio and
  netcode are interleaved (combat functions play SFX, spawn particles, touch the DOM
  and broadcast network events inline), so the simulation cannot run headless.
- The player boss is a special-cased object separate from the NPC array, causing
  duplicated damage/slash/movement/sprint code paths and hardcoded `Faction.PLAYER`.
- Balance numbers scattered inline; prop collision geometry defined in three places.
- `withSeed()` monkey-patches `Math.random`; variable-timestep loop tied to rAF.
- Guest snapshot apply is O(n²), full chunk state is sent ~12 Hz, and peer names are
  injected into `innerHTML` unsanitized.

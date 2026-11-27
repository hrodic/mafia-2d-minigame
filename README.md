# Hrodic's Mafia 2D

A top-down 2D mafia turf-war game. Play a syndicate Boss in a procedurally generated
city: capture neighborhoods, earn hourly income, auto-recruit a crew, and eliminate
every rival Boss. Play solo against AI syndicates or host/join a **2–4 player P2P
multiplayer** match where each human controls a rival family.

**Zero-build static game** — plain HTML/CSS/JavaScript, native ES modules, no npm, no
bundler, no server. The GitHub Pages artifact in `docs/` is produced by minifying each
source module with esbuild (no bundling).

## Features

- Procedural city of 5×5–25×25 district blocks (seeded, so multiplayer peers match).
- 6 syndicate organizations, 2–4 per match, 4-tier hierarchy (Boss / Underboss /
  Captain / Soldier) with per-rank costs, upkeep, caps and weapons.
- Hourly economy: neighborhood income, crew upkeep, corruption penalties, negative cash,
  auto-recruitment and treasury.
- Combat: knife slash (arc, up to 3 targets), 9 mm pistol with distance-based accuracy
  and damage falloff, kevlar armor, sprint.
- Territory capture block by block; boss death eliminates a syndicate; victory/defeat
  with spectator mode.
- Boss/economy HUD, crew management, bottom combat bar with cooldowns and a faction
  leaderboard (turf, kills, deaths).
- City radar minimap with a 168px default view and a 336px expanded view.
- Synthesized Web Audio SFX and two procedural dark-noir music tracks.
- Host-authoritative P2P multiplayer with lobby, short invite codes/links, human/AI
  seats, snapshot interpolation and AI takeover on disconnect.

Full tuning surface: [`BALANCE.md`](BALANCE.md).

## Controls

| Input | Action |
|---|---|
| WASD / Arrows | Move boss |
| Left-click street / minimap | Move to waypoint (A* pathfinding) |
| Shift or hold Sprint button | Sprint |
| Space / F or Slash button | Knife slash |
| Right-click or Pistol button | Pistol shot at cursor |
| Q or Armor button | Buy kevlar armor |
| Crew Management panel | Recruit toggles/caps |
| Utility buttons | Music, SFX, Tip me (Ko-fi), New Game |

## Run locally

Any static file server works. From the repo root:

```sh
python -m http.server 8000
# or use the VS Code Live Server extension, or:
powershell -ExecutionPolicy Bypass -File tools/serve.ps1 -Port 8123
```

Open `http://localhost:8000/` (or the port you chose). ES modules do not load from
`file://`, so a server is required.

### Build the Pages artifact

GitHub Pages publishes only `/docs`. Source modules stay in `src/`; the root docs and tests
are not served by the site.

```powershell
powershell -ExecutionPolicy Bypass -File tools/build-pages.ps1
```

The script:

- downloads a local `tools/esbuild.exe` if missing (ignored by git),
- minifies each `src/**/*.js` into `docs/src/` without bundling,
- copies `index.html`, `styles.css` and `.nojekyll` into `docs/`,
- does not copy tests or test pages.

Commit `docs/` after rebuilding. **Never hand-edit `docs/`** — it is pure generated output.
GitHub Pages settings: Deploy from a branch, then your published branch, folder `/docs`.
Rebuild and commit `docs/` whenever source changes.
published branch → `/docs`**. Rebuild and commit `docs/` whenever source changes.

The game needs network access for the Tailwind CDN and, for cross-machine multiplayer, the
Trystero signaling CDN; same-origin multi-tab play works offline via the local bus.

## Tests

Zero-dependency browser test suite:

```
http://localhost:8000/tests/tests.html
```

All tests must pass (`PASS` in the page title); golden world-generation hashes guard the
seeded maps. Static sanity check (imports resolve, every suite is registered, no duplicate
DOM ids):

```sh
powershell -ExecutionPolicy Bypass -File tools/check.ps1
powershell -ExecutionPolicy Bypass -File tools/typecheck.ps1
```

The full static gate is:

1. `tools/check.ps1` — source health and generated `docs/` shape.
2. `tools/typecheck.ps1` — native TypeScript compiler against `jsconfig.json`.
3. `tests/tests.html` — runtime tests (`PASS`).
4. `tools/build-pages.ps1` + `/docs/` smoke when source or shell files change.
5. `tests/mp-harness.html` when `sim/`, `net/` or shared state changes.

`tools/typecheck.ps1` downloads the native TypeScript compiler into the ignored
`tools/typescript/` directory on first use, then checks the `jsconfig.json` program. No npm
install or TypeScript build step is added.

Manual checklist: `tests/SMOKE.md`. Deterministic two-tab multiplayer testing (local bus,
no external relays): `tests/mp-harness.html`.

## Tech

- Vanilla JavaScript ES modules, Canvas 2D rendering, Tailwind CSS via CDN.
- Web Audio API synthesis, seeded PRNG world generation, A* pathfinding.
- Multiplayer: Trystero WebRTC signaling (`nostr`/`mqtt` from CDN) + same-origin
  BroadcastChannel/localStorage fallback; host simulates, guests stream input.
- Page-view analytics: GoatCounter, loaded asynchronously and non-blocking.

## Tuning

Gameplay and feel tuning is split by concern:

- **`src/config/balance.js`** — `RANK_STATS` (HP, armor, damage, AI/human speed, radius,
  capture rate, cost/upkeep), `UNIT_CAPS`, `SLASH` (`humanBoss`/`aiBoss`/`aiMelee`/`aiMeleeByRank`),
  `PISTOL` (damage, cooldown, knockback, accuracy bands) and `INCOME_TIERS`.
- **`src/config/constants.js`** — world/map defaults, sprint tuning, pistol range, hit-flash
  duration, fixed simulation step and catch-up limits.
- **`src/config/organizations.js`** — syndicate names, colors and rank labels.

Presentation feel and AI decision logic stay in their own modules. Balance tables are locked
by `tests/balance.test.js`; update its expected values in the same change when tuning is
intentional.

## Seeds

Every new match has a **world seed** (1–2147483647; `0` is also accepted if typed):

- Single-player and the **host** choose the seed; a blank field generates a random one.
- Guests do **not** choose: they receive the host's seed and build the same city.
- Click the header seed badge (or the setup **Copy** button) to copy the current seed.
- Reuse it to replay the same map; the **Random** button fills a new one.

## Versioning

SemVer (`MAJOR.MINOR.PATCH`) starting at `0.1.0`. The single source is
`src/config/version.js`; the title, HUD/modal labels and multiplayer handshake read it.
Every commit-sized step bumps the version: **PATCH** for fixes/refactors/docs/tests,
**MINOR** for new user-visible capabilities. `1.0.0` will be the first stable release.
Multiplayer requires both peers to run the same version.

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — layers, modules, data flow, netcode, testing.
- [EVENTS.md](EVENTS.md) — implemented event-bus contract (catalog + subscribers).
- [PLAN.md](PLAN.md) — phased refactor plan and current status.
- [AGENTS.md](AGENTS.md) — workflow contract for AI/human contributors.
- `.opencode/skills/` — task skills auto-discovered by OpenCode (zero-build refactor,
  multiplayer debug).

## Support

The in-game **☕ Tip me** button in the top bar opens the Ko-fi popup. If the widget is
unavailable it falls back to [ko-fi.com/hrodic](https://ko-fi.com/hrodic).

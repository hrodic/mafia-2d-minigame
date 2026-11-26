# Hrodic's Mafia 2D

A top-down 2D mafia turf-war game. Play a syndicate Boss in a procedurally generated
city: capture neighborhoods, earn hourly income, auto-recruit a crew, and eliminate
every rival Boss. Play solo against AI syndicates or host/join a **2–4 player P2P
multiplayer** match where each human controls a rival family.

**Zero-build static game** — plain HTML/CSS/JavaScript, native ES modules, no npm, no
bundler, no server. Deploys to GitHub Pages as-is.

## Features

- Procedural city of 5×5–25×25 district blocks (seeded, so multiplayer peers match).
- 6 syndicate organizations, 2–4 per match, 4-tier hierarchy (Boss / Underboss /
  Captain / Soldier) with per-rank costs, upkeep, caps and weapons.
- Hourly economy: neighborhood income, crew upkeep, auto-recruitment, treasury.
- Combat: knife slash (arc, up to 3 targets), 9 mm pistol with distance-based accuracy
  and damage falloff, kevlar armor, sprint.
- Territory capture block by block; boss death eliminates a syndicate; victory/defeat
  with spectator mode.
- City expansion (expand ring or click-to-build), city radar minimap.
- Synthesized Web Audio SFX and two procedural dark-noir music tracks.
- Host-authoritative P2P multiplayer with lobby, invite links, human/AI seats, snapshot
  interpolation and AI takeover on disconnect.

## Controls

| Input | Action |
|---|---|
| WASD / Arrows | Move boss |
| Left-click street / minimap | Move to waypoint (A* pathfinding) |
| Shift | Sprint |
| Space / F | Knife slash |
| Right-click | Pistol shot at cursor |
| Q | Buy kevlar armor |
| HUD buttons | Recruit toggles/caps, armor, slash, pistol, expand, borders, music, SFX, new game |

## Run locally

Any static file server works. From the repo root:

```sh
python -m http.server 8000
# or use the VS Code Live Server extension, or:
powershell -ExecutionPolicy Bypass -File tools/serve.ps1 -Port 8123
```

Open `http://localhost:8000/` (or the port you chose). ES modules do not load from
`file://`, so a server is required.

### Deploy

Push to GitHub and enable Pages for the repository root. No build step. The game needs
network access for the Tailwind CDN and, for cross-machine multiplayer, the Trystero
signaling CDN; same-origin multi-tab play works offline via the local bus.

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
```

Manual checklist: `tests/SMOKE.md`. Deterministic two-tab multiplayer testing (local bus,
no external relays): `tests/mp-harness.html`.

## Tech

- Vanilla JavaScript ES modules, Canvas 2D rendering, Tailwind CSS via CDN.
- Web Audio API synthesis, seeded PRNG world generation, A* pathfinding.
- Multiplayer: Trystero WebRTC signaling (`nostr`/`mqtt` from CDN) + same-origin
  BroadcastChannel/localStorage fallback; host simulates, guests stream input.

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — layers, modules, data flow, netcode, testing.
- [EVENTS.md](EVENTS.md) — event-bus contract for Phase 2 (catalog + subscribers).
- [PLAN.md](PLAN.md) — phased refactor plan and current status.
- [AGENTS.md](AGENTS.md) — workflow contract for AI/human contributors.
- `.opencode/skills/` — task skills auto-discovered by OpenCode (zero-build refactor,
  multiplayer debug).

## Support

The in-game **Support me** button (bottom-left) links to [ko-fi.com/hrodic](https://ko-fi.com/hrodic).

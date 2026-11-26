# Manual smoke checklists

The architecture refactor has a **golden rule: every commit must leave the game
playable, deployable and the automated tests green.** Run the quick smoke after every
change; run the full checklist at the end of every phase.

Serve the repo over http first (`python -m http.server 8000` or any static server).

## Quick smoke (~1 minute) — after EVERY commit

- [ ] `http://localhost:8000/` loads with no console errors; setup modal renders.
- [ ] Launch single player (default 15×15).
- [ ] Move: WASD + click-to-move + minimap click.
- [ ] Slash (Space/F) works.
- [ ] Right-click pistol fires (tracer + accuracy label).
- [ ] Capture one block (progress bar → tint change).
- [ ] One economy tick fires (hour advances, income/upkeep applied).
- [ ] `http://localhost:8000/tests/tests.html` → all tests green, title says `PASS`.

## Multiplayer quick check (two tabs) — any change touching sim/net/shared state

> **Deterministic offline variant:** open `tests/mp-harness.html` in two tabs. It embeds
> the game in an iframe, which forces the same-origin BroadcastChannel/localStorage bus
> instead of the external Trystero relays (useful when relays are down or flaky).

- [ ] Tab A: Host creates a room (room code shown).
- [ ] Tab B: Join with `RoomCode:Secret`; lobby shows both players.
- [ ] Slot toggles (human/AI) sync to the guest; guest settings summary matches host.
- [ ] Launch; both bosses move; guest slash/shoot works through host simulation.
- [ ] Guest recruit toggle/caps reach the host (auto-recruit respects them).
- [ ] Guest closes tab → host shows "AI took control" toast.
- [ ] Host closes tab → guest sees the disconnect banner.

## Full checklist — end of EVERY phase

### Setup & shell
- [ ] No console errors; Tailwind styles applied; HUD header renders.
- [ ] Ko-fi **☕ Tip me** button renders in the top bar between version and seed; clicking it opens the Ko-fi popup; no floating launcher is visible.
- [ ] Setup modal shows the version where "Criminal Empire Edition" used to be (no duplicate).
- [ ] Setup modal: mode buttons (Single/Host/Join), faction count 2/3/4, org dropdowns
      (unique orgs enforced), map size slider 5–25 + presets + cap preview,
      tick speed 10–30 s, income tier Low/Mid/High.

### Single player

- [ ] World seed: start with a known seed, New Game, reuse it → same map; change it → different map.
- [ ] Seed badge/Copy puts the current seed on the clipboard.- [ ] Boss HP/armor/cash/sprint/hour HUD values update correctly.
- [ ] Movement: WASD, arrows, click street, minimap click; waypoint marker shows.
- [ ] Collision: cannot walk through buildings/cars/dumpsters; doors/alley paths work.
- [ ] Sprint: 1.6× burst 2 s, cooldown 4 s, HUD bar reflects state.
- [ ] Slash hits up to 3 enemies with knockback + blood + floating damage text.
- [ ] Pistol: range ring, accuracy label, tracers, casings, ricochets, misses ("MISS!").
- [ ] Armor: Q/button buys 300 armor ($3,500), absorbs damage, once per tick, HUD shows.
- [ ] Rival AI bosses buy armor, use pistol/slash, capture blocks, recruit crew.
- [ ] Territory: capture bar fills, block tint updates, minimap updates.
- [ ] Economy: hourly tick adds income minus upkeep; treasury never negative.
- [ ] Auto-recruit: toggles + caps work; units spawn near boss/owned turf; limits honored.
- [ ] Build/border controls are gone (no Expand Ring, Click-Build or Borders buttons).
- [ ] Outside the generated map, a subtle dark city backdrop is visible (not flat black).
- [ ] City Radar is larger/readable and still shows player/boss/unit markers.
- [ ] Bottom action bar: slash/pistol/armor/sprint cooldowns, costs, shortcuts and tooltips;
  armor shows a cooldown overlay; sprint works while holding the button.
- [ ] Leaderboard shows Turf / Crew / Kills with a readable rank order.
- [ ] Kill a rival boss → toast + turf neutral; kill all → victory banner + summary.
- [ ] Die → defeat banner → Spectate pans camera → spectator banner "Leave/New Game".
- [ ] Music: Noir I → Noir II → OFF; SFX toggle mutes/unmutes.
- [ ] New Game returns to setup and next match starts clean (no stale units/turf/timers).

### Multiplayer (two tabs, same origin → local bus)
- [ ] Host creates/room code copies invite link; invite URL auto-fills join panel.
- [ ] Guest joins, gets assigned a syndicate and settings echo the host's.
- [ ] Human/AI slot toggles and org changes broadcast to the guest.
- [ ] Version mismatch rejection works (simulate by editing `GAME_VERSION` in
  `src/config/version.js` in one tab).
- [ ] Launch: world identical on both peers (same seed); guest cannot choose the seed, sees the host's seed badge, and sees all factions.
- [ ] Guest input: movement, sprint, facing/aim, slash, shoot, armor, recruit prefs,
      capture, recruit, slash/shoot and armor all take effect on host simulation.
- [ ] Snapshots smooth (interpolation) and combat animations show on guest.
- [ ] Host/guest HP, armor, cash, hour and standings match; guest leaderboard reflects host kills.
- [ ] Peer leaves mid-match → AI takeover toast; remaining players continue.
- [ ] Host leaves mid-match → guests see disconnect modal → Return to Menu.

### Automated
- [ ] `tests/tests.html` all green.
- [ ] No new console errors/warnings introduced by the change.

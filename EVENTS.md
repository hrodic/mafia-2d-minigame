# Events — Phase 2 contract

Status: the bus is implemented in `src/core/events.js` with tests in
`tests/events.test.js`. Migration of simulation side effects to events is in progress; the
transitional `core/runtime.js` hooks remain active until each one is replaced. The end state
is a fully headless `sim/` plus independent presentation subscribers.

## Bus API

```js
// src/core/events.js (implemented)
export function on(type, handler) {}   // subscribe; returns an idempotent unsubscribe
export function off(type, handler) {}
export function emit(type, payload) {} // synchronous dispatch
export function clear() {}             // tests / full match reset: remove all subscribers
```

Rules:

- Handlers are synchronous and isolated: a throwing subscriber is caught and logged, and
  never interrupts the simulation or other subscribers.
- Dispatch uses a snapshot: subscribing or unsubscribing during `emit` affects the next
  emit, not the current one.
- Events are **facts** (past tense). Emit them after the state mutation that produced them.
- Subscribers must not mutate gameplay state, emit cascades, or do heavy work; they only
  render/play/send/log.
- `sim/` emits events and must not import subscribers (`render/`, `audio/`, `ui/`, `net/`).
- Emit only discrete transitions. Never emit per frame or per NPC per frame; continuous
  visuals (positions, HP, timers) are read from state.
- Keep payloads small. Entity references are fine during the call; do not retain them.

Naming: `domain:pastTense` (`unit:damaged`, `chunk:captured`, `match:victory`).

## Event catalog

| Event | Payload | Emitted by |
|---|---|---|
| `unit:damaged` | `{ unit, amount, absorbed, remainingHp, hitAngle, source }` | combat |
| `unit:died` | `{ unit, faction, rank, x, y, facing, byPlayer }` | combat |
| `boss:died` | `{ faction, boss, x, y }` | combat/territory |
| `faction:eliminated` | `{ faction }` | territory |
| `chunk:captured` | `{ chunk, faction }` | territory |
| `slash:performed` | `{ attacker, x, y, facing, color, hitCount }` | combat |
| `shot:fired` | `{ shooterFaction, x1, y1, x2, y2, color, missed, impact }` | combat |
| `armor:equipped` | `{ unit, amount, faction }` | combat |
| `armor:broken` | `{ unit }` | combat |
| `unit:recruited` | `{ unit, faction, rank, cost, silent }` | units/economy |
| `hour:tick` | `{ hour, income, upkeep, treasuries }` | economy |
| `match:victory` | `{ summary }` | territory |
| `match:defeat` | `{ faction }` | territory |
| `ui:toast` | `{ message }` | any sim system |

## Subscriber map (wired once in `main.js`)

| Subscriber | Listens to | Action |
|---|---|---|
| `render/effects.js` | `unit:damaged`, `unit:died`, `slash:performed`, `shot:fired`, `armor:*`, `chunk:captured`, `unit:recruited` | blood/sparks, corpses, arcs, tracers/casings/muzzle flash, floating text |
| `audio/sfx.js` | `slash:performed`, `shot:fired`, `unit:died`, `boss:died`, `armor:equipped`, `faction:eliminated`, `match:victory` | play synthesized SFX |
| `ui/hud.js` | `chunk:captured`, `hour:tick`, `unit:recruited`, `armor:*`, `match:*` | refresh HUD; show/hide banners |
| `ui/menus.js` | `ui:toast`, `match:victory`, `match:defeat` | toast + banner content |
| `net/mpNet.js` (host) | `shot:fired` | broadcast the ephemeral SHOT event to guests |

Snapshot state still comes from the host; events are only for ephemeral presentation.

## Migration plan

1. **DONE** — `src/core/events.js` + `tests/events.test.js` (subscribe/emit/unsubscribe,
   throw isolation, snapshot dispatch, clear).
2. Add `emit(...)` calls at the existing `runtime.*` call sites, one system at a time:
   combat → units/economy → territory → match.
3. Wire subscribers in `main.js` (effects/audio/HUD/toasts/banners/net). Remove the
   corresponding `runtime` hook.
4. Keep the HUD fallback (`updateHUD`) for periodic refreshes triggered by the simulation
   loop; discrete events can request immediate refreshes via a coalesced flag.
5. When `runtime.js` has no remaining hooks, delete it and update `ARCHITECTURE.md`.

## Testing

- Subscribe in a test, perform the action, assert payloads and ordering.
- Assert a throwing subscriber does not break `emit` or the caller.
- Existing mechanics tests (combat/economy/territory/units) should keep passing unchanged;
  events are additive until hooks are removed.

## Benefits

- **Headless simulation.** `sim/` still imports `audio/sfx.js`, `render/effects.js` and
  `render/canvas.js` directly, so it cannot run without a browser. Events remove those
  imports: gameplay emits, presentation subscribes.
- **One-to-many facts.** One `unit:damaged` can drive floating text, blood, SFX, HUD
  invalidation and an optional network effect without editing the damage function.
- **One wiring point.** Subscribers are registered once in `main.js`, not scattered across
  combat/territory/units/economy.
- **Behavior-level tests.** Assert emitted facts and payloads without mocking audio/canvas.
- **Swappable presentation.** Canvas, a replay viewer or a future renderer can change
  without touching gameplay code.
- **Fewer cycles.** Cross-layer imports disappear; module load order matters less.

## Tradeoffs and mitigations

| Tradeoff | Mitigation |
|---|---|
| Indirection: the effect is no longer at the call site | Stable `domain:pastTense` names, the catalog below, one subscriber map, tests |
| Untyped payloads in JavaScript | Keep payloads small, test them, treat the catalog as the contract |
| Double effects during migration (hook + event) | Migrate one system per commit; delete the old hook in the same change |
| Global subscriptions can leak | Wire once at startup; keep/return unsubscribe; `clear()` on full reset; tests call `clear()` |
| Synchronous dispatch adds frame cost | Discrete events only, cheap handlers, batch HUD/DOM work |
| Hidden ordering/cascades | Subscribers must not emit events or mutate gameplay state |
| Events mistaken for state | Snapshots/state remain authoritative; events are ephemeral facts |
| Overhead on a tiny codebase | Use direct calls inside `sim/`; reserve events for cross-layer boundaries |

## When to use events

Use them for **discrete, cross-layer facts**:

- damage, death, armor break, recruit, capture, hourly tick, victory/defeat;
- one action several independent systems care about (effects + audio + HUD + net);
- behavior assertions in tests;
- optional analytics/replay hooks.

## When NOT to use events

- **Per-frame or per-NPC-per-frame updates** (position, timers, HP bars, animation state).
  Render these from `state` every frame instead.
- **Authoritative state or replication.** Snapshots are the source of truth; never rely on
  event delivery for correctness or late joiners.
- **Input/commands.** Use the command path (Phase 3 dispatcher); events are not requests.
- **Intra-simulation control flow/AI communication.** Direct calls and data are simpler.
- **Request/response** where a return value is needed.
- **Expensive or async work** (network serialization, layout, file I/O) inside a handler.
- **Ordering-critical gameplay logic.** Make the order explicit in code.
- **High-frequency loops.** If event rate grows with `NPCs × frames`, redesign.

## Performance budget: many NPCs + multiplayer

The bus is synchronous and copies the handler set per `emit` (`Array.from`). That is
negligible for dozens to low hundreds of discrete events per second and wrong for
thousands. The rule is:

> **Event rate must scale with discrete actions, not with entity count × frame rate.**

Hot-path shape:

```js
update(dt):
  for (const npc of state.npcs) {
    // AI/movement/combat mutate state
    // emit only on transitions: attack, damage, death, capture
  }
  // HUD refresh on its existing cadence/dirty flag

render():
  // read positions, HP, timers and animation state directly from `state`
```

Rules:

- **No movement/position/timer events.** Continuous visuals are state-driven.
- **No HUD writes per event.** Set a dirty flag; refresh at the existing cadence (~4 Hz in
  `simulation.js`), not on every damage tick.
- **Cap and cull effects.** Limit floating damage numbers, tracers, casings and corpses;
  skip off-screen effects. At high NPC counts, merge multi-hit numbers.
- **Throttle audio.** Do not create many overlapping synth nodes in one frame; the SFX layer
  already distance-culls—keep it that way.
- **Keep handlers cheap.** No layout reads/writes, DOM queries or serialization in the
  simulation frame. Queue expensive work or run it on the HUD cadence.
- **No cascades.** Subscribers must not `emit` or mutate gameplay state; depth stays 1.
- **Payloads are live references.** Do not retain entity objects after the handler returns
  unless you copy the fields you need.

### Multiplayer specifics

- **Host emits gameplay facts; guests do not simulate.** Guests must not emit combat,
  capture or economy events.
- **Snapshots are the transport.** Do not turn routine events into network messages; they
  duplicate state and break late joiners. Only broadcast ephemeral facts that snapshots
  cannot express (e.g. a tracer), and throttle/coalesce them.
- **Never emit per NPC while applying snapshots.** Guest presentation is derived from
  snapshotted state and interpolation, not from a replay of host events.
- **Keep the host frame budget.** `emit` is inline: a slow subscriber delays the simulation
  and therefore the snapshot rate. Prefer batching/queueing in `net/` over synchronous sends.
- **Measure.** If event count or handler time grows with NPC count or snapshot rate, move
  that concern back to state-driven rendering.

If profiling ever shows the bus itself is hot, optimize in this order: skip emits with no
subscribers (already done), avoid `Array.from` when the handler set is not mutated, then
copy-on-write per-type arrays. Do not optimize before measuring.

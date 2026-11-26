# Events — Phase 2 contract (proposed, not implemented yet)

This is the intended event-bus design for Phase 2. It replaces the transitional
`core/runtime.js` hooks so `sim/` becomes fully headless and presentation is a set of
independent subscribers.

## Bus API

```js
// src/core/events.js
export function on(type, handler) {}   // subscribe; returns an unsubscribe function
export function off(type, handler) {}
export function emit(type, payload) {} // notify subscribers synchronously
export function clear() {}             // tests: remove all subscribers
```

Rules:

- Handlers are synchronous and isolated: a throwing subscriber is caught and logged, and
  never interrupts the simulation or other subscribers.
- Events are **facts** (past tense). Emit them after the state mutation that produced them.
- Subscribers must not mutate gameplay state; they only render/play/send/log.
- `sim/` emits events and must not import subscribers (`render/`, `audio/`, `ui/`, `net/`).
- Do not emit per-frame noise (movement, timers). Coalesce or emit only discrete facts.
- Keep payloads small and serializable-friendly (references to entities are fine locally).

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

1. Add `src/core/events.js` + `tests/events.test.js` (subscribe/emit/unsubscribe,
   throw isolation, clear).
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

## Why this matters

Phase 2's other changes (data-driven balance, explicit RNG, dedup) are behavior-preserving
and already guarded by tests. The event bus is the one structural change that can silently
drop presentation effects; the catalog above keeps the effects/audio/HUD wiring explicit
and testable.

# BALANCE.md — current tuning reference

Snapshot for **0.7.0**. The executable source of truth is
`src/config/balance.js` + `src/config/constants.js`; this file exists so the full
stat surface can be read and compared in one place. Update it in the same commit as
any intentional tuning change.

## Match & world defaults

| Value | Current |
|---|---|
| Grid range | 5×5 to 25×25 |
| Default setup | **Normal**: 15×15, 15s tick, Mid income |
| Engine fallback tick | 10s |
| Start cash | $5,000 |
| Start hour | 19:00 |
| Active factions | 4 |
| Tile size | 66 px |
| Chunk size | 15×15 tiles |
| Chunk pixel size | 990 px |
| Simulation step | 1/120 s |
| Max frame delta | 0.25 s |
| Max catch-up steps | 8 |

## Unit ranks

The table uses canonical rank names. In-game, each syndicate uses its own titles (Boss →
Don / Pakhan / Oyabun / Shan Chu / Capobastone / Patrón); the field manual lists them.
“Blade” is the per-hit melee damage range. “Capture/tick” is chunk progress per game
tick, scaled automatically by the configured tick length; points from multiple units stack.
Boss armor is bought separately; Underboss starts with armor.

| Rank | HP | Armor | Blade dmg | Speed | Capture/tick | Regen/s | Radius | Hire | Upkeep/hr | Cap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Boss | 800 | 0 → 300 | 30–40 | 140 | 1 | 5 | 13.5 | — | — | 1 |
| Underboss | 800 | 120 | 25–35 | 150 | 1 | 4 | 12.8 | $4,000 | $600 | ×1 grid side |
| Captain | 600 | 0 | 20–30 | 160 | 0.5 | 2 | 12 | $2,500 | $300 | ×2 grid side |
| Soldier | 300 | 0 | 15–25 | 170 | 0.2 | 1 | 11 | $1,000 | $100 | ×10 grid side |

Regen only runs while a unit is standing on its own faction's turf, is below max HP,
and is not in the hit-flash window after taking damage. It is integrated into the existing
per-unit simulation loop and reuses `hitFlashTimer`, so there is no extra timer or pass.

Derived notes:

- Capture alone: Boss/Underboss 1 tick · Captain 2 ticks · Soldier 5 ticks. At a 15s
  default tick that is 15 / 15 / 30 / 75 seconds.
- Enemy turf cannot be captured while any living enemy unit stands on it; neutral turf
  (including a defeated faction's former turf) never resists.
- HP per $1,000 hire: Soldier 300 · Captain 240 · Underboss 200.
- Upkeep as % of hire per hour: Soldier 10% · Captain 12% · Underboss 15%.

## Rank caps

Hard caps scale with the **grid side**, not the number of neighborhoods:

- Underbosses: `side × 1`, minimum **1**
- Captains: `side × 2`, minimum **2**
- Soldiers: `side × 10`, minimum **10**
- Boss: always **1**

| Grid | Underboss max | Captain max | Soldier max | Default slider (full) |
|---|---:|---:|---:|---|
| 5×5 | 5 | 10 | 50 | 5 / 10 / 50 |
| 10×10 | 10 | 20 | 100 | 10 / 20 / 100 |
| 15×15 | 15 | 30 | 150 | 15 / 30 / 150 |
| 20×20 | 20 | 40 | 200 | 20 / 40 / 200 |
| 25×25 | 25 | 50 | 250 | 25 / 50 / 250 |

Crew Limits let the player lower each maximum inside that range. Changing grid size
resets the sliders to the full ceiling. Human and AI factions both start at the full
ceiling; lowering the sliders is an explicit choice.

## Combat

### Knife slash

| Unit | Reach | Targets | Arc | Knockback | Cooldown |
|---|---:|---:|---:|---:|---:|
| Boss (human + AI) | 52 px | 3 | 150° | 10 | 0.8 s |
| Underboss | 50 px | 3 | 120° | 10 | 1.0 s |
| Captain | 48 px | 2 | 100° | 10 | 1.2 s |
| Soldier | 46 px | 1 | 90° | 10 | 1.5 s |

`arc` is stored as a fraction of 180° (a 150° cone is `150 / 360`). The cone is centered on
facing and always applies at any distance inside reach: there is no point-blank
forgiveness, so an enemy behind the attacker is never hit. Positioning and aim decide a
melee fight. AI units turn to face their target before swinging. The residual slash arc
drawn on screen uses the same per-rank value, so the visible sweep matches the hit cone.

Targets are sorted nearest-first and only the first `maxTargets` are damaged, so bosses and
underbosses cleave up to 3, captains up to 2, and soldiers hit 1.

### 9 mm pistol

Base damage **50–80**, knockback **10–15**, max range **600 px**.
**Bosses and underbosses** (human and AI) fire on a **0.2 s** cadence from a
**10-round** magazine. Reloading takes **4 s**; pressing **R** reloads early and discards
the remaining rounds. Captains and soldiers are knife-only and carry no ammo at all.
Pistol rounds can hit **same-faction units**; AI shooters hold fire when a building, prop
or ally is in the bullet path. Knives never hit allies.

| Distance | Damage | Hit chance |
|---|---:|---:|
| ≤ 100 px | 80% | 90% |
| ≤ 200 px | 90% | 80% |
| ≤ 300 px | 100% | 70% |
| ≤ 400 px | 100% | 60% |
| ≤ 500 px | 100% | 50% |
| ≤ 600 px | 100% | 40% |
| > 600 px | 0% | 0% |

### Critical hits

| Value | Current |
|---|---|
| Base chance | **5%** |
| Back-hit bonus | **+15%** (20% total) |
| Back cone | rear **120°** of the victim's facing |
| Multiplier | **2×** damage |
| Applies to | every melee and pistol hit, rolled per victim |

Roll order: hit chance (pistol) → base damage roll → distance falloff (pistol) → critical
roll → armor → HP. A miss can never crit. Each target of a cleave rolls separately. The
back check uses the victim's facing against the incoming strike direction and costs one
cosine per hit; it adds no raycast or allocation.

### AI tactics

| Value | Current |
|---|---|
| Boss retreat HP | **≤ 35%** |
| Boss retreat trigger | **no armor** and (HP ≤ 35% or ≥ 3 enemies with more enemies than allies) |
| Boss retreat | **2.2 s**, target 280 px away, sprint burst |
| Pistol flank | **90 px** lateral sidestep, committed for **0.9 s** |
| Flank fallback | back off 72 px when both sides are blocked |
| Close range | knife takes priority; knives never hit allies |
| Armor | boss buys armor when it is missing/low and affordable; retreat is the fallback |

Pistol shooters hold fire while any ally is in the bullet path. They sidestep to re-open the
lane, then fire as soon as it is clear.

### Armor & sprint

| Value | Current |
|---|---|
| Boss armor purchase | $3,500 |
| Boss armor amount | 300 |
| Armor cooldown | one hour |
| Sprint multiplier | 1.6× |
| Sprint duration | 2.0 s |
| Sprint cooldown | 4.0 s |

## Economy

### Income tiers

| Tier | Income per neighborhood per hour |
|---|---:|
| Low | $500–$1,000 |
| Mid | $1,000–$1,500 |
| High | $1,500–$2,000 |

Income is paid every tick/hour; upkeep is charged at the same time. Net can push the
treasury **negative**. Negative cash does not block movement, but all purchases and
auto-recruitment require enough cash for their cost.

### Corruption

Every **10 controlled neighborhoods** adds **1% turf corruption**. Every **25 living
units** adds **1% crew corruption**. Total corruption is applied as an income penalty:

```text
effective income = round(gross income × (1 − total corruption / 100))
net = effective income − upkeep
```

There is no cap. The Crew Management totals show Turf corruption, Crew corruption and
the combined total.

### Setup presets

| Preset | Grid | Tick | Income |
|---|---|---|---:|
| Turbo | 10×10 | 10 s | High |
| Normal | 15×15 | 15 s | Mid |
| Long game | 20×20 | 25 s | Low |

## Weather & time

- Day: **08:00–21:00**, rain chance **25%**.
- Night: **22:00–07:00**, rain chance **50%**.
- Rain is re-decided only when the day/night period flips.
- Streetlamps fade off 07:00–08:00 and on 21:00–22:00; off during the day, on at night.
- Night ambient overlay is darker than day; lamps and window lights are the main
  visibility aids.

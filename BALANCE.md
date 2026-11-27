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

## Unit tiers

“Blade” is the per-hit melee damage range. “Capture” is chunk progress per second.
Boss armor is bought separately; Underboss starts with armor.

| Rank | HP | Armor | Blade dmg | Speed | Capture/s | Radius | Hire | Upkeep/hr | Cap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Supreme Leader / Boss | 400 | 0 → 300 | 20–40 | 140 | 0.375 | 13.5 | — | — | 1 |
| Second-in-Command / Underboss | 480 | 120 | 26–38 | 150 | 0.24 | 12.8 | $3,800 | $380 | ×1 grid side |
| Middle Management / Captain | 340 | 0 | 18–28 | 150 | 0.18 | 12 | $2,200 | $220 | ×2 grid side |
| Street Enforcers / Soldier | 180 | 0 | 10–18 | 150 | 0.12 | 11 | $1,200 | $120 | ×10 grid side |

Derived notes:

- Capture time alone: Boss ~2.7s · Underboss ~4.2s · Captain ~5.6s · Soldier ~8.3s.
- HP per $1,000 hire: Soldier 150 · Captain 154.5 · Underboss 126.3.
- Upkeep as % of hire per hour: Soldier 10% · Captain 10% · Underboss 10%.

## Tier caps

Hard caps scale with the **grid side**, not the number of neighborhoods:

- Underbosses: `side × 1`, minimum **1**
- Captains: `side × 2`, minimum **2**
- Soldiers: `side × 10`, minimum **10**
- Boss: always **1**

| Grid | Underboss max | Captain max | Soldier max | Default slider (half) |
|---|---:|---:|---:|---|
| 5×5 | 5 | 10 | 50 | 3 / 5 / 25 |
| 10×10 | 10 | 20 | 100 | 5 / 10 / 50 |
| 15×15 | 15 | 30 | 150 | 8 / 15 / 75 |
| 20×20 | 20 | 40 | 200 | 10 / 20 / 100 |
| 25×25 | 25 | 50 | 250 | 13 / 25 / 125 |

Crew Limits let the player lower each maximum inside that range. Changing grid size
resets the sliders to half of the new ceiling. Human factions start at that half quota;
AI factions start at the full ceiling.

## Combat

### Knife slash

| Profile | Reach | Targets | Arc | Close range | Knockback | Cooldown |
|---|---:|---:|---:|---:|---:|---:|
| Human Boss | 52 px | 3 | 0.42 rad | 30 px | 14 | 0.34 s |
| AI Boss | 52 px | 3 | — | — | 12 | 1.0 s |
| AI melee ranks | 46 px | 1 | — | — | 0 | 1.0 s |

### 9 mm pistol

Base damage **40–80**, knockback **16**, max range **1,000 px**.
Human Boss cooldown **0.65 s**; AI pistol cooldown **1.0 s**.

| Distance | Damage | Hit chance |
|---|---:|---:|
| ≤ 50 px | 25% | 100% |
| ≤ 100 px | 50% | 100% |
| ≤ 250 px | 100% | 100% |
| ≤ 500 px | 100% | 95% |
| ≤ 750 px | 100% | 90% |
| ≤ 900 px | 100% | 75% |
| ≤ 1,000 px | 100% | 50% |
| > 1,000 px | 0% | 0% |

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

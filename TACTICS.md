# Tactics & Operational Stance

**Status: current implementation.** This file is the single source for the
high-level AI posture and rules of engagement. `BALANCE.md` owns tuning numbers,
`ARCHITECTURE.md` owns module flow, and this file owns intent and behavior.

## Bottom line

There is a **faction command layer** for the human player, but every AI unit still acts as an
independent agent with no squad coordination.

The current command posture defaults to:

> **GLOBAL: EXPAND · LOCAL: ATTACK**

The current grand posture remains:

> **Opportunistic local territorial creep with nearest-enemy skirmishing.**

AI factions do not form fronts, mass forces, defend strategically, or coordinate attacks.
They expand into whatever non-owned block is nearest, fight whatever enemy is nearest, and
otherwise walk to a random point inside the target block and capture it.

## Command layer

Each faction carries `state.factionTactics[faction]`:

| Field | Meaning |
|---|---|
| `globalStance` | **1 Defend** · **2 Expand** (default) |
| `localOrder` | **1 Guard** · **2 Attack** (default) |
| `bossInDanger` | Boss HP ≤ 35%, or ≥ 3 nearby enemies with more enemies than allies |
| `threatenedChunks` | Owned chunks containing living enemies |
| `localFocusId` | Nearest enemy on the boss chunk, else nearest within 360 px |
| `updatedAt` | Accumulated simulation seconds of the last refresh |

`sim/tactics.js` refreshes these facts every **250 ms** inside the fixed simulation step. It
also sets per-unit `inBossAura` with hysteresis: **325 px enter / 360 px exit** for both
local orders. The 200-300 px gunner ring stays local.

Scope split:

- **Global stance** governs allies **outside** the boss aura.
- **Local order** governs **non-boss allies inside** the aura.
- The boss itself is never ordered; its own survival and combat logic always wins.

Controls:

- **G** opens the global menu; **1** Defend, **2** Expand.
- **L** opens the local menu; **1** Guard, **2** Attack.
- The shop (**B**) and order menus are mutually exclusive; selecting an order closes it.
- Orders are host-authoritative commands and are mirrored to guests in snapshots.

**Implementation status:** the command layer, UI, commands and snapshot sync are live.
Defaults **Expand + Attack** preserve the pre-command behavior. **Global Defend** and
**Local Guard** are wired. Guard keeps non-boss crews in a scattered ring around the boss:
Soldiers/Captains at **50–150 px** and Underbosses at **200–300 px**, covering all
directions. Attack crews collapse into the same guard ring when the boss is in danger.
All other behavior is unchanged.

## Operational directives

### 1. Expand — nearest non-owned block

When no enemy is in aggro range, each unit periodically picks a patrol target:

- scans a **7×7 chunk neighborhood** around itself,
- chooses the nearest chunk where `chunk.faction !== unit.faction`,
- treats **neutral and enemy turf equally**,
- walks to a **random walkable point** inside that chunk,
- captures the chunk on arrival.

If no non-owned chunk exists in that neighborhood, it falls back to the **first non-owned
chunk in the global chunk map**, not the nearest one.

Patrol retargeting happens every **1.6–3.4 s**.

There is no preference for:

- neutral over enemy turf,
- high-income neighborhoods,
- weakly defended blocks,
- blocks adjacent to the current front,
- or any strategic objective.

### 2. Defend — owned turf only

Global **Defend** changes destination selection for **non-boss allies outside the boss aura**.
It does not change combat, pathing, retreat or capture.

When no enemy is in aggro range:

- if owned blocks are threatened, the nearest threatened owned block is the destination,
- otherwise the nearest **owned border block** (an owned block with a non-owned neighbor),
- otherwise the nearest owned block,
- if the faction owns no turf, the unit holds position.

Defend units **never choose neutral or enemy turf as a patrol destination**.

Borders are destination-only: pathing, backoff, flanking, retreat and pursuit may still cross
into non-owned turf. Automatic capture is untouched, so a Defend unit that chases an enemy
across a border or happens to stand on neutral turf still captures it. **Defend prevents
deliberate expansion, not accidental capture.**

Inside the boss aura the local order still wins, so a **Defend + Attack** faction keeps
expanding around the boss while distant crews hold turf.

### 3. Guard — screen the boss

Local **Guard** applies to non-boss allies inside the local aura. It replaces patrol
selection with a scattered defensive ring around the boss.

- **Soldiers and Captains** hold a scattered post between **50 and 150 px** from the boss.
- **Underbosses** default to a scattered post between **200 and 300 px** and fire from
  there; if a target is out of gun range they may step in, then return.
- Slots are deterministic per unit: a golden-angle direction with a small jitter plus a
  hashed distance. There is **no rear bias**; the result covers all directions without
  forming a perfect ring.
- If a slot points into a wall or off the map, the post searches the walkable ring and keeps
  at least **60%** of the intended distance instead of collapsing onto the boss.
- Each guard caches a **stable slot**; when it reaches the post it stands still inside a
  **14 px idle deadzone** instead of micro-correcting or orbiting the boss.
- The local focus enemy is the shared **priority** target. It is not the only target:
  without a valid focus, guards still engage the nearest enemy in their own aggro range.
- Guards may chase the focus or a self-defense target inside their normal aggro range, up to
  **1000 px** from the boss. They keep their guard assignment while outside the local aura
  and return to their post once the fight ends.
- A focus outside the **360 px** local focus radius is dropped and the guard returns to its
  post unless a nearer enemy is engaging it.
- Guard units do not patrol for new blocks. Automatic capture still runs if they happen to
  stand on non-owned turf.
- The boss itself is never ordered; its own survival and combat logic remain in control.

The local aura is **325 px enter / 360 px exit** for **both** Guard and Attack. The same
units stay under the local order when you switch; only the order changes.

**Self-defense:** an enemy inside the guard's immediate reach always overrides the shared
focus. Melee guards answer an adjacent attacker first; Underbosses answer a close threat
inside **180 px** first. Without a valid focus, guards still engage the nearest enemy in
their normal aggro range instead of standing idle.

**Guard assignment / recall:** a unit that was guarding keeps `guardAssigned` state while it
chases outside the 325/360 bubble. It does not fall back to the global stance during the
fight. After the target is gone it returns to its scattered post. The assignment clears when:

- the boss is farther than **1000 px**,
- the local order changes to Attack and the boss is not in danger,
- the boss dies or the faction is eliminated.

If the player switches to Attack while guards are outside the bubble, they resume the global
stance until they re-enter the local aura.

**Focus debounce:** acquiring the first focus and dropping a lost focus are immediate. A
switch to a different enemy must survive **two 250 ms refreshes (~0.5 s)** before it commits,
so two equidistant enemies cannot swing the ring back and forth.

**CPU cadence:** guard posts are rebuilt only when the 250 ms command layer publishes a new
revision, not every simulation frame. Between refreshes guards reuse the cached post.

**Attack + boss danger:** when the boss is in danger, Attack crews temporarily behave like
Guard and collapse into the same scattered ring. Normal Attack resumes when the danger
clears.

### 4. Engage — nearest enemy only

A unit engages when an enemy is inside its aggro range:

- ranged ranks: **680 px**
- melee ranks: **480 px**

It always targets the **nearest** enemy. It does not prioritize:

- the enemy boss,
- low-HP enemies,
- shooters,
- capturers,
- or units threatening owned turf.

There is no focus fire between allies.

### 5. Capture — stand on the block

Capture progress advances while a non-retreating unit stands on a non-owned chunk.

- **Neutral turf never resists**, even if enemies are standing on it.
- **Enemy turf requires the chunk to be clear of living enemy units.**
- Multiple friendly units stack capture points.
- Capture points per tick: Boss/Underboss **1**, Captain **0.5**, Soldier **0.2**.
- A retreating boss does not capture.
- Units can keep capturing while fighting on the same chunk if the capture rule allows it.

### 6. Survive — boss only

Only the boss has a survival directive.

Danger is:

- **HP ≤ 35%**, or
- **≥ 3 nearby enemies with more enemies than allies**.

When in danger:

- the boss retreats for **2.2 s** toward a point about **280 px** away,
- prefers own turf when selecting the retreat point,
- uses the boss sprint,
- **armor does not cancel the retreat**,
- the retreat re-commits while the danger persists.

When healthy and not outnumbered:

- inside **110 px** the boss commits to melee instead of kiting,
- it may still fire while closing,
- the knife takes over inside melee reach.

Underbosses, captains and soldiers have no survival retreat. They fight until dead.

### 7. Buy — boss only

Only boss-rank units shop. Shopping requires friendly turf.

AI boss equipment shop, once per second:

1. **Glock 19** first.
2. First **20 rounds** when dry, then reload.
3. **MP9** after **5 living units** and **3 owned blocks** if $4,000 is available.

Armor is a separate purchase: **Kevlar** when missing/low, affordable and off cooldown.

Underbosses, captains and soldiers never shop.

### 8. Reinforce — safe owned block

Under **Expand**, AI reinforcements spawn in a **random owned chunk**; player reinforcements
prefer the boss's chunk when the boss is on owned turf.

Under **Global Defend**, reinforcements are placed on safe friendly turf near the threat:

1. the threatened owned block itself, if it holds fewer than **3** enemies,
2. otherwise the nearest safe owned block to that threat,
3. with no threat, the nearest owned border block to the boss.

A block holding **3+** enemies is avoided whenever a safe alternative exists. After spawning,
the unit immediately follows the same independent patrol/engage directive.

There is no “send reinforcements to the front” or “defend this block” order.

### 9. Garrison defense — incidental only

Global Defend changes **where distant allies go and where reinforcements spawn**, but there is
still no reactive defense system.

Units do not:

- respond to an enemy capturing owned turf,
- regroup to protect the boss,
- guard chokepoints or buildings,
- prioritize threatened blocks,
- or return home to defend.

Defense happens only when an enemy happens to enter a unit's local aggro range.

## Per-rank directives

| Rank | Primary posture | Engagement | Survival | Shopping / armor |
|---|---|---|---|---|
| **AI Boss** | Expand locally; survive when in danger | Gun from melee reach to weapon range; healthy boss commits to melee inside 110 px; knife inside reach | Retreats while HP ≤ 35% or outnumbered; armor does not cancel | Glock → ammo → MP9; buys armor |
| **AI Underboss** | Expand locally; ranged skirmisher | Gun from melee reach to weapon range; fires while backing off below 110 px; knife inside 50 px | None | None |
| **AI Captain** | Expand locally; melee | Knife only; 48 px, 2 targets | None | None |
| **AI Soldier** | Expand locally; melee | Knife only; 46 px, 1 target | None | None |
| **Local human Boss** | Player-controlled | Player aim and fire; point-blank allowed | Player decides | Manual shop |
| **Remote human Boss** | Player-controlled over the network | Guest input; AI takes over on disconnect | Player decides | Manual shop |

The non-boss rows describe **Expand** outside the aura and **Attack** inside it. Under Global
Defend, patrol destinations outside the aura are restricted to owned turf as described in
directive 2. Under Local Guard, inside-aura units hold a screen around the boss as described
in directive 3; combat behavior is otherwise unchanged.

## Rules of engagement

- **Target selection:** nearest enemy only.
- **Defend destinations:** owned turf only (threatened, then border, then nearest owned); capture stays automatic.
- **Guard ring:** Soldiers/Captains **50–150 px**; Underbosses **200–300 px**; scattered all-around slots.
- **Guard posts:** stable slot; **14 px** idle deadzone; chase up to **1000 px** from the boss, then return.
- **Guard recall:** an assigned guard stays Guard outside the 325/360 bubble and returns after combat.
- **Local aura:** **325 px** enter / **360 px** exit for both Guard and Attack.
- **Self-defense:** guards always engage the nearest enemy in their own aggro range, even without a focus.
- **Self-defense priority:** an adjacent melee threat or a <180 px ranged threat overrides the shared focus.
- **Focus debounce:** first focus and loss immediate; switches commit after **~0.5 s**.
- **Attack danger collapse:** boss in danger → nearby Attack crews use the same Guard ring.
- **Ranged fire band:** melee reach → weapon range. There is no 110 px minimum.
- **Underboss close range:** below 110 px, fire while backing off (80 px step, 0.6 s).
- **Boss close range:** healthy and not outnumbered → commit to melee inside 110 px.
- **Boss survival:** danger overrides melee commitment and kiting.
- **Knife:** takes over inside actual melee reach.
- **Friendly fire:** AI holds gun fire when an ally is in the bullet path; knives never hit
  allies. Human players can still hit allies with guns.
- **Firing line:** a blocked gun shooter sidesteps 90 px for 0.9 s; if both sides are
  blocked, it backs off 72 px.
- **Pathing:** A* to the goal, with a perpendicular dodge attempt when movement is blocked.

## What is intentionally absent

These are not implemented today and are the natural next iteration points:

- AI stance director (AI factions do not choose Defend or Guard on their own),
- guard-ring hard caps, bodyguard angle assignment and sprint exceptions,
- squad formation and cohesion,
- advanced bodyguard roles (caps, cover, escort assignments),
- cross-squad focus fire and target priority,
- scouting and shared vision,
- front-line or chokepoint control,
- regroup, healing, cover-seeking and crew retreat,
- fixed guard posts and patrol routes,
- coordinated multi-unit flanking,
- role assignment (scout, guard, skirmisher, etc.),
- unit-to-unit communication,
- strategic target value (income, adjacency, threat, defenses).

## Code map

| Area | File |
|---|---|
| Perception, patrol, engagement, retreat, flank, backoff | `src/sim/ai.js` |
| Movement, sprint, human-controlled rival boss | `src/sim/movement.js` |
| Boss shop, armor, friendly-fire path checks, search-terrain shooting | `src/sim/combat.js` |
| Faction command layer (stances, aura, danger, threats, focus) | `src/sim/tactics.js` |
| Tactics constants (`AI_TACTICS`, MP9 thresholds) | `src/config/balance.js` |
| Command codes, aura radii, record factory | `src/config/tactics.js` |
| Capture rules and progress | `src/sim/territory.js` |
| Recruitment and reinforcement spawn location | `src/sim/units.js` |
| AI behavior tests | `tests/ai.test.js`, `tests/combat.test.js` |
| Command-layer tests | `tests/tactics.test.js` |
| Longer integration sanity | `tests/simulation-integration.test.js`, `tests/long-sim.html` |

## Iteration rule

Change the intended directive here **first**, then update constants/logic, tests and any
affected docs in the same change. Keep this file as the high-level source of truth so the
tactics can be reviewed without reverse-engineering `ai.js`.

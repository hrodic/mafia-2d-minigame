# SKILLS.md — techniques that worked on this project

Reusable practices and pitfalls from the zero-build refactor and multiplayer debugging.
Written for the next agent session on this codebase (or a similar vanilla-JS game).

## 1. Strangler refactor for a single-file browser game

Goal: split a multi-thousand-line `<script>` into ES modules without breaking playability.

- Move the **entire script intact** into `src/main.js` and load it with
  `<script type="module">`. Modules are deferred and strict, so first check for duplicate
  top-level function declarations, top-level `this`, `with`, and any inline HTML handlers.
- Extract one cohesive subsystem per commit: `config → core → world → sim/render/audio/net
  → ui`. After each extraction: run tests + a quick smoke in a real browser.
- Dependency order matters more than the written plan. Extract movement/economy helpers
  before units/combat; extract `render/canvas.js` before simulation if `update` needs the
  canvas for aiming.
- Cross-module mutable state goes into `core/state.js` as properties of one `state`
  object. For primitives that are reassigned, importers read `state.x`; exported `let`
  bindings cannot be reassigned by importers.
- Break sim→UI dependencies with a small bridge (`core/runtime.js`) until the event bus
  exists. `main.js` wires the hooks once.

## 2. Scripted extraction (PowerShell) — safe pattern

Extracting hundreds of lines by hand is error-prone; use a script with assertions:

```powershell
$lines = [IO.File]::ReadAllLines('src/main.js')
if ($lines[190] -ne '    function foo() {') { throw 'line 191 changed' }
$block = $lines[190..320] | ForEach-Object { if ($_ -match '^    ') { $_.Substring(4) } else { $_ } }
$block[0] = 'export function foo() {'
# write module, then remove ranges BOTTOM-UP so earlier indices stay valid
```

Pitfalls learned the hard way:

- **Remove ranges bottom-up** (highest line numbers first). Replacing/removing a block
  shifts everything after it.
- **Dedent changes indentation**: replacement strings written for 6 spaces may not match
  after dedenting to 2/4. Verify with `Select-String` and fix explicitly.
- **PowerShell strings**: backticks are escapes; `${n}` avoids `$n:` drive syntax; use
  single-quoted here-strings (`@' ... '@`) for JS containing `$`, backticks or quotes.
- **Emoji/Unicode**: write files with `[Text.UTF8Encoding]::new($false)`; avoid emoji in
  script literals (construct via `[char]::ConvertFromUtf32(0x1F3B7)` if needed). Console
  output may show `??`/`×` incorrectly; trust the file bytes, not the console rendering.
- **Create target directories** before `WriteAllText` (`New-Item -ItemType Directory`).
- **Bulk token renames are dangerous**: exclude property accesses (`.name`), object keys
  (`name:`), object shorthand (`{ name }`), spreads (`...name`) and quoted strings.
  Handle those separately. A rename once corrupted the DOM id `mp-host-player-count`
  inside a string and broke the lobby.
- After extraction, run a **live browser check**. Unit tests may not import the module
  (e.g. `mpNet.js`), so missing imports only surface in the game.

## 3. Zero-dependency browser TDD

The game is testable without npm:

- `tests/tests.html` + `tests/harness.js`: `test(name, fn)`, assertions
  (`assert`, `assertEqual`, `assertDeepEqual`, `assertClose`, `assertThrows`), async
  support, green/red DOM list, `window.__TEST_RESULTS__`, and `document.title = PASS/FAIL`.
- `tests/runner.js` is the manifest: import every suite there. A **watchdog** in
  `tests.html` reports module-load failures (otherwise the page stays "Running…").
- Fixtures: `tests.html` includes hidden `<canvas id="gameCanvas">`, `#minimapCanvas`,
  HUD elements, banners and the toast, so render/HUD/menu modules can be imported and
  exercised. Without the fixtures, `canvas.js`/`hudEls` resolve to `null`.
- State is a singleton: every test saves/restores the fields it mutates (`withState`
  helpers) — clone arrays/objects when the function under test replaces them.
- For audio, disable sound (`setSoundEnabled(false)`) so SFX no-op; use a real
  `OfflineAudioContext` when testing buffer creation (a mock buffer breaks the real
  music engine later via a shared cache).
- Characterization tests: assert counts/caps/lifetimes/rates exactly as implemented.
  Test bugs are common — when a test disagrees with the code, verify the intended
  mechanics first (e.g. friendly personal-space radius ~11px; an alive player is itself a
  friendly unit).

## 4. Live multiplayer debugging

The fastest way to diagnose guest issues:

1. Serve the repo, open `tests/mp-harness.html` in two tabs. The iframe makes
   `window.self !== window.top`, forcing the same-origin **local bus** (no relays).
2. Get frame IDs with the browser tool, then `evaluate` inside each frame.
3. Import the singleton state in the page to inspect truth:
   ```js
   const { state } = await import('./src/core/state.js');
   const boss = state.npcs.find(u => u.faction === 'RIVAL_1' && u.rank === 'BOSS');
   state.net.getPeerInput(boss.humanPeerId);   // host-side last guest input
   state.keys;                                 // guest-side held keys
   boss.x, boss.netX, boss.path, boss.targetX; // movement/path state
   ```
4. Compare host vs guest: `humanPeerId`, `lastInput`, boss position, `netX`, timers.
5. Check both consoles and screenshots.

Patterns found this way:

- **Guest "frozen"**: (a) straight-line waypoint steering against buildings → use A*
  path following; (b) lost `keyup` leaves `state.keys` stuck → clear on blur/visibility
  and ignore host-side peer input older than 500 ms; (c) the host tab backgrounded → rAF
  throttled to ~1 fps. Keep the host visible or use two windows/computers.
- **Frozen animations**: guest snapshots re-armed slash/muzzle timers but nothing decayed
  them. Interpolate positions per frame and decay timers in `render/interpolation.js`.
- **Snapshot timing**: apply snapshots to `netX/netY` targets, not directly to `x/y`;
  smooth at render rate (`dt * 14`).
- **Audio error after tests**: cache noise buffers per AudioContext (WeakMap), not one
  global buffer.

## 5. Verification protocol

Before a behavior-preserving refactor, lock behavior with **golden tests**: hash the exact
output (here: FNV-1a over each seeded chunk's tiles, props, income and faction) and assert
it in `tests/world-golden.test.js`. Then the refactor is proven safe when the hashes stay
equal. Pair it with a static check (`tools/check.ps1`) so missing imports, unregistered
test suites and duplicate DOM ids fail fast, before opening a browser.

After every change:

0. `tools/check.ps1` → `OK: …` (imports, runner manifest, DOM ids).
1. `tests/tests.html` → PASS (check the console for errors, not just the summary).
2. Load the game over http, launch a match, move/slash/shoot, capture, wait a tick,
   check the console. Use screenshots for visual regressions.
3. If `sim/`, `net/` or shared state changed: two-tab MP check (lobby, launch, guest
   input, commands, snapshots, disconnect).
4. Only then report; commit/push only when the owner asks.

## 6. Documentation handoff

When pausing a long project, leave durable knowledge in the repo:

- `README.md`: what the game is, controls, run/test/deploy.
- `ARCHITECTURE.md`: layers, module map, data flow, invariants, limitations.
- `AGENTS.md`: workflow contract, environment, verification loop, pitfalls.
- `SKILLS.md`: techniques (this file).
- `PLAN.md`: phased plan with current status and deviations.

Keep docs short enough to read in a few minutes; link rather than duplicate.

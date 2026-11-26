# Zero-dependency test harness

No npm. `tests/tests.html` + `tests/harness.js`:

- `test(name, fn)` with `assert`, `assertEqual`, `assertDeepEqual`, `assertClose`,
  `assertThrows`; async supported.
- Results render green/red; `window.__TEST_RESULTS__` holds counts; `document.title` becomes
  `PASS`/`FAIL`.
- `tests/runner.js` is the manifest: import every suite there. A watchdog in `tests.html`
  reports module-load failures (otherwise the page stays "Running...").
- `tests.html` includes hidden fixtures (`#gameCanvas`, `#minimapCanvas`, HUD elements,
  banners, toast) so render/HUD/menu modules import cleanly. Without them, `canvas.js` and
  HUD refs are `null`.
- `state` is a singleton: each test saves/restores fields it mutates (`withState` helpers);
  clone arrays/objects when the function under test replaces them.
- Audio: call `setSoundEnabled(false)` for SFX tests. For buffer creation use a real
  `OfflineAudioContext`; a mock buffer poisons the per-context cache.
- Characterization tests assert current mechanics exactly (counts, caps, lifetimes, rates).
  If a test disagrees with code, verify intended behavior first; do not "fix" the test to
  match a bug.

## Golden tests

`tests/world-golden.test.js` hashes each seeded chunk (tiles, props, colors, solid mask,
income, faction) with FNV-1a. Equal hashes after a refactor prove generation is unchanged.

## Testing event migrations

- Subscribe a capture listener around the call and assert event type + payload fields.
- Wire the real presentation handlers in the test harness when you also assert effects;
  they run synchronously, so visual/RNG behavior stays identical.
- Keep at least one test that asserts behavior without presentation handlers, to prove the
  sim module is decoupled.

---
name: mafia-zero-build-refactor
description: "Use when refactoring or extending Hrodic's Mafia 2D (vanilla ES-module game): strangler module extraction, behavior-preserving dedup, PowerShell line surgery, golden tests, and zero-build/GitHub Pages constraints."
---

# Zero-build refactor

Read `AGENTS.md` first: owner rules + verification loop. This skill is the structural
procedure.

## Before editing

1. Read `ARCHITECTURE.md` (layers) and `PLAN.md` > Status (current phase).
2. Run `git status` and `git branch --show-current`; work on a branch, never `master`.
3. Baseline: `tools/check.ps1` and `tests/tests.html` must be green.
4. Behavior-preserving work: write a characterization test first. Worldgen is locked by
   `tests/world-golden.test.js`; hashes must stay equal unless the change is intentional.

## Strangler rules

- Move code intact first, then extract one cohesive subsystem per step.
- Dependency direction: `config -> core -> world -> sim/render/audio/net -> ui -> main`.
- `sim/` never imports `ui/`, `render/`, `audio/`, `net/`; it emits events and never
  touches presentation.
- Events are discrete cross-layer facts only. Never emit per frame or per NPC per frame,
  never route state/replication through them, and keep subscribers cheap. Continuous
  visuals read `state`. The full rules and performance budget are in `EVENTS.md`.
- Shared mutable state lives on the single `state` object (`core/state.js`). Importers read
  `state.x` for reassigned primitives; exported `let` bindings cannot be reassigned.
- Keep gameplay numbers unchanged unless the task is a balance change.
- One subsystem per commit-sized step; the game must stay playable after each.
- `tools/check.ps1` enforces a layering ratchet: `sim/` cannot import `render/`, `audio/`,
  `ui/` or `net/`. The debt allowlist is empty; keep `sim/` headless.
- Migrating a system to events: emit facts in `sim/`, add handlers in
  `render/combatFx.js`-style modules, wire them in `main.js`, and delete the old direct
  calls/legacy hooks in the same step. Test the emitted payloads.

## Scripted extraction

Assert source lines, write UTF-8 without BOM, and remove ranges bottom-up. Full pattern,
bulk-rename hazards and ESM-cycle rules: `references/powershell-extraction.md`.
Testing harness details (fixtures, singleton state, audio, characterization tests):
`references/testing-harness.md`.

## Release artifact

GitHub Pages publishes `docs/`, not the repo root. After changing `src/`, `index.html` or
`styles.css`, run:

```powershell
powershell -ExecutionPolicy Bypass -File tools/build-pages.ps1
```

It minifies each module into `docs/src/` with a local `tools/esbuild.exe` (ignored by git)
without bundling, then copies `index.html`, `styles.css` and `.nojekyll`. Tests are never
copied. Do not hand-edit `docs/`; rebuild it and smoke `http://localhost:8123/docs/`.

## Verify and report

Run the `AGENTS.md` loop: static check -> type check -> tests -> game smoke -> MP check when
`sim/`/`net/`/state changed. Report files + results; do not commit. The type checker is a
downloaded, git-ignored native `tsc.exe`; no npm or build step is added.

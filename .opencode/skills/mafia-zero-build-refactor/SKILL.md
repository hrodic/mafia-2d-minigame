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
- `sim/` never imports `ui/`, `render/`, `audio/`, `net/`; use `core/runtime.js` hooks
  until `EVENTS.md` is implemented.
- Events are discrete cross-layer facts only. Never emit per frame or per NPC per frame,
  never route state/replication through them, and keep subscribers cheap. Continuous
  visuals read `state`. The full rules and performance budget are in `EVENTS.md`.
- Shared mutable state lives on the single `state` object (`core/state.js`). Importers read
  `state.x` for reassigned primitives; exported `let` bindings cannot be reassigned.
- Keep gameplay numbers unchanged unless the task is a balance change.
- One subsystem per commit-sized step; the game must stay playable after each.

## Scripted extraction

Assert source lines, write UTF-8 without BOM, and remove ranges bottom-up. Full pattern,
bulk-rename hazards and ESM-cycle rules: `references/powershell-extraction.md`.
Testing harness details (fixtures, singleton state, audio, characterization tests):
`references/testing-harness.md`.

## Verify and report

Run the `AGENTS.md` loop: static check -> tests -> game smoke -> MP check when
`sim/`/`net/`/state changed. Report files + results; do not commit.

# Phase 1 — Grid + Projects

## Source Of Truth

- Roadmap: `docs/Features/Foundation/roadmap.md` (§6 decisions D1–D9)
- Council findings: `docs/architecture/CR-1.2-pane-layout-council-findings.md`
- Project rules: `CLAUDE.md`
- Verified codebase state: 2026-07-18 (line numbers cited in each task doc)

## Goal

Phase 1 turns Chorus from a fixed two-pane demo into a real multi-session workspace. By the end of the phase a user can run many agent sessions arranged in an owned binary split tree (grid mode), spread across multiple projects reachable via tabs, kill or restart any session from its own pane chrome, and have the entire arrangement restored on the next launch. Sessions keep stable ids so the same session identity survives layout edits and app restarts. This is grid mode only — the filmstrip presentation, command palette, and auto-titling move to Phase 1b.

## The Five Tasks

Phase 1 is decomposed into five tasks executed **serially**. Dependencies are strict: no two tasks own the same file in parallel, and each task assumes its predecessor has landed and committed.

| Task | Sub-phase | One-line scope | Depends on |
|------|-----------|----------------|------------|
| 1-1 | 1.1 | Tailwind adoption + per-pane session lifecycle UI (header, status dot, Kill/Restart, `session:kill` IPC) | none |
| 1-2 | data layer | Drizzle adoption + Vitest setup + shared LayoutTree module + `sessions` table with stable ids + layout content conversion (flat array → tree) | 1-1 |
| 1-3 | 1.2 | xterm-in-splitpanes spike (go/no-go) + `LayoutRenderer.vue` + stable-id session wiring + debounced PTY resize + filmstrip model spike | 1-2 |
| 1-4 | 1.3 | Launch dialog + true multi-session per agent kind | 1-3 |
| 1-5 | 1.4 | Project tabs + full restore on restart | 1-4 |

The former sub-phase 1.5 (filmstrip default view, command palette, auto-titling) is deferred to **Phase 1b** with its own kickoff later.

### File-ownership summary

Each task owns a bounded set of files. The chain below shows where ownership is handed off; exact create/edit lists live in each task doc.

| File | 1-1 | 1-2 | 1-3 | 1-4 | 1-5 |
|------|:---:|:---:|:---:|:---:|:---:|
| `src/shared/ipc.ts` | edit | edit | edit | edit | edit |
| `src/main/ipc.ts` | edit | edit | edit | edit | edit |
| `src/main/services/sessionManager.ts` | edit | edit | edit | edit | edit |
| `src/main/services/storage.ts` | — | rewrite (Drizzle) | — | edit | edit |
| `src/main/db/schema.ts` | — | create | — | — | — |
| `src/preload/index.ts` | edit | edit | edit | edit | edit |
| `src/renderer/src/App.vue` | edit | edit (interim adapter) | edit | edit | edit |
| `src/renderer/src/components/TerminalPane.vue` | edit | edit (sessionId prop) | edit | edit | — |
| `src/renderer/src/components/LayoutRenderer.vue` | — | — | create | edit | edit |
| `src/renderer/src/components/LaunchDialog.vue`, `EmptyState.vue` | — | — | — | create | — |
| `src/renderer/src/components/ProjectTabs.vue` | — | — | — | — | create |
| `src/renderer/src/stores/session.ts` | edit | rekey | edit | edit | edit |
| `src/renderer/src/stores/layout.ts` | — | — | create | edit | edit |
| `src/renderer/src/stores/project.ts` | — | — | — | — | create |
| `src/shared/layout.ts` | — | create | edit | edit (only if needed) | — |

Note: `src/preload/index.d.ts` never needs manual edits — `ChorusApi` is inferred from the preload object.

Because ownership overlaps across the serial chain, every task doc carries the same warning: implementers work only inside their listed scope and **must not revert, stage, or commit files they did not change**, including untracked docs.

## Inherited Decisions (roadmap §6, all RESOLVED 2026-07-18)

Phase 1 is bound by these already-made decisions. Implementers do not relitigate them.

- **D7 — Adopt Drizzle ORM now.** Phase 1 (Task 1-2) ports the existing hand-rolled better-sqlite3 storage to a Drizzle-defined schema with typed queries. Drizzle is sanctioned; no dependency question to raise. (Scope cut: the hand-rolled migration runner stays — Drizzle is types + queries only this phase.)
- **D8 — Adopt Tailwind at Task 1-1.** Tailwind CSS is the styling system for the renderer from sub-phase 1.1 onward. Sanctioned; wired into the electron-vite renderer build.
- **D9 — Layout = Option C (council, unanimous).** The persisted data model is an **owned binary split tree**; `splitpanes@~4.1.2` is used only as a dumb renderer behind a `LayoutRenderer.vue` adapter. The tree is ours; splitpanes never owns state. See `docs/architecture/CR-1.2-pane-layout-council-findings.md`.
  - **Escape hatch:** if the xterm-in-splitpanes spike (Task 1-3) fails, fall back to a fully custom renderer. **The tree model does not change** — only the renderer behind the adapter does.
  - **PTY resize strategy:** xterm `fit()` runs continuously; `pty.resize` is debounced to 150 ms of inactivity / drag-end.

## Spike Gates (Task 1-3)

Task 1-3 contains two go/no-go spikes that gate the rest of the phase. They are evaluated with the app actually running, not by build success alone.

1. **xterm-in-splitpanes (Gate: renderer choice).** Prove that live xterm.js TUIs survive being hosted inside splitpanes panes — resize, drag, and focus behave, no canvas corruption, `fit()` tracks the pane. **Go** → keep splitpanes behind `LayoutRenderer.vue`. **No-go** → invoke the D9 escape hatch and build the custom renderer behind the same adapter. Either way the binary-split-tree data model is unchanged.
2. **Filmstrip model validation (Gate: Phase 1b readiness).** Validate that the tree/session data model can also express the deferred filmstrip presentation, so Phase 1b is a view addition rather than a data-model rework. This spike produces a written finding only (`docs/architecture/spike-filmstrip-notes.md`); it ships no filmstrip UI in Phase 1.

## Execution Rhythm

- Each task = **one execution session** producing **one narrated commit** (verification gates G1–G3: `npm run typecheck` clean, app runs with real TUIs observed, one commit).
- The `/phase-prompt` skill generates the self-contained kickoff prompt for each session from that task's doc + implementation spec.
- Tasks run in numeric order. A task session starts only after its predecessor's commit exists.

## Phase-Level Acceptance Criteria

Phase 1 is complete when all of the following hold:

- [ ] Tailwind drives renderer styling; each pane has header chrome with a live status dot and working Kill / Restart controls (1-1).
- [ ] Storage is Drizzle-defined with typed queries; a `sessions` table persists **stable** session ids; layout content is a tree, not a flat array; Vitest runs (1-2).
- [ ] Layout renders through `LayoutRenderer.vue` from the binary split tree; sessions are keyed by stable ids; PTY resize is debounced to 150 ms; the xterm-in-splitpanes gate is resolved with a recorded verdict (1-3).
- [ ] A launch dialog can start new sessions, and more than one session per agent kind can run at once (1-4).
- [ ] Multiple projects are reachable via tabs, and the full arrangement (projects, layout tree, sessions) is restored on restart (1-5).
- [ ] `npm run typecheck` is clean at every task boundary; the app runs and real Claude Code / Codex TUIs are observed live.

## Phase Non-Goals

Explicitly **out of scope** for Phase 1 (each is a later phase or deliberately deferred):

- Git worktrees or any worktree-per-session model.
- BYOK / credential entry / safeStorage key injection UI. Env is inherited untouched (D5); no credentials handled.
- Any notifications engine beyond the existing `notifications.ts` (exit toast + logging; OS delivery stays blocked on the dev machine).
- Filmstrip default view, command palette, auto-titling (all Phase 1b).
- Pop-out / detached windows.
- Packaging, installers, or distribution.

## Cross-Task Non-Goal (repeated in every task doc)

Do **not** revert, stage, or commit files you did not change — including untracked docs under `docs/` (`docs/Features/Foundation/roadmap.md`, `docs/architecture/CR-1.2-pane-layout-council-findings.md`, `CouncilBriefs/`). Touch only the files your task owns.

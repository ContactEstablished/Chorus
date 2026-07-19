# Task 1-1 — Tailwind Adoption + Session Lifecycle UI (Sub-phase 1.1)

## Source Of Truth

- Phase overview: `docs/Features/Foundation/Tasks/Phase-1-Overview.md`
- Roadmap §6 (D8 Tailwind): `docs/Features/Foundation/roadmap.md`
- Project rules: `CLAUDE.md`
- Deep spec: `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-1-1.md`
- Verified codebase state: 2026-07-18

## Initial Starting Point (verified 2026-07-18)

| Location | Verified fact |
|----------|---------------|
| `src/main/services/sessionManager.ts` | `private sessions = new Map<string, PtySession>()` line 38; `attach(agent, cwd)` line 43 (one live session per agent kind, respawns if exited); `getAgent(sessionId)` line 71; `dispose()` line 84 kills all; `findByAgent` line 93; `spawn(agent, cwd)` line 100 uses `resolveCli(agent)`, `useConpty: true`, 4 MB ring buffer; PtySession ids are `randomUUID()` at spawn (ephemeral) |
| `src/shared/ipc.ts` | channels: `session:attach` (line 12), `session:write`, `session:resize`, `session:data`, `session:exit`, `cli:detect` (line 22), `layout:get` (line 24); `agentKindSchema = z.enum(['claude','codex'])` line 31; `paneSchema` line 93; all schemas exported, parsed only in `src/main/ipc.ts` |
| `src/main/ipc.ts` | `ipcMain.handle` registrations that `.parse()` the shared schemas (only place `.parse()` runs) |
| `src/preload/index.ts` | Zod-free typed forwarder: `attachSession(agent)`, `detectClis()`, `getLayout()`, `writeSession`, `resizeSession`, `onSessionData`, `onSessionExit`; renderer types via `ChorusApi` (inferred from the preload object — `index.d.ts` needs no manual edit) |
| `src/renderer/src/App.vue` | `panes = ref<Pane[]>([])` line 11 from `getLayout()`; `v-for` line 22 renders `<TerminalPane :agent>` in fixed 50/50 flexbox; per-agent exit banner |
| `src/renderer/src/components/TerminalPane.vue` | `defineProps<{agent: AgentKind}>()` line 9; attaches via `attachSession(props.agent)` line 44; xterm + FitAddon, scrollback 10_000, ResizeObserver → `fit()` + IMMEDIATE `resizeSession` (no debounce); listeners filter events by sessionId |
| `src/renderer/src/stores/session.ts` | Pinia store `sessions: Record<AgentKind, PaneSessionState>` line 16-17 (keyed by agent kind) |
| `package.json` | scripts: dev, start, build, rebuild:better-sqlite3, typecheck:node, typecheck:web, typecheck; NO test/vitest/tailwind/drizzle/splitpanes yet |

## Goal

Introduce Tailwind CSS as the renderer styling system and give every pane real lifecycle chrome. Each pane gains a header bar carrying its agent label and a color-coded status dot (running / exited-ok / exited-error) driven by existing store state, plus per-pane **Restart** and **Kill** controls. Kill is a new `session:kill` IPC that tears the process tree down through `pty.kill()`; Restart kills then respawns the same agent+cwd through the existing attach flow. The bottom exit banner is replaced by this in-pane chrome. Layout stays a fixed 50/50 split — no tree, no Drizzle, no launch dialog yet.

## Exact Scope

**Edit only these files:**

- `src/shared/ipc.ts` — add `killRequestSchema` and the `SessionKill: 'session:kill'` channel, following the existing `IpcChannel` object layout (lines 10–25). Export only; no `.parse()` here.
- `src/main/ipc.ts` — register the `session:kill` handler, copying the existing handler pattern; `.parse()` the new schema here.
- `src/main/services/sessionManager.ts` — add `kill(sessionId)` near the write/resize methods (after the line 43 `attach` block): guard status, call `pty.kill()`, let the existing `onExit` handler perform the state transition.
- `src/preload/index.ts` — add `killSession(sessionId)` forwarder (`ChorusApi` picks it up by inference; `index.d.ts` needs no edit).
- `src/renderer/src/stores/session.ts` — add per-pane busy/exited handling used by the header controls.
- `src/renderer/src/components/TerminalPane.vue` — add the header bar (label + status dot + Restart/Kill), wire Restart/Kill, remove reliance on the bottom banner; convert scoped styles to Tailwind as touched.
- `src/renderer/src/App.vue` — remove the per-agent bottom exit banner (now redundant); convert touched scoped styles to Tailwind.
- `package.json` — add Tailwind (+ its Vite plugin) per the version verified at execution time (see below).
- Tailwind config / CSS entry files as required by the **currently documented** Tailwind v4 + Vite setup (created per docs, not from memory).

**Nothing else.** Do not touch `storage.ts`, `notifications.ts`, `constants.ts`, or `main/index.ts`.

## Non-Goals

- No launch dialog, no new-session UI.
- No layout changes — the split stays fixed 50/50; no tree model, no `LayoutRenderer.vue`.
- No session persistence changes; ids stay ephemeral `randomUUID()` (stable ids arrive in Task 1-2).
- No Drizzle, no Vitest (Task 1-2 owns those).
- No renaming or reshaping of existing IPC channels.
- No new notifications work beyond what `notifications.ts` already emits.
- **Do not revert, stage, or commit unrelated or untracked files, including docs/** (`docs/Features/Foundation/roadmap.md`, `docs/architecture/CR-1.2-pane-layout-council-findings.md`, `CouncilBriefs/`).

## Dependencies

None. Task 1-1 is the head of the Phase 1 chain.

## Step-by-step Work

1. **Verify Tailwind's current install method.** Per D4-style discipline, check Tailwind's own docs at execution time for the current v4 + Vite plugin setup (the `@tailwindcss/vite` plugin and the `@import "tailwindcss";` CSS entry are the v4 shape as of this writing — confirm before hardcoding). Install the exact packages the docs specify.
2. **Wire Tailwind into the electron-vite renderer build.** Add the Vite plugin to the renderer config, add the CSS entry import, confirm a trivial utility class renders in the running app before proceeding.
3. **Add the `session:kill` IPC contract.** In `src/shared/ipc.ts`, add `killRequestSchema = z.object({ sessionId: z.string() })` and `SessionKill: 'session:kill'` in the `IpcChannel` object (lines 10–25 layout). Export both; do not call `.parse()`.
4. **Register the main handler.** In `src/main/ipc.ts`, add an `ipcMain.handle(IpcChannel.SessionKill, ...)` that `.parse()`s `killRequestSchema` and calls `sessions.kill(sessionId)`, mirroring the existing handler shape.
5. **Implement `kill(sessionId)` in SessionManager.** Insert after the line 43 `attach` block: look up the `PtySession`, guard on status (no-op if already exited), call `pty.kill()`. Do **not** transition state inline — the existing `onExit` handler already flips status and emits `session:exit`.
6. **Add the preload forwarder.** In `src/preload/index.ts` add `killSession(sessionId)` invoking the channel.
7. **Extend the session store.** In `src/renderer/src/stores/session.ts`, add per-pane busy/exited handling so the header dot and buttons reflect running / exited-ok / exited-error and disable during in-flight kill/restart.
8. **Build pane header chrome in `TerminalPane.vue`.** Add a header bar (Tailwind): agent label, status dot (green running / gray exited-ok / red exited-error), Restart and Kill buttons. Wire Kill → `killSession(sessionId)`; wire Restart → kill then `attachSession(props.agent)` **after** the exit event arrives (await exit; attach respawns only when status is exited — this is the race guard).
9. **Remove the bottom exit banner.** Drop the redundant per-agent banner from `App.vue` (and any banner remnants in `TerminalPane.vue`); the header dot now carries exit signal.
10. **Convert touched styles to Tailwind.** Only styles in the blocks you edit — no sweeping restyle.

## Test Expectations

**No automated tests in this task.** Vitest is introduced in Task 1-2; adding it here would violate the task split. Verification is runtime (drive the app) plus `npm run typecheck`. The kill/restart process-tree behavior is inherently an OS-integration concern verified via `tasklist`, not a unit test.

## Verification Commands

```
npm run typecheck
npm run dev
```

Process-tree teardown check (run in a separate shell while the app is up):

```
tasklist | findstr /i "claude cmd"
```

Run it before and after clicking Kill on the Claude pane; the claude/cmd entries must disappear.

## Acceptance Criteria

- [ ] `npm run typecheck` is clean.
- [ ] App launches with Tailwind active; a known utility class visibly applies.
- [ ] Each pane shows a header with agent label + status dot; the old bottom exit banner is gone.
- [ ] Status dot is green while running, gray on clean exit, red on error exit.
- [ ] Kill on the Codex pane: process ends, dot turns gray/red, exit toast logs (OS delivery blocked on this machine — logged is sufficient).
- [ ] Restart on a pane: process is killed, then a fresh live TUI attaches for the same agent+cwd (no attach before the exit event).
- [ ] Kill on the Claude pane leaves no orphaned `claude.exe` / `cmd.exe` children (`tasklist | findstr /i "claude cmd"` shows them gone).
- [ ] Exactly one narrated commit; no unrelated/untracked files staged.

## Review Checklist

- [ ] `killRequestSchema` exported from `shared/ipc.ts`; `.parse()` called **only** in `main/ipc.ts`.
- [ ] `kill()` guards status and relies on `onExit` for the state transition (no inline state mutation).
- [ ] Tailwind packages/config match the **currently documented** v4 method, not memory.
- [ ] Restart awaits the exit event before attaching (race guard intact).
- [ ] No changes to `storage.ts`, `notifications.ts`, `constants.ts`, `main/index.ts`, or any existing channel name.
- [ ] Only Tailwind-touched styles were converted; no unrelated restyle.
- [ ] Windows process-tree caveat addressed: killing an agent spawned via `cmd.exe /c` reaches and kills cmd.exe's children.
- [ ] No docs or other untracked files reverted, staged, or committed.

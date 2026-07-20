# Chorus Phase 1b, Task 1b-3 Execution Prompt — Ctrl+K Command Palette Skeleton

_Generated 2026-07-20 against HEAD `0bdf42c`. Ground facts in §4 re-verified at that commit; typecheck clean and 70/70 vitest passing at generation time._

## §1 Role

You are the implementation engineer for Chorus Phase 1b, Task 1b-3 (Ctrl+K command palette skeleton — third and final Phase 1b task; closes the phase). Repo root: `C:\Projects\ContactEstablished\Chorus`. Expected branch `main` — confirm with `git branch --show-current`; do not switch or create branches. Expected HEAD: `0bdf42c` ("Roadmap re-sync after Task 1b-2") or a descendant. Planning was done by a separate coordinator; the final summary will be reviewed against the task docs. Phase 1, 1b-1, and 1b-2 were implemented by other agents; their handoff findings are folded in below.

## §2 Goal

Add a Ctrl+K command palette skeleton (D21): a modal over an extensible command registry, an in-repo fuzzy subsequence filter (no new dependency), and five commands wired to plumbing that already exists — launch agent, switch project, focus pane (by title/agent), toggle filmstrip/grid, restart focused session. Ctrl+K opens it even while a terminal is focused (window-level capture-phase keydown; `attachCustomKeyEventHandler` is the fallback); Esc closes; ↑/↓ navigate; Enter runs then closes; Tab focus trap mirrors `LaunchDialog`. Renderer-only — zero main/IPC/storage/preload changes. Closes Phase 1b.

## §3 Project Context

Architecture: local-first, Windows-only Electron 43.1.1 + Vue 3 + TypeScript + Vite + Pinia app running AI coding-agent CLIs (Claude Code, Codex) as live interactive TUIs in xterm.js panes; PTYs (node-pty / ConPTY) live in the MAIN process owned by `SessionManager`; renderer is a pure view attaching by session id over typed IPC; `contextIsolation: true`, `nodeIntegration: false`.

Dev machine: Windows 11, PowerShell 7, Node 22.14.0. CLIs: `claude.exe` 2.1.215 (native exe; currently UNAUTHENTICATED — TUIs boot fine but any real prompt ends in "token has expired. Re-authenticate to continue." after retries; irrelevant to palette work, but do not mistake it for a bug), `codex-cli` 0.144.6 (npm `.cmd` shim via `cmd.exe /c`).

Environment quirks — all expected, none a bug the implementer caused:
- (a) OS toasts disabled system-wide (registry `ToastEnabled=0`); exit-toast logs `[notify] toast shown:` then `[notify] toast failed:` — the log line is the pass signal.
- (b) Codex TUI first-run prompts — update prompt (press 2 to Skip, never 1), possible directory-trust prompt, `TERM is set to "dumb"` `[y/N]`.
- (c) `node-pty` logs `AttachConsole failed` on PTY teardown. Pre-existing noise.
- (d) The automation harness strips `ComSpec` and modifies PATH — restore `ComSpec` (`$env:ComSpec = "$env:SystemRoot\System32\cmd.exe"`) + registry machine/user PATH before npm installs or app launches.
- (e) `TaskStop` kills only the wrapper shell — `npm run dev` descendant trees survive as orphans holding the CDP port. Every "restart the app" check MUST tree-kill the root node process (`taskkill /PID <root> /T /F`) and confirm port 9222 rebinds on a NEW pid, or the "fresh boot" is the old window. NOTE FOR THIS TASK: 1b-3 is renderer-only, and electron-vite HMR covers the renderer — most iteration needs NO relaunch at all; a full tree-kill relaunch is only needed for cold-boot checks.
- (f) `npx`/`npm run` prepend the npm-global dir to the child PATH. Launch the app as: restore ComSpec/PATH, then `node node_modules/electron-vite/bin/electron-vite.js dev -- --remote-debugging-port=9222` directly from the repo root.
- (g) Orphan checks cannot grep `tasklist` for claude/codex — the dev machine runs many unrelated `claude.exe`. Walk the descendant tree of the electron main PID instead. `window.confirm` blocks the renderer thread — CDP must fire such clicks async (`setTimeout(...,0)`); the palette's restart command path does NOT use `window.confirm` (only TerminalPane's ✕-close does).
- (h) Verification driver: CDP on `--remote-debugging-port=9222` (beat the user32 helper in 1b-1/1b-2). `Runtime.evaluate` for DOM assertions (wrap in an IIFE — top-level `const` collides across evaluates), `Page.captureScreenshot`, `Input.insertText` reaches xterm `onData` as one chunk, `Input.dispatchKeyEvent` for keys (Ctrl+K = keyDown with ctrlKey modifier — send modifiers:2 / key:'k'; verify the exact CDP encoding at execution). Install `ws` in the session scratchpad, never the repo. `ELECTRON_RUN_AS_NODE=1` scripts print nothing to a PowerShell console — write results to a file. The `sqlite3` CLI is NOT installed: DB inspection = a dump script requiring better-sqlite3 by absolute repo path, run via `$env:ELECTRON_RUN_AS_NODE=1; & node_modules\electron\dist\electron.exe dump.js out.json`, results written to a file.
- (i) Dev DB state (`%APPDATA%\chorus\chorus.db`): two projects — "Chorus" (id `985d547b-d152-4a07-9094-ddb8da56ef8f`, 2-leaf layout: one Claude Code session + one exited Codex session) and "Chorus-Second" (id `f47ac10b-58cc-4372-a567-0e02b2c3d479`, real dir, NO sessions/layout — useful for the switch-project command and empty-state palette tests). `view_state:` settings rows exist for both (Chorus=filmstrip, Chorus-Second=grid). All legitimate prior-verification artifacts — do not clean up.

## §4 Ground Yourself First (Read BEFORE Editing)

Docs (in-repo):
- `CLAUDE.md` — locked rules, incl. D14 plain-object IPC (palette-relevant only insofar as commands call existing store actions that already comply).
- `docs/Features/Foundation/roadmap.md` — §5 Verified Ground Facts, §6 Decisions (D21 binds this task); findings F12, F13.
- `docs/Features/Foundation/Tasks/Phase-1b-Overview.md` — phase shape, file-ownership matrix.
- `docs/Features/Foundation/Tasks/Task-1b-3.md` — THE task contract. Scope, non-goals, acceptance criteria. THIS GOVERNS.
- `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-1b-3.md` — exact interfaces, code sketches, runtime script. Follow it, with the corrections in §7 below.

Code state — verified 2026-07-20 at HEAD `0bdf42c`; trust this over any older doc line:
- `npm run typecheck` exits 0; `npx vitest run` = 70/70 across 5 files (`src/shared/layout.test.ts`, `src/shared/ipc.test.ts`, `src/main/services/restore.test.ts`, `src/renderer/src/stores/layout.test.ts`, `src/renderer/src/stores/view.test.ts`).
- `src/renderer/src/App.vue` (142 lines) — imports `{ computed, onMounted, ref, watch }` from vue at line 2 (1b-3 adds `onUnmounted`); the single `watch(() => projectStore.activeId, …)` supersede-token load at lines 34–52; `effectiveFocused` computed at line 57 (via pure `resolveFocused`); `agentFor` at line 63; `openLaunchDialog(target = null)` at line 66; `onLaunched` at line 74 (ends by `viewStore.setFocused(snapshot.sessionId)`); template: tab row + view toggle at lines 99–112, mode-switched `FilmstripRenderer`/`LayoutRenderer` at 113–133, `LaunchDialog` at 134–139. Stores in scope: `layout` (`useLayoutStore`), `projectStore`, `sessionStore` (`useSessionStore` — `sessions[id].status` for the restart routine), `viewStore` (`useViewStore` — `mode`, `focusedSessionId`, `setMode`, `setFocused`), plus `sessions = ref<SessionInfo[]>` (rows with `title`/`createdAt`/`exitCode`).
- `src/renderer/src/stores/view.ts` — `setMode(mode)` / `setFocused(sessionId)` persist immediately (plain snapshots, D14); exported pure `resolveFocused(tree, wanted)`.
- `src/renderer/src/stores/project.ts` — `{projects: ProjectsList, activeId}`; `select(id)` no-ops when `id === activeId`, otherwise persists via `project:select` and refreshes active flags. `ProjectsList` entries carry `{id, name, root_path, active}`.
- `src/renderer/src/components/LaunchDialog.vue` — THE modal idiom to copy: `onKeydown` focus trap at lines 83–103 (Esc cancels; Tab/Shift-Tab cycle across `button:not([disabled]), input:not([disabled])` within the panel); overlay template `fixed inset-0 z-50 flex items-center justify-center bg-black/50` with inner `role="dialog" aria-modal="true"` at lines 107–108; autofocuses its input in `onMounted`.
- `src/renderer/src/components/TerminalPane.vue` — `waitForExit(sessionId)` helper at line 132; `onRestart` at line 182 (the kill → awaited-exit → `restartSession` sequence the palette's restart command mirrors); the pane already re-attaches on `session:restored` and repaints — the palette never manipulates panes directly.
- `window.chorus` (preload) — `launch`, `restartSession(sessionId)`, `killSession(sessionId)`, `onSessionExit(cb)` (returns an off() disposer), `listProjects`, `selectProject`, `getViewState`/`setViewState`, and the rest. NO palette code exists anywhere; `src/renderer/src/palette/` does not exist yet.
- D4 check done at generation time: installed `@xterm/xterm` 6 typings line 1072: `attachCustomKeyEventHandler(customKeyEventHandler: (event: KeyboardEvent) => boolean): void;` — the fallback exists if window capture fails. Re-verify at execution.

Git checks (run first):
```powershell
git branch --show-current   # expect: main
git status --porcelain      # expect: ONLY "?? _verify/"
git log --oneline -1        # expect: 0bdf42c or descendant
git config user.email       # expect: mwilson29072@gmail.com
```

## §5 Pre-existing Changes Warning

The working tree holds exactly one untracked entry at prompt-generation time: `_verify/` — a previous implementer's harness artifacts, deliberately uncommitted. Do not read into scope, revert, stage, commit, or delete it. If `git status --porcelain` shows anything ELSE, stop and ask the user. Your commit contains only files you changed for this task.

## §6 Resolved Decisions and Findings That Bind This Task

Quote; do not relitigate:
- D1 (RESOLVED): ALL Zod validation in main only. 1b-3 adds no IPC, so this binds only by prohibition: no Zod imports anywhere in the new renderer files.
- D3 (locked): sessions live in main; the renderer never spawns processes. The restart command goes through the existing `session:restart` IPC only.
- D4 (locked): verify third-party APIs against installed typings at execution, never model memory. Here: `attachCustomKeyEventHandler` (typings line 1072, confirmed at generation) and the CDP key-event encoding for Ctrl+K.
- D14 (locked, CLAUDE.md): renderer→main payloads must be plain objects. The palette calls existing store actions/`window.chorus` forwarders that already comply — introduce no new payload paths.
- D21 (RESOLVED 2026-07-19): palette skeleton = FIVE commands over an extensible registry: launch agent, switch project, focus pane (by title/agent), toggle filmstrip/grid, restart focused. In-repo fuzzy subsequence filter — no new dependency. Further commands, shortcuts (Ctrl+T/Ctrl+1..9/Ctrl+Tab), and MRU are later phases.
- F12 (binds labels): compose agent + title when labeling panes (Codex titles are just the cwd basename — same-project Codex sessions collide on title alone); render PERSISTED titles (from App's `sessions[]`), never a live title stream (Claude's OSC title is twitchy ~1 Hz while working).
- F13 (found+fixed in 1b-2, binds NEW code): async `onMounted` continuations must bail after every `await` if the component may have unmounted — post-cleanup registrations leak for the app lifetime. Any await the palette adds in lifecycle hooks needs the same guard discipline.
- Grid-focus caveat (1b-2 minimal path): grid mode does NOT track focus — `LayoutRenderer` has no focus relay. `effectiveFocused` still always resolves (F4 fallback), so "Focus pane" and "Restart focused" work in both modes; do NOT add a LayoutRenderer relay in this task (raise it in the report if it feels needed).
- View-store caveat: `setFocused` persists immediately per call — fine for palette command execution (one write per Enter); do not wire live-preview focusing to arrow navigation.

## §7 Implementation Scope

Follow the Exact Scope table in `Task-1b-3.md` and ImplementationSpec-1b-3 §§2–4 exactly. Files: CREATE `src/renderer/src/palette/commands.ts`, `src/renderer/src/components/CommandPalette.vue`, `src/renderer/src/palette/commands.test.ts`; EDIT `src/renderer/src/App.vue`. Explicitly do NOT touch: anything in `src/main/` or `src/preload/` or `src/shared/`, `LayoutRenderer.vue`, `FilmstripRenderer.vue`, `TerminalPane.vue`, `LaunchDialog.vue`, `EmptyState.vue`, `ProjectTabs.vue`, `stores/*` (read their APIs, edit nothing).

| File | Change |
|---|---|
| `src/renderer/src/palette/commands.ts` | NEW. `PaletteCommand` interface `{id, label, keywords, enabled(), run()}`; `PaletteContext` interface (spec §2 — openLaunchDialog, projects, selectProject, leaves, focusSession, focusedSessionId, toggleMode, currentMode, restartFocused); `buildCommands(ctx)` returning the five D21 command groups (switch/focus groups expand per project/leaf); `fuzzyFilter(commands, query)` — case-insensitive subsequence over label+keywords with contiguity/early-match scoring; un-exported `subsequenceScore`. Pure module: no store imports, no window.chorus reach-in, no Zod. |
| `src/renderer/src/palette/commands.test.ts` | NEW. Vitest for the pure module — see §10. |
| `src/renderer/src/components/CommandPalette.vue` | NEW. LaunchDialog overlay idiom; props `{commands: PaletteCommand[]}`, emits `close`; `query`/`selectedIndex` state, `filtered = fuzzyFilter(...)`, watch resets index on re-filter; Esc close, ↑/↓ wrap-around move, Enter runs selected THEN closes (spec: emit close before awaiting run — the command may open LaunchDialog or swap views), Tab trap copied from LaunchDialog; input autofocused on mount; click runs; `fuzzyFilter` already omits disabled commands (spec's sanctioned simpler choice — state it in the commit if chosen, or implement dimmed-unselectable rows instead). |
| `src/renderer/src/App.vue` | Add `onUnmounted` to the vue import (line 2); `paletteOpen = ref(false)`; `onGlobalKey` (Ctrl+K, no alt/meta, `e.key.toLowerCase()==='k'`, `preventDefault`, toggle) registered `window.addEventListener('keydown', onGlobalKey, true)` in `onMounted`, removed in `onUnmounted`; `paletteCommands` computed assembling the `PaletteContext` (spec §4 sketch — leaves from `collectSessionIds(layout.tree.root)` mapped through `agentFor` + `sessions` titles; import `collectSessionIds` from `../../shared/layout`, currently NOT imported in App.vue); `restartFocused()` async helper mirroring TerminalPane.onRestart by id (running → register exit-waiter → `killSession` → await → `restartSession`; else `restartSession` directly); mount `<CommandPalette v-if="paletteOpen" :commands="paletteCommands" @close="paletteOpen = false" />` in the template near LaunchDialog. |

Key invariants (from ImplementationSpec-1b-3 §5):
- Renderer-only: no main/IPC/storage/preload edits; commands call EXISTING `window.chorus`/store APIs.
- The Ctrl+K listener is capture-phase on `window` and removed in `onUnmounted` — no leaked global listener across teardown/HMR.
- `fuzzyFilter`/`buildCommands` pure and dependency-free; empty query → all enabled commands in registry order.
- Extensibility = adding to `buildCommands`'s array; the palette component never changes per-command.
- Palette closes before a command runs.
- Restart reuses kill→await-exit→`restartSession`; never `restartSession` on a live session (main rejects it). The exit await is load-bearing.
- Empty states are safe: no projects → no switch entries; no leaves → no focus entries; no focus → restart disabled; palette never crashes on empty state.

Corrections/notes to the task doc + spec (coordinator-verified 2026-07-20):
1. The task doc's "Initial Starting Point" was written before 1b-2 landed — §4 above is the current truth (line numbers verified at `0bdf42c`).
2. Spec §4's `restartFocused` sketch reads `sessionStore.sessions[id]` for running-ness. This is sound for the restart target: the effective focused session's pane is mounted and attached, so its store entry is current. If the entry is missing (never attached this run), treat as not-running and call `restartSession` directly — and surface main's structured `{ok:false, reason}` rejection to the user, never swallow it.
3. The spec's toggle command captures `currentMode` at build time — the `paletteCommands` computed re-evaluates on store change, so the label stays correct; keep the computed, don't cache the array.
4. Vitest test location: keep `commands.test.ts` beside the module in `src/renderer/src/palette/` (matches the `stores/view.test.ts` precedent — vitest picks up the folder).

## §8 Strict Non-Goals

- No commands beyond the five (D21). No Ctrl+T / Ctrl+1..9 / Ctrl+Tab. No MRU/recents/persistence. No palette theming beyond the existing Tailwind neutral/sky idiom.
- No main / IPC / storage / preload / shared edits. No new npm dependencies.
- No `LayoutRenderer` focus relay (grid focus-follow stays the 1b-2 minimal path).
- Do not revert, stage, or commit unrelated or untracked files — including `_verify/` and anything under `docs/`.

## §9 Required Workflow

1. Ground per §4.
2. Implement in spec order: `palette/commands.ts` → `commands.test.ts` (red/green as you go) → `CommandPalette.vue` → `App.vue` wiring. Run `npm run typecheck` + `npx vitest run` after the pure module before touching components.
3. Self-review the diff against CLAUDE.md, D1/D3/D4/D14/D21, F12/F13, and the Task-1b-3.md Review Checklist.
4. Run verification (§10).
5. ONE intentional commit, style of repo commit `80e69c3` (plain-English paragraph first, then "Technical notes:" bullets); state in the message which hotkey interception won (window capture vs `attachCustomKeyEventHandler`) and which disabled-command rendering was chosen; verify `git config user.email` = `mwilson29072@gmail.com`; end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; do not push, do not open a PR, do not amend or rebase existing commits.

## §10 Verification Commands

```powershell
npm run typecheck   # zero errors (G1)
npx vitest run      # green — 70 existing + new commands.test.ts cases
# app launch (only when CDP needed): restore ComSpec/PATH, then
node node_modules/electron-vite/bin/electron-vite.js dev -- --remote-debugging-port=9222
```

New unit tests (in `src/renderer/src/palette/commands.test.ts`): `fuzzyFilter` — empty query returns all enabled commands in registry order; `'grid'` matches "Switch to grid view"; a subsequence like `'tgv'` matches the toggle command; `'zzz'` → `[]`; a contiguous match outranks a scattered one; disabled commands are excluded. `buildCommands` with a stub `PaletteContext` — five groups present; `restart-focused.enabled()` false when `focusedSessionId` null; no switch entries when `projects` empty; a focus entry's `enabled()` false for the already-focused id; labels compose agent + title (F12).

RUN the app, don't just compile (G2). Runtime script, numbered, each with its exact observable (screenshot each step; the dev DB from §3(i) already provides two projects and two sessions):
1. Boot → click into the focused terminal (xterm textarea focused) → send Ctrl+K → the palette opens OVER the live terminal. Report which interception won (capture listener expected; `attachCustomKeyEventHandler` is the fallback).
2. Type a fragment of the Codex pane's title (e.g. `cod` or a title substring) → the "Focus Codex — <title>" entry surfaces via fuzzy match; ↑/↓ moves the highlight (wraps); Enter focuses that session — filmstrip re-renders with the chosen session full-size; dump `pane_layouts` before/after → byte-identical (§3h dump method).
3. Ctrl+K → "Launch agent…" → the launch dialog opens (cancel it).
4. Ctrl+K → "Switch to Chorus-Second" → the other tab activates (its grid/empty view + view_state restore per 1b-2). Switch back via the palette.
5. Ctrl+K → toggle command → mode flips filmstrip⇄grid and persists (view_state row updated — dump).
6. Ctrl+K → "Restart focused session" → the focused session restarts with a fresh TUI; `[title] persisted` / boot banner appears; NO "still running" rejection in the dev log (exit was awaited). The restored pane repaints via its existing `session:restored` handler.
7. Empty state: switch to Chorus-Second (no sessions) → Ctrl+K → no focus entries, restart absent/disabled, no crash; single-project check does not apply (two projects exist) — instead verify the ACTIVE project has no "Switch to Chorus-Second" entry when Chorus-Second is active (`enabled: () => !p.active`).
8. Esc closes; click-to-run closes; after closing, typing reaches the terminal again (no stuck trap/listener). Toggle Ctrl+K twice rapidly → no double-mount, no console errors.
9. D14/console check: renderer console across the whole flow — zero `An object could not be cloned`, zero uncaught errors (the F13 error-hook pattern from 1b-2 is a good harness: hook `console.error` + `unhandledrejection` early, read at the end).

## §11 Failure Honesty Clause

Capture exact output on any failure, explain it, report it; never claim success not directly observed. Specifically may NOT be reported as success: a Ctrl+K-over-focused-terminal you did not actually send to a focused xterm; a fuzzy match you did not type through the palette input; a restart whose await-exit you did not confirm in the log; byte-identity you did not dump; a persistence claim without an actual dump. The claude CLI's "token has expired" auth failure is a known environment condition (§3) — a TUI that boots to that state still proves the restart path. If a verification command fails for an unrelated environment reason, capture the exact output, explain it, and do not claim success.

## §12 Final Reporting Requirements

Detailed summary for coordinator review:
- Status: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED.
- Hotkey interception report (D4): window capture vs `attachCustomKeyEventHandler`, with evidence.
- Disabled-command rendering choice (omit vs dimmed) and why.
- Files changed — one-line rationale each; anything beyond §7's list flagged loudly with justification.
- Deviations from ImplementationSpec-1b-3, with why — including confirmation the §7 corrections were honored.
- Verification transcript: typecheck; vitest with new test names and count; runtime items 1–9 individually with what was actually observed (screenshots referenced); the DB dumps for byte-identity/persistence.
- Acceptance criteria from Task-1b-3.md restated pass/fail.
- Non-goals confirmation — each §8 item untouched.
- Residual risks / notes for the Phase-1b-closing `/architect` re-sync — anything learned about the palette/registry the Phase 2+ command additions will ride.
- Final git output fenced: `git status --porcelain` and `git log --oneline -2`.

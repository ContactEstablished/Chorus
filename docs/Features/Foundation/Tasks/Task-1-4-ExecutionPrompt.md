# Chorus Phase 1, Task 1-4 Execution Prompt — Launch Dialog + True Multi-Session

_Generated 2026-07-19 against HEAD `e7d6e60`. Ground facts in §4 were re-verified against the live code on that date._

## §1 Role

You are the implementation engineer for **Chorus Phase 1, Task 1-4** (launch dialog + true multi-session). Repo root: `C:\Projects\ContactEstablished\Chorus`. Expected branch `main` — confirm with `git branch --show-current`; do not switch or create branches. Expected HEAD: `e7d6e60` ("Phase 1.3: layout view - LayoutRenderer over the persisted split tree, debounced PTY resize, close-kills-pane") or a descendant.

Planning was done by a separate coordinator (Claude). Your final summary will be reviewed by that coordinator against the task docs, so it must be precise and honest. Tasks 1-1, 1-2, and 1-3 were implemented by other agents; their handoff findings are already folded into this prompt.

## §2 Goal

Replace the implicit auto-attach of two seeded sessions with an explicit launch flow, and lift the one-session-per-agent-kind limit so N concurrent sessions of the same agent can run (e.g. two Codex TUIs at once). A user launches via a `LaunchDialog` — from an empty-state screen when no panes exist, or from a now-enabled split button on an existing pane, which drops the new session's leaf into the split tree. A new `session:launch` IPC creates a stable session row, spawns its PTY, and returns an attach-style snapshot, with `cwd` validated in main as a security boundary. Fresh DBs seed an empty layout; existing DBs still upgrade through the legacy conversion path.

**This is the widest task in Phase 1** — it carries a prerequisite store refactor, the launch flow, the removal of two guards Task 1-3 installed, and one deferred wiring item.

## §3 Project Context

**Architecture:** local-first, Windows-only Electron 43.1.1 + Vue 3 + TypeScript + Vite + Pinia app running AI coding-agent CLIs (Claude Code, Codex) as live interactive TUIs in xterm.js panes. PTYs (node-pty / ConPTY) live in the **main** process, owned by `SessionManager`; the renderer is a pure view attaching by session id over typed IPC. `contextIsolation: true`, `nodeIntegration: false`.

**Dev machine:** Windows 11, PowerShell 7, Node 22.14.0. CLIs: `claude.exe` 2.1.207 (native exe), `codex-cli` 0.135.0 (npm `.cmd` shim, spawned via `cmd.exe /c`).

**Environment quirks you MUST know — all five are expected, none is a bug you caused:**

(a) **OS toast notifications are disabled system-wide** (registry `ToastEnabled=0`). Exit-toast code logs `[notify] toast shown: …` then `[notify] toast failed: … (HRESULT: -2143420140)`. The **log line is the pass signal**; a visible toast will never appear.

(b) **The codex TUI opens with first-run prompts** — an update-available prompt (press **2** to Skip — never **1**, which runs npm install), possibly a directory-trust prompt, and a `TERM is set to "dumb"` `[y/N]` prompt. These rendering crisply **is** the terminal layer working.

(c) **`node-pty` logs `AttachConsole failed` from `conpty_console_list_agent` on PTY teardown.** Pre-existing noise, present before Phase 1.

(d) **This automation harness strips `ComSpec` and runs a modified PATH.** `npm install` and app launches need `ComSpec` restored and the registry user/machine PATH, or CLIs resolve to the wrong tools. Fix your environment before concluding a command "failed".

(e) **NEW, from the Task 1-3 session:** `TaskStop` on this harness kills only the wrapper shell — `npm run dev` descendant trees (electron, PTY children) survive as orphans and keep holding the CDP port. Any "restart the app" verification **MUST** kill the process tree (`taskkill /PID <root> /T /F`) and confirm the port rebinds, or the supposed "fresh boot" is actually the old window still running. The 1-3 session had a restart check invalidated exactly this way and had to redo it.

## §4 Ground Yourself First (Read BEFORE Editing)

### Docs (in-repo)
- `CLAUDE.md` — locked architecture rules.
- `docs/Features/Foundation/roadmap.md` — §5 Verified Ground Facts, §6 Decisions & Gates (**D1, D2, D3, D4, D5, D9, D10, D11, D14** bind this task).
- **`docs/Features/Foundation/Tasks/Task-1-4.md`** — THE task contract. Scope, non-goals, acceptance criteria. **This governs.**
- **`docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-1-4.md`** — the four-state session machine, IPC schemas, dialog sketch, runtime script; follow it with the four corrections in §7 below.
- `docs/Features/Foundation/Tasks/Task-1-3-CompletionSummary.md` — the previous implementer's handoff.

### Code state — re-verified 2026-07-19 at HEAD `e7d6e60`, trust this over any older doc line

- `npm run typecheck` exits 0; `npx vitest run` = 27/27 across two files (`src/shared/layout.test.ts`, `src/renderer/src/stores/layout.test.ts`).
- `src/main/services/sessionManager.ts` — `Map<string, PtySession>` keyed by stable DB row id. Public: `attach({sessionId?, agent}, cwd)`, `kill`, `write`, `resize`, `getAgent`, `onData`, `onExit`, `dispose`. Private: `spawn(agent, cwd, sessionId?)`, `findByAgent(agent)`. `exitListeners` is a `Set` — **multiple `onExit` listeners are supported**. There is **no `restart()` method** — Restart is renderer-side (kill, await exit, re-attach) from Task 1-1.
- `src/shared/ipc.ts` — `IpcChannel` has **9** entries: `session:attach`/`write`/`resize`/`kill`, `session:data`/`exit`, `cli:detect`, `layout:get`, `layout:set`. `attachResponseSchema` and `agentKindSchema` are existing exported symbols to reuse. `.parse()` is called only under `src/main/`.
- `src/main/ipc.ts` — `registerIpc(sessions, storage, project)`; every handler Zod-parses before acting.
- `src/main/services/storage.ts` — `getOrCreateProject`, `getPaneLayout`, `savePaneLayout`, `createSession`, `getSessionsForProject`, `updateSessionStatus` (**exists but has NO caller**), `getWindowBounds`, `saveWindowBounds`, `close`. Private: `buildDefaultLayout(projectId)`, `findOrCreateSession(projectId, agent)`, `migrate()`. **There are no generic `getSetting`/`setSetting` helpers** — settings access is done inline with Drizzle, see `getWindowBounds`/`saveWindowBounds` as the pattern to copy.
- `src/main/index.ts` — on `whenReady`: storage init, `getOrCreateProject(DEV_WORKING_DIR)` (from `src/main/constants.ts`), `registerIpc`, `watchSessionExits(sessions)`, `createWindow`.
- `src/main/services/notifications.ts` — `watchSessionExits(sessions: SessionManager)` takes **only** the SessionManager, no storage. It registers its own `sessions.onExit(...)` toast listener. **This file is NOT in scope.**
- `src/preload/index.ts` — Zod-free typed forwarders in a `chorusApi` object; `ChorusApi` is **inferred** from it, so `index.d.ts` needs no edit. Existing: `attachSession`, `writeSession`, `resizeSession`, `killSession`, `detectClis`, `getLayout`, `setLayout`, `onSessionData`, `onSessionExit`.
- `src/renderer/src/App.vue` — one `layout:get` round-trip on mount → `layout.loadLayout(tree)` + `sessions.value = rows`; `agentFor(id): AgentKind | undefined`; renders `<LayoutRenderer v-if="layout.tree" :node :path :agent-for>` with **no `v-else`** — a null tree currently renders nothing at all.
- `src/renderer/src/components/LayoutRenderer.vue` — recursive; props `{node, path: (0|1)[], agentFor}`. Internal nodes render splitpanes `~4.1.2`; leaves mount `TerminalPane`; a leaf whose session row is missing renders a "Session no longer exists" placeholder that holds the split geometry. `@resize` reads `payload.panes[0].size / 100`.
- `src/renderer/src/components/TerminalPane.vue` — props `{sessionId, agent}`; scrollback 5 000; ResizeObserver → continuous `fit()` + 150 ms-debounced `resizeSession`. Header: label, dot, **Split ⬌ / Split ⬍ both `:disabled="true"`**, Restart, Kill, ✕ close guarded by `isLastLeaf`. **All store access goes through `props.agent`.**
- `src/renderer/src/stores/layout.ts` — `{tree, dirty}`; `loadLayout(layout)` takes the tree as a parameter; `applyRatio`; `removeLeaf` (**early-returns instead of dropping the last leaf**); `schedulePersist()` debounces 500 ms and sends a plain JSON snapshot.
- `src/renderer/src/stores/session.ts` — **still `Record<AgentKind, PaneSessionState>`** with two pre-seeded slots (`claude`, `codex`).
- `src/main/services/cliDetect.ts` — `resolveCli(name)`, `detectClis()` memoized (claude/codex/git/docker/node → found/path/version).
- `splitpanes ~4.1.2` is installed. `LaunchDialog.vue` and `EmptyState.vue` do **not** exist.

### Git checks (run first)
```powershell
git branch --show-current   # expect: main
git status --porcelain
git log --oneline -1        # expect: e7d6e60 or descendant
```

## §5 Pre-existing Changes Warning — READ THIS

**The working tree is NOT clean, and that is expected.** At prompt-generation time it held:

```
 M docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-1-2.md
 M docs/Features/Foundation/Tasks/Task-1-2.md
 M docs/Features/Foundation/Tasks/Task-1-4.md
 M docs/Features/Foundation/roadmap.md
?? _ui/
?? docs/Features/Foundation/Tasks/Task-1-1-ExecutionPrompt.md
?? docs/Features/Foundation/Tasks/Task-1-2-CompletionSummary.md
?? docs/Features/Foundation/Tasks/Task-1-2-ExecutionPrompt.md
?? docs/Features/Foundation/Tasks/Task-1-3-CompletionSummary.md
?? docs/Features/Foundation/Tasks/Task-1-3-ExecutionPrompt.md
?? docs/Features/Foundation/Tasks/Task-1-4-ExecutionPrompt.md
```

(That last entry is this prompt file itself.)

These are the coordinator's planning docs plus `_ui/` (a UI mockup scratch directory). **All of it is none of your business.** Do not revert, stage, commit, edit, or "clean up" any of it. Your commit contains only files you changed for this task.

If you see modifications to anything under **`src/`** — that is not expected. Stop and ask the user.

## §6 Resolved Decisions That Bind This Task

Quote these; do not relitigate.

- **D1** (RESOLVED): ALL Zod validation lives in **main** only. Preload and renderer run under a CSP with no `unsafe-eval`; Zod's `.parse()` there throws EvalError and **silently drops IPC events**. Shared files may EXPORT schemas; only `src/main/` calls `.parse()`.
- **D2** (RESOLVED): **NEVER** run `electron-rebuild`. node-pty ships working prebuilds. If an `npm install` re-fetches better-sqlite3 and the app then hits a native-module ABI error, run `npm run rebuild:better-sqlite3` — nothing else.
- **D3** (locked, CLAUDE.md): Sessions live in main; the renderer never spawns processes.
- **D4** (locked, CLAUDE.md): Verify tooling and CLI flags against current official docs/`--help` at execution time, never from model memory. Task 1-3 proved this concretely: the splitpanes `@resize` payload shape in its spec sketch did not exist in the real v4.1.2 API.
- **D5** (RESOLVED): Child PTYs inherit env untouched; no credentials injected or logged. This task adds no env handling. Do not log `cwd` with surrounding process-env context.
- **D9** (RESOLVED, council unanimous; spike GO 2026-07-19): layout is an owned binary split tree; splitpanes is a dumb renderer behind the `LayoutRenderer.vue` adapter and owns no layout state.
- **D10** (RESOLVED 2026-07-19): the session-store rekey from `AgentKind` to `sessionId` is **THIS TASK'S**, and is step 0. Tasks 1-2 and 1-3 deliberately deferred it because with one session per kind the agent-keying was still correct. It stops being correct the moment this task lands two Codex sessions: a single `sessions['codex']` slot means the second launch overwrites the first's `sessionId`, both status dots move together, killing one marks both busy, and one pane's exit event clears the other's state. This is the exact failure that acceptance criterion (d) in §10 is built to expose — the rekey is what prevents it.
- **D11** (RESOLVED 2026-07-19): `storage.updateSessionStatus` is wired in this task, in `src/main/index.ts`. It has had no caller since 1-2 because both 1-2 and 1-3 carried "do not touch main/index.ts" as a non-goal. `src/main/index.ts` is admitted to scope for that single purpose and nothing else.
- **D14** (RESOLVED 2026-07-19): renderer→main IPC payloads must be plain objects. Pinia state is a Vue reactive Proxy; Electron's structured clone refuses it with `Error: An object could not be cloned`, and there is NO compile-time signal. Task 1-3 hit this at runtime on its first splitter drag. Anything sourced from a store or `reactive()`/`ref()` must be snapshotted (`JSON.parse(JSON.stringify(x))`, matching the 1-3 precedent) before crossing the bridge.

## §7 Implementation Scope

Follow the **Exact Scope** table in `Task-1-4.md` and the step-by-step items in `ImplementationSpec-1-4.md`.

**Create:**
- `src/renderer/src/components/LaunchDialog.vue`
- `src/renderer/src/components/EmptyState.vue`

**Edit:** `src/main/services/sessionManager.ts` · `src/shared/ipc.ts` · `src/main/ipc.ts` · `src/preload/index.ts` · `src/main/services/storage.ts` · `src/main/index.ts` (D11 only) · `src/renderer/src/App.vue` · `src/renderer/src/components/LayoutRenderer.vue` · `src/renderer/src/components/TerminalPane.vue` · `src/renderer/src/stores/layout.ts` · `src/renderer/src/stores/session.ts`.

**Explicitly do NOT touch:** `src/main/services/notifications.ts`, `src/main/services/cliDetect.ts`, `src/main/constants.ts`, `src/main/db/schema.ts`, `src/shared/layout.ts` (unless an "is the tree empty" helper is genuinely absent).

### Four corrections to ImplementationSpec-1-4

1. **`EmptyState` belongs in `App.vue`, not `LayoutRenderer.vue`.** Spec §8 says LayoutRenderer renders it when the tree is null — but `LayoutRenderer` takes a non-nullable `node: LayoutNode` prop and is only mounted when a tree exists. Add the `v-else` arm in `App.vue` alongside the existing `v-if="layout.tree"`.
2. **`DEFAULT_LAYOUT` does not exist.** Spec §5 says to remove a `DEFAULT_LAYOUT` write. The real seeding path is the private `buildDefaultLayout(projectId)` plus `findOrCreateSession`, called from `getOrCreateProject`. Removing the seed means creating neither the `pane_layouts` row NOR the two default session rows.
3. **`getSetting`/`setSetting` do not exist.** Spec §5's recent-cwds code calls them. Either add the generic pair or follow the existing `getWindowBounds`/`saveWindowBounds` inline-Drizzle pattern. Pick one and say which in the summary.
4. **`SessionManager` has no `restart()` method.** Spec §1's state-machine table lists `restart(sessionId)` as an op. That row describes the EXISTING renderer-side Restart chrome from Task 1-1 (kill → await exit → re-attach under the same row id), not a method to add. Do not add one; do preserve the behavior.

### Wiring D11 without touching notifications.ts

`watchSessionExits(sessions)` in `notifications.ts` takes only the SessionManager and registers its own `onExit` toast listener. `sessionManager.exitListeners` is a `Set`, so register a SECOND, independent `sessions.onExit((sessionId, exitCode) => storage.updateSessionStatus(sessionId, 'exited', exitCode))` in `src/main/index.ts`. Do not change `watchSessionExits`'s signature and do not thread storage into `notifications.ts`.

### Two Task 1-3 guards that must come down

Both exist because empty layouts were illegal until now; this task legalizes them, so leaving either in place makes the new flows unreachable.

1. `TerminalPane`'s ✕ close and `onClose` are hard-guarded by `isLastLeaf` (`collectSessionIds(root).length <= 1`, tooltip "Cannot close the last pane"). Closing the final pane is currently impossible. Remove the guard and its now-unused `collectSessionIds` import.
2. `stores/layout.ts` `removeLeaf` early-returns when `removePane` yields `null`. It must instead set `tree = null` and persist the layout's absence via `clearPaneLayout`.

### Key invariants to restate

- N same-kind sessions = N rows + N PTYs, no lookup ever collapses them.
- `launch` is the only op that creates a row, `attach` never spawns, Restart owns respawn, `kill` keeps the row.
- All Zod parsing in main, `cwd` absolute+exists validated in main before spawn.
- Empty layout = ABSENT `pane_layouts` row, never a `{version:1, root:null}` wrapper.
- The renderer inserts only main-returned session ids.
- `layout:set` is the sole layout persistence path.
- The legacy DB conversion path stays untouched.
- Preload stays Zod-free.
- `LayoutRenderer`'s missing-session placeholder branch stays.

## §8 Strict Non-Goals

Itemized from Task-1-4.md:
- **No** project switching or tabs (Task 1-5).
- **No** launch profiles, model, or effort options (Phase 3) — the dialog exposes agent + cwd only.
- **No** worktree modes (Phase 2).
- **No** keyboard/command palette (Phase 1b).
- **No** per-agent extra CLI args, bare launch stays bare (D4).
- **No auto-relaunch on restart** — after an app restart, panes show exited/dead chrome with the layout shape intact. Automatic relaunch is Task 1-5's restore contract, so state it explicitly in the run notes so a reviewer does not flag it as a regression.
- **No** changes to secrets/env handling (D5).
- **`src/main/index.ts` changed ONLY for the D11 exit-listener wiring** — no other edits to that file, however tempting.
- **No** reverting, staging, or committing unrelated or untracked files, including anything under `docs/` (see §5).

## §9 Required Workflow

1. **Ground per §4** — read the task doc, spec, and this prompt before editing.
2. **Do step 0 first** — the D10 store rekey as a standalone pure refactor: `typecheck` green and the two-pane app visually unchanged before any launch-flow code; do not proceed until verified.
3. **Implement the launch flow step-by-step** per the spec, small reviewable edits.
4. **Self-review the diff** against CLAUDE.md, D1/D3/D5/D10/D11/D14, and the Task-1-4 Review Checklist.
5. **Run verification (§10).**
6. **ONE intentional commit** narrating what changed and why, in the style of repo commit `80e69c3` (plain-English summary paragraph first, "Technical notes:" bullets after); mention in the message that the removed first-run seed affects only DBs created after this task and that the existing dev DB still opens. Commit author must be **Matthew Wilson <mwilson29072@gmail.com>** — check `git config user.name` / `user.email`, use `git -c user.name=… -c user.email=…` overrides if they differ; end with a `Co-Authored-By:` line crediting yourself, matching the repo's existing format; do not push, do not open a PR, do not amend or rebase.

## §10 Verification Commands

From `C:\Projects\ContactEstablished\Chorus`:

```powershell
npm run typecheck   # zero errors (G1)
npx vitest run      # green — 27 existing + new splitPane/removePane-to-null and launchRequestSchema tests
npm run dev
```

**RUN the app, don't just compile (G2).** Note that D14's failure mode is runtime-only, so a green typecheck proves nothing about the launch flow.

Runtime script — exactly what to do and what must be observed, as (a)–(h):

**(a)** Back up then delete `userData/chorus.db*`; `npm run dev` → **empty state** appears, not two seeded sessions.

**(b)** Click Launch → dialog → pick Claude → cwd = project root → Launch → full-window single leaf, live Claude TUI, responds to typing.

**(c)** Split V on that pane → dialog → pick Codex → Launch → 50/50 split, both TUIs live.

**(d)** Split H on the Codex pane → dialog → pick Codex again → Launch → **THREE panes, two independent Codex TUIs**. Type a distinct command in each Codex pane and confirm they respond independently. This is the multi-session-per-kind proof — screenshot it. Also confirm killing one Codex turns only that pane's dot and disables only that pane's buttons.

**(e)** In the dialog enter a nonexistent path (e.g. `C:\nope\nope`) → Launch → inline red error, dialog stays open, no new pane, and no new `sessions` row (verify with a row count).

**(f)** Undetected agents appear as disabled cards with a "not found" note.

**(g)** Close panes down to the last one, then close that too → returns to the empty state and the `pane_layouts` row is gone.

**(h)** Kill a pane, then dump its `sessions` row → `status='exited'` with the real `exit_code` (the D11 proof — a DB dump, not code inspection).

**Console check:** watch the renderer devtools console across the whole flow for `An object could not be cloned` (D14). Zero occurrences required.

**Restart check:** quit, kill the process tree per §3(e), relaunch → panes render in the restored shape showing exited/dead chrome with Restart available; no auto-relaunch (expected, see §8).

**DB check:** better-sqlite3 is built against Electron's ABI and will not load in plain `node` — use the `ELECTRON_RUN_AS_NODE` trick.

**Orphan check:**
```powershell
tasklist | findstr /i "claude codex cmd"   # before quit
# quit, wait 2s
tasklist | findstr /i "claude codex cmd"   # after quit — no matches expected
```

**Headless window observation:** If the Electron window cannot be observed directly, write a PowerShell helper into a temp directory using user32.dll P/Invoke — `EnumWindows` to find the visible electron-process window titled "Chorus", `GetWindowRect` + `Graphics.CopyFromScreen` to screenshot, `SetCursorPos` + `mouse_event` to click, `SendKeys` to type. The window may sit at negative coordinates on a secondary monitor — use the rect from `EnumWindows`, don't assume the primary display.

## §11 Failure Honesty Clause

If any verification fails — including for an environment reason unrelated to the change — **capture the exact output, explain what it means, and report it.** Never claim success not directly observed. Specifically:

- A codex pane showing its update/trust/TERM prompts still verifies the terminal layer (note it).
- But two Codex panes that share state, an `An object could not be cloned` error, a `sessions` row still reading `running` after a kill, an empty state that cannot be reached, a nonexistent-cwd launch that creates a row, or an orphaned process after quit may **NOT** be reported as success.
- Add: if the restart check was run without killing the process tree (§3e), it did not happen — redo it.

## §12 Final Reporting Requirements

End your session with a **detailed summary** — the coordinator reviews it for accuracy:

- **Status:** DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED.
- **Step 0 (D10 rekey):** confirmation it landed and was verified standalone before launch-flow work, with the visual-unchanged evidence.
- **Files changed:** every file, one-line rationale each; anything beyond the §7 lists flagged loudly with justification; explicit confirmation that `src/main/index.ts` changed only for D11.
- **Deviations** from `ImplementationSpec-1-4.md`, with why — including how each of the four §7 corrections was handled and which route was taken for the settings helpers.
- **Verification transcript:** typecheck result; vitest result with the new test names; runtime observations (a)–(h) each stated individually with what was actually seen (reference screenshots); the console check for D14; the restart check with confirmation the process tree was killed; the `sessions` row dump for D11; `tasklist` before/after.
- **Acceptance criteria:** the `Task-1-4.md` checklist restated with pass/fail per item.
- **Non-goals confirmation:** explicit statement that each §8 non-goal was untouched, calling out no-auto-relaunch by name.
- **Residual risks / notes for Task 1-5's implementer** — especially anything learned about session-row/leaf drift (a row can outlive its leaf, and a leaf can reference a dead session), which is 1-5's reconciliation problem.
- **Final git output:**
  ```
  git status --porcelain
  git log --oneline -2
  ```

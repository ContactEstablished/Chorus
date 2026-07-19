# Chorus Phase 1, Task 1-5 Execution Prompt — Project Tabs + Session Restore

_Generated 2026-07-19 against HEAD `717311d`. Ground facts in §4 were re-verified at that commit and its doc ancestors; no src changes follow it._

## §1 Role

You are the implementation engineer for **Chorus Phase 1, Task 1-5** (project tabs + full restore — the Phase 1 closer). Repo root: `C:\Projects\ContactEstablished\Chorus`. Expected branch `main` — confirm with `git branch --show-current`; do not switch or create branches. Expected HEAD: `717311d` ("Phase 1.5 planning: council cycle on the session restore contract") or a descendant.

Planning was done by a separate coordinator (Claude); the restore contract was decided by a 3-model council review (CR-1.5) and is **not open for redesign** — the final summary will be reviewed by the coordinator against the task docs and the contract. Tasks 1-1 through 1-4 were implemented by other agents; their handoff findings are folded into this prompt.

## §2 Goal

Turn Chorus from a single-project app into a multi-project one with a project tab bar, and implement the **D16 session restore contract**: at boot and on first tab activation, the restore set (layout leaves ∩ `running` rows) is cwd-validated and auto-relaunched under original row ids with fresh PTYs — staggered, badged as fresh conversations — while `running` rows with no leaf are **healed to `exited` before any spawn** (the invisible-process guard). Restart is unified through a new `session:restart` channel (in-run and post-restart, one path); the 1-4 `respawn` attach flag is removed entirely; a `session:delete` IPC ships and pane close deletes the session row. `registerIpc` stops closing over one project — every handler resolves `project_id` per-request. No schema change anywhere.

**This task closes Phase 1** and touches the widest main-process surface yet: the IPC layer rework, the restore engine, and the removal of 1-4's respawn mechanism.

## §3 Project Context

**Architecture:** local-first, Windows-only Electron 43.1.1 + Vue 3 + TypeScript + Vite + Pinia app running AI coding-agent CLIs (Claude Code, Codex) as live interactive TUIs in xterm.js panes; PTYs (node-pty / ConPTY) live in the **MAIN** process owned by `SessionManager`; renderer is a pure view attaching by session id over typed IPC; `contextIsolation: true`, `nodeIntegration: false`.

**Dev machine:** Windows 11, PowerShell 7, Node 22.14.0. CLIs: `claude.exe` 2.1.207 (native exe), `codex-cli` 0.135.0 (npm `.cmd` shim via `cmd.exe /c`).

**Environment quirks — all seven expected, none a bug the implementer caused:**

(a) **OS toasts disabled system-wide** (registry `ToastEnabled=0`); exit-toast logs `[notify] toast shown: …` then `[notify] toast failed: … (HRESULT: -2143420140)`; the **log line is the pass signal**.

(b) **Codex TUI first-run prompts** — update prompt (press **2** to Skip, never **1**), possible directory-trust prompt, `TERM is set to "dumb"` `[y/N]`. Rendering crisply IS the terminal layer working. **NOTE for this task: auto-restored Codex panes will re-show these prompts** — that is the "fresh conversation" reality the D16 badge exists to disclose, not a restore bug.

(c) **`node-pty` logs `AttachConsole failed` on PTY teardown.** Pre-existing noise.

(d) **The automation harness strips `ComSpec` and modifies PATH** — restore `ComSpec` + registry user/machine PATH before npm installs or app launches.

(e) **`TaskStop` kills only the wrapper shell** — `npm run dev` descendant trees survive as orphans holding the CDP port. Every "restart the app" check **MUST** `taskkill /PID <root> /T /F` and confirm the port rebinds, or the "fresh boot" is the old window. Two prior sessions lost time to exactly this.

(f) **`npx`/`npm run` prepend the npm-global dir to the child PATH** (defeats missing-CLI simulation, breaks `--` passthrough). Invoke `node node_modules/electron-vite/bin/electron-vite.js dev -- --remote-debugging-port=9222` directly. electron-vite HMR covers the renderer only — every main-process edit needs a full tree-kill + relaunch (this task edits main heavily; budget for it).

(g) **Orphan checks cannot grep `tasklist` for claude/codex** — the dev machine runs ~16 unrelated `claude.exe`. Walk the descendant tree of the electron main PID instead. Also: `window.confirm` blocks the renderer thread — CDP must fire the click async (`setTimeout(...,0)`) and dismiss with a real mouse click.

## §4 Ground Yourself First (Read BEFORE Editing)

### Docs (in-repo)
- `CLAUDE.md` — locked rules, now including the D14 plain-object IPC payload rule.
- `docs/Features/Foundation/roadmap.md` — §5 Verified Ground Facts, §6 Decisions (**D16 is the contract this task implements**; D15 is partially superseded by it).
- **`docs/Features/Foundation/Tasks/Task-1-5.md`** — THE task contract. Scope, non-goals, acceptance criteria. **THIS GOVERNS.**
- **`docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-1-5.md`** — §1 restore contract (goes verbatim in the commit message), §4/§4b restore engine + restart/delete, boot sequence, UI sketches, runtime script.
- `docs/Features/Foundation/CouncilBriefs/CouncilFindings-1.5-RestoreContract.md` — the council's reasoning and dissents. **Precedence rule: where the raw findings and ImplementationSpec-1-5 disagree, THE SPEC WINS** — it carries four coordinator resolutions ratified after the findings were filed: (a) `status='running'` written only AFTER spawn success; (b) no PID-based orphan scanning; (c) cwd-missing shows a message, no re-homing UI; (d) close-flow row deletion, no context-menu/session-list UI. The findings' Q4 step 3 and Risk-1 PID mitigation are explicitly superseded, and findings action item 7 (layout migration) was already satisfied by commit `81e8a0b`.
- `docs/Features/Foundation/Tasks/Task-1-4-CompletionSummary.md` — the previous implementer's handoff (F5–F9).

### Code state — verified 2026-07-19 at commit `c91aea1` (docs commits `dd75dc1`, `717311d` follow it; no src changes since). Trust this over any older doc line.

- `npm run typecheck` exits 0; `npx vitest run` = 38/38 across three files (`src/shared/layout.test.ts`, `src/shared/ipc.test.ts`, `src/renderer/src/stores/layout.test.ts`).
- `src/main/services/sessionManager.ts` — `Map<string, PtySession>` keyed by stable DB row id; N same-kind sessions supported. Public: `launch(agent, cwd, sessionId)` (spawns under a caller-minted row id), `attach({sessionId, agent, respawn?}, cwd)` (**the `respawn` branch is what this task removes**), `kill`, `write`, `resize`, `getAgent`, `onData`/`onExit` (listener Sets), `dispose`. Private `spawn(agent, cwd, sessionId?)`.
- `src/shared/ipc.ts` — **11 channels**: `session:attach/launch/launch-context/write/resize/kill`, `session:data/exit`, `cli:detect`, `layout:get/set`. `attachRequestSchema` carries `respawn: z.boolean().optional()` (**remove**). `layout:set` payload is `layoutJsonSchema.nullable()` — null DELETEs the `pane_layouts` row. Repo convention `z.uuid()`.
- `src/main/ipc.ts` — `registerIpc(sessions, storage, project)` **closes over ONE project** (the structural debt this task pays down). The `session:launch` handler mints the row (`storage.createSession({id: randomUUID(), projectId: project.id, …})`) then calls `sessions.launch(agent, cwd, row.id)` — keep that division of labor when threading `project_id`. The attach handler flips the row to `running` on a respawn attach (**remove with the respawn mechanism**). `session:launch-context` serves `{projectRoot, recentCwds}` and closes over the single project (**make project-aware**).
- `src/main/services/storage.ts` — `getOrCreateProject` (seeds nothing: project row only), `getPaneLayout(): LayoutJson | null`, `savePaneLayout`, `clearPaneLayout`, `getRecentCwds`/`pushRecentCwd` (inline-Drizzle settings pattern, key `recent_cwds`), `createSession`, `getSessionsForProject` (ordered by `created_at`), `updateSessionStatus`, `getWindowBounds`/`saveWindowBounds`, `close`. **No `getProjectById`, no `listProjects`, no active-project settings, no delete-session API — this task adds all four.**
- `src/main/index.ts` — `whenReady`: storage init, `getOrCreateProject(DEV_WORKING_DIR)` (from `src/main/constants.ts`), `registerIpc(sessions, storage, project)`, `watchSessionExits(sessions)` plus a second `sessions.onExit` listener writing `updateSessionStatus(id,'exited',code)` (D11), `createWindow`.
- `src/preload/index.ts` — Zod-free forwarders; `ChorusApi` inferred (no index.d.ts edit). Existing: `attachSession`, `launch`, `getLaunchContext`, `detectClis`, `getLayout`, `setLayout` (nullable), `writeSession`, `resizeSession`, `killSession`, `onSessionData`, `onSessionExit`.
- `src/renderer/src/App.vue` — one `layout:get` on mount → layout store + `sessions` ref; `agentFor(id): AgentKind | undefined`; `<LayoutRenderer v-if="layout.tree">` with `v-else` `EmptyState`; hosts `LaunchDialog` and owns its open/close + split-target state.
- `src/renderer/src/components/TerminalPane.vue` — props `{sessionId, agent}`; store access keyed by `sessionId` (D10 done); Restart chrome = kill → await exit → re-attach with `respawn: true` (**reroute to `session:restart`**); ✕ close = confirm → kill → `removeLeaf` (**add row deletion after exit completes**); split buttons enabled.
- `src/renderer/src/stores/session.ts` — `Record<string /*sessionId*/, PaneSessionState>`, `agent` a data field; entries never pre-seeded and never removed on leaf close.
- `src/renderer/src/stores/layout.ts` — `{tree, dirty}`; `loadLayout(layout)` takes the tree as parameter; `insertLaunchedLeaf`; `removeLeaf` (null tree → persists null); 500 ms debounced persist sending a **plain JSON snapshot** (D14).
- `src/renderer/src/components/` — `LayoutRenderer.vue` (recursive, splitpanes ~4.1.2, missing-session placeholder branch — **do not touch this file**), `LaunchDialog.vue`, `EmptyState.vue`. **`ProjectTabs.vue` and `stores/project.ts` do not exist — this task creates them.**
- DB: tables `projects` (id, name, root_path UNIQUE, created_at) / `pane_layouts` / `settings` / `schema_migrations` / `sessions` — all already keyed by `project_id` where relevant. Migrations applied: 1, 2. **No new migration in this task.**
- Repo-local git identity is set (`Matthew Wilson <mwilson29072@gmail.com>`) — no `-c` overrides needed, but verify with `git config user.email` before committing.

### Git checks (run first)
```powershell
git branch --show-current   # expect: main
git status --porcelain      # expect: CLEAN (empty)
git log --oneline -1        # expect: 717311d or descendant
```

## §5 Pre-existing Changes Warning

**The working tree is CLEAN at prompt-generation time** — a first for this phase. If `git status --porcelain` shows anything at all, stop and ask the user before proceeding. Never revert, stage, or commit files you did not change; your commit contains only Exact-Scope files.

## §6 Resolved Decisions That Bind This Task

Quote these; do not relitigate:

- **D1** (RESOLVED): ALL Zod validation in main only; preload/renderer CSP forbids `unsafe-eval` — `.parse()` there throws EvalError and silently drops events. Shared files EXPORT schemas; only `src/main/` parses.
- **D2** (RESOLVED): NEVER run `electron-rebuild`. If an install re-fetches better-sqlite3 and an ABI error appears, `npm run rebuild:better-sqlite3` — nothing else.
- **D3** (locked): Sessions live in main; the renderer never spawns processes. `dialog.showOpenDialog` runs in main.
- **D4** (locked): Verify tooling against live docs/`--help`, never model memory.
- **D5** (RESOLVED): Child PTYs inherit env untouched; no credentials anywhere; don't log cwd with env context.
- **D14** (RESOLVED, now in CLAUDE.md): renderer→main IPC payloads must be PLAIN objects — Pinia/reactive state is a Proxy that structured clone rejects at runtime with no compile-time signal. This task adds several new payloads (`project:select`, `session:restart`, `session:delete`, project-threaded layout/launch calls) — snapshot anything store-sourced; runtime-verify every one.
- **D15** (RESOLVED, items 1–2 SUPERSEDED by D16): the 1-4 `respawn` attach flag and its row-flip are REMOVED this task. Items that stand: manager-unknown attach reports `exited` (row supplies only exit code; the manager map is the sole liveness authority within a run); `session:launch-context` channel; inline-Drizzle settings.
- **D16** (RESOLVED 2026-07-19, council CR-1.5 + coordinator resolutions — THE CONTRACT THIS TASK IMPLEMENTS): restore set = layout leaves ∩ `running` rows; heal `running`-rows-without-leaf to `exited` BEFORE any spawn (invisible-process guard); guarded-auto-relaunch (cwd `existsSync` per spawn; 500 ms stagger; transient ~5 s "Session restarted — new conversation" badge; cap 16); `status='running'` written only AFTER spawn success; unified `session:restart` (row → cwd re-validate → launch path, same id, no row creation); `session:delete` (rejects live sessions), called from pane close after kill/exit completes; quit/crash write nothing at teardown and converge on the boot reconcile; NO schema change. Dissents preserved for later phases (Gemini: `desired_state` column when a "don't restore" toggle lands; GPT: affordance-driven restore is a renderer-only revert if auto-relaunch confuses).
- Findings that bind: **F4** (row/leaf drift is routine — the reconcile pass is its resolution), **F5** (panes remount on sibling close; attach must stay a pure view binding — this task removes its last spawn path), **F6** (persisted `running` = "was running when last observed", never "is alive").

## §7 Implementation Scope

Follow the Exact Scope table in `Task-1-5.md` and ImplementationSpec-1-5 §§2–9.

**Create:** `src/renderer/src/components/ProjectTabs.vue`, `src/renderer/src/stores/project.ts`, and the `computeRestoreSet` pure helper (own module or exported beside the manager — implementer's call; must be unit-testable without Electron).

**Edit:** `src/shared/ipc.ts` · `src/main/ipc.ts` · `src/preload/index.ts` · `src/main/services/storage.ts` · `src/main/services/sessionManager.ts` · `src/main/index.ts` · `src/renderer/src/App.vue` · `src/renderer/src/components/TerminalPane.vue` · `src/renderer/src/components/LaunchDialog.vue` · `src/renderer/src/stores/layout.ts` (+ test files).

**Explicitly do NOT touch:** `src/main/services/notifications.ts`, `src/main/services/cliDetect.ts`, `src/main/constants.ts` (`DEV_WORKING_DIR` stays — first-run seed only), `src/main/db/schema.ts` (NO migration), `src/shared/layout.ts`, `src/renderer/src/components/LayoutRenderer.vue`, `src/renderer/src/components/EmptyState.vue`, `src/renderer/src/stores/session.ts` (unless the restored-badge event genuinely needs a store field — if so, flag it in the summary).

### Known spec seams

1. Spec §3's table line `sessions.launch(p.id, req.agent, req.cwd)` predates the 1-4 division of labor — the HANDLER mints the row (`createSession({projectId: p.id, …})`) and calls `launch(agent, cwd, row.id)`. Spec §4's amendment states this; follow it.
2. Spec §8's store sketch calls `useLayoutStore().loadFor(id)` — that method doesn't exist; today's store has `loadLayout(layout)`. Naming and plumbing of project-aware load is the implementer's call; keep the single-round-trip pattern and the D14 snapshot persist.
3. The stagger constant: 500 ms per spawn; drop to 250 ms ONLY if runtime testing shows ConPTY tolerates it, and say so in the summary. Render pane chrome immediately with a spinner so the stagger is not user-blocking (findings Risk 2).
4. Heal writes and the reconcile read should be transactionally adjacent (findings action 2) — better-sqlite3 is synchronous, so a plain sequential block in one function satisfies this; do not build transaction machinery.

### Key invariants to restate

- Restore set = leaves ∩ running rows, computed by a pure unit-tested helper.
- Heal BEFORE any spawn.
- `running` only AFTER spawn success.
- Attach has NO spawn path when done.
- Every handler FK-checks `project_id` per-request.
- Empty layout = absent row (nullable `layout:set` per project).
- Close ordering: kill → awaited exit → leaf removed → row deleted.
- No PID scanning; no sentinel exit codes (cwd-missing is its own chrome state).
- D14 plain payloads.
- Cap 16.
- Switching tabs never kills sessions.

## §8 Strict Non-Goals

- No schema change / no migration / no `desired_state` column (Gemini's dissent is deferred, not adopted).
- No "Relaunch all" button (GPT's dissent is a documented revert path, not scope).
- No context-menu system, no session-list UI, no cwd re-homing / "Choose directory" flow (Phase 2).
- No project delete or rename UI; no per-project theming; no cross-project session moves; no worktrees (Phase 2); no multi-window; no filmstrip/palette/auto-titling (Phase 1b).
- No secrets/env changes (D5).
- Do not revert, stage, or commit unrelated files; docs are the coordinator's.

## §9 Required Workflow

1. Ground per §4.
2. **Suggested order (respect it unless you have a stated reason):** (i) `computeRestoreSet` pure helper + unit tests FIRST — it is the contract's heart and needs no Electron; (ii) schemas + preload + storage additions; (iii) `registerIpc` rework, verified against the existing single project (app must still boot + launch normally); (iv) restore engine + boot sequence; (v) `session:restart`/`session:delete` + respawn removal end-to-end; (vi) tabs UI + project store + window title; (vii) badge.
3. Self-review the diff against CLAUDE.md, D1/D3/D14/D16, and the Task-1-5 Review Checklist.
4. Run verification (§10).
5. ONE intentional commit in the style of `80e69c3` (plain-English paragraph, then "Technical notes:" bullets). **The commit message must contain ImplementationSpec-1-5 §1's restore contract verbatim.** Verify `git config user.email` shows `mwilson29072@gmail.com` (repo-local is set). End with a `Co-Authored-By:` line crediting yourself per repo format. Do not push, do not open a PR, do not amend or rebase existing commits.

## §10 Verification Commands

```powershell
npm run typecheck   # zero errors (G1)
npx vitest run      # green — 38 existing + new: computeRestoreSet (all four populations, failed-spawn orphan, already-live), project_id schemas, projectsListSchema
npm run dev         # via the direct electron-vite invocation from §3(f) when CDP is needed
```

**RUN the app, don't just compile (G2).** The restore contract's failure modes are runtime-only; a green typecheck proves nothing here. Work through the runtime script in order — each item states the exact observable:

1. Existing dev DB → **one tab** (repo project), zero migration; sessions restore per contract or empty state if none qualify.
2. **+ Add Project** → native directory picker (main-side) → second real directory → second tab appears and becomes active; cancel is a no-op.
3. Launch Claude in project B; switch to A, launch Codex. Both live.
4. Start continuous output in B (e.g. `ping -t`); switch to A; wait; switch back → output **continued while hidden** (sessions-live-in-main proof — screenshot).
5. With 3 running sessions, quit (window ✕). Descendant-tree walk of the electron PID → no agent processes remain.
6. Relaunch → active project's qualifying sessions **auto-relaunch staggered** in the restored layout shape, each wearing the ~5 s "new conversation" badge (screenshot during the window); exited-before-quit sessions show exited chrome.
7. Switch to the other project's tab → its `running` rows relaunch NOW (lazy) — not before (verify via main-process log or process count prior to the switch).
8. **Heal proof:** app closed → hand-edit DB to add a `running` row with no leaf → boot → nothing extra spawns; DB dump shows it `exited`; heal logged before first spawn.
9. **cwd-missing:** app closed → rename one restored session's cwd directory → boot → that pane shows "Working directory not found" exited chrome; others restore; no sentinel exit code in the DB.
10. **Restart unification:** in-run (kill a live pane → Restart → fresh TUI) AND post-restart (relaunch app → Restart an exited pane → fresh TUI, same row id). DB shows `running` written only after each spawn.
11. **Close deletes:** close a pane → DB dump shows the row GONE. `session:delete` on a live session → structured rejection.
12. **Respawn gone:** `grep -ri respawn src/` → no matches.
13. **D14 console check:** renderer devtools console across the whole flow — zero `An object could not be cloned`.
14. Window title shows the active project name and updates on tab switch.

Every relaunch step: tree-kill + port-rebind confirmation per §3(e). DB dumps via `ELECTRON_RUN_AS_NODE` (better-sqlite3 will not load in plain node).

**Headless fallback:** PowerShell user32 helper — EnumWindows for the "Chorus" window, GetWindowRect + CopyFromScreen screenshots, SetCursorPos + mouse_event clicks, SendKeys typing; window may sit at negative coordinates on a secondary monitor.

## §11 Failure Honesty Clause

Capture exact output on any failure, explain it, report it; never claim success not directly observed. Specifically may NOT be reported as success: an invisible PTY (process count exceeds visible panes), a heal that happened after a spawn, `running` written before a spawn succeeded, a badge you did not actually see, a "fresh boot" without a confirmed tree-kill, `respawn` references surviving in src/, a clone error in the console, or a deleted row that still exists. Restored Codex panes re-showing first-run prompts is expected (§3b) — note it, don't fix it.

## §12 Final Reporting Requirements

Detailed summary for coordinator review:

- **Status:** DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED.
- **Contract conformance:** ImplementationSpec §1's five clauses restated with a one-line statement each of how the implementation satisfies it and which runtime step proved it.
- **Files changed** (one-line rationale each; beyond-scope flagged loudly). Whether `stores/session.ts` was touched for the badge, with justification.
- **Deviations** from the spec, including the stagger value used and each "Known spec seam" disposition.
- **Verification transcript:** typecheck; vitest with new test names; runtime items 1–14 individually with what was actually observed (screenshots referenced); DB dumps for heal/close-delete/restart; the descendant-tree walk output.
- **Acceptance criteria** from Task-1-5.md restated pass/fail.
- **Non-goals confirmation** — call out "no schema change" and "no Relaunch-all" by name.
- **Residual risks / notes for Phase 1b** — including anything learned about the restore engine that affects filmstrip/palette work.
- **Final git output** fenced:
  ```
  git status --porcelain
  git log --oneline -2
  ```

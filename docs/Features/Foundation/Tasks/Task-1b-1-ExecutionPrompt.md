# Chorus Phase 1b, Task 1b-1 Execution Prompt — Session Auto-Titling

_Generated 2026-07-19 against HEAD `b9b0dfa`. Ground facts in §4 were re-verified at that commit and its doc ancestors; no src changes follow it._

## §1 Role

You are the implementation engineer for **Chorus Phase 1b, Task 1b-1** (session auto-titling — the first of three Phase 1b tasks). Repo root: `C:\Projects\ContactEstablished\Chorus`. Expected branch `main` — confirm with `git branch --show-current`; do not switch or create branches. Expected HEAD: `b9b0dfa` ("Phase 1b kickoff: auto-titling, Focus+Filmstrip, Ctrl+K palette") or a descendant.

Planning was done by a separate coordinator (Claude); the final summary will be reviewed by the coordinator against the task docs. Phase 1 (five tasks) was implemented by other agents; relevant handoff findings are folded into this prompt.

## §2 Goal

Give every session a human-readable, persisted title captured from the terminal itself: a nullable `title` column on `sessions` (migration v3), a `session:set-title` IPC (sanitized + length-bounded in main, ~500 ms trailing debounce in the renderer), capture via xterm's `Terminal.onTitleChange` (OSC 0/2) with a first-typed-line fallback, and the title threaded onto both `attachResponseSchema` and `sessionInfoSchema` so every view reads it from one round-trip. The pane header renders it (ellipsis + tooltip). This is a small, surgical task — the narrowest of Phase 1b — but it is the data foundation both later 1b views consume.

## §3 Project Context

**Architecture:** local-first, Windows-only Electron 43.1.1 + Vue 3 + TypeScript + Vite + Pinia app running AI coding-agent CLIs (Claude Code, Codex) as live interactive TUIs in xterm.js panes; PTYs (node-pty / ConPTY) live in the **MAIN** process owned by `SessionManager`; renderer is a pure view attaching by session id over typed IPC; `contextIsolation: true`, `nodeIntegration: false`.

**Dev machine:** Windows 11, PowerShell 7, Node 22.14.0. CLIs: `claude.exe` 2.1.207 (native exe), `codex-cli` 0.135.0 (npm `.cmd` shim via `cmd.exe /c`).

**Environment quirks — all seven expected, none a bug the implementer caused:**

(a) **OS toasts disabled system-wide** (registry `ToastEnabled=0`); exit-toast logs `[notify] toast shown: …` then `[notify] toast failed: … (HRESULT: -2143420140)`; the **log line is the pass signal**.

(b) **Codex TUI first-run prompts** — update prompt (press **2** to Skip, never **1**), possible directory-trust prompt, `TERM is set to "dumb"` `[y/N]`. Rendering crisply IS the terminal layer working. **NOTE:** these prompt lines may become fallback titles if typed at — that is working-as-designed, not a bug.

(c) **`node-pty` logs `AttachConsole failed` on PTY teardown.** Pre-existing noise.

(d) **The automation harness strips `ComSpec` and modifies PATH** — restore `ComSpec` + registry user/machine PATH before npm installs or app launches.

(e) **`TaskStop` kills only the wrapper shell** — `npm run dev` descendant trees survive as orphans holding the CDP port. Every "restart the app" check **MUST** `taskkill /PID <root> /T /F` and confirm the port rebinds, or the "fresh boot" is the old window. Two prior sessions lost time to exactly this.

(f) **`npx`/`npm run` prepend the npm-global dir to the child PATH** (defeats missing-CLI simulation, breaks `--` passthrough). Invoke `node node_modules/electron-vite/bin/electron-vite.js dev -- --remote-debugging-port=9222` directly. electron-vite HMR covers the renderer only — every main-process edit needs a full tree-kill + relaunch (this task edits main; budget for it).

(g) **Orphan checks cannot grep `tasklist` for claude/codex** — the dev machine runs ~16 unrelated `claude.exe`. Walk the descendant tree of the electron main PID instead. Also: `window.confirm` blocks the renderer thread — CDP must fire the click async (`setTimeout(...,0)`) and dismiss with a real mouse click.

## §4 Ground Yourself First (Read BEFORE Editing)

### Docs (in-repo)

- `CLAUDE.md` — locked rules, including the D14 plain-object IPC payload rule.
- `docs/Features/Foundation/roadmap.md` — §5 Verified Ground Facts, §6 Decisions (D18/D19 bind this task).
- **`docs/Features/Foundation/Tasks/Phase-1b-Overview.md`** — phase shape, file-ownership matrix, cross-cutting rules.
- **`docs/Features/Foundation/Tasks/Task-1b-1.md`** — THE task contract. Scope, non-goals, acceptance criteria. **THIS GOVERNS.**
- **`docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-1b-1.md`** — exact schemas, code sketches, insertion points by named symbol, runtime script. Follow it, with the ONE correction in §7 below (DB verification method).
- `docs/Features/Foundation/Tasks/Task-1-5-CompletionSummary.md` — the previous implementer's handoff (findings F10/F11).

### Code state — verified 2026-07-19 at HEAD `b9b0dfa` (src unchanged since `fb384c5`); trust this over any older doc line

- `npm run typecheck` exits 0; `npx vitest run` = 55/55 across 4 files (`src/shared/layout.test.ts`, `src/shared/ipc.test.ts`, `src/main/services/restore.test.ts`, `src/renderer/src/stores/layout.test.ts`).
- `src/main/db/schema.ts` — Drizzle `sessions` table: `id`, `projectId`, `agent`, `cwd`, `status`, `exitCode`, `createdAt`. **No `title` column.** `SessionRow`/`NewSessionRow` via `$inferSelect`/`$inferInsert`.
- `src/main/services/storage.ts` — `MIGRATIONS` is a `string[]` of two DDL blocks (v1, v2); `migrate()` applies `applied+1 … MIGRATIONS.length` in a transaction and records `schema_migrations`. `updateSessionStatus` is the pattern to mirror for the new `updateSessionTitle`. Settings use inline-Drizzle per-key accessors (no generic getSetting/setSetting).
- `src/shared/ipc.ts` — 17 channels in `IpcChannel`; `sessionInfoSchema` = `{id, agent, status}`; `attachResponseSchema` = `{sessionId, buffer, status, exitCode, cwdMissing?, restorePending?, restored?}`. Repo convention `z.uuid()`. All `.parse()` in `src/main/` only (D1).
- `src/main/ipc.ts` — `registerIpc(sessions, storage)`; the `session:attach` handler fetches `const row = storage.getSessionById(sessionId)` at the top, so `row.title` will be in hand for both response branches.
- `src/preload/index.ts` — Zod-free `chorusApi` forwarders; `ChorusApi` inferred (no index.d.ts edit).
- `src/renderer/src/components/TerminalPane.vue` — **verified line anchors (2026-07-19):** `cleanups: Array<() => void>` at line 54; `attachToSession()` defined at line 85; `terminal.onData((data) => …)` keystroke handler registered at line 225 with its disposable pushed into `cleanups` at line 230; `onBeforeUnmount` at line 238 (runs `clearTimeout`s then all cleanups); header agent label `labels[props.agent]` at line 264. Props `{sessionId, agent}`; chrome (`paneMessage`, badge, spinner) rides attach-response flags.
- DB at `%APPDATA%\chorus\chorus.db` (confirmed present); migrations applied: 1, 2. The dev DB currently holds real rows from Phase-1 verification (a second project `Chorus-Second`, live/exited sessions) — expected, do not clean it up.
- **`@xterm/xterm` 6 installed typings** (`node_modules/@xterm/xterm/typings/xterm.d.ts`, verified 2026-07-19): `onTitleChange: IEvent<string>` at line 1003; (`attachCustomKeyEventHandler` at 1072 — not needed this task). Re-verify at execution per D4.
- Repo-local git identity is set (`Matthew Wilson <mwilson29072@gmail.com>`) — verify with `git config user.email` before committing.

### Git checks (run first)

```powershell
git branch --show-current   # expect: main
git status --porcelain      # expect: ONLY "?? _verify/"
git log --oneline -1        # expect: b9b0dfa or descendant
```

## §5 Pre-existing Changes Warning

The working tree holds exactly one untracked entry at prompt-generation time: `_verify/` — a previous implementer's harness artifacts (screenshots, helper scripts), deliberately uncommitted. It is none of your business: do not read into scope, revert, stage, commit, or delete it. If `git status --porcelain` shows anything ELSE, stop and ask the user. Your commit contains only files you changed for this task.

## §6 Resolved Decisions That Bind This Task

Quote; do not relitigate:

- **D1** (RESOLVED): ALL Zod validation in main only; preload/renderer CSP forbids `unsafe-eval` — `.parse()` there throws EvalError and silently drops events. Shared files EXPORT schemas; only `src/main/` parses.
- **D2** (RESOLVED): NEVER run `electron-rebuild`. If an install re-fetches better-sqlite3 and an ABI error appears: `npm run rebuild:better-sqlite3` — nothing else.
- **D3** (locked): Sessions live in main; the renderer never spawns processes.
- **D4** (locked): Verify third-party APIs against installed typings/docs at execution time, never from model memory. Here: `Terminal.onTitleChange` (cited from installed typings above — confirm before use).
- **D14** (locked, CLAUDE.md): renderer→main IPC payloads must be PLAIN objects (Pinia/reactive Proxies fail structured clone at runtime with no compile-time signal). The set-title payload is built from primitives — keep it that way.
- **D18** (RESOLVED 2026-07-19): Title source = OSC + first-line fallback. `Terminal.onTitleChange` (OSC 0/2) wins and may keep updating live; the fallback (first Enter-terminated typed line, trimmed, ≤120 chars) fires only while the title is still null. NO LLM summarization (Phase 3+). **Honest unknown:** whether Claude Code / Codex emit OSC titles at all is UNVERIFIED until this session — the fallback is the guaranteed path, and you must report which mechanism fired per CLI.
- **D19** (RESOLVED 2026-07-19): Migration v3 = one nullable `title` TEXT column on `sessions`, in BOTH the hand-rolled MIGRATIONS array and the Drizzle schema. Council waived (trivially reversible). Existing rows back-fill to NULL.
- Findings that bind: **F5** (panes remount when siblings close — attach is a view binding; your capture listeners and debounce timer must be registered/torn down per mount: disposables into `cleanups`, `clearTimeout` in `onBeforeUnmount`), **F10** (boot-transient chrome is consume-once, never clock-based — context for why the badge code you'll see looks the way it does; do not disturb it). The F11 harness practicalities are already folded into §3's quirks (e)–(g).

## §7 Implementation Scope

Follow the Exact Scope table in `Task-1b-1.md` and ImplementationSpec-1b-1 §§2–6 exactly. Files (all edits, no creates): `src/main/db/schema.ts` · `src/main/services/storage.ts` · `src/shared/ipc.ts` · `src/main/ipc.ts` · `src/preload/index.ts` · `src/renderer/src/components/TerminalPane.vue` (+ `src/shared/ipc.test.ts` for the new schema tests). Explicitly do NOT touch: `sessionManager.ts`, `restore.ts`, `notifications.ts`, `cliDetect.ts`, `constants.ts`, `main/index.ts`, `App.vue`, `LayoutRenderer.vue`, `LaunchDialog.vue`, `EmptyState.vue`, `ProjectTabs.vue`, any store, `shared/layout.ts`.

### One correction to the task doc + spec (coordinator-verified 2026-07-19)

Both documents verify the persisted title with `sqlite3 "$env:APPDATA\chorus\chorus.db" …`. **The `sqlite3` CLI is NOT installed on this machine** (`where.exe sqlite3` finds nothing). Use the established method instead: a small dump script run under Electron's node — better-sqlite3 is compiled for Electron's ABI and will not load in plain `node`:

```powershell
# dump.js: require better-sqlite3 by absolute path, open %APPDATA%\chorus\chorus.db readonly,
#          SELECT agent, status, title FROM sessions; console.log rows
$env:ELECTRON_RUN_AS_NODE=1
& node_modules\electron\dist\electron.exe dump.js
```

Write the dump script into your scratch/temp area (or `_verify/`-style local dir you do NOT commit), never into the repo.

### Key invariants to restate

- OSC title wins and may update live; the fallback fires ONLY while title is null and never overwrites OSC.
- Every write goes through `session:set-title`: main sanitizes (strip C0 + DEL: `raw.replace(/[\x00-\x1F\x7F]/g, '').trim()`), bounds to 120, and silently no-ops on an empty post-sanitize result — never a blank write.
- Renderer debounce is 500 ms TRAILING (last title always lands).
- `title` is required-NULLABLE (`z.string().nullable()`, not `.optional()`) on both `sessionInfoSchema` and `attachResponseSchema` — a producer that forgets it fails the outbound parse loudly.
- Attach seeding: only seed `title.value` from `attach.title` when `title.value` is still null (a mid-session remount must not clobber a live OSC title with a stale row value).
- The DDL string and the Drizzle column must match exactly (TEXT, nullable) — the same discipline the MIGRATIONS header comment states for v2.
- One keystroke listener: extend the EXISTING `terminal.onData` handler (line 225); do not register a second.

## §8 Strict Non-Goals

- No LLM summarization (Phase 3+); no manual rename UI; no title in project tabs (pane header only).
- No schema change beyond the one nullable column; no new tables; no drizzle-kit migration machinery.
- No changes to the restore/attach lifecycle, the badge/spinner/cwd-missing chrome, or the session store.
- No new npm dependencies.
- Do not revert, stage, or commit unrelated or untracked files — including `_verify/` and anything under `docs/`.

## §9 Required Workflow

1. Ground per §4. 
2. Implement per the spec's order: schema+migration → storage accessor → shared schemas → main handler (+ `sanitizeTitle` helper, exported for tests) → preload forwarder → renderer capture + header. Run `npm run typecheck` after the main-side work before touching the renderer. 
3. Self-review the diff against CLAUDE.md, D1/D4/D14/D18/D19, and the Task-1b-1 Review Checklist. 
4. Run verification (§10). 
5. ONE intentional commit, style of repo commit `80e69c3` (plain-English paragraph, then "Technical notes:" bullets); state in the message which title mechanism fired per CLI; verify `git config user.email` = `mwilson29072@gmail.com`; end with a `Co-Authored-By:` line crediting yourself per repo format; do not push, do not open a PR, do not amend or rebase existing commits.

## §10 Verification Commands

```powershell
npm run typecheck   # zero errors (G1)
npx vitest run      # green — 55 existing + new: setTitleRequestSchema accept/reject, sessionInfoSchema/attachResponseSchema title cases, sanitizeTitle if exported
npm run dev
```

**RUN the app, don't just compile (G2).** Runtime script, numbered, each with its exact observable:

1. Boot on the existing dev DB → migration v3 applies in place (log or `schema_migrations` dump shows version 3); existing sessions intact, `title = NULL` everywhere.
2. Launch Claude Code → watch the header. **Report: OSC or fallback?** If nothing appears before you type, type a line + Enter → the line becomes the title. Note the exact title.
3. Launch (or use an existing) Codex pane → same report, per CLI.
4. Type a >40-char line as a fallback title → header ellipsis-truncates; hover shows the full text via the `title=` tooltip.
5. Debounce check: during heavy TUI redraws (or repeated OSC updates if they occur), the DB write cadence is ~1 per settle, not per redraw (observe main log or repeated dumps).
6. Restart the app (tree-kill + port rebind per §3e) → titled panes show their titles again on attach; the DB dump (§7 method) shows titled rows carrying strings, untitled rows NULL.
7. Boundary: paste a first line containing ANSI/control sequences → the persisted title is stripped clean (dump), and no blank title is ever written.
8. D14 console check: renderer devtools console across the flow — zero `An object could not be cloned`.

**Headless fallback:** PowerShell user32 helper — EnumWindows for the "Chorus" window, `PrintWindow` with `PW_RENDERFULLCONTENT` for screenshots, SetCursorPos + mouse_event clicks, SendKeys typing; window may sit at negative coordinates on a secondary monitor.

## §11 Failure Honesty Clause

Capture exact output on any failure, explain it, report it; never claim success not directly observed. Specifically may NOT be reported as success: a migration that did not visibly apply (no v3 in `schema_migrations`), a title that you did not actually see in the header, an unverified claim about which mechanism (OSC vs fallback) fired, a debounce you did not observe (a write-per-redraw flood is a FAIL), a control-character title reaching the DB, or a blank title written. If `onTitleChange` never fires for either CLI, that is an acceptable, REPORTABLE outcome (D18) — the fallback path carrying the feature is success, pretending OSC worked is not.

## §12 Final Reporting Requirements

Detailed summary for coordinator review:

- **Status:** DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED.
- **Title-mechanism report (D18):** per CLI (Claude Code, Codex): OSC fired / fallback fired / both — with the observed titles. Confirmation that `onTitleChange` exists in the installed typings (D4).
- **Files changed** — one-line rationale each; anything beyond §7's list flagged loudly with justification.
- **Deviations** from ImplementationSpec-1b-1, with why — including confirmation the §7 DB-verification correction was used (sqlite3 CLI absent).
- **Verification transcript:** typecheck; vitest with new test names; runtime items 1–8 individually with what was actually observed (screenshots referenced); the DB dumps for migration/persistence/sanitization.
- **Acceptance criteria** from Task-1b-1.md restated pass/fail.
- **Non-goals confirmation** — each §8 item untouched.
- **Residual risks / notes for Task 1b-2's implementer** — especially anything learned about title behavior that affects filmstrip cards.
- **Final git output** fenced:
  ```
  git status --porcelain
  git log --oneline -2
  ```

# Chorus Phase 1b, Task 1b-2 Execution Prompt — Focus + Filmstrip Default Layout

_Generated 2026-07-19 against HEAD `ef86623`. Ground facts in §4 re-verified at that commit; typecheck clean and 60/60 vitest passing at generation time._

## §1 Role

You are the implementation engineer for Chorus Phase 1b, Task 1b-2 (Focus + Filmstrip default layout — second of three serial Phase 1b tasks). Repo root: `C:\Projects\ContactEstablished\Chorus`. Expected branch `main` — confirm with `git branch --show-current`; do not switch or create branches. Expected HEAD: `ef86623` ("Roadmap re-sync after Task 1b-1") or a descendant. Planning was done by a separate coordinator; the final summary will be reviewed against the task docs. Phase 1 and Task 1b-1 were implemented by other agents; their handoff findings are folded in below.

## §2 Goal

Make the filmstrip the default workspace view (decision D20): one focused session rendered as a full `TerminalPane`, every other leaf a compact card (agent, title, status dot, elapsed-since-createdAt) in a strip along one edge. Clicking a card refocuses — a view-state change only, NEVER a tree mutation. A toggle switches to grid (`LayoutRenderer`) and back. Mode + focused session persist per project in the `settings` table (key `view_state:<projectId>`, JSON `{mode, focusedSessionId}`) over a small Zod IPC (`view:get`/`view:set`), outbound-filtered in main. Filmstrip is the default for existing DBs on first post-1b boot (absent row → default). `FilmstripRenderer.vue` consumes the same contract the filmstrip spike validated — the persisted `LayoutJson` tree + `agentFor(id): AgentKind | undefined` — plus `layout:get`'s `sessions[]` for card metadata. Focused-pane split and close keep working: a split's new session becomes focused; closing the focused pane focuses the first remaining leaf in tree order.

## §3 Project Context

**Architecture:** local-first, Windows-only Electron 43.1.1 + Vue 3 + TypeScript + Vite + Pinia app running AI coding-agent CLIs (Claude Code, Codex) as live interactive TUIs in xterm.js panes; PTYs (node-pty / ConPTY) live in the MAIN process owned by `SessionManager`; renderer is a pure view attaching by session id over typed IPC; `contextIsolation: true`, `nodeIntegration: false`.

**Dev machine:** Windows 11, PowerShell 7, Node 22.14.0. CLIs: `claude.exe` 2.1.207 (native exe), `codex-cli` 0.135.0 (npm `.cmd` shim via `cmd.exe /c`).

**Environment quirks — all expected, none a bug the implementer caused:**
(a) OS toasts disabled system-wide (registry `ToastEnabled=0`); exit-toast logs `[notify] toast shown: …` then `[notify] toast failed: … (HRESULT: -2143420140)`; the log line is the pass signal.
(b) Codex TUI first-run prompts — update prompt (press 2 to Skip, never 1), possible directory-trust prompt, `TERM is set to "dumb"` `[y/N]`. Rendering crisply IS the terminal layer working.
(c) `node-pty` logs `AttachConsole failed` on PTY teardown. Pre-existing noise.
(d) The automation harness strips `ComSpec` and modifies PATH — restore `ComSpec` + registry user/machine PATH before npm installs or app launches.
(e) `TaskStop` kills only the wrapper shell — `npm run dev` descendant trees survive as orphans holding the CDP port. Every "restart the app" check MUST `taskkill /PID <root> /T /F` and confirm the port rebinds, or the "fresh boot" is the old window. Multiple prior sessions lost time to exactly this.
(f) `npx`/`npm run` prepend the npm-global dir to the child PATH (defeats missing-CLI simulation, breaks `--` passthrough). Invoke `node node_modules/electron-vite/bin/electron-vite.js dev -- --remote-debugging-port=9222` directly. electron-vite HMR covers the renderer only — every main-process edit needs a full tree-kill + relaunch (this task edits main; budget for it).
(g) Orphan checks cannot grep `tasklist` for claude/codex — the dev machine runs ~16 unrelated `claude.exe`. Walk the descendant tree of the electron main PID instead. `window.confirm` blocks the renderer thread — CDP must fire the click async (`setTimeout(...,0)`) and dismiss with a real mouse click.
(h) **CDP beat the user32 helper in the 1b-1 session — prefer it:** `--remote-debugging-port=9222`; `Runtime.evaluate` for DOM assertions (wrap in an IIFE — top-level `const` collides across evaluates), `Page.captureScreenshot` (no window-coordinate issues), `Input.insertText` reaches xterm `onData` as one chunk; install `ws` in the session scratchpad, never the repo. `ELECTRON_RUN_AS_NODE=1` scripts print nothing to a PowerShell console (electron.exe is GUI-subsystem) — write results to a file.

## §4 Ground Yourself First (Read BEFORE Editing)

### Docs (in-repo)
- `CLAUDE.md` — locked rules, incl. the D14 plain-object IPC payload rule.
- `docs/Features/Foundation/roadmap.md` — §5 Verified Ground Facts, §6 Decisions (D20 binds this task); finding F12.
- `docs/Features/Foundation/Tasks/Phase-1b-Overview.md` — phase shape, file-ownership matrix, cross-cutting rules.
- `docs/Features/Foundation/Tasks/Task-1b-2.md` — THE task contract. Scope, non-goals, acceptance criteria. THIS GOVERNS.
- `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-1b-2.md` — exact schemas, code sketches, insertion points by named symbol, runtime script. Follow it, with the corrections in §7 below.
- `docs/architecture/spike-filmstrip-notes.md` — the throwaway spike that validated the tree/`agentFor` contract (no spike code exists in the tree; `FilmstripRenderer.vue` is written fresh).

### Code state — verified 2026-07-19 at HEAD `ef86623`; trust this over any older doc line
- `npm run typecheck` exits 0; `npx vitest run` = 60/60 across 4 files (`src/shared/layout.test.ts`, `src/shared/ipc.test.ts`, `src/main/services/restore.test.ts`, `src/renderer/src/stores/layout.test.ts`).
- `src/shared/ipc.ts` — `sessionInfoSchema` = `{id, agent, status, title}` (`title` required-nullable since 1b-1). NO `createdAt` yet. `layoutGetResponseSchema` = `{layout: layoutJsonSchema.nullable(), sessions: z.array(sessionInfoSchema)}`. Repo convention `z.uuid()`. All `.parse()` in `src/main/` only (D1).
- `src/main/ipc.ts` — `registerIpc(sessions, storage)`; `requireProject(projectId)` FK-check helper at line 71; the `layout:get` handler (line 199) returns `layoutGetResponseSchema.parse({layout: storage.getPaneLayout(p.id), sessions: storage.getSessionsForProject(p.id)})` — note `getSessionsForProject` returns full `SessionRow[]` (which already carries `createdAt`, ISO text, ordered `asc(createdAt)`); today the outbound parse STRIPS the extra keys, so adding `createdAt: z.string()` to `sessionInfoSchema` surfaces it with zero handler changes. Verify this at execution.
- `src/main/services/storage.ts` — settings use inline-Drizzle per-key accessor pairs (`getWindowBounds`/`saveWindowBounds` at ~line 260 is the pattern to mirror: JSON value, defensive parse returning null on corrupt rows, `onConflictDoUpdate` upsert). No generic `getSetting`/`setSetting` exists — keep it that way. `sessions` Drizzle table: `createdAt: text('created_at').notNull()`.
- `src/renderer/src/stores/layout.ts` — `loadLayout(layout, projectId)` (line 34) flushes a pending debounce to the OLD project before switching (lines 35–39: `this.persistNow(this.projectId, this.tree)`); `persistNow(projectId, tree)` at line 80 sends a plain JSON snapshot (D14). Mirror this flush-old-project discipline in the new view store.
- `src/shared/layout.ts` — pure module; `collectSessionIds(tree: LayoutNode): string[]` at line 129, `findLeaf(tree: LayoutNode, sessionId: string): LayoutLeaf | null` at line 135. Both already exist — import, don't reimplement.
- `src/renderer/src/App.vue` — `loadToken` supersede token at line 31; the single `watch(() => projectStore.activeId, …)` at line 32 does the one `getLayout` round-trip per project (token check at line 38); `agentFor` at line 47; `onLaunched` at line 58 (calls `layout.insertLaunchedLeaf` at line 65); renders `<LayoutRenderer v-if="layout.tree">` / `<EmptyState v-else>` + `<LaunchDialog>`.
- `src/renderer/src/components/TerminalPane.vue` — props `{sessionId, agent}`; `defineEmits<{ split: [target: SplitTarget] }>()` at line 14; `labels: Record<AgentKind, string> = { claude: 'Claude Code', codex: 'Codex' }` at line 16; `cleanups: Array<() => void>` at line 70; `onMounted` at line 206; the single `terminal.onData` handler at line 253 with its disposable pushed at line 273; `onBeforeUnmount` at line 281; header agent label at line 308. Title capture (OSC + fallback) landed in 1b-1 — do not disturb it.
- `src/renderer/src/components/LayoutRenderer.vue` — recursive splitpanes; props `{node, path, agentFor}`; leaf branch renders `TerminalPane` or a "Session no longer exists" placeholder; relays `@split` up.
- DB at `%APPDATA%\chorus\chorus.db`; migrations applied: 1, 2, 3. The dev DB holds real rows from prior verification (a second project `Chorus-Second`, live/exited/titled sessions) — expected, do not clean it up. No `view_state:%` settings rows exist yet.
- Repo-local git identity is set (`Matthew Wilson <mwilson29072@gmail.com>`) — verify with `git config user.email` before committing.

### Git checks (run first)
```powershell
git branch --show-current   # expect: main
git status --porcelain      # expect: ONLY "?? _verify/"
git log --oneline -1        # expect: ef86623 or descendant
```

## §5 Pre-existing Changes Warning

The working tree holds exactly one untracked entry at prompt-generation time: `_verify/` — a previous implementer's harness artifacts, deliberately uncommitted. Do not read into scope, revert, stage, commit, or delete it. If `git status --porcelain` shows anything ELSE, stop and ask the user. Your commit contains only files you changed for this task.

## §6 Resolved Decisions and Findings That Bind This Task

Quote; do not relitigate:
- **D1** (RESOLVED): ALL Zod validation in main only; preload/renderer CSP forbids `unsafe-eval` — `.parse()` there throws EvalError and silently drops events. Shared files EXPORT schemas; only `src/main/` parses.
- **D2** (RESOLVED): NEVER run `electron-rebuild`. On an ABI error: `npm run rebuild:better-sqlite3` — nothing else.
- **D3** (locked): Sessions live in main; the renderer never spawns processes.
- **D4** (locked): Verify third-party APIs against installed typings/docs at execution time, never from model memory. Here: `terminal.textarea` (`readonly textarea: HTMLTextAreaElement | undefined` in the installed `@xterm/xterm` 6 typings — confirm before use).
- **D14** (locked, CLAUDE.md): renderer→main IPC payloads must be PLAIN objects (Pinia/reactive Proxies fail structured clone at runtime with no compile-time signal). The `view:set` state is built as a fresh object literal from primitives — keep it that way.
- **D20** (RESOLVED 2026-07-19): View state per-project in `settings` (key `view_state:<projectId>`, JSON `{mode, focusedSessionId}`) over a small Zod IPC. **Filmstrip is the DEFAULT** (PLAN §183), including for existing DBs; grid is the alternate. `focusedSessionId` is never FK-checked — it legitimately goes stale (F4); views resolve staleness by falling back to the first leaf.
- **F4**: row/leaf drift is normal; a `focusedSessionId` can outlive its session. The fallback must be total — never a crash, never a non-null assertion. Residual: healed/cwd-missing exited rows render the red error dot (a neutral dot is this task's optional stretch).
- **F5**: attach is a pure view binding; focus swaps are safe remounts — the hidden session's PTY keeps running in main and replays on the next attach. Key the focused `TerminalPane` by session id so a swap is a clean remount.
- **F10**: the restored badge is consume-once (exactly one attach reports it). Cards never attach, so they never fake the badge; only the focused pane can wear it.
- **F12** (from the 1b-1 runtime, verified at `a00af48` — binds this task's cards): (a) Claude Code's OSC title is live and twitchy (~1 Hz spinner while the agent works) — cards render the PERSISTED value from `layout:get`'s `sessions[]` (fetched once per project load), which is naturally static; do NOT wire cards to any live title stream. (b) Codex titles are just the cwd basename, so same-project Codex sessions title identically — cards must compose agent + title, not title alone. (c) The renderer header shows the pre-sanitize value until the next attach; anything reading over IPC always gets the sanitized value — card/header text may differ briefly; not a bug.

## §7 Implementation Scope

Follow the Exact Scope table in `Task-1b-2.md` and ImplementationSpec-1b-2 §§2–9 exactly. Files: EDIT `src/shared/ipc.ts`, `src/main/services/storage.ts`, `src/main/ipc.ts`, `src/preload/index.ts`, `src/renderer/src/App.vue`, `src/renderer/src/components/TerminalPane.vue`; CREATE `src/renderer/src/stores/view.ts`, `src/renderer/src/components/FilmstripRenderer.vue` (+ `src/shared/ipc.test.ts` for new schema tests). `src/preload/index.d.ts` needs no manual edit (`ChorusApi` is inferred). Explicitly do NOT touch: `sessionManager.ts`, `restore.ts`, `notifications.ts`, `cliDetect.ts`, `constants.ts`, `main/index.ts`, `db/schema.ts`, `LaunchDialog.vue`, `EmptyState.vue`, `ProjectTabs.vue`, `stores/session.ts`, `stores/project.ts`, `shared/layout.ts`.

Per-file changes (Task-1b-2.md Exact Scope, reproduced):

| File | Change |
|---|---|
| `src/shared/ipc.ts` | Add `ViewGet: 'view:get'` / `ViewSet: 'view:set'` to `IpcChannel`; `viewModeSchema` (`z.enum(['filmstrip','grid'])`); `viewStateSchema` (`{mode, focusedSessionId: z.string().nullable()}`); `viewGetRequestSchema` / `viewSetRequestSchema` (`{project_id: z.uuid()}` [+ `state` on set]). Add `createdAt: z.string()` to `sessionInfoSchema`. |
| `src/main/services/storage.ts` | `getViewState(projectId)` / `setViewState(projectId, state)` — inline Drizzle, key `view_state:<projectId>`, mirroring `getWindowBounds`/`saveWindowBounds` (JSON value, defensive parse → null on corrupt rows). |
| `src/main/ipc.ts` | `view:get` (FK-check; stored state or the filmstrip default `{mode:'filmstrip', focusedSessionId:null}` when absent; outbound `viewStateSchema.parse`) and `view:set` (FK-check; `storage.setViewState`). |
| `src/preload/index.ts` | `getViewState(projectId)` / `setViewState(projectId, state)` forwarders. |
| `src/renderer/src/stores/view.ts` | NEW Pinia store `{mode, focusedSessionId, projectId}`; `loadFor(projectId)`, `setMode`, `setFocused`; each mutation persists a plain snapshot immediately (no debounce needed — writes are low-frequency); flush-old-project-before-switch like `layout.ts::loadLayout`. |
| `src/renderer/src/components/FilmstripRenderer.vue` | NEW. Props `{tree, sessions, focusedSessionId, agentFor}`; emits `focus`, `split`. Focused leaf → one keyed `TerminalPane` (full); other leaves (in `collectSessionIds` order) → compact cards (agent label + title composed per F12b, status dot from the row's status/exitCode, ticking elapsed). Card click → `emit('focus', id)`. No xterm/canvas in cards; writes nothing to the layout store. |
| `src/renderer/src/App.vue` | Import view store + `FilmstripRenderer`; render by mode; toggle control (in App.vue's template, NOT ProjectTabs.vue); `effectiveFocused` computed with total F4 fallback (`findLeaf` else first of `collectSessionIds`, else null); wire `@focus`; `onLaunched` sets the new session focused; load view state under the SAME `loadToken` supersede guard as the layout load. |
| `src/renderer/src/components/TerminalPane.vue` | Extend `defineEmits` with `focus: [sessionId: string]`; emit on `terminal.textarea` focus (listener registered after `terminal.open`, removal pushed into `cleanups`). No other change. |

Key invariants (from ImplementationSpec-1b-2):
- Focus is view state only — no tree mutation on focus; verify `pane_layouts` is byte-identical before/after a focus click.
- The elapsed ticker is ONE shared `setInterval` at 60 s granularity updating a single `now` ref — never per-card or per-second timers.
- Only the focused leaf mounts a `TerminalPane`; the focused pane is `:key`ed by session id (F5 clean remount).
- `focusedSessionId` is schema-validated as nullable string only, never FK-checked (schema validity ≠ liveness).
- Card status comes from `layout:get`'s `sessions[]` rows, NOT the session store (the store keys off attach and cards never attach).
- `view:set` payloads are plain snapshots (D14); `view:get` outbound-parsed in main (D1).
- Judgment call flagged by the spec (§9): grid-mode focus-follow needs a one-line `LayoutRenderer.vue` relay (`@focus` passthrough + emit declaration) — `LayoutRenderer.vue` is NOT in the scope table. Either take the one-line relay (state it loudly in the commit) or route focus only through the filmstrip and leave `LayoutRenderer.vue` untouched. Prefer the minimal path; state which was chosen in the commit message.
- Optional stretch (skip without ceremony if not trivial): a neutral status dot for healed/cwd-missing exited sessions instead of the red error dot; if attempted it must not regress the running/error dots.

### Corrections to the task doc + spec (coordinator-verified 2026-07-19)
1. **The `sqlite3` CLI is NOT installed on this machine.** Wherever Task-1b-2.md or the spec says `sqlite3 "$env:APPDATA\chorus\chorus.db" …`, instead use the established method: a small dump script (require better-sqlite3 by absolute path, open the DB readonly, SELECT and write results TO A FILE — console prints nothing, see §3h) run via `$env:ELECTRON_RUN_AS_NODE=1; & node_modules\electron\dist\electron.exe dump.js`. Write dump scripts into your scratchpad or `_verify/`-style local dir, never committed.
2. The spec's §8 `Promise.all` destructure sketch (`const [{ layout: tree, sessions: rows }] = await Promise.all([...])`) is a sketch — `viewStore.loadFor` resolves void; any shape that runs both under the same token is fine.

## §8 Strict Non-Goals

- No card controls (cards are click-to-focus only); no split/kill/restart on cards; no drag-to-reorder; card order is `collectSessionIds` document order.
- No tree mutation on focus; `FilmstripRenderer` never calls `applyRatio`/`insertLaunchedLeaf`/`removeLeaf`.
- No xterm/canvas/PTY stream in cards; no badges on cards (F10).
- No new npm dependencies; no schema/migration changes (view state lives in `settings`).
- No palette/Ctrl+K work (that is Task 1b-3).
- Do not revert, stage, or commit unrelated or untracked files — including `_verify/` and anything under `docs/`.

## §9 Required Workflow

1. Ground per §4.
2. Implement in the spec's order: shared schemas → storage accessors → main handlers → preload forwarders → view store → `FilmstripRenderer.vue` → `App.vue` wiring → `TerminalPane` focus emit. Run `npm run typecheck` after the main-side work before touching the renderer.
3. Self-review the diff against CLAUDE.md, D1/D4/D14/D20, F4/F5/F10/F12, and the Task-1b-2.md Review Checklist.
4. Run verification (§10).
5. ONE intentional commit, style of repo commit `80e69c3` (plain-English paragraph, then "Technical notes:" bullets); state in the message which grid-focus-follow path was chosen (§7); verify `git config user.email` = `mwilson29072@gmail.com`; end with a `Co-Authored-By:` line crediting yourself per repo format; do not push, do not open a PR, do not amend or rebase existing commits.

## §10 Verification Commands

```powershell
npm run typecheck   # zero errors (G1)
npx vitest run      # green — 60 existing + new: viewStateSchema accept/reject, viewSetRequestSchema, sessionInfoSchema createdAt, resolveFocused-style fallback if factored pure
npm run dev         # or the direct electron-vite invocation from §3f when CDP is needed
```

New unit tests (in `src/shared/ipc.test.ts`): `viewStateSchema` accepts `{mode:'filmstrip', focusedSessionId:null}` and `{mode:'grid', focusedSessionId:'<id>'}`; rejects an unknown mode and a missing `focusedSessionId` key. `viewSetRequestSchema` requires a uuid `project_id` and a valid `state`. `sessionInfoSchema` now requires `createdAt`. If the `effectiveFocused` core is factored into a pure helper (e.g. `resolveFocused(tree, wanted)`), unit-test: valid id passes through, stale id → first leaf, null tree → null.

**RUN the app, don't just compile (G2).** Runtime script, numbered, each with its exact observable (use a project with ≥2 sessions; screenshot each step):
1. Boot on the existing dev DB → the app opens in the FILMSTRIP (no `view_state` row exists — the default). One full focused pane + cards for the rest.
2. Read a card: agent label + title (composed per F12b), status dot, elapsed. Wait a minute → elapsed ticks up once (not every second).
3. Click a card → that session becomes the focused full pane; the previous one becomes a card. Dump `pane_layouts` before/after (§7 correction 1 method) → byte-identical.
4. Refocus back → the first session's TUI shows CONTINUED output produced while it was a card (PTY kept running in main — F5 proof).
5. Toggle Grid view → `LayoutRenderer` renders the same tree; toggle back → filmstrip. Restart the app (tree-kill + port rebind per §3e) → last mode + focus restored; DB dump shows the `view_state:<id>` row.
6. From the focused pane, Split → launch → the NEW session is focused. Close the focused pane → focus lands on the first remaining leaf; no crash.
7. Stale focus: hand-edit the `view_state:<id>` row's `focusedSessionId` to a bogus id (dump-script UPDATE variant), boot → first leaf focused, no crash (F4).
8. A card NEVER shows the "Session restarted — new conversation" badge; only the focused pane can (F10).
9. Multi-project: set project A to grid, project B to filmstrip; switch tabs back and forth → each restores its own mode/focus; no cross-project state bleed (the store flushed the old project on switch).
10. D14 console check: renderer devtools console across the flow — zero `An object could not be cloned`.

## §11 Failure Honesty Clause

Capture exact output on any failure, explain it, report it; never claim success not directly observed. Specifically may NOT be reported as success: a filmstrip default you did not see on a DB with no `view_state` row; a focus click whose `pane_layouts` byte-identity you did not dump; continued-output (F5) you did not observe; a per-second elapsed re-render (that is a FAIL); a persistence claim without the restart actually performed (tree-kill + port rebind — a surviving old window is NOT a fresh boot); a stale-focus boot you did not actually force. If a verification command fails for an unrelated environment reason, capture the exact output, explain it, and do not claim success.

## §12 Final Reporting Requirements

Detailed summary for coordinator review:
- **Status:** DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED.
- **Grid-focus-follow decision (§7):** which path was taken (one-line LayoutRenderer relay vs filmstrip-only) and why.
- **Stretch report:** neutral dot attempted/landed/skipped.
- **Files changed** — one-line rationale each; anything beyond §7's list flagged loudly with justification.
- **Deviations** from ImplementationSpec-1b-2, with why — including confirmation the §7 sqlite3 correction was used.
- **Verification transcript:** typecheck; vitest with new test names and count; runtime items 1–10 individually with what was actually observed (screenshots referenced); the DB dumps for default/persistence/byte-identity.
- **Acceptance criteria** from Task-1b-2.md restated pass/fail.
- **Non-goals confirmation** — each §8 item untouched.
- **Residual risks / notes for Task 1b-3's implementer** — especially anything learned about focus/view-state behavior the palette's "focus pane" and "toggle view" commands will ride.
- **Final git output** fenced:
  ```
  git status --porcelain
  git log --oneline -2
  ```

# Chorus v1 — Master Roadmap (Foundation)

_Location: `docs/Features/Foundation/roadmap.md` · Last updated: 2026-07-20_

---

## 1. Purpose

Chorus v1 is a local-first, BYOK Electron + Vue 3 + TypeScript desktop app (Windows-only) for running multiple AI coding agents in parallel terminal panes. The **prime contract**: a developer can launch, watch, control, and persist many concurrent agent sessions across multiple projects — restart-safe and cleanly killable — from a single window.

This roadmap refines **`docs/PLAN.md` §14** into an executable, phase-by-phase program of work. It is the single master roadmap for the whole v1 effort. It records **what** each phase delivers and **why** — not how (implementation detail lives in Task docs and Implementation Specs).

---

## 2. Source Of Truth

| Authority | Owns |
|---|---|
| `docs/PLAN.md` (master plan v2.1) | Product vision, full architecture, macro-phase intent |
| `CLAUDE.md` | Non-negotiable, locked architecture rules |
| **This roadmap** | Phase status, decision log, verified ground facts |
| Workflow skills (`/architect`, `/phase-kickoff`, `/phase-prompt`) | The operating rhythm that keeps the three above in sync (see §3) |

When these disagree, PLAN.md and CLAUDE.md win on intent and rules; this roadmap wins on _current status_ and _what happens next_.

---

## 3. Governance & Workflow

Chorus is built on a repeating rhythm. One phase at a time, in the order below.

1. **`/architect`** — after each phase lands, updates this roadmap: marks the phase complete, re-verifies ground facts against the code, revises provisional phases, appends decisions.
2. **`/phase-kickoff`** — decomposes the next phase into `Phase-N-Overview.md` plus 1–5 paired `Task-N-#.md` + `ImplementationSpec-N-#.md` files under this Foundation folder (`Tasks/` and `ImplementationSpecs/`).
3. **`/phase-prompt`** — generates a verbose, self-contained execution prompt to open a fresh conversation for the phase.
4. **Execution session** — implements the tasks, **verifies by running the real app** (not just compiling), and makes **one intentional narrated commit**.
5. **Back to `/architect`** — the loop closes; the roadmap re-syncs to reality.

Council Review (§4) can interrupt steps 2 and 4 whenever a section meets its trigger criteria.

---

## 4. Council Review (CR) Mechanism

Matthew runs a **multi-LLM council** — a Cursor-based setup that uses several other LLM models for independent review and deliberation. **Claude cannot run the council.** Claude's obligations around it are:

1. **Flag** when a section meets CR trigger criteria — at kickoff time or mid-phase.
2. **Prepare a council brief**: the specific decision / design / diff in question, the development goals and acceptance criteria it must satisfy, and the specific questions Claude wants answered.
3. **Pause** and prompt Matthew to run the council. Do not proceed past the checkpoint.
4. **Record findings** in the §6 decision log — unanimous agreement, dissents, and action items — before continuing.

**Trigger criteria for a "tough section":**

- Hard-to-reverse architectural shapes — adapter interface, DB schema growth, event bus design.
- Security-sensitive surfaces — credential vault, secret injection/redaction, localhost hook listener, permission broker.
- Data-loss surfaces — worktree lifecycle, destructive git operations.
- Anything an execution session flags as **low-confidence**, or where **two approaches remain contested**.

Phases marked **[CR]** below carry at least one pre-identified council checkpoint.

---

## 5. Verified Ground Facts

Re-verified **2026-07-20** against the codebase at commit `de98679` (Task 1b-2 + TerminalPane mid-attach fix landed; working tree carries only untracked `_verify/` harness artifacts and the coordinator's `Tasks/Task-1b-2-ExecutionPrompt.md`). Facts carried forward unchanged from earlier keep their prior dates; anything re-read today is dated 2026-07-20.

### Status & toolchain

| Fact | Where | Verified |
|---|---|---|
| Phase 0 complete through `f0d409b`. Trail: `80e69c3` (0.2 single Claude Code terminal), `45c5b2b` (0.3 two agents side-by-side + CLI detection), `f0d409b` (0.4 SQLite persistence + exit notifications), `ae4eba4` (docs). | git log | 2026-07-18 |
| **Phase 1.1 landed** as `185f972` (Tailwind + per-pane lifecycle controls). **1.2** as `81e8a0b` (Drizzle, stable session ids, layout tree, Vitest). **1.3** as `e7d6e60` (LayoutRenderer over the split tree, debounced PTY resize, close-kills-pane). **1.4** as `c91aea1` (launch dialog + true multi-session). **1.5** as `fb384c5` (project tabs + D16 restore — the phase closer). All five reviewed; reviews produced D10–D17 and findings F2–F11. | git log | 2026-07-19 |
| **Phase 1b in progress:** **1b-1** landed as `a00af48` (auto-titling, migration v3, D18 empirically resolved). **1b-2** landed as `3a28ec2` (filmstrip default view, D20 implemented), follow-up `de98679` (TerminalPane mid-attach unmount guard + empty-title persist guard). | git log | 2026-07-20 |
| **`npm run typecheck` exits 0** (node + web). **`npx vitest run` = 70/70 green** across **5 files** (the four prior — `src/shared/layout.test.ts`, `src/shared/ipc.test.ts`, `src/main/services/restore.test.ts`, `src/renderer/src/stores/layout.test.ts` — plus new `src/renderer/src/stores/view.test.ts`) — **+10 vs 1b-1**: view-state schema accept/reject cases, `view:get`/`view:set` request schemas, `sessionInfoSchema` `createdAt`+`exitCode` requirement, and 5 pure `resolveFocused` F4-fallback cases. **`grep -ri respawn src/` is empty.** | run today; re-verified at `de98679` | 2026-07-20 |
| Deps: electron `43.1.1`, vue `3.5.25`, pinia `4.0.2`, vite `7.2.6`, vitest `4.1.10`, zod `4.4.3`, drizzle-orm `0.45.2` + drizzle-kit `0.31.10`, tailwindcss + `@tailwindcss/vite` `4.3.3`, `@xterm/xterm` `6.0.0` + addon-fit `0.11.0`, better-sqlite3 `12.11.1`, node-pty `1.1.0`, **`splitpanes` `~4.1.2`** (installed by 1-3 on the spike GO). | `package.json` | 2026-07-19 |
| Scripts: `dev`, `start`, `build`, `typecheck` (`:node` + `:web`), `test` (`vitest run`), `rebuild:better-sqlite3`. | `package.json` | 2026-07-19 |
| better-sqlite3 **12.11.1** — no electron-v148 (Electron 43) prebuild on npm; MSVC 17.14 ICEs (`C1001`, `sqlite3.c`) at `/O2`. `.npmrc` pins `runtime=electron`; `npm run rebuild:better-sqlite3` builds with `/Od`. **Drop both when ≥12.11.2 reaches npm.** Note: the 1-2 dependency install needed **no** rebuild (no ABI error surfaced). | `.npmrc`, package scripts | 2026-07-19 |
| node-pty **1.1.0** — in-package N-API prebuilds; **no electron-rebuild ever** (broken on Windows). | package | 2026-07-18 |
| Dev-machine CLIs — `claude.exe` **2.1.215** (native exe; currently **unauthenticated** — now surfaces as "token has expired. Re-authenticate to continue." after in-TUI retry exhaustion, observed 2026-07-19 during 1b-2 verification; still blocks any harness test needing a real agent reply, irrelevant to view-state work), `codex-cli` **0.144.6** (npm `.cmd` shim, spawned via `cmd.exe /c`), git 2.50.0, docker 28.0.4, node 22.14.0. | dev machine | 2026-07-20 |

### Main process

| Fact | Where | Verified |
|---|---|---|
| `SessionManager` — `Map<string, PtySession>` keyed by **stable DB session row id**; N concurrent same-kind sessions. Public: `bindStorage`, `launch(agent, cwd, sessionId)` (spawn under a caller-minted row id), **`attach(sessionId)` — single-argument pure view binding, NO spawn path** (returns `SessionSnapshot \| null`), **`restore(projectId)`** (the D16 engine: `computeRestoreSet` → heal-first → cwd-validated staggered spawns, `running` written after success, cap 16), `isRunning`, `isRestorePending`, `consumeRestoredBadge` (F10 consume-once), `onRestored`, `kill`, `write`, `resize`, `getAgent`, `onData`/`onExit` (listener Sets), `dispose`. `restore()` is the **one documented place** the manager touches storage (heal + post-spawn status writes are contract steps); rows are otherwise minted by the IPC layer. | `src/main/services/sessionManager.ts`, `src/main/services/restore.ts` | 2026-07-19 |
| **`computeRestoreSet(layout, rows, live)`** — pure, Electron-free, structurally-typed module returning `{toRelaunch, toHeal, missingRows}`; 6 unit tests cover all four populations + failed-spawn orphan + already-live. | `src/main/services/restore.ts` | 2026-07-19 |
| IPC — **20 channels**: invokes `session:attach` / `launch` / `launch-context` / `write` / `resize` / `kill` / **`restart`** / **`delete`** / **`set-title`**, `cli:detect`, `layout:get` / `set`, **`view:get`** / **`view:set`**, **`project:add`** (main-side `dialog.showOpenDialog`; cancel = structured no-op) / **`project:list`** / **`project:select`** (persists active id, lazy-restores idempotently, retitles window); events `session:data` / `exit` / **`restored`**. All Zod in **main only**; every project-scoped handler parses `project_id` (`z.uuid()`) and FK-checks it via `requireProject`. `session:launch` keeps the cwd security boundary + 16-pane soft cap; `layout:set` payload is `{project_id, layout: nullable}` — null DELETEs the row. **`view:get`** FK-checks `project_id` and returns the stored per-project view state or the filmstrip default `{mode:'filmstrip', focusedSessionId:null}` when no row exists, outbound-parsed with `viewStateSchema`; **`view:set`** FK-checks and persists. `focusedSessionId` is schema-validated as **nullable string only, never FK-checked** (F4). `session:restart` refuses live sessions, re-validates cwd, spawns under the same row id; `session:delete` refuses live sessions (invoke **rejection**, not a value — callers must await-catch). **`session:set-title`** (`setTitleRequestSchema` = `{sessionId: z.uuid(), title: z.string().min(1).max(120)}`) sanitizes via exported `sanitizeTitle` (strips C0+DEL), re-bounds to 120, silently no-ops on empty post-sanitize, logs `[title] persisted …` per write. **`sessionInfoSchema` grew `createdAt` (ISO string) AND `exitCode` (int nullable) in 1b-2** so filmstrip cards can compute elapsed and color their status dot from the `layout:get` rows alone (cards never attach) — the `exitCode` addition was a **flagged, ratified deviation** from the task's scope table (the spec's card-dot mapping required it; zero handler changes, the existing outbound parse surfaces both from `SessionRow`). | `src/shared/ipc.ts`, `src/main/ipc.ts` | 2026-07-20 |
| Preload is a **Zod-free typed forwarder**; page CSP forbids Zod's `eval`. Surface: `attachSession`, `launch`, `getLaunchContext(projectId)`, `restartSession`, `deleteSession`, **`setSessionTitle(sessionId, title)`**, `detectClis`, `getLayout(projectId)`, `setLayout`, **`getViewState(projectId)`**, **`setViewState(projectId, state)`**, `addProject`, `listProjects`, `selectProject`, `writeSession`, `resizeSession`, `killSession`, `onSessionData`, `onSessionExit`, `onSessionRestored`. `ChorusApi` is inferred from the object. | `src/preload/index.ts` | 2026-07-20 |
| Storage — better-sqlite3 (WAL) at `userData/chorus.db`; **Drizzle for typed queries only**, migrations stay a hand-rolled `MIGRATIONS` array + `schema_migrations` runner (deliberate scope cut under D7). Applied versions: **1, 2, 3** (v3 = `ALTER TABLE sessions ADD COLUMN title TEXT;`, applied in place on the dev DB at 2026-07-19T23:47Z, existing rows back-filled NULL). Tables `projects` / `pane_layouts` / `settings` / `schema_migrations` / `sessions`. | `src/main/services/storage.ts`, `src/main/db/schema.ts` | 2026-07-19 |
| `sessions` table — `id` TEXT PK (stable UUID), `project_id` FK, `agent`, `cwd`, `status`, `exit_code`, `created_at`, **`title` TEXT (nullable)**. | `src/main/db/schema.ts` | 2026-07-19 |
| `StorageService` API — `getOrCreateProject` (seeds nothing: project row only), **`listProjects`**, **`getProjectById`**, **`getActiveProjectId`/`setActiveProjectId`** (settings key `active_project_id`), `getPaneLayout(projectId): LayoutJson \| null`, `savePaneLayout`, `clearPaneLayout`, **`getViewState(projectId): ViewState \| null`** / **`setViewState(projectId, state)`** (inline-Drizzle settings pair, key `view_state:<projectId>`, defensive JSON parse — corrupt/hand-edited rows return null so the filmstrip default applies, mirroring the `getWindowBounds` pattern per D15(5)), `getRecentCwds`/`pushRecentCwd`, `createSession` (null-coalesces `title` into the returned row), `getSessionsForProject`, **`getSessionById`**, **`deleteSession`**, `updateSessionStatus`, **`updateSessionTitle(id, title)`**, `getWindowBounds`/`saveWindowBounds`, `close`. | `src/main/services/storage.ts` | 2026-07-20 |
| **Session status lifecycle (D11 + D16):** the `onExit` listener in `src/main/index.ts` writes `exited` + real code; the restore engine heals leafless/beyond-cap/cwd-missing rows to `exited` and writes `running` only **after** spawn success; `session:restart` does the same. Quit/crash write nothing at teardown — the boot reconcile resolves whatever the DB holds. F6 stands as the *reason* for the reconcile: persisted `running` means *"was running when last observed"*, never "is alive". | `src/main/index.ts`, `src/main/services/sessionManager.ts` | 2026-07-19 |
| **Boot sequence** (`src/main/index.ts`): storage init → active project = persisted setting if still valid, else `getOrCreateProject(DEV_WORKING_DIR)` (**first-run seed only**) → `registerIpc(sessions, storage)` (no project closure) → exit listener → `restore(activeId)` → `createWindow` → title = active project name. | `src/main/index.ts` | 2026-07-19 |
| Notifications — exit toast wired with show/failed logging. Windows delivery **verified blocked** on the dev machine by system-wide `ToastEnabled=0` (HRESULT `0x803E0114`). Dev AUMID Start-menu shortcut `Chorus (Dev).lnk` written idempotently. | `src/main/services/notifications.ts` | 2026-07-18 |
| Window-bounds persistence fires **only on interactive drag** (`'resized'`/`'moved'`). Programmatic resize and maximize are **not** persisted. | main window mgmt | 2026-07-18 |

### Shared & renderer

| Fact | Where | Verified |
|---|---|---|
| `src/shared/layout.ts` is a **pure, immutable, no-op-on-invalid** module: `clampRatio`, `createLeaf`, `splitPane`, `removePane`, `setRatio`, `changeDirection`, `swapPanes`, `collectSessionIds`, `findLeaf`, `normalizeTree`, `convertLegacyFlatLayout`. Tree invariants at every boundary: exactly 2 children per internal node, ratios ∈ [0.05, 0.95], no duplicate `sessionId`s, ≥1 leaf, `version: 1`. | `src/shared/layout.ts`, `layout.test.ts` | 2026-07-19 |
| `layout:get` returns `{layout, sessions: [{id, agent, status, title, createdAt, exitCode}]}`; `layoutJsonSchema` / `layoutNodeSchema` (recursive via `z.lazy`) exported from shared, parsed in main. `title` is **required-nullable** (`z.string().nullable()`, not `.optional()`) on **both** `sessionInfoSchema` and `attachResponseSchema` — rippled at compile time into the launch/restart handlers (both embed `attachResponseSchema`, spread `title: row.title`) and into `App.vue`'s `onLaunched` cache entry. Legacy flat-array schemas retained for conversion. | `src/shared/ipc.ts` | 2026-07-20 |
| `App.vue` — renders `ProjectTabs` above the layout; a **single watcher on `activeId`** now runs `getLayout` **and `viewStore.loadFor(id)` under the same supersede token** (a slow response for a stale project never lands); computes **`effectiveFocused` via the pure `resolveFocused(tree, wanted)`** (stale/null focus falls back to the first leaf in tree order, F4-total); renders **`FilmstripRenderer` vs `LayoutRenderer` by `viewStore.mode`**; **hosts the filmstrip⇄grid toggle in its own template** (`ProjectTabs` untouched); `onLaunched` **focuses the new session**; hosts `LaunchDialog` (which threads `projectId` through `launch` + `launch-context`). | `src/renderer/src/App.vue` | 2026-07-20 |
| **Projects UI** — `ProjectTabs.vue` (tabs + "+ Add Project"; no rename/delete controls, deferred 1b+) and `stores/project.ts` (list/add/select; active id derived from main's persisted setting). | `src/renderer/src` | 2026-07-19 |
| `LayoutRenderer.vue` — recursive; props `{node, path: (0\|1)[], agentFor}`. Internal nodes render splitpanes; leaves mount `TerminalPane`; a leaf with a missing session row renders a placeholder that holds the geometry. `@resize` reads `payload.panes[0].size / 100` (real v4 API — **not** the old spec sketch's `sizes[]`), rAF-batched into `applyRatio`. splitpanes owns no layout state. | `src/renderer/src/components/LayoutRenderer.vue` | 2026-07-19 |
| **`stores/view.ts` + `FilmstripRenderer.vue` (1b-2):** Pinia view store `{mode, focusedSessionId, projectId}` — `loadFor` (store-level supersede guard `loadSeq` **beyond** the App token, because the App token cannot cancel a store-internal await), `setMode`/`setFocused` **persist immediately as plain snapshots** (D14; **no debounce** — writes are low-frequency, contrast `layout.ts`); **flush-old-project-before-switch mirrors `layout.ts`**. Exports pure **`resolveFocused`** (unit-tested). `FilmstripRenderer.vue` consumes the spike contract `{tree, sessions, focusedSessionId, agentFor}` + emits focus/split; **focused `TerminalPane` keyed by session id** (F5 clean remount); other leaves render as **cards in `collectSessionIds` order** (agent label + persisted title composed per F12b, status dot from row `status`+`exitCode`, elapsed from **ONE shared 60 s interval** — runtime-verified ticking exactly once/minute); cards are **plain flexbox, no xterm/canvas/badge, zero layout-store writes**; verified byte-identical `pane_layouts` across focus clicks. | `src/renderer/src/stores/view.ts`, `src/renderer/src/components/FilmstripRenderer.vue` | 2026-07-20 |
| `stores/layout.ts` — `{tree, dirty}`; `loadLayout(layout)` takes the tree as a **parameter**; `applyRatio`; `removeLeaf` (last-leaf removal now **sets `tree = null` and persists null** → row deleted); `insertLaunchedLeaf` (root on empty, or `splitPane` at a target); `schedulePersist()` debounces 500 ms and sends a plain JSON snapshot (D14). | `src/renderer/src/stores/layout.ts` | 2026-07-19 |
| `TerminalPane.vue` — props `{sessionId, agent}`; attach is view-only; **Restart = kill → awaited exit → `restartSession()`** (one path in-run and post-restart); **✕ close = kill → awaited exit → leaf removed → `deleteSession()`**; restore chrome rides **attach-response flags** (`restorePending` spinner, consume-once badge, `cwdMissing` overlay) — designed for reuse by 1b's filmstrip/palette rather than re-derivation. **Title**: `title` ref; OSC capture via `terminal.onTitleChange` (disposable into `cleanups`, F5-safe); first-typed-line fallback folded into the one existing `onData` listener (fires only while title null, never overwrites OSC); 500 ms **trailing** debounce (`titleTimer` cleared in `onBeforeUnmount`); attach seeds `title` from `attach.title` only while local title null (remount can't clobber a live OSC title); header renders the title next to the agent label with `max-w-[16rem] truncate` + `:title` tooltip. xterm scrollback 5 000, continuous `fit()` + 150 ms-debounced resize. **1b-2 added** a `focus` emit on the xterm textarea's focus event (listener registered after `terminal.open`, removal in `cleanups`). **`de98679` added** (a) an `onMounted` **bail-out right after `await attachToSession()`** when the component unmounted mid-attach (`terminal === null`) — previously the continuation threw `null.onTitleChange` and **leaked the three `window.chorus` listeners** registered after the await, and the leaked `onSessionRestored` handler could re-attach a dead pane and consume the F10 consume-once badge; verified clean under a 40-swap filmstrip remount storm; (b) **`persistTitle` early-returns on empty/whitespace titles** (OSC title-clear previously fired a `session:set-title` that main's `min(1)` schema rejected as an unhandled rejection) — the renderer header still tracks a live `''` title; only the doomed persist is skipped. | `src/renderer/src/components/TerminalPane.vue` | 2026-07-20 |
| **Session store rekeyed (D10 closed):** `Record<string /* sessionId */, PaneSessionState>`, entries created on attach/launch (never pre-seeded), `agent` is a data field, all actions take a `sessionId`. `TerminalPane` reads agent only for labels — never as a key. **Entries are never removed** when a leaf closes (lingers per app run; harmless at Phase-1 scale — restore must key off tree + rows, not the store). | `src/renderer/src/stores/session.ts` | 2026-07-19 |
| Renderer components: `LayoutRenderer.vue`, `FilmstripRenderer.vue`, `TerminalPane.vue`, `LaunchDialog.vue`, `EmptyState.vue`, `ProjectTabs.vue`. Stores: `layout.ts` (persists `{project_id, layout}` plain snapshots, **flushes a pending debounce to the old project on tab switch**), `view.ts`, `project.ts`, `session.ts` (untouched by 1-5 — badge/spinner state is per-pane local). | `src/renderer/src` | 2026-07-20 |
| **(F5, resolved at the root in 1-5)** Vue remounts surviving panes when a sibling leaf closes, so attach re-runs on remount. Attach is a **view binding, not a lifecycle hook** — and since 1-5, `attach()` has **no spawn path at all**, so the hazard class is structurally gone. **(F10)** corollary from 1-5: boot-transient chrome must be **consume-once state, not clock comparisons** — dev cold-start mounts exceeded 20 s, outlasting any fixed recency window; the restored badge is a `restoredUnbadged` set consumed by first attach. Binding on 1b's activity dots / unread markers. | renderer + `sessionManager.ts` | 2026-07-19 |
| **(F4, resolved by D16; residual updated 1b-2)** Row/leaf drift is reconciled: the boot/activation heal pass covers `running`-without-leaf; pane close now **deletes** the row (accumulation stopped); `LayoutRenderer`'s placeholder covers leaf-without-row. **1b-2's optional neutral-dot stretch was SKIPPED** (cards would need per-row `cwdMissing` over IPC and cards never attach); healed/cwd-missing exited rows still render the red *error* dot. Residual stands for a later phase. `project:select`'s reconcile read is unbounded if historical rows ever grow large (index/status-filter when that day comes). | storage + renderer | 2026-07-20 |
| **Harness caveats (F3/F7/F8/F9/F11):** `TaskStop` kills only the wrapper shell — kill the process **tree** (`taskkill /PID <root> /T /F`) + confirm CDP port rebind, or the "fresh boot" is the old window; a **graceful** quit test is `taskkill /PID <electron-main-pid>` *without* `/F` (delivers WM_CLOSE → `before-quit` → `dispose()`). `ComSpec` + registry PATH must be restored. `npx`/`npm run` prepend the npm-global dir to child PATH — invoke `node node_modules/electron-vite/bin/electron-vite.js dev -- --remote-debugging-port=9222` directly. electron-vite HMR covers the renderer only. Orphan checks walk the electron main PID's descendant tree, never grep `tasklist` (~16 unrelated `claude.exe` on this machine). `window.confirm` blocks the renderer thread — fire CDP clicks async, dismiss with a real mouse click. **Screenshots: `PrintWindow(hwnd, PW_RENDERFULLCONTENT)`, never `CopyFromScreen`** (captures occluders). Native `#32770` dialogs: drive via `FindWindowEx` + `WM_SETTEXT` + `BM_CLICK` (SendKeys/foreground-lock is unreliable). Output-continuation assertions must match **response-only strings**, never text echoed from the prompt. **CDP on `--remote-debugging-port=9222` beat the user32 helper** (1b-1): `Runtime.evaluate` for DOM assertions (wrap in an IIFE — top-level `const` collides across evaluates), `Page.captureScreenshot` (no window-coordinate issues), `Input.insertText` reaches xterm `onData` as one chunk; `ws` installed in the session scratchpad, never the repo. `ELECTRON_RUN_AS_NODE=1` scripts print nothing to a PowerShell console (electron.exe is GUI-subsystem) — write results to a file. | execution sessions | 2026-07-19 |
| **(F12) Title behavior binds 1b-2's filmstrip cards.** (a) Claude Code's OSC title is **live and twitchy** (~1 Hz spinner while the agent works) — cards reading titles will flicker during activity unless they render the **persisted** value or debounce re-renders. (b) Codex titles are just the **cwd basename**, so same-project Codex sessions title identically — cards must compose **agent + title**, not title alone, to disambiguate. (c) The renderer header shows the **pre-sanitize** value until the next attach; anything reading over IPC always gets the **sanitized** value. Verified at `a00af48`. | `TerminalPane.vue` + 1b-1 runtime observation | 2026-07-19 |
| **(F13, found + fixed in 1b-2 `de98679`) Async `onMounted` continuations must bail after every `await` when the component may have unmounted** — Vue runs the continuation regardless; `cleanups` arrays are consumed exactly once, so post-cleanup registrations leak for the app lifetime. Found via the 1b-2 renderer error hook (two `null.onTitleChange` TypeErrors), root-caused as **pre-existing 1b-1 exposure amplified by 1b-2's keyed focus-swap remounts (F5)**, fixed in `de98679`. Binds any future component with awaits in `onMounted` (palette, worktree UI). **Corollary — grid mode does NOT track focus:** the minimal grid-focus-follow path was taken (`LayoutRenderer` untouched; `TerminalPane`'s focus emit is only consumed via `FilmstripRenderer`). If 1b-3's palette "focus pane" command wants grid tracking, it needs the small `LayoutRenderer` relay. Also: `App.vue`'s `sessions[]` refreshes **only on project load**, so card title/status can lag until the next tab switch (deliberate under F12a); and the dev DB now holds `view_state:` rows plus a second project `Chorus-Second` (id `f47ac10b-…`) inserted during verification — **legitimate artifacts, do not clean up**. | `TerminalPane.vue` + 1b-2 runtime observation | 2026-07-20 |

---

## 6. Global Decisions & Gates

### Decisions

All **RESOLVED 2026-07-18** unless noted.

| ID | Decision | Status |
|---|---|---|
| D1 | All Zod validation lives in **main only** — CSP forbids `eval` in preload. | RESOLVED |
| D2 | **No electron-rebuild.** node-pty uses shipped prebuilds; better-sqlite3 via `.npmrc` electron runtime + `/Od` source build (temporary — see §5). | RESOLVED |
| D3 | Sessions live in **main**, owned by `SessionManager`; the renderer never spawns processes. | RESOLVED (CLAUDE.md, locked) |
| D4 | Verify CLI flags against the tool's own `--help` at build time — never from training memory. | RESOLVED (CLAUDE.md, locked) |
| D5 | Child PTYs inherit env untouched; no credentials injected/logged anywhere. **Will be superseded by the Phase 3 vault work.** | RESOLVED |
| D6 | Council Review runs in Cursor by Matthew; Claude flags, briefs, pauses, and records findings (§4). | RESOLVED |
| D7 | **Adopt Drizzle ORM now** — Phase 1 migrates the existing 4 tables' access code to Drizzle and defines all new Phase-1 schema in it. (Matthew's call at Phase 1 kickoff, against the deferral recommendation — typed queries from day one won.) | RESOLVED 2026-07-18 |
| D8 | **Adopt Tailwind CSS at sub-phase 1.1** — first real UI mass; existing scoped styles migrate as touched. | RESOLVED 2026-07-18 |
| D9 | Pane layout engine (CR-1.2): **Option C — owned binary split tree as persisted data model; splitpanes@~4.1.2 as dumb grid renderer behind a `LayoutRenderer.vue` adapter.** Council verdict unanimous 3-of-3 (Claude, Gemini, GPT); Gemini dissent-on-preference for full custom (B) recorded, conceded on implementation risk. **Escape hatch: if the xterm-in-splitpanes spike (timeboxed, go/no-go) fails, fall back to B — the tree model carries over unchanged.** Serialized schema: versioned binary tree, leaves bind `sessionId`, ratios clamped [0.05, 0.95], invariants Zod-enforced in main per D1. PTY resize: continuous `fit()`, debounced `pty.resize` (150 ms / drag-end). Brief: `CouncilBriefs/CouncilBrief-1.2-LayoutEngine.md` · Findings: `docs/architecture/CR-1.2-pane-layout-council-findings.md`. splitpanes 4.1.2 existence/recency verified on npm 2026-07-18. **Spike result (Task 1-3, 2026-07-19): GO** — xterm-in-splitpanes passed all 12 checks at window widths 1024/1440/2560: canvases paint, splitter/canvas layer cleanly (screenshotted), ResizeObserver on our pane containers fires mid-drag (21 callbacks sampled with the mouse button still held; ~7 `@resize` emits per drag), `fit()` yields plausible cols/rows (e.g. 1200 px → 144 cols, 861 px → 53 rows). v4.1.2 API verified from shipped typings/source (D4): `@resize` payload is `{event, index, prevPane, nextPane, panes: [{min,max,size}]}` fired per frame during drag, `resized` fires at drag-end — ratio write-back reads `panes[0].size / 100`, NOT the spec sketch's `sizes[]`. splitpanes@~4.1.2 installed. | RESOLVED 2026-07-18 (council, unanimous) |

**Decisions from the Task 1-2 completion review** (`Tasks/Task-1-2-CompletionSummary.md`), ratified 2026-07-19:

| ID | Decision | Status |
|---|---|---|
| D10 | **Session store rekey (`AgentKind` → `sessionId`) belongs to Task 1-4, as its first step.** Task 1-3 leaves the store per-kind and keys only *pane components* by `sessionId` — with one session per kind the agent-keying is still correct, and rekeying inside a layout task is unverifiable until multi-session exists. Task 1-4 cannot skip it: two Codex sessions sharing one `sessions['codex']` slot would break the task's own headline criterion. Task-1-4.md amended 2026-07-19 (its "Initial Starting Point" had wrongly claimed the rekey was already done). | RESOLVED 2026-07-19 |
| D11 | **`storage.updateSessionStatus` is wired in Task 1-4**, at `watchSessionExits` in `src/main/index.ts` — persisted status only becomes meaningful once 1-4/1-5 restore sessions on boot. Task 1-3 confirmed the symptom (F4: closed panes leave rows stuck at `status='running'`). **Action closed 2026-07-19** — `src/main/index.ts` admitted to Task-1-4.md's scope table for this single purpose, with a step and an acceptance criterion. | RESOLVED 2026-07-19 |
| D12 | **Session rows are born `status='running'` before any PTY attaches.** Accepted as informational until D11 lands; no schema change. Nothing reads `sessions[].status` today. | RESOLVED 2026-07-19 |
| D14 | **Renderer→main IPC payloads must be plain objects.** Pinia state is a Vue reactive Proxy and Electron's structured clone refuses it — `Error: An object could not be cloned`, with **no compile-time signal**. Found at runtime in Task 1-3 (`setLayout(this.tree)`); fixed by sending `JSON.parse(JSON.stringify(tree))` from the store's persist path. Binds every task from here on: anything sourced from a store or `reactive()`/`ref()` gets snapshotted before crossing the bridge. **Promoted into `CLAUDE.md` 2026-07-19** (Matthew's approval at the 1-4 review). | RESOLVED 2026-07-19 |
| D13 | **`getPaneLayout` normalization is read-path, in-memory only** — a corrupted-but-parseable tree self-heals on the first `savePaneLayout`, not on read. Accepted: silent write-back on read would muddy the lazy-conversion semantics. | RESOLVED 2026-07-19 |

Also ratified from that review, no ID needed: `z.uuid()` over the Zod-4-deprecated `z.string().uuid()`; `layout:get` responses parsed outbound in main as well as inbound; first-run seeding of two default panes stands until Task 1-4 switches it to an empty layout (already carried in Task-1-4.md).

**Decision from the Task 1-4 completion review** (`Tasks/Task-1-4-CompletionSummary.md`), ratified 2026-07-19:

| ID | Decision | Status |
|---|---|---|
| D15 | **Task 1-4's five deviations ratified as the session-lifecycle contract.** (1) `attach` carries an optional **`respawn` flag** — plain view attach *never* spawns (F5 makes attach re-run on sibling-close remounts; an ungated attach resurrected killed sessions); only the Restart chrome sends `respawn: true`, after kill + awaited exit. (2) On a respawn attach, main flips the row to `running`/null — D11 in both directions. (3) An attach for a manager-unknown id reports `status: 'exited'` **even if the persisted row says `running`** — the row supplies only the exit code; the manager's map is the sole liveness authority within a run (F6). (4) Recent-cwds + project root travel over a dedicated `session:launch-context` channel. (5) Settings stay inline-Drizzle per key (`getWindowBounds` pattern); no generic get/setSetting pair. **Post-restart Restart is deliberately a no-op** (`respawn` on an unknown id spawns nothing) — whether that button relaunches after restart is 1-5's restore-contract decision; the `respawn` gate is the seam. **⚠ Items (1)–(2) superseded by D16 (CR-1.5 Q4, 2026-07-19):** the `respawn` flag is removed in Task 1-5; *all* respawn routes through the launch path gated on an existing row, and `attach` becomes a pure view binding with no spawn path at all. Items (3)–(5) stand. | RESOLVED 2026-07-19 · partially superseded by D16 |

**Decision from Council Review CR-1.5** (the session restore contract), findings filed and ratified 2026-07-19:

| ID | Decision | Status |
|---|---|---|
| D16 | **The session restore contract** (CR-1.5, 3-model council; brief `CouncilBriefs/CouncilBrief-1.5-RestoreContract.md`, findings `CouncilBriefs/CouncilFindings-1.5-RestoreContract.md`). **Q1 — reconcile-on-boot (C), 2-of-3.** No schema change; `status='running'` read through a deterministic boot/activation reconcile pass; quit and crash converge by construction. *Gemini dissent preserved:* a `desired_state` intent column (B) is the cleaner model — adopt it when a user-facing "don't restore" toggle lands (Phase 2+). **Q2 — restore set, unanimous:** `{leaf.sessionId | leaf ∈ layout ∧ row.status='running'}`. Leaves∩exited → exited chrome + Restart; leaves-without-row → placeholder; **`running` rows without a leaf are healed to `exited` before any spawn** (the invisible-process guard). `session:delete` IPC ships (rejects live sessions). **Q3 — guarded-auto-relaunch, 2-of-3:** cwd `existsSync` before each spawn (missing → exited chrome, "Working directory not found"); 500 ms spawn stagger (250 ms if ConPTY tolerates); a transient "Session restarted — new conversation" badge (~5 s) on every restored pane; pane cap 16. *GPT dissent preserved:* affordance-driven ("Relaunch all") is more honest — the revert is renderer-only if auto proves confusing. **Q4 — unanimous:** Restart (in-run *and* post-restart) routes through a new `session:restart` channel → the launch path under the existing row id, with cwd re-validation; the D15 `respawn` attach flag is **removed** (see D15 supersession). **Coordinator resolutions (Matthew-approved 2026-07-19):** (a) `status='running'` is written **only after** spawn succeeds — supersedes findings Q4 step 3, per the findings' own Risk 1; (b) the "PID-prefix orphan scan" mitigation is dropped (contradicts the findings' own Q5 rejection of PID tracking); (c) the "Choose directory" re-homing action is trimmed to the not-found message — re-homing is Phase 2; (d) no context-menu/session-list UI — **pane close deletes the session row** after kill/exit completes (leafless rows are unreachable under the Q2 restore set, so close-flow deletion is the coherent cleanup); channels are singular (`session:delete`/`session:restart`); cwd-missing renders as its own chrome state, not a sentinel `exit_code=-1`; findings action item 7 (layout-tree migration) was already satisfied by `81e8a0b`. **Implemented verbatim in `fb384c5`** — the five-clause contract is in that commit's message; all 14 runtime steps individually verified (see `Tasks/Task-1-5-CompletionSummary.md`). | RESOLVED 2026-07-19 · IMPLEMENTED `fb384c5` |
| D17 | **Task 1-5's six deviations ratified** (completion review, 2026-07-19). (1) **Consume-once restored badge** (F10) — a `restoredUnbadged` set consumed by first attach, replacing the sketched recency window: dev cold starts outlast any fixed timing window, and the boot event fires before any pane exists. (2) **`restore()` runs on every `project:select`**, not on tracked first-activation — `computeRestoreSet`'s live-guard makes re-runs idempotent, so the activation set was needless state. (3) `storage.getSessionById` added (restart reads a row without project context). (4) `src/main/db/schema.ts` touched **comment-only** ("respawns"→"re-creation") so the `grep -ri respawn src/` criterion returns literally nothing — no schema/migration change. (5) Stagger stays 500 ms (ConPTY never showed stress; the 250 ms condition never arose). (6) `restore()` is the one documented place the manager touches storage — the spec's own §4 sketch prescribed this; `launch`/`attach` keep the IPC-owns-rows division. | RESOLVED 2026-07-19 |

**Decisions at the Phase 1b kickoff** (Matthew, 2026-07-19):

| ID | Decision | Status |
|---|---|---|
| D18 | **Title source: OSC + first-line fallback.** Titles come from terminal-title escape sequences (xterm `Terminal.onTitleChange`, OSC 0/2 — API confirmed in the installed `@xterm/xterm` 6 typings, re-verified at execution per D4); fallback = the first Enter-terminated line typed into the pane, only while the title is still null. OSC keeps updating live. **No LLM summarization** (Phase 3+, when BYOK keys exist). Whether the CLIs actually emit OSC titles is unverified until execution — the fallback is the guaranteed path; the implementer reports which mechanism fired per CLI. **Outcome (`a00af48`, mechanism report in the commit message) — the "honest unknown" is resolved:** **both CLIs emit OSC 0/2 at spawn, before any keystroke**, so the first-line fallback is effectively unreachable in a live pane for these two. Claude Code 2.1.215 sets `✳ Claude Code` and **animates a spinner in the title** while working (`⠂`/`⠐ Claude Code`, ~1 Hz, settling back to `✳`); Codex 0.144.6 sets the **cwd basename** (`Chorus`). The fallback was still exercised genuinely on an **exited** pane (no OSC source): captured a typed line, sanitized in the DB (raw shown in-renderer until next attach), ellipsis-truncated with full-text tooltip, survived restart seeded purely from the DB row. Debounce on real OSC traffic: 5 changes in ~3.4 s → 4 writes (correct trailing, no per-redraw flood). D14: zero `An object could not be cloned` across the flow. | RESOLVED 2026-07-19 · VERIFIED `a00af48` |
| D19 | **Migration v3: nullable `title` TEXT on `sessions`**, via the hand-rolled MIGRATIONS runner + Drizzle schema. "DB schema growth" is technically a §4 CR trigger; **council waived** for one trivially-reversible nullable column (coordinator recommendation, Matthew's call). Matches PLAN §269's target schema. | RESOLVED 2026-07-19 |
| D20 | **View state per-project in `settings`** (key `view_state:<projectId>`, JSON `{mode, focusedSessionId}`) over a small Zod IPC. **Filmstrip is the default** (PLAN §183), including for existing DBs; grid is the alternate. `focusedSessionId` is never FK-checked — it legitimately goes stale (F4); views resolve staleness by falling back to the first leaf. **Implemented verbatim in 1b-2; all 10 runtime items individually verified** (filmstrip default on a no-row DB, byte-identical tree across focus clicks, F5 continued-output proof, per-project persistence across a tree-kill restart, stale-focus fallback with a hand-edited bogus id, cards never badge, multi-project isolation, zero structured-clone errors); the flagged `sessionInfoSchema` `exitCode` addition and the minimal grid-focus path are recorded in the commit message. | RESOLVED 2026-07-19 · IMPLEMENTED `3a28ec2` |
| D21 | **Palette skeleton = five commands** over an extensible registry: launch agent, switch project, focus pane (by title/agent), toggle filmstrip/grid, restart focused. In-repo fuzzy subsequence filter — **no new dependency**. Further commands, shortcuts (`Ctrl+T`/`Ctrl+1..9`/`Ctrl+Tab`), and MRU are later phases. | RESOLVED 2026-07-19 |

### Gates

| ID | Gate |
|---|---|
| G1 | Typecheck: zero errors. |
| G2 | **Run, don't just compile** — drive the real app window, observe both TUIs; screenshots when headless. |
| G3 | **One** intentional narrated commit per execution session (style of `80e69c3`). |
| G4 | **Secret-grep gate** before any phase touching credentials — no keys in args, logs, or transcripts. |
| G5 | Council Review checkpoints per D6 on all **[CR]** phases. |

---

## 7. Phases

### Phase 0 — Foundation & Twin Terminals — ✅ COMPLETE (2026-07-18)

| Sub-phase | Delivered | Commit |
|---|---|---|
| 0.1 Scaffold | Electron + Vue + Vite + TS skeleton (folded into 0.2) | _(in 0.2)_ |
| 0.2 Single terminal | One Claude Code TUI live in an xterm.js pane | `80e69c3` |
| 0.3 Multi-session + detection | Two agents side-by-side; CLI detection | `45c5b2b` |
| 0.4 Persistence + exit toast | SQLite persistence; exit notifications | `f0d409b` |

**Milestone (met):** two real agent TUIs run side-by-side in one window, backed by a persistent SQLite store, with exit notifications wired.

---

### Phase 1 — Grid + Projects — ✅ COMPLETE (2026-07-19)

_Five serial tasks, each planned (`Task-1-#.md` + `ImplementationSpec-1-#.md`), executed in its own session, and coordinator-reviewed (`Task-1-#-CompletionSummary.md`). Two council reviews ran: CR-1.2 (layout engine → D9) and CR-1.5 (restore contract → D16). Decisions D7–D17 and findings F2–F11 all trace to this phase._

| Task | Scope | Status |
|---|---|---|
| **1-1** Tailwind + session lifecycle UI | Status dots driven by exit codes; restart/kill per pane, incl. clean process-tree kill; exit banner removed. | ✅ `185f972` |
| **1-2** Data layer | Drizzle typed queries; migration v2 (`sessions`); stable session ids; flat layout → versioned binary tree (lazy conversion); Vitest (24 tests). Zero visual change. | ✅ `81e8a0b` |
| **1-3** Layout view | `LayoutRenderer.vue` over the persisted tree via splitpanes; `layout:set` IPC; debounced PTY resize; close-kills-session. **Spike gate returned GO** (12/12 checks, ~45 min of a 4h box). Split buttons disabled as planned. Filmstrip spike ran and was deleted; notes kept. Produced D14 + findings F2/F3/F4. | ✅ `e7d6e60` |
| **1-4** Launch dialog + multi-session | D10 rekey landed first as a verified standalone refactor; explicit launch flow (`session:launch` + dialog + empty state); N sessions per agent kind proved (3 panes, 2 independent Codex TUIs); both 1-3 guards cleared; D11 wired. One runtime bug (F5 attach-resurrection) found, fixed via the `respawn` gate (D15), re-verified. | ✅ `c91aea1` |
| **1-5** Project tabs + restore | Project tabs (native picker, persisted active project, window title); `registerIpc` freed of its project closure (per-request FK-checked `project_id`); the **D16 restore contract implemented verbatim** — pure `computeRestoreSet`, heal-before-spawn, guarded staggered auto-relaunch, unified `session:restart`, close-flow row deletion, `respawn` removed end-to-end. One runtime-found flaw (badge timing) fixed as F10/D17. | ✅ `fb384c5` |

**Milestone — MET:** many sessions across multiple projects, restart-safe and killable. Runtime-proven at `fb384c5`: sessions keep running while their project's tab is hidden; quit leaves zero orphans; relaunch auto-restores the active project's sessions (staggered, badged) in the persisted layout shape with lazy restore on tab activation; and no code path can spawn a PTY that no pane can reach.

**[CR] checkpoint (1.2):** _splitpanes library vs. custom split-tree vs. hybrid_ — **CLOSED** as **D9**, unanimous 3-of-3. Brief: `CouncilBriefs/CouncilBrief-1.2-LayoutEngine.md`; findings: `docs/architecture/CR-1.2-pane-layout-council-findings.md`. The remaining open question is empirical, not architectural: Task 1-3's spike gate decides splitpanes vs. custom renderer behind the same adapter contract.

**Milestone:** many sessions across multiple projects — restart-safe and killable.

---

### Phase 1b — Auto-Titling, Focus + Filmstrip, Palette Skeleton — ▶ IN PROGRESS (1b-2 landed 2026-07-19, fix 2026-07-20)

_Decomposed into three serial tasks — see [`Tasks/Phase-1b-Overview.md`](Tasks/Phase-1b-Overview.md) and the paired `Task-1b-#.md` / `ImplementationSpec-1b-#.md` docs. D18–D21 resolved at kickoff (§6); **1b-1 delivered (`a00af48`), 1b-2 delivered (`3a28ec2` + fix `de98679`), D18/D20 empirically resolved**. A presentation-and-input layer over the unchanged Phase-1 data model; the 1-3 filmstrip spike (`docs/architecture/spike-filmstrip-notes.md`) de-risked the core bet._

| Task | Scope | Status |
|---|---|---|
| **1b-1** Session auto-titling | Migration v3 (nullable `sessions.title`); `session:set-title` IPC (sanitized, debounced); OSC `onTitleChange` + first-typed-line fallback (D18/D19); title on `SessionInfo` + attach response; pane-header display. **Delivered:** required-nullable `title` rippled into launch/restart handlers + `App.vue`'s `onLaunched` cache (one-line ripple **flagged and ratified in review** — the omission-catch the required-nullable design exists for); 60/60 tests; D18 empirically resolved (§6, F12). | ✅ `a00af48` |
| **1b-2** Focus + Filmstrip default | `FilmstripRenderer.vue` over the spike-validated tree/`agentFor` contract — one focused `TerminalPane` + compact cards (agent, title, dot, elapsed); click-to-focus (view state, never a tree mutation); filmstrip ⇄ grid toggle; per-project `view_state` persistence (D20). **Cards bound by F12** — render the persisted title / debounce re-renders (twitchy Claude titles); compose agent+title (Codex cwd-basename collisions). **Delivered:** `FilmstripRenderer` + view store + `view:get`/`set` over D20; split-focuses-new, close-falls-back; `exitCode` deviation flagged and ratified; follow-up `de98679` hardened `TerminalPane` against mid-attach unmount → F13. | ✅ `3a28ec2` + fix `de98679` |
| **1b-3** `Ctrl+K` palette skeleton | `CommandPalette.vue` + extensible registry + in-repo fuzzy filter; five D21 commands over existing plumbing; capture-phase hotkey interception (xterm swallows keys). Renderer-only. Closes Phase 1b. | Pending — ready for `/phase-prompt` |

**Milestone:** the workspace is glanceable and drivable — sessions name themselves, the default view is one focused pane plus a status strip, and `Ctrl+K` reaches launch/switch/focus/toggle/restart without the mouse.

---

> **Phases 2–7 are PROVISIONAL.** They sketch the intended shape (refining PLAN.md §14) but are **not authoritative**. Each will be re-planned at its own `/phase-kickoff`. Scope, ordering, and [CR] questions below may change.

### Phase 2 — Worktrees _(provisional)_ **[CR: worktree lifecycle & crash reconciliation — data-loss surface]**

`GitWorktreeManager`; workspace modes in the launch dialog; auto-worktree when a 2nd _writing_ agent targets the same repo; diff summary; cleanup + boot reconciliation against `git worktree list`. **Never auto-merge.**

- **[CR] question:** how do we reconcile worktree state after a crash without losing uncommitted agent work?
- **Milestone:** two writing agents safely share one repo via isolated worktrees, reconciled on restart.

### Phase 3 — BYOK + Adapters _(provisional)_ **[CR: vault security review; adapter interface shape]**

safeStorage/DPAPI vault; `credential_profiles`; provider configs; `AgentAdapter` interface + capabilities (PLAN §4 — first real abstraction over the Phase-0 enum); model catalog + test-key; effort normalization; launch profiles; **env-var injection into child PTYs (supersedes D5)**; pino secret-redacting logging; `usage_records` capture begins.

- **[CR] questions:** is the vault design sound against key exfiltration? Is the `AgentAdapter` interface shape right before we build providers on it?
- **Gate:** G4 secret-grep mandatory.
- **Milestone:** agents launch with injected BYOK credentials, keys never touching args/logs/transcripts.

### Phase 4 — Notifications _(provisional)_ **[CR: localhost hook listener security]**

Hook listener + hook injection into `.claude/settings.json`; append-only `agent_events` bus; notification policies; toast → focus-pane; tray badge; notification center; Attention Inbox; per-session event timeline sidebar.

- **Note:** OS toast delivery is already **proven blocked** by the dev machine's `ToastEnabled=0` — the **in-app notification center must be first-class**, not an afterthought.
- **[CR] question:** how do we secure the localhost hook listener against local processes spoofing agent events?
- **Milestone:** agent attention events reliably surface in-app regardless of OS toast state.

### Phase 5 — Voice _(provisional)_

uiohook push-to-talk; whisper.cpp local + cloud toggle; mic overlay; injection with target ring; mission-control overlay (shares always-on-top plumbing).

- **Milestone:** voice dictation injects into the targeted session.

### Phase 6 — Neo4j Memory + Skills _(provisional)_ **[CR: memory schema + provenance model]**

dockerode provisioner; per-project containers; schema templates + provenance; MCP wiring into CLIs; index-codebase skill; lifecycle UI; provider-neutral skill format (`skill.yaml`).

- **[CR] question:** what memory schema and provenance model keeps agent-written knowledge trustworthy and attributable?
- **Milestone:** agents read/write a per-project memory graph via MCP.

### Phase 7 — Polish & Ship _(provisional)_

Pop-out windows; scrollback search; transcript export; cost rollups; secret-redaction audit; **NSIS installer + updater that registers the AUMID properly** (fixes the dev toast situation); crash-recovery pass; Windows terminal test matrix (Playwright) in CI.

- **Milestone:** a shippable, installable Chorus v1 with working OS notifications and CI coverage.

---

## 8. Out Of Scope (v1 horizon)

Explicitly **not** in v1 (per PLAN):

- Task board / card-dispatch; orchestration roles; automation scheduler.
- Built-in editor & diff viewer; TTS; wake word.
- Cloud sync; plugin marketplace; mobile companion.
- **macOS / Linux** support.
- **Auto-merge** of agent branches.

---

## How to run the next step

**Phase 1 is complete; Task 1b-2 landed (`3a28ec2` + `de98679`, 2026-07-20).** Next action: run **`/phase-prompt`** for **Task 1b-3** (`Ctrl+K` palette skeleton) against `Tasks/Task-1b-3.md` + `ImplementationSpecs/ImplementationSpec-1b-3.md`, then open the execution session with the generated prompt. **Notes binding 1b-3:** the view store's `setMode`/`setFocused` and the exported `resolveFocused` are exactly the primitives the palette's "toggle view" / "focus pane" commands should call; **grid mode doesn't track focus** (minimal path — add the `LayoutRenderer` relay only if the palette needs it); **F13 binds any async `onMounted` the palette adds**; **focus writes are immediate**, so a palette that live-previews focus should debounce. Task 1b-3 **closes Phase 1b**; then `/architect` re-sync and Phase 2 (Worktrees) kickoff, carrying its pre-identified **[CR]** on worktree lifecycle & crash reconciliation.
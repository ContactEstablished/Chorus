# Kimi K3: Chorus Phase 1, Task 1-2 Execution Prompt

## 1. Role

You are Kimi K3, the implementation engineer for **Chorus Phase 1, Task 1-2** (data layer: Drizzle, Vitest, LayoutTree, stable session ids).

- **Repo root:** `C:\Projects\ContactEstablished\Chorus`
- **Expected branch:** `main` — confirm with `git branch --show-current`; do not switch or create branches.
- **Expected HEAD:** `185f972` ("Phase 1.1: Tailwind styling and per-pane session lifecycle controls") or a descendant.

You implemented Task 1-1 in a previous session, but this session has none of that context — re-ground from the files. Planning is owned by a separate coordinator (Claude), who will audit your final summary against the task docs and the repo.

## 2. Goal

Task 1-2 is a **pure re-plumbing with zero visual change**. Three things land:

1. **Drizzle ORM** adopted for schema types + typed queries over the existing better-sqlite3 connection.
2. **Vitest** introduced, with the repo's first unit tests covering a new pure binary-split-tree module.
3. **Stable session identity** — a `sessions` DB row id that survives PTY respawns and app restarts — and the persisted pane layout converts from a flat array to a versioned tree.

> **Prime constraint:** when you are done, the running app must look and behave **exactly** as it does now — two panes, same live TUIs, same fixed 50/50 split, same pane headers. If anything moved on screen, you changed too much.

## 3. Project Context

**Chorus** is a local-first, Windows-only Electron 43.1.1 + Vue 3 + TypeScript + Vite + Pinia desktop app that runs AI coding agent CLIs (Claude Code, Codex) as live interactive TUIs inside xterm.js terminal panes. PTY processes (node-pty, ConPTY) live in the Electron **main** process, owned by `SessionManager`; the renderer is a pure view that attaches to sessions by id over typed IPC. `contextIsolation: true`, `nodeIntegration: false`.

**Dev machine:** Windows 11, PowerShell 7, Node 22.14.0 (`NODE_MODULE_VERSION 127`), npm 11.x, Electron 43.1.1 (`NODE_MODULE_VERSION 148`). CLIs installed: `claude.exe` 2.1.207 (native exe), `codex-cli` 0.135.0 (npm `.cmd` shim spawned via `cmd.exe /c`).

**App database:** `C:\Users\matth\AppData\Roaming\chorus\chorus.db` (SQLite, WAL).

**Environment quirks you MUST know:**

| Quirk | What you will see | How to treat it |
|---|---|---|
| (a) OS toasts disabled system-wide (registry `ToastEnabled=0`) | Exit-toast code logs `[notify] toast shown: ...` then `[notify] toast failed: ... (HRESULT: -2143420140)` | **Expected.** The log line is the pass signal; a visible toast will never appear. |
| (b) Codex first-run prompts | An update-available prompt and/or a directory-trust prompt in the Codex pane | These rendering crisply **is** the terminal layer working. Press **"2"** (Skip) on the update prompt — **never "1"**, which runs an npm install. |
| (c) Claude CLI auth may be expired | The Claude pane may show a `401` / "Please run /login" instead of a REPL | Auth state is **outside this task's scope**. The pane still proves the terminal layer works. Note it; do not attempt to log in. |

## 4. Ground Yourself First (read BEFORE editing)

| File | Purpose |
|---|---|
| `CLAUDE.md` | Locked architecture rules |
| `docs/Features/Foundation/roadmap.md` | §5 Verified Ground Facts, §6 Decisions & Gates |
| `docs/Features/Foundation/Tasks/Phase-1-Overview.md` | Phase shape, file-ownership matrix |
| **`docs/Features/Foundation/Tasks/Task-1-2.md`** | **THE task contract — scope, non-goals, acceptance criteria. This governs.** |
| `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-1-2.md` | Exact schema contents, Zod shapes, conversion algorithm, insertion points |
| `docs/architecture/CR-1.2-pane-layout-council-findings.md` | Authoritative for the layout tree schema and its invariants (produced by a multi-model review council; the spec's schema derives from it) |

> **The "Initial Starting Point" line numbers inside `Task-1-2.md` and `ImplementationSpec-1-2.md` were captured BEFORE Task 1-1 landed and are now STALE.** The table in §5 below supersedes them. Trust §5, then confirm by reading the files.

## 5. Verified Code Anchors (re-verified 2026-07-19 at HEAD 185f972)

### `src/main/services/sessionManager.ts`
| Line | Symbol | Note |
|---|---|---|
| 10 | `BUFFER_MAX_CHARS = 4_000_000` | Main-process **replay ring buffer** cap (not xterm scrollback) |
| 38 | `private sessions = new Map<string, PtySession>()` | Keyed by session id |
| 43 | `attach(agent: AgentKind, cwd: string): SessionSnapshot` | Signature changes this task |
| 60 | `kill(sessionId: string): void` | Task 1-1; no change needed |
| 80 | `getAgent(sessionId)` | |
| 93 | `dispose()` | Kills all PTYs on quit |
| 102 | `private findByAgent(agent)` | One-per-kind lookup; still valid this task |
| 109 | `private spawn(agent, cwd)` | |
| 111 | `const id = randomUUID()` | **The ephemeral id this task replaces** |

### `src/shared/ipc.ts`
| Line | Symbol | Note |
|---|---|---|
| 12 / 18 / 24 / 26 | `SessionAttach` / `SessionKill` / `CliDetect` / `LayoutGet` | Members of the `IpcChannel` **const object** (not a TS enum) |
| 33 | `agentKindSchema` | `z.enum(['claude','codex'])` |
| 36 | `attachRequestSchema` | Gains optional `sessionId` this task |
| 41 | `attachResponseSchema` | Shape: `{sessionId, buffer, status, exitCode}` |
| 63 | `killRequestSchema` | Task 1-1 |
| 100 | `paneSchema` | The flat `{slot, agent}` — **replaced this task** |
| 106 | `layoutGetResponseSchema` | Currently `z.array(paneSchema)` — **replaced this task** |

### `src/main/services/storage.ts`
| Line | Symbol |
|---|---|
| 20 | `DEFAULT_LAYOUT` (flat array) |
| 30 | `MIGRATIONS: string[]` |
| 62 | `getOrCreateProject` |
| 77 | The `DEFAULT_LAYOUT` seed write inside `getOrCreateProject` |
| 83 | `getPaneLayout` |
| 92 / 108 | `getWindowBounds` / `saveWindowBounds` |
| 117 | `close()` |

### `src/main/ipc.ts`
| Line | Symbol |
|---|---|
| 24 | `registerIpc(sessions, storage, project)` |
| 29 / 34 / 39 / 44 / 49 / 54 | Handlers: SessionAttach / CliDetect / LayoutGet / SessionWrite / SessionResize / SessionKill |

Every handler Zod-parses its payload before acting. Copy that pattern.

### `src/preload/index.ts`
Zod-free forwarders in a `chorusApi` object; the `ChorusApi` type is **inferred** from it (`index.d.ts` needs no edit).

| Line | Forwarder |
|---|---|
| 22 / 25 / 27 | `attachSession` / `detectClis` / `getLayout` |
| 29 / 32 / 35 | `writeSession` / `resizeSession` / `killSession` |
| 38 / 46 | `onSessionData` / `onSessionExit` |

### `src/renderer/src/App.vue`
| Line | Symbol |
|---|---|
| 8 | `const panes = ref<Pane[]>([])` |
| 10 / 11 | `onMounted` → `await window.chorus.getLayout()` |
| 18 | `v-for="{ slot, agent } in panes"` |
| 19 | `<TerminalPane :agent="agent" />` |

### `src/renderer/src/components/TerminalPane.vue`
| Line | Symbol | Note |
|---|---|---|
| 9 | `defineProps<{ agent: AgentKind }>()` | Gains `sessionId` this task |
| 11 | `labels` record | `{ claude: 'Claude Code', codex: 'Codex' }` |
| 15 | `pane` computed | `store.sessions[props.agent]` |
| 16 | `dotStatus` computed | `store.dotStatus(props.agent)` |
| 23 | `fitAndSyncPty()` | ResizeObserver → `fit()` + **immediate** `resizeSession`. **Do NOT add debounce — Task 1-3.** |
| 32 | `attachToSession()` | Currently calls `attachSession(props.agent)` |
| 41 | `waitForExit(sessionId)` | Task 1-1 race guard — **preserve exactly** |
| 52 / 64 | `onKill` / `onRestart` | Task 1-1 |
| 82 | `onMounted` | Creates the Terminal, loads FitAddon, opens it, calls `attachToSession()`, registers data/exit listeners |
| 85 | `scrollback: 10_000` | **Do NOT change to 5000 — Task 1-3.** |

### `src/renderer/src/stores/session.ts`
| Line | Symbol | Exact shape |
|---|---|---|
| 5 | `export type DotStatus` | `'detached' \| 'running' \| 'exited-ok' \| 'exited-error'` |
| 7 | `interface PaneSessionState` | `{ sessionId: string \| null; status: SessionStatus \| 'detached'; exitCode: number \| null; busy: boolean }` |
| 15 | `function detached(): PaneSessionState` | **Factory** returning a fresh detached state (it does not remove anything) |
| 20 | `useSessionStore` | |
| 21–26 | `state: sessions: Record<AgentKind, PaneSessionState>` | Seeded with `claude: detached(), codex: detached()` |
| 29 | `dotStatus` getter | Curried: `(agent) => DotStatus`; running → `'running'`, exited → exitCode 0 ? `'exited-ok'` : `'exited-error'`, else `'detached'` |
| 39 | `attached(agent, sessionId, status, exitCode)` | Replaces that agent's whole state, `busy: false` |
| 42 | `exited(agent, exitCode)` | Sets status/exitCode, clears `busy` |
| 47 | `setBusy(agent, busy)` | |

## 6. What Task 1-1 Already Built (do not undo it)

Commit `185f972` shipped: Tailwind CSS v4.3.3 (`@tailwindcss/vite` plugin on the **renderer** target, `@import 'tailwindcss'` in `src/renderer/src/assets/main.css`); a per-pane header bar with agent label + status dot + Restart/Kill buttons; the `session:kill` IPC channel; the `busy` flag and `dotStatus` getter on the session store; the bottom exit banner removed.

**All of this must survive Task 1-2 unchanged.** In particular preserve:
- the header chrome and its Tailwind classes,
- the `waitForExit` race guard in `onRestart` (register the exit listener **before** killing; await it **before** re-attaching),
- the store's `busy` / `dotStatus` behavior.

## 7. Current Database State (what the legacy-conversion path will encounter)

Verified 2026-07-19 by reading the live DB:

| Item | Current state |
|---|---|
| `schema_migrations` | Exactly `version 1`. **Your new migration becomes version 2.** |
| Tables present | `pane_layouts`, `projects`, `schema_migrations`, `settings`. **No `sessions` table yet.** |
| `projects` | One row — name `Chorus`, root_path `C:\Projects\ContactEstablished\Chorus` |
| `pane_layouts.layout_json` | The LEGACY flat array, verbatim: `[{"slot":0,"agent":"claude"},{"slot":1,"agent":"codex"}]` |

**Your lazy legacy-conversion path WILL execute on the first run against the real dev database** — it is not a hypothetical branch. Getting it right is the core of this task's runtime verification. (If you corrupt the DB, it is reconstructible: quit, delete `chorus.db*`, and the app reseeds — but you must report it.)

## 8. Resolved Decisions That Bind This Task (quote; do not relitigate)

- **D1** (RESOLVED 2026-07-18): ALL Zod validation lives in the **main process only**. Preload and renderer run under a CSP with no `unsafe-eval`; Zod's `.parse()` there throws `EvalError` and silently drops IPC events. Shared files may EXPORT schemas; only `src/main/` calls `.parse()`.
  → **For this task:** `src/shared/layout.ts` must be **pure TypeScript with NO Zod import at all**. The Zod tree schema lives in `src/shared/ipc.ts` and is parsed only in main (`src/main/ipc.ts` and `src/main/services/storage.ts`).
- **D2** (RESOLVED 2026-07-18): **NEVER run `electron-rebuild`.** node-pty ships working prebuilds. better-sqlite3 is built for Electron's ABI via the repo's `.npmrc` + `npm run rebuild:better-sqlite3` (compiles with `/Od` due to an MSVC 17.14 internal compiler error). Your `npm install` of drizzle/vitest may re-fetch better-sqlite3; if the app then fails with a native-module ABI error, run `npm run rebuild:better-sqlite3` — nothing else.
- **D3** (locked, CLAUDE.md): sessions live in main; the renderer never spawns processes.
- **D4** (locked, CLAUDE.md): verify tooling setup against **current official docs at execution time**, never from model memory. Applies here to Drizzle's better-sqlite3 driver setup and the Vitest config — check their current docs rather than recalling an API shape.
- **D7** (RESOLVED 2026-07-18): **Drizzle ORM is adopted starting this task**; the dependency is pre-approved, do not ask.
  → **Deliberate scope cut:** Drizzle provides schema **TYPES + TYPED QUERIES only**. The existing hand-rolled `MIGRATIONS` array + `schema_migrations` runner **STAYS**. Do **NOT** adopt drizzle-kit migrations. Rationale to honor: swapping the migration engine and the query layer simultaneously doubles risk; drizzle-kit can be revisited when schema churn grows.
- **D9** (RESOLVED 2026-07-18, unanimous council): the persisted layout is an **owned binary split tree**:
  ```ts
  type LayoutNode =
    | { type: 'leaf'; sessionId: string }
    | { type: 'row' | 'column'; ratio: number; children: [LayoutNode, LayoutNode] }
  type LayoutJson = { version: 1; root: LayoutNode }
  ```
  Leaves bind **`sessionId`**, NOT agent kind — because multiple sessions per agent kind arrive in Task 1-4.
  **Invariants:** exactly 2 children on internal nodes; `ratio` clamped `[0.05, 0.95]` on write **and** read; `sessionId` non-empty; no duplicate `sessionId`s (dedupe keep-first on load); minimum valid tree is a single leaf; `version` literal `1`; invalid content logs and falls back rather than crashing.

## 9. Corrected Fact — the Vitest / better-sqlite3 ABI situation

`Task-1-2.md` previously claimed that importing the storage module under plain node "throws at load time". That was imprecise; the doc has been corrected. The accurate behavior (re-verified 2026-07-19):

- `require('better-sqlite3')` under plain Node 22 **SUCCEEDS** — the package entry point is JavaScript and the native binding loads lazily.
- The failure occurs on the first `new Database(...)`:
  ```
  The module '...\better_sqlite3.node' was compiled against a different Node.js version
  using NODE_MODULE_VERSION 148. This version of Node.js requires NODE_MODULE_VERSION 127.
  ```

**Do not interpret a successful import as evidence that DB-backed tests will work — they will fail at the first query.** Keep Task 1-2's tests **pure-logic only** (exercising `src/shared/layout.ts`), exactly as the task doc requires. Do **not** attempt a parallel node-ABI build of better-sqlite3 to enable DB tests; that is explicitly out of scope.

## 10. Known Trap — tsconfig include globs and test files

Both tsconfigs include `src/shared/**/*`:
- `tsconfig.node.json` → `electron.vite.config.*`, `src/main/**/*`, `src/preload/**/*`, `src/shared/**/*`
- `tsconfig.web.json` → `src/renderer/src/**/*`, `src/preload/*.d.ts`, `src/shared/**/*`

A test file at `src/shared/layout.test.ts` therefore lands in **both** typecheck passes (`typecheck:node` via `tsc` and `typecheck:web` via `vue-tsc`). To keep `npm run typecheck` green:

- Import Vitest helpers **explicitly**: `import { describe, it, expect } from 'vitest'`.
- Do **NOT** enable `globals: true` in the Vitest config — bare `describe`/`it` would fail typecheck in both projects.
- If typecheck still objects to the test file, prefer adding a narrow `exclude` for `src/**/*.test.ts` to the tsconfigs over weakening any type settings.

**Report whichever route you took.**

## 11. Implementation Scope

Follow `Task-1-2.md`'s Exact Scope and its 13 Step-by-step Work items. Summary:

**CREATE**

| File | Content |
|---|---|
| `src/main/db/schema.ts` | Drizzle table definitions mirroring the existing DDL (`projects`, `pane_layouts`, `settings`, `schema_migrations`) **plus the new `sessions` table**: `id` TEXT PK (stable UUID), `project_id` TEXT → projects(id), `agent` TEXT, `cwd` TEXT, `status` TEXT, `exit_code` INTEGER NULL, `created_at` TEXT. Export inferred row types. |
| `src/shared/layout.ts` | **Pure TypeScript, imports nothing.** Types `LayoutNode` / `LayoutJson`, plus `createLeaf`, `splitPane`, `removePane`, `setRatio` (clamped), `changeDirection`, `swapPanes`, `collectSessionIds`, `findLeaf`, `convertLegacyFlatLayout`. |
| `vitest.config.ts` | Node environment, `include: ['src/**/*.test.ts']`. No `globals: true` (see §10). |
| `src/shared/layout.test.ts` | Invariant tests — see §15 for the required coverage list. |

**EDIT**

| File | Changes |
|---|---|
| `package.json` | devDeps `drizzle-orm`, `drizzle-kit`, `vitest` (**those three only — do not add `@vitest/ui` or coverage packages**); add `"test": "vitest run"`. |
| `src/main/services/storage.ts` | Append **migration version 2** creating the `sessions` table (plain SQL in the existing `MIGRATIONS` array, column names/types matching `schema.ts` exactly); port existing queries to Drizzle typed queries over the same better-sqlite3 connection; `getPaneLayout` returns the tree with lazy legacy conversion + write-back; add `createSession`, `getSessionsForProject`, `updateSessionStatus`, and `savePaneLayout(projectId, layout)`. |
| `src/shared/ipc.ts` | Replace `paneSchema` / `layoutGetResponseSchema` with the recursive `layoutJsonSchema` (via `z.lazy`, discriminated on `type`, `z.tuple` of exactly 2 children, `version` literal 1, ratio `.min(0.05).max(0.95)`) and a new response `{ layout, sessions: [{id, agent, status}] }`; extend `attachRequestSchema` with `sessionId: z.string().uuid().optional()`. Export only — no `.parse()` here. |
| `src/main/services/sessionManager.ts` | `attach` becomes `attach(opts: { sessionId?: string; agent: AgentKind }, cwd)`. When `sessionId` is provided, the spawned `PtySession.id` **is that stable row id** instead of `randomUUID()` (line 111). When absent, preserve current behavior. Document inline: **from 1-2 on, session identity = DB row id; the PTY instance is ephemeral and re-created under the same id on respawn.** |
| `src/main/ipc.ts` | New `layout:get` response shape; extended attach request. All parsing happens here. |
| `src/preload/index.ts` | Forward the extended attach payload and the new response shape verbatim. **Stays Zod-free.** |
| `src/renderer/src/App.vue` | Interim adapter: consume `{layout, sessions}`, flatten the tree's leaves in document order via `collectSessionIds`, look up each leaf's agent from the `sessions` array, and render the **same fixed 50/50 flexbox**. |
| `src/renderer/src/components/TerminalPane.vue` | Accept `{ sessionId, agent }` props; attach by `sessionId`. **Preserve ALL Task 1-1 chrome, the header, and the `waitForExit` race guard.** |
| `src/renderer/src/stores/session.ts` | Minimal changes only. |

**Key guidance:**

- **Keep the session store keyed by `AgentKind`.** There is still exactly one session per agent kind until Task 1-4, and Task 1-1's `busy`/`dotStatus` logic is keyed that way. Rekeying by `sessionId` is Task 1-3/1-4 work — doing it here would churn the code twice and risk the zero-visual-change constraint.
- **Fresh-DB seeding decision point.** `getOrCreateProject` (line 62) currently seeds `DEFAULT_LAYOUT` as a flat array at line 77. A brand-new project must end up with a **valid tree**, which means its session rows must exist before the tree can reference them. Handle this coherently (create the two session rows, then seed a tree of two leaves) and state your approach in the summary. Note for context: Task 1-4 later changes first-run seeding to an **empty** layout — do not implement that now.
- Legacy conversion is **lazy on-read-then-write-back**, not a SQL data migration.
- Ratios are clamped on **read as well as write**.

## 12. Strict Non-Goals

- No layout view / splitpanes / `LayoutRenderer.vue` / resize UI / split or close buttons — **Task 1-3**.
- No launch dialog, no multi-session-per-kind — **Task 1-4**.
- No project tabs, no restore-on-boot — **Task 1-5**.
- No new IPC channels beyond the changed `layout:get` response shape and the extended attach request. Specifically **no `layout:set`** (Task 1-3).
- No drizzle-kit migrations. No DB-backed tests.
- No PTY resize debounce, no scrollback change (both Task 1-3).
- **No visual change of any kind.**
- Do not touch `src/main/services/notifications.ts`, `src/main/constants.ts`, or `src/main/index.ts`.
- **Do not revert, stage, or commit unrelated or untracked files, including anything under `docs/`.**

## 13. Pre-existing Changes Warning

At prompt-generation time (2026-07-19, HEAD `185f972`) the tracked tree was clean, with **one expected untracked file**:

```
?? docs/Features/Foundation/Tasks/Task-1-1-ExecutionPrompt.md
```

That is the previous task's prompt, left by the coordinator. **Leave it exactly as is** — do not stage, commit, move, or delete it. (This prompt file may appear alongside it once saved; treat it the same way.) If `git status --porcelain` shows anything **else**, stop and ask the user before proceeding.

## 14. Required Workflow

1. **Ground** per §4/§5 — read the task doc and spec, then confirm the anchors in the actual files.
2. **Implement in the doc's step order**, in small reviewable edits. Get `npm run typecheck` green before moving on from each layer: deps → Drizzle schema → migration 2 → layout module → Zod schema → SessionManager → storage → IPC → preload → renderer → tests.
3. **Self-review** the diff against `CLAUDE.md`, D1/D3/D7/D9, and `Task-1-2.md`'s Review Checklist.
4. **Run verification** (§15).
5. **ONE intentional commit** narrating what changed and why, in the style of commits `80e69c3` and `185f972`: a plain-English summary paragraph, then an "In plain terms:" paragraph, then a "Technical notes:" bullet list.
   - Commit author must be **Matthew Wilson <mwilson29072@gmail.com>** — check `git config user.name` / `user.email` and use `git -c user.name=... -c user.email=...` overrides if they differ.
   - End the message with `Co-Authored-By: Kimi K3 <noreply@moonshot.ai>` (matching `185f972`).
   - **Do not push, do not open a PR, do not amend or rebase existing commits.**

## 15. Verification Commands (run from `C:\Projects\ContactEstablished\Chorus`)

**Typecheck**
```
npm run typecheck
```
Zero errors across `typecheck:node` and `typecheck:web`.

**Unit tests**
```
npx vitest run
```
All pure-logic layout tests green. Required coverage per `Task-1-2.md`: exactly-2 children · ratio clamp on write · ratio clamp on read · dedupe keep-first · single-leaf minimum · `version` literal 1 · `removePane` sibling-absorb · `removePane` root collapse to `null` · `splitPane` shape · legacy conversion balanced shape · `collectSessionIds` document order · `changeDirection` · `swapPanes`.

**Run the app (do not just compile)**
```
npm run dev
```

| # | Observe |
|---|---|
| (a) | The window is **visually identical** to before this task — two panes, live TUIs (Claude Code left, Codex right), the fixed 50/50 split, and Task 1-1's pane headers with label + dot + Restart/Kill all intact |
| (b) | The main-process console logs `[storage] project 'Chorus' ...` normally, with **no ABI error** |
| (c) | Typing in one pane never reaches the other |
| (d) | Task 1-1's Kill and Restart still work end-to-end |

**Before/after screenshot comparison is the acceptance evidence for the zero-visual-change constraint.** Capture the window before you start and after you finish, and compare them.

**Database inspection — QUIT THE APP FIRST**, then run this exact command (readonly, safe):
```powershell
$env:ELECTRON_RUN_AS_NODE=1; ./node_modules/.bin/electron -e "const D=require('C:/Projects/ContactEstablished/Chorus/node_modules/better-sqlite3'); const db=new D(process.env.APPDATA+'/chorus/chorus.db',{readonly:true}); console.log('migrations:', JSON.stringify(db.prepare('select version from schema_migrations').all())); console.log('layout:', db.prepare('select layout_json from pane_layouts').get().layout_json); console.log('sessions:', JSON.stringify(db.prepare('select id,agent,status from sessions').all()));"
```

Expected after a successful run:
- `schema_migrations` contains versions **1 and 2**.
- `layout_json` has been rewritten from the flat array to `{"version":1,"root":{"type":"row","ratio":0.5,"children":[{"type":"leaf","sessionId":"..."},{"type":"leaf","sessionId":"..."}]}}`.
- `sessions` has exactly **2 rows** (one `claude`, one `codex`) with stable UUID ids **matching the leaf `sessionId`s**.

**Session-identity check.** With the app running, click **Restart** on a pane (which kills and respawns the PTY), then quit and re-run the DB inspection: the session row `id` must be **unchanged**. That is the proof that identity now lives in the DB row rather than the PTY instance.

**If you cannot visually observe the Electron window from your harness,** write a PowerShell helper into a temp directory using `user32.dll` P/Invoke (`EnumWindows` to find the visible electron-process window titled "Chorus", `GetWindowRect` + `Graphics.CopyFromScreen` to screenshot, `SetCursorPos` + `mouse_event` to click, `SendKeys` to type) and inspect the screenshots. The window may sit at **negative coordinates on a secondary monitor** — use the rect from `EnumWindows`; do not assume the primary display.

## 16. Failure Honesty Clause

If any verification fails — including for an environment reason unrelated to your change — **capture the exact output, explain what it means, and report it. Never claim success that was not directly observed.**

- **Still a pass, note and move on:** a Codex pane showing its update/trust prompt; a Claude pane showing a login prompt (§3c).
- **May NOT be reported as success:** a blank pane · dropped keystrokes · a layout that did not convert · a missing `sessions` row · an ABI error · any visible change to the window.

If the legacy conversion corrupts the dev database, say so plainly. The database is reconstructible (quit, delete `chorus.db*`, the app reseeds), so an honest failure report costs nothing — and a false success costs the next three tasks.

## 17. Final Reporting Requirements

The coordinator will audit this against the task docs and the repo. Be precise, complete, and honest. End with a detailed summary containing:

- **Status:** DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED.
- **Files changed:** every file with a one-line rationale; flag loudly any file touched beyond the Exact Scope list (§11), with justification.
- **Deviations from `ImplementationSpec-1-2.md`:** every difference and why — including any Drizzle or Vitest API that differed from the spec's sketch once you checked current docs per D4.
- **Fresh-DB seeding approach:** what you did about `getOrCreateProject` seeding a valid tree (§11).
- **Verification transcript:**
  - `npm run typecheck` result.
  - `npx vitest run` summary — test count and the list of invariants covered.
  - Runtime observations (a)–(d) stated individually with what you **actually saw**.
  - The before/after screenshot comparison verdict on zero-visual-change.
  - The DB inspection output **verbatim** (migrations, layout_json, sessions rows).
  - The session-identity-across-restart result.
- **D2 follow-up:** whether the better-sqlite3 rebuild was needed after installing dependencies.
- **Tsconfig/test trap (§10):** which route you took to keep typecheck green.
- **Acceptance criteria:** `Task-1-2.md`'s checklist restated with pass/fail per item.
- **Non-goals confirmation:** explicit statement that each non-goal (§12) was untouched, and that Task 1-1's chrome, race guard, and store behavior survive intact.
- **Residual risks / notes for Task 1-3's implementer** (who builds `LayoutRenderer.vue`, splitpanes, and the debounced PTY resize on top of your tree model) — note any assumptions about the tree invariants you relied on, and any simplifications Task 1-3 must work around.
- **Final output of:**
  ```
  git status --porcelain
  git log --oneline -3
  ```

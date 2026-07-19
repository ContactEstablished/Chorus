# Chorus v1 — Master Roadmap (Foundation)

_Location: `docs/Features/Foundation/roadmap.md` · Last updated: 2026-07-19_

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

Re-verified **2026-07-19** against the codebase at HEAD `e7d6e60` (Task 1-3 landed; working tree carries only uncommitted `docs/` planning edits and `_ui/`). Facts carried forward unchanged from 2026-07-18 keep that date; anything re-read today is dated 2026-07-19.

### Status & toolchain

| Fact | Where | Verified |
|---|---|---|
| Phase 0 complete through `f0d409b`. Trail: `80e69c3` (0.2 single Claude Code terminal), `45c5b2b` (0.3 two agents side-by-side + CLI detection), `f0d409b` (0.4 SQLite persistence + exit notifications), `ae4eba4` (docs). | git log | 2026-07-18 |
| **Phase 1.1 landed** as `185f972` (Tailwind + per-pane lifecycle controls). **1.2** as `81e8a0b` (Drizzle, stable session ids, layout tree, Vitest). **1.3** as `e7d6e60` (LayoutRenderer over the split tree, debounced PTY resize, close-kills-pane). All three reviewed; 1-2's review produced D10–D13, 1-3's produced D14 + F2/F3/F4. | git log | 2026-07-19 |
| **`npm run typecheck` exits 0** (node + web). **`npx vitest run` = 27/27 green** across two files (`src/shared/layout.test.ts`, `src/renderer/src/stores/layout.test.ts`). | run today | 2026-07-19 |
| Deps: electron `43.1.1`, vue `3.5.25`, pinia `4.0.2`, vite `7.2.6`, vitest `4.1.10`, zod `4.4.3`, drizzle-orm `0.45.2` + drizzle-kit `0.31.10`, tailwindcss + `@tailwindcss/vite` `4.3.3`, `@xterm/xterm` `6.0.0` + addon-fit `0.11.0`, better-sqlite3 `12.11.1`, node-pty `1.1.0`, **`splitpanes` `~4.1.2`** (installed by 1-3 on the spike GO). | `package.json` | 2026-07-19 |
| Scripts: `dev`, `start`, `build`, `typecheck` (`:node` + `:web`), `test` (`vitest run`), `rebuild:better-sqlite3`. | `package.json` | 2026-07-19 |
| better-sqlite3 **12.11.1** — no electron-v148 (Electron 43) prebuild on npm; MSVC 17.14 ICEs (`C1001`, `sqlite3.c`) at `/O2`. `.npmrc` pins `runtime=electron`; `npm run rebuild:better-sqlite3` builds with `/Od`. **Drop both when ≥12.11.2 reaches npm.** Note: the 1-2 dependency install needed **no** rebuild (no ABI error surfaced). | `.npmrc`, package scripts | 2026-07-19 |
| node-pty **1.1.0** — in-package N-API prebuilds; **no electron-rebuild ever** (broken on Windows). | package | 2026-07-18 |
| Dev-machine CLIs — `claude.exe` 2.1.207 (native exe), `codex-cli` 0.135.0 (npm `.cmd` shim, spawned via `cmd.exe /c`), git 2.50.0, docker 28.0.4, node 22.14.0. | dev machine | 2026-07-18 |

### Main process

| Fact | Where | Verified |
|---|---|---|
| `SessionManager` — `Map<string, PtySession>` keyed by **stable DB session row id** (the PTY is ephemeral, re-created under the same id). `attach({sessionId?, agent}, cwd)`, `kill`, `write`, `resize`, `getAgent`, `onData`, `onExit`, `dispose`. **`findByAgent()` still exists** and is the one-live-session-per-kind fallback when `attach` is called without a `sessionId` — Task 1-4 removes it. | `src/main/services/sessionManager.ts` | 2026-07-19 |
| IPC — **9 channels**: `session:attach` / `write` / `resize` / `kill` (invoke), `session:data` / `exit` (events), `cli:detect`, `layout:get`, **`layout:set`** (added by 1-3; re-clamps + re-validates in main, persists via `savePaneLayout`). All Zod-validated in **main only**. | `src/shared/ipc.ts`, `src/main/ipc.ts` | 2026-07-19 |
| Preload is a **Zod-free typed forwarder**; page CSP forbids Zod's `eval` (EvalError → silently dropped events). Surface: `attachSession`, `writeSession`, `resizeSession`, `killSession`, `detectClis`, `getLayout`, `setLayout`, `onSessionData`, `onSessionExit`. `ChorusApi` is inferred from the object. | `src/preload/index.ts` | 2026-07-19 |
| Storage — better-sqlite3 (WAL) at `userData/chorus.db`; **Drizzle for typed queries only**, migrations stay a hand-rolled `MIGRATIONS` array + `schema_migrations` runner (deliberate scope cut under D7). Applied versions: **1, 2**. Tables `projects` / `pane_layouts` / `settings` / `schema_migrations` / `sessions`. | `src/main/services/storage.ts`, `src/main/db/schema.ts` | 2026-07-19 |
| `sessions` table — `id` TEXT PK (stable UUID), `project_id` FK, `agent`, `cwd`, `status`, `exit_code`, `created_at`. | `src/main/db/schema.ts` | 2026-07-19 |
| `StorageService` API — `getOrCreateProject`, `getPaneLayout` (lazy legacy-flat → tree conversion, normalizes **in memory only**), `savePaneLayout` (clamps + upserts), `createSession`, `getSessionsForProject` (ordered by `created_at`), `updateSessionStatus`, `getWindowBounds`, `saveWindowBounds`, `close`. | `src/main/services/storage.ts` | 2026-07-19 |
| **`updateSessionStatus` exists but is unwired** — nothing calls it; DB `status` is never updated after row creation, and seeded rows are born `'running'`. Assigned to Task 1-4 (D11). | `src/main/services/storage.ts` | 2026-07-19 |
| Notifications — exit toast wired with show/failed logging. Windows delivery **verified blocked** on the dev machine by system-wide `ToastEnabled=0` (HRESULT `0x803E0114`). Dev AUMID Start-menu shortcut `Chorus (Dev).lnk` written idempotently. | `src/main/services/notifications.ts` | 2026-07-18 |
| Window-bounds persistence fires **only on interactive drag** (`'resized'`/`'moved'`). Programmatic resize and maximize are **not** persisted. | main window mgmt | 2026-07-18 |

### Shared & renderer

| Fact | Where | Verified |
|---|---|---|
| `src/shared/layout.ts` is a **pure, immutable, no-op-on-invalid** module: `clampRatio`, `createLeaf`, `splitPane`, `removePane`, `setRatio`, `changeDirection`, `swapPanes`, `collectSessionIds`, `findLeaf`, `normalizeTree`, `convertLegacyFlatLayout`. Tree invariants at every boundary: exactly 2 children per internal node, ratios ∈ [0.05, 0.95], no duplicate `sessionId`s, ≥1 leaf, `version: 1`. | `src/shared/layout.ts`, `layout.test.ts` | 2026-07-19 |
| `layout:get` returns `{layout, sessions: [{id, agent, status}]}`; `layoutJsonSchema` / `layoutNodeSchema` (recursive via `z.lazy`) exported from shared, parsed in main. Legacy flat-array schemas retained for conversion. | `src/shared/ipc.ts` | 2026-07-19 |
| `App.vue` makes **one** `layout:get` round-trip on mount → seeds the layout store + a `sessions` ref; `agentFor(id): AgentKind \| undefined`; renders `<LayoutRenderer v-if="layout.tree">` with **no `v-else`** (a null tree renders nothing — Task 1-4 adds `EmptyState`). | `src/renderer/src/App.vue` | 2026-07-19 |
| `LayoutRenderer.vue` — recursive; props `{node, path: (0\|1)[], agentFor}`. Internal nodes render splitpanes; leaves mount `TerminalPane`; a leaf with a missing session row renders a placeholder that holds the geometry. `@resize` reads `payload.panes[0].size / 100` (real v4 API — **not** the old spec sketch's `sizes[]`), rAF-batched into `applyRatio`. splitpanes owns no layout state. | `src/renderer/src/components/LayoutRenderer.vue` | 2026-07-19 |
| `stores/layout.ts` — `{tree, dirty}`; `loadLayout(layout)` takes the tree as a **parameter**; `applyRatio`; `removeLeaf` (**early-returns rather than dropping the last leaf** — a Phase-1 close-guard Task 1-4 removes); `schedulePersist()` debounces 500 ms and sends a plain JSON snapshot (D14). | `src/renderer/src/stores/layout.ts` | 2026-07-19 |
| `TerminalPane.vue` — props `{sessionId, agent}`; attaches by `sessionId`; xterm **scrollback 5 000**, `.xterm-viewport` scrollbar hidden; ResizeObserver → continuous `fit()` + **150 ms-debounced** `resizeSession`. Header: label, dot, **Split ⬌/⬍ disabled**, Restart, Kill, ✕ close guarded by **`isLastLeaf`** (both guards come down in 1-4). | `src/renderer/src/components/TerminalPane.vue` | 2026-07-19 |
| **The Pinia session store is still keyed by `AgentKind`** — `Record<AgentKind, PaneSessionState>` with two pre-seeded slots (`claude`, `codex`), and `TerminalPane` reads through `props.agent` for `sessions[…]`, `dotStatus`, `setBusy`, `attached`, `exited`. Correct only while one session per kind exists. Rekey assigned to Task 1-4 (D10). | `src/renderer/src/stores/session.ts` | 2026-07-19 |
| Renderer components: `LayoutRenderer.vue`, `TerminalPane.vue`. Stores: `layout.ts`, `session.ts` (+ `layout.test.ts`). `LaunchDialog.vue` / `EmptyState.vue` do **not** exist — Task 1-4 creates them. | `src/renderer/src` | 2026-07-19 |
| **Harness caveat (F3):** `TaskStop` kills only the wrapper shell — `npm run dev` descendants (electron, PTY children) survive as orphans and hold the CDP port. Any "restart the app" check must kill the process **tree** (`taskkill /PID <root> /T /F`) and confirm port rebind, or the "fresh boot" is the old window. `ComSpec` must also be restored for npm/app launches. | execution sessions | 2026-07-19 |

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
| D14 | **Renderer→main IPC payloads must be plain objects.** Pinia state is a Vue reactive Proxy and Electron's structured clone refuses it — `Error: An object could not be cloned`, with **no compile-time signal**. Found at runtime in Task 1-3 (`setLayout(this.tree)`); fixed by sending `JSON.parse(JSON.stringify(tree))` from the store's persist path. Binds every task from here on: anything sourced from a store or `reactive()`/`ref()` gets snapshotted before crossing the bridge. **Candidate for promotion into `CLAUDE.md`** alongside the existing D1 CSP/Zod rule — same class of hazard (a boundary constraint invisible to the type system). | RESOLVED 2026-07-19 |
| D13 | **`getPaneLayout` normalization is read-path, in-memory only** — a corrupted-but-parseable tree self-heals on the first `savePaneLayout`, not on read. Accepted: silent write-back on read would muddy the lazy-conversion semantics. | RESOLVED 2026-07-19 |

Also ratified from that review, no ID needed: `z.uuid()` over the Zod-4-deprecated `z.string().uuid()`; `layout:get` responses parsed outbound in main as well as inbound; first-run seeding of two default panes stands until Task 1-4 switches it to an empty layout (already carried in Task-1-4.md).

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

### Phase 1 — Grid + Projects — ▶ IN PROGRESS (2 of 5 tasks landed)

_Decomposed into five serial tasks — see [`Tasks/Phase-1-Overview.md`](Tasks/Phase-1-Overview.md) and the paired `Tasks/Task-1-#.md` / `ImplementationSpecs/ImplementationSpec-1-#.md` docs. D7/D8/D9 resolved at kickoff; D10–D13 added from the Task 1-2 review (§6)._

| Task | Scope | Status |
|---|---|---|
| **1-1** Tailwind + session lifecycle UI | Status dots driven by exit codes; restart/kill per pane, incl. clean process-tree kill; exit banner removed. | ✅ `185f972` |
| **1-2** Data layer | Drizzle typed queries; migration v2 (`sessions`); stable session ids; flat layout → versioned binary tree (lazy conversion); Vitest (24 tests). Zero visual change. | ✅ `81e8a0b` |
| **1-3** Layout view | `LayoutRenderer.vue` over the persisted tree via splitpanes; `layout:set` IPC; debounced PTY resize; close-kills-session. **Spike gate returned GO** (12/12 checks, ~45 min of a 4h box). Split buttons disabled as planned. Filmstrip spike ran and was deleted; notes kept. Produced D14 + findings F2/F3/F4. | ✅ `e7d6e60` |
| **1-4** Launch dialog + multi-session | Store rekey (D10) first; then `session:launch`, `LaunchDialog`, `EmptyState`, split enabled, N sessions per agent kind. Also clears 1-3's two empty-layout guards and wires D11. | ▶ **NEXT** |
| **1-5** Project tabs | Project tabs + full persistence/restore of projects + layout + sessions on restart. | Pending |
| → **Phase 1b** | Focus + Filmstrip default layout; `Ctrl+K` palette skeleton; session auto-titling. Split out 2026-07-18 to keep Phase 1 at five bounded tasks; own kickoff after 1-5. The timeboxed filmstrip spike in Task 1-3 de-risks it early (council action item 6). | Deferred |

**[CR] checkpoint (1.2):** _splitpanes library vs. custom split-tree vs. hybrid_ — **CLOSED** as **D9**, unanimous 3-of-3. Brief: `CouncilBriefs/CouncilBrief-1.2-LayoutEngine.md`; findings: `docs/architecture/CR-1.2-pane-layout-council-findings.md`. The remaining open question is empirical, not architectural: Task 1-3's spike gate decides splitpanes vs. custom renderer behind the same adapter contract.

**Milestone:** many sessions across multiple projects — restart-safe and killable.

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

**Task 1-4 is next.** Its execution prompt is generated: [`Tasks/Task-1-4-ExecutionPrompt.md`](Tasks/Task-1-4-ExecutionPrompt.md). Open a fresh conversation with it, against `Task-1-4.md` + `ImplementationSpec-1-4.md`.

Task 1-4 is the widest task in Phase 1: it carries the **D10 store rekey** (as a standalone step 0), the launch flow proper, the removal of 1-3's two empty-layout guards, and the **D11** `updateSessionStatus` wiring. D14 makes its runtime verification non-optional.

After 1-4 lands: `/architect` to re-sync, then `/phase-prompt` for Task 1-5 (project tabs + restore) — which inherits **F4**'s reconciliation problem in full.

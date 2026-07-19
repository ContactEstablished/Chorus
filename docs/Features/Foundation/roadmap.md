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

Re-verified **2026-07-19** against the codebase at commit `c91aea1` (Task 1-4 landed; planning docs committed as `dd75dc1`; working tree clean). Facts carried forward unchanged from 2026-07-18 keep that date; anything re-read today is dated 2026-07-19.

### Status & toolchain

| Fact | Where | Verified |
|---|---|---|
| Phase 0 complete through `f0d409b`. Trail: `80e69c3` (0.2 single Claude Code terminal), `45c5b2b` (0.3 two agents side-by-side + CLI detection), `f0d409b` (0.4 SQLite persistence + exit notifications), `ae4eba4` (docs). | git log | 2026-07-18 |
| **Phase 1.1 landed** as `185f972` (Tailwind + per-pane lifecycle controls). **1.2** as `81e8a0b` (Drizzle, stable session ids, layout tree, Vitest). **1.3** as `e7d6e60` (LayoutRenderer over the split tree, debounced PTY resize, close-kills-pane). **1.4** as `c91aea1` (launch dialog + true multi-session). All four reviewed; 1-2's review produced D10–D13, 1-3's D14 + F2/F3/F4, 1-4's D15 + F5–F9. | git log | 2026-07-19 |
| **`npm run typecheck` exits 0** (node + web). **`npx vitest run` = 38/38 green** across three files (`src/shared/layout.test.ts`, `src/shared/ipc.test.ts`, `src/renderer/src/stores/layout.test.ts`). | run today | 2026-07-19 |
| Deps: electron `43.1.1`, vue `3.5.25`, pinia `4.0.2`, vite `7.2.6`, vitest `4.1.10`, zod `4.4.3`, drizzle-orm `0.45.2` + drizzle-kit `0.31.10`, tailwindcss + `@tailwindcss/vite` `4.3.3`, `@xterm/xterm` `6.0.0` + addon-fit `0.11.0`, better-sqlite3 `12.11.1`, node-pty `1.1.0`, **`splitpanes` `~4.1.2`** (installed by 1-3 on the spike GO). | `package.json` | 2026-07-19 |
| Scripts: `dev`, `start`, `build`, `typecheck` (`:node` + `:web`), `test` (`vitest run`), `rebuild:better-sqlite3`. | `package.json` | 2026-07-19 |
| better-sqlite3 **12.11.1** — no electron-v148 (Electron 43) prebuild on npm; MSVC 17.14 ICEs (`C1001`, `sqlite3.c`) at `/O2`. `.npmrc` pins `runtime=electron`; `npm run rebuild:better-sqlite3` builds with `/Od`. **Drop both when ≥12.11.2 reaches npm.** Note: the 1-2 dependency install needed **no** rebuild (no ABI error surfaced). | `.npmrc`, package scripts | 2026-07-19 |
| node-pty **1.1.0** — in-package N-API prebuilds; **no electron-rebuild ever** (broken on Windows). | package | 2026-07-18 |
| Dev-machine CLIs — `claude.exe` 2.1.207 (native exe), `codex-cli` 0.135.0 (npm `.cmd` shim, spawned via `cmd.exe /c`), git 2.50.0, docker 28.0.4, node 22.14.0. | dev machine | 2026-07-18 |

### Main process

| Fact | Where | Verified |
|---|---|---|
| `SessionManager` — `Map<string, PtySession>` keyed by **stable DB session row id**; supports **N concurrent same-kind sessions** (`findByAgent` deleted in 1-4). Public: `launch(agent, cwd, sessionId)` (spawn under a caller-minted row id), `attach({sessionId, agent, respawn?}, cwd)` (view binding — **never spawns** unless `respawn: true`, which only the Restart chrome sends after kill + exit), `kill`, `write`, `resize`, `getAgent`, `onData`, `onExit` (listener **Sets** — multiple subscribers), `dispose`. | `src/main/services/sessionManager.ts` | 2026-07-19 |
| IPC — **11 channels**: `session:attach` / `launch` / `launch-context` / `write` / `resize` / `kill` (invoke), `session:data` / `exit` (events), `cli:detect`, `layout:get`, `layout:set`. All Zod-validated in **main only**. `session:launch` validates `cwd` (`path.isAbsolute` + `fs.existsSync`) **before** any row or PTY exists; `layout:set` accepts `layoutJsonSchema.nullable()` — a null tree DELETEs the `pane_layouts` row (absence = empty). `session:launch-context` serves `{projectRoot, recentCwds}` to the dialog, outbound-filtered in main. | `src/shared/ipc.ts`, `src/main/ipc.ts` | 2026-07-19 |
| Preload is a **Zod-free typed forwarder**; page CSP forbids Zod's `eval` (EvalError → silently dropped events). Surface: `attachSession`, `launch`, `getLaunchContext`, `detectClis`, `getLayout`, `setLayout` (nullable), `writeSession`, `resizeSession`, `killSession`, `onSessionData`, `onSessionExit`. `ChorusApi` is inferred from the object. | `src/preload/index.ts` | 2026-07-19 |
| Storage — better-sqlite3 (WAL) at `userData/chorus.db`; **Drizzle for typed queries only**, migrations stay a hand-rolled `MIGRATIONS` array + `schema_migrations` runner (deliberate scope cut under D7). Applied versions: **1, 2**. Tables `projects` / `pane_layouts` / `settings` / `schema_migrations` / `sessions`. | `src/main/services/storage.ts`, `src/main/db/schema.ts` | 2026-07-19 |
| `sessions` table — `id` TEXT PK (stable UUID), `project_id` FK, `agent`, `cwd`, `status`, `exit_code`, `created_at`. | `src/main/db/schema.ts` | 2026-07-19 |
| `StorageService` API — `getOrCreateProject` (**seeds nothing** since 1-4: project row only, no layout, no sessions), `getPaneLayout(): LayoutJson \| null` (lazy legacy-flat → tree conversion intact; null = empty), `savePaneLayout` (clamps + upserts), `clearPaneLayout` (deletes the row), `getRecentCwds` / `pushRecentCwd` (settings key `recent_cwds`, dedupe, cap 10, inline-Drizzle pattern), `createSession`, `getSessionsForProject` (ordered by `created_at`), `updateSessionStatus`, `getWindowBounds`, `saveWindowBounds`, `close`. | `src/main/services/storage.ts` | 2026-07-19 |
| **`updateSessionStatus` is wired (D11 closed):** a second `sessions.onExit` listener in `src/main/index.ts` writes `exited` + real exit code on PTY exit; the attach handler flips the row back to `running`/null on a Restart respawn. **Caveat (F6):** the listener often misses sessions alive at quit (`dispose()` kills PTYs but `storage.close()` runs before the async exit events land) — a persisted `running` means *"was running when last observed"*, never "is alive". | `src/main/index.ts`, `src/main/ipc.ts` | 2026-07-19 |
| Notifications — exit toast wired with show/failed logging. Windows delivery **verified blocked** on the dev machine by system-wide `ToastEnabled=0` (HRESULT `0x803E0114`). Dev AUMID Start-menu shortcut `Chorus (Dev).lnk` written idempotently. | `src/main/services/notifications.ts` | 2026-07-18 |
| Window-bounds persistence fires **only on interactive drag** (`'resized'`/`'moved'`). Programmatic resize and maximize are **not** persisted. | main window mgmt | 2026-07-18 |

### Shared & renderer

| Fact | Where | Verified |
|---|---|---|
| `src/shared/layout.ts` is a **pure, immutable, no-op-on-invalid** module: `clampRatio`, `createLeaf`, `splitPane`, `removePane`, `setRatio`, `changeDirection`, `swapPanes`, `collectSessionIds`, `findLeaf`, `normalizeTree`, `convertLegacyFlatLayout`. Tree invariants at every boundary: exactly 2 children per internal node, ratios ∈ [0.05, 0.95], no duplicate `sessionId`s, ≥1 leaf, `version: 1`. | `src/shared/layout.ts`, `layout.test.ts` | 2026-07-19 |
| `layout:get` returns `{layout, sessions: [{id, agent, status}]}`; `layoutJsonSchema` / `layoutNodeSchema` (recursive via `z.lazy`) exported from shared, parsed in main. Legacy flat-array schemas retained for conversion. | `src/shared/ipc.ts` | 2026-07-19 |
| `App.vue` — one `layout:get` round-trip on mount; renders `<LayoutRenderer v-if="layout.tree">` with a `v-else` **`EmptyState`**; hosts `LaunchDialog` and owns its open/close + split-target state. | `src/renderer/src/App.vue` | 2026-07-19 |
| `LayoutRenderer.vue` — recursive; props `{node, path: (0\|1)[], agentFor}`. Internal nodes render splitpanes; leaves mount `TerminalPane`; a leaf with a missing session row renders a placeholder that holds the geometry. `@resize` reads `payload.panes[0].size / 100` (real v4 API — **not** the old spec sketch's `sizes[]`), rAF-batched into `applyRatio`. splitpanes owns no layout state. | `src/renderer/src/components/LayoutRenderer.vue` | 2026-07-19 |
| `stores/layout.ts` — `{tree, dirty}`; `loadLayout(layout)` takes the tree as a **parameter**; `applyRatio`; `removeLeaf` (last-leaf removal now **sets `tree = null` and persists null** → row deleted); `insertLaunchedLeaf` (root on empty, or `splitPane` at a target); `schedulePersist()` debounces 500 ms and sends a plain JSON snapshot (D14). | `src/renderer/src/stores/layout.ts` | 2026-07-19 |
| `TerminalPane.vue` — props `{sessionId, agent}`; attaches by `sessionId` (**plain attach never respawns**; `respawn: true` only from Restart after kill + exit); xterm scrollback 5 000, scrollbar hidden; continuous `fit()` + 150 ms-debounced `resizeSession`. Header: label, dot, **Split ⬌/⬍ enabled** (emit `{targetSessionId, direction}`), Restart, Kill, ✕ close (last-leaf guard removed). | `src/renderer/src/components/TerminalPane.vue` | 2026-07-19 |
| **Session store rekeyed (D10 closed):** `Record<string /* sessionId */, PaneSessionState>`, entries created on attach/launch (never pre-seeded), `agent` is a data field, all actions take a `sessionId`. `TerminalPane` reads agent only for labels — never as a key. **Entries are never removed** when a leaf closes (lingers per app run; harmless at Phase-1 scale — restore must key off tree + rows, not the store). | `src/renderer/src/stores/session.ts` | 2026-07-19 |
| Renderer components: `LayoutRenderer.vue`, `TerminalPane.vue`, `LaunchDialog.vue` (agent cards from `cli:detect`, cwd + recents from `launch-context`, inline `{ok:false}` errors), `EmptyState.vue`. Stores: `layout.ts`, `session.ts` (+ `layout.test.ts`). | `src/renderer/src` | 2026-07-19 |
| **(F5) Vue remounts surviving panes when a sibling leaf closes** — `removePane` restructures the tree and the vdom position of survivors changes despite stable `:key`s, so `TerminalPane`'s mount-time attach re-runs. Attach is therefore a **view binding, not a lifecycle hook**: any attach-time side effect must assume remounts. This is why plain attach must never spawn (an ungated attach resurrected killed sessions — the one runtime bug of 1-4, fixed via the `respawn` gate). | renderer + `sessionManager.ts` | 2026-07-19 |
| **(F4) Session rows and layout leaves drift apart in both directions, by design** — rows outlive leaves (close-pane; close-all leaves N rows, 0 leaves), and leaves reference dead sessions (every restart). `LayoutRenderer`'s placeholder covers leaf-without-row. A failed `session:launch` spawn can also orphan a row with no PTY; **no delete-session API exists**. Reconciliation is Task 1-5's contract. | storage + renderer | 2026-07-19 |
| **Harness caveats (F3/F7/F8/F9):** `TaskStop` kills only the wrapper shell — kill the process **tree** (`taskkill /PID <root> /T /F`) + confirm CDP port rebind, or the "fresh boot" is the old window. `ComSpec` + registry PATH must be restored. `npx`/`npm run` prepend the npm-global dir to child PATH (defeats missing-CLI simulation — invoke `node node_modules/electron-vite/bin/electron-vite.js dev` directly; its own `--` passes `--remote-debugging-port`). electron-vite HMR covers the renderer only — main-process edits need a full relaunch. Orphan checks must walk the electron PID's descendant tree, not grep `tasklist` (the dev machine runs ~16 unrelated `claude.exe`). `window.confirm` blocks the renderer thread — CDP must fire the click async and dismiss with a real mouse click. | execution sessions | 2026-07-19 |

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
| D16 | **The session restore contract** (CR-1.5, 3-model council; brief `CouncilBriefs/CouncilBrief-1.5-RestoreContract.md`, findings `CouncilBriefs/CouncilFindings-1.5-RestoreContract.md`). **Q1 — reconcile-on-boot (C), 2-of-3.** No schema change; `status='running'` read through a deterministic boot/activation reconcile pass; quit and crash converge by construction. *Gemini dissent preserved:* a `desired_state` intent column (B) is the cleaner model — adopt it when a user-facing "don't restore" toggle lands (Phase 2+). **Q2 — restore set, unanimous:** `{leaf.sessionId | leaf ∈ layout ∧ row.status='running'}`. Leaves∩exited → exited chrome + Restart; leaves-without-row → placeholder; **`running` rows without a leaf are healed to `exited` before any spawn** (the invisible-process guard). `session:delete` IPC ships (rejects live sessions). **Q3 — guarded-auto-relaunch, 2-of-3:** cwd `existsSync` before each spawn (missing → exited chrome, "Working directory not found"); 500 ms spawn stagger (250 ms if ConPTY tolerates); a transient "Session restarted — new conversation" badge (~5 s) on every restored pane; pane cap 16. *GPT dissent preserved:* affordance-driven ("Relaunch all") is more honest — the revert is renderer-only if auto proves confusing. **Q4 — unanimous:** Restart (in-run *and* post-restart) routes through a new `session:restart` channel → the launch path under the existing row id, with cwd re-validation; the D15 `respawn` attach flag is **removed** (see D15 supersession). **Coordinator resolutions (Matthew-approved 2026-07-19):** (a) `status='running'` is written **only after** spawn succeeds — supersedes findings Q4 step 3, per the findings' own Risk 1; (b) the "PID-prefix orphan scan" mitigation is dropped (contradicts the findings' own Q5 rejection of PID tracking); (c) the "Choose directory" re-homing action is trimmed to the not-found message — re-homing is Phase 2; (d) no context-menu/session-list UI — **pane close deletes the session row** after kill/exit completes (leafless rows are unreachable under the Q2 restore set, so close-flow deletion is the coherent cleanup); channels are singular (`session:delete`/`session:restart`); cwd-missing renders as its own chrome state, not a sentinel `exit_code=-1`; findings action item 7 (layout-tree migration) was already satisfied by `81e8a0b`. | RESOLVED 2026-07-19 (council + coordinator resolutions) |

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
| **1-4** Launch dialog + multi-session | D10 rekey landed first as a verified standalone refactor; explicit launch flow (`session:launch` + dialog + empty state); N sessions per agent kind proved (3 panes, 2 independent Codex TUIs); both 1-3 guards cleared; D11 wired. One runtime bug (F5 attach-resurrection) found, fixed via the `respawn` gate (D15), re-verified. | ✅ `c91aea1` |
| **1-5** Project tabs + restore | Project tabs + full persistence/restore per the **D16 restore contract** (reconcile-on-boot; leaves∩running restore set; guarded-auto-relaunch; unified `session:restart`; close-flow row deletion). **CR-1.5 CLOSED** 2026-07-19 — findings recorded as D16 with two dissents preserved. Closes Phase 1. | ▶ **NEXT** |
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

**Task 1-5 is next; CR-1.5 is closed (D16).** Its execution prompt is generated: [`Tasks/Task-1-5-ExecutionPrompt.md`](Tasks/Task-1-5-ExecutionPrompt.md). Open a fresh conversation with it, against `Task-1-5.md` + `ImplementationSpec-1-5.md` (both finalized from the D16 contract).

Task 1-5 closes Phase 1. After it lands: `/architect` to re-sync, then `/phase-kickoff` for **Phase 1b** (Focus + Filmstrip, `Ctrl+K` palette skeleton, session auto-titling — the filmstrip spike notes from 1-3 are its starting input).

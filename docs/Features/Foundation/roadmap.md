# Chorus v1 — Master Roadmap (Foundation)

_Location: `docs/Features/Foundation/roadmap.md` · Last updated: 2026-07-18_

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

All facts verified **2026-07-18** against the codebase.

| Fact | Where | Verified |
|---|---|---|
| Phase 0 complete through commit `f0d409b`. Trail: `80e69c3` (0.2 single Claude Code terminal), `45c5b2b` (0.3 two agents side-by-side + CLI detection), `f0d409b` (0.4 SQLite persistence + exit notifications), `ae4eba4` (docs). | git log | 2026-07-18 |
| `SessionManager` — `Map<sessionId, PtySession>`, one live session per agent kind (`'claude' \| 'codex'`), 4 MB replay ring buffer, `dispose()` kills all PTYs. | `src/main/services/sessionManager.ts` | 2026-07-18 |
| IPC — 7 channels (`session:attach`/`write`/`resize`, `session:data`/`exit` events, `cli:detect`, `layout:get`), all Zod-validated in **main only**. | `src/shared/ipc.ts` | 2026-07-18 |
| Preload is a **Zod-free typed forwarder** — page CSP forbids Zod's `eval` (EvalError → silently dropped events). | `src/preload/index.ts` | 2026-07-18 |
| Storage — better-sqlite3, `chorus.db` in userData, versioned migrations, tables `projects` / `pane_layouts` / `settings` / `schema_migrations` (per PLAN §13 naming). | `src/main/services/storage.ts` | 2026-07-18 |
| Notifications — exit toast wired with show/failed logging. Windows delivery **verified blocked** on the dev machine by system-wide `ToastEnabled=0` (HRESULT `0x803E0114`). Dev AUMID Start-menu shortcut `Chorus (Dev).lnk` written idempotently. | `src/main/services/notifications.ts` | 2026-07-18 |
| better-sqlite3 **12.11.1** — no electron-v148 (Electron 43) prebuild on npm; MSVC 17.14 ICEs (`C1001`, `sqlite3.c`) at `/O2`. `.npmrc` pins `runtime=electron`; `npm run rebuild:better-sqlite3` builds with `/Od`. **Drop both when ≥12.11.2 reaches npm.** | `.npmrc`, package scripts | 2026-07-18 |
| node-pty **1.1.0** — in-package N-API prebuilds; **no electron-rebuild ever** (broken on Windows). | package | 2026-07-18 |
| Dev-machine CLIs — `claude.exe` 2.1.207 (native exe), `codex-cli` 0.135.0 (npm `.cmd` shim, spawned via `cmd.exe /c`), git 2.50.0, docker 28.0.4, node 22.14.0. | dev machine | 2026-07-18 |
| Window-bounds persistence fires **only on interactive drag** (`'resized'`/`'moved'`). Programmatic resize and maximize are **not** persisted. | main window mgmt | 2026-07-18 |
| Renderer pane layout is fetched from DB via `layout:get` — seeded slot 0 = claude, slot 1 = codex, fixed 50/50 flexbox. | renderer | 2026-07-18 |

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
| D9 | Pane layout engine (CR-1.2): **Option C — owned binary split tree as persisted data model; splitpanes@~4.1.2 as dumb grid renderer behind a `LayoutRenderer.vue` adapter.** Council verdict unanimous 3-of-3 (Claude, Gemini, GPT); Gemini dissent-on-preference for full custom (B) recorded, conceded on implementation risk. **Escape hatch: if the xterm-in-splitpanes spike (timeboxed, go/no-go) fails, fall back to B — the tree model carries over unchanged.** Serialized schema: versioned binary tree, leaves bind `sessionId`, ratios clamped [0.05, 0.95], invariants Zod-enforced in main per D1. PTY resize: continuous `fit()`, debounced `pty.resize` (150 ms / drag-end). Brief: `CouncilBriefs/CouncilBrief-1.2-LayoutEngine.md` · Findings: `docs/architecture/CR-1.2-pane-layout-council-findings.md`. splitpanes 4.1.2 existence/recency verified on npm 2026-07-18. | RESOLVED 2026-07-18 (council, unanimous) |

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

### Phase 1 — Grid + Projects — ▶ NEXT (kickoff complete 2026-07-18)

_Decomposed into five serial tasks — see [`Tasks/Phase-1-Overview.md`](Tasks/Phase-1-Overview.md) and the paired `Tasks/Task-1-#.md` / `ImplementationSpecs/ImplementationSpec-1-#.md` docs. D7/D8/D9 resolved at kickoff (§6). Task 1-1 is ready for `/phase-prompt`._

| Sub-phase | Scope | Why |
|---|---|---|
| 1.1 Session lifecycle UI | Status dots driven by exit codes; restart/kill per pane, incl. **clean process-tree kill**; replace the exit banner. | Make sessions observable and controllable, not just visible. |
| 1.2 Split-tree layout | Binary split-tree pane layout serialized to `pane_layouts`; cap ~12–16 panes. **[CR candidate]** | Move beyond the fixed 50/50 seed to arbitrary user layouts. |
| 1.3 Launch dialog | Dialog for agent + cwd + workspace-mode _stub_; **multiple concurrent sessions per agent kind** (`SessionManager` grows past one-per-agent). | Lift the one-live-session-per-kind constraint from Phase 0. |
| 1.4 Project tabs | Project tabs + **full persistence/restore** of projects + layout + sessions on restart. | Deliver the restart-safe prime-contract promise. |
| 1.5 → **moved to Phase 1b** | Focus + Filmstrip default layout; `Ctrl+K` palette skeleton; session auto-titling. Split out 2026-07-18 at kickoff to keep Phase 1 at five bounded tasks; gets its own kickoff after 1.4 lands. A timeboxed filmstrip architecture spike rides along in Task 1-3 to de-risk it early (council action item 6). | Keep phase size executable. |

**[CR] checkpoint (1.2):** _splitpanes library vs. custom split-tree vs. hybrid_ — now tracked as **D9**; brief issued 2026-07-18 (`CouncilBriefs/CouncilBrief-1.2-LayoutEngine.md`), findings pending.

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

Phase 1 (Grid + Projects) is next but not yet decomposed. Start it by running **`/phase-kickoff`** for Phase 1 against this roadmap — it will verify ground facts, resolve **D7** (Drizzle) and **D8** (Tailwind), and author `Phase-1-Overview.md` plus the paired `Task-1-#.md` / `ImplementationSpec-1-#.md` files under `docs/Features/Foundation/`. Flag the 1.2 layout-engine **[CR]** checkpoint at kickoff.

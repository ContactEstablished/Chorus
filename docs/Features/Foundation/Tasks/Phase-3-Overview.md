# Phase 3 — BYOK Vault + Adapters

## Source Of Truth

- Roadmap: `docs/Features/Foundation/roadmap.md` — §5 (Verified Ground Facts), §6 decisions **D28–D32** (this kickoff), §7 Phase 3 sketch, and the "Open items Phase 3 inherits" list.
- Council (pending): `CouncilBriefs/CouncilBrief-3.0-Vault.md` (credential vault security) and `CouncilBriefs/CouncilBrief-3.1-AdapterInterface.md` (adapter interface shape). **Both are [CR] gates — see "Council checkpoints" below.** Their findings become D33/D34 and, where they conflict with anything sketched here, **the ratified findings win**.
- `docs/PLAN.md` §4 (Adapter Abstraction — the `AgentAdapter` interface and `AgentCapabilities`), §6 (Credentials, Providers, BYOK), §12 (Permissions — the honest version), §13 (target data model: `credential_profiles`, `provider_configs`), §14 (Phase 3 line).
- Project rules: `CLAUDE.md` (locked architecture; D1 Zod-in-main; D14 plain-object IPC; secrets via safeStorage, injected as env vars into child PTYs, never in args/logs/transcripts; verify CLI flags against `--help` at execution time).
- **Verified codebase state: 2026-07-21, commit `04a8a0d`** (Phase 2 complete, clean tree). Each task doc anchors insertion points to **named symbols**, never line numbers (house rule, per `Phase-1b-Overview.md` and `Phase-2-Overview.md`).

## Goal

Phases 0–2 made Chorus a real multi-agent workspace, but every agent still launches on the developer's own ambient credentials: `SessionManager.spawn` passes `env: process.env` through untouched, and D5 ("child PTYs inherit env untouched; no credentials injected/logged anywhere") has stood since Phase 0. Phase 3 replaces that with **bring-your-own-key**: a DPAPI-backed credential vault, provider and credential-profile records, the first real **`AgentAdapter`** abstraction over the two-value `AgentKind` enum, and **env-var injection of decrypted keys into child PTYs at launch** — decrypted in main, at launch, and nowhere else. The phase's prime directive is the mirror of Phase 2's: **a key never reaches a command line, a log file, a transcript, the renderer, or disk in plaintext.** Supporting that claim — not merely implementing it — is what the phase is judged on.

## Scope boundary (D28 — Matthew, 2026-07-21)

The roadmap's provisional Phase 3 line listed ten deliverables; its stated milestone needs only the first four. **Phase 3 is scoped tight to its own milestone.** Model catalog caching, effort normalization, launch profiles, and `usage_records` move to a new provisional **Phase 3a — Profiles & Catalog** (§7). This keeps the security-critical vault and the hard-to-reverse adapter interface from sharing execution sessions with UI polish.

| Roadmap §7 Phase 3 item | Phase 3 | Deferred |
|---|:---:|---|
| safeStorage/DPAPI vault | ✅ 3-2 | |
| `credential_profiles` | ✅ 3-2 | |
| provider configs | ✅ 3-2 | |
| `AgentAdapter` interface + capabilities | ✅ 3-3 | |
| provider/credential settings UI | ✅ 3-4 | |
| env-var injection into child PTYs (supersedes D5) | ✅ 3-5 | |
| pino secret-redacting logging | ✅ 3-1 | |
| test-key | ✅ 3-5 (single live probe, no cache) | |
| model catalog (`model_catalog` table + refresh) | | **Phase 3a** |
| effort normalization (Fast/Balanced/Deep/Max) | | **Phase 3a** |
| launch profiles (`launch_profiles`) | | **Phase 3a** |
| `usage_records` capture | | **Phase 3a** (PTY agents emit no token counts; the table needs an api-mode producer to be honest) |

## The Five Tasks

Phase 3 is decomposed into five tasks executed **serially**. 3-1 clears two carry-over defects and lays the secret-safe logging spine *before any secret exists*; 3-2 builds the vault and its data layer; 3-3 refactors the launch path behind `AgentAdapter` with zero behavior change; 3-4 ships the first real Settings view over 3-2's channels; 3-5 injects credentials into child PTYs and closes the milestone.

| Task | One-line scope | Depends on | CR gate |
|------|----------------|------------|---------|
| **3-1** | **Carry-over fixes + secret-safe logging spine.** A flagged chore commit first (D32): **F21** (a distinct branch-force acknowledgment so main can never `-D` an unmerged branch on a clean worktree) and **F23** (a palette launch must not replace the whole layout tree). Then the task commit: `pino` + a redacting serializer, the 24 main-process `console.*` calls migrated onto it, and a repo secret-grep script for G4. | Phase 2 | — |
| **3-2** | **Vault + credential/provider data layer.** Migration v5 (`provider_configs`, `credential_profiles`); a `CredentialVault` service over Electron `safeStorage` (DPAPI); storage accessors; `provider:*` / `credential:*` IPC with all Zod in main; preload forwarders. **No UI** — the same shape as Task 2-1. | 3-1 | **CR-3.0** |
| **3-3** | **`AgentAdapter` interface + capabilities + launch-path refactor.** `src/main/adapters/` with the interface, a `claude-code` adapter, a `codex` adapter, and a registry; `SessionManager.spawn` consumes a `ProcessLaunchRequest` instead of calling `resolveCli` itself; `cli:detect` routes through `detectInstallation()`. **Zero behavior change** — a pure refactor. | 3-2 | **CR-3.1** |
| **3-4** | **First real Settings view (D29).** Providers and credential profiles CRUD over 3-2's channels; auth methods rendered from 3-3's `getAuthMethods()`/`getCapabilities()`. Plaintext keys are write-only: they travel renderer→main once and are never read back. | 3-3 | — |
| **3-5** | **BYOK env injection + test-key.** The launch path resolves a credential profile, main decrypts **at launch only**, and the adapter's `buildLaunch` puts the key in the child PTY's `env` — never in args. Launch dialog gains auth-method/credential selection. Test-key = one live provider probe. **G4 mandatory.** Supersedes D5 and closes the milestone. | 3-4 | — |

Dependency chain: **3-1 → 3-2 → 3-3 → 3-4 → 3-5** (strictly serial).

### Authoring status

**Only Task 3-1 is authored at this kickoff.** Tasks 3-2 through 3-5 are deliberately **not written yet**: 3-2's schema and vault surface are the subject of CR-3.0, 3-3's interface is the subject of CR-3.1, and 3-4/3-5 both consume shapes those two councils may change. Writing their specs first would mean discarding them. They are authored in a follow-up `/phase-kickoff` pass once the findings are filed and ratified as D33/D34.

### File-ownership matrix

Overlapping files across tasks are **legal only because execution is serial** — each later task starts only after the prior task's commit exists, and touches a disjoint region of any shared file.

| File | 3-1 | 3-2 | 3-3 | 3-4 | 3-5 |
|------|:---:|:---:|:---:|:---:|:---:|
| `package.json` (`pino`, `grep:secrets`) | **edit** | — | — | — | — |
| `scripts/secret-grep.mjs` | **create** | run | run | run | run |
| `src/main/services/logger.ts` | **create** | consume | consume | — | consume |
| `src/main/services/logger.test.ts` | **create** | — | — | — | — |
| `src/main/services/vault.ts` | — | **create** | — | — | consume |
| `src/main/adapters/**` | — | — | **create** | — | **edit** (injection) |
| `src/main/db/schema.ts` | — | **edit** (v5 tables) | — | — | — |
| `src/main/services/storage.ts` | edit (logger) | **edit** (v5 + accessors) | — | — | — |
| `src/main/services/sessionManager.ts` | edit (logger) | — | **edit** (`ProcessLaunchRequest`) | — | edit (env) |
| `src/main/services/cliDetect.ts` | — | — | **edit** (behind adapters) | — | — |
| `src/main/services/worktrees.ts` | edit (logger) | — | — | — | — |
| `src/main/services/notifications.ts` | edit (logger) | — | — | — | — |
| `src/main/index.ts` | edit (logger init) | edit (vault init) | — | — | — |
| `src/shared/ipc.ts` | **edit** (F21 field) | edit (vault channels) | edit (capabilities) | — | edit (launch cred) |
| `src/main/ipc.ts` | **edit** (F21 gate) | edit (vault handlers) | edit (detect via adapters) | — | edit (injection) |
| `src/preload/index.ts` | — | edit (forwarders) | — | — | edit (forwarder) |
| `src/renderer/src/stores/layout.ts` | **edit** (F23 fix) | — | — | — | — |
| `src/renderer/src/components/LaunchDialog.vue` | — | — | edit (capability-driven) | — | **edit** (auth/cred) |
| `src/renderer/src/views/Settings*.vue` | — | — | — | **create** | — |
| `src/renderer/src/App.vue` | **edit** (F23 anchor) | — | — | **edit** (view switch) | — |
| `src/shared/ipc.test.ts` | edit | edit | edit | — | edit |
| `src/renderer/src/stores/layout.test.ts` | **edit** (F23 cases) | — | — | — | — |

`src/preload/index.d.ts` is never hand-edited — `ChorusApi` is inferred from the preload object. **`WorktreePanel.vue` is deliberately absent from this matrix:** F21 is fixed as a main-side gate only, which leaves `-D` with zero callers — no renderer affordance is added, in Task 3-1 or later in the phase.

Because ownership overlaps across the serial chain, every task doc repeats the same guard: implementers work only inside their listed scope and **must not revert, stage, or commit files they did not change**, including untracked `_verify/` harness artifacts and anything under `docs/`.

## Shared Context — what Phase 2 left behind that binds here

Phase 3 builds on these facts; implementers do not relitigate them.

- **Env is currently inherited whole.** `SessionManager.spawn` calls `pty.spawn(cli.file, cli.args, { …, env: process.env as Record<string, string> })` with a comment stating that both agents use their own subscription logins and no credentials are injected. **That comment is D5, and Task 3-5 supersedes it** — but only 3-5. Tasks 3-1 through 3-4 leave the spawn env untouched.
- **`AgentKind` is a two-value Zod enum** (`z.enum(['claude','codex'])` in `src/shared/ipc.ts`) threaded through the launch/attach/restart schemas, `sessions.agent`, `resolveCli(agent)`, the LaunchDialog's `labels`/`AGENT_KINDS` constants, and the palette. Task 3-3 introduces adapters **behind** that enum: the wire vocabulary stays `'claude' | 'codex'` so no migration and no renderer churn is needed. Widening the wire type is Phase 3a's problem, not 3-3's.
- **CLI resolution is `where.exe`-based and memoized.** `cliDetect.ts` exports `resolveCli(name)` (throws when nothing spawnable is found; prefers a real `.exe`, falls back to `cmd.exe /c <shim>`), `DETECTED_TOOLS = ['claude','codex','git','docker','node']`, and a memoized `detectClis()`. Task 3-3 moves the *agent* entries behind `detectInstallation()`; git/docker/node stay plain tool probes.
- **Migrations are a hand-rolled numbered array.** `MIGRATIONS: string[]` in `storage.ts`, applied in order inside a transaction by `migrate()`, tracked in `schema_migrations`. Four are applied on the real dev DB. Task 3-2 adds **v5** and it must apply **in place, with zero data loss** — the same bar migration v4 met.
- **FKs are ENFORCED (F16).** better-sqlite3 12.11.1 defaults `PRAGMA foreign_keys=ON`. Any new `REFERENCES` clause in v5 is a real constraint: insert order matters and deleting a referenced parent throws. Design `credential_profiles` → `provider_configs` accordingly.
- **Preload is a Zod-free typed forwarder (D1).** The page CSP forbids Zod's `eval`; every schema parse lives in main. This is doubly load-bearing this phase: the preload must also never become a place where a plaintext key can be observed.
- **F13 — async `onMounted` bail rule.** Any new component with awaits in `onMounted` (the Settings view in 3-4) must bail after each `await` if it may have unmounted; `cleanups` arrays run exactly once, so post-cleanup registrations leak for the app's lifetime.
- **F20 verification-provenance rule (standing).** Execution sessions run with a **redirected `AppData` but a real `C:\Projects`**: their filesystem/git evidence is trustworthy, their **database** evidence describes a different DB. Every implementer dump must quote the `projects` table; the coordinator re-verifies DB claims against the real `%APPDATA%\chorus\chorus.db` (projects `985d547b…` / `f47ac10b…`).
- **Harness caveats pointer (roadmap §5, F3/F7/F8/F9/F11).** CDP on `--remote-debugging-port=9222` is the proven runtime driver (`Runtime.evaluate` in IIFEs, `Page.captureScreenshot`, `Input.insertText`); `ws` lives in the session scratchpad, never the repo; kill process **trees** (`taskkill /PID <root> /T /F`); graceful-quit test = `taskkill` without `/F`; electron-vite does **not** hot-restart main, so every main-process check needs a cold boot; `ELECTRON_RUN_AS_NODE=1` scripts print nothing to a console (write to a file) and **intermittently produce no file on first run — retry once**; `sqlite3` is NOT installed (use the `_verify/2-1-dump.js` pattern). **Claude Code CLI is currently UNAUTHENTICATED** (token expired) — runtime tests needing a real agent reply should prefer Codex or plain observation. Note that this phase gives the expired-token situation a second use: it is a genuine fixture for "launched with an injected key" vs "launched on subscription auth".

## Decisions (Matthew, 2026-07-21 — quoted, not relitigated)

- **D28 — Phase 3 is scoped to its own milestone.** Vault, credential/provider data layer, `AgentAdapter`, settings UI, env injection, redacting logger, and a single-probe test-key ship. Model catalog, effort normalization, launch profiles, and `usage_records` move to a new provisional **Phase 3a**. Rationale: the roadmap's Phase 3 line was a provisional sketch listing roughly twice what the milestone requires, and the security-critical work should not share sessions with UI polish.
- **D29 — Phase 3 ships the first real Settings view.** `CLAUDE.md`'s "do not jump ahead to UI/settings screens" barred building settings *before their phase*; PLAN §14 places "provider/credential settings" in Phase 3, so this is arriving on schedule, not jumping ahead. The Phase-2 precedent D26(g) (overlay dialog instead of a settings panel) was correct **for Phase 2** and is not a precedent against this. Consequences: `App.vue` gains a view switch (workspace ⇄ settings) — Chorus's first navigation concept — and Phase 3b's council configuration UI (D27) inherits it rather than inventing a second one. **The overlay idiom is not abandoned:** `WorktreePanel.vue` and `LaunchDialog.vue` stay overlays; only durable configuration moves into the view.
- **D30 — `pino` is added as a dependency** (PLAN §2 names it; `CLAUDE.md`'s stack list did not, hence the ask). It arrives with a **redacting serializer** — declared redact paths plus a known-key-shape regex scrub — in Task 3-1, **before any secret exists in the codebase**. File rotation is **deferred to Phase 7** with the installer work; Phase 3 logs to console through pino's transport. `pino` is the only new runtime dependency approved for this phase; anything else requires a fresh ask.
- **D31 — Two council briefs, both before coding.** `CouncilBrief-3.0-Vault.md` (vault security) and `CouncilBrief-3.1-AdapterInterface.md` (adapter interface shape) are issued at this kickoff. Task docs for 3-2 and 3-3 — and therefore 3-4 and 3-5, which consume their shapes — are authored **after** the findings are filed and ratified. The two questions have little overlap, and the adapter is the interface Phases 3a, 3b, 4, and 6 all build on; a combined brief would shortchange whichever the council found less interesting.
- **D32 — F21 and F23 land as a flagged chore commit at the start of Task 3-1** (precedent: D24's F15 chore in Task 2-1, and the standalone `de98679` fix commit). **G3 is amended for this one session: 3-1 makes two commits** — the chore, then the task. Rationale: both are pre-existing defects inherited by this phase, neither belongs in the logging commit's narrative, and F23 in particular is a live session-loss path that should not wait five tasks. The chore's effects are verified in 3-1's G2 runtime pass.

## Council checkpoints (G5)

Phase 3 carries **two** pre-identified [CR] gates. Per §4 of the roadmap, Claude cannot run the council: Claude flags, briefs, pauses, and records findings.

| Gate | Brief | Question | Blocks |
|---|---|---|---|
| **CR-3.0** | `CouncilBriefs/CouncilBrief-3.0-Vault.md` | Is the vault design sound against key exfiltration — storage shape, decrypt lifetime, injection surface, redaction coverage, and the safeStorage failure mode? | Task 3-2 (and transitively 3-4, 3-5) |
| **CR-3.1** | `CouncilBriefs/CouncilBrief-3.1-AdapterInterface.md` | Is the `AgentAdapter` interface shape right before providers are built on it — surface, execution-mode split, capability granularity, and state detection? | Task 3-3 (and transitively 3-4, 3-5) |

**Both are issued and awaiting findings.** Findings are recorded in roadmap §6 as **D33** (vault) and **D34** (adapter) with dissents preserved, exactly as CR-1.2, CR-1.5, and CR-2.0 were.

## Cross-cutting rules (every task doc repeats these)

- **One new npm dependency this phase: `pino` (D30).** Anything else requires a fresh ask (`CLAUDE.md`). No HTTP client dependency — the test-key probe uses Node's built-in `fetch`.
- **All Zod in main (D1, CSP).** Preload and renderer are Zod-free. Every new renderer→main payload is parsed in the main handler; every main→renderer event is validated in main before sending.
- **D14 plain-object IPC payloads.** Snapshot any store-sourced data (`JSON.parse(JSON.stringify(...))`) before it crosses the bridge; a reactive Proxy is rejected by structured clone at runtime with no compile-time signal.
- **Secrets discipline (the phase's prime directive).** Keys are encrypted with `safeStorage` and stored as blobs in SQLite; decrypted **in main, at launch, into a value that is not retained**; injected as **env vars into the child PTY**, never as CLI args (process lists are world-readable); never logged, never written into a transcript, never returned to the renderer, never placed in an error message. A plaintext key must not be reachable from any preload or renderer surface — write-only in, never read back out.
- **Never widen the blast radius to prove a feature.** No "debug mode" that logs a key, no temporary plaintext file, no key echoed into a test fixture. If something cannot be verified without exposing a key, verify it with a **planted fake key of realistic shape** instead.
- **G1 typecheck clean at every task boundary. G2 run, don't just compile** (drive the real app; CDP where headless).
- **Verify CLI/provider flags and env-var names against the tool's own `--help`/docs at execution time (D4)** — never from training-data memory. This binds hard in 3-5: `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `OPENAI_API_KEY`, and Codex's config-file conventions must each be confirmed against the installed CLI (claude 2.1.215, codex 0.144.6) before being hardcoded.

## Gates

| ID | Gate |
|----|------|
| G1 | `npm run typecheck` exits 0 at every task boundary. |
| G2 | **Run, don't just compile** — drive the real app window, observe both TUIs, cross-check the sqlite DB; screenshots when headless. |
| G3 | **One** intentional narrated commit per execution session — **plus** the F21/F23 chore commit in 3-1 (D32). |
| G4 | **Secret-grep gate — MANDATORY this phase.** Before every commit from Task 3-2 onward: no key material in source, logs, transcripts, process args, test fixtures, or `_verify/` artifacts. Task 3-1 ships the repo script that makes this checkable rather than asserted. |
| G5 | Council Review checkpoints **CR-3.0** and **CR-3.1** must be filed and ratified (D33/D34) before Tasks 3-2 and 3-3 are authored or executed. |

## Phase-Level Acceptance Criteria

Phase 3 is complete when all hold:

- [ ] **F21 closed:** main requires a distinct branch-force acknowledgment before `branchDelete(..., force = true)` is ever reachable; a request carrying only a path-matching `confirmation` plus `deleteBranch: true` on a **clean** worktree can no longer `-D` an unmerged branch, regardless of what any renderer sends (3-1).
- [ ] **F23 closed:** a palette launch into a populated layout **adds** a pane; every pre-existing pane survives in the tree, and no session is silently orphaned into a leafless `running` row (3-1).
- [ ] **Redacting logger:** main logs through pino; a planted fake key of realistic shape appearing in a logged object is emitted **redacted**; no `console.*` remains in `src/main` (3-1).
- [ ] **Migration v5** applies in place on the existing dev DB (4 → 5) with zero manual steps and zero data loss; `provider_configs` and `credential_profiles` exist with the CR-3.0-ratified shape (3-2).
- [ ] **Vault round-trip:** a value encrypted via `safeStorage` persists as an opaque blob and decrypts back to the original in main; the stored blob contains no plaintext substring of the input; `isEncryptionAvailable()` returning false is handled as a first-class refusal, not a crash (3-2).
- [ ] **`AgentAdapter` refactor is behavior-neutral:** both agents launch, attach, restart, and restore exactly as before; `cli:detect` reports the same shape; the full 142-test baseline stays green and grows (3-3).
- [ ] **Settings view:** providers and credential profiles can be created, listed, and deleted from the app; a stored key is never rendered, never returned over IPC, and cannot be read back after entry (3-4).
- [ ] **Phase milestone (runtime-proven, G2):** an agent launches with a BYOK credential injected as an env var into its child PTY; the key appears in **no** command line (`Get-CimInstance Win32_Process` on the live process tree), **no** log line, **no** transcript, and **no** renderer-reachable surface; a subscription-auth launch still works with no key injected (3-5).
- [ ] `npm run typecheck` clean and `npx vitest run` green at every task boundary; one narrated commit per task (+ the chore in 3-1).

## Phase Non-Goals

Explicitly out of scope for Phase 3 (later phases or deliberately deferred):

- **No `model_catalog` table, no catalog caching or refresh** — Phase 3a. Task 3-5's test-key is a single live probe returning ok/fail, not a cached catalog.
- **No effort normalization, no Fast/Balanced/Deep/Max slider, no `launch_profiles`** — Phase 3a.
- **No `usage_records` capture** — Phase 3a; PTY agents emit no token counts, so the table would have no honest producer until an api-mode adapter exists.
- **No api-mode execution / api-chat pane.** The adapter interface must *admit* `executionMode: 'api'` without contortion (CR-3.1 tests this), but Phase 3 implements **only** the `'pty'` path; `startApiSession` stays unimplemented.
- **No `resumeSession` / `--resume` support, no MCP config writing, no hook writing** — the interface may declare them optional; Phase 3 implements none of them (hooks are Phase 4, MCP is Phase 6).
- **No read-only workspace mode** (D22 deferred it to "Phase 3+"; it remains unenforceable for PTY agents — PLAN §12 — and Phase 3 adds no enforcement mechanism, so it stays deferred).
- **No new agent kinds.** Gemini, Aider, OpenCode, Ollama are what the adapter interface is *for*; adding them is not Phase 3's job. The wire vocabulary stays `'claude' | 'codex'`.
- **No log file rotation, no on-disk transcripts** — Phase 7 with the installer (D30).
- **No credential sharing, sync, or export**; no OS keychain beyond `safeStorage`; no `oauth`/`azure-identity`/`aws-profile` auth modes implemented (the schema may keep the vocabulary open per PLAN §6, but only `cli-managed` and `api-key` are built).
- **No restart-driver / restart-event change** (F14 stays deferred per D25 — Phase 3 adds no new restart driver).
- **Do not revert, stage, or commit unrelated or untracked files, including `_verify/` and anything under `docs/`.**

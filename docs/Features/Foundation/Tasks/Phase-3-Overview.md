# Phase 3 — BYOK Vault + Adapters

_Re-kickoff 2026-07-22: both council gates are closed (**D33** vault, **D34** adapter interface), Task 3-1 has landed, and Tasks 3-2 … 3-6 are authored below against the two ratified contracts. The original kickoff (2026-07-21) is preserved in the decision log; this document supersedes its task table._

## Source Of Truth

- Roadmap: `docs/Features/Foundation/roadmap.md` — §5 (Verified Ground Facts), §6 decisions **D28–D35**, §7 Phase 3, and the "Open items Phase 3 inherits" list.
- Council (**both CLOSED**): `CouncilBriefs/CouncilBrief-3.0-Vault-Findings.md` → **D33** (vault security contract) and `CouncilBriefs/CouncilBrief-3.1-AdapterInterface-Findings.md` → **D34** (adapter interface contract). Where the findings' prose and the ratified decision disagree, **D33/D34 including their coordinator resolutions win** — several resolutions exist precisely because the filed findings contradicted themselves.
- `docs/PLAN.md` §4 (Adapter Abstraction), §6 (Credentials, Providers, BYOK), §12 (Permissions — the honest version), §13 (target data model), §14 (Phase 3 line).
- Project rules: `CLAUDE.md` (locked architecture; D1 Zod-in-main; D14 plain-object IPC; secrets via safeStorage, injected as env vars into child PTYs, never in args/logs/transcripts; verify CLI flags against `--help` at execution time).
- **Verified codebase state: 2026-07-22, commit `fb3201e`** (Task 3-1 landed, working tree clean). Each task doc anchors insertion points to **named symbols**, never line numbers (house rule).

## Goal

Phases 0–2 made Chorus a real multi-agent workspace, but every agent still launches on the developer's own ambient credentials: `SessionManager.spawn` passes `env: process.env` through untouched, and D5 ("child PTYs inherit env untouched; no credentials injected/logged anywhere") has stood since Phase 0. Phase 3 replaces that with **bring-your-own-key**: a DPAPI-backed credential vault, provider and credential-profile records, the first real **`AgentAdapter`** abstraction over the two-value `AgentKind` enum, a **per-session PTY scrubber**, and **env-var injection of decrypted keys into child PTYs at launch** — decrypted in main, at launch, and nowhere else. The phase's prime directive is the mirror of Phase 2's: **a key never reaches a command line, a log file, a transcript, the renderer, or disk in plaintext.** Supporting that claim — not merely implementing it — is what the phase is judged on.

## Scope boundary (D28 — Matthew, 2026-07-21)

The roadmap's provisional Phase 3 line listed ten deliverables; its stated milestone needs only the first four. **Phase 3 is scoped tight to its own milestone.** Model catalog caching, effort normalization, launch profiles, and `usage_records` move to a new provisional **Phase 3a — Profiles & Catalog** (§7).

| Roadmap §7 Phase 3 item | Phase 3 | Deferred |
|---|:---:|---|
| safeStorage/DPAPI vault | ✅ 3-2 | |
| `credential_profiles` | ✅ 3-2 | |
| provider configs | ✅ 3-2 | |
| `AgentAdapter` interface + capabilities | ✅ 3-3 | |
| provider/credential settings UI | ✅ 3-4 | |
| **PTY scrubber on ingest** _(new scope — D33 Q4)_ | ✅ 3-5 | |
| env-var injection into child PTYs (supersedes D5) | ✅ 3-6 | |
| pino secret-redacting logging | ✅ 3-1 | |
| test-key | ✅ 3-6 (single live probe, no cache) | |
| model catalog (`model_catalog` table + refresh) | | **Phase 3a** |
| effort normalization (Fast/Balanced/Deep/Max) | | **Phase 3a** |
| launch profiles (`launch_profiles`) | | **Phase 3a** |
| `usage_records` capture | | **Phase 3a** (PTY agents emit no token counts; the table needs an api-mode producer to be honest) |

## The Six Tasks

Phase 3 is decomposed into six tasks executed **serially**. The phase grew from five to six at the re-kickoff: **D33's majority ruling added a per-session PTY scrubber that the phase sketch never contained**, and **D35** gives it its own task rather than folding it into the injection session.

| Task | One-line scope | Depends on | CR gate |
|------|----------------|------------|---------|
| **3-1** | **Carry-over fixes + secret-safe logging spine.** A flagged chore commit first (D32): **F21** (a distinct branch-force acknowledgment) and **F23** (`insertLaunchedLeaf` becomes total). Then the task commit: `pino` + a two-layer redacting logger, the 24 main-process `console.*` calls migrated, and `scripts/secret-grep.mjs` making G4 a command. | Phase 2 | — |
| **3-2** | **Vault + credential/provider data layer.** Migration v5 (`provider_configs`, `credential_profiles`); an Electron-free `vaultCore.ts` + a `CredentialVault` service over `safeStorage` (DPAPI); storage accessors; `provider:*` / `credential:*` IPC with all Zod in main; preload forwarders. **No UI** — the same shape as Task 2-1. Contract: **D33**. | 3-1 | **CR-3.0 CLOSED (D33)** |
| **3-3** | **`AgentAdapter` interface + capabilities + launch-path refactor.** `src/main/adapters/` with the normative interface, a `claude` adapter, a `codex` adapter, and a static registry; `SessionManager.spawn` consumes a `PtyLaunchRequest`; `cli:detect` routes through `detectInstallation()` and grows display data; a new declarative `adapter:list` channel. **Zero behavior change.** Contract: **D34**. | 3-2 | **CR-3.1 CLOSED (D34)** |
| **3-4** | **First real Settings view (D29).** Providers and credential profiles CRUD over 3-2's channels; auth methods rendered from 3-3's `adapter:list`. Plaintext keys are write-only: they travel renderer→main once and are never read back. Renderer-only. | 3-3 | — |
| **3-5** | **PTY scrubber on ingest (D33 Q4 + resolutions a/e).** A pure streaming exact-value scrubber with bounded carry-over and a timer flush, wired into `SessionManager`'s `onData` **before** ring-buffer append and **before** renderer broadcast. Lands with **zero registered secrets** — the 3-1 pattern: redaction before the secret exists. | 3-4 | — |
| **3-6** | **BYOK env injection + test-key.** The launch path resolves a credential profile, main decrypts **at launch only**, composes the allow-list env, registers the value with 3-5's scrubber, and the adapter's `buildLaunch` puts the key in the child PTY's `env` — never in args. Launch dialog gains auth-method/credential selection. Test-key = one live provider probe. **G4 mandatory.** Supersedes D5 and closes the milestone. | 3-5 | — |

Dependency chain: **3-1 → 3-2 → 3-3 → 3-4 → 3-5 → 3-6** (strictly serial).

### Why the scrubber is its own task, before injection (D35)

Task 3-1 established the phase's operating principle: **redaction machinery lands before the secret it protects against exists**, so the secret is written into an already-safe environment rather than retrofitted into an audited-by-nobody one. The scrubber is the same shape of work as the logger, one layer down.

Folding it into 3-6 would have put the launch-payload change, credential resolution, allow-list env composition, adapter wiring, a streaming scrubber, the launch-dialog UI, and a live network probe into a single commit — the phase's largest and most security-critical session. Split, each half gets its own runtime proof: 3-5 proves the scrubber against a planted fake value with no vault involved, and 3-6 proves injection against a scrubber already known to work.

### File-ownership matrix

Overlapping files across tasks are **legal only because execution is serial** — each later task starts only after the prior task's commit exists, and touches a disjoint region of any shared file.

| File | 3-1 | 3-2 | 3-3 | 3-4 | 3-5 | 3-6 |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| `package.json` (`pino`, `grep:secrets`) | **edit** | — | — | — | — | — |
| `scripts/secret-grep.mjs` | **create** | run | run | run | run | run |
| `src/main/services/secret-patterns.json` | **create** | — | — | — | consume | consume |
| `src/main/services/logger.ts` | **create** | consume | consume | — | consume | consume |
| `src/main/services/vaultCore.ts` | — | **create** | — | — | — | consume |
| `src/main/services/vaultCore.test.ts` | — | **create** | — | — | — | — |
| `src/main/services/vault.ts` | — | **create** | — | — | — | consume |
| `src/main/adapters/**` | — | — | **create** | — | — | **edit** (env/secret seam) |
| `src/main/services/scrubber.ts` | — | — | — | — | **create** | consume |
| `src/main/services/scrubber.test.ts` | — | — | — | — | **create** | — |
| `src/main/db/schema.ts` | — | **edit** (v5 tables) | — | — | — | — |
| `src/main/services/storage.ts` | edit (logger) | **edit** (v5 + accessors) | — | — | — | edit (`last_verified_at`) |
| `src/main/services/sessionManager.ts` | edit (logger) | — | **edit** (`PtyLaunchRequest`) | — | **edit** (ingest scrub) | **edit** (env composition) |
| `src/main/services/cliDetect.ts` | — | — | **edit** (behind adapters) | — | — | — |
| `src/main/services/worktrees.ts` | edit (logger) | — | — | — | — | — |
| `src/main/services/notifications.ts` | edit (logger) | — | — | — | — | — |
| `src/main/index.ts` | edit (logger init) | **edit** (vault init) | — | — | — | — |
| `src/shared/ipc.ts` | **edit** (F21 field) | **edit** (vault channels) | **edit** (detect + adapter:list) | — | — | **edit** (launch cred + test-key) |
| `src/main/ipc.ts` | **edit** (F21 gate) | **edit** (vault handlers) | **edit** (detect via adapters) | — | — | **edit** (injection + probe) |
| `src/preload/index.ts` | — | **edit** (forwarders) | **edit** (adapter:list) | — | — | **edit** (test-key) |
| `src/renderer/src/stores/layout.ts` | **edit** (F23 fix) | — | — | — | — | — |
| `src/renderer/src/stores/settings.ts` | — | — | — | **create** | — | edit (verify state) |
| `src/renderer/src/components/LaunchDialog.vue` | — | — | **edit** (display data) | — | — | **edit** (auth/cred) |
| `src/renderer/src/views/Settings*.vue` | — | — | — | **create** | — | **edit** (Test key) |
| `src/renderer/src/palette/commands.ts` | — | — | — | **edit** (open settings) | — | — |
| `src/renderer/src/App.vue` | **edit** (F23 anchor) | — | — | **edit** (view switch) | — | — |
| `src/shared/ipc.test.ts` | edit | edit | edit | — | — | edit |
| `src/renderer/src/stores/layout.test.ts` | **edit** (F23 cases) | — | — | — | — | — |
| `docs/…/AdapterAuthoring.md` | — | — | **create** | — | — | — |

`src/preload/index.d.ts` is never hand-edited — `ChorusApi` is inferred from the preload object. **`WorktreePanel.vue` is deliberately absent:** F21 was fixed as a main-side gate only, which leaves `-D` with zero callers — no renderer affordance is added anywhere in this phase.

Because ownership overlaps across the serial chain, every task doc repeats the same guard: implementers work only inside their listed scope and **must not revert, stage, or commit files they did not change**, including untracked `_verify/` harness artifacts and anything under `docs/`.

## Shared Context — what Phases 2 and 3-1 left behind that binds here

Phase 3 builds on these facts; implementers do not relitigate them. **All re-verified 2026-07-22 at `fb3201e`.**

- **Baseline:** `npm run typecheck` exits 0. `npx vitest run` = **160/160 across 8 files** (up from 142/7 — Task 3-1 added `src/main/services/logger.test.ts`). `npm run grep:secrets` reports `clean (6 patterns over src/, scripts/, _verify/, package.json, root configs)`. Working tree clean.
- **The logger surface (3-1).** `src/main/services/logger.ts` exports `logger` (a pino 10.3.1 instance), the pure **`scrubSecrets(text: string): string`**, `SCRUB_PLACEHOLDER` (`'[redacted]'`), and `REDACT_PATHS`. Redaction is two-layer: pino `redact` paths for structured fields, plus `hooks.logMethod` routing every **string** argument through `scrubSecrets`. **New credential-bearing field names must be added to `REDACT_PATHS`** as they are introduced.
- **One canonical key-shape list.** `src/main/services/secret-patterns.json` holds the six patterns (`sk-ant-`, `sk-or-v1-`, `sk-proj-`, generic `sk-`, `gh[pousr]_`, `AKIA`) and is consumed by **both** `logger.ts` and `scripts/secret-grep.mjs`. **Order matters** — specific prefixes precede the generic `sk-` pattern. This was a Task 3-1 deviation from its own doc and it is the right shape: the G4 gate can never test different shapes than the scrubber. Extend the JSON, never fork it.
- **Env is currently inherited whole.** `SessionManager.spawn` calls `pty.spawn(cli.file, cli.args, { …, env: process.env as Record<string, string> })` with a comment stating that both agents use their own subscription logins and no credentials are injected. **That comment is D5, and Task 3-6 supersedes it** — but only 3-6. Tasks 3-2 through 3-5 leave the spawn env untouched.
- **The ingest point exists and is unambiguous.** `SessionManager.spawn`'s `child.onData` handler appends to `session.buffer` (capped at `BUFFER_MAX_CHARS = 4_000_000`) and **then** broadcasts to `dataListeners`, in that order. Task 3-5 inserts the scrubber ahead of both, so the ring buffer, the live `session:data` stream, and `attach()`'s replay all consume the same scrubbed text.
- **`AgentKind` is a two-value Zod enum** (`z.enum(['claude','codex'])` in `src/shared/ipc.ts`) threaded through the launch/attach/restart schemas, `sessions.agent`, `resolveCli(agent)`, the LaunchDialog's `labels`/`AGENT_KINDS` constants, and the palette. Task 3-3 introduces adapters **behind** that enum: per **D34(b)** the wire schema stays the authority and the registry is typed `Record<AgentKind, AgentAdapter>`. Widening the wire vocabulary is Phase 3a's problem.
- **CLI resolution is `where.exe`-based, synchronous, and memoized.** `cliDetect.ts` exports `resolveCli(name)` (uses `execFileSync`; throws when nothing spawnable is found; prefers a real `.exe`, falls back to `cmd.exe /c <shim>`), `DETECTED_TOOLS = ['claude','codex','git','docker','node']`, and a memoized `detectClis()`. **`resolveCli` being synchronous is load-bearing** — `SessionManager.launch()` is sync, so 3-3's `buildLaunch` must stay sync too.
- **Migrations are a hand-rolled numbered array.** `MIGRATIONS: string[]` in `storage.ts`, applied in order inside a transaction by `migrate()`, tracked in `schema_migrations`. **Coordinator-verified against the real dev DB 2026-07-22: exactly 4 applied** (v4 `applied_at` `2026-07-20T16:57:49.534Z`, untouched). Task 3-2 adds **v5** and it must apply **in place, with zero data loss**.
- **FKs are ENFORCED (F16).** Coordinator-verified again this session: `PRAGMA foreign_keys` reads `1`. Any new `REFERENCES` clause in v5 is a real constraint: insert order matters and deleting a referenced parent throws. `credential_profiles` → `provider_configs` is therefore RESTRICT by default, and provider deletion must be handled explicitly rather than left to throw.
- **safeStorage on Electron 43.1.1 (D4-verified against the installed typings, 2026-07-22).** `isEncryptionAvailable(): boolean` · `isAsyncEncryptionAvailable(): Promise<boolean>` · `encryptString(s): Buffer` · `decryptString(buf): string` · `encryptStringAsync(s): Promise<Buffer>` · `decryptStringAsync(buf): Promise<DecryptStringAsyncReturnValue>` where that type is **`{ shouldReEncrypt: boolean; result: string }`** — the plaintext field is **`result`**, not `decrypted`. `getSelectedStorageBackend()` is Linux-only and irrelevant here.
- **Preload is a Zod-free typed forwarder (D1).** The page CSP forbids Zod's `eval`; every schema parse lives in main. This is doubly load-bearing this phase: the preload must also never become a place where a plaintext key can be observed.
- **F13 — async `onMounted` bail rule.** Any new component with awaits in `onMounted` (the Settings view in 3-4) must bail after each `await` if it may have unmounted; `cleanups` arrays run exactly once, so post-cleanup registrations leak for the app's lifetime.
- **F20 verification-provenance rule (standing).** Execution sessions run with a **redirected `AppData` but a real `C:\Projects`**: their filesystem/git evidence is trustworthy, their **database** evidence describes a different DB. Every implementer dump must quote the `projects` table; the coordinator re-verifies DB claims against the real `%APPDATA%\chorus\chorus.db`.
- **The real dev DB, coordinator-dumped 2026-07-22.** Migrations 1–4; projects `985d547b…` (Chorus, root `C:\Projects\ContactEstablished\Chorus`) and `f47ac10b…` (Chorus-Second, root `C:\Projects\ContactEstablished` — **F22**, not a git repo); two sessions, both `exited` (`claude` exit 3, `codex` exit `-1073741510`), both `worktree_id` NULL; **one `worktrees` row** — `9ba9b0da…`, `detached`, `session_id NULL`, branch `chorus/Chorus/24b5c1fe`, **`base_branch ''`**, path `C:\Projects\ContactEstablished\.chorus\Chorus\wt-24b5c1fe`. **Retain that row, its directory, and its branch** — it is the standing regression fixture.
- **Harness caveats (roadmap §5, F3/F7/F8/F9/F11/F17).** CDP on `--remote-debugging-port=9222` is the proven runtime driver (`Runtime.evaluate` in IIFEs, `Page.captureScreenshot`, `Input.insertText`); `ws` lives in the session scratchpad, never the repo; kill process **trees** (`taskkill /PID <root> /T /F`); graceful-quit test = `taskkill` without `/F`; electron-vite does **not** hot-restart main, so every main-process check needs a cold boot; `ELECTRON_RUN_AS_NODE=1` scripts print nothing to a console (write to a file) and **intermittently produce no file on first run — retry once**; `sqlite3` is NOT installed (use the `_verify/2-1-dump.js` pattern). **Claude Code CLI is currently UNAUTHENTICATED** (token expired) — which this phase turns into an asset: it is a genuine fixture for distinguishing "launched with an injected key" from "launched on subscription auth".

## Decisions

Kickoff decisions **D28–D32** (Matthew, 2026-07-21) stand unchanged — see roadmap §6. The re-kickoff adds:

- **D33 — the vault security contract** (CR-3.0, council majority + coordinator resolutions (a)–(e), Matthew-ratified 2026-07-22). Envelope blob over safeStorage/DPAPI; plaintext metadata columns; **main-side-only** salted SHA-256 fingerprints (resolution b — the council's own clause 3 bars them from IPC, so clause 2's "UI can display" was impossible as written); decrypt-per-launch with variable isolation; **write-only inbound IPC**; refuse-never-degrade failure modes; full log redaction; and a **per-session exact-value PTY scrubber on ingest** (majority 2-of-3; Qwen's accept-and-document dissent preserved). Resolution (a) is the one that shapes code most: exact-match scrubbing **requires** retaining the injected plaintext for the session's lifetime, so clause 4's "drop all references" gains an explicit carve-out and the widened crash-dump window is a **named limit**. Resolution (c): the allow-list env applies **only** to credential-bearing launches. Resolution (d): the honest guarantee gains a Test-key carve-out.
- **D34 — the `AgentAdapter` interface contract** (CR-3.1, council unanimous on all five questions + coordinator resolutions (a)–(f), Matthew-ratified 2026-07-22). Narrow always-implemented core + capability-gated extension interfaces; `PtyAgentAdapter | ApiAgentAdapter` discriminated union; descriptors over booleans; **`detectState` is OUT** (resolution a strikes `SupportsStateDetection`/`OutputInterpreter` from the declaration set — the findings' verbatim TS contradicted its own Q4 majority); the adapter `id` **is** the persisted `sessions.agent` value; static frozen registry. Resolution (b): `AgentKind` derives from `agentKindSchema`, not from the main-side registry. Resolution (d): **env policy has one owner — main.** Resolution (f): `cli:detect` gains display data. **The `ImplementationSpec-3-3.md` authored at this re-kickoff is the normative interface text; the findings' TypeScript is its strong draft and does not compile as written.**
- **D35 — the PTY scrubber gets its own task, placed before injection** (Matthew, 2026-07-22). D33's Q4 majority added scope the phase sketch never had. It becomes **Task 3-5**; BYOK injection + test-key becomes **Task 3-6**; Tasks 3-2/3-3/3-4 keep the numbering already published in the roadmap and in the closed council decisions. Rationale: it preserves the 3-1 principle (redaction lands before the secret exists), it keeps the phase's most security-critical session from carrying seven concerns at once, and it avoids renumbering task ids that ratified documents already reference.

## Council checkpoints (G5) — BOTH CLOSED

| Gate | Brief | Findings | Outcome |
|---|---|---|---|
| **CR-3.0** | `CouncilBrief-3.0-Vault.md` | `CouncilBrief-3.0-Vault-Findings.md` | **CLOSED 2026-07-22 → D33** |
| **CR-3.1** | `CouncilBrief-3.1-AdapterInterface.md` (2026-07-22 amended form, carrying the D33 seam facts) | `CouncilBrief-3.1-AdapterInterface-Findings.md` | **CLOSED 2026-07-22 → D34** |

No further council gate is planned for Phase 3. If an execution session finds itself with two contested approaches on a security surface, that is a fresh CR trigger under roadmap §4 — flag, brief, pause.

## Cross-cutting rules (every task doc repeats these)

- **One new npm dependency this phase: `pino` (D30), already installed.** Anything else requires a fresh ask (`CLAUDE.md`). No HTTP client dependency — the test-key probe uses Node's built-in `fetch`.
- **All Zod in main (D1, CSP).** Preload and renderer are Zod-free. Every new renderer→main payload is parsed in the main handler; every main→renderer event is validated in main before sending.
- **D14 plain-object IPC payloads.** Snapshot any store-sourced data (`JSON.parse(JSON.stringify(...))`) before it crosses the bridge; a reactive Proxy is rejected by structured clone at runtime with no compile-time signal.
- **Secrets discipline (the phase's prime directive).** Keys are encrypted with `safeStorage` and stored as blobs in SQLite; decrypted **in main, at launch**; injected as **env vars into the child PTY**, never as CLI args (process lists are world-readable); never logged, never returned to the renderer, never placed in an error message. A plaintext key must not be reachable from any preload or renderer surface — write-only in, never read back out. **The one sanctioned retention** is D33(a)'s per-session scrubber match set: main memory only, never persisted, cleared on session end.
- **Never widen the blast radius to prove a feature.** No "debug mode" that logs a key, no temporary plaintext file, no key echoed into a committed test fixture. If something cannot be verified without exposing a key, verify it with a **planted fake key of realistic shape** instead. Temporary instrumentation must be reverted and the review checks the **commit diff**, not the worktree (the Task 2-4 precedent).
- **G1 typecheck clean at every task boundary. G2 run, don't just compile** (drive the real app; CDP where headless).
- **Verify CLI/provider flags and env-var names against the tool's own `--help`/docs at execution time (D4)** — never from training-data memory. This binds hardest in 3-6: `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `OPENAI_API_KEY`, and Codex's config-file conventions must each be confirmed against the installed CLI (claude 2.1.215, codex 0.144.6) before being hardcoded.

## Gates

| ID | Gate |
|----|------|
| G1 | `npm run typecheck` exits 0 at every task boundary. |
| G2 | **Run, don't just compile** — drive the real app window, observe both TUIs, cross-check the sqlite DB; screenshots when headless. |
| G3 | **One** intentional narrated commit per execution session. (3-1's two-commit amendment under D32 was for that session only.) |
| G4 | **Secret-grep gate — MANDATORY from Task 3-2 onward.** Before every commit: `npm run grep:secrets` clean, and no key material in source, logs, transcripts, process args, test fixtures, or `_verify/` artifacts. |
| G5 | Council Review checkpoints **CR-3.0** and **CR-3.1** — **both CLOSED** (D33/D34). No remaining gate. |

## Phase-Level Acceptance Criteria

Phase 3 is complete when all hold:

- [x] **F21 closed** — main requires a distinct branch-force acknowledgment before `branchDelete(..., force = true)` is reachable (3-1, `bc9b403`).
- [x] **F23 closed** — a palette launch into a populated layout adds a pane; `insertLaunchedLeaf` is total (3-1, `bc9b403`).
- [x] **Redacting logger** — main logs through pino; a planted fake key emits redacted from both a structured field and an interpolated message; no `console.*` remains in `src/main` (3-1, `0e0640a`).
- [x] **Migration v5** applied in place on the real dev DB (**4 → 5**, `2026-07-23T13:04:06.301Z`) with zero manual steps and zero data loss — coordinator re-driven after the implementer's F20-redirected run (3-2, `a0b6a5e`).
- [x] **Vault round-trip** — proven with a planted fake key through the app's own vault (SHA-256 equality); blob opacity proven on hex + latin1 renderings **with a control that fails**; unavailable-encryption, corrupt-blob, and truncated-blob paths each refuse with label-only messages and keep the row (3-2, `a0b6a5e`).
- [x] **No credential IPC channel ever returns key material or a fingerprint** — proven structurally (the clause-3 test on the parse output) and at runtime (full response dumps + nine boot logs, 11/11 leak checks pass) (3-2, `a0b6a5e`; re-checked in 3-4 and 3-6).
- [ ] **`AgentAdapter` refactor is behavior-neutral** — both agents launch, attach, restart, and restore exactly as before; `cli:detect` reports the same installation facts; the 160-test baseline stays green and grows (3-3).
- [ ] **The renderer no longer hardcodes agent names or labels** — `LaunchDialog`'s `labels`/`AGENT_KINDS` constants are gone, replaced by adapter-supplied display data (3-3).
- [ ] **Settings view** — providers and credential profiles can be created, listed, and deleted from the app; a stored key is never rendered, never returned over IPC, and cannot be read back after entry (3-4).
- [ ] **Scrubber** — a planted fake key of realistic shape, printed by a live agent into its own terminal, appears as `[REDACTED-CREDENTIAL]` in the renderer, in the ring buffer, and in `attach()`'s replay; a value split across two PTY chunks is still caught; ordinary output is byte-identical to unscrubbed (3-5).
- [ ] **Phase milestone (runtime-proven, G2)** — an agent launches with a BYOK credential injected as an env var into its child PTY; the key appears in **no** command line (`Get-CimInstance Win32_Process` on the live process tree), **no** log line, **no** ring buffer, and **no** renderer-reachable surface; a subscription-auth launch still works with no key injected and no allow-list applied (3-6).
- [ ] `npm run typecheck` clean, `npx vitest run` green, and `npm run grep:secrets` clean at every task boundary; one narrated commit per task.

## Phase Non-Goals

Explicitly out of scope for Phase 3 (later phases or deliberately deferred):

- **No `model_catalog` table, no catalog caching or refresh** — Phase 3a. Task 3-6's test-key is a single live probe returning ok/fail, not a cached catalog.
- **No effort normalization, no Fast/Balanced/Deep/Max slider, no `launch_profiles`** — Phase 3a.
- **No `usage_records` capture** — Phase 3a; PTY agents emit no token counts, so the table would have no honest producer until an api-mode adapter exists.
- **No api-mode execution / api-chat pane.** The adapter interface must *admit* `executionMode: 'api'` without contortion, but Phase 3 implements **only** the `'pty'` path; `startApiSession` stays unimplemented and `ApiAgentAdapter` has zero instances.
- **No `SessionManager` PTY/API session split.** D34's Q2 ruling puts the boundary at both adapter and session level eventually; **Phase 3 restructures only the adapter side** — `SessionManager` stays PTY-only.
- **No `resumeSession` / `--resume` support, no MCP config writing, no hook writing** — the extension interfaces may be declared; Phase 3 implements none of them (hooks are Phase 4, MCP is Phase 6).
- **No `detectState`, no `OutputInterpreter`, no `SupportsStateDetection`** — struck by D34(a). Phase 4 designs its own buffered interpreter if hooks prove insufficient.
- **No scrubber coverage claims beyond exact-value matching.** Base64-encoded, ANSI-interleaved, or deliberately split-and-obfuscated key output is **out of scope by council ruling** and must be named as a limit, not quietly implied to be covered.
- **No read-only workspace mode** (D22 deferred it to "Phase 3+"; it remains unenforceable for PTY agents — PLAN §12 — and Phase 3 adds no enforcement mechanism).
- **No new agent kinds.** Gemini, Aider, OpenCode, Ollama are what the adapter interface is *for*; adding them is not Phase 3's job. The wire vocabulary stays `'claude' | 'codex'`.
- **No log file rotation, no on-disk transcripts** — Phase 7 with the installer (D30).
- **No credential sharing, sync, or export**; no OS keychain beyond `safeStorage`; no `oauth`/`azure-identity`/`aws-profile` auth modes implemented (the schema may keep the vocabulary open per PLAN §6, but only `cli-managed` and `api-key` are built).
- **No restart-driver / restart-event change** (F14 stays deferred per D25).
- **No `-D` affordance in the UI** — `WorktreePanel.vue` stays untouched for the whole phase.
- **Do not revert, stage, or commit unrelated or untracked files, including `_verify/` and anything under `docs/`.**
- **Do not remove the standing `wt-24b5c1fe` worktree row, directory, or branch `chorus/Chorus/24b5c1fe`.**

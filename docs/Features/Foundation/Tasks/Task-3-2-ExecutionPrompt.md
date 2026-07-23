# Chorus Phase 3, Task 3-2 Execution Prompt — Vault + Credential/Provider Data Layer

_Generated 2026-07-23 against HEAD `fb3201e`. Every ground fact in §3–§4 was verified at that commit by direct inspection this session: `npm run typecheck` exits 0, `npx vitest run` = **160/160 across 8 files**, `npm run grep:secrets` clean, working tree carries **docs-only** changes (§5), the real dev DB holds **migrations 1–4** with `PRAGMA foreign_keys = 1` and one `worktrees` row, and Electron 43.1.1's `safeStorage` typings were read directly (§6, D4)._

## §1 Role

You are the implementation engineer for Chorus **Phase 3, Task 3-2** — the phase's second task and the first one that touches a secret. Repo root: `C:\Projects\ContactEstablished\Chorus`. Expected branch `main` — confirm with `git branch --show-current`; **do not switch or create branches**. Expected HEAD: `fb3201e` ("Saving more Phase 3 docs") or a descendant.

Planning was done by a separate coordinator. Your final summary will be reviewed against the task docs, and **the reviewer WILL re-run your verification independently**, including re-reading the database on the real machine (§11).

**⚠ THIS SESSION MAKES EXACTLY ONE COMMIT (G3).** Task 3-1's two-commit session was a deliberate, ratified one-off recorded as **D32** — it does not carry forward. If you find yourself wanting a second commit, stop and raise it instead.

**⚠ G4 IS NOW MANDATORY.** `npm run grep:secrets` must exit 0 before you commit. Task 3-1 shipped the script precisely so this gate is a command you run, not a claim you make. It scans `src/`, `scripts/`, **`_verify/`**, `package.json`, and root configs — note `_verify/` in that list (§10).

## §2 Goal

Build the credential vault and its data layer — the first place a real secret will ever live in Chorus — with **no UI and no injection**.

The task is complete when a plaintext key can be handed to main once, encrypted with DPAPI via Electron's `safeStorage`, stored as an opaque blob in SQLite, and decrypted back **inside main only**; and when there is **no path at all** by which the renderer can read one back.

The security properties are the deliverable, not the CRUD. Three of them are structural rather than behavioural, and each must be provable by reading the code rather than by trusting a test:

1. **Write-only inbound IPC.** No `credential:*` response type contains key material or a fingerprint. Enforced by the **outbound schemas**, so a future handler that forgets cannot leak quietly — it fails the outbound parse loudly.
2. **Fingerprints never leave main** (D33 resolution b). Their job is duplicate detection at creation and rotation detection — not UI disambiguation, which the mandatory label handles.
3. **Refuse, never degrade** (D33 clause 8). Encryption unavailable, blob corrupt, blob undecryptable — each is an explicit refusal that keeps the row, names the profile by **label only**, and never carries blob bytes, partial key material, or a derived secret in its message.

## §3 Project Context

Architecture: local-first, Windows-only Electron **43.1.1** + Vue 3 + TypeScript + Vite + Pinia app running AI coding-agent CLIs (Claude Code, Codex) as live interactive TUIs in xterm.js panes; PTYs (node-pty / ConPTY) live in the MAIN process owned by `SessionManager`; the renderer is a pure view attaching by session id over typed IPC; `contextIsolation: true`, `nodeIntegration: false`. SQLite via better-sqlite3 **12.11.1** (WAL) at `%APPDATA%\chorus\chorus.db`; Drizzle for typed queries ONLY — migrations are a hand-rolled `MIGRATIONS` array + `schema_migrations` runner (**D7**).

Phases 0–2 are complete. Phase 3 introduces BYOK credentials; **Task 3-1 laid the redacting-logger groundwork and is done**; this task introduces the vault itself.

Dev machine: Windows 11, PowerShell 7, **Node 22.14.0, git 2.50.0.windows.1**. CLIs: `claude.exe` 2.1.215 (**token expired — expected, not your problem, and irrelevant to this task**), `codex-cli` 0.144.6 (npm `.cmd` shim via `cmd.exe /c`). **This task needs the app to BOOT and its IPC surface to respond. It does not need an agent to answer a prompt.**

Environment quirks — all expected, none a bug you caused:

- **(a)** OS toasts disabled system-wide (registry `ToastEnabled=0`); exit-toast logging emits `[notify] toast shown:` then `[notify] toast failed:`. Pre-existing, not yours.
- **(b)** Codex TUI first-run prompts — update prompt (press **2 to Skip, never 1**), possible directory-trust prompt, `TERM is set to "dumb"` `[y/N]`.
- **(c)** `node-pty` logs `AttachConsole failed` on PTY teardown. Pre-existing noise.
- **(d)** The automation harness strips `ComSpec` and modifies PATH — restore before launching:
  `$env:ComSpec = "$env:SystemRoot\System32\cmd.exe"` and
  `$env:PATH = "$((Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment').Path);$((Get-ItemProperty 'HKCU:\Environment').Path)"`.
- **(e)** `TaskStop` kills only the wrapper shell. To stop the app, find the root node process (`Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*electron-vite*dev*' }`) and `taskkill /PID <pid> /T /F`, then confirm port 9222 is free. **`electron-vite` does NOT hot-restart the main process on `src/main` edits (renderer HMR only) — and this task edits main almost exclusively, so budget a real tree-kill cold boot for every check.**
- **(f)** Launch the app as: restore ComSpec/PATH, then `node node_modules/electron-vite/bin/electron-vite.js dev -- --remote-debugging-port=9222` from the repo root.
- **(g)** Orphan checks **cannot** grep `tasklist` for claude/codex — many unrelated `claude.exe` run on this machine. **Walk the descendant tree of the electron main PID.** A graceful-quit test is `taskkill` on the electron-main PID **WITHOUT** `/F`; force cleanup is `/T /F`.
- **(h)** Verification driver: **CDP** on `--remote-debugging-port=9222` (`Runtime.evaluate` in IIFEs — top-level `const` collides across evaluates; `Page.captureScreenshot`); install `ws` in the session scratchpad, **never the repo**. `ELECTRON_RUN_AS_NODE=1` scripts print nothing to a PowerShell console — write results to a file.
- **(i) The `sqlite3` CLI is NOT installed.** DB inspection = a script requiring better-sqlite3 **by absolute repo path**, run via `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe dump.js out.json`. **Known flake: intermittently writes no file on the first invocation with no error — retry once.** `_verify/` is gitignored (`.gitignore:165`); read `_verify/2-1-dump.js` for the pattern.
- **(j)** CDP `Runtime.evaluate` reaches `window.chorus`, so you can drive the new IPC channels **before any UI exists**. That is the intended way to exercise this task — there is no settings view until Task 3-4.
- **(k) `safeStorage` requires a real Electron app that has emitted `ready`.** It cannot be exercised from Vitest, which is why the pure core is split out (§7) and why the encryption proofs are all runtime.

### Dev-machine baseline — coordinator-verified 2026-07-22/23, do NOT "clean up"

- Migrations **1, 2, 3, 4** — `applied_at` `2026-07-19T01:23:38.589Z`, `2026-07-19T15:03:43.749Z`, `2026-07-19T23:47:12.930Z`, **`2026-07-20T16:57:49.534Z`**. **You add v5 — the count must read 5 when you finish, and the first four timestamps must be UNCHANGED** (§10).
- Tables: `pane_layouts`, `projects`, `schema_migrations`, `sessions`, `settings`, `worktrees`. **`PRAGMA foreign_keys` reads `1`** — re-verified this session (**F16**).
- Projects: **`985d547b-d152-4a07-9094-ddb8da56ef8f` = "Chorus"**, root `C:\Projects\ContactEstablished\Chorus`. **`f47ac10b-58cc-4372-a567-0e02b2c3d479` = "Chorus-Second"**, root **`C:\Projects\ContactEstablished`** — the PARENT directory (**F22**; older docs claimed `…\Chorus-Second`, which was never true). That parent is **not** a git repo.
- Sessions: one `claude` (`exit_code 3`) + one `codex` (`exit_code -1073741510`), **both `exited`**, both `worktree_id` NULL.
- **`worktrees` holds ONE row:** `9ba9b0da-cecd-4960-815d-f36166cf8c00`, `status='detached'`, `session_id NULL`, branch `chorus/Chorus/24b5c1fe`, **`base_branch ''`**, project `985d547b…`, path `C:\Projects\ContactEstablished\.chorus\Chorus\wt-24b5c1fe`.
- Settings keys: `active_project_id`, `recent_cwds`, `view_state:985d547b…`, `view_state:f47ac10b…`, `window_bounds`.
- **⚠⚠ THE `wt-24b5c1fe` ROW, ITS DIRECTORY, AND BRANCH `chorus/Chorus/24b5c1fe` ARE A RETAINED REGRESSION FIXTURE — DO NOT REMOVE ANY OF THE THREE.** Nothing in this task should go near them; if your migration disturbs that row, that is a **zero-data-loss failure**, which is the headline thing this task is judged on.
- Leftover `chorus/*` branches with no worktree — normal under D26 Q4's no-auto-delete default, leave them: `39b6f2fe`, `54098146`, `605843db`, `ca1eff01`, `cc30c7be`.

## §4 Ground Yourself First (Read BEFORE Editing)

Docs, in this order:

- `CLAUDE.md` — locked rules (sessions in main; **Zod in main only**; D14 plain-object IPC payloads; **ask before adding dependencies**).
- `docs/Features/Foundation/roadmap.md` — §5 Verified Ground Facts (**especially F16, F20, F22**); §6 decisions **D28–D35**, and above all **D33** — the vault contract with its coordinator resolutions (a)–(e); §7 the Phase 3 section.
- `docs/Features/Foundation/CouncilBriefs/CouncilBrief-3.0-Vault-Findings.md` — the filed findings: clauses 1–9, action items 1–11, risks 1–7, and Qwen's preserved dissent. **Read it AFTER D33, and remember D33's resolutions patch it.** Where they disagree, **D33 wins** (§6).
- `docs/Features/Foundation/Tasks/Phase-3-Overview.md` — phase shape, file-ownership matrix, cross-cutting rules, Phase-Level Acceptance Criteria (**the migration-v5, vault-round-trip, and no-credential-IPC boxes are yours**).
- `docs/Features/Foundation/Tasks/Task-3-2.md` — **THE task contract. Scope, non-goals, acceptance criteria. THIS GOVERNS.**
- `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-3-2.md` — exact contents, insertion points, rationale. **§2 gives you the v5 DDL and the Drizzle mirror near-verbatim; §3 gives the pure core; §9 gives the verification protocol including the "test the test" rule.**

**You do NOT need to read `CouncilBrief-3.1-AdapterInterface-Findings.md` or the Task 3-3…3-6 docs.** They gate later tasks. Skimming them for context is fine; **acting on them is out of scope.**

### Code state — verified 2026-07-23 at `fb3201e`; trust this over any older doc line

- `npm run typecheck` exits 0 (node + web). `npx vitest run` = **160/160 across 8 files**: `src/shared/ipc.test.ts` (59), `src/main/services/worktrees.test.ts` (30), `src/shared/layout.test.ts` (26), `src/renderer/src/palette/commands.test.ts` (17), **`src/main/services/logger.test.ts` (10)**, `src/renderer/src/stores/layout.test.ts` (7), `src/main/services/restore.test.ts` (6), `src/renderer/src/stores/view.test.ts` (5). `npm run grep:secrets` exits 0.
- **`src/main/services/storage.ts`** — imports at **1–17** (`logger` at **8**, Drizzle table imports at **7**, row types at **9**). **`const MIGRATIONS: string[] = [` at line 41**; the v4 entry ends at **line 85** (`ALTER TABLE sessions ADD COLUMN worktree_id TEXT;\``) and the array closes at **line 86** — **append v5 there**. `export class StorageService` at **96**. The worktree-accessor block runs **281–337** (banner comment at 281, `createWorktreeRow` at 286, `deleteWorktreeRow` at 335) — **your new accessor block goes after it**, before `getWindowBounds()` at **339**. `close()` at **398**. `private migrate()` at **425** — it reads `MAX(version)` and applies each remaining entry inside `this.db.transaction(...)`; **a single MIGRATIONS entry may contain multiple statements and v4 already does. Do not modify `migrate()`.**
- **`src/main/db/schema.ts`** — the sole import is `{ sqliteTable, text, integer }` from `drizzle-orm/sqlite-core` at **line 1**; **you must add `blob`**. `worktrees` table at **66–83**; the `$infer` type exports run **85–90**. Add your two tables after `worktrees` and your four type aliases after line 90.
- **`src/shared/ipc.ts`** (522 lines) — `IpcChannel` runs **13–65**, last entry `WorktreeDiffSummary: 'worktree:diff-summary'` at **64**, closing `} as const` at **65**. Schemas live under dated banner comments (`Task 2-2: workspace modes…`, `Task 2-3: cleanup flows…`, `Task 2-4: diff summary…`) — **add a `Task 3-2: providers + credential vault (D33)` banner** and put your schemas under it. File currently ends at `sessionRestoredEventSchema` (**510–511**).
- **`src/main/ipc.ts`** — imports **1–74** (`logger` at **5**, the big `../shared/ipc` block from **6**, `StorageService` type at **72**, `GitWorktreeManager` at **73**). **`export function registerIpc(` at line 105**, currently `(sessions: SessionManager, storage: StorageService, worktrees: GitWorktreeManager)` — **add a fourth `vault: CredentialVault` parameter** and extend the JSDoc block above it (which already documents the 2-2 `GitWorktreeManager` threading, at **101–104**). The simple invoke handlers cluster near the end (`SessionWrite` at **690**); put your handlers under their own banner comment.
- **`src/preload/index.ts`** — the `chorusApi` object literal; worktree forwarders at **85–96** (`getWorktreeDiffSummary` at **95**), event subscriptions at **98–120**, `export type ChorusApi = typeof chorusApi` at **123**. **Add your eight forwarders after line 96, before the event block.** _(corrected from "six" post-execution — F-1)_ No Zod here, ever. `src/preload/index.d.ts` is **never hand-edited** (`ChorusApi` is inferred).
- **`src/main/index.ts`** — `new StorageService(...)` at **99**, `sessions.bindStorage(storage)` at **100**, **`const worktrees = new GitWorktreeManager(storage)` at 101** (construct the vault right after), `registerIpc(sessions, storage, worktrees)` at **118**.
- **`src/main/services/logger.ts`** — `export const REDACT_PATHS: string[] = [` at **23**, array closes at **40**; the pino instance consumes it at **62** (`redact: { paths: REDACT_PATHS, censor: SCRUB_PLACEHOLDER }`). **Append your new field names inside 23–40.** The two-layer design (redact paths + `hooks.logMethod` free-text scrub) is already wired — **do not restructure it.**
- **`src/main/services/secret-patterns.json`** — the canonical six-pattern list, consumed by **both** `logger.ts` and `scripts/secret-grep.mjs`. **Do not fork it.** You are unlikely to need to extend it; if you think you do, say why in the summary.
- `scripts/secret-grep.mjs` exists; `SCAN_DIRS = ['src', 'scripts', '_verify']` plus `package.json` and root configs.
- **There is no `src/main/services/vault.ts` or `vaultCore.ts`** — you create both.

### Git checks (run first)

```powershell
git branch --show-current   # expect: main
git status --porcelain      # expect: docs-only entries (see §5)
git log --oneline -1        # expect: fb3201e or descendant
git config user.email       # expect: mwilson29072@gmail.com
git worktree list           # expect: main tree + .chorus\Chorus\wt-24b5c1fe
```

## §5 Pre-existing Changes Warning

**The working tree may not be clean. As of prompt generation it carries docs-only changes from the Phase 3 re-kickoff:**

```
 M docs/Features/Foundation/Tasks/Phase-3-Overview.md
 M docs/Features/Foundation/roadmap.md
?? docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-3-2.md
?? docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-3-3.md
?? docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-3-4.md
?? docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-3-5.md
?? docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-3-6.md
?? docs/Features/Foundation/Tasks/Task-3-2.md
?? docs/Features/Foundation/Tasks/Task-3-3.md
?? docs/Features/Foundation/Tasks/Task-3-4.md
?? docs/Features/Foundation/Tasks/Task-3-5.md
?? docs/Features/Foundation/Tasks/Task-3-6.md
```

Plus this prompt itself (`docs/Features/Foundation/Tasks/Task-3-2-ExecutionPrompt.md`).

**These may or may not already be committed by the time you start** — the coordinator commits kickoff docs separately. Either way the rule is identical: **do not revert, stage, or commit anything under `docs/`.** Your one commit contains only source files you changed for this task.

If `git status --porcelain` shows anything **outside `docs/`** at session start, **stop and ask.**

`_verify/` is gitignored — add harness artifacts there freely, **but see the §10 warning about planted keys in `_verify/` tripping G4.**

## §6 Resolved Decisions and Findings That Bind This Task

Quote; do not relitigate.

- **D1** (locked): all Zod validation in main only — preload and renderer stay Zod-free (page CSP forbids the eval Zod compiles parsers with). **Doubly load-bearing this phase: the preload must also never become a place where a plaintext key can be observed.**
- **D3** (locked): sessions live in main; the renderer never spawns processes.
- **D4** (locked): verify a tool's API against its own docs/typings at execution, never from training memory. **Already done for you and re-verified this session against `node_modules/electron/electron.d.ts` — but confirm it yourself:** `isEncryptionAvailable(): boolean` · `isAsyncEncryptionAvailable(): Promise<boolean>` · `encryptString(plainText: string): Buffer` · `decryptString(encrypted: Buffer): string` · `encryptStringAsync(s): Promise<Buffer>` · `decryptStringAsync(encrypted: Buffer): Promise<DecryptStringAsyncReturnValue>` where **`DecryptStringAsyncReturnValue = { shouldReEncrypt: boolean; result: string }`**. **The plaintext field is `result`, NOT `decrypted`** — the findings' prose implies otherwise and is wrong. `getSelectedStorageBackend()` is Linux-only and irrelevant.
- **D7** (RESOLVED 2026-07-18): Drizzle provides schema **types + typed queries only**. The migration ENGINE stays the hand-rolled array + runner. **Do not introduce drizzle-kit migrations.**
- **D14** (locked): renderer→main IPC payloads must be plain objects.
- **D28** (RESOLVED 2026-07-21): Phase 3 is scoped to its milestone. **This task ships no adapter, no settings view, no injection, no model catalog, no launch profiles, no `usage_records`.**
- **D30** (RESOLVED 2026-07-21): **`pino` was the ONE dependency approved for this phase and it is already installed.** `node:crypto` is a Node built-in and `safeStorage` ships with Electron, so **this task needs no new dependency at all**. Anything else requires stopping and asking.
- **D33 — THE VAULT SECURITY CONTRACT** (RESOLVED 2026-07-22; council majority + coordinator resolutions (a)–(e), Matthew-ratified). Read it in full in roadmap §6. The parts that bind you directly:
  - **Clause 1** — envelope blob `{key, baseUrl?, extraHeaders?}` encrypted via safeStorage/DPAPI, with plaintext metadata columns.
  - **Clause 2 + resolution (b)** — a **salted SHA-256** fingerprint stored in the clear, **MAIN-SIDE ONLY**. The council's clause 2 said "so the UI can display" while its own clause 3 bars fingerprints from IPC; resolution (b) resolves the contradiction: the fingerprint's purpose is **duplicate detection at creation and rotation detection**, and the **mandatory label** does the UI disambiguation.
  - **Clause 3** — **write-only inbound IPC.** `create` takes a plaintext key and returns only an id; everything else works by opaque id. **No channel ever returns a decrypted key or a fingerprint.**
  - **Clause 8** — refuse, never degrade. Mark `unavailable_since`, **keep the row**, refuse with the profile's **label only** — never the blob, never partial key material, never a derived secret.
  - **Clause 9** — the **no-credential path is fully preserved**. Nothing in this task changes how a session launches.
  - **Resolution (e)** — `shouldReEncrypt` is reported **only** by `decryptStringAsync`, so rotation detection requires the async API; and provider-level plaintext `base_url`/`extra_headers_json` are **documented non-secret**, with an explicit precedence rule: **the credential envelope's values override the provider's defaults.**
  - **Resolution (a)** concerns the per-session PTY scrubber and its plaintext retention — **that is Task 3-5's business, not yours.** `decryptForLaunch` must retain nothing itself: no cache, no memo, no "last decrypted" field.
- **D35** (RESOLVED 2026-07-22): Phase 3 is **six** tasks; the PTY scrubber is Task 3-5 and injection is Task 3-6. **The five-task table in older documents is superseded.**
- **F16** (found Task 2-1, re-verified 2026-07-23): **SQLite foreign keys ARE enforced** — better-sqlite3 12.11.1 defaults `PRAGMA foreign_keys=ON`, and default behaviour is RESTRICT. **Directly in your path this time:** `credential_profiles.provider_id REFERENCES provider_configs(id)` is a real constraint, so deleting a provider that still has profiles **throws `SQLITE_CONSTRAINT_FOREIGNKEY`**. Handle it with an explicit count-and-refuse **before** SQLite throws — reverse-engineering a user message out of a caught constraint error is the failure mode Task 2-3 already paid for once.
- **F20 — KNOWN ENVIRONMENT CONDITION, stated as fact, not suspicion.** Execution sessions here run with a **REDIRECTED `AppData` but a REAL `C:\Projects`**. `$APPDATA` prints the correct string because the redirection is at the storage layer, not the variable. **Consequences: (1) your filesystem/git evidence is trustworthy; (2) your DATABASE evidence may describe a different DB and the coordinator WILL re-verify it; (3) this is an environment artifact — no dishonesty is implied.** **Dump the `projects` table in every DB dump and quote the ids** (§11). This matters more than usual here: your headline claim is a **migration on the real dev DB**.
- **F22** — Chorus-Second's `root_path` is `C:\Projects\ContactEstablished` (the parent), which is not a git repo.

## §7 Implementation Scope

Follow the Exact Scope table in `Task-3-2.md` and the near-final contents in `ImplementationSpec-3-2.md`.

| File | Change |
|------|--------|
| `src/main/services/vaultCore.ts` | **Create.** The **Electron-free** pure core: `CredentialEnvelope`, `encodeEnvelope`, `decodeEnvelope` (returns a discriminated result, **never throws with the input in the message**), the salted `fingerprint(key)`, `VaultFailureKind` + `failureMessage(kind, label)`, and `toProfileMeta(row)`. Spec §3 gives near-final code. |
| `src/main/services/vaultCore.test.ts` | **Create.** Unit tests over every pure function (§10). |
| `src/main/services/vault.ts` | **Create.** `CredentialVault` over `safeStorage` + `StorageService`. **The only module in the repo that may call `encryptString`/`decryptString*`.** Spec §4. |
| `src/main/db/schema.ts` | **Edit.** Add `blob` to the line-1 import; add `providerConfigs` + `credentialProfiles` after `worktrees` (line 83); add four `$infer` aliases after line 90. Spec §2.2. |
| `src/main/services/storage.ts` | **Edit.** Append migration **v5** to `MIGRATIONS` (after line 85, before the `]` at 86). Add the provider/credential accessor block after the worktree block (after line 337). Spec §2.1, §5. |
| `src/shared/ipc.ts` | **Edit.** Eight `IpcChannel` entries (before the `} as const` at line 65) + their request/response schemas under a new `Task 3-2` banner. Spec §6.1–6.2. |
| `src/main/ipc.ts` | **Edit.** `registerIpc` (line 105) grows a `vault: CredentialVault` parameter; eight handlers, each inbound-parsed AND **outbound-parsed**. Spec §6.3–6.4. |
| `src/preload/index.ts` | **Edit.** Eight typed forwarders after line 96. No Zod. |
| `src/main/index.ts` | **Edit.** Construct the vault after line 101; thread it into `registerIpc` at line 118; log availability once at boot. Spec §7. |
| `src/main/services/logger.ts` | **Edit.** Append the new credential-bearing field names to `REDACT_PATHS` (lines 23–40). Spec §8. |
| `src/shared/ipc.test.ts` | **Edit.** Schema cases including the **negative** cases that prove secret-freedom (§10). |

**Explicitly do NOT touch:** `src/main/services/sessionManager.ts`, `src/main/services/cliDetect.ts`, `src/main/services/restore.ts`, `src/main/services/worktrees.ts`, `src/main/services/git.ts`, `src/main/services/notifications.ts`, `src/main/services/secret-patterns.json`, `scripts/secret-grep.mjs`, `src/shared/layout.ts`, `src/preload/index.d.ts`, and **every file under `src/renderer/`**. If a change seems to require another file, **raise it and justify it loudly in the summary.**

### Key invariants

- **The v5 DDL and `schema.ts` agree column for column** — names, types, nullability, `REFERENCES` clauses. v4 is the precedent for getting this exactly right, and the reviewer will diff them line by line.
- **Migration v5 applies IN PLACE, 4 → 5, with zero data loss.** v1–v4 `applied_at` values must be **byte-identical** before and after — that is what distinguishes a migration from a recreation (§10).
- **`vaultCore.ts` does not import `electron`** — that is what makes `vaultCore.test.ts` runnable without mocks. If you needed a mock, the split is in the wrong place.
- **`toProfileMeta` is an EXPLICIT CONSTRUCTION, never a spread-and-delete.** `{...row}` minus two keys silently re-admits every column a future migration adds. The unit test asserts on `Object.keys`, so a spread-based implementation fails it — deliberately.
- **Every handler outbound-parses.** The outbound parse is what makes secret-freedom structural rather than aspirational; a handler that skips it defeats the whole design.
- **The fingerprint is genuinely salted**, with a fixed 32-byte in-code constant (generate once with `crypto.randomBytes(32).toString('hex')` and paste the literal). **Do not derive it from anything machine-specific** — a fingerprint must stay stable across reinstalls or rotation detection breaks. **Do not store it in the database** — the contract puts it in code so a stolen DB alone is not enough to build a rainbow table.
- **No failure message ever carries** blob bytes, a key substring, the key's byte length, or the raw exception text from `decryptString`.
- **`decryptForLaunch` has ZERO callers in this commit** — the same dormant-with-one-documented-legal-caller state `--force` sat in after Task 2-1. Its one future caller is Task 3-6. Grep-verify it.
- **`credential:create` is never logged**, at any level, behind any flag (D33 redaction rule 4).
- **`extraHeaders` on a PROVIDER is plaintext** — run incoming `extra_headers_json` through `scrubSecrets` on create/update and refuse with a reason if it changed, telling the user to put the credential on a credential profile instead (spec §6.4). Five lines that turn a documented assumption into an enforced one, using machinery Task 3-1 already shipped.

## §8 Strict Non-Goals

- **No UI whatsoever** — no settings view, no dialog, no palette command, no renderer store, no renderer file touched at all. That is Task 3-4. This task ships channels a renderer will consume later, exactly as Task 2-1 did.
- **No injection, no launch-path change, no `SessionManager` change.** D5 still stands until Task 3-6.
- **No PTY scrubber** — Task 3-5 owns it (D35). Do not touch `sessionManager.ts`.
- **No adapter work** — Task 3-3 owns `src/main/adapters/`. `provider_configs.adapter_type` is a plain TEXT column this task; nothing validates it against a registry yet.
- **No test-key, no network call of any kind.** Task 3-6 owns the probe. `last_verified_at` ships as a column nothing writes yet.
- **No `model_catalog`, no `launch_profiles`, no `usage_records`** — Phase 3a.
- **No key crosses to the renderer in any shape** — not plaintext, not a fingerprint, not a hint, not a length, **not a masked preview**. A masked preview (`sk-ant-…AB12`) is explicitly forbidden: it is key material and clause 3 admits no exception.
- **No plaintext fallback when encryption is unavailable.** Not behind a flag, not in dev, not "temporarily".
- **No new dependency** (D30).
- **No change to `migrate()`**, to the logger's two-layer structure, or to `secret-patterns.json`.
- **Do not delete the `wt-24b5c1fe` worktree, its DB row, or branch `chorus/Chorus/24b5c1fe`** (§3).
- **Do not revert, stage, or commit anything under `docs/`** (§5).
- **Do not push, open a PR, amend, or rebase.**

## §9 Required Workflow

1. **Ground per §4.** Read `Task-3-2.md` and `ImplementationSpec-3-2.md` in full, plus **D33 in roadmap §6**, before editing.
2. **Schema first.** Migration v5 + the Drizzle mirror. **Before booting the app, back up the real DB** (`chorus.db`, `chorus.db-wal`, `chorus.db-shm`) into `_verify/` and take the **pre-migration dump** — you cannot take it after the fact, and it is half the zero-data-loss proof.
3. **Pure core second** — `vaultCore.ts` + its tests, green before anything touches Electron.
4. **`vault.ts`**, then the storage accessors, then the IPC schemas → handlers → preload forwarders, then boot wiring and the `REDACT_PATHS` additions.
5. **Run `npm run typecheck` + `npx vitest run` + `npm run grep:secrets`.**
6. **Runtime verification (§10)** — the migration proof, the round-trip, blob opacity **with its control**, the three refusal proofs, and the no-leak sweep. **Clean every planted key out of `_verify/` before the final `grep:secrets` run.**
7. **Self-review the diff** against `Task-3-2.md`'s Review Checklist.
8. **ONE commit.** Narration in the style of `94f062c` / `6dfd146` / `2f0a35f` / `0e0640a`: a plain-English paragraph a non-technical reader can follow, then a `Technical notes:` bullet list. State the **D4 outcome** for `safeStorage`'s API, that the migration applied **in place on the real dev DB with zero data loss**, and any deviation from the spec. Verify `git config user.email` = `mwilson29072@gmail.com`. End with the `Co-Authored-By:` trailer naming the model that did the work.
9. **Do not push, do not open a PR, do not amend or rebase existing commits.**

## §10 Verification Commands

```powershell
npm run typecheck          # zero errors (G1)
npx vitest run             # green — 160 existing + your new cases
npm run grep:secrets       # MANDATORY this task (G4) — must exit 0 before you commit
```

Grep gates — run and report hit counts:

```powershell
git grep -n "decryptForLaunch" -- src        # declaration only; ZERO call sites
git grep -n "fingerprint" -- src/shared src/preload src/renderer   # expect: NOTHING
git grep -n "encryptString\|decryptString" -- src                  # only src/main/services/vault.ts
git diff --name-only HEAD -- src/renderer    # expect: EMPTY — this task touches no renderer file
git diff --name-only HEAD -- src/main/services/sessionManager.ts   # expect: EMPTY
```

App launch: restore ComSpec/PATH (§3d), then:

```powershell
node node_modules/electron-vite/bin/electron-vite.js dev -- --remote-debugging-port=9222
```

### New unit tests

`src/main/services/vaultCore.test.ts` — **must run without mocking `electron`**:

| Case | Expected |
|---|---|
| `decodeEnvelope(encodeEnvelope(e))` for minimal `{key}`, full `{key, baseUrl, extraHeaders}`, and headers needing JSON escaping | deep-equals the input |
| decode of malformed JSON / valid-JSON-non-object / object with missing or non-string `key` | the **corrupt** classification; **no throw carrying the input**; no partially-populated envelope |
| `fingerprint` determinism, and difference for a one-character change | as stated |
| **`fingerprint(k)` ≠ unsalted `sha256(k)`** (compute the unsalted digest in the test) | **this is what actually proves the salt is applied** |
| `fingerprint` output shape | 64 lowercase hex chars |
| `fingerprint` of a realistic fake key contains **no ≥8-char substring** of that key | guards against a "fingerprint" that embeds a prefix |
| **`Object.keys(toProfileMeta(row))`** for a row carrying `encryptedBlob` + `fingerprintHash` | contains **neither** — asserted by key enumeration, so a future secret column fails the test |
| each `VaultFailureKind` → its own variant; every message contains the **label** and no blob bytes / key substring | as stated |

`src/shared/ipc.test.ts` — under a `Task 3-2` banner:

| Case | Expected |
|---|---|
| each new request schema: valid payload accepted; bad uuid / empty label / empty key rejected | as stated |
| **`credentialProfileMetaSchema.parse(objectCarryingEncryptedBlobAndFingerprint)`** | output keys include **neither** — assert on the **parse output**, because that output is what main sends. **Name this the clause-3 structural test.** |
| `providerConfigSchema` round-trips `base_url`/`extra_headers_json`; `credentialProfileMetaSchema` carries neither key nor fingerprint | as stated |

**No unit test may contain a real credential.** Use obviously-fake values of realistic **shape** so the logic is genuinely exercised — and **`npm run grep:secrets` must still pass afterwards.** If the gate trips on a fixture, **the fixture is wrong, not the gate**: shorten it below the pattern's length floor or use a shape the patterns do not claim.

### RUN the app, don't just compile (G2)

Cold-boot after every main-process edit (§3e). Screenshot or dump each step.

1. **Migration proof — the three-dump protocol (the Task 2-1 bar).** Dump the DB **before** the first boot carrying v5, then after, then after a **second** cold boot. Required: v1–v4 `applied_at` **byte-identical across all three**; v5 present after boot 1 with a fresh timestamp; **boot 2 does not re-apply it**; and the pre/post row diff contains **only** the two new empty tables — every project, session, setting, layout, and the `9ba9b0da…` worktree row unchanged. **Quote all five timestamps.**
2. **Round-trip.** Create a profile over CDP with a **planted fake key of realistic shape**, then decrypt it back in main and confirm it is **identical**. (`decryptForLaunch` has no IPC caller by design — exercise it through a temporary, clearly-declared main-side probe, or via a dedicated one-off script run in the app's main process. **If you add temporary instrumentation, revert it and say so; the reviewer checks the commit diff, not the worktree** — the Task 2-4 precedent.)
3. **Blob opacity — and TEST THE TEST.** Dump `credential_profiles` with the blob rendered as **hex** and as **latin1**. Assert the plaintext key appears in neither. **Then run the identical assertions against a deliberately unencrypted control buffer (`Buffer.from(key)`) and confirm both assertions FAIL on it.** A verification that cannot fail is not evidence — report the control result alongside the real one.
4. **Refusal proof A — corrupt blob.** Hand-write garbage bytes into an existing profile's `encrypted_blob`, then attempt a decrypt-path operation. The **row must survive**, `unavailable_since` must be set, and the error must name the **label** and nothing else.
5. **Refusal proof B — truncated blob.** Same, using the first N bytes of a genuine blob. Must classify identically.
6. **Refusal proof C — unavailable encryption.** `isEncryptionAvailable()` returns true on Windows once the app is ready, so drive this by **temporarily** forcing the availability check false in `vault.ts`, proving creation is refused with no plaintext fallback, then **reverting**. Declare it as temporary instrumentation.
7. **Provider-delete refusal.** Attempt to delete a provider that still has credential profiles. Expected: a structured `{ok:false, reason}`, **not** a raw SQLite FK error surfacing to the renderer, and the provider row still present (F16).
8. **No-leak sweep.** With CDP attached, call **every** `credential:*` and `provider:*` channel and dump the **full** JSON of each response. Assert: no response contains the planted key, **no ≥8-character substring of it**, and **no 64-character hex run** (that is what a leaked fingerprint looks like). Run the same two assertions over the **boot log**.
9. **Console hygiene** across everything: zero `An object could not be cloned` (D14), zero uncaught errors, zero unhandled rejections.

**⚠ G4 AND `_verify/`.** `scripts/secret-grep.mjs` scans `_verify/`. Your dumps will contain the planted fake key. **Purge or redact those artifacts before the final `npm run grep:secrets` run**, or the gate will correctly fail. Do not "fix" this by removing `_verify` from `SCAN_DIRS` — that directory is in the scan list on purpose, and editing the gate to pass is a reportable regression.

## §11 Failure Honesty Clause

Capture exact output on any failure, explain it, report it. **Never claim success you did not directly observe.**

**Verification-provenance rule (enforced — F20, §6):** your **filesystem and git evidence is trustworthy**; your **database evidence may describe a different DB**, and the coordinator **will** re-verify against the real `%APPDATA%\chorus\chorus.db` (projects `985d547b-d152-4a07-9094-ddb8da56ef8f` = Chorus, `f47ac10b-58cc-4372-a567-0e02b2c3d479` = Chorus-Second). **Dump the `projects` table alongside every DB dump and quote the ids you actually saw.** If they do not match, say so plainly and prominently — that is a useful signal, not a failure on your part. **This matters more in this task than in any before it**, because "migration v5 applied in place on the real dev DB with zero data loss" is your headline claim.

**Specifically may NOT be reported as success:**

- a migration claim without the **pre-migration dump** — taken before the first v5 boot, and impossible to reconstruct afterwards;
- a zero-data-loss claim from "the tables are all still there" rather than from a **row-level pre/post diff**;
- an in-place claim without quoting the **unchanged v1–v4 timestamps** — a recreated DB also "has all the tables", with fresh timestamps;
- a blob-opacity claim without the **control buffer** demonstration from item 3;
- a no-leak claim from reading the schemas rather than from **dumping actual responses**;
- a refusal-path claim reasoned about from code rather than obtained by **actually corrupting a blob and calling the channel**;
- `grep:secrets` passing **after** you deleted the artifacts but **without** having run the sweep in item 8 first.

**If something fails, that is a legitimate and valuable outcome — report `DONE_WITH_CONCERNS` or `BLOCKED` with exact evidence.** A truthfully-failed proof is worth far more than a claimed one.

Known environment conditions are **not** failures — note them and move on: the dump-script first-run flake (§3i), `AttachConsole failed` teardown noise (§3c), disabled OS toasts (§3a), Claude Code's expired token.

## §12 Final Reporting Requirements

Write a detailed summary for coordinator review containing:

- **Status:** DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED.
- **Commit SHA** + one-line description. Confirm **exactly one** commit (the D32 two-commit exception was Task 3-1 only).
- **Environment statement** — confirm the runtime evidence came from this machine's dev DB (**quote the project ids you saw**), or state plainly that it did not (§11).
- **D4 report for `safeStorage`** — what the installed Electron 43.1.1 typings actually specify, and confirmation you used **`result`** (not `decrypted`) and `decryptStringAsync` for `shouldReEncrypt`.
- **Migration evidence** — the three dumps by filename, all five `applied_at` timestamps, the row-level pre/post diff, and explicit confirmation that the `9ba9b0da…` worktree row, both projects, both sessions, all five settings keys, and the `pane_layouts` row are unchanged.
- **The v5 DDL and `schema.ts` side by side**, so the reviewer can check column-for-column agreement without opening two files.
- **Round-trip + blob-opacity evidence** — including the **control-buffer** result proving the check can fail.
- **The three refusal proofs + the provider-delete refusal**, each with the exact error message returned (and confirmation it carries the label and nothing else).
- **No-leak sweep results** — the dumped responses by filename and the three assertions (no key, no ≥8-char substring, no 64-hex run) over responses **and** the boot log.
- **Grep gate results** with hit counts: `decryptForLaunch` (zero call sites), `fingerprint` in shared/preload/renderer (nothing), `encryptString`/`decryptString` (vault.ts only), renderer files touched (none).
- **Files changed** — one-line rationale each; anything beyond §7's table flagged loudly with justification.
- **Deviations** from `ImplementationSpec-3-2.md`, with why. (Its code blocks are starting points, not mandates — adapting them to the surrounding file's conventions is expected and is **not** a deviation. Changing a *guarantee* is.)
- **Verification transcript** — typecheck; vitest with new test names and the new total; `grep:secrets`; runtime items 1–9 individually with what was actually observed.
- **Acceptance criteria** from `Task-3-2.md` restated pass/fail, plus the **migration-v5**, **vault-round-trip**, and **no-credential-IPC** boxes in `Phase-3-Overview.md`.
- **Non-goals confirmation** — each §8 item untouched, **explicitly including** that no renderer file was touched, `sessionManager.ts` was not touched, no dependency was added, and `decryptForLaunch` has zero callers.
- **Fixture end-state declaration** — final `git worktree list`, the `worktrees` table, and `git branch --list "chorus/*"`. **Confirm `wt-24b5c1fe`, its row, and branch `chorus/Chorus/24b5c1fe` all still exist.**
- **Migration count** — confirm `schema_migrations` now reads **5**, and that v1–v4 timestamps are untouched.
- **`_verify/` hygiene** — confirm planted keys were purged and that the final `grep:secrets` ran **after** the sweep, not instead of it.
- **Residual risks / notes for Task 3-3** — anything the adapter task should know, particularly whether the `ResolvedCredential`-shaped envelope you return from `decryptForLaunch` matches what `ImplementationSpec-3-3.md` §2 declares (`{envVarName, value, isSecret}`), since Task 3-6 has to join them.
- **Final git output**, fenced: `git status --porcelain` and `git log --oneline -4`.

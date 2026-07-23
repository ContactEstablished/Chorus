# Chorus Phase 3, Task 3-3 Execution Prompt — `AgentAdapter` Interface + Launch-Path Refactor

_Generated 2026-07-23 against HEAD `a0b6a5e`. Every ground fact in §3–§4 was verified at that commit by direct coordinator inspection: `npm run typecheck` exits 0, `npx vitest run` = **193/193 across 9 files**, `npm run grep:secrets` clean, the real dev DB holds **migrations 1–5** (v5 coordinator-applied `2026-07-23T13:04:06.301Z`), and the working tree carries **docs-only** changes (§5)._

## §1 Role

You are the implementation engineer for Chorus **Phase 3, Task 3-3**. Repo root: `C:\Projects\ContactEstablished\Chorus`. Expected branch `main` — confirm with `git branch --show-current`; **do not switch or create branches**. Expected HEAD: `a0b6a5e` ("Task 3-2: credential vault + provider data layer") or a descendant.

Planning was done by a separate coordinator. Your final summary will be reviewed against the task docs, and **the reviewer WILL re-run your verification independently** — for this task that means re-running your before/after diffs, not just your gates.

**⚠ THIS SESSION MAKES EXACTLY TWO COMMITS** — a deliberate, ratified exception to G3, recorded as **D36** (precedent: D24's F15 chore in Task 2-1, D32's F21/F23 chore in Task 3-1):

1. **Commit 1 — chore:** three small hardenings from the Task 3-2 completion review (F24 + F-4 + F-5b). Nothing to do with adapters.
2. **Commit 2 — task:** the `AgentAdapter` refactor — **zero behavior change**.

Do them in that order, each self-contained, each with its own verification pass. Do not squash them.

## §2 Goal

**The chore** closes three review findings while they are cheap: **(F24)** the pino logger's free-text scrub covers string arguments only, so `logger.error({ err }, …)` emits Error message/stack **unscrubbed** — D33 redaction item 3 requires them covered, and Task 3-6's fetch errors can embed request headers; **(F-4)** `replaceProfile` bypasses the duplicate-fingerprint detection `createProfile` has; **(F-5b)** `credentialProfileMetaSchema` silently *strips* unknown keys where the design prose promises a *loud* failure — `.strict()` makes it literal.

**The task** puts a real interface between Chorus and the two agent CLIs, and changes **nothing a user can observe**. Today the coupling is a string: `resolveCli(agent)` takes `'claude' | 'codex'` and the knowledge of what those mean is spread across `cliDetect.ts`, `SessionManager.spawn`, and two hardcoded constants in a Vue component. Phases 3a, 3b, 4, and 6 all build on this seam, which is why its shape went to council (CR-3.1 → **D34**). You are judged on two things that pull in opposite directions:

1. **Behavior neutrality** — both agents launch, attach, restart, and restore exactly as before; `cli:detect` reports the same installation facts; the spawned process trees are identical. **Proven by before/after diffs captured in this session, not asserted.**
2. **Type honesty** — "supported" and "implemented" become the same fact at the call site. No capability booleans a caller must trust separately from method presence; no mandatory PTY methods on API adapters; no casts papering over the union.

This task moves knowledge; it does not use it. The credential/env machinery it declares stays **inert** until Tasks 3-5/3-6.

## §3 Project Context

Architecture: local-first, Windows-only Electron **43.1.1** + Vue 3 + TypeScript + Vite + Pinia app running AI coding-agent CLIs as live TUIs in xterm.js panes; PTYs (node-pty / ConPTY) live in MAIN owned by `SessionManager`; the renderer attaches by session id over typed IPC; `contextIsolation: true`, `nodeIntegration: false`. SQLite via better-sqlite3 12.11.1 (WAL); Drizzle for typed queries only (D7). Phases 0–2 complete; Phase 3 tasks 3-1 (logging spine) and 3-2 (credential vault) have landed.

Dev machine: Windows 11, PowerShell 7, Node 22.14.0, git 2.50.0.windows.1.

**⚠ CLI VERSION DRIFT — capture your own baseline.** The coordinator's 2026-07-23 boot observed `claude` at **2.1.218** resolving to `C:\Users\matth\.local\bin\claude.exe` — older docs say 2.1.215 at a different path, and the CLI self-updates. Consequence: **never compare your post-refactor output against numbers printed in any doc, including this one.** Capture the pre-refactor `cli:detect` JSON and process-tree command lines **in this session, before your first edit**, and diff against those. `codex-cli` 0.144.6 (npm `.cmd` shim via `cmd.exe /c`). Claude Code's auth state has been flaky; **this task needs TUIs that render, not agents that answer** — an auth/login screen is a perfectly good "process started and painted" signal.

Environment quirks — all expected, none a bug you caused:

- **(a)** OS toasts disabled system-wide; `[notify] toast shown:` then `[notify] toast failed:` is normal.
- **(b)** Codex TUI first-run prompts — update prompt (press **2 to Skip, never 1**), possible directory-trust prompt, `TERM is set to "dumb"` `[y/N]`.
- **(c)** `node-pty` logs `AttachConsole failed` on PTY teardown. Pre-existing noise.
- **(d)** The automation harness strips `ComSpec` and modifies PATH — restore before launching:
  `$env:ComSpec = "$env:SystemRoot\System32\cmd.exe"` and
  `$env:PATH = "$((Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment').Path);$((Get-ItemProperty 'HKCU:\Environment').Path)"`.
- **(e)** `TaskStop` kills only the wrapper shell. Find the root (`Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*electron-vite*dev*' }`) and `taskkill /PID <pid> /T /F`; confirm port 9222 free. **electron-vite does NOT hot-restart main on `src/main` edits — this task is almost entirely main-process, so budget a real tree-kill cold boot for every check.**
- **(f)** Launch: restore ComSpec/PATH, then `node node_modules/electron-vite/bin/electron-vite.js dev -- --remote-debugging-port=9222` from repo root.
- **(g)** Orphan checks walk the **descendant tree of the electron main PID** — never `tasklist` name-matching (~16 unrelated `claude.exe` on this machine). This matters doubly here: your neutrality proof includes command-line comparison of the agent processes, and a name-match would sample the wrong processes.
- **(h)** Verification driver: **CDP** on 9222 (`Runtime.evaluate` in IIFEs — top-level `const` collides across evaluates; `Page.captureScreenshot`; `Input.insertText`); `ws` in the session scratchpad, never the repo. `ELECTRON_RUN_AS_NODE=1` scripts print nothing — write to a file.
- **(i)** **`sqlite3` CLI NOT installed.** DB inspection = better-sqlite3 by absolute repo path via `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe dump.js out.json`. **Known flake: no output file on first invocation — retry once.** `_verify/` is gitignored; see `_verify/2-1-dump.js`.
- **(j)** CDP reaches `window.chorus`, so you can drive `credential:*`/`provider:*` channels (the F-4 chore proof) and craft payloads the UI never sends (the unknown-agent proof).

### Dev-machine baseline — coordinator-verified 2026-07-23, do NOT "clean up"

- **Migrations 1–5** (v5 `applied_at` `2026-07-23T13:04:06.301Z`, coordinator-applied on the real DB). **This task adds NO migration — the count must still read 5 when you finish.**
- Projects: `985d547b-…` = "Chorus" (root `C:\Projects\ContactEstablished\Chorus`), `f47ac10b-…` = "Chorus-Second" (root `C:\Projects\ContactEstablished` — the parent, **not** a git repo; F22).
- Sessions: one `claude` + one `codex`, both `exited`, both `worktree_id` NULL. **The unknown-agent proof (§10 item 5) hand-edits one of these — restore it afterwards.**
- `provider_configs` and `credential_profiles` exist and are **empty**. Your F-4 chore proof creates rows through the channels — **delete them through the channels when done**.
- **`worktrees` holds ONE row:** `9ba9b0da-…`, `detached`, branch `chorus/Chorus/24b5c1fe`, `base_branch ''`, path `…\.chorus\Chorus\wt-24b5c1fe`. **⚠ That row, its directory, and its branch are a retained regression fixture — do not remove any of the three.**
- Leftover `chorus/*` branches with no worktree (normal, leave them): `39b6f2fe`, `54098146`, `605843db`, `ca1eff01`, `cc30c7be`.
- **F20, stated as fact:** execution sessions here run with a **redirected AppData but a real `C:\Projects`** (Tasks 3-1 and 3-2 both saw redirected project ids `a43b395d…`/`b684e96e…`). Your filesystem/git evidence is trustworthy; your DB evidence describes a different DB and the coordinator re-verifies against the real one. **Dump the `projects` table in every DB dump and quote the ids.** For THIS task DB evidence is peripheral (no schema change) — the session-row hand-edit and its restoration are the only DB writes you make.

## §4 Ground Yourself First (Read BEFORE Editing)

Docs, in this order:

- `CLAUDE.md` — locked rules (Zod in main only; D14 plain payloads; **ask before adding dependencies** — this task needs none).
- `docs/Features/Foundation/roadmap.md` — §6 **D34** (the adapter contract, resolutions (a)–(f)) and **D36** (your chore, ratified 2026-07-23); §5 facts **F16, F20, F22, F24**.
- `docs/Features/Foundation/CouncilBriefs/CouncilBrief-3.1-AdapterInterface-Findings.md` — the filed findings. **Read AFTER D34 and remember: its verbatim TypeScript does NOT compile as written and four resolutions patch it. Where it disagrees with the spec, the spec wins.**
- `docs/Features/Foundation/Tasks/Phase-3-Overview.md` — phase contract, file-ownership matrix, cross-cutting rules.
- `docs/Features/Foundation/Tasks/Task-3-3.md` — **THE task contract, including the D36 chore's own scope table. THIS GOVERNS.**
- `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-3-3.md` — **NORMATIVE under D34.** §1 explains the four findings defects and their fixes; **§2 is the interface text to transcribe, not paraphrase**; §§3–10 give near-final code for `mergeCapabilities`, the adapters, the registry, the `cliDetect` split, `SessionManager.spawn`, the wire, and `LaunchDialog`. Any deviation from §2 must be flagged in the commit message with its reason.

**You do NOT need** the CR-3.0 vault findings, the 3-4/3-5/3-6 docs, or `Task-3-2-ImplementationReport.md` (skim §17/§19 of the report if curious — your chore implements three of its findings, but the D36 entry and Task-3-3.md's chore table are the authoritative statement of them).

### Code state — verified 2026-07-23 at `a0b6a5e`; trust this over any older doc line

- Baseline: typecheck 0; **193/193 across 9 files** — `src/shared/ipc.test.ts` (71), `src/main/services/worktrees.test.ts` (30), `src/shared/layout.test.ts` (26), `src/main/services/vaultCore.test.ts` (21), `src/renderer/src/palette/commands.test.ts` (17), `src/main/services/logger.test.ts` (10), `src/renderer/src/stores/layout.test.ts` (7), `src/main/services/restore.test.ts` (6), `src/renderer/src/stores/view.test.ts` (5); `npm run grep:secrets` clean.
- **`src/main/services/cliDetect.ts`** — `resolveCli` at **46** (synchronous, `execFileSync('where.exe')`; throws when nothing spawnable); `pickSpawnable` prefers `.exe`, else `{file:'cmd.exe', args:['/c', shim]}`; `DETECTED_TOOLS` at **65**; module-private `detectOne` at **67** (`--version`, 10 s timeout, `windowsHide`, first line, `'unknown'` on probe failure); memoization var `detection` at **97**; `detectClis()` at **100**. **`resolveCli` stays exported and unchanged** — the adapters call it. Watch the import cycle (spec §6): adapters import `resolveCli` from `cliDetect`, `cliDetect` imports `getAdapter` from `registry` — tolerable because `getAdapter` is only *called* at detect time; if the bundler objects, extract `resolveCli`/`pickSpawnable` into a `cliResolve.ts` leaf rather than fighting it.
- **`src/main/services/sessionManager.ts`** — `import { resolveCli }` at **3**; `launch(agent, cwd, sessionId)` at **79** (**synchronous — must stay so**); `private spawn` at **256**; `const cli = resolveCli(agent)` at **257**; `env: process.env as Record<string, string>` at **269** with the D5 comment above it. **The env line and comment are UNTOUCHED this task** — `envAdditions`/`secretEnv` are declared, empty, and deliberately NOT merged (spec §7 explains why merging empty objects would still be a scope breach).
- **`src/shared/ipc.ts`** (693 lines) — `IpcChannel` closes at **81** (`CredentialDelete` at 80); `agentKindSchema` at **87**; the Task 3-2 banner at **324**; `credentialProfileMetaSchema` at **414** (your F-5b chore edit); `detectedCliSchema` at **512** (your D34(f) widening: `displayName` + `agentKind`, both **required-nullable**, plus the new `adapter:list` schemas under a `Task 3-3` banner).
- **`src/main/ipc.ts`** (918 lines) — `registerIpc` at **168** (params through **172**, `vault: CredentialVault` last); `session:restart` handler at **415** with **the `agentKindSchema.parse(row.agent)` throw at 428 — D34(c) replaces exactly this line** with a `getAdapter` lookup returning `{ok:false, reason}` inline; provider/credential handlers **657–789**; the `cli:detect` one-liner at **792**; simple invoke handlers from **881**.
- **`src/preload/index.ts`** (164 lines) — provider/credential forwarders at **113–135**; event subscriptions from **137**; `ChorusApi` inferred at **162**. One new forwarder: `listAdapters`.
- **`src/renderer/src/components/LaunchDialog.vue`** — `const labels` at **26**, `const AGENT_KINDS` at **27** (**both deleted this task**); `detectClis()` consumed at **51** inside `onMounted`. Cards render `labels[a.name]`. Spec §9 gives the replacement; **the component gets smaller.**
- **`src/main/services/logger.ts`** — pino options object at **75–91**: `redact` at 77, `formatters` at 78, `hooks` at 84. **Your F24 `serializers` entry joins this options object.** `scrubSecrets` and `SCRUB_PLACEHOLDER` are exported.
- **`src/main/services/vault.ts`** — `replaceProfile` at **135**; the creation-time fingerprint check it must mirror is at **75** (`getCredentialProfileByFingerprint(providerId, hash)`, storage accessor at `storage.ts:426`). Remember the **own-row exemption**: `existing.id !== id`.
- **There is no `src/main/adapters/` directory and no `docs/Features/Foundation/AdapterAuthoring.md`** — you create both.
- `src/preload/index.d.ts` is never hand-edited (`ChorusApi` is inferred).

### Git checks (run first)

```powershell
git branch --show-current   # expect: main
git status --porcelain      # expect: docs-only entries (see §5)
git log --oneline -1        # expect: a0b6a5e or descendant
git config user.email       # expect: mwilson29072@gmail.com
git worktree list           # expect: main tree + .chorus\Chorus\wt-24b5c1fe
```

## §5 Pre-existing Changes Warning

**The working tree carries docs-only changes from the Phase 3 re-kickoff and the 3-2 completion review:**

```
 M docs/Features/Foundation/Tasks/Phase-3-Overview.md
 M docs/Features/Foundation/roadmap.md
?? docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-3-2.md
?? docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-3-3.md
?? docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-3-4.md
?? docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-3-5.md
?? docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-3-6.md
?? docs/Features/Foundation/Tasks/Task-3-2-ExecutionPrompt.md
?? docs/Features/Foundation/Tasks/Task-3-2-ImplementationReport.md
?? docs/Features/Foundation/Tasks/Task-3-2.md
?? docs/Features/Foundation/Tasks/Task-3-3.md
?? docs/Features/Foundation/Tasks/Task-3-4.md
?? docs/Features/Foundation/Tasks/Task-3-5.md
?? docs/Features/Foundation/Tasks/Task-3-6.md
```

Plus this prompt itself. **These may or may not be committed by the time you start** — either way: **do not revert, stage, or commit anything under `docs/` EXCEPT `docs/Features/Foundation/AdapterAuthoring.md`, which commit 2 creates and commits** (it is the one docs file in your scope — CR-3.1 action item 12). If `git status` shows anything outside `docs/` at session start, **stop and ask**. `_verify/` is gitignored — harness artifacts go there freely.

## §6 Resolved Decisions and Findings That Bind This Task

Quote; do not relitigate.

- **D1** (locked): all Zod in main only. **D3** (locked): sessions live in main. **D14** (locked): plain-object IPC payloads.
- **D4** (locked): verify a tool's API against its own docs/typings at execution. **Binds here:** pino 10.3.1's serializer signature (the F24 chore); anything you're tempted to hardcode into an adapter (this task should need almost none — neither agent gets flags today, and **that "almost none" is a reportable finding, not an assumption**). `InstallationStatus.authenticated` stays **unset** — an auth probe would break the neutrality gate.
- **D16** (RESOLVED 2026-07-19): the restore contract. Its spawn-failure path (catch → heal to `exited` → log) is **exactly the path D34(c) routes unknown agents through** — you change no restore code; `getAdapterOrThrow` throwing inside `spawn` is caught by the machinery that already exists.
- **D25** (RESOLVED 2026-07-20): F14 stays deferred — no restart-event change, no new restart driver.
- **D33** (RESOLVED 2026-07-22): the vault contract. Binds this task only at the seams: `ResolvedCredential` is `{envVarName, value, isSecret: true}`; `secretEnv` is separate from `envAdditions` so main can register scrubber values and keep logs clean. **Declared, tested at the unit level, inert at runtime.**
- **D34 — THE ADAPTER CONTRACT** (RESOLVED 2026-07-22, council unanimous Q1–Q5 + coordinator resolutions (a)–(f), Matthew-ratified). The resolutions you must not "fix back":
  - **(a)** `SupportsStateDetection` and `OutputInterpreter` are **STRUCK** — the findings declared them in contradiction of their own Q4 majority. They appear **nowhere**, grep-verified.
  - **(b)** `AgentKind` derives from `agentKindSchema` in `src/shared/ipc.ts` — **never** from the registry (`keyof typeof staticRegistry` violates the process boundary AND was widened to `string` by the findings' own annotation). The registry is typed **`Record<AgentKind, AgentAdapter>`** via a **type-only** import — exhaustiveness stays compiler-enforced.
  - **(c)** an unknown persisted agent **degrades, never crashes**: restore heals it via the existing D16 path; `session:restart` returns `{ok:false, reason}` inline instead of the line-428 throw. There is no `'failed'` status and no notification centre until Phase 4.
  - **(d)** **env policy has ONE owner: main.** `buildLaunch` contributes `envAdditions` + `secretEnv` only; no adapter ever sees or builds the full environment; `cols`/`rows` stay in `SessionManager`.
  - **(e)** `env_var_name`: provider override ?? adapter default — the resolver ships now, consumed in 3-6.
  - **(f)** `cli:detect` grows adapter display data. **Coordinator refinement, flag it in the commit message:** `agentKind: agentKindSchema.nullable()` (typed) instead of the sketched boolean flag; and the **`adapter:list` channel is a coordinator ADDITION** beyond D34(f) — static declarations (auth methods + capabilities) so Task 3-4 doesn't hardcode them; `cli:detect` keeps installation state. Flag both.
- **D36** (RESOLVED 2026-07-23): **your commit 1.** Three hardenings from the 3-2 review: (a) F24 err-serializer scrub; (b) `replaceProfile` provider-scoped duplicate check **with the own-row exemption** — a same-key replace of the profile's own row must still succeed; (c) `.strict()` on `credentialProfileMetaSchema` — the shipped clause-3 test flips from stripped-output to **throws**. Kept OUT: any `unavailable_since` semantics change (F-5a stays contract-literal).
- **F16**: FKs enforced — peripheral here; do not disturb 3-2's delete ordering.
- **F20**: redirected AppData, real `C:\Projects` — §3 baseline block. Quote project ids in any dump.
- **F24** (found 2026-07-23): the logger gap your chore closes — `hooks.logMethod` scrubs **string args only**; `{ err }` objects serialize message/stack verbatim.

## §7 Implementation Scope

Follow the two Exact Scope tables in `Task-3-3.md` (chore + task) and the near-final code in `ImplementationSpec-3-3.md`. Summary:

### Commit 1 — chore (D36)

| File | Change |
|------|--------|
| `src/main/services/logger.ts` | `serializers: { err }` in the pino options (75–91): wrap `pino.stdSerializers.err`, apply `scrubSecrets` to serialized `message` + `stack`. **Export the wrapped serializer** for direct unit testing. D4-verify the signature against the installed typings. |
| `src/main/services/logger.test.ts` | Error with key-shaped message/stack → both scrubbed; ordinary Error → byte-identical. |
| `src/main/services/vault.ts` | `replaceProfile` (135): the provider-scoped fingerprint check from `createProfile` (75), refusing `duplicate` only when `existing.id !== id`. |
| `src/shared/ipc.ts` | `credentialProfileMetaSchema` (414) gains `.strict()`. |
| `src/shared/ipc.test.ts` | Clause-3 test flips: digest-carrying object now **throws**; clean meta still parses. |

### Commit 2 — task

| File | Change |
|------|--------|
| `src/main/adapters/types.ts` | **Create.** Transcribe spec §2 — the normative interface. Types + guards only. |
| `src/main/adapters/capabilities.ts` | **Create.** `mergeCapabilities` with the null-vs-undefined rule (spec §3). |
| `src/main/adapters/claude.ts`, `codex.ts` | **Create.** Spec §4: `buildLaunch` delegates to `resolveCli(this.id)`; `envAdditions: {}`; `secretEnv` via the shared credential helper; capabilities declared per the §4.2 honesty rules (`reasoningEffort: null` — Phase 3a's job; nothing declared that wasn't verified this session). |
| `src/main/adapters/registry.ts` | **Create.** Spec §5: `staticRegistry: Readonly<Record<AgentKind, AgentAdapter>>` (type-only import), `getAdapter` (widening lookup), `getAdapterOrThrow`, `UnknownAgentError`. |
| `src/main/adapters/adapters.test.ts` | **Create.** §10's table. |
| `src/main/services/cliDetect.ts` | Agent entries route through `detectViaAdapter`; git/docker/node keep `detectOne` (which gains `displayName: null, agentKind: null`). Memoization and probe logic **unchanged**. |
| `src/main/services/sessionManager.ts` | `spawn` (256): `getAdapterOrThrow` → `isPtyAdapter` guard → `buildLaunch` → `pty.spawn(request.executable, [...request.args], …)`. **Line 269's `env: process.env` and its D5 comment stay.** `cols: 80, rows: 24` stay. |
| `src/shared/ipc.ts` | `detectedCliSchema` (512) += `displayName: z.string().nullable()`, `agentKind: agentKindSchema.nullable()`; new `adapter:list` channel + schemas under a `Task 3-3` banner. |
| `src/main/ipc.ts` | Line 428's `agentKindSchema.parse(row.agent)` → `getAdapter` lookup with inline refusal (D34c); `adapter:list` handler (a map over `staticRegistry`, outbound-parsed); `cli:detect` handler untouched (the new fields come from `detectClis` itself). |
| `src/preload/index.ts` | One `listAdapters` forwarder. No Zod. |
| `src/renderer/src/components/LaunchDialog.vue` | Delete `labels` + `AGENT_KINDS` (26–27); cards from the wire per spec §9. **Verify the not-found disabled card still renders** (spec §9's two consequences). |
| `src/shared/ipc.test.ts` | Widened detect schema (required-nullable rejections) + `adapter:list` cases. |
| `docs/Features/Foundation/AdapterAuthoring.md` | **Create** (CR-3.1 action 12): narrowing idiom, both-halves guard rationale, worked example that **compiles against the shipped types**, the declared-but-unimplemented list, the null-vs-undefined rule. |

**Explicitly do NOT touch:** `src/main/services/restore.ts`, `storage.ts`, `worktrees.ts`, `git.ts`, `notifications.ts`, `vaultCore.ts`, `secret-patterns.json`, `scripts/secret-grep.mjs`, `src/shared/layout.ts`, `src/preload/index.d.ts`, any renderer file beyond `LaunchDialog.vue`, and — in commit 2 — the files commit 1 owned. If a change seems to require another file, raise it loudly in the summary.

### Key invariants

- **The interface matches spec §2 exactly**; deviations are flagged with reasons in the commit message (normative under D34).
- **`buildLaunch` is synchronous**; `SessionManager.launch()` stays synchronous.
- **No `as any`, no `@ts-expect-error`, no `as unknown as` anywhere in `src/main/adapters/`** — the two sanctioned casts are `mergeCapabilities`' boundary `as AgentCapabilities` and the registry's widening lookup, both documented in the spec.
- **`envAdditions` is `{}` for both adapters**, `secretEnv` is `{}` for a credential-free spec, and **neither is merged into the spawn env** — declared, inert.
- **Every capability descriptor that is non-null has an implemented method** (the capability-honesty test), and both shipped adapters narrow to `false` on `supportsMcp`/`supportsHooks`/`supportsResume`.
- **`DETECTED_TOOLS` order is unchanged** — card order in the dialog derives from it now.
- **The unknown-agent path never crashes the app and never touches another session.**

## §8 Strict Non-Goals

- **No behavior change of any kind in commit 2.** Not a better error message, not a tidier argv, not an "improved" probe. If the refactor tempts you, write it down and raise it.
- **No env policy change** — D5 stands until Task 3-6; the allow-list is 3-6's; the spawn env line is untouched.
- **No credential involvement** — `PtyLaunchSpec.credential` is always `undefined`; the vault is not imported by any adapter file.
- **No `SessionManager` PTY/API session split** (D34 Q2: Phase 3 restructures the adapter side only). **No `ApiAgentAdapter` instances.**
- **No `detectState`, no `OutputInterpreter`, no `SupportsStateDetection`** (D34a) — grep-verified absent.
- **No `resumeSession`/MCP/hooks implementations** — extension interfaces declared only.
- **No new agent kinds; the wire vocabulary stays `'claude' | 'codex'`.**
- **No `AbortSignal` plumbing beyond the signature; no `InstallationStatus.authenticated` probing.**
- **No new dependency.**
- **In commit 1: nothing beyond the five chore files; no `unavailable_since` semantics change (F-5a).**
- **Do not delete the `wt-24b5c1fe` fixture (row, directory, or branch).** Do not revert/stage/commit `docs/` beyond `AdapterAuthoring.md`. **Do not push, open a PR, amend, or rebase.**

## §9 Required Workflow

1. **Ground per §4**, then — **before any edit** — capture the neutrality baseline: (a) the full `cli:detect` JSON over CDP; (b) both agents launched side by side, `Get-CimInstance Win32_Process` command lines for the electron main's descendant agent processes; (c) a screenshot of the launch dialog. Tree-kill. These are your diff anchors; **without them the task cannot be verified.**
2. **Commit 1 — chore.** Implement F24 + F-4 + F-5b; unit tests; `npm run typecheck` + `npx vitest run` + `npm run grep:secrets`; the F-4 CDP runtime proof (create two profiles on one provider → replace B with A's key refused, B with B's own key succeeds → **delete the rows through the channels**). Self-review against the chore table. **Commit**, narrated as a flagged D36 chore.
3. **Commit 2 — task.** `types.ts` first (transcribe spec §2), then capabilities → adapters → registry → cliDetect → sessionManager → wire → preload → LaunchDialog → `AdapterAuthoring.md`. Unit tests as you go.
4. **Gates:** typecheck, vitest, grep:secrets, plus §10's grep gates.
5. **Runtime verification (§10 items 1–6)** — the neutrality diffs against step 1's baseline, the unknown-agent proof, the PATH-rename card proof.
6. **Self-review the diff** against `Task-3-3.md`'s Review Checklist — especially: guards compile and are used; no casts in `src/main/adapters/`; the Codex `cmd.exe /c` indirection survives.
7. **Commit**, narration style of `0e0640a`/`a0b6a5e`: plain-English paragraph, then `Technical notes:` bullets stating the D4 outcomes, the two flagged coordinator refinements (typed `agentKind`; the `adapter:list` addition), and any spec-§2 deviation with its reason. Verify `git config user.email` = `mwilson29072@gmail.com`. `Co-Authored-By:` trailer naming the model that did the work.
8. **Do not push, do not open a PR, do not amend or rebase.**

## §10 Verification Commands

```powershell
npm run typecheck          # zero errors (G1)
npx vitest run             # green — 193 baseline + your new cases
npm run grep:secrets       # (G4) exit 0
```

Grep gates — run and report hit counts:

```powershell
git grep -n "SupportsStateDetection\|OutputInterpreter\|detectState" -- src   # expect: NOTHING (D34a)
git grep -n "as any\|@ts-expect-error\|as unknown as" -- src/main/adapters    # expect: NOTHING
git grep -n "AGENT_KINDS\|labels\[" -- src/renderer                           # expect: NOTHING
git grep -nE "from '.*main/" -- src/shared src/renderer src/preload           # expect: NOTHING (D34b boundary)
git grep -n "keyof typeof staticRegistry" -- src                              # expect: NOTHING (D34b)
```

App launch: restore ComSpec/PATH (§3d), then:

```powershell
node node_modules/electron-vite/bin/electron-vite.js dev -- --remote-debugging-port=9222
```

### New unit tests

`src/main/adapters/adapters.test.ts` — must import neither `electron` nor `node-pty`:

| Case | Expected |
|---|---|
| per adapter: `buildLaunch({sessionId, cwd})` `.executable`/`.args` | **equal `resolveCli(<id>)`'s output, compared by CALLING `resolveCli` in the test** — never a hardcoded path (a literal would encode this machine's install layout) |
| per adapter: credential-free spec | `envAdditions` empty AND `secretEnv` empty |
| per adapter: spec with a fake credential | `secretEnv = {[envVarName]: value}`, `envAdditions` free of it |
| `mergeCapabilities`: undefined detected / empty object | identity |
| `mergeCapabilities`: partial with one field | only that field overridden |
| `mergeCapabilities`: **explicit `null` overrides a non-null base** | the D34-risk-7 test — null means "probe determined absent" |
| registry: **iterate `agentKindSchema.options`** — every kind resolves | survives Phase 3a's widening; do not hardcode two names |
| `getAdapter('nope')` / `getAdapterOrThrow('nope')` | `undefined` / throws `UnknownAgentError` naming the id |
| guards: `isPtyAdapter` true for both; `supportsMcp`/`supportsHooks`/`supportsResume` **false for both** | asserted explicitly |
| capability honesty, **generic**: every non-null descriptor ↔ implemented method | catches a future adapter that declares without implementing |

`src/shared/ipc.test.ts` (Task 3-3 banner): widened `detectedCliSchema` accepts agent + non-agent rows, **rejects a row missing `agentKind` or `displayName`** (required-nullable, the 1b-1 discipline); `adapterListResponseSchema` round-trips a realistic payload.

Chore tests: per §7's commit-1 table.

### RUN the app, don't just compile (G2)

Cold-boot after every main-process edit (§3e). Screenshot or dump each step.

1. **`cli:detect` diff.** Post-refactor JSON vs your step-1 baseline: **every pre-existing field byte-identical for all five tools** (name, found, path, version); the only additions are `displayName`/`agentKind`. Any version/path drift between captures invalidates the comparison — recapture both sides in one session and say so.
2. **Both agents launch side by side**; both TUIs paint (an auth/login screen counts — report it as the expected signal, not a failure). Then: restart a killed pane; tree-kill + cold-boot to prove D16 restore relaunches into the same layout; close a pane and confirm row deletion.
3. **Process-tree command-line diff.** `Get-CimInstance Win32_Process` descendant walk, agent command lines vs baseline: **identical**. This is the check that catches a changed `cmd.exe /c` wrapper for Codex — the single likeliest silent regression.
4. **`adapter:list` over CDP** — dump the full response; it carries static declarations only (no installation state, no secret-adjacent field), and both entries' auth methods and capabilities match the adapters' declarations.
5. **Unknown-agent proof (D34c).** Hand-edit one session row's `agent` to `'gemini'` (dump-script pattern, §3i). Cold-boot: the restore engine heals it to `exited` with a pino-logged reason, **the other session restores normally, the app does not crash**. `session:restart` on it over CDP → inline `{ok:false}` naming the id. **Restore the row's original value afterwards and prove it with a dump quoting the `projects` table (F20).**
6. **Not-found card proof.** Temporarily rename `codex` off PATH (or point PATH past it), cold-boot, open the launch dialog: the Codex card **still renders, disabled, "not found"** — deleting `AGENT_KINDS` must not have removed the guarantee (spec §9's consequence 2). Restore PATH; confirm detection recovers on the next boot.
7. **Console hygiene** throughout: zero `An object could not be cloned`, zero uncaught errors, zero unhandled rejections.

## §11 Failure Honesty Clause

Capture exact output on any failure, explain it, report it. **Never claim success you did not directly observe.**

**Specifically may NOT be reported as success:**

- a neutrality claim without the **step-1 baseline captured before your first edit** — a post-hoc "it looks the same" is not a diff;
- a command-line-identical claim from name-matched processes rather than a **descendant-tree walk** (§3g);
- `buildLaunch` correctness asserted against hardcoded strings instead of against `resolveCli`'s live output;
- an unknown-agent claim reasoned from code rather than obtained by **actually hand-editing the row and cold-booting**, or one where the row was not restored afterwards;
- skipping the **PATH-rename card proof** (§10 item 6) — it is the only check that catches the not-found regression the `AGENT_KINDS` deletion makes possible;
- an F-4 chore claim without both halves: **refused for a different profile AND succeeded for the own-row same-key replace**;
- an F24 claim tested only through the exported function but never through an actual `logger.error({ err }, …)` emission;
- "the spec was followed" without listing the spec-§2 deviations (or stating there were none) in the commit message.

**F20 (§3/§6):** DB evidence describes the redirected DB; quote the `projects` table ids in every dump; the coordinator re-verifies the session-row restoration against the real DB. **If something fails, report DONE_WITH_CONCERNS or BLOCKED with exact evidence** — a truthfully-failed proof beats a claimed one. Known environment conditions (§3 quirks, dump-script flake, Codex first-run prompts, Claude auth state) are not failures.

## §12 Final Reporting Requirements

Write a detailed summary for coordinator review containing:

- **Status:** DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED.
- **BOTH commit SHAs** + one-line descriptions, in order, confirmation they were not squashed (D36).
- **Environment statement** — the project ids your dumps saw (F20), and confirmation the hand-edited session row was restored.
- **D4 report** — pino's serializer signature as the installed typings state it; anything verified against a CLI's own output, and the explicit statement that the adapters hardcode **no** flags or env-var names this task.
- **The neutrality evidence** — baseline and post-refactor `cli:detect` JSON (by filename), the field-level diff, the command-line comparison, and the launch/restart/restore/close observations.
- **The two flagged coordinator refinements** (typed `agentKind`; `adapter:list`) and **any spec-§2 deviation** with its reason — or the statement that §2 was transcribed exactly.
- **Chore evidence** — the F-4 both-halves proof, the F24 emission proof, the flipped clause-3 test.
- **Grep gate results** with hit counts (all five §10 gates).
- **Files changed** per commit with one-line rationales; anything beyond §7's tables flagged loudly.
- **Verification transcript** — typecheck, vitest (new names + new total), grep:secrets, runtime items 1–7 individually with what was actually observed.
- **Acceptance criteria** from `Task-3-3.md` restated pass/fail, plus Phase-3-Overview's behavior-neutral and renderer-no-hardcoded-names boxes.
- **Non-goals confirmation** — each §8 item, explicitly including: spawn env line untouched, no vault import in adapters, no API adapter instances, D34(a) names absent.
- **Fixture end-state** — `git worktree list`, `git branch --list "chorus/*"`, `wt-24b5c1fe` intact; migration count still **5**; `provider_configs`/`credential_profiles` empty again after the chore proof.
- **Residual risks / notes for Task 3-4** — anything the Settings view should know about `adapter:list`'s final shape, and for 3-6: the exact `ResolvedCredential`/`PtyLaunchRequest` shapes as shipped.
- **Final git output**, fenced: `git status --porcelain` and `git log --oneline -5`.

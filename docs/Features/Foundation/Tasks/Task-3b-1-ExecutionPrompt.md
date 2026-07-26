# Task 3b-1: The API-Mode Session Primitive — Execution Prompt

## Role

You are the Coordinator for Chorus — Foundation **Phase 3b, Task 3b-1** (the api-mode session primitive). **This task OPENS Phase 3b.**

Repo root: `C:\Projects\ContactEstablished\Chorus`

Expected branch: `main` — confirm with `git branch --show-current`; do **NOT** switch or create branches without instruction.

**Expected code HEAD for `src/`: `341ea5c`** (Task 3a-5 — `launch_profiles`, the dialog default, one-click relaunch; closes Phase 3a). Docs-only commits may sit on top. **No production code has changed since `341ea5c`.** Confirm this yourself with `git log --oneline -3 -- src/` — if `src/` has moved, **stop and report before writing a line.**

Platform: Windows 11, PowerShell 7.

Chorus is a local-first, BYOK Electron + Vue 3 + TypeScript desktop app for running multiple AI coding agents in parallel terminal panes. Windows-only v1.

---

## ⚠⚠ STOP — the council findings you will read DO NOT COMPILE

**Read this before you read the findings, because you will read them and they are wrong in four specific ways.**

`CouncilBriefs/CouncilBrief-3b.0-Findings.md` is the ruling authority for this task's architecture. Its **§6 "The Producer — Verbatim TypeScript"** is **not** authoritative and does not compile. The council had the brief; it did not have the repo. **Roadmap D63 resolutions (a)–(g) correct it, and they win.**

| # | Findings §6 says | Build instead | Verified |
|:--:|---|---|---|
| **a** | `import type { Scrubber } from './sessionOutput.js'` | *(dropped — see d)* | `Scrubber` is declared at **`src/main/services/scrubber.ts:34`**. `sessionOutput.ts` only *imports* `createScrubber` from it and re-exports nothing. |
| **b** | `.js` import specifiers | extensionless — `from '../adapters/types'` | No module under `src/` uses extensions. |
| **c** | `spec.credential.key` | **`spec.credential.value`** | `ResolvedCredential` is `{ envVarName, value, isSecret: true }` (`src/main/adapters/types.ts`). **There is no `key` field.** |
| **d** | `ApiSessionDeps.scrubber: Pick<Scrubber, …>` | **STRUCK ENTIRELY** | See below. |

### ⚠ Why (d) is the one that matters

The findings' **Q4 ruling** puts scrubbing at the **consumer** — `createSessionOutput().ingest()` driven from `for await (… of handle.receive())`. Their **§6 code** puts a second scrubber **inside the factory**. Those are two different designs and the findings contain both.

It is not merely redundant. `createSessionOutput` builds its own scrubber via `createScrubber(opts.secrets)`, and a scrubber **holds a carry across chunk boundaries** — a partial tail withheld in case it is the prefix of a secret. `scrubber.ts:50–51` states the invariant:

> *the concatenation of every `push()` return, followed by `flush()`, equals the concatenation of every input chunk with secrets replaced*

**That is proven for ONE scrubber, not a chain.** Two carries in series is unproven behaviour on the app's only redaction path — and a second scrub path inside the producer is precisely the shape `sessionOutput.ts` was extracted (D46, commit `e3d72c5`) to prevent.

**The factory emits raw text. The consumer scrubs. One seam (D45(1)).**

### Three gaps the council did not raise — (e), (f), (g)

- **(e) Nothing bounds the stream in bytes or time.** One minted key per run caps **spend**, not volume. Build **both** a byte cap and a wall-clock cap. Precedent: `MODELS_RESPONSE_CAP_BYTES = 8_000_000` in `src/main/services/modelCatalog.ts`.
- **(f)** *(applies to Task 3b-4, not this task)* the brief-sanitization pre-pass must reuse `src/main/services/secret-patterns.json`.
- **(g) ⚠ Q3 AND THE PHASE'S COST RULING ARE IN TENSION, AND THE COUNCIL ANSWERED NEITHER SIDE.** Q3 ratified `ApiSessionHandle` **as declared** — `receive()` yields `string`. D64(2) requires **per-member token usage**. A stream that yields only strings has **nowhere to report what it cost**.

  **Do NOT add `usage` to `ApiSessionHandle`.** That is the SHARED primitive D45(2) binds the future interactive chat pane to; a pane that meters nothing would carry a field it never reads. **Usage is reported through an optional `onUsage` callback on `ApiSessionDeps`** — the factory's own contract, not the shared one. It also keeps usage **out of the text stream**: a final `receive()` yield would flow through the scrubber and the ring buffer and be rendered in the transcript as though the model had said it.

**⚠ D63's coordinator resolutions (a)–(g) are RATIFIED — `RESOLVED 2026-07-26 · coordinator resolutions (a)–(g) Matthew-ratified 2026-07-26`.** They are binding, exactly as D34's resolutions (a)–(f) were for the adapter interface. (a)–(c) are objective compile errors; (d)–(g) are judgement calls with their reasoning written out in the decision. **If you find a resolution wrong, that is a §4 CR trigger — flag, brief, pause. Do not silently revert to the findings' code.**

---

## ⚠ STOP — the other thing that will cost you an hour if you skip it

**F31 is SOLVED and its fix is mandatory. `--user-data-dir` reaches the real database but NOT the DPAPI context unless you bring the key with it.**

`safeStorage` blobs are wrapped with **Chromium's OSCrypt key, stored in `<user-data-dir>/Local State`**. Copy `chorus.db` without it and **every pre-existing credential blob is undecryptable** while blobs written in that same boot decrypt fine — an asymmetry that cost Task 3a-3 an hour and was recorded as UNPROVEN until Task 3a-5 solved it.

**Copy `Local State` beside the database for every rehearsal or copy-DB run. Treat a credential blob as bound to the user-data DIRECTORY, not just the Windows user.**

**Probe decryptability EARLY**, before building anything that depends on it: `_verify/3a-4/eval-vault-probe.js` or `_verify/3a-3/eval-vault-diagnose.js`. **If `OR milestone key` does not decrypt: STOP and ask Matthew to re-enter it through the running app's Settings UI.** That is a **human** step. **Never ask for a key's text in chat, never read it from a file, never accept it in any form, never write it to disk yourself.**

---

## Goal

Give Chorus the ability to hold a conversation with a model over HTTP — **one module, one primitive, no council** — so that Task 3b-3's council and a later native chat pane are two consumers of one mechanism rather than two mechanisms.

The deliverable is `createApiSession()`: a factory taking a resolved credential and a model id, POSTing to an OpenAI-compatible chat-completions endpoint with `stream: true`, returning an `ApiSessionHandle` whose `receive()` yields content deltas. Its output is scrubbed and buffered by **the existing `sessionOutput.ts` seam**, driven by the caller.

**A primitive adopted by four consumers is worth proving with one.** If the shape is wrong, it is wrong in one file with one caller, not woven through a council orchestrator.

### One Commit in This Session

**ONE intentional narrated commit (G3).** If a pre-existing defect surfaces, **raise it rather than folding it in**.

---

## Ground Yourself First

Read these before editing anything. Paths are relative to repo root.

- `CLAUDE.md` — locked stack; **D1** Zod-in-main; **D14** plain-object IPC; secrets via safeStorage, never in argv/logs/transcripts; **D4** verify external API shapes against the vendor's own docs at execution time.
- `docs/Features/Foundation/Tasks/Task-3b-1.md` — **GOVERNS SCOPE.** Read all of it.
- `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-3b-1.md` — **GOVERNS EXACT CONTENTS.** §2 (the `onUsage` boundary and why it is not on the handle), §3 (the exact module surface and the two constants' rationale), §4 (the SSE decoder's three failure modes), §5 (the three `types.ts` insertion points), §6 (`api:probe`), §7 (verification).
- `docs/Features/Foundation/Tasks/Phase-3b-Overview.md` — the phase contract, the file-ownership matrix, the gates, the standing conditions.
- `docs/Features/Foundation/CouncilBriefs/CouncilBrief-3b.0-ApiSessionProducer.md` and `-Findings.md` — **the rulings bind; §6's code does not.** See the STOP section.
- `docs/Features/Foundation/roadmap.md` — §5 (**F20**, **F25**, **F27**, **F29**, **F31**), §6 (**D1, D14, D33, D34, D45, D46, D52, D55, D56, D58, D60, D62, D63, D64**), §7 Phase 3b.
- `docs/PLAN.md` §4 (adapter abstraction), §6 (credentials/providers/BYOK).
- **`docs/Features/Foundation/Tasks/Task-3a-5-ExecutionPrompt.md`** — the immediately prior session's prompt. Its harness caveats are the closest thing to current, and its *format* is the house style for the report you owe.

### Code to Inspect — anchored to NAMED SYMBOLS, never line numbers

All verified present by the coordinator **2026-07-26 at `341ea5c`**. (Line numbers appear only where this prompt quotes a specific fact.)

- **`src/main/adapters/types.ts`** — `ApiSessionHandle`, `ApiLaunchSpec`, `ApiAgentAdapter`, `ResolvedCredential`, the `AgentAdapter` union and `isPtyAdapter`/`isApiAdapter`. **Read this first.** `getModels` and `startApiSession` have **ZERO implementations**; `isApiAdapter` has zero callers.
- **`src/main/services/sessionOutput.ts`** (107 lines) — `createSessionOutput({ secrets, maxChars, flushMs, onText })` → `{ ingest, flush, buffer, dispose }`. **Read its header comment in full**; it already names api mode as the second driver and lists the five invariants it preserves. **This is the seam. Do not build beside it.**
- **`src/main/services/scrubber.ts`** — `createScrubber(secrets)` → `{ push, flush, pendingLength }`, and the ordering invariant at lines 50–51.
- **`src/main/services/modelCatalog.ts`** — the transport precedent: `FetchLike` / `FetchResponseLike` / `FetchInitLike` (**import these; do not re-declare**), `MODELS_RESPONSE_CAP_BYTES`, `readCapped(res, capBytes)` cancelling the reader on overflow, `refuse()` applying `scrubSecrets` on the way out, and refusals ordered **before** any decryption.
- **`src/main/services/openrouterKeys.ts`** — injected `fetchImpl`, 10 s timeout, `Result<T>`, and the **decrypt-per-use thunk** rather than a cached string. Note its header: it is *structurally incapable of inference* — **keep it that way; do not add a completion endpoint to it.**
- **`src/main/ipc.ts`** — the nested **`resolveCredential(profileId, agent)`** inside `registerIpc`: five ordered refusals, label-only messages, the **management refusal that sits BEFORE decryption**, returning `{ ok, credential, route, authType }`. **You add a caller. You never fork it.**
- **`src/main/ipc.ts`** — the `session:launch` handler's `!path.isAbsolute(req.cwd) || !fs.existsSync(req.cwd)` cwd boundary (**`ipc.ts:540`**), as the house pattern for main-side validation.
- **`src/main/adapters/registry.ts`** (35 lines) — `Readonly<Record<AgentKind, AgentAdapter>>`, frozen, two entries. **Untouched by this task.**
- **`src/shared/ipc.ts`** — `agentKindSchema = z.enum(['claude','codex'])` at **line 157**. **Unchanged by this task.**
- **`src/main/services/sessionManager.ts`** — `spawn()`, `LaunchOptions.secrets`, and the `createSessionOutput` construction, as the reference for how a driver wires the seam. **This file must be BYTE-IDENTICAL after you finish.**
- **`src/main/services/logger.ts`** — `scrubSecrets`. **`src/main/services/secret-patterns.json`** — the ONE shared pattern list.

### Git checks to run first

```powershell
git branch --show-current
```
```powershell
git status --porcelain
```
```powershell
git log --oneline -3 -- src/
```

---

## ⚠ D4 obligations — answer these BEFORE writing the transport

The council's implementation sketch names OpenRouter's chat-completions endpoint and an SSE stream shape. **None of it is verified against the live API**, and **D4 binds: do not trust training-data memory for API syntax.**

1. **The endpoint and request shape** — path, whether `stream: true` is correct, and the exact SSE framing (`data: ` prefix, `[DONE]` sentinel, whether comment/keep-alive lines appear).
2. **⚠ WHERE TOKEN USAGE ARRIVES ON A STREAMED RESPONSE.** D64(2) and resolution (g) depend on it, and **many OpenAI-compatible APIs omit `usage` from stream chunks unless a `stream_options`-style flag is set.** **If it cannot be obtained from the stream, SAY SO AND REPORT IT** — Task 3b-3's entire cost model rests on the answer, and discovering it there is far more expensive than discovering it here. A negative is a valid, valuable finding.
3. **The error-body shape**, so a refusal can be worded without echoing a key.

**Record each answer WITH ITS SOURCE in the report.** A guess repeated as fact is what D4 exists to prevent.

**Installed CLI versions, coordinator-checked 2026-07-25:** `claude` **2.1.218**, `codex-cli` **0.145.0**. **This task changes no adapter and maps nothing onto a CLI flag**, so the D4 surface here is the HTTP API, not the CLIs.

---

## Decisions You Must Honour — all RESOLVED

- **D63 (2026-07-26, CR-3b.0)** — **Option D, 3-of-3 unanimous.** The producer is a **standalone factory outside the agent registry**. `agentKindSchema` stays `'claude' | 'codex'`; `staticRegistry` stays frozen; **D52 keeps the D34-Q5 registry lift with Phase 3d.** `ApiAgentAdapter.startApiSession` stays **dormant but documented**, becoming a one-line delegation when the registry is lifted. **Q2 OUT:** council members never enter `SessionManager` and write no `sessions` row, so **the boot restore engine structurally cannot resurrect one.** **Q3 CORRECT:** the handle is unchanged and **`dispose()` is the SOLE cancellation mechanism** — say so in a docstring. **Q4 SCRUB**, with the coverage claim bounded in the same breath. Resolutions **(a)–(g)** as above.
- **D64 (2026-07-26)** — the council surface is a **view/route** (so D45(3) stays out of the phase); **one minted key per RUN** bounds cost (3b-3's job, not yours); the deliberation-protocol `[CR]` is deferred to Task 3b-3.
- **D45(1)/(2) (2026-07-24)** — **ONE ingest-scrub seam**, and **`ApiSessionHandle` is the SINGLE primitive**; Phase 3b's council must be an **orchestrator over** it, never a parallel implementation.
- **D46 (2026-07-24)** — why `sessionOutput.ts` exists at all: *"one seam, so a second session type cannot ship unredacted by forgetting a second wiring point, which is precisely the F26 failure shape."*
- **D58 (2026-07-25)** — how a key-bearing call is admitted: **user-initiated only · decrypt at the moment of the call and drop it · refused for a profile carrying `unavailable_since` BY LABEL without re-attempting decryption · refused outright when `auth_mode` is `'management'` · read-on-2xx-only, size-capped, cancelled unread on every other path, and the parsed value never interpolated into an error.** **Your `api:probe` is a third key-bearing call and must be admitted the same way: numbered, constrained, and narrated — never slipped in.**
- **D60 (2026-07-26)** — the guarantee is stated by **credential CLASS**, not by call-site count: *no code path reachable without a user gesture may resolve a **LAUNCH** credential.* **Never restate it as a count** — that is the standing lesson.
- **D56 (2026-07-25)** — model precedence: `launch_profiles.model` > `provider_configs.model` > nothing. **`model_catalog` is never authoritative.** You create no new home for "which model".
- **D34 Q5 / D52** — the frozen registry is **not** lifted here.
- **D14** — plain-object IPC. A Pinia object is a Vue reactive Proxy; structured clone rejects it with **no compile-time signal**.
- **F27** — the honest redaction wording is *"Chorus redacts registered exact values on ingest; it cannot redact values an agent derives"* — **never** "agents cannot echo the key".
- **D40** — **stage scope files EXPLICITLY by path; never `git add -A`.**

---

## Pre-Existing Changes — Do Not Touch

The working tree at prompt time carries:

```
 M docs/Features/Foundation/roadmap.md
?? TASK-3-5-REVIEW-FABLE.md
?? TASK-3-6-REVIEW-FABLE.md
?? docs/Features/Foundation/CouncilBriefs/CouncilBrief-3b.0-ApiSessionProducer.md
?? docs/Features/Foundation/CouncilBriefs/CouncilBrief-3b.0-Findings.md
?? docs/Features/Foundation/Tasks/Phase-3b-Overview.md
?? docs/Features/Foundation/Tasks/Task-3b-1.md … Task-3b-4.md
?? docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-3b-1.md … -3b-4.md
```

**Do NOT revert, stage, delete, or commit any of them.** The two `TASK-*-REVIEW-FABLE.md` files belong to prior sessions' review record. The roadmap modification and the Phase 3b docs are this kickoff's output and are **Matthew's to commit**, not yours. **Your commit stages only `src/` files.** Never stage or revert anything under `_verify/` or `docs/`.

---

## Implementation Scope

**Exactly as `Task-3b-1.md`'s Exact Scope table** (which governs; this is the summary):

- **CREATE** `src/main/services/apiSession.ts` — `createApiSession(spec, deps): ApiSessionHandle`, SSE decoding, byte + wall-clock caps, `AbortController`. **No electron import. No storage import. No Zod. No scrubber.**
- **CREATE** `src/main/services/apiSession.test.ts` — the 12-case table plus the type-level assertion.
- **EDIT** `src/main/adapters/types.ts` — **comments and one type-level assertion ONLY**: the `dispose()`-is-sole-cancellation docstring on `ApiSessionHandle`, the `@deferred Phase 3d` docstring on `startApiSession`, and the signature-compatibility assertion. **No behavioural change, no new interface.**
- **EDIT** `src/shared/ipc.ts` — **one** channel + request/response schemas for `api:probe`.
- **EDIT** `src/main/ipc.ts` — **one** handler, reusing `resolveCredential`, driving the factory through `createSessionOutput`.
- **EDIT** `src/preload/index.ts` — one Zod-free typed forwarder. `index.d.ts` is never hand-edited.
- **CREATE (untracked)** `_verify/3b-1/` — drive scripts. `_verify/` is entirely gitignored.

### On `api:probe` — label it temporary IN THE CODE

The factory needs a live proof and has no consumer until 3b-3. This channel runs one message through it and returns the assembled text. **It is a proof, not a feature:** no renderer UI, no palette entry, no store action beyond what the drive needs.

**Put the label in the source, not only in the commit message:**

> ⚠ TEMPORARY (Task 3b-1). Exists to give the api-mode transport a live proof before Task 3b-3 has a consumer. **3b-3 must adopt it or delete it** and say which. Not a product surface.

If a change seems to require another file — **especially `sessionManager.ts`, `sessionOutput.ts`, `scrubber.ts`, `vault.ts`, `registry.ts`, or any adapter implementation — stop and raise it.** That is a scope signal, not a detail.

---

## Strict Non-Goals

- **NO council code.** No `councilService.ts`, no `councilCore.ts`, no member schema, no protocol. That is 3b-2 and 3b-3.
- **NO migration.** `MIGRATIONS.length` is **10** before and after. The phase's only migration is 3b-2's v11.
- **NO registry change.** `agentKindSchema` stays `'claude' | 'codex'`; `staticRegistry` stays two frozen entries; **`src/main/adapters/` diff is limited to `types.ts`, and that diff limited to comments plus one type-level assertion.**
- **NO `startApiSession` implementation.** It stays dormant. Implementing it *is* the registry lift, and **D52 gives that to Phase 3d.**
- **NO `SessionManager` change.** Zero lines; **byte-identical**. An api session is not a `PtySession`, writes no `sessions` row, and is invisible to `restore()`.
- **NO second scrub path** (D63(d)). The factory holds no `Scrubber` and imports none.
- **NO `getModels` implementation** — 3a-4's `model_catalog` owns model listing and **D56** says the catalog is never authoritative. Do not create a second home.
- **NO conversation persistence.** No transcript table, no `sessions` row, no `dispatches` row.
- **NO retry, no backoff, no fallback provider.** A failed call returns a refusal. Retry is a policy decision with cost consequences and has no owner yet.
- **NO minting.** One minted key per *run* is D64(2) and belongs to 3b-3. Use the standing `OR milestone key` directly.
- **NO new npm dependency.** SSE is parsed by hand; `fetch` is injected.
- **NO renderer UI**, no palette entry, no `.vue` file.
- **Do not touch** the two `TASK-*-REVIEW-FABLE.md` files or the `wt-24b5c1fe` worktree fixture (id `9ba9b0da-cecd-4960-815d-f36166cf8c00`, branch `chorus/Chorus/24b5c1fe`) — row, directory and branch all stay.

---

## Required Workflow

Work as coordinator: **D4 pass → implement → review the diff against the Implementation Spec → a code-quality pass → resolve findings → run the gates → narrate the commit.** **Do NOT push and do NOT open a pull request unless explicitly asked.**

Ordered work steps (`Task-3b-1.md` §Step-by-step governs):

1. **The D4 pass FIRST**, before writing the transport. The three obligations above determine the request body and the usage plumbing.
2. **Probe credential decryptability early** (the F31 STOP section).
3. **Write the SSE decoder and its test table before wiring anything.** It is pure and it is the part most likely to be subtly wrong.
4. **The factory body** — `AbortController` at construction; `dispose()` aborts then awaits teardown; `receive()` yields deltas; both caps enforced in the read loop.
5. **`types.ts`** — two docstrings and the assertion. **If the assertion does not compile, the FACTORY signature is wrong — fix the factory, not the assertion.** Then **deliberately break the factory signature and confirm typecheck errors**, so you know the assertion is not vacuous.
6. **The `api:probe` channel**, reusing `resolveCredential`, driving `createSessionOutput`, outbound-`.parse`d.
7. **Tests, then the gates.**
8. **The live drives (G2).**

---

## Verification Commands

Run from repo root in PowerShell.

```powershell
npm run typecheck
```
```powershell
npx vitest run
```
```powershell
npm run grep:secrets
```
```powershell
npm run dev
```

**Baseline to beat, coordinator-verified 2026-07-26 at `341ea5c`:**
- typecheck: **0 errors** (node + web)
- vitest: **702/702 across 24 files**
- grep:secrets: **clean (6 patterns over `src/`, `scripts/`, `_verify/`, `package.json`, root configs)**
- `MIGRATIONS.length` = **10** · `ipcMain.handle(` = **41** · `IpcChannel` = **44**

### Grep gates — run before the commit, quote every count

- **zero** `vault` in `src/main/services/apiSession.ts`;
- **zero** `Scrubber` / `createScrubber` in `apiSession.ts` (**D63(d)** — the factory holds no scrubber);
- **zero** `electron` imports in `apiSession.ts`;
- `agentKindSchema` still `z.enum(['claude','codex'])`; `staticRegistry` still **two** entries;
- **`src/main/adapters/` diff limited to `types.ts`**, and that diff limited to comments plus one type-level assertion;
- `src/main/services/sessionManager.ts`, `sessionOutput.ts`, `scrubber.ts` **byte-identical**;
- `MIGRATIONS.length` still **10**;
- `ipcMain.handle(` = **42**; `IpcChannel` = **45**;
- `TASK-3-5-REVIEW-FABLE.md` / `TASK-3-6-REVIEW-FABLE.md` present, unmodified, **unstaged**.

### The live drives (G2) — the whole point of the task

Boot against the **real dev DB**: `C:\Users\matth\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\chorus\chorus.db`. Electron ignores `APPDATA` but honours `--user-data-dir` — **copy `_verify/3a-4/start-realdb.ps1` into `_verify/3b-1/`**. A dump quoting projects `a43b395d…`/`b684e96e…` is the scratch DB and **discharges nothing**; the real pair is `985d547b…` (Chorus) / `f47ac10b…` (Chorus-Second).

Then, over CDP (`_verify/3a-4/cdp.js`, port 9222):

1. **One `api:probe`** on the standing route — provider **OpenRouter**, credential **`OR milestone key`**, model **`moonshotai/kimi-k3`** — with a short prompt carrying a planted token. **Assert the model's answer returns and contains the token.** A 200 with no answer proves the request, not the transport.
2. **⚠ Streaming is real, not buffered.** Assert `chunks > 1` on a response long enough to stream. **A single-chunk yield is indistinguishable from a non-streaming implementation** and would silently fail the chat pane later.
3. **`dispose()` mid-stream actually aborts.** Start a long generation, dispose, and assert the request terminated rather than running to completion in the background. **An unaborted request keeps spending after the user has moved on.**
4. **The key is nowhere it should not be.** Walk the process tree from the electron main PID via `ParentProcessId` — **never name-matching**; there are ~16 unrelated `claude.exe` on this machine and `_verify/3a-3/find-child-pids.ps1` is the proven walker. Assert **no command line holds the key or any ≥ 8-character substring of it**. **State the asymmetry honestly:** unlike Task 3-6's five-surface check, an api session **injects nothing into any child environment**, so there is **no positive half** — the key exists only in an HTTP header inside main's own process. Say that rather than implying a passed check that was never possible.
5. **⚠ The scrub seam is genuinely in the path.** Register a planted secret, ask the model to repeat a supplied string, and assert the **ingested** text is redacted. **This is the only evidence distinguishing "the seam is wired" from "the seam is declared"** — the `secrets: [credential.value]` argument to `createSessionOutput` is the whole mechanism, and omitting it leaves a wired-but-inert seam that passes every structural check.

### Harness caveats — verified through 2026-07-26

- **electron-vite does NOT hot-restart the main process**; HMR covers the renderer only. **Every main-process change needs a real cold boot.**
- **Graceful quit:** `taskkill` **without** `/F` (WM_CLOSE) does **not** terminate the dev app in this session. Use a CDP `window.close()` evaluate. Kill process **TREES** with `taskkill /PID <root> /T /F` for crash cases.
- **CDP on `--remote-debugging-port=9222`** is the proven driver. **Wrap every `Runtime.evaluate` body in an IIFE** — top-level `const` collides across evaluates.
- **⚠ Vite's SPA fallback poisons CDP-driven file reads:** `fetch('some.txt')` inside the page returns `index.html`. Use `fetch('/@fs/C:/absolute/path')`.
- **The dev window is NOT foregrounded by default** and other desktop apps steal foreground mid-run (F29). Foreground deliberately (`_verify/3a-3/focuswindow.ps1`) and verify before any screenshot check.
- **`sqlite3` is NOT installed** — use the `ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe` pattern. **Known flake: a dump script writes no file on its first invocation — retry once.**
- All artifacts under `_verify/3b-1/`.

### ⚠ Cost envelope

**Under $0.02. This task spends real money on Matthew's OpenRouter account.**

Four short completions at most: the answer drive, the streaming-multiplicity drive, the abort drive (aborted early, so cheaper), and the scrub drive. **If a drive needs a fifth completion, stop and ask.** **Do not press "Test key" on `OR milestone key`** — it is a live billable call. Report actual cost against the envelope.

**⚠ Standing condition — the dev vault holds REAL, BILLABLE credentials.** `OR milestone key` (inference) and `OR Management Key` (management, `auth_mode = 'management'`). **Never dump, echo, print, copy, or transmit `credential_profiles.encrypted_blob` or `fingerprint_hash`** — select non-secret columns explicitly and prove blob stability with `length(encrypted_blob)`. **No test, fixture, `_verify/` artifact, or probe log line may contain a real credential or key fragment**; `npm run grep:secrets` must pass over `_verify/3b-1/` too.

---

## Failure Honesty Clause

If any verification command fails for an unrelated environment reason, **capture the EXACT output, explain it, and DO NOT claim success.** An indeterminate result is reported as indeterminate and the affected acceptance criterion is marked **FAILED** — never reasoned into a pass. **An unproven claim is worse than an honest unknown, because it will be cited later as evidence.** Temporary instrumentation must be reverted, and the review checks the **COMMIT DIFF**, not the worktree.

**This applies with force to D4 obligation 2.** If token usage is not obtainable from a streamed response, **that is a finding to report, not a problem to work around** — Task 3b-3's cost model depends on the true answer.

---

## Final Reporting Requirements

Report a status of exactly one of **DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED**, plus:

- **The three D4 answers, each with its source** — endpoint/framing, **where usage arrives on a streamed response (or that it does not)**, and the error-body shape.
- **The commit SHA and every file changed** (only the Exact Scope files), confirming `MIGRATIONS.length` is still **10**.
- **Typecheck / vitest / grep:secrets results with actual numbers**, against the 0 / 702-across-24 / clean-6-patterns baseline.
- **The 12 unit cases**, with **case 12 (no credential in any output) quoted explicitly**, plus confirmation the type-level assertion **fails when deliberately broken** — an assertion that passes vacuously is worse than none.
- **Both caps proven** — byte and wall-clock.
- **The five live drives**, each with its evidence: the planted token returned by the real model; **`chunks > 1`**; the abort proven to terminate the request; the process-tree sweep with the **asymmetry stated** (no positive half exists for an api session); and the **echoed planted secret arriving redacted**.
- **The grep gate counts**, each quoted, including `ipcMain.handle(` = 41 → **42**, `IpcChannel` = 44 → **45**, the two-entry `staticRegistry`, and the byte-identical `sessionManager.ts` / `sessionOutput.ts` / `scrubber.ts`.
- **Confirmation of the narration requirements in the commit message:** why the producer sits **outside** the registry (D63 Q1, and that D52 keeps the lift with Phase 3d); **why the factory holds no scrubber (D63(d)), with the carry-chaining reason**; why `onUsage` is on the deps and not on the handle (D63(g)); what the two caps are and why one minted key would not have sufficed (D63(e)); the three D4 answers; and **that `api:probe` is a temporary proof surface Task 3b-3 must adopt or delete**.
- **Confirmation each non-goal held:** no council code; no migration; `agentKindSchema` unchanged; `staticRegistry` unchanged; `startApiSession` still unimplemented; `sessionManager.ts` byte-identical; no second scrubber; no `.vue` file; no new dependency; no retry; no minting.
- **Confirmation the two `TASK-*-REVIEW-FABLE.md` files are still untracked and unmodified**, that **nothing under `_verify/` or `docs/` was staged or reverted** (the roadmap edit and the Phase 3b docs are Matthew's to commit), and that the `wt-24b5c1fe` worktree row, directory and branch are intact.
- **Actual cost**, against the **< $0.02** envelope, with the number of completions submitted, and confirmation Test key was never pressed against `OR milestone key`.
- **Residual risks and known gaps**, and the **final `git status --porcelain`**.

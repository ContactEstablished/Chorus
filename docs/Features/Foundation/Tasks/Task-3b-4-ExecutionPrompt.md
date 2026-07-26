# Task 3b-4: The Council View, Brief In → Findings Out — Execution Prompt

## Role

You are the Coordinator for Chorus — Foundation **Phase 3b, Task 3b-4** (the council view/route). This is **Task 4 of 4**, it **CLOSES PHASE 3b**, and it carries the phase's **milestone**: a real Chorus governance CR running natively, end to end.

Repo root: `C:\Projects\ContactEstablished\Chorus`

Expected branch: `main` — confirm with `git branch --show-current`; do **NOT** switch or create branches without instruction.

**Expected HEAD: `456d3d7`** (`Task 3b-3: Chorus can hold a council…`), plus the coordinator's roadmap pass on top of it. The last commit to touch `src/` is **`456d3d7`**. Confirm both yourself:

```powershell
git log --oneline -6
```
```powershell
git log --oneline -3 -- src/
```

If `src/` has moved past `456d3d7`, **stop and report before writing a line.**

Platform: Windows 11, PowerShell 7.

Chorus is a local-first, BYOK Electron + Vue 3 + TypeScript desktop app for running multiple AI coding agents in parallel terminal panes. Windows-only v1.

---

## Goal

Close the loop D27 opened: **point Chorus at a brief `.md`, watch the deliberation stream, get a findings `.md` beside it** — the same format §4 has used since Phase 1, produced by the app instead of by Cursor.

Task 3b-3 shipped everything behind the glass: `CouncilService` runs a four-phase deliberation from brief **text** and returns findings **text**, `council:progress` broadcasts scrubbed deltas, and runs and messages persist. **Nothing reads or writes a file, and nothing renders.** This task adds the file boundary at one end, the view at the other, and the sanitization pre-pass between them.

---

## ⚠⚠ READ THIS FIRST — YOUR OWN TASK DOCS ARE WRONG IN FOUR PLACES, AND ONE OF THEM BREAKS THE MILESTONE

**D68 (RESOLVED 2026-07-26, coordinator, pre-execution) rules all four. Read the full decision in `docs/Features/Foundation/roadmap.md` §6 before implementing.** They were found by running the shipped code against the actual input the milestone names — not by reading the docs, which assert the opposite in good faith.

### 1. ⚠ THE DOGFOOD DRIVE CANNOT RUN AS WRITTEN: the brief parser cannot find the questions in a real brief

`Task-3b-4.md` says to *"point the council at an actual brief in `docs/Features/Foundation/CouncilBriefs/`"*. **Measured 2026-07-26 against the shipped `parseBriefQuestions`:**

| Brief | "Questions" found | Actually questions |
|---|---|---|
| `CouncilBrief-3b.1-DeliberationProtocol.md` | **21** | **none of the first 12** |
| `CouncilBrief-3b.0-ApiSessionProducer.md` | **23** | **none of the first 12** |

What it returns instead is §6's constraints list, §7's weighted rubric and §4's binding rulings — *"Windows-only v1."*, *"No transport change."*, *"Cost proportionality — what each round buys, per dollar (15%)."* The real §8 questions are drowned.

The parser scans the **whole document** for enumerated lines. That was correct against the short synthetic briefs 3b-3 tested it on, and it is wrong against every brief this feature exists to read. The damage is not cosmetic: members would be asked for an AGREE/DISAGREE/QUALIFY verdict on *"Windows-only v1"*, the disagreement vector and the dissent appendix would be computed over noise, and **every member pays input tokens for all 21 of them, on every round.**

**Fix it FIRST, in `councilCore.ts`, as this task's own flagged commit 1** — scope the parse to the questions **section** (a heading matching `/questions/i`), falling back to the whole document when there is no such heading. It is provably behaviour-neutral for the existing synthetic-brief tests, and shipping the view on top of a parser that cannot read a real brief would make the dogfood drive discover this at the most expensive possible moment.

### 2. The findings document is missing BOTH things `ImplementationSpec-3b-4.md` §3 requires

`assembleFindingsDocument` in `councilCore.ts` already emits the partial-run header, the detection table and the dissent appendix. It emits **neither** of §3's two requirements — verified by grep, count **0**:

- **§3.1 provenance** — which members ran, on which models, at what time, under which run id. *"A findings file whose authorship cannot be reconstructed is not usable as a record."*
- **§3.2 the standing caveat** — that these findings are **model deliberation, not verified fact**. §3 calls it mandatory: *"The file must say so, or a later reader will cite it as verification."* CR-3b.0's four compile errors are why.

Both belong in the pure core beside the dissent appendix they sit next to. **The run id and the timestamp arrive as PARAMETERS** — `councilCore.ts` has no clock and must not grow one.

### 3. `App.vue`'s `activeView` is a two-value union, not a router

```ts
const activeView = ref<'workspace' | 'settings'>('workspace')
```

D64(1) rules the council surface a view/route on the `SettingsProviders.vue` precedent — and that precedent *is* this union plus a conditional render (`App.vue:336`). A third view cannot exist without widening it.

**`src/renderer/src/App.vue` is in scope.** The grep gate *"exactly 1 new `.vue` file"* still holds: `App.vue` is **edited**, `CouncilView.vue` is the one **created**.

### 4. `council:start` needs its input REPLACED, not "widened"

`Task-3b-4.md` says the channel is *"widened to take a validated path"*. As shipped:

```ts
project_id: z.uuid().nullable(),
brief_path: z.string().min(1).max(1024),      // a recorded LABEL — main never opens it
brief_text: z.string().min(1).max(200_000)    // the actual input
```

3b-4 makes the **path** authoritative and removes `brief_text`. That is a breaking change to a schema and a test that already exist — **a replacement, not an addition. Say so in the commit.**

### ⚠ D68 amends G3 for this session: TWO commits

Precedent: **D46 / D54 / D66**, and D66 is this phase's own.

1. **The `councilCore.ts` fix commit** — the question-section parser (finding 1) and the provenance + caveat additions (finding 2), with tests. Flagged, narrated, landing **before** any view exists.
2. **The task commit** — the path boundary, the pre-pass, the writer, the store, the view, the palette command.

**Do NOT push and do NOT open a pull request unless explicitly asked.**

### D68's scope widening, exactly

**3b-4's Exact Scope gains `src/main/services/councilCore.ts` (+ its test) and `src/renderer/src/App.vue`, and NOTHING ELSE.** Everything outside that is still a raise, not a licence.

---

## ⚠ STOP — four things that are settled, and getting them wrong is the likely failure

### 1. The brief path is a SECURITY BOUNDARY, and the findings path is DERIVED

A renderer-supplied path that main opens is an arbitrary-file-**read** primitive. A renderer-supplied path that main writes is an arbitrary-file-**write** primitive, which is worse.

`ImplementationSpec-3b-4.md` §1's ordered refusals, each returning before the next is attempted: **not absolute** → **null byte** (before touching the filesystem) → **not `.md`** (case-insensitive) → **does not exist or is not a regular file** (`statSync().isFile()` — `existsSync` alone passes a *directory*, which is the `session:launch` cwd check's own lesson) → **over a size cap** (every member pays input tokens for every byte).

**⚠ Normalize with `path.resolve` and re-check AFTER normalizing.** Checking before normalizing checks the wrong string.

**The findings path is computed, never supplied:**

```ts
findingsPathFor(briefPath) => join(dirname(briefPath), `${basename(briefPath, '.md')}-Findings.md`)
```

One validated input, one computed output — that removes the write primitive as a *class* rather than guarding it. **Review Checklist item 1 is exactly this**, and it is the most serious defect available in this task.

**Overwrite vs suffix on an existing findings file is a REAL DECISION the spec deliberately leaves open (§6). Decide it and narrate it.** Silently replacing a previous council's output destroys the record §4 exists to keep.

### 2. ⚠ The sanitization pre-pass reuses ONE pattern list, and the claim it licenses is bounded

`src/main/services/secret-patterns.json` is **already** the single list — verified 2026-07-26: `src/main/services/logger.ts:2` imports it for `scrubSecrets`, and `scripts/secret-grep.mjs:19` reads the same file for the G4 gate. **Authoring a second list is forbidden**: it would let the gate and the sanitizer test different shapes, which is the exact drift that file's header exists to prevent.

**Report the pattern NAME and the LINE NUMBER. Never the matched value** — not in a log, not in a refusal, not in the view. *A refusal that echoes the secret it found is a leak wearing a warning's clothes*, and it would land in a log file the user might then share.

**Refuse vs redact on a hit is a REAL DECISION (§6). Recommended: REFUSE**, naming pattern and line so the user can fix the brief. Redacting quietly changes the text several models are about to reason about, which corrupts the deliberation *and* buries the warning. **Decide it and say which in the commit.**

**And the wording stays honest. The only sentence this task may ship, verbatim:**

> *Chorus redacts registered exact values on ingest and scans briefs for known credential shapes. It cannot redact values an agent derives, and it cannot recognize a secret it has no pattern for.*

**Never "your brief is safe."** This is the first surface a user reads a redaction claim on.

**The false-positive guard matters as much as the true positives.** A pre-pass that refuses every brief containing a git SHA is a feature nobody can use. `logger.test.ts` already establishes the fixtures — a 40-char SHA, a Windows path, a UUID, a `chorus/<repo>/<8hex>` branch name — and they must pass through clean.

### 3. The progress broadcast is already scrubbed — do not give the view a second channel

`council:progress` carries text from `SessionOutput`'s `onText`, never from the raw stream (`councilService.driveMember`). **Wiring the view to anything else bypasses the seam at the last possible hop, which is exactly where it is least visible in review** — Review Checklist item 3.

### 4. What 3b-3 already built, so you consume it rather than rebuild it

- **The protocol is RULED (D67) and is not yours to revise.** Four phases: `positions` (round 0, blind, every member concurrently) → `critique` (round 1, anonymised) → `arbitration` (round 2, arbiter) → `synthesis` (round 3, arbiter).
- **The dissent section is generated BY THE CORE**, unconditionally, from the transcript. The arbiter can add narrative and cannot remove an entry. Do not add a second dissent path in the view.
- **`assembleRun` already refuses**, by label and never silently: zero members, zero or two arbiters, fewer than two members, an unavailable credential, a `management` route, an unresolvable model, a non-gateway route, and **a brief with no numbered questions**. That last refusal is what the view must surface well — after finding 1 is fixed, a real brief will pass it.
- **The mint is per-RUN** (`COUNCIL_MINT_LIMIT_USD = 1.0`), read back then revoked in a `finally`, on every exit path. **Do not touch it.**

---

## ⚠ STOP — F31 is SOLVED and its fix is MANDATORY for any copy-DB work

**`--user-data-dir` reaches the real database but NOT the DPAPI context unless you bring the key with it.** `safeStorage` blobs are wrapped with Chromium's OSCrypt key, stored in `<user-data-dir>/Local State`. Copy `chorus.db` without it and **every pre-existing credential blob is undecryptable** while blobs written in that same boot decrypt fine.

**Probe decryptability EARLY and for FREE:** `_verify/3b-3/eval-vault-probe.js` proves `OR milestone key` decryptable via `model:refresh` (the unmetered `GET /models`), never via `credential:test`. **Do not press "Test key"** — it is a live billable call and nothing here needs one.

**If `OR milestone key` does not decrypt: STOP and ask Matthew to re-enter it through the running app's Settings UI.** That is a **human** step. **Never ask for a key's text in chat, never read it from a file, never accept it in any form, never write it to disk yourself.**

---

## Ground Yourself First

Read these before editing anything. Paths are relative to repo root.

- `CLAUDE.md` — locked stack; **D1** Zod-in-main; **D14** plain-object IPC; secrets via safeStorage, never in argv/logs/transcripts.
- `docs/Features/Foundation/Tasks/Task-3b-4.md` — **GOVERNS SCOPE**, including the six-item Review Checklist. **Its Exact Scope is amended by D68** (above).
- `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-3b-4.md` — **GOVERNS EXACT CONTENTS.** §1 (the path boundary), §1.1 (the dialog), §2 (the pre-pass), §3 (findings format — **and see D68 finding 2**), §4 (renderer), §5 (verification), §6 (what it deliberately does not decide — **two live decisions**).
- `docs/Features/Foundation/Tasks/Phase-3b-Overview.md` — the phase contract, the file-ownership matrix, the five gates, the standing conditions.
- `docs/Features/Foundation/roadmap.md` — §4 (**the CR mechanism, and the FORMAT the findings must match**), §5 (**F20, F27, F29, F31, F32, F34**), §6 (**D1, D14, D21, D27, D45(3), D55, D56, D60, D63, D64, D66, D67, D68**), §7 Phase 3b (**the "Task 3b-3 landed" block — its two drive-found defects are context you need**).
- `docs/Features/Foundation/CouncilBriefs/CouncilBrief-3b.0-Findings.md` — **the external findings you must compare your native output against**, and the standing example of a council whose code did not compile.
- `docs/PLAN.md` §4, §6, §13.
- **`docs/Features/Foundation/Tasks/Task-3b-3-ExecutionPrompt.md`** — the immediately prior session's prompt. Its harness caveats are the closest thing to current and its format is the house style for the report you owe.

### Code to Inspect — anchored to NAMED SYMBOLS

All verified present by the coordinator **2026-07-26 at `456d3d7`**. Line numbers appear only where this prompt quotes a specific fact — **re-locate by symbol, do not trust the number.**

**What you extend (D68's widening)**

- **`src/main/services/councilCore.ts`** — `parseBriefQuestions` (**finding 1 lives here**), `assembleFindingsDocument` (**finding 2**), plus `CouncilPhase`, `CouncilAction`, `nextAction`, `assembleRun`, `computeDisagreement`, `extractDissentEntries`, `dissentsElided`, `computeRunAccounting`. **PURE — no electron, no fetch, no storage, no clock.** Keep it that way: the run id and timestamp for provenance are **parameters**.
- **`src/main/services/councilCore.test.ts`** — 72 cases in the table style yours must follow.
- **`src/renderer/src/App.vue:94`** — `const activeView = ref<'workspace' | 'settings'>('workspace')`, rendered conditionally at **336**. The `SettingsView` toggle at **324–327** is the whole view/route precedent.

**What you consume and must not change**

- **`src/main/services/councilService.ts`** — `createCouncilService(deps)`, `start` / `cancel` / `abandonOpenRunsOnQuit`. `start` takes `{ projectId, briefPath, briefText }` today; **you replace `briefText` with a read of a validated `briefPath`.** Its `driveMember` holds the scrub seam and the progress emit. `COUNCIL_MINT_LIMIT_USD`, `COUNCIL_MINT_TTL_MS`, `MAX_OUTPUT_TOKENS_DEFAULT`, `MAX_COUNCIL_PARTICIPANTS` are argued constants — read the arguments before touching one.
- **`src/main/services/apiSession.ts` · `sessionOutput.ts` · `scrubber.ts` · `sessionManager.ts` · `src/main/adapters/`** — **byte-identical across all of Phase 3b.** If a change seems to need one, **stop and raise it.**
- **`src/main/services/attributionCore.ts` · `dispatchAttribution.ts`** — D66's files. **Untouched since `525c7f3` and they stay that way.**
- **`src/main/services/secret-patterns.json`** — the one list. `logger.ts:2` imports it; `scripts/secret-grep.mjs:19` reads it.
- **`src/main/services/storage.ts`** — `createCouncilRun`, `updateCouncilRun`, `appendCouncilMessage`, `getCouncilMessagesForRun` (**still no caller — the view may become its first**), `deleteCouncilRun` (**still no caller, and that stays true**). `COUNCIL_RUN_STATUSES` is the closed vocabulary.

**IPC and the renderer**

- **`src/shared/ipc.ts`** — `IpcChannel` holds **51** keys. `CouncilStart` / `CouncilCancel` / `CouncilProgress`; `councilStartRequestSchema` (**finding 4**), `councilStartResponseSchema` with its **required** `accounting` block (D55 — a cost cannot travel without its denominator), `councilProgressEventSchema`.
- **`src/main/ipc.ts`** — `ipcMain.handle(` appears **47** times. The nested `resolveCredential` (five ordered refusals, management refused **pre-decrypt**) — **reuse, never fork.** `resolveMemberRoute` is the council's wrapper over it. The `project:add` handler is the **`dialog.showOpenDialog` precedent**, including the structured cancel no-op.
- **`src/preload/index.ts`** — Zod-free typed forwarders only, exposed as `window.chorus`. **⚠ Zod in preload throws `EvalError` under CSP and silently drops events — validate in main only (D1).** `startCouncilRun` / `cancelCouncilRun` / `onCouncilProgress` exist. `index.d.ts` is never hand-edited.
- **`src/renderer/src/palette/commands.ts`** — `buildCommands(ctx: PaletteContext): PaletteCommand[]`, each `{ id, label, enabled(), run() }`. **A PURE REGISTRY: no store import, no `window.chorus`, no Zod.** Existing ids include `launch`, `toggle-mode`, `restart-focused`, `settings.open`. `fuzzyFilter` excludes disabled commands, so a disabled entry simply does not render.
- **`src/renderer/src/stores/`** — `layout.ts`, `project.ts`, `session.ts`, `settings.ts`, `view.ts`. The **`loadSeq` supersede-token idiom** is in `view.ts`; copy it.
- **`src/renderer/src/views/`** — `SettingsView.vue`, `SettingsProviders.vue`, `SettingsCredentials.vue`. **`CouncilView.vue` joins them.**
- **`src/renderer/src/components/CommandPalette.vue` and `LaunchDialog.vue`** — the shared overlay/focus-trap idiom worth reusing.
- **⚠ The listener-leak precedent (`de98679`, F13):** a subscription registered after an `await` in `onMounted` leaks if the component unmounted meanwhile. **Bail after every `await` if the component is gone**, and remove the `council:progress` subscription on unmount.

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

## Pre-Existing Changes

**`git status --porcelain` at prompt time returns NOTHING — the tree is CLEAN.**

This prompt and the roadmap pass that produced D68 were committed by the coordinator before this session was started, which is the `a53ba96` / `f00600a` precedent applied one step earlier than usual. **The previous task's prompt shipped with a "pre-existing changes" list that was already stale by the time the session read it; this one is accurate instead.**

**Therefore: any dirt you find is something you or a tool created — account for all of it.**

**Three facts about the tree, verified 2026-07-26:**

1. **`TASK-3-5-REVIEW-FABLE.md` and `TASK-3-6-REVIEW-FABLE.md` DO NOT EXIST.** `Task-3b-4.md`'s Non-Goals says *"do not touch the two `TASK-*-REVIEW-FABLE.md` files"* — **that instruction is stale.** The only one at the repo root is **`TASK-3-4-REVIEW-FABLE.md`, which IS tracked and committed.** Leave it alone; do not go looking for the others and do not recreate them.
2. **`_verify/` is entirely gitignored.** Your `_verify/3b-4/` artifacts will never appear in `git status` — which also means **`npm run grep:secrets` is the only thing between a `_verify/` artifact and a leaked key**, and that script does scan `_verify/`.
3. **The dev DB already holds this feature's fixtures** — see the drive section.

**Still true and still binding:** the `wt-24b5c1fe` worktree fixture — directory `C:\Projects\ContactEstablished\.chorus\Chorus\wt-24b5c1fe`, row id `9ba9b0da-cecd-4960-815d-f36166cf8c00`, branch `chorus/Chorus/24b5c1fe`. **Row, directory and branch all stay.**

**D40: stage scope files EXPLICITLY by path; never `git add -A`.**

---

## Decisions You Must Honour — all RESOLVED, none open

- **D1 / D14 (2026-07-19)** — Zod in **main only**; **plain-object IPC**. A Pinia object is a Vue reactive Proxy; structured clone rejects it with **`Error: An object could not be cloned`** and **no compile-time signal**. Snapshot with `JSON.parse(JSON.stringify(x))` and runtime-verify every new renderer→main payload. **This task adds a store, so D14 is live.**
- **D21** — the palette is a **pure registry**; commands are data, and the context is injected.
- **D27 (2026-07-20)** — what this feature is *for*: the externally-run CR mechanism becomes native, **brief-`.md` in → findings-`.md` out in this same format.** This task is the sentence that decision was written to produce.
- **D45(3)** — pane type is a versioned, migrated layout-schema change. **D64(1) keeps it entirely out of this phase** by making the council a view/route. Do not open it.
- **D55 (2026-07-25)** — **no number without its denominator, enforced by the SCHEMA.** `councilStartResponseSchema` already requires the `accounting` block beside `cost_usd`. **The view must render the denominator too** — a cost or a token count shown alone is the same defect one layer up.
- **D60 (2026-07-26)** — **no code path reachable without a user gesture may resolve a LAUNCH credential.** A council run is user-initiated by construction. **⚠ Never restate this as a call-site count** — a stale invariant is worse than a loose one, because it gets cited as proof.
- **D63 (2026-07-26)** — **Q2**: a council member writes no `sessions` row, so restore structurally cannot resurrect one. **Q4/(d)**: one scrub seam, at the consumer. **(f)**: the brief sanitization pre-pass is this task's.
- **D64 (2026-07-26)** — **(1)** the council surface is a **view/route, not a layout pane**. **(2)** one minted key per RUN. **(3)** the protocol `[CR]`, now **CLOSED as D67**.
- **D66 (2026-07-26)** — the boot reconcile covers council runs. **Discharged and proven with a real key. Its files are closed to you.**
- **D67 (2026-07-26, CR-3b.1)** — the ruled protocol, with **six coordinator corrections**. **Binding here: briefs MUST carry enumerated questions** (Q3) — which is what makes D68 finding 1 a blocker rather than a nicety — and **the dissent section is core-generated and unconditional** (Q5), so the view renders it rather than reconstructing it.
- **D68 (2026-07-26)** — **the four findings above, and the two-commit amendment.**
- **F27 (2026-07-24)** — the redaction wording, quoted verbatim in STOP #2.

---

## Implementation Scope

**`Task-3b-4.md`'s Exact Scope governs, AS AMENDED BY D68; `ImplementationSpec-3b-4.md` governs contents.**

**Commit 1 — the `councilCore.ts` fix, on its own, first:**

| Action | File | What |
|---|---|---|
| **EDIT** | `src/main/services/councilCore.ts` | `parseBriefQuestions` scoped to the questions **section**, falling back to whole-document. `assembleFindingsDocument` gains **provenance** and the **standing caveat**, with run id and timestamp as **parameters**. |
| **EDIT** | `src/main/services/councilCore.test.ts` | The existing 72 cases pass **unchanged**; new cases for section-scoped parsing (**including the two real briefs as fixtures**) and for the two new document sections. |

**Commit 2 — the task:**

| Action | File | What |
|---|---|---|
| **EDIT** | `src/main/services/councilService.ts` | `validateBriefPath`, `findingsPathFor`, `scanBriefForSecrets`, the brief read, the findings write. **Exactly ONE findings-write call site.** |
| **EDIT** | `src/main/ipc.ts` / `src/shared/ipc.ts` / `src/preload/index.ts` | The brief-path dialog channel (main-side `dialog.showOpenDialog`, **structured cancel no-op**); `council:start` with `brief_text` **replaced** by the validated path. |
| **CREATE** | `src/renderer/src/views/CouncilView.vue` | Roster, live deliberation, findings. **The only new `.vue`.** |
| **CREATE** | `src/renderer/src/stores/council.ts` | `{ runId, phase, round, members, messages, findings, error }`, `loadSeq` supersede token, subscription **removed on unmount**. |
| **EDIT** | `src/renderer/src/App.vue` | `activeView` widened to include `'council'`, plus the conditional render. **D68 finding 3.** |
| **EDIT** | `src/renderer/src/palette/commands.ts` (+ test) | One command, `id: 'council.run'`, label `Run council…`, `enabled()` false without an active project. **Pure registry rules hold.** |
| **EDIT** | `src/shared/ipc.test.ts` | Schema coverage for the changed request and the dialog channel. |
| **CREATE (untracked)** | `_verify/3b-4/` | Drive scripts, dumps, logs. Gitignored. |

If a change seems to require another file — **especially `sessionManager.ts`, `apiSession.ts`, `sessionOutput.ts`, `scrubber.ts`, `vault.ts`, `registry.ts`, `attributionCore.ts`, `dispatchAttribution.ts`, or any adapter — stop and raise it.** That is a scope signal, not a detail.

---

## Strict Non-Goals

- **NO layout-tree pane** (D64(1)) — a view/route, so **D45(3) stays entirely out of this phase**.
- **NO migration.** v11 was the phase's only one; `MIGRATIONS.length` stays **11** and `sqliteTable(` stays **15**.
- **NO protocol change.** 3b-3's ruled protocol is **consumed, not revised**. Fixing where the parser *looks* for questions is not a protocol change; changing the rounds, the verdict vocabulary or the dissent mechanism is.
- **NO second api transport, NO second scrubber, NO `fetch` in the renderer, NO `fs` in the renderer.**
- **NO second pattern list.** `secret-patterns.json` is imported (D63(f)).
- **NO writing anywhere but beside the brief.** No temp files, no app-data copies, no "recent findings" cache. **One derived output path.**
- **NO board, no dashboard, no history browser.** Runs persist; rendering the archive is a later phase's call, and `deleteCouncilRun` still has no caller.
- **NO editing the brief in-app.** Chorus reads it; the user's editor writes it.
- **NO auto-run**, no watcher, no scheduled council — which is also what keeps D60 true by construction.
- **NO `dispatches` write. NO `sessions` row.**
- **NO change to `agentKindSchema`, `staticRegistry`, or anything under `src/main/adapters/`**; `startApiSession` stays dormant.
- **NO new npm dependency.**
- **Do not touch** the `wt-24b5c1fe` worktree fixture or `TASK-3-4-REVIEW-FABLE.md`.

---

## Required Workflow

Work as coordinator: **ground → implement → review the diff against the Implementation Spec → a code-quality pass → resolve findings → run the gates → narrate the commit.** **Do NOT push and do NOT open a pull request unless explicitly asked.**

1. **Commit 1 first (D68)** — the parser fix and the findings-document additions, with the existing 72 core cases passing unchanged. Gates green, then commit it on its own.
2. **The path boundary**, in main, **with its refusals tested before any UI exists**.
3. **The sanitization pre-pass**, reusing `secret-patterns.json`. **Decide refuse-vs-redact and narrate it.**
4. **The findings write**, derived path. **Decide overwrite-vs-suffix and narrate it.**
5. **The store and the view**, progress over the broadcast.
6. **The palette command**, pure-registry rules.
7. **Tests, gates, the drives, the commit.**

---

## Verification Commands

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

**Baseline to beat — coordinator-verified 2026-07-26 at `456d3d7`, by running each command:**

| Gate | Value |
|---|---|
| typecheck | **0 errors** (node + web) |
| vitest | **880 passed / 880, across 27 files** |
| grep:secrets | **clean (6 patterns over `src/`, `scripts/`, `_verify/`, `package.json`, root configs)** |
| `MIGRATIONS.length` | **11** → must stay **11** |
| `sqliteTable(` in `src/main/db/schema.ts` | **15** → must stay **15** |
| `ipcMain.handle(` in `src/main/ipc.ts` | **47** → expect **48** (the brief-path dialog) |
| `IpcChannel` keys in `src/shared/ipc.ts` | **51** → expect **52** |

**If the handler/channel counts land differently, that is fine — quote what you actually get and explain the delta.** The point is that you counted. **`MIGRATIONS.length` and `sqliteTable(` are NOT in that category: any movement there is a scope breach to stop and report.**

### Grep gates — run before the commit, quote every count

- **zero** `fetch(` and **zero** `fs`/`node:fs` in any renderer file;
- **exactly one** findings-write call site in `councilService.ts`;
- **zero** new secret-pattern literals — `secret-patterns.json` is imported;
- **zero** `createScrubber` call sites outside `sessionOutput.ts`;
- **exactly 1** new `.vue` file (`App.vue` is edited, not created);
- **`git diff -- src/main/adapters/` EMPTY**; `agentKindSchema` still `z.enum(['claude','codex'])`; `staticRegistry` still **two** entries;
- **`sessionManager.ts`, `apiSession.ts`, `sessionOutput.ts`, `scrubber.ts` byte-identical** to `456d3d7`;
- **`attributionCore.ts` and `dispatchAttribution.ts` byte-identical** to `525c7f3`;
- **the commit-1 boundary, checked against the DIFF rather than the worktree:** `councilCore.ts` appears in **commit 1 only**, and `git diff <commit1>..HEAD -- src/main/services/councilCore.ts` is **EMPTY**;
- `MIGRATIONS.length` still **11**.

### The live drives (G2)

**Real DB (F20): `C:\Users\matth\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\chorus\chorus.db`.** Electron ignores `APPDATA` but honours `--user-data-dir`; copy `_verify/3b-3/start-realdb.ps1` into `_verify/3b-4/`. **Every dump must quote the `projects` pair `985d547b…` (Chorus) / `f47ac10b…` (Chorus-Second)** — a dump quoting `a43b395d…`/`b684e96e…` is the scratch DB and **discharges nothing.** Drive the window over CDP (`_verify/3b-3/cdp.js`, port 9222).

**⚠ Step 0 — THE FIXTURES ALREADY EXIST. Task 3b-3 left them deliberately, and they are verified present at `456d3d7`:**

| Fixture | State |
|---|---|
| `council_members` | **4 rows** — `CR Alpha (nemo)` · `CR Beta (llama-3.1-8b)` · `CR Gamma (qwen-2.5-7b)` · `CR Arbiter (mistral-small)`, all on `OR milestone key`, differing by model, each `params_json` `{"max_tokens":700}` |
| `council_runs` | **6 rows**, all with `revoked_at` NOT NULL and **zero open ledger rows** |
| `council_messages` | **32 rows** |
| Credentials | `OR milestone key` (inference, OpenRouter route) · `Claude fake key` (carries `unavailable_since` — a free live fixture for the refusal path) · `OR Management Key` (`auth_mode = 'management'` — a free fixture for the management refusal, and the source of the mint) |

**⚠ The four models were chosen deliberately against F34 and you should keep them.** The route's configured default `moonshotai/kimi-k3` is a **reasoning** model at **$3/M in, $15/M out** (live pricing, 2026-07-26); OpenRouter bills reasoning tokens as output tokens and F34 measured a probe consuming its whole cap for an empty answer. The four fixtures are cheap non-reasoning instruction-followers. **`GET /api/v1/models` is free and unauthenticated (F32)** — `_verify/3b-3/probe-council-models.js` is the precedent if you re-pick.

**Drive 1 — the path boundary, before any UI.** Every refusal in the spec §1 table, plus the derived-path computation. Unit-level where it is pure, against real temp files where it stats.

**Drive 2 — the sanitization pre-pass.** A brief containing each known pattern is caught (name + line, **never the value**); a brief containing a 40-char SHA, a Windows path, a UUID and a `chorus/<repo>/<8hex>` branch is **not**.

**Drive 3 — a stub-brief run through the whole UI.** Palette → view → main-side dialog → deliberation streaming → findings written. **Use a few-line stub brief**, and confirm the findings file lands beside it and is then cleaned up.

**⚠ Drive 4 — THE DOGFOOD RUN. This is the phase milestone.** Point the council at a **real** brief in `docs/Features/Foundation/CouncilBriefs/` and let it run natively, end to end. Assert, quoting evidence: the findings file lands **beside the brief** in §4 format, **carrying provenance and the standing caveat** (D68 finding 2); the transcript persisted with rounds and phases; **dissents are present where the deliberation actually disagreed**; the run's key was minted, used, **read back and revoked**; and `npm run grep:secrets` is clean **including over the written findings file**.

**⚠ Then the honest comparison, and it is not optional.** Hold the native findings beside `CouncilBrief-3b.0-Findings.md`, produced externally. **Report where the native run is WEAKER.** Phase 3b's milestone is that a real CR runs natively — **not that it runs as well** — and a report claiming parity without the comparison has not earned it. **3b-3 already found one weakness to look for:** mechanical dissent extraction is noisy, and one talkative member produced six of nine entries on a real run.

### ⚠ Cost envelope

**Under $0.30 — the phase's largest, and the dogfood brief is long.** Input tokens scale with the brief for every member on every round.

- **Drive everything except drive 4 with a stub brief of a few lines.**
- **Report actual cost**, per member where the data allows, cross-checked against the minted key's `readUsage`.
- **⚠ If the dogfood run alone exceeds $0.20, STOP and report before running a second.**
- For calibration: 3b-3 measured **$0.001306 across six short-brief runs**. A real brief is roughly 9,000 tokens, and only the positions, arbitration and synthesis prompts carry it — the critique prompt does not.
- **Do not press "Test key" on `OR milestone key`.**

### Harness caveats — verified through 2026-07-26

- **electron-vite does NOT hot-restart the main process**; HMR covers the renderer only. **Every main-process change needs a real cold boot.**
- **`sqlite3` is NOT installed** — use the `ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe` pattern (`_verify/3b-3/dump-v11.js` is current). **Known flake: a dump script writes no file on its first invocation — retry once.**
- **CDP on `--remote-debugging-port=9222`** is the proven driver, and `cdp.js`'s subcommand is `eval <file>` (not a bare path). **Wrap every `Runtime.evaluate` body in an IIFE** — top-level `const` collides across evaluates. The bridge is **`window.chorus`**, not `window.api`.
- **⚠ CDP-driven Vue forms need a microtask tick between `input` and the submit click**, or the click lands on a stale `:disabled` — **a silent no-op that reads exactly like a broken feature. This has caused a failed drive in three separate tasks**, and this task is UI-heavy.
- **⚠ Vite's SPA fallback poisons CDP-driven file reads:** `fetch('some.txt')` inside the page returns `index.html`. Use `fetch('/@fs/C:/absolute/path')`.
- **Graceful quit:** `taskkill` **without** `/F` does **not** terminate the dev app. Use a CDP `window.close()` evaluate (`_verify/3b-3/eval-quit.js`). Kill process **TREES** with `taskkill /PID <root> /T /F` for crash cases.
- **The dev window is NOT foregrounded by default** and other desktop apps steal foreground mid-run (F29). Foreground deliberately (`_verify/3b-3/focuswindow.ps1`) and verify before any screenshot check.
- **⚠ A long-lived dev app can disappear between tool calls.** 3b-3 observed one exit with no error in its log; re-check the process before assuming a CDP failure means a code failure.
- All artifacts under `_verify/3b-4/`.

### ⚠ Standing condition — the dev vault holds REAL, BILLABLE credentials

**Never dump, echo, print, copy, or transmit `credential_profiles.encrypted_blob` or `fingerprint_hash`** — select non-secret columns explicitly and prove blob stability with `length(encrypted_blob)`. **No test, fixture, `_verify/` artifact, transcript row, log line or council message may contain a real credential or key fragment.** `npm run grep:secrets` must pass over `_verify/3b-4/` **and over the findings file this task writes into the repo** — that file is the one artifact in this phase whose content Chorus did not author.

---

## Test Expectations

**Path validation** gets the exhaustive table, in main: relative path; non-existent; a directory; not `.md`; a traversal attempt (`..`); a UNC path; a path with a null byte; a file over the size cap. **Each is a refusal with a message naming no path fragment that was not supplied.**

**Sanitization:** each known pattern caught, with name and line and **never the value**; the four false-positive fixtures pass clean.

**The parser fix (D68 finding 1):** the two real briefs are **fixtures**, and the assertion is that the parsed questions are the §8 questions and **not** the constraints list or the rubric. The existing synthetic-brief cases pass unchanged.

**The findings document (D68 finding 2):** provenance names every member and its model and the run id; the standing caveat is present. Asserted **structurally, over the produced document**, not by reading prose.

**Palette:** the command appears, and `enabled()` is false when no project is active.

**Store:** the progress subscription is removed on unmount, and a superseded load does not overwrite a newer one.

---

## Failure Honesty Clause

If any verification command fails for an unrelated environment reason, **capture the EXACT output, explain it, and DO NOT claim success.** An indeterminate result is reported as indeterminate and the affected acceptance criterion is marked **FAILED** — never reasoned into a pass. **An unproven claim is worse than an honest unknown, because it will be cited later as evidence.** Temporary instrumentation must be reverted, and the review checks the **COMMIT DIFF**, not the worktree.

**Three places this bites hardest in this task:**

1. **A findings file you did not read.** The dogfood output is model text written into the repo. Read it, grep it, and quote what is actually in it.
2. **A comparison you asserted rather than made.** "Comparable to the external findings" is not a finding. Name where the native run is worse.
3. **A redaction claim that drifted.** The only permitted sentence is in STOP #2. Grep your own diff for "safe".

---

## Final Reporting Requirements

Report a status of exactly one of **DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED**, plus:

- **Both commit SHAs, in order, and every file changed**, confirming the scope tables and nothing beyond them. **The `councilCore.ts` fix must land FIRST**, and `git diff <commit1>..HEAD -- src/main/services/councilCore.ts` must be **EMPTY**.
- **D68 discharged in four parts:** the parser scoped to the questions section **with the two real briefs as test fixtures and their parsed output quoted**; provenance and the standing caveat present in a real findings file; `App.vue` widened with exactly one new `.vue`; `brief_text` replaced rather than widened, said so in the commit.
- **The two decisions the spec left open, each stated and narrated:** overwrite-vs-suffix, and refuse-vs-redact.
- **Typecheck / vitest / grep:secrets with actual numbers**, against the **0 / 880-across-27 / clean-6-patterns** baseline. Vitest must be **above** 880.
- **The grep gate counts, each quoted.**
- **All four drives, each quoted** — especially **drive 4**, with the findings file's own text as evidence.
- **⚠ The honest comparison against `CouncilBrief-3b.0-Findings.md`, naming where the native run is weaker.**
- **Actual cost against the < $0.30 envelope**, with the denominator (members answered / refused / usage available), and confirmation Test key was never pressed.
- **The redaction wording actually shipped**, quoted, with confirmation that no surface says "safe".
- **Confirmation the progress broadcast is fed from `SessionOutput.onText`** and that the view has no second channel.
- **Confirmation each non-goal held**, including `MIGRATIONS.length` **11**, `sqliteTable(` **15**, adapters untouched, `startApiSession` still dormant, no `dispatches` write, no `sessions` row, `deleteCouncilRun` still uncalled.
- **Confirmation `TASK-3-4-REVIEW-FABLE.md` is unmodified and unstaged**, the **`wt-24b5c1fe` row, directory and branch are intact**, the **standing fixtures were restored** (say what you left in `council_members` / `council_runs` and dump it), **nothing under `_verify/` was staged**, and **`Task-3b-4-ExecutionPrompt.md` was neither staged nor reverted.**
- **Whether the findings file written during the dogfood drive was left in the repo or removed**, and why.
- **Residual risks and known gaps**, and the **final `git status --porcelain`**.
- **⚠ Phase 3b's closing statement:** this task closes the phase. Say plainly whether the milestone — *a real Chorus governance CR runs natively end-to-end* — was **met, partially met, or not met**, and on what evidence.

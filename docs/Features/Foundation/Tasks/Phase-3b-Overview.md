# Phase 3b — Native Council Review

_Kicked off **2026-07-26**, immediately after Phase 3a closed (`341ea5c`, roadmap `6e12b0e`). Four tasks, executed **strictly serially**, each in its own session and each coordinator-reviewed before the next is prompted. This document governs the phase; each `Task-3b-#.md` governs its own scope; each paired `ImplementationSpec-3b-#.md` governs exact contents._

## Source Of Truth

- Roadmap: `docs/Features/Foundation/roadmap.md` — §4 (the CR mechanism this phase productizes), §5 (**F20**, **F25**, **F27**, **F29**, **F31**, **F32**, **F-36-1**), §6 decisions **D1, D4, D7, D14, D16, D33, D34, D42, D45, D46, D48, D52, D56, D57, D58, D60, D61, D62** plus this phase's **D63** (the CR-3b.0 council ruling) and **D64** (the kickoff scope rulings), and §7 Phase 3b.
- Council: `CouncilBriefs/CouncilBrief-3b.0-ApiSessionProducer.md` and its findings `CouncilBriefs/CouncilBrief-3b.0-Findings.md`. **The findings' rulings bind; their verbatim TypeScript does not** — see D63 resolutions (a)–(g), Matthew-ratified 2026-07-26.
- `docs/PLAN.md` §4 (adapter abstraction), §6 (credentials/providers/BYOK), §13 (target data model).
- Project rules: `CLAUDE.md` — locked stack; **D1** Zod-in-main; **D14** plain-object IPC; secrets via safeStorage, never in args/logs/transcripts; **D4** verify external API shapes against the vendor's own docs at execution time.
- **Verified codebase state: 2026-07-26, `src/` at commit `341ea5c`** (Task 3a-5 landed; Phase 3a closed). Every task doc anchors insertion points to **named symbols, never line numbers** (house rule).

## Goal

Phase 3a made a launch reproducible. Phase 3b makes the app **able to review its own design** — the §4 Council Review mechanism, run in Cursor since Phase 1, becomes a feature of Chorus itself: point it at a brief `.md`, watch 3–5 API-mode members deliberate live, get a findings `.md` beside the brief, with every member's key never leaving the vault.

It is also, and more consequentially, the phase where **Chorus makes its first API call on a user's behalf that is not administrative**. Everything before now either spawned a process that made its own calls, or called OpenRouter's *management* surface. This phase builds the inference transport, and D45 is explicit that whatever it builds becomes the de-facto api-mode machinery for the whole app — including the native chat pane the product has already committed to.

## ⚠ The phase's real risk is not the council — it is the primitive underneath it

A wrong deliberation protocol produces disappointing findings and gets tuned. A wrong `ApiSessionHandle` gets adopted by the chat pane, the eventual `SessionManager` session-type split, and every later api-mode consumer, and then costs a cross-phase refactor to change. **That is why the producer question went to its own council (CR-3b.0) before a line was written, and why Task 3b-1 ships the primitive alone, with a live proof, before any council code exists.**

## Kickoff decisions

| ID | Decision |
|---|---|
| **D63** | **CR-3b.0 — the api-mode session producer.** Council-ruled 3-of-3: **Option D**, a standalone factory `src/main/services/apiSession.ts` exporting `createApiSession(spec, deps)`, **outside** the agent registry. `agentKindSchema` stays `'claude' \| 'codex'`; `staticRegistry` stays frozen; **D52 keeps the D34-Q5 registry lift with Phase 3d**. `ApiAgentAdapter.startApiSession` stays dormant-but-documented, becoming a one-line delegation when the registry is lifted. **Q2 OUT:** council members never enter `SessionManager` and write no `sessions` row, so the boot restore engine **structurally cannot** resurrect one. **Q3 CORRECT:** `send` / `receive(): AsyncIterable<string>` / `dispose` unchanged; `dispose()` is the **sole** cancellation mechanism and the interface must say so. **Q4 SCRUB:** api text routes through `createSessionOutput().ingest()`, **with the coverage claim bounded in the same breath** — the scrubber catches injected credential *echo*, not brief-quoted content. Coordinator resolutions **(a)–(g)**, Matthew-ratified 2026-07-26, correct four errors in the findings' verbatim TypeScript and add three gaps the council did not raise — including **(g)**, that `receive()` yielding only strings leaves nowhere to report token usage, closed via `onUsage` on the deps rather than by changing the shared handle. |
| **D64** | **Three scope rulings.** **(1)** The council surface is a **view/route**, not a layout pane — which keeps **D45(3) entirely out of this phase** (no layout-tree migration, no non-OSC auto-titling). **(2)** Cost is bounded by **one minted OpenRouter key per RUN** with a hard limit, per-member granularity from each response's `usage` block; the cap must clear the members' **max output allocation**, not their expected spend (3a-3's measured lesson). **(3)** The `[CR]` checkpoint on the deliberation protocol is **deferred to Task 3b-3's kickoff, not waived** — it fires once a design exists to review. |

## The Four Tasks

| Task | One-line scope | Migration | Depends on |
|---|---|---|---|
| **3b-1** | **The api-mode session primitive — and nothing else.** `createApiSession()` per D63: SSE-streamed OpenAI-compatible chat-completions, injected `fetchImpl`, byte **and** wall-clock caps, `dispose()` aborting the request. Output driven through `createSessionOutput().ingest()`. Credential via the existing `resolveCredential`. Proven live by **one** member answering **one** prompt on the standing OR route. **No council code, no schema, no renderer file.** | — | Phase 3a |
| **3b-2** | **`council_members` + `council_runs` schema, and the configuration UI.** A member is (credential profile × base URL × model id × role `member\|arbiter` × params). Real `REFERENCES` per **D62**, with count-and-refuse authored in main **before** SQLite throws. Settings surface: list / create / rename / delete. **No orchestration.** | **v11** | 3b-1 |
| **3b-3** | **`CouncilService` + the deliberation protocol. ⚠ CARRIES THE `[CR]` CHECKPOINT (D64(3)).** Pure `councilCore.ts` state machine — blind positions → cross-critique → disagreement detection → arbiter ruling → synthesis with dissents preserved. Orchestrates `createApiSession` handles. One minted key per run (D64(2)); per-member cost from each response's `usage`. Transcript persistence. | — | 3b-2 |
| **3b-4** | **The council view/route, brief-in → findings-out — closes the phase.** Palette command "Run council…"; the run view streaming deliberation live; the findings `.md` written beside the brief. **The brief-path file boundary is a security surface** (the `session:launch` cwd precedent) and the **brief sanitization pre-pass** reuses `secret-patterns.json` (D63(f)). | — | 3b-3 |

Dependency chain: **3b-1 → 3b-2 → 3b-3 → 3b-4** (strictly serial).

### ⚠ Migration numbering

**`MIGRATIONS.length` is 10 at phase start**, so 3b-2's migration is **v11** — the phase's only one. Confirm `MIGRATIONS.length + 1 === 11` **before** appending; **stop and report divergence** rather than renumbering silently. v11 carries the **full three-dump protocol** (pre / post / second boot) exactly as v7–v10 did: prior `applied_at` values byte-identical, every pre-existing table row-identical, the new version not re-applied on boot 2, and the `projects` pair quoted for F20 provenance.

## ⚠ The two things this phase must not overclaim

**1. Redaction coverage (F27, sharpened by D63 Q4).** The scrubber exact-matches **registered** values. A council member is *sent* a brief and *writes* findings to disk; if the brief quotes a key, the scrubber will not catch it, because it was never registered. The honest wording, and the only one any doc in this phase may use:

> *Chorus redacts registered exact values on ingest; it cannot redact values an agent derives, and it cannot redact content it was asked to read.*

The mitigation is a **pre-pass** over the brief (D63(f)), not a stronger claim about the scrubber.

**2. What a council's output is.** The findings this feature produces are **model deliberation, not verified fact.** CR-3b.0 is the live example and the lesson: the council's rulings were sound and its verbatim TypeScript had four errors, because it had the brief and not the repo. **Nothing in this phase may present findings as verified**, and the view should not imply it. The coordinator-verification step in §4 is not replaced by this feature — it is the reason the feature is safe to build.

## Standing conditions for every session in this phase

- **⚠ THIS PHASE SPENDS REAL MONEY ON EVERY RUN, and more than any prior phase.** A council run is 3–5 members plus an arbiter reading a brief; 3a-3's entire envelope was one dispatch. **Every run is bounded by one minted key with a hard cap (D64(2))**, and every task doc states its own envelope. **⚠ 3a-3's lesson binds the cap: OpenRouter pre-authorizes against the key's remaining limit**, so a cap below a member's requested max output refuses the request outright (`402 … you requested up to 65536 tokens, but can only afford 46666`) — the cap must clear **max output allocation**, not expected spend.
- **⚠ The dev vault holds REAL, billable credentials** — `OR milestone key` (inference) and `OR Management Key` (management, `auth_mode = 'management'`). **Never dump, echo, copy, or transmit `credential_profiles.encrypted_blob` or `fingerprint_hash`**; select non-secret columns explicitly and prove blob stability with `length(encrypted_blob)`. **Do not press "Test key" on `OR milestone key`** unless a step calls for it.
- **⚠ F31 is SOLVED and its fix is mandatory for every rehearsal:** `safeStorage` blobs are wrapped with Chromium's OSCrypt key, stored in `<user-data-dir>/Local State`. **Copy `Local State` beside `chorus.db`** or every pre-existing credential blob is undecryptable while same-boot blobs work fine. Treat a credential blob as bound to the user-data **directory**, not just the Windows user.
- **⚠ F20:** the real dev DB is `C:\Users\matth\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\chorus\chorus.db`. Electron ignores `APPDATA` but honours `--user-data-dir`. **Every dump must quote the `projects` table** (`985d547b…` Chorus / `f47ac10b…` Chorus-Second) or it discharges nothing.
- **D60's invariant stands and this phase adds a caller.** No code path reachable without a user gesture may resolve a **launch** credential. A council run is user-initiated by construction (D63 Q2: no `sessions` row, so nothing to restore), and **that must be proven, not assumed** — 3b-3 owns the proof.
- **Untracked files:** `TASK-3-5-REVIEW-FABLE.md` and `TASK-3-6-REVIEW-FABLE.md` sit at the repo root. **Do not commit, delete, or revert them.**
- **Baselines at phase start, coordinator-verified 2026-07-26 at `341ea5c`:** typecheck **0** (node + web) · vitest **702/702 across 24 files** · `npm run grep:secrets` **clean (6 patterns)** · migrations **v1–v10** · `ipcMain.handle(` **41** · `IpcChannel` **44**.

## Gates

| ID | Gate | Applies |
|---|---|---|
| **G1** | Typecheck: zero errors. | Every task |
| **G2** | **Run, don't just compile** — drive the real window; screenshots when headless. CDP harness precedent `_verify/3a-4/cdp.js` (port 9222), real-DB boot `_verify/3a-4/start-realdb.ps1`. | Every task; **load-bearing in 3b-1**, whose whole deliverable is a live transport |
| **G3** | One intentional narrated commit per execution session. | Every task |
| **G4** | **`npm run grep:secrets` before shipping.** | Every task; **load-bearing throughout** — this phase writes model output to disk |
| **G5** | Council Review per D6 on **[CR]** phases. | **CR-3b.0 CLOSED** (D63). **The protocol checkpoint is OPEN and fires at Task 3b-3's kickoff** (D64(3)) |

## File-ownership matrix

Overlapping files across tasks are **legal only because execution is serial** — each later task starts only after the prior task's commit exists.

| File | 3b-1 | 3b-2 | 3b-3 | 3b-4 |
|---|:--:|:--:|:--:|:--:|
| `src/main/services/apiSession.ts` (+ test) | ✅ new | | | |
| `src/main/adapters/types.ts` (docstring + assertion only) | ✅ | | | |
| `src/main/services/storage.ts` (MIGRATIONS + accessors) | | ✅ v11 | ✅ | |
| `src/main/db/schema.ts` | | ✅ | | |
| `src/main/services/councilCore.ts` (+ test) | | | ✅ new | |
| `src/main/services/councilService.ts` | | | ✅ new | ✅ |
| `src/main/ipc.ts` / `src/shared/ipc.ts` / `src/preload/index.ts` | ✅ | ✅ | ✅ | ✅ |
| `src/renderer/…` (Settings surface) | | ✅ | | |
| `src/renderer/…` (council view, palette) | | | | ✅ |

**`src/main/adapters/` is otherwise byte-identical across this phase** — 3b-1 touches `types.ts` only to add the `@deferred` docstring and the signature-compatibility assertion D63 requires. **No adapter implementation changes, and `staticRegistry` is untouched by every task.**

## Milestone

**Point the council at a brief `.md`; get a findings `.md` from live multi-model deliberation, with keys never leaving the vault.** The dogfood check is the honest one: **a real Chorus governance CR runs natively end-to-end** — and its output is presented as deliberation to be verified, not as fact, because CR-3b.0 itself demonstrated the difference.

# Task 3a-1 — TERM Pin (flagged chore) + The Dispatch Telemetry Spine

_First task of Phase 3a (Foundation). Windows-only. **TWO commits — G3 amended for this session** (precedent: D24, D32, D36, D37, **D46**): first a **flagged, behaviour-scoped chore commit** pinning `TERM` in `composeChildEnv` (**D54**, closing **F28**), then the task commit — migration **v7** and the dispatch telemetry spine. This task governs scope; `ImplementationSpec-3a-1.md` governs exact contents. **No UI. G4 is mandatory.**_

**Why this is the phase's FIRST task and not its last.** Mission Control's spec **Phase 0** is the only work item in the whole roadmap with a clock running against it. Its own rationale, verbatim from `docs/Features/Mission Control/chorus-mission-control-spec.md` §9: _"historical actuals cannot be backfilled. Every week without capture is a week the estimator cannot calibrate, and phases 2 onward are worthless without three to four weeks of data."_ D50 sequenced the whole phase on that asymmetry. Every day this task does not exist is a day of data that can never be recovered — so capture lands before the catalog, before profiles, before any UI.

## Source Of Truth

- `docs/Features/Mission Control/chorus-mission-control-spec.md` — **§5.2** (what a dispatch record must hold) and **§9 Phase 0** (the acceptance bar and the decay argument). **Read both before writing anything.** §8 is also binding on placement: _"**Main process** owns all ingestion"_ and _"Dispatches, actuals, attention log, size tables | Local SQLite | No — gitignored"_.
- Roadmap §7 **Phase 3a** — the phase entry, its telemetry-first bullet, and the five kickoff questions. This task answers the `TERM` one (**D54**) and touches none of the other four.
- Roadmap §5 **F28** (2026-07-24) — the `TERM=dumb` finding. Commit 1 exists because of it.
- Roadmap §7 **Phase 8**, open question 1 — **already answered, do not re-investigate.** Session identity is the `sessions` row id and survives restart, **with two caveats this task must design around**: _"(a) a restored session is a genuinely **fresh conversation**, not a resumed one — the id survives, the context does not; (b) pane close / `session:delete` **deletes the row** (D16 resolution d), so dispatch records must tolerate their session id disappearing rather than assuming referential integrity."_
- Roadmap §6 **D42** — attribution is keyed on `AuthMethodDefinition.type` (`'subscription' | 'api_key'`), not on the gateway. That discriminator is a **column on the dispatch row** in this task.
- Roadmap §6 **D48** — the one-home rule, learned the expensive way. Applied here to the token/cost columns.
- Roadmap §6 **D7** — Drizzle is types + queries only. **Migrations stay in the hand-rolled `MIGRATIONS` array.** Never drizzle-kit.
- Roadmap §5 **F16** — FKs are **ENFORCED**. This is the reason the dispatch table has no `REFERENCES` clause anywhere; see Goal.
- Roadmap §5 **F6** — a persisted `running` means _"was running when last observed"_, never _"is alive"_. The boot-heal branch of this task is the same idea one layer up.
- Roadmap §5 **F20** — verification provenance. The coordinator re-verifies every DB claim against the real `%APPDATA%\chorus\chorus.db`.
- `Tasks/Task-3-6.md` + `ImplementationSpecs/ImplementationSpec-3-6.md` — the closest precedent for a two-commit session carrying a migration, and the source of the three-dump protocol reproduced below.
- `CLAUDE.md` — sessions live in main; the renderer never spawns and never owns lifecycle facts.

## Initial Starting Point

**Verified 2026-07-24 by the coordinator against `15a016e`** (Task 3-6, code HEAD for `src/`) with the roadmap at `e233e33`. Anchored to **named symbols, never line numbers** (standing house rule). Re-verify at execution; these facts have moved before.

- **Baseline:** `npm run typecheck` exits 0 (node + web) · `npx vitest run` = **273/273 across 14 files** · `npm run grep:secrets` clean (6 patterns).
- **Working tree carries two untracked files at repo root: `TASK-3-5-REVIEW-FABLE.md` and `TASK-3-6-REVIEW-FABLE.md`.** They are not yours. **Do not commit them, do not delete them, do not revert them.**
- **Migrations.** `const MIGRATIONS: string[]` in `src/main/services/storage.ts`, currently **six entries**; v6 is `ALTER TABLE provider_configs ADD COLUMN model TEXT;`. The runner is the private `migrate()` method over the `schema_migrations` table — hand-rolled, applied in order, each version inside its own transaction.
- **Drizzle schema** `src/main/db/schema.ts` exports `projects`, `paneLayouts`, `settings`, `schemaMigrations`, `sessions`, `worktrees`, `providerConfigs`, `credentialProfiles`. Nothing else.
- **`sessions` columns are `id, project_id, agent, cwd, status, exit_code, title, worktree_id, created_at`.** **There is NO `ended_at`, and no `started_at` distinct from `created_at`.** `status` is `'running' | 'exited'` only. A dispatch's wall-clock therefore cannot be read off the sessions table — it has to be recorded, which is the whole reason this task exists.
- **`StorageService`** (class, `storage.ts`) — existing accessors include `createSession`, `getSessionById`, `updateSessionStatus`, `updateSessionTitle`, `deleteSession`, `getCredentialedSessionIds`, `markSessionCredentialed`, `unmarkSessionCredentialed`, and the inline-Drizzle `settings` pair pattern (`getViewState` / `setViewState`).
- **`SessionManager`** (`src/main/services/sessionManager.ts`) — `launch()`, private `spawn()`, `restore(projectId)`, `attach(sessionId)`, `kill()`, `dispose()`, and the `onData` / `onExit` / `onRestored` listener **Sets**. `spawn` composes the child env via `composeChildEnv` and constructs the `SessionOutput`. **`sessions.kill(...)` has exactly ONE caller in the whole codebase** — the `IpcChannel.SessionKill` handler in `src/main/ipc.ts`; `sessions.dispose()` has exactly one — the `before-quit` handler in `src/main/index.ts`. That is what makes end-intent capturable at all.
- **`src/main/index.ts`** — `app.whenReady().then(async () => {…})` constructs storage, calls `sessions.bindStorage(storage)`, constructs `GitWorktreeManager` and `CredentialVault`, calls `registerIpc(sessions, storage, worktrees, vault)`, then `watchSessionExits(sessions)`, then registers `sessions.onExit((sessionId, exitCode) => {…})` which writes `exited` + the real code, then **awaits** `worktrees.reconcileAll()`, then `void sessions.restore(project.id)`.
- **`src/main/adapters/env.ts`** exports `BASELINE_ENV_VARS` (the D33 council seven: `PATH, SystemRoot, TEMP, TMP, HOMEDRIVE, HOMEPATH, USERPROFILE`), `ComposeInput`, `composeChildEnv`, `resolveEnvVarName`. Tests in `src/main/adapters/env.test.ts`.
- **`powerMonitor` is NOT imported anywhere in the codebase, and no focus tracking of any kind exists.** Both are Task 3a-2's job, not this one.
- **IPC:** the `IpcChannel` map in `src/shared/ipc.ts`; `registerIpc` in `src/main/ipc.ts` with **31 `ipcMain.handle(` registrations**. All Zod in main (D1); the preload is a Zod-free typed forwarder; IPC payloads must be plain objects (D14). **This task adds zero channels and leaves all three files untouched.**
- **Harness precedent:** `_verify/3-6/dump-v6.js` — a read-only dump script run under `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe`. Read it before writing `dump-v7.js`; it is the shape to copy, **with one mandatory change** (see the warning below).

### ⚠ Standing condition — the dev vault now holds a REAL, BILLABLE credential

Coordinator-established 2026-07-24 and recorded in roadmap §5: **Matthew's real OpenRouter key lives in the real dev vault** under the credential profile **"OR milestone key"** (provider "OpenRouter", model `moonshotai/kimi-k3`). His key, his vault, his machine, deliberately left in place.

Consequences, all binding on this task:

- **Never dump, echo, print, copy, or transmit `credential_profiles.encrypted_blob` or `fingerprint_hash`.** The 3-6 dump script selected `*` from that table; **`dump-v7.js` must not.** Select the non-secret columns explicitly and prove blob stability with `length(encrypted_blob)` — a byte count is not key material, and it is sufficient evidence that a migration did not touch the blob.
- **Do not treat vault contents as fixtures.** Anything you need to launch against, you create yourself with a planted fake key and remove afterwards.
- **Do not press Test key on "OR milestone key".** That is a live, billable call on someone else's account, and nothing in this task needs it.

## Goal

Start the clock. Make Chorus record, for every agent run, the facts that cannot be reconstructed later — when it started, when it ended, how it ended, which agent and model, under which auth mode — into a durable local table whose token and cost columns Task 3a-3 fills in on the **same row**.

And, before that, pay off F28: stop letting the host shell's `TERM` decide how an agent renders and whether the scrubber can see what it renders.

Four properties define the work. Each is a way this can be built wrong while looking right.

1. **One home, not two.** D48's lesson, applied prospectively instead of retroactively. The token and cost columns live on the **same row** that carries the wall-clock — not in a parallel `usage_records` table joined 1:1 to it. See the naming note in Exact Scope: the roadmap's `usage_records` language is **superseded**, deliberately and explicitly, not quietly.
2. **A dispatch is not a session.** Sessions are deleted on pane close (D16 resolution d), and a restored session is a **genuinely fresh conversation** (Phase 8 open question 1, caveat (a)). So: one session id may own **many** dispatch rows over its life, and a dispatch row **must survive its session id disappearing**. **⚠ Therefore `dispatches` carries NO `REFERENCES` clause of any kind.** FKs are ENFORCED on this database (F16, re-verified repeatedly), and a `REFERENCES sessions(id)` would default to RESTRICT — which means the very first pane close after this ships would make `session:delete` **throw**, breaking a flow that has worked since Task 1-5. A telemetry table that can break a user flow is worse than no telemetry table.
3. **Free of the renderer.** Spec §8: main owns all ingestion. Capture hangs off the lifecycle main already owns — `spawn` success, the `onExit` announcement, the boot heal — and off nothing the renderer says. There is no IPC channel in this task, so there is nothing for a renderer to lie about or forget to call.
4. **Telemetry may never fail a launch.** Every write is inside a `try` whose `catch` logs and returns. A dispatch row that fails to insert is a lost data point; a dispatch row whose insert propagates is a **dead agent session**. The first is acceptable and the second is not, and the code must make that trade structurally rather than by hoping SQLite never errors.

## Exact Scope

**Commit 1 — the flagged chore (D54, closes F28).** Behaviour-scoped, not behaviour-neutral: it deliberately changes what every child process sees in exactly two variables, and it must be narrated as an **amendment to D33's seven-variable allow-list**, not slipped in.

| File | Change |
|---|---|
| `src/main/adapters/env.ts` | **Edit — COMMIT 1.** Add `PINNED_ENV_VARS` (`TERM=xterm-256color`, `COLORTERM=truecolor`) and apply it in **both** branches of `composeChildEnv`. **⚠ It is a separate constant, NOT an addition to `BASELINE_ENV_VARS`** — see the trap in the Review Checklist. |
| `src/main/adapters/env.test.ts` | **Edit — COMMIT 1.** Amend the identity test; add the pin cases listed in Test Expectations. |

**Commit 2 — the task.** Migration v7 plus the dispatch spine. **No UI, no IPC, no renderer file, no adapter change.**

| File | Change |
|---|---|
| `src/main/db/schema.ts` | **Edit.** Add the `dispatches` and `attentionSpans` Drizzle table definitions plus their `$inferSelect`/`$inferInsert` types, matching v7's DDL column for column. |
| `src/main/services/storage.ts` | **Edit.** Append **migration v7** (both `CREATE TABLE`s + the one index, one string, applied atomically — the v4/v5 multi-statement precedent). Add the dispatch accessors named in the spec. **No attention accessor, no usage accessor** — see Non-Goals. |
| `src/main/services/dispatches.ts` | **Create.** The pure `classifyOutcome` + the `DispatchRecorder` that opens on start, closes on exit, and heals orphans at boot. Electron-free and node-pty-free, so it is unit-testable. |
| `src/main/services/dispatches.test.ts` | **Create.** Unit tests for the classifier table and the never-propagate property. |
| `src/main/services/sessionManager.ts` | **Edit.** Three additive changes only: an `onStart` listener Set announced at the end of `spawn`; a `killRequested` flag on the internal `PtySession` set by `kill()` and `dispose()`; a public `wasKilledByChorus(sessionId)`. **No change to any existing code path's behaviour.** |
| `src/main/index.ts` | **Edit.** Construct the recorder after storage init, heal orphaned dispatches **before** `restore()`, attach it to the manager, and close open dispatches in `before-quit`. |
| `_verify/3a-1/dump-v7.js` | **Create (untracked harness, not committed).** The three-dump script, adapted from `_verify/3-6/dump-v6.js` **with the credential-blob change mandated above**. |

Nothing else. If a change seems to require another file — especially `src/main/ipc.ts`, `src/shared/ipc.ts`, or anything under `src/renderer/` — **stop and raise it**; that is a scope signal, not a detail.

### ⚠ Naming — the table is `dispatches`, and that SUPERSEDES the roadmap's `usage_records`

The roadmap names the token/cost capture **`usage_records`** in three places (Phase 3 scope split, the Phase 3 non-goals, and the Phase 3a entry: _"**`usage_records`** capture — which needs an api-mode producer to be honest"_). Mission Control's spec never uses that name; its unit of work is a **dispatch** (§5.2, §9 Phase 0, §8's storage table). This task builds **one table named `dispatches`** and does **not** create `usage_records`.

**That is a deliberate supersession and must be narrated in the commit message, not left to inference.** The reasoning, which is D48's lesson applied one phase earlier than it was learned:

- The roadmap's `usage_records` and the spec's dispatch record describe **the same row**. §5.2 lists `started_at`, `ended_at`, `outcome`, `agent_id`; §5.1 lists `tokens_in`, `tokens_out`, `tokens_cached`, `model`, `cost`. §9 Phase 0's acceptance folds them into one sentence: _"task id (or a placeholder), agent, model, start, end, tokens, cost, outcome."_ One record, described twice.
- Building both would produce a **1:1 side table joined to the dispatch it annotates** — two homes for one fact, which is exactly what D48 was written to stop. The Phase 3a entry already carries that instruction forward for models: _"3a must NOT create a second competing home for 'which model.'"_ The same rule governs cost.
- The blocker the roadmap attached to `usage_records` ("needs an api-mode producer to be honest") is a **producer** problem, not a **schema** problem. This task ships the columns empty and honest; Task 3a-3 supplies the producer. Waiting for the producer before creating the row would forfeit the wall-clock data that is decaying today, which is the one thing D50 sequenced this phase to prevent.

If a later reader looks for `usage_records`, the answer is: the dispatch row is the usage record.

## Non-Goals

- **Do not revert, stage, delete, or commit the two untracked `TASK-*-REVIEW-FABLE.md` files at repo root.** They belong to prior sessions' review record. Leave them exactly as found.
- **No UI, no board, no dispatch panel, no pane task chip, no settings surface.** Spec §9 Phase 0 is explicit: _"No UI. No board."_ Not a debug view, not a temporary table dump in Settings, not "just a count in the status bar".
- **No IPC channel, no preload forwarder, no Zod schema.** The count of `ipcMain.handle(` registrations must still read **31** when this task ends.
- **No task graph, no seed loader, no validation, no readiness / fan-out / critical path / float / estimation / projection.** Those are spec phases 1 and 2 and belong to Phase 8.
- **No token or cost WRITER.** v7 declares `tokens_in`, `tokens_out`, `tokens_cached`, `cost_usd`; this task writes `NULL` to all four, always. The producer is Task 3a-3's OpenRouter Provisioning-API work (D42) and its shape is not knowable yet.
- **No OpenRouter Provisioning API client, no per-dispatch key minting, no key revocation, no spend polling.** Task 3a-3.
- **No attention WRITER, no focus tracking, no `powerMonitor` import, no `BrowserWindow` focus listener, no idle threshold.** v7 creates `attention_spans` and this task leaves it **empty**. Task 3a-2 owns every line that writes to it. The table is created here only so schema churn stays in one migration.
- **No second migration.** v7 is the only one this task adds. If you find yourself wanting v8, the design is wrong — raise it. **(For the phase as a whole the numbers are fixed: 3a-1 → v7 · 3a-3 → v8 · 3a-4 → v9 · 3a-5 → v10. Confirm `MIGRATIONS.length + 1` equals 7 before appending; if it does not, stop and report.)**
- **⚠ v7's `attention_spans` DDL was AMENDED by the coordinator on 2026-07-24, after this doc was drafted and before anything shipped.** Task 3a-2 raised a dependency finding during authoring: the table as first drafted lacked **`class`** and **`tick_seconds`**, without which attention has a numerator but no denominator. Both are now in the spec's DDL and are **mandatory**. Read `ImplementationSpec-3a-1.md` §2.1/§2.2 as authoritative over any earlier column list. This is the boundary working as designed — the amendment cost two columns because it was caught before v7 reached the real dev DB.
- **No `usage_records` table.** Superseded here; see Exact Scope's naming note.
- **No `REFERENCES` clause on either new table.** Not to `sessions`, not to `projects`, not to `provider_configs`. This is a hard rule, not a preference.
- **No change to session behaviour.** No new session status, no change to `launch` / `attach` / `restore` / `restart` / `delete` semantics, no change to what the renderer sees, no change to the restore contract.
- **No adapter change, no new agent kind, no registry widening.** `agentKindSchema` stays `'claude' | 'codex'`.
- **No `launch_profiles`, no `model_catalog`, no effort normalization.** Later in this phase.
- **No retention policy, no pruning, no aging-out of dispatch rows** (spec open question 6 is explicitly unresolved — do not pre-empt it).
- **Do not dump, echo, log, or transmit `credential_profiles.encrypted_blob` or `fingerprint_hash`**, and do not run Test key against "OR milestone key".
- **Do not remove the standing `wt-24b5c1fe` worktree row, its directory, or branch `chorus/Chorus/24b5c1fe`.** It is the standing regression fixture.
- **Do not revert, stage, or commit unrelated or untracked files, including anything under `_verify/` or `docs/`.**

## Dependencies

- **Phase 3, complete** (`15a016e`): `composeChildEnv` exists and is the single env-policy owner; `SessionManager.spawn` is the single composition point; the hand-rolled migration runner has six versions applied on the real dev DB.
- **No new npm dependency.** Everything here is better-sqlite3 + Drizzle types + `randomUUID` + the existing pino logger.
- Nothing in this task depends on Task 3a-2 or 3a-3; both depend on it.

## Step-by-step Work

0. **COMMIT 1 — pin `TERM` (D54, closes F28). Flagged chore, lands FIRST, narrated as an allow-list amendment.**

   **The finding, restated so the fix is aimed at the right thing.** The Task 3-6 execution shell exported **`TERM=dumb`**. That value was inherited through the allow-list into the child, and it put codex 0.145.0 into a fallback renderer that emits cursor-advance escapes **between individual characters** — the roadmap's recorded sample is `-  a  p  i  0  3  -  K  7 …`. The consequence is the sharp one: the secret was **fully legible on screen and simultaneously invisible to substring matching**, so exact-value scrubbing was defeated **without any bug in the scrubber**. This is D33's accepted ANSI-interleaving residual (Qwen's preserved dissent) observed live, and it is a rendering-policy problem, not a scrubber problem. Fix it where rendering policy lives.

   **What lands:** a new exported constant in `env.ts` — **not** an addition to `BASELINE_ENV_VARS` — holding two fixed values, applied in **both** branches of `composeChildEnv`.

   **Both branches, and this is the decision.** Pinning only on credential-bearing launches would leave the no-credential path (which is most launches) still inheriting `TERM=dumb`, and would make two launch policies render differently — the exact class of asymmetry that produced F28 in the first place. So the identity branch is no longer a literal identity: it returns the parent environment **plus the two pins**. That is a real amendment to D33 resolution (c) and the commit message must say so. It does not weaken (c)'s substance: (c) exists so that a no-credential launch keeps the developer's ambient environment including ambient provider keys, and pinning two rendering variables takes nothing away.

   **`COLORTERM` travels with it — decided, not deferred.** Three reasons, in order of weight:
   - **A pinned constant does not widen the inheritance surface at all.** D33's allow-list is a list of *names to inherit from the parent*; every entry is a channel through which host state reaches the child. `TERM` and `COLORTERM` here are **imposed literals** — they carry zero bytes of host state. The amendment therefore adds **zero** inherited variables, which is materially different from allow-listing something like `APPDATA`. Argue it in the commit message this way or the amendment looks larger than it is.
   - **Without it the two branches disagree again.** On a credential-bearing launch `COLORTERM` is not in the allow-list, so it is stripped — while `TERM` now advertises 256-color. On a no-credential launch a host-exported `COLORTERM` passes through. Same asymmetry, different variable.
   - **It removes the last host-shell variable from the render decision**, which is the whole point of the pin. Half-fixing a variance bug leaves a variance bug.

   The counter-argument, recorded because it is not silly: `COLORTERM`'s absence degrades colour depth only — never correctness, never scrubber effectiveness — so it is not strictly evidenced by F28. It is admitted on consistency grounds, and the commit message should say that plainly rather than implying F28 proved it.

   **Precedence inside `composeChildEnv`:** inherited baseline/required → **pins** → `envAdditions` → `secretEnv`. The pins therefore beat anything inherited (the point) but an adapter that deliberately declares `TERM` in `envAdditions` still wins — which leaves F28's "pin per-adapter" option open for a later phase without building it now.

   **Runtime proof obligation — the chore is not done until this is driven.** Two parts, both required:
   1. **Launch the dev app from a shell that exports `TERM=dumb`**, launch codex through the real window, and observe a **correctly rendered TUI** (box drawing, unicode, colour — the same structural check the Task 3-5 coordinator used). Then read the child's environment from **outside** the app and confirm it holds `TERM=xterm-256color`, not `dumb`. This is the direct F28 re-drive: same hostile input, opposite outcome.
   2. **Re-drive at least one Task 3-5 scrubber item against the pinned seam**, using the existing `_verify/3-5/probe.js` harness (it reports booleans and counts only, never the value). Item 2 (ring buffer holds the placeholder, the value is absent) is the cheapest and the most load-bearing. **Use a planted fake value, never the vault's real key.** A rendering change that alters how output reaches the scrubber is not proven safe by a compile.

   **Not in this commit:** no schema, no dispatch code, no `sessionManager.ts` edit, no per-adapter terminal declaration.

1. **COMMIT 2 — migration v7.** Append the two `CREATE TABLE`s and the one index as a single `MIGRATIONS` entry, applied atomically in the runner's existing transaction (the v4 precedent: two statements, one entry). Mirror both tables in `schema.ts` **exactly** — the DDL and the Drizzle definition must not drift, and the spec gives both texts.
2. **Storage accessors.** The dispatch open/close/read surface, in the same rows-in-rows-out style as the worktree and credential accessors. Every policy decision lives in the recorder, not here.
3. **`dispatches.ts` — the pure classifier first.** `classifyOutcome` takes plain facts and returns `{outcome, closedBy}`. Pure, exported, Electron-free — the `computeRestoreSet` / `composeChildEnv` precedent. Write its unit table before the recorder exists.
4. **`dispatches.ts` — the recorder.** Open on start, close on exit, heal orphans at boot, close the remainder at quit. **Every storage call inside its own `try/catch` that logs through pino and returns.** No method on this object may throw.
5. **`sessionManager.ts` — three additive changes**, no more. The `onStart` announce loop must itself be defensive so a future listener cannot break a launch; existing loops stay untouched.
6. **`index.ts` — wiring and ORDER.** The boot heal must run **before** `sessions.restore(project.id)`, for the same reason the worktree reconcile does: restore opens new dispatches, and a heal that ran afterwards would close them. The quit close must run **after** `sessions.dispose()` and **before** `storage.close()`.
7. **Tests**, then `npm run typecheck` / `npx vitest run` / `npm run grep:secrets`.
8. **The three-dump migration protocol** (Verification Commands) and the runtime drive (G2).

## Test Expectations

**Unit (Vitest), `src/main/adapters/env.test.ts` — COMMIT 1:**

- **The existing `NO credential → identity` test will FAIL and must be amended, not deleted.** Its replacement asserts the honest new property: the result is the parent environment **plus exactly the pinned keys**, with every other key and value unchanged. Assert by key-set equality against `Object.keys(PARENT) ∪ pinned` so an accidental extra survives nothing.
- **The pin beats a hostile inherited value, in BOTH branches.** With `parentEnv.TERM = 'dumb'`: a no-credential launch yields `xterm-256color`, and a credential-bearing launch yields `xterm-256color`. Two named tests — the whole point of D54 is that both branches agree.
- **`COLORTERM` is present and equals `truecolor` in both branches**, including when the parent does not define it at all.
- **`envAdditions` beats the pin.** An adapter declaring `TERM` wins; the pin is a default, not an authority.
- **`secretEnv` still beats everything**, unchanged.
- **The credential-branch key-set equality test is updated** to include the two pinned names, and it must still fail against a `{...parentEnv, ...secretEnv}` implementation. Confirm that by trying it, not by assuming it.

**Unit (Vitest), `src/main/services/dispatches.test.ts` — COMMIT 2:**

- **The `classifyOutcome` table**, one case per row of the mapping in the spec's classification section, including the two that are easy to get wrong: **exit code 0 after a kill is `abandoned`, not `completed`**, and a boot-healed orphan is `abandoned` with `ended_at` **null**.
- **THE MOST IMPORTANT TEST IN THE TASK — a storage double that throws on every call does not propagate.** Drive open, close, heal and quit-close against it and assert each returns normally and logs. This is the property that decides whether telemetry can kill an agent session, and it is exactly the kind of thing that is true on the day it ships and false three refactors later.
- **Open → close writes exactly one row and closes exactly that row**, with `started_at` ≤ `ended_at`.
- **A second `spawn` under the same session id opens a SECOND dispatch row** and does not reopen or mutate the first — the fresh-conversation property (Phase 8 open question 1, caveat (a)).
- **Closing is idempotent:** a row already carrying an `outcome` is never re-closed, so a boot heal cannot rewrite history on every subsequent boot. Assert the open predicate is `outcome IS NULL`, **not** `ended_at IS NULL` — see the trap in the spec.
- **The session id is recorded as an opaque string**, and nothing in the recorder reads the `sessions` table to validate it. A test asserting a dispatch closes cleanly for a session id that no longer exists is the unit-level statement of invariant 2.

**No test may contain a real credential, a real key fragment, or a copy of anything from the dev vault**, and `npm run grep:secrets` must pass afterwards.

**Runtime (G2) carries the migration proof and the F28 re-drive.** No unit test can establish either.

## Verification Commands

Run from repo root in **PowerShell**.

```
npm run typecheck
```

```
npx vitest run
```

```
npm run grep:secrets
```

```
npm run dev
```

**The F28 re-drive (Commit 1) — launch from a hostile shell.** In a fresh PowerShell:

```
$env:TERM = 'dumb'; npm run dev
```

Then launch codex through the real window, screenshot the TUI, and read the child's environment **from outside the app** (`_verify/3-6/read-env.ps1` is the kept harness for exactly this — its PEB offsets were established the hard way on this Win11 build and are recorded in roadmap §5). Report: the value of `TERM` in the child, and whether the render shows the interleaved `-  a  p  i …` shape or a normal TUI.

**⚠ The migration v7 proof — the FULL three-dump protocol, exactly as Tasks 3-2 and 3-6 ran it.** A short DDL does not earn a short proof: the risk lives in the runner and the real database, not in the statements.

```
New-Item -ItemType Directory -Force _verify\3a-1 | Out-Null
$env:ELECTRON_RUN_AS_NODE = '1'
& node_modules\electron\dist\electron.exe _verify\3a-1\dump-v7.js "$env:APPDATA\chorus\chorus.db" _verify\3a-1\pre.json
```

Then boot the app once (cold — electron-vite does **not** hot-restart main), tree-kill it, and dump again to `post.json`; then boot a second time, tree-kill, and dump to `boot2.json`. Assert, **quoting the evidence**:

1. `schema_migrations` shows **6 → 7**, applied **in place**; the `applied_at` timestamps for **v1–v6 are byte-identical** pre and post. That is the proof it migrated rather than recreated. Known-good values to check against: v4 `2026-07-20T16:57:49.534Z`, v5 `2026-07-23T13:04:06.301Z`, v6 `2026-07-24T15:52:22.591Z`.
2. Every pre-existing table is **row-identical** across pre / post / boot-2 — `projects`, `sessions`, `worktrees`, `pane_layouts`, `settings`, `provider_configs`, and `credential_profiles` **over its non-secret columns plus `length(encrypted_blob)`**. Zero data loss.
3. `dispatches` and `attention_spans` exist, with the exact column list and types the spec gives, and both are **empty** immediately after the migrating boot.
4. **Boot 2 does not re-apply v7** — `applied_at` for v7 is byte-identical between `post.json` and `boot2.json`.
5. The standing `wt-24b5c1fe` worktree row is intact.

**⚠ Provenance (F20).** **Quote the `projects` table in every dump.** The coordinator re-verifies on the real dev DB and needs to see the real pair — `985d547b…` (Chorus) and `f47ac10b…` (Chorus-Second). A dump showing `a43b395d…`/`b684e96e…` is the redirected DB and does **not** discharge this criterion.

**⚠ The `sqlite3` CLI is NOT installed.** Use the `ELECTRON_RUN_AS_NODE` script pattern only. **Known flake: the script intermittently writes no file on its first invocation — retry once.**

**The dispatch runtime drive (G2).** With the app running, after each step dump `dispatches` and quote the row:

1. **Open.** Launch a session. One row appears: `session_id` matching, `agent` correct, `started_at` set, `ended_at` NULL, `outcome` NULL, all four token/cost columns NULL.
2. **Normal end.** Let a session exit on its own. The row closes with the code-derived outcome and a real `ended_at`.
3. **Kill.** Press the pane's Kill control. The row closes `abandoned` / `kill` — **not** `failed`, even though Windows reports a non-zero code for a killed PTY (the recorded shape on this machine is `-1073741510`).
4. **THE DANGLING-ID PROOF.** Close a pane entirely (kill → awaited exit → leaf removed → `session:delete`). Confirm: `session:delete` **does not throw**, the `sessions` row is gone, and the dispatch row **survives** carrying a session id that no longer resolves. This is invariant 2 proven against the enforced-FK reality, and it is the single most important runtime check in the task.
5. **Fresh conversation.** Restart the app so the restore engine relaunches a session. Confirm a **second** dispatch row under the **same** session id, with the first still closed and untouched.
6. **Crash heal.** Tree-kill the app (`taskkill /PID <root> /T /F`) while a session is live, leaving a dispatch open. Boot again. Confirm the orphan closes `abandoned` / `boot-heal` with `ended_at` **NULL**, and that a **third** boot does not touch it again.
7. **Never-fail-a-launch, at runtime.** Temporarily instrument the recorder to throw on open, cold-boot, and confirm a session still launches and attaches normally with the failure logged. **Then revert the instrumentation** and prove the revert against the **commit diff**, not the worktree — the Task 2-4 precedent.

**Harness reminders.** Kill process **trees** (`taskkill /PID <root> /T /F`); the graceful-quit test is `taskkill` **without** `/F`. electron-vite does not hot-restart main, so every check above needs a real cold boot. CDP on `--remote-debugging-port=9222` is the proven driver.

## Acceptance Criteria

- [ ] `npm run typecheck` — zero errors, node and web (G1).
- [ ] `npx vitest run` — green, the 273/14 baseline **intact and grown**.
- [ ] `npm run grep:secrets` — clean (G4, mandatory), including over any new `_verify/3a-1/` artifacts.
- [ ] **`TERM` is pinned to `xterm-256color` and `COLORTERM` to `truecolor` in BOTH branches of `composeChildEnv`**, as a separate constant, and the commit message narrates it as an amendment to D33's seven-variable allow-list under **D54**, with the "pinned constant ≠ inherited variable" argument stated.
- [ ] **F28 is re-driven at runtime and closed:** the app launched from a shell exporting `TERM=dumb` produced a correctly rendered codex TUI, and an external read of the child's environment showed `TERM=xterm-256color`. Evidence quoted.
- [ ] **At least one Task 3-5 scrubber item was re-driven against the pinned seam** with a planted fake value, results quoted. Belief is not proof on a redaction path.
- [ ] **Migration v7 applied IN PLACE on the real dev DB with zero data loss** — the three-dump protocol above, with v1–v6 `applied_at` byte-identical, every pre-existing table row-identical across pre/post/boot-2, both new tables created empty, and v7 not re-applied on boot 2. **The coordinator re-verifies on the real DB** (F20); an implementer dump that does not quote `985d547b…` does not discharge this.
- [ ] **No `credential_profiles` blob or fingerprint appears in any dump, log, artifact, or summary**, and Test key was never pressed against "OR milestone key".
- [ ] **`dispatches` carries no `REFERENCES` clause**, and the dangling-id proof ran: a pane close deleted the session row, `session:delete` did not throw, and the dispatch row survived.
- [ ] **Outcome classification is implemented as specified and proven at runtime for all five observables** — clean exit, non-zero exit, kill, quit, boot-heal orphan. A killed session with exit code 0 records `abandoned`.
- [ ] **A restored session opens a SECOND dispatch row** — the fresh-conversation property, proven across a real restart.
- [ ] **Telemetry cannot fail a launch** — proven by the throwing-storage unit test **and** by a reverted runtime instrumentation drive, with the revert checked against the commit diff.
- [ ] **The token/cost columns exist on the dispatch row and are written NULL** — no `usage_records` table exists anywhere, and the commit message states that this supersedes the roadmap's separate-table language and why.
- [ ] **`attention_spans` exists and is empty**, with no writer, no `powerMonitor` import, and no focus listener anywhere in `src/`. Grep-verified.
- [ ] **Zero behaviour change to sessions** — launch, attach, restore, restart, delete and close all behave as before; the `ipcMain.handle(` count still reads **31**; `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/ipc.ts` and every file under `src/renderer/` are untouched. Grep-verified.
- [ ] **TWO** narrated commits (G3 amended): the `TERM` chore, then the telemetry spine. Each touches only its own Exact Scope rows.
- [ ] **The two untracked `TASK-*-REVIEW-FABLE.md` files are still present, unmodified, and unstaged**, and no `_verify/` or `docs/` file was staged or reverted.
- [ ] The standing `wt-24b5c1fe` worktree row, directory, and branch are **untouched**.

## Review Checklist

- [ ] **Read `env.ts` for the category error.** Adding `'TERM'` to `BASELINE_ENV_VARS` would compile, pass a careless test, and **inherit `TERM=dumb`** — i.e. reproduce F28 exactly while reading as the fix, because that array is a list of *names to copy from the parent*. Confirm the pins are a separate map of *values to impose*, and that a test would fail if they were moved.
- [ ] **Confirm the pin is applied in the identity branch too.** A pin that only fires on credential-bearing launches leaves the common path broken and the two policies disagreeing — the F28 shape.
- [ ] **Check the open predicate.** It must be `outcome IS NULL`, not `ended_at IS NULL`. A boot-healed orphan deliberately keeps `ended_at` NULL; if "open" is defined by `ended_at`, every subsequent boot re-closes the same rows forever and the table quietly becomes a lie. Confirm a unit test would catch it.
- [ ] **Grep the migration string for `REFERENCES`.** Zero hits in v7. Then confirm the dangling-id runtime proof actually ran against a **deleted** session row, not merely an exited one.
- [ ] **Read every recorder method for an unguarded storage call.** One un-`try`'d line is enough to turn a SQLite hiccup into a failed agent launch. Check the `onStart` announce loop in `sessionManager.ts` too — a throwing listener there lands inside `spawn`.
- [ ] **Confirm the boot heal runs before `restore()`** and the quit close runs after `dispose()` and before `storage.close()`. Both orderings are load-bearing and both look arbitrary in a diff.
- [ ] **Check that `kill()`'s intent flag is set BEFORE `pty.kill()`**, not after. The exit event can arrive fast; setting the flag afterwards is a race that misclassifies kills as failures, and it will reproduce only sometimes.
- [ ] **Confirm nothing reads the `sessions` table to validate a dispatch's session id** — not in the recorder, not in the accessors. That lookup is how referential assumptions creep back in after the FK was deliberately omitted.
- [ ] **Read the dump script before it is run.** It must not `SELECT *` from `credential_profiles`. The vault holds a real billable key and a careless `*` puts an encrypted blob into a JSON artifact that then gets quoted into a summary.
- [ ] **Confirm the runtime never-fail instrumentation was genuinely reverted** — against the commit diff, not the worktree (Task 2-4 precedent).
- [ ] **Confirm no dispatch write happens when `spawn` throws.** The row must be opened only after `pty.spawn` has returned, or a failed launch leaves a permanently open dispatch that the next boot heal will silently count as an abandoned run.
- [ ] **Check the summary for an unproven migration claim.** A dump quoting `a43b395d…` is the F20-redirected database and proves nothing about the real one; send it back rather than reasoning around it.

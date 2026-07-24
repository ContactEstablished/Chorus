# Implementation Spec 3a-1 — TERM Pin + The Dispatch Telemetry Spine

_Companion to `Tasks/Task-3a-1.md`. The task doc governs **scope**; this doc governs **exact contents, insertion points, and rationale**. Code blocks are starting points to adapt to the surrounding file's conventions — not byte-for-byte mandates — **except** the v7 DDL and the Drizzle table definitions in §2, which are **EXACT** and must not drift from each other._

**Anchored 2026-07-24 to `15a016e`** (Task 3-6 — code HEAD for `src/`), roadmap at `e233e33`. Baseline: typecheck 0 · **273/273 across 14 files** · `grep:secrets` clean over 6 patterns. Working tree carries two untracked `TASK-*-REVIEW-FABLE.md` files at repo root that are **not yours**. Re-verify all of it at execution.

**⚠ Standing condition, repeated here because this spec contains a database dump script:** the real dev vault holds Matthew's **real, billable OpenRouter key** ("OR milestone key"). Never select, print, copy or transmit `credential_profiles.encrypted_blob` or `fingerprint_hash`; never treat vault contents as fixtures; never run Test key against that profile.

---

## 1. `src/main/adapters/env.ts` — COMMIT 1, the `TERM` pin (D54, closes F28)

**Edit.** Two additions and two one-line applications. Nothing else in the file moves.

### 1.1 The constant

Insert immediately **after** the `BASELINE_ENV_VARS` declaration and **before** `interface ComposeInput`.

```ts
/**
 * Values Chorus IMPOSES on every child, regardless of what the host shell
 * exported. D54 (2026-07-24), amending D33's seven-variable allow-list.
 *
 * ⚠ This is deliberately NOT part of BASELINE_ENV_VARS, and the distinction is
 * load-bearing rather than stylistic. BASELINE_ENV_VARS is a list of NAMES TO
 * COPY FROM THE PARENT — every entry is a channel through which host state
 * reaches the child. This is a map of VALUES TO IMPOSE, carrying zero bytes of
 * host state. Adding 'TERM' to the array instead would compile, read as the
 * fix, and inherit TERM=dumb — i.e. reproduce F28 exactly.
 *
 * WHY (F28, observed live 2026-07-24): the execution shell exported TERM=dumb;
 * inherited, it put codex 0.145.0 into a fallback renderer that emits
 * cursor-advance escapes BETWEEN individual characters (`-  a  p  i  0  3  -
 * K  7 …`). The value was fully legible ON SCREEN and simultaneously INVISIBLE
 * to substring matching, so exact-value scrubbing was defeated with no bug in
 * the scrubber. That is D33's accepted ANSI-interleaving residual, observed
 * rather than theorised — and it is a rendering-policy problem, so it is fixed
 * where rendering policy lives.
 *
 * COLORTERM travels with TERM by decision, not by accident: without it a
 * credential-bearing launch strips COLORTERM (not on the allow-list) while
 * TERM advertises 256-colour, and a no-credential launch passes a host value
 * through — the same two-policies-disagree asymmetry that produced F28. It is
 * admitted on consistency grounds; F28 does not evidence it on its own.
 */
export const PINNED_ENV_VARS: Readonly<Record<string, string>> = {
  TERM: 'xterm-256color',
  COLORTERM: 'truecolor'
}
```

### 1.2 Applying it — BOTH branches of `composeChildEnv`

The no-credential branch currently reads `return { ...parentEnv } as Record<string, string>`. It becomes:

```ts
  if (Object.keys(secretEnv).length === 0) {
    // D54: still "inherit wholesale" — resolution (c) is about NOT stripping
    // the developer's ambient environment, and nothing is stripped here. Two
    // rendering constants are imposed on top. Pinning only on the credential
    // path would leave the COMMON path inheriting TERM=dumb and make the two
    // policies render differently, which is the F28 shape.
    return { ...parentEnv, ...PINNED_ENV_VARS } as Record<string, string>
  }
```

The credential branch gains one line, and **its position is the precedence rule**:

```ts
  const out: Record<string, string> = {}
  for (const name of [...BASELINE_ENV_VARS, ...requiredEnvVars]) {
    const v = parentEnv[name]
    if (typeof v === 'string') out[name] = v
  }
  Object.assign(out, PINNED_ENV_VARS)   // ← D54: beats anything INHERITED…
  Object.assign(out, envAdditions)      // …but an adapter that declares TERM wins,
  Object.assign(out, secretEnv)         //   which leaves F28's per-adapter option open.
  return out
```

**Precedence, stated once so it is not re-derived:** inherited → **pins** → `envAdditions` → `secretEnv`. The pins beat the host (the point of D54). An adapter deliberately declaring a terminal expectation beats the pins (F28 listed "pin per-adapter" as an option; this admits it later without building it now). A secret beats everything (unchanged).

### 1.3 What the commit message must say

Three things, or the amendment looks larger or smaller than it is:

1. **It amends D33's allow-list from seven to eight-and-nine** — and the amendment adds **zero inherited variables**. A pinned constant is a different object from an allow-listed name; say so explicitly, because "we added two variables to a council-set security list" is the reading a reviewer will otherwise reach.
2. **It changes the no-credential branch**, which D33 resolution (c) protects, and therefore changes what *every* existing session sees. Nothing is removed; two constants are added.
3. **`COLORTERM` is a consistency decision, not an F28 finding.** Do not imply the evidence covers it.

### 1.4 Tests (`env.test.ts`)

The existing `NO credential → identity` case **will fail**. That failure is the correct signal; amend it, do not delete it.

```ts
  it('NO credential → parent env plus the pins, and nothing else changed', () => {
    const out = composeChildEnv({ parentEnv: PARENT, requiredEnvVars: ['APPDATA'],
                                  envAdditions: { FOO: 'bar' }, secretEnv: {} })
    // Key-set equality, so an accidental extra fails here rather than in prod.
    expect(Object.keys(out).sort())
      .toEqual([...Object.keys(PARENT), ...Object.keys(PINNED_ENV_VARS)]
        .filter((k, i, a) => a.indexOf(k) === i).sort())
    for (const [k, v] of Object.entries(PARENT)) {
      if (k in PINNED_ENV_VARS) continue
      expect(out[k]).toBe(v)          // every non-pinned value untouched
    }
    expect(out.TERM).toBe('xterm-256color')
  })
```

Then, added:

- **`the pin beats an inherited TERM=dumb — no-credential branch`** and **`… — credential branch`**. Two separate named tests over `{ ...PARENT, TERM: 'dumb' }`. Both must read `xterm-256color`. These two are the D54 regression guard; a future refactor that pins in one branch only must go red.
- **`COLORTERM is imposed even when the parent never defined it`**, both branches.
- **`envAdditions beats the pin`** — `envAdditions: { TERM: 'screen-256color' }` wins.
- **The existing credential-branch key-set-equality case** gains `'TERM'` and `'COLORTERM'` to its expected set. **Verify by hand that it still fails against a `{ ...parentEnv, ...secretEnv }` implementation** — that test is the allow-list's only structural defence and it is easy to weaken while updating it.

---

## 2. Migration v7 — EXACT

### 2.1 The `MIGRATIONS` entry

**Append** as the seventh element of `const MIGRATIONS: string[]` in `src/main/services/storage.ts`, after the v6 `ALTER TABLE provider_configs ADD COLUMN model TEXT;` string. One entry, three statements, applied atomically inside the runner's existing per-version transaction — the **v4 precedent** (a `CREATE TABLE` plus an `ALTER` in one entry) and the **v5 precedent** (two `CREATE TABLE`s in one entry).

```ts
  // v7 (Phase 3a / Task 3a-1): the dispatch telemetry spine — Mission Control
  // spec §5.2 + §9 Phase 0. Historical actuals CANNOT be backfilled, which is
  // why this lands before any UI in this phase (D50).
  //
  // ⚠ NO `REFERENCES` CLAUSE ANYWHERE, AND THAT IS DELIBERATE. FKs are ENFORCED
  // on this database (F16). A dispatch outlives its session by design: pane
  // close DELETES the sessions row (D16 resolution d), and a restored session
  // is a genuinely FRESH conversation under the same id (Phase 8 open question
  // 1). A REFERENCES sessions(id) would default to RESTRICT and make the very
  // next pane close throw inside session:delete — a telemetry table that can
  // break a shipped user flow. session_id/project_id are OPAQUE STRINGS here.
  //
  // ⚠ tokens_*/cost_usd are declared now and written NULL by this task. Their
  // producer is Task 3a-3 (per-dispatch OpenRouter keys, D42). They live on
  // THIS row rather than in a separate `usage_records` table because they
  // describe the same run the wall-clock columns describe — one home, not two
  // (D48). The roadmap's `usage_records` name is superseded by this table.
  //
  // ⚠ attention_spans is created here and left EMPTY. Task 3a-2 is its only
  // writer. It exists in v7 so this phase's schema churn stays in ONE
  // migration rather than two.
  `CREATE TABLE dispatches (
     id            TEXT PRIMARY KEY,
     session_id    TEXT,
     project_id    TEXT,
     task_id       TEXT,
     agent         TEXT NOT NULL,
     model         TEXT,
     provider_name TEXT,
     auth_mode     TEXT NOT NULL,
     cwd           TEXT NOT NULL,
     started_at    TEXT NOT NULL,
     ended_at      TEXT,
     outcome       TEXT,
     closed_by     TEXT,
     exit_code     INTEGER,
     tokens_in     INTEGER,
     tokens_out    INTEGER,
     tokens_cached INTEGER,
     cost_usd      REAL
   );
   CREATE INDEX dispatches_open ON dispatches (outcome, session_id);
   CREATE TABLE attention_spans (
     id          TEXT PRIMARY KEY,
     dispatch_id TEXT,
     session_id  TEXT,
     project_id  TEXT,
     started_at  TEXT NOT NULL,
     ended_at    TEXT NOT NULL,
     seconds     INTEGER NOT NULL,
     class       TEXT NOT NULL,
     tick_seconds INTEGER NOT NULL,
     source      TEXT NOT NULL,
     created_at  TEXT NOT NULL
   );`
```

### 2.2 Every column, and why it is there

| Column | Why |
|---|---|
| `id` | UUID, minted by the recorder. The dispatch's own identity — **not** the session's. |
| `session_id` | Opaque string, **no FK**. The join back to a pane while one exists; dangling afterwards, by design. |
| `project_id` | Opaque string, **no FK**. Spec §5.3 needs a per-project overhead bucket and §6.6 needs per-project velocity; both need this without a live projects row. |
| `task_id` | Nullable, **never written by this task** — the seed does not exist. The one forward-looking column admitted, because spec §9 Phase 0's acceptance line names it as part of the minimum record (_"task id (or a placeholder)"_) and it is the join key the whole feature exists for. |
| `agent` | The adapter id — `sessions.agent`'s vocabulary. Spec §5.2's `agent_id`. |
| `model` | Nullable: a subscription route names no model. Read from the launch's route, not from the provider row, so a later provider edit cannot rewrite history. |
| `provider_name` | Nullable, the route's user-authored name **at dispatch time**. **Deliberately a name and not a `provider_id`:** the ledger records what a run was configured with, not a live pointer, for the same reason it has no FKs. When `launch_profiles` exists, its stable id is the right key — and it will be added by the phase that creates that table. Inventing a column for a table that does not exist yet is the speculative-schema failure D48 warned about. |
| `auth_mode` | `'subscription'` \| `'api_key'`. **D42's attribution discriminator, promoted to a column** — the roadmap is explicit that strategy is keyed on auth mode, not on the gateway, and that _"% of spend attributed"_ must be a first-class metric. Without this column that metric is not computable. |
| `cwd` | Spec §5.4 wants git-side correlation later; the working directory is the cheap half of it and is free at spawn time. |
| `started_at` | ISO string, the app's convention everywhere. **There is no separate `created_at`** — for a dispatch they would be the same instant, and a duplicate is a chance to disagree. |
| `ended_at` | Nullable. **NULL after close is meaningful**, not lazy: it is how a boot-healed orphan says _"it ended, we never saw when"_. Wall-clock queries filter `ended_at IS NOT NULL`. |
| `outcome` | `'completed'` \| `'abandoned'` \| `'failed'`, per spec §5.2. **NULL means OPEN** — see §4.3. |
| `closed_by` | `'exit'` \| `'kill'` \| `'dispose'` \| `'boot-heal'`. Provenance for the estimator's honesty and for auditing the classifier. A fact, not a derivation. |
| `exit_code` | Nullable integer, the PTY's real code — the same value `sessions.exit_code` gets. |
| `tokens_in` / `tokens_out` / `tokens_cached` / `cost_usd` | Declared, always NULL here, filled by 3a-3. **`tokens_cached` is separate on purpose:** spec §5.1 — _"cached input is priced roughly an order of magnitude below fresh input"_ and a projection ignoring it _"will be badly wrong in the expensive direction"_. `cost_usd` is `REAL`: OpenRouter reports fractional dollars and the consumer does percentile statistics, not accounting — no ledger claim is made. |

**`attention_spans`** is Task 3a-2's shape and is created empty: `dispatch_id`/`session_id` nullable so a **project overhead** span (§5.3: time in Chorus but not in an agent pane) has a home; `seconds` stored rather than derived because §5.3's _"one-tap correction control"_ changes the number without changing the wall interval; `source` distinguishing `'measured'` from `'corrected'`; and **`created_at` present here** — unlike on `dispatches` — because a corrected span is written after the interval it describes, so write time and event time genuinely differ.

**⚠ `class` and `tick_seconds` were ADDED to this DDL by the coordinator on 2026-07-24, before v7 shipped, on a dependency finding raised by Task 3a-2 during authoring.** They are not optional and they are not 3a-2's to add later. **`class`** is the attention class the span was credited to (pane / overhead / idle / blurred / locked, per 3a-2's focus-state table) — **without it there is no denominator**: "% of measured time that was pane-focused" is uncomputable from a table that only records the numerator, and the accounting identity 3a-2 uses as its headline correctness check (all classes sum to ticks fired) cannot be evaluated at all. **`tick_seconds`** records the sampling granularity the span was accumulated at, so that changing the tick cadence in a later phase does not silently corrupt the arithmetic of rows written under the old one. **This is exactly the amendment the Non-Goals section tells 3a-2 to raise rather than work around, and it is being made here, in v7, at a cost of two columns — which is the entire reason that boundary was drawn.** Task 3a-2 writes both; this task creates them and leaves the table empty.

**The index.** `dispatches_open (outcome, session_id)` serves both hot reads: the boot scan (`WHERE outcome IS NULL`) and the close lookup (`WHERE session_id = ? AND outcome IS NULL`). **No index for the estimator's `(agent, model)` grouping** — that consumer does not exist yet, and at a handful of dispatches per day a full scan costs nothing. Adding indexes for hypothetical queries is the same speculation the `provider_id` decision above rejects.

### 2.3 The Drizzle mirror — `src/main/db/schema.ts`, EXACT

Append after `credentialProfiles` and its exported types. **These definitions and the DDL above must not drift**; a mismatch produces typed queries that silently read the wrong shape.

```ts
/**
 * Phase 3a / Task 3a-1 (migration v7): one row per agent RUN. Mission Control
 * spec §5.2 + §9 Phase 0.
 *
 * A dispatch is NOT a session. One sessions row may own MANY dispatches over
 * its life (each restore relaunch is a fresh conversation, Phase 8 open
 * question 1), and a dispatch OUTLIVES its session row (pane close deletes it,
 * D16 resolution d). Hence NO .references() on any column here — the FK would
 * be enforced (F16) and RESTRICT would break session:delete. session_id and
 * project_id are opaque strings.
 *
 * The token/cost columns live on THIS row, not in a separate usage_records
 * table: they describe the same run (D48 — one home, not two). Written by
 * Task 3a-3; NULL until then.
 */
export const dispatches = sqliteTable('dispatches', {
  id: text('id').primaryKey(),
  sessionId: text('session_id'),
  projectId: text('project_id'),
  // Nullable and unwritten until a task seed exists (spec §9 Phase 0).
  taskId: text('task_id'),
  agent: text('agent').notNull(),
  model: text('model'),
  providerName: text('provider_name'),
  // D42: attribution strategy is keyed on auth mode. 'subscription' | 'api_key'.
  authMode: text('auth_mode').notNull(),
  cwd: text('cwd').notNull(),
  startedAt: text('started_at').notNull(),
  // NULL after close means the end was never OBSERVED (boot-healed orphan).
  endedAt: text('ended_at'),
  // NULL means OPEN. 'completed' | 'abandoned' | 'failed'.
  outcome: text('outcome'),
  // 'exit' | 'kill' | 'dispose' | 'boot-heal'.
  closedBy: text('closed_by'),
  exitCode: integer('exit_code'),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  // Separate on purpose: cached input is ~an order of magnitude cheaper
  // (spec §5.1), and folding it in projects wrong in the expensive direction.
  tokensCached: integer('tokens_cached'),
  costUsd: real('cost_usd')
})

/**
 * Phase 3a / Task 3a-1 (migration v7): attention-minutes, spec §5.3. Created
 * here so this phase's schema churn stays in ONE migration; TASK 3a-2 IS ITS
 * ONLY WRITER and this task leaves it empty. Same no-FK rule as dispatches.
 */
export const attentionSpans = sqliteTable('attention_spans', {
  id: text('id').primaryKey(),
  dispatchId: text('dispatch_id'),
  sessionId: text('session_id'),
  // Set (with a null dispatch/session) for the per-project overhead bucket.
  projectId: text('project_id'),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at').notNull(),
  // Stored, not derived: a one-tap correction changes the number without
  // changing the interval.
  seconds: integer('seconds').notNull(),
  // 'measured' | 'corrected'.
  source: text('source').notNull(),
  createdAt: text('created_at').notNull()
})

export type DispatchRow = typeof dispatches.$inferSelect
export type NewDispatchRow = typeof dispatches.$inferInsert
export type AttentionSpanRow = typeof attentionSpans.$inferSelect
export type NewAttentionSpanRow = typeof attentionSpans.$inferInsert
```

**Note the import line at the top of `schema.ts` currently reads `{ sqliteTable, text, integer, blob }` — `real` must be added.** That is the only edit above the new block.

---

## 3. `StorageService` accessors — exact signatures

**Insert point:** a new commented section in `src/main/services/storage.ts` **after** the providers/credential-profiles block (which ends at `deleteCredentialProfile`) and **before** `getWindowBounds`. Same rows-in-rows-out discipline as every block around it: **no policy here.** Import `dispatches` from `../db/schema` alongside the existing table imports, and `DispatchRow`/`NewDispatchRow` alongside the existing type imports. Drizzle needs `isNull` added to the `drizzle-orm` import.

```ts
  /* -------------------------------------------------------------------- */
  /* Dispatch telemetry (Phase 3a / Task 3a-1, migration v7). Rows in,     */
  /* rows out. "OPEN" means outcome IS NULL — never ended_at IS NULL, which*/
  /* a boot-healed orphan deliberately leaves set to NULL forever.         */
  /* -------------------------------------------------------------------- */

  createDispatch(row: NewDispatchRow): DispatchRow

  /** The open dispatch for a session, newest first. Used by the exit close.
   *  Returns null when there is none — a normal case, not an error (a session
   *  spawned before this feature existed, or a dispatch already closed). */
  getOpenDispatchForSession(sessionId: string): DispatchRow | null

  /** Every dispatch still open — the boot heal's input. */
  listOpenDispatches(): DispatchRow[]

  /** The ONE close path. `endedAt` is nullable so the boot heal can record
   *  "it ended, we never saw when". Writes nothing if the row already carries
   *  an outcome (idempotence is enforced HERE, in the WHERE clause, so a
   *  caller that loops cannot rewrite history). */
  closeDispatch(
    id: string,
    patch: {
      outcome: 'completed' | 'abandoned' | 'failed'
      closedBy: 'exit' | 'kill' | 'dispose' | 'boot-heal'
      endedAt: string | null
      exitCode: number | null
    }
  ): void
```

`closeDispatch`'s Drizzle `.where(...)` must be `and(eq(dispatches.id, id), isNull(dispatches.outcome))`. **The idempotence lives in the SQL, not in a caller's `if`** — a guard the caller can forget is not a guard.

**Deliberately absent, and named so their absence is legible as a decision:**

- **No `recordDispatchUsage(...)`.** Task 3a-3 owns it, and its shape depends on what the OpenRouter Provisioning API actually returns — unknown today. A dormant accessor guessed at now is a contract nobody verified.
- **No `createAttentionSpan(...)`.** Task 3a-2 owns it. The table exists; the writer does not.
- **No delete, no prune, no retention.** Spec open question 6 is open (_"probably unbounded, but confirm"_) and pre-empting it in the task that creates the table is how an unratified policy becomes permanent.

---

## 4. `src/main/services/dispatches.ts` — create

Electron-free and node-pty-free, so it is unit-testable and so the same recorder can serve an api-mode session later without a second wiring point (the D45(1)/F26 failure shape, one layer up).

### 4.1 The pure classifier

```ts
export type DispatchOutcome = 'completed' | 'abandoned' | 'failed'
export type DispatchClosedBy = 'exit' | 'kill' | 'dispose' | 'boot-heal'

/**
 * The ONE place an observable becomes an outcome. Pure and exported so the
 * mapping is a unit-test table rather than three scattered `if`s — the
 * computeRestoreSet / composeChildEnv precedent.
 *
 * ⚠ `killRequested` DOMINATES the exit code, and that is the whole reason this
 * function exists. On Windows a killed PTY reports a non-zero code (this
 * machine's recorded shape is -1073741510 = STATUS_CONTROL_C_EXIT), so code
 * alone cannot distinguish "the user closed the pane" from "the agent
 * crashed". Classifying by code would make `failed` the dominant outcome and
 * poison the only quality signal the estimator has (spec §5.4).
 */
export function classifyOutcome(input: {
  readonly reason: 'exit' | 'dispose' | 'boot-heal'
  readonly exitCode: number | null
  readonly killRequested: boolean
}): { outcome: DispatchOutcome; closedBy: DispatchClosedBy }
```

### 4.2 The mapping — every observable, no gaps

| Observable | `outcome` | `closed_by` | `ended_at` |
|---|---|---|---|
| PTY exits on its own, code **0** | `completed` | `exit` | the exit time |
| PTY exits on its own, code **non-zero** | `failed` | `exit` | the exit time |
| `SessionManager.kill()` was called first, **any** exit code — pane ✕, the Kill control, Restart's kill step | `abandoned` | `kill` | the exit time |
| App quit: `dispose()` killed it and no exit event was delivered before teardown | `abandoned` | `dispose` | quit time |
| Dispatch still open at boot — previous run crashed or was tree-killed | `abandoned` | `boot-heal` | **NULL** |
| `spawn()` throws (unknown agent, ConPTY failure) | **no row is created at all** | — | — |
| `restore()` heals a row it will not relaunch (credentialed / beyond-cap / cwd-missing) | **no row is created**; that session's previous dispatch was already closed by the boot heal | — | — |

**"Pane close while running" is the third row, not a fourth case.** The renderer's close flow is kill → awaited exit → leaf removed → `session:delete`. The kill is what the recorder sees; the row delete happens afterwards and the dispatch simply outlives it. That sequence is also the runtime proof of the no-FK invariant (task doc, runtime drive step 4).

**`ended_at` NULL after close is a value, not a gap.** It says: this run ended, and nobody observed when. Wall-clock consumers filter `ended_at IS NOT NULL`; outcome-rate consumers do not. Spec §11's first risk is _"Estimator produces confident-looking numbers from thin data"_ — inventing a plausible end time at boot would be exactly that, one layer down.

### 4.3 ⚠ The open predicate is `outcome IS NULL`

Not `ended_at IS NULL`. A boot-healed orphan keeps `ended_at` NULL **forever, on purpose**. If "open" is defined by `ended_at`, every subsequent boot re-selects the same rows and re-closes them — the timestamps churn, the counts double, and the table quietly becomes fiction while every test still passes. Enforce it in the accessor's SQL (§3) and assert it in a unit test.

### 4.4 The recorder

```ts
export interface DispatchRecorder {
  /** Close every dispatch left open by a previous run. MUST run before
   *  restore(): restore opens new dispatches, and a heal running afterwards
   *  would close them on their first millisecond. Same reasoning as the
   *  worktree reconcile running awaited before restore. */
  healOrphansAtBoot(): void
  /** Subscribe to the manager's start/exit announcements. */
  attach(sessions: SessionManager): void
  /** app 'before-quit': close whatever survived dispose(). Idempotent. */
  closeOpenOnQuit(): void
}

export function createDispatchRecorder(storage: StorageService): DispatchRecorder
```

**Every method, and every storage call inside every method, is wrapped in `try/catch` that logs through the pino `logger` and returns.** This is the property the task doc calls the most important test in the work:

```ts
// Telemetry may LOSE a data point. It may never FAIL A LAUNCH. A dispatch row
// that fails to insert costs one sample; a dispatch row whose insert
// propagates costs the user a dead agent session. Structure the trade here,
// once, rather than trusting that SQLite never errors.
private safely(what: string, fn: () => void): void {
  try { fn() } catch (err) { logger.error({ err }, `[dispatch] ${what} failed; continuing`) }
}
```

**Open** happens on the `onStart` announcement, which fires only after `pty.spawn` has returned — so a throwing spawn leaves no permanently-open row. The row is built from what `spawn` already has:

```ts
{ id: randomUUID(), sessionId, projectId, taskId: null, agent, model, providerName,
  authMode, cwd, startedAt: new Date().toISOString(), endedAt: null, outcome: null,
  closedBy: null, exitCode: null,
  tokensIn: null, tokensOut: null, tokensCached: null, costUsd: null }
```

**Close** happens on the existing `onExit` announcement: look up the open dispatch by session id, read `sessions.wasKilledByChorus(sessionId)`, classify, close. **No open dispatch is a no-op, not an error** — sessions launched before this feature shipped have none.

---

## 5. `src/main/services/sessionManager.ts` — three additive changes

Nothing existing changes behaviour. Anchored by symbol.

**(a) A start announcement.** Alongside the existing `DataListener` / `ExitListener` / `RestoredListener` types and their `Set`s:

```ts
/** What a dispatch record needs and `spawn` already has. Deliberately a plain
 *  fact bundle, not a telemetry type: SessionManager announces lifecycle and
 *  stays ignorant of what listens. */
export interface SessionStartInfo {
  readonly sessionId: string
  readonly agent: AgentKind
  readonly cwd: string
  /** D42's discriminator, derived from the SAME fact composeChildEnv uses to
   *  select its policy: a credential is present, or it is not. */
  readonly authMode: 'subscription' | 'api_key'
  readonly model: string | null
  readonly providerName: string | null
}
type StartListener = (info: SessionStartInfo) => void
```

`onStart(listener: StartListener): void` mirrors `onData`/`onExit`. It is announced at the **end of `spawn`**, after the `child.onExit` wiring and immediately before `return session` — i.e. after the PTY exists and after the output pipeline is wired, so the announcement can never precede a working session. Derive the payload from what `spawn` holds:

```ts
    // Additive announcement (Task 3a-1). Defensive by construction: this is a
    // NEW loop, so wrapping it changes nothing that exists, and a throwing
    // listener must never be able to fail a launch.
    const startInfo: SessionStartInfo = {
      sessionId: id,
      agent,
      cwd: request.cwd,
      authMode: opts.credential ? 'api_key' : 'subscription',
      model: opts.route?.modelId ?? null,
      providerName: opts.route?.providerName ?? null
    }
    for (const listener of this.startListeners) {
      try { listener(startInfo) } catch (err) { logger.error({ err }, '[session] start listener threw') }
    }
```

**(b) End intent.** Add `killRequested: boolean` to the private `PtySession` interface, initialised `false` in the object literal built in `spawn`. Set it in `kill()` **before** `session.pty.kill()`:

```ts
  kill(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    if (session.status === 'exited') return
    // Set BEFORE the kill: the exit event can arrive immediately, and a flag
    // set afterwards is a race that misclassifies user kills as failures —
    // intermittently, which is the worst kind.
    session.killRequested = true
    session.pty.kill()
  }
```

and in `dispose()`'s loop, on the same line-of-reasoning, before `session.pty.kill()`.

**Why this is capturable at all:** `sessions.kill(...)` has **exactly one caller** in the codebase — the `IpcChannel.SessionKill` handler — and `dispose()` exactly one, the `before-quit` handler. Every renderer-initiated end (pane ✕, the Kill control, Restart's kill step) funnels through that single channel. Marking intent inside `kill()` therefore captures all of them without touching `ipc.ts`.

**(c) The read.** `wasKilledByChorus(sessionId: string): boolean` — `this.sessions.get(sessionId)?.killRequested ?? false`. The flag lives on the session record, so it dies with the record and leaks nothing (contrast the `restoredUnbadged` set, which is fine at its scale but is a second structure).

**What must NOT change:** the `onData` and `onExit` announce loops (unwrapped today; leave them), the restore contract, `snapshot()`, `attach()`, the `SessionOutput` construction and its position in the synchronous block, or `launch()`'s signature.

---

## 6. `src/main/index.ts` — wiring, and the two orderings that matter

Inside `app.whenReady().then(async () => {…})`, anchored by the existing calls:

```ts
  const vault = new CredentialVault(storage)
  logger.info(`[vault] safeStorage encryption available: ${vault.isAvailable()}`)

  // Task 3a-1: dispatch telemetry. Constructed here, healed BEFORE restore.
  const dispatches = createDispatchRecorder(storage)
  // No PTY survives an app restart, so every dispatch still open belongs to a
  // run that is already over — the same idea as F6 one layer up ("persisted
  // 'running' means WAS running when last observed"). Running this AFTER
  // restore would close the dispatches restore has just opened.
  dispatches.healOrphansAtBoot()
  dispatches.attach(sessions)
```

That block goes **after** the vault construction and **before** `void sessions.restore(project.id)`. Placing it before `registerIpc` is harmless; placing it after `restore` is a bug. `attach` may sit either side of `watchSessionExits(sessions)` — `exitListeners` is a `Set` and order within it is not contractual (the D11 status listener already relies on that).

And in the module-level `before-quit` handler:

```ts
app.on('before-quit', () => {
  sessions.dispose()
  dispatches.closeOpenOnQuit()   // AFTER dispose (some rows close via onExit),
  storage?.close()               // BEFORE the DB closes. Idempotent either way.
  storage = null
})
```

`dispatches` is currently scoped inside `whenReady` while `before-quit` is module-level — hoist it to a module-level `let dispatches: DispatchRecorder | null = null` beside the existing `let storage`, and null-guard the call. **Follow the existing `storage?.` idiom rather than inventing a second pattern.**

---

## 7. Verification — RUNTIME, not just build

Build checks (`npm run typecheck`, `npx vitest run`, `npm run grep:secrets`) are necessary and prove none of what follows.

### 7.1 The dump script — `_verify/3a-1/dump-v7.js`

Adapted from `_verify/3-6/dump-v6.js`, which is the working pattern on this machine. **One mandatory change:** 3-6's script does `SELECT * FROM credential_profiles`, which now means selecting Matthew's real encrypted key blob into a JSON file. Replace it with an explicit non-secret projection.

```js
// Migration v7 three-dump protocol (Task 3-2 / 3-6 pattern). READ-ONLY.
//   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe dump-v7.js <dbPath> <out.json>
// KNOWN FLAKE: intermittently writes no file on first run — retry once.
const Database = require('C:/Projects/ContactEstablished/Chorus/node_modules/better-sqlite3')
const fs = require('fs')

const out = {}
const db = new Database(process.argv[2], { readonly: true })
out.migrations = db.prepare('SELECT version, applied_at FROM schema_migrations ORDER BY version').all()
// F20 provenance: the coordinator checks this against 985d547b… / f47ac10b….
out.projects = db.prepare('SELECT id, name, root_path FROM projects ORDER BY created_at').all()
out.dispatchesDdl = db.prepare("SELECT sql FROM sqlite_master WHERE name IN ('dispatches','attention_spans','dispatches_open')").all()
out.dispatchColumns = db.prepare('PRAGMA table_info(dispatches)').all()
out.attentionColumns = db.prepare('PRAGMA table_info(attention_spans)').all()
for (const t of ['sessions', 'worktrees', 'pane_layouts', 'settings', 'provider_configs', 'dispatches', 'attention_spans']) {
  try { out[t] = db.prepare(`SELECT * FROM ${t}`).all() } catch (e) { out[t] = `unavailable: ${e.message}` }
}
// ⚠ NEVER `SELECT *` HERE. The dev vault holds a REAL, BILLABLE key. The blob
// LENGTH is sufficient evidence that a migration did not touch it, and a byte
// count is not key material.
out.credential_profiles = db.prepare(
  `SELECT id, provider_id, label, created_at, last_verified_at, unavailable_since,
          reencrypted_at, length(encrypted_blob) AS blob_len
     FROM credential_profiles ORDER BY created_at`
).all()
db.close()
fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 2))
```

### 7.2 The three dumps

```
New-Item -ItemType Directory -Force _verify\3a-1 | Out-Null
$env:ELECTRON_RUN_AS_NODE = '1'
& node_modules\electron\dist\electron.exe _verify\3a-1\dump-v7.js "$env:APPDATA\chorus\chorus.db" _verify\3a-1\pre.json
```

Then: cold boot the app (v7 applies) → tree-kill → dump `post.json` → cold boot again → tree-kill → dump `boot2.json`. Assert and **quote**:

1. `schema_migrations` **6 → 7**, in place. v1–v6 `applied_at` **byte-identical** pre/post. Known-good anchors: v4 `2026-07-20T16:57:49.534Z`, v5 `2026-07-23T13:04:06.301Z`, v6 `2026-07-24T15:52:22.591Z`.
2. `projects`, `sessions`, `worktrees`, `pane_layouts`, `settings`, `provider_configs` **row-identical** across pre / post / boot-2; `credential_profiles` identical over the non-secret projection **including `blob_len`**.
3. `PRAGMA table_info(dispatches)` matches §2.1 column-for-column, in order and type; same for `attention_spans`; the `dispatches_open` index exists.
4. Both new tables are **empty** in `post.json` before any session is launched.
5. v7's `applied_at` is **byte-identical** between `post.json` and `boot2.json` — not re-applied.
6. The standing `wt-24b5c1fe` worktree row is present and unchanged.

**⚠ `sqlite3` is not installed.** This script pattern is the only route. **⚠ F20:** quote `projects`; a dump showing `a43b395d…`/`b684e96e…` describes the redirected DB and discharges nothing.

### 7.3 The F28 re-drive (Commit 1)

In a fresh PowerShell:

```
$env:TERM = 'dumb'; npm run dev
```

Launch codex through the real window. Report two things:

1. **The render.** Screenshot the TUI. Under the bug it emits the interleaved shape (`-  a  p  i  0  3  -  K  7 …`); under the pin it renders normally — box drawing, unicode, colour. The Task 3-5 coordinator's structural comparison is the standard.
2. **The child's environment, read from OUTSIDE the app.** `_verify/3-6/read-env.ps1` is kept harness for exactly this; its PEB offsets were established the hard way on this Win11 build (roadmap §5: `EnvironmentSize` is not at the documented `0x3F0`; `ProcessParameters` is at PEB+0x20, not +0x10; the script scans for the double-null terminator). Expected: `TERM=xterm-256color`, `COLORTERM=truecolor`. Walk the tree from the electron main PID via `ParentProcessId` — **never name-match**, there are ~16 unrelated `claude.exe` on this machine.

Then re-drive **at least one Task 3-5 scrubber item** against the pinned seam using `_verify/3-5/probe.js` (booleans and counts only, never the value), with a **planted fake value**. Item 2 — the ring buffer holds `[REDACTED-CREDENTIAL]` and the value is absent — is the cheapest and most load-bearing.

### 7.4 The dispatch runtime drive (G2)

Quote the row after each step.

| # | Drive | Expect |
|---|---|---|
| 1 | Launch a session | one row: `session_id` matching, `agent` right, `started_at` set, `ended_at`/`outcome`/`closed_by` NULL, all four token/cost columns NULL |
| 2 | Let it exit on its own | closed with the code-derived outcome, `closed_by='exit'`, real `ended_at` |
| 3 | Press Kill | `abandoned` / `kill` — **not** `failed`, despite the non-zero Windows code |
| 4 | **Close the pane fully** (kill → awaited exit → leaf removed → delete) | `session:delete` **does not throw**; the `sessions` row is gone; the dispatch **survives** with a dangling `session_id` |
| 5 | Restart the app so restore relaunches | a **second** dispatch under the **same** session id; the first untouched |
| 6 | `taskkill /PID <root> /T /F` mid-session, then boot | orphan closes `abandoned` / `boot-heal`, `ended_at` **NULL**; a third boot leaves it alone |
| 7 | Instrument the recorder to throw on open, cold-boot | the session still launches and attaches; the failure is logged; **then revert and prove the revert against the COMMIT DIFF**, not the worktree (Task 2-4 precedent) |

Step 4 is the single most important check in the task: it is the enforced-FK invariant proven against reality rather than asserted in a comment.

### 7.5 Grep gates

```
npm run grep:secrets
```

Plus, quoted in the summary:

- `REFERENCES` in the v7 migration string — **zero hits**.
- `powerMonitor` across `src/` — **zero hits**.
- `usage_records` across `src/` — **zero hits**.
- `ipcMain.handle(` in `src/main/ipc.ts` — still **31**.
- `git diff --stat` for commit 2 touching only the six scope files; `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/ipc.ts` and `src/renderer/**` all absent from both commits.
- `git status --porcelain` still showing `TASK-3-5-REVIEW-FABLE.md` and `TASK-3-6-REVIEW-FABLE.md` as untracked and unmodified.

### 7.6 Harness reminders

electron-vite does **not** hot-restart the main process — every check here needs a real cold boot. Kill process **trees**; the graceful-quit test is `taskkill` without `/F`. CDP on `--remote-debugging-port=9222`. `ELECTRON_RUN_AS_NODE` scripts print nothing to a console — write to a file, and retry once if no file appears. Vite's SPA fallback will happily return `index.html` from a page-side `fetch('some.txt')` — if a fixture is ever loaded that way, use `fetch('/@fs/C:/absolute/path')` (this cost a full milestone launch on the wrong value during Task 3-6).

---

## 8. What this task deliberately leaves undone

Recorded so the next session does not read absence as oversight.

- **Token and cost values.** Columns declared, always NULL. Producer: Task 3a-3 (per-dispatch OpenRouter keys with a hard limit, minted and revoked around the dispatch — D42). **Its writes land on the row this task created**, which is the entire point of building it this way.
- **Attention.** Table created, empty, no writer, no `powerMonitor`, no focus listener. Task 3a-2. Spec open question 3 (_"Is focus-plus-idle a good enough attention proxy?"_) is explicitly unresolved and this task does not pre-empt it.
- **`task_id`.** Column exists, always NULL — there is no seed. Spec phase 1.
- **Anything derived.** No readiness, fan-out, critical path, float, estimate, projection, velocity or gate. Spec §6 is emphatic: _"Everything below is computed on read."_ This task stores facts only.
- **Retention.** Spec open question 6 is open. No pruning, no aging, no cap.
- **Provider/profile identity as a stable key.** `provider_name` records the route's name at dispatch time; a stable id arrives with `launch_profiles`, added by the phase that creates that table.
- **The other four Phase 3a kickoff questions** (the two new PTY adapters and D34 Q5's frozen registry; the model precedence order; restore option (a); the OpenRouter multi-turn proof; `ANTHROPIC_BASE_URL`). This task answers **only** the `TERM` one, as **D54**.

# Phase 3e — Council Deliberation Quality — Task Overview

**Kicked off 2026-07-28** against the verified codebase at `0ac1f3e`. The phase was created
2026-07-26 to give the Phase 3b residual an owner; see the roadmap §7 entry for why it exists.

## Why this phase is not what its scope note says any more

The roadmap scoped 3e as **"tuning and measurement over a shipped, working feature — no new
milestone capability, no schema, and (with one exception below) no new surface"**.

**⚠ TWO OF MATTHEW'S KICKOFF DECISIONS BREAK THAT, DELIBERATELY, AND THE WIDENING IS DECLARED HERE
RATHER THAN DISCOVERED MID-PHASE** — the same discipline D74 and D80 used in Phase 3c:

- **D95 makes F41 "task work"**, which the scope note itself flagged as *"the only item here that
  touches a surface outside the council files"*. It does.
- **D97 builds the transcript reader**, which is **a new surface and a new IPC channel**. The scope
  note did not anticipate it because the previous framing was "give it a reader **or** justify the
  absence in writing", and Matthew chose the reader.

**The phase is therefore tuning + measurement + two bounded features.** Everything else in the
scope note holds: **no schema change, no migration**, and the deliberation protocol itself stays
closed (D67; re-opening it is a new CR, not a tuning pass).

## Verified ground facts — checked 2026-07-28 at `0ac1f3e`

Every number below came from a command run this session. **Nothing is inherited from the roadmap
on trust.**

| Fact | Where | Value |
|---|---|---|
| Stream byte cap | `services/apiSession.ts:129` | `RESPONSE_CAP_BYTES = 4_000_000` |
| Cap applied as default | `apiSession.ts:199` | `deps.maxResponseBytes ?? RESPONSE_CAP_BYTES` |
| **The cap-hit path DISCARDS the byte count** | `apiSession.ts:362–368` | `totalBytes += …; if (totalBytes > maxResponseBytes) { … refuse(tooLarge); return }` — **`totalBytes` is never logged, returned, or attached to the refusal** |
| Mint cap | `services/councilService.ts:137` | `COUNCIL_MINT_LIMIT_USD = 10.0` |
| Output ceiling | `councilService.ts:201` | `MAX_OUTPUT_TOKENS_CEILING = 32_000` |
| Per-turn deadline | `councilService.ts:241` | `COUNCIL_TURN_TIMEOUT_MS = 15 * 60 * 1000` |
| Dissent heading, both branches | `services/councilCore.ts:706`, `:711` | each returns a string beginning `## Dissents preserved` |
| Detection path type | `councilCore.ts:524` | `type DetectionPath = 'structural' \| 'model-judged'` |
| `getCouncilMessagesForRun` | `services/storage.ts:1819` | **zero callers** outside `storage.ts` and tests |
| `deleteCouncilRun` | `storage.ts:1802` | **zero callers** |
| Attention classes | `services/attentionCore.ts:41` | `'pane' \| 'overhead' \| 'blurred' \| 'idle' \| 'locked'` |
| The F41 rule as shipped | `attentionCore.ts:73` | *"3b-4 added `council`. Everything that is not the workspace is `overhead`."* |
| `council_members` rows | real DB | **0 — the D71 roster is GONE** |
| Credential profiles | real DB | 3 OpenRouter profiles, `unavailable_since` null on all three; two carry `last_verified_at` |
| The comparability brief | `CouncilBriefs/CouncilBrief-3b.0-ApiSessionProducer.md` | present — the brief all four existing data points used |
| Baseline | — | typecheck **0** · vitest **1007/1007 across 30 files** · `grep:secrets` clean · `IpcChannel` **57** · `ipcMain.handle(` **52 / 0** · `sqliteTable(` **16** · `MIGRATIONS.length` **12** |

**⚠ THE THIRD ROW IS THE MOST IMPORTANT FACT IN THIS DOCUMENT.** F39 asks whether kimi is
pathological or the 4 MB cap is simply too small for a model that streams its chain of thought.
**That question cannot be answered by running the app as it stands**, because the one number that
would answer it — how many bytes kimi had streamed when the cap fired — is computed, compared, and
thrown away. **The phase's first code change is an INSTRUMENT, not a fix.**

## Decisions settled at kickoff

### D95 — council time is TASK WORK, not overhead *(Matthew, 2026-07-28)*

`attentionCore.classify()` currently credits every non-workspace view to `overhead`, so a
~14-minute council run contributes **nothing** to the task it was run for. **Matthew's ruling: that
understates what a task cost, and a paid deliberation about a task is effort toward it.**

- **⚠ THIS IS TIME-SENSITIVE AND THAT IS WHY IT IS IN THIS PHASE.** Per **D50**, actuals cannot be
  backfilled: every run that happens under the old rule is permanently mis-attributed. The decision
  is cheap now and unrecoverable later.
- **⚠ IT DOES NOT REVERT D70, AND MUST NOT BE IMPLEMENTED AS IF IT DID.** D70 ratified
  `!== 'workspace'` on the reasoning that *no pane is mounted* is what makes a view overhead — a
  property true of every future view **by construction**, which is why it cannot be forgotten the
  way a list can. **That reasoning is still correct for `settings`.** What changes is that the
  council view is not merely "not the workspace" — it is a view that is **doing paid work on a
  named project**, which `settings` never is. The rule becomes *"a view with no pane mounted is
  overhead **unless it is itself performing work attributable to a project**"*, and the council
  view is the only such view today.
- **⚠ IT NEEDS A PROJECT ID AND THE CREDIT MUST BE REFUSED WITHOUT ONE.** `CouncilView` already
  receives `projectId` and it is nullable. **A run with no project credits `overhead` exactly as
  today** — inventing an attribution is the D76 failure at the telemetry layer, and D55's rule that
  a number without its denominator is worse than no number applies to a mis-attributed minute too.

### D96 — F39 is measured by ADDING AN INSTRUMENT, never by raising the cap on a guess *(coordinator, 2026-07-28)*

The roadmap's own words: *"Measure before touching the constant — a cap raised on a guess is how
an unbounded stream gets re-authorised, and D63(e) put that bound there on purpose."*

**The instrument is a log line at the refusal carrying `totalBytes`, plus the same figure for
turns that SUCCEED.** One number alone does not answer the question: "kimi hit 4 MB" is compatible
with both hypotheses. **"Kimi hit 4 MB while the largest successful turn in the same run was
180 KB" says pathological; "kimi hit 4 MB while the arbiter's successful synthesis was 3.6 MB"
says the cap is too small for this roster.** The comparison is the measurement.

- The instrument **must not change any bound**: `RESPONSE_CAP_BYTES` stays `4_000_000` through
  Task 3e-1. Task 3e-2 may move it, and only on the number 3e-1 produces.
- **It must not log content.** A byte count and a member label; never a fragment of the stream —
  the scrub seam exists precisely because model output can carry a credential.

### D97 — the transcript gets the reader the mock already draws *(Matthew, 2026-07-28)*

`council_messages` is written on every run and has **never been read**. At **~$0.83 and ~14
minutes** per run, that is an expensive artifact nobody can re-open. **`docs/design/v2/Chorus
Council.dc.html` already draws the reader** — a `findings | transcript · 13 turns` toggle in the
findings panel header — so this is not a new design question.

- **⚠ IT IS A DECLARED EXCEPTION TO THE PHASE'S "no new surface" SCOPE, AND TO 3c's FROZEN CHANNEL
  COUNT.** Bounded: **one channel** (`council:transcript`), **one handler**, **read-only**, **no
  schema change**, `MIGRATIONS.length` stays **12** and `sqliteTable(` stays **16**.
- **⚠ RETENTION IS PART OF THE SAME DECISION, NOT A FOLLOW-UP.** `deleteCouncilRun` has no caller
  and nothing prunes. A reader that makes runs re-openable forever, over a table nothing deletes,
  trades one problem for a slower one. **3e-4 must either wire a retention path or state a bound in
  writing** — a store with no delete path is a decision, and it has now been inherited across four
  tasks.

### D98 — the measurement re-uses the SAME brief, verbatim *(coordinator, 2026-07-28)*

`CouncilBrief-3b.0-ApiSessionProducer.md`. **Four data points already exist against it** (external
Cursor council · Chorus cheap roster @700 · Chorus real roster @16,000 · Chorus real roster
@32,000), and F38's *4 of 6 questions falling to `model-judged`* was measured on it. **A
re-measurement on a different brief measures a different thing and discharges nothing.** The brief
is not edited, not shortened, not "modernised".

## Tasks

Four tasks. **Dependency chain: 3e-1 → 3e-2. 3e-3 and 3e-4 are independent of both and of each
other**, so they may run in any order relative to the measurement.

| Task | Scope | Depends on |
|---|---|---|
| **[3e-1](Task-3e-1.md)** | **The instrument, the roster, and the measurement.** Add the byte-count diagnostic (D96); rebuild D71's four-member roster; run the council on D98's brief; write down verdict-token compliance and F39's byte comparison **whatever they say**. Also discharges the streaming proof Phase 3c-5 left UNPROVEN. | — |
| **[3e-2](Task-3e-2.md)** | **The fixes the measurement licenses.** F40's duplicated `## Dissents preserved` heading; the noisy dissent matcher; and F39's resolution — raise the cap **or** drop the member, decided by 3e-1's number and by nothing else. | **3e-1** |
| **[3e-3](Task-3e-3.md)** | **D95 — council time becomes task work.** `attentionCore.classify()` gains one branch; the council view's `projectId` becomes the attribution. Refuses to credit when there is no project. | — |
| **[3e-4](Task-3e-4.md)** | **D97 — the transcript reader**, plus the retention answer. One read-only channel, the mock's findings/transcript toggle. | — |

## The purity contract for this phase

- **No schema change and no migration.** `MIGRATIONS.length` stays **12**, `sqliteTable(` stays
  **16**. Any task that wants one has left its scope.
- **Exactly ONE channel may be added, in Task 3e-4 only** (`council:transcript`), taking
  `IpcChannel` **57 → 58** and `ipcMain.handle(` **52 → 53**. Every other task holds at 57 / 52.
  `ipcMain.handle(` in `index.ts` stays **0**.
- **The deliberation protocol is closed.** D67 ruled it and CR-3b.1 is closed. **Nothing in this
  phase changes how members are prompted, in what order, or what the arbiter is asked** — except
  where 3e-2 changes a *heading string* or the synthesis prompt's instruction about one, which is
  the narrow lane F40's fix is confined to.
- **⚠ The unconditional dissent append is NOT the thing to remove.** `councilCore` appending a
  dissent section unconditionally **is the whole enforceability argument** (D67 Q5 ruling 5C as
  corrected). Deleting it hands dissent preservation back to the arbiter's goodwill, which is 5A
  and was explicitly rejected. **F40's fix lands on the core's heading or the synthesis prompt,
  never on the append.**
- **No test may be edited to accommodate a change.** Baseline **1007 across 30 files**, and the
  rule is **"never fewer"**.

## Cost, and the envelope stated before the first run

**Matthew authorised ~$4.00 on 2026-07-28.** At D71's dials a full frontier run is **~$0.83 and
~14 minutes**, so the envelope is roughly **four runs**.

| Task | Runs | Envelope |
|---|---|---|
| 3e-1 | 1 (2 only if the first is refused before producing a document) | ~$0.83–$1.70 |
| 3e-2 | 1, to prove the fixes on a real run | ~$0.83 |
| 3e-3 | 0 | $0.00 |
| 3e-4 | 0 — it reads a run 3e-1 already paid for | $0.00 |

**⚠ REPORT A BOUND, NOT A TIDY FIGURE.** F39 means `kimi-k3` contributes **no `usage` block**, so
Chorus's own reported cost **under-reports the truth** whenever it participates. **Check the
measured figure against OpenRouter's own billing page, not only against Chorus's number** — and
say which one you are quoting.

**⚠ STATE THE ENVELOPE BEFORE THE FIRST RUN AND MEASURE AGAINST IT** (3b-1's standing lesson). A
task that discovers its spend afterwards has not managed it.

## Gates

- **G1** `npm run typecheck` exits 0.
- **G2** **Run it, don't just compile it.** For 3e-1 and 3e-2 that means a real council run; for
  3e-3 and 3e-4, the running app over CDP.
- **G3** One narrated commit per task.
- **G4** `npm run grep:secrets` clean across 6 patterns.
- **G5** Council review checkpoint — **not triggered.** This phase makes no security, schema or
  protocol decision: D96 adds a diagnostic, D95 is a classification, D97 is a read path over a
  table that already exists. Recorded so the absence is deliberate.

## What this phase inherits from Phase 3c-5, and must not lose

**The council's streaming path is UNPROVEN.** 3c-5 restyled `CouncilView` and could not re-verify
that a run streams into it, that Esc refuses to leave mid-run, or that the findings file lands —
because `council_members` was empty and rebuilding the roster belonged here. The code paths are
unchanged (`stores/council.ts`, `councilCore.ts`, `councilService.ts` all had an empty 3c-5 diff),
**but "unchanged code" is an argument, not evidence.** **Task 3e-1's run is the evidence**, and its
report must tick those three boxes explicitly.

## Milestone

Verdict-token compliance is **re-measured on the frontier roster and the number is written down
whatever it says**; **F39 is resolved by measurement rather than by guess**; **F40 is closed**;
**D95 and D97 are implemented**; and the transcript store has **both a reader and a stated
retention position**.

**⚠ The milestone is met even if the measurement says the structural arm still fails.** The
deliverable is a number and a decision taken on it — not a particular number. A phase that only
closes when the answer is convenient is not a measurement phase.

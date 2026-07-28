# ImplementationSpec 3e-4 — The Transcript Reader and the Retention Answer (D97)

**Normative for:** [`../Tasks/Task-3e-4.md`](../Tasks/Task-3e-4.md).

## 1. The channel

**One** channel, `council:transcript`, request → response, **read-only**.

- **Request:** a run id. Validate it as an id, not as free text.
- **Response:** the run's messages in stored order — member id, phase, round, text — plus enough to
  render the header's denominator (**the turn count**).
- **Zod on both sides, in MAIN only.** ⚠ **Never import Zod into the preload** — it throws
  `EvalError` under the app's CSP and silently drops events. This is a standing repo fact, not a
  style preference.
- **⚠ The response must be a PLAIN object** (D14). Rows out of `better-sqlite3` already are; keep
  them that way and do not decorate them with anything reactive.

**⚠ SIZE IS A REAL CONCERN AND MUST BE BOUNDED HERE, NOT DISCOVERED LATER.** A frontier run's
transcript reached **45,718 bytes** of *findings* alone (D71); the raw transcript is larger — 13
turns of full model output. **State a cap on the response and refuse beyond it**, the way every
other bounded read in this codebase does, rather than letting an arbitrarily large payload cross
the bridge. If a run exceeds the cap, return what fits **and say so in the payload** — a truncated
transcript that admits truncation is honest; one that does not is worse than no reader.

## 2. The handler

`getCouncilMessagesForRun` already exists at `storage.ts:1819` and has never been called. **Call
it. Do not write a second query** — a second read path over the same table is exactly the two-homes
hazard this codebase keeps ruling against.

The handler validates, reads, bounds, returns. **No mutation of any kind.**

## 3. Store state — separate from the live transcript

**⚠ THIS IS THE MOST DANGEROUS PART OF THE TASK AND IT IS NOT OBVIOUS.** `stores/council.ts`
carries `messages`, which the **live broadcast** appends to, and whose block identity is keyed on
`(member, phase, round)` — **F37's fix, after a live run rendered 291 fragments where 8 turns
belonged**.

**Do not load a historical transcript into `messages`.** It would:

- collide with a live run's blocks if one is in flight,
- and put historical rows through the delta-append path, which is not what they are.

**Use a separate piece of state** — a distinct field for the historical transcript, cleared when
the view closes. The live path keeps its own state, its own grouping, and its own test.
**`stores/council.test.ts`'s F37 regression test must stay green and unedited**; if it goes red,
grouping was disturbed and the fix is to back out, not to adjust the test.

## 4. The toggle

The mock draws it in the findings panel header:

```
FINDINGS   [ findings | transcript · 13 turns ]
```

— a two-segment control, the inactive segment quieter, the count carrying its noun. 3c-5 built
`.cn-panel-head` with an eyebrow and a right-hand slot; **put it there and reuse the existing
tokens.** No raw hex, no stock Tailwind palette utility.

- **`transcript · N turns` carries its denominator by construction** — do not render a bare `N`.
- Selecting `transcript` renders the historical rows in the **same turn treatment** the live view
  uses (`.cn-turn`), so one vocabulary describes both.
- **⚠ No verification chrome, and the standing caveat still governs the findings pane.** Switching
  tabs must not move the caveat out of view above the synthesis — invariant 2 of Task-3c-5, still
  binding.

## 5. The retention answer — required, not optional

`deleteCouncilRun` has **no caller** and nothing prunes `council_messages`. A reader makes runs
re-openable forever over a table nothing deletes.

**Ship one of these and record it in the roadmap:**

- **(a) A wired path** — the simplest honest one is a bound on retained runs (keep the most recent
  N, purge the rest through the **existing** `deleteCouncilRun`, which already purges messages in
  one transaction). ⚠ If you take this, **N is a decision, not a detail** — put it in the commit
  message with the reasoning, and note that a purge is **irreversible** and deletes something the
  user paid for.
- **(b) A written bound** — a stated position that runs are kept indefinitely on purpose, with the
  growth arithmetic done (bytes per run × runs per week) so the next reader can see it was
  measured, not assumed.

**⚠ (b) IS A LEGITIMATE ANSWER AND MUST NOT BE TREATED AS THE LAZY ONE** — the roadmap's own words
are *"give it a reader or justify the absence in writing"*, and a store with no delete path **is a
decision**. What is not acceptable is silence, which is what the last four tasks inherited.

## 6. Verification

```bash
npm run typecheck && npx vitest run && npm run grep:secrets
grep -oE "^\s+[A-Za-z]+: '[a-z0-9:-]+'" src/shared/ipc.ts | wc -l   # 58
grep -c "ipcMain.handle(" src/main/ipc.ts                           # 53
grep -c "sqliteTable(" src/main/db/schema.ts                        # 16
```

**Runtime (G2), over CDP:** open a past run's transcript from the toggle; confirm turns render as
turns; confirm the live path still groups correctly by starting nothing and switching back to
`findings`. **Cost `$0.00`** — this task reads a run 3e-1 already paid for.

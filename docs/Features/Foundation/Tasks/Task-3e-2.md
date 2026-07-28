# Task 3e-2 — The Fixes the Measurement Licenses

**Phase:** 3e · **Task 2 of 4** · **Depends on:** **3e-1 — hard.**

## Source Of Truth

- [`Phase-3e-Overview.md`](Phase-3e-Overview.md) — the purity contract and **the rule that F40's
  fix may not touch the unconditional append**.
- `../ImplementationSpecs/ImplementationSpec-3e-2.md`.
- **`docs/Features/Foundation/Investigations/3e-1-Measurement.md`** — **this task's actual input.**
  If it does not exist, this task is not startable.

## Initial Starting Point (verified 2026-07-28 at `0ac1f3e`)

- `src/main/services/councilCore.ts:706` — the no-dissents branch returns a string opening
  `## Dissents preserved`.
- `councilCore.ts:711` — the populated branch returns the same heading.
- `councilCore.test.ts:619`, `:639`, `:915`, `:927` — four existing assertions reference the
  heading or the prompt that names it. **They are the guard rails; expect to read them before
  touching anything.**
- `src/main/services/apiSession.ts:129` — `RESPONSE_CAP_BYTES = 4_000_000`.

## Goal

Close **F40** (the duplicated `## Dissents preserved` heading), reduce the dissent matcher's noise,
and **resolve F39 the way 3e-1's evidence licenses and no other way**.

## Exact Scope

**Edit:** `src/main/services/councilCore.ts` · `councilCore.test.ts` · and **conditionally**
`src/main/services/apiSession.ts` (only for F39, only per §4.2 of ImplementationSpec-3e-1).

## Non-Goals

- **⚠ DO NOT REMOVE THE CORE'S UNCONDITIONAL DISSENT APPEND.** It is D67 Q5 ruling 5C as
  corrected, and **it is the entire enforceability argument**: deleting it hands dissent
  preservation back to the arbiter's goodwill, which is ruling 5A and was explicitly rejected.
  **The fix lands on the core's heading string or on the synthesis prompt's instruction — never on
  the append.**
- **⚠ DO NOT MOVE A CONSTANT ON A HUNCH.** If 3e-1's record lands in the "pathological" or "did not
  reproduce" row, `RESPONSE_CAP_BYTES` **does not move**, however tempting.
- **Do not change the deliberation protocol** — who is prompted, in what order, with what role.
- **Do not "fix" the dissent matcher by suppressing dissents.** See spec §2.
- No IPC, schema, or migration. 57 / 52 / 0 / 16 / 12 frozen.

## Dependencies

**3e-1, hard.** Two of the three items here are decided by its numbers. Starting without them
means guessing, which is the failure mode this phase was created to avoid.

## Step-by-step Work

1. **Read `3e-1-Measurement.md` first** and quote, in your report, the row of
   ImplementationSpec-3e-1 §4.2 that F39 landed in.
2. **F40** — spec §1.
3. **The dissent matcher** — spec §2.
4. **F39** — spec §3. May be a no-op; a no-op with a written reason is a valid outcome.
5. **One real run** to prove the document changed the way the fix predicted.

## Test Expectations

- The four existing `councilCore.test.ts` assertions must still pass, or the change is out of
  scope. **⚠ If one must change, that is a stop-and-report**, not an edit — those assertions encode
  D67's ruling.
- New cases: exactly one `## Dissents preserved` heading in a rendered document, in both the
  populated and the empty branch.

## Verification Commands

```bash
npm run typecheck && npx vitest run && npm run grep:secrets
```

```bash
# In a rendered findings document from the proving run:
grep -c "^## Dissents preserved" <findings.md>      # expect exactly 1
```

## Acceptance Criteria

- [ ] Gates green; vitest **≥ 3e-1's figure**, never fewer, no existing assertion weakened.
- [ ] A rendered document from a **real run** contains **exactly one** `## Dissents preserved`.
- [ ] **The unconditional append is still there**, and the report says where the fix landed instead.
- [ ] F39 resolved **by evidence**: either a constant moved with 3e-1's number quoted in the commit
      message, or a written statement of why nothing moved.
- [ ] Cost stated against the envelope, as a bound.

## Review Checklist

1. **`git diff` on `councilCore.ts` does not delete the append.** Look for it specifically.
2. **The four pre-existing assertions are untouched.**
3. **If a constant moved, the commit message quotes the measured byte figure it moved on.** A
   constant that moves without a number in its justification is exactly what D63(e) forbids.
4. **The dissent matcher change did not reduce noise by dropping real dissents** — spec §2's
   distinction.

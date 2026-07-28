# Task 3e-1 — The Instrument, the Roster, and the Measurement

**Phase:** 3e — Council Deliberation Quality · **Task 1 of 4** · **Depends on:** none.

## Source Of Truth

- [`Phase-3e-Overview.md`](Phase-3e-Overview.md) — **D96** (instrument, never a guessed cap),
  **D98** (the same brief, verbatim), the purity contract, the cost envelope.
- `../ImplementationSpecs/ImplementationSpec-3e-1.md` — normative.
- Roadmap §7 Phase 3e — **F38**, **F39**, and the "measurement first" ordering.
- `docs/Features/Foundation/CouncilBriefs/CouncilBrief-3b.0-ApiSessionProducer.md` — **the** brief.

## Initial Starting Point (verified 2026-07-28 at `0ac1f3e`)

- `src/main/services/apiSession.ts:129` — `RESPONSE_CAP_BYTES = 4_000_000`.
- `apiSession.ts:362–368` — the cap-hit path. `totalBytes` is accumulated, compared, and then
  **discarded**: `refuse(API_SESSION_FAILURE.tooLarge)` carries no size.
- `src/main/services/councilCore.ts:524` — `DetectionPath = 'structural' | 'model-judged'`.
- **`council_members` has zero rows.** The three OpenRouter credential profiles survive and two
  carry `last_verified_at`.
- Baseline: typecheck **0** · vitest **1007/1007 across 30 files** · `IpcChannel` **57** ·
  `ipcMain.handle(` **52 / 0** · `sqliteTable(` **16** · `MIGRATIONS.length` **12**.

## Goal

Produce the two numbers Phase 3e exists to obtain, and write them down whatever they say: **(1)**
how many of the brief's questions are resolved by a **structural** verdict-token read versus
falling through to **`model-judged`**, measured on the frontier roster rather than the cheap one;
and **(2)** the byte count `kimi-k3` reaches when the 4 MB cap fires, **beside** the byte counts of
the turns that succeeded in the same run — because one figure alone cannot distinguish "this model
is pathological" from "this cap is too small for this roster", and those have opposite fixes.

## Exact Scope

**Edit:**
- `src/main/services/apiSession.ts` — the diagnostic only (D96).
- `src/main/services/apiSession.test.ts` — cases covering the diagnostic.

**Create:**
- `docs/Features/Foundation/Investigations/3e-1-Measurement.md` — the record.

**Configure (not code):** the four council members, through the app's own
`council-member:create` channel — **never SQL**, the same discipline D71 used.

## Non-Goals

- **⚠ DO NOT CHANGE `RESPONSE_CAP_BYTES`, `MAX_OUTPUT_TOKENS_CEILING`, `COUNCIL_MINT_LIMIT_USD`
  or `COUNCIL_TURN_TIMEOUT_MS`.** This task measures. **3e-2** moves a constant, on this task's
  number and on nothing else.
- **Do not fix F40, the dissent matcher, or anything the measurement reveals.** Record it.
- **Do not touch the deliberation protocol** — prompts, ordering, roles, rounds.
- **Do not edit the brief** (D98). Not shortened, not modernised, not re-titled.
- **Do not log stream content.** A byte count and a member label; never a fragment.
- **No IPC channel, handler, table or migration.** 57 / 52 / 0 / 16 / 12 frozen.
- **Do not revert or commit unrelated working-tree changes.**

## Dependencies

None. **⚠ But it has a PRECONDITION the implementer cannot satisfy alone:** a working OpenRouter
credential must be present and decryptable. Two of the three profiles carry `last_verified_at`; if
the run refuses on credentials, **stop and report** — re-entering a key is Matthew's action, never
the implementer's.

## Step-by-step Work

1. **Add the instrument** (spec §1). Land it and run the gates before spending anything.
2. **Rebuild D71's roster through the app** — four members on the standing OpenRouter route:
   `moonshotai/kimi-k3` (member), `z-ai/glm-5.2` (member), `qwen/qwen3-coder` (member),
   `anthropic/claude-opus-5` (**arbiter**). `params_json`: **arbiter 32,000, the three members
   16,000** — D71's measured asymmetry, not a guess.
   **⚠ Re-check each model id against OpenRouter's live `/models` before creating the member.** The
   F32 instrument is free and unauthenticated; an id that has been retired since 2026-07-26 turns a
   $0.83 run into a refusal.
3. **State the envelope in the report BEFORE the run.**
4. **Run the council on D98's brief.**
5. **Read the numbers out of the run** — the detection-path split per question, and the byte
   figures from the instrument.
6. **Write `3e-1-Measurement.md`** — the numbers, the comparison, and what each licenses 3e-2 to
   do. **No fix.**
7. **Tick the three streaming boxes Phase 3c-5 left UNPROVEN** (below).

## Test Expectations

**New unit cases for the diagnostic only** — that the refusal carries the byte count, and that a
successful turn reports one. **1007 → more, never fewer, and no existing test edited.**

**There is no unit test for the measurement itself, and that is correct:** it is an observation of
a live system, not a property of the code.

## Verification Commands

```bash
npm run typecheck && npx vitest run && npm run grep:secrets
```

```bash
grep -n "RESPONSE_CAP_BYTES = " src/main/services/apiSession.ts    # must still read 4_000_000
grep -oE "^\s+[A-Za-z]+: '[a-z0-9:-]+'" src/shared/ipc.ts | wc -l  # 57
grep -c "ipcMain.handle(" src/main/ipc.ts                          # 52
grep -c "sqliteTable(" src/main/db/schema.ts                       # 16
git diff --stat docs/Features/Foundation/CouncilBriefs/            # EMPTY — D98
```

## Acceptance Criteria

- [ ] Gates green; vitest **≥ 1007** across **≥ 30** files, none edited.
- [ ] Frozen numbers unmoved: 57 / 52 / 0 / 16 / 12, and **`RESPONSE_CAP_BYTES` still 4,000,000**.
- [ ] The roster is four members, created **through the app**, and the report names each id with
      the date its existence was re-checked against `/models`.
- [ ] **Verdict-token compliance is written down as `N of M` questions structural** — with the
      denominator, per D55 — **whatever N is**.
- [ ] **F39's comparison is written down**: kimi's byte count at the cap, beside the largest
      successful turn's byte count in the same run, and a stated read of which hypothesis it
      supports.
- [ ] Cost stated against the envelope, **as a bound**, with a note on whether the figure is
      Chorus's or OpenRouter's billing page.
- [ ] **The three inherited 3c-5 boxes are ticked or explicitly marked UNPROVEN:** a run streams
      into the restyled view · Esc refuses to leave mid-run · the findings `.md` lands beside the
      brief.

## Review Checklist

1. **No constant moved.** `git diff` on `apiSession.ts` shows a diagnostic and nothing else.
2. **No stream content in any log line.** Read every line the instrument can emit.
3. **The brief is byte-identical.**
4. **The measurement is reported with denominators**, and the F39 read is stated as a *reading of
   evidence*, not as a conclusion the numbers do not support.
5. **If the number is bad, it is still written down.** A measurement task that quietly re-runs
   until the answer improves has produced nothing.

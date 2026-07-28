# Task 3e-3 — Council Time Becomes Task Work (D95)

**Phase:** 3e · **Task 3 of 4** · **Depends on:** none.

## Source Of Truth

- [`Phase-3e-Overview.md`](Phase-3e-Overview.md) — **D95** in full, including what it does *not*
  revert.
- `../ImplementationSpecs/ImplementationSpec-3e-3.md`.
- Roadmap §6 **D70** — the ruling this amends, and the reasoning that must survive.
- Roadmap §6 **D50** — why this is time-sensitive.

## Initial Starting Point (verified 2026-07-28 at `0ac1f3e`)

- `src/main/services/attentionCore.ts:41` —
  `type AttentionClass = 'pane' | 'overhead' | 'blurred' | 'idle' | 'locked'`.
- `attentionCore.ts:73` — the comment that is the shipped rule: *"3b-4 added `council`. Everything
  that is not the workspace is `overhead`."*
- `attentionCore.ts:56–80` — `AttentionInputs`, described in its own comment as *"the exact set of
  facts the runtime proof has to be able to force, and anything not here cannot influence the
  number"*. **`rendererView` is there; there is no council project id.**
- `attentionCore.ts:89` — *"FIRST MATCH WINS, AND THE ORDER IS THE SPECIFICATION"*.
- `App.vue` passes `projectId` to `CouncilView` (nullable) and reports `view` in the attention
  report.

## Goal

A council run's minutes are credited to **the project it was run for** instead of being buried in
`overhead`, so Phase 8's estimator sees what a task actually cost — **and a run with no project
still credits `overhead`, because inventing an attribution is worse than omitting one.**

## Exact Scope

**Edit:** `src/main/services/attentionCore.ts` · `attentionCore.test.ts` · the attention report
path in `src/renderer/src/App.vue` **only** so far as carrying the council's project id ·
`src/shared/ipc.ts` **only** if the attention report payload must carry that id.

**⚠ If the payload must change, that is a RESHAPE, not a new channel.** `IpcChannel` stays **57**
and `ipcMain.handle(` stays **52**. Say so loudly in the report — Phase 3c's D80 is the precedent
for how a bounded reshape gets declared.

## Non-Goals

- **⚠ DO NOT REVERT D70 OR RESTORE `=== 'settings'`.** D70's reasoning — *no pane is mounted* is
  what makes a view overhead, true of every future view **by construction** — **is still correct
  for `settings` and for every view added later.** What D95 adds is a **narrow exception for a view
  that is itself performing paid work on a named project**. A future view is `overhead` by default
  and must earn its way out, exactly as before.
- **Do not add a sixth `AttentionClass`.** Matthew considered and declined it: nothing reads a
  distinction that does not exist yet.
- **Do not credit a council run with no project id.** No project → `overhead`, unchanged.
- **Do not touch the council files** — `councilCore.ts`, `councilService.ts`, `stores/council.ts`.
- **No schema, no migration, no new channel.** ⚠ `attention_spans` **has no `view` column**
  (`storage.ts:198`) — D70 established this. **Do not add one.**

## Dependencies

None. Independent of the measurement; may run before or after 3e-1.

## Step-by-step Work

1. Read D70's roadmap row in full — including the correction that its *stated argument was false on
   a checkable fact*. **This task must not repeat that mistake: verify what `attention_spans`
   actually stores before reasoning about what a change writes.**
2. Widen `AttentionInputs` with the council's project id (spec §1).
3. Add the branch to `classify()`, respecting first-match-wins order (spec §2).
4. Carry the id from the renderer (spec §3).
5. Prove it on the running app (spec §4).

## Test Expectations

`attentionCore.test.ts` is a **pure-function** suite — this is the one part of the attention story
that is cheap to test exhaustively, so test it exhaustively:

- council view + project id → `pane`-class attribution to that project, **`sessionId` null**;
- council view + **no** project id → `overhead`;
- settings view → `overhead`, **unchanged**;
- a hypothetical future view → `overhead`, **unchanged** (the D70 property, asserted so a later
  reader cannot quietly lose it);
- the `coverage()` accounting identity still holds — **every tick lands in exactly one class**.

**Never fewer than the baseline; no existing assertion weakened.**

## Verification Commands

```bash
npm run typecheck && npx vitest run && npm run grep:secrets
```

```bash
grep -c "sqliteTable(" src/main/db/schema.ts                        # 16
grep -oE "^\s+[A-Za-z]+: '[a-z0-9:-]+'" src/shared/ipc.ts | wc -l   # 57 — no NEW channel
grep -n "view" src/main/services/storage.ts | grep -i "attention"   # still no view column
git diff --stat src/main/services/council*                          # EMPTY
```

## Acceptance Criteria

- [ ] Gates green; the pure-function suite covers all five cases above.
- [ ] `IpcChannel` **57**, `ipcMain.handle(` **52 / 0**, `sqliteTable(` **16**,
      `MIGRATIONS.length` **12**.
- [ ] **On the running app**, a minute spent in the council view with a project selected is
      credited to that project, and with no project selected is credited to `overhead`. **Both
      directions demonstrated** — one alone proves nothing.
- [ ] The report states plainly **whether the attention report payload was reshaped**, and if so
      that it added no channel.
- [ ] D70's property is asserted by a test, not merely respected.

## Review Checklist

1. **`settings` still classifies as `overhead`.** Read the test, not the diff.
2. **No project id → `overhead`.** This is the D76-shaped hazard: an implementer who defaults to
   "the active project" has invented an attribution.
3. **`attention_spans` gained no column.**
4. **The council files have an empty diff.**
5. **First-match-wins order is preserved** — a branch inserted at the wrong position changes
   classes it was never meant to touch, and the order is the specification.

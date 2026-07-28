# Task 3e-4 — The Transcript Reader and the Retention Answer (D97)

**Phase:** 3e · **Task 4 of 4** · **Depends on:** none.

## Source Of Truth

- [`Phase-3e-Overview.md`](Phase-3e-Overview.md) — **D97**, and the declared channel exception.
- `../ImplementationSpecs/ImplementationSpec-3e-4.md`.
- `docs/design/v2/Chorus Council.dc.html` — **the reader is already drawn**: a
  `findings | transcript · 13 turns` toggle in the findings panel header.
- Roadmap §7 Phase 3e — the write-only-store finding.

## Initial Starting Point (verified 2026-07-28 at `0ac1f3e`)

- `src/main/services/storage.ts:1819` — `getCouncilMessagesForRun(runId): CouncilMessageRow[]`,
  **zero callers** outside `storage.ts` and its tests. **The read function already exists.**
- `storage.ts:1802` — `deleteCouncilRun(id)`, **zero callers**. Purges `council_messages`
  explicitly in one transaction (`schema.ts:501` records why: SQLite will not cascade a soft
  pointer).
- `src/renderer/src/views/CouncilView.vue` — restyled by 3c-5; the findings panel header is
  `.cn-panel-head` and already carries an eyebrow and a right-hand slot.
- `IpcChannel` **57** · `ipcMain.handle(` **52 / 0** · `sqliteTable(` **16** ·
  `MIGRATIONS.length` **12**.

## Goal

Make a paid deliberation re-openable. A run costs **~$0.83 and ~14 minutes**; today its transcript
is written and never readable again. Add the reader the design already specifies — **and answer, in
writing, what stops the table growing forever.**

## Exact Scope

**Edit:** `src/shared/ipc.ts` (one channel + its Zod pair) · `src/main/ipc.ts` (one handler) ·
`src/preload/index.ts` (one forwarder) · `src/renderer/src/stores/council.ts` (the fetch + state) ·
`src/renderer/src/views/CouncilView.vue` (the toggle) · the matching test files.

## Non-Goals

- **⚠ READ-ONLY. The channel returns rows; it never writes, never deletes.** A delete path from the
  renderer is a different decision with a different blast radius, and D97 did not make it.
- **Do not add a table, a column, or a migration.** `sqliteTable(` **16**, `MIGRATIONS.length`
  **12**. The data already exists; this task gives it a door.
- **Do not change council orchestration** — `councilCore.ts`, `councilService.ts` untouched.
- **⚠ Do not disturb the F37 grouping.** `stores/council.ts` keys live message blocks on
  `(member, phase, round)` after a run rendered **291 fragments where 8 turns belonged**.
  **`stores/council.test.ts` holds the regression test; if it goes red, stop and report.** The
  historical transcript is a **separate** piece of state from the live one — see spec §3.
- **Do not render a cost, a duration, or any figure without its denominator** (D55).
- **Do not exceed one channel.** 57 → **58** and 52 → **53**, once, here. `index.ts` stays **0**.

## Dependencies

None. **But it is most useful after 3e-1**, which produces the first run there is anything to read.

## Step-by-step Work

1. The channel and its schemas (spec §1).
2. The handler, over the existing `getCouncilMessagesForRun` (spec §2).
3. Store state for the historical transcript, **separate from the live one** (spec §3).
4. The toggle in the findings panel header, against the mock (spec §4).
5. **The retention answer** (spec §5) — a wired path **or** a written bound. **Not silence.**

## Test Expectations

- Schema round-trip cases for the new channel in `src/shared/ipc.test.ts`.
- A store case: loading a historical transcript **does not disturb live message grouping**.
- **`stores/council.test.ts`'s F37 regression test stays green and unedited.**

## Verification Commands

```bash
npm run typecheck && npx vitest run && npm run grep:secrets
```

```bash
grep -oE "^\s+[A-Za-z]+: '[a-z0-9:-]+'" src/shared/ipc.ts | wc -l   # 58 — exactly one added
grep -c "ipcMain.handle(" src/main/ipc.ts                           # 53
grep -c "ipcMain.handle(" src/main/index.ts                         # 0
grep -c "sqliteTable(" src/main/db/schema.ts                        # 16 — unchanged
git diff --stat src/main/services/council*                          # EMPTY
```

## Acceptance Criteria

- [ ] Gates green; vitest **≥ baseline**, F37's test green and unedited.
- [ ] `IpcChannel` **58**, `ipcMain.handle(` **53 / 0**, `sqliteTable(` **16**,
      `MIGRATIONS.length` **12**.
- [ ] **On the running app**, a past run's transcript opens from the toggle and shows its turns
      grouped as turns.
- [ ] **The retention position is written into the roadmap**, either as a wired path or as a stated
      bound with the reason.
- [ ] The toggle matches the mock's header treatment and carries its denominator
      (`transcript · N turns`).

## Review Checklist

1. **The channel is read-only.** No delete, no write, no parameter that could become one.
2. **`sqliteTable(` and `MIGRATIONS.length` did not move.**
3. **F37's regression test is untouched and green**, and the historical transcript is separate
   state from the live one.
4. **The retention answer exists** — a task that ships the reader and leaves the growth question
   silent has done the easy half and inherited the hard one to a fifth task.
5. **No number without its denominator** in the new UI.

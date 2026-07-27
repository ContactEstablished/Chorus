# Task 3c-5 — Settings and Council — Closes Phase 3c

**Phase:** 3c — Design Adoption · **Task 5 of 5** · **Depends on:** 3c-1, 3c-3, 3c-4.

## ✅ UNBLOCKED — D72 IS DISCHARGED (2026-07-26)

**`docs/design/v2/Chorus Council.dc.html` EXISTS** — 69,011 bytes, `data-screen-label="Council
Review"`, produced by Matthew in Claude Design from
[`../../../design/CouncilView-DesignPrompt.md`](../../../design/CouncilView-DesignPrompt.md).
**Coordinator-reviewed at delivery and it passes on all four invariants** (§ below).

**⚠ THE WHOLE `v2/` FOLDER IS NOW THE AUTHORITY, and the reason is that it is not a fork.** All
seven pre-existing screens in `docs/design/v2/` are **byte-identical** to their originals —
verified by `cmp` on each — so v2 adds the council mock and changes **nothing else**. Pointing
some specs at the root and one at `v2/` would create exactly the two-homes hazard this codebase
keeps ruling against, for no benefit. **Every 3c document now cites `docs/design/v2/`.**

*(`support.js` does differ — 66,404 → 69,150 bytes. It is the mock renderer harness, not a
screen, and it carries no design value; noted so the byte-identity claim above is exact rather
than approximate.)*

## Source Of Truth

- [`Phase-3c-Overview.md`](Phase-3c-Overview.md) — **D72**, the purity contract, the milestone.
- [`../ImplementationSpecs/ImplementationSpec-3c-5.md`](../ImplementationSpecs/ImplementationSpec-3c-5.md).
- `docs/design/v2/Chorus Settings Providers.dc.html` — the settings authority.
- `docs/design/v2/Chorus Council.dc.html` — the council authority **(must exist)**.
- `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-3b-4.md` §4 — the council
  view's three non-styling rendering rules, which this task must not break.

## Initial Starting Point (verified 2026-07-26 at `1cf23ff`)

- `views/SettingsView.vue` (73 lines) — the shell, **built to the design's skeleton in Task 3-4
  precisely so this phase recolors rather than rearranges**.
- `views/SettingsProviders.vue` (**1,171 lines**) — the app's largest file; providers, models,
  and the council-member management surface added by 3b-2.
- `views/SettingsCredentials.vue` (329 lines) — the mock is "Providers **& Keys**", so it is
  partially covered; where it is not, conformance applies.
- `views/CouncilView.vue` (273 lines) — functional, generic neutral greys, three documented
  rendering rules at lines 11–18 and the F27 wording at lines 25–33.

## Goal

Finish the phase: settings against its mock, then the council view against the new one. When this
lands, every surface in Chorus speaks the design language and the app is one Matthew can sit in
front of all day — which is the reason 3c went first.

## ⚠ Four things in the council view are NOT styling, and a restyle must preserve every one

From `CouncilView.vue`'s own documentation and `ImplementationSpec-3b-4.md` §4:

1. **The F27 redaction wording is verbatim and bounded** (`CouncilView.vue:31–33`). It says
   Chorus redacts registered exact values and **cannot** redact derived ones. **Do not shorten,
   soften, or reword it** — it is the one sentence this feature may ship about redaction, and it
   was written to refuse the claim "your brief is safe".
2. **The standing caveat sits ABOVE the synthesis** and states that findings are deliberation,
   not verified fact. **It may not be moved below, collapsed, or made dismissible.**
3. **An unavailable member is shown and explained, never hidden** (`:109–114`). The run is
   refused over it; a roster that hid it would make the refusal unreadable.
4. **D55, one layer up: no number without its denominator** (`:228–265`). Every figure in the
   accounting block — members, turns, usage, tokens, cost — appears with what it is out of.
   **A cost rendered alone is the exact defect the wire schema forbids.**

**And nothing may imply the findings are verified.** No checkmarks, no green success chrome. The
visual language for a finished run is "finished", never "correct". CR-3b.0 is the standing
evidence: sound rulings, four compile errors, because the council had the brief and not the repo.

### ✅ The delivered mock was checked against all five, and it passes

Verified against `docs/design/v2/Chorus Council.dc.html` on 2026-07-26:

1. **F27 wording — VERBATIM.** Present as one unbroken string, matching `CouncilView.vue:31–33`
   exactly. No shortening, no softening.
2. **The caveat — VERBATIM and above the synthesis.** The section comment literally reads
   `<!-- standing caveat, above the synthesis -->`.
3. **Unavailable members — shown and explained, and the mock EXTENDS the rule.** Refused members
   keep their roster card and gain a red explanation line (`HTTP 429 rate_limit_exceeded after 2
   retries (18s, 42s) · this turn contributed nothing and is counted as refused, not answered`),
   **and refused turns appear in the transcript as rows rather than as gaps.** ⚠ That transcript
   half goes **beyond** what `CouncilView.vue` does today — adopt it; it is the rule's spirit
   applied where the current code left a gap.
4. **Denominators — the accounting block is STRONGER than the shipped code.** It is labelled
   *"every figure carries its denominator"* and renders `3 answered / 4 planned`, `11 answered /
   2 refused / 13 attempted`, `reported for 9 of 13 turns · absent for 4 of 13`, tokens `covers
   the 9 of 13 turns that reported usage`, and cost `$0.83 · covers 9 of 13 turns · 4 turns not
   reported by the provider · **true total is at least this**`. **That last clause is F39's
   under-reporting problem stated in the UI**, which the current view does not say. Adopt it.
5. **No verification chrome.** A search for `✓ ✔ passed verified success` returns **one** hit —
   the word "verified" inside the caveat's own *"not verified fact"*. Clean.

## Exact Scope

**Edit:**
- `src/renderer/src/views/SettingsView.vue`
- `src/renderer/src/views/SettingsProviders.vue`
- `src/renderer/src/views/SettingsCredentials.vue`
- `src/renderer/src/views/CouncilView.vue`

**Create:** only if the new council mock introduces a component with no existing home (e.g. a
phase-progress indicator). **Prefer extending `StateMarker` over inventing a second state
vocabulary.**

## Non-Goals

- **No IPC.** `IpcChannel` **56**, `ipcMain.handle(` **51** — unchanged.
- **No change to council orchestration, the store, or the protocol.** `stores/council.ts`,
  `councilCore.ts`, `councilService.ts` are untouched. **The 3b-4 fragmentation fix (F37) keys
  message blocks on (member, phase, round) — do not touch that grouping**; it exists because a
  live run rendered 291 fragments where 8 turns belonged.
- **No change to credential handling or what settings write.** Write-only-inbound stays
  write-only-inbound; no schema gains a field.
- **Do not "fix" the council's output quality, the dissent matcher, or the duplicated dissent
  heading (F40).** That is **Phase 3e**. This task changes pixels.
- **Do not revert or commit unrelated working-tree changes.**

## Dependencies

3c-1 (tokens, `StateMarker`), 3c-3 (the workspace), 3c-4 (the shared overlay anatomy) — and
**the council mock (D72)**.

## Step-by-step Work

1. **Confirm `docs/design/v2/Chorus Council.dc.html` exists.** If not, stop and report.
2. `SettingsView.vue` shell against the mock.
3. `SettingsProviders.vue` — the big one; work section by section.
4. `SettingsCredentials.vue` — mock where covered, conformance elsewhere.
5. `CouncilView.vue` against the new mock, preserving all four invariants above.
6. The visual pass and the council behaviour re-check.

## Test Expectations

**No new component tests.** `stores/council.test.ts` and `stores/settings.test.ts` must stay
green **unedited** — that is the signal that a restyle did not reach into behaviour.

**⚠ `stores/council.test.ts` contains the F37 regression test.** If it goes red, message
grouping was disturbed and the 291-fragment defect is back. That is a stop-and-report, not a
test to adjust.

## Verification Commands

```bash
npm run typecheck && npx vitest run && npm run grep:secrets
```

```bash
test -f "docs/design/v2/Chorus Council.dc.html" && echo "mock present" || echo "BLOCKED — D72"
```

```bash
grep -rn "neutral-\|sky-\|zinc-\|slate-\|gray-\|red-[0-9]\|amber-[0-9]" src/renderer/src/views/ ; echo "expect: nothing"
```

**The invariant greps — each must still match:**

```bash
grep -n "cannot redact values an agent derives" src/renderer/src/views/CouncilView.vue
grep -n "model deliberation, not verified fact" src/renderer/src/views/CouncilView.vue
grep -n "membersPlanned\|turnsRefused\|usageAbsent" src/renderer/src/views/CouncilView.vue
```

### Visual pass (G2) — surfaces 11–14, and then the whole inventory

- [ ] **Settings — Providers**, against its mock, including the council-member section.
- [ ] **Settings — Credentials**.
- [ ] **Council — empty**, **no members configured**, **running mid-deliberation**, **partial
      run**, **complete with findings**, and **refused/error** — the six states the design prompt
      asked for.
- [ ] **⚠ THE PHASE CLOSE-OUT PASS: re-screenshot ALL 14 surfaces** in the Overview's inventory
      and confirm nothing regressed while later tasks moved. This is the F15 lesson's whole
      point — an app-wide token change is only verified when every surface has been looked at
      **after the last change**, not after its own task.

### Council behaviour re-check

- [ ] A real council run streams into the restyled view and the findings file still lands beside
      the brief. **⚠ Use a SHORT stub brief, not a real governance brief** — D71 puts a full
      frontier run at **~$0.83 and ~14 minutes**, and this is a styling check.
- [ ] Esc still refuses to leave while a run is in flight.
- [ ] A partial run still **reads** as partial.

### ⚠ Cost envelope

**`< $0.05`.** A styling verification does not need a real deliberation on a real brief. State
the measured cost against this envelope, and **report a bound rather than a tidy figure if any
turn returns no usage frame** (F39: `kimi-k3` reports none at all).

## Acceptance Criteria

- [ ] Gates green; **941 tests passing, none edited** — including the F37 regression test.
- [ ] `IpcChannel` **56**, `ipcMain.handle(` **51**, `MIGRATIONS.length` **11**,
      `sqliteTable(` **15**.
- [ ] Settings and Council match their mocks on a screenshot diff.
- [ ] **All four council invariants verified by grep AND by screenshot** — present in the source
      and legible on screen.
- [ ] **Zero** stock Tailwind palette utilities anywhere in `src/renderer/src/views/`.
- [ ] **The 14-surface close-out pass is complete**, with the worktree panel's unmocked status
      restated as the phase's one known gap.
- [ ] Cost stated against the `< $0.05` envelope.

## Review Checklist

1. **The F27 sentence is byte-identical.** Diff it. A restyle that "tightened the copy" has
   changed a security claim, and this is the most likely place in the phase for that to happen.
2. **The caveat is still above the synthesis**, still unconditional, still not dismissible.
3. **No verification chrome crept in.** Search the diff for checkmarks, `✓`, green success
   styling around findings. The mock may even suggest it; the rule outranks the mock.
4. **Every accounting number still has its denominator.** Read the rendered block, not the
   template.
5. **`stores/council.test.ts` is unedited and green** — F37 has not regressed.
6. **The close-out pass covers 14 surfaces**, not 4. A task that only screenshots its own
   surfaces has not verified the phase.

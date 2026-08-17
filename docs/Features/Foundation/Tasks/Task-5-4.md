# Task 5-4 — The three refinement modes, metered, and the settings section

_Phase 5, task 4 of 4. Authored 2026-08-17 against `4369954`._

---

## Source Of Truth

| Document | Owns |
|---|---|
| [`Phase-5-Overview.md`](Phase-5-Overview.md) | Ground facts, the purity contract, D159–D162 |
| [`../Phase-5-VoicePlan.md`](../Phase-5-VoicePlan.md) §2, §5, §8.4 | The refinement rules and the settings list — **authoritative on design** |
| [`../ImplementationSpecs/ImplementationSpec-5-4.md`](../ImplementationSpecs/ImplementationSpec-5-4.md) | Exact prompts, the metering row, settings layout |
| `roadmap.md` §6 | **D137** (three modes) · **D157** (meter it) · **D161** (no table) · **D76** (a nav row must have something behind it) · **D48** (one home for spend) · **F42** (the cost race) |

---

## Initial Starting Point — verified 2026-08-17 at `4369954`

| Fact | Value |
|---|---|
| BYOK entry point | `createApiSession(spec: ApiLaunchSpec, deps: ApiSessionDeps): ApiSessionHandle` — `src/main/services/apiSession.ts:290` |
| Usage callback | `deps.onUsage?: (usage: TokenUsage) => void` — `apiSession.ts:140`, fired at `:537` when a final-frame `usage` is present |
| ⚠ Only `onUsage` producer in main | `councilService.ts:1129` — **exactly one**, AST-checked across `src/main/` |
| ⚠ The newest consumer meters **nothing** | The day-report summarizer calls `createApiSession` with `{baseUrl, maxOutputTokens}` and **no `onUsage`** — `ipc.ts:4274`, inside `resolveDaySummarizer` (`:4263–4299`) |
| Spend columns | `dispatches.tokensIn` / `tokensOut` / `tokensCached` / `costUsd` / `tokensSource` — `schema.ts`, and `schema.ts:238` states these live here *"not in a separate `usage_records` table … one home, not two (D48)"* |
| `dispatches` FK posture | **Zero `REFERENCES` on every column**; `session_id` / `project_id` are **opaque strings** — a dispatch deliberately outlives its session row |
| `agentKindSchema` | `z.enum(['claude','codex','kimi','opencode'])` — `src/shared/ipc.ts:709` |
| Settings channel-group precedent | `agent-lock:pin-status` / `-set` / `-clear` — `src/shared/ipc.ts:66`, `:70`, `:73` |
| `SettingsView.vue` | Renders **two** nav rows; docblock **:15–19** names Voice as one of five withheld under **D76** |
| `MIGRATIONS.length` | **20**, and it stays there (D161) |

---

## Goal

Add Verbatim / Clean up / Organize over the **existing** BYOK path, meter what
they spend, and give the "Voice & dictation" settings section something real to
be — so the nav row the mock draws finally **earns** its place under D76.

---

## ⚠ Where the spend lands — settled here, as D157 said it would be

D157 ruled *"meter it"* and left the destination to this kickoff. It is
**`dispatches`**, and that is what makes D161's "no migration" possible:

- `dispatches` already carries `tokens_in` / `tokens_out` / `tokens_cached` /
  `cost_usd` / `tokens_source`, and `schema.ts:238` says in as many words that
  this is spend's **one home** (D48).
- Its columns carry **zero FKs** and are opaque strings, so a refinement that
  outlives its pane — or belongs to no pane at all — stores cleanly.
- **No new table, no migration, no `deleteProject` step.** `v21` stays free.

### ⚠ And it opens F25's exact shape, which is why the ruling is explicit

`dispatches.agent` is `.notNull()`. A refinement turn is **not** one of
`claude`/`codex`/`kimi`/`opencode`, so this task writes **`agent: 'voice'`** —
a value outside `agentKindSchema`.

Today that is safe: **no IPC schema parses `dispatches.agent`**, verified this
kickoff. But **F25 is precisely this defect one layer up** — a single row whose
`agent` held an unknown value made an outbound Zod parse throw and blanked an
entire project view. The moment Phase 7's cost rollups read dispatch rows,
an enum parse over `agent` meets `'voice'` and repeats it.

**Therefore this task must, in the same commit:**

1. Write `agent: 'voice'` **deliberately**, with a comment at the write site
   naming F25 and this hazard.
2. **Widen the reader's contract rather than the writer's guess** — follow
   **D86**, which lifted the `agentKindSchema` freeze and moved the enum and
   `staticRegistry` **together, in one change, as a numbered decision**. A
   dispatch-shaped read schema, if one is introduced, tolerates unknown agents
   at the **projection** (F25's ruled fix) rather than widening the enum blindly.
3. **Record the choice** so the next reader finds a ruling, not a surprise.

---

## Exact Scope

**Create:**

| File | Purpose |
|---|---|
| `src/main/services/voiceRefineCore.ts` | **Pure.** The three prompts, mode selection, the do-not-invent contract, response validation, fallback selection. No network, no `electron`. |
| `src/main/services/voiceRefineCore.test.ts` | Unit tests |
| `src/main/services/voiceRefine.ts` | The `createApiSession` call, `onUsage` wiring, the `dispatches` write |
| `src/main/services/voiceRefine.test.ts` | Unit tests, transport injected |
| `src/renderer/src/views/SettingsVoice.vue` | The "Voice & dictation" section |

**Edit:**

| File | Change |
|---|---|
| `src/renderer/src/views/SettingsView.vue` | The nav row — **now that there is something behind it** |
| `src/main/services/voice.ts` | Refinement between transcription and injection |
| `src/main/ipc.ts` + `src/shared/ipc.ts` + `ipc.test.ts` | A `voice:*` settings channel group (the `agent-lock:*` shape, **not** a generic key/value bag); re-count both assertions |

---

## ⚠ The refinement rules are the feature, not the API call

Adopted wholesale from the source document (VoicePlan §2) and **not re-argued**:

- **The original transcript is the source of truth and is never overwritten.**
  Under D161 it is held in memory rather than in SQLite — the rule is unchanged,
  only its storage is.
- **Refinement must not invent.** Names, numbers, dates, monetary amounts,
  identifiers and quoted language survive **verbatim**. Unclear passages are
  **marked, not guessed**. The speaker's uncertainty is preserved.
- **Failure falls back to the original transcript and never loses it** — a
  refinement that errors, times out, refuses, or returns something that fails
  validation yields the **original**, and says so.
- **Verbatim is always available and requires no key, no network and no LLM.**
  It is the offline floor and must remain reachable in one setting change.

⚠ **A refinement that silently drops a number is worse than no refinement at
all**, because the user has already stopped proof-reading. The validation in
`voiceRefineCore` is what makes "must not invent" a check rather than a hope:
digits, quoted spans and identifier-shaped tokens present in the original must
still be present in the refined text, or the refinement is **rejected and the
original used**.

---

## ⚠ F42's race hits this harder than anything before it

The council's `cost_usd` under-reports because it reads the **minted key's
spend counter** milliseconds after the last stream closes, before the provider
has settled the final turn — and then deletes the key, so the reading can never
be revised. F42 proved the honest method twice, to within **0.05%**: derive
from the run's **own stored token counts** at published rates.

**A refinement is a single short turn — so *all* of it is the final turn.** The
minted-key approach would be maximally wrong here.

**Therefore: derive from `onUsage`'s reported token counts.** Record
`tokens_source` so a later reader knows which method produced the number, and
**never** read a key-spend scalar for this path.

---

## Non-Goals

- **No composer, no mode-switch-after-the-fact, no "restore the original" UI**
  (D160). Mode is chosen **before** dictation; after the write nothing is
  retractable (VoicePlan §6.1).
- **No cloud STT** (D155) — refinement sends **transcript text**, never audio.
- **No migration** (D161).
- **No new table.** Spend rides `dispatches`.
- **No second provider client.** `createApiSession` or nothing (D45(2)).
- **No auto-Enter**, unchanged from 5-3.
- **No telemetry egress.** Local counters only.
- **No transcript text in any log** — including in refinement errors, which is
  the tempting place to put it.
- **Do not revert or commit** the pre-existing uncommitted doc changes.

---

## Dependencies

**Task 5-3** — a transcript reaching a pane is what refinement improves.

---

## Step-by-step Work

1. **`voiceRefineCore.ts` first**: the three prompts, and the **invention check**
   with its tests. Write the check before the call, so the call is never the
   thing under test.
2. **`voiceRefine.ts`**: `createApiSession`, `onUsage` wired, disposal on every
   path including error and timeout.
3. **The `dispatches` write**, with the F25 comment at the write site.
4. **Wire into `voice.ts`** between transcription and injection; Verbatim
   short-circuits without touching the network.
5. **Settings**: model (base.en / small.en, D159), hotkey, activation mode,
   default refinement mode, input device, and the **disclosure** — stated where
   the mode is chosen, not buried (VoicePlan §5).
6. **Add the nav row last**, once the section behind it exists (D76).
7. **Re-count `IpcChannel`.**

---

## Test Expectations

- Each mode produces its own prompt; Verbatim makes **no** network call at all.
- **Invention check**: a refined text that drops or alters a digit, a quoted
  span, or an identifier is **rejected**, and the original is returned.
- Fallback on: transport error, timeout, refusal, empty response, and
  validation failure — five paths, five tests, **original preserved in each**.
- `onUsage` fires → a `dispatches` row carries tokens and a derived cost with
  `tokens_source` set.
- `onUsage` never fires → the row records **absent usage honestly**, not zero.
  *(Zero and unknown are different facts; F42 exists because they were conflated.)*
- Disposal happens on every path.
- Settings round-trip and survive a restart.

**Expect roughly +40 to +55 tests.**

---

## Verification Commands

```
npm run typecheck                 # 0
npx vitest run                    # >= 5-3's total + new; NEVER --reporter=basic
npm run grep:secrets              # clean

# Metering is actually wired (D157) — the day-summarizer's omission is the anti-pattern
grep -n "onUsage" src/main/services/voiceRefine.ts        # expect a real wiring

# No second provider client (D45(2))
grep -rn "fetch(" src/main/services/voiceRefine*.ts       # expect ZERO — createApiSession only

# No migration (D161)
node -e "const ts=require('typescript'),fs=require('fs');const p='src/main/services/storage.ts';const sf=ts.createSourceFile(p,fs.readFileSync(p,'utf8'),ts.ScriptTarget.Latest,true);let i=null;const w=n=>{if(ts.isVariableDeclaration(n)&&n.name.text==='MIGRATIONS')i=n.initializer;ts.forEachChild(n,w)};w(sf);console.log(i.elements.length)"   # expect 20

# The F25 hazard is commented, not silent
grep -rn "F25" src/main/services/voiceRefine.ts           # expect the note at the write site

# No transcript in logs
grep -rn "logger\." src/main/services/voiceRefine*.ts     # review EVERY hit
```

### Runtime gates (G2)

1. **A real billable call.** Clean up runs against a real credential on the
   **installed** app and returns better text than Verbatim **on the same audio**.
   A stubbed transport cannot show this — D153's summarizer shipped a prompt
   defect that every unit test passed straight through.
2. **Spend is recorded.** The `dispatches` row exists after a refinement, with
   non-null tokens and a cost derived from **counts**, not a key scalar.
3. **Fallback is real.** Pull the network mid-refinement: the **original**
   transcript is injected, and the user is told refinement failed.
4. **Verbatim is offline.** With the network off, Verbatim dictation still works
   end to end — the D155 floor.
5. **The nav row appears** and its section is populated; changing the model
   setting survives a restart.

---

## Acceptance Criteria

- [ ] Three modes; **Verbatim makes no network call**.
- [ ] Invention check rejects altered numbers / quotes / identifiers, and the
      original is used.
- [ ] All five failure paths fall back to the original, which is never lost.
- [ ] `onUsage` wired; a `dispatches` row records tokens + derived cost +
      `tokens_source`; **absent usage recorded as absent, not zero**.
- [ ] `agent: 'voice'` written deliberately, F25 named at the write site, the
      reader-side ruling recorded.
- [ ] Settings section shipped; nav row added **only** because it now has
      content (D76); disclosure shown where the mode is chosen.
- [ ] `MIGRATIONS.length` **20**; runtime deps **9**; `index.html` byte-identical.
- [ ] `IpcChannel` re-counted; both assertions updated.
- [ ] typecheck 0 · vitest green with a printed count · `grep:secrets` clean.

---

## Review Checklist

- Does Verbatim genuinely bypass the network, or merely send a
  "change nothing" prompt? The offline floor depends on the former.
- Is the invention check a **real comparison** against the original, or a
  prompt instruction hoping the model complies?
- On refinement failure, is the original **injected**, or is the whole dictation
  lost? Losing it is the worse bug and the easier one to write.
- Is absent usage stored as `NULL`, or quietly as `0`? F42 exists because those
  were conflated once already.
- Is the F25 hazard commented at the write site, or only in this document?
- Does any refinement error message embed the transcript it failed on?
- Did the nav row appear **before** its content? That inverts D76.

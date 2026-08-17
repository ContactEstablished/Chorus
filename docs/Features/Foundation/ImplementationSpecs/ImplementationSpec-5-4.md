# Implementation Spec 5-4 — Refinement modes, metering, and the settings section

_Normative companion to [`../Tasks/Task-5-4.md`](../Tasks/Task-5-4.md).
Written 2026-08-17 against `4369954`._

---

## §0 — Reuse the BYOK path exactly; grow no second client

```ts
import { createApiSession } from './apiSession'   // apiSession.ts:290
```

`createApiSession(spec: ApiLaunchSpec, deps: ApiSessionDeps): ApiSessionHandle`.
D45(2) makes this the one shared primitive; the council and the day report both
ride it. **No `fetch` in `voiceRefine*.ts`.**

Credential resolution reuses `resolveCredential` — the same reasoning
`resolveDaySummarizer` states at `ipc.ts:4263`: *"a second, shorter refusal
ladder drifts from the first."*

---

## §1 — The three modes

| Mode | Network | Prompt |
|---|---|---|
| **Verbatim** | **NONE** | — short-circuits before any call |
| **Clean up** (default) | yes | remove fillers, fix obvious mis-recognitions, punctuate; **change nothing else** |
| **Organize** | yes | structure into sentences/bullets where the speaker clearly intended them |

```ts
// ⚠ VERBATIM MUST SHORT-CIRCUIT, NOT SEND A "CHANGE NOTHING" PROMPT.
// It is the OFFLINE FLOOR (D155): "no network, no key, no vendor, no LLM,
// reachable in one setting change". A Verbatim path that calls a model with
// instructions to leave the text alone satisfies the WORDS and breaks the
// GUARANTEE — and it breaks it silently, on a machine with no network, by
// failing where the user was promised it would not.
if (mode === 'verbatim') return { text: original, refined: false }
```

### The do-not-invent contract, stated in the prompt AND checked in code

Prompt text (adopted from VoicePlan §2, not re-argued):

> Names, numbers, dates, monetary amounts, identifiers and quoted language must
> survive **verbatim**. Do not guess at unclear passages — mark them. Preserve
> the speaker's uncertainty. Output only the corrected text.

⚠ **A prompt instruction is a request, not a guarantee.** D153's summarizer
shipped with a prompt defect (*"1 to 3 sentences"* permitted one enormous
sentence) that **every unit test passed straight through** and only a real call
revealed. So the contract is also **enforced in code**:

```ts
// voiceRefineCore.ts — the check that makes "must not invent" a CHECK.
export function preservesFacts(original: string, refined: string): PreserveResult
```

Rejects the refinement (and returns the **original**) when:

- any **digit sequence** in the original is absent from the refined text;
- any **double-quoted span** is absent;
- any **identifier-shaped token** (contains `_`, `::`, `/`, `.` between word
  chars, or is camelCase) is absent;
- the refined text is **> 1.5×** or **< 0.4×** the original's length — a
  refinement that doubles or halves the text has done something other than
  clean it.

Each rule gets a unit test with a realistic dictation, including a false-positive
guard: *"twenty twenty six"* → *"2026"* is a **legal** normalisation the digit
rule must not reject. **Compare digit sequences present in the ORIGINAL against
the refined text, never the reverse.**

---

## §2 — Metering (D157), and where it lands

**Destination: a `dispatches` row.** No migration; `MIGRATIONS.length` stays 20.

Why it fits without a schema change:

- `dispatches` carries `tokens_in` / `tokens_out` / `tokens_cached` /
  `cost_usd` / `tokens_source` already, and `schema.ts:238` declares this spend's
  **one home** (D48 — "not in a separate `usage_records` table").
- **Zero `REFERENCES` on every column**; `session_id` / `project_id` are opaque
  strings — so a refinement that outlives its pane, or belongs to none, stores
  cleanly and `deleteProject` needs no new step.

### ⚠ `agent: 'voice'` — F25's shape, opened deliberately

```ts
// ⚠ 'voice' IS OUTSIDE agentKindSchema (ipc.ts:709 — claude|codex|kimi|opencode),
// AND THAT IS A DELIBERATE, RECORDED CHOICE RATHER THAN AN OVERSIGHT.
//
// Safe TODAY: no IPC schema parses dispatches.agent — verified at the 2026-08-17
// kickoff. But F25 is EXACTLY this defect one layer up: one session row whose
// `agent` held an unknown value made an outbound Zod parse throw and blanked an
// entire project view. When Phase 7's cost rollups read dispatch rows, an enum
// parse over `agent` meets 'voice' and repeats it.
//
// The ruled fix is F25's own: TOLERATE AT THE PROJECTION, not by widening the
// enum reflexively — and if the enum is ever widened, it moves TOGETHER with
// staticRegistry in one change, as a numbered decision (D86's precedent).
```

### Derive cost from counts, never from a key scalar

```ts
// ⚠ F42 APPLIES HARDER HERE THAN ANYWHERE IT HAS BEEN MEASURED.
// The council's cost_usd under-reports because it reads the MINTED KEY'S spend
// counter milliseconds after the last stream closes — before the provider has
// settled the final turn — and then deletes the key, so the reading can never
// be revised. Brute-forcing run A's charges showed the recorded figure matched
// "every turn EXCEPT the last".
//
// A refinement is a SINGLE SHORT TURN. All of it is the final turn. The
// minted-key method would be maximally wrong.
//
// Derive from onUsage's reported token counts at published rates — the method
// F42 confirmed TWICE to within 0.05%. Record tokens_source so a later reader
// knows which method produced the number.
```

**Absent usage is recorded as absent:**

```ts
// ⚠ NULL AND ZERO ARE DIFFERENT FACTS. If onUsage never fires, write NULL —
// never 0. F42 exists because "measured as zero" and "never measured" were
// conflated once already, and a zero silently understates every rollup built
// on top of it.
```

---

## §3 — Wiring into `voice.ts`

`transcribed → (mode === 'verbatim' ? inject : refine) → inject`.

```ts
// ⚠ THE ORIGINAL IS THE SOURCE OF TRUTH AND IS NEVER OVERWRITTEN.
// Under D161 it lives in memory rather than in SQLite — the rule is unchanged,
// only its storage is. Hold `original` for the whole flow; `refined` is a
// SEPARATE field. On ANY failure — transport error, timeout, refusal, empty
// response, preservesFacts rejection — inject `original` and tell the user
// refinement failed.
//
// ⚠ LOSING THE DICTATION IS THE WORSE BUG AND THE EASIER ONE TO WRITE.
// A refinement failure must never mean the user has to say it again.
```

Dispose the handle on **every** path, including error and timeout (`try/finally`
around `send`/`receive`, the `resolveDaySummarizer` shape at `ipc.ts:4287-4293`).

---

## §4 — Settings, and the nav row that finally earns its place

New section `src/renderer/src/views/SettingsVoice.vue`; nav row added to
`SettingsView.vue` **last**.

```
⚠ THE ORDER IS THE POINT (D76). SettingsView.vue's own docblock (:15-19) records
that five mock sections — General / Agents / Keybindings / Voice / Appearance —
are deliberately NOT rendered because they had nothing behind them, and that
"Agent lock" earned its row by acquiring content first. Adding the Voice row
before its content exists inverts the precedent this app has been keeping since
Phase 3c.
```

Settings to expose:

| Setting | Notes |
|---|---|
| Model | `base.en` (default, 141 MB) / `small.en` (465 MB) — **show the sizes**; D159 |
| Activation | hold / toggle |
| Hotkey | configurable, **disable-able**, shown as a chord |
| Default refinement mode | Verbatim / Clean up (default) / Organize |
| Input device | from `enumerateDevices()` |
| Credential | which BYOK profile refinement uses |

Channels follow the **`agent-lock:*` group shape** (`ipc.ts:66`, `:70`, `:73`) —
a dedicated group, **not** a generic key/value bag.

### The disclosure belongs where the mode is chosen

```
⚠ NOT BURIED IN SETTINGS (VoicePlan §5). Clean up and Organize send transcript
TEXT to an LLM on the user's own key — the moment refinement is enabled, what
was said leaves the machine. State it where the mode is picked. Verbatim +
local whisper is the offline floor and must remain ONE setting change away.
```

---

## §5 — Verification

### Deterministic

```
npm run typecheck                                    # 0
npx vitest run                                       # count printed; NEVER --reporter=basic
npm run grep:secrets                                 # clean

grep -n "onUsage" src/main/services/voiceRefine.ts        # wired (contrast: ipc.ts:4274 wires none)
grep -rn "fetch(" src/main/services/voiceRefine*.ts       # ZERO — createApiSession only
grep -rn "F25" src/main/services/voiceRefine.ts           # the note at the write site
grep -rn "logger\." src/main/services/voiceRefine*.ts     # review EVERY hit
node -e "const ts=require('typescript'),fs=require('fs');const p='src/main/services/storage.ts';const sf=ts.createSourceFile(p,fs.readFileSync(p,'utf8'),ts.ScriptTarget.Latest,true);let i=null;const w=n=>{if(ts.isVariableDeclaration(n)&&n.name.text==='MIGRATIONS')i=n.initializer;ts.forEachChild(n,w)};w(sf);console.log(i.elements.length)"   # 20
```

### Runtime — on the INSTALLED app, per D158's reasoning

The dev instance has **0 credential profiles**; the installed app
(`%APPDATA%\chorus-app`) has **2**. A refinement drive against the dev build
finds no credential and reads as a broken feature.

1. **A real billable call.** Clean up on a real credential produces **better
   text than Verbatim on the same audio**. Paste both.
   ⚠ **A stubbed transport cannot show this** — D153 shipped a prompt defect
   that every unit test passed.
2. **Spend recorded.** The `dispatches` row exists with non-null
   `tokens_in`/`tokens_out`, a cost **derived from counts**, and `tokens_source`
   set. Dump the row.
3. **Absent usage.** Force a response with no `usage` frame → the row records
   **NULL**, not `0`.
4. **Invention check fires.** Dictate a sentence with a number and an identifier
   (e.g. *"bump `retry_count` to seven in `apiSession.ts`"*); if a refinement
   ever drops one, the **original** is injected.
5. **Fallback.** Pull the network mid-refinement → **original** injected, user
   told refinement failed, **dictation not lost**.
6. **Verbatim is offline.** Network off → Verbatim dictation works end to end.
7. **Settings persist** across a restart; the nav row is present and populated.

### What a reviewer should distrust

- Verbatim implemented as a "change nothing" prompt.
- `preservesFacts` written as a prompt instruction with no code behind it.
- A digit check that compares refined→original (backwards) and so rejects the
  legal *"twenty twenty six"* → *"2026"* normalisation.
- Absent usage stored as `0`.
- A `catch` that logs the transcript it failed on.
- The nav row added before its section had content.
- A refinement drive run against the **dev** build (0 credentials) and reported
  as "no council/credential configured" rather than as a wrong venue.

# ImplementationSpec 3c-5 — Settings and Council

**Normative for:** [`../Tasks/Task-3c-5.md`](../Tasks/Task-3c-5.md). `docs/design/v2/Chorus Settings
Providers.dc.html` and `docs/design/v2/Chorus Council.dc.html` win on appearance; the four
invariants in §3 outrank both.

## 1. Gate: the council mock — ✅ SATISFIED

```bash
test -f "docs/design/v2/Chorus Council.dc.html" || { echo "BLOCKED — D72"; exit 1; }
```

**Discharged 2026-07-26.** The mock exists (69,011 B) and passed coordinator review on all five
invariants — see `Task-3c-5.md`. The gate stays in the doc because a task doc is read by whoever
executes it, and the command is still the correct first action.

### 1a. What the mock adds beyond the prompt, and what to build because of it

The delivered design answers the three questions the prompt flagged as the real work, and its
answers are **more opinionated than the prompt asked for**. Build them:

- **A five-stop phase track** — `positions → critique → arbitration → synthesis → done`, rendered
  as discrete stops with an explicit round counter, **not a progress bar**. The mock's own sample
  transcript argues the reason and it is worth preserving: a bar implies a rate that cannot
  honestly be estimated over a ~14-minute run. **This is the load-bearing progress affordance**
  and is the single largest new component in the task.
- **Motion lives in the phase track, not in the roster.** Per-member state is a **stable
  `StateMarker`, never a per-member spinner** — four independent animations compete for exactly
  the attention the screen is trying to conserve. ⚠ This is a design ruling that binds 3c-1's
  no-animation rule for `StateMarker` **into the council view too**: do not add a spinner variant.
- **A roster legend**, so the marker vocabulary is readable without prior knowledge.
- **Refused turns render as transcript ROWS, not gaps** — see `Task-3c-5.md` §invariant 3. New
  behaviour relative to the shipped view, and in scope.
- **A `next-up` placeholder** in the transcript, so a waiting round reads as waiting rather than
  as finished.
- **An accounting block that states its own limit** — including cost's *"true total is at least
  this"*, which is **F39's under-reporting made visible**. Adopt the wording.

**⚠ The mock contains a state switcher** (`<!-- mock state switcher (design artifact — not part
of the app) -->`). It is scaffolding for viewing the six states in one file. **Do not build it.**

### 1b. Three new tokens the council mock introduces

Verified by diffing its color set against the four previously-swept mocks. **None is a new
*state* color, so the four-shape vocabulary is untouched** — that was the risk and it did not
materialise:

| Value | Role | Token name |
|---|---|---|
| `#5EA2E8` | a **fourth spine color** (blue), identical geometry to the project rail's 2px spine — used per roster member | `--color-spine-blue` |
| `#333D48` | dimmed logo-bar tone, empty-state glyph at `opacity:.5` | `--color-glyph-dim-mid` |
| `#3E4954` | dimmed logo-bar tone, empty-state glyph | `--color-glyph-dim-high` |

**These belong in 3c-1's `@theme` block**, not in a council-local style. `ImplementationSpec-3c-1.md`
§2 already instructs a sweep of the other mocks and requires reporting additions — **these three
are that report, delivered early**, so 3c-1 can add them with the rest rather than 3c-5
discovering them at the end of the phase.

## 2. Settings

`SettingsView.vue` (73 lines) is the shell and was **built to the design's skeleton in Task 3-4
on purpose** — expect to recolor, not to rearrange. If it seems to need rearranging, that is a
finding worth reporting: it means the 3-4 assumption did not hold.

`SettingsProviders.vue` is **1,171 lines** — the largest file in the app. Work **section by
section against the mock**, not by global search-and-replace of color classes. It contains:
provider configs, the model catalog, and the council-member management surface from 3b-2.

**Preserve exactly, because each is a normative ruling wearing a UI:**

- **The council member's model input is free text with an additive `<datalist>`** — D56's third
  enforcement site. **Never a closed `<select>`.** The same rule as `LaunchDialog`'s, and the
  same likely mistake.
- **`model` and `resolvedModel` stay two visibly distinct things.** Collapsing them in the UI is
  how a back-write into rank 1 gets authored by a later reader; "NULL, inheriting" and
  "explicitly set to the route default" must remain tellable apart.
- **`params_json` is write-only inbound** — settable at create, never echoed back. A restyle
  must not add a "current value" display; there is nothing to display and the wire refuses to
  carry it.
- **The `credential:delete` refusal names both blockers distinctly** (launch profiles **and**
  council members), so the user learns what to remove. Do not merge them into one count.

`SettingsCredentials.vue` — the mock is "Providers **& Keys**", so parts are covered. Where it is
not, apply token conformance and say so. **No masked preview, no hint, no length** for any
credential: D33 clause 3 admits no exception, and a "helpful" `••••1234` is a real leak.

## 3. The council view's four invariants

Restyle freely **around** these; changing any one is out of scope for a design phase.

| # | Invariant | Where | Why it outranks the mock |
|---|---|---|---|
| 1 | The F27 redaction wording, **verbatim** | `CouncilView.vue:31–33` | It is the only sentence this feature may ship about redaction, and it was written to refuse "your brief is safe". Shortening it makes a claim the code cannot honour. |
| 2 | The standing caveat **above** the synthesis, unconditional, not dismissible | `:213–219` | CR-3b.0 produced sound rulings containing four compile errors. The caveat is the mechanism that keeps that visible. |
| 3 | An unavailable member is **shown and explained** | `:109–114` | Assembly refuses the run over it; hiding it makes the refusal unreadable. |
| 4 | **No number without its denominator** | `:228–265` | D55, one layer up. A cost rendered alone re-introduces at the pixel level the defect the wire schema forbids. |

**And the negative rule: nothing may imply the findings are verified.** No `✓`, no green success
chrome, no "complete" badge that reads as "correct". **If the new mock draws any of these, the
rule wins and the deviation goes in the report** — a mock cannot authorise a claim the feature is
forbidden to make.

## 4. The parts of the council view most worth the redesign

The design prompt named three, and they are where the value is:

- **The phase indicator.** Five phases (`Positions (blind)` → `Critique (anonymised)` →
  `Arbitration` → `Synthesis` → `Done`) plus a round number, currently one line of grey text
  and the only progress affordance across a **~14-minute** run.
- **The roster's live per-member state.** Currently static. During a run, the roster is what the
  user watches. **Use `StateMarker`** — extend it before inventing a second vocabulary.
- **The transcript.** Several members stream **concurrently** in a blind round, so interleaved
  authorship must be unambiguous.

**⚠ Message grouping is keyed on (member, phase, round) and must not be touched.** That is
**F37**'s fix: a live run rendered **291 fragments where 8 turns belonged** because the store
matched each delta against only the most recent block. `stores/council.test.ts` holds the
regression test. **Restyle the block; do not touch what defines a block.**

## 5. Verification

```bash
npm run typecheck && npx vitest run && npm run grep:secrets
grep -rn "neutral-\|sky-\|zinc-\|slate-\|gray-\|red-[0-9]\|amber-[0-9]" src/renderer/src/views/    # expect nothing
git diff --stat src/renderer/src/stores/ src/main/services/council*                                # expect: empty
```

Invariant greps (each must still match):

```bash
grep -n "cannot redact values an agent derives" src/renderer/src/views/CouncilView.vue
grep -n "model deliberation, not verified fact" src/renderer/src/views/CouncilView.vue
grep -n "membersPlanned\|turnsRefused\|usageAbsent" src/renderer/src/views/CouncilView.vue
```

**Runtime, over CDP:** the six council states, the two settings views, and then **the 14-surface
close-out pass**.

**⚠ The close-out pass is the phase's real acceptance test, not this task's.** An app-wide token
change is only verified when every surface has been re-checked **after the last change lands** —
tasks 3c-1 … 3c-4 each verified their own surfaces against a codebase that has since moved. Any
regression found here belongs to the phase, not to whoever finds it.

**Cost: `< $0.05`.** Use a short stub brief — D71 puts a real frontier run at ~$0.83 and ~14
minutes, and this is a styling check. Report a **bound** rather than a tidy figure if any turn
returns no usage frame (**F39**: `kimi-k3` reports none at all, so any run including it
under-reports).

## 6. Deliberately out of scope

- **Council output quality** — the truncation is fixed (D71) but verdict-token compliance is
  unmeasured on the frontier roster, the dissent matcher is noisy (F38), and the dissent heading
  is duplicated (F40). **All of it is Phase 3e.** This task changes pixels only.
- **The worktree panel** — 3c-4's declared gap; unchanged here.
- **Per-project cost in settings** — D76; no source exists.

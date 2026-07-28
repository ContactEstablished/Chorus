# Task 3c-5 — Execution Prompt (paste into a fresh session)

*Authored 2026-07-28 against the code at `87e64c2`, not merely against the task docs. **This
matters more here than it did for 3c-4, and for a reason no earlier task in this phase faced:
PHASE 3d LANDED IN BETWEEN.** `Task-3c-5.md` and `ImplementationSpec-3c-5.md` were written at
`1cf23ff`; **every frozen number they state is now wrong**, two of 3c-5's own files grew new
regions that no mock draws, and the launch dialog gained a control that D81 said did not exist.
Every fact in the tables below was re-run this session.*

---

## Role

You are the **Coordinator** for **Chorus — Phase 3c (Design Adoption), Task 3c-5: Settings and
Council — `SettingsView`, `SettingsProviders`, `SettingsCredentials`, `CouncilView`**. **This task
closes the phase**, which means it also owns the 14-surface close-out pass over surfaces other
tasks built.

- **Repo root:** `C:\Projects\ContactEstablished\Chorus`
- **Expected branch:** `main`. **Confirm it; do not switch or create a branch without instruction.**
- **Expected HEAD at start:** `87e64c2` *("Chorus stops borrowing Electron's icon…")*.
- **Platform:** Windows 11, PowerShell primary. A Bash tool is also available; each takes its own
  syntax.

## Goal

Finish the phase: settings against its mock, then the council view against D72's mock. When this
lands, every surface in Chorus speaks the design language — which is the stated reason 3c went
first: Matthew wants to reach the point where he can use Chorus to develop Chorus.

## ⚠ READ THIS FIRST — PHASE 3d LANDED BETWEEN 3c-4 AND THIS TASK

**This is the first task in the phase whose baseline moved for reasons outside the phase.** Tasks
3d-1 … 3d-4 shipped out of order at Matthew's request (they were blocking his daily use of the
app), and they touched two of the four files you own. **The purity contract still binds you — but
its numbers do not.**

### The frozen numbers are all different now. These are the correct ones.

| | `Task-3c-5.md` / `Phase-3c-Overview.md` say | **Actual at `87e64c2`** | Moved by |
|---|---|---|---|
| `IpcChannel` keys | 56 | **57** | 3d (`model-shortlist:set`) |
| `ipcMain.handle(` in `ipc.ts` | 51 | **52** | 3d |
| `ipcMain.handle(` in `index.ts` | 0 | **0** | — must stay 0 |
| `sqliteTable(` | 15 | **16** | 3d (`model_shortlist`, D85) |
| `MIGRATIONS.length` | 11 | **12** | 3d (v12, D85) |
| vitest | 941 / 29 files | **1007 / 30 files** | 3d |

**Your task freezes all six at the right-hand column.** The rule is unchanged and still absolute:
**3c-5 adds no channel, no handler, no table, no migration, and reshapes no payload.** D80's
reshape exception was 3c-3's and is spent. If any number moves, **stop and report — do not absorb
it.**

### D90 revised D81. The launch dialog now HAS a model picker.

3c-4 deliberately did not draw the mock's model dropdown, and D81 said the element did not exist.
**D90 then built one** — a **closed `<select>`** over `model_shortlist` (falling back to
`model_catalog`), whose null default means *"use whatever main resolves"*. **This does not reopen
D48**, which refused a *free-text* field standing beside the route's own default; a closed list
main already owns is a different thing, and the struck `<datalist>` check **stays struck**.

**Why you care:** `LaunchDialog.vue` is **not your file** and you must not touch it — but it is
**surface 9** of your close-out pass, and it no longer looks like it did when 3c-4 screenshotted
it. Re-screenshot it; do not assume 3c-4's evidence still describes it.

## ⚠ THE MOCK TELLS YOU TO DO ONE FORBIDDEN THING. DO NOT DO IT.

**`docs/design/v2/Chorus Settings Providers.dc.html` draws masked key previews.** Verbatim from
the mock this session: `sk-ant-…Xq4F`, `sk-proj-…9dKm`, `sk-proj-…T2wa`, `sk-or-…v81A`, each
beside a "key verified" line.

**D33 clause 3 admits no exception, and `ImplementationSpec-3c-5.md` §2 states it directly: no
masked preview, no hint, no length, for any credential.** A `••••1234` is a real leak — it
narrows the search space for anyone who sees a screenshot, a screen-share, or a support ticket.

**The codebase already refuses this and says so in its own source.** `SettingsCredentials.vue:12`
("there is no key, no fingerprint, no length, no masked preview") and **`:176`** (*"NO key-hint
column — the design mock's masked hint is D33-forbidden"*). **Those comments are load-bearing.
Preserve them.**

| Ruling | |
|---|---|
| The masked previews | ❌ **DO NOT ADOPT.** The rule outranks the mock — the same precedence `ImplementationSpec-3c-5.md` §3 sets for verification chrome in the council view. |
| Everything else about those rows | ✅ adopt: the layout, the "verified Nh ago" line, the default/test-key affordances, the spacing. |
| Your report | Must **name this deviation explicitly**. A phase whose milestone is "visually indistinguishable" has to say out loud where it deliberately is not. |

**⚠ This is the single most likely way this task ships a security regression**, because the
instruction to match the mock is the task's whole point and this is the one place matching it is
wrong.

**Two smaller cases of the same shape, both D76:**

- **The mock's settings nav has six entries** (General · Providers & keys · Agents · Keybindings ·
  Voice & dictation · Appearance). **Chorus has one live entry**, and `SettingsView.vue:9-11`
  records why: *"the mock's other sections appear when their phases build them — no dead nav
  entries."* **Do not build the other five.** Restyle the one that exists.
- **The mock's status bar shows `neo4j :7688`.** That is **Phase 6** and it does not exist. D76:
  render what the data supports, omit the rest, never a placeholder.

## ⚠ THE UNMOCKED COUNT IS THREE, NOT TWO — AND TWO OF THE THREE ARE INSIDE YOUR OWN FILES

D83 amended the milestone from one unmocked surface to two (`WorktreePanel.vue`,
`EmptyState.vue`). **Authoring this prompt against the code found a third and a fourth, both
inside `SettingsProviders.vue`, and both invisible to the mock because they did not exist when it
was drawn:**

| Region | Where | Mock coverage | Held to |
|---|---|---|---|
| **The council-member management surface** (3b-2) | `SettingsProviders.vue` | **ZERO** — `grep -ci "council"` over the mock returns **0** | token-and-primitive conformance |
| **The model shortlist section** (3d / D85) | `SettingsProviders.vue`, `data-shortlist-section` (`:917`) | **ZERO** — `grep -ciE "shortlist\|favourite\|star\|pin"` returns **0** | token-and-primitive conformance |

**`SettingsProviders.vue` is 1,334 lines and the mock describes maybe half of it.** Work section
by section and **be explicit in your report about which sections were diffed against a mock and
which were only conformed.** Presenting the whole file as "matches the mock" would be false.

**⚠ The shortlist's model input is FREE TEXT with an additive `<datalist>` and must stay that
way** — D85 forbids a foreign key onto `model_catalog` precisely so a user can shortlist an id no
refresh has ever returned. Same rule as the council member's model input (`ImplementationSpec-3c-5.md`
§2). **Never a closed `<select>` in either place.** *(The launch dialog's picker is a closed
select over the shortlist — that is D90, a different control with a different job. Do not
"harmonise" them.)*

## ⚠ The three council tokens are ALREADY in `main.css`. Do not add them again.

`ImplementationSpec-3c-5.md` §1b reports three tokens the council mock needs and instructs that
they belong in 3c-1's `@theme` block. **3c-1 shipped them.** Verified this session:

```
main.css:146  --color-spine-blue:        #5EA2E8;
main.css:157  --color-glyph-dim-mid:     #333D48;
main.css:158  --color-glyph-dim-high:    #3E4954;
```

**The `@theme static` block is 3c-1's and no later task edits it.** If the council mock needs a
value that is not there, **report it — do not add it.** (64 `--color-*` tokens exist today.)

## Ground yourself first — before editing anything

**Read, in this order:**

1. `CLAUDE.md` — typed Zod IPC, plain objects across the bridge (D14).
2. `docs/Features/Foundation/Tasks/Phase-3c-Overview.md` — the purity contract, **D73**, **D76**,
   **D77**, the 14-surface inventory, the milestone. **Read its frozen numbers through the
   correction table above.**
3. `docs/Features/Foundation/Tasks/Task-3c-5.md` — the four council invariants.
4. `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-3c-5.md` — **normative except
   where this prompt overrides.** Where it and the task doc differ the spec wins; where either
   differs from the mock, **the mock wins (D73)** — *except* where a rule outranks the mock, which
   is the masked-preview case above and the verification-chrome case in §3.
5. `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-3b-4.md` §4 — the council
   view's three non-styling rendering rules.
6. `docs/design/v2/Chorus Settings Providers.dc.html` (16,484 B) and
   `docs/design/v2/Chorus Council.dc.html` (69,011 B) — the two authorities.
7. `src/renderer/src/assets/main.css` (3c-1's tokens) **and `src/renderer/src/assets/overlays.css`
   (3c-4's shared overlay anatomy, 341 lines)** — **the second file did not exist when your task
   docs were written.** Scrim, panel, keycaps, fields, cards and segmented controls already have a
   home. **Reuse it; do not re-derive it, and do not fork a second copy for settings.**
8. `src/renderer/src/components/TitleBar.vue`, `ProjectRail.vue`, `StatusBar.vue` — the house
   idiom: scoped `<style>`, semantic class names, `var(--token)`, zero Tailwind palette utilities.

**Ground facts — all re-verified 2026-07-28 at `87e64c2`:**

| Fact | Where | Status |
|---|---|---|
| `SettingsView.vue` **73** · `SettingsProviders.vue` **1,334** · `SettingsCredentials.vue` **329** · `CouncilView.vue` **273** | `views/` | ✅ — **`SettingsProviders` grew 1,171 → 1,334 in 3d**; spec line refs to it are stale |
| Stock-palette hits to remove: **SettingsProviders 118 · CouncilView 38 · SettingsCredentials 31 · SettingsView 5** = **192** | grep | ✅ your whole job, numerically |
| Raw hex in `views/`: **0** | grep | ✅ — must still be 0 at close |
| `overlays.css` exists (341 lines), authored by 3c-4 | `assets/` | ✅ **reuse** |
| The three council tokens are present | `main.css:146/157/158` | ✅ **do not re-add** |
| F27 wording | `CouncilView.vue:33` | ✅ invariant 1 |
| Standing caveat | `CouncilView.vue:217` | ✅ invariant 2 — stays **above** the synthesis |
| Unavailable-member explanation | `CouncilView.vue:113` | ✅ invariant 3 |
| Accounting denominators (`membersPlanned` `:234`, `turnsRefused` `:241`, `usageAbsent` `:246`) | `CouncilView.vue` | ✅ invariant 4 |
| `SettingsCredentials.vue` already refuses the masked hint, in a comment | `:12`, `:176` | ✅ **preserve the comments** |
| `council_members` table is **EMPTY** — zero rows | real DB | ⚠ **see the cost section; it changes how you verify** |
| Baseline: **1007 tests / 30 files**, all passing | `npx vitest run` | ✅ |

## ⚠ Pre-existing changes — do not touch

`git status` should be clean apart from untracked `docs/Features/Foundation/Investigations/` and
`_verify/` (both gitignored or unrelated). **Do not revert anything and do not fold unrelated
paths into your commit.**

## Implementation scope

### Edit — and nothing else

- **`src/renderer/src/views/SettingsView.vue`** — the shell. Built to the design's skeleton in
  Task 3-4 *on purpose*, so expect to recolor rather than rearrange. **If it seems to need
  rearranging, that is a finding worth reporting** — it means the 3-4 assumption did not hold.
- **`src/renderer/src/views/SettingsProviders.vue`** — the largest file in the app. Section by
  section. Two of its regions are unmocked (above).
- **`src/renderer/src/views/SettingsCredentials.vue`** — mock where covered, conformance
  elsewhere. **No masked preview, ever.**
- **`src/renderer/src/views/CouncilView.vue`** — against D72's mock, preserving all four
  invariants.

**Create** only if the council mock introduces a component with no existing home — the **five-stop
phase track** is the likely one. **Prefer extending `StateMarker` over inventing a second state
vocabulary.**

### What the council mock adds beyond a restyle, and which of it to build

Per `ImplementationSpec-3c-5.md` §1a — all in scope:

- **A five-stop phase track** — `positions → critique → arbitration → synthesis → done`, discrete
  stops plus an explicit round counter, **not a progress bar**. A bar implies a rate that cannot
  honestly be estimated across a ~14-minute run. **This is the single largest new component.**
- **Motion lives in the phase track, not the roster.** Per-member state is a stable `StateMarker`,
  **never a per-member spinner** — four competing animations spend exactly the attention the
  screen is trying to conserve. **Do not add a spinner variant to `StateMarker`.**
- **A roster legend**, so the marker vocabulary reads without prior knowledge.
- **Refused turns render as transcript ROWS, not gaps.** New behaviour relative to the shipped
  view, and deliberately in scope — it is invariant 3's spirit applied where the code left a gap.
- **A `next-up` placeholder**, so a waiting round reads as waiting rather than as finished.
- **The accounting block states its own limit**, including cost's *"true total is at least this"*
  — **F39's under-reporting made visible in the UI**. Adopt the wording.
- **⚠ The mock contains a state switcher** (`<!-- mock state switcher (design artifact — not part
  of the app) -->`). **Do not build it.**

### The four council invariants — restyle around them, never through them

| # | Invariant | Where |
|---|---|---|
| 1 | F27 redaction wording, **verbatim** | `CouncilView.vue:33` |
| 2 | Standing caveat **above** the synthesis, unconditional, not dismissible | `:217` |
| 3 | An unavailable member is **shown and explained**, never hidden | `:113` |
| 4 | **No number without its denominator** (D55) | `:234`–`:262` |

**And the negative rule: nothing may imply the findings are verified.** No `✓`, no green success
chrome, no "complete" badge that reads as "correct". CR-3b.0 is the standing evidence — sound
rulings containing four compile errors, because the council had the brief and not the repo. **If
the mock draws any of this, the rule wins and the deviation goes in your report.**

### The three things this task must get right

1. **The F27 sentence is byte-identical after your change.** Diff it explicitly. A restyle that
   "tightened the copy" has changed a security claim, and this is the likeliest place in the whole
   phase for that to happen.
2. **Message grouping is keyed on `(member, phase, round)` and must not be touched.** That is
   **F37**'s fix: a live run rendered **291 fragments where 8 turns belonged**. Restyle the block;
   do not touch what *defines* a block. `stores/council.test.ts` holds the regression test — **if
   it goes red, stop and report. It is not a test to adjust.**
3. **`model` and `resolvedModel` stay two visibly distinct things** in settings. Collapsing them is
   how a back-write into rank 1 gets authored by a later reader: *"NULL, inheriting"* and
   *"explicitly set to the route default"* must remain tellable apart. Likewise **`params_json` is
   write-only inbound** — settable at create, never echoed back. **Do not add a "current value"
   display; the wire refuses to carry it.** And **`credential:delete`'s refusal names both
   blockers distinctly** (launch profiles *and* council members) — do not merge them into one
   count.

## Strict non-goals

- **Do not adopt the mock's masked key previews** (D33 clause 3), **do not build the five dead nav
  entries**, **do not render `neo4j :7688`** (D76).
- **Do not touch `LaunchDialog.vue`, `CommandPalette.vue`, `EmptyState.vue`, `WorktreePanel.vue`**
  — 3c-4's, done. Screenshot them; do not edit them.
- **Do not touch anything 3c-2 or 3c-3 built** — `TitleBar.vue`, `ProjectRail.vue`,
  `StatusBar.vue`, `FilmstripRenderer.vue`, `LayoutRenderer.vue`, `TerminalPane.vue`,
  `StateMarker.vue`, `App.vue`.
- **Do not edit 3c-1's token block or remove `@theme static`.** Missing token → **report it**.
- **Do not change council orchestration, the store, or the protocol** — `stores/council.ts`,
  `councilCore.ts`, `councilService.ts` are untouched. `git diff --stat` over them must be empty.
- **Do not "fix" council output quality** — the dissent matcher's noise, the duplicated
  `## Dissents preserved` heading (F40), verdict-token compliance. **All of that is Phase 3e.**
  This task changes pixels.
- **Do not add an IPC channel, handler, table, migration, or payload field.** **57 / 52 / 0 / 16 /
  12** are frozen.
- **Do not change store logic.** No `stores/*.test.ts` in `git diff --stat`.
- **Do not add a dependency.** Anything needed → stop and ask.
- **Do not push or open a PR unless explicitly asked.**

## Required workflow

1. **Ground** — read the eight documents and verify the ground-fact table against the code.
2. **Implement in order**: `SettingsView.vue` → `SettingsProviders.vue` (section by section) →
   `SettingsCredentials.vue` → `CouncilView.vue`.
3. **Spec review** — re-read `ImplementationSpec-3c-5.md` against your diff through this prompt's
   corrections. Did a masked preview appear? Did a dead nav entry? Did the F27 sentence move? Is
   `(member, phase, round)` untouched? Any stock Tailwind utility left?
4. **Code-quality review** of your own diff.
5. **Resolve findings**, then **verify** (below). **The visual pass and the close-out pass are not
   optional and are the phase's real acceptance test.**
6. **One intentional commit**, narrated in the repo's established style: a plain-language title,
   then a body a non-technical reader follows first, technical detail second.

## Verification

### Build gates — all must pass

```bash
npm run typecheck && npx vitest run && npm run grep:secrets
```

**Expected:** typecheck **0** · vitest **1007**, **never fewer**, across **30 files** ·
`grep:secrets` **clean across 6 patterns**. **No pre-existing test may be edited.**

### Grep gates — with expected counts

```bash
grep -rn "neutral-\|sky-\|zinc-\|slate-\|gray-\|red-[0-9]\|amber-[0-9]\|emerald-\|green-[0-9]" src/renderer/src/views/   # expect NOTHING (was 192)
grep -rnE "#[0-9a-fA-F]{6}\b" src/renderer/src/views/                  # expect NOTHING
git diff --stat src/renderer/src/stores/ src/main/services/council*    # expect EMPTY
git diff --stat src/renderer/src/components/                           # expect EMPTY
grep -oE "^\s+[A-Za-z]+: '[a-z0-9:-]+'" src/shared/ipc.ts | wc -l      # expect 57 — UNCHANGED
grep -c "ipcMain.handle(" src/main/ipc.ts                              # expect 52 — UNCHANGED
grep -c "ipcMain.handle(" src/main/index.ts                            # expect 0  — MUST stay zero
grep -c "sqliteTable(" src/main/db/schema.ts                           # expect 16 — UNCHANGED
```

`MIGRATIONS.length` must remain **12** (`src/main/services/storage.ts`).

**The invariant greps — each must still match:**

```bash
grep -n "cannot redact values an agent derives" src/renderer/src/views/CouncilView.vue
grep -n "model deliberation, not verified fact" src/renderer/src/views/CouncilView.vue
grep -n "membersPlanned\|turnsRefused\|usageAbsent" src/renderer/src/views/CouncilView.vue
```

**And the negative grep that this prompt adds** — no masked-hint affordance may appear:

```bash
grep -rniE "sk-ant|sk-proj|sk-or-|maskedKey|keyHint|••••" src/renderer/src/views/   # expect NOTHING
```

### G2 — the visual pass, on the real running app

**Settings:**

- [ ] **Settings — Providers**, against its mock, section by section. **Say which sections were
      mock-diffed and which were conformance-only** (the council-member surface and the shortlist
      section are the latter).
- [ ] **Settings — Credentials**, with the masked-preview deviation stated.

**Council — all six states from the design prompt.** ⚠ **`council_members` is empty**, so read
the cost section below before planning this.

- [ ] empty · [ ] no members configured · [ ] running mid-deliberation · [ ] partial run ·
      [ ] complete with findings · [ ] refused/error

**⚠ THE PHASE CLOSE-OUT PASS — re-screenshot ALL 14 surfaces** in the Overview's inventory and
confirm nothing regressed while later tasks moved. **This is the F15 lesson's whole point:** an
app-wide token change is only verified when every surface has been looked at **after the last
change lands**, not after its own task. Tasks 3c-1 … 3c-4 each verified against a codebase that
has since moved **twice** — once for 3c-4 and once for all of Phase 3d.

**⚠ Surface 9 (launch dialog) changed after 3c-4 verified it** — D90's model picker. **Surface 11
(Settings — Providers) gained the shortlist section.** Neither is covered by 3c-4's evidence.

### Council behaviour re-check

- [ ] Streaming still renders into the restyled view, and the findings `.md` still lands beside
      the brief.
- [ ] **Esc still refuses to leave while a run is in flight** (`council.running` owns Esc).
- [ ] A **partial** run still **reads** as partial.
- [ ] The F37 grouping still holds — turns render as turns, not as hundreds of fragments.

### ⚠ Cost envelope — `< $0.05`, and the roster is empty, which changes the plan

**`council_members` has ZERO rows.** The D71 frontier roster is gone (the DB was rebuilt
2026-07-27); the three OpenRouter credential profiles survive and are verified. **A frontier run
is ~$0.83 and ~14 minutes (D71) and would blow this task's envelope by 16×.**

**The sanctioned approach, in this order:**

1. **The six visual states cost `$0.00`.** The view renders from the **live broadcast**, so drive
   the store over CDP with synthetic council events and capture all six — including `refused` and
   `error`, which a real run may not even produce on demand. **This is better evidence for a
   styling task than a real run, not worse.** Say plainly in the report that these six are
   synthetic.
2. **One CHEAP real run for the behaviour re-check**, on a **stub brief of a few lines** and a
   **minimal cheap roster you create for the purpose** (e.g. `qwen/qwen3-coder` at $0.30/M in ·
   $1.00/M out). That proves streaming, the F37 grouping and the findings file end-to-end for
   **cents**.
3. **Do NOT rebuild D71's frontier roster here.** That belongs to **Phase 3e**, which has the
   budget and the measurement questions that need it.

**Report a BOUND, not a tidy figure, if any turn returns no usage frame** — F39: `kimi-k3` reports
none at all, so any run including it under-reports. State the measured cost against the `< $0.05`
envelope.

### Runtime mechanism

**CDP on `--remote-debugging-port=9222`.** Launch with `_verify/launch.ps1` (it restores `PATH`/
`ComSpec`, which the harness strips, and returns the wrapper PID). Working drivers: `_verify/3c-1-cdp.js`
(`eval`, `shot`, `media`, `mediaeval`), `_verify/3c-3-cdp.js` (`shotclip <out> <x> <y> <w> <h> <scale>`),
`_verify/3c-3-hover.js` (real `Input.dispatchMouseEvent` + screenshot **in the same session**),
`_verify/3c-3-sample.ps1 -In <png> -Points 'x,y,label;…'`. `_verify/` is gitignored; reuse and
extend freely.

⚠ **Harness facts that will bite you:**

- **F17 — electron-vite does NOT hot-restart the main process.** This task touches **no** main
  code, so renderer HMR is enough; reload rather than cold-boot when iterating.
- **`Emulation.setEmulatedMedia` is CDP-SESSION-scoped** — set and read in one session.
- **`:hover` does not survive a socket close** — dispatch and capture in the same session.
- **Tailwind needs a beat to regenerate** after a CSS-only edit. For anything load-bearing, **cold
  boot rather than trusting HMR.**
- **⚠ `window.confirm` BLOCKS the renderer under CDP.** Stub it in the evaluated expression and
  restore in a `finally` (see `_verify/3c-3-expr-closemine.js`).
- **F20/F31 — the real user-data-dir is `C:\Users\matth\AppData\Roaming\chorus`.** For DB
  evidence run `ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe <script>` from
  the repo root (so `better-sqlite3` resolves), use **forward slashes**, and stop the app first so
  the WAL checkpoints. **A `--user-data-dir` copy reaches the DB but NOT the DPAPI context** —
  copy `Local State` beside `chorus.db` or every credential blob is undecryptable.

## Failure honesty

**If any verification command fails for an unrelated environment reason, capture the exact output,
explain what happened, and do not claim success. A gate that could not be run is not a gate that
passed.**

**This applies with force to the close-out pass.** Fourteen surfaces is a lot to screenshot and
exactly the kind of list that gets reasoned about instead of performed. **If you could not
actually capture one, say which and why, and mark it UNPROVEN.** Do not substitute an inference
from the code.

## Final reporting requirements

1. **Status** — `DONE` · `DONE_WITH_CONCERNS` · `NEEDS_CONTEXT` · `BLOCKED`.
2. **Files changed**, with `git diff --stat`. Confirm it lists only the four views (plus any
   extracted council component), and that **no `stores/*`, no `components/*`, no
   `main/services/council*` appears**.
3. **The frozen numbers**: `IpcChannel` **57**, `ipcMain.handle(` **52 / 0**, `sqliteTable(`
   **16**, `MIGRATIONS.length` **12** — all unchanged. **If any moved, say so loudly.**
4. **Build results** — typecheck, the vitest figure (**1007**, never fewer, 30 files),
   `grep:secrets`, and every grep gate count including the **192 → 0** stock-palette sweep and the
   masked-hint negative grep.
5. **The four council invariants**, each verified **by grep AND by screenshot** — present in the
   source and legible on screen. **Quote the F27 sentence in your report** and confirm it is
   byte-identical.
6. **The six council states**, with screenshots, and an explicit statement of **which were
   synthetic and which were a real run**.
7. **The 14-surface close-out pass**, surface by surface, with the two that changed since 3c-4
   (launch dialog, settings providers) called out separately.
8. **The masked-preview deviation, named as a deliberate deviation from the mock**, with the rule
   that outranks it.
9. **Which regions of `SettingsProviders.vue` were mock-diffed and which were conformance-only** —
   the council-member surface and the shortlist section are unmocked, and the milestone's unmocked
   list is therefore **four regions across three files**, not two surfaces.
10. **Cost** — measured against `< $0.05`, as a bound if any turn reported no usage.
11. **Non-goals confirmation** — no channel/handler/table/migration/payload change, no store logic
    or store test changed, `stores/council.test.ts` green and unedited (**F37 intact**), council
    orchestration untouched, `@theme static` intact, no dead nav entry, no `neo4j` chip, nothing
    touched in 3c-2/3c-3/3c-4 territory.
12. **The phase milestone, assessed** — this task closes Phase 3c, so state whether the milestone
    is met, and restate the known gaps (`WorktreePanel.vue`, `EmptyState.vue`, the council-member
    surface, the shortlist section) rather than letting them disappear.
13. **Residual risks and anything you had to decide** that these documents did not settle.
14. **Final `git status`.**

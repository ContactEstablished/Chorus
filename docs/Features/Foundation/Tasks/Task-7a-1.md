# Task 7a-1 — Vendor Marks

_Phase 7a, task 1 of 3. Authored 2026-08-26 against `3c70e87` ("Release 0.7.8"), on branch
`chorus/Chorus/2be8b104`, which is identical to `main` and `origin/main`. Every `file:line` below was
opened and checked in this authoring session — **this document's fact table is measured, not
inherited**, and where it repeats a number from [`Phase-7a-Overview.md`](Phase-7a-Overview.md) the two
were taken independently and agree._

## Source Of Truth

| Document | Owns |
|---|---|
| `roadmap.md` §6 — **D184** (settled by Matthew, 2026-08-26) · [`Phase-7a-Overview.md`](Phase-7a-Overview.md) §*The decisions this kickoff settles* | **The ruling this task executes.** Faithful vendor marks, monochrome, on the 24-grid, tinted by `currentColor`. It is stated in full under *Goal* below because the roadmap row is written by the architect pass, not by this task |
| [`Phase-7a-Overview.md`](Phase-7a-Overview.md) | The phase's shared ground facts, its **purity contract** (no new IPC channel, no migration, no dependency), the gate numbers every task in 7a runs, and the pre-existing working-tree state. **Where it and this document state the same number, they were measured separately** — if they ever disagree, re-measure rather than picking one |
| `roadmap.md` §6 — **D183(e)** (`roadmap.md:709`) · §7 Phase 7a (`roadmap.md:1948`) | The phase entry that created this task and pre-argued it: *"VENDOR MARKS REPLACE THE TWO-LETTER TILES … The never-colour rule is preserved in full."* **D183(f) explicitly reserved the drawing decision for D184** and took none itself |
| `roadmap.md` §6 — **D38** (`roadmap.md:514`) · `docs/PLAN.md:185` (§7b) | The colour-channel system this task must not break: *"hue = project · icon = provider/agent · state = dot + glow"*, adopted by D38 as *"project identity by hue only; **agent identity by glyph only, never color**"*. **Read both before deciding this task is a design override — the icon channel is already the agent's** |
| `roadmap.md` §6 — **D73** (the mock is the authority) · `ChorusMark.vue:15`–`:22` | The authority being overridden, and **the precedent for overriding it at exactly this scope**: four v2 mocks draw a six-bar Chorus logo, `ChorusMark.vue` draws the correct seven-bar one, and its docblock records why D73 did not settle that |
| `docs/design/v2/Chorus Launch Dialog.dc.html:64`, `:68` | **The mock's own two-letter tile**, inline-styled `18px / radius 3px / #1A2027 / 1px #262D35 / JetBrains Mono 9px / #B9C2CC`. **This is the chrome that survives and the content that does not** — every one of those six values is already a 3c-1 token in `.launch-agent-tile` |
| `src/renderer/src/components/PaneIcon.vue` (182 lines) | **The pattern.** The 24 `viewBox`, `currentColor`, `withDefaults`, and — the part that matters most — the docblock recording where each shape came from and why it was vendored rather than installed |
| [`../ImplementationSpecs/ImplementationSpec-7a-1.md`](../ImplementationSpecs/ImplementationSpec-7a-1.md) | The probe that must run first, the exact insertion points, the component's shape, the CSS ruling, and the runtime checks that decide whether it worked |
| `CLAUDE.md` — the stack lock and **D4** | *"Ask before adding dependencies not named in the stack"*, and *"verify current flags against the tool's own docs/`--help`; don't trust training-data memory."* **The second one is about CLI flags and this task applies it to logos, which move for the same reason and fail the same way** |

## Initial Starting Point — verified 2026-08-26 at `3c70e87`

| Fact | Where | Value |
|---|---|---|
| The tree | `git log --oneline -1` | **`3c70e87` "Release 0.7.8"**, branch `chorus/Chorus/2be8b104`, identical to `main` and `origin/main` |
| The working tree | `git status --porcelain` | **exactly two modified files at kickoff** — `M .mcp.json` (a line-ending artefact) and `M docs/Features/Foundation/roadmap.md` (this session's architect pass) — **and no untracked files.** The only untracked additions since are **this kickoff's own documents** (`Phase-7a-Overview.md`, `Task-7a-{1,2,3}.md`, `ImplementationSpec-7a-{1,2,3}.md`). **None of the above is this task's to revert, commit or absorb**; see Non-Goals |
| The three maps to delete | `LaunchDialog.vue:608` · `FilmstripRenderer.vue:100` · `TerminalPane.vue:80` | all three are `Record<AgentKind, string>` = `{claude:'cc', codex:'cx', grok:'gk', kimi:'km', opencode:'oc'}`. **Identical content, three copies, three docblocks** — `TerminalPane.vue:79` even says *"same codes the filmstrip card uses"* |
| Where they render | `LaunchDialog.vue:882` `<span class="launch-agent-tile">{{ codes[a.name] }}</span>` · `FilmstripRenderer.vue:370` · `TerminalPane.vue:1399` `<span class="pane-tile">{{ codes[props.agent] }}</span>` | three call sites, one per map |
| The picker's grid | `LaunchDialog.vue:872` `<div class="launch-grid">` · `:874` `v-for="a in agents"` · `:877` `class="overlay-card launch-agent"` | the tile is the first child of a `<button>` |
| **⚠ The filmstrip's `'??'` FALLBACK IS REAL** | `FilmstripRenderer.vue:370` renders `agentFor(id) ? codes[agentFor(id) as AgentKind] : '??'`; the prop is typed `agentFor: (id: string) => AgentKind \| undefined` at `:71` | **the only call site that can be handed `undefined`**, and the mark component must never be. See fact 6 |
| The tile chrome | `.launch-agent-tile` `LaunchDialog.vue:1378`–`:1391` (18×18) · `.card-tile` `FilmstripRenderer.vue:535`–`:548` (16×16) · `.pane-tile` `TerminalPane.vue:1926`–`:1939` (16×16) | all three: `flex` centred, `--radius-chip`, `--color-surface-badge`, `1px solid --color-border-badge`, **`color: var(--color-text-badge)`** |
| The one state rule that already re-tints a tile | `FilmstripRenderer.vue:690`–`:694` `.card-done .card-tile` sets `background: --color-surface-badge-dim`, `border-color: --color-border-dim`, **`color: --color-text-muted`** | **it will dim the mark for free**, because `color` is what `currentColor` resolves to. No new CSS |
| The picker's disabled state | `overlays.css:180`–`:185` `.overlay-card:disabled { … opacity: 0.55 }` | a not-found agent's whole card fades, **mark included, for free** |
| The pane header's focus state | `TerminalPane.vue:1618`–`:1624` `.pane-shell:focus-within .pane-header` changes **`background-color` only** | **⚠ the mark's colour does NOT change between focused and unfocused, and never did** — the two letters did not either. Do not go looking for a colour change that has never existed |
| The design tokens | `main.css:61` `--color-surface-badge: #1A2027` · `:62` `--color-surface-badge-dim` · `:97` `--color-border-badge` · `:109` `--color-text-badge` · `:198` `--radius-chip: 3px` | all under `@theme static`. **Untouched by this task** |
| The `labels` maps that **STAY** | `TerminalPane.vue:71`–`:77` · `FilmstripRenderer.vue:88`–`:94` · `palette/commands.ts:49`–`:55` · `AGENT_LABELS` `main/services/notifications.ts:11`–`:17` | four `Record<AgentKind, string>` maps of **display names**, all live. `notifications.ts:6`–`:10` argues the `Record` shape at length: *"D86 added 'kimi' and the COMPILER found this file … That is the property working, not a chore"* |
| **⚠ `LaunchDialog` HARDCODES NO LABEL AT ALL** | `LaunchDialog.vue:520` `label: c.displayName ?? c.agentKind`, and the `codes` docblock at `:600`–`:603` says why: *"the file's standing rule since 3-3/D34f is that nothing here hardcodes an agent's name or label"* | **that asymmetry is deliberate and is not this task's to tidy** |
| The hidden agent | `LaunchDialog.vue:512` `const HIDDEN_AGENTS: readonly AgentKind[] = ['kimi']`, filtered in `toAgentCards` at `:517`; the docblock at `:505`–`:510` calls it *"A PRESENTATION FILTER, NOT A REMOVAL … an EXISTING kimi session … still attaches, renders and resumes"* | **kimi never renders in the picker and DOES render in pane headers** |
| The closed union | `shared/ipc.ts:902` `agentKindSchema = z.enum(['claude','codex','grok','kimi','opencode'])` · `:903` `AgentKind` | **five members at this SHA. `'shell'` is NOT one** — Task 7a-2 widens it (roadmap `:1950`) |
| The pattern to follow | `PaneIcon.vue` — docblock `:2`–`:38`, union `:40`–`:50`, `withDefaults(defineProps<{name: PaneIconName; size?: number; strokeWidth?: number}>(), {size: 16, strokeWidth: 1.85})` `:52`–`:55`, svg root `:59`–`:70`, first branch `:73` | a `<template v-if>` / `v-else-if` chain, one per glyph; `fill="none" stroke="currentColor"`; imported at `TerminalPane.vue:10` |
| **Lucide is copied in, not installed** | `PaneIcon.vue:14`–`:20`: *"copied in rather than installed. Two reasons: CLAUDE.md locks the stack and asks before new dependencies …"* | **there is no icon library in `package.json` and no `src/renderer/src/icons/` directory.** This task adds neither |
| Gates at `3c70e87`, **in the main checkout** | `npm run typecheck` · `npx vitest run` · `npm run grep:secrets` | **0** (node + web) · **2969 / 2969 across 79 files** · clean, 6 patterns |
| Gates at `3c70e87`, **in a clean worktree** | same commands | **0** · **2941 / 2941 across 78 files, with 1 file uncollected** · clean. **That is F103 and it is EXPECTED — see fact 2** |
| There is no linter | `npm run lint` | **`Missing script: "lint"`.** `package.json` has `dev`, `start`, `build`, `rebuild:better-sqlite3`, `typecheck:node`, `typecheck:web`, `typecheck`, `icons`, `test`, `grep:secrets`, `dist`, `logo` — and nothing else. Do not report a lint pass |
| The no-raw-hex gate | `TitleBar.vue:12`–`:14` and `ProjectRail.vue:22`–`:24` both record it; the 3c-era documents write the command as `grep -rnE` (`Task-3c-4-ExecutionPrompt.md:286`) | **a documented pattern search over named files, not a script.** **⚠ AND `grep` IS NOT ON PATH IN POWERSHELL HERE** — verified 2026-08-26, `Get-Command grep` returns nothing — **so the historical form is not runnable, and its shell error would be read as a clean gate.** The runnable form is `Select-String -Path <the four files> -Pattern '#[0-9a-fA-F]{6}\b'`, given in full under *Verification Commands* along with the both-ways proof that it fires. `ActivityBar.vue` is the one named exception (D178: supplied artwork with its own raw hex) |
| The test surface | 79 `*.test.ts` under `src/`, **none of which mounts a component**; `vitest.config.ts:11` `environment: 'node'`; `package.json` has **no `@vue/test-utils`, no `jsdom`, no `happy-dom`** | **a `.vue` test is not merely absent — it is unrunnable without a new dependency AND a config change**, both of which `CLAUDE.md` gates. See *Test Expectations* |

### ⚠ Eight facts that will cost a session if they are not believed

1. **A WORKTREE HAS NO `node_modules`, AND THE WAY YOU REMOVE THE JUNCTION CAN DELETE THE MAIN
   CHECKOUT'S.** Every gate in this document is a false green until you junction the main checkout's
   modules in — without them `tsc` reports *"not recognized"*, which reads like a broken environment
   rather than a missing directory:

   ```powershell
   New-Item -ItemType Junction -Path "C:\Projects\ContactEstablished\.chorus\Chorus\wt-2be8b104\node_modules" `
     -Target "C:\Projects\ContactEstablished\Chorus\node_modules" | Out-Null
   # ⚠ ASSERT IT EXISTS BEFORE TRUSTING ANY GATE BELOW. Whichever form you use, a
   #   junction that was not created surfaces as `'tsc' is not recognized`, which
   #   reads as a broken toolchain rather than a missing directory.
   if (-not (Test-Path "C:\Projects\ContactEstablished\.chorus\Chorus\wt-2be8b104\node_modules\.bin\tsc.cmd")) { throw 'junction missing — gates below would be a false green' }
   ```

   **⚠ USE THE POWERSHELL FORM ABOVE, NOT `cmd /c mklink /J`, AND KEEP THE ASSERTION.** `mklink`
   is a **cmd builtin**. It works from cmd and from PowerShell — but it creates **nothing** when the
   shell in between mangles the backslashes in those two paths, and it reports that by printing
   nothing at all. This document shipped the `mklink` spelling and it silently did nothing on
   2026-08-27; the first sign was `npm run typecheck` reporting `'tsc' is not recognized`, i.e. the
   failure arrived disguised as a broken toolchain. **The `Test-Path` throw is the actual fix** —
   whichever form you use, prove the link is there before you believe a gate. It was tested in both
   directions: it passes with the junction present and throws with it absent.

   **⚠ AND REMOVE IT WITH `cmd /c rmdir` — NEVER `rm -rf`, NEVER `Remove-Item -Recurse`.** Those two
   follow the junction and delete the **target's** contents, which is the main checkout's
   `node_modules` and every other worktree's gates with it. `rmdir` on a junction removes the link
   only. Removing it at all matters for a second reason: left in place, an `npm install` run here
   writes into the main checkout.

   ```powershell
   cmd /c rmdir "C:\Projects\ContactEstablished\.chorus\Chorus\wt-2be8b104\node_modules"
   ```

   ```powershell
   # Equivalent and shell-agnostic — removes the REPARSE POINT only, leaving the target alone:
   (Get-Item "C:\Projects\ContactEstablished\.chorus\Chorus\wt-2be8b104\node_modules" -Force).Delete()
   ```

2. **EXPECT `2941 / 2941 ACROSS 78 FILES` WITH ONE FILE UNCOLLECTED, AND DO NOT "FIX" IT.** That is
   **F103**, open and owned by Phase 7: `codeIndexCore.test.ts:42` reads a captured fixture from
   `_verify/6a-2/log-name-only.txt`, and `_verify/` is gitignored at `.gitignore:165` with **0**
   tracked files under it. The main checkout has the capture on disk and reports **2969 / 79**; a
   clean worktree does not and reports **2941 / 78 plus one uncollected file**. The suite is not
   broken, your checkout is clean. **Deleting the fixture read, inventing a fixture, or un-ignoring
   `_verify/` are all out of scope** — the test's own comment at `:39`–`:41` says it fails loudly on
   purpose rather than *"quietly falling back to an invented fixture that proves nothing"*.
3. **ONLY THE `codes` MAPS GO. THE `labels` MAPS STAY — ALL FOUR OF THEM.** They are a different
   thing that happens to share a shape: `codes` is a stand-in for an icon, `labels` is the agent's
   display name, and this task deletes the first and reads the second. Two of them are needed *by*
   this task (`FilmstripRenderer.vue:88` supplies the card tile's new `title`; `TerminalPane.vue:71`
   already renders the header's name beside the tile at `:1404`). **And `LaunchDialog` deliberately
   has no label map at all** — it reads `displayName` off the wire at `:520` because
   *"nothing here hardcodes an agent's name or label"* (`:600`–`:603`). A tidy-up that "unifies the
   three maps" deletes a rule, three comments and one live consumer in one edit.
4. **KIMI NEVER RENDERS IN THE PICKER AND DOES RENDER IN PANE HEADERS.** `HIDDEN_AGENTS`
   (`LaunchDialog.vue:512`) is a presentation filter on the launch cards only; its own docblock says
   an existing kimi session *"still attaches, renders and resumes exactly as before"*. So a kimi mark
   is **not** optional, and the `Record<…>` type demands it whether or not the drive can find a kimi
   pane to look at. **Its absence from the picker is not evidence it is unused.**
5. **DRAW EVERY MARK FROM THE VENDOR'S OWN CURRENT SOURCE AT IMPLEMENTATION TIME, NEVER FROM MEMORY.**
   This is D4's discipline — the one `CLAUDE.md` imposes on CLI flags — applied to logos, which move
   for the same reason and fail worse. A CLI flag drawn from memory errors out; **a mark drawn from
   memory renders perfectly and is wrong**, and a wrong mark is worse than the two letters it
   replaced because it is confidently wrong on a vendor's identity. The spec's §0 is the procedure
   and it is not optional. **⚠ AND IT IS ALL SIX OR NONE**: a picker showing three real marks beside
   two letter-tiles is worse than five letter-tiles, so if any one source cannot be obtained, **stop
   and report before editing a call site**.
6. **`AgentMark` MUST NEVER BE HANDED `undefined`, BECAUSE ONE CALL SITE CAN PRODUCE IT.**
   `FilmstripRenderer.vue:370` guards `agentFor(id)` — typed `AgentKind | undefined` at `:71` —
   with a `'??'` text fallback today. That fallback is **kept**, as text, outside the mark: a card
   whose session row has no agent still says something. Passing `undefined` into a
   `Record`-keyed lookup renders an empty `<svg>`, which is fact 8's failure mode.
7. **`color:` ON THE THREE TILE RULES IS NO LONGER TEXT STYLING — IT IS THE MARK'S TINT — AND
   DELETING IT AS DEAD CSS FAILS SILENTLY.** `color: var(--color-text-badge)` is now the only thing
   that decides what `currentColor` resolves to inside the tile. Delete it and the mark inherits from
   above — `--color-text-muted` in `.pane-meta` (`TerminalPane.vue:1836`), the card's own text colour
   in the picker — and the whole family shifts tone in a way no gate catches. It is the one line in
   this task's CSS that must be kept **and** commented.

   **⚠ AND THE TEXT DECLARATIONS ARE DEAD ON TWO OF THE THREE RULES, NOT ALL THREE.**
   `.launch-agent-tile` and `.pane-tile` can never hold text again, so their `font-family`,
   `font-size` and `letter-spacing` go. **`.card-tile` KEEPS ITS `font-family` AND `font-size`,
   because it is the one tile that can still contain text** — the `'??'` fallback of fact 6. Strip
   them there and that fallback renders at the inherited 12px inside a 16px box. The asymmetry is
   deliberate and is commented in the file.
8. **A `v-else-if` CHAIN IS NOT EXHAUSTIVENESS-CHECKED, AND THAT IS WHY THIS COMPONENT IS NOT SHAPED
   LIKE `PaneIcon.vue`.** `PaneIcon` keys its glyphs off a template chain (`:73` onward); `vue-tsc`
   does not verify that the chain covers `PaneIconName`, and a name with no branch renders an empty
   `<svg>` — a 16px hole that reads as a CSS bug and sends the reader to the stylesheet. `AgentMark`
   keys its path data off a **`Record<AgentMarkName, …>`** instead, so that when **7a-2 widens
   `agentKindSchema`** the compiler *demands* the missing mark at the map, in the file that owns the
   drawing, before anything renders. This is `notifications.ts:6`–`:10`'s argument reused verbatim:
   the compiler finding the file is *"the property working, not a chore"*.

## Goal

Make the agent's identity **legible at a glance** on the two surfaces where a user picks an agent and
then has to keep track of which pane is which. Today both draw a two-letter monospace code — `cc`,
`cx`, `gk`, `km`, `oc` — inside a badge tile. **`cc` is a code standing in for an icon**: it must be
learned, it does not survive peripheral vision, and at 8.5px in a 16px tile it is close to the limit
of what can be read at all. Every one of those tools has a mark that a user already recognises.

**D184 — settled by Matthew, 2026-08-26: faithful vendor marks, monochrome.** Each vendor's actual
mark, redrawn on the 24 grid, tinted by `currentColor`, inside the badge chrome the mock already
draws.

**The argument for it is weaker than it looks, and the design system is on its side — both halves
matter, so both are recorded.** `docs/PLAN.md:185` (§7b) names three colour channels that must never
mix — **hue = project · icon = provider/agent · state = dot + glow** — and **D38** adopts that,
phrasing it *"project identity by hue only; **agent identity by glyph only, never color**"*. So the
**icon channel is already assigned to the agent**: a vendor mark *fulfils* that assignment rather
than overriding it. The rule actually being protected is that agent identity must never travel on
**hue**, because hue identifies projects (`src/shared/projectColors.ts`) and a second colour axis
would collide with the first. **That rule is preserved in full**: monochrome, `currentColor`, no
vendor brand hue anywhere in the palette, badge chrome untouched. What changes is that the glyph gets
better at being a glyph.

**What is genuinely being overridden is the mock, and that is why this is a decision rather than an
edit.** `docs/design/v2/Chorus Launch Dialog.dc.html:64` draws the two-letter tile, and **D73 makes
the mock the authority**. The precedent for an override at exactly this scope is the Chorus logo
itself: four v2 mocks draw a six-bar glyph, `ChorusMark.vue` draws the correct seven-bar mark, and
its docblock (`:15`–`:22`) records that D73 *"cannot be the authority on what Matthew's own logo is …
superseded here on his instruction, not silently 'improved'."* **Same move, same requirement: written
down, not silently improved.**

**And the chrome is the proof that the override is narrow.** The mock's tile is
`18px / radius 3px / #1A2027 / 1px #262D35 / #B9C2CC` — six values, all six already tokens in
`.launch-agent-tile`. **Every one of them survives this task.** Only the glyph inside the box
changes.

**One legal note, stated once and not belaboured:** these are third-party marks used
**nominatively** — to identify the tool a button launches, which is the same use any IDE makes of
them. Draw them faithfully and monochrome; do not restyle Chorus's own branding to resemble any of
them, and do not imply endorsement anywhere in the UI.

**Six entries are needed, not five.** `claude`, `codex`, `grok`, `kimi`, `opencode` — and **`shell`**,
which is Task 7a-2's kind and is a `>_` prompt glyph Chorus draws itself. **7a-1 ships it so that
7a-2 does not have to touch this file**: a task about widening `agentKindSchema` and adding a
`shell.ts` adapter is the worst possible place for a drawing to land, because no reviewer of that
diff is looking at geometry. The cost is stated in the open: for the length of one task the shell
entry is typed, required by the union, and rendered by nothing.

## Exact Scope

**Create**

- `src/renderer/src/components/AgentMark.vue` — the only new file, and the only place any of the six
  marks is drawn.

**Edit**

- `src/renderer/src/components/LaunchDialog.vue` — delete the `codes` map and its docblock
  (`:599`–`:614`), import `AgentMark`, swap the tile's content at `:882`, and strip the three dead
  text declarations from `.launch-agent-tile` (`:1378`).
- `src/renderer/src/components/FilmstripRenderer.vue` — delete `codes` and its docblock
  (`:96`–`:106`), import, swap `:370` **keeping the `'??'` fallback as text** and adding the `title`
  the tile has never had. **`.card-tile` (`:535`) keeps its text styling** — it is the one tile that
  can still hold text — and gains a comment saying so.
- `src/renderer/src/components/TerminalPane.vue` — delete `codes` and its docblock (`:79`–`:86`),
  import beside `PaneIcon` (`:10`), swap `:1399`, and strip the dead text declarations from
  `.pane-tile` (`:1926`).

**Nothing else.** Four files, all under `src/renderer/src/components/`. **Nothing crosses the IPC
bridge, no main-process file is opened, no schema moves, no migration exists, and `package.json` is
not touched.** If you find yourself in `src/main/`, `src/shared/` or `src/preload/`, stop — the
design does not call for it.

**Evidence** goes under `_verify/7a-1/` (the vendor source files, the drive's screenshots and CDP
reads). That directory is gitignored (`.gitignore:165`) and **no test may read from it** — that is
F103's whole lesson and this task must not add a second instance of it.

## Non-Goals

- **⚠ NO NEW DEPENDENCY, AND SPECIFICALLY NO ICON PACKAGE.** `lucide-vue-next`, `@iconify/vue`,
  `unplugin-icons` and every sibling are out. `PaneIcon.vue:14`–`:20` already argued this once and
  the argument has not weakened: `CLAUDE.md` locks the stack and asks before dependencies, and a
  package whose upgrade can restyle app chrome is a bad trade for six shapes that never change.
  Geometry is **copied in**, exactly as Lucide's was. `package.json` must be byte-identical after
  this task.
- **⚠ NO COLOUR. NOT ONE VENDOR BRAND HUE, ANYWHERE.** No new token, no inline `fill="#..."`, no
  `color-mix` against a vendor colour, no gradient, no two-tone mark. Every mark is a single
  `currentColor` fill. **This is the D38 rule the whole decision rests on, and breaking it here
  would retire the argument that got the marks approved.** The no-raw-hex gate (`Select-String` —
  see *Verification Commands*) is run against all four files and is a hard gate, not a style check.
- **No change to the badge chrome.** `--color-surface-badge`, `--color-border-badge`,
  `--color-text-badge`, `--radius-chip` and the three tiles' box geometry (18×18, 16×16, 16×16) are
  untouched. `main.css` is not edited. If a mark looks wrong inside the box, **the mark's scale is
  wrong, not the box**.
- **No change to the `labels` maps, `AGENT_LABELS`, `HIDDEN_AGENTS`, `toAgentCards`, or the
  `displayName` wire read.** See fact 3.
- **No widening of `agentKindSchema` and no `shell` adapter.** That is Task 7a-2 and it is a
  main-process change with an F25 hazard attached (`roadmap.md:1950`). This task adds a `'shell'`
  *drawing* under a renderer-local type alias and nothing else; `src/shared/ipc.ts` is not opened.
- **No presets, no "how many", no batch launch** — Task 7a-3.
- **No `.vue` test infrastructure.** Adding `@vue/test-utils` + `jsdom` and switching
  `vitest.config.ts` off `environment: 'node'` is a dependency ask and a config change for a
  component whose only assertable properties the compiler and a pattern search already cover. See
  *Test Expectations*.
- **No refactor of `PaneIcon.vue`.** The two components differ deliberately (stroked vs filled,
  chain vs `Record`) and both differences are argued in `AgentMark`'s docblock. **Merging them into
  one icon component is a bigger change than this task, and it would force the filled family into
  the stroked one's shape.**
- **No `aria-label` on the marks and no new accessible name in the picker or the pane header.** Both
  already render the agent's name as text beside the tile (`LaunchDialog.vue:884`,
  `TerminalPane.vue:1404`); a second announcement is noise. **The filmstrip card is the one place
  with no adjacent name, and it gets a `title`, not an `aria-label`** — see the spec's §3.
- **⚠ Do not revert, stage, commit or delete the two pre-existing working-tree changes.**
  `M .mcp.json` is a line-ending artefact and `M docs/Features/Foundation/roadmap.md` is this
  session's architect pass. **Neither is yours. Do not `git checkout` them, do not include them in a
  commit, do not "clean the tree" before starting.** The same goes for the kickoff's untracked
  documents (`Phase-7a-Overview.md`, `Task-7a-{2,3}.md` and their specs) — they are siblings, not
  strays. Report anything else you find; absorb nothing.
- **Do not write D184 into `roadmap.md`.** The decision row is the architect pass's, and
  `roadmap.md` is already modified. This document records the decision; the roadmap records it
  separately.

## Dependencies

**None.**

This is the first task of Phase 7a, nothing in 7a has landed, and **nothing in this task depends on
7a-2 or 7a-3**. It is renderer-only, it changes no contract, and it is independently shippable — an
implementer could land it and stop, and the app would be strictly better. That is why the roadmap
put it first (`roadmap.md:1948`: *"Deliberately first: self-contained, independently shippable, and
the change Matthew sees"*).

**⚠ The one decision this task needed IS SETTLED. D184 was resolved by Matthew on 2026-08-26** —
faithful vendor marks, monochrome — and its full argument is under *Goal*. There is no gate to
discharge and no approval to wait for. What is **not** optional is the discipline attached to it:
fact 5, and the spec's §0.

**⚠ THE DEPENDENCY RUNS THE OTHER WAY, AND IT IS WHY THE SHELL MARK IS IN SCOPE HERE.**
[`Task-7a-2.md`](Task-7a-2.md) depends on **this** task for exactly one thing — the `shell` mark —
and its own Non-Goals say so: *"The `codes` maps are 7a-1's to delete, and 7a-1 already supplies the
`shell` mark in `AgentMark.vue`. If 7a-1 has landed, there is nothing to draw here."* It carries a
fallback for the case where this task has **not** landed. **Landing this task cleanly is what keeps
that fallback unused**, and a `shell` entry quietly dropped here as "unrendered, therefore
unnecessary" hands a drawing to a task that has no reviewer looking at drawings.

**It ships as its own single narrated commit, in its own execution session** (Matthew's choice,
2026-08-26). Not folded into 7a-2, not batched with 7a-3, and not committed mid-task — the commit is
the last step, after the gates and the drive.

## Step-by-step Work

1. **Junction `node_modules` and take the baseline before touching anything** (fact 1). Record what
   `npm run typecheck`, `npx vitest run` and `npm run grep:secrets` actually print **in this
   worktree**. Every later claim is measured against *your* numbers, not this document's — and if
   vitest does not say **2941 / 78 with one uncollected file**, say so before assuming F103.
2. **Run §0 of the spec. Do not skip it and do not shorten it.** Fetch each of the five vendors'
   marks **from that vendor's own current source**, prefer an SVG over a raster, save each one
   verbatim under `_verify/7a-1/marks/<name>.svg`, and record **the URL, the retrieval date, the
   source's own `viewBox`, and the mark's bounding box** for each. **Paste that table into the
   report.** A mark whose provenance is not written down is a mark drawn from memory as far as any
   later reader can tell. **If any one of the five cannot be sourced, STOP and report** — fact 5.
3. **Write `AgentMark.vue`.** A 24 `viewBox`, `fill="currentColor"`, `stroke="none"`, path data
   **copied verbatim from the saved sources** and placed on the grid by an authored wrapper
   transform — **no path digit is retyped or adjusted by eye**, which is what makes fidelity
   checkable by a reviewer with a pattern search. Keyed off `Record<AgentMarkName, Mark>` where
   `AgentMarkName = AgentKind | 'shell'` (fact 8). The docblock carries the provenance table, the
   D184 argument in two sentences, and **why this component is filled where `PaneIcon` is stroked**.
   The spec's §1 is the shape.
4. **`LaunchDialog.vue`.** Delete `:599`–`:614`; import; `:882` becomes the mark; strip
   `font-family` / `font-size` from `.launch-agent-tile` and **keep `color`, with a comment saying
   what it now does** (fact 7).
5. **`FilmstripRenderer.vue`.** Delete `:96`–`:106`; import; `:370` becomes a mark **plus the kept
   `'??'` text fallback plus a `title` from the `labels` map at `:88`** — the card's tile is the only
   agent identifier on that surface and its own retired comment (`:96`–`:99`) said so:
   *"the tile plus the title compose the identity"*. **`.card-tile` keeps `color` AND its text
   styling** (fact 7). **Do not touch `.card-done .card-tile` (`:690`) — it already works.**
6. **`TerminalPane.vue`.** Delete `:79`–`:86`; import beside `PaneIcon` at `:10`; `:1399` becomes the
   mark; strip `font-size` and `letter-spacing` from `.pane-tile`; keep `color`.
7. **Run every gate, plus the two `Select-String` searches that prove the deletion was complete** —
   the orphan-reference check is `npm run typecheck` and the `codes[` search, not a reading of the
   diff.
8. **Remove the junction with `cmd /c rmdir`** (fact 1), then **drive the real app**. A compiled
   feature is not a delivered one (roadmap §3, step 4), and for a task whose entire deliverable is
   *what a shape looks like at 11 pixels*, the drive is not a formality — **it is the only test this
   task has**.
9. **Commit, once, narrated.** After the gates and the drive, never before.

## Test Expectations

**⚠ THIS REPO HAS NO `.vue` COMPONENT TESTS AT ALL, AND THIS TASK DOES NOT ADD THE FIRST ONE. SAYING
SO PLAINLY IS MORE USEFUL THAN INVENTING A TEST PLAN.**

The state of the world, measured at `3c70e87`: **79 `*.test.ts` files under `src/`, none of which
mounts a component.** `vitest.config.ts:11` sets `environment: 'node'`. `package.json` contains
**no `@vue/test-utils`, no `jsdom`, no `happy-dom`**. So a component test is not merely missing — it
**cannot run** without a new dependency *and* a config change, and `CLAUDE.md` gates both. Three
other documents in this repo already state the consequence for their own surfaces
(`shared/provenance.ts:6`–`:10`; `Task-6b-1.md`'s wording rules), and the standing answer there is
**"move the logic somewhere a node test can reach"**.

**That answer was considered here and refused, and the reasoning is the substance of this section.**
The renderer does have pure `.ts` tests extracted from components — `projectRail.test.ts`,
`projectChip.test.ts`, `palette/commands.test.ts` — so `agentMarks.ts` beside `AgentMark.vue` is a
real option. What would it assert?

- **that all six keys exist** — the `Record<AgentMarkName, Mark>` type already enforces this at
  compile time, and enforces it *better*, because it fires when a kind is added rather than when
  someone remembers to run the suite. A test here would be a test of TypeScript;
- **that no `fill` is a hex colour** — the no-raw-hex gate already covers it, across all four
  files, including the ones a unit test would not import;
- **that a path matches the vendor's** — the source files live under gitignored `_verify/`, so a
  test reading them **would re-create F103 exactly**: green here, uncollected in a clean checkout.

What is left is *"does this shape read as Grok's mark at 11 pixels"*, which no test in any framework
answers. **So the coverage for this task is the runtime drive, and the drive is therefore not
optional and not summarisable.** A report that says "gates green" and shows no rendered marks has
verified nothing this task did.

Two consequences a reviewer should hold onto:

1. **The compiler is the regression test.** The `Record` is what makes a future agent kind fail
   loudly, and it is the reason this component is not shaped like `PaneIcon.vue`. Anyone who later
   "simplifies" it to a `v-else-if` chain has deleted this task's only automated guarantee — and
   nothing will go red when they do.
2. **The suite's total must not move.** typecheck **0**, vitest **2941 / 78** in a worktree
   (**2969 / 79** in the main checkout), `grep:secrets` clean. **A changed test count in a task that
   adds no test is a finding**, not a rounding difference — report it and stop.

## Verification Commands

Runnable as written from the repository root (PowerShell). **⚠ Step 0 and the last step are not
optional and are not reorderable** — see fact 1.

```powershell
# 0. A WORKTREE HAS NO node_modules. Without this, every gate below is a false green.
New-Item -ItemType Junction -Path "C:\Projects\ContactEstablished\.chorus\Chorus\wt-2be8b104\node_modules" `
  -Target "C:\Projects\ContactEstablished\Chorus\node_modules" | Out-Null
# ⚠ ASSERT IT EXISTS BEFORE TRUSTING ANY GATE BELOW. Whichever form you use, a
#   junction that was not created surfaces as `'tsc' is not recognized`, which
#   reads as a broken toolchain rather than a missing directory.
if (-not (Test-Path "C:\Projects\ContactEstablished\.chorus\Chorus\wt-2be8b104\node_modules\.bin\tsc.cmd")) { throw 'junction missing — gates below would be a false green' }

npm run typecheck        # 0 errors, node + web. THE REAL ORPHAN-REFERENCE CHECK.
npx vitest run           # 2941 / 2941 across 78 files + 1 uncollected  (F103 — expected)
npm run grep:secrets     # clean, 6 patterns
# There is NO `npm run lint` in this repo. Do not report one.
```

**`npm run typecheck` is the check that matters, and it is worth saying why.** The three `codes` maps
are `Record<AgentKind, string>` consts read by exactly one expression each. Delete a map and leave a
reader, and `vue-tsc` fails on the template — which is precisely the orphan-reference class this task
can produce. **A green typecheck after all three deletions IS the proof the swap was complete**;
reading the diff is the weaker check.

**The deletion is complete — two searches that must come back empty:**

```powershell
Get-ChildItem -Path src\renderer\src -Recurse -Include *.vue,*.ts | Select-String -Pattern "codes\["       # expect NOTHING
Get-ChildItem -Path src\renderer\src -Recurse -Include *.vue,*.ts | Select-String -Pattern "const codes"   # expect NOTHING
```

**⚠ `Get-ChildItem … | Select-String`, NOT `Select-String … -Recurse` — AND THE OLD SPELLING FAILED
TWO DIFFERENT WAYS, THE SECOND SILENTLY.** `Select-String` has **no `-Recurse` parameter**: that
spelling throws *"A parameter cannot be found that matches parameter name 'Recurse'"*. The spelling
without it is worse — `Select-String -Path <a directory> -Include <glob>` returns **0 with no error**,
because `Select-String` cannot read a directory and `-Include` then filters nothing. **Both were in
these documents until 2026-08-27**, and the silent one is the dangerous one: for a gate whose whole
job is to come back empty, "clean" and "never ran" are the same output. The corrected form was
verified to scan **67 files**. **Do not "simplify" it back.**

**⚠ AND RUN THE POSITIVE CONTROL. Two searches returning nothing prove nothing on their own:**

```powershell
# MUST return hits. If this is also empty, the scan is not running and the two above are worthless.
Get-ChildItem -Path src\renderer\src -Recurse -Include *.vue,*.ts | Select-String -Pattern "AgentMark"
```

**The no-raw-hex gate — a hard gate here, because D184 rests on the marks being colourless:**

```powershell
Select-String -Path src\renderer\src\components\AgentMark.vue,src\renderer\src\components\LaunchDialog.vue,src\renderer\src\components\FilmstripRenderer.vue,src\renderer\src\components\TerminalPane.vue `
  -Pattern '#[0-9a-fA-F]{6}\b'      # expect NOTHING
```

**⚠ `Select-String`, NOT `grep` — AND THE GATE WAS PROVEN BOTH WAYS BEFORE BEING WRITTEN DOWN.**
`grep` is **not on PATH in PowerShell on this machine** (`Get-Command grep` returns nothing, verified
2026-08-26), so the `grep -rnE` form the 3c-era task docs use (`Task-3c-4-ExecutionPrompt.md:286`) is
**not runnable here** — and its shell error would be read as a clean gate, which is the worst
possible failure for a check whose whole job is to come back empty. The replacement above was
verified in **both** directions rather than only against a clean file: `ActivityBar.vue` — the one
file D178 allows to carry raw hex — returns **12** hits, and `PaneIcon.vue` + `TitleBar.vue`, both
asserted hex-free, return **0**. **A gate only ever tested against a clean file cannot tell
"passing" from "not running".** Do not "restore" the `grep` form.

**Fidelity — every path is the vendor's, not an approximation.** For each of the five vendor marks,
the `d` string in `AgentMark.vue` must appear **character for character** in the source saved under
`_verify/7a-1/marks/`:

```powershell
# Take each `d` out of AgentMark.vue, then look for it -SimpleMatch (never as a regex — path data
# is full of `.`, `-` and `,`) in the file it came from. One run per path, per mark.
Select-String -Path _verify\7a-1\marks\claude.svg -SimpleMatch "<paste the d string here>"
# expect a hit for EVERY path of every vendor mark.
# `shell` is exempt: it is Chorus's own drawing and has no source file.
```

**The tint survives, and the dead text styling is gone:**

```powershell
Select-String -Path src\renderer\src\components\LaunchDialog.vue,src\renderer\src\components\FilmstripRenderer.vue,src\renderer\src\components\TerminalPane.vue `
  -Pattern "color: var\(--color-text-badge\)"      # expect 3 hits — one per tile rule
```

Then read the three rules by eye — this is a four-line check, not a pattern match:
`.launch-agent-tile` (`LaunchDialog.vue:1378`) and `.pane-tile` (`TerminalPane.vue:1926`) have **no**
`font-family`, `font-size` or `letter-spacing` left; **`.card-tile` (`FilmstripRenderer.vue:535`)
still has `font-family` and `font-size`, and a comment saying they style the `'??'` fallback.**

**Nothing outside the four files moved, and nothing was absorbed:**

```powershell
git diff --stat      # exactly 4 paths under src/renderer/src/components/ (3 modified + 1 new)
git status --porcelain
# ⚠ `M .mcp.json` and `M docs/Features/Foundation/roadmap.md` are PRE-EXISTING and stay that way;
#   the untracked `Phase-7a-Overview.md` / `Task-7a-*.md` / `ImplementationSpec-7a-*.md` are the
#   kickoff's own documents and are likewise not this task's to stage, commit or remove.
# `package.json` must NOT appear.
```

**Remove the junction — with `rmdir`, not `rm -rf`:**

```powershell
cmd /c rmdir "C:\Projects\ContactEstablished\.chorus\Chorus\wt-2be8b104\node_modules"
```

**Runtime drive — the only coverage this task has.** Evidence under `_verify/7a-1/`.

1. Seed a scratch user-data dir from the installed app so the window has real projects and real
   sessions: copy `%APPDATA%\chorus-app\chorus.db` (plus `-wal` / `-shm` when present) **and
   `Local State`** — without the last one every pre-existing credential blob is undecryptable and
   the dialog paints wrong for reasons that have nothing to do with this task.
2. `npm run dev` against that dir with `--remote-debugging-port=9333`. **⚠ 9333, NEVER 9222.**
   Port 9222 is the installed stable Chorus and driving it would be driving the wrong app.
3. **(a) The picker.** Open the launch dialog. **Every card shows its mark** — and with `kimi`
   hidden by `HIDDEN_AGENTS`, that is **four** cards, not five. Screenshot it. Then confirm the
   not-found state: a card whose CLI is absent fades whole, mark included
   (`overlays.css:180`–`:185`), and the selected card's mark is unchanged (selection moves the
   border and background, never the glyph).
4. **(b) The pane header, in BOTH modes.** Grid: each pane's `.pane-meta` shows its mark beside the
   agent label. Filmstrip: each card's `.card-tile` shows its mark. **Both, in one drive** — they
   are two different components with two different tile rules and only one of them has the `'??'`
   fallback.
5. **(c) The states.** Focus a pane and unfocus it: the header tints its **background** and the mark
   does not change colour — that is correct and is what the two letters did too
   (`TerminalPane.vue:1618`–`:1624`). Then find or make a completed card: `.card-done .card-tile`
   sets `color: var(--color-text-muted)` and **the mark must dim with it**, with no CSS added by
   this task. That single observation is what proves `currentColor` is really wired to the tile.
6. **(d) Kimi.** A kimi mark must render in a **pane header** though no kimi card exists in the
   picker. Check the seeded DB first — `SELECT id, agent FROM sessions WHERE agent = 'kimi'` — and
   drive a real row if one exists. **If none exists, say so and report the visual half of this check
   as NOT PERFORMED**, resting on the `Record`'s compile-time guarantee for the rest. Do not
   fabricate a pane and do not claim the observation.
7. **(e) The optical check, which is the actual deliverable.** Screenshot all six marks at their
   rendered sizes (18px tile and 16px tile) **at 100% zoom, not scaled up**, and look at them.
   Every mark must be recognisable as its vendor's and no mark may be visibly heavier or lighter
   than its neighbours. **If one is, the fix is that mark's wrapper transform, never the tile.**

**⚠ Failure-honesty clause.** A command that fails for any reason — a vendor site unreachable, a
missing CLI, a locked DB, CDP refusing the port — is reported **with its output**, and the step is
**not claimed**. A drive that did not run is not a drive that passed, and for this task that means
the feature is unverified.

## Acceptance Criteria

- [ ] **All six marks are drawn from the vendor's own current source, fetched this session**, and the
      report carries the provenance table: name, URL, retrieval date, source `viewBox`, bounding box.
      The saved sources are under `_verify/7a-1/marks/`. **`shell` is Chorus's own drawing and is
      recorded as such**, not attributed to anyone.
- [ ] **Every path `d` in `AgentMark.vue` appears character for character in its saved source.** No
      digit was retyped, smoothed or adjusted by eye; only the wrapper transform is authored.
- [ ] `AgentMark.vue` keys off **`Record<AgentMarkName, Mark>`**, not a `v-else-if` chain, and the
      docblock says why (an unmatched chain renders an empty `<svg>`, and 7a-2 must fail at the map).
- [ ] **Six entries**, `shell` included, and the shell mark is Chorus-drawn — not Lucide's stroked
      `terminal`, which would put a stroked glyph in a filled family.
- [ ] **Monochrome, `fill="currentColor"`, `stroke="none"`, and the no-raw-hex gate is clean across
      all four files** — run as `Select-String`, because `grep` is not on PATH in PowerShell here. No
      vendor brand hue entered the palette; `main.css` is untouched.
- [ ] **All three `codes` maps are gone** and `Select-String "codes\["` over `src/renderer/src`
      returns nothing. **`npm run typecheck` is 0** — the orphan check that matters.
- [ ] **All four `labels` maps survive**, `HIDDEN_AGENTS` survives, `LaunchDialog`'s `displayName`
      read survives, and `git diff` proves no one "unified" them.
- [ ] **`color: var(--color-text-badge)` survives on all three tile rules**, with a comment saying it
      is now the mark's tint. `font-family` / `font-size` / `letter-spacing` are gone from
      `.launch-agent-tile` and `.pane-tile`, and **still present on `.card-tile`**, which alone can
      still hold text.
- [ ] The filmstrip's **`'??'` fallback still renders as text** for a card whose `agentFor(id)` is
      `undefined`, and `AgentMark` is never handed `undefined`. The card tile gained a `title` from
      the existing `labels` map.
- [ ] **Badge chrome unchanged**: 18×18 / 16×16 / 16×16, `--radius-chip`, `--color-surface-badge`,
      `--color-border-badge`. The mock's tile is still the mock's tile.
- [ ] **`package.json` is byte-identical.** No icon library, no `@vue/test-utils`, no `jsdom`.
- [ ] typecheck **0** · vitest **2941 / 78** in the worktree (**2969 / 79** in the main checkout) ·
      `grep:secrets` clean, 6 patterns. **The test count did not move** — this task adds no test.
- [ ] The `node_modules` junction was created before the gates and **removed with `cmd /c rmdir`**
      after them, and the report says so.
- [ ] The runtime drive's five observations — (a) picker, (b) both pane-header modes, (c) focus and
      done states, (d) kimi, (e) the optical check at 100% — are captured under `_verify/7a-1/` with
      screenshots. **Anything not observed is reported as not observed.**
- [ ] `git diff --stat` shows **exactly four paths**, all under `src/renderer/src/components/`.
      `M .mcp.json` and `M docs/Features/Foundation/roadmap.md` are still modified, still unstaged,
      and are **not** in the commit.
- [ ] The work ships as **one narrated commit**, made after the gates and the drive.

## Review Checklist

A spec reviewer must confirm:

1. **Every mark came from the vendor, this session, with a URL and a date.** This is the one thing
   that cannot be recovered later: a mark drawn from memory looks exactly like a mark drawn from the
   source, renders perfectly, passes every gate, and is wrong. **Do not accept "I drew these from the
   vendors' logos" — check the provenance table against the saved files, and check a `d` string.**
   If the paths do not appear verbatim in the sources, they were traced, and traced is memory with
   extra steps.
2. **`Record`, not `v-else-if`.** Open `AgentMark.vue` and confirm the path data is keyed by a
   `Record<AgentMarkName, …>`. A chain compiles, renders, and passes every check in this document —
   and then silently renders an empty tile the day 7a-2 widens the union. **This is the task's only
   automated regression guarantee; treat its removal as a scope change.**
3. **No colour, anywhere, in any form.** `Select-String` for hex, `rgb(`, `hsl(`, `color-mix`,
   `gradient`, `fill="` with anything other than `currentColor`, and `opacity` used to fake a second
   tone. D184 was approved *because* the marks are monochrome; a two-tone mark retires the argument
   that approved it. **⚠ And check the gate was actually RUN as `Select-String`** — `grep` is not on
   PATH in PowerShell here, so a pasted `grep` line produces a shell error that looks exactly like a
   clean result.
4. **`color:` was kept on all three tile rules.** It is the only line in the CSS diff that has
   changed meaning rather than changed value, and deleting it is invisible in review and invisible
   at runtime until someone notices the family is slightly the wrong grey. Check all three.
5. **The `labels` maps are untouched and `LaunchDialog` still reads `displayName`.** Three maps were
   deleted; four look like them and must survive. If the diff touches `notifications.ts` or
   `palette/commands.ts`, this task has left the renderer.
6. **The `'??'` fallback survives as text in the filmstrip, and nothing passes `undefined` to the
   mark.** `agentFor` is `AgentKind | undefined` at `FilmstripRenderer.vue:71` — that `undefined` is
   not theoretical.
7. **Nothing crossed the wire.** `git diff --stat` must show four paths under
   `src/renderer/src/components/`. If `src/shared/ipc.ts` appears, someone started 7a-2 inside 7a-1
   and the F25 hazard (`roadmap.md:1950`) came with it.
8. **The drive happened and is shown, not summarised.** This task has no unit tests by design; the
   screenshots *are* the evidence. Specifically look for **both** pane-header modes, the **done**
   card's dimmed mark, and the **100% zoom** optical shot — an enlarged screenshot proves nothing
   about a glyph whose whole problem was that it is 11 pixels tall.
9. **The junction was removed, and removed with `rmdir`.** A worktree left with a live junction turns
   the next `npm install` into an edit of the main checkout.

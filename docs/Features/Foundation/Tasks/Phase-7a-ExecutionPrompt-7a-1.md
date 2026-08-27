# Phase 7a — Execution Prompt (Task 7a-1 — vendor marks)

_Generated 2026-08-26 against `chorus/Chorus/2be8b104` at `3c70e87` ("Release 0.7.8"). **Paste the
body below into a fresh conversation** — it is self-contained and assumes no prior context. Every
line number in it was verified at `3c70e87`; re-confirm each before editing, since any earlier edit
in the same session shifts them._

---

## 1. Role

You are the **Coordinator** for **Chorus — Phase 7a, Task 7a-1 (vendor marks)**.

- Repository root: `C:\Projects\ContactEstablished\.chorus\Chorus\wt-2be8b104`
- This is a **git worktree**, not the main checkout. Run everything from this directory; do **not** `cd` to the original repository root.
- Expected branch: **`chorus/Chorus/2be8b104`**. **Confirm it with `git branch --show-current`; do not switch branches without instruction.**
- Expected HEAD at hand-off: **`3c70e87`** ("Release 0.7.8").
- Platform: **Windows 11, PowerShell**. Commands below are PowerShell unless marked otherwise.

## 2. Goal

Replace the two-letter monospace agent glyph tiles (`cc`, `cx`, `gk`, `km`, `oc`) with each tool's own vendor mark, drawn monochrome and tinted by `currentColor`, on the launch picker and both pane-header surfaces.

**The prime constraint: this task is RENDERER-ONLY and adds NO dependency.** Four files, all under `src/renderer/src/components/`. Nothing crosses the IPC bridge, no main-process file is opened, no schema moves, no migration exists, and `package.json` must be byte-identical afterwards. If you find yourself editing `src/main/`, `src/shared/` or `src/preload/`, stop — the design does not call for it.

## 3. Ground yourself first — read before editing anything

Read these three documents in full, in this order. **They are the specification; this prompt is only the orientation.**

1. `docs/Features/Foundation/Tasks/Phase-7a-Overview.md` — the phase contract, the purity rules, and the shared verification set.
2. `docs/Features/Foundation/Tasks/Task-7a-1.md` — **including its `### ⚠ Eight facts that will cost a session if they are not believed` block, which is not optional reading.**
3. `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-7a-1.md` — **its `## §0 — Probe before you build (do not skip)` is the procedure for obtaining the vendor marks and it runs BEFORE any call site is edited.**

Then inspect these code locations (line numbers verified 2026-08-26 at `3c70e87`; **re-confirm each before editing, since any earlier edit shifts them**):

- `src/renderer/src/components/PaneIcon.vue` — the pattern to follow (24-unit viewBox, `currentColor`, vendored geometry). Its `:14`–`:20` records why no icon package is installed.
- `src/renderer/src/components/LaunchDialog.vue` — `codes` map + docblock `:599`–`:614`; the tile rendered at `:882`; agent grid `v-for` at `:874`; `.launch-agent-tile` styles at `:1378`; `HIDDEN_AGENTS` at `:512`; the wire `displayName` read at `:520`.
- `src/renderer/src/components/FilmstripRenderer.vue` — `codes` + docblock `:96`–`:106`; the tile with its `'??'` text fallback at `:370`; `agentFor` typed `AgentKind | undefined` at `:71`; `labels` at `:88`; `.card-tile` styles at `:535`; `.card-done .card-tile` at `:690`.
- `src/renderer/src/components/TerminalPane.vue` — `codes` + docblock `:79`–`:86`; `PaneIcon` import at `:10`; the tile at `:1399`; the agent name rendered beside it at `:1404`; `labels` at `:71`; `.pane-tile` styles at `:1926`.

Git checks to run before your first edit:

```powershell
git branch --show-current      # expect chorus/Chorus/2be8b104
git log -1 --oneline           # expect 3c70e87 Release 0.7.8
git status --porcelain
```

## 4. ⚠ Pre-existing changes — do not revert, stage, commit or delete these

`git status --porcelain` at hand-off shows exactly this, and **none of it is yours**:

```
 M .mcp.json
 M docs/Features/Foundation/roadmap.md
?? docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-7a-1.md
?? docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-7a-2.md
?? docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-7a-3.md
?? docs/Features/Foundation/Tasks/Phase-7a-Overview.md
?? docs/Features/Foundation/Tasks/Task-7a-1.md
?? docs/Features/Foundation/Tasks/Task-7a-2.md
?? docs/Features/Foundation/Tasks/Task-7a-3.md
```

- **`M .mcp.json`** is a **line-ending artefact only** — its content matches HEAD; `core.autocrlf = true` while the file is stored LF in the working tree, so git reports it modified forever. Leave it.
- **`M docs/Features/Foundation/roadmap.md`** is an architect pass (D183–D188, F102–F104, the Phase 7a entry). Leave it.
- The **seven untracked documents** are this phase's own kickoff output — siblings, not strays. Leave them.

**Do not `git checkout` any of these, do not include them in your commit, and do not "clean the tree" before starting.** If you find anything *else* modified, **report it and stop** rather than absorbing or reverting it.

This prompt itself (`Phase-7a-ExecutionPrompt-7a-1.md`) will appear as an eighth untracked document and is likewise not part of the commit.

## 5. Implementation scope

**Create (one file):** `src/renderer/src/components/AgentMark.vue` — the only place any of the six marks is drawn. Keys its path data off a `Record<AgentMarkName, …>` where `AgentMarkName = AgentKind | 'shell'`. Marks are **solid** — `fill="currentColor"`, `stroke="none"` — which deliberately differs from `PaneIcon.vue`'s stroked glyphs. Six entries: `claude`, `codex`, `grok`, `kimi`, `opencode`, `shell`.

**Edit (three files):**
- `LaunchDialog.vue` — delete `codes` + docblock, import `AgentMark`, swap the tile's content, strip the three dead text declarations from `.launch-agent-tile`.
- `FilmstripRenderer.vue` — delete `codes` + docblock, import, swap the tile **keeping the `'??'` fallback as text**, add the `title` the tile has never had. **`.card-tile` KEEPS its `font-family` and `font-size`** — it is the one tile that can still contain text.
- `TerminalPane.vue` — delete `codes` + docblock, import beside `PaneIcon`, swap the tile, strip the dead text declarations from `.pane-tile`.

Evidence (vendor source files, drive screenshots, CDP reads) goes under `_verify/7a-1/`. That directory is gitignored at `.gitignore:165` and **no test may ever read from it**.

**The decision this task implements, quoted with its date:**

> **D184 — the icon channel finally gets an icon. SETTLED 2026-08-26 (Matthew).** `PLAN.md` §7b names three colour channels that must never mix — **hue = project · icon = provider/agent · state = dot + glow** — and **D38** adopts it as *"project identity by hue only; agent identity by glyph only, never color"*. The icon channel is therefore **already assigned to the agent**; the rule being protected is that agent identity must never travel on **hue**, because hue identifies projects and a second colour axis would collide. That rule is preserved in full: marks are monochrome, tint with `currentColor`, no vendor brand hue enters the palette, and the badge chrome is untouched. It is still an override of the mock, which draws the two-letter tile, and **D73** makes the mock the authority — hence a decision rather than an edit. **⚠ Marks are redrawn from each vendor's own current source at implementation time, never from memory** — the D4 discipline `CLAUDE.md` imposes on CLI flags, applied to logos, which move for the same reason and fail worse: a CLI flag drawn from memory errors out, whereas **a mark drawn from memory renders perfectly and is wrong**. **And it is all six or none** — a picker showing three real marks beside two letter-tiles is worse than five letter-tiles, so if any one source cannot be obtained, **stop and report before editing a call site**.

## 6. Strict non-goals

None of the following is in scope for Task 7a-1:
- **No new dependency, and specifically no icon package** (`lucide-vue-next`, `@iconify/vue`, `unplugin-icons` and every sibling are out). Geometry is copied in. `package.json` must be byte-identical.
- **No colour. Not one vendor brand hue, anywhere** — no new token, no inline `fill="#..."`, no `color-mix` against a vendor colour, no gradient, no two-tone mark. This is the D38 rule the whole decision rests on.
- **No change to the badge chrome** — `--color-surface-badge`, `--color-border-badge`, `--color-text-badge`, `--radius-chip`, and the three tiles' box geometry (18×18, 16×16, 16×16). `main.css` is not edited. If a mark looks wrong inside the box, the mark's scale is wrong, not the box.
- **No change to the `labels` maps, `AGENT_LABELS`, `HIDDEN_AGENTS`, `toAgentCards`, or the `displayName` wire read.** Only the `codes` maps go.
- **No widening of `agentKindSchema` and no `shell` adapter** — that is Task 7a-2. This task adds a `'shell'` *drawing* under a renderer-local type alias and nothing else; `src/shared/ipc.ts` is not opened.
- **No presets, no "how many", no batch launch** — Task 7a-3.
- **No `.vue` test infrastructure** — adding `@vue/test-utils` + `jsdom` and switching `vitest.config.ts` off `environment: 'node'` is a dependency ask and a config change.
- **No refactor of `PaneIcon.vue`** — the two components differ deliberately.
- **No `aria-label` on the marks** — both the picker and the pane header already render the agent's name as text beside the tile. The filmstrip card is the one place with no adjacent name, and it gets a `title`.
- **Do not write D184 into `roadmap.md`** — the decision row is already recorded there by a separate pass.

## 7. Required workflow

Work as a coordinator, not a lone implementer:
1. **Ground** (read the three documents and the code locations above; run `§0` of the spec to obtain the vendor marks) →
2. **Implement** →
3. **Spec review** — a reviewer checks the change against `ImplementationSpec-7a-1.md` clause by clause →
4. **Code-quality review** — a second pass for house conventions, comment density, and dead code →
5. **Resolve findings** →
6. **Verification** (§8 below — run it, do not merely compile) →
7. **Commit narration** — **one intentional commit** with a title and a plain-English body a non-technical reader can follow, technical detail second.

Note there is **no `.codex/workflows/subagents/` kit in this repository** — the pattern above is the workflow.

**Do not push and do not open a PR unless explicitly asked.**

## 8. Verification commands

Runnable as written, in PowerShell, from the repository root. **Step 0 and the final step are not optional and are not reorderable.**

```powershell
# 0. ⚠ A WORKTREE HAS NO node_modules. Without this, EVERY gate below is a false green
#    (`tsc` reports "not recognized", which reads as a broken environment, not a missing directory).
New-Item -ItemType Junction -Path "C:\Projects\ContactEstablished\.chorus\Chorus\wt-2be8b104\node_modules" `
  -Target "C:\Projects\ContactEstablished\Chorus\node_modules" | Out-Null
# ⚠ ASSERT IT EXISTS BEFORE TRUSTING ANY GATE BELOW. Whichever form you use, a
#   junction that was not created surfaces as `'tsc' is not recognized`, which
#   reads as a broken toolchain rather than a missing directory.
if (-not (Test-Path "C:\Projects\ContactEstablished\.chorus\Chorus\wt-2be8b104\node_modules\.bin\tsc.cmd")) { throw 'junction missing — gates below would be a false green' }

npm run typecheck        # 0 errors, node + web. THE REAL ORPHAN-REFERENCE CHECK.
npx vitest run           # 2941 / 2941 across 78 files + 1 uncollected  (F103 — EXPECTED, see below)
npm run grep:secrets     # clean, 6 patterns
# There is NO `npm run lint` in this repo. Do not report one.
```

**Why typecheck is the check that matters:** the three `codes` maps are consts read by exactly one expression each. Delete a map and leave a reader, and `vue-tsc` fails on the template — precisely the orphan-reference class this task can produce. **A green typecheck after all three deletions IS the proof the swap was complete.**

**⚠ `2941 / 78 with one file uncollected` is the CORRECT result in this worktree and must not be "fixed".** That is **F103**, open and owned by Phase 7: `src/main/services/codeIndexCore.test.ts:42` reads a captured fixture from `_verify/6a-2/log-name-only.txt`, and `_verify/` is gitignored at `.gitignore:165` with **zero** tracked files. The main checkout has that capture on disk and reports 2969 / 79; a clean worktree does not. **Deleting the fixture read, inventing a fixture, or un-ignoring `_verify/` are all out of scope.**

⚠ **The junction line above is PowerShell-native on purpose, and the `Test-Path` throw is not
decoration.** `cmd /c mklink /J` is a cmd builtin that works from cmd and PowerShell but creates
nothing when the shell between mangles those backslashes — and then `npm run typecheck` reports
`'tsc' is not recognized`, so the failure arrives disguised as a broken toolchain. That happened
on 2026-08-27. Prove the link exists before believing any gate below.

Deletion completeness — both must come back empty:
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

The no-raw-hex gate — a hard gate, because D184 rests on the marks being colourless:
```powershell
Select-String -Path src\renderer\src\components\AgentMark.vue,src\renderer\src\components\LaunchDialog.vue,src\renderer\src\components\FilmstripRenderer.vue,src\renderer\src\components\TerminalPane.vue `
  -Pattern '#[0-9a-fA-F]{6}\b'      # expect NOTHING
```
**⚠ `Select-String`, NOT `grep` — `grep` is not on PATH in PowerShell on this machine** (`Get-Command grep` returns nothing, verified 2026-08-26). The older 3c-era task docs write this gate as `grep -rnE`; that form is **not runnable here**, and its shell error reads exactly like a clean gate — the worst possible failure for a check whose whole job is to come back empty. This form was proven **both ways**: `ActivityBar.vue`, the one file allowed raw hex, returns **12** hits; `PaneIcon.vue` + `TitleBar.vue`, both asserted hex-free, return **0**. Do not "restore" the `grep` form.

The tint survives:
```powershell
Select-String -Path src\renderer\src\components\LaunchDialog.vue,src\renderer\src\components\FilmstripRenderer.vue,src\renderer\src\components\TerminalPane.vue `
  -Pattern "color: var\(--color-text-badge\)"      # expect 3 hits — one per tile rule
```

Scope containment:
```powershell
git diff --stat        # exactly 4 paths under src/renderer/src/components/ (3 modified + 1 new)
git status --porcelain # the pre-existing entries from section 4 are still there and still unstaged
                       # package.json must NOT appear
```

Remove the junction — **with `rmdir`, never `rm -rf` and never `Remove-Item -Recurse`**, because those two follow the junction and delete the **main checkout's** `node_modules`:
```powershell
cmd /c rmdir "C:\Projects\ContactEstablished\.chorus\Chorus\wt-2be8b104\node_modules"
```

**RUNTIME GATE — run the app, do not merely compile.** This project does not accept a compiled feature as a delivered one. Launch a real window against a `--user-data-dir` **seeded from `%APPDATA%\chorus-app`** (the dev database has no credentials, so credential paths look broken without it), driven over CDP on **port 9333 — never 9222**, which is the stable installed instance. Observe and capture:
- (a) every card in the launch picker shows its vendor mark, and **no card shows a two-letter code**;
- (b) every pane header shows its mark, in **both grid and filmstrip** views;
- (c) a **done** filmstrip card's mark re-tints — `.card-done .card-tile` sets `color: var(--color-text-muted)`, so this is the behavioural proof `currentColor` is wired to the tile rather than inherited from above;
- (d) a filmstrip card whose session row has no agent still shows the `'??'` text fallback, not an empty box;
- (e) no mark renders as an empty `<svg>` (a 16px hole).

## 9. Failure honesty

If any verification command fails — including for an unrelated environmental reason (Docker down, a locked database, a missing CLI, an ABI mismatch) — **capture the exact output, explain what happened, and do not claim the step succeeded.** A gate that did not run is not a gate that passed. Assert on the **success signal** — a test count you can read — never on the absence of an error string.

## 10. Final reporting requirements

Close the session with a report containing:
- **Status**, one of: `DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`.
- **Files changed**, with line counts, and confirmation that it is exactly the four in scope.
- **Build results**: `npm run typecheck`, `npx vitest run`, `npm run grep:secrets` — actual numbers, not "passed".
- **Runtime results**: what was actually observed for each of (a)–(e) above, with evidence paths under `_verify/7a-1/`.
- **Mark provenance**: for each of the five vendor marks, where the source was obtained and confirmation the path data matches it character-for-character; `shell` noted as Chorus's own drawing.
- **Review outcomes**: spec review and code-quality review findings, and how each was resolved.
- **Non-goals confirmation**: explicitly confirm `package.json` is unchanged, no colour was added, no dependency was installed, and `src/main/`, `src/shared/` and `src/preload/` were not opened.
- **Residual risks / follow-ups.**
- **Final `git status --porcelain`**, showing the pre-existing entries untouched and unstaged.

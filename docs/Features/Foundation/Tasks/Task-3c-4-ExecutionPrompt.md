# Task 3c-4 — Execution Prompt (paste into a fresh session)

*Authored 2026-07-27 against the code at `98191ec`, not merely against the task docs. **This
matters more than usual here:** `Task-3c-4.md` and `ImplementationSpec-3c-4.md` were written at
`1cf23ff`, before 3c-1, 3c-2 and 3c-3 landed, and **three of the things they instruct are now
wrong — two of them would cause real damage if followed.** Every fact in the tables below was
re-run this session.*

---

## Role

You are the **Coordinator** for **Chorus — Phase 3c (Design Adoption), Task 3c-4: Overlays and
Dialogs — `LaunchDialog`, `CommandPalette`, `EmptyState`, `WorktreePanel`**.

- **Repo root:** `C:\Projects\ContactEstablished\Chorus`
- **Expected branch:** `main`. **Confirm it; do not switch or create a branch without instruction.**
- **Expected HEAD at start:** `98191ec` *("The session counts stop lying after you close a pane")*.
- **Platform:** Windows 11, PowerShell primary. A Bash tool is also available; each takes its own
  syntax.

## Goal

Bring every overlay into the design language. **Two of the four surfaces have mocks and are held to
the screenshot diff; two have none and are held to token-and-primitive conformance only.** This is
the last task before Settings and Council (3c-5), and it takes the codebase's **final `#1e1e1e`**
to zero.

## ⚠ READ THIS BEFORE YOU READ THE TASK DOCS

**`Task-3c-4.md` and `ImplementationSpec-3c-4.md` are stale in three specific, load-bearing
places.** They remain your source of truth for everything else — the worktree-panel restraint, the
D56/D48 preservation rules, the behaviour re-check, the F21 warning on the destructive path — but
these three amendments override them. All three are recorded in full in `Phase-3c-Overview.md`.

### D81 — there is NO model input in `LaunchDialog`. **The spec's check cannot be run, and "restoring" one would breach D48.**

`ImplementationSpec-3c-4.md` §3 says *"the model input stays free text with an additive
`<datalist>`"*, and §6.3 makes it a verification step: *"inspect the element; it must be an
`<input>` with a `<datalist>`, not a `<select>`."*

**Verified at `98191ec`: no such element exists.** `grep` finds **zero** `<datalist>` in the file.
The three `<select>` elements are the **launch profile** (`:436`), the **credential profile**
(`:496`) and the **worktree** (`:590`) — none is the model. The model is a **read-only computed**,
`resolvedModel` (`:142`), whose own comment settles it:

> *"The model precedence order, RESOLVED IN MAIN and merely displayed here… The renderer does NOT
> re-implement the table — that would be the second home 3a-4's ruling exists to prevent."*

| Told to do | Where | Ruling |
|---|---|---|
| Verify the model input is `<input>` + `<datalist>` | spec §6.3 | ❌ **struck — cannot be performed. Do not tick it.** |
| Keep the model input free text | spec §3 | ⚠ **there is no input.** What survives is the **display**: `resolvedModel` and its conditional missing-model warning (`:508`, `data-launch-missing-model`) stay rendered, wording unchanged. |

**⚠ DO NOT ADD A MODEL INPUT.** The hazard here is the inverse of the one the spec meant to
prevent: an implementer who "restores" the missing field creates exactly the **second home for
"which model"** that **D48** exists to forbid. **3c-4 adds no model input.**

*(Two smaller corrections in the same section. `extra_args` and its D59 argv warning are **not in
this dialog** — §3's clause is conditional so it is harmless, but do not go hunting for them. And
the effort vocabulary is **not hardcoded**: `effortLevels` (`:113`) is computed from the adapter
descriptor via `adapter:list`, so §3's "`fast | balanced | deep | max`" describes DATA — writing
those labels into the view would be a regression.)*

### D82 — the spec's shared overlay anatomy contradicts BOTH mocks. **The mocks win.**

`ImplementationSpec-3c-4.md` §1 specifies the shared panel as `--color-surface-card` (`#12151A`),
`1px solid --color-border-inset` (`#1D232A`), `--radius-card` (6px). **All three are wrong** — and
because §1 is the *extract-once* shared shell, following it propagates the error into every mocked
overlay at once.

Read from the mocks this session, which **agree with each other**:

| | Workspace mock (palette) | Launch Dialog mock | Use this 3c-1 token |
|---|---|---|---|
| panel background | `#10141A` | `#10141A` | `--color-surface-overlay` |
| panel border | `#262D35` | `#262D35` | `--color-border-badge` |
| panel radius | `8px` | `8px` | `--radius-overlay` |
| panel shadow | `0 24px 60px rgba(0,0,0,.6)` | — | *(no token; it is a shadow, not a colour)* |

3c-1 already read this correctly — `--color-surface-overlay`'s own comment names this exact use
("command palette / launch dialog / mission popover — the elevated panel body"). **D73 applies:
the mock is the authority.**

**⚠ The scrim base has NO token, and its two alphas differ ON PURPOSE.** Palette scrim
`rgba(5,6,8,.62)`; launch-dialog scrim `rgba(5,6,8,.55)`. `#050608` is **not** in 3c-1's block
(`--color-surface-void` is `#08090B` — a different colour). Per D73 reproduce both alphas **as
drawn; do not unify them**, and **report the missing base colour — do not add it.** The token
block is 3c-1's and no later task edits it.

### D83 — the Startup mock is a SPLASH SCREEN. `EmptyState.vue` has no mock at all.

`Task-3c-4.md` cites *"`Chorus Startup.dc.html` — for `EmptyState`"*; spec §4 says *"20 lines
against the Startup mock."* **They are not the same surface.**

The Startup mock is a **2.75-second animated launch splash** overlaying the workspace
(`<dc-import name="Chorus Workspace">`): seven staggered logo bars, a wordmark glint sweep, a boot
line *"waking 7 voices · restoring 3 sessions"*, a version line, and its own reduced-motion block.
**Verified: `grep -rniE "splash|startup"` over `src/main/` and `src/renderer/src/` returns
NOTHING — Chorus has no splash screen.**

`EmptyState.vue` is a different thing: App.vue renders it at `:434` when `layout.tree` is null, and
it reads *"No agents running."* over a **"Launch an agent"** button. **No mock draws it** — the
Workspace mock has no empty state either (`grep -ci "no agents|empty"` → **0**).

| Ruling | |
|---|---|
| `EmptyState.vue` | ✅ **token-and-primitive conformance only** — same bar as `WorktreePanel.vue`. It is 20 lines; restyle it onto the tokens, do not redesign it. |
| The splash | ❌ **DO NOT BUILD IT.** New feature, not a restyle — no window, no timing, no boot-progress source. Its boot line is **D76** all over again: "restoring 3 sessions" needs live restore progress the renderer is never told. |
| The milestone | ⚠ **AMENDED — there are TWO unmocked surfaces, not one.** Say so in your report. |

**⚠ `EmptyState`'s button and 3c-3's rail footer are DIFFERENT VERBS — do not unify them.** The
rail's row calls `store.add()` (adds a **project**); `EmptyState` emits `launch` (opens the
**launch dialog** for a session). Spec §4's "they should read as the same action" means *visually
consistent*, not *merged*.

## Ground yourself first — before editing anything

**Read, in this order:**

1. `CLAUDE.md` — all IPC typed and Zod-validated; **payloads crossing the bridge must be PLAIN
   objects** (D14).
2. `docs/Features/Foundation/Tasks/Phase-3c-Overview.md` — the purity contract, **D73**, **D76**,
   **D77**, and **D81 / D82 / D83** above.
3. `docs/Features/Foundation/Tasks/Task-3c-4.md` — **read through the D81/D82/D83 filter.**
4. `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-3c-4.md` — **normative except
   where D81–D83 override.** Where it and the task doc differ the spec wins; where either differs
   from the mock, **the mock wins** (D73).
5. `docs/design/v2/Chorus Launch Dialog.dc.html` (16,515 B) and the
   `<!-- ══ command palette (ctrl+k or tweak) ══ -->` block of `docs/design/v2/Chorus
   Workspace.dc.html` — the authorities for the two mocked surfaces.
6. `src/renderer/src/assets/main.css` — 3c-1's `@theme static` block. **Every surface you build is
   made from these; the files you own may contain no raw hex.**
7. `src/renderer/src/components/TitleBar.vue`, `ProjectRail.vue`, `StatusBar.vue` — **the house
   idiom you must match**: scoped `<style>`, semantic class names, `var(--token)` throughout, zero
   Tailwind palette utilities. 3c-2 and 3c-3 set this pattern; follow it rather than inventing one.

**Ground facts — all re-verified 2026-07-27 at `98191ec`:**

| Fact | Where | Status |
|---|---|---|
| `LaunchDialog.vue` **647 lines** · `CommandPalette.vue` **118** · `EmptyState.vue` **20** · `WorktreePanel.vue` **298** | renderer | ✅ unchanged by 3c-3 |
| `App.vue` is **475 lines** (was 403 before 3c-3) | `App.vue` | ✅ — **spec line refs to App.vue are stale** |
| Stock-palette hits to remove: **LaunchDialog 38 · WorktreePanel 29 · CommandPalette 4 · EmptyState 2** | grep | ✅ |
| All three overlays are `fixed inset-0 z-50` with `bg-black/50`, `role="dialog"`, `aria-modal="true"` | `CommandPalette:91,94` · `LaunchDialog:420,421` · `WorktreePanel:170,174` | ✅ they cover titlebar + status bar, which **matches the mock** (its scrim spans the whole screen) |
| `anyOverlayOpen` lives at `App.vue:156`, feeds the attention report at `:238`/`:246`, and is passed to Settings/Council at `:406`/`:411` | `App.vue` | ✅ **do not touch** |
| `resolvedModel` is a computed at `:142`; the missing-model warning at `:508` carries `data-launch-missing-model` | `LaunchDialog.vue` | ✅ D81 |
| `effortLevels` computed at `:113` from the adapter descriptor — **no level name is hardcoded** | `LaunchDialog.vue` | ✅ |
| `WorktreePanel` renders `row.status` as **plain text** (`:225`); no state maps cleanly to `StateMarker` | `WorktreePanel.vue` | ✅ **so leave its indicator alone** — spec §5's own fallback |
| `#1e1e1e` survives in **exactly 1 place**: `EmptyState.vue:11` | grep | ✅ **yours — take it to 0** |
| `StateMarker.vue` needs-you marker is **8px** (D79) | `StateMarker.vue` | ✅ |
| `chorusPulse` still has **no first caller** (D78) — expected, do not "fix" it | `main.css` | ✅ |
| Baseline: **947 tests / 29 files**, all passing | `npx vitest run` | ✅ **947, not 941** |
| `IpcChannel` **56** · `ipcMain.handle(` **51 / 0** · `sqliteTable(` **15** · `MIGRATIONS.length` **11** | — | ✅ |

**⚠ `palette/commands.test.ts` was edited by 3c-3 and that is expected.** D80 made `sessionCount`
required on `projectsListSchema`, and this file builds `ProjectsList` fixtures, so it stopped
compiling; two fixture rows gained the field and **no assertion changed**. `Task-3c-4.md`'s rule
that it stays green **"unedited"** still holds — but **"unedited" means unedited FROM HEAD**, not
from the 3c-1 baseline. **The standing rule is untouched: no `stores/*.test.ts` in your diff.**

**Run these git checks first:**

```bash
git branch --show-current    # expect: main
git log --oneline -1         # expect: 98191ec
git status --porcelain
```

## ⚠ Pre-existing changes — do not touch

`git status` will show paths that are **not yours**:

```
 M docs/Features/Foundation/Tasks/Phase-3c-Overview.md   ← D81/D82/D83, written at kickoff
 M docs/Features/Foundation/roadmap.md                   ← 3c progress + D77-D83
?? docs/Features/Foundation/Investigations/              ← unrelated
```

**Do not revert them and do not fold them into your commit.** Your commit must contain only the
files listed under Scope. *(If Matthew has committed the doc updates before you start, `git status`
will show only `Investigations/` and HEAD will be one commit past `98191ec` — that is expected, and
the ground facts are unaffected because that commit is docs-only.)*

## Implementation scope

### Edit — and nothing else

- **`src/renderer/src/components/LaunchDialog.vue`** — against its mock. The largest job.
- **`src/renderer/src/components/CommandPalette.vue`** — against the Workspace mock's palette block.
- **`src/renderer/src/components/EmptyState.vue`** — **conformance only** (D83). Kills the last `#1e1e1e`.
- **`src/renderer/src/components/WorktreePanel.vue`** — **conformance only.**

**Nothing else.** No new component unless you extract the shared overlay shell (below), which may
live in `src/renderer/src/components/`.

### The shared overlay shell (spec §1, corrected by D82)

Extract the common treatment **once** — a small wrapper component or a shared class set,
implementer's choice, but **one home**. Using the **corrected** values:

- **Scrim**: `rgba(5,6,8,.62)` palette / `rgba(5,6,8,.55)` launch dialog — **two alphas, as drawn**.
- **Panel**: `--color-surface-overlay`, `1px solid --color-border-badge`, `--radius-overlay`.
- **Keycap hints**: `--font-mono` `9.5px`, `1px solid --color-border-divider`, background
  `--color-surface-keycap`, radius `--radius-chip`, padding `1px 5px`. *(3c-3's `StatusBar.vue`
  already implements exactly this — match it rather than re-deriving.)*
- **Eyebrow labels**: mono, `9.5px`, `.18em` tracking, `--color-text-eyebrow`.

**⚠ The wrapper is PRESENTATIONAL ONLY. Do not change any overlay's open/close/Esc mechanics while
extracting it.** `anyOverlayOpen` feeds the attention report; an overlay that stops reporting
itself makes the app credit dialog time to a terminal pane, and per **D50** that telemetry cannot
be corrected later.

### The three things this task must get right

1. **The worktree panel is restyled, not redesigned.** `git diff` must read as **class-attribute
   churn**. If elements moved, were renamed or regrouped, the scope was exceeded — however much
   better it looks. Its `row.status` text indicator **stays as text**: no state maps cleanly onto
   `StateMarker` and inventing a fifth shape is a design decision, not an implementation one.
2. **The destructive path is untouchable.** The worktree removal confirmation has **F21** history:
   its logic, its required confirmation text and its wording are **byte-identical** after your
   change. Restyle the container; leave the mechanism alone.
3. **The launch dialog is worked top-down through the mock, section by section** — not by
   search-and-replacing colour classes. The mock has a real information hierarchy (profile, agent,
   route, model, effort, worktree); the current dialog's is flat. **Preserve exactly:** the profile
   → route → model resolution and **D56's precedence order** (expressed in main — never
   re-implemented or second-guessed in the view), and the missing-model warning's wording.

## Strict non-goals

- **Do not add a model input** (D81). **Do not build the splash screen** (D83).
- **Do not redesign `WorktreePanel.vue`** or `EmptyState.vue` — both are conformance-only.
- **Do not touch the worktree removal confirmation flow** — F21.
- **Do not change `anyOverlayOpen`, or any overlay's open / close / Esc handling.**
- **Do not touch `src/renderer/src/palette/commands.ts`** — the command list, ids and
  `hasActiveProject` gating are behaviour, asserted by `commands.test.ts`.
- **Do not add an IPC channel, handler, or payload field.** 56 / 51 / 0 are frozen. **D80 was
  3c-3's one-off; no other task in this phase may reshape a payload.**
- **Do not change store logic.** `stores/*.test.ts` must not appear in `git diff --stat`.
- **Do not edit 3c-1's token block or remove `@theme static`.** Missing token → **report it**.
- **Do not touch anything 3c-2 or 3c-3 built** — `TitleBar.vue`, `ProjectRail.vue`,
  `StatusBar.vue`, `FilmstripRenderer.vue`, `LayoutRenderer.vue`, `TerminalPane.vue`,
  `StateMarker.vue`, `App.vue`.
- **Do not touch settings or council views** — 3c-5.
- **Do not add a dependency.** Anything needed → stop and ask.
- **Do not push or open a PR unless explicitly asked.**

## Required workflow

1. **Ground** — read the seven documents and verify the ground-fact table against the code.
2. **Implement in the spec's order**: the shared overlay shell (D82's values) → `CommandPalette.vue`
   → `LaunchDialog.vue` → `EmptyState.vue` → `WorktreePanel.vue`.
3. **Spec review** — re-read `ImplementationSpec-3c-4.md` against your diff **through the D81–D83
   filter**. Did any model input appear? Did the worktree panel's elements move? Is the destructive
   path byte-identical? Any stock Tailwind utility left?
4. **Code-quality review** of your own diff.
5. **Resolve findings**, then **verify** (below). The visual pass and the behaviour re-check are
   not optional.
6. **One intentional commit**, narrated in the repo's established style: a plain-language title,
   then a body a non-technical reader follows first, technical detail second. **Do not push.**

## Verification

### Build gates — all must pass

```bash
npm run typecheck && npx vitest run && npm run grep:secrets
```

**Expected:** typecheck **0** · vitest **947**, **never fewer**, across **29 files** ·
`grep:secrets` **clean across 6 patterns**. **No pre-existing test may be edited in this task** —
D80's exception was 3c-3's and is spent.

### Grep gates — with expected counts

```bash
grep -rn "neutral-\|sky-\|zinc-\|slate-\|gray-\|red-[0-9]\|amber-[0-9]\|emerald-\|green-[0-9]" \
  src/renderer/src/components/LaunchDialog.vue \
  src/renderer/src/components/CommandPalette.vue \
  src/renderer/src/components/EmptyState.vue \
  src/renderer/src/components/WorktreePanel.vue     # expect NOTHING
```

```bash
grep -rn "#1e1e1e" src/                                        # expect NOTHING — you kill the last one
grep -rnE "#[0-9a-fA-F]{6}\b" src/renderer/src/components/{LaunchDialog,CommandPalette,EmptyState,WorktreePanel}.vue   # expect NOTHING
grep -c "<datalist" src/renderer/src/components/LaunchDialog.vue    # expect 0 — D81, none added
git diff --stat src/renderer/src/palette/                      # expect EMPTY
git diff --stat src/renderer/src/stores/                       # expect EMPTY
grep -oE "^\s+[A-Za-z]+: '[a-z0-9:-]+'" src/shared/ipc.ts | wc -l   # expect 56 — UNCHANGED
grep -c "ipcMain.handle(" src/main/ipc.ts                      # expect 51 — UNCHANGED
grep -c "ipcMain.handle(" src/main/index.ts                    # expect 0  — MUST stay zero
grep -c "sqliteTable(" src/main/db/schema.ts                   # expect 15
```

`MIGRATIONS.length` must remain **11** (`src/main/services/storage.ts`).

### G2 — the visual pass, on the real running app

**Cold-boot with at least two projects**, and screenshot each surface:

- [ ] **Command palette** (Ctrl+K) against the Workspace mock's palette block — panel
      `#10141A` / `#262D35` / 8px (**D82**), the **selected-row treatment**
      (`background: rgba(59,207,174,.08)` with a `2px solid #3BCFAE` left border), the keycap
      hints, and the footer line.
- [ ] **A disabled command** — `council.run` is disabled without an active project. It must read
      as disabled by **more than opacity alone**.
- [ ] **Launch dialog** against its mock, in **more than one state**: a profile selected, no
      profile, and the worktree option engaged. A dialog screenshotted only in its empty state
      hides most of its surface area.
- [ ] **The missing-model warning still renders** where it did — it is D81's surviving half.
- [ ] **Empty state** — conformance only. **State plainly in the report that it is unmocked**
      (D83) and what it now looks like.
- [ ] **Worktree panel** — conformance only. Screenshot it and **state plainly that it is
      unmocked** and that it was not redesigned.

### Behaviour re-check — this task touches four interactive surfaces

- [ ] **Ctrl+K opens the palette; Esc closes it; ↑/↓ and Enter still select and run.**
- [ ] **A launch from the dialog still starts a session** on the right agent, route and model.
- [ ] **The worktree panel's create / detach / gated remove flow behaves exactly as before**,
      including the confirmation requirement.
- [ ] **`anyOverlayOpen` still flips** — with an overlay open, attention must classify as
      `overhead` rather than crediting a pane.
- [ ] **The empty state's "Launch an agent" still opens the launch dialog.**

### Runtime mechanism

**CDP on `--remote-debugging-port=9222`.** Launch with `_verify/launch.ps1` (it restores `PATH`/
`ComSpec`, which the harness strips, and returns the wrapper PID). Working drivers are at
`_verify/3c-1-cdp.js` (`eval`, `shot`, `media`, `mediaeval`) and `_verify/3c-3-cdp.js`
(`shotclip <out> <x> <y> <w> <h> <scale>` — clipped, scaled captures). `_verify/3c-3-hover.js`
dispatches a real `Input.dispatchMouseEvent` and screenshots **in the same CDP session**, which is
how hover states must be captured. `_verify/3c-3-sample.ps1 -In <png> -Points 'x,y,label;…'` samples
pixels out of a CDP capture in page coordinates — the quickest way to check a colour against the
mock's literal. `_verify/` is gitignored; reuse and extend freely.

⚠ **Harness facts that will bite you:**

- **F17 — electron-vite does NOT hot-restart the main process.** This task touches **no** main
  code, so renderer HMR is enough; reload rather than cold-boot when iterating.
- **`Emulation.setEmulatedMedia` is CDP-SESSION-scoped** — set and read in one session (that is
  what `mediaeval` is for), or you silently read the un-emulated page.
- **`:hover` does not survive a socket close** — dispatch the mouse event and capture in the same
  session (`3c-3-hover.js`).
- **CSS-only edits hot-reload, but Tailwind needs a beat to regenerate.** For anything
  load-bearing, **cold-boot rather than trusting HMR.**
- **⚠ `window.confirm` BLOCKS the renderer under CDP.** The worktree removal path uses confirms;
  stub `window.confirm` in the evaluated expression and restore it in a `finally`, the way
  `_verify/3c-3-expr-closemine.js` does.
- **The app's real user-data-dir is `C:\Users\matth\AppData\Roaming\chorus`** and its DB is
  `chorus.db` there. **You should not need DB evidence.** If you do, `better-sqlite3` is built for
  Electron's ABI — run scripts as `ELECTRON_RUN_AS_NODE=1
  ./node_modules/electron/dist/electron.exe <script>`, use **forward slashes** in paths (backslash
  escaping through the shell layers is a known foot-gun that presents as `SQLITE_CANTOPEN`), and
  stop the app first so the WAL checkpoints.
- **Cost envelope: `$0.00`.** This task makes **no API call**. A launch during the behaviour
  re-check starts a local PTY agent, which is free. If something appears to require an API call,
  stop and report.

## Failure honesty

**If any verification command fails for an unrelated environment reason, capture the exact output,
explain what happened, and do not claim success. A gate that could not be run is not a gate that
passed.**

**This applies with force to the visual pass and the behaviour re-check.** Several boxes — the
gated worktree remove, `anyOverlayOpen` still flipping, and the palette's keyboard path — are
exactly the kind that are tempting to reason about rather than perform. **If you could not
actually perform one, say which and why, and mark it UNPROVEN.** Do not substitute an inference
from the code.

## Final reporting requirements

1. **Status** — `DONE` · `DONE_WITH_CONCERNS` · `NEEDS_CONTEXT` · `BLOCKED`.
2. **Files changed**, with `git diff --stat`. Confirm it lists only the four components (plus any
   extracted overlay shell), and that **no `stores/*.test.ts` and no `palette/` file appears**.
3. **The frozen numbers**: `IpcChannel` **56**, `ipcMain.handle(` **51 / 0**, `sqliteTable(` **15**,
   `MIGRATIONS.length` **11** — all unchanged. **If any moved, say so loudly.**
4. **Build results** — typecheck, the vitest figure (**947**, never fewer), `grep:secrets`, and
   every grep gate count **including `#1e1e1e` now being 0** and `<datalist` being 0.
5. **The visual pass, surface by surface**, with screenshots — including the palette's selected
   row, a disabled command, and the launch dialog in **more than one state**.
6. **The behaviour re-check, item by item** — what you actually did and observed, with the
   **gated worktree remove** and **`anyOverlayOpen` still flipping** called out separately.
7. **The worktree-panel diff, characterised** — state explicitly whether it is class churn only,
   and confirm the removal confirmation's logic and wording are byte-identical.
8. **Confirmation that the files you own contain no raw hex and no stock Tailwind palette
   utilities**, which 3c-1 tokens you used, and **any the mocks needed that 3c-1 did not provide**
   (**report, do not add**) — the scrim base `#050608` is already known to be one.
9. **The two unmocked surfaces, named as such** — `EmptyState.vue` and `WorktreePanel.vue`, per
   D83. Do not present either as matching a mock.
10. **Non-goals confirmation** — no model input added, no splash built, no channel/handler/payload
    change, no store logic or store test changed, `palette/commands.ts` untouched, the destructive
    path untouched, `@theme static` intact, nothing touched in 3c-2/3c-3/3c-5 territory.
11. **Residual risks and anything you had to decide** that these documents did not settle.
12. **Final `git status`**, confirming `docs/Features/Foundation/Investigations/` is still
    untracked.

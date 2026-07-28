# Phase 3c — Design Adoption — Task Overview

**Kicked off:** 2026-07-26, against the verified codebase at `1cf23ff`.
**Roadmap:** [`../roadmap.md`](../roadmap.md) §7 "Phase 3c — Design Adoption" (created by D38).
**Feature:** Foundation.

## Why this phase is first in the queue

Matthew's stated goal, and it should be read as the phase's acceptance bar rather than as
motivation: **he wants to reach the point where he can actively use Chorus day-to-day to
continue developing Chorus.** Every phase after 3c pays the retrofit cost of not having done
it; no other queued phase moves the app toward daily use. Where a decision inside this phase
is a genuine toss-up, **prefer the option that makes the app pleasant to sit in front of all
day.**

## Verified ground facts (checked 2026-07-26 at `1cf23ff` — every number below came from a
command run this session)

### The mockups that actually exist

**⚠ THE AUTHORITY IS `docs/design/v2/`, AND IT IS NOT A FORK — verified by `cmp`, 2026-07-26.**
Matthew delivered the council mock (D72) inside a `v2/` folder alongside re-exports of everything
else. **All seven pre-existing screens are BYTE-IDENTICAL to their originals**, so v2 adds the
council mock and changes nothing else. Every 3c document cites `docs/design/v2/`; citing the root
for six files and v2 for one would be the two-homes hazard for no benefit. *(`support.js` does
differ — 66,404 → 69,150 B — but it is the mock renderer harness, not a screen.)*

`docs/design/v2/` holds **eight** `.dc.html` mocks plus `support.js`:

| `Chorus Council.dc.html` (69,011 B) | `Council Review` | **3c (Task 3c-5)** — **NEW**, D72, coordinator-reviewed and passing all five invariants |
|---|---|---|

and the seven that predate it:

| File | `data-screen-label` | Phase that owns it |
|---|---|---|
| `v2/Chorus Workspace.dc.html` (30,900 B) | `Main Workspace` | **3c** — titlebar, project rail, pane header, terminal, filmstrip, status bar, command palette |
| `Chorus Launch Dialog.dc.html` (16,515 B) | `Launch Dialog` | **3c** |
| `Chorus Settings Providers.dc.html` (16,484 B) | `Settings — Providers & Keys` | **3c** |
| `Chorus Startup.dc.html` (6,248 B) | `Startup` | **3c** |
| `Chorus Micro Surfaces.dc.html` (14,762 B) | `Micro-surfaces` | **Phase 5** — it is the mission-control overlay over a fake IDE, plus push-to-talk mic pills. **Not a 3c surface.** |
| `Chorus Attention Inbox.dc.html` (14,340 B) | `Attention Inbox` | **Phase 4** |
| `Chorus Overview.dc.html` (12,098 B) | *(none)* | index/overview document, not a screen |

**⚠ A NINTH FILE ARRIVED 2026-07-27, AFTER KICKOFF: `docs/design/v2/Chorus Needs Attention.html`
(412,049 B).** It is **not a screen mock** — it is a **state specification** for `needs-you` across
four scales (filmstrip card · inbox row · OS tray · escalation over time), with a token table and a
do/don't list. **Its format differs from the other eight:** a self-unpacking bundle whose real
~42 KB document is a JSON-escaped string in the `<script type="__bundler/template">` block, so
`grep` over the raw file finds almost nothing — extract it before reading. **Per D78 it is PHASE
4's normative spec, not 3c-3's**, because what it specifies is a capability the app does not have.
It does, usefully, **confirm 3c-1 got the pulse exactly right**: its `attn.core #F59E0B`,
`attn.edge.lo .45`, `attn.edge.hi .95`, `attn.cycle 2200ms` and its reduced-motion resolution all
match the shipped `chorusPulse` keyframe line for line.

**⚠ There is no CSS custom property anywhere in any mock.** `grep -o '--[a-z0-9-]*:[^;]*;'`
across `docs/design/*.dc.html` returns **nothing**. Every value is an inline literal, so
"extract design tokens" is genuine extraction work with no existing naming to inherit.

**⚠ The mocks load fonts from the Google Fonts CDN** —
`fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=JetBrains+Mono:ital,wght@0,400;0,500;0,600;1,400`.
A local-first desktop app cannot ship that.

### The renderer surfaces that exist today

13 `.vue` files, **4,222 lines** total:

| File | Lines | Mock | Notes |
|---|---|---|---|
| `views/SettingsProviders.vue` | 1,171 | ✅ Settings Providers | largest surface in the app |
| `components/LaunchDialog.vue` | 647 | ✅ Launch Dialog | |
| `components/TerminalPane.vue` | 631 | ✅ Workspace (pane header + terminal) | xterm host |
| `App.vue` | 395 | ✅ Workspace (shell) | `activeView` is `'workspace' \| 'settings' \| 'council'` (line 100) |
| `views/SettingsCredentials.vue` | 329 | ⚠ partial — the mock is "Providers **& Keys**" | |
| `components/WorktreePanel.vue` | 298 | ❌ **no mock** | |
| `views/CouncilView.vue` | 273 | ❌ **no mock** | shipped by Task 3b-4, after the design set was drawn |
| `components/FilmstripRenderer.vue` | 121 | ✅ Workspace (right rail) | |
| `components/CommandPalette.vue` | 118 | ✅ Workspace (palette section) | |
| `components/LayoutRenderer.vue` | 108 | ✅ Workspace | |
| `views/SettingsView.vue` | 73 | ✅ Settings Providers (shell) | built to the design's skeleton in 3-4 on purpose |
| `components/ProjectTabs.vue` | 38 | ⚠ **replaced, not restyled** — the design has a 208px left rail, not a top tab bar | |
| `components/EmptyState.vue` | 20 | ✅ Startup | |

### Styling and toolchain state

- **Tailwind v4.3.3** via `@tailwindcss/vite` (`electron.vite.config.ts:4,15`). **There is no
  `tailwind.config.*` file** — v4 is CSS-first, so the theme lands in `@theme` inside CSS.
- `src/renderer/src/assets/main.css` is **9 lines**: `@import 'tailwindcss'` and a
  `html, body, #app` block hardcoding `background: #1e1e1e`. That is the entire current theme.
- Existing surfaces use **stock Tailwind palette utilities** (`neutral-800`, `sky-500`,
  `red-400`, `amber-300`), none of which are the design's colors.
- **`BrowserWindow` today has a native frame** (`src/main/index.ts:37–51`): no `frame`, no
  `titleBarStyle`, `autoHideMenuBar: true`, `backgroundColor: '#1e1e1e'`, bounds restored from
  `storage.getWindowBounds()`, with `resized`/`moved` persistence and the 3a-2 focus latch
  wired to the same window.
- **⚠ There are no component tests. None.** All 6 renderer test files are stores/logic
  (`stores/*.test.ts`, `palette/commands.test.ts`, `attention/reporter.test.ts`); 29 test files
  repo-wide, **941 tests passing**. **No visual claim in this phase can be discharged by
  vitest** — this is the F15 lesson in its sharpest form.

## Decisions settled at kickoff (Matthew, 2026-07-26)

| # | Decision | Ruling |
|---|---|---|
| **D72** | **The council view has no mock — design it, or defer it?** | **DESIGN IT FULLY IN 3c — ✅ DISCHARGED THE SAME DAY.** Matthew produced the mock in Claude Design from [`docs/design/CouncilView-DesignPrompt.md`](../../../design/CouncilView-DesignPrompt.md) and delivered it as `docs/design/v2/Chorus Council.dc.html` (**69,011 B**, all six requested states plus a roster legend). **Coordinator-reviewed at delivery: all five invariants PASS** — F27 wording verbatim, the standing caveat verbatim and above the synthesis, unavailable members shown *and* explained, every accounting figure carrying its denominator, and **zero** verification chrome (the only `verified` in the file is inside the caveat's own *"not verified fact"*). **⚠ It EXCEEDS the brief in three places worth adopting** (`ImplementationSpec-3c-5.md` §1a): refused turns render as transcript **rows rather than gaps** — new behaviour relative to the shipped view; the cost line states ***"true total is at least this"***, which is **F39's under-reporting made visible in the UI**, something the shipped view does not say; and motion is deliberately confined to the phase track so per-member state stays a **stable marker, never a spinner**. **"Make it look like Settings" never came into play.** |
| **D73** | **~45 distinct hex values, ~10 near-identical darks. Faithful extraction, or snap to a disciplined ladder?** | **REPRODUCE EVERY VALUE FAITHFULLY.** The milestone's screenshot diff stays literally checkable, and the mocks remain the authority. **⚠ The accepted cost, stated so a later reader does not "clean it up": the theme will contain several values differing by 1–2 hex points with no semantic distinction** (`#0F1216` / `#101318` / `#111419` / `#101317`, and `#12151A` / `#12161B` / `#12151A`). They are named by **role and provenance**, not by similarity, and **collapsing them later is a design change requiring Matthew's approval — not a refactor.** |
| **D74** | **Frameless titlebar: `frame:false` with custom controls, or `titleBarStyle:'hidden'` + `titleBarOverlay`?** | **`frame:false`, FULLY CUSTOM CONTROLS.** Matches the mock exactly, including the `#C42B1C` close hover. **⚠ The accepted cost is that Windows behaviour must be re-implemented rather than inherited:** minimize / maximize / restore / close, double-click-to-maximize, drag regions, resize edges, and the maximized-state icon swap. Task 3c-2 owns all of it and is deliberately isolated so a problem there cannot block the rest of the phase. |
| **D75** | **Fonts: vendor `.woff2`, add `@fontsource` packages, or keep the CDN?** | **ADD `@fontsource` PACKAGES.** ⚠ This is **two dependencies not named in `CLAUDE.md`'s locked stack** (`@fontsource/archivo`, `@fontsource-variable/jetbrains-mono` or the static equivalent), and **CLAUDE.md requires asking before adding any such dependency — Matthew was asked and approved it explicitly at kickoff.** They are `devDependencies`-installed but bundled into the renderer at build time. **The CDN link must be gone, not merely supplemented:** a local-first app makes no font request at launch, and the acceptance criterion is that the app renders correctly with networking disabled. |

### D77 — there is no component-test harness, and this phase is not the place to build one *(Matthew, 2026-07-26, settled while authoring Task 3c-1's execution prompt)*

**Found by authoring the prompt against the code rather than against the task docs** — the same
pass that produced D66 in Phase 3b and D68 in Task 3b-4. Task 3c-1 required a `StateMarker.vue`
component test as "the repo's first". **The repo cannot run one, and the gap is bigger than the
task doc assumed:** `vitest.config.ts` sets `environment: 'node'`, includes only
`src/**/*.test.ts`, and documents itself as *"Pure-logic unit tests only"*; there is **no
`@vue/test-utils`, no `jsdom`, no `happy-dom`.** Satisfying it meant **two dependencies against
`CLAUDE.md`'s locked stack plus changing a deliberately-chosen test environment** — where D75's
approval covered fonts only.

**RULING: no component test. Prove shape-distinctness on the real rendered app via CDP.** The
property being claimed is *"a user who cannot distinguish these colors can still distinguish
these states"*, and a jsdom assertion on `transform: rotate(45deg)` is a **weaker** proof of that
than a grayscale screenshot of the running app. The phase's entire verification model is already
CDP screenshots **because** no component tests exist; adding a harness for one component would be
the inconsistent choice, not the rigorous one.

**⚠ ITS CONSEQUENCE, STATED RATHER THAN DISCOVERED LATER: 3c-1 mounts `StateMarker` NOWHERE**
(it restyles nothing), so there is nothing for CDP to photograph in that task. **The runtime
proof is therefore OWED BY TASK 3c-3** — the grayscale filmstrip check already in its acceptance
criteria — and 3c-1 verifies the component **structurally only** and must say so. This is the
**`attention_spans` (v7) precedent**: something written one task before its first caller, with
the gap named in writing instead of papered over.

**Not closed, just not here:** if component testing proves worth having later, it is its own
decision with its own approval — `vitest.config.ts` stays byte-identical through this phase.

### D76 — the mocks draw data that does not exist. **Omit it; never fake it.** *(coordinator, 2026-07-26)*

The Workspace mock's rail and status bar render numbers Chorus cannot currently produce. Verified
this session against `src/shared/ipc.ts`:

| Mock element | Data source today | Ruling |
|---|---|---|
| Project rail: `5 sessions · $1.94` | session count **yes** (session/layout stores); **per-project cost NO** — `attribution:summary` is **account-scoped** and windowed (F35 says so explicitly), not per project | render the session count; **omit the cost** |
| Status bar: `worktrees 4` | **yes** — `worktree:list` | render |
| Status bar: `7 sessions · 3 running · 1 waiting · 1 error` | **yes** — session store + state | render |
| Status bar: `taxapp $1.94 · all $4.12 today` | **NO** per-project or per-day rollup exists | **omit** |
| Status bar: `neo4j :7688` | **NO** — Neo4j is **Phase 6** and does not exist | **omit** |
| Rail attention badge (`◆ 2`) | **yes** — pane state | render |

**THE RULING: render what the data supports, omit the rest, and never render a placeholder,
a zero, or a dash where a real number will later go.** Two reasons, and the second is the one
that binds:

1. A fake `$0.00` is a false statement to the user about their own spending.
2. **It is the same defect D55 already forbids one layer down** — the codebase's standing rule
   is *no number without its denominator*, and `attribution:summary`'s schema enforces "null,
   never 0" for exactly this case. A UI that invents `$0.00` re-introduces at the pixel level
   the defect the wire schema was written to prevent.

**⚠ This makes the screenshot diff non-literal for two surfaces**, and that is the honest cost of
D76: the rail and status bar will match the mock's *design* while showing fewer facts. **Recorded
here so a later reviewer reads it as a ruling rather than as an incomplete implementation** —
and so that whichever phase adds per-project cost knows the slot was left for it deliberately.

### D78 — the `needs-you` state has no data source, and building one is Phase 4's *(Matthew, 2026-07-27, settled while authoring Task 3c-3's execution prompt)*

**Found by authoring the prompt against the code at `fbb6d2b` rather than against the task docs** —
the same pass that produced D66 in Phase 3b, D68 in Task 3b-4, and D77 in Task 3c-1. **The renderer
can derive exactly THREE session states, not four**, and three separate claims in the 3c-3 documents
rest on a fourth that does not exist:

| Claimed | Where | Reality at `fbb6d2b` |
|---|---|---|
| Rail attention badge `◆ 2` | **D76's own table**, `ImplementationSpec-3c-3.md` §2 | ❌ no source |
| Status bar `1 waiting` | `ImplementationSpec-3c-3.md` §3, marked "✅ from the session store" | ❌ no source |
| Filmstrip needs-you card + `data-pulse` | `ImplementationSpec-3c-3.md` §4 | ❌ no source |

**The evidence, re-run this session:** `sessionStatusSchema = z.enum(['running','exited'])` —
two statuses. `SessionInfo` is `{id, agent, status, title, createdAt, exitCode, branch}`;
`PaneSessionState` is `{agent, status, exitCode, busy}`. Neither carries attention. **The
`attention:*` machinery is WRITE-ONLY OUTBOUND** — `attention:summary` is *never called anywhere in
the renderer*, and its response is attention-**minutes** bucketed by
`pane|overhead|blurred|idle|locked`. ⚠ **That is the HUMAN's attention, not the agent's state**: its
`idle` means "nobody has touched the keyboard for 60 s", **not** "the agent is blocked on you".
Nothing anywhere reads the PTY stream looking for an agent prompt. So the derivable states are
**running** (`status==='running'`) · **done** (`exited`, `exitCode===0`) · **error** (`exited`,
`exitCode!==0`).

**⚠ `docs/design/v2/Chorus Needs Attention.html` (Matthew, 2026-07-27) DOES NOT CLOSE THIS GAP, AND
THAT IS THE POINT.** It is an excellent and now-normative spec — it settles shape (diamond), hue
(`#F59E0B`), motion (2.2 s), the four scales, the escalation curve, the reduced-motion resolution,
and a do/don't list worth obeying. **But it specifies a CAPABILITY, not a skin.** Its Scale A — the
filmstrip card, the only one of its four scales in 3c-3's territory — needs four facts the app
cannot produce: detection that *"a voice has stopped and cannot continue without a human"*, the
agent's **verbatim ask** (`asking: run \`dotnet ef database update\``), **elapsed wait**
(`4m 12s`), and **per-session cost** (`$0.31`). Scales B (inbox row), C (tray badge) and D
(escalation over time) are Phase 4/5 surfaces outright.

**RULING: 3c-3 ships the three states that exist. `Chorus Needs Attention.html` becomes the
normative spec for PHASE 4**, which already owns the Attention Inbox mock. This confirms and
extends D77's "the fourth is owed by Phase 4".

**⚠ ITS CONSEQUENCES, STATED RATHER THAN DISCOVERED LATER:**

- **No rail attention badge, no `1 waiting` tally, no needs-you card, no `data-pulse` in 3c-3.**
- **`chorusPulse` ships with NO FIRST CALLER.** 3c-1 wrote it for this card. It stays unused until
  Phase 4 — **named here, not left to look like an oversight**, exactly as `StateMarker`'s own gap
  was named by D77 and `attention_spans` (v7) was before it. **This is now the SECOND artefact 3c-1
  built one phase ahead of its consumer, and both are waiting on the same Phase 4 work.**
- **The `prefers-reduced-motion` visual check moves to Phase 4 with it** — 3c-3 has nothing pulsing
  to photograph, so that acceptance line cannot be discharged here and must not be ticked.
- **Detection is deliberately NOT attempted by heuristic.** Inferring "waiting" from terminal output
  would invent a signal (D76's core prohibition) and would be behaviour work inside a restyle. A
  false pulse is worse than none: the design doc's own rule is *"Pulse forever. Motion that never
  resolves is trained-out within a day."*

### D79 — the attention marker is 8px canonical, 6px in the rail badge *(Matthew, 2026-07-27)*

Three sizes were in play once the new doc landed: **`Chorus Needs Attention.html` says 8px**
("8px square `rotate(45deg)` no radius"), **`StateMarker.vue` ships 7px** (read by 3c-1 from the
Workspace mock's filmstrip card), and **the Workspace mock's rail badge draws 6px**. D73 makes the
screenshot diff literal, so two design sources disagreeing needed a ruling rather than a preference.

**RULING: 8px is the token's canonical size — `StateMarker.vue` moves 7px → 8px. The rail badge
keeps the Workspace mock's 6px** as an intentional density variant, recorded so a later reader sees
a ruling and not drift. The glow is unchanged and already agrees across both sources
(`0 0 8px rgba(245,158,11,.6)`).

⚠ **Only the `needs-you` marker changes.** The other three keep 3c-1's mock-derived geometry
(running circle 8px, error triangle 11×10, done square 7px). **This edit has no visible effect in
3c-3** — per D78 the needs-you marker renders nowhere in this phase — so it is a source-only change
that hands Phase 4 the right value. If the 8px diamond later reads inconsistently beside the 7px
square, **report it; do not adjust the others in passing.**

### D80 — `project:list` gains a session count: a DECLARED exception to the purity contract *(Matthew, 2026-07-27)*

The mock's rail shows a session count on **every** project. Verified this session: it cannot.
`projectsListSchema` is `{id, name, root_path, active}` — no count — and sessions reach the renderer
only via `getLayout(activeId)`, with the layout store holding **one project's tree at a time**. So
the count is available for the active project and no other. **D76's table row "session count yes
(session/layout stores)" is therefore true for one rail item out of N.**

Three options were weighed: render the count on the active item only (asymmetric against the mock);
N× `layout:get` at boot (N extra round-trips, and behaviour work); or **one `GROUP BY` in main
folded into the response `project:list` already returns.**

**RULING: add `sessionCount` to `projectsListSchema`, computed in main with a single
`GROUP BY project_id` over the `sessions` table** (which already carries a `notNull` `project_id`
FK). **No new channel — `IpcChannel` stays 56. No new handler — `ipcMain.handle(` stays 51. No extra
round-trips.**

**⚠ IT IS STILL A PAYLOAD RESHAPE, WHICH THIS PHASE'S PURITY CONTRACT FORBIDS, AND IT IS ADMITTED
ON D74'S TERMS: recorded here as a named exception BEFORE the task runs, rather than discovered
mid-task.** It is bounded to this one field on this one existing response, and **no other task in
this phase may reshape a payload.**

**⚠ IT WILL REQUIRE EDITING ONE EXISTING TEST, AND THAT IS EXPECTED — NOT A CONTRACT BREACH.**
`src/shared/ipc.test.ts:380–400` asserts `projectsListSchema.parse(list)).toEqual(list)` against
objects with no `sessionCount`, so a required field makes it fail. **That is an IPC SCHEMA test
gaining a new field's coverage. The contract's standing rule — "no STORE test is edited to
accommodate a restyle" — is untouched, and `stores/*.test.ts` must still not appear in the diff.**

### D81 — `LaunchDialog` has NO model input, and the 3c-4 spec's check for one cannot be run *(coordinator, 2026-07-27, found while authoring Task 3c-4's execution prompt)*

**The same author-against-the-code pass that produced D66, D68, D77 and D78–D80.**
`ImplementationSpec-3c-4.md` §3 instructs that *"the model input stays free text with an additive
`<datalist>`"* and §6.3 makes it a verification step: *"inspect the element; it must be an
`<input>` with a `<datalist>`, not a `<select>`."*

**Verified at `98191ec`: there is no model input in `LaunchDialog.vue` at all.** `grep` finds
**zero** `<datalist>`, and the three `<select>` elements are the launch profile (`:437`), the
credential profile (`:498`) and the worktree (`:590`). The model is a **read-only computed**,
`resolvedModel` (`:142`), whose own comment is decisive: *"The model precedence order, RESOLVED IN
MAIN and merely displayed here… The renderer does NOT re-implement the table — that would be the
second home 3a-4's ruling exists to prevent."* Task 3a-4 moved model resolution into main; the
dialog displays the resolved value plus a conditional missing-model warning (`:508`) and nothing
more.

**RULING: the §6.3 check is struck — it cannot be performed and must not be ticked.** ⚠ **THE
HAZARD IS THE INVERSE OF THE ONE THE SPEC MEANT TO PREVENT:** an implementer who reads "the model
input must stay free text", finds none, and *adds* one would create exactly the second home for
"which model" that **D48** forbids. **3c-4 adds no model input.** What §3 still correctly protects
is the display: the resolved model and its warning stay rendered, and their wording is unchanged.

*(Two smaller items in the same spec, corrected rather than ruled on: `extra_args` and its D59
argv warning are **not in this dialog** — §3's clause is conditional and therefore harmless, but an
implementer should not go looking; and the effort vocabulary is **not hardcoded** — `effortLevels`
is computed from the adapter descriptor via `adapter:list`, so §3's "`fast | balanced | deep | max`"
describes DATA, and writing those labels into the view would be a regression.)*

### D82 — the 3c-4 spec's shared overlay anatomy contradicts BOTH mocks; the mocks win *(coordinator, 2026-07-27)*

`ImplementationSpec-3c-4.md` §1 specifies the shared overlay panel as `--color-surface-card`
(`#12151A`), `1px solid --color-border-inset` (`#1D232A`), `--radius-card` (6px). **All three
values are wrong**, and because §1 is the *extract-once* shared shell, the error would propagate
into all three mocked overlays at once.

Read from the mocks this session, which **agree with each other**:

| | Workspace mock (palette) | Launch Dialog mock | 3c-1 token |
|---|---|---|---|
| panel background | `#10141A` | `#10141A` | `--color-surface-overlay` ✅ |
| panel border | `#262D35` | `#262D35` | `--color-border-badge` ✅ |
| panel radius | `8px` | `8px` | `--radius-overlay` ✅ |

**RULING: D73 applies — the mock wins, and 3c-1 already tokenised the right values.** Its
`--color-surface-overlay` comment names this exact use ("command palette / launch dialog / mission
popover — the elevated panel body"), so 3c-1 read the mock correctly and the 3c-4 spec, authored
in the same pass but before 3c-1 landed, guessed. **Use the overlay tokens, not the card tokens.**

**⚠ The scrim has NO token, and its two alphas differ ON PURPOSE.** The palette's scrim is
`rgba(5,6,8,.62)` and the launch dialog's is `rgba(5,6,8,.55)`; the base `#050608` is **not** in
3c-1's block (`--color-surface-void` is `#08090B`, a different colour). Per D73 the two alphas are
reproduced as drawn and **not unified**. The missing base colour is **reported, not added** — the
token block is 3c-1's and no later task edits it.

### D83 — the Startup mock is a SPLASH SCREEN, not an empty state. `EmptyState.vue` has no mock, and it is the phase's SECOND unmocked surface *(coordinator, 2026-07-27)*

`Task-3c-4.md` cites *"`docs/design/v2/Chorus Startup.dc.html` — for `EmptyState`"* and
`ImplementationSpec-3c-4.md` §4 says *"20 lines against the Startup mock."* **They are not the same
surface, and one of them does not exist in the app.**

Read this session, the Startup mock is a **2.75-second animated launch splash** that overlays the
workspace (`<dc-import name="Chorus Workspace">`) and then fades: seven staggered logo bars
(`barIntro`), a wordmark with a `glintSweep`, a boot line *"waking 7 voices · restoring 3
sessions"*, a version line *"chorus v1.0.0 · windows x64"*, and its own `prefers-reduced-motion`
block. **Verified: `grep -rniE "splash|startup"` across `src/main/` and `src/renderer/src/` returns
NOTHING — Chorus has no splash screen.**

`EmptyState.vue` is an unrelated surface: App.vue renders it at `:434` when `layout.tree` is null
(fresh project, or the last pane closed), and it reads *"No agents running."* over a **"Launch an
agent"** button. **The Workspace mock contains no empty state either** (`grep -ci "no agents|empty"`
→ **0**).

**RULING, three parts:**

1. **`EmptyState.vue` has NO mock and is held to token-and-primitive conformance only** — the same
   bar as `WorktreePanel.vue`, and for the same reason. **⚠ IT IS THEREFORE THE SECOND UNMOCKED
   SURFACE, AND THE MILESTONE AMENDMENT'S "the one surface with no mock" IS AMENDED BELOW.** It is
   a 20-line file whose only jobs are to say nothing is running and offer the launch — a restyle
   onto the tokens, not a redesign.
2. **⚠ DO NOT BUILD THE SPLASH.** It is a **new feature**, not a restyle: no window, no timing, no
   boot-progress source exists. Its boot line is also squarely **D76** — *"waking 7 voices ·
   restoring 3 sessions"* would need live restore progress the renderer is never told. Building it
   inside a restyle repeats exactly what D78 refused.
3. **The phase's 14-surface inventory item 1, "Startup / no project (`EmptyState`)", conflated the
   two.** It means **the no-project empty state**, which exists. The splash is unbuilt and
   unscheduled — a candidate for a later phase, recorded here so it is not silently dropped.

**⚠ The add-project route from `EmptyState` and the one 3c-3 put in the rail's footer should read
as the same action** (spec §4's one still-correct instruction) — but note they are different
verbs: the rail's row calls `store.add()` (adds a PROJECT), while `EmptyState`'s button emits
`launch` (opens the LAUNCH DIALOG for a session). **Do not "unify" them into one control.**

### Decisions taken by the coordinator, on the mock's own open-questions list

The roadmap requires the mock's open questions be settled here. **Three of the five are not
3c's** and are recorded as such rather than answered:

- **Filmstrip right-rail vs bottom strip at 16+ sessions** — **keep the right rail** (what the
  mock draws), with vertical scroll and no reflow to a bottom strip. Revisit only if a real
  16-session layout proves it wrong; a speculative second layout mode is exactly the kind of
  unpaid complexity this phase should not add. **Reversible.**
- **Amber pulse strength** — **use the mock's values verbatim** (`chorusPulse 2.2s`, the
  shadow pair recorded in 3c-1's spec) and honour `prefers-reduced-motion`. Per D73 the mock is
  the authority; "strength" stops being an open question once faithful extraction is the rule.
- **Card width** — **fixed by the mock's geometry** (208px rail, 88px card height, `9px 11px`
  padding). Not open.
- **Inbox mode vs overlay** — **PHASE 4's question, not 3c's.** The Attention Inbox mock exists
  but the Inbox does not, and 3c restyles what exists.
- **Mission-control orientation** — **PHASE 5's question, not 3c's.** `Chorus Micro
  Surfaces.dc.html` is the mission-control + push-to-talk mock; neither surface exists yet.

## The purity contract

**This phase changes how the app looks and nothing else.** The roadmap's milestone says "with
no behavioral change", and that is enforceable, so every task's Non-Goals enforce it:

- **No IPC channel is added, removed or reshaped — with ONE declared exception, in Task 3c-2
  only.** `IpcChannel` keys stay at **52** and `ipcMain.handle(` at **48** for tasks 3c-1, 3c-3,
  3c-4 and 3c-5. **⚠ Task 3c-2 must add window-control channels, because D74's `frame: false`
  makes it structurally impossible not to:** with no native frame, the renderer's buttons have
  no way to minimize, maximize or close except by asking main. That is **four keys**
  (`window:minimize`, `window:toggle-maximize`, `window:close`, and a main→renderer
  `window:maximized-changed` event so the restore icon can follow a double-click or `Win+↑`),
  taking `IpcChannel` **52 → 56** and `ipcMain.handle(` **48 → 51**. **The exception is recorded
  here rather than discovered mid-task**, and it is bounded: no other task in this phase may add
  a channel, and 3c-2 may add no channel beyond those four.
  - **⚠ AMENDED 2026-07-27 BY D80 — a SECOND, DIFFERENT exception, in Task 3c-3 only.** D80 adds
    **`sessionCount` to `project:list`'s existing response**. It adds **no channel and no handler**
    — the counts stay **56 / 51** — so it is not an exception to the *count*, it is an exception to
    the stricter clause **"no channel is RESHAPED"**. Bounded to that one field on that one
    response; **no other task in this phase may reshape a payload.**
- **No migration.** `MIGRATIONS.length` stays at **11** and `sqliteTable(` at **15**.
- **No store logic change.** The 6 renderer store/logic test files and their assertions stay
  green **without being edited to accommodate a restyle** — if a store test needs changing, the
  change is out of scope and must be reported, not absorbed.
- **One exception, and it is the phase's only intentional behavioural change: `frame:false`**
  (D74). It is confined to Task 3c-2 and to window chrome — no session, layout, or persistence
  behaviour moves with it.
  - **⚠ AMENDED 2026-07-27 — a SECOND behavioural change, landed at Matthew's explicit request
    AFTER 3c-3's task commit and deliberately kept OUT of it.** Commit `98191ec` ("The session
    counts stop lying after you close a pane") makes `TerminalPane` dispatch a
    `chorus:session-closed` window event and `App.vue` answer it by re-reading main; `onLaunched`
    gains the matching refresh. **It is a refresh-cadence change, which is behaviour, not
    styling.** It exists because 3c-3 put two session COUNTS on screen for the first time (the
    rail's `sessionCount` and the status bar's tally) and nothing told them a pane had closed —
    so the defect is one this phase *created* by displaying facts that were previously
    undisplayed. **Recorded here as its own commit, separate from the task's, precisely so the
    "no behavioural change" claim over the task commit stays literally true and auditable.**
    Scope: no channel, no handler, no store logic, no test edited.
- **`ProjectTabs.vue` is the one component replaced rather than restyled** (D38's design has a
  left rail, not a top tab bar). Its *behaviour* — `store.projects`, `store.activeId`,
  `store.select(id)`, `store.add()` — is preserved exactly.

## Tasks

Five serial tasks. **Dependency chain: 3c-1 → 3c-2 → 3c-3 → 3c-4 → 3c-5**, each in its own
session, each coordinator-reviewed before the next is prompted.

| Task | Scope | Depends on | Blocked by |
|---|---|---|---|
| **[3c-1](Task-3c-1.md)** | **The theme foundation, and nothing visual beyond the shell.** Faithful `@theme` token extraction into `main.css` (D73); `@fontsource` packages replacing the CDN (D75); the four colorblind-safe state-marker components (diamond / circle / triangle / square) as shared primitives; the `chorusPulse` keyframe and its `prefers-reduced-motion` resolution. | — | — |
| **[3c-2](Task-3c-2.md)** | **The frameless window (D74) — the phase's only main-process change.** `frame: false`, the 36px custom titlebar with the chorus wordmark, drag regions, and re-implemented minimize / maximize / restore / close including double-click-to-maximize and the maximized icon swap. Isolated on purpose. | 3c-1 | — |
| **[3c-3](Task-3c-3.md)** | **The workspace, which is most of the app.** The 208px left project rail **replacing** `ProjectTabs.vue`; the filmstrip as the right rail; pane-header enrichment to the design's anatomy where the data already exists; the 30px bottom status bar. Consumes 3c-1's state markers. **⚠ AMENDED 2026-07-27: `Task-3c-3.md` and `ImplementationSpec-3c-3.md` were written at `1cf23ff` and three of their surfaces have since been ruled out or changed — read D78 (three states, NOT four: no attention badge, no `1 waiting`, no pulsing card), D79 (marker 8px) and D80 (`project:list` gains `sessionCount`) BEFORE either document.** | 3c-1, 3c-2 | — |
| **[3c-4](Task-3c-4.md)** | **Overlays and dialogs.** `LaunchDialog` (mock), `CommandPalette` (mock, inside the Workspace file), `EmptyState`/startup (mock), and `WorktreePanel` — which has **no mock** and is therefore held to token-and-primitive conformance only, explicitly not a redesign. **⚠ AMENDED 2026-07-27: `Task-3c-4.md` and `ImplementationSpec-3c-4.md` were written at `1cf23ff` and two of their instructions are now wrong — read D81 (there is NO model input; the datalist check cannot be run and adding one would breach D48) and D82 (the shared overlay panel is `--color-surface-overlay` / `--color-border-badge` / `--radius-overlay`, NOT the card tokens the spec names) BEFORE either document.** | 3c-1, 3c-3 | — |
| **[3c-5](Task-3c-5.md)** | **Settings and Council — closes the phase.** `SettingsView` / `SettingsProviders` / `SettingsCredentials` against the "Providers & Keys" mock, then `CouncilView` against Matthew's new mock. | 3c-1, 3c-3, 3c-4 | ✅ **nothing — D72 discharged 2026-07-26**, the mock is delivered and reviewed |

**Why the titlebar is second rather than last.** It is the riskiest work and the most likely to
need a second pass, and every later task's screenshots are taken inside the window it defines —
landing it early means one set of reference screenshots, not two.

## Verification approach — the F15 lesson, applied in reverse

**⚠ "Typecheck passes" proves nothing in this phase, and there are no component tests to lean
on.** An app-wide token change touches every surface at once, so the verification is a
**per-surface visual pass** with a named, enumerated surface list.

**The surface inventory that every task's visual pass must cover** (14 states, because two
surfaces have more than one):

1. Startup / no project (`EmptyState`)
2. Workspace — filmstrip mode
3. Workspace — grid mode
4. Workspace — a pane in each of the four states (needs-you / running / error / done)
5. Project rail — active and inactive items, with and without an attention badge
6. Pane header
7. Status bar
8. Command palette (Ctrl+K)
9. Launch dialog
10. Worktree panel
11. Settings — Providers
12. Settings — Credentials
13. Council — empty
14. Council — running, and complete

**Mechanism (from §5 and the standing memory):** drive the running app over **CDP on
`--remote-debugging-port=9222`** — DOM assertions plus `Page.captureScreenshot` — in preference
to the user32 PowerShell helper. Screenshots go under `_verify/3c-<task>/` (gitignored) and are
compared against the corresponding mock region.

**⚠ Two harness facts that bite this phase specifically:**

- **F17 — electron-vite does NOT hot-restart the main process.** Task 3c-2 changes
  `src/main/index.ts`, so **every titlebar iteration costs a tree-kill cold boot.** Budget for
  it; do not expect HMR.
- **F20/F31 — execution sessions run with a redirected `AppData` but a real `C:\Projects`.**
  Their filesystem and screenshot evidence is trustworthy; their **database** evidence describes
  a different DB. Nothing in this phase should need DB evidence — if a task finds itself
  dumping the database, it has left its scope.

## Gates

Standing repo gates, all mandatory at every task close:

- **G1** `npm run typecheck` exits 0 (node + web).
- **G2** **Run it, don't just compile it** — the per-surface visual pass above, on the real
  running app. **Load-bearing in every task of this phase**, more so than in any earlier phase,
  because the entire deliverable is visual.
- **G3** One narrated commit per task unless a flagged pre-commit is required.
- **G4** `npm run grep:secrets` clean across 6 patterns.
- **G5** Council review checkpoint — **not triggered in this phase.** No `[CR]` question is
  attached to 3c: it makes no security, schema, or protocol decision. Recorded so the absence is
  deliberate rather than an oversight.

**Baseline to hold at every close:** typecheck **0** · vitest **941/941 across 29 files**
(plus each task's own added tests, never fewer) · `grep:secrets` **clean** ·
`MIGRATIONS.length` **11** · `sqliteTable(` **15**.

**⚠ THE VITEST FIGURE MOVES AS TASKS LAND — the rule is "never fewer", not "always 941".**
Actual, re-run at each close: after **3c-1** 941/941 across 29 files · after **3c-2**
**946/946 across 29 files** (its four channels' schema tests) · after **3c-3**
**947/947 across 29 files** (D80's `sessionCount` coverage). **Task 3c-4 opens at 947.**

**⚠ TWO PRE-EXISTING TESTS WERE EDITED BY 3c-3, BOTH FORCED BY D80 AND NEITHER A CONTRACT BREACH
— and the second was NOT anticipated by 3c-3's own execution prompt:**

| File | Why | Assertions changed? |
|---|---|---|
| `src/shared/ipc.test.ts` (`projectsListSchema`) | D80 predicted this one: a required field breaks a `toEqual` on objects without it | fixtures updated + one new test |
| `src/renderer/src/palette/commands.test.ts` | **unforeseen** — it builds `ProjectsList` fixtures too, so it stopped **compiling** | **none** — two fixture rows gained the field |

**⚠ CONSEQUENCE FOR TASK 3c-4, WHOSE DOC PREDATES THIS:** `Task-3c-4.md` requires
`palette/commands.test.ts` to stay green **"unedited"**. That still holds, but **"unedited" now
means unedited FROM HEAD, not from the 3c-1 baseline** — the file already carries `sessionCount`
in its fixtures. The standing rule is untouched: **no `stores/*.test.ts` in any diff.**

**IPC counts move exactly once in this phase, and only in 3c-2:**

| | after 3c-1 | after **3c-2** | after 3c-3, 3c-4, 3c-5 |
|---|---|---|---|
| `IpcChannel` keys | 52 | **56** | 56 |
| `ipcMain.handle(` | 48 | **51** | 51 |

Any other movement is out of scope and must be reported, not absorbed.

## Milestone, and the one amendment it needs

The roadmap's wording: *"the running app is visually indistinguishable from the Workspace and
Settings mocks for every surface that exists, with no behavioral change — screenshot-diffed
against the mocks."*

**⚠ AMENDED AT KICKOFF, because "every surface that exists" now includes surfaces with no
mock.** The milestone reads, for this phase:

- **Surfaces with a mock** — Workspace (and its rail / pane header / filmstrip / status bar /
  palette), Launch Dialog, Settings, Startup, **and Council once D72's mock lands** — are held
  to **visually indistinguishable, screenshot-diffed**. D73 makes that literal rather than
  approximate.
- **The surfaces with no mock and no plan to get one are held to token-and-primitive
  conformance**: they use the theme's colors, fonts, radii and state markers, and contain **zero**
  stock Tailwind palette utilities. They are explicitly **not** redesigned, and that is recorded
  as a known gap rather than quietly satisfied by a screenshot of something no one drew.
  - **`WorktreePanel.vue`** — declared at kickoff.
  - **⚠ `EmptyState.vue` — ADDED 2026-07-27 BY D83.** This clause said "the ONE surface" until the
    3c-4 prompt was authored against the code and found that the **Startup mock is an animated
    launch splash, not an empty state**, and that no mock anywhere draws the no-project screen.
    **So the count is two, not one** — corrected here rather than left for 3c-4's report to
    discover.
- **⚠ The Startup mock's SPLASH SCREEN is not in this phase's milestone at all** (D83). It depicts
  a surface the app does not have, so it can be neither screenshot-diffed nor conformance-checked.
  It is unbuilt and unscheduled, recorded so a later reader sees a deliberate omission.
- **No behavioral change**, with `frame:false` (D74) as the single declared exception.

## Tokens the mocks need and 3c-1 did not provide

**Reported, never added** — the `@theme static` block is 3c-1's and no later task edits it. Each
was found by the task that needed it, and each has a chosen substitute recorded so a later reader
sees a decision rather than drift.

| Missing | Where the mock uses it | Found by | What shipped instead |
|---|---|---|---|
| `#D08A4E` | the second project's inactive rail spine, `rgba(208,138,78,.55)` | 3c-3 | the three spine tokens that DO exist (`violet`/`sand`/`blue`), cycled by project index |
| `#050608` | both overlay scrims, at `.62` (palette) and `.55` (launch dialog) | 3c-4 prompt (D82) | *(3c-4's call — the base colour has no token; `--color-surface-void` is `#08090B` and is NOT it)* |

**Two tokens are also used OUTSIDE their names, deliberately** — same value, second role, and
renaming them is a design decision rather than a refactor: `--color-surface-inset` ("status-bar
chip") is also the focused pane's frame `#0F1216`, and `--color-surface-rail` ("left project
rail") is also the terminal surface `#0B0D10` that the xterm theme's `background` must match.

## Next step

**None — ✅ PHASE 3c IS COMPLETE.** All five tasks landed. See "Phase close" below.

**Progress:** ✅ **3c-1** landed at `b8f2b1e` (+ `00fed15` docs) · ✅ **3c-2** landed at `fbb6d2b`
(frameless window + titlebar; all twelve behaviour-drive boxes driven on the real window) ·
✅ **3c-3** landed at `0476e54` (+ `98191ec`, the declared behavioural follow-up above) — rail,
filmstrip right rail, pane header, status bar, D79 and D80 all discharged; **the grayscale proof
D77 owed was performed and passed for the three states that exist**, with the fourth geometry
recorded as UNPROVEN and owed by Phase 4 · ✅ **3c-4** landed at `070f381` — the four overlays plus
the extracted `assets/overlays.css`; **`#1e1e1e` reached 0** · ✅ **3c-5** landed at `c4f82fb` —
settings and council, closing the phase.

## Phase close — 3c-5, 2026-07-28 at `c4f82fb`

**⚠ THE BASELINE MOVED FOR REASONS OUTSIDE THIS PHASE, AND THAT IS THE DURABLE LESSON HERE.**
Tasks 3d-1 … 3d-4 shipped **between 3c-4 and 3c-5**, out of order at Matthew's request because
they blocked his daily use of the app. Every frozen number in this document's Gates section was
correct when written and wrong by the time 3c-5 ran. **The purity contract held; its numbers did
not.** The corrected figures, all re-verified at close:

| | this doc said | actual at close | moved by |
|---|---|---|---|
| `IpcChannel` | 56 | **57** | 3d (`model-shortlist:set`) |
| `ipcMain.handle(` (`ipc.ts` / `index.ts`) | 51 / 0 | **52 / 0** | 3d |
| `sqliteTable(` | 15 | **16** | 3d (`model_shortlist`, D85) |
| `MIGRATIONS.length` | 11 | **12** | 3d (v12, D85) |
| vitest | 941 / 29 files | **1007 / 30 files** | 3d |

**3c-5 moved none of them.** Its diff is four `views/` files plus one new stylesheet:
`assets/settings.css`, the settings sibling of 3c-4's `overlays.css`. Zero `stores/`, zero
`main/`, zero `shared/`, zero `components/`, zero `palette/`.

**The stock-palette sweep is finished: 192 → 0 across `views/`**, and 0 raw hex outside comments.

### ⚠ The mock asked for a forbidden thing, and the rule outranked it

**`Chorus Settings Providers.dc.html` draws masked key previews** — `sk-ant-…Xq4F`,
`sk-proj-…9dKm`, `sk-proj-…T2wa`, `sk-or-…v81A`. **D33 clause 3 admits no exception** and
`ImplementationSpec-3c-5.md` §2 says so directly. **They were not adopted**, and the refusal is
structural rather than incidental: `settings.css` has **no `.set-row-hint` class**, so there is
nowhere to put one, and the file header says why. `SettingsCredentials.vue:12/:176` already
carried the same refusal and both comments survive.

**This is the phase's one deliberate visual deviation from a mock**, and it is recorded here
rather than left in a task report, because "visually indistinguishable" is the milestone's own
wording and a reader deserves to know where it is knowingly false.

**Two smaller D76 omissions in the same file:** the mock's **six** settings-nav entries (Chorus
has one live; the other five arrive when their phases build them) and its **`neo4j :7688`** status
chip (Phase 6; no source exists).

### ⚠ The unmocked count is FOUR regions across THREE files, not two surfaces

D83 amended this from one to two. Authoring 3c-5's prompt against the code found two more, both
inside `SettingsProviders.vue`, both invisible to a mock drawn before they existed:

| Region | Mock coverage | Held to |
|---|---|---|
| `WorktreePanel.vue` | none (declared at kickoff) | token-and-primitive conformance |
| `EmptyState.vue` | none (D83) | token-and-primitive conformance |
| **The council-member surface (3b-2)** | **`grep -ci "council"` over the mock → 0** | token-and-primitive conformance |
| **The model shortlist section (3d / D85)** | **`grep -ciE "shortlist\|favourite\|star\|pin"` → 0** | token-and-primitive conformance |

**`SettingsProviders.vue` is 1,334 lines and the mock describes roughly half of it.** Any future
claim that this file "matches the mock" is false without that qualification.

### Two defects the running app exposed that reading the code did not

Both found in the G2 pass, both fixed in the task commit:

- **A route with an unverified credential rendered "0 of 1 verified" in the healthy green chip.**
  The denominator was carrying the whole message and the colour was contradicting it. Zero-verified
  now takes the neutral tone. **This is D55 the other way round:** the number was right and the
  *rendering* of it lied.
- **A two-word provider name wrapped and pushed the status chip onto a second line.** The mock's
  card header is one row, always; the name no longer wraps and the route meta truncates instead.

### D76 bound harder here than anywhere else in the phase

The council mock's phase header draws four figures **none of which has a source**, and all four
were omitted rather than approximated — the reasoning is recorded in `CouncilView.vue`'s
`roundLabel` comment so a later reader sees a decision:

| Mock draws | Why it is not rendered |
|---|---|
| `elapsed 4:38` | the store carries no run start time, and adding one is store logic this task may not touch |
| `est. remaining ~9m` | the dishonest number the five-stop track exists to refuse |
| `round 1 **of 2**` | the renderer is told which round it is in, never how many are planned |
| `$0.31 so far` | `costUsd` arrives with the accounting at the END of a run |

**What ships is the round ordinal alone.** ⚠ Note this is a **deliberate, reasoned exception to
D55's "no number without its denominator"**: an ordinal position is not a measured quantity out of
a total, and inventing "of 2" to satisfy the letter of D55 would breach D76. Recorded so the next
reader does not "fix" it.

### The four council invariants — verified by grep AND on the running app

Asserted in the live DOM, not inferred from the template:

- **F27 wording byte-identical and on screen** — `f27_verbatim_on_screen: true`.
- **The standing caveat is verbatim and ABOVE the synthesis** — proven by
  `compareDocumentPosition`, not by reading source order.
- **An unavailable member is shown and explained** — and the mock's extension is adopted:
  **refused turns now render as transcript ROWS, not gaps.**
- **Every accounting figure carries its denominator**, including **F39 made visible**: when turns
  report no usage the cost line reads *"…4 turns not reported by the provider · true total is at
  least this"*. **The clause is CONDITIONAL** — when every turn reports usage the figure IS the
  total, and saying otherwise would be its own dishonesty.
- **No verification chrome: zero checkmarks.** The only `verified` on screen is inside the
  caveat's own *"not verified fact"* — exactly the one hit `Task-3c-5.md` §5 predicted.

### G2 — the 14-surface close-out pass, and what it could NOT prove

Driven over CDP on the real app. **13 of 14 surfaces fully captured; one is partial and is named
as such rather than ticked:**

- **Surface 4 (a pane in each of four states) — PARTIAL.** `running` was observed on three live
  panes. `exited` and `error` were **not induced, because doing so means killing sessions Matthew
  has real work in**, and `needs-you` **has no data source at all** (D78) — it remains Phase 4's,
  unproven since 3c-3 said the same thing. **Recorded as UNPROVEN, not inferred from the code.**
- **The six council states were driven SYNTHETICALLY**, by writing the renderer store over CDP in
  exactly the shape main's broadcast produces. **Cost `$0.00`.** This is better evidence than a
  real run for a styling task — `refused` and `error` are states a real run may not produce on
  demand — and it is stated plainly here so nobody later reads them as photographs of a live
  deliberation. **No IPC call, no API call, no database write; reverted by a window reload.**
- **⚠ Two surfaces changed AFTER 3c-4 verified them and were re-checked here:** the **launch
  dialog** (D90's model picker; four agent cards now, `opencode` fourth) and **Settings —
  Providers** (3d's shortlist section).

### ⚠ The council behaviour re-check was NOT performed, and here is why

`Task-3c-5.md` asks for a real run streaming into the restyled view. **`council_members` is empty
— zero rows.** The D71 frontier roster is gone (the DB was rebuilt 2026-07-27; the three
OpenRouter credential profiles survive and verify). A run needs a roster, and **rebuilding D71's
roster is Phase 3e's job, with Matthew's authorised budget behind it** — doing it here to satisfy
a styling check would spend frontier money on the wrong question and pre-empt 3e's measurement.

**Status: streaming, Esc-during-run, and the findings-file write are UNPROVEN by this task.**
They are unchanged code paths — `stores/council.ts`, `councilCore.ts` and `councilService.ts` have
an empty diff — but "unchanged code" is an argument, not evidence, and this phase's whole rule is
that the two are different. **Phase 3e's first real run is the natural place to close it**, and
3e's own task docs carry it forward.

**Cost of this task: `$0.00`, against a `< $0.05` envelope.**

**What the phase leaves for later, stated so it is not re-discovered:** `chorusPulse` still has
**no first caller** (D78) · the fourth `StateMarker` geometry is **still unproven at runtime** and
owed by Phase 4 · the council's streaming path is **unproven since the roster was lost** and is
owed by 3e's first run.

*(Historical: the original next step read "`/phase-prompt` for Task 3c-1".)*

**✅ D72's gate is already satisfied** — `docs/design/v2/Chorus Council.dc.html` was delivered and
reviewed on 2026-07-26, so 3c-5 has no outstanding blocker. **The phase now has a complete design
set: eight mocks covering every surface except `WorktreePanel.vue`**, which remains the one
declared gap in the milestone amendment above.

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
- **No migration.** `MIGRATIONS.length` stays at **11** and `sqliteTable(` at **15**.
- **No store logic change.** The 6 renderer store/logic test files and their assertions stay
  green **without being edited to accommodate a restyle** — if a store test needs changing, the
  change is out of scope and must be reported, not absorbed.
- **One exception, and it is the phase's only intentional behavioural change: `frame:false`**
  (D74). It is confined to Task 3c-2 and to window chrome — no session, layout, or persistence
  behaviour moves with it.
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
| **[3c-3](Task-3c-3.md)** | **The workspace, which is most of the app.** The 208px left project rail **replacing** `ProjectTabs.vue`; the filmstrip as the right rail; pane-header enrichment to the design's anatomy where the data already exists; the 30px bottom status bar. Consumes 3c-1's state markers. | 3c-1, 3c-2 | — |
| **[3c-4](Task-3c-4.md)** | **Overlays and dialogs.** `LaunchDialog` (mock), `CommandPalette` (mock, inside the Workspace file), `EmptyState`/startup (mock), and `WorktreePanel` — which has **no mock** and is therefore held to token-and-primitive conformance only, explicitly not a redesign. | 3c-1, 3c-3 | — |
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
- **The one surface with no mock and no plan to get one — `WorktreePanel.vue`** — is held to
  **token-and-primitive conformance**: it uses the theme's colors, fonts, radii and state
  markers, and contains **zero** stock Tailwind palette utilities. It is explicitly **not**
  redesigned, and that is recorded as a known gap rather than quietly satisfied by a screenshot
  of something no one drew.
- **No behavioral change**, with `frame:false` (D74) as the single declared exception.

## Next step

`/phase-prompt` for **Task 3c-1**. Tasks run strictly serially, each coordinator-reviewed before
the next is prompted.

**✅ D72's gate is already satisfied** — `docs/design/v2/Chorus Council.dc.html` was delivered and
reviewed on 2026-07-26, so 3c-5 has no outstanding blocker. **The phase now has a complete design
set: eight mocks covering every surface except `WorktreePanel.vue`**, which remains the one
declared gap in the milestone amendment above.

# Task 3c-3 — Execution Prompt (paste into a fresh session)

*Authored 2026-07-27 against the code at `fbb6d2b`, not merely against the task docs. **This
matters more than usual here:** `Task-3c-3.md` and `ImplementationSpec-3c-3.md` were written at
`1cf23ff`, before 3c-1 and 3c-2 landed, and **three of the surfaces they specify have since been
ruled out or changed by D78, D79 and D80.** Every fact in the tables below was re-run this session.*

---

## Role

You are the **Coordinator** for **Chorus — Phase 3c (Design Adoption), Task 3c-3: The Workspace —
Project Rail, Filmstrip, Pane Header, Status Bar**.

- **Repo root:** `C:\Projects\ContactEstablished\Chorus`
- **Expected branch:** `main`. **Confirm it; do not switch or create a branch without instruction.**
- **Expected HEAD at start:** `fbb6d2b` *("The window loses its Windows frame and grows the
  design's own titlebar…")*.
- **Platform:** Windows 11, PowerShell primary. A Bash tool is also available; each takes its own
  syntax.

## Goal

Turn the workspace into the mock: the **208px left project rail** replacing the top tab bar, the
**filmstrip as the right rail**, the **pane header** enriched to the design's anatomy, and the
**30px status bar** at the bottom. This is the surface Matthew will look at all day, and it is the
task that most directly serves the phase's reason for going first.

## ⚠ READ THIS BEFORE YOU READ THE TASK DOCS

**`Task-3c-3.md` and `ImplementationSpec-3c-3.md` are stale in three specific, load-bearing
places.** They are still your source of truth for everything else — geometry, colour, the rail's
anatomy, the card design, the status bar's layout — but these three amendments override them, and
**two of them delete work the specs tell you to do.** All three are recorded in full in
`Phase-3c-Overview.md`.

### D78 — there are THREE session states, not four. **The attention UI is NOT in this task.**

**The renderer cannot know that an agent is waiting for a human.** Verified at `fbb6d2b`:

- `sessionStatusSchema = z.enum(['running','exited'])` — **two** statuses.
- `SessionInfo` = `{id, agent, status, title, createdAt, exitCode, branch}`. `PaneSessionState` =
  `{agent, status, exitCode, busy}`. **Neither carries attention.**
- The `attention:*` machinery is **write-only outbound**. `attention:summary` is **never called
  anywhere in the renderer**, and its response is attention-**minutes** bucketed by
  `pane|overhead|blurred|idle|locked`. ⚠ **That is the HUMAN's attention, not the agent's state** —
  its `idle` means "nobody has touched the keyboard for 60 s", **not** "the agent is blocked on
  you". Nothing anywhere reads the PTY stream looking for an agent prompt.

**So you can derive exactly three states:** `running` (`status==='running'`) · `done` (`exited`,
`exitCode===0`) · `error` (`exited`, `exitCode!==0`).

**DO NOT BUILD, and delete these from your reading of the specs:**

| Told to build | Where | Ruling |
|---|---|---|
| Rail attention badge `◆ 2` | `ImplementationSpec-3c-3.md` §2; **D76's own table** | ❌ **omit** |
| Status bar `1 waiting` (marked "✅ from the session store") | `ImplementationSpec-3c-3.md` §3 | ❌ **omit** |
| Filmstrip needs-you card + `data-pulse` + `chorusPulse` | `ImplementationSpec-3c-3.md` §4 | ❌ **omit** |
| Acceptance: "all **four** states distinguishable with colour removed" | `Task-3c-3.md` | ⚠ **three** |
| Acceptance: `prefers-reduced-motion` — needs-you card holds the static shadow | `Task-3c-3.md` · spec §7.3 | ❌ **cannot be discharged here** — nothing pulses. **Do not tick it.** |

**⚠ `docs/design/v2/Chorus Needs Attention.html` is NOT yours.** Matthew delivered it 2026-07-27
and it is superb, but **it specifies a CAPABILITY, not a skin** — its Scale A alone needs waiting-
detection, the agent's verbatim ask, an elapsed-wait timer and per-session cost, none of which
exist. **Per D78 it is PHASE 4's normative spec.** Do not implement from it. *(If you open it: it
is a self-unpacking bundle — the real ~42 KB document is a JSON-escaped string inside the
`<script type="__bundler/template">` block, so `grep` over the raw file finds nothing.)*

**⚠ DO NOT ATTEMPT TO INFER "waiting" FROM TERMINAL OUTPUT.** That invents a signal (D76's core
prohibition) and is behaviour work inside a restyle. A false pulse is worse than none — the design
doc's own rule is *"Pulse forever. Motion that never resolves is trained-out within a day."*

**`chorusPulse` will therefore ship with no first caller.** That is expected and recorded, not an
oversight — **do not "fix" it by finding something to pulse.**

### D79 — the `needs-you` marker becomes 8px. Source-only.

`Chorus Needs Attention.html` says 8px; `StateMarker.vue` ships 7px; the Workspace mock's rail badge
draws 6px. **Ruling: 8px is canonical — change `StateMarker.vue`'s `needs-you` from 7px to 8px.**
The glow already agrees across both sources (`0 0 8px rgba(245,158,11,.6)`) — leave it.

⚠ **Only `needs-you` changes.** Running circle 8px, error triangle 11×10, done square 7px all stay.
**This has NO visible effect in 3c-3** (per D78 the needs-you marker renders nowhere), so it is a
source-only edit that hands Phase 4 the right value. If the 8px diamond later reads oddly beside the
7px square, **report it; do not adjust the others in passing.**

### D80 — `project:list` gains `sessionCount`. **A declared exception — you WILL touch main.**

`Task-3c-3.md` says "**No IPC**". **That is now amended.** The rail shows a session count on every
project; verified this session, it cannot — `projectsListSchema` is `{id, name, root_path, active}`,
and sessions reach the renderer only via `getLayout(activeId)`, with the layout store holding one
project's tree at a time.

**Ruling: add `sessionCount` to `projectsListSchema`, computed in main with a single
`GROUP BY project_id` over the `sessions` table** (already has a `notNull` `project_id` FK).

- **No new channel — `IpcChannel` stays 56.** **No new handler — `ipcMain.handle(` stays 51 / 0.**
- **No extra IPC round-trips**, and **no migration** — `MIGRATIONS.length` **11**, `sqliteTable(`
  **15**.
- **⚠ It reshapes an existing payload, which the purity contract forbids. It is admitted on D74's
  terms — declared BEFORE the task, bounded to this one field on this one response.** If you find
  yourself wanting a second reshape, **STOP AND REPORT.**

**⚠ IT WILL BREAK ONE EXISTING TEST, AND THAT IS EXPECTED.** `src/shared/ipc.test.ts:380–400`
asserts `projectsListSchema.parse(list)).toEqual(list)` against objects with no `sessionCount`.
**Update it — that is an IPC schema test gaining coverage for a new field. The standing rule that no
STORE test may be edited is untouched: `stores/*.test.ts` must NOT appear in your diff.**

## Ground yourself first — before editing anything

**Read, in this order:**

1. `CLAUDE.md` — sessions live in MAIN; all IPC is typed and Zod-validated; **payloads crossing the
   bridge must be PLAIN objects** (D14).
2. `docs/Features/Foundation/Tasks/Phase-3c-Overview.md` — the purity contract, **D73**, **D76**,
   and **D78 / D79 / D80 above**.
3. `docs/Features/Foundation/Tasks/Task-3c-3.md` — **read through the D78/D79/D80 filter.**
4. `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-3c-3.md` — **normative except
   where D78–D80 override.** Where it and the task doc differ the spec wins; where either differs
   from the mock, **the mock wins** (D73).
5. `docs/design/v2/Chorus Workspace.dc.html` — the authority for every surface here.
6. `src/renderer/src/assets/main.css` — 3c-1's 69-token `@theme static` block. **Every surface you
   build is made from these; the files you own may contain no raw hex.**

**Ground facts — all re-verified 2026-07-27 at `fbb6d2b`:**

| Fact | Where | Status |
|---|---|---|
| `ProjectTabs.vue` is **38 lines**; its whole contract is `store.projects`, `store.activeId`, `store.select(id)`, `store.add()` | `components/ProjectTabs.vue` | ✅ |
| `FilmstripRenderer.vue` **121 lines** · `LayoutRenderer.vue` **108** · `TerminalPane.vue` **631** · `App.vue` **403** (was 395; 3c-2 added 8) | renderer | ✅ |
| Cards' metadata source is **`layout:get` rows, deliberately NOT the session store** ("cards never attach") | `FilmstripRenderer.vue:17–25` | ✅ — so a card sees `status`/`exitCode` only |
| Filmstrip is currently a **bottom strip**; the spec moves it to the **right rail** | `FilmstripRenderer.vue:10` | ✅ real change, in scope |
| App.vue root is `<div class="flex h-full flex-col">` with `<TitleBar />` first, then the tab-bar row, then `<div class="min-h-0 flex-1">` | `App.vue:315–347` | ✅ |
| View switch: settings `:352`, council `:357`, workspace `<template v-else>` `:362` | `App.vue` | ✅ (spec cites 342–353 — **stale, 3c-2 shifted it**) |
| `#1e1e1e` survives in **6 places / 4 files** | see below | ✅ **5 are yours; 1 is not** |
| `sessions` table has `projectId` `notNull` + FK — D80's `GROUP BY` is available | `db/schema.ts` | ✅ |
| `toWireProject` builds the wire shape **explicitly** ("a spread would silently re-admit any column a future migration adds") — add `sessionCount` there deliberately | `main/ipc.ts` | ✅ |
| `storage.listProjects()` returns `{id,name,rootPath}[]`, ordered by `createdAt` | `services/storage.ts` | ✅ |
| No worktree store exists; `listWorktrees(projectId)` is called only by `WorktreePanel.vue:42,55` | renderer | ✅ status bar must call it itself |
| `StateMarker.vue` exists and is **mounted nowhere** — **this task is its first caller (D77)** | `components/StateMarker.vue` | ✅ |
| Baseline: **946 tests / 29 files**, all passing | `npx vitest run` | ✅ **946, not 941** |
| `IpcChannel` **56** · `ipcMain.handle(` **51 / 0** · `sqliteTable(` **15** · `MIGRATIONS.length` **11** | — | ✅ |

**The six `#1e1e1e`, and which are yours:**

```
src/renderer/src/components/FilmstripRenderer.vue:90    ← YOURS
src/renderer/src/components/LayoutRenderer.vue:58       ← YOURS
src/renderer/src/components/TerminalPane.vue:373        ← YOURS (the xterm theme object)
src/renderer/src/components/TerminalPane.vue:585        ← YOURS
src/renderer/src/components/TerminalPane.vue:589        ← YOURS
src/renderer/src/components/EmptyState.vue:11           ← NOT yours — 3c-4 owns EmptyState
```

**Run these git checks first:**

```bash
git branch --show-current    # expect: main
git log --oneline -1         # expect: fbb6d2b
git status --porcelain
```

## ⚠ Pre-existing changes — do not touch

`git status` will show up to **four** paths that are **not yours**. Three of them are this task's own
kickoff artefacts, and one is an unrelated investigation:

```
 M docs/Features/Foundation/Tasks/Phase-3c-Overview.md          ← D78/D79/D80, written at kickoff
?? docs/Features/Foundation/Tasks/Task-3c-3-ExecutionPrompt.md  ← this file
?? docs/design/v2/Chorus Needs Attention.html                   ← Matthew's new state spec (Phase 4's)
?? docs/Features/Foundation/Investigations/                     ← unrelated
```

**Do not revert them and do not fold them into your commit.** Your commit must contain only the
files listed under Scope below. *(If Matthew has committed the kickoff artefacts before you start,
`git status` will show only `Investigations/` and HEAD will be one commit past `fbb6d2b` — that is
expected, and the ground facts are unaffected because that commit is docs-only.)*

## Implementation scope

### Create

- **`src/renderer/src/components/ProjectRail.vue`** — replaces `ProjectTabs.vue`. Spec §2.
- **`src/renderer/src/components/StatusBar.vue`** — spec §3.

### Edit

- **`src/renderer/src/App.vue`** — rail left, filmstrip right, status bar bottom. Spec §1.
- **`src/renderer/src/components/FilmstripRenderer.vue`** — the 88px card, as the right rail.
- **`src/renderer/src/components/LayoutRenderer.vue`** — grid-mode surfaces to the tokens.
- **`src/renderer/src/components/TerminalPane.vue`** — **pane header only**, plus the xterm theme
  object (spec §6).
- **`src/renderer/src/components/StateMarker.vue`** — **D79 only**: `needs-you` 7px → 8px.
- **`src/shared/ipc.ts`** · **`src/main/ipc.ts`** · **`src/main/services/storage.ts`** — **D80
  only**: `sessionCount` on `projectsListSchema`, one `GROUP BY` in storage, threaded through
  `toWireProject` and the `ProjectList` handler.
- **`src/shared/ipc.test.ts`** — **D80 only**: update the `projectsListSchema` test (`:380–400`) and
  cover the new field.

### Delete

- **`src/renderer/src/components/ProjectTabs.vue`**, once nothing imports it.

**Nothing else.**

### The three things this task must get right

1. **`ProjectTabs.vue` is REPLACED, not restyled — and `store.add()` must survive.** The mock's rail
   draws no add affordance; **put one at the bottom of the rail** as a quiet full-width row
   (spec §2). **⚠ This is the single most likely behavioural regression in the phase** — a rail
   written as a `v-for` over projects silently drops the only route to adding one, and **the app has
   no other.**
2. **D76 governs every number on screen.** Render session counts (now available for every project
   per D80), the worktree count and the state tallies. **Omit** per-project cost, the daily rollup,
   the neo4j chip, per-session cost and token counts. **Never render `$0.00`, `—`, or a skeleton in
   their place.** Two omissions in the status bar means **one separator, not two — do not leave a
   dangling divider.**
3. **State is shape-first.** Every session state uses `StateMarker`. **A surface that distinguishes
   states only by colour has broken the property the markers exist for**, and the review checks it
   with a grayscale screenshot.

## Strict non-goals

- **Do not build the attention UI** — no badge, no `1 waiting`, no needs-you card, no `data-pulse`
  (D78). **Do not implement from `Chorus Needs Attention.html`.**
- **Do not infer "waiting" from terminal output.**
- **Do not add an IPC channel or handler.** 56 / 51 / 0 are frozen. **D80 is the one payload
  reshape; a second means STOP AND REPORT.**
- **Do not change store logic.** `stores/*.test.ts` must not appear in `git diff --stat`.
- **Do not change layout behaviour** — split/close/focus, filmstrip↔grid, ratio write-back and
  `layout:set` all behave exactly as before.
- **Do not touch xterm's buffer, scrollback, resize or PTY wiring.** The theme object only.
- **⚠ Do not restyle the 16 ANSI colours** (spec §6). Those are the *agent's* output colours;
  overriding them is a behavioural change wearing a styling costume. **If they look wrong against
  the new background, REPORT IT — it is Matthew's call, not an implementer's.**
- **Do not touch `EmptyState.vue`, `LaunchDialog.vue`, `CommandPalette.vue`, `WorktreePanel.vue`, or
  any settings/council view** — 3c-4 and 3c-5.
- **Do not touch `TitleBar.vue` or anything 3c-2 built.**
- **Do not edit 3c-1's token block or remove `@theme static`.** Missing token → **report it.**
- **Do not add a dependency.** Anything needed → stop and ask.
- **Do not touch migrations or schema.**
- **Do not push or open a PR unless explicitly asked.**

## Required workflow

1. **Ground** — read the six documents and verify the ground-fact table against the code.
2. **Implement in the spec's order**: D80's wire+main change first (it unblocks the rail's counts) →
   `ProjectRail.vue` + mount + delete `ProjectTabs.vue` → `StatusBar.vue` → `FilmstripRenderer.vue`
   → `LayoutRenderer.vue` → `TerminalPane.vue` header + xterm theme → `StateMarker.vue` (D79).
3. **Spec review** — re-read `ImplementationSpec-3c-3.md` against your diff **through the D78–D80
   filter**. Did `add()` survive? Any invented number? Any stock Tailwind utility left in the files
   you own? `min-height: 0` and `min-width: 0` both present?
4. **Code-quality review** of your own diff.
5. **Resolve findings**, then **verify** (below). The visual pass and the behaviour re-check are not
   optional.
6. **One intentional commit**, narrated in the repo's established style: a plain-language title,
   then a body a non-technical reader follows first, technical detail second. **Do not push.**

## Verification

### Build gates — all must pass

```bash
npm run typecheck && npx vitest run && npm run grep:secrets
```

**Expected:** typecheck **0** · vitest **946 + your D80 test additions**, **never fewer than 946**,
across **29 files** · `grep:secrets` **clean across 6 patterns**. **The only pre-existing test you
may edit is `projectsListSchema`'s (D80).**

### Grep gates — with expected counts

```bash
grep -rn "ProjectTabs" src/                                    # expect NOTHING — file and every import gone
grep -oE "^\s+[A-Za-z]+: '[a-z0-9:-]+'" src/shared/ipc.ts | wc -l   # expect 56 — UNCHANGED
grep -c "ipcMain.handle(" src/main/ipc.ts                      # expect 51 — UNCHANGED
grep -c "ipcMain.handle(" src/main/index.ts                    # expect 0  — MUST stay zero
grep -c "sqliteTable(" src/main/db/schema.ts                   # expect 15
grep -rn "#1e1e1e" src/                                        # expect EXACTLY 1 — EmptyState.vue:11 (3c-4's)
```

```bash
grep -rn "neutral-\|sky-\|zinc-\|slate-\|gray-" \
  src/renderer/src/components/ProjectRail.vue \
  src/renderer/src/components/StatusBar.vue \
  src/renderer/src/components/FilmstripRenderer.vue \
  src/renderer/src/components/LayoutRenderer.vue     # expect NOTHING
```

```bash
grep -rn "\$0\.00\|neo4j\|waiting\|today" \
  src/renderer/src/components/StatusBar.vue \
  src/renderer/src/components/ProjectRail.vue        # expect NOTHING — D76 + D78
```

`MIGRATIONS.length` must remain **11** (`src/main/services/storage.ts`; the array ends at the
`// v11` entry — **your storage edit is a new read-only query, nowhere near it**).

### G2 — the visual pass, on the real running app

**Cold-boot with at least two projects and four sessions**, and screenshot-diff each against the
Workspace mock:

- [ ] **Project rail** — active (`#13171C`, 2px periwinkle spine, `#E6EAEE` label) vs inactive
      (transparent border, `#9AA4AE`, hover `#101318`); the mono `#68737F` session-count sub-line
      **on every project** (D80). **Cost omitted (D76). No attention badge (D78).**
- [ ] **The add-project affordance is present and works.**
- [ ] **Filmstrip cards in the three states** — running, error, done (`opacity: .82`). Confirm the
      **shapes** differ, not only the colours.
- [ ] **Pane header** in both filmstrip and grid mode.
- [ ] **Status bar** — 30px, `#0A0B0D`, mono 10.5px, `worktrees N`, the session tallies, **one**
      separator, the `ctrl+k commands` keycap.
- [ ] **Grid mode** at 4+ panes.
- [ ] **The grayscale proof (D77's, owed by this task).** Apply `filter: grayscale(1)` to the
      document and screenshot the filmstrip with **all three** states present. **All three must stay
      distinguishable.** ⚠ **State in the report that the fourth geometry (`needs-you`) is UNPROVEN
      at runtime and owed by Phase 4 (D78)** — do not claim four.

**Then the behaviour re-check, because this task rewrites the app's shell:** switching projects,
**adding a project**, splitting a pane, closing a pane, switching filmstrip↔grid, focusing a pane —
all still work, and **the layout still persists across a restart**.

### Runtime mechanism

**CDP on `--remote-debugging-port=9222`.** Launch with `_verify/launch.ps1` (it restores `PATH`/
`ComSpec`, which the harness strips, and returns the wrapper PID). A working driver is at
`_verify/3c-1-cdp.js` (`eval`, `shot`, `media`, `mediaeval`). `_verify/` is gitignored — reuse and
extend freely; it will not enter your diff. Task 3c-2 also left `_verify/3c-2-win.ps1` (OS-level
window info / click / drag / key / full-screen capture), `_verify/3c-2-crop.ps1` and
`_verify/3c-2-sample.ps1` (crop and pixel-sample a capture in screen coordinates) — the last two are
the quickest way to check a colour against the mock's literal.

⚠ **Harness facts that will bite you:**

- **F17 — electron-vite does NOT hot-restart the main process.** D80 edits `main/ipc.ts` and
  `storage.ts`, so **every iteration on those costs a tree-kill and a cold boot.** `_verify/
  killtree.ps1` and `taskkill /PID <root> /T /F` both work. Budget for it.
- **`Emulation.setEmulatedMedia` is CDP-SESSION-scoped** — set and read in one session (that is what
  `mediaeval` is for), or you silently read the un-emulated page.
- **CSS-only edits hot-reload, but Tailwind needs a beat to regenerate.** For anything load-bearing,
  **cold-boot rather than trusting HMR.**
- **F20/F31 — a redirected `AppData` but a real `C:\Projects`.** Filesystem and screenshot evidence
  is trustworthy; database evidence describes a different DB. **You should not need DB evidence.**
  If you do read the DB, `better-sqlite3` is built for Electron's ABI — run it as
  `ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe <script>`, not plain `node`.
- **Cost envelope: `$0.00`.** This task makes **no API call**. If something appears to require one,
  stop and report.

## Failure honesty

**If any verification command fails for an unrelated environment reason, capture the exact output,
explain what happened, and do not claim success. A gate that could not be run is not a gate that
passed.**

**This applies with force to the visual pass and the behaviour re-check.** Several boxes — the
grayscale proof, layout persistence across a restart, and *"add-project still works"* — are exactly
the kind that are tempting to reason about rather than perform. **If you could not actually perform
one, say which and why, and mark it UNPROVEN.** Do not substitute an inference from the code.

## Final reporting requirements

1. **Status** — `DONE` · `DONE_WITH_CONCERNS` · `NEEDS_CONTEXT` · `BLOCKED`.
2. **Files changed**, with `git diff --stat`. Confirm it lists only the expected paths, that
   `ProjectTabs.vue` shows as deleted, and that **no `stores/*.test.ts` appears**.
3. **The frozen numbers**: `IpcChannel` **56**, `ipcMain.handle(` **51 / 0**, `sqliteTable(` **15**,
   `MIGRATIONS.length` **11** — all unchanged. **If any moved, say so loudly.**
4. **D80, quoted** — `git diff src/shared/ipc.ts src/main/ipc.ts src/main/services/storage.ts`. It
   should show only the `sessionCount` field, the `GROUP BY` query, and its threading. Confirm no
   channel or handler was added.
5. **Build results** — typecheck, the vitest figure (946 + yours), `grep:secrets`, and every grep
   gate count including the `#1e1e1e` count of exactly 1.
6. **The visual pass, surface by surface**, with screenshots — including **the grayscale
   screenshot**, and the explicit statement that the fourth geometry is unproven and owed by Phase 4.
7. **The behaviour re-check, item by item** — what you actually did and observed, with
   **add-project** and **layout persistence across a restart** called out separately.
8. **Confirmation that the files you own contain no raw hex and no stock Tailwind palette
   utilities**, and which 3c-1 tokens you used — including any the mock needed that 3c-1 did not
   provide (**report, do not add**).
9. **Non-goals confirmation** — no attention UI, no second payload reshape, no channel/handler
   added, no store logic or store test changed, no ANSI palette change, `@theme static` intact,
   nothing touched in 3c-4/3c-5 territory.
10. **Residual risks and anything you had to decide** that these documents did not settle —
    especially anything about the ANSI palette against the new background, or the 8px diamond
    beside the 7px square.
11. **Final `git status`**, confirming `docs/Features/Foundation/Investigations/` is still untracked.

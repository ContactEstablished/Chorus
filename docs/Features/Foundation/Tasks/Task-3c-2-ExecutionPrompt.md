# Task 3c-2 — Execution Prompt (paste into a fresh session)

*Authored 2026-07-27 against the code at `b8f2b1e`, not merely against the task docs. Every fact
in the tables below was re-run this session, after Task 3c-1 landed — the task doc and spec were
written at `1cf23ff` and their line numbers have been re-checked rather than trusted.*

---

## Role

You are the **Coordinator** for **Chorus — Phase 3c (Design Adoption), Task 3c-2: The Frameless
Window and Custom Titlebar**.

- **Repo root:** `C:\Projects\ContactEstablished\Chorus`
- **Expected branch:** `main`. **Confirm it; do not switch or create a branch without
  instruction.**
- **Expected HEAD at start:** `b8f2b1e` *("Every colour in the theme is now readable from the
  running app…")*.
- **Platform:** Windows 11, PowerShell primary. A Bash tool is also available; each takes its own
  syntax.

## Goal

Replace the native window frame with the design's **36px custom titlebar**, and **re-implement by
hand every window behaviour that removing the frame takes away** — minimize, maximize, restore,
close, drag, double-click-to-maximize, snap, and resize from all eight edges and corners.

**⚠ THE PRIME CONSTRAINT: this task is the phase's ONLY main-process change and its ONLY IPC
change, and both are bounded.** `frame: false` is the single declared behavioural change in all of
Phase 3c. **Exactly four IPC channels, no more.** Nothing about sessions, layout, persistence or
attention moves with it. **Nothing below the titlebar is restyled** — the rail, filmstrip and
status bar belong to Task 3c-3.

**This task cannot be discharged by a screenshot.** It is behaviour, and behaviour is precisely
what removing the frame endangers.

## Ground yourself first — before editing anything

**Read, in this order:**

1. `CLAUDE.md` — sessions live in MAIN; all IPC is typed and Zod-validated via the contextBridge
   preload; **IPC payloads crossing the bridge must be PLAIN objects** (D14).
2. `docs/Features/Foundation/Tasks/Phase-3c-Overview.md` — **D74** (the ruling that put you here),
   the purity contract, and the IPC exception table that predicts your numbers.
3. `docs/Features/Foundation/Tasks/Task-3c-2.md` — your task, including the **behaviour drive
   checklist** that is this task's real acceptance test.
4. `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-3c-2.md` — **normative.**
   Where it and the task doc differ, **the spec wins**; where either differs from the mock,
   **the mock wins** (D73).
5. `src/renderer/src/assets/main.css` — Task 3c-1's token block. **Your titlebar is built
   entirely from these; it may contain no raw hex.**

**Ground facts — all re-verified 2026-07-27 at `b8f2b1e`, after 3c-1 landed:**

| Fact | Where | Status |
|---|---|---|
| `new BrowserWindow({...})` spans **lines 37–51**; no `frame`, no `titleBarStyle`; `show:false`, `autoHideMenuBar:true`, `backgroundColor:'#0D0F12'` (set by 3c-1) | `src/main/index.ts:37–51` | ✅ unchanged by 3c-1 except the one `backgroundColor` line |
| **Zero window IPC exists.** `grep -n "window:" src/shared/ipc.ts` returns nothing | `src/shared/ipc.ts` | ✅ |
| **All 48 `ipcMain.handle(` live in `ipc.ts`; `index.ts` has ZERO** | `src/main/ipc.ts` · `src/main/index.ts` | ✅ 48 / 0 |
| The `getAllWindows()` broadcast precedent | `src/main/ipc.ts:2045`, `:2314`, `:2321` (also `:2342`) | ✅ all four confirmed |
| The **F13 listener-lifecycle discipline** to copy — registered on mount, released on unmount | `src/renderer/src/views/CouncilView.vue:35–50` | ✅ confirmed at those exact lines |
| `App.vue`'s root is **already** `<div class="flex h-full flex-col">` — mounting the titlebar as its first child is clean | `src/renderer/src/App.vue:315` | ✅ |
| `activeView` is `'workspace' \| 'settings' \| 'council'` | `src/renderer/src/App.vue:100` | ✅ |
| `src/shared/ipc.test.ts` exists — the schema-test pattern to follow | `src/shared/ipc.test.ts` | ✅ |
| Baseline: **941 tests / 29 files**, all passing | `npx vitest run` | ✅ |

**Run these git checks first:**

```bash
git branch --show-current    # expect: main
git log --oneline -1         # expect: b8f2b1e
git status --porcelain
```

## ⚠ Pre-existing changes — do not touch

`git status` will show five paths that are **not yours**. They belong to the 3c-1 planning and
execution sessions and to another investigation:

```
 M docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-3c-1.md
 M docs/Features/Foundation/Tasks/Phase-3c-Overview.md
 M docs/Features/Foundation/Tasks/Task-3c-1.md
?? docs/Features/Foundation/Investigations/
?? docs/Features/Foundation/Tasks/Task-3c-1-ExecutionPrompt.md
```

*(This prompt itself — `Task-3c-2-ExecutionPrompt.md` — will also appear as untracked. Same rule.)*

**Do not revert them, do not stage them, do not commit them.** Your commit must contain only the
files listed under Scope below.

## What Task 3c-1 already gave you

**Read this section before writing a single line of `TitleBar.vue` — it resolves a contradiction
between your own spec and your own gate.**

3c-1 shipped `main.css` with a **69-token `@theme static` block**. Two consequences:

- **`@theme static`, not plain `@theme`.** Tailwind v4 tree-shakes unreferenced theme variables;
  `static` forces all of them into `:root`. **Every token below reads back from
  `getComputedStyle(document.documentElement)` at runtime, whether or not anything uses it yet** —
  so you can verify tokens directly over CDP. **Do not remove `static`.**
- **`ImplementationSpec-3c-2.md` §4 writes the titlebar's colours as RAW HEX, but
  `Task-3c-2.md`'s grep gate requires `TitleBar.vue` to contain NO raw hex.** That is not a
  conflict you have to resolve by judgement — **every value has a token**, and three of them were
  added by 3c-1 specifically for this task. Use this mapping:

| Spec §4 says | Use this token | Value |
|---|---|---|
| titlebar background `#0A0B0D` | `--color-surface-chrome` | `#0A0B0D` |
| bottom border `#15181C` | `--color-border-chrome` | `#15181C` |
| wordmark `#8A94A0` | `--color-text-muted` | `#8A94A0` |
| idle glyph `#7E8894` | `--color-text-tertiary` | `#7E8894` |
| hover background `#181C21` | `--color-surface-titlebar-hover` | `#181C21` |
| hover glyph | `--color-text-body` | `#C7CFD8` |
| close hover `#C42B1C` | `--color-state-close-hover` | `#C42B1C` |
| **close hover "white glyph"** | **`--color-text-on-close-hover`** | `#FFFFFF` |
| **logo bars 1 & 6 `#3E4650`** | **`--color-logo-bar-low`** | `#3E4650` |
| **logo bars 2 & 5 `#4A535E`** | **`--color-logo-bar-mid`** | `#4A535E` |
| **logo bar 3 `#5A646F`** | **`--color-logo-bar-high`** | `#5A646F` |
| logo bar 4 (the jade one) `#3BCFAE` | `--color-accent-jade` | `#3BCFAE` |
| wordmark typeface | `--font-mono` | `'JetBrains Mono', monospace` |

**In an inline SVG, `fill="var(--color-logo-bar-low)"` works** — 3c-1's `StateMarker.vue` already
does exactly this with `fill="var(--color-state-error)"`. Read it as the precedent.

**Also inherited from 3c-1, so you are not surprised by them:**

- `StateMarker.vue` exists and is **mounted nowhere**. **It is not yours** — Task 3c-3 is its
  first caller and **owes the runtime colourblind proof** (D77). Do not mount it here.
- **`#1e1e1e` still appears in five places across four components** (`TerminalPane.vue` ×3
  including the xterm theme object, `EmptyState.vue`, `FilmstripRenderer.vue`,
  `LayoutRenderer.vue`). **That is correct and not yours to fix** — 3c-3 and 3c-4 own those files,
  and the xterm ANSI palette is explicitly deferred to 3c-3.
- The app-wide visible change so far is background + typeface only. **If your diff changes
  anything below the titlebar, report it — do not absorb it.**

## Implementation scope

### Create

- **`src/renderer/src/components/TitleBar.vue`** — geometry and colour per
  `ImplementationSpec-3c-2.md` §4, using the token mapping above.

### Edit

- **`src/main/index.ts`** — **`frame: false`, and the `maximize` / `unmaximize` window listeners
  only.** The listeners go beside the existing `resized` / `moved` wiring — same window, same
  lifecycle, one readable block.
- **`src/main/ipc.ts`** — **the three `ipcMain.handle` registrations, inside `registerIpc(...)`.**
- **`src/shared/ipc.ts`** — four `IpcChannel` keys and their Zod schemas.
- **`src/preload/index.ts`** — the four bridge methods.
- **`src/renderer/src/App.vue`** — mount `<TitleBar />` as the first child of the root; make room
  for 36px.
- **`src/shared/ipc.test.ts`** — schema tests for the new channels (see Test Expectations).

**Nothing else.**

### Resolved decisions that bind this task

**D74 (Matthew, 2026-07-26) — `frame:false`, FULLY CUSTOM CONTROLS.**
> Matches the mock exactly, including the `#C42B1C` close hover. **⚠ The accepted cost is that
> Windows behaviour must be re-implemented rather than inherited:** minimize / maximize / restore
> / close, double-click-to-maximize, drag regions, resize edges, and the maximized-state icon
> swap. Task 3c-2 owns all of it and is deliberately isolated so a problem here cannot block the
> rest of the phase.

**The IPC exception (Phase-3c-Overview.md) — four channels, and only in this task.**
> With no native frame the renderer's buttons have no way to minimize, maximize or close except by
> asking main. That is **four keys** — `window:minimize`, `window:toggle-maximize`,
> `window:close`, and a main→renderer `window:maximized-changed` event so the restore icon can
> follow a double-click or `Win+↑`. `IpcChannel` **52 → 56**, `ipcMain.handle(` **48 → 51**.
> **No other task in this phase may add a channel, and 3c-2 may add none beyond those four.**
> **If a fifth seems necessary, STOP AND REPORT** rather than adding it.

**⚠ `window:maximized-changed` is REQUIRED, not a convenience.** The maximized state can change by
routes the renderer never sees — double-clicking the drag region, `Win+↑` / `Win+↓`, or the OS
snapping the window. Without the event the restore icon silently desyncs. **Wire BOTH the
`maximize` and `unmaximize` listeners**; wiring only the button's own click is the classic defect
here and the review checks for it.

**⚠ `frame:false` keeps the resize border on Windows.** Electron's frameless windows remain
resizable and snappable by default. **If resizing appears broken after this change, the cause is
almost always a renderer element covering the edge — fix it in CSS, not by adding `resizable` or a
manual hit-test.** Do not add `titleBarStyle`, `titleBarOverlay`, `transparent`, or `resizable`.

**⚠ Do not touch `persistBounds`.** It already skips while minimized, and a maximized window's
`getNormalBounds()` returns the restored bounds — which is exactly what should be persisted. The
existing code is already correct for the frameless case.

## Strict non-goals

- **Do not add a fifth IPC channel**, and do not make an existing channel do window work.
- **Do not register any `ipcMain.handle` in `index.ts`.** All 48 live in `ipc.ts` inside
  `registerIpc(...)` and `index.ts` has zero. **A second registration site is exactly the drift
  this codebase keeps ruling against.**
- **Do not touch bounds persistence** — `persistBounds`, `getWindowBounds`, `saveWindowBounds`,
  and the `resized`/`moved` wiring.
- **Do not touch the 3a-2 focus latch** or anything attention-related.
- **Do not restyle anything below the titlebar.** The rail, filmstrip and status bar are 3c-3.
- **Do not add a menu, a tray icon, or an app menu bar.** `autoHideMenuBar` stays.
- **Do not implement pop-out windows** — Phase 7.
- **Do not mount `StateMarker.vue`** — 3c-3 is its first caller.
- **Do not remove `static` from `@theme static`**, and do not otherwise edit 3c-1's token block.
  If you find a token missing, **report it** rather than adding one in passing.
- **Do not add any dependency.** Anything needed → stop and ask.
- **Do not touch schema, migrations, or store logic.**
- **Do not revert, stage, or commit the pre-existing changes listed above.**
- **Do not push or open a PR unless explicitly asked.**

## Required workflow

1. **Ground** — read the five documents above and verify the ground-fact table against the code.
2. **Implement in the spec's order**: channels + schemas → preload → `frame:false` + listeners →
   handlers in `ipc.ts` → `TitleBar.vue` → `App.vue` mount.
3. **Spec review** — re-read `ImplementationSpec-3c-2.md` against your diff. Both listeners
   present? Exactly four channels? `no-drag` on all three controls? No raw hex?
4. **Code-quality review** of your own diff.
5. **Resolve findings**, then **verify** (below) — the behaviour drive is not optional.
6. **One intentional commit**, narrated in the repo's established style: a plain-language title,
   then a body that explains what changed and why in terms a non-technical reader follows first,
   technical detail second. **Do not push.**

## Verification

### Build gates — all must pass

```bash
npm run typecheck && npx vitest run && npm run grep:secrets
```

**Expected:** typecheck **0** (node + web) · vitest **941 + your new schema tests** across
**29 + 0 or 1 files** (0 if you extend `src/shared/ipc.test.ts`, which is preferred) — **never
fewer than 941**, and **no pre-existing test edited to accommodate this change** · `grep:secrets`
**clean across 6 patterns**.

### Grep gates — with expected counts

```bash
grep -oE "^\s+[A-Za-z]+: '[a-z0-9:-]+'" src/shared/ipc.ts | wc -l   # expect 56 (was 52)
grep -c "ipcMain.handle(" src/main/ipc.ts                           # expect 51 (was 48)
grep -c "ipcMain.handle(" src/main/index.ts                         # expect 0 — MUST stay zero
grep -rn "#[0-9A-Fa-f]\{6\}" src/renderer/src/components/TitleBar.vue   # expect NOTHING
```

**Counts that must NOT move:**

```bash
grep -c "sqliteTable(" src/main/db/schema.ts    # expect 15
```

`MIGRATIONS.length` must remain **11** (`src/main/services/storage.ts:75`; the array ends at the
`// v11` entry — the file should not appear in your diff at all).

### ⚠ THE BEHAVIOUR DRIVE (G2) — this task's load-bearing verification

**Cold-boot the real app and confirm each of these BY HAND.** Every one is free with a native
frame and has to be earned back. **A box you did not actually drive is not a box you may tick.**

- [ ] **Minimize** restores from the taskbar with bounds intact.
- [ ] **Maximize** fills the work area **without covering the taskbar**, and **without the classic
      frameless bug where the maximized window overflows the screen edges by the border width.**
      ⚠ **Screenshot this one with the taskbar in frame** — it is invisible in a cropped shot.
- [ ] **Restore** returns to the pre-maximize bounds.
- [ ] **The maximize/restore icon follows the state — including when the state changes by a route
      the button did not initiate**: double-click the drag region, `Win+↑`, `Win+↓`. **This is the
      only thing that actually tests the event channel.**
- [ ] **Close** quits cleanly, with sessions torn down as before.
- [ ] **Drag** by the titlebar's empty middle moves the window; **dragging by a button does not.**
- [ ] **Double-click the drag region** toggles maximize. ⚠ This is standard Windows behaviour that
      `-webkit-app-region: drag` gives for free — **verify it rather than implementing it.** Only
      add an explicit `@dblclick` handler if the drive shows it is not working, **and say so in
      the report if you do.**
- [ ] **Snap**: drag to the top edge, and `Win+←` / `Win+→`.
- [ ] **Resize from all four edges and all four corners** — **including the top edge**, which is
      the one a custom titlebar most often eats.
- [ ] **Bounds persist across a full quit and relaunch.** ⚠ Check the **maximized** case too:
      relaunching must not restore a maximized window to a broken size.
- [ ] The window does **not** flash white or grey before first paint.

### Runtime gates over CDP

**Mechanism: CDP on `--remote-debugging-port=9222`.** Launch with
`npx electron-vite dev -- --remote-debugging-port=9222` (dev) or `npx electron-vite preview -- …`
(packaged). **A working driver already exists at `_verify/3c-1-cdp.js`** with `eval`, `shot`,
`media` and `mediaeval` commands — `_verify/` is gitignored, so reuse or extend it freely; it will
not enter your diff.

⚠ **Two things 3c-1 learned the hard way, so you do not repeat them:**
- **`Emulation.setEmulatedMedia` and `Network.emulateNetworkConditions` are CDP-SESSION-scoped.**
  They revert the instant the socket closes, so setting them in one process and reading in another
  silently reads the un-emulated page. **Set and read in one session** (that is what `mediaeval`
  is for).
- **CSS-only edits hot-reload, but Tailwind needs a beat to regenerate.** A screenshot taken
  immediately after a CSS swap can catch a transient un-styled frame. For anything load-bearing,
  **cold-boot rather than trusting HMR.**

Then confirm:

1. `document.querySelector('[data-testid="titlebar"]')` exists in **all three views**
   (`workspace`, `settings`, `council`) — it is window chrome, not workspace chrome.
2. After `window:toggle-maximize`, the **restore** glyph is rendered; after `Win+↓` **driven from
   the OS**, it reverts. *(The OS-driven half is the only one that tests the event channel.)*
3. The titlebar's computed height is **36px** and its background resolves to `#0A0B0D`.

### Visual pass

Screenshot the titlebar and diff against the mock's `<!-- ══ titlebar ══ -->` block in
`docs/design/v2/Chorus Workspace.dc.html`: **36px tall**, `#0A0B0D`, 1px `#15181C` bottom border,
the six-bar logo (`width=20 height=14`, bars at `x = 0, 3.6, 7.2, 10.8, 14.4, 18`, `width=2`,
`rx=1`, heights `4, 8, 12, 14, 8, 4` centred) with **the jade fourth bar**, the `chorus` wordmark
in JetBrains Mono 11px at `0.3em` letter-spacing, and three **44px** controls whose hover is
`#181C21` — except close, whose hover is `#C42B1C` with a white glyph.

### Harness conditions you should know

- **⚠ F17 — electron-vite does NOT hot-restart the main process.** You are editing `index.ts` and
  `ipc.ts` repeatedly. **Every iteration costs a tree-kill and a cold boot.** Budget for it; do
  not expect HMR and do not fight it. A tree-kill helper exists at `_verify/killtree.ps1`, and
  `taskkill /PID <root> /T /F` on the root `bash.exe` of the `electron-vite` tree works.
- **F20/F31** — execution sessions run with a **redirected `AppData`** but a **real
  `C:\Projects`**. Filesystem and screenshot evidence is trustworthy; **database** evidence
  describes a different DB. **Nothing in this task should need DB evidence — if you find yourself
  dumping the database, the scope has moved.** ⚠ Note this cuts one way that matters here: the
  **bounds-persistence check reads `storage`, which lives in the redirected `AppData`.** That is
  fine — you are checking that a value round-trips within one session's own store, not comparing
  against Matthew's real window position.
- **Cost envelope: `$0.00`.** This task makes **no API call**. If something appears to require
  one, stop and report.

## Failure honesty

**If any verification command fails for an unrelated environment reason, capture the exact output,
explain what happened, and do not claim success.** A gate that could not be run is **not** a gate
that passed.

**This applies with unusual force to the behaviour drive.** It is a manual checklist on a real
Windows window, and several boxes (top-edge resize, maximize overflow, OS-driven icon sync) are
exactly the kind that are tempting to reason about rather than perform. **If you could not
actually perform one, say which and why, and mark it UNPROVEN** — do not substitute an inference
from the code. A titlebar that is wrong in one of these ways is wrong in a way that is hard to
attribute months later.

## Final reporting requirements

Report:

1. **Status** — `DONE` · `DONE_WITH_CONCERNS` · `NEEDS_CONTEXT` · `BLOCKED`.
2. **Files changed**, with `git diff --stat`. Confirm it lists only the expected paths, and that
   **no file below the titlebar** (rail, filmstrip, settings views, `TerminalPane`) appears.
3. **The IPC numbers**: `IpcChannel` keys **56**, `ipcMain.handle(` **51 in `ipc.ts` and 0 in
   `index.ts`**. State the four channel names. **If you added a fifth, say so loudly — it means
   the scope moved.**
4. **`git diff src/main/index.ts`, quoted** — it should show only the `frame` line and the
   maximize/unmaximize listeners. Confirm `persistBounds` and the 3a-2 focus latch are untouched.
5. **Build results** — typecheck, the vitest figure (941 + your new tests), `grep:secrets`, and
   every grep-gate count.
6. **The behaviour drive, box by box** — what you actually did and observed for each of the twelve
   items, **with the maximize-overflow screenshot (taskbar in frame) and the top-edge-resize case
   explicitly confirmed rather than assumed**, and the OS-driven icon-sync case stated separately
   from the button-driven one.
7. **The visual diff** against the mock's titlebar block, with a screenshot.
8. **Confirmation that `TitleBar.vue` contains no raw hex**, and which 3c-1 tokens you used —
   including whether the `--color-logo-bar-*` and `--color-text-on-close-hover` tokens were
   sufficient, or whether the mock needed something 3c-1 did not provide.
9. **Non-goals confirmation** — no fifth channel, no handler in `index.ts`, no bounds-persistence
   change, no focus-latch change, nothing restyled below the titlebar, no dependency added,
   `@theme static` intact.
10. **Residual risks and anything you had to decide** that these documents did not settle —
    especially if you had to add an explicit `@dblclick` handler, or inset the drag region to
    recover top-edge resize.
11. **Final `git status`**, confirming the five pre-existing paths are still uncommitted and
    `docs/Features/Foundation/Investigations/` is still untracked.

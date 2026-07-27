# Task 3c-2 — The Frameless Window and Custom Titlebar

**Phase:** 3c — Design Adoption · **Task 2 of 5** · **Depends on:** 3c-1.

## Source Of Truth

- [`Phase-3c-Overview.md`](Phase-3c-Overview.md) — **D74** (the ruling that put us here) and the IPC exception table.
- [`../ImplementationSpecs/ImplementationSpec-3c-2.md`](../ImplementationSpecs/ImplementationSpec-3c-2.md).
- `docs/design/v2/Chorus Workspace.dc.html`, the `<!-- ══ titlebar ══ -->` block — the authority.
- `CLAUDE.md` — sessions live in main; all IPC is typed and Zod-validated; payloads are plain objects.

## Initial Starting Point (verified 2026-07-26 at `1cf23ff`)

- `src/main/index.ts:37–51` — `new BrowserWindow({...})` with **no `frame` and no
  `titleBarStyle`**: `width/height` from `storage.getWindowBounds()` (defaults 1200×800),
  `x`/`y`, `show: false`, `autoHideMenuBar: true`, `backgroundColor` (set by 3c-1), and
  `webPreferences` with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false`.
- `mainWindow.on('ready-to-show')` → `show()`; `resized`/`moved` → `persistBounds`, which skips
  when minimized; the 3a-2 focus latch is wired to the same window.
- **There is no window-control IPC of any kind.** `grep -n "window:\|minimize\|maximize"
  src/shared/ipc.ts` returns nothing.
- `App.vue` has no titlebar element; its root is the view switcher.

## Goal

Replace the native window frame with the design's 36px titlebar, and re-implement the window
behaviours that removing the frame takes away — **so that the app looks like the mock without
becoming worse to use.** The bar carries the chorus wordmark and logo at the left, a drag region
across the middle, and minimize / maximize-restore / close at the right.

## ⚠ This task is the phase's only main-process change, and its only IPC change

Both are consequences of D74 and both are bounded:

- **`frame: false` is the phase's one declared behavioural change.** Nothing about sessions,
  layout, persistence or attention moves with it.
- **Exactly four channels, no more** — `window:minimize`, `window:toggle-maximize`,
  `window:close`, and the `window:maximized-changed` event. `IpcChannel` **52 → 56**,
  `ipcMain.handle(` **48 → 51**. **If a fifth seems necessary, stop and report** rather than
  adding it.

**⚠ F17 applies hard here: electron-vite does NOT hot-restart the main process.** Every
iteration on `index.ts` costs a tree-kill and a cold boot. Budget for it; do not fight it.

## Exact Scope

**Create:** `src/renderer/src/components/TitleBar.vue`.

**Edit:**
- `src/main/index.ts` — **`frame: false` and the `maximize`/`unmaximize` window listeners only.**
- `src/main/ipc.ts` — **the three `ipcMain.handle` registrations.** ⚠ Verified 2026-07-26: all
  **48** existing handlers live here inside `registerIpc(...)` and **`index.ts` has zero**. Do
  not start a second registration site.
- `src/shared/ipc.ts` — four `IpcChannel` keys and their Zod schemas.
- `src/preload/index.ts` — the four bridge methods.
- `src/renderer/src/App.vue` — mount `TitleBar` above the view switcher; make room for 36px.

## Non-Goals

- **Do not touch bounds persistence.** `persistBounds`, `getWindowBounds`, `saveWindowBounds` and
  the `resized`/`moved` wiring are working code that a frameless window does not change.
- **Do not touch the 3a-2 focus latch** or anything attention-related.
- **Do not add a menu, a tray icon, or an app menu bar.** `autoHideMenuBar` stays.
- **Do not implement pop-out windows** — Phase 7.
- **Do not restyle anything below the titlebar.** The rail, filmstrip and status bar are 3c-3.
- **Do not add a fifth IPC channel**, and do not make any existing channel do window work.
- **Do not revert or commit unrelated working-tree changes.**

## Dependencies

**3c-1** — the titlebar is built from its tokens (`--color-surface-chrome`,
`--color-border-chrome`, `--color-surface-titlebar-hover`, `--color-state-close-hover`,
`--font-mono`) and must contain no raw hex.

## Step-by-step Work

1. Add the four channels + schemas in `src/shared/ipc.ts`; expose them in the preload.
2. `frame: false` in `index.ts`; register the three `ipcMain.handle` handlers; forward
   `maximize`/`unmaximize` to the renderer as `window:maximized-changed`.
3. Build `TitleBar.vue` to the mock's geometry, with `-webkit-app-region` drag/no-drag.
4. Mount it in `App.vue`.
5. **Drive every window behaviour by hand** (below). This task cannot be discharged by
   screenshot alone — it is behaviour, and behaviour is what removing the frame endangers.

## Test Expectations

**Unit-test the schemas** alongside the existing `src/shared/ipc.test.ts` patterns — the four
new channels parse valid payloads and reject invalid ones. That is the repo's standing
discipline for every channel and this task adds four.

**No component test for `TitleBar.vue`.** What matters here is whether a real Windows window
minimizes, maximizes, restores, drags, snaps and resizes — none of which jsdom can answer. **The
proof is the manual drive, and pretending otherwise with a mounted-component test would be
coverage theatre.**

## Verification Commands

```bash
npm run typecheck && npx vitest run && npm run grep:secrets
```

```bash
grep -oE "^\s+[A-Za-z]+: '[a-z0-9:-]+'" src/shared/ipc.ts | wc -l ; echo "expect 56 (was 52)"
```

```bash
grep -c "ipcMain.handle(" src/main/ipc.ts ; grep -c "ipcMain.handle(" src/main/index.ts ; echo "expect 51 in ipc.ts and 0 in index.ts — the second number must stay zero"
```

```bash
grep -rn "#[0-9A-Fa-f]\{6\}" src/renderer/src/components/TitleBar.vue ; echo "expect: no raw hex — tokens only"
```

### ⚠ The behaviour drive (G2) — this task's load-bearing verification

Cold-boot the real app and confirm **each of these by hand**. Every one of them is free with a
native frame and has to be earned back:

- [ ] **Minimize** restores from the taskbar with bounds intact.
- [ ] **Maximize** fills the work area **without covering the taskbar**, and **without the
      classic frameless bug where the maximized window overflows the screen edges by the border
      width.**
- [ ] **Restore** returns to the pre-maximize bounds.
- [ ] **The maximize/restore icon follows the state** — including when the state changes by a
      route the button did not initiate (double-click the drag region, `Win+↑`, `Win+↓`).
- [ ] **Close** quits cleanly, with sessions torn down as before.
- [ ] **Drag** by the titlebar's empty middle moves the window; **dragging by a button does
      not**.
- [ ] **Double-click the drag region** toggles maximize.
- [ ] **Snap** works: drag to the top edge, and `Win+←` / `Win+→`.
- [ ] **Resize from all four edges and all four corners**, including the top edge, which is the
      one a custom titlebar most often eats.
- [ ] **Bounds persist across a full quit and relaunch** — the pre-existing `persistBounds` path
      still fires. ⚠ Check the **maximized** case too: relaunching should not restore a
      maximized window to a broken size.
- [ ] The window does **not** flash white or grey before first paint.

### Visual pass

Screenshot the titlebar and diff against the mock's `<!-- ══ titlebar ══ -->` block: 36px tall,
`#0A0B0D`, 1px `#15181C` bottom border, the six-bar logo with the jade `#3BCFAE` fourth bar, the
`chorus` wordmark in JetBrains Mono 11px at `0.3em` letter-spacing in `#8A94A0`, and three 44px
controls whose hover is `#181C21` — except close, whose hover is `#C42B1C` with white glyph.

## Acceptance Criteria

- [ ] Gates green: typecheck 0 · vitest 941 + the new schema tests · `grep:secrets` clean.
- [ ] `IpcChannel` keys **56**, `ipcMain.handle(` **51** — the numbers D74's exception predicts,
      no more.
- [ ] `MIGRATIONS.length` **11**, `sqliteTable(` **15** — unchanged.
- [ ] **Every box in the behaviour drive above is ticked**, with the maximize-overflow and
      top-edge-resize cases explicitly confirmed rather than assumed.
- [ ] The titlebar matches the mock on a screenshot diff.
- [ ] `TitleBar.vue` contains **no raw hex** — 3c-1's tokens only.
- [ ] `persistBounds` and the 3a-2 focus latch are **byte-identical**; `git diff
      src/main/index.ts` shows only the `frame` line, the handlers, and the maximize listeners.

## Review Checklist

1. **Maximize does not overflow.** Ask for the screenshot with the taskbar visible. This is the
   single most common `frame:false` defect and it is invisible in a cropped screenshot.
2. **Top-edge resize works.** The second most common. A 36px bar that swallows the resize
   affordance makes the window feel broken in a way that is hard to attribute later.
3. **The icon follows state changes it did not cause.** If the implementer only wired the
   button's own click, `Win+↑` will desync the icon. Confirm the `maximize`/`unmaximize`
   listeners exist, not just the handlers.
4. **Exactly four channels.** Count them. A fifth means the scope moved.
5. **Drag regions are correct in both directions** — the middle drags, the buttons do not.
   `-webkit-app-region: no-drag` on the controls is not optional.
6. **Nothing below the titlebar changed.** `git diff --stat` should not list the rail, the
   filmstrip, or any settings view.

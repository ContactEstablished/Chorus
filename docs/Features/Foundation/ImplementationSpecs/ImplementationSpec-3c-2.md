# ImplementationSpec 3c-2 — The Frameless Window and Custom Titlebar

**Normative for:** [`../Tasks/Task-3c-2.md`](../Tasks/Task-3c-2.md). The mock
(`docs/design/v2/Chorus Workspace.dc.html`, `<!-- ══ titlebar ══ -->`) wins on appearance.

## 1. The window

In `src/main/index.ts`, inside the existing `new BrowserWindow({...})`:

```ts
frame: false,
```

**Nothing else in the options object changes** except 3c-1's `backgroundColor`. In particular
**do not add `titleBarStyle`, `titleBarOverlay`, `transparent`, or `resizable`** — D74 chose full
custom controls, and `titleBarStyle` would layer a second mechanism over them. `resizable`
defaults to `true` and must stay that way.

**⚠ `frame: false` keeps the resize border on Windows** — Electron's frameless windows remain
resizable and snappable by default. If resizing appears broken after this change, the cause is
almost always a renderer element covering the edge, **not** a missing window option. Fix it in
CSS, not by adding `resizable` or a manual hit-test.

## 2. The four channels

In `src/shared/ipc.ts`, following the file's existing `IpcChannel` + schema conventions:

```ts
/** invoke: minimize the main window. Renderer→main, no payload, no result. */
WindowMinimize: 'window:minimize',
/** invoke: maximize if restored, restore if maximized. Returns the NEW state so
 *  the caller can settle its icon without waiting for the event. */
WindowToggleMaximize: 'window:toggle-maximize',
/** invoke: close the main window (normal quit path, not a force kill). */
WindowClose: 'window:close',
/** event (main→renderer): the maximized state changed. ⚠ REQUIRED, not a
 *  convenience — the state can change by routes the renderer never sees:
 *  double-clicking the drag region, Win+↑ / Win+↓, or the OS snapping the
 *  window. Without this the restore icon silently desyncs. */
WindowMaximizedChanged: 'window:maximized-changed',
```

Schemas — the repo's rule is that every channel is Zod-validated and every payload is a plain
object:

```ts
export const windowMaximizedSchema = z.object({ maximized: z.boolean() }).strict()
export type WindowMaximized = z.infer<typeof windowMaximizedSchema>
```

`window:minimize` and `window:close` take and return nothing. `window:toggle-maximize` returns
`windowMaximizedSchema`. **`.strict()` for the F-5b reason the file already documents** — zod
otherwise strips unknown keys silently.

## 3. Main-side handlers

**⚠ THE WORK SPLITS ACROSS TWO FILES, AND THE SPLIT IS THE REPO'S EXISTING CONVENTION — verified
2026-07-26, not assumed.** All **48** `ipcMain.handle(` calls live in `src/main/ipc.ts` inside
`registerIpc(...)`; **`src/main/index.ts` has ZERO.** So:

- **`src/main/ipc.ts`** — the three `ipcMain.handle` registrations. They reach the window the way
  every other push in that file does: `BrowserWindow.getAllWindows()` (see `ipc.ts:2045`,
  `:2314`, `:2321` — the `SessionData` / `SessionExit` / `CouncilProgress` precedent).
- **`src/main/index.ts`** — `frame: false`, and the `maximize` / `unmaximize` listeners, because
  those attach to the **window instance** and belong beside the existing `resized` / `moved`
  wiring.

**Do not register handlers in `index.ts`.** A second home for IPC registration is exactly the
drift this codebase keeps ruling against, and `registerIpc` is the one home.

```ts
ipcMain.handle(IpcChannel.WindowMinimize, () => { mainWindow.minimize() })
ipcMain.handle(IpcChannel.WindowClose,    () => { mainWindow.close() })
ipcMain.handle(IpcChannel.WindowToggleMaximize, () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  else mainWindow.maximize()
  return { maximized: mainWindow.isMaximized() }
})

// ⚠ BOTH listeners, and they are the whole reason the event channel exists.
mainWindow.on('maximize',   () => send({ maximized: true }))
mainWindow.on('unmaximize', () => send({ maximized: false }))
```

**The two `on(...)` listeners go in `index.ts` beside the existing `resized`/`moved` wiring** —
same window, same lifecycle, one readable block. The `send` follows the house pattern from
`ipc.ts` (`for (const win of BrowserWindow.getAllWindows()) win.webContents.send(...)`), guarded
so a destroyed window is never sent to.

**⚠ Do not touch `persistBounds`.** It already skips while minimized. A maximized window's
`getNormalBounds()` returns the restored bounds, which is exactly what should be persisted — the
existing code is correct for the frameless case and needs no change.

## 4. `TitleBar.vue`

Geometry and color, read from the mock:

- Root: `height: 36px`, background `--color-surface-chrome` (`#0A0B0D`), `border-bottom: 1px
  solid --color-border-chrome` (`#15181C`), `display:flex; align-items:center; flex:none`.
- **Left group** — `padding: 0 14px`, `gap: 9px`:
  - the six-bar logo, inline SVG `width=20 height=14`, bars at `x = 0, 3.6, 7.2, 10.8, 14.4, 18`,
    `width=2`, `rx=1`, heights `4, 8, 12, 14, 8, 4` centred, fills
    `#3E4650, #4A535E, #5A646F, #3BCFAE, #4A535E, #3E4650` — **the fourth bar is the jade one**;
  - the wordmark `chorus`, `--font-mono`, `11px`, `letter-spacing: 0.3em`,
    `--color-text-muted`.
- **Spacer** — `flex: 1`. **This is the drag region.**
- **Controls** — three cells, each `width: 44px`, full 36px height, centred:
  - minimize: a 10×10 SVG with `<line x1=1 y1=5 x2=9 y2=5>`;
  - maximize: a 10×10 SVG with `<rect x=1 y=1 width=8 height=8 fill=none>`;
    **when maximized, swap to the two-square restore glyph**;
  - close: a 10×10 SVG X.
  - Idle glyph color `--color-text-tertiary` (`#7E8894`); hover background
    `--color-surface-titlebar-hover` (`#181C21`) with glyph `--color-text-body`; **close hover is
    `--color-state-close-hover` (`#C42B1C`) with a white glyph.**

### Drag regions — both directions matter

```css
.titlebar-drag    { -webkit-app-region: drag; }
.titlebar-control { -webkit-app-region: no-drag; }
```

**⚠ `no-drag` on the controls is not optional.** Inside a drag region a button still receives
`click` on Windows, but the press-and-move gesture moves the window instead of feeling like a
button, and a slight mouse drift during a click can move the window instead of closing it. Apply
`drag` to the spacer **and** the left group, `no-drag` to all three controls.

**Double-click to maximize:** in the mock this is standard Windows behaviour that
`-webkit-app-region: drag` gives for free — **verify it rather than implementing it**. Only add
an explicit `@dblclick` handler if the drive shows it is not working, and say so in the report if
you do.

Component state: hold `maximized` as a `ref`, seed it from the `window:toggle-maximize` return
value, and **subscribe to `window:maximized-changed` on mount, unsubscribing on unmount** — the
`F13` discipline the council view documents (`CouncilView.vue:35–50`) is the house pattern for
listener lifecycle; follow it.

## 5. `App.vue` integration

Mount `<TitleBar />` as the first child of the root, above the view switcher. The root becomes a
column flex: titlebar `flex: none`, the rest `flex: 1; min-height: 0`.

**⚠ `min-height: 0` is load-bearing.** Without it the flex child refuses to shrink, the terminal
host grows past the viewport, and the layout scrolls in a window that sets `overflow: hidden` —
which presents as "the status bar disappeared" in 3c-3 and gets misdiagnosed there.

**The titlebar renders in all three views** (`workspace | settings | council`) — it is window
chrome, not workspace chrome.

## 6. Verification

Build gates and counts:

```bash
npm run typecheck && npx vitest run && npm run grep:secrets
grep -rn "#[0-9A-Fa-f]\{6\}" src/renderer/src/components/TitleBar.vue   # expect nothing
```

**Runtime — the manual drive in the task doc is the acceptance proof.** Two cases deserve
naming because they are the classic frameless regressions:

1. **Maximize overflow.** On Windows a frameless window maximized by `maximize()` should respect
   the work area. Screenshot maximized **with the taskbar in frame** and confirm the window's
   edges are on the work-area boundary, not past it.
2. **Top-edge resize.** The titlebar occupies the top 36px; the resize affordance is the outer
   few pixels. Confirm the cursor changes and the drag resizes. If the bar eats it, inset the
   bar's drag region rather than adding a manual hit-test.

**CDP checks (`--remote-debugging-port=9222`):**

- `document.querySelector('[data-testid="titlebar"]')` exists in all three views.
- After `window:toggle-maximize`, the restore glyph is rendered; after `Win+↓`, it reverts —
  **driven from the OS, not from the button**, which is the only way the event channel gets
  tested.

## 7. Deliberately out of scope

- **Pop-out windows** (Phase 7) — they will need their own frame decision; nothing here presumes
  it.
- **A tray icon or app menu** (Phase 4).
- **The status bar** — it is the bottom sibling and belongs to 3c-3, but note the two together
  define the vertical budget: 36px + 30px of chrome around a `flex: 1` body.

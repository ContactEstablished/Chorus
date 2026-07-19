# Task 1b-3 — Ctrl+K Command Palette Skeleton

_Third task of Phase 1b (Foundation). Windows-only. Serial after Task 1b-2 (it drives the view store's focus/toggle actions). Closes Phase 1b._

## Source Of Truth
- `CLAUDE.md` (locked architecture rules; no new dependencies without asking).
- `docs/PLAN.md` §188 (command palette).
- Phase 1b decision binding here: **D21** (palette skeleton = five commands over an extensible registry — launch agent, switch project, focus pane by title/agent, toggle filmstrip/grid, restart focused session; in-repo fuzzy subsequence filter, **no new dependency**).
- Phase 1 finding still relevant: a focused xterm **swallows** key events — the palette hotkey needs a capture-phase interception or `attachCustomKeyEventHandler` (verify against installed xterm 6 per D4).
- This task governs scope; `ImplementationSpec-1b-3.md` governs exact contents.

## Initial Starting Point

**Verified 2026-07-19 against commit `fb384c5`**, plus Tasks 1b-1 and 1b-2 landed.

- **`App.vue`** hosts `ProjectTabs`, the mode-switched renderer (`FilmstripRenderer` / `LayoutRenderer`, from 1b-2), `LaunchDialog`, and (after 1b-2) the view store. It owns `openLaunchDialog(target)`, `sessions` (`SessionInfo[]` with `title`/`createdAt`), `agentFor`, and the effective focused leaf. `projectStore` (`{projects, activeId, load, add, select}`) and `viewStore` (`{mode, focusedSessionId, setMode, setFocused}`) are both available.
- **`LaunchDialog.vue`** is the reference for a modal overlay + focus trap: `onKeydown` handles Esc (cancel) and Tab / Shift-Tab cycling within the panel; the panel is `fixed inset-0 z-50 … bg-black/50` with an inner `role="dialog" aria-modal="true"`. Reuse this pattern.
- **`TerminalPane.vue`** owns the kill→await-exit→`restartSession` sequence (`onRestart`) and creates the xterm `Terminal`. `window.chorus.restartSession(sessionId)` / `killSession` / `onSessionExit` exist.
- **`window.chorus`** (preload) exposes `launch`, `restartSession`, `killSession`, `onSessionExit`, `listProjects`, `selectProject`, plus the 1b-2 view-state forwarders. **No palette code exists.**

## Goal

Add a **Ctrl+K command palette skeleton**: a modal over an **extensible command registry**, with an **in-repo fuzzy subsequence filter** and **five D21 commands** wired to existing plumbing. Ctrl+K opens it even when a terminal is focused; Esc closes; arrows navigate; Enter runs; a basic focus trap keeps keyboard focus inside (same pattern as `LaunchDialog`).

The five commands (D21), each wired to plumbing that already exists:
1. **Launch agent** → `App`'s `openLaunchDialog(null)`.
2. **Switch project** → `projectStore.select(...)` (skeleton: one entry per project, "Switch to `<name>`", or next-project cycle — see the spec).
3. **Focus pane** (by title/agent) → `viewStore.setFocused(id)` (one entry per current leaf, labeled by agent + title, so the fuzzy filter narrows by either).
4. **Toggle filmstrip/grid** → `viewStore.setMode(...)`.
5. **Restart focused session** → the kill→await-exit→`restartSession` sequence on the effective focused session.

## Exact Scope
Touch **only** these files:

| File | Change |
|---|---|
| `src/renderer/src/palette/commands.ts` | **New.** `interface PaletteCommand { id: string; label: string; keywords: string[]; enabled(): boolean; run(): void \| Promise<void> }`; a `buildCommands(ctx)` factory that returns the five D21 commands (some dynamic — one focus entry per leaf, one switch entry per project) given a context of the stores/callbacks it needs; and `fuzzyFilter(commands, query): PaletteCommand[]` — a subsequence match (all query chars appear in order in `label`+`keywords`, case-insensitive) with a simple contiguity/position score. **No new dependency.** |
| `src/renderer/src/components/CommandPalette.vue` | **New.** Modal overlay (LaunchDialog idiom): a search input, the fuzzy-filtered list, a highlighted `selectedIndex`, ↑/↓ navigation, Enter runs the selected command (then closes), Esc closes, a Tab focus trap. Props/emits to receive the command list (or context) and signal open/close. Disabled commands (`enabled()===false`) render dimmed and are unselectable. |
| `src/renderer/src/App.vue` | Mount `<CommandPalette v-if="paletteOpen">`; install a **window-level capture-phase `keydown`** listener that opens the palette on Ctrl+K (`e.ctrlKey && e.key.toLowerCase()==='k'`, `preventDefault`) — added in `onMounted`, removed in `onUnmounted`; assemble the command context (openLaunchDialog, projectStore, viewStore, sessions/effective-focused, a restart routine) and pass it to the palette. |

Nothing else. If a change seems to require another file, raise it.

## Non-Goals
- **No additional commands** beyond the five (D21).
- **No keyboard shortcuts beyond Ctrl+K** — Ctrl+T / Ctrl+1..9 / Ctrl+Tab are later phases.
- **No command persistence / recents / MRU ordering.**
- **No palette theming beyond the existing Tailwind idiom** (reuse LaunchDialog's neutral/sky palette).
- **No changes to main / IPC / storage / preload** — the palette is renderer-only, wired to plumbing that already exists.
- **Do not revert, stage, or commit unrelated or untracked files, including `_verify/` and anything under `docs/`.**

## Dependencies
- Tasks 1b-1 (title on `SessionInfo`) and 1b-2 (view store with `setMode`/`setFocused`; `FilmstripRenderer`) landed.
- `restartSession` / `killSession` / `onSessionExit` exist in `window.chorus`.
- The installed `@xterm/xterm` 6 exposes `attachCustomKeyEventHandler` (fallback interception path; confirmed in the typings — re-verify per D4). The primary path is the window capture listener.
- No new npm dependencies.

## Step-by-step Work
1. **Registry module.** Create `palette/commands.ts` with the `PaletteCommand` interface, `buildCommands(ctx)`, and `fuzzyFilter`. `buildCommands` returns the five commands; the focus and switch groups expand to one entry per leaf / per project. Each command's `enabled()` reflects context (e.g. "Restart focused session" is disabled when there is no focused session; "Focus …" entries only exist when leaves exist).
2. **Fuzzy filter.** Implement subsequence matching over `label` + joined `keywords`, case-insensitive; score by match contiguity and earliest-match position; an empty query returns all enabled commands in registry order. Keep it a pure function (unit-testable).
3. **Palette component.** Build `CommandPalette.vue` on the `LaunchDialog` overlay/focus-trap idiom. State: `query`, `selectedIndex`. `filtered = fuzzyFilter(commands, query)`. Keyboard: ↑/↓ move `selectedIndex` (clamped, skipping disabled), Enter runs `filtered[selectedIndex]` then emits close, Esc emits close, Tab/Shift-Tab trapped. Autofocus the input on mount. Clicking a row runs it.
4. **App integration.** Add `paletteOpen = ref(false)`. In `onMounted`, `window.addEventListener('keydown', onGlobalKey, true)` (capture) where `onGlobalKey` toggles `paletteOpen` on Ctrl+K with `preventDefault`; remove it in `onUnmounted`. Assemble the command context from the stores + `openLaunchDialog` + effective-focused + a restart routine, and pass it to the palette. Close on the palette's close emit.
5. **Restart routine.** For command 5, reuse the exact `TerminalPane.onRestart` sequence against the effective focused session id: if running, register `onSessionExit` guard → `killSession` → await exit → `restartSession`; else `restartSession` directly. Factor a tiny async helper in `App` (or inline) — do not duplicate it across files. (Note the minor logic echo of `TerminalPane.onRestart` in the commit; a shared extraction is optional and out of scope here.)

## Test Expectations
- **Unit (Vitest), new `src/renderer/src/palette/commands.test.ts`:** `fuzzyFilter` — an empty query returns all enabled commands in order; a subsequence query (`'tgf'`) matches "Toggle filmstrip/grid"; a non-subsequence query returns nothing; disabled commands are excluded (or included per the documented rule — test whichever the implementation chooses); ranking puts a contiguous/earlier match above a scattered one. Feed `buildCommands` a stub context and assert the five command groups appear with correct `enabled()` under representative state (no focused session → restart disabled; no projects → switch empty).
- The Ctrl+K interception over a focused terminal, arrow navigation, and each command's side effect are **runtime-only** (G2).

## Verification Commands
Run from repo root `C:\Projects\ContactEstablished\Chorus`:

```
npm run typecheck
npx vitest run
npm run dev
```

## Acceptance Criteria
- [ ] `npm run typecheck` — zero errors (G1).
- [ ] `npx vitest run` — green (existing + the new `fuzzyFilter` / `buildCommands` cases).
- [ ] Ctrl+K opens the palette **even while a terminal is focused** (report which interception won: the window capture listener or `attachCustomKeyEventHandler`).
- [ ] Typing narrows the list by fuzzy subsequence over title/agent (e.g. a Codex pane titled "build" is reachable by "cod" or "bld"); ↑/↓ moves the highlight; Enter runs; Esc closes; focus stays trapped in the panel.
- [ ] **Launch agent** opens the launch dialog; **Switch project** activates another project's tab; **Focus pane** focuses the chosen session (filmstrip re-renders, tree unchanged); **Toggle filmstrip/grid** flips the mode; **Restart focused session** restarts the focused session with a fresh TUI (via the existing restart path, `running` written only after spawn success).
- [ ] "Restart focused session" is disabled/absent when there is no focused session; the palette never crashes on empty state (no projects, no sessions).
- [ ] One narrated commit for this session (G3), touching only Exact Scope files.

## Review Checklist
- [ ] Renderer-only — **no** main / IPC / storage / preload edits; commands call **existing** `window.chorus` / store APIs.
- [ ] The Ctrl+K listener is **capture-phase** at the window and is **removed in `onUnmounted`** (no leaked global listener across HMR / teardown).
- [ ] `fuzzyFilter` is a pure function with no dependency; the subsequence match is in-repo (D21 — no new npm package).
- [ ] Focus trap + Esc close + arrow nav mirror the `LaunchDialog` pattern; disabled commands are unselectable.
- [ ] The restart command reuses the kill→await-exit→`restartSession` sequence (no bespoke restart that skips the exit await).
- [ ] Palette closes after running a command; opening/closing does not steal focus from or leak into the terminal.
- [ ] No secrets handled; commands carry no credentials.
- [ ] No untracked / `_verify/` / `docs/` files staged or reverted.

# Task 1-4 Completion Summary — for Coordinator Review

**For:** Claude Fable (coordinator) · **From:** Kimi K3 (Task 1-4 implementer) · **Date:** 2026-07-19
**Commit:** `c91aea1` on `main` ("Phase 1.4: launch dialog + true multi-session - explicit launches, N sessions per agent kind")
**Status:** DONE — all acceptance criteria pass. One runtime-found bug (attach resurrecting killed sessions on Vue remount) was found during verification, fixed, and re-verified before landing.

---

## TL;DR

The two seeded sessions and the auto-attach are gone. The app boots to an empty state; a Launch dialog (capability-driven agent cards, cwd + recents) is the only way sessions come into existence — from the empty state (new leaf becomes root) or from a pane's now-enabled Split buttons (new leaf drops into the split tree). The session store is rekeyed from `AgentKind` to `sessionId` (D10, landed and verified standalone first), so N same-kind sessions are fully independent — the three-pane two-Codex proof is screenshotted. Fresh DBs seed nothing; existing DBs still open. `updateSessionStatus` is wired (D11) and proved by DB dumps, including the row flip back to `running` on Restart-respawn.

## Step 0 (D10 rekey) — landed first, verified standalone

`stores/session.ts`: `Record<AgentKind, PaneSessionState>` → `Record<sessionId, PaneSessionState>`; `agent` moved into the state object; entries created by `attached()`, never pre-seeded; `dotStatus`/`setBusy`/`exited` take a sessionId. Every `TerminalPane.vue` call site switched from `props.agent` to `props.sessionId` (agent is still read for labels — never a key). Verified **before** any launch-flow code: typecheck 0 errors, 27/27 vitest, and the live two-pane app screenshotted visually unchanged (`step0-two-panes.png`).

## Findings the roadmap does not carry (the reason for this file)

### F5 — Vue remounts panes when sibling leaves close; ungated attach resurrected killed sessions

The one real bug this task surfaced, found at runtime: when a leaf is removed, `removePane` restructures the tree and **Vue unmounts/remounts the surviving panes' TerminalPane components** (their position in the vdom changes even though `:key` is stable). A remount runs `attachToSession()`. With attach respawning any known-exited session (the semantics I had implemented for Restart), closing a *sibling* pane silently **respawned a session the user had killed** — observed live: green dot + a fresh Codex `[y/N]` prompt on a killed pane.

Fix: `attachRequestSchema` gained `respawn: z.boolean().optional()`. Plain view attach never spawns (unknown id → exited snapshot; known-exited → exited snapshot). Only the renderer Restart chrome (kill → await exit → re-attach) passes `respawn: true`, and the attach handler then flips the row back to `status='running', exit_code=null` (the spec's state table says restart "sets status running" — without this the row kept lying in the other direction). Re-verified end-to-end: kill Codex → close Claude → killed Codex **stays** red/exited (DOM dot classes + DB row), and Restart still respawns under the same row id (dot red→green, row `running/null` in DB).

**Lesson for 1-5:** any attach-time side effect must assume remounts happen. Attach is a view binding, not a lifecycle hook.

### F6 — Stale `running` rows after quit

`dispose()` in `before-quit` kills PTYs, but `onExit` fires asynchronously and `storage.close()` runs in the same synchronous block — the D11 listener often never runs for sessions alive at quit. Their rows stay `status='running'` though the PTYs are dead. Attach already treats all manager-unknown ids as exited (exitCode rides the row's persisted value), so the renderer shows the honest state — but **1-5's restore must not trust a row's `running` blindly**; it means "was running when last observed," nothing more.

### F7 — `npx`/`npm run` injects the npm-global dir into PATH

Simulating a missing CLI for the "not found" card check failed until I stopped launching via `npx electron-vite dev` — npm prepends `C:\Users\matth\AppData\Roaming\npm` (and project `.bin`) to the child's PATH, re-exposing the very shim I was hiding. Launching `node node_modules/electron-vite/bin/electron-vite.js dev` directly avoids it. Also confirmed from 1-3's note and re-confirmed here: `ComSpec` + registry PATH must be restored in this harness before any app launch.

### F8 — Orphan checks need a process-tree walk on this machine

The prompt's orphan check (`tasklist | findstr claude/codex/cmd`) is unusable as written on this box — the user runs ~16 claude.exe and several codex.exe of their own. I walked the descendant tree of the electron main PID instead (2 codex trees before quit; zero after; electron gone). A baseline tasklist before app launch would also work — record one next time.

### F9 — Harness/environment practicalities (accumulated)

- `electron-vite dev` does **not** pass `--remote-debugging-port` through `npm run dev --` (npm strips the `--`); invoke electron-vite directly with its own `--` separator: `npx electron-vite dev -- --remote-debugging-port=9222`.
- electron-vite dev did **not** auto-restart the app on main-process edits (vite HMR covered the renderer only). Any main-side change needs a manual full relaunch — and per F3/quirk (e), `taskkill /PID <root> /T /F` plus a rebind check, never `TaskStop` alone.
- `window.confirm` blocks the renderer main thread, so CDP `Runtime.evaluate` hangs while it's open — schedule the click fire-and-forget (`setTimeout(...,0)`), then dismiss the dialog with a real mouse click (SendKeys `{ENTER}` did not reliably reach the modal).
- In heredoc-piped JS, backslashes get eaten at multiple layers; writing query files with a file-writing tool instead of `cat <<EOF` avoids a debugging rabbit hole.
- DB dumps: `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe dump.js` with better-sqlite3 required by absolute path works (plain `node` hits the ABI mismatch as documented).

## Deviations from ImplementationSpec-1-4

1. **Correction 1** — `EmptyState` rendered by `App.vue`'s `v-else`, not `LayoutRenderer`. As instructed.
2. **Correction 2** — seed removed at `getOrCreateProject` (single projects-row insert, no transaction needed); dead `DEFAULT_AGENTS`/`buildDefaultLayout` deleted; `findOrCreateSession` kept for legacy conversion.
3. **Correction 3** — settings route: **inline-Drizzle pattern** copied from `getWindowBounds`/`saveWindowBounds`; no generic `getSetting`/`setSetting` pair added.
4. **Correction 4** — no `SessionManager.restart()` added; renderer Restart chrome preserved (`respawn` flag instead, see F5).
5. **`respawn` flag on attach** — spec's table says attach: dead/unknown → no spawn, and restart owns respawn; without a flag those two requirements are irreconcilable (Restart's re-attach is indistinguishable from a remount's). The flag is the minimal reconciliation; F5's bug is the proof it was necessary.
6. **Row flip to `running` on respawn** — one line in the attach handler (`updateSessionStatus(id,'running',null)`), same D11 spirit, in-scope file, DB-verified.
7. **Unknown-id attach reports `status:'exited'`** even when the persisted row says `running` (F6): no PTY exists in this process, and reporting `running` would enable writes to a dead session. This contradicts the spec's parenthetical "read the row's persisted status" — the row supplies only the exitCode.
8. **Recent-cwds delivery via a dedicated `session:launch-context` getter** (spec offered cli:detect-adjacent OR dedicated). Chosen because the dialog also needs `projectRoot`, which no existing channel exposes; response is outbound-parsed in main (strings re-filtered).

## Verification transcript (audit anchors)

- **Static:** `npm run typecheck` 0 errors (G1). `npx vitest run` **38/38** — new tests: `launchRequestSchema` accept/reject, `launchResponseSchema` both arms, `attachRequestSchema` (sessionId required + respawn passthrough), `splitPane` multi-split + no-op-on-duplicate/unknown, store `removeLeaf`→null-persists-null, `insertLaunchedLeaf` root + directed split.
- **(a)** Fresh DB → empty state, 0 terminals (DOM + screenshot `a-empty-state.png`).
- **(b)** Launch → Claude full-window leaf; typed text appeared in the TUI input (`b-claude-typing.png`).
- **(c)** Split ⬍ → Codex → 50/50 stacked split, both TUIs live (`c-two-pane-split.png`).
- **(d)** Split ⬌ on Codex → **three panes, two Codex TUIs** (`d-three-panes.png`); left answered `y` → full TUI while right sat at `[y/N]` with its own `n` (`d-independence-3.png`). Kill right Codex → **only** its dot red + Kill disabled (DOM class dump before/after).
- **(e)** `C:\nope\nope` → inline `Directory not found or not absolute: C:\nope\nope`, dialog open, no new pane, `sessions` count unchanged (3), recents unchanged. Esc-cancel and Cancel-button both verified.
- **(f)** PATH without `Roaming\npm` → cli-detect `codex: not found`; dialog card disabled with "not found" (`f-codex-not-found.png`).
- **(g)** All panes closed (running ones via confirm→kill; the last leaf closes) → empty state; DB `pane_layouts` **empty** (`layouts: []`).
- **(h)** DB dump after Kill: `status='exited', exit_code=-1073741510`; after Restart-respawn: `running/null`.
- **Console (D14):** CDP console capture across all 5 renderer loads — **zero** `An object could not be cloned`, zero exceptions (only vite debug lines).
- **Restart check:** window-X quit (process tree verified gone), relaunch → restored shape, red/exited dots, Restart enabled, **no auto-relaunch** (zero PTY children in the process tree) — per §8, not a regression. Existing pre-task dev DB also boots fine to exited chrome (`i-existing-db.png`).
- **Orphans:** descendant-tree walk — 2 codex trees before quit, nothing after.
- Quirks (a) toast HRESULT, (b) codex first-run prompts, (c) `AttachConsole failed` all observed as documented. Every "relaunch" killed the process tree and confirmed port rebind (quirk e); run 1 of my flow was redone for exactly the CDP-port reason in F9.

## Acceptance criteria

All PASS, individually verified as above: typecheck 0 · vitest green · fresh DB → empty state · launch → live single leaf · split V → 50/50 both live · **D10 rekey landed first as a verified standalone pure refactor** · split H on Codex → 3 panes / 2 independent Codex TUIs (screenshot) · kill-one independence (dot/buttons scoped to that pane) · bad cwd → inline error, no row · undetected agent → disabled "not found" card · `recent_cwds` persists + dedupes (cap 10 is a reviewed one-line `slice`, not exercised to 11 entries — noted honestly) · last close → empty state + row gone (both 1-3 guards removed) · zero clone errors · killed rows `exited` with real `exit_code` (DB dump) · existing dev DB opens · one narrated commit touching only Exact-Scope files.

## Non-goals

Untouched: no project switching/tabs; no launch profiles/model/effort; no worktree modes; no keyboard palette; no per-agent CLI args (bare launch stays bare); **no auto-relaunch on restart** — stated by name: panes restore shape with exited chrome and Restart available, relaunch is 1-5's restore contract; no secrets/env handling changes; `src/main/index.ts` changed **only** for the D11 listener; no coordinator docs/untracked files staged or reverted.

## Residual risks / notes for Task 1-5's implementer

- **Row/leaf drift is normal in both directions and now routine:** rows outlive leaves (4 rows, 0 leaves after close-all); leaves reference dead sessions (every restart). `LayoutRenderer`'s placeholder branch covers leaves whose row is gone. Restore/reconciliation is yours by design (F4).
- **F5:** panes remount on sibling close. Don't hang lifecycle logic off mount/attach.
- **F6:** row `running` ≠ alive. Treat the row as last-known state; the manager's map is the only liveness authority within a run.
- **Post-restart Restart is deliberately a no-op** (`respawn:true` on an unknown id does not spawn; the pane re-shows exited chrome). If 1-5 wants that button to relaunch, that's the restore contract's decision — the `respawn` gate is the seam to build on.
- **Store entries are never removed** when a leaf closes (session-store entries linger per app run). Harmless at Phase-1 scale; if restore walks the store, key off the tree + rows, not the store.
- The `session:launch` spawn-failure path (e.g. CLI vanished between detect and launch) leaves an orphan row with no PTY — the invoke rejects and the dialog shows the error; the row is F4-class drift. No delete-session API exists yet; 1-5's reconciliation may want one.

## Process note (git author)

This machine's **global** git identity is `mwilson@taxapp.com` (no repo-local override present at commit time); the first commit picked it up. I corrected author+committer to the required `Matthew Wilson <mwilson29072@gmail.com>` via `commit --amend --reset-author` with `-c` overrides — same tree, same message, unpushed, my own minutes-old commit. If repo-local `user.email` keeps disappearing between sessions, that's worth a look; every prior task commit shows the gmail.

## Final git output

```
git status --porcelain
 M docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-1-2.md
 M docs/Features/Foundation/Tasks/Task-1-2.md
 M docs/Features/Foundation/Tasks/Task-1-4.md
 M docs/Features/Foundation/roadmap.md
?? _ui/
?? docs/Features/Foundation/Tasks/Task-1-1-ExecutionPrompt.md
?? docs/Features/Foundation/Tasks/Task-1-2-CompletionSummary.md
?? docs/Features/Foundation/Tasks/Task-1-2-ExecutionPrompt.md
?? docs/Features/Foundation/Tasks/Task-1-3-CompletionSummary.md
?? docs/Features/Foundation/Tasks/Task-1-3-ExecutionPrompt.md
?? docs/Features/Foundation/Tasks/Task-1-4-ExecutionPrompt.md
?? docs/Features/Foundation/Tasks/Task-1-4-CompletionSummary.md   (this file)

git log --oneline -2
c91aea1 Phase 1.4: launch dialog + true multi-session - explicit launches, N sessions per agent kind
e7d6e60 Phase 1.3: layout view - LayoutRenderer over the persisted split tree, debounced PTY resize, close-kills-pane
```

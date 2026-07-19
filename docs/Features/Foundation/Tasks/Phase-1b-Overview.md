# Phase 1b — Titles, Filmstrip, and the Command Palette

## Source Of Truth

- Roadmap: `docs/Features/Foundation/roadmap.md` (Phase 1b decisions D18–D21)
- `docs/PLAN.md` §183 (filmstrip is the default presentation), §188 (command palette), §189 (auto-titling)
- Project rules: `CLAUDE.md`
- Filmstrip spike: `docs/architecture/spike-filmstrip-notes.md` (2026-07-19 — tree/`agentFor` contract validated view-agnostic)
- Verified codebase state: **2026-07-19, commit `fb384c5`** (Phase 1 complete). Each task doc anchors its insertion points to **named symbols**, never line numbers.

## Goal

Phase 1 delivered grid mode: an owned binary split tree of live agent panes, spread across projects, restored on restart (D16). Phase 1b is a **presentation-and-input** layer on top of that same data model — it changes how the workspace is *seen* and *driven*, not what is stored about a session's process or layout.

By the end of Phase 1b:

- Every session carries a **title** — sourced first from the terminal's own OSC 0/2 title escape sequence, falling back to the first line the user types (D18). The title shows in each pane header and persists across restarts (a nullable `title` column, migration v3 / D19).
- The default workspace view is a **filmstrip**: one focused session rendered full, every other session a compact card in a strip along one edge; grid mode is one toggle away (D20). Filmstrip is the default for existing DBs too.
- **Ctrl+K** opens a command-palette skeleton — five commands over an extensible registry with an in-repo fuzzy filter (D21).

Phase 1b is deliberately a *view addition*, exactly as the filmstrip spike predicted: the persisted `LayoutJson` tree and the `agentFor(id)` resolver are consumed unchanged; focus is view state, never a tree mutation.

## The Three Tasks

Phase 1b is decomposed into three tasks executed **serially**. Titling lands first because both later views consume the title.

| Task | One-line scope | Depends on |
|------|----------------|------------|
| 1b-1 | **Session auto-titling** — migration v3 (`title` column), `session:set-title` IPC, OSC + first-line capture in `TerminalPane`, `SessionInfo`/attach carry `title`, header shows it | Phase 1 |
| 1b-2 | **Focus + Filmstrip default layout** — `FilmstripRenderer.vue` over the same tree/`agentFor` contract, focused pane + compact cards, view-mode toggle, per-project view-state persistence (`view:get`/`view:set`), filmstrip default | 1b-1 |
| 1b-3 | **Ctrl+K command palette skeleton** — `CommandPalette.vue` + a renderer command registry, in-repo fuzzy subsequence filter, five D21 commands wired to existing plumbing | 1b-2 |

### File-ownership matrix

Each task owns a bounded set of files. Serial execution is what makes the two shared files safe.

| File | 1b-1 | 1b-2 | 1b-3 |
|------|:----:|:----:|:----:|
| `src/main/db/schema.ts` | edit (`title` col) | — | — |
| `src/main/services/storage.ts` | edit (MIGRATIONS v3, `updateSessionTitle`) | edit (view-state accessors) | — |
| `src/shared/ipc.ts` | edit (`SessionSetTitle`, `title` on `SessionInfo`/attach) | edit (`ViewGet`/`ViewSet`, `createdAt` on `SessionInfo`) | — |
| `src/main/ipc.ts` | edit (`session:set-title`, title in attach/layout:get) | edit (`view:get`/`view:set`) | — |
| `src/preload/index.ts` | edit (`setSessionTitle`) | edit (`getViewState`/`setViewState`) | — |
| `src/renderer/src/components/TerminalPane.vue` | **edit** (capture + header title) | **edit** (focus-emit) | — |
| `src/renderer/src/components/FilmstripRenderer.vue` | — | create | — |
| `src/renderer/src/stores/view.ts` | — | create | — |
| `src/renderer/src/App.vue` | — | **edit** (mode render, toggle, focus) | **edit** (mount palette, Ctrl+K) |
| `src/renderer/src/components/CommandPalette.vue` | — | — | create |
| `src/renderer/src/palette/commands.ts` | — | — | create |

**The only cross-task overlaps are two files, and serial ordering makes both safe:**

- **`TerminalPane.vue`** is touched by **1b-1** (renders the title in the header) and **1b-2** (emits a `focus` event when its terminal gains focus, so the active pane is tracked in both views). 1b-2 starts only after 1b-1's commit exists.
- **`App.vue`** is touched by **1b-2** (renders `FilmstripRenderer` vs `LayoutRenderer` by mode, hosts the toggle, owns `focusedSessionId`) and **1b-3** (mounts `CommandPalette`, installs the Ctrl+K listener). 1b-3 starts only after 1b-2's commit exists.

`src/shared/ipc.ts`, `src/main/ipc.ts`, `src/main/services/storage.ts`, and `src/preload/index.ts` are each touched by 1b-1 and 1b-2, but in **disjoint regions** (title vs view-state) and, again, serially. `src/preload/index.d.ts` never needs manual edits — `ChorusApi` is inferred from the preload object.

Because ownership overlaps across the serial chain, every task doc repeats the same guard: implementers work only inside their listed scope and **must not revert, stage, or commit files they did not change**, including untracked `_verify/` harness artifacts and anything under `docs/`.

## Shared Context — what Phase 1 left behind

Phase 1b is built on these Phase-1 facts; implementers do not relitigate them.

- **The D16 restore engine.** `SessionManager.restore(projectId)` relaunches the restore set (layout leaves ∩ `running` rows) with fresh PTYs under the same row ids, heal-first, cwd-validated, 500 ms-staggered. A restored session emits `onRestored`; `restore` is idempotent within a run (live-guarded). Filmstrip focus swaps and palette-driven restarts ride this contract unchanged.
- **Attach-response chrome flags.** `attachResponseSchema` carries `restorePending` / `restored` / `cwdMissing`; `TerminalPane` drives all boot-transient chrome (spinner, badge, "Working directory not found" overlay) from these flags. **1b views must REUSE these flags, not re-derive lifecycle state.** Cards in the filmstrip do **not** attach, so they never fake these badges.
- **The consume-once F10 rule.** The restored badge rides `consumeRestoredBadge` (exactly one attach reports it, immune to how late the pane mounts). Boot-transient chrome is consume-once state, never a clock comparison — dev cold-start mounts have exceeded 20 s. Only the **focused** pane attaches, so only it can wear the badge.
- **The tree / `agentFor` contract.** The persisted `LayoutJson` tree (pure module `src/shared/layout.ts`: `collectSessionIds`, `findLeaf`, `removePane`, `splitPane`) plus `agentFor(id): AgentKind | undefined` is the identical props contract `LayoutRenderer` consumes. The spike confirmed a second, materially different renderer works over it with **zero model changes**. `FilmstripRenderer` is a new SFC over this contract, not an architecture change.
- **F5 — panes remount on sibling close.** `attach` is a pure view binding with no spawn path; Vue remounts panes when siblings close or when focus swaps. Attach-time side effects must assume remounts. A filmstrip focus change unmounts the old focused `TerminalPane` and mounts the new one — a safe remount, because the PTY keeps running in main and replays on the next attach.
- **The session store keys off rows + tree, not itself.** `useSessionStore` (`Record<sessionId, PaneSessionState>`) creates entries on attach and **never removes** them on leaf close. Any view iterating sessions keys off the layout tree + the `layout:get` `sessions[]` rows, never the store's keys.

## Decisions (Matthew, 2026-07-19 — quoted, not relitigated)

- **D18 — Title source: OSC + first-line fallback.** Titles come from terminal-title escape sequences: xterm.js parses OSC 0/2 and exposes `Terminal.onTitleChange: IEvent<string>` (confirmed in the installed `@xterm/xterm` 6 typings; still re-verify at execution time per D4). Fallback: if no OSC title has arrived, the first Enter-terminated line the user types into the pane becomes the title (truncated). OSC updates may keep updating the title live; the fallback only fires while the title is still null. **No LLM summarization** (Phase 3+).
- **D19 — Migration v3: nullable `title` TEXT column on `sessions`.** Applied via both the hand-rolled `MIGRATIONS` array + `schema_migrations` runner **and** the Drizzle `schema.ts` table definition. No council pass (one nullable column, trivially reversible). Existing DBs upgrade in place; rows keep `title = NULL` until a title event arrives.
- **D20 — View state per-project in the `settings` table.** A JSON value per project (key `view_state:<projectId>`) holding `{mode: 'filmstrip'|'grid', focusedSessionId: string|null}`, read/written over a small Zod-validated IPC, outbound-filtered in main. **Filmstrip is the DEFAULT** (PLAN §183) — including for existing DBs on first post-1b boot. Grid remains the alternate view, one toggle away.
- **D21 — Palette skeleton = five commands** over an extensible registry: launch agent (opens `LaunchDialog`), switch project, focus pane (by title/agent), toggle filmstrip/grid, restart focused session. Fuzzy filter implemented in-repo (simple subsequence match — **no new dependency**).

## Cross-cutting rules (every task doc repeats these)

- **No new npm dependencies.** The stack is locked (`CLAUDE.md`); Phase 1b adds nothing to `package.json`.
- **All Zod in main.** Preload and renderer are Zod-free (D1 — CSP forbids the eval Zod compiles parsers with). Every new renderer→main payload is parsed in the main handler; every main→renderer event is validated in main before sending.
- **D14 plain payloads.** Renderer→main IPC payloads must be plain objects — Pinia/reactive state is a Proxy that structured clone rejects at runtime with no compile-time signal. Snapshot store-sourced payloads (`JSON.parse(JSON.stringify(...))`, as `layout.ts::persistNow` already does).
- **Verify third-party APIs against installed typings at execution time (D4).** The xterm title event and key handler are cited from the installed typings in the specs; confirm them at execution, never from training-data memory.

## Gates (every task)

- **G1 — typecheck clean.** `npm run typecheck` exits 0 at every task boundary.
- **G2 — run, don't just compile.** Each task is verified with the app actually running and real Claude Code / Codex TUIs observed — not by build success alone. Every ImplementationSpec has a RUNTIME verification section.
- **G3 — one narrated commit per task session.** Commit style `80e69c3`: a plain-English paragraph, then a `Technical notes:` section. One commit per execution session, touching only that task's Exact Scope files.

## Phase-Level Acceptance Criteria

Phase 1b is complete when all of the following hold:

- [ ] Launching an agent produces a pane whose header shows a title — the CLI's OSC title if it emits one, else the first typed line; the title survives an app restart (DB-persisted, migration v3) (1b-1).
- [ ] The default view is the filmstrip: one focused pane + compact cards; clicking a card refocuses without mutating the tree; a toggle switches to grid and back; the choice persists per project (1b-2).
- [ ] Ctrl+K opens the palette even over a focused terminal; the five D21 commands run against existing plumbing; the fuzzy filter narrows by title/agent (1b-3).
- [ ] `npm run typecheck` is clean at every task boundary; the app runs and real TUIs are observed live; one narrated commit per task.

## Phase Non-Goals

Explicitly out of scope for Phase 1b (later phases or deliberately deferred):

- **No LLM summarization of titles** (Phase 3+); no manual rename UI; no title in the project tabs.
- **No card controls** (cards are click-to-focus only in 1b); no drag-to-reorder the filmstrip.
- **No keyboard shortcuts beyond Ctrl+K** (Ctrl+T / Ctrl+1..9 / Ctrl+Tab are later phases); no command persistence/recents; no palette theming beyond the existing Tailwind idiom.
- **No schema change beyond the one nullable `title` column.** View state lives in `settings`, not a new table.
- **No worktrees, no multi-window, no packaging** (unchanged from Phase 1).
- **Do not revert, stage, or commit unrelated or untracked files, including `_verify/` and anything under `docs/`.**

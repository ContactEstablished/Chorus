# Task 1b-2 — Focus + Filmstrip Default Layout

_Second task of Phase 1b (Foundation). Windows-only. Serial after Task 1b-1 (it consumes the `title` on `SessionInfo`)._

## Source Of Truth
- `CLAUDE.md` (locked architecture rules, incl. D1 Zod-in-main and D14 plain-object IPC).
- `docs/PLAN.md` §183 (filmstrip is the default presentation).
- Filmstrip spike: `docs/architecture/spike-filmstrip-notes.md` — a second, materially different rendering of the persisted tree works with **zero model changes**; carry the `agentFor(id): AgentKind | undefined` contract forward unchanged; keep filmstrip chrome free of store mutations (focus re-renders from the tree, never forks it).
- Phase 1b decision binding here: **D20** (view state per project in `settings`, key `view_state:<projectId>`, JSON `{mode, focusedSessionId}`, small Zod IPC outbound-filtered in main; filmstrip is the default, including for existing DBs).
- Phase 1 findings still binding: **F5** (attach is a pure view binding; focus swaps are safe remounts — the hidden session's PTY keeps running in main and replays on attach), **F10** (consume-once badge), **F4** (row/leaf drift is normal — a `focusedSessionId` can outlive its session).
- This task governs scope; `ImplementationSpec-1b-2.md` governs exact contents.

## Initial Starting Point

**Verified 2026-07-19 against commit `fb384c5`**, plus Task 1b-1 landed (`title` on `sessionInfoSchema` and `attachResponseSchema`; `session:set-title`).

- **`App.vue`** holds `sessions = ref<SessionInfo[]>([])`, filled by the single `watch(() => projectStore.activeId)` round-trip (`window.chorus.getLayout(id)` → `layout.loadLayout(tree, id)` + `sessions.value = rows`). It exposes `agentFor(id)` from `sessions`, hosts `openLaunchDialog`/`onLaunched`, and renders `<LayoutRenderer v-if="layout.tree">` / `<EmptyState v-else>` plus `<LaunchDialog>`.
- **`LayoutRenderer.vue`** props `{node, path, agentFor}`; recursive splitpanes; leaf branch renders `<TerminalPane v-if="agentFor(node.sessionId)">` else a "Session no longer exists" placeholder; relays `@split` up.
- **`TerminalPane.vue`** props `{sessionId, agent}` (+ header `title` from 1b-1); mounts xterm on `onMounted`; emits `split`. Only-focused-mounts-xterm is the mechanism that keeps the filmstrip cheap.
- **`SessionInfo`** = `{id, agent, status, title}` (title added in 1b-1). It does **not** carry `created_at` yet.
- **`storage`** settings pattern is inline Drizzle upsert (`getWindowBounds`/`saveWindowBounds`, `getActiveProjectId`/`setActiveProjectId`, key-per-value). `SessionRow` carries `createdAt`. There are **no** generic `getSetting`/`setSetting` helpers — each key has its own accessor pair.
- **`registerIpc(sessions, storage)`** with the `requireProject` FK-check helper; project-scoped handlers parse `project_id` (`z.uuid()`). `layout:get` returns `{layout, sessions}` (SessionInfo) — the single per-project round-trip every view reads.
- **The spike is throwaway** — no `FilmstripRenderer.vue` exists in the tree today.

## Goal

Make the **filmstrip** the default workspace view (D20): one **focused** session rendered as a full `TerminalPane`, every other leaf a compact **card** (agent, title, status dot, elapsed-since-`created_at`) in a strip along one edge. Clicking a card refocuses — a **view-state change only, never a tree mutation** (focus is not layout). A toggle switches to grid (`LayoutRenderer`) and back. The mode and focused session persist **per project** in `settings` (D20). Filmstrip is the default for existing DBs on first post-1b boot.

`FilmstripRenderer.vue` consumes the **same contract** the spike validated — the persisted tree + `agentFor(id)` — plus the `layout:get` `sessions[]` for card metadata (title/status/`created_at`). Focused-pane split and close keep working: a split's new session becomes focused; closing the focused pane focuses the next leaf in tree order.

## Exact Scope
Touch **only** these files:

| File | Change |
|---|---|
| `src/shared/ipc.ts` | Add `ViewGet: 'view:get'` / `ViewSet: 'view:set'` to `IpcChannel`; `viewModeSchema` (`z.enum(['filmstrip','grid'])`); `viewStateSchema` (`{mode, focusedSessionId: z.string().nullable()}`); `viewGetRequestSchema` / `viewSetRequestSchema` (`{project_id: z.uuid()}` [+ `state` on set]). Add `createdAt: z.string()` to `sessionInfoSchema` so cards can compute elapsed. |
| `src/main/services/storage.ts` | Add `getViewState(projectId): {mode,focusedSessionId} \| null` and `setViewState(projectId, state)` — inline-Drizzle settings, key `view_state:<projectId>`, mirroring `getWindowBounds`/`saveWindowBounds` (JSON value, defensive parse on read). |
| `src/main/ipc.ts` | Add `view:get` (FK-check `project_id`; return the stored state, or the **filmstrip default** `{mode:'filmstrip', focusedSessionId:null}` when absent; outbound `viewStateSchema.parse`) and `view:set` (FK-check; `storage.setViewState`). |
| `src/preload/index.ts` | Add `getViewState(projectId)` / `setViewState(projectId, state)` forwarders. |
| `src/renderer/src/stores/view.ts` | **New** Pinia store: `{mode, focusedSessionId, projectId}`; `loadFor(projectId)` (one `view:get`), `setMode(mode)`, `setFocused(sessionId)`; each mutation persists a **plain snapshot** via `view:set` (D14), flush-on-project-switch like `layout.ts`. |
| `src/renderer/src/components/FilmstripRenderer.vue` | **New.** Props `{tree, sessions, focusedSessionId, agentFor}`; emits `focus`, `split`. Focused leaf → one `TerminalPane` (full); every other leaf (in `collectSessionIds` order) → a compact card (agent label, title, status dot, ticking elapsed). Card click → `emit('focus', id)`. No xterm/canvas in cards. |
| `src/renderer/src/App.vue` | Import the view store + `FilmstripRenderer`; render `FilmstripRenderer` when `viewStore.mode==='filmstrip'` else `LayoutRenderer`; a toggle control; compute the effective focused leaf (fallback to first leaf in tree order when `focusedSessionId` is stale — F4); wire `@focus`; on `onLaunched` set the new session focused; load view state on active-project change. |
| `src/renderer/src/components/TerminalPane.vue` | Emit a `focus` event when its terminal gains focus (`terminal.textarea` focus, or `onData`), so the active pane is tracked in **both** views. No other change. |

Nothing else. If a change seems to require another file, raise it.

## Non-Goals
- **No card controls in 1b** — a card is click-to-focus only (no split/kill/restart on cards; those live on the focused pane's header). Deferred.
- **No drag-to-reorder** the filmstrip; card order is `collectSessionIds` document order.
- **No tree mutation on focus** — focus is view state; the tree is never re-shaped by focusing (spike recommendation).
- **No xterm/canvas/PTY stream in cards** — cards are plain flexbox; only the focused pane attaches.
- **No badges on cards** — the consume-once restored badge shows only on the focused pane, which is the only leaf that attaches (F10).
- **Optional-if-cheap (stretch):** a neutral status dot for healed / cwd-missing exited sessions (the F4 residual — currently the red error dot). Mark it clearly as stretch; **skip it without ceremony** if not trivial.
- **Do not revert, stage, or commit unrelated or untracked files, including `_verify/` and anything under `docs/`.**

## Dependencies
- Task 1b-1 landed: `title` on `SessionInfo`; the pane header renders it.
- `SessionRow.createdAt` exists (Phase 1); this task surfaces it on `SessionInfo`.
- No new npm dependencies.

## Step-by-step Work
1. **Schemas.** In `ipc.ts`: add `ViewGet`/`ViewSet` channels; `viewModeSchema`; `viewStateSchema`; the two request schemas; and `createdAt: z.string()` on `sessionInfoSchema`. Confirm `layout:get` now carries `createdAt` (SessionRow → parse).
2. **storage.** Add `getViewState`/`setViewState` (key `view_state:<projectId>`, defensive JSON parse — a corrupt/hand-edited row returns null → the default applies).
3. **Main handlers.** `view:get`: FK-check; `return viewStateSchema.parse(storage.getViewState(p.id) ?? { mode: 'filmstrip', focusedSessionId: null })`. `view:set`: FK-check; `storage.setViewState(p.id, req.state)`.
4. **Preload.** Add the two forwarders (`getViewState`, `setViewState`).
5. **view store.** New store holding `mode`/`focusedSessionId`/`projectId`; `loadFor(id)` fetches once and seeds; `setMode`/`setFocused` mutate then debounced-or-immediate `view:set` with a **plain snapshot**; on project switch, flush the old project's pending write before loading the new (mirror `layout.ts::loadLayout`'s flush-old-project guard).
6. **FilmstripRenderer.** Consume `{tree, sessions, focusedSessionId, agentFor}`. Compute `ids = collectSessionIds(tree.root)`. Render the focused leaf as `<TerminalPane :key="focusedSessionId" …>` (keyed so a focus swap remounts — F5). Render the rest as cards. Elapsed uses a **single shared `now` ref** ticked by one `setInterval` at **30 s or 60 s** granularity (never per-second — cards must not re-render every second); each card computes `now - createdAt`. Card click → `emit('focus', id)`.
7. **App wiring.** Load view state whenever `projectStore.activeId` changes (extend the existing watcher or add a sibling watcher, superseded by the same token discipline). Compute `effectiveFocused`: `focusedSessionId` if it is a current leaf (`findLeaf`), else `collectSessionIds(tree.root)[0]` (F4 — never crash, never a non-null assertion). Render `FilmstripRenderer` vs `LayoutRenderer` by mode; add a toggle button (near `ProjectTabs`) calling `viewStore.setMode`. On `@focus`, `viewStore.setFocused(id)`. In `onLaunched`, set the new session focused (a split's new pane becomes focused). Closing the focused pane needs no special code — `effectiveFocused` falls back to the first remaining leaf.
8. **TerminalPane focus emit.** Add `const emit = defineEmits<{ split: […]; focus: [sessionId: string] }>()` (extend the existing emits) and fire `emit('focus', props.sessionId)` when the terminal's textarea gains focus. `LayoutRenderer` and `FilmstripRenderer` relay it to `App`.

## Test Expectations
- **Unit (Vitest), `src/shared/ipc.test.ts`:** `viewStateSchema` accepts `{mode:'filmstrip', focusedSessionId:null}` and `{mode:'grid', focusedSessionId:'<id>'}`; rejects an unknown mode and a missing `focusedSessionId` key. `viewSetRequestSchema` requires a uuid `project_id` and a valid `state`. `sessionInfoSchema` now requires `createdAt`.
- **Focus fallback** (if factored into a pure helper, e.g. `resolveFocused(tree, focusedSessionId): string | null` reusing `findLeaf`/`collectSessionIds`): unit-test that a stale/absent id falls back to the first leaf, an empty/null tree yields null, and a valid id passes through. Otherwise it is a runtime check.
- The filmstrip rendering, focus swaps, elapsed ticker, and per-project persistence are **runtime-only** (G2).

## Verification Commands
Run from repo root `C:\Projects\ContactEstablished\Chorus`:

```
npm run typecheck
npx vitest run
npm run dev
```

Inspect persisted view state:

```
sqlite3 "$env:APPDATA\chorus\chorus.db" "SELECT key, value FROM settings WHERE key LIKE 'view_state:%';"
```

## Acceptance Criteria
- [ ] `npm run typecheck` — zero errors (G1).
- [ ] `npx vitest run` — green (existing + new schema/fallback cases).
- [ ] First post-1b boot on the **existing** dev DB shows the **filmstrip** (default), not the grid — no `view_state` row required.
- [ ] With ≥2 sessions: one focused full pane + compact cards for the rest; cards show agent, title (from 1b-1), a status dot, and an elapsed time that ticks at most once/minute.
- [ ] Clicking a card refocuses that session; the **tree is unchanged** (verify the persisted `pane_layouts` row is byte-identical before/after a focus change).
- [ ] The previously-focused session's TUI shows **continued output** after refocusing back to it (PTY kept running in main — the F5 / sessions-live-in-main proof).
- [ ] The toggle switches filmstrip ⇄ grid; both render the same tree; the choice persists per project across a restart (DB dump shows the `view_state:<id>` row).
- [ ] Splitting from the focused pane makes the **new** session focused; closing the focused pane focuses the **next** leaf in tree order (never a crash, even if `focusedSessionId` is stale).
- [ ] Cards never show a restored badge; only the focused pane wears it (F10).
- [ ] One narrated commit for this session (G3), touching only Exact Scope files.

## Review Checklist
- [ ] All Zod in **main**; `view:get`/`view:set` FK-check `project_id`; the response is outbound-`parse`d; preload/renderer Zod-free (D1, CSP).
- [ ] `view:set` payloads are **plain snapshots** (D14) — no reactive Proxy crosses IPC.
- [ ] Focus is view state only — **no tree mutation** on focus; `FilmstripRenderer` writes nothing to the layout store (spike recommendation).
- [ ] `focusedSessionId` fallback is total: a deleted-row / removed-leaf id resolves to the first leaf, never a crash or non-null assertion (F4).
- [ ] The elapsed ticker uses **one** shared interval at ≥30 s granularity — no per-card, per-second timers.
- [ ] Only the focused leaf mounts a `TerminalPane`; cards mount no xterm/canvas and open no PTY stream.
- [ ] The focused `TerminalPane` is `:key`ed by session id so a focus swap is a clean remount (F5); the old pane's `onBeforeUnmount` cleanup runs.
- [ ] Filmstrip default holds for existing DBs (absent `view_state` → filmstrip).
- [ ] Stretch neutral-dot change, if attempted, is isolated and does not regress the running/error dots; skipped cleanly otherwise.
- [ ] No untracked / `_verify/` / `docs/` files staged or reverted.

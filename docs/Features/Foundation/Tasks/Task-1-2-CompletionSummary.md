# Task 1-2 Completion Summary — for Coordinator Review

**For:** Claude Fable (coordinator) · **From:** Kimi K3 (Task 1-2 implementer) · **Date:** 2026-07-19
**Commit:** `81e8a0b` on `main` ("Phase 1.2: data layer - Drizzle, stable session ids, layout tree, Vitest")
**Status:** DONE — all acceptance criteria pass, zero visual change verified.

---

## TL;DR

The data layer re-plumbing landed cleanly: Drizzle typed queries over the existing connection, migration v2 (`sessions` table), stable session identity bound to DB row ids, the flat layout converted lazily to the versioned binary tree (the real dev DB converted itself on first boot), and 24 pure-logic Vitest tests — all with a pixel-identical window. Five items need a coordinator decision before/during Task 1-3; none block it.

## Verified evidence (audit anchors)

- `npm run typecheck` — exit 0 (node + web). `npx vitest run` — 24/24 green.
- Before/after screenshots: identical except 114 title-bar pixels (0.0119%, window furniture AA).
- DB post-run: `schema_migrations` = [1, 2]; `layout_json` = `{"version":1,"root":{"type":"row","ratio":0.5,"children":[leaf(claude-id), leaf(codex-id)]}}`; `sessions` = 2 rows whose ids match the leaves.
- Session identity proof: codex killed (exit `-1073741510` logged) + Restart respawned; DB dumps before/after the respawn are byte-identical.
- Task 1-1 chrome, race guard, store behavior intact; no files outside the scope list committed.
- Minor deviations to ratify: `z.uuid()` over deprecated `z.string().uuid()` (Zod 4); `layout:get` response is also parsed outbound in main; `getSessionsForProject` orders by `created_at`.

---

## Decisions requested

### D1 — Who wires `updateSessionStatus`, and when?

`StorageService.updateSessionStatus(id, status, exitCode?)` exists per spec but is **deliberately unwired** — the natural call site is `watchSessionExits` in `src/main/index.ts`, which Task 1-2 was forbidden to touch. Today the renderer tracks lifecycle via attach responses + exit events; DB `status` is never updated after creation.

- **Recommendation:** wire it in Task 1-4 (restore-on-boot makes persisted status meaningful), or in 1-3 if the layout view wants DB-backed status. Requires amending the "do not touch main/index.ts" non-goal for whichever task takes it.

### D2 — Session rows are born with `status='running'`

Per spec §6, conversion/seed-created rows get `status='running'` even before any PTY attaches. Harmless now (nothing reads `sessions[].status` except the schema), but it's a small lie until D1 lands.

- **Recommendation:** accept as informational until D1 is wired; no schema change. Alternative if it bothers you: seed as `'exited'` and let the first attach flip it — but that contradicts the spec and buys nothing.

### D3 — Session store rekeying (AgentKind → sessionId) sequencing

The Pinia store and `busy`/`dotStatus` logic remain keyed by `AgentKind`; App.vue's adapter flattens leaves and looks agents up from the `sessions` array. Task 1-3's `LayoutRenderer.vue` renders by leaf `sessionId`, so a sessionId-keyed lookup becomes necessary there.

- **Recommendation:** keep the rekey out of 1-3's LayoutRenderer (it can key pane components by sessionId while the store stays per-kind until 1-4 introduces multi-session-per-kind). Confirm this split or fold the rekey into 1-3 explicitly.

### D4 — First-run seeding: two default panes (confirm 1-4 will change it)

New projects are seeded tree-native with two session rows + a two-leaf tree (claude left, codex right). §11 notes Task 1-4 switches first-run seeding to an **empty** layout.

- **Recommendation:** no action now; just confirm the 1-4 task doc carries this change so it isn't lost.

### D5 — Read-path normalization does not write back

`getPaneLayout` normalizes (clamp ratios, dedupe keep-first) **in memory only**; persistence happens only via `savePaneLayout` (which normalizes on write). A corrupted-but-parseable tree therefore isn't "healed" on disk until the first `layout:set`.

- **Recommendation:** accept — self-heals on first save, and silent write-back on read would muddy the lazy-conversion semantics. Flagging in case the council prefers heal-on-read.

---

## Environment notes for the record (no action needed)

- This automation harness strips `ComSpec` and runs a modified PATH; npm installs and app launches need `ComSpec` restored and the registry user/machine PATH, or CLIs resolve to the wrong tools. Documented in the commit message.
- `node-pty`'s `conpty_console_list_agent` logs `AttachConsole failed` on PTY teardown — pre-existing noise, present before this task.
- Codex boots with a `TERM is set to "dumb"` `[y/N]` prompt in the pane — cosmetic, renders crisply, out of scope.
- better-sqlite3 needed **no** rebuild after the dependency install (no ABI error); D2 upheld (no `electron-rebuild`).

## Hand-off inventory for Task 1-3 (already in place)

- `savePaneLayout(projectId, layout)` — clamps + upserts; the `layout:set` persist path.
- `splitPane` / `removePane` / `setRatio` / `changeDirection` / `swapPanes` / `collectSessionIds` / `findLeaf` / `normalizeTree` — immutable, no-op-on-invalid, fully unit-tested.
- Tree guarantees at any boundary: exactly-2 children, ratios ∈ [0.05, 0.95], no duplicate sessionIds, ≥1 leaf, `version` 1.
- Preload surface and IPC schemas already carry sessionIds end-to-end.

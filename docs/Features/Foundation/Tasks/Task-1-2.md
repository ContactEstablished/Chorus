# Task 1-2 — Data Layer: Drizzle Schema, Stable Session IDs, LayoutTree, Legacy Conversion

## Source Of Truth
- `CLAUDE.md` (locked architecture rules) and `docs/PLAN.md` (roadmap).
- Roadmap §6 decisions, all RESOLVED 2026-07-18: **D1** Zod-in-main-only · **D2** no `electron-rebuild` ever (better-sqlite3 built via `.npmrc` electron runtime + `npm run rebuild:better-sqlite3` `/Od` workaround) · **D3** sessions-in-main · **D7** ADOPT DRIZZLE (schema types + typed queries in Phase 1) · **D9** layout = owned binary split tree persisted as data, splitpanes as a dumb renderer.
- Council findings: `docs/architecture/CR-1.2-pane-layout-council-findings.md` (authoritative for the layout schema and its invariants).
- Phase 1 task split: **1-2 is the data layer.** Strict serial dependency — it follows 1-1 (Tailwind + lifecycle UI) and precedes 1-3 (layout view).

## Initial Starting Point (verified 2026-07-18, line numbers exact)
- `src/main/services/sessionManager.ts` — `private sessions = new Map<string, PtySession>()` (line 38); `attach(agent: AgentKind, cwd: string)` (line 43); `getAgent(sessionId)` (line 71); `dispose()` (line 84); `findByAgent` (line 93); `spawn(agent, cwd)` (line 100) uses `resolveCli(agent)`, `useConpty: true`, 4 MB ring buffer, and sets `PtySession.id = randomUUID()` **at spawn — ephemeral**. This task begins replacing that ephemeral id with the stable DB row id.
- `src/shared/ipc.ts` — channels `session:attach` (line 12) `/write/resize`, `session:data`/`session:exit` events, `cli:detect` (line 22), `layout:get` (line 24); `agentKindSchema` (line 31); flat `paneSchema {slot, agent}` (line 93) + `layoutGetResponseSchema` (an array). All schemas exported; `.parse()` is called only in `src/main/ipc.ts`.
- `src/main/services/storage.ts` — better-sqlite3 12.11.1; hand-rolled `MIGRATIONS: string[]` + `schema_migrations(version, applied_at)`; tables `projects(id TEXT PK, name, root_path UNIQUE, created_at)`, `pane_layouts(project_id TEXT PK REFERENCES projects, layout_json TEXT NOT NULL)`, `settings(key PK, value)`; `DEFAULT_LAYOUT` (line 20) is a flat array; `getOrCreateProject` seeds project + layout in one transaction; `getPaneLayout` (line 83) Zod-validates and falls back to default. DB at `userData/chorus.db`, WAL. **The `layout_json` column already exists** — conversion is a CONTENT change (flat array → tree v1), done lazily on-read-then-write-back.
- `src/main/ipc.ts` — `registerIpc(sessions, storage, project)`; every handler Zod-parses; outbound events Zod-validated in main before `webContents.send`.
- `src/main/index.ts` — storage init at `whenReady`; `getOrCreateProject(DEV_WORKING_DIR)`; `registerIpc`; `watchSessionExits`; `createWindow`; `before-quit` → `sessions.dispose()` + `storage.close()`.
- `src/preload/index.ts` — Zod-free forwarders: `attachSession(agent)`, `detectClis()`, `getLayout()`, `writeSession`, `resizeSession`, `onSessionData`, `onSessionExit`.
- `src/renderer/src/App.vue` — `panes` ref (line 11) from `getLayout()`; `v-for` (line 22) → `<TerminalPane :agent>`; 50/50 flexbox.
- `src/renderer/src/components/TerminalPane.vue` — props `{agent}` (line 9), `attachSession(props.agent)` (line 44), xterm scrollback 10 000.
- `package.json` — scripts `dev, start, build, rebuild:better-sqlite3, typecheck:node, typecheck:web, typecheck`. **No `test` script yet.** Not installed: `drizzle-orm`, `drizzle-kit`, `vitest`, `splitpanes`. (Tailwind arrives in 1-1.)
- tsconfigs: `tsconfig.node.json` (main+preload+shared), `tsconfig.web.json` (renderer+shared).

## Goal
Replace the flat pane-layout data model with the council's persisted binary split-tree, introduce **stable session identity** (a `sessions` DB row id that survives restarts and PTY respawns), and adopt Drizzle ORM for schema types + typed queries — all as a **pure re-plumbing with zero visual change**. After this task the app still shows exactly two panes running the same live TUIs; nothing on screen moves. The tree model, the layout mutation library, and the legacy-content conversion path all land here so that Task 1-3 can build the real layout view on a settled foundation.

## Exact Scope
**Create:**
- `src/main/db/schema.ts` — Drizzle table definitions for `projects`, `pane_layouts`, `settings`, `schema_migrations` (existing) + new `sessions`.
- `src/shared/layout.ts` — `LayoutNode`/`LayoutJson` TypeScript types + pure tree functions (no Zod, no runtime deps).
- `vitest.config.ts` — node environment, pure-logic tests only.
- `src/shared/layout.test.ts` — unit tests for every layout invariant + legacy conversion (pure).

**Edit:**
- `package.json` — add devDeps `drizzle-orm`, `drizzle-kit`, `vitest`; add `"test": "vitest run"` script.
- `src/main/services/storage.ts` — append migration version 2 (sessions table) to `MIGRATIONS`; port existing methods to Drizzle typed queries over the same better-sqlite3 connection; make `getPaneLayout` return `LayoutJson` with lazy legacy conversion + write-back; add sessions CRUD (`createSession`, `getSessionsForProject`, `updateSessionStatus`) and `savePaneLayout(projectId, layout)` (persist path used by Task 1-3's `layout:set`).
- `src/shared/ipc.ts` — replace `paneSchema`/`layoutGetResponseSchema` (line 93 area) with `layoutJsonSchema` (recursive) and a new `layoutGetResponseSchema = { layout, sessions[] }`; extend `attachRequestSchema` with optional `sessionId`.
- `src/main/services/sessionManager.ts` — change `attach` to accept `{ sessionId?, agent }`; bind `PtySession.id` to the stable id when provided.
- `src/main/ipc.ts` — wire the new `layout:get` response shape and the extended attach request; parse all new schemas here (main only).
- `src/preload/index.ts` — forward the extended attach payload and the new `layout:get` response unchanged (still Zod-free).
- `src/renderer/src/App.vue` — interim flatten adapter: consume `{layout, sessions}`, flatten leaves via `collectSessionIds` in document order, render the same 50/50 flexbox row.
- `src/renderer/src/components/TerminalPane.vue` — accept `{sessionId, agent}`; attach by `sessionId`.
- `src/renderer/src/stores/session.ts` — accommodate keying by `sessionId` where needed (minimal; keep the interim simple).

## Non-Goals (itemized)
- **No** real layout view, splitpanes, `LayoutRenderer.vue`, resize UI, split/close buttons — that is Task 1-3.
- **No** launch dialog, no multi-session-per-kind UI — Task 1-4.
- **No** new IPC channel for sessions (`layout:set`, `session:kill`, `listSessions`). Session data rides on the extended `layout:get` response.
- **No** adoption of `drizzle-kit migrate` / drizzle-managed migrations. The hand-rolled `MIGRATIONS` array + `schema_migrations` format stays; Drizzle is used **only** for schema types + typed queries this task.
- **No** DB-backed integration tests under Vitest (better-sqlite3 loads an electron-ABI binding that fails under plain node — see Test Expectations). Tests are pure-logic only.
- **No** visual change of any kind. Two panes, same TUIs, same 50/50 split.
- **Do not revert, stage, or commit files the implementer did not change**, including anything untracked under `docs/`.

## Dependencies
- **Requires** Task 1-1 complete (Tailwind installed, lifecycle UI landed).
- Adds devDeps: `drizzle-orm`, `drizzle-kit`, `vitest`. All three are sanctioned (Drizzle by D7; Vitest is stack-resolved for Phase 1 testing).
- **D2 caveat:** any `npm install` may re-fetch better-sqlite3 and re-trigger the electron-ABI rebuild need. If `npm run dev` then fails to load the native module, run `npm run rebuild:better-sqlite3` (the `/Od` workaround). Never run `electron-rebuild`.

## Step-by-step Work
1. **Deps + script.** `npm install -D drizzle-orm drizzle-kit vitest`. Add `"test": "vitest run"` to `package.json`. If dev fails to boot afterward, run `npm run rebuild:better-sqlite3`.
2. **Drizzle schema** (`src/main/db/schema.ts`). Define `sqliteTable` for the four existing tables mirroring the current DDL exactly, plus the new `sessions` table: `id TEXT PK`, `project_id TEXT REFERENCES projects(id)`, `agent TEXT` (`'claude'|'codex'`), `cwd TEXT`, `status TEXT` (`'running'|'exited'`), `exit_code INTEGER NULL`, `created_at TEXT`. Export inferred row types.
3. **Migration 2** (`storage.ts`). Append a plain-SQL string to `MIGRATIONS` creating the `sessions` table (idempotent `CREATE TABLE IF NOT EXISTS`, matching the Drizzle definition byte-for-byte in column names/types). The runner records version 2 in `schema_migrations`.
4. **Port queries.** Wrap the existing better-sqlite3 connection in the Drizzle better-sqlite3 driver. Re-express `getOrCreateProject`, window-bounds get/save, and settings access as Drizzle typed queries against that same connection. Behavior is unchanged; only the query layer changes.
5. **Pure layout library** (`src/shared/layout.ts`). Implement `createLeaf`, `splitPane`, `removePane` (sibling absorbs; root-leaf removal → `null`), `setRatio` (clamped `[0.05,0.95]`), `changeDirection`, `swapPanes`, `collectSessionIds`, `findLeaf`, and `convertLegacyFlatLayout(flat, resolveSessionId)`. No Zod, no imports beyond TS types.
6. **Zod tree schema** (`src/shared/ipc.ts`). Replace `paneSchema`/`layoutGetResponseSchema` with `layoutJsonSchema` (recursive `z.lazy`, discriminated on `type`, tuple of exactly 2 children for internals, `version` literal 1, ratio `.min(.05).max(.95)`) and `layoutGetResponseSchema = z.object({ layout: layoutJsonSchema, sessions: z.array(sessionInfoSchema) })`. Extend `attachRequestSchema` with `sessionId: z.string().uuid().optional()`. Export all; parse none here.
7. **Stable session identity** (`sessionManager.ts`). Change `attach(opts: { sessionId?: string; agent: AgentKind }, cwd)`. When `sessionId` is present, spawn/reuse the PTY bound to that id (`PtySession.id = sessionId`) rather than `randomUUID()`. When absent, preserve current behavior for safety. Document inline: **from 1-2 on, session identity = DB row id; the PTY instance is ephemeral.**
8. **Storage read path** (`getPaneLayout`). Read `layout_json`; try `layoutJsonSchema.parse`. On success return the tree. On `ZodError`, try the legacy flat-array shape; if it matches, create `sessions` rows (stable ids) for each agent seeded with the project cwd, call `convertLegacyFlatLayout`, persist the tree back to `pane_layouts`, and return it. On any other invalid content, log and fall back to a single-leaf/empty state (per council: don't crash). Add `createSession`, `getSessionsForProject`, `updateSessionStatus`.
9. **IPC wiring** (`main/ipc.ts`). `layout:get` handler returns `{ layout, sessions }` (validated in main). The attach handler accepts the extended request; when `sessionId` is present it looks up the session row and calls the new `attach({ sessionId, agent }, cwd)`.
10. **Preload** (`preload/index.ts`). Forward the extended attach payload and the `{layout, sessions}` response verbatim. Still Zod-free.
11. **Interim renderer** (`App.vue` + `TerminalPane.vue`). App.vue reads `{layout, sessions}`, flattens leaves with `collectSessionIds`, looks up each leaf's `agent` from the `sessions` array, and renders `<TerminalPane :sessionId :agent>` in the same 50/50 flexbox. TerminalPane attaches by `sessionId`.
12. **Tests + Vitest config.** Add `vitest.config.ts` (node env) and `src/shared/layout.test.ts` covering all invariants + legacy conversion.
13. **Verify.** `npm run typecheck`, `npx vitest run`, `npm run dev` — confirm the window is pixel-identical to before.

## Test Expectations
Pure-logic Vitest tests over `src/shared/layout.ts` — **no DB, no electron, no better-sqlite3 import**.

Rationale for excluding DB tests: better-sqlite3 in this repo is built against the **electron** ABI (D2). Vitest runs under plain node, whose ABI differs, so any `import` of the storage module (which loads the native binding) throws at load time. Rather than maintain a parallel node-ABI rebuild, Task 1-2 keeps tests **pure-logic only** and defers storage/DB integration tests to a later task. This constraint is documented in the spec.

Required cases:
| Case | Assertion |
|---|---|
| Internal node children | Exactly 2 children; a 1- or 3-child node is rejected/impossible by construction |
| Ratio clamp on write | `setRatio` clamps to `[0.05, 0.95]` |
| Ratio clamp on read | conversion output ratios within bounds |
| Dedupe keep-first | Duplicate `sessionId`s collapse, first kept |
| Single-leaf minimum | Minimum valid tree is one leaf |
| Version literal | `version` is exactly `1` |
| `removePane` sibling-absorb | Removing one leaf of a pair returns the sibling in its place |
| `removePane` root collapse | Removing the only leaf returns `null` |
| `splitPane` | Target leaf becomes an internal node with the original + a new leaf, ratio 0.5 |
| Legacy conversion balanced shape | 2-entry flat array → single internal node, 2 leaves, ratio 0.5, correct session ids |
| `collectSessionIds` order | Document-order left-to-right |

## Verification Commands
```
npm run typecheck
npx vitest run
npm run dev
```
(If `npm run dev` reports a native-module load failure after the install: `npm run rebuild:better-sqlite3`, then re-run `npm run dev`.)

## Acceptance Criteria
- [ ] `npm run typecheck` — zero errors (G1).
- [ ] `npx vitest run` — all pure-logic tests green.
- [ ] `npm run dev` (G2) — the window is **visually identical** to pre-task: two panes, same live TUIs, same 50/50 split.
- [ ] `pane_layouts.layout_json` for the dev project has been converted to `{version:1, root:{type:'row', ratio:0.5, children:[leaf, leaf]}}` and persisted.
- [ ] The `sessions` table exists with **2 rows** (one per agent), each with a stable `id`, correct `agent`, project cwd, and `status`.
- [ ] Session identity is the DB row id: the same `sessionId` is used across a PTY respawn.
- [ ] `paneSchema`/`layoutGetResponseSchema` (old) are gone; `layoutJsonSchema` + `{layout, sessions}` response are in place; `.parse()` is called only in `src/main/`.
- [ ] One narrated commit for this execution session (G3).

## Review Checklist
- [ ] All Zod `.parse()` calls live in `src/main/` only; `src/shared/layout.ts` imports no Zod.
- [ ] Drizzle is used for types + queries; the hand-rolled `MIGRATIONS`/`schema_migrations` runner is untouched apart from appended version 2.
- [ ] Migration 2 DDL matches `src/main/db/schema.ts` column names/types exactly.
- [ ] Legacy conversion is lazy on-read-then-write-back, not a SQL data migration.
- [ ] No new IPC channels; session data rides `layout:get`.
- [ ] No secrets in args/logs/transcripts (attach still injects keys via env only).
- [ ] No visual change; interim adapter flattens leaves in document order.
- [ ] No unrelated/untracked files reverted, staged, or committed (including `docs/`).
- [ ] D2 workaround (`npm run rebuild:better-sqlite3`) noted for any re-install.

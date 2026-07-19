# ImplementationSpec 1-2 — Data Layer (Deep Spec)

Companion to `docs/Features/Foundation/Tasks/Task-1-2.md`. Read the task first. This spec gives exact contents where determinable, exact insertion points anchored to verified symbols/lines, invariants, and runtime verification. Absolute dates; verified state as of 2026-07-18.

---

## 1. `package.json` changes
Add to `devDependencies`: `drizzle-orm`, `drizzle-kit`, `vitest`. Add to `scripts`:
```json
"test": "vitest run"
```
Install: `npm install -D drizzle-orm drizzle-kit vitest`.

**D2 note.** This install may re-fetch better-sqlite3 and re-trigger its electron-ABI build. If the app then fails to boot with a native-module ABI mismatch, run `npm run rebuild:better-sqlite3` (the existing `/Od` workaround). Do not run `electron-rebuild`.

---

## 2. `src/main/db/schema.ts` (new — exact content)
Mirrors the existing DDL exactly, plus `sessions`.

```ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  rootPath: text('root_path').notNull().unique(),
  createdAt: text('created_at').notNull(),
})

export const paneLayouts = sqliteTable('pane_layouts', {
  projectId: text('project_id').primaryKey().references(() => projects.id),
  layoutJson: text('layout_json').notNull(),
})

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

export const schemaMigrations = sqliteTable('schema_migrations', {
  version: integer('version').primaryKey(),
  appliedAt: text('applied_at').notNull(),
})

// NEW — stable session identity (survives restarts + PTY respawns)
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),                       // stable UUID
  projectId: text('project_id').notNull().references(() => projects.id),
  agent: text('agent').notNull(),                    // 'claude' | 'codex'
  cwd: text('cwd').notNull(),
  status: text('status').notNull(),                  // 'running' | 'exited'
  exitCode: integer('exit_code'),                    // nullable
  createdAt: text('created_at').notNull(),
})

export type ProjectRow = typeof projects.$inferSelect
export type PaneLayoutRow = typeof paneLayouts.$inferSelect
export type SessionRow = typeof sessions.$inferSelect
export type NewSessionRow = typeof sessions.$inferInsert
```

**Deliberate scope cut (state in code comment):** Drizzle here provides schema **types + typed queries only**. Migrations remain the hand-rolled `MIGRATIONS` array + `schema_migrations`. Swapping the migration engine and the query layer at once doubles risk; `drizzle-kit migrate` can be revisited when schema churn grows.

---

## 3. Migration version 2 — exact SQL appended to `MIGRATIONS` in `storage.ts`
Append **after** the existing migration string(s), so the runner assigns it version 2:

```sql
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id),
  agent       TEXT NOT NULL,
  cwd         TEXT NOT NULL,
  status      TEXT NOT NULL,
  exit_code   INTEGER,
  created_at  TEXT NOT NULL
);
```
Column names/types match `schema.ts` exactly. The runner records `(2, <ISO applied_at>)` in `schema_migrations`.

---

## 4. `layoutJsonSchema` — exact Zod (in `src/shared/ipc.ts`, replacing lines ~93)
Replace `paneSchema` and the old array `layoutGetResponseSchema`:

```ts
import { z } from 'zod'

const layoutLeafSchema = z.object({
  type: z.literal('leaf'),
  sessionId: z.string().min(1),
})

type LayoutNodeInput = z.input<typeof layoutLeafSchema> | {
  type: 'row' | 'column'
  ratio: number
  children: [LayoutNodeInput, LayoutNodeInput]
}

export const layoutNodeSchema: z.ZodType<LayoutNodeInput> = z.lazy(() =>
  z.discriminatedUnion('type', [
    layoutLeafSchema,
    z.object({
      type: z.union([z.literal('row'), z.literal('column')]),
      ratio: z.number().min(0.05).max(0.95),
      children: z.tuple([layoutNodeSchema, layoutNodeSchema]),
    }),
  ])
)

export const layoutJsonSchema = z.object({
  version: z.literal(1),
  root: layoutNodeSchema,
})

export const sessionInfoSchema = z.object({
  id: z.string().min(1),
  agent: agentKindSchema,           // existing, line 31
  status: z.union([z.literal('running'), z.literal('exited')]),
})

export const layoutGetResponseSchema = z.object({
  layout: layoutJsonSchema,
  sessions: z.array(sessionInfoSchema),
})
```

**Attach request change** (extend existing `attachRequestSchema`; keep `agent` working):
```ts
export const attachRequestSchema = z.object({
  agent: agentKindSchema,
  sessionId: z.string().uuid().optional(),
})
```
All schemas exported. `.parse()` is called **only** in `src/main/ipc.ts` and `src/main/services/storage.ts`. `z.discriminatedUnion` on `type` is required so an internal node cannot masquerade as a leaf; the `z.tuple` enforces the exactly-2-children invariant at the schema boundary.

---

## 5. `src/shared/layout.ts` — signatures + invariant notes (no Zod)
```ts
export type LayoutLeaf = { type: 'leaf'; sessionId: string }
export type LayoutInternal = {
  type: 'row' | 'column'
  ratio: number
  children: [LayoutNode, LayoutNode]
}
export type LayoutNode = LayoutLeaf | LayoutInternal
export type LayoutJson = { version: 1; root: LayoutNode }

const MIN_RATIO = 0.05
const MAX_RATIO = 0.95
export const clampRatio = (r: number): number =>
  Math.min(MAX_RATIO, Math.max(MIN_RATIO, r))

export function createLeaf(sessionId: string): LayoutLeaf
// invariant: sessionId non-empty (caller guarantees; not thrown here)

export function splitPane(
  tree: LayoutNode,
  targetSessionId: string,
  direction: 'row' | 'column',
  newSessionId: string,
): LayoutNode
// target leaf → internal{direction, ratio:0.5, children:[original, createLeaf(newSessionId)]}

export function removePane(tree: LayoutNode, sessionId: string): LayoutNode | null
// leaf match at root → null; else sibling absorbs the internal node's slot

export function setRatio(tree: LayoutNode, path: (0 | 1)[], ratio: number): LayoutNode
// clampRatio applied; path = 0|1 indices from root

export function changeDirection(tree: LayoutNode, path: (0 | 1)[]): LayoutNode
// toggles 'row' <-> 'column' at path

export function swapPanes(tree: LayoutNode, path: (0 | 1)[]): LayoutNode
// swaps children[0] <-> children[1] at the internal node at path

export function collectSessionIds(tree: LayoutNode): string[]
// left-to-right document order; used by the interim App.vue flatten adapter

export function findLeaf(tree: LayoutNode, sessionId: string): LayoutLeaf | null

export function convertLegacyFlatLayout(
  flat: { slot: number; agent: string }[],
  resolveSessionId: (agent: string, slot: number) => string,
): LayoutJson
```
`dedupe keep-first` note: `collectSessionIds` and the loaders treat the first occurrence of a `sessionId` as canonical; later duplicates are dropped when a tree is normalized on load.

---

## 6. Legacy conversion algorithm (exact)
Input: the current `DEFAULT_LAYOUT`-shaped flat array `[{slot:0, agent:'claude'}, {slot:1, agent:'codex'}]`.

1. For each flat entry, call `resolveSessionId(agent, slot)`. In storage, this looks up an existing `sessions` row for `(projectId, agent)`; if none, it **creates one** with a fresh UUID, `cwd = project.rootPath`, `status = 'running'`, `created_at = now`.
2. Build leaves in slot order: `leafA = createLeaf(idA)`, `leafB = createLeaf(idB)`.
3. Two leaves → a single split: `{ version:1, root:{ type:'row', ratio:0.5, children:[leafA, leafB] } }`.
   (General case, N leaves → balanced binary tree; Phase 1 only ever has 2, so the two-leaf split is the concrete path.)
4. Dedupe keep-first if the same agent appears twice (shouldn't in practice).

---

## 7. Storage read path pseudocode (`getPaneLayout`, replacing line ~83 logic)
```
row = db.select layout_json from pane_layouts where project_id = pid
raw = JSON.parse(row.layoutJson)

try:
    tree = layoutJsonSchema.parse(raw)          // main-only .parse — OK
    return normalize(tree)                        // dedupe keep-first, clamp ratios on read
catch ZodError:
    try:
        flat = legacyFlatArraySchema.parse(raw)  // { slot, agent }[]
    catch:
        log('invalid layout content, falling back to empty state')
        return emptyOrSingleLeafFallback()        // don't crash
    tree = convertLegacyFlatLayout(flat, (agent, slot) =>
        findOrCreateSessionRow(pid, agent, project.rootPath).id)
    db.update pane_layouts set layout_json = JSON.stringify(tree) where project_id = pid
    return tree
```
Ratios are clamped **on read** as well as write (council invariant). This is CONTENT conversion, not a SQL data migration — deliberate divergence from council action item 5, chosen for a single call-site and lazy semantics.

**Sessions CRUD** (Drizzle typed queries):
- `createSession(row: NewSessionRow): SessionRow`
- `savePaneLayout(projectId: string, layout: LayoutJson): void` — JSON.stringify + upsert into pane_layouts (Task 1-3's `layout:set` persist path)
- `getSessionsForProject(projectId): SessionRow[]`
- `updateSessionStatus(id, status, exitCode?)`

---

## 8. Attach schema + SessionManager change
`src/main/services/sessionManager.ts` — change `attach` (line 43):
```ts
attach(opts: { sessionId?: string; agent: AgentKind }, cwd: string): AttachSnapshot {
  // reuse a live PtySession keyed by opts.sessionId if present, else by agent (interim)
  // when spawning:
  //   const id = opts.sessionId ?? randomUUID()
  //   pty session .id = id                       // stable when sessionId provided
}
```
`spawn` (line 100) sets `PtySession.id = id` from the caller rather than always `randomUUID()`. Inline doc: **from 1-2 on, session identity = DB row id; the PTY instance is ephemeral and re-created on respawn under the same id.** `findByAgent` (line 93) remains for the interim single-per-kind path.

`src/main/ipc.ts` attach handler: `attachRequestSchema.parse(payload)` → if `sessionId` present, `storage.getSessionsForProject(project.id)` lookup → `sessions.attach({ sessionId, agent }, session.cwd)`.

---

## 9. Interim App.vue flatten adapter (extend `layout:get` response — chosen option)
Chosen (simplest, no extra channel): `layout:get` returns `{ layout: LayoutJson, sessions: SessionInfo[] }`.

`App.vue` (replace the line 11 `panes` ref + line 22 `v-for`):
```ts
const { layout, sessions } = await window.chorus.getLayout()
const order = collectSessionIds(layout.root)           // document order
const leaves = order.map(id => ({
  sessionId: id,
  agent: sessions.find(s => s.id === id)!.agent,
}))
```
```html
<div class="flex h-full w-full">
  <TerminalPane
    v-for="leaf in leaves" :key="leaf.sessionId"
    :sessionId="leaf.sessionId" :agent="leaf.agent" />
</div>
```
`TerminalPane.vue` — props become `{ sessionId: string; agent: AgentKind }` (line 9); `attachSession` (line 44) sends `{ sessionId: props.sessionId, agent: props.agent }`. Event filtering stays keyed on `sessionId`. The 50/50 flexbox is preserved so the render is pixel-identical.

`stores/session.ts` (lines 16-17) — where the current shape is `Record<AgentKind, PaneSessionState>`, key interim entries by `sessionId` if the store is touched at all; keep changes minimal.

---

## 10. `vitest.config.ts` — exact content
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
```
Tests never import `storage.ts` or better-sqlite3 (electron-ABI binding fails under node). Only `src/shared/layout.ts` is exercised.

---

## 11. Example test cases table (`src/shared/layout.test.ts`)
| # | Input | Expected |
|---|---|---|
| 1 | `setRatio(tree, [], 0.02)` | ratio clamped to `0.05` |
| 2 | `setRatio(tree, [], 0.99)` | ratio clamped to `0.95` |
| 3 | `splitPane(leaf('a'),'a','row','b')` | `{type:'row',ratio:0.5,children:[leaf('a'),leaf('b')]}` |
| 4 | `removePane(rowOf('a','b'),'b')` | `leaf('a')` |
| 5 | `removePane(leaf('a'),'a')` | `null` |
| 6 | `collectSessionIds(rowOf('a','b'))` | `['a','b']` (order) |
| 7 | `convertLegacyFlatLayout([{slot:0,agent:'claude'},{slot:1,agent:'codex'}], r)` | `{version:1,root:{type:'row',ratio:0.5,children:[leaf(idClaude),leaf(idCodex)]}}` |
| 8 | `changeDirection(rowOf('a','b'),[])` | `type:'column'` |
| 9 | `swapPanes(rowOf('a','b'),[])` | children reversed |
| 10 | duplicate-id tree | dedupe keep-first on normalize |
| 11 | leaf-only tree | valid minimum tree |

---

## 12. Verification (incl. RUNTIME)
```
npm run typecheck            # zero errors
npx vitest run               # all green
npm run dev                  # observe two panes, same TUIs, 50/50 — identical to pre-task
```
**Screenshot compare:** capture the dev window before and after (PowerShell user32 helper). They must be indistinguishable.

**DB inspection** via the ELECTRON_RUN_AS_NODE trick (better-sqlite3 loads under the electron binary running as node):
```
ELECTRON_RUN_AS_NODE=1 <path-to-electron> -e "const db=require('better-sqlite3')(process.env.APPDATA+'/<app>/chorus.db'); console.log(db.prepare('select layout_json from pane_layouts').get()); console.log(db.prepare('select id,agent,status from sessions').all());"
```
Expect: `layout_json` = the converted `{version:1, root:{type:'row', ratio:0.5, children:[leaf,leaf]}}`; `sessions` = 2 rows (claude, codex), stable ids, `status='running'`. Confirm `schema_migrations` contains version 2.

**Runtime identity check:** kill one PTY (let it respawn) and confirm the `sessions.id` is unchanged — identity survives the respawn.

---

## 13. Invariants recap (must hold post-task)
- Exactly-2 children on every internal node (schema tuple + constructor).
- Ratio clamped `[0.05, 0.95]` on write **and** read.
- `sessionId` non-empty; no duplicate `sessionId`s (dedupe keep-first on load).
- Minimum tree = single leaf; `version` literal 1.
- Invalid content → log + fall back to empty/single-leaf state, never crash.
- All `.parse()` in main only. No visual change. No new IPC channels. No unrelated/untracked files touched.

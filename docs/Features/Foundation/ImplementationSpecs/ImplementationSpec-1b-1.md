# Implementation Spec 1b-1 — Session Auto-Titling

_Deep spec for Task 1b-1. Read `Task-1b-1.md` first. Insertion points are anchored to **named symbols**, never line numbers._

## 1. The contract (D18/D19)

> A session's title is captured from the terminal, not synthesized. Priority: the OSC 0/2 window-title escape sequence (xterm parses it; `Terminal.onTitleChange` fires with the new title) wins and may keep updating live. Until an OSC title has ever arrived, the **first Enter-terminated line the user types** becomes the title (trimmed, truncated). The title is a **nullable** `sessions.title` column, written through one channel (`session:set-title`), debounced ~500 ms trailing in the renderer, and read back onto both the attach response and the `layout:get` `sessions[]` so every view shows it from the same round-trip. No LLM (Phase 3+).

**Why nullable, no council (D19):** one reversible column. Existing rows stay `NULL` until a title event fires; nothing reads a title as required.

**Why debounce in the renderer, not main:** OSC-emitting TUIs rewrite the title on every redraw. The renderer already holds the live value; a 500 ms trailing debounce collapses a redraw storm into one write while still landing the final title. Main stays a dumb validated writer.

**Honest unknown (must be reported at execution):** it is **UNVERIFIED** whether Claude Code or Codex emit OSC 0/2 titles at all. `onTitleChange` may never fire for one or both. The first-line fallback is the **guaranteed** path. The implementer reports, per CLI, which mechanism fired.

## 2. Schema + migration (`src/main/db/schema.ts`, `src/main/services/storage.ts`)

**Drizzle table** — add to the `sessions` `sqliteTable` definition, after the `exitCode` column, before `createdAt`:

```ts
export const sessions = sqliteTable('sessions', {
  // …id, projectId, agent, cwd, status, exitCode unchanged…
  title: text('title'),            // nullable (D19) — no .notNull(); NULL until a title event
  createdAt: text('created_at').notNull()
})
```

`SessionRow` (`$inferSelect`) then types `title: string | null`; `NewSessionRow` (`$inferInsert`) types it optional — existing `createSession(...)` callers pass no `title`, so new rows are `NULL`. No caller change required.

**Migration v3** — append a **third** string to the `MIGRATIONS` array in `storage.ts` (it currently holds versions 1 and 2; `migrate()` applies `applied+1 … MIGRATIONS.length`):

```ts
const MIGRATIONS: string[] = [
  /* v1 … */,
  /* v2 … */,
  `ALTER TABLE sessions ADD COLUMN title TEXT;`   // v3 (D19): nullable, in place
]
```

`ALTER TABLE … ADD COLUMN` with no default and no `NOT NULL` back-fills existing rows to `NULL` — exactly D19. The runner records version 3 in `schema_migrations`.

**Invariant:** the DDL column name/type/nullability must match the Drizzle definition exactly (the same discipline the header comment on `MIGRATIONS` already states for v2). `TEXT` ↔ `text('title')`, both nullable.

**Storage accessor** — add next to `updateSessionStatus`:

```ts
updateSessionTitle(id: string, title: string): void {
  this.d.update(sessions).set({ title }).where(eq(sessions.id, id)).run()
}
```

## 3. IPC schema additions (`src/shared/ipc.ts`)

**Channel** — add to `IpcChannel`:

```ts
/** invoke: persist a session's captured title (OSC 0/2 or first-line fallback) */
SessionSetTitle: 'session:set-title',
```

**Request schema** (`z.uuid()` per repo convention):

```ts
export const setTitleRequestSchema = z.object({
  sessionId: z.uuid(),
  title: z.string().min(1).max(120)
})
export type SetTitleRequest = z.infer<typeof setTitleRequestSchema>
```

**Extend `sessionInfoSchema`** (rides `layout:get`) and **`attachResponseSchema`** (rides `session:attach`) with a required-nullable `title`:

```ts
export const sessionInfoSchema = z.object({
  id: z.string().min(1),
  agent: agentKindSchema,
  status: sessionStatusSchema,
  title: z.string().nullable()          // 1b-1
})

export const attachResponseSchema = z.object({
  // …sessionId, buffer, status, exitCode, cwdMissing?, restorePending?, restored?…
  title: z.string().nullable()          // 1b-1: seed the header on attach
})
```

`title` is **required in the object but nullable** (not `.optional()`) so every producer must supply it — `SessionRow.title` is `string | null`, which satisfies it directly; a producer that forgets it fails the outbound `.parse`, catching the omission at the boundary rather than as a silent `undefined`.

**Invariant:** `max(120)` at the schema layer bounds the wire size; the renderer also `.slice(0, 120)`s the fallback line, so the two agree.

## 4. Main handlers (`src/main/ipc.ts`)

**Sanitizer** — a tiny pure helper near the top of the module (exportable for a unit test):

```ts
/** Strip C0 control chars + DEL from a captured title; titles are raw terminal
 *  output. Returns the trimmed remainder (possibly empty — the caller rejects
 *  an empty result rather than writing a blank title). */
export function sanitizeTitle(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\x00-\x1F\x7F]/g, '').trim()
}
```

**Handler** — register alongside the other `ipcMain.handle` calls in `registerIpc`:

```ts
ipcMain.handle(IpcChannel.SessionSetTitle, (_event, payload): void => {
  const { sessionId, title } = setTitleRequestSchema.parse(payload)
  const clean = sanitizeTitle(title).slice(0, 120)
  if (clean.length === 0) return           // nothing worth persisting; no error, no write
  storage.updateSessionTitle(sessionId, clean)
})
```

No project closure is involved — the title write keys off the session row id (the row carries `project_id`). No FK-check on a project is needed; a bad `sessionId` simply updates zero rows (Drizzle `update … where` is a no-op on a missing id — acceptable; matches `updateSessionStatus`).

**Attach response** — in the existing `session:attach` handler, `const row = storage.getSessionById(sessionId)` is already fetched at the top. Add `title` to **both** returned shapes:

- Live-in-manager branch: `sessions.consumeRestoredBadge(sessionId) ? { ...snap, title: row.title, restored: true } : { ...snap, title: row.title }` (the snapshot has no title of its own; the row is the source).
- Manager-unknown branch: add `title: row.title` to the object literal alongside `sessionId: row.id`.

**`layout:get`** — the handler already does `sessions: storage.getSessionsForProject(p.id)` then `layoutGetResponseSchema.parse(...)`. `SessionRow` now carries `title`, and `sessionInfoSchema` now includes it, so the parse passes it through automatically. **Confirm** it flows (a quick log or the runtime DB check); no code change beyond the schema.

## 5. Preload (`src/preload/index.ts`)

Add one forwarder to `chorusApi` (types inferred into `ChorusApi`):

```ts
setSessionTitle: (sessionId: string, title: string): Promise<void> =>
  ipcRenderer.invoke(IpcChannel.SessionSetTitle, { sessionId, title }),
```

No Zod here (D1/CSP) — the payload is a plain object; main validates.

## 6. Renderer capture (`src/renderer/src/components/TerminalPane.vue`)

**State** — add near the existing `badge` / `paneMessage` refs:

```ts
const title = ref<string | null>(null)
let pendingLine = ''
let titleTimer: ReturnType<typeof setTimeout> | undefined
function persistTitle(t: string): void {
  clearTimeout(titleTimer)
  titleTimer = setTimeout(() => {
    void window.chorus.setSessionTitle(props.sessionId, t)
  }, 500)                                   // trailing debounce — last title wins
}
```

**Seed from attach** — in `attachToSession`, after `store.attached(...)`, seed the header so a reattach (F5 remount, or focus swap in 1b-2) shows the persisted title immediately:

```ts
if (attach.title !== null) title.value = attach.title
```

(Do not overwrite a live OSC value with a stale row value on a mid-session reattach: only seed when `title.value` is still `null`, i.e. `if (title.value === null && attach.title !== null) title.value = attach.title`.)

**OSC capture** — in `onMounted`, after `terminal.open(container.value!)` and before/after `attachToSession()`, register and track the disposable (D4: `onTitleChange` confirmed in `@xterm/xterm` 6 typings — verify at execution):

```ts
const titleDisposable = terminal.onTitleChange((t) => {
  title.value = t                            // OSC wins and may keep updating live
  persistTitle(t)
})
cleanups.push(() => titleDisposable.dispose())
```

**First-line fallback** — extend the **existing** `terminal.onData((data) => …)` keystroke handler (the one that forwards to `writeSession`). Buffer printable input; on Enter, if no title has ever arrived, adopt the line:

```ts
const dataDisposable = terminal.onData((data) => {
  if (pane.value.status === 'running') {
    void window.chorus.writeSession(props.sessionId, data)
  }
  if (title.value !== null) return           // OSC already owns the title
  if (data === '\r') {                        // Enter
    const line = pendingLine.trim().slice(0, 120)
    pendingLine = ''
    if (line.length > 0) {
      title.value = line
      persistTitle(line)
    }
  } else if (data === '\x7f') {               // Backspace
    pendingLine = pendingLine.slice(0, -1)
  } else if (data >= ' ') {                    // printable
    pendingLine += data
  }
})
```

Keep this inside the current `onData` registration so there is one keystroke listener, already pushed into `cleanups`.

**Cleanup** — in `onBeforeUnmount`, add `clearTimeout(titleTimer)` next to the existing `clearTimeout(resizeTimer)` / `clearTimeout(badgeTimer)`.

**Header** — in the header's left group, after the agent label span and before the badge span, add:

```html
<span
  v-if="title"
  class="max-w-[16rem] truncate text-xs text-neutral-400"
  :title="title"
>{{ title }}</span>
```

`truncate` (Tailwind: `overflow-hidden text-ellipsis whitespace-nowrap`) ellipsis-truncates; `:title` gives the full text on hover. `max-w-[16rem]` keeps it from crowding the buttons.

## 7. Invariants recap (1b-1)

- One nullable `title` column, applied by migration v3 in both the DDL string and the Drizzle table; existing rows back-fill to `NULL`.
- OSC title (via `onTitleChange`) wins and may update live; the first-line fallback fires **only while `title` is null** and never overwrites a live OSC title.
- All title writes go through `session:set-title`, sanitized (C0 + DEL stripped) and length-bounded in main; an empty post-sanitize title is a silent no-op, never a blank write.
- The renderer debounce is **500 ms trailing** — the final title always lands; a redraw storm does not flood IPC.
- `sessionInfoSchema.title` and `attachResponseSchema.title` are both present so every view reads the title from the same round-trip; the header renders it truncated with a full-text tooltip.
- Capture disposables and the debounce timer are tracked and torn down (F5 remount safety); no Zod in preload/renderer (D1).

## 8. Verification (including RUNTIME — G2: run, don't just compile)

**Static:**
- `npm run typecheck` (G1).
- `npx vitest run` — add to `src/shared/ipc.test.ts`: `setTitleRequestSchema` accept/reject (valid; empty title; >120; non-uuid `sessionId`); `sessionInfoSchema` accepts `title:null` and a string, rejects a missing `title`; `attachResponseSchema` accepts `title:null` and a string. If `sanitizeTitle` is exported, unit-test control-char stripping + trim.

**Runtime script (screenshot each step):**
1. `npm run dev` on the existing dev DB → app boots; the first-boot log shows migration v3 applied (or already-applied on a second run). Confirm zero data loss (existing sessions still listed).
2. Launch **Claude Code**. Watch the header. **Report:** did a title appear from OSC (`onTitleChange` fired) or only after you typed a line and pressed Enter (fallback)? Note the exact title shown.
3. Launch **Codex**. Repeat the report (OSC vs fallback). It is an acceptable and expected outcome for one or both CLIs to use only the fallback.
4. Type a long command line (>40 chars) into a fallback pane and press Enter → the header shows an ellipsis-truncated title; hovering shows the full text (`:title` tooltip).
5. In an OSC-emitting pane (if any), trigger repeated redraws → confirm `session:set-title` is **debounced** (the main-process log / DB write cadence shows ~1 write per settle, not per redraw).
6. Restart the app → the titled panes show their titles again. Confirm via DB:
   `sqlite3 "$env:APPDATA\chorus\chorus.db" "SELECT agent, status, title FROM sessions;"` → titled rows carry the string; untitled rows are `NULL`.
7. **Boundary:** paste a line containing control characters (e.g. an ANSI sequence) as the first line → the persisted title has the controls stripped (DB dump), and no blank title is ever written.

**Completion-summary requirement:** state, per CLI, **which capture mechanism fired** (OSC / fallback / both), and whether `onTitleChange` was confirmed present in the installed `@xterm/xterm` version at execution (D4).

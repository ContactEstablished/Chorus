# Task 1b-1 — Session Auto-Titling

_First task of Phase 1b (Foundation). Windows-only. Serial after Phase 1. Both later Phase 1b views consume the title, so titling lands first._

## Source Of Truth
- `CLAUDE.md` (locked architecture rules, incl. D1 Zod-in-main and D14 plain-object IPC).
- `docs/PLAN.md` §189 (auto-titling).
- Phase 1b decisions binding here: **D18** (title source: OSC 0/2 via `Terminal.onTitleChange`, first-line fallback, no LLM), **D19** (migration v3: nullable `title` TEXT column on `sessions`, in both the hand-rolled MIGRATIONS array and the Drizzle schema).
- Phase 1 findings still binding: **F5** (panes remount on sibling close — attach is a view binding; capture side-effects must survive remounts), **F10** (boot-transient chrome is consume-once, never a clock comparison).
- This task governs scope; `ImplementationSpec-1b-1.md` governs exact contents.

## Initial Starting Point

**Verified 2026-07-19 against commit `fb384c5`** (Phase 1 complete; `npm run typecheck` 0 errors; `npx vitest run` 55/55 across 4 files). Trust this over any older doc line.

- **`sessions` table** (`src/main/db/schema.ts` `sessions` + the second entry of the `MIGRATIONS` array in `storage.ts`): `id` TEXT PK, `project_id` FK, `agent`, `cwd`, `status`, `exit_code`, `created_at`. **No `title` column.** `SessionRow` / `NewSessionRow` are Drizzle `$inferSelect` / `$inferInsert`.
- **`MIGRATIONS`** is a `string[]` of two DDL blocks (versions 1, 2); `migrate()` applies `applied+1 … MIGRATIONS.length` inside a transaction and records `schema_migrations`. Adding a third string = migration version 3.
- **`StorageService`** has `createSession(NewSessionRow)`, `getSessionById(id)`, `getSessionsForProject(projectId)`, `updateSessionStatus(id, status, exitCode?)`. Inline-Drizzle upsert pattern for settings is `getWindowBounds`/`saveWindowBounds`. **No title accessor.**
- **IPC** — 17 channels in `IpcChannel` (`src/shared/ipc.ts`); `registerIpc(sessions, storage)` in `src/main/ipc.ts`; every project-scoped handler resolves `project_id` via the local `requireProject` helper and FK-checks it. `sessionInfoSchema` is `{id, agent, status}`; it rides `layoutGetResponseSchema.sessions`. `attachResponseSchema` is `{sessionId, buffer, status, exitCode, cwdMissing?, restorePending?, restored?}`. Repo convention is `z.uuid()` (not `z.string().uuid()`).
- **`SessionManager.attach(sessionId)`** returns a `SessionSnapshot` `{sessionId, buffer, status, exitCode}` or `null`. The `session:attach` handler already fetches `const row = storage.getSessionById(sessionId)` at the top, so `row.title` is in hand there.
- **`TerminalPane.vue`** props `{sessionId, agent}`. It creates the xterm `Terminal` in `onMounted`, calls `attachToSession()`, registers `terminal.onData((data) => …)` for keystrokes, and drives chrome (`paneMessage`, `badge`, `showBadge`) from the attach response. Header template shows the status dot, `labels[props.agent]`, and the transient badge. **No title anywhere.**
- **`preload/index.ts`** `chorusApi` forwards typed invokes; `ChorusApi` is inferred. No `setSessionTitle`.

## Goal

Give every session a human-readable title captured from the terminal itself and persisted across restarts.

- Add a **nullable `title` TEXT column** to `sessions` via migration v3 (D19), in both the hand-rolled `MIGRATIONS` array and the Drizzle `schema.ts` table.
- Add a **`session:set-title`** IPC (`{sessionId, title}`, Zod-parsed and control-character-sanitized in main) that persists via a new `storage.updateSessionTitle`.
- In `TerminalPane`, capture the title two ways (D18): (1) `Terminal.onTitleChange` (OSC 0/2) updates the title live; (2) a **first-line fallback** — buffer the user's keystrokes locally and, on the first Enter, submit the trimmed line **only if no title has arrived yet**. Both paths persist through the IPC, **debounced ~500 ms trailing** (TUIs spam title updates during redraws).
- Thread the title onto the round-trip both later views read: `sessionInfoSchema` (in `layout:get`'s `sessions[]`) and `attachResponseSchema` both gain `title`. The pane header shows the title next to the agent label — truncated with CSS ellipsis, full title in the `title=` tooltip attribute.

**Honest caveat (state it in the spec):** whether Claude Code / Codex actually emit OSC 0/2 titles is **UNVERIFIED until execution**. The first-line fallback is the guaranteed path. The implementer must report, in the commit and completion summary, **which mechanism fired for each CLI**.

## Exact Scope
Touch **only** these files:

| File | Change |
|---|---|
| `src/main/db/schema.ts` | Add `title: text('title')` (nullable — no `.notNull()`) to the `sessions` table, after `exitCode`. `SessionRow.title` becomes `string \| null`; `NewSessionRow.title` optional. |
| `src/main/services/storage.ts` | Append a **third** DDL string to `MIGRATIONS` (`ALTER TABLE sessions ADD COLUMN title TEXT;`) → migration version 3. Add `updateSessionTitle(id, title)` (inline-Drizzle update, mirroring `updateSessionStatus`). |
| `src/shared/ipc.ts` | Add `SessionSetTitle: 'session:set-title'` to `IpcChannel`; add `setTitleRequestSchema` (`{sessionId: z.uuid(), title: z.string().min(1).max(120)}`); add `title: z.string().nullable()` to `sessionInfoSchema` and to `attachResponseSchema`. |
| `src/main/ipc.ts` | Add the `session:set-title` handler (parse → sanitize control chars → reject if empty after sanitize → `storage.updateSessionTitle`). Include `title` in the `session:attach` response (both the live-snapshot branch and the manager-unknown branch, from the `row` already fetched). `layout:get`'s `sessions` already flow `SessionRow`s through `layoutGetResponseSchema.parse` — the new `sessionInfoSchema.title` picks up `row.title` automatically; confirm it. |
| `src/preload/index.ts` | Add `setSessionTitle(sessionId, title)` forwarder to `chorusApi`; import the request type if needed. |
| `src/renderer/src/components/TerminalPane.vue` | Seed a local `title` ref from `attach.title`; register `terminal.onTitleChange` (live update + debounced persist); add the first-line fallback (buffer keystrokes in the existing `terminal.onData` handler, submit on Enter when `title` is still null); render the title in the header with ellipsis + `title=` tooltip. Debounce/throttle the `session:set-title` IPC ~500 ms trailing. |

Nothing else. If a change seems to require another file, raise it.

## Non-Goals
- **No LLM summarization** — capture only (D18); Phase 3+.
- **No manual rename UI** — a later phase.
- **No title in the project tabs** — pane header only.
- **No new table and no schema change beyond the one nullable column** (D19).
- **No change to the restore/attach lifecycle** — this task only *reads* `row.title` into existing responses and *writes* it via one new channel.
- **Do not revert, stage, or commit unrelated or untracked files, including `_verify/` and anything under `docs/`.**

## Dependencies
- Phase 1 landed (commit `fb384c5`): `sessions` table, `session:attach`/`layout:get`, the restore engine, `getSessionById`.
- The installed `@xterm/xterm` 6 exposes `Terminal.onTitleChange: IEvent<string>` (confirmed in `node_modules/@xterm/xterm/typings/xterm.d.ts`; re-verify at execution per D4).
- No new npm dependencies.

## Step-by-step Work
1. **Schema + migration (D19).** Add the nullable `title` column to `schema.ts`'s `sessions`. Append `ALTER TABLE sessions ADD COLUMN title TEXT;` as the third `MIGRATIONS` entry. The runner applies it in place on existing DBs; `schema_migrations` records version 3. Existing rows keep `title = NULL`.
2. **storage accessor.** Add `updateSessionTitle(id: string, title: string): void` — inline Drizzle `update(sessions).set({title}).where(eq(sessions.id, id)).run()`, mirroring `updateSessionStatus`.
3. **Schemas.** In `ipc.ts`: add the `SessionSetTitle` channel; `setTitleRequestSchema`; extend `sessionInfoSchema` with `title: z.string().nullable()`; extend `attachResponseSchema` with `title: z.string().nullable()` (place it with the other optional/nullable fields).
4. **Main handlers.** Add the `session:set-title` handler: parse with `setTitleRequestSchema`, strip C0 control characters + DEL via the spec's `sanitizeTitle` helper (`raw.replace(/[\x00-\x1F\x7F]/g, '').trim()`), reject (structured error) if the result is empty, else `storage.updateSessionTitle(sessionId, clean)`. In the `session:attach` handler, add `title: row.title` to both returned shapes. Confirm `layout:get` already carries the title (SessionRow → `sessionInfoSchema.parse`).
5. **Preload.** Add `setSessionTitle: (sessionId, title) => ipcRenderer.invoke(IpcChannel.SessionSetTitle, {sessionId, title})`.
6. **Renderer capture.** In `TerminalPane`: add `const title = ref<string | null>(null)`; seed it from `attach.title` in `attachToSession`. In `onMounted`, after the terminal exists, register `terminal.onTitleChange((t) => { title.value = t; persistTitle(t) })` and push its disposable into `cleanups`. Add a `pendingLine` buffer; in the existing `terminal.onData` keystroke handler, append printable input and, on `\r`, if `title.value === null`, set `title.value = pendingLine.trim().slice(0, 120)` and `persistTitle(...)`, then reset the buffer. `persistTitle` is a **500 ms trailing debounce** over `window.chorus.setSessionTitle(props.sessionId, t)`; clear its timer in `onBeforeUnmount`.
7. **Header display.** In the header, next to `labels[props.agent]`, render `<span v-if="title" class="… truncate" :title="title">{{ title }}</span>` so long titles ellipsis-truncate and the full text is the tooltip.

## Test Expectations
- **Unit (Vitest), `src/shared/ipc.test.ts`:** `setTitleRequestSchema` accepts `{sessionId: <uuid>, title: 'x'}`; rejects a missing/empty title, a title over 120 chars, and a non-uuid `sessionId`. `sessionInfoSchema` accepts a row with `title: null` and with a string title, and rejects a missing `title` key (it is required-nullable). `attachResponseSchema` accepts `title: null` and a string.
- **Sanitization** (if factored into a small exported helper, e.g. `sanitizeTitle(raw): string`): unit-test that control characters are stripped and the result is trimmed; otherwise it is covered at runtime (G2).
- The OSC-capture and first-line-fallback paths are **runtime-only** (G2) — they need a live PTY and xterm.

## Verification Commands
Run from repo root `C:\Projects\ContactEstablished\Chorus`:

```
npm run typecheck
npx vitest run
npm run dev
```

Inspect the persisted title after a restart (adjust the path if `userData` differs):

```
# from a PowerShell prompt, against the dev DB
sqlite3 "$env:APPDATA\chorus\chorus.db" "SELECT id, agent, title FROM sessions;"
```

## Acceptance Criteria
- [ ] `npm run typecheck` — zero errors (G1).
- [ ] `npx vitest run` — green (existing 55 + the new schema cases).
- [ ] Migration v3 applies to the **existing** dev DB in place; `schema_migrations` shows version 3; pre-existing rows have `title = NULL` until a title event lands.
- [ ] Launch Claude Code → the header shows a title. **Report which mechanism fired**: OSC (`onTitleChange`) if the CLI emits one, else the first-typed-line fallback. Repeat for Codex and report.
- [ ] Long titles ellipsis-truncate in the header; the full title is the `title=` tooltip.
- [ ] Title updates are debounced (~500 ms trailing) — a redraw-spamming TUI does not flood `session:set-title` (observe the main log / DB write cadence).
- [ ] Restart the app → the title survives (read back from the DB; the fresh PTY may also re-emit its OSC title).
- [ ] A DB dump shows the `title` column populated for titled sessions (G2 runtime check).
- [ ] One narrated commit for this session (G3), touching only Exact Scope files.

## Review Checklist
- [ ] All Zod validation in **main**; the preload/renderer stay Zod-free (D1, CSP).
- [ ] `session:set-title` sanitizes control characters and rejects an empty post-sanitize title before any DB write.
- [ ] The first-line fallback fires **only while `title` is null**; a live OSC title keeps updating and is never overwritten by the fallback.
- [ ] The `onTitleChange` and keystroke disposables are pushed into `cleanups`; the debounce timer is cleared in `onBeforeUnmount` (F5 — the pane remounts on sibling close; no leaked listeners/timers).
- [ ] The debounce is **trailing** (last title wins) — not a fixed interval that could drop the final update.
- [ ] `sessionInfoSchema.title` and `attachResponseSchema.title` are both present so every view reads the title from the same round-trip.
- [ ] No secrets in args/logs/transcripts (unchanged); titles are terminal output, not credentials — but the sanitizer still runs.
- [ ] No untracked / `_verify/` / `docs/` files staged or reverted.

# Implementation Spec 1-4 — Launch Dialog + True Multi-Session

_Deep spec for Task 1-4. Read `Task-1-4.md` first. Post-1-3 state — insertion points are anchored to **named symbols**, never invented line numbers._

## 1. Session lifecycle state machine (the core invariant)
After this task, SessionManager exposes exactly four operations with disjoint responsibilities. This table is the contract; implement to it precisely.

| Op | Precondition | Row effect | PTY effect | Returns |
|---|---|---|---|---|
| `launch(agent, cwd)` | none | **creates** new stable row (status `running`) | **spawns** fresh PTY | attach-style snapshot (`{sessionId, buffer, status, exitCode}` + the new row id) |
| `attach({sessionId, agent}, cwd)` | row exists | none | **binds a view** to the live PTY + replays buffered output; if PTY is dead/unknown → **no spawn** | snapshot with real status (`running` or `exited`) |
| `restart(sessionId)` (existing Kill/Restart chrome) | row exists | keeps same row id; sets status `running` | **respawns** PTY under same id | snapshot `running` |
| `kill(sessionId)` | row exists | keeps row; sets status `exited` | **terminates** PTY | — (exit event follows) |

**Rationale:** collapsing "attach" and "launch" is what forced the old one-per-kind assumption and the auto-seed. Splitting them lets N same-kind sessions coexist (each is a distinct row + PTY) and makes restore in 1-5 a pure "attach live PTYs, relaunch the ones marked running" walk.

**Insertion (SessionManager, `src/main/services/sessionManager.ts`):**
- Add method `launch(agent, cwd)` adjacent to the existing `attach` method. Body: `const id = storage.createSession({ projectId, agent, cwd, status: 'running' }); const pty = this.spawn(agent, cwd, id); this.sessions.set(id, pty); return this.snapshot(id);` — reuse the existing private `spawn` and whatever `snapshot`/return-shape `attach` already builds.
- In `attach`, remove any branch that respawns when the session id is unknown or the PTY has exited. Replace with: return a snapshot carrying `status: 'exited'` (read the row's persisted status). Delete any `findByAgent` / one-per-kind helper and its call sites.

## 2. IPC schemas (`src/shared/ipc.ts`)
Insert next to the existing attach schemas:

```ts
export const launchRequestSchema = z.object({
  agent: agentKindSchema,          // reuse existing 'claude' | 'codex' enum
  cwd: z.string().min(1),
});
export type LaunchRequest = z.infer<typeof launchRequestSchema>;

// snapshot mirrors the attach response shape already defined in this module
export const launchResponseSchema = z.union([
  attachResponseSchema,            // existing symbol: { sessionId, buffer, status, exitCode }
  z.object({ ok: z.literal(false), reason: z.string() }),
]);
export type LaunchResponse = z.infer<typeof launchResponseSchema>;
```

`attachResponseSchema` is the existing symbol in `src/shared/ipc.ts` — reuse it; do not redefine the snapshot shape.

**Invariant:** `cwd` is only `min(1)` at the schema layer. Absolute-path and existence checks are **not** expressible in a shared schema that must also run conceptually near the renderer — they are main-only, filesystem-touching, and are the security boundary. Keep them in the handler (§3), never in `src/shared`.

## 3. `session:launch` handler (`src/main/ipc.ts`)
Register alongside the existing `session:attach` handler inside `registerIpc`. Exact logic:

```ts
ipcMain.handle('session:launch', async (_e, raw) => {
  const req = launchRequestSchema.parse(raw);            // Zod in main (D1)
  if (!path.isAbsolute(req.cwd) || !fs.existsSync(req.cwd)) {
    return { ok: false, reason: `Directory not found or not absolute: ${req.cwd}` };
  }
  const snap = sessions.launch(req.agent, req.cwd);       // §1
  storage.pushRecentCwd(req.cwd);                          // §5
  return snap;
});
```

- `import path from 'node:path'` and `import fs from 'node:fs'` at the top of `ipc.ts` if not already present.
- **Do not log `req.cwd` at error level with any surrounding env context.** A bare debug line with the path alone is acceptable; never interpolate process env near it (D5 hygiene).
- Structured `{ok:false, reason}` is returned (not thrown) so the renderer can surface it inline without a rejected-promise dance. The union in `launchResponseSchema` covers both arms.

## 4. Preload forwarder (`src/preload/index.ts`)
Add to the `ChorusApi` object, mirroring the existing `attach` forwarder exactly (no Zod here — CSP no-eval):

```ts
launch: (req: LaunchRequest): Promise<LaunchResponse> =>
  ipcRenderer.invoke('session:launch', req),
```

Add `launch` to the `ChorusApi` type so `window.chorus.launch` is typed in the renderer.

## 5. storage: first-run seeding change + recent-cwds (`src/main/services/storage.ts`)
**First-run change — anchored to `getOrCreateProject`:** locate the branch that, for a newly-created project, writes `DEFAULT_LAYOUT` into `pane_layouts`. Remove that write. A fresh project now has **no** `pane_layouts` row. Do **not** touch the legacy lazy-conversion branch in `getPaneLayout` — existing DBs must still upgrade. `getPaneLayout` therefore returns `null` for fresh projects (renderer shows empty state) and a converted/loaded tree for existing ones.

**Regression guard:** the existing dev `chorus.db` (which has a seeded layout) must open unchanged — the removed seed only affects DBs created after this task. State this in the commit message.

**Recent-cwds mechanics** (settings key `recent_cwds`, JSON string array):

```ts
getRecentCwds(): string[] {
  const raw = this.getSetting('recent_cwds');
  const arr = raw ? JSON.parse(raw) : [];
  return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
}
pushRecentCwd(p: string): void {
  const next = [p, ...this.getRecentCwds().filter(x => x !== p)].slice(0, 10);
  this.setSetting('recent_cwds', JSON.stringify(next));
}
```

**Outbound-validation invariant:** whenever recent-cwds are sent to the renderer (via a `cli:detect`-adjacent call or a dedicated getter), main re-filters to strings first. The renderer never trusts raw disk contents.

## 6. Split wiring, end-to-end
The flow from a pane header split button to a persisted tree:

1. **Pane header** (`TerminalPane.vue` chrome): the enabled H/V split buttons `emit('split', { targetSessionId, direction })` where `direction` is `'row'` (H → side-by-side) or `'column'` (V → stacked) — match whatever `splitPane`/`changeDirection` in `src/shared/layout.ts` already names its axes.
2. **App / LayoutRenderer** catches `split`, stores `pending = { targetSessionId, direction }`, and opens `LaunchDialog` in split mode.
3. **On launch success** (`snap` with a `sessionId`): the layout store applies `splitPane(tree, pending.targetSessionId, pending.direction, { type: 'leaf', sessionId: snap.sessionId })`, then persists via `layout:set` (main clamps + re-validates against `layoutJsonSchema`).
4. **Empty state / first launch**: `pending` is null → the new leaf becomes the root (`tree = { type:'leaf', sessionId }`).

**Invariant:** the renderer never fabricates a session id — it only inserts the id that main returned. `layout:set` is always the single persistence path.

## 7. `LaunchDialog.vue` sketch (Tailwind)
Structure (classes indicative, follow the 1-1 Tailwind conventions already in the repo):

```html
<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" @keydown.esc="cancel">
  <div ref="panel" class="w-[28rem] rounded-lg bg-neutral-900 p-5 shadow-xl" role="dialog" aria-modal="true">
    <h2 class="text-sm font-semibold text-neutral-200">Launch agent</h2>

    <!-- agent cards from detectClis() -->
    <div class="mt-3 grid grid-cols-2 gap-2">
      <button v-for="a in agents" :key="a.name"
              :disabled="!a.found"
              :class="[selected===a.name ? 'ring-2 ring-sky-500' : 'ring-1 ring-neutral-700',
                       !a.found && 'opacity-40 cursor-not-allowed']"
              class="rounded-md p-3 text-left"
              @click="selected = a.name">
        <div class="text-neutral-100">{{ a.name }}</div>
        <div class="text-xs text-neutral-400">
          {{ a.found ? a.version : 'not found' }}
        </div>
      </button>
    </div>

    <!-- cwd -->
    <label class="mt-4 block text-xs text-neutral-400">Working directory</label>
    <input v-model="cwd" class="mt-1 w-full rounded bg-neutral-800 px-2 py-1 text-neutral-100" />
    <div class="mt-1 flex flex-wrap gap-1">
      <button class="text-xs text-sky-400" @click="cwd = projectRoot">use project root</button>
      <button v-for="r in recentCwds" :key="r" class="text-xs text-neutral-400 hover:text-neutral-200"
              @click="cwd = r">{{ r }}</button>
    </div>

    <p v-if="error" class="mt-2 text-xs text-red-400">{{ error }}</p>

    <div class="mt-5 flex justify-end gap-2">
      <button class="text-sm text-neutral-400" @click="cancel">Cancel</button>
      <button class="rounded bg-sky-600 px-3 py-1 text-sm text-white disabled:opacity-40"
              :disabled="!selected || !cwd" @click="submit">Launch</button>
    </div>
  </div>
</div>
```

- `agents` is built from `detectClis()` results (via the existing `cli:detect` invoke): `{ name, found, version }`. Undetected → disabled card with "not found".
- `projectRoot` is the active project root (from the current single project until 1-5).
- `recentCwds` comes from main (§5), pre-filtered to strings.
- `submit()`: `const res = await window.chorus.launch({ agent: selected, cwd }); if ('ok' in res && res.ok === false) { error.value = res.reason; return; } emit('launched', res); close();`
- **Focus trap (basic):** on mount, focus the first enabled agent card or the cwd input; Tab/Shift-Tab cycle within `panel` (simple first/last-element wrap is sufficient — no full a11y library). Esc calls `cancel()`.

## 8. `EmptyState.vue`
Rendered by `LayoutRenderer.vue` when the store tree is `null`:

```html
<div class="flex h-full flex-col items-center justify-center gap-3 text-neutral-400">
  <p class="text-sm">No agents running.</p>
  <button class="rounded bg-sky-600 px-4 py-2 text-white" @click="$emit('launch')">Launch an agent</button>
</div>
```

`launch` opens `LaunchDialog` with `pending = null`.

## 9. Last-pane close → empty state
In the layout store's close handler (already kills the session in 1-3), after `removePane`:
- If `removePane` returns `null` (no leaves left), set `tree = null` and issue a delete of the `pane_layouts` row (a new tiny storage method `clearPaneLayout(projectId)` deleting the row, or reuse an existing setter with a null-tree contract — pick the delete-row route so `getPaneLayout` returns `null` and the empty state shows). Keep `layoutJsonSchema` strict; never persist a `null` inside a `{version:1, root:null}` wrapper — the **absence of the row** is the empty signal.

## 10. Verification (including RUNTIME)
**Static:** `npm run typecheck` (G1) and `npx vitest run` (layout `splitPane`/`removePane`→null cases, `launchRequestSchema` accept/reject).

**Runtime script (G2 — screenshot each numbered step with the existing PowerShell user32 helper):**
1. Delete `userData/chorus.db*`. `npm run dev`. → **Empty state** appears (not two seeded sessions).
2. Click Launch → dialog → pick Claude → cwd = project root → Launch. → **full-window single leaf**, live Claude TUI. Type into it; it responds.
3. Split V on that pane → dialog → pick Codex → Launch. → **50/50** split, both TUIs live.
4. Split H on the Codex pane → dialog → pick Codex again → Launch. → **THREE panes, two Codex TUIs**. Type a distinct command in each Codex pane; confirm they respond **independently** (the multi-session-per-kind proof — screenshot).
5. In the dialog, enter a nonexistent path (e.g. `C:\nope\nope`) → Launch. → **inline red error**, no new pane, no new row (verify via a quick `sessions` count).
6. Kill the middle pane. → sibling **absorbs** the space; layout stays valid.
7. Quit and `npm run dev` again. → panes render in the **restored shape** but show **exited/dead chrome** (Restart available). **No auto-relaunch** — that is 1-5. State this explicitly in the run notes so the reviewer does not flag it as a regression.

**Orphan check:** after quit in step 7, `tasklist` shows no lingering `claude`/`codex` agent processes (`dispose()` from prior tasks still owns quit cleanup).

## 11. Invariants recap
- N same-kind sessions = N rows + N PTYs; no lookup ever collapses them.
- `launch` is the only op that creates a row; `attach` never spawns; `restart` owns respawn; `kill` keeps the row.
- All Zod parsing in main; `cwd` absolute+exists validated in main before spawn.
- Empty layout = **absent** `pane_layouts` row, never a null-root wrapper.
- Renderer inserts only main-returned session ids; `layout:set` is the sole persistence path.
- Legacy DB conversion path untouched.

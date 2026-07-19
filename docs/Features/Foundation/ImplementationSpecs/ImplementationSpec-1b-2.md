# Implementation Spec 1b-2 — Focus + Filmstrip Default Layout

_Deep spec for Task 1b-2. Read `Task-1b-2.md` first. Insertion points are anchored to **named symbols**, never line numbers._

## 1. The contract (D20 + the filmstrip spike)

> The workspace has two views over one unchanged model. **Filmstrip (default):** one focused session rendered as a full `TerminalPane`; every other leaf is a compact card (agent, title, status dot, elapsed) in a strip along one edge. **Grid:** the Phase-1 `LayoutRenderer`. The view mode and the focused session are **per-project view state** persisted in `settings` (key `view_state:<projectId>`, JSON `{mode, focusedSessionId}`) over a small Zod IPC, outbound-filtered in main. **Focus is view state, never a tree mutation.** Filmstrip is the default — including for existing DBs with no `view_state` row.

The spike (`docs/architecture/spike-filmstrip-notes.md`) proved this is a **view addition, not an architecture change**: the filmstrip read the same `LayoutNode` tree via `collectSessionIds()` and resolved agents through the same `agentFor(id)` lookup as `LayoutRenderer` — "No splitpanes import, no xterm, no Pinia dependency beyond what any view gets handed. The tree model is confirmed view-agnostic." Carry the `agentFor(id): AgentKind | undefined` contract forward unchanged (it handles a leaf whose row is gone without a non-null assertion), and keep filmstrip chrome free of store mutations.

**Why per-project view state, not global:** two projects can sensibly want different focus and even different modes; the window-bounds/active-project settings already establish the per-key inline-Drizzle pattern this reuses.

## 2. IPC schema additions (`src/shared/ipc.ts`)

**Channels** — add to `IpcChannel`:

```ts
/** invoke: read a project's persisted view state (mode + focused session) */
ViewGet: 'view:get',
/** invoke: persist a project's view state */
ViewSet: 'view:set',
```

**Schemas:**

```ts
export const viewModeSchema = z.enum(['filmstrip', 'grid'])
export type ViewMode = z.infer<typeof viewModeSchema>

export const viewStateSchema = z.object({
  mode: viewModeSchema,
  focusedSessionId: z.string().nullable()     // may reference a since-gone session (F4)
})
export type ViewState = z.infer<typeof viewStateSchema>

export const viewGetRequestSchema = z.object({ project_id: z.uuid() })
export type ViewGetRequest = z.infer<typeof viewGetRequestSchema>

export const viewSetRequestSchema = z.object({
  project_id: z.uuid(),
  state: viewStateSchema
})
export type ViewSetRequest = z.infer<typeof viewSetRequestSchema>
```

**Extend `sessionInfoSchema`** with `createdAt` so cards can compute elapsed (title was added in 1b-1):

```ts
export const sessionInfoSchema = z.object({
  id: z.string().min(1),
  agent: agentKindSchema,
  status: sessionStatusSchema,
  title: z.string().nullable(),       // 1b-1
  createdAt: z.string()               // 1b-2 — SessionRow.createdAt (ISO string) passes through
})
```

**Invariant:** `focusedSessionId` is validated as a nullable string only — **never** FK-checked against sessions. It legitimately outlives its session (F4); the renderer resolves staleness by falling back to the first leaf (§6). Schema validity ≠ liveness.

## 3. Storage accessors (`src/main/services/storage.ts`)

Mirror the `getWindowBounds`/`saveWindowBounds` inline-Drizzle pattern (defensive JSON parse on read; a corrupt/hand-edited row returns `null` so the default applies). There is **no** generic `getSetting`/`setSetting` — each key gets its own pair.

```ts
getViewState(projectId: string): ViewState | null {
  const key = `view_state:${projectId}`
  const row = this.d.select().from(settings).where(eq(settings.key, key)).get()
  if (!row) return null
  try {
    const v = JSON.parse(row.value)
    if (
      (v.mode === 'filmstrip' || v.mode === 'grid') &&
      (v.focusedSessionId === null || typeof v.focusedSessionId === 'string')
    ) {
      return { mode: v.mode, focusedSessionId: v.focusedSessionId }
    }
  } catch {
    /* fall through to null → default applies */
  }
  return null
}

setViewState(projectId: string, state: ViewState): void {
  const key = `view_state:${projectId}`
  const value = JSON.stringify(state)
  this.d
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run()
}
```

Import `ViewState` from `../../shared/ipc` (a type-only import — no Zod in the read-path shape guard; the object guard above is deliberate plain TS, since storage already re-guards hand-edited rows this way for `getWindowBounds`). Main's `view:get` handler still does the authoritative `viewStateSchema.parse` on the way out (§4).

## 4. Main handlers (`src/main/ipc.ts`)

Register in `registerIpc`, using the existing `requireProject` FK-check:

```ts
ipcMain.handle(IpcChannel.ViewGet, (_event, payload): ViewState => {
  const req = viewGetRequestSchema.parse(payload)
  const p = requireProject(req.project_id)
  // Default = filmstrip (D20 / PLAN §183), applied when no row exists — this is
  // what makes existing DBs open in the filmstrip on first post-1b boot.
  return viewStateSchema.parse(
    storage.getViewState(p.id) ?? { mode: 'filmstrip', focusedSessionId: null }
  )
})

ipcMain.handle(IpcChannel.ViewSet, (_event, payload): void => {
  const req = viewSetRequestSchema.parse(payload)
  const p = requireProject(req.project_id)
  storage.setViewState(p.id, req.state)
})
```

**Invariant (outbound filter):** `view:get` returns a `viewStateSchema.parse`d object — a hand-edited/garbage settings row can never feed the renderer a bad shape; it collapses to the default.

## 5. Preload (`src/preload/index.ts`)

```ts
getViewState: (projectId: string): Promise<ViewState> =>
  ipcRenderer.invoke(IpcChannel.ViewGet, { project_id: projectId }),

setViewState: (projectId: string, state: ViewState): Promise<void> =>
  ipcRenderer.invoke(IpcChannel.ViewSet, { project_id: projectId, state }),
```

`state` is a plain object assembled by the store snapshot (§6) — D14: never pass the reactive store object directly.

## 6. View store (`src/renderer/src/stores/view.ts`, new)

Model it on `stores/layout.ts`: hold the active project's view state, persist on mutation, and **flush the old project before switching** so a pending write never lands under the new `project_id`.

```ts
import { defineStore } from 'pinia'
import type { ViewMode, ViewState } from '../../../shared/ipc'

export const useViewStore = defineStore('view', {
  state: (): { mode: ViewMode; focusedSessionId: string | null; projectId: string | null } => ({
    mode: 'filmstrip',            // default until loadFor resolves (D20)
    focusedSessionId: null,
    projectId: null
  }),
  actions: {
    async loadFor(projectId: string) {
      // A pending write belongs to the OLD project — persist it there first
      // (mirrors layout.ts::loadLayout's flush-old-project guard).
      if (this.projectId && this.projectId !== projectId) this.persistNow()
      const state = await window.chorus.getViewState(projectId)
      this.projectId = projectId
      this.mode = state.mode
      this.focusedSessionId = state.focusedSessionId
    },
    setMode(mode: ViewMode) {
      this.mode = mode
      this.persistNow()
    },
    setFocused(sessionId: string) {
      this.focusedSessionId = sessionId
      this.persistNow()
    },
    persistNow() {
      if (!this.projectId) return
      // Plain snapshot (D14): reactive Proxy would be rejected by structured clone.
      const snapshot: ViewState = { mode: this.mode, focusedSessionId: this.focusedSessionId }
      void window.chorus.setViewState(this.projectId, snapshot)
    }
  }
})
```

View-state writes are low-frequency (mode toggles, focus clicks), so no debounce is needed — persist immediately. (Contrast `layout.ts`, which debounces because ratio drags are continuous.)

## 7. `FilmstripRenderer.vue` (new)

**Props / emits** — the spike's contract plus the card-metadata array:

```ts
const props = defineProps<{
  tree: LayoutJson                                   // layout.tree (non-null; App guards v-if)
  sessions: SessionInfo[]                            // layout:get rows: title/status/createdAt
  focusedSessionId: string                           // App's resolved effective focus (§8)
  agentFor: (id: string) => AgentKind | undefined    // identical to LayoutRenderer's contract
}>()
const emit = defineEmits<{ focus: [sessionId: string]; split: [target: SplitTarget] }>()
```

**Order + partition** — one O(leaves) walk, exactly the spike's approach:

```ts
const ids = computed(() => collectSessionIds(props.tree.root))       // document order
const cardIds = computed(() => ids.value.filter((id) => id !== props.focusedSessionId))
const infoFor = (id: string) => props.sessions.find((s) => s.id === id)
```

**Focused pane** — one full `TerminalPane`, keyed so a focus swap is a clean remount (F5); relay its `split`/`focus`:

```html
<div class="min-h-0 flex-1">
  <TerminalPane
    v-if="agentFor(focusedSessionId)"
    :key="focusedSessionId"
    :session-id="focusedSessionId"
    :agent="(agentFor(focusedSessionId) as AgentKind)"
    @split="(t) => emit('split', t)"
    @focus="(id) => emit('focus', id)"
  />
  <div v-else class="flex h-full items-center justify-center text-xs text-neutral-500">
    Session no longer exists
  </div>
</div>
```

**Card strip** — plain flexbox, no xterm/canvas, click emits focus:

```html
<div class="flex shrink-0 gap-2 overflow-x-auto border-t border-neutral-800 bg-neutral-900 p-2">
  <button
    v-for="id in cardIds"
    :key="id"
    class="flex w-40 shrink-0 flex-col gap-1 rounded border border-neutral-700 p-2 text-left hover:border-sky-500"
    @click="emit('focus', id)"
  >
    <div class="flex items-center gap-1">
      <span class="inline-block h-2 w-2 rounded-full" :class="dotClass(id)" />
      <span class="text-xs text-neutral-200">{{ labels[agentFor(id) ?? 'claude'] }}</span>
    </div>
    <span class="truncate text-xs text-neutral-400" :title="infoFor(id)?.title ?? ''">
      {{ infoFor(id)?.title ?? '—' }}
    </span>
    <span class="text-[10px] text-neutral-500">{{ elapsed(id) }}</span>
  </button>
</div>
```

**Elapsed ticker — one shared clock, coarse granularity** (the key trap): a single `setInterval` at 60 s updates one `now` ref; every card derives its label from `now`. **Never** a per-card or per-second timer.

```ts
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | undefined
onMounted(() => { clock = setInterval(() => { now.value = Date.now() }, 60_000) })
onBeforeUnmount(() => clearInterval(clock))

function elapsed(id: string): string {
  const info = infoFor(id)
  if (!info) return ''
  const mins = Math.floor((now.value - Date.parse(info.createdAt)) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  return hrs < 24 ? `${hrs}h` : `${Math.floor(hrs / 24)}d`
}
```

`dotClass(id)` maps the row's `status`/`exitCode` to the same palette `TerminalPane` uses (green running / neutral exited-ok / red exited-error). The card's status comes from `infoFor(id)`, **not** from the session store (the store keys off attach and cards never attach). Reuse `labels: Record<AgentKind,'Claude Code'|'Codex'>` as `TerminalPane` defines it.

**Invariant:** the filmstrip writes **nothing** to the layout store — no `applyRatio`, `insertLaunchedLeaf`, or `removeLeaf`. Focus flows out as an event; the tree is read-only here (spike recommendation).

## 8. `App.vue` wiring

**Imports:** `import FilmstripRenderer from './components/FilmstripRenderer.vue'` and `import { useViewStore } from './stores/view'`; `const viewStore = useViewStore()`.

**Load view state on active-project change** — the existing `watch(() => projectStore.activeId, …, { immediate: true })` already does the `getLayout` round-trip. Add the view-state load in the same callback, under the same `loadToken` supersede guard, so a fast tab switch cannot cross state:

```ts
const token = ++loadToken
const [{ layout: tree, sessions: rows }] = await Promise.all([
  window.chorus.getLayout(id),
  viewStore.loadFor(id)                       // seeds mode + focusedSessionId for this project
])
if (token !== loadToken) return
layout.loadLayout(tree, id)
sessions.value = rows
```

(`viewStore.loadFor` returns void; keep the `getLayout` result as the awaited value. Adjust the destructure to your taste — the point is both run under the token.)

**Effective focus — total, never crashes (F4):**

```ts
const effectiveFocused = computed<string | null>(() => {
  if (!layout.tree) return null
  const ids = collectSessionIds(layout.tree.root)
  const wanted = viewStore.focusedSessionId
  if (wanted && findLeaf(layout.tree.root, wanted)) return wanted   // still a live leaf
  return ids[0] ?? null                                             // fallback: first leaf
})
```

Import `collectSessionIds` and `findLeaf` from `../../shared/layout` (both already exist — pure module).

**Render by mode:**

```html
<div class="min-h-0 flex-1">
  <template v-if="layout.tree">
    <FilmstripRenderer
      v-if="viewStore.mode === 'filmstrip' && effectiveFocused"
      :tree="layout.tree"
      :sessions="sessions"
      :focused-session-id="effectiveFocused"
      :agent-for="agentFor"
      @focus="(id) => viewStore.setFocused(id)"
      @split="openLaunchDialog"
    />
    <LayoutRenderer
      v-else
      :node="layout.tree.root"
      :path="[]"
      :agent-for="agentFor"
      @split="openLaunchDialog"
      @focus="(id) => viewStore.setFocused(id)"
    />
  </template>
  <EmptyState v-else @launch="openLaunchDialog()" />
</div>
```

**Toggle control** — a small button (place it in the `ProjectTabs` row region or a thin bar above the renderer). It flips the mode:

```html
<button
  class="px-2 py-1 text-xs text-neutral-400 hover:text-neutral-200"
  @click="viewStore.setMode(viewStore.mode === 'filmstrip' ? 'grid' : 'filmstrip')"
>
  {{ viewStore.mode === 'filmstrip' ? 'Grid view' : 'Filmstrip view' }}
</button>
```

(If placed inside `ProjectTabs.vue`, that file would enter scope — **do not**; keep the toggle in `App.vue`'s template, which is already in scope. Render it in App's top-level flexbox next to `<ProjectTabs />`.)

**Split-becomes-focused** — in `onLaunched`, after `layout.insertLaunchedLeaf(...)`, focus the new session:

```ts
viewStore.setFocused(snapshot.sessionId)
```

**Close-focuses-next** — no special code: closing the focused pane removes its leaf; `effectiveFocused` recomputes to `ids[0]` of the remaining tree. Verify at runtime.

## 9. `TerminalPane.vue` focus emit

Extend the existing `defineEmits` (currently `{ split: [target: SplitTarget] }`) to also declare `focus`:

```ts
const emit = defineEmits<{ split: [target: SplitTarget]; focus: [sessionId: string] }>()
```

Emit when the terminal's input gains focus, so clicking into a pane (grid or filmstrip) marks it the focused session — making a later filmstrip toggle land on the pane you were actually using. `terminal.textarea` is the xterm input element (confirmed `readonly textarea: HTMLTextAreaElement | undefined` in the installed typings — verify per D4). In `onMounted`, after `terminal.open(...)`:

```ts
const onFocus = (): void => emit('focus', props.sessionId)
terminal.textarea?.addEventListener('focus', onFocus)
cleanups.push(() => terminal?.textarea?.removeEventListener('focus', onFocus))
```

`LayoutRenderer` must relay this: it already relays `@split`; add `@focus="(id) => emit('focus', id)"` on its `<TerminalPane>` and declare `focus` in its own `defineEmits` — **this is the one `LayoutRenderer.vue` line 1b-2 touches** (it is not in the Exact Scope table; if the implementer prefers, route focus only through `FilmstripRenderer` and skip grid-mode focus-follow). **Judgment call flagged:** grid-mode focus-follow needs a one-line `LayoutRenderer` relay; filmstrip focus works without it (cards emit focus directly, and the focused `TerminalPane` in filmstrip relays via `FilmstripRenderer`). If grid focus-follow is dropped, `LayoutRenderer.vue` stays untouched and the emit still works from filmstrip's focused pane. Prefer the minimal path unless grid focus-follow is wanted; state which was chosen in the commit.

## 10. Invariants recap (1b-2)

- Two views over **one unchanged tree**; `FilmstripRenderer` consumes the same `LayoutNode` tree + `agentFor(id)` contract the spike validated, and mutates nothing in the layout store.
- Focus is **view state**, persisted per project in `settings` (`view_state:<projectId>`); a focus click never changes `pane_layouts`.
- Filmstrip is the **default** — `view:get` returns `{mode:'filmstrip', focusedSessionId:null}` when no row exists, so existing DBs open in the filmstrip.
- Only the **focused** leaf mounts a `TerminalPane` (attaches a PTY view); cards are plain flexbox with no xterm/canvas — the hidden sessions' PTYs keep running in main and replay on the next attach (F5).
- `focusedSessionId` is nullable and may be stale (F4); `effectiveFocused` falls back to the first leaf in tree order — never a crash, never a non-null assertion.
- The elapsed ticker is **one** shared 60 s interval; cards never re-render per second.
- The restored badge shows only on the focused pane (F10); cards never fake it (they don't attach).
- `view:set` payloads are plain snapshots (D14); `view:get` is outbound-`parse`d in main (D1); the store flushes the old project before switching.

## 11. Verification (including RUNTIME — G2: run, don't just compile)

**Static:**
- `npm run typecheck` (G1).
- `npx vitest run` — in `src/shared/ipc.test.ts`: `viewStateSchema` accept (`filmstrip`/`null`, `grid`/`<id>`) + reject (bad mode; missing `focusedSessionId`); `viewSetRequestSchema` requires uuid + valid state; `sessionInfoSchema` now requires `createdAt`. If `effectiveFocused`'s core is factored into a pure `resolveFocused(tree, wanted)` helper, unit-test: valid id passes through, stale id → first leaf, null tree → null.

**Runtime script (screenshot each step; use a project with ≥2 sessions):**
1. `npm run dev` on the existing dev DB → the app opens in the **filmstrip** (no `view_state` row yet — the default). One full focused pane + cards for the rest.
2. Read a card's metadata: agent label, title (from 1b-1), status dot, elapsed. Wait a minute → elapsed ticks up (once, not every second).
3. Click a card → that session becomes the focused full pane; the previously focused one becomes a card. Confirm the `pane_layouts` row is **unchanged** (dump it before/after — byte-identical).
4. Refocus back to the first session → its TUI shows **continued output** produced while it was a card (PTY kept running in main — F5 / sessions-live-in-main proof).
5. Click **Grid view** → `LayoutRenderer` renders the same tree in splitpanes. Toggle back → filmstrip. Restart the app → the last mode + focus are restored (DB dump shows the `view_state:<id>` row).
6. From the focused pane, **Split** → launch a session → the **new** session is focused. Then **close** the focused pane → focus lands on the next remaining leaf (tree order); no crash.
7. **Stale focus:** hand-edit the `view_state:<id>` row's `focusedSessionId` to a bogus id, boot → the app focuses the first leaf, no crash (F4 guard).
8. Confirm a card **never** shows the "Session restarted — new conversation" badge; only the focused pane can (F10).
9. Multi-project: set project A to grid, project B to filmstrip; switch tabs back and forth → each project restores its own mode/focus (per-project state; the store flushed the old project on switch).

# Implementation Spec 1b-3 — Ctrl+K Command Palette Skeleton

_Deep spec for Task 1b-3. Read `Task-1b-3.md` first. Insertion points are anchored to **named symbols**, never line numbers._

## 1. The contract (D21)

> A **Ctrl+K** modal over an **extensible command registry**, with an **in-repo fuzzy subsequence filter** (no dependency) and **five commands** wired to plumbing that already exists: launch agent, switch project, focus pane (by title/agent), toggle filmstrip/grid, restart focused session. Esc closes, arrows navigate, Enter runs, a basic focus trap (the `LaunchDialog` pattern) keeps focus inside. Renderer-only — no main/IPC/storage/preload changes.

**Why a registry, not hardcoded rows:** later phases add commands (Ctrl+T, project-scoped actions). A `PaletteCommand[]` built by a `buildCommands(ctx)` factory means new commands are additions to one array, and the palette component never changes.

**Why a window capture listener for the hotkey:** a focused xterm consumes key events before they bubble to Vue — the same reason `LaunchDialog` traps keys locally. A **capture-phase** `keydown` on `window` sees Ctrl+K before xterm's textarea handles it, so the palette opens over a live terminal. `attachCustomKeyEventHandler` (confirmed in the installed `@xterm/xterm` 6 typings — verify per D4) is the fallback if capture proves unreliable; it would require touching every `TerminalPane`, so prefer the single window listener.

## 2. Command registry (`src/renderer/src/palette/commands.ts`, new)

```ts
import type { ProjectsList, SessionInfo, AgentKind } from '../../../shared/ipc'

export interface PaletteCommand {
  id: string
  label: string
  keywords: string[]          // extra fuzzy-match tokens (agent kind, title, project name)
  enabled(): boolean
  run(): void | Promise<void>
}

/** Everything the five commands need, handed in from App so the module stays
 *  pure and testable (no store imports, no window.chorus reach-in here). */
export interface PaletteContext {
  openLaunchDialog: () => void
  projects: ProjectsList
  selectProject: (id: string) => void | Promise<void>
  leaves: { id: string; agent: AgentKind | undefined; title: string | null }[]
  focusSession: (id: string) => void
  focusedSessionId: string | null
  toggleMode: () => void
  currentMode: 'filmstrip' | 'grid'
  restartFocused: () => void | Promise<void>
}

const labels: Record<AgentKind, string> = { claude: 'Claude Code', codex: 'Codex' }

export function buildCommands(ctx: PaletteContext): PaletteCommand[] {
  const cmds: PaletteCommand[] = []

  // 1. Launch agent
  cmds.push({
    id: 'launch',
    label: 'Launch agent…',
    keywords: ['new', 'session', 'claude', 'codex', 'start'],
    enabled: () => true,
    run: () => ctx.openLaunchDialog()
  })

  // 2. Switch project — one entry per project (fuzzy by name)
  for (const p of ctx.projects) {
    cmds.push({
      id: `project:${p.id}`,
      label: `Switch to ${p.name}`,
      keywords: ['project', 'switch', p.name],
      enabled: () => !p.active,
      run: () => ctx.selectProject(p.id)
    })
  }

  // 3. Focus pane — one entry per leaf (fuzzy by agent + title)
  for (const leaf of ctx.leaves) {
    const agentLabel = leaf.agent ? labels[leaf.agent] : 'session'
    const title = leaf.title ?? '(untitled)'
    cmds.push({
      id: `focus:${leaf.id}`,
      label: `Focus ${agentLabel} — ${title}`,
      keywords: ['focus', 'pane', agentLabel, title],
      enabled: () => leaf.id !== ctx.focusedSessionId,
      run: () => ctx.focusSession(leaf.id)
    })
  }

  // 4. Toggle filmstrip / grid
  cmds.push({
    id: 'toggle-mode',
    label: ctx.currentMode === 'filmstrip' ? 'Switch to grid view' : 'Switch to filmstrip view',
    keywords: ['view', 'toggle', 'filmstrip', 'grid', 'layout'],
    enabled: () => true,
    run: () => ctx.toggleMode()
  })

  // 5. Restart focused session
  cmds.push({
    id: 'restart-focused',
    label: 'Restart focused session',
    keywords: ['restart', 'reload', 'focused'],
    enabled: () => ctx.focusedSessionId !== null,
    run: () => ctx.restartFocused()
  })

  return cmds
}
```

**Fuzzy subsequence filter** — pure, no dependency (D21):

```ts
/** Subsequence match: every char of `query` appears in order somewhere in the
 *  haystack (label + keywords), case-insensitive. Score rewards contiguity and
 *  an early first match so a tight hit outranks a scattered one. An empty query
 *  returns all enabled commands in registry order. */
export function fuzzyFilter(commands: PaletteCommand[], query: string): PaletteCommand[] {
  const enabled = commands.filter((c) => c.enabled())
  const q = query.trim().toLowerCase()
  if (q === '') return enabled

  const scored: { cmd: PaletteCommand; score: number }[] = []
  for (const cmd of enabled) {
    const hay = `${cmd.label} ${cmd.keywords.join(' ')}`.toLowerCase()
    const s = subsequenceScore(hay, q)
    if (s !== null) scored.push({ cmd, score: s })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.map((s) => s.cmd)
}

function subsequenceScore(hay: string, q: string): number | null {
  let hi = 0
  let firstIdx = -1
  let contiguous = 0
  let lastMatch = -2
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]
    let found = -1
    for (let j = hi; j < hay.length; j++) {
      if (hay[j] === ch) { found = j; break }
    }
    if (found === -1) return null              // not a subsequence
    if (firstIdx === -1) firstIdx = found
    if (found === lastMatch + 1) contiguous++
    lastMatch = found
    hi = found + 1
  }
  // higher = better: contiguity bonus minus how late the first match starts
  return contiguous * 10 - firstIdx
}
```

Keep `subsequenceScore` un-exported (implementation detail); `fuzzyFilter` and `buildCommands` are the tested surface.

## 3. `CommandPalette.vue` (new)

Built on the `LaunchDialog.vue` overlay + focus-trap idiom (`fixed inset-0 z-50 … bg-black/50`, inner `role="dialog" aria-modal="true"`, `onKeydown` trap). Props/emits:

```ts
const props = defineProps<{ commands: PaletteCommand[] }>()
const emit = defineEmits<{ close: [] }>()
```

State + derived list:

```ts
const query = ref('')
const selectedIndex = ref(0)
const filtered = computed(() => fuzzyFilter(props.commands, query.value))
watch(filtered, () => { selectedIndex.value = 0 })     // reset highlight on every re-filter
```

Keyboard handling on the panel (extends the `LaunchDialog` trap):

```ts
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') { emit('close'); return }
  if (e.key === 'ArrowDown') { move(1); e.preventDefault(); return }
  if (e.key === 'ArrowUp') { move(-1); e.preventDefault(); return }
  if (e.key === 'Enter') { runSelected(); e.preventDefault(); return }
  // …Tab / Shift-Tab focus trap, copied from LaunchDialog.onKeydown…
}
function move(delta: number): void {
  const n = filtered.value.length
  if (n === 0) return
  selectedIndex.value = (selectedIndex.value + delta + n) % n
}
async function runSelected(): Promise<void> {
  const cmd = filtered.value[selectedIndex.value]
  if (!cmd) return
  emit('close')                    // close first — running may open LaunchDialog / swap views
  await cmd.run()
}
```

Template: a search `<input>` (autofocus on mount, `@keydown` bound to `onKeydown` on the panel), then the filtered rows. Each row highlights when `i === selectedIndex`; clicking runs it. `buildCommands` already excludes nothing by `enabled()` at build time except via `fuzzyFilter` — since `fuzzyFilter` filters to `enabled()` commands, disabled ones simply don't appear. (Alternative: render disabled rows dimmed-and-unselectable — implementer's choice; the simpler "omit disabled" is acceptable for the skeleton. State which was chosen.)

```html
<div class="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-24" @keydown="onKeydown">
  <div ref="panel" class="w-[32rem] rounded-lg bg-neutral-900 p-3 shadow-xl" role="dialog" aria-modal="true">
    <input
      ref="input"
      v-model="query"
      placeholder="Type a command…"
      class="w-full rounded bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none"
    />
    <ul class="mt-2 max-h-80 overflow-y-auto">
      <li
        v-for="(cmd, i) in filtered"
        :key="cmd.id"
        :class="i === selectedIndex ? 'bg-sky-600 text-white' : 'text-neutral-300 hover:bg-neutral-800'"
        class="cursor-pointer rounded px-3 py-1.5 text-sm"
        @click="selectedIndex = i; runSelected()"
        @mouseenter="selectedIndex = i"
      >
        {{ cmd.label }}
      </li>
      <li v-if="filtered.length === 0" class="px-3 py-1.5 text-sm text-neutral-500">No matching command</li>
    </ul>
  </div>
</div>
```

Autofocus the input in `onMounted` (`input.value?.focus()`), same as `LaunchDialog` focuses `cwdInput`.

## 4. `App.vue` integration

**Imports:** `CommandPalette`, `buildCommands` + `PaletteCommand`/`PaletteContext` from `./palette/commands`. `collectSessionIds` is already imported for 1b-2's `effectiveFocused`.

**Open state + hotkey (window capture):**

```ts
const paletteOpen = ref(false)
function onGlobalKey(e: KeyboardEvent): void {
  if (e.ctrlKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    paletteOpen.value = !paletteOpen.value
  }
}
onMounted(() => window.addEventListener('keydown', onGlobalKey, true))    // capture phase
onUnmounted(() => window.removeEventListener('keydown', onGlobalKey, true))
```

Use `onMounted`/`onUnmounted` (App already imports `onMounted`; add `onUnmounted`). Capture (`true`) is what beats the focused xterm.

**Build the context** — a computed so it reflects current projects/leaves/focus:

```ts
const paletteCommands = computed<PaletteCommand[]>(() =>
  buildCommands({
    openLaunchDialog: () => openLaunchDialog(null),
    projects: projectStore.projects,
    selectProject: (id) => projectStore.select(id),
    leaves: layout.tree
      ? collectSessionIds(layout.tree.root).map((id) => ({
          id,
          agent: agentFor(id),
          title: sessions.value.find((s) => s.id === id)?.title ?? null
        }))
      : [],
    focusSession: (id) => viewStore.setFocused(id),
    focusedSessionId: effectiveFocused.value,
    toggleMode: () => viewStore.setMode(viewStore.mode === 'filmstrip' ? 'grid' : 'filmstrip'),
    currentMode: viewStore.mode,
    restartFocused: restartFocused
  })
)
```

**Restart routine** — reuse the `TerminalPane.onRestart` sequence against the effective focused id (kill→await-exit→restart; the exit await is load-bearing — main refuses to restart a live session):

```ts
async function restartFocused(): Promise<void> {
  const id = effectiveFocused.value
  if (!id) return
  const state = sessionStore.sessions[id]
  if (state?.status === 'running') {
    const exited = new Promise<void>((resolve) => {
      const off = window.chorus.onSessionExit((ev) => { if (ev.sessionId === id) { off(); resolve() } })
    })
    await window.chorus.killSession(id)
    await exited
  }
  await window.chorus.restartSession(id)
  // The focused TerminalPane re-attaches on session:restored (its existing
  // onSessionRestored handler) and repaints; no direct pane manipulation here.
}
```

This mirrors `TerminalPane.onRestart` but drives the session by id from App. The minor logic echo is acceptable for the skeleton (a shared extraction is out of scope — note it in the commit). The restarted pane repaints because `TerminalPane` already listens for `session:restored` and re-attaches (Phase 1 behavior).

**Mount the palette:**

```html
<CommandPalette
  v-if="paletteOpen"
  :commands="paletteCommands"
  @close="paletteOpen = false"
/>
```

## 5. Invariants recap (1b-3)

- Renderer-only: no main/IPC/storage/preload edits; every command calls **existing** `window.chorus` or store APIs.
- The Ctrl+K listener is **capture-phase on `window`** and is removed in `onUnmounted` — no leaked global listener across teardown/HMR, and it opens over a focused terminal.
- `fuzzyFilter` and `buildCommands` are **pure** and dependency-free (D21 subsequence match, no npm package).
- The five commands are an **array from a factory** — extensibility is adding to `buildCommands`, never editing the palette component.
- Focus trap + Esc + arrow nav mirror `LaunchDialog`; the palette closes before a command runs (a command may open `LaunchDialog` or swap the view, which must own focus next).
- "Restart focused session" reuses the kill→**await-exit**→`restartSession` sequence; it never calls `restartSession` on a still-live session (main would reject it).
- Empty states are safe: no projects → no switch entries; no leaves → no focus entries; no focus → restart command disabled/absent.

## 6. Verification (including RUNTIME — G2: run, don't just compile)

**Static:**
- `npm run typecheck` (G1).
- `npx vitest run` — new `src/renderer/src/palette/commands.test.ts`:
  - `fuzzyFilter`: empty query → all enabled commands in registry order; `'grid'` matches "Switch to grid view"; a subsequence like `'sfg'`/`'tgv'` matches the toggle; a non-subsequence (`'zzz'`) → `[]`; a contiguous match outranks a scattered one; disabled commands are excluded.
  - `buildCommands` with a stub `PaletteContext`: the five groups appear; `restart-focused.enabled()` is false when `focusedSessionId` is null; no switch entries when `projects` is empty; a focus entry's `enabled()` is false for the already-focused id.

**Runtime script (screenshot each step):**
1. `npm run dev` → focus a terminal pane (click into it), then press **Ctrl+K** → the palette opens over the live terminal. **Report** whether the window capture listener sufficed or `attachCustomKeyEventHandler` was needed (D4).
2. Type `cod` (or part of a pane's title) → the "Focus … Codex …" entry surfaces via fuzzy match; ↑/↓ moves the highlight; Enter focuses that session (filmstrip re-renders; `pane_layouts` unchanged).
3. Ctrl+K → run **Launch agent…** → the launch dialog opens.
4. Ctrl+K → run a **Switch to `<project>`** entry (with ≥2 projects) → the other tab activates.
5. Ctrl+K → run **Switch to grid view** / **Switch to filmstrip view** → the mode flips (and persists per 1b-2).
6. Ctrl+K → run **Restart focused session** → the focused session restarts with a fresh TUI (via the existing restart path; `running` written only after spawn success). Confirm the exit was awaited (no "still running" rejection in the log).
7. **Empty-state safety:** with no sessions, open the palette → no focus entries, "Restart focused session" is absent/disabled, no crash. With a single project, no switch entries appear.
8. **Esc** closes; clicking a row runs and closes; after closing, keyboard focus returns cleanly to the app (typing into a terminal works again — the palette did not leave a trap or a stuck listener).

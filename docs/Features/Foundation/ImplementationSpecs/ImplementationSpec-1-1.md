# ImplementationSpec 1-1 — Tailwind Adoption + Session Lifecycle UI

Companion to `docs/Features/Foundation/Tasks/Task-1-1.md`. This spec pins exact insertion points (anchored to the verified 2026-07-18 line numbers), exact shapes where determinable, and the runtime verification that must pass. Where the ecosystem moves fast (Tailwind v4 install), it directs the implementer to verify live rather than hardcode.

## 1. IPC contract — `src/shared/ipc.ts`

**Anchor:** the `IpcChannel` object at lines 10–25 (existing members include `session:attach` line 12, `cli:detect` line 22, `layout:get` line 24) and the schema block that begins with `agentKindSchema` line 31.

Add the channel member alongside the existing session channels, matching their string-literal style:

```ts
// inside the IpcChannel object (lines 10–25), grouped with the other session:* members
SessionKill: 'session:kill',
```

Add the request schema in the exported-schema region (near the other session request schemas — keep it with its peers):

```ts
export const killRequestSchema = z.object({
  sessionId: z.string().min(1),
});
export type KillRequest = z.infer<typeof killRequestSchema>;
```

**Invariant (D1):** this file exports the schema and never calls `.parse()`. `shared/` is imported by preload and renderer, both under the no-eval CSP where `.parse()` throws `EvalError`. Export only.

## 2. Main handler — `src/main/ipc.ts`

**Anchor:** the existing `ipcMain.handle(IpcChannel.SessionAttach, ...)` registrations where the shared schemas are `.parse()`d. Copy that exact pattern.

```ts
ipcMain.handle(IpcChannel.SessionKill, (_event, payload) => {
  const { sessionId } = killRequestSchema.parse(payload);
  sessions.kill(sessionId);
});
```

**Rationale for placement:** this is the *only* module allowed to `.parse()`. Registering here keeps validation in main and mirrors the write/resize handlers so the boundary is uniform. Import `killRequestSchema` from `../shared/ipc` alongside the existing schema imports.

## 3. SessionManager — `src/main/services/sessionManager.ts`

**Anchor:** insert the new method immediately after the `attach(agent, cwd)` block that ends around line 43, keeping it adjacent to the write/resize methods (before `getAgent` at line 71). It operates on the same `private sessions = new Map<string, PtySession>()` (line 38).

```ts
/** Kill a live session by id. State transition is handled by the existing
 *  onExit handler — do NOT mutate status here. No-op if already exited. */
kill(sessionId: string): void {
  const session = this.sessions.get(sessionId);
  if (!session) return;
  if (session.status === 'exited') return; // guard: idempotent
  session.pty.kill();
}
```

**Invariants:**
- `kill()` performs no state mutation and emits no `session:exit`. The PTY's existing `onExit` (wired in `spawn`, line 100) is the single writer of status + exit emission. Two writers would race the renderer's exit filtering.
- Idempotent: calling kill twice, or on an already-exited session, is a safe no-op.

**Windows process-tree caveat (critical).** `codex` is launched through `resolveCli(agent)` which resolves to `codex.cmd`, spawned via ConPTY (`useConpty: true`, line 100) under `cmd.exe /c`. `pty.kill()` must terminate the whole tree — cmd.exe **and** its child. Verify at runtime (§7) that no orphan survives. If ConPTY leaves an orphan, escalate to a tree kill (`taskkill /PID <pid> /T /F`) in `kill()` using the pty's pid — but only adopt that if the plain `pty.kill()` runtime check shows a survivor. Do not pre-emptively add `taskkill`; verify first.

## 4. Preload forwarder — `src/preload/index.ts`

**Anchor:** the existing Zod-free forwarders (`attachSession`, `writeSession`, `resizeSession`, …) in the `chorusApi` object. Add one entry in the same style:

```ts
killSession: (sessionId: string): Promise<void> =>
  ipcRenderer.invoke(IpcChannel.SessionKill, { sessionId }),
```

**No `.d.ts` edit needed:** `ChorusApi` is `typeof chorusApi` — the renderer's `window.chorus.killSession` types itself once the entry exists.

**Invariant:** preload stays Zod-free (no `.parse()`); it forwards the raw object, main validates.

## 5. Session store — `src/renderer/src/stores/session.ts`

**Anchor:** the `sessions: Record<AgentKind, PaneSessionState>` state (lines 16–17). Extend `PaneSessionState` (or its consumers) so each pane exposes:

- a derived `status`: `'running' | 'exited-ok' | 'exited-error'` computed from the existing exit event (exit code 0 → ok, non-zero → error) already flowing through `onSessionExit`;
- a `busy` flag set true when a kill/restart is in flight and cleared when the next attach's data/exit event resolves, used to disable the header buttons.

Keep the store keyed by `AgentKind` for this task — rekeying by sessionId is explicitly Task 1-2's job. Do not change the key shape here.

## 6. Pane chrome — `src/renderer/src/components/TerminalPane.vue`

**Anchor:** `defineProps<{agent: AgentKind}>()` line 9; attach at line 44 via `attachSession(props.agent)`. Add the header above the xterm mount element.

Markup sketch (Tailwind; final classes per the verified v4 utilities):

```vue
<div class="flex items-center justify-between h-8 px-2 bg-neutral-900 border-b border-neutral-800 select-none">
  <div class="flex items-center gap-2">
    <span
      class="inline-block h-2 w-2 rounded-full"
      :class="{
        'bg-green-500': status === 'running',
        'bg-neutral-500': status === 'exited-ok',
        'bg-red-500': status === 'exited-error',
      }"
    />
    <span class="text-xs font-medium text-neutral-200">{{ agent }}</span>
  </div>
  <div class="flex items-center gap-1">
    <button
      class="text-xs px-2 py-0.5 rounded hover:bg-neutral-700 disabled:opacity-40"
      :disabled="busy"
      @click="onRestart"
    >Restart</button>
    <button
      class="text-xs px-2 py-0.5 rounded hover:bg-red-700 disabled:opacity-40"
      :disabled="busy || status !== 'running'"
      @click="onKill"
    >Kill</button>
  </div>
</div>
```

**Kill handler:**

```ts
async function onKill() {
  if (!sessionId.value) return;
  await window.chorus.killSession(sessionId.value);
  // no local state change — wait for onSessionExit to flip status
}
```

**Restart handler (race guard is load-bearing):**

```ts
async function onRestart() {
  busy.value = true;
  if (sessionId.value && status.value === 'running') {
    const exited = waitForExit(sessionId.value); // resolves on onSessionExit
    await window.chorus.killSession(sessionId.value);
    await exited;                                 // MUST await exit
  }
  await attach();                                 // attach() respawns only when exited
  busy.value = false;
}
```

**Rationale:** `attach(agent, cwd)` (SessionManager line 43) respawns only when the current session for that agent kind has exited. Attaching before the exit event lands would either hit the still-live session or race the respawn. Awaiting the exit event closes that window. `waitForExit` is a thin promise over the existing `onSessionExit` listener filtered to the current sessionId.

**Layout note:** the xterm host must keep filling the remaining space under the 32px header. Give the header a fixed height and let the terminal container flex; re-run `fit()` after the header is added so the initial size accounts for the reduced height. Do **not** touch the ResizeObserver → immediate `resizeSession` behavior — debounce is Task 1-3's change.

## 7. `App.vue` — remove the bottom banner

**Anchor:** `panes = ref<Pane[]>([])` line 11; `v-for` at line 22; the per-agent exit banner below it. Delete the banner block and any now-unused banner state. The split stays fixed 50/50 flexbox — do not introduce a tree or renderer here. Convert only the styles inside the blocks you edited to Tailwind.

## 8. Tailwind install (verify live — do not hardcode)

Per D4-style discipline, confirm the **current** Tailwind v4 + Vite setup from Tailwind's own docs at execution time. As of this writing the v4 shape is:

1. `npm i -D tailwindcss @tailwindcss/vite` (confirm package names/versions against docs).
2. Add the plugin to the **renderer** Vite config (electron-vite's renderer target), not main/preload.
3. Add `@import "tailwindcss";` at the top of the renderer's global CSS entry, imported by the renderer bootstrap.
4. Verify a utility class (e.g. `text-red-500`) renders in the running app before building the pane chrome.

If the docs show a changed method (e.g. a different plugin name or a PostCSS-based path), follow the docs — this list is a pointer, not the authority. D8 sanctions the dependency; no approval needed.

**D2 note:** if the install re-fetches better-sqlite3 and the app then fails to load the native module, run `npm run rebuild:better-sqlite3`. Never `electron-rebuild`.

## 9. Verification

**Static:**

```
npm run typecheck
```
Zero errors across `typecheck:node` and `typecheck:web`.

**Runtime (drive the app — required, not optional):**

```
npm run dev
```

1. App renders with Tailwind active; header bars show on both panes; no bottom banner remains.
2. Both dots start green with live Claude Code and Codex TUIs streaming.
3. Click **Kill** on the Codex pane → process ends, dot turns gray (code 0) or red (non-zero), exit toast is logged (OS toast blocked on this machine: `ToastEnabled=0` — the log line / in-app signal is the pass condition).
4. Click **Restart** on a pane → the TUI tears down, then a fresh TUI attaches for the same agent+cwd. Confirm no attach fired before the exit event (dot briefly non-green, then green again).
5. **Process-tree teardown.** With the app up, in a separate shell:

```
tasklist | findstr /i "claude cmd"
```
Run before and after clicking **Kill** on the Claude pane. The claude/cmd rows present before must be absent after. A survivor means the ConPTY tree kill is incomplete — apply the `taskkill /T /F` escalation from §3 and re-verify.

**Commit:** exactly one narrated commit for this session. Do not stage or revert files outside the Task 1-1 scope, including untracked docs under `docs/` and `CouncilBriefs/`.

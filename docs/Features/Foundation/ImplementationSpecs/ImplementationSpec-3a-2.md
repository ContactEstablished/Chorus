# Implementation Spec 3a-2 — Attention Capture (Focus + Idle)

_Companion to `Tasks/Task-3a-2.md`. The task doc governs **scope**; this doc governs **exact contents, insertion points, and rationale**. Code blocks are starting points to adapt to the surrounding file's conventions — not byte-for-byte mandates — **except** where marked **EXACT**._

**Anchored to commit `15a016e`, verified 2026-07-24** (baseline re-run this session: typecheck 0 · **273 passed / 14 files** · `grep:secrets` clean). **Re-anchor against Task 3a-1's commit before starting** — 3a-1 owns migration v7 and the table this task writes into, and its shipped DDL, not this doc's column names, is the authority.

Insertion points are named by **symbol**, never by line number (standing house rule).

---

## 1. What §5.3 actually asks for, and what it is silent about

The source clauses, verbatim from `docs/Features/Mission Control/chorus-mission-control-spec.md` §5.3:

> - Track which pane holds focus and for how long, via Electron `BrowserWindow` focus events plus per-pane active state in the renderer.
> - Discount away-from-keyboard time using `powerMonitor.getSystemIdleTime()`; anything over a 60-second idle threshold does not count.
> - Attribute focused, non-idle time to whichever task that pane is running.
> - Time spent in Chorus but not in any agent pane (reviewing the board, reading diffs) is attributed to a per-project overhead bucket, not to a task.
>
> On task completion, show the measured number with a one-tap correction control. Do not ask the user to run a timer — that is the failure mode this is designed to avoid.

Four things the clauses do **not** settle, each of which decides whether the resulting number is trustworthy. This spec settles all four rather than deferring them, because every one of them is cheap to decide now and expensive to change once three weeks of data exist in the shape the first decision implied.

1. **Sampling or intervals** — §2 below. Decided on crash-safety.
2. **The boundary of "focused on a pane"** — §3. Decided by an exhaustive state table, because the states are genuinely different and blur/minimize/settings/overlay all look like "not focused" from a distance while meaning different things.
3. **What idle can and cannot see** — §5. Decided by naming the bias direction in the data.
4. **Who pays for the clock** — §4. Decided by the 1b-2 shared-clock rule.

**One clause is deliberately deferred**: the one-tap correction control. Chorus has no task-completion moment to hang it on — no tasks, no dispatch outcomes, no completion surface — so building it here means building a fake screen to demo it against, which the Task 3-4 precedent bars ("do not ship dead UI"). What this task owes it instead is a shape that makes it **purely additive**: `source='measured'` on every row this task writes, so a later `source='correction'` row is a new fact rather than an edit, and the measured value survives forever alongside its correction. That preserved pair is itself valuable — *"% of attention hand-corrected"* is the honesty metric for this subsystem, exactly as *"% of spend attributed"* (D42) is for the cost subsystem.

---

## 2. Sampling vs. intervals — the ruling, and the arithmetic behind it

### The failure mode being designed against is real and recent

Chorus gets tree-killed. `taskkill /PID <root> /T /F` is the standing harness practice recorded in every phase overview's harness caveats, the Phase 2 milestone drove exactly that, and a dev-loop crash or a hard reboot produces the same shape. **A design that persists a duration only on a clean stop loses everything since the last stop.**

Two candidate designs:

| | **Interval records** (write on focus-in / focus-out) | **Periodic sampling** (write on a tick) |
|---|---|---|
| Rows per day | ~hundreds | ~5,700 at 15 s, if written naively one-per-tick |
| Worst-case loss on tree-kill | **the whole open interval — unbounded**; an hour of uninterrupted focused work is one interval | **one tick** |
| Sleep / suspend behaviour | credits the whole sleep as focused time unless separately handled | credits nothing, structurally |
| Denominator for honesty | must be reconstructed | **is the stored value** |

The interval design's failure is not a small one. The single longest interval is, by definition, the deepest work session of the day — the one the estimator most needs and the one a crash is most likely to interrupt (long sessions have more exposure).

### **Ruling: sampled runs — sampling semantics, run-length storage.**

A single `setInterval` fires every **`TICK_SECONDS = 15`**. On each firing the tracker computes the current *slot* (`projectId`, `sessionId`, `class`) and either:

- **extends** the open span — `UPDATE attention_spans SET ended_at = <now>, seconds = seconds + 15 WHERE id = ?` — when the slot is unchanged, or
- **closes** it and **inserts** a new span when the slot changed.

(3a-1's `attention_spans` stores **`seconds`**, not a tick count; the two are the same fact in different units — `samples = seconds / TICK_SECONDS` — and this doc says "samples" wherever the *count* is the clearer way to reason. **Never derive credited time from `ended_at - started_at`**: that divergence is the coverage signal, not the number. See the task doc's Dependencies for the two-column finding raised against 3a-1's draft — `class` and `tick_seconds`.)

This gets both properties at once:

- **Crash-safety of sampling.** Every tick durably advances `ended_at` and `samples`. A tree-kill at any instant loses **at most 15 seconds**, and that bound is independent of how long the user has been focused.
- **Compactness of intervals.** Rows are created on *classification change*, not on every tick — a realistic day produces a few hundred rows, not six thousand.

**Worst-case data loss: 15 seconds.** State that figure in the module header; it is the design's headline property and the reason the cadence is what it is.

### Why 15 seconds specifically

- It must **divide the 60 s idle threshold evenly**, so the idle boundary lands on a tick and not between two.
- One tick must be **below the smallest unit any consumer will care about** — the output is measured in minutes, so a 15 s worst-case loss is under a quarter of the display unit.
- It is **15× cheaper than the naive one-second timer** the task doc bars, and a single in-process SQLite `UPDATE` of one small row costs tens of microseconds — four times a minute, this is not measurable.

**Do not make the cadence configurable at runtime.** Ideally `tick_seconds` is recorded **per row** so a future cadence change is visible in the data rather than silently rewriting the meaning of historical rows — that is one of the two columns raised against 3a-1 (task doc, Dependencies). **If 3a-1 declines it, the cadence becomes a hard constant that may not change without a migration**, and the module header must say so in those words rather than leaving a future contributor to discover it. Either way the read helper sums per row, never `samples × currentCadence` applied globally.

### The rule that makes sleep and clock-skew harmless

**Credited time is `samples × tick_seconds`, and is never derived from a wall-clock difference.**

A timer that should fire every 15 s can arrive 10 minutes late — a suspended laptop, a hibernating VM, a wildly loaded machine. If any code path computes `now - lastTick` and adds it, that 10 minutes is credited as focused attention and the day's headline number is fiction. Hence:

```ts
// EXACT — this cap is the whole defence and it is one line.
const elapsedMs = nowMs - run.lastTickMs
const gap = elapsedMs > tickMs * 2
// Credit ONE sample. Never `Math.round(elapsedMs / tickMs)`.
```

The gap flag is not cosmetic: `ended_at - started_at` diverging from `samples × tick_seconds` is precisely the signal that the window has holes in it, and §6's `coverage()` turns that divergence into the number a consumer must display.

---

## 3. `attentionCore.ts` — the pure, Electron-free core

**Precedent, and why it is mandatory rather than tasteful:** `restore.ts` (`computeRestoreSet`) and `vaultCore.ts` are Electron-free, DB-free modules with real unit tests. `vitest.config.ts` states the constraint outright — tests never import `storage.ts` or `better-sqlite3`, because the native binding is built for the Electron ABI (148) while Vitest runs under Node 22 (127), so `new Database()` throws on the first call. **A core that imports Electron or Drizzle is a core with no tests.**

```ts
// src/main/services/attentionCore.ts — NO imports from 'electron',
// 'better-sqlite3', 'drizzle-orm', or '../db/schema'. Time arrives as a
// parameter; this module never calls Date.now().

/** §5.3's mandated threshold, verbatim. Not configurable. */
export const IDLE_THRESHOLD_SECONDS = 60

/** One clock, 15 s. Divides the idle threshold evenly; worst-case loss on a
 *  tree-kill is exactly one tick. See spec §2. */
export const TICK_SECONDS = 15

export type AttentionClass = 'pane' | 'overhead' | 'blurred' | 'idle' | 'locked'

/** Everything classify() is allowed to know. Deliberately a flat bag of
 *  primitives: it is also the exact set of facts the runtime proof has to be
 *  able to force, and anything not here cannot influence the number. */
export interface AttentionInputs {
  /** BrowserWindow.isFocused(), latched from 'focus'/'blur' in main. */
  readonly windowFocused: boolean
  /** BrowserWindow.isMinimized(), latched from 'minimize'/'restore'. */
  readonly windowMinimized: boolean
  /** powerMonitor.getSystemIdleTime() — SECONDS, OS-WIDE. See spec §5. */
  readonly osIdleSeconds: number
  /** Latched from powerMonitor 'lock-screen'/'suspend', cleared on the
   *  matching 'unlock-screen'/'resume'. */
  readonly osLocked: boolean
  /** The active project. null suppresses the row entirely (table row 12). */
  readonly projectId: string | null
  /** RENDERER-REPORTED: the session whose terminal host holds DOM focus, or
   *  null for chrome. NOT viewStore.focusedSessionId — see §3.1. */
  readonly activeSessionId: string | null
  readonly rendererView: 'workspace' | 'settings'
  readonly overlayOpen: boolean
  /** True between a renderer reload and its first report (table row 11). */
  readonly reportStale: boolean
  readonly captureEnabled: boolean
}

export interface AttentionSlot {
  readonly projectId: string
  readonly sessionId: string | null
  readonly cls: AttentionClass
}

/** First match wins. The ORDER IS THE SPECIFICATION — see the task doc's
 *  focus-state table, whose thirteen rows are this function's test cases. */
export function classify(i: AttentionInputs): AttentionClass {
  if (i.osLocked) return 'locked'                                   // rows 1,2
  if (i.osIdleSeconds >= IDLE_THRESHOLD_SECONDS) return 'idle'      // row 3
  if (!i.windowFocused || i.windowMinimized) return 'blurred'       // rows 4,5
  if (i.rendererView === 'settings') return 'overhead'              // row 8
  if (i.overlayOpen) return 'overhead'                              // row 9 (*)
  if (i.reportStale) return 'overhead'                              // row 11
  if (i.activeSessionId === null) return 'overhead'                 // row 7
  return 'pane'                                                     // row 6
}
// (*) The overlay check MUST precede the activeSessionId check. An overlay can
//     be open while a terminal underneath still holds DOM focus, so testing
//     activeSessionId first would credit dialog time to a pane. This is the
//     single easiest ordering mistake in the function and it produces numbers
//     that still look plausible.

/** null when there is nothing to attribute to (no project, capture off). */
export function slotFor(i: AttentionInputs): AttentionSlot | null
export function sameSlot(a: AttentionSlot | null, b: AttentionSlot | null): boolean
```

### 3.1 Why the renderer must report, and why `focusedSessionId` cannot be used

Main cannot see DOM focus, so the renderer half of §5.3's first clause ("plus per-pane active state in the renderer") is unavoidable. The tempting shortcut is the value already persisted — `view_state:<projectId>.focusedSessionId`, read through `StorageService.getViewState` and held by `useViewStore`. **It is the wrong instrument for three separately verified reasons**, and all three were confirmed against `15a016e`:

1. **It survives blur, minimize, and process exit.** It is *designed* to — it tells the filmstrip which pane to render full-size on the next boot. Attention needs an instantaneous fact; this one is deliberately durable.
2. **Grid mode never updates it.** `TerminalPane` emits `focus` from a genuine `terminal.textarea` `'focus'` listener (`onTextareaFocus`), and `FilmstripRenderer` forwards it to `App.vue` → `viewStore.setFocused(id)`. But **`LayoutRenderer` declares `defineEmits<{ split: [target: SplitTarget] }>()` only and binds no `@focus` on its `<TerminalPane>`** — the emit is discarded in grid mode. A tracker reading `focusedSessionId` would attribute an entire grid-mode work session to whichever pane was last focused in the filmstrip, and the resulting numbers would be *confidently wrong*, which is worse than missing.
3. **It is never FK-checked (F4)** and legitimately names a deleted session.

**This is worth flagging as a finding but NOT fixing here** (task Non-Goals): forwarding the emit through `LayoutRenderer` would change what gets *persisted* as the remembered filmstrip pane, which is a behaviour change to a shipped feature and belongs in its own commit.

The mechanism used instead is a **DOM-focus walk**, which is mode-agnostic by construction:

```ts
// App.vue — ONE window listener, capture-phase not required ('focusin'
// bubbles). The house idiom is already here: App.vue runs a capture-phase
// window 'keydown' for Ctrl+K and a window CustomEvent listener for worktree
// notices. Remove on unmount, as both of those do.
function onFocusIn(): void {
  const el = document.activeElement as HTMLElement | null
  const host = el?.closest('[data-attention-session]') as HTMLElement | null
  activeSessionId.value = host?.dataset.attentionSession ?? null
}
```

and in `TerminalPane.vue`, **one attribute** on the **terminal host element** — the div xterm mounts into, *not* the pane card:

```html
<div :data-attention-session="sessionId" class="…terminal host…"></div>
```

**Where the attribute sits is a design decision, not a detail.** On the terminal host, clicking the pane's header buttons or the splitter resolves to `null` → `overhead`, which is what table row 7 rules. On the pane card, every header click would become task attention and the overhead bucket would be nearly empty — a bug that presents as "the numbers are suspiciously clean".

### 3.2 The report survives blur — deliberately

DOM `activeElement` does not change when the OS window loses focus, so the renderer's last report stays *correct* across a blur and needs no re-send on refocus. **This is the clean separation the whole design rests on**: the renderer answers *"which terminal has DOM focus?"* — a fact that legitimately outlives blur — and main answers *"does this window have the OS's keyboard focus right now?"*. Neither is sufficient alone; `classify()` requires both.

The one case where the report genuinely goes stale is a renderer reload (Ctrl+R, HMR): the old DOM is gone and the new one has not mounted. Main clears its report on `webContents` `'did-finish-load'` and sets `reportStale` until the renderer's `onMounted` report arrives — at most a tick or two, classified as `overhead`, which cannot corrupt a per-task number.

---

## 4. `attention.ts` — the Electron seam, and the one clock

**The 1b-2 rule, one process further in.** `FilmstripRenderer.vue` carries it verbatim: _"ONE shared clock at 60 s granularity: every card derives its elapsed label from this single ref — never a per-card or per-second timer."_ Here: **one `setInterval` in main for the entire application.** Panes are not subscribers. The tick reads one snapshot of state and writes at most one row. Ten panes cost exactly what one pane costs, and the runtime proof checks that by row rate rather than by reading the code.

The renderer contributes by **edge-triggered event**, never by polling: a report is sent only when one of the four reported facts changes. On a normal working minute that is a handful of messages, not 240.

```ts
export interface AttentionTracker {
  /** Latched window state, called from createWindow's event wiring. */
  setWindowFocused(v: boolean): void
  setWindowMinimized(v: boolean): void
  /** The renderer's report (already Zod-parsed in the ipc handler). */
  applyReport(r: AttentionReport): void
  markReportStale(): void
  /** A session exited — drop it if it is the one being credited (row 10). */
  onSessionExited(sessionId: string): void
  summary(projectId: string, fromIso: string, toIso: string): AttentionSummary
  /** Flush the open run and clear the interval. */
  dispose(): void
}

export function createAttentionTracker(deps: {
  storage: StorageService
  /** Injected, not imported, so a future test can drive it without Electron. */
  readIdleSeconds: () => number
  now: () => number
  tickMs?: number
}): AttentionTracker
```

`powerMonitor` is reached through the injected `readIdleSeconds` rather than imported into the module body, so the seam stays substitutable; the actual `powerMonitor.getSystemIdleTime` binding happens in `index.ts` where every other Electron singleton is already wired.

**One `powerMonitor` read per tick**, not per pane and not per query. `getSystemIdleTime()` is a cheap syscall (`GetLastInputInfo` on Windows), but four calls a minute is the correct budget for it regardless.

---

## 5. What idle measures — and the sentence that must appear in the code

**Put this in the module header, not only in this doc.** The number this subsystem produces will be read by someone who did not write it, and the failure mode the spec names is a confident-looking figure from an unreliable input.

> `powerMonitor.getSystemIdleTime()` returns **seconds since the last keyboard or mouse input anywhere on the machine**. It is OS-wide. It cannot tell which application received the input, so it can never *confirm* the user was interacting with Chorus — only that they were interacting with *something*. Conjoined with window focus it is a reasonable proxy, and it is the only tractable one available from inside the process. It is not a measurement of attention.

The three consequences, each of which biases the number **downward**, and all of which must be stated where a consumer reads them:

1. **Reading is undercounted, and reading is what review panes produce.** An inactive stretch is credited its first ≤60 s and nothing after. A 20-minute careful read of a diff counts as **one minute**. Four short reads count as four. This is the largest known bias and §7's unit test pins it so it cannot drift silently.
2. **Work done outside the Chorus window is not counted at all.** Reading the same diff in GitKraken, a browser, or an editor reads as `blurred`. §5.3 scopes the overhead bucket to _"time spent in Chorus"_, so this is correct per the spec and wrong per reality — hence `blurred` is **recorded rather than dropped**, so a consumer can see how much of the day happened elsewhere instead of inferring that it did not happen.
3. **Presence is over-trusted in one direction only.** Chorus focused with the mouse being jiggled while attention is on a second monitor counts as attention. There is no signal available from inside the process that distinguishes it.

**Net: the attention figure is a lower bound**, biased against reading-heavy and multi-window work. Say "lower bound" in the code, in the channel's doc comment, and in whatever eventually renders it.

### 5.1 No retro-debit — an explicit ruling on an ambiguous clause

§5.3 says _"anything over a 60-second idle threshold does not count"_, which admits two readings: (a) the excess beyond 60 s does not count, or (b) the entire inactive stretch does not count, retroactively cancelling the first 60 s.

**Ruled: (a). Credit is never revoked once written.** Reasons, in order of weight: retro-debiting means mutating rows already committed, which reintroduces exactly the crash-window the sampled-run design exists to close; the correction would have to reach across run boundaries, so a stretch spanning a focus change becomes ambiguous; and the difference is bounded at 60 s per inactive stretch, which is small next to the reading bias already named in (1) above.

**Consequence, which must be tested rather than assumed:** a 3-minute no-input stretch at a 15 s cadence produces **4 `pane` samples then 8 `idle` samples**. Pin that exact split in a unit test.

---

## 6. Coverage — the denominator, and why it is a field rather than a comment

The roadmap's estimator-honesty rule (_"always surface the sample count"_; §11's first risk row) is usually treated as a display concern. It is not: **if the capture layer does not record the denominator, no later layer can invent it.** A window in which the app was closed for six hours and a window in which the user worked for six hours with 8% attention are indistinguishable from a minutes figure alone.

```ts
export interface AttentionCoverage {
  /** Ticks actually credited, by class. The accounting identity below holds. */
  readonly byClass: Readonly<Record<AttentionClass, number>>
  readonly samples: number          // sum of byClass
  readonly tickSeconds: number
  /** Ticks the sampler SHOULD have produced across the window, from the run
   *  spans. Divergence = the app was not running, or was suspended. */
  readonly expectedSamples: number
  readonly missingSamples: number   // expected - samples, floored at 0
  readonly coveragePct: number      // samples / expected, 0 when expected is 0
}
```

**The accounting identity is the single best correctness check in this task:**

```
byClass.pane + byClass.overhead + byClass.blurred + byClass.idle + byClass.locked === samples
```

Every tick lands in exactly one class; no tick is silently dropped. It is checkable in a unit test, against the real DB after the scripted drive, and at any scale afterwards — and it catches the whole family of "the number looks plausible but something is quietly vanishing" defects, which is the family that matters here because nobody has an independent measurement to notice them against.

**⚠ `byClass` is exactly why the `class` column is a blocker, not a nice-to-have.** 3a-1's drafted `attention_spans` has no `class`, and without it only `pane` and `overhead` spans are representable — the histogram collapses to its numerator, `expectedSamples` has nothing to compare against, and the accounting identity below cannot be evaluated at all. Settle the finding before writing code; do not encode class into `source`, whose two values belong to the correction design.

**`attention:summary` must make the denominator structurally inseparable from the number.** Minutes are *derived from* `samples × tickSeconds`; the response carries `byClass`, `expectedSamples`, and `coveragePct` in the same record. Write the schema so a denominator-less object **fails to parse**, and write the negative test that proves it does. A response shape from which a caller can read `minutes` alone is the Non-Goals bar violated.

---

## 7. Exact insertion points, by symbol

### `src/main/index.ts`

- **In `createWindow`, beside `persistBounds`** — the existing precedent for window-event wiring, already registered on `'resized'`/`'moved'` with the note that they _"fire once after the interaction ends (Windows), so no debounce"_:

  ```ts
  mainWindow.on('focus', () => attention?.setWindowFocused(true))
  mainWindow.on('blur', () => attention?.setWindowFocused(false))
  mainWindow.on('minimize', () => attention?.setWindowMinimized(true))
  mainWindow.on('restore', () => attention?.setWindowMinimized(false))
  mainWindow.webContents.on('did-finish-load', () => attention?.markReportStale())
  ```

  Initialise the latches from `mainWindow.isFocused()` / `isMinimized()` at construction — do not assume a `'focus'` event will arrive before the first tick.

- **Inside `app.whenReady().then(async () => …)`, after `const vault = new CredentialVault(storage)` and before `registerIpc(...)`** — the same slot and the same shape as 3-2's vault construction:

  ```ts
  const attention = createAttentionTracker({
    storage,
    readIdleSeconds: () => powerMonitor.getSystemIdleTime(),
    now: () => Date.now()
  })
  logger.info(`[attention] capture ${attention.enabled ? 'on' : 'off'} · tick ${TICK_SECONDS}s · local-only`)
  ```

  **That is the only log line this subsystem may emit at info level.** No per-tick logging: it would turn the log file into a second, unredacted behavioural record of the operator's day, and it would be four lines a minute forever.

- **`powerMonitor` listeners** alongside it: `'lock-screen'` / `'unlock-screen'` (typed `@platform darwin,win32`) and `'suspend'` / `'resume'`. Latch a single `osLocked` boolean; the `'resume'` path additionally forces the next tick to be treated as a gap.

- **`registerIpc(sessions, storage, worktrees, vault, attention)`** — a fifth positional parameter, exactly as `vault` was added in 3-2.

- **A third `sessions.onExit` listener** (row 10). `exitListeners` is a `Set`, and `index.ts` already registers two independent listeners — `watchSessionExits(sessions)` and the D11 status-persist one — so this is the established idiom, not a new pattern:

  ```ts
  sessions.onExit((sessionId) => attention.onSessionExited(sessionId))
  ```

- **`app.on('before-quit')`** — `attention.dispose()` **before** `storage?.close()`. Dispose flushes the open run; flushing after the DB closes throws.

### `src/main/ipc.ts`

Two `ipcMain.handle` registrations (31 → 33), placed beside the `IpcChannel.ViewGet`/`ViewSet` pair, which is the closest existing model — parse in, `requireProject(...)`, storage/tracker call, outbound `.parse` on the way back:

```ts
ipcMain.handle(IpcChannel.AttentionReport, (_event, payload): void => {
  const req = attentionReportSchema.parse(payload)
  // Deliberately NOT FK-checked, exactly as view:set's focusedSessionId is
  // not (F4): a report can legitimately name a session that main has just
  // seen exit, and a throw here would break the renderer's fire-and-forget.
  attention.applyReport(req)
})

ipcMain.handle(IpcChannel.AttentionSummary, (_event, payload): AttentionSummary => {
  const req = attentionSummaryRequestSchema.parse(payload)
  const p = requireProject(req.project_id)
  return attentionSummaryResponseSchema.parse(attention.summary(p.id, req.from, req.to))
})
```

**The outbound `.parse` is what makes §6's denominator rule structural rather than aspirational** — the same move D33 clause 3 used to make "no key material on the wire" a fact about the code instead of a promise about the author. If a future edit drops `coveragePct` from the returned object, the handler throws rather than shipping a bare number.

### `src/shared/ipc.ts`

Two `IpcChannel` entries (34 → 36) with doc comments in the file's existing style, plus the schemas. `AttentionReport` is **write-only inbound** and returns `void`; note that in its comment as the credential channels do.

### `src/preload/index.ts`

Two typed forwarders. **Zod-free** (D1 — the page CSP forbids the `eval` Zod compiles parsers with; a preload `.parse` throws `EvalError` and silently drops events). `src/preload/index.d.ts` is never hand-edited.

### `src/main/services/storage.ts`

Accessors only — `openAttentionSpan(row)`, `extendAttentionSpan(id, endedAt, seconds)`, `readAttentionSpans(projectId, fromIso, toIso)` — written over 3a-1's `attentionSpans` Drizzle table. Follow the `saveWindowBounds` / `setViewState` inline-Drizzle idiom, including the defensive read that collapses a corrupt row to a default rather than throwing; every settings/state reader in this file already does. Rows are written with `source: 'measured'` (3a-1's vocabulary — `'corrected'` is the other member and belongs to the deferred correction control) and `dispatch_id: null`.

**No `MIGRATIONS` entry. No `schema.ts` table. No v8.** If 3a-1's Drizzle model or a needed column is missing, that is a dependency finding to raise — see the task doc's Dependencies, which already raises `class` and `tick_seconds` against 3a-1's draft DDL.

### `src/renderer/src/App.vue`

- `onFocusIn` registered on `window` in `onMounted`, removed in `onUnmounted` — alongside the two listeners already there.
- One `watch` over `[projectStore.activeId, activeView, anyOverlayOpen, activeSessionId]` calling `shouldReport(prev, next)` and sending only on a real edge.
- One initial report in `onMounted` (so a fresh renderer clears main's `reportStale` immediately).
- **D14**: the report is a fresh object literal built from primitives. `anyOverlayOpen` is a `computed` — read `.value` into a local before building the object; passing the computed itself, or any store-sourced object, hands a Vue proxy to structured clone and fails at **runtime with no compile-time signal**. If any field ever becomes store-sourced it needs `JSON.parse(JSON.stringify(...))`. The `reporter.test.ts` prototype assertion exists to catch this class in CI rather than in a runtime dump.

### `src/renderer/src/components/TerminalPane.vue`

One attribute — `:data-attention-session="sessionId"` on the terminal host div. Nothing else in the file changes.

---

## 8. Privacy and scope — stated once, plainly, in the code

This subsystem records **how long a human being sat in front of a screen**. That deserves an explicit statement rather than an inference from the absence of a network call. Put the following in `attention.ts`'s header and honour every clause:

- **Local-only.** Rows live in `%APPDATA%\chorus\chorus.db`, the same local SQLite the rest of the app uses. The roadmap already fixes this split: _"the plan is shared, the telemetry is personal"_ — actuals are machine-local and gitignored.
- **Nothing leaves the machine.** No `fetch`, no analytics, no telemetry endpoint, no crash-reporter attachment, no sync. Grep-verifiable, and grepped as part of the runtime proof.
- **Nothing is written into any transcript, ring buffer, or PTY.** This task does not touch `sessionOutput.ts`, `scrubber.ts`, or `SessionManager.spawn`'s data path. **An agent must never be able to read the operator's attention record**, and the only way to guarantee that is to keep the two paths from meeting at all.
- **Nothing is logged per tick.** One boot line, naming cadence and enabled state.
- **What is recorded, exhaustively:** a project id, a session id (or null), a class enum, two timestamps, two integers. **What is not, and must not become so:** keystrokes, keystroke timing, window titles of other applications, process names, screenshots, clipboard, or anything about activity outside the Chorus window beyond the single bit "the window did not have focus".
- **An off switch exists** — `attention_capture_enabled` in `settings`, default on, read at boot and honoured live. The tick still fires when it is off (so the setting takes effect without a restart) and writes nothing.
- **⚠ Standing condition:** `credential_profiles` is not read, dumped, echoed, or transmitted by this task, and must not appear in any `_verify/3a-2/` artifact. The real dev vault holds a real, billable key.

---

## 9. Verification — RUNTIME, because none of this compiles into a proof

**⚠ G2 applies with unusual force here.** Every claim this task makes is a claim about *behaviour over time on a real Windows desktop*: that window focus events fire when a user alt-tabs, that `getSystemIdleTime()` climbs while nobody types, that a DOM-focus walk resolves the right pane in grid as well as filmstrip, that a tree-kill loses one tick. **None of it is observable from a type check and none of it is observable from a unit test.** The core's tests prove the arithmetic is right given the inputs; only a driven window proves the inputs are right.

Drive it with the CDP harness the repo already has: `_verify/3-6/cdp35.js` (`eval` with `awaitPromise` + `returnByValue` · `shot` · `typefile` · `enter` · `watch`), against `--remote-debugging-port=9222` started by `_verify/launch.ps1` (which restores `ComSpec` and rebuilds `PATH` from the registry first — the harness strips both). Wrap every `Runtime.evaluate` body in an IIFE; top-level `const` collides across evaluates. Put all artifacts under `_verify/3a-2/`.

### 9.1 ⚠ Step 0 — measure the instrument before measuring with it

**Three unknowns, each of which silently invalidates the whole drive if guessed. Answer all three first and record the answers as facts.**

1. **Does CDP-injected input reset the Windows idle timer?** `Input.insertText` / `Input.dispatchKeyEvent` deliver events into Chromium, not through the OS input stack, so `GetLastInputInfo` — which `getSystemIdleTime()` wraps — **may not observe them at all**. If it does not, every "user is typing" phase driven by CDP classifies as `idle`, every `pane` count reads zero, and the natural conclusion ("attribution is broken") would be wrong. **Probe:** focus the app, drive CDP input every 10 s for 90 s, and sample `getSystemIdleTime()` throughout. If it climbs past 60, CDP input is invisible to the OS timer and **every typing phase below must be driven with real OS input** — the `user32` `SendInput` helper pattern — not CDP. Record the result either way; "I assumed it worked" is not a result.
2. **Independent oracle.** Read the same OS counter from **outside** Electron with a PowerShell `GetLastInputInfo` P/Invoke (`_verify/3a-2/idle.ps1`), and compare against `getSystemIdleTime()` read inside. Agreement is what proves Electron is reporting the OS's counter rather than something it computes about its own window. Disagreement is a finding that changes the design.
3. **Is `'locked'` observable here?** The Electron typings say `getSystemIdleState()`'s `'locked'` is _"available on supported systems only"_. Lock (`rundll32 user32.dll,LockWorkStation`), wait, unlock, read. If it never reports `'locked'`, table row 1 rests on the `'lock-screen'` event alone — a smaller claim, which must then be documented as smaller rather than quietly retained.

### 9.2 The scripted focus/idle sequence — with expected attributed minutes

Boot cold (**electron-vite HMR covers the renderer only; this task's clock is in main, so every timing check needs a real cold boot**). Open **two panes, A and B**, in one project. Note the wall-clock start. Run the phases back to back. At 15 s each 75 s phase is **5 ticks ±1**.

| Phase | Duration | Action | Expected |
|---|---|---|---|
| 1 | 75 s | Focus **A**'s terminal; real input every ~10 s | `pane`/A, **5 ±1** |
| 2 | 75 s | Focus **B**'s terminal; real input every ~10 s | `pane`/B **5 ±1**; A **does not grow** |
| 3 | 75 s | Open **Settings**; keep the machine active | `overhead`, `session_id` NULL, **5 ±1** |
| 4 | 75 s | Focus **another application** and type in it | `blurred` **5 ±1**; A, B, overhead all **frozen** |
| 5 | 180 s | Focus **A**, then touch nothing | `pane`/A **4 ±1**, then `idle` **8 ±1** — the §5.1 proof |
| 6 | 75 s | Repeat phase 1 in **grid** view | identical attribution — the `LayoutRenderer` gap proof (§3.1) |
| 7 | — | `taskkill /PID <root> /T /F` mid-run, then cold boot | open run's `ended_at` within **one tick** of the kill |
| 8 | — | Lock ~60 s, unlock (**run last**) | `locked`, or a recorded "not observable here" |

**Assertions against the dumped rows — quote real numbers, not adjectives:**

- **A ≈ 2.25 min · B ≈ 1.25 min · overhead ≈ 1.25 min**, each within one tick.
- **The accounting identity holds** across the entire drive (§6).
- **Phase 4 froze everything.** The strongest single check in the sequence: blur must move *no* counter except `blurred`.
- **Phase 6 matches phase 1.** If grid attributes to the wrong pane or to overhead, the DOM-focus walk is not doing what §3.1 claims.
- **Phase 7's delta in seconds** is stated explicitly. This is the crash-safety claim; "it looked fine" does not discharge it.
- **`attention:summary`'s full JSON** is dumped and shown internally consistent: `byClass` sums to `samples`, `coveragePct` reflects the phase-7 hole.
- **Cost:** run the same one-minute measurement with 2 panes and with 4 — the tick rate is **identical**. One clock, proven by row rate rather than by reading the code.
- **Privacy sweep:** grep every boot log for a per-tick line, session content, another app's window title, and key material — zero hits; and confirm no network call exists in the new modules.

### 9.3 Test the test

Two checks here would pass whatever the code did unless deliberately falsified, so falsify them once:

- **Temporarily invert the overlay/pane ordering in `classify()`** and confirm the phase-3 overhead assertion goes **red**. A drive that passes with the ordering wrong is a drive that was not measuring attribution.
- **Temporarily change the extend-in-place write to a write-on-transition** and confirm phase 7's delta blows out from ~15 s to the full run length. That is the crash-safety property being *observed* rather than argued.

Revert both, and say so in the commit narration — **the review checks the commit diff, not the worktree** (the Task 2-4 instrumentation precedent).

### 9.4 Dump discipline

**⚠ The `sqlite3` CLI is NOT installed.** Use the `ELECTRON_RUN_AS_NODE` pattern (`_verify/2-1-dump.js`, `_verify/3-6/dump-v6.js`): these scripts print nothing to a console, so write results to a file, and **known flake — no file on the first invocation; retry once**. **Quote the `projects` table in every dump (F20)**: execution sessions run with a redirected `AppData` but a real `C:\Projects`, so their filesystem evidence is trustworthy while their **database** evidence may describe a different DB — the coordinator re-verifies against the real `%APPDATA%\chorus\chorus.db`, exactly as 3-2's v5 and 3-6's v6 had to be re-driven. **Never dump `credential_profiles`.**

---

## 10. Known limits, to be stated rather than implied

Recorded here so the review can check they were *stated*, not silently inherited. Every one of them is a property of the design, not a defect in the implementation:

1. **The number is a lower bound**, biased against reading-heavy and multi-window work (§5).
2. **A 20-minute uninterrupted read counts as one minute** (§5.1). Largest known bias; pinned by test.
3. **Work outside the Chorus window is invisible** and lands in `blurred`, per §5.3's own scoping of the overhead bucket to "time in Chorus".
4. **Presence is over-trusted in one direction**: a focused window with idle input activity counts, whatever the human is actually looking at.
5. **Reading a dead pane's scrollback is charged to overhead, not the task** (table row 10) — deliberate, to stop a closed dispatch's cost growing after it ended.
6. **Worst-case data loss is 15 seconds**, by construction (§2).
7. **The spec's own §10 Q3 is not answered by this task** — _"Is focus-plus-idle a good enough attention proxy, or is explicit start/stop needed?"_ It is answered by **weeks of the data this task starts collecting**, which is the whole reason D50 sequenced it first. Building the capture is the experiment; the coverage figures and the eventual correction rate are its readout. **Do not let the number acquire authority before that readout exists** — which is what §6's denominator rule enforces mechanically.

# Implementation Spec 4-4 — OS Delivery: Toast → Focus-Pane + Tray Badge

_Governs exact contents. `Tasks/Task-4-4.md` governs scope. Measured against `main` at `00f0f0d`; **re-read every line number before editing.**_

---

## 0. Read this before writing any Electron call

**Two of the three APIs this task needs behave differently by platform, and this app is Windows-only v1.** CLAUDE.md's D4 rule — *verify current flags against the tool's own docs; don't trust training-data memory* — is written about CLI flags and applies here for the identical reason.

| Need | Do not assume | Verify |
|---|---|---|
| a count on the taskbar | `app.setBadgeCount()` — **documented as macOS/Linux** | whether Electron 43 supports it on Windows at all; the Windows affordance is `BrowserWindow.setOverlayIcon(image, description)`, which takes a **generated image**, not a number |
| a tray icon | that any icon path works | `resources/icon.ico` and `icon.png` exist; a tray icon has its own size expectations |
| the toast | that `Notification.isSupported()` returning true means a toast appears | it returns **true on this machine and nothing appears** — `ToastEnabled=0`, `HRESULT: -2143420140` |

**Whichever you use, state it in the commit with what you observed.** A badge that silently does nothing is this phase's existing failure mode repeating itself one layer down.

---

## 1. `src/main/services/notifications.ts` — the file's first edit since Phase 0

### 1.1 The signature gains its dependencies

Today: `watchSessionExits(sessions: SessionManager)`. It needs the policy and the attended-session read, and **both are injected rather than imported as singletons** — the `AttentionTrackerDeps` idiom at `attention.ts:129`, whose own comment says why: *"INJECTED, not imported, so the seam stays substitutable and the module body holds no Electron reference."* That is what makes Test Expectation 2 possible at all.

```ts
export interface NotificationDeps {
  sessions: SessionManager
  attendedSessionId: () => string | null
  /** Raise and focus the window, then put DOM focus on this session's
   *  terminal. See §3 — main can do the first half alone and cannot do the
   *  second. */
  focusSession: (sessionId: string) => void
}
```

### 1.2 Obey the policy

Inside the `onExit` listener, before constructing anything:

```ts
    const verdict = decide({
      event: { kind: 'exit', sessionId, exitCode },
      attendedSessionId: deps.attendedSessionId()
    })
    if (!verdict.notify) return
```

> **⚠ THIS IS A NARROWING OF SHIPPED BEHAVIOUR AND IT IS USER-VISIBLE.** `:24` currently toasts **every** exit. After this, closing a pane normally produces nothing. Intended (PLAN.md:200 says "failed", not "exited"), and it goes in the commit message rather than being discovered as a missing notification.
>
> **⚠ AND D143(b) IS THIS FILE'S OWN PRIOR DEFECT.** A resume-failure relaunch fires the exit fan-out, and the run before D143(b)'s fix logged `[notify] toast shown: Claude Code exited (1)` for a session that came straight back. **Route through the existing suppression seam** — `dispatches.ts:155` reads `sessions.wasKilledByChorus(sessionId)`; follow whatever that seam looks like at the moment you write this. **Do not add a second mechanism.**

### 1.3 Keep the two log lines exactly as they are

`:34–35` are **instruments, not debug output**. Task 4a-3 used them to prove a fan-out was suppressed, and this task's own Acceptance 4 and 6 depend on them. Keep the wording; a grep for `[notify]` must keep working.

### 1.4 The click handler — the actual feature

`:36` today does `win.show(); win.focus()` and stops. PLAN.md:200 says *"click focuses the exact pane"*.

```ts
    toast.on('click', () => {
      const win = BrowserWindow.getAllWindows()[0]
      if (!win) return
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      // ⚠ THE PANE HALF, WHICH MAIN CANNOT DO ALONE. Raising the window is an
      // OS operation; moving DOM focus to one terminal is a renderer one.
      deps.focusSession(sessionId)
    })
```

The `sessionId` is already in scope from the listener — **no lookup, no map, nothing to go stale.**

---

## 2. `src/main/services/trayBadge.ts` — new

### 2.1 Split the pure part out, because the impure part cannot be tested here

```ts
/** The tooltip / overlay description for a waiting count.
 *  ⚠ ZERO CLEARS RATHER THAN RENDERING "0" — a badge showing zero is a badge
 *  the eye learns to ignore, and the absence of a marker is the clearer signal
 *  (the same argument attentionRollup.ts:70 makes for projects with nothing to
 *  report being ABSENT from the roll-up rather than present with a null state). */
export function badgeText(waiting: number): string | null {
  if (waiting <= 0) return null
  return waiting === 1 ? '1 session needs you' : `${waiting} sessions need you`
}
```

Tested at 0, 1, 2 and a large value.

### 2.2 The count's source is the Inbox, not a new derivation

The waiting count is **`inboxList.items.length`** — Task 4-2's `buildInbox` already applies all three exclusions (not-running, no-hook-bus, not-waiting). **Deriving it again here would be a second rule that starts agreeing and stops.** Subscribe to the same recompute that pushes `inbox:changed`.

> **⚠ THE COUNT IS THE INBOX'S, NOT THE CENTRE'S, AND THE DIFFERENCE IS THE WHOLE POINT.** The centre is a log of what fired; the Inbox is what needs you *now*. A badge counting the centre would only ever climb.

### 2.3 Holding the Tray

```ts
// ⚠ MODULE OR CLASS SCOPE, NEVER A LOCAL. An Electron Tray that loses its last
// JS reference is garbage-collected and the icon disappears from the taskbar
// with no error anywhere — a failure that looks exactly like "the feature was
// never built".
let tray: Tray | null = null
```

Dispose on `before-quit` alongside the existing teardown in `index.ts`.

---

## 3. Focusing a pane from main — resolve by reading, not by assuming

**Main cannot move DOM focus.** The renderer already has the operation: `App.vue:650` exposes `focusSession: (id) => viewStore.setFocused(id)`.

**Before adding a channel, grep for one that already carries "focus this session" from main to the renderer.** If it exists, use it — `IpcChannel` stays at 91.

If it does not, one channel is justified:

```ts
  /** event (main -> renderer): bring this session's pane to DOM focus.
   *  Fired when the user clicks a notification. */
  SessionFocusRequest: 'session:focus-request',
```

…and then **`IpcChannel` moves 91 → 92 and BOTH assertions in `ipc.test.ts` (3438, 3816) move with it.** Re-read the figure from the merged tree first (G6/F54 — this counter has collided four times).

**⚠ `viewStore.setFocused` IS THE RIGHT CALL HERE AND THE WRONG ONE IN TASK 4-3, AND BOTH ARE TRUE AT ONCE.** `reporter.ts:11` records that `focusedSessionId` is the wrong instrument for *measuring* attention — it survives blur, grid mode never updates it, and it can name a deleted session. **Setting** it to move focus is its actual job. Reading it to decide whether someone is looking is not. Do not "fix" one to match the other.

---

## 4. `src/main/index.ts`

Construct the badge beside the existing window wiring, and pass `notifications` its new deps — the `attendedSessionId` accessor from Task 4-3's `attention.ts`, and the focus dispatcher from §3. **The window is already created at `:145` and `:303` with `icon: appIcon`; reuse `appIcon`'s resolution rather than re-resolving a path.**

---

## 5. Verification

### Build gates

```bash
npm run typecheck        # 0, node + web
npm test                 # no regression
npm run grep:secrets     # clean
grep -c "sqliteTable(" src/main/db/schema.ts       # 18
grep -n "toHaveLength(" src/shared/ipc.test.ts     # 91 or 92 — BOTH sites agree
```

### Runtime — real app, throwaway `--user-data-dir`, never `%APPDATA%\chorus-app`

**⚠ THE TWO HALVES HAVE DIFFERENT KINDS OF EVIDENCE AND MUST NOT BE REPORTED AS ONE.**

**Observed (the tray badge — this genuinely works here):**

1. Two sessions waiting → the count reads **2**. Screenshot.
2. Answer one → **1**. Answer the last → **cleared**, not "0". Screenshot each.
3. The icon is **still there** after five minutes and after a minimise/restore cycle (the §2.3 GC failure).

**Log-asserted (the toast — `ToastEnabled=0` here):**

4. A failing session on an **unfocused** pane logs `[notify] toast shown: …` then `[notify] toast failed: … HRESULT: -2143420140`. **Both lines quoted. This is a PASS:** the code path ran and the OS refused.
5. **The narrowing, both directions.** Close a pane normally → **no `[notify]` line at all**. Kill one with a non-zero code → the two lines from (4). *The absence is the evidence, so show the log region, not just the presence.*
6. **D143(b).** Force a resume failure so the automatic relaunch fires the fan-out → **no `[notify]` line**. Same before/after shape D143(b) itself was proven with.
7. **Focused-pane suppression.** Same failing session, this time on the pane holding focus → **no `[notify]` line**.

**Named-as-unverified (the click path):**

8. The toast cannot be clicked on this machine. **Either** invoke the click handler directly and show the pane took DOM focus (CDP-assert `document.activeElement`'s owning session), **or** state plainly which line is untested and why.
   > **⚠ DO NOT CLAIM IT WORKS BECAUSE THE CODE READS CORRECTLY.** F66 exists in this repo because two adapter classifiers looked right, matched **nothing** against real terminal bytes, and would have shipped an entire recovery path as dead code. The honest sentence is cheap; the false green is not.

Evidence under `_verify/4-4/`.

### Phase close

Re-run `Phase-4-Overview.md` §9 and write the pass into roadmap §5, **superseding** the `00f0f0d` block rather than editing it (the house convention — every prior pass is kept for the trail). State whether the milestone — *"agent attention events reliably surface in-app regardless of OS toast state"* — is met. **It is an in-app claim and the in-app half is fully verifiable here**, so answer it without hedging, and record separately that OS toast delivery remains blocked by machine configuration rather than by code.

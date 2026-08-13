# Implementation Spec 4a-4 — Scrollback Mirrored To Disk

_Governs exact contents for `Tasks/Task-4a-4.md`._

## 1. Verified starting state (`82e16d7`, 2026-08-12)

| Symbol | Line | Current |
|---|---|---|
| `createSessionOutput` | `sessionOutput.ts:44` | takes `{secrets, maxChars, flushMs, onText}` |
| the single emit path | `sessionOutput.ts:57` | `const emit = (text) => { if (!text.length) return; buffer += text; if (buffer.length > opts.maxChars) buffer = buffer.slice(...) }` |
| the five invariants | `sessionOutput.ts:18–30` | header comment — **read them before editing** |
| construction | `sessionManager.ts:618` | `createSessionOutput({secrets, maxChars: BUFFER_MAX_CHARS, flushMs: SCRUB_FLUSH_MS, onText})` |
| `BUFFER_MAX_CHARS` | `sessionManager.ts:25` | `4_000_000` |
| `SCRUB_FLUSH_MS` | `sessionManager.ts:32` | `50` |
| replay | `sessionManager.ts:519` | `buffer: session.output.buffer` inside `snapshot()` |

## 2. The one structural rule

**The disk write is a third consumer of the string the existing `emit` already computed.**

`sessionOutput.ts`'s invariant 1 is explicit: *one* `scrubber.push()` per chunk, and its single result feeds both the ring buffer and the broadcast. Two calls advance the scrubber's carry twice and corrupt the stream — and worse, a second call site is how unredacted text reaches a new destination. That is F26's exact shape, and D45(1) exists because of it.

So: add **one optional sink** to the options object, and call it from inside `emit`, next to the two consumers already there.

```ts
export function createSessionOutput(opts: {
  readonly secrets: readonly string[]
  readonly maxChars: number
  readonly flushMs: number
  readonly onText: (text: string) => void
  /**
   * Phase 4a / D141: mirror to disk. Receives EXACTLY the string `onText`
   * receives — post-scrub, computed once, from the single emit path.
   *
   * ⚠ IT IS AN OPTION ON THIS OBJECT RATHER THAN A SUBSCRIPTION ELSEWHERE,
   * AND THAT IS THE POINT. D45(1): scrubbing is a property of "a session emits
   * text". A sink wired anywhere else would be a second place for a future
   * change to forget the scrubber, which is precisely the F26 failure. There
   * is one emit path; every consumer hangs off it.
   *
   * ⚠ MUST NOT THROW AND MUST NOT BLOCK. It runs on the PTY data path at
   * `flushMs` cadence, per pane. Swallow inside the implementation.
   */
  readonly onPersist?: (text: string) => void
}): SessionOutput
```

Inside `emit`, after the existing buffer append and before/beside the `onText` fan-out:

```ts
    opts.onPersist?.(text)
```

Nothing else in `sessionOutput.ts` changes. **The five invariants must still hold verbatim afterwards** — in particular invariant 4 (the timer is cleared on `flush()` and in `dispose()`), because the sink must also be released in `dispose()` if it holds any handle.

## 3. `scrollbackCore.ts` — the pure half

```ts
/** The head-truncation rule, extracted so it is testable without fs and so it
 *  provably matches the in-memory ring buffer's own rule at
 *  sessionOutput.ts:60–61. Two caps that drift is a bug nobody would see. */
export function capTail(existing: string, incoming: string, maxChars: number): string

/** What a restored pane should be seeded with, given what is on disk. */
export function planReplay(fileContents: string, maxChars: number): string
```

Cap: **4,000,000 characters**, deliberately equal to `BUFFER_MAX_CHARS`. Define it once and import it, or assert equality in a test — *"the file holds what the buffer would have held"* is the contract, and two independently-maintained constants will not stay equal.

## 4. `scrollbackStore.ts` — the impure half

Directory: `join(app.getPath('userData'), 'scrollback')`, created on demand.

> **⚠ `userData`, NEVER `TEMP` AND NEVER THE PROJECT DIRECTORY.** This file is a plaintext record of the user's work. It gets the same location and therefore the same OS protection as `chorus.db`. A file in a project directory eventually gets committed by an agent that was told to `git add -A`.

File name: `${sessionId}.log`.

```ts
/** ⚠ EXPLICIT, NOT IMPLIED. Row ids are randomUUID() today (ipc.ts:1373), so
 *  this guard is currently unreachable — which is exactly why it must be
 *  written down rather than assumed. The day a session id comes from anywhere
 *  else, `../../` must already be refused. */
function safeName(sessionId: string): string | null   // null => refuse, do not write
```

Operations:

| Op | Contract |
|---|---|
| `append(sessionId, text)` | Asynchronous, fire-and-forget, **never throws**. Serialise per session so two appends cannot interleave mid-chunk. |
| `readTail(sessionId)` | Returns `''` for missing, unreadable, or locked. **Never throws.** |
| `remove(sessionId)` | Deletes; a missing file is a no-op. |
| `pruneOrphans(liveSessionIds)` | Boot-time sweep: delete every `.log` whose id is not a live row. |

**No `fsync`, no `writeFileSync`.** A dropped tail on a hard crash costs a fraction of a second of *display text*; the agent's own transcript — the thing that actually matters — is written by the agent, not by Chorus.

Enforce the cap without rewriting a 4 MB file every 50 ms: append normally, and only when the file exceeds the cap by a **slack margin** (e.g. 25%) rewrite it to the capped tail. Amortised, the rewrite is rare. Naive re-truncation on every append would be a 4 MB write twenty times a second per pane.

## 5. `sessionManager.ts` — the wiring

Three edits:

1. **Construct the store** alongside the other services and hold it on the manager.
2. **Pass the sink** at `:618`:
   ```ts
   onPersist: (text) => this.scrollback?.append(id, text)
   ```
   Nothing else in that call changes.
3. **Seed the replay buffer on restore.** `attach()` (`:251`) returns `snapshot()`, which reads `session.output.buffer` (`:519`). For a session relaunched by `restore()`, that buffer starts empty. Seed it from `readTail(sessionId)` at construction so the first attach replays history.

   > ⚠ The disk history is **prepended context, not live output.** It must not be re-broadcast through `dataListeners` as if it had just arrived, and it must not be re-appended to the file — that would double the history on every restart until the cap ate it.

4. **Delete on session delete.** Wherever the session row is deleted (D16 resolution (d)), call `remove(sessionId)`. An orphan file outliving its row is a plaintext record of work with nothing left pointing at it.

5. **Prune at boot**, once, after the restore reconcile knows which rows are live.

## 6. Verification

### Build

```bash
npm run typecheck && npm test && npm run grep:secrets
```

### The redaction A/B (acceptance 3) — the one that matters

**Run it; do not reason about it.** The whole risk of this task is a new plaintext destination for session text, and the scrubber is what stands between it and a leaked key.

1. Launch a session on a stored credential (the D33/Task 3-6 path, so `secretEnv` is genuinely populated).
2. In the pane, cause the agent or shell to echo the environment.
3. Confirm the **pane** shows the redacted form (this is the pre-existing behaviour and the control).
4. `grep` the scrollback file for the secret's plaintext.

```bash
grep -c "<the-secret-value>" "$env:APPDATA/chorus-app/scrollback/<sessionId>.log"   # expect 0
```

5. Also run `npm run grep:secrets`.

**If step 4 returns anything but 0, stop and do not commit.**

### The structural proof

```bash
# exactly one scrubber.push in the codebase's session path
grep -rn "scrubber.push\|createScrubber" src/main --include=*.ts | grep -v test
#   expect: sessionOutput.ts only (plus councilService.ts's own createSessionOutput call)

# the sink is fed from the single emit path
grep -n "onPersist" src/main/services/sessionOutput.ts
#   expect: the option declaration and ONE call site, inside emit
```

### The rest

- **Restart demonstration:** distinctive output → quit → reopen → history visible. Screenshot both.
- **Cap:** drive past 4 M chars; show the file plateaus and retains the tail (`tail -c 200`).
- **Double-append guard:** restart twice; confirm history is not duplicated.
- **Delete:** close a pane; confirm the file is gone by path.
- **Orphan prune:** delete a row with the app closed; boot; confirm the file is swept.
- **Responsiveness:** run a high-output command (name it — e.g. a full `npm run build`) and state that typing latency was unaffected.

Evidence under `_verify/4a-4/`.

## 7. What the commit message must record

- That the redaction A/B was run live, with the grep result.
- The cap and the slack-margin rewrite strategy.
- That files live under `userData` and are deleted with their row.
- `IpcChannel` still 86; the five `sessionOutput.ts` invariants still hold.

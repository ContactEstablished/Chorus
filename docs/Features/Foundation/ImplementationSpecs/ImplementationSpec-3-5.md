# Implementation Spec 3-5 — PTY Scrubber on Ingest

_Companion to `Tasks/Task-3-5.md`. The task doc governs **scope**; this doc governs **exact contents, insertion points, and rationale**. Code blocks are starting points to adapt to the surrounding file's conventions — not byte-for-byte mandates — **except** where marked **EXACT**._

**Anchored to commit `fb3201e`, verified 2026-07-22.** Re-anchor against Task 3-4's commit before starting.

---

## 1. The one place this goes

`SessionManager.spawn`'s data handler, verified this session:

```ts
child.onData((data) => {
  session.buffer += data                       // ← ring buffer
  if (session.buffer.length > BUFFER_MAX_CHARS) { … }
  for (const listener of this.dataListeners) listener(id, data)   // ← renderer
})
```

Everything Chorus retains or replays flows through here: `session.buffer` is what `attach()` returns as `attachResponseSchema.buffer`, `dataListeners` is what becomes `session:data`, and Phase 7's transcripts will read the same buffer. **One insertion point covers all three.** Placing the scrub anywhere downstream — in the IPC handler, in the renderer — would leave the ring buffer holding plaintext, which is the specific thing the council's HIGH finding was about.

The rule the implementation must satisfy, stated as an invariant:

> After this task, `data` (the raw parameter) is referenced exactly once — as the argument to the scrub — and never again. Every other consumer sees only scrubbed output.

---

## 2. `src/main/services/scrubber.ts` — the pure core

**Create.** Imports nothing from `electron` or `node-pty`. No timers (see §3 for why the timer lives in `SessionManager`).

### 2.1 Why exact-value and not pattern

Stated in the module header, because the next person to read this file will wonder why it does not reuse `secret-patterns.json`:

```ts
/**
 * Per-session exact-value scrubber for PTY output (D33 clause 7, council
 * majority 2-of-3; Qwen's accept-and-document dissent preserved in D33).
 *
 * EXACT VALUES, not shapes — and the distinction is the design:
 *   · logger.ts scrubs by SHAPE, because it cannot know which secrets exist
 *     and must catch any of them in arbitrary free text.
 *   · this scrubs by VALUE, because it knows precisely which strings were
 *     injected into this session. Zero false positives, by construction.
 * A shape-based scrubber here would mangle legitimate agent output — a code
 * review of a file containing an example key, a `git diff` of `.env.example`,
 * a docs page — for no security gain. Do not "improve" this by applying
 * secret-patterns.json to the terminal stream.
 *
 * HONEST LIMITS (D33 clause 7, risks 1 and 5 — the council's own words):
 *   · The raw chunk is transiently in main-process memory before scrubbing;
 *     node-pty delivers it there. This mechanism REDUCES RETENTION and
 *     prevents storage/replay/transcript exposure. It does not prevent all
 *     transient main-heap presence, and must never be described as doing so.
 *   · An agent that base64-encodes the key, interleaves ANSI escapes inside
 *     it, or splits it across writes with other content between DEFEATS exact
 *     matching. Out of scope by ruling.
 *   · Scrubbing mutates user-visible terminal output.
 * It does not, and cannot, stop an agent from exfiltrating a key it holds.
 */
```

### 2.2 The placeholder

```ts
/** D33 risk 5: a distinct marker so a reader can tell WHICH mechanism fired —
 *  this, or logger.ts's '[redacted]'. Deliberately different. */
export const CREDENTIAL_PLACEHOLDER = '[REDACTED-CREDENTIAL]'
```

### 2.3 The interface

```ts
export interface Scrubber {
  /** Feed a chunk; returns the text safe to store and forward. May return
   *  less than it was given — a tail that could be the start of a secret is
   *  HELD until the next push or a flush. */
  push(chunk: string): string
  /** Release any held tail. Called on a timer (§3) and at session exit, so a
   *  paused TUI never leaves output stranded mid-prefix. */
  flush(): string
  /** Characters currently held. The caller schedules its flush timer on this
   *  being > 0 — exposed as a number so the caller never reaches into state. */
  pendingLength(): number
}

export function createScrubber(secrets: readonly string[]): Scrubber
```

### 2.4 The algorithm

Three moving parts: longest-first replacement, a bounded held tail, and an identity fast path.

```ts
export function createScrubber(secrets: readonly string[]): Scrubber {
  // Longest first: with secrets A and AB both registered, replacing A first
  // would consume AB's prefix and leave 'B' as recognizable residue.
  const ordered = [...new Set(secrets)].filter((s) => s.length > 0).sort((a, b) => b.length - a.length)
  const maxLen = ordered.reduce((m, s) => Math.max(m, s.length), 0)
  let carry = ''

  function push(chunk: string): string {
    // IDENTITY FAST PATH. Every session pays this on every chunk forever, and
    // the overwhelming majority of sessions have no registered secret at all.
    // Return the SAME string reference — no copy, no scan, no allocation.
    if (ordered.length === 0) return chunk

    const work = carry + chunk
    let out = work
    for (const s of ordered) out = out.split(s).join(CREDENTIAL_PLACEHOLDER)

    // Hold the longest suffix that could still grow into a secret. Bounded at
    // maxLen - 1 (D33 resolution e): a full-length suffix would already have
    // been replaced above, so anything longer cannot be a PROPER prefix.
    const hold = heldSuffixLength(out, ordered, maxLen)
    carry = hold === 0 ? '' : out.slice(out.length - hold)
    return hold === 0 ? out : out.slice(0, out.length - hold)
  }

  function flush(): string {
    const held = carry
    carry = ''
    return held
  }

  return { push, flush, pendingLength: () => carry.length }
}

/** Longest k ≤ min(maxLen-1, s.length) such that s's last k characters are a
 *  proper prefix of some secret. 0 when nothing could be forming. */
function heldSuffixLength(s: string, ordered: readonly string[], maxLen: number): number {
  const limit = Math.min(maxLen - 1, s.length)
  for (let k = limit; k > 0; k--) {
    const tail = s.slice(s.length - k)
    for (const secret of ordered) {
      if (secret.length > k && secret.startsWith(tail)) return k
    }
  }
  return 0
}
```

**Notes on the choices, each of which a reviewer will otherwise question:**

- **`split().join()` over `replaceAll`** is a style call; either is fine. What is *not* fine is a `RegExp` built from the secret — that would require escaping the secret's metacharacters, i.e. constructing a regex source string containing key material, which is a new place for it to exist and a new way to get it wrong.
- **`heldSuffixLength` scans at most `maxLen − 1` characters**, not the whole chunk. With a ~110-character key and a 4 KB chunk, that is ~110 comparisons on a bounded window regardless of chunk size.
- **`secret.length > k`** is what makes it a *proper* prefix. Without it, a complete secret sitting at the very end of a chunk would be held forever instead of replaced — except it was already replaced above, so the guard is what keeps the two halves consistent.
- **Deduplication and empty-string filtering** on construction: an empty secret would match everywhere and destroy the stream. Belt and braces, since the registration API is public within main.
- **The fast path returns the same reference.** Do not `return chunk.slice()` or run the loop over an empty array "for uniformity" — the whole point is that unregistered sessions are untouched, and that claim is verified by comparing screenshots.

### 2.5 Ordering invariant

The concatenation of every `push` return, followed by `flush()`, **equals the concatenation of every input chunk with secrets replaced**. Nothing is dropped, nothing is reordered, nothing is emitted twice. The unit tests assert this directly on a long random input; it is the property that makes the terminal render correctly.

---

## 3. `SessionManager` wiring

### 3.1 The match set and its documented carve-out

Add to the `PtySession` interface and construct it in `spawn`:

```ts
interface PtySession {
  …
  /** The per-session exact-value scrubber, and — via its closure — THE ONLY
   *  PLACE in Chorus that retains injected plaintext beyond the spawn call.
   *
   *  D33 resolution (a), verbatim in intent: clause 4 says the decrypted
   *  plaintext "never enters a retained variable". Exact-match scrubbing
   *  REQUIRES exactly that, so clause 4 carries an explicit carve-out for this
   *  match set: main memory only, never persisted, never logged, never sent
   *  over IPC, cleared on session end.
   *
   *  NAMED LIMIT: this widens the crash-dump exposure window from the
   *  milliseconds of a spawn call to the lifetime of the session. Ratified as
   *  sound without a council round-trip because an attacker who can read this
   *  heap can already read the child process's environment block — the same
   *  excluded threat class, a longer duration, no new class. */
  scrubber: Scrubber
  scrubTimer: NodeJS.Timeout | null
}
```

Putting the carve-out here, on the field, rather than in a design doc, is deliberate: this is the declaration a future reader will find when they ask "why is a key still in memory?".

### 3.2 The ingest handler

```ts
const SCRUB_FLUSH_MS = 50

child.onData((data) => {
  // A pending flush must never overtake a chunk that has already arrived.
  // Clearing FIRST, then pushing, then rescheduling makes the ordering
  // correct by construction rather than by timing: Node is single-threaded,
  // so a timer callback cannot interleave inside this function body.
  if (session.scrubTimer) {
    clearTimeout(session.scrubTimer)
    session.scrubTimer = null
  }

  // The raw chunk is referenced exactly ONCE, here. Nothing below sees it.
  emit(session.scrubber.push(data))

  if (session.scrubber.pendingLength() > 0) {
    session.scrubTimer = setTimeout(() => {
      session.scrubTimer = null
      emit(session.scrubber.flush())
    }, SCRUB_FLUSH_MS)
  }
})
```

with a single local helper so the ring buffer and the listeners provably consume **the same** scrubbed string, computed once:

```ts
const emit = (text: string): void => {
  if (text.length === 0) return
  session.buffer += text
  if (session.buffer.length > BUFFER_MAX_CHARS) {
    session.buffer = session.buffer.slice(session.buffer.length - BUFFER_MAX_CHARS)
  }
  for (const listener of this.dataListeners) listener(id, text)
}
```

**Why one helper and not two scrub calls:** calling `push(data)` once for the buffer and again for the listeners would advance the carry state twice and corrupt the stream. It looks like harmless duplication and is a correctness bug. The helper makes it impossible.

**Why 50 ms:** long enough that a normal burst of TUI output never triggers a mid-burst flush, short enough that a human never perceives a stalled prefix. It is a guess with a reason, not a measurement — the task requires the implementer to **measure and report** the observed latency, and to adjust if 50 ms proves visible.

### 3.3 Teardown

In `child.onExit`, before notifying listeners:

```ts
if (session.scrubTimer) { clearTimeout(session.scrubTimer); session.scrubTimer = null }
emit(session.scrubber.flush())    // don't strand a held tail on exit
```

and in `dispose()`, clear every session's timer alongside the existing kill loop. A leaked `setTimeout` holding a closure over the match set would keep secrets reachable past app teardown — small, but exactly the kind of thing this phase is judged on.

**The match set dies with the session object** when `sessions.delete(id)` runs or the map is cleared in `dispose()`. There is no separate "clear secrets" call to forget, because there is no separate structure — the closure is the storage. Say so in a comment; it is why this design is safer than a `Map<sessionId, Set<string>>` alongside.

### 3.4 The registration seam — declared, unused

```ts
  /**
   * Launch a brand-new session. `secrets` are the exact values injected into
   * this session's environment; they are registered with the per-session
   * scrubber so Chorus never STORES or REPLAYS them (D33 clause 7).
   *
   * Task 3-5 ships this parameter with ZERO callers supplying it — the same
   * dormant-with-one-documented-legal-caller state `--force` sat in after Task
   * 2-1. Task 3-6 is that caller.
   */
  launch(agent: AgentKind, cwd: string, sessionId: string, secrets: readonly string[] = []): SessionSnapshot
```

`spawn` threads it into `createScrubber(secrets)`. The restore path passes nothing — **and that is a real gap Task 3-6 must close**, because a restored session re-spawns without re-resolving its credential. Note it here so 3-6 inherits the problem rather than discovering it: **a restored BYOK session will have an empty match set unless 3-6 re-resolves the credential at restore time.** That is 3-6's decision to make (re-resolve, or refuse to auto-restore credentialed sessions); it is out of scope here but must not be silently forgotten.

---

## 4. What the tests must actually pin down

The task lists the cases; two deserve emphasis because they are the ones a plausible-looking implementation fails.

**The all-split-points loop.** For a secret of length *n*, feeding `slice(0,i)` then `slice(i)` for every *i* in `1..n−1` is 100-ish tiny assertions and catches every off-by-one in `heldSuffixLength`. A single split at the midpoint passes with several wrong implementations. Write the loop.

**The false-prefix release.** Feed `sk-ant-api03-AAAA`, then `NOT-THE-KEY`. The output must contain `sk-ant-api03-AAAANOT-THE-KEY` intact. An implementation that drops the carry when the next chunk diverges silently deletes user output — a data-loss bug that no security test would notice, and the reason "released intact" is an explicit acceptance criterion.

**Assert the carry bound observably.** `pendingLength()` is exposed precisely so the test does not reach into a closure. Assert `sum(outputs) + pendingLength() === sum(inputs)` after an arbitrary sequence — one property that catches drops, duplications, and unbounded growth together.

---

## 5. Verification notes

### 5.1 The instrumentation route, and why it is acceptable here

Nothing registers a secret until 3-6, so the runtime proof needs a temporary two-line edit registering a planted fake value at launch. The house precedent is Task 2-4's `git.ts` cadence instrumentation: declared in the summary, reverted before commit, and the reviewer confirmed the revert **against the commit diff, not the worktree**. Follow it exactly, and expect the same check.

Note that registering a value is a **safe** operation in the security sense — its only effect is to cause more redaction. The risk being managed here is a process one (uncommitted debug code shipping), not an exposure one.

### 5.2 The replay check is the load-bearing one

Of the seven runtime checks in the task doc, **check 3 (remount → `attach()` replay)** is the one that distinguishes this implementation from a wrong one. A scrubber wired into the IPC event path instead of ingest passes checks 1 and 2 and fails check 3, because the ring buffer would still hold plaintext. Do that check carefully and report exactly how the remount was triggered.

### 5.3 Measure the flush, do not assert it

Report the observed prefix-release latency as a number. If it is perceptible, say so and raise the constant — a scrubber that makes the terminal feel laggy will be turned off by someone eventually, and a measured number now is what prevents that argument later.

### 5.4 The non-interference screenshot pair

Capture a running TUI before this change and after it (with a registered secret that never appears). Box drawing, colours, and spinner animation must be identical. This is the evidence that the identity fast path and the carry logic do not perturb ordinary output — the cost every session pays for a feature most sessions never use.

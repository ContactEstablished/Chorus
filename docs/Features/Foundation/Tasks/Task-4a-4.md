# Task 4a-4 — Scrollback Mirrored To Disk

_Phase 4a, task 4 of 4. **One narrated commit (G3).** Executes the line `docs/PLAN.md:173` has carried since v2.1 — _"full transcript mirrored to disk (size-capped)"_ — which has never been built. **Not council-gated**; may land while 4a-2's CR is pending. This task governs scope; `ImplementationSpecs/ImplementationSpec-4a-4.md` governs exact contents._

## Source Of Truth

- `Tasks/Phase-4a-Overview.md` — **D141** (flat file, never SQLite), §7.
- `docs/PLAN.md:173` — the pane spec: _"Scrollback 10k lines in xterm + full transcript mirrored to disk (size-capped)"_.
- Roadmap §6 **D45(1)** (scrubbing is a property of "a session emits text", not "a PTY emits text"), **D46** (the output pipeline lives in one session-shaped object), **F26** (the live A/B that found unredacted output), **D16 resolution (d)** (pane close deletes the row).
- `src/main/services/sessionOutput.ts` — `createSessionOutput` at **:44**; the five invariants in its header comment; the ring-buffer trim at **:60–61**.
- `src/main/services/sessionManager.ts` — `BUFFER_MAX_CHARS = 4_000_000` at **:25**, `SCRUB_FLUSH_MS = 50` at **:32**, the `createSessionOutput` construction at **:618**, and `buffer: session.output.buffer` in `snapshot()` at **:519**.
- `src/main/services/scrubber.ts` — the secret scrubber whose output is the **only** text this task may ever touch.

## Goal

Make a restored pane show the conversation that was in it, instead of an empty terminal — by mirroring each session's already-scrubbed output to a size-capped file, and replaying it on attach.

## Why a file and not SQLite (D141)

The user's own framing offered both. For **this** data the flat file is right, and the reasons are properties of the data rather than preferences:

- It is a **byte stream, not records.** There is no row, no key, no query. The only read is "give me the tail".
- The write cadence is **50 ms** (`SCRUB_FLUSH_MS`, `sessionManager.ts:32`), from every pane simultaneously. That is a transaction per pane per tick against a DB that also serves layout, sessions, turns, attention and council writes.
- The cap is a **head truncation** (`sessionOutput.ts:60–61` already does exactly this in memory), which a file supports natively and a table models badly.
- A corrupt or truncated file costs one pane's history. A corrupt SQLite page costs the projects list.

**The conversation pointer went into SQLite in 4a-1 for precisely the opposite reasons** — it is a single small queryable fact with transactional meaning. Same phase, two stores, one principle: match the store to the shape.

## Exact Scope

| File | Change |
|---|---|
| `src/main/services/scrollbackCore.ts` | **Create.** The **pure** half: the head-truncation rule, the cap arithmetic, and the "what do we replay" computation. No `fs`, no `electron`, no clock. |
| `src/main/services/scrollbackCore.test.ts` | **Create.** Cap, truncation boundary, empty and oversized inputs. |
| `src/main/services/scrollbackStore.ts` | **Create.** The impure half: append, read-tail, delete, and the directory under `app.getPath('userData')`. |
| `src/main/services/scrollbackStore.test.ts` | **Create.** Against a temp directory. |
| `src/main/services/sessionOutput.ts` | **Edit.** One optional sink, invoked from the **existing single emit path**. |
| `src/main/services/sessionManager.ts` | **Edit.** Construct the store; wire the sink at `:618`; seed the replay buffer on restore; delete the file on session delete. |

Nothing else. **No IPC channel (stays 86), no preload, no renderer, no schema change, no npm dependency.**

## Non-Goals

- **⚠ ONLY POST-SCRUB TEXT MAY BE WRITTEN, AND THE SINK MUST HANG OFF THE EXISTING SINGLE EMIT PATH.** `sessionOutput.ts`'s invariant 1 states it: *one* `scrubber.push()` per chunk, whose single result feeds both the ring buffer and the broadcast. **The disk write is a third consumer of that same string — never a second call, never a tap on raw PTY bytes.** F26 was a live A/B that found unredacted output; D45(1) exists because a second wiring point is how a credential ships. A reviewer must be able to see that the file cannot contain anything the pane did not.
- **⚠ THIS IS A PLAINTEXT FILE OF THE USER'S WORK ON DISK, AND THE TASK MUST TREAT THAT AS A DECISION, NOT A DETAIL.** It goes under `userData` (the same protection as `chorus.db`), never `TEMP`, never the project directory, never anywhere a repo could accidentally commit it. It is **deleted when its session row is deleted** (D16 resolution (d) — pane close deletes the row; the file must not outlive it).
- **No scrollback search, no export, no transcript viewer, no copy-transcript button.** Phase 7 owns those (`roadmap.md` Phase 7: _"scrollback search; transcript export"_). This task ends at "the pane looks right after a restart".
- **No unbounded growth.** A cap, enforced on write, with head truncation — the same shape `sessionOutput.ts:60–61` already applies in memory.
- **No change to `BUFFER_MAX_CHARS` (4,000,000) or `SCRUB_FLUSH_MS` (50).** The in-memory ring buffer keeps its current size and cadence; the file is a mirror of it, not a replacement.
- **No fsync-per-chunk, no synchronous write on the PTY data path.** Terminal responsiveness is the feature; a blocking write at 50 ms intervals per pane would be felt. A dropped tail on a hard crash is acceptable — losing the last few hundred milliseconds of *display text* costs nothing, because the agent's own transcript (the thing that matters) is written by the agent.
- **No replay for a session whose row is gone.** An orphan file is deleted at boot, not resurrected.
- **Do not revert, stage, or commit unrelated or untracked files** — see Overview §6.

## Dependencies

**None.** Independent of 4a-1/2/3 and of the council gate. Sequenced last only because it shares `sessionManager.ts` with 4a-3.

## Test Expectations

`scrollbackCore.test.ts` (pure):

- Under the cap → content unchanged.
- Exactly at the cap → unchanged (off-by-one guard).
- Over the cap → head-truncated, tail preserved, result exactly the cap.
- Empty input → no write attempted.
- A single chunk larger than the whole cap → truncated to the cap's tail, not rejected.

`scrollbackStore.test.ts` (temp dir):

- Append then read-tail round-trips.
- A missing file reads as empty, never throws.
- An unreadable/locked file reads as empty and logs — a corrupt mirror may never block a launch.
- Delete removes the file; deleting a missing file is a no-op.
- A session id that is not a plain UUID **cannot escape the directory** — path traversal is refused. Row ids are `randomUUID()` today (`ipc.ts:1373`), which is exactly why the guard must be explicit rather than implied.

## Verification Commands

```bash
npm run typecheck
npm test
npm run grep:secrets
```

## Acceptance Criteria

1. `npm run typecheck` exits 0; `npm test` passes with no count regression; `npm run grep:secrets` clean.
2. **G2, driven on the real app:** produce distinctive output in a pane, quit Chorus, reopen — **the pane shows the earlier output above the prompt**, not an empty terminal. Screenshot both sides.
3. **The redaction proof, run as a live A/B in the F26 style, not reasoned:** launch a session on a stored credential, cause the secret to appear in the environment the agent can echo, and grep the scrollback file. **The secret is absent.** This is the criterion that most deserves the effort, and the one a reviewer cannot check by reading.
4. The cap is demonstrated: drive a session past the cap and show the file stops growing and keeps the **tail**.
5. Delete a pane; its file is gone. Confirm by path.
6. An orphan file (row deleted while the app was closed) is cleaned at boot.
7. Terminal responsiveness is unaffected under a high-output command (e.g. a large build) — stated as an observation, with the command named.
8. Evidence under `_verify/4a-4/`.

## Review Checklist

- [ ] The disk sink is fed from the **single existing emit path** in `sessionOutput.ts`; there is no second `scrubber.push()` and no raw-PTY tap (D45(1), invariant 1).
- [ ] Files live under `userData`, never TEMP or a project directory.
- [ ] Path traversal on the session id is explicitly refused.
- [ ] The file is deleted with its session row (D16 (d)) and orphans are cleaned at boot.
- [ ] Cap enforced on write, head-truncated.
- [ ] No synchronous or fsync-per-chunk write on the data path.
- [ ] Every read failure degrades to "empty scrollback", never to a failed launch.
- [ ] `BUFFER_MAX_CHARS` and `SCRUB_FLUSH_MS` unchanged.
- [ ] `IpcChannel` still 86.
- [ ] The secret-absence A/B was actually run, not argued.

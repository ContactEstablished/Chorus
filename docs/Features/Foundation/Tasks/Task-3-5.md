# Task 3-5 — PTY Scrubber on Ingest

_Fifth task of Phase 3 (Foundation). Windows-only. **One commit** (G3). This task governs scope; `ImplementationSpec-3-5.md` governs exact contents. Created by **D35**; implements **D33 Q4** (majority ruling) with coordinator resolutions **(a)** and **(e)**._

## Source Of Truth

- `docs/Features/Foundation/Tasks/Phase-3-Overview.md` — the phase contract, cross-cutting rules, gates, file-ownership matrix.
- Roadmap §6 **D33**, specifically:
  - **clause 7** — the PTY ring buffer and future transcripts are scrubbed at ingest for the exact key values injected into that session; a streaming exact-match scrubber replaces matches with `[REDACTED-CREDENTIAL]` before the chunk enters the ring buffer; chunk-boundary cases are handled; the raw chunk transiently exists in main memory (node-pty delivery) and the contract says so.
  - **resolution (a)** — clause 4's "drop all references" gains a carve-out: exact-match scrubbing **requires** retaining the injected plaintext for the session's lifetime. The match set is **main memory only, never persisted, cleared on session end**, and the widened crash-dump window is a **named limit**.
  - **resolution (e)** — carry-over bounded at `maxSecretLen − 1` bytes with a **short timer flush**, because a TUI pausing mid-prefix must not stall rendering.
- `CouncilBriefs/CouncilBrief-3.0-Vault-Findings.md` — the HIGH finding, the Q4 ruling, **Qwen's preserved dissent**, and risks 1 and 5.
- Roadmap §6 **D35** — why this is its own task, before injection.
- Precedent: **Task 3-1** is the model — redaction machinery lands *before* the secret it protects against exists, with its own tests and its own runtime proof against a planted fake value.

## Initial Starting Point

**Verified 2026-07-22 against commit `fb3201e`**; re-verify against 3-4's commit before starting.

- **Baseline at the time of writing:** typecheck 0 · 160/160 across 8 files · `grep:secrets` clean. Tasks 3-2/3-3/3-4 add to this.
- **The ingest point, verified this session** — `SessionManager.spawn`'s data handler, in `src/main/services/sessionManager.ts`:
  ```ts
  child.onData((data) => {
    session.buffer += data
    if (session.buffer.length > BUFFER_MAX_CHARS) {
      session.buffer = session.buffer.slice(session.buffer.length - BUFFER_MAX_CHARS)
    }
    for (const listener of this.dataListeners) listener(id, data)
  })
  ```
  Ring-buffer append happens **first**, listener broadcast **second**, and both consume the same `data`. `BUFFER_MAX_CHARS = 4_000_000`.
- **Three consumers, one source.** `session.buffer` is replayed by `attach()` via `snapshot()` into `attachResponseSchema.buffer`; `dataListeners` feed the `session:data` event to the renderer; and Phase 7's on-disk transcripts will read the same buffer. Scrubbing at this one point covers all three — which is exactly why the council put it here rather than at three call sites.
- **`SessionManager` is PTY-only** and stays so (D34 Q2: Phase 3 restructures only the adapter side).
- **`session:data` payload is `{sessionId, data}`** (`sessionDataEventSchema`), validated in main before sending. Unchanged by this task.
- **Nothing injects a credential yet.** D5 still stands; `spawn` passes `process.env` through untouched. Task 3-6 changes that.
- **The canonical key-shape list is `src/main/services/secret-patterns.json`** — six patterns, shared by `logger.ts` and `scripts/secret-grep.mjs`. **This task does not use it for matching** (see Goal) but its `SCRUB_PLACEHOLDER` neighbour in `logger.ts` is a useful contrast: the logger's placeholder is `[redacted]`; this task's is `[REDACTED-CREDENTIAL]` per D33 risk 5.

## Goal

Make Chorus's own stored and replayed terminal output safe against an agent that prints its injected key — and land it **before** any key exists to print.

The council's reasoning, worth restating because it decides the design: an agent is an autonomous program with shell access, so `echo $env:ANTHROPIC_API_KEY`, a debug flag, a crash dump, or a provider error page can all put a key into the PTY stream. Chorus does not control the agent. Chorus **does** control the ring buffer, the renderer replay, and the future transcript file — those are Chorus-controlled surfaces under Constraint 1, and storing and replaying a key there is Chorus's leak, not the agent's.

**This is exact-value matching, not pattern matching.** The distinction is the design:

- The **logger** scrubs by *shape* (`sk-ant-…`), because it cannot know which secrets exist and must catch any of them in free text.
- The **scrubber** scrubs by *value*, because it knows exactly which strings were injected into this session, and matching the literal value has no false positives at all. A shape-based scrubber on a terminal stream would mangle legitimate agent output — a code review of a file containing an example key, a `git diff` of a `.env.example`, documentation — which is a real cost with no security benefit here.

Do not "improve" this by also applying `secret-patterns.json` to the PTY stream. That would be a different, worse feature.

**What this task honestly does not do**, and must say so in code comments and in the completion summary (D33 clause 7 and risks 1/5, and the council's own words):

- The raw chunk is transiently in main-process memory before scrubbing — node-pty delivers it there. The contract phrases this as *reducing retention and preventing storage/replay/transcript exposure*, **not** as preventing all transient main-heap presence.
- An agent that base64-encodes the key, interleaves ANSI escapes inside it, or splits it across writes with other content between defeats exact matching. **This is out of scope by council ruling**, and Qwen's dissent — that the whole mechanism creates a false sense of security — is preserved precisely so nobody later claims more than this.
- Scrubbing mutates user-visible terminal output.

## Exact Scope

| File | Change |
|---|---|
| `src/main/services/scrubber.ts` | **Create.** The pure streaming core: a scrubber factory with `push(chunk)`, `flush()`, and the carry-over/boundary logic. Electron-free, node-pty-free, unit-testable. |
| `src/main/services/scrubber.test.ts` | **Create.** The boundary and correctness cases (see Test Expectations). |
| `src/main/services/sessionManager.ts` | **Edit.** Per-session scrubber; the registration API; ingest wiring; teardown clearing. |

Nothing else. **No IPC change, no schema change, no renderer change, no vault involvement.** If a change seems to require another file, raise it.

## Non-Goals

- **No injection.** `launch()` grows an optional secrets parameter as the seam 3-6 fills; **nothing passes it in this commit** and no vault module is imported. Grep-verifiable: zero callers supply secrets.
- **No shape/pattern matching on the PTY stream.** Exact values only, for the reason in Goal.
- **No transcript writing.** Phase 7. The scrubber makes future transcripts safe by construction; it does not create them.
- **No renderer-side redaction, no UI indicator.** D33 risk 5 floats "consider a per-session visual indicator when redaction has occurred" — that is a *consideration*, not a contract clause, and it would require new IPC. Out of scope; note it as a Phase 7 candidate.
- **No change to `session:data`'s shape**, no new event, no counters over IPC.
- **No scrubbing of PTY *input*** (what the user types). Only output.
- **No change to `BUFFER_MAX_CHARS`, to the ring-buffer trim, or to the listener mechanism.**
- **No logger change.** `scrubSecrets` and `[redacted]` stay exactly as they are; this task's placeholder is different by design.
- **Do not revert, stage, or commit unrelated or untracked files, including `_verify/` and anything under `docs/`.**
- **Do not remove the standing `wt-24b5c1fe` worktree row, directory, or branch.**

## Dependencies

- **Task 3-4** — ordering only. No code dependency; the scrubber touches nothing 3-2/3-3/3-4 built.
- No new npm dependency.

## Step-by-step Work

1. **`scrubber.ts` — the pure core, written and tested before anything touches `SessionManager`.** Get the boundary algorithm right in isolation; it is the only genuinely subtle code in this task.
2. **Wire it into `spawn`'s `onData`** so the scrubbed text feeds **both** the ring buffer and the listeners, and the raw chunk reaches neither.
3. **The timer flush** (D33(e)) — a held carry must not wait indefinitely for the next chunk.
4. **Registration + teardown:** `registerSecrets(sessionId, values)`; the match set is cleared on `onExit` and in `dispose()`.
5. **Tests** for the core, then `npm run typecheck` / `npx vitest run` / `npm run grep:secrets`.
6. **Runtime-verify (G2)** per Verification Commands, including the split-across-chunks proof, using the temporary-instrumentation route described there.

## Test Expectations

**Unit (Vitest), `src/main/services/scrubber.test.ts`.** The module must import neither `electron` nor `node-pty`.

Correctness:
- **No secrets registered → identity.** `push(x)` returns `x` byte-for-byte, for text containing `[`, ANSI escapes, CRLF, and non-ASCII. This is the most important test in the file: 99.99% of chunks have no secret, and a scrubber that perturbs them at all is a regression in every session.
- **Single occurrence** in one chunk → replaced.
- **Multiple occurrences** in one chunk → all replaced.
- **Two different secrets**, both present → both replaced.
- **Overlapping/prefix-related secrets** (one secret a prefix of another) → the longer match wins and no partial residue of either remains.
- **A secret adjacent to other text** (`KEY=<secret>\n`) → surrounding bytes preserved exactly.

Boundaries — the reason this is a streaming algorithm:
- **Split across two chunks** at every split point: for a secret of length *n*, loop `i` from 1 to *n−1*, feeding `secret.slice(0, i)` then `secret.slice(i)`, and assert the concatenated output contains the placeholder and **no fragment of the secret of length ≥ 8**. A single hand-picked split point is not sufficient; the loop is what proves the algorithm rather than one case.
- **Split across three chunks** for at least one split pattern.
- **False-prefix release:** feed a proper prefix of a secret followed by text that diverges (`sk-ant-api03-AAA` then `BUT-NOT-THE-KEY`). The held prefix must be **emitted intact** — dropping or mangling it would corrupt legitimate output.
- **Carry bound:** after any sequence of pushes, the internal carry never exceeds `maxSecretLen − 1` characters. Assert on the observable consequence — total output length plus carry length equals total input length — rather than reaching into private state.
- **`flush()`** emits any held carry and empties it; a second `flush()` returns empty.
- **Order preservation:** for a long random-ish input containing no secrets, the concatenation of all `push` returns plus `flush` equals the input exactly.

Register the fixtures as obviously-fake values of realistic shape and length. `npm run grep:secrets` must still pass — if it trips, the fixture is wrong, not the gate.

**Runtime (G2)** carries the proof that the ring buffer, the live stream, and `attach()`'s replay are all covered — a unit test can only show the function works.

## Verification Commands

Run from repo root (PowerShell):

```
npm run typecheck
```

```
npx vitest run
```

```
npm run grep:secrets
```

```
npm run dev
```

**The runtime proof needs a registered secret, and nothing registers one yet.** Use the established house route: **temporary instrumentation, explicitly declared and verifiably reverted** — the pattern Task 2-4 used for its `git.ts` cadence instrumentation, where the coordinator confirmed the revert against the **commit diff**, not the worktree.

Add a two-line temporary edit in `src/main/ipc.ts`'s current-tree launch branch that registers a **planted fake key of realistic shape** for the new session, then:

1. **Live stream** — launch an agent, type `echo <the planted value>` into the pane, and confirm the terminal renders `[REDACTED-CREDENTIAL]`. (Codex is the agent to use: Claude Code is unauthenticated on this machine. A shell-like echo through the agent, or simply typing at whatever prompt is available, is enough — the point is bytes traversing the PTY, not agent semantics.)
2. **Ring buffer** — with the value on screen, dump the session's buffer through a CDP-driven `attach` (or read the attach response after a pane remount) and confirm the placeholder is present and the value is absent.
3. **Replay** — close and reopen the pane (or switch filmstrip focus, which remounts) so `attach()` replays from the buffer, and confirm the replayed text is scrubbed. **This is the check that proves scrubbing happened at ingest rather than on the way out.**
4. **Split across chunks, for real** — emit the value in two writes with a delay between them (e.g. `printf` in two parts, or a small script the agent runs) and confirm the reassembled output is still redacted. This is the runtime counterpart of the unit loop and the single most likely place for the implementation to be wrong in practice.
5. **The timer flush** — emit a proper prefix of the secret and then **stop producing output**. The prefix must appear on screen within the flush interval, not hang until the next keystroke. Time it and report the number.
6. **Non-interference** — run a normal agent session with a registered secret that never appears, and confirm the TUI renders identically to an unscrubbed session (spinner animation, box drawing, colours). Compare screenshots.
7. **Teardown** — kill the session and confirm the match set is cleared (a subsequent session with no registration does not scrub).

**Then revert the instrumentation** and re-run `npm run typecheck` / `npx vitest run` before committing. State in the completion summary that it was reverted, and expect the reviewer to check the diff.

**⚠ The `sqlite3` CLI is NOT installed.** Use the `ELECTRON_RUN_AS_NODE` dump-script pattern (`_verify/2-1-dump.js`); write results to a file; **known flake: no file on first invocation, retry once**; **quote the `projects` table** (F20).

**Harness reminders:** electron-vite does **not** hot-restart the main process — every scrubber check needs a real tree-kill cold boot. Kill process **trees** (`taskkill /PID <root> /T /F`). `Input.insertText` reaches xterm's `onData` as one chunk, which is useful for controlling exactly how input arrives. Screenshots via `Page.captureScreenshot`.

## Acceptance Criteria

- [ ] `npm run typecheck` — zero errors (G1).
- [ ] `npx vitest run` — green, the then-current baseline intact and grown by the scrubber cases.
- [ ] `npm run grep:secrets` — clean, including the new test fixtures (G4).
- [ ] **Identity when no secret is registered** — proven by unit test and by an on-screen comparison of a normal session before and after this change.
- [ ] **Exact-value scrubbing works at ingest:** a registered planted value printed by a live agent appears as `[REDACTED-CREDENTIAL]` in the renderer, in the ring buffer, **and** in `attach()`'s replay after a remount.
- [ ] **Chunk-split values are caught** — unit-tested at every split point, and runtime-proven with a genuinely split emission.
- [ ] **A false prefix is released intact**, not dropped and not mangled.
- [ ] **The carry is bounded** at `maxSecretLen − 1` and the **timer flush** releases a held prefix within its interval — the measured interval is reported, not asserted.
- [ ] **The match set is main-memory only**: it is never written to the DB, never logged, never sent over IPC, and is **cleared on session exit and in `dispose()`** — grep-verified and runtime-confirmed.
- [ ] **The retention carve-out is documented in the code** where the match set is declared, naming it as D33 resolution (a)'s explicit exception to clause 4 and stating the widened crash-dump window as a known limit.
- [ ] **The scope limits are documented in the code** — transient main-memory presence, and the base64/ANSI/obfuscation gap — in the words the council used, not softer ones.
- [ ] **Nothing registers a secret in the committed code** (grep-verified); the temporary verification instrumentation is **reverted and its absence provable from the commit diff**.
- [ ] **No IPC, schema, renderer, or vault change.**
- [ ] **One** narrated commit (G3), touching only the three Exact Scope files.
- [ ] The standing `wt-24b5c1fe` worktree row, directory, and branch are **untouched**.

## Review Checklist

- [ ] **The identity path is genuinely free.** Read the code for the zero-secrets case: it must not allocate, copy, or scan. Every session pays this cost on every chunk forever, and an agent under load emits a lot of chunks.
- [ ] The ring buffer and the listeners receive the **same scrubbed string**, computed once. Two separate scrub calls on the same chunk would be a correctness bug the moment carry-over is involved.
- [ ] The raw `data` parameter is **not** referenced after the scrub call — no logging it, no length-measuring it, no passing it anywhere.
- [ ] The carry-over algorithm was checked against the unit loop over **all** split points, not one.
- [ ] The timer flush cannot emit out of order with a subsequent `push` — a chunk arriving while a flush is pending must not overtake it. Read the code for this specifically; it is the classic bug in this shape and no test will find it by accident.
- [ ] The placeholder is `[REDACTED-CREDENTIAL]` (D33 risk 5), distinct from the logger's `[redacted]`, so a reader of a log or a transcript can tell which mechanism fired.
- [ ] The comments state the limits honestly. If any comment implies the scrubber prevents an agent from exfiltrating its own key, it is wrong and must be rewritten — the council was explicit that it does not.
- [ ] Qwen's dissent is acknowledged somewhere durable (the commit message or a code comment), so the next reader knows the mechanism was contested and on what grounds.
- [ ] No untracked / `_verify/` / `docs/` files staged or reverted; the temporary instrumentation is gone from the diff.

# Implementation Spec 4a-3 — Wiring Resume Into Launch, Restore And Restart

_Governs exact contents for `Tasks/Task-4a-3.md`. Assumes 4a-1's column and 4a-2's adapter contract are merged; **re-read against D139's actual verdict** before use._

## 1. Verified starting state (`82e16d7`, 2026-08-12)

| Symbol | Line | Current |
|---|---|---|
| `SessionManager.restore()` | `sessionManager.ts:272` | heal-first, then relaunch loop |
| the relaunch spawn | `sessionManager.ts:346` | `this.spawn(row.agent as AgentKind, row.cwd, row.id)` — **no options at all** |
| credentialed refusal | `sessionManager.ts:321` | heals to `exited`, sets a title, `continue`s |
| `spawn()` | `sessionManager.ts:525` | builds hooks, calls `adapter.buildLaunch` at `:561`, `pty.spawn` at `:594` |
| `attach()` | `sessionManager.ts:251` | pure view binding, returns `snapshot()` |
| restart comment | `sessionManager.ts:665` | _"A restart is a NEW CONVERSATION (D16 clause 4 …)"_ |
| `computeRestoreSet` | `restore.ts:31` | `RestoreCandidate` = `{id, status}`, structurally typed |
| `SessionRestart` handler | `ipc.ts:1587` | — |

**Re-verify before editing.**

## 2. `resumeCore.ts` — the pure decision

Follows the `computeRestoreSet` / `attentionCore` / `turnsCore` house pattern: no `fs`, no `electron`, no `better-sqlite3`, no clock. Everything arrives as a parameter, so Vitest covers it without an Electron ABI.

```ts
/**
 * Phase 4a / D140: what kind of conversation this launch is.
 *
 * PURE. The three inputs are the row's stored pointer, the adapter's declared
 * `idSource`, and whether the conversation still exists on disk — the last
 * being a BOOLEAN the caller computed, never a path this module stats.
 *
 * ⚠ `fresh` AND `assign` ARE DIFFERENT ANSWERS AND CONFLATING THEM IS THE BUG
 * THIS MODULE EXISTS TO PREVENT. `assign` means "launch naming the
 * conversation up front" (claude). `fresh` means "launch bare and go find out
 * what it named itself" (codex). Both start a new conversation; only one of
 * them puts a token in argv.
 */
export type ResumePlan =
  | { kind: 'reopen'; agentSessionId: string }
  | { kind: 'assign'; agentSessionId: string }
  | { kind: 'fresh' }

export function planResume(input: {
  storedAgentSessionId: string | null
  idSource: 'assign-at-launch' | 'discover-after-launch' | null
  conversationExists: boolean
  mintId: () => string
}): ResumePlan
```

Rules, matching the task's truth table exactly:

1. `idSource === null` (an adapter with no resume support — kimi, opencode, noHarness) → **always `fresh`**. This is the branch that keeps the unsupported adapters behaving exactly as they do today.
2. pointer set **and** `conversationExists` → `reopen`.
3. otherwise `assign-at-launch` → `assign` with `mintId()`.
4. otherwise → `fresh`.

**`mintId` is injected rather than imported** so the core stays deterministic under test — the same discipline that keeps `Date.now()` out of `turnsCore`.

## 3. `sessionManager.ts` — the three edits

### 3.1 `spawn()` accepts a plan and persists what it assigned

`spawn` already takes `opts: LaunchOptions = {}` (`:525`). Add a `resume?: PtyLaunchResume` to that options type and forward it into the `buildLaunch` call at `:561`, beside `hooks`.

**Persist on `assign`, and persist BEFORE the PTY is spawned.** If Chorus mints an id, puts it in argv, and then crashes before writing the row, the conversation exists on disk under a name nobody remembers — an orphan transcript and a pane that starts fresh forever. Writing first can only cost a pointer to a conversation that never started, which the existence pre-flight already handles gracefully.

> ⚠ This is the mirror image of `restore()`'s `'running'`-after-spawn rule at `:351`, and the asymmetry is deliberate. **Status must be written after** (a crash mid-spawn must not leave a row claiming `running`); **the pointer must be written before** (a crash mid-spawn must not orphan a named conversation). Different failure, different safe direction.

### 3.2 `restore()` — the resume branch

Inside the existing `for (const row of set.toRelaunch)` loop, **after** the credentialed check at `:321`, the `RESTORE_CAP` check at `:331` and the `existsSync(row.cwd)` check at `:337` — all three keep their current order and semantics — compute the plan and pass it to `spawn`:

```ts
const plan = planResume({
  storedAgentSessionId: row.agentSessionId ?? null,
  idSource: adapterIdSource(row.agent),
  conversationExists: conversationExists(row.agent, row.cwd, row.agentSessionId),
  mintId: randomUUID
})
```

`spawn(row.agent as AgentKind, row.cwd, row.id, { resume: toLaunchResume(plan) })` — where a `fresh` plan yields `undefined` and the call becomes **byte-identical to today's** (`:346`).

Log which happened, once per session, at `info`:

```
[restore] reopened conversation for <sessionId>          // no id, no cwd — see 3.4
[restore] no conversation to reopen for <sessionId>; fresh
```

### 3.3 The existence pre-flight

**This is what prevents the picker**, and it is the reason claude's path reads zero transcript bytes.

| Agent | Check |
|---|---|
| claude | `existsSync(join(homedir(), '.claude', 'projects', mungeCwd(cwd), `${id}.jsonl`))` |
| codex | the rollout path recorded at discovery time, or a scan for `*-<id>.jsonl` under `~/.codex/sessions` |

> **⚠ THE CWD MUNGE IS A DEPENDENCY ON SOMEONE ELSE'S PRIVATE FORMAT, AND IT MUST FAIL SAFE.**
> Verified 2026-08-12: `C:\Projects\...\scratchpad\resumetest` → `C--Users-matth-AppData-...-scratchpad-resumetest`, i.e. separators and `:` become `-`. **Chorus does not own this transformation and Claude Code may change it.** Therefore: a failed existence check must mean **"launch fresh"**, never an error — and **never a reason to skip launching**. If the munge breaks, the worst outcome is that resume silently stops working and every pane starts fresh, which is exactly today's behaviour. Encode that in a comment so a future reader knows the degradation is designed.
>
> **⚠ AND THE MUNGE IS CWD-SENSITIVE, WHICH INTERACTS WITH WORKTREES.** A session whose `cwd` was rewritten to a worktree path after launch (Phase 2 / D26) has its transcript under the **old** munged directory. The check will miss, and the pane will start fresh. That is acceptable and correct-by-degradation for this phase — **record it as a known limitation**, do not attempt a search across munged directories.

### 3.4 What must never be logged

A log line containing both the agent session id **and** the cwd is a recipe for reconstructing a transcript path, i.e. a pointer to the full text of the user's work, sitting in a log file with different permissions from the transcript. **Log the Chorus session id and the outcome; never the agent id, never beside the cwd.**

## 4. `codexSessionDiscovery.ts`

Split pure from impure exactly as `attentionCore`/`attention` do: the header parse and the candidate-selection rule are pure and tested; the directory walk is not.

```ts
/** Parse a rollout file's FIRST LINE only. Returns null for anything that is
 *  not a well-formed session_meta — malformed JSON, a truncated line, a
 *  different record type. Never throws. */
export function parseRolloutHeader(firstLine: string): { sessionId: string; cwd: string; timestamp: string } | null

/** Choose among candidates. Returns null when the answer is ambiguous.
 *
 *  ⚠ AMBIGUITY RETURNS NULL RATHER THAN THE NEWEST, AND THAT IS THE WHOLE
 *  SAFETY PROPERTY. Two panes launching codex in the same cwd within the same
 *  second are genuinely indistinguishable from here. Claiming the newest would
 *  eventually cross two conversations — pane A resuming pane B's work — which
 *  is a silent, confusing corruption. No pointer just means "starts fresh",
 *  which is visible, honest, and exactly today's behaviour. */
export function selectRollout(candidates: RolloutCandidate[], cwd: string, spawnedAtIso: string): string | null
```

The impure wrapper:

- Walks `~/.codex/sessions/YYYY/MM/DD/` for **today and yesterday only** (a launch never produces a rollout dated earlier; two days covers a midnight boundary and bounds the walk).
- Reads **only the first line** of each candidate — a bounded read, not the file.
- Is **retried on a short delay** after spawn, because the rollout appears asynchronously. Bound the attempts (e.g. a handful of polls over a few seconds) and give up quietly.
- Wraps everything in the `safely()` discipline: **discovery may fail; it may never propagate into a launch failure.**

Match on: header `cwd` equals the session's cwd (normalise separators and case for Windows), **and** header timestamp `>= spawnedAt` minus a small tolerance.

## 5. `ipc.ts` — restart clears the pointer

At `SessionRestart` (`:1587`), before relaunching:

```ts
// D142: a restart is a DELIBERATE fresh conversation (D16 clause 4 — it is
// what the "Session restarted" badge announces). Clearing the pointer is what
// makes that true now that restore resumes; without this line the next boot
// would silently reopen the conversation the user just chose to abandon, and
// the badge would be lying.
storage.clearAgentSessionId(sessionId)
```

**Nothing else on this path changes.** The badge, the refusal rules, the credentialed check, and the response shape are all untouched.

## 6. Verification

### Build

```bash
npm run typecheck && npm test && npm run grep:secrets
```

`IpcChannel` must still be **86** — `ipc.test.ts:3438` and `:3816` prove it without any edit.

### The headline demonstration (G2)

Not optional and not replaceable by tests.

1. Real project, real `claude` pane. Say: *"Remember the number 4917. Reply OK."* Then a second turn so the transcript is unambiguous.
2. `SELECT id, agent, agent_session_id FROM sessions WHERE status='running';` — capture.
3. **Quit Chorus entirely.** (Then, once, repeat the whole run across a genuine machine reboot — that is the reported scenario.)
4. Reopen. Pane returns.
5. Ask: *"What number did I ask you to remember?"* → **4917**. Screenshot.
6. Repeat 1–5 for `codex`.
7. Restart the claude pane → ask again → **it does not know**, and the badge shows. `agent_session_id` is NULL immediately after the clear.
8. Rename that session's `.jsonl` aside, quit, reopen → pane launches **fresh**, no dialog, **no picker**, one honest log line.

Evidence under `_verify/4a-3/`.

### The negative checks

```bash
# no second transcript reader crept in
grep -rn "\.jsonl" src/main --include=*.ts | grep -v test
#   expect: contextUsage.ts (pre-existing), codexSessionDiscovery.ts (new), nothing else

# the hook listener is untouched
git diff --stat HEAD -- src/main/services/agentEvents.ts src/main/services/agentEventsCore.ts
#   expect: empty

# restart really does clear
grep -rn "clearAgentSessionId" src/main --include=*.ts
#   expect: a call on the restart path
```

## 7. What the commit message must record

- That the reboot demonstration was actually run across a real reboot, with the recalled value.
- Whether codex discovery proved reliable — and if not, that codex shipped **without** resume, as a stated outcome rather than a silent gap.
- The worktree-cwd limitation (§3.3) as a known, accepted degradation.
- `IpcChannel` still 86; `agentEvents.ts` untouched.

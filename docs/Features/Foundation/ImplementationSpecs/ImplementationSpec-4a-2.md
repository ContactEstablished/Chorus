# Implementation Spec 4a-2 — The Adapter Resume Contract

_Governs exact contents for `Tasks/Task-4a-2.md`. **Revised 2026-08-13 against the CR-4a.0 ruling and re-measured at `a6fab79`.** The previous revision was written while D139 was pending and hedged everything against a coordinator preference; that hedging is gone. Where this spec and the findings disagree, **§4.4 names the disagreement explicitly and gives the reason** — there are exactly two, both repository facts the council could not see._

## 1. Verified starting state (`a6fab79`, 2026-08-13)

| Symbol | Line | Current state |
|---|---|---|
| `PtyLaunchSpec` | `types.ts:233` | **exactly eight** fields: `sessionId`, `cwd`, `modelId?`, `effortOptionId?`, `extraArgs?`, `credential?`, `route?`, `hooks?` |
| `ResumeDescriptor` | `types.ts:180` | `{ mode: DescriptorMode, cliFlag: string \| null }` |
| `ResumeSpec` | `types.ts:351` | `{ sessionId, cwd }` — **two fields. Deleted by this task.** |
| `SupportsResume` | `types.ts:574` | `resumeSession(spec: ResumeSpec): PtyLaunchRequest` — **deleted by this task** |
| `supportsResume` guard | `types.ts:621` | `(a: BaseAgentAdapter): a is BaseAgentAdapter & SupportsResume` |
| `supportsMcp` / `supportsHooks` | `types.ts:606` / `:614` | the two sibling guards this one must match in shape |
| `SupportsHooks` | `types.ts:565` | **methods only — no descriptor property.** The house pattern |
| `claude` capability | `claude.ts:100` | `sessionResume: null`; the comment explaining it at `:85`–`:88` |
| `claude` `buildLaunch` | `claude.ts:202` | the single launch builder |
| `codex` capability | `codex.ts:82` | `sessionResume: null`; the comment at `:71`–`:73` groups it with `hooks` |
| `codex` `buildLaunch` | `codex.ts:110` | `const cli = resolveCli(this.id)` at `:115`; `const args = [...cli.args, ...CODEX_BASELINE_ARGS]` at `:121`; the cmd.exe shim note at `:113`–`:114` |
| `kimi` / `opencode` | `kimi.ts:111` / `opencode.ts:144` | `sessionResume: null`; the `-c`-means-`--continue` warnings at `kimi.ts:136` / `opencode.ts:204` |
| `noHarness` | `noHarness.ts:85` | `sessionResume: null` — **not an adapter object**, see §8.1 |
| capability merge | `capabilities.ts:35` | merges a detected `sessionResume` override field-for-field |
| registry | `registry.ts:35` | `staticRegistry` — **exactly four** adapters |
| honesty table | `adapters.test.ts:596` | asserts `supportsResume` **false** for every adapter; `expect` at `:598` |
| coverage guard | `adapters.test.ts:574` | _"covers every registry adapter — the loops below cannot silently shrink"_ |
| `EXTENSION_METHODS` | `adapters.test.ts:908` | the generic pairing array; **`['sessionResume','resumeSession']` at `:911`** |
| argv-assertion idiom | `adapters.test.ts:291`, `:408` | _"a copied buildLaunch would silently RESUME a stale session"_ |
| wire schema | `ipc.ts:2219` | `resumeDescriptorSchema`; `mode` at `:2220`; `agentCapabilitiesSchema` `:2224`; its `sessionResume` field `:2231` |
| wire fixture | `ipc.test.ts:1822` | a capabilities fixture with `sessionResume: null` — **holds null, so no edit expected; confirm rather than assume** |
| Test baseline | — | **56 files / 1888 tests**, typecheck 0 errors, `IpcChannel` **86** |

> **⚠ EVERY LINE NUMBER IN THIS TABLE WAS MEASURED AT `a6fab79`. A LINE NUMBER IN A SPEC IS A SNAPSHOT, NOT A FACT** — this phase has already had two go stale (roadmap §5 records them: the kickoff docs cite `SupportsResume`/`ResumeSpec` swapped, and `buildLaunch` at a line Task 4a-4 moved). Re-confirm before editing; if one has moved, fix it here rather than working around it.

## 2. What the ruling changed relative to the pre-council draft

| Pre-council draft said | The ruling says |
|---|---|
| `SupportsResume` and `ResumeSpec` are **redefined, not deleted** | **Both are deleted.** `ResumeSpec` disappears; `SupportsResume` is a new, differently-shaped union |
| codex resumes through a `resumeSession()` method | codex resumes **inside its own `buildLaunch`**, branching on `spec.resume` |
| descriptor gains `idSource: 'assign-at-launch' \| 'discover-after-launch'` | descriptor is **discriminated on `kind: 'assigned' \| 'discovered'`**, and `mode` **stays** |
| modifier is `{mode: 'assign' \| 'reopen', agentSessionId}` | modifier is `AgentSessionLaunch`, a **two-member union on `strategy`** carrying `action: 'create' \| 'resume'` |
| the claude "wart" — a descriptor with no method — was an open question | **resolved:** the companion method is `classifyResumeFailure`, which claude implements, so the guard is honest for both adapters |
| failure detection unowned | **adapter-owned**, via `classifyResumeFailure` |
| discovery is "4a-3's, in main" | **`discoverSessionId` is a codex adapter method**; only its invocation is 4a-3's |
| `src/shared/ipc.ts` explicitly out of scope | **in scope** (D143(f)) |

## 3. The CLI facts this spec encodes

**Measured 2026-08-12. Re-verify at implementation time (D4) — these are the whole basis of the task.**

### claude

```
--session-id <uuid>    Use a specific session ID for the conversation (must be a valid UUID)
-r, --resume [value]   Resume a conversation by session ID, or open interactive picker
                       with optional search term
--fork-session         When resuming, create a new session ID instead of reusing the original
```

| Action | Result |
|---|---|
| `--session-id <fresh uuid>` | session created under that exact id; transcript at `~/.claude/projects/<munged-cwd>/<uuid>.jsonl` |
| `--resume <uuid>` | **context genuinely restored** — recalled a word planted in the prior turn |
| `--session-id <live uuid>` | `Error: Session ID <uuid> is already in use.` |
| `--resume <unknown uuid>` | `No conversation found with session ID: <uuid>` |

**`--session-id` and `--resume` are mutually exclusive by construction** — the first refuses an id that exists, the second requires one that does. The adapter must never emit both.

> **⚠ AMENDMENT (d) — THE EVIDENCE ABOVE IS PRINT-MODE EVIDENCE AND THIS TASK NEEDS INTERACTIVE EVIDENCE.**
>
> Every row was measured with `claude --session-id <uuid> -p …`. **`-p` is print mode: non-interactive, one shot, exits.** Every Chorus pane is an interactive TUI. `claude --help` documents the flag generically — *"Use a specific session ID for the conversation (must be a valid UUID)"* — with **no `--print` restriction**, so it very probably holds in both modes.
>
> **"Very probably" is not what D4 accepts, and this is not a marginal path.** The assigned strategy puts `--session-id` on **every claude launch in the application**, not only on restores. If the flag behaves differently without `-p` — refused, ignored, or accepted while the TUI names its own session anyway — the pointer Chorus writes down is wrong for every session it ever creates, and the symptom appears one restart later.
>
> **Protocol, before any argv is written:**
> 1. Mint a UUID. Launch `claude --session-id <uuid>` **interactively**, in a throwaway cwd, with no `-p`.
> 2. Say one distinctive word in the pane; exit.
> 3. Confirm `~/.claude/projects/<munged-cwd>/<uuid>.jsonl` exists **under that exact id** — not under a different one.
> 4. Relaunch `claude --resume <uuid>` interactively and confirm the word comes back.
> 5. Capture all five steps into `_verify/4a-2/`, with the `claude --version` that produced them.
>
> **If step 3 fails, STOP.** The assigned strategy does not work for interactive claude and D139 needs re-opening — that is a finding, not a bug to route around.

> **⚠ AMENDMENT (e) — `--resume` TAKES AN OPTIONAL VALUE, AND THE BARE FORM OPENS A PICKER.**
>
> Verbatim from `claude --help`: *"-r, --resume [value] — Resume a conversation by session ID, or open interactive picker with optional search term."* The square brackets are the whole problem: **the value is optional to the CLI**, so `claude --resume` with nothing after it **does not error**. It drops a session picker into the pane and waits for a human who is not looking at that pane — a session that appears hung, forever, with no log line anywhere.
>
> The guard is explicit and unconditional, and it lives in the adapter rather than in a caller, because a caller that has nothing to pass is exactly the caller that will pass nothing:
>
> ```ts
> // ⚠ THE VALUE IS OPTIONAL TO THE CLI, SO AN EMPTY POINTER DOES NOT FAIL —
> // IT OPENS AN INTERACTIVE PICKER IN A PANE NOBODY IS WATCHING. No value,
> // no flag. (D143(e).)
> if (id.length > 0) args.push('--resume', id)
> ```

### codex (codex-cli 0.147.0)

```
codex resume [OPTIONS] [SESSION_ID] [PROMPT]
    [SESSION_ID]  Session id (UUID) or session name. UUIDs take precedence if it parses.
    --last        Continue the most recent session without showing the picker
    --all         Show all sessions (disables cwd filtering)
```

**There is no launch-time id assignment.** `codex --help` has no `--session-id` equivalent. Discovery is the only route, and per **F57** `~/.codex/session_index.jsonl` carries no `cwd`, so the rollout file's first-line `session_meta` record is the only verified discovery surface.

> **⚠ ONE FACT THIS SPEC DOES NOT KNOW AND THE IMPLEMENTER MUST MEASURE: WHERE `-c` MAY LEGALLY SIT RELATIVE TO THE `resume` SUBCOMMAND.**
>
> `codex.ts:110`'s `buildLaunch` builds `args = [...cli.args, ...CODEX_BASELINE_ARGS]` at `:121`, and the surrounding comment records **why `CODEX_BASELINE_ARGS` comes first**: it makes the baseline a genuine prefix of every codex command line, which is what lets every "base + extras" assertion in `adapters.test.ts` stay an exact-equality pin instead of reasoning about a tail. **Inserting a subcommand changes that.**
>
> Two orderings are possible and only measurement decides:
> - `codex -c … resume <id>` — root-level global options before the subcommand;
> - `codex resume -c … <id>` — options after the subcommand.
>
> **Measure both against the installed binary before writing either.** And measure the consequence, not just the exit code: **if `-c` overrides are silently dropped in the resume position, then a resumed codex session loses its OpenRouter route, its effort override and its status line — which is "a different session wearing the same pane", the exact failure D139 exists to prevent.** `codex.ts`'s own status-line warning records that a misplaced `-c` key was accepted **with no error, no warning and no log**, and the status line was simply unchanged. Assume nothing about silence here.

## 4. `types.ts` — the edits

### 4.1 The ruled contract, verbatim

Reproduce the ruling's TypeScript. It is the authority for shape and naming:

```ts
export interface AssignedResumeDescriptor {
  /**
   * Retained from the existing declared descriptor surface.
   * It is not the assign-versus-discover discriminator.
   */
  readonly mode: DescriptorMode
  readonly kind: 'assigned'
  readonly cliFlag: string | null
}

export interface DiscoveredResumeDescriptor {
  readonly mode: DescriptorMode
  readonly kind: 'discovered'
  readonly cliFlag: string | null
}

export type ResumeDescriptor =
  | AssignedResumeDescriptor
  | DiscoveredResumeDescriptor

/**
 * A modifier on the single buildLaunch path.
 *
 * Assigned/create is used by Claude for a fresh conversation whose vendor id
 * Chorus minted. Resume is used for an existing persisted vendor id.
 */
export type AgentSessionLaunch =
  | {
      readonly strategy: 'assigned'
      readonly action: 'create' | 'resume'
      readonly agentSessionId: string
    }
  | {
      readonly strategy: 'discovered'
      readonly action: 'resume'
      readonly agentSessionId: string
    }

export interface DiscoverSessionContext {
  readonly cwd: string
  /** Epoch milliseconds captured immediately before the fresh PTY spawn.
   *  Discovery must not accept an older rollout as this launch's result. */
  readonly launchedAt: number
  /** Aborted on app quit, session disposal, restart, or superseding spawn.
   *  An aborted result must never be persisted. */
  readonly signal: AbortSignal
}

export type ResumeFailureReason =
  | 'not-found'
  | 'in-use'
  | 'transcript-unavailable'
  | 'unusable-pointer'

export interface ResumeExitObservation {
  readonly exitCode: number | null
  readonly signal: string | null
  readonly output: string
}

export type SupportsResume = AssignedResumeSupport | DiscoveredResumeSupport

// DELETE:
// export interface ResumeSpec { sessionId: string; cwd: string }
// export interface SupportsResume { resumeSession(spec: ResumeSpec): PtyLaunchRequest }
```

`PtyLaunchSpec` (`:233`) gains a **ninth** field, appended after `hooks?`:

```ts
  /**
   * Phase 4a / D139: the agent conversation this launch belongs to.
   *
   * ⚠ IT IS THE AGENT-SESSION LAUNCH MODIFIER, AND A FIELD NAMED `resume`
   * LEGALLY CONTAINS A `create`. That is the ruling's own deliberate cost:
   * Claude must receive the Chorus-minted id on its FIRST launch, not only on
   * a restore, and the alternative was a second launch API that would rebuild
   * credential, route, effort, extraArgs and hook handling beside this one.
   * All three council members raised the naming objection and all three
   * accepted it. DO NOT "fix" it with a second field.
   *
   * Absent — the overwhelmingly common case today, and the only case codex
   * ever sees on a fresh launch — means "a fresh conversation, named by
   * whatever the CLI chooses", and argv MUST then be byte-identical to what
   * HEAD produced. That identity is a test, not a hope: every launch in the
   * app flows through here.
   *
   * ⚠ THE TWO CLAUDE ACTIONS ARE MUTUALLY EXCLUSIVE AT THE CLI, NOT MERELY BY
   * CONVENTION. `--session-id` REFUSES an id that already exists ("Session ID
   * … is already in use.") and `--resume` REQUIRES one that does. An adapter
   * that emits both has emitted a guaranteed failure.
   */
  readonly resume?: AgentSessionLaunch
```

### 4.2 `ResumeExitObservation.output` — the amendment (a) documentation

**This comment is a deliverable of the task, not decoration.** The findings specify `output` only as *"the bounded terminal text needed for adapter-local failure recognition"* and *"must not be logged by this contract"* — they do not say **which** terminal text, and there are two candidates in this codebase:

```ts
export interface ResumeExitObservation {
  readonly exitCode: number | null
  readonly signal: string | null
  /**
   * The bounded terminal text needed for adapter-local failure recognition.
   *
   * ⚠ IT IS THE POST-SCRUB STRING FROM THE SINGLE EMIT PATH IN
   * `services/sessionOutput.ts`, NOT RAW PTY BYTES. (D143(a).)
   *
   * A failure classifier reading session output is a NEW CONSUMER OF SESSION
   * TEXT, and D45(1) makes scrubbing a property of "a session emits text": ONE
   * `scrubber.push()` per chunk, whose single result feeds the ring buffer,
   * the renderer broadcast and the disk mirror. This must hang off that same
   * computed string.
   *
   * ⚠ A TAP ON RAW PTY BYTES HERE IS F26'S EXACT SHAPE — the live A/B that
   * found unredacted output reaching a new destination the moment a new
   * destination was added. Vendor error strings are not credentials, but this
   * contract is GENERIC and the next adapter's failure output is not ours to
   * predict.
   *
   * ⚠ AND IT MUST NOT BE LOGGED. The classifier reads it, returns a reason,
   * and the string goes nowhere else.
   *
   * The TYPE and this constraint ship in 4a-2. The WIRING — capturing bounded
   * output off the emit path and handing it to the classifier — is 4a-3's, and
   * 4a-3 must satisfy this without adding a second emit point.
   */
  readonly output: string
}
```

### 4.3 The support interfaces and the guard

```ts
/**
 * Implemented by an adapter whose CLI accepts a Chorus-minted conversation id
 * at launch (claude's `--session-id`). Deterministic: no discovery, no
 * watcher, no race — which is why `discoverSessionId` is FORBIDDEN here rather
 * than merely unused. `?: never` is the compile-time half of that; the guard
 * below is the runtime half, and `adapters.test.ts` asserts it.
 */
export interface AssignedResumeSupport {
  readonly discoverSessionId?: never
  /** Returns a reason only for a FAILED assigned/resume launch. A clean exit,
   *  and every ordinary end of an ordinary session, returns null. */
  classifyResumeFailure(observation: ResumeExitObservation): ResumeFailureReason | null
}

/**
 * Implemented by an adapter whose CLI names its own conversation and must be
 * asked afterwards what it chose (codex). Discovery is ADAPTER-OWNED because a
 * SessionManager that reads rollout headers is shared code that has learned a
 * vendor file format — the ruling's Q2 reasoning applied to files instead of
 * argv.
 */
export interface DiscoveredResumeSupport {
  /** ⚠ BOUNDED AND ABORTABLE, AND IT OWNS NO TIMER OF ITS OWN. `context.signal`
   *  is aborted on quit, restart, disposal or a superseding spawn, and an
   *  aborted result must never be persisted. `null` means "not found, not
   *  certain, or not in time" — all three are the same answer, because a wrong
   *  pointer resumes SOMEONE ELSE'S CONVERSATION INTO THIS PANE and an empty
   *  one costs a manual relaunch (D140). Reads rollout-file `session_meta`
   *  headers ONLY; never `session_index.jsonl`, which carries no cwd (F57).
   *  4a-3 owns when this is called. */
  discoverSessionId(context: DiscoverSessionContext): Promise<string | null>
  classifyResumeFailure(observation: ResumeExitObservation): ResumeFailureReason | null
}
```

The guard replaces `types.ts:621` **in place**, keeping the explanatory comment block above it:

```ts
/**
 * ⚠ TASK 4a-2 REPLACED THE NAME-PAIRING WITH A STRUCTURAL CHECK (CR-4a.0 Q5).
 * The old form asked "is there a method called `resumeSession`?" — a question
 * about a name. This asks whether the adapter provides what its OWN DECLARED
 * KIND requires: `assigned` forbids discovery, `discovered` requires it, and
 * both must classify their failures. D34 Q1's invariant is unchanged and the
 * check is strictly stronger.
 */
export function supportsResume(a: BaseAgentAdapter): a is BaseAgentAdapter & SupportsResume {
  const descriptor = a.getCapabilities().sessionResume
  if (descriptor === null) return false
  const ext = a as Partial<AssignedResumeSupport & DiscoveredResumeSupport>
  if (typeof ext.classifyResumeFailure !== 'function') return false
  return descriptor.kind === 'assigned'
    ? ext.discoverSessionId === undefined
    : typeof ext.discoverSessionId === 'function'
}
```

### 4.4 ⚠ THE TWO PLACES THE RULED TYPESCRIPT DOES NOT FIT THIS TREE

**Both are repository facts no council member could see, and both are recorded rather than silently "improved".**

**(i) The guard keeps its `BaseAgentAdapter &` intersection.** The findings write `supportsResume(adapter: unknown): adapter is SupportsResume`, which **drops** the intersection the current guard carries at **`types.ts:621`**. Its two siblings — `supportsMcp` (`:606`) and `supportsHooks` (`:614`) — both narrow to `BaseAgentAdapter & …`, and **4a-3's call sites need `buildLaunch` off the same value they just narrowed.** A guard returning bare `SupportsResume` would force a cast back at every use, which is how a narrowing helper becomes a decoration. **D143's recorded correction; keep the intersection.**

**(ii) `sessionResume` is NOT a direct property of an adapter, so the support interfaces must not declare it as one.** The findings' `AssignedResumeSupport` opens with `readonly sessionResume: AssignedResumeDescriptor`. **In this tree the descriptor lives on the return value of `getCapabilities()`** — `claude.ts:100` and `codex.ts:82` are both inside that method — and `SupportsHooks` (`types.ts:565`) declares **only** `writeHooksConfig`, with no descriptor member, which is the house pattern. Declaring `sessionResume` as an adapter property would:

- make claude and codex fail to satisfy their own interfaces (the property does not exist on the object);
- and, if "fixed" by adding one, **bypass `capabilities.ts:35`**, where a detected override is merged over the static descriptor — the guard would then read a stale descriptor while `getCapabilities()` returned a live one.

So the support interfaces carry **methods only**, and the guard reads the descriptor through `getCapabilities()`, exactly as its two siblings do. **The ruling's intent is preserved in full** — the kind/method linkage is enforced, just at the guard rather than in the interface.

**A consequence 4a-3 should know:** after `supportsResume(a)` narrows, `a.discoverSessionId` has type `((c: DiscoverSessionContext) => Promise<string | null>) | undefined`, and `typeof a.discoverSessionId === 'function'` narrows it the rest of the way — which is precisely why the council could rule that a separate `supportsDiscover()` guard is unnecessary. `?: never` on the assigned side is what makes the union discriminable by presence.

### 4.5 `capabilities.ts`

**Probably no edit.** `:35` merges `sessionResume` as an opaque field and the discriminated type flows through unchanged. **Verify by compiling, not by reading.** One property worth stating in review: a detected override supplying a descriptor whose `kind` disagrees with the adapter's methods makes `supportsResume` return **false**. That is correct behaviour, not a bug — the guard doing its job against a probe result.

## 5. `claude.ts`

### 5.1 `buildLaunch` (`:202`)

Append resume argv **after** the existing effort and hook argv are computed, leaving those lines untouched so a no-modifier launch is provably unchanged:

| `spec.resume` | Emitted |
|---|---|
| absent | **nothing — argv byte-identical to HEAD** |
| `{strategy:'assigned', action:'create', agentSessionId}` | `--session-id <agentSessionId>` |
| `{strategy:'assigned', action:'resume', agentSessionId}` | `--resume <agentSessionId>` |
| any modifier with an empty `agentSessionId` | **nothing (amendment (e))** |
| `{strategy:'discovered', …}` | **nothing** — claude is not a discovered adapter; an unreachable case that must degrade to a normal launch rather than throw |

Never both flags. The UUID is **non-secret** and may legally travel in argv (unlike a credential, D33) — but note it *is* world-readable via `Get-CimInstance Win32_Process`, which is acceptable for a conversation id and would not be for anything else.

### 5.2 The descriptor at `:100`

Replace the `sessionResume: null` and **rewrite the comment at `:85`–`:88`**, which currently explains the null by saying the extension method is unimplemented:

```ts
      sessionResume: { mode: 'static', kind: 'assigned', cliFlag: '--resume' },
```

The replacement comment must record: that D34 Q1's honesty rule is **satisfied structurally** now rather than by a method name (Q5); that `kind: 'assigned'` means **Chorus mints the id and writes it down before a byte of output exists** (D140); that `mode: 'static'` is the same "known ahead of time rather than probed" value `CLAUDE_EFFORT` and `CLAUDE_MCP` carry and is **not** a support flag; and that `cliFlag` names the **resume** flag while creation uses `--session-id`, which is why one string cannot describe both.

### 5.3 `classifyResumeFailure`

Adapter-local, pure, no I/O, no logging. It maps **measured** claude output to a generic reason:

| Observed | Reason |
|---|---|
| `No conversation found with session ID: <uuid>` | `'not-found'` |
| `Error: Session ID <uuid> is already in use.` | `'in-use'` |
| transcript missing / unreadable for a stored id | `'transcript-unavailable'` |
| anything else, **including every clean exit** | `null` |

**⚠ `null` IS THE IMPORTANT RETURN AND THE ONE TO TEST HARDEST.** Every ordinary end of every ordinary claude session reaches this function once 4a-3 wires it. A classifier that is generous with reasons turns normal exits into pointer-clearing relaunches with a "context was not restored" badge — the user-visible failure would be **worse than never having shipped resume at all**. Match narrowly, on strings that were measured, with the measurement pasted in a comment beside each.

## 6. `codex.ts`

### 6.1 `buildLaunch` (`:110`)

Resume is a **subcommand**, so the modifier changes argv **shape**, not merely its contents. Requirements:

1. **No modifier → the existing function, unchanged.** `const args = [...cli.args, ...CODEX_BASELINE_ARGS]` (`:121`) and everything after it stays byte-for-byte as today. This is the most-used path.
2. **Modifier present → the `resume` token and the id positional are inserted at the measured position** (§3's open question), and **every other token the normal path would have emitted is preserved** — the baseline `-c tui.status_line=…`, the D47 route overrides, `-m`, and the effort override. Nothing is dropped for a resume.
3. **`cli.args` is `['/c', <shim>]` via `cmd.exe`** (the shim note at `:113`–`:114`, `resolveCli` at `:115`) and stays first regardless. The subcommand goes after the shim, never before it.
4. **Assert no `-c` is used as a continue flag.** Here `-c` is `--config`; on kimi and opencode it **is** `--continue`. The two must not be conflated by a future reader copying this code.
5. **An empty `agentSessionId` emits no subcommand at all** — the same guard as claude's, for the same reason: `codex resume` with no positional shows a **picker**.

### 6.2 The descriptor at `:82`

```ts
      sessionResume: { mode: 'static', kind: 'discovered', cliFlag: null },
```

`cliFlag: null` is now **meaningful rather than a placeholder** — it says "resumption is not flag-driven here", which is exactly true, and `kind` carries the rest. Rewrite the comment at `:71`–`:73`, which currently groups `hooks` and `sessionResume` as both-null-for-the-same-reason. **`hooks` stays null; `sessionResume` does not** — the two must stop sharing a sentence.

### 6.3 `discoverSessionId`

- Reads **rollout-file first-line `session_meta` records only**. **Never `session_index.jsonl`** as identity evidence — F57 measured that it carries `{id, thread_name, updated_at}` and **no `cwd`**, so it cannot answer "the session I just launched in this directory".
- **Requires exact `cwd` equality** against `context.cwd`. Not a prefix, not a case-insensitive compare, not a realpath guess.
- **Enforces `context.launchedAt`** as a lower bound, so an older matching rollout from the same worktree cannot be adopted.
- **Rejects ambiguity.** Two candidates is `null`, not "the newest".
- **Returns `null` on timeout or abort**, and checks `context.signal` before returning.
- **Owns no timer and no watcher**, and writes nothing. Persistence is 4a-3's, after a spawn-generation check.

**Nothing calls it in this task.** It is a function with tests and no caller — the same deliberate shape Task 4a-1 shipped its column in.

### 6.4 `classifyResumeFailure`

Same discipline as claude's: measured strings only, `null` for clean exits, no logging. Capture codex's actual output for an unknown id into `_verify/4a-2/` and quote it in the comment.

## 7. `src/shared/ipc.ts` — amendment (f)

At **`:2219`**:

```ts
export const resumeDescriptorSchema = z.object({
  mode: descriptorModeSchema,
  /** Phase 4a / D139: which mechanism obtains this CLI's conversation id.
   *  'assigned' — the CLI accepts an id Chorus mints (claude --session-id).
   *  'discovered' — the CLI names its own and Chorus must find out (codex).
   *  ⚠ ADDED HERE AS WELL AS IN types.ts BECAUSE z.object STRIPS UNKNOWN KEYS
   *  RATHER THAN REJECTING THEM: a `kind` on the runtime object and not on this
   *  schema would vanish on the wire silently. No renderer reads sessionResume
   *  today (grep-verified) — the schema moves for honesty, per D1. (D143(f).) */
  kind: z.enum(['assigned', 'discovered']),
  cliFlag: z.string().nullable()
})
```

**Do not remove `mode`** (`:2220`). Three council members flagged it as surplus beside `kind`; it is a **validated wire field**, and removing it would be a breaking schema change made for tidiness.

**Not a discriminated union on the wire.** Both variants have identical field shapes apart from the literal, so a flat object with an enum validates exactly the same set of values and keeps `agentCapabilitiesSchema` (`:2224`, field at `:2231`) untouched. **`IpcChannel` stays 86** — no channel is added, and the existing assertions must still pass unchanged.

**Also confirm rather than assume:** `ipc.test.ts:1822`'s capabilities fixture and `noHarness.ts:85` both hold `sessionResume: null`, so neither should need editing — **but a fixture that constructs a non-null descriptor would now fail type-checking**, so compile before concluding.

## 8. Tests — `adapters.test.ts`

### 8.1 The honesty table at `:596`

Currently `it.each(...)('supportsResume is FALSE for %s')` with the `expect` at `:598`, under a comment calling resume _"the only one left that is genuinely false"_. **Rewrite it into the named two-value table idiom the `supportsMcp` block below already uses** — `claude: true, codex: true, kimi: false, opencode: false` — and rewrite the comment to say what changed and why. **The test's purpose is unchanged and must survive: catching a descriptor that drifts from its methods.**

**⚠ FOUR ADAPTERS, NOT FIVE.** `staticRegistry` (`registry.ts:35`) holds exactly `claude`, `codex`, `kimi`, `opencode`. `noHarness` has **no adapter object** to put through a guard — D84 keeps it out of the registry deliberately, and its `sessionResume: null` at `noHarness.ts:85` is asserted where its descriptor is asserted. **The pre-council draft of this spec and its task doc both said "and noHarness" — that was wrong and is corrected here.** The coverage test at `:574` is what stops the new named table from quietly losing a row.

### 8.2 Remove the `['sessionResume', 'resumeSession']` pair

In the `EXTENSION_METHODS` array at **`:908`**, the row itself at **`:911`**. `resumeSession` no longer exists and claude now declares a descriptor without it, so the generic pairing would **fail on a true statement**. **Remove that one row. `['mcp','writeMcpConfig']` and `['hooks','writeHooksConfig']` stay exactly as they are**, and the surrounding comment must record that resume left this table for the structural guard rather than because it was weakened (Q5).

### 8.3 Argv cases — exact, not different

Follow the `:291` / `:408` idiom, whose comments already explain that a copied `buildLaunch` would silently resume a stale session. **Q5 requires the exact expected argv**: `toEqual` on the full array, not `not.toEqual` between two launches.

```
claude · no modifier            → args toEqual the HEAD snapshot, exactly
claude · assigned/create        → exact array containing --session-id <uuid>, and NOT --resume
claude · assigned/resume        → exact array containing --resume <uuid>, and NOT --session-id
claude · empty agentSessionId   → exact array === the no-modifier array; '--resume' absent   (amendment (e))
codex  · no modifier            → args toEqual the HEAD snapshot, exactly
codex  · discovered/resume      → 'resume' token + id positional in the measured order,
                                  AND the baseline/route/effort tokens all still present
kimi   · with a resume field    → args toEqual args without it
opencode · with a resume field  → args toEqual args without it
```

The last two are **Grok's explicit request** and they are the cheapest test in the set: an adapter that silently honours a modifier it never declared is the first risk the ruling names.

### 8.4 Structural support

- every non-null descriptor satisfies `supportsResume()`;
- `codexAdapter.discoverSessionId` is a function; **`claudeAdapter.discoverSessionId` is `undefined`** — asserted explicitly, because `?: never` is a compile-time claim only;
- both capable adapters expose `classifyResumeFailure`;
- `kimi` and `opencode` still declare `sessionResume: null`.

### 8.5 Classifier fixtures

One `describe` per adapter, each case built from a **measured** `ResumeExitObservation`:

```
claude · "No conversation found with session ID: <uuid>"   → 'not-found'
claude · "Error: Session ID <uuid> is already in use."     → 'in-use'
claude · clean exit, ordinary output                        → null
codex  · its measured resume-failure output                 → its reason
codex  · clean exit                                         → null
```

**The `null` rows are not filler.** They are what stops 4a-3 from turning every normal session exit into a pointer-clearing relaunch.

### 8.6 The D139 risk case

Kept from the pre-council spec **because the ruling reduced this risk rather than removing it**: one test that a resume launch carrying **credential + route + hooks** returns a request preserving all three — `secretEnv` populated, route `-c` overrides present, hook argv present. The single launch path makes this structurally likely; the test makes it checked.

## 9. Verification

### 9.1 Build gates

```bash
npm run typecheck && npm test && npm run grep:secrets
```

Baseline to beat: **56 files / 1888 tests**, **0 typecheck errors**, `IpcChannel` **86** (asserted twice in `ipc.test.ts`). **The 53 files / 1837 tests figure in the pre-council docs was `82e16d7`'s and is stale.**

### 9.2 Runtime, and this is where the real evidence lives

**A green build proves the types agree with each other. It proves nothing about the two CLIs, and the two CLIs are the whole task.**

1. **`claude --help`** → capture to `_verify/4a-2/claude-help.txt`, with `claude --version`. Confirm the three flag lines quoted in §3 verbatim, including the **square brackets** on `--resume [value]`.
2. **⚠ The interactive `--session-id` protocol in §3, all five steps, captured (amendment (d)).** This is the acceptance criterion that cannot be satisfied by reading anything.
3. **`codex resume --help`** and **`codex --version`** → captured. Confirm the positional `[SESSION_ID]`.
4. **The `-c`-position measurement from §3** → run both orderings against the real binary and record which one preserves the overrides. **Record the observed behaviour, not just the exit code** — codex has been measured accepting a misplaced `-c` in silence.
5. **Argv byte-identity, all four adapters.** Capture the composed `PtyLaunchRequest.args` for a no-modifier launch **before** the change and **after**, and diff them. A behaviour-neutral claim about the normal launch path is worth exactly as much as the diff that backs it — and amendment (d) means claude's launch path changes for real users the moment 4a-3 lands, so this diff is the last point at which "unchanged" is still cheap to prove.
6. **Wire round-trip.** Parse claude's real `getCapabilities()` through `agentCapabilitiesSchema` and assert `sessionResume.kind` **survived**. `z.object` strips silently; a passing parse is not evidence that a field arrived.
7. **Grep gates.** `resumeSession` and `ResumeSpec` return **zero hits** across `src/`. `services/sessionManager.ts`, `kimi.ts` and `opencode.ts` appear **nowhere** in `git diff --stat`.

## 10. What the commit message must record

- **D139's verdict** — one launch path, `ResumeSpec` and `resumeSession()` deleted — and **D143's four amendments this task carries**, named.
- **That the council was a partial run** (3 of 4 members; GLM 5.2 returned no verdict token on any question), so the ruling's structural agreement signal is thinner than its prose suggests.
- **The interactive `--session-id` verification and its result** (amendment (d)) — the single most load-bearing new fact in the commit.
- Both `--help` captures and the two CLI versions they came from (D4).
- **That `--resume` can never be emitted bare** (amendment (e)), and where the guard is.
- **That `resumeDescriptorSchema` gained `kind` while `IpcChannel` stayed 86** (amendment (f)), and that `mode` was retained deliberately.
- That `ResumeExitObservation.output` is documented as post-scrub (amendment (a)), with the wiring left to 4a-3.
- That `kimi.ts`, `opencode.ts` and `services/sessionManager.ts` are byte-identical to HEAD, and that **nothing calls the new surface**.
- That no-resume argv is unchanged for all four adapters, **with the diff as the evidence**.

# Implementation Spec 4a-2 — The Adapter Resume Contract

_Governs exact contents for `Tasks/Task-4a-2.md`. **Everything below is CONDITIONAL on D139** — it is written against the coordinator's preferred shape (hybrid (A)), and must be re-read against the council's actual verdict before use. Where the council overrules a construct here, the council wins and this spec is amended, not worked around._

## 1. Verified starting state (`82e16d7`, 2026-08-12)

| Symbol | Line | Current state |
|---|---|---|
| `PtyLaunchSpec` | `types.ts:233` | 8 readonly fields, ending `hooks?` at `:265` |
| `ResumeDescriptor` | `types.ts:180` | `{ mode: DescriptorMode, cliFlag: string \| null }` |
| `ResumeSpec` | `types.ts:351` | `{ sessionId, cwd }` — **two fields** |
| `SupportsResume` | `types.ts:574` | `resumeSession(spec: ResumeSpec): PtyLaunchRequest` |
| `supportsResume` guard | `types.ts:621` | requires descriptor **non-null** AND method present |
| `claude` capability | `claude.ts:100` | `sessionResume: null`, with a comment naming D34 Q1 as the reason |
| `codex` capability | `codex.ts:82` | `sessionResume: null`, same reason |
| Honesty test | `adapters.test.ts:596` | asserts `supportsResume` **false** for every adapter |

## 2. The CLI facts this spec encodes

**Verified live 2026-08-12. Re-verify at implementation time (D4) — these are the whole basis of the task.**

### claude

```
--session-id <uuid>    Use a specific session ID for the conversation (must be a valid UUID)
-r, --resume [value]   Resume a conversation by session ID, or open interactive picker
--fork-session         When resuming, create a new session ID instead of reusing the original
```

Observed behaviour:

| Action | Result |
|---|---|
| `--session-id <fresh uuid>` | session created under that exact id; transcript at `~/.claude/projects/<munged-cwd>/<uuid>.jsonl` |
| `--resume <uuid>` | **context genuinely restored** — recalled a word planted in the prior turn |
| `--session-id <live uuid>` | `Error: Session ID <uuid> is already in use.` |
| `--resume <unknown uuid>` | `No conversation found with session ID: <uuid>` |

**`--session-id` and `--resume` are mutually exclusive by construction** — the first refuses an id that exists, the second requires one that does. The adapter must never emit both.

### codex (codex-cli 0.147.0)

```
codex resume [OPTIONS] [SESSION_ID] [PROMPT]
    [SESSION_ID]  Session id (UUID) or session name. UUIDs take precedence if it parses.
    --last        Continue the most recent session without showing the picker
    --all         Show all sessions (disables cwd filtering)
```

**There is no launch-time id assignment.** `codex --help` has no `--session-id` equivalent. Discovery is the only route, and it is 4a-3's job — but the adapter must declare that this is the mechanism.

## 3. `types.ts` — the three edits

### 3.1 `PtyLaunchSpec` gains one optional field

Append after `hooks?` (`:265`):

```ts
  /**
   * Phase 4a / D139: the conversation this launch belongs to.
   *
   * Absent — the overwhelmingly common case — means "a fresh conversation,
   * named by whatever the CLI chooses", and argv MUST then be byte-identical
   * to what HEAD produced. That identity is a test (4a-2 acceptance 4), not a
   * hope: every launch in the app flows through here.
   *
   * ⚠ THE TWO MODES ARE MUTUALLY EXCLUSIVE AT THE CLI, NOT MERELY BY
   * CONVENTION. `claude --session-id` REFUSES an id that already exists
   * ("Session ID … is already in use.") and `--resume` REQUIRES one that
   * does. An adapter that emits both has emitted a guaranteed failure.
   */
  readonly resume?: PtyLaunchResume
```

with:

```ts
export interface PtyLaunchResume {
  /** 'assign' — this is a NEW conversation and Chorus is naming it up front.
   *  'reopen' — this conversation already exists in the CLI's own store. */
  readonly mode: 'assign' | 'reopen'
  /** The AGENT's id, never Chorus's session row id. For 'assign' it is a
   *  freshly minted UUID; for 'reopen' it is what `sessions.agent_session_id`
   *  held. */
  readonly agentSessionId: string
}
```

### 3.2 `ResumeDescriptor` widens to express mechanism

`{mode, cliFlag}` cannot distinguish "Chorus names it" from "Chorus must go find out what it was named", and 4a-3 branches on exactly that. Add one field:

```ts
export interface ResumeDescriptor {
  readonly mode: DescriptorMode
  /** e.g. '--resume'; null when resumption is not CLI-flag driven — which is
   *  codex's case, where resume is a SUBCOMMAND (`codex resume <id>`). */
  readonly cliFlag: string | null
  /**
   * Phase 4a / D140: how this CLI's conversation id is OBTAINED.
   *
   *  'assign-at-launch'      — the CLI accepts an id we choose (claude's
   *                            `--session-id`). Deterministic; no discovery,
   *                            no watcher, no race.
   *  'discover-after-launch' — the CLI names its own conversation and Chorus
   *                            must find out what it picked (codex).
   *
   * ⚠ 4a-3 BRANCHES ON THIS, so it is a capability rather than a hardcoded
   * `if (agent === 'codex')` in the session manager. The asymmetry is a
   * property of the CLI and belongs with the other properties of the CLI.
   */
  readonly idSource: 'assign-at-launch' | 'discover-after-launch'
}
```

### 3.3 `SupportsResume` — redefined, not deleted

The declared `resumeSession(spec: ResumeSpec): PtyLaunchRequest` cannot stand: `ResumeSpec` is two fields and `buildLaunch` needs eight. **Redefine `ResumeSpec` as an alias of the full launch spec plus a required resume**, so codex's subcommand path loses nothing:

```ts
/** Phase 4a / D139: a resume is a LAUNCH with a known conversation, not a
 *  parallel universe with its own two-field vocabulary. Superseding the
 *  original `{sessionId, cwd}` — which could not carry credential, route,
 *  effort, extraArgs or hooks, every one of which buildLaunch receives, and
 *  a resumed session that silently drops its BYOK credential or its
 *  OpenRouter route is a DIFFERENT session wearing the same pane. */
export type ResumeSpec = PtyLaunchSpec & { readonly resume: PtyLaunchResume }

/** Implemented ONLY by adapters whose resume changes the argv SHAPE rather
 *  than adding a flag — i.e. `idSource: 'discover-after-launch'` CLIs with a
 *  subcommand form. A flag-driven CLI (claude) needs none of this: its
 *  buildLaunch handles `spec.resume` inline. */
export interface SupportsResume {
  resumeSession(spec: ResumeSpec): PtyLaunchRequest
}
```

The `supportsResume` guard at `:621` needs **no change** — it already checks descriptor-non-null AND method-present, which is exactly D34 Q1.

> **⚠ NOTE FOR THE COUNCIL.** This hybrid means `claude` declares a non-null descriptor but implements **no** `resumeSession` method, so `supportsResume(claudeAdapter)` is **false while claude demonstrably supports resume**. That is a genuine wart and question 2 of the brief exists because of it. The alternative — a trivial `resumeSession` on claude that just delegates to `buildLaunch` — restores the guard's meaning at the cost of a pass-through method. **The coordinator leans toward the delegating method**; the council should rule.

## 4. `claude.ts`

In `buildLaunch`, where argv is assembled, branch on `spec.resume`:

| `spec.resume` | Emit |
|---|---|
| absent | nothing — **argv byte-identical to HEAD** |
| `{mode: 'assign', agentSessionId}` | `--session-id <agentSessionId>` |
| `{mode: 'reopen', agentSessionId}` | `--resume <agentSessionId>` |

Never both. The UUID is **non-secret** and may legally travel in argv (unlike a credential, D33) — but note it *is* world-readable via `Get-CimInstance Win32_Process`, which is acceptable for a conversation id and would not be for anything else.

Replace the `sessionResume: null` at `:100` and rewrite the comment above it that currently explains the null. The comment must now record the opposite fact and keep the D34 Q1 reasoning visible:

```ts
      sessionResume: { mode: 'static', cliFlag: '--resume', idSource: 'assign-at-launch' },
```

## 5. `codex.ts`

Resume is a **subcommand**, so the request's `args` begin `['resume', '<uuid>', …]` rather than the normal prompt-first shape. Implement `resumeSession(spec)`:

1. Build the normal request via the existing `buildLaunch` internals — **do not re-derive env, route or effort**; that duplication is precisely what D139 rejects.
2. Rewrite `args` to put `resume` and the positional id first, preserving every other token the normal path would have emitted.
3. **Assert no `-c` is present.** `codex.ts` already carries a warning that `-c` means `--continue`; here it would additionally collide with `-c/--config`. A test must cover it.

Descriptor:

```ts
      sessionResume: { mode: 'static', cliFlag: null, idSource: 'discover-after-launch' },
```

`cliFlag: null` is now **meaningful rather than a placeholder** — it says "not flag-driven", which is exactly true, and `idSource` carries the rest.

## 6. Tests — `adapters.test.ts`

### The honesty table at `:596` must be updated, not deleted

It currently reads that `supportsResume` is _"the only one left that is genuinely false"_ for every adapter. Rewrite it as a two-column table: **true** for the resume-capable adapters (per D139's ruling on the claude wart), **false** for `kimi`, `opencode`, `noHarness`. The test's purpose — catching a descriptor that drifts from its method — is unchanged and must survive.

### Argv cases

Follow the `:291` / `:408` idiom, whose comments already explain that a copied `buildLaunch` would silently resume a stale session.

```
claude · no resume        → argv identical to the HEAD snapshot
claude · assign           → contains --session-id <uuid>, does NOT contain --resume
claude · reopen           → contains --resume <uuid>, does NOT contain --session-id
codex  · no resume        → argv identical to the HEAD snapshot
codex  · resumeSession    → args[0] === 'resume', args[1] === <uuid>, no '-c'
kimi/opencode             → supportsResume false; files untouched
```

### The D139 risk case

One test that a resume request carrying **credential + route + hooks** returns a request preserving all three. This is the failure mode the whole decision turns on; it must be executable, not a review comment.

## 7. Verification

```bash
claude --help | grep -E -- "--session-id|--resume|--fork-session"  # capture to _verify/4a-2/
codex resume --help                                                 # capture
codex --version                                                     # record
npm run typecheck && npm test && npm run grep:secrets
```

**Argv byte-identity (acceptance 4) is the one that needs real evidence.** Capture the composed `PtyLaunchRequest.args` for a no-resume launch of all five adapters before and after the change and diff them. A behaviour-neutral claim about the normal launch path is worth exactly as much as the diff that backs it.

## 8. What the commit message must record

- D139's verdict, and which of (A)/(B)/hybrid shipped.
- The two `--help` outputs captured, and the codex version they came from (D4).
- That `kimi.ts`, `opencode.ts` and `sessionManager.ts` are byte-identical to HEAD.
- That no-resume argv is unchanged, with the diff as evidence.

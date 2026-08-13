# Council Brief CR-4a.0 — The Session-Resume Contract for Chorus Adapters

**⚠ ANSWER THESE QUESTIONS. DO NOT REVIEW THIS DOCUMENT.** This brief is context, not the artefact under review. Your output is a committed answer to each numbered question in section 8, in the format section 10 specifies. Do not critique the brief's structure, wording or completeness; do not propose edits to it. If a question cannot be answered from what is here, say which fact is missing and answer the rest.

Registered as decision **D139** in `docs/Features/Foundation/roadmap.md` §6, status **PENDING COUNCIL**. It blocks Tasks 4a-2 and 4a-3. Two of Phase 4a's four tasks have already shipped; this decision is the only thing preventing the other two.

## 1. What Chorus is

A local-first, BYOK Windows desktop app (Electron + Vue 3 + TypeScript) for running several AI coding agents in parallel terminal panes. Each pane is a real PTY running a vendor CLI — today `claude` (Claude Code), `codex`, `kimi` and `opencode`. Sessions live in the MAIN process, owned by `SessionManager`; panes are views that attach to a `sessionId` over typed, Zod-validated IPC. The renderer never spawns a process and never sees a credential. An **adapter** is the per-agent object that knows how that CLI starts: `buildLaunch(spec)` returns the executable, argv and environment for one launch.

## 2. Why this decision exists now

A user reboots overnight or quits to install an update, and loses the conversations in every pane. Chorus already restores the *panes* — rows, layout and relaunch under the original ids have worked since Task 1-5 (decision D16). What does not come back is what the agent knew. The agents themselves already persist their conversations: Claude Code writes `~/.claude/projects/<munged-cwd>/<session-uuid>.jsonl`, codex writes `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`. Both were confirmed present on the development machine on 2026-08-12. So Chorus does not need to store conversations — it needs to store a **pointer** and hand it back on relaunch.

That pointer now exists. Migration **v19** landed on 2026-08-13 (commit `bbf6d32`) adding a nullable `sessions.agent_session_id` column plus three accessors, and it is **deliberately dormant — nothing reads or writes it**. The schema was landed separately precisely so this interface question could be taken slowly. What remains is the contract by which an adapter says "resume this conversation", and that contract as currently declared does not fit.

## 3. Current implementation state (verified 2026-08-13, commit `a6fab79`)

**The declared-but-unimplemented resume surface.** Three declarations were written in Phase 3 ahead of any caller. All are live in `src/main/adapters/types.ts` today:

```ts
// :180 — the capability descriptor
export interface ResumeDescriptor {
  readonly mode: DescriptorMode          // 'static' | 'dynamic'
  readonly cliFlag: string | null        // e.g. '--resume'; null when not CLI-flag driven
}

// :351 — what an adapter would be told
export interface ResumeSpec {
  readonly sessionId: string
  readonly cwd: string
}

// :574 — the extension interface
export interface SupportsResume {
  resumeSession(spec: ResumeSpec): PtyLaunchRequest
}
```

**What a launch actually needs, by contrast.** `PtyLaunchSpec` (`types.ts:233`) carries nine fields, and `buildLaunch` receives all of them:

```ts
export interface PtyLaunchSpec {
  readonly sessionId: string
  readonly cwd: string
  readonly modelId?: string
  readonly effortOptionId?: string
  readonly extraArgs?: readonly string[]
  readonly credential?: ResolvedCredential
  readonly route?: PtyLaunchRoute
  readonly hooks?: PtyLaunchHooks
}
```

The single call site is `sessionManager.ts:619`, and it passes seven of them on every launch — `sessionId`, `cwd`, `credential`, `route`, `effortOptionId`, `extraArgs`, `hooks`. **`ResumeSpec` can carry two of the seven.** An adapter implementing `resumeSession()` as declared would therefore have to rebuild credential injection, route selection, effort mapping, raw-argument passthrough and hook wiring from scratch, beside `buildLaunch`, with no access to the values.

**Nobody implements it, and the code says why.** All four PTY adapters declare `sessionResume: null`. `claude.ts:85` states the reason in its own words: *"sessionResume: NULL even though `-r/--resume` exists — the extension METHOD is unimplemented, and D34 Q1 makes 'declared' and 'implemented' one fact: a non-null descriptor without its method fails the capability-honesty test."* `codex.ts:71` says the same for its `resume` subcommand. So the honesty rule is already load-bearing and already being obeyed.

**The two CLIs are not symmetrical, and this was measured live on 2026-08-12, not recalled.** Against the installed `claude` 2.1.229 in a throwaway directory: `claude --session-id <uuid> -p …` created a session and wrote its transcript as `<uuid>.jsonl`; `claude --resume <uuid> -p …` **recalled a word planted in the earlier turn**, so context was genuinely restored; reusing a live id failed with `Error: Session ID <uuid> is already in use.`; an unknown id reported `No conversation found with session ID: <uuid>` and exited cleanly. Against `codex-cli` 0.147.0: resume is a **subcommand**, `codex resume [SESSION_ID] [PROMPT]` with `--last` and `--all`, and **there is no launch-time id option at all**. So Chorus can *assign* Claude's id but must *discover* codex's.

**Discovery has one honest source, and it is not the index (finding F57).** `~/.codex/session_index.jsonl` carries only `{id, thread_name, updated_at}` — **no `cwd`** — so it cannot answer "which session did I just start in this directory", and Chorus launches concurrent agents in sibling worktrees by design. The rollout file's first line is a `session_meta` record carrying `session_id`, `cwd`, `originator`, `cli_version` and `source`. That header is the only verified discriminator.

**The third row above is why a second column was needed at all.** Chorus session-row ids are already `randomUUID()`, so passing the row id as `--session-id` was the tempting zero-schema design. It cannot work: `session:restart` and `restore()` both reuse the row id deliberately (that is D16's stable-identity contract), and the second launch under that id would fail outright.

## 4. Binding prior rulings — constraints on your answer, not open questions

- **D16** — session identity is the `sessions` row id, stable across PTY re-creation. Restart and restore both reuse it. Clause 4 makes restart a deliberate fresh conversation.
- **D33** — a decrypted credential is injected as an environment variable into the child PTY at launch, never in argv, never written to disk, never logged. Env policy has exactly one owner: the `composeChildEnv` call inside `SessionManager.spawn`.
- **D34 Q1** — capability honesty: a non-null descriptor without its implementing method is a defect. `declared` and `implemented` are one fact, asserted per adapter in `adapters.test.ts`.
- **D45(1) / F26** — scrubbing is a property of "a session emits text", not "a PTY emits text". F26 was a live A/B that found unredacted output reaching a new destination.
- **D140 (RESOLVED)** — Claude assigns, codex discovers, and the capability declares which. A discovered id is written only after a positive `cwd` match on the rollout header. **This is settled; you are not being asked to revisit it.** You are being asked how the *contract* should express it.
- **D142 (RESOLVED for the pointer)** — `session:restart` rotates the pointer and `restore()` preserves it, which is why `clearAgentSessionId` is its own named method rather than a nullable setter.
- **No resume for `kimi` or `opencode`.** Both adapter files carry explicit warnings that their `-c` flag means `--continue` and would silently resume a stale session. They keep `sessionResume: null` and are untouched by this phase.
- **Locked stack.** Electron, Vue 3, TypeScript, xterm.js, node-pty, better-sqlite3, Zod on all IPC. No new dependencies. Windows-only v1.
- **`IpcChannel` is at 86 and Phase 4a adds no channel.** Whatever you propose must not require a new renderer-facing channel.

## 5. The decision

### Q1 — The core shape: one launch path, or two?

The proposal on the table is that **`PtyLaunchSpec` gains an optional `resume` field**, so `buildLaunch` remains the single launch path and resumption becomes a *modifier* on a launch rather than a parallel kind of launch. The alternative that already exists in the type system is `SupportsResume.resumeSession(spec)`, a second entry point returning its own `PtyLaunchRequest`. A third option is a hybrid: keep `resumeSession` but widen `ResumeSpec` until it is `PtyLaunchSpec` plus an id, which raises the question of why two types exist. Give the exact TypeScript you would write today, and the strongest argument against it.

### Q2 — Where codex's argv-shape change lives

Claude resumes with a flag appended to an otherwise identical command line. Codex resumes with a **different argv shape entirely** — `codex resume <id>` puts a subcommand in first position, before every other argument. A design that assumes "resume is a flag you append" fits one of the two CLIs and breaks on the other. Does that variation belong inside each adapter's own `buildLaunch` branching, in a redefined `SupportsResume`/`ResumeSpec` retained specifically to express it, or in a richer `ResumeDescriptor` that the launch path reads? Name the owner and say what the other two lose.

### Q3 — How the contract expresses assign-versus-discover

D140 settles the behaviour: Claude's id is minted by Chorus before launch, codex's is discovered afterwards by matching `cwd` in a rollout header. But the *interface* has to carry that asymmetry somehow. Options include a discriminated `ResumeDescriptor` (`{kind: 'assigned'} | {kind: 'discovered'}`), an optional adapter method such as `discoverSessionId(cwd, since): Promise<string | null>`, or leaving discovery entirely outside the adapter in a codex-specific service. If you add a method, give its exact signature and say **when** it is called and what happens if it is still running when the user quits.

### Q4 — Failure semantics when resume does not work

A resume attempt can fail in at least four measured ways: the id is unknown to the CLI (Claude exits cleanly with a message), the id is already in use (Claude errors), the transcript file has been deleted or pruned by the vendor, or discovery finds no `cwd` match. What is the contract's required behaviour? Silently fall back to a fresh session; start fresh but tell the user in the pane; or refuse to launch and make the user choose? Note that Chorus already ships a "Session restarted" badge for the fresh-conversation case, and that a silent fallback means a user believes they have context they do not have.

### Q5 — What earns the `sessionResume` descriptor under the new shape

D34 Q1 makes a non-null descriptor without its implementing method a defect, and `adapters.test.ts` asserts the pairing `['sessionResume', 'resumeSession']` explicitly. If resume becomes a **field on `PtyLaunchSpec`** rather than a method on an extension interface, there is no `resumeSession` to pair with. What replaces the honesty test? Does `SupportsResume` survive as a marker, does the pairing move to something else, or does the test change shape? Say what `supportsResume()` — the runtime type guard at `types.ts:621` — should do afterwards.

### Q6 — Option-fixation check

Name any load-bearing alternative shape this brief has not considered, or state plainly that there is none. Only propose an alternative if you would actually argue for it; do not enumerate for completeness.

### Q7 — Restart's scrollback semantics

Separate from the pointer, and currently unruled. Chorus now mirrors each session's terminal scrollback to a file and replays it when a pane is restored. Because `session:restart` goes through the same `spawn()` path, a restarted pane **currently re-seeds and shows its prior scrollback**, even though D16 clause 4 makes restart a deliberate fresh conversation. That is terminal-like — restarting a shell does not wipe what is above the prompt — but nothing rules on it. Should restart clear the scrollback mirror as it clears the pointer, keep it, or keep it behind a visible separator?

## 6. Constraints the winner must survive

- **One launch path for credentials.** Whatever shape wins, there must remain exactly one place where a decrypted credential is turned into child environment, because D33's guarantee is enforced structurally rather than by review.
- **One place session text fans out.** The output pipeline has one emit path with three consumers; a resumed session must not introduce a second.
- **No new IPC channel, no renderer change, no new dependency.**
- **`kimi` and `opencode` keep `sessionResume: null`** and must not be forced to implement anything.
- **A wrong pointer is worse than no pointer.** Resuming someone else's conversation into a pane is a data-exposure event; starting fresh is a minor annoyance. Any ambiguity resolves toward "start fresh".
- **The column is nullable and means it.** Every pre-v19 row reads NULL and starts fresh exactly once; there is no backfill and none is wanted.
- **It must be implementable by two more tasks**, 4a-2 (the contract plus the two adapters) and 4a-3 (the wiring), each landing as one reviewable commit.

## 7. Evaluation rubric (weigh in this order)

1. Correctness under the D33 credential rule and the D16 identity contract.
2. Resistance to drift — how hard is it for a future change to update one launch path and forget the other?
3. Honesty of the capability surface: can an adapter declare something it does not do?
4. Fit to the measured CLI facts, especially codex's subcommand shape and its missing `cwd` index.
5. Failure behaviour that never silently misleads the user about what the agent remembers.
6. Implementation cost across exactly two tasks, and reviewability of the resulting diff.

## 8. Questions for the council

1. Q1: `PtyLaunchSpec.resume` versus `resumeSession()` versus a named hybrid — give the exact TypeScript you would write today and the strongest argument against it.
2. Q2: where codex's subcommand argv shape lives — adapter branching, a redefined `SupportsResume`, or a richer `ResumeDescriptor` — and what the rejected owners lose.
3. Q3: how the interface expresses assign-versus-discover, with the exact signature and timing of any method you add.
4. Q4: a ruling on resume failure — silent fresh start, visible fresh start, or refuse — covering unknown id, id in use, missing transcript and failed discovery.
5. Q5: what replaces the D34 Q1 honesty pairing if resume stops being a method, and what `supportsResume()` should do afterwards.
6. Q6 as posed: load-bearing alternative shapes only, or an explicit none.
7. Q7: whether `session:restart` should clear, keep, or visibly separate the scrollback mirror it currently re-seeds.

## 9. Success criteria for this council session

The session **succeeds** if it returns one committed answer per question, or an explicit tie with the tie-breaker named; **the resume contract written out as TypeScript that compiles against the interfaces quoted in section 3**; a statement of which adapter files change and which do not; and the failure-behaviour ruling from Q4 in a form Task 4a-2 can implement without further interpretation. It **fails** if it returns a survey of options without a commitment, or if it re-opens D140, D141 or D16.

## 10. Required output format

```
## Per-model positions

<one short block per member: the position taken on each question, no hedging>

## Council synthesis

<the committed answer to Q1-Q7, one paragraph each>

## The contract (verbatim TypeScript, implementable)

<the interfaces as they should be written, compiling against section 3>

## What changes, file by file

<adapter files, types.ts, sessionManager.ts - and what explicitly does NOT change>

## Failure behaviour

<the Q4 ruling, stated as a rule an implementer follows>

## Risks & mitigations for the winner

## Answer to question 6

## Action items for implementation
```

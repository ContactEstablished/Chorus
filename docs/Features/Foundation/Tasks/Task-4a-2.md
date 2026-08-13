# Task 4a-2 — The Adapter Resume Contract (Claude + Codex)

_Phase 4a, task 2 of 4. **One narrated commit (G3).** This task makes two adapters able to say "start this conversation with a known id" and "go back to this conversation" — and makes them stop declaring `sessionResume: null`. **Nothing calls the new surface in this task**; the wiring is 4a-3. This task governs scope; `ImplementationSpecs/ImplementationSpec-4a-2.md` governs exact contents._

> **⛔ COUNCIL REVIEW GATE — DO NOT WRITE CODE FOR THIS TASK UNTIL THE CR HAS RUN AND D139 IS RECORDED AS RESOLVED.**
>
> Roadmap §4 names _"Hard-to-reverse architectural shapes — **adapter interface**"_ as a trigger, and this task changes the adapter interface. Matthew ratified 2026-08-12: docs now, council before implementation. **Tasks 4a-1 and 4a-4 are not gated and may land while the council deliberates.**
>
> The brief's question is §"The decision the council must settle" below. Claude cannot run the council (§4); prepare the brief, pause, and record findings in roadmap §6 as **D139** before proceeding.

## Source Of Truth

- `Tasks/Phase-4a-Overview.md` — §3 (the two CLIs verified live), **D139 (pending)**, **D140**.
- Roadmap §6 **D4** (verify CLI flags against the tool's own `--help`, never training memory — locked in `CLAUDE.md`), **D34 Q1** (declared and implemented are ONE fact), **D46/D47** (route and env ownership), **D52** (adapter registry shape).
- `src/main/adapters/types.ts` — `PtyLaunchSpec` at **:233**, `ResumeDescriptor` at **:180**, `ResumeSpec` at **:351**, `SupportsResume` at **:574**, the `supportsResume` guard at **:621**.
- `src/main/adapters/claude.ts:100` and `src/main/adapters/codex.ts:82` — the two `sessionResume: null` declarations this task retires, and the comments explaining *why* they are null (the extension method is unimplemented, and D34 Q1 forbids declaring without implementing).
- `docs/Features/Foundation/AdapterAuthoring.md` — the house rules for adding to an adapter.

## Goal

Give the adapter layer a truthful, per-CLI answer to two questions — _"can I name this conversation at launch?"_ and _"how do I reopen it?"_ — with `claude` and `codex` both answering, in the two structurally different ways their CLIs actually work.

## The decision the council must settle (D139)

**The declared contract does not fit, and implementing it verbatim would fork the launch path.**

`SupportsResume` (`types.ts:574`) is:

```ts
export interface SupportsResume {
  resumeSession(spec: ResumeSpec): PtyLaunchRequest
}
```

and `ResumeSpec` (`types.ts:351`) is `{ sessionId, cwd }` — **two fields**. But `buildLaunch` receives **eight** (`PtyLaunchSpec`, `types.ts:233`): `sessionId`, `cwd`, `modelId`, `effortOptionId`, `extraArgs`, `credential`, `route`, `hooks`. A `resumeSession` that returns a whole `PtyLaunchRequest` from two fields would have to **rebuild env composition, effort resolution, route flags and hook wiring from nothing** — or silently drop them. A resumed session that loses its BYOK credential, its OpenRouter route, or its hook config is a different session wearing the same pane.

Two candidate shapes:

| | **(A) Extend `PtyLaunchSpec`** | **(B) Implement `resumeSession` as declared** |
|---|---|---|
| Shape | `PtyLaunchSpec` gains `resume?: { agentSessionId, mode }`; `buildLaunch` stays the **single** launch path | A second entry point returning a full `PtyLaunchRequest` |
| Claude | trivially adds `--session-id` or `--resume` to argv | duplicates all of `buildLaunch` |
| Codex | must change **executable argv shape** (`codex resume <id>` is a subcommand, not a flag) — awkward inside `buildLaunch` | natural fit: it *is* a different request |
| Drift risk | one path, one place to forget | two paths, guaranteed divergence at the next launch feature |
| Verdict | preferred by the coordinator | preferred by the pre-declared types |

**Coordinator's position, for the council to accept or reject:** take **(A)** as the primary, and **redefine rather than delete** `SupportsResume` so codex's argv-shape change has a home — i.e. `buildLaunch` handles the flag case, `resumeSession` handles the subcommand case, and the capability descriptor says which applies. The council should specifically probe whether that hybrid is worse than either pure option.

**Questions for the council** — answer these; do not review this document:

1. Is (A), (B), or the hybrid the right shape, given codex's subcommand form is not hypothetical but verified?
2. Does D34 Q1's "declared = implemented" rule survive a descriptor that now has to express *which mechanism* (`assign-at-launch` vs `discover-after-launch`, flag vs subcommand), or does that belong outside the capability?
3. Is a resumed launch allowed to differ from the original launch in credential/route/effort, or must it be byte-identical argv plus the resume token?
4. `codex resume <id>` with an unknown id, and `claude --resume <id>` with an unknown id, both fall back toward a **picker** in interactive mode. Should the adapter be responsible for pre-flighting existence, or is that main's job? (The coordinator's view: main's, because it owns the filesystem check — but the adapter knows *where to look*.)

## Exact Scope

| File | Change |
|---|---|
| `src/main/adapters/types.ts` | **Edit.** Whatever D139 resolves: the `PtyLaunchSpec` field and/or the redefined `ResumeSpec`/`SupportsResume`, plus a widened `ResumeDescriptor` able to express mechanism. |
| `src/main/adapters/claude.ts` | **Edit.** Emit `--session-id <uuid>` on a fresh launch when asked; emit `--resume <uuid>` on a resume. Declare a non-null `sessionResume`. |
| `src/main/adapters/codex.ts` | **Edit.** Produce the `codex resume <uuid>` argv shape. Declare a non-null `sessionResume` describing **discover-after-launch**. |
| `src/main/adapters/capabilities.ts` | **Edit only if** the widened descriptor requires it (`capabilities.ts:35` already merges `sessionResume`). |
| `src/main/adapters/adapters.test.ts` | **Edit.** See Test Expectations — including the named-table row at `:596` that currently asserts `supportsResume` is **false** for every adapter. |

Nothing else. **No `sessionManager.ts`, no `ipc.ts`, no `storage.ts`, no renderer, no IPC channel.**

## Non-Goals

- **⚠ NOTHING CALLS THE NEW SURFACE IN THIS TASK.** `sessionManager.ts` is byte-identical to HEAD. The adapters gain a capability; 4a-3 uses it.
- **⚠ `kimi.ts` AND `opencode.ts` ARE BYTE-IDENTICAL TO HEAD AND KEEP `sessionResume: null`.** Both files carry explicit warnings that their resume syntax differs and would **silently resume a stale session** (`kimi.ts:136`, `opencode.ts:204`). Adding them "while we're in here" is exactly the failure those comments were written to prevent.
- **No flag is written from memory.** D4 is locked in `CLAUDE.md`. Every token this task emits must be re-verified against the installed CLI's own `--help` **at implementation time** — the Overview's §3 table was measured 2026-08-12 against claude (current) and codex-cli **0.147.0**, and both move fast.
- **No `--fork-session`, no `--continue`/`--last`, no picker invocation.** `--continue` and `codex resume --last` resume *the most recent conversation for the directory*, which is emphatically not "this pane's conversation" when several panes share a cwd — the exact bug `kimi.ts` and `opencode.ts` warn about. **Resume is by explicit id or not at all.**
- **No filesystem access from an adapter.** Adapters build launch requests; they do not stat transcripts, read `~/.codex/sessions`, or watch directories. Discovery is 4a-3's, in main.
- **No credential, route, effort or hook behaviour change on the normal launch path.** A launch with no resume field must produce **byte-identical argv** to HEAD. This is the regression that would be hardest to notice and most expensive to have shipped.
- **Do not revert, stage, or commit unrelated or untracked files** — see Overview §6.

## Dependencies

- **Task 4a-1** (the column exists) — not a compile dependency, but the sequence matters for review.
- **The council review on D139.** Hard. Do not start.

## Test Expectations

In `adapters.test.ts`, which already owns the capability-honesty suite:

- **The `supportsResume` named-table row at `:596` must change.** It currently asserts `supportsResume` is **false for every adapter** with a comment noting resume is _"the only one left that is genuinely false"_. After this task it is true for `claude` and `codex` and still false for `kimi`, `opencode` and `noHarness`. **Update the table; do not delete the test** — its whole job is catching a descriptor that drifts from its method (D34 Q1).
- Argv assertions per adapter, in the `:291`/`:408` style that already guards against a copied `buildLaunch` silently resuming a stale session:
  - claude, fresh launch **without** a resume request → argv **byte-identical to HEAD**.
  - claude, fresh launch **with** an assigned id → contains `--session-id <uuid>` and **not** `--resume`.
  - claude, resume → contains `--resume <uuid>` and **not** `--session-id` (the live-id error proves they are mutually exclusive).
  - codex, resume → the `resume` subcommand with the id **positional**, and **no `-c`** (which means `--continue` there).
  - codex, fresh launch → byte-identical to HEAD.
- A resume request carrying credential + route + hooks preserves **all three** in the returned request. This is D139's central risk, and it must be a test, not a review comment.

## Verification Commands

```bash
claude --help | grep -E -- "--session-id|--resume|--fork-session"   # D4, at implementation time
codex resume --help                                                  # D4, at implementation time
codex --version                                                      # record it; 0.147.0 when specced
npm run typecheck
npm test
npm run grep:secrets
```

## Acceptance Criteria

1. `npm run typecheck` exits 0; `npm test` passes with **no count regression** against 53 files / 1837 tests; `npm run grep:secrets` clean.
2. Both CLIs' resume surfaces were **re-verified against their own `--help` this session**, and the observed output is pasted into `_verify/4a-2/`. The codex version tested is recorded.
3. `supportsResume(claudeAdapter)` and `supportsResume(codexAdapter)` are **true**; `kimi`, `opencode` and `noHarness` remain **false** — asserted, not inspected.
4. A no-resume launch produces argv **byte-identical to HEAD** for all five adapters. Show the diff of a captured argv, not a claim.
5. `git diff --stat` touches only the files in Exact Scope. `kimi.ts` and `opencode.ts` appear nowhere in it.
6. D139 is recorded in roadmap §6 with the council's verdict, dissents and action items — **before** the commit.

## Review Checklist

- [ ] D139 resolved and recorded before any code was written.
- [ ] Every emitted flag re-verified against the CLI's own `--help`, with output captured (D4).
- [ ] `--continue` / `--last` / `--fork-session` appear nowhere.
- [ ] No adapter touches the filesystem.
- [ ] Descriptor and method ship together for each adapter (D34 Q1); the honesty test at `:596` was updated, not weakened.
- [ ] No-resume argv byte-identical to HEAD, demonstrated.
- [ ] Credential + route + hooks survive a resume request, demonstrated by test.
- [ ] `kimi.ts` and `opencode.ts` byte-identical to HEAD.
- [ ] `sessionManager.ts` byte-identical to HEAD.

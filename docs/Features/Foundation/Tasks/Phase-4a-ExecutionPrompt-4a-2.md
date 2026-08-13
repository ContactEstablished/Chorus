# Phase 4a — Execution Prompt (Task 4a-2)

_Generated 2026-08-13 against `main` at `a6fab79`. Paste the body below into a **fresh** conversation._

> **⚠ THIS PROMPT COVERS ONE OF THE PHASE'S FOUR TASKS.**
> Tasks **4a-1** and **4a-4** landed on 2026-08-13 (`bbf6d32`, `a6fab79`). Task **4a-3** is a hard **compile** dependency on the types this task ships, so it needs its own prompt **after 4a-2 merges** — its documents are already written and carry coordinator amendments D143 (b), (c) and (g).
>
> The council gate that blocked this task is **closed**: CR-4a.0 ran on 2026-08-13 and **D139 is RESOLVED**. There is no open decision in this prompt.

---

## PROMPT BODY — copy everything below this line

---

You are the **Coordinator** for Chorus **Phase 4a — Session Continuity**, executing **Task 4a-2** only.

Repository root: `C:\Projects\ContactEstablished\Chorus`
Expected branch: **`main`** — confirm with `git branch --show-current`. **Do not switch or create a branch without instruction.**
Expected HEAD at start: `a6fab79` ("Restored scrollback is now visible, not just written"). If HEAD differs, **re-verify every line number cited below before editing** and report any that moved.

## 1. Goal

Chorus restores panes across a restart, and since `bbf6d32` it restores their scrollback too — but a restored agent still starts a **brand-new conversation**. This task gives the adapter layer the contract that lets a later task hand each CLI back its own conversation id.

**Nothing calls the new surface in this task.** The adapters gain a capability; Task 4a-3 uses it. That split is deliberate — it is the same dormant shape Task 4a-1 shipped its database column in.

**Prime constraint: a launch with no `resume` field must produce byte-identical argv to HEAD, for all four adapters.** This is the regression that would be hardest to notice and most expensive to have shipped.

## 2. Ground yourself first — read before editing

**Phase documents (your source of truth; all are MODIFIED or UNTRACKED in the working tree — read them, do not edit them, do not commit them):**

- `docs/Features/Foundation/Tasks/Task-4a-2.md` — governs scope
- `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-4a-2.md` — governs exact contents
- `docs/Features/Foundation/Tasks/Phase-4a-Overview.md` — phase scope, verified ground facts, decisions
- `docs/Features/Foundation/CouncilBriefs/CouncilBrief-4a.0-ResumeContract-Findings.md` — the ruling. **⚠ Read its partial-run banner FIRST:** 3 of 4 members completed, one returned no verdict token on any question, and nothing in it was compiled, executed or tested by anyone who could see this repository.
- `docs/Features/Foundation/roadmap.md` §6 — decisions **D139**, **D140**, **D142**, **D143** and gates **G1–G6**.

**Governing rules:**

- `CLAUDE.md` — locked architecture. Sessions live in main; all IPC is Zod-validated in main only; no new dependencies without asking.
- Roadmap §6 **D4** — verify CLI flags against the tool's own `--help`, never training memory.
- Roadmap §6 **G6** — re-count shared counters against the merged tree.

**Code to inspect before editing (verified at `a6fab79`; confirm each):**

| Path | Line | What |
|---|---|---|
| `src/main/adapters/types.ts` | 180 | `ResumeDescriptor` |
| `src/main/adapters/types.ts` | 233 | `PtyLaunchSpec` — exactly **eight** fields |
| `src/main/adapters/types.ts` | 351 | `ResumeSpec` — `{sessionId, cwd}`, **deleted by this task** |
| `src/main/adapters/types.ts` | 565 | `SupportsHooks` — **methods only, no descriptor property**; the house pattern to follow |
| `src/main/adapters/types.ts` | 574 | `SupportsResume` — `resumeSession()`, **deleted by this task** |
| `src/main/adapters/types.ts` | 606, 614 | `supportsMcp` / `supportsHooks` — the two sibling guards to match |
| `src/main/adapters/types.ts` | 621 | the `supportsResume` guard, replaced by this task |
| `src/main/adapters/claude.ts` | 85–88 | the comment explaining why `sessionResume` is null — **rewrite, do not delete** |
| `src/main/adapters/claude.ts` | 100 | `sessionResume: null` |
| `src/main/adapters/claude.ts` | 202 | `buildLaunch` |
| `src/main/adapters/codex.ts` | 71–73 | the comment grouping `hooks` and `sessionResume` — **rewrite** |
| `src/main/adapters/codex.ts` | 82 | `sessionResume: null` |
| `src/main/adapters/codex.ts` | 110, 115, 121 | `buildLaunch`; `resolveCli`; `const args = [...cli.args, ...CODEX_BASELINE_ARGS]` |
| `src/main/adapters/kimi.ts` | 111, 136 | `sessionResume: null`; the "`-c` means `--continue`" warning |
| `src/main/adapters/opencode.ts` | 144, 204 | the same pair |
| `src/main/adapters/capabilities.ts` | 35 | merges a detected `sessionResume` override |
| `src/main/adapters/registry.ts` | 35 | `staticRegistry` — **exactly FOUR adapters** |
| `src/main/adapters/adapters.test.ts` | 574 | the coverage guard |
| `src/main/adapters/adapters.test.ts` | 596, 598 | the `supportsResume is FALSE for %s` table |
| `src/main/adapters/adapters.test.ts` | 908, 911 | `EXTENSION_METHODS`; the `['sessionResume','resumeSession']` row at 911 |
| `src/main/adapters/adapters.test.ts` | 291, 408 | the argv-assertion idiom to follow |
| `src/shared/ipc.ts` | 2219, 2220, 2224, 2231 | `resumeDescriptorSchema` / its `mode` field / `agentCapabilitiesSchema` / its `sessionResume` field |
| `src/main/adapters/noHarness.ts` | 85 | `sessionResume: null` — **NOT an adapter object**, not in the registry |
| `src/shared/ipc.test.ts` | 1822 | a capabilities fixture holding `sessionResume: null` |

**Git checks to run first:**

```bash
git branch --show-current      # expect: main
git log -1 --format="%H %s"    # expect: a6fab79 …
git status --porcelain
```

## 3. Pre-existing changes — DO NOT REVERT, STAGE, OR COMMIT THESE

The tree is **already dirty** when you start. These belong to the coordinator (phase documents, roadmap, council briefs) and to **Phase 5 (Voice Input)** — not to you:

```
 M docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-4a-2.md
 M docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-4a-3.md
 M docs/Features/Foundation/Tasks/Phase-4a-Overview.md
 M docs/Features/Foundation/Tasks/Task-4a-2.md
 M docs/Features/Foundation/Tasks/Task-4a-3.md
 M docs/Features/Foundation/roadmap.md
 M docs/Plan.md
?? CLAUDE-PROJECT-MARKER.txt
?? docs/Features/Foundation/CouncilBriefs/CouncilBrief-4a.0-ResumeContract-Findings.md
?? docs/Features/Foundation/CouncilBriefs/CouncilBrief-4a.0-ResumeContract.md
?? docs/Features/Foundation/Investigations/Voice-Input-Feature-Requirements-source.md
?? docs/Features/Foundation/Phase-5-VoicePlan.md
?? "docs/Features/Voice Input/"
```

> **⚠ THE FIVE MODIFIED PHASE 4a DOCUMENTS AND THE TWO COUNCIL BRIEFS ARE YOUR SOURCE OF TRUTH.** Read them; do not edit them; do not commit them. `roadmap.md` is `/architect`'s. **This task commits CODE ONLY.**

Stage explicitly by path. **Never `git add -A` or `git add .`** in this repo.

## 4. Implementation scope

**Files owned — nothing else:**

| File | Change |
|---|---|
| `src/main/adapters/types.ts` | Add `resume?: AgentSessionLaunch` to `PtyLaunchSpec`. Discriminate `ResumeDescriptor` on `kind`. Add `AgentSessionLaunch`, `DiscoverSessionContext`, `ResumeFailureReason`, `ResumeExitObservation`. **Delete `ResumeSpec`.** Replace `SupportsResume` and the guard. |
| `src/main/adapters/claude.ts` | `--session-id <uuid>` on assigned/create, `--resume <uuid>` on assigned/resume, **neither on an empty pointer**. Non-null `assigned` descriptor. Implement `classifyResumeFailure`. |
| `src/main/adapters/codex.ts` | The `resume <uuid>` subcommand argv shape when the modifier is present. Non-null `discovered` descriptor. Implement `discoverSessionId` and `classifyResumeFailure`. |
| `src/shared/ipc.ts` | `resumeDescriptorSchema` gains `kind`. |
| `src/main/adapters/capabilities.ts` | **Only if** the discriminated descriptor requires it. |
| `src/main/adapters/adapters.test.ts` | The table at 596; remove the `EXTENSION_METHODS` row at 911; new argv, structural and classifier tests. |

### Resolved decisions governing this task

Quote them in code comments where they bite.

- **D139 (RESOLVED 2026-08-13 by CR-4a.0)** — *One launch path.* `PtyLaunchSpec` gains an optional modifier; `buildLaunch` stays the only launch entry point; `ResumeSpec` and `SupportsResume.resumeSession()` are **deleted**; argv grammar stays **inside each adapter's own `buildLaunch`**. **⚠ The council ADDED something the brief did not ask for:** the modifier must model **assigned creation** as well as resumption, because Claude must receive the Chorus-minted id on its **first** launch — hence `action: 'create' | 'resume'`, and a field named `resume` legally contains a `create`. All three members raised that naming objection and all three accepted it; do not "fix" it with a second field.
- **D140 (RESOLVED 2026-08-12)** — *Claude assigns, codex discovers, and the capability declares which.* `claude --session-id` assigns and `--resume` reopens (verified live); codex has no launch-time id option and resumes by **subcommand**.
- **D143 (ADOPTED 2026-08-13)** — six coordinator amendments conditioning D139. **Four are yours:**
  - **(a)** `ResumeExitObservation.output` must be documented **at the type** as the **post-scrub** string from the single emit path in `services/sessionOutput.ts`, not raw PTY bytes. A classifier reading session output is a **new consumer of session text**; D45(1) makes scrubbing a property of "a session emits text"; a raw-PTY tap here is **F26's exact shape**.
  - **(d)** This puts `--session-id` on **every Claude launch**, not just restores. The verified evidence was `-p` **print mode** only, and every Chorus pane is an interactive TUI. **Re-verify interactively before shipping** — D4 does not accept "probably".
  - **(e)** `--resume` with **no value** opens an interactive picker. Verbatim from `claude --help`: *"-r, --resume [value] — Resume a conversation by session ID, or open interactive picker with optional search term."* The value is **optional to the CLI**, so an empty pointer does not error — it drops a picker into a pane nobody is watching. **Require an explicit argv guard: no value, no flag.**
  - **(f)** `resumeDescriptorSchema` (`src/shared/ipc.ts:2219`) rides `adapter:list`. Adding `kind` is a **Zod schema change** even though `IpcChannel` stays **86**. `z.object` **strips** unknown keys rather than rejecting them, so a `kind` not added to the schema **vanishes silently**. The renderer never reads `sessionResume`. **Do NOT remove `mode` (`:2220`)** — it is a validated wire field.

## 5. Strict non-goals

- **Nothing calls the new surface.** `src/main/services/sessionManager.ts` must be **byte-identical to HEAD**.
- **`kimi.ts` and `opencode.ts` byte-identical to HEAD**, keeping `sessionResume: null` — and **tested to IGNORE a `resume` field** if one is passed.
- **No flag written from memory** (D4).
- **No `--fork-session`, no `--continue`/`--last`, no picker invocation.**
- **`buildLaunch` stays synchronous and touches no filesystem.** `discoverSessionId` may read `~/.codex/sessions` rollout headers only — **never `session_index.jsonl`** (F57: it carries no `cwd`) — and owns no timer or watcher. **Nothing calls it in this task.**
- **No resume-failure policy.** `classifyResumeFailure` returns a reason; it does not clear, relaunch, badge, log or notify. Every consequence is Task 4a-3's.
- **No scrollback or restart work** — that is 4a-3 (amendment (g)).
- **No new IPC channel** (`IpcChannel` stays **86**), no preload change, no renderer change, no schema or migration change, no npm dependency.
- **Do not revert, stage, or commit the pre-existing dirty files in §3.**

## 6. Required workflow

1. **Ground** — read the phase documents and inspect every code location in §2 before editing. Report any line number that moved.
2. **Spec review** — re-read `ImplementationSpec-4a-2.md` and confirm your plan matches it. Where the task doc and the spec disagree on scope, the **task doc** wins; on contents, the **spec** wins.
3. **⚠ DO THE D4 MEASUREMENTS BEFORE WRITING ANY ARGV** — including amendment (d)'s five-step interactive protocol and the codex `-c`-position measurement, both in `ImplementationSpec-4a-2.md` §3. **If (d) step 3 fails, STOP and report:** the assigned strategy does not work for interactive claude, and D139 needs re-opening. That is a finding, not a bug to route around.
4. **Code-quality review** — review your own diff against the task's **Review Checklist**, item by item. Fix what fails.
5. **Verification** — §7, in full. **Run, don't just compile (G2).**
6. **One intentional narrated commit (G3)** in the style of `80e69c3`: a concise title, then a description a non-technical reader understands first and a technical reader second. Stage by explicit path. **Code only** — none of §3's documents.
7. **Do not push and do not open a PR** unless explicitly asked.

## 7. Verification commands

Run from the repo root.

### Build gates

```bash
npm run typecheck      # G1 — expect 0 errors
npm test               # baseline at a6fab79: 56 files / 1888 tests, all passing
npm run grep:secrets   # G4 — expect clean
```

A **lower** test count than 56/1888 is a regression even if everything passes.

### Channel tally (must not move)

```bash
grep -n "toHaveLength(86)" src/shared/ipc.test.ts    # expect two hits: 3438 and 3816
```

### D4 captures — into `_verify/4a-2/`

```bash
claude --help | grep -E -- "--session-id|--resume|--fork-session"
claude --version
codex resume --help
codex --version
```

### Structural proofs

```bash
grep -rn "resumeSession\|ResumeSpec" src/
#   expect ZERO hits — both are deleted by this task

git diff --stat HEAD -- src/main/services/sessionManager.ts src/main/adapters/kimi.ts src/main/adapters/opencode.ts
#   expect empty
```

### Runtime gates (G2: measure the CLIs, do not reason about them)

| # | Do this | Expect |
|---|---|---|
| 1 | **Amendment (d).** Mint a UUID. Launch `claude --session-id <uuid>` **INTERACTIVELY** in a throwaway cwd, with **no `-p`**. Say one distinctive word; exit. | `~/.claude/projects/<munged-cwd>/<uuid>.jsonl` exists under **that exact id** |
| 2 | Relaunch `claude --resume <uuid>` interactively | the distinctive word comes back |
| 3 | Measure **both** codex orderings — `codex -c … resume <id>` and `codex resume -c … <id>` | record **which preserves the `-c` overrides**, and the **observed behaviour** rather than just the exit code — codex has been measured accepting a misplaced `-c` in total silence |
| 4 | Capture the composed argv for a no-modifier launch **before** and **after** the change, all four adapters | **byte-identical** — show the diff |
| 5 | Parse claude's real `getCapabilities()` through `agentCapabilitiesSchema` | `sessionResume.kind` **survived** — `z.object` strips silently, so a passing parse is not evidence a field arrived |

Evidence under `_verify/4a-2/`.

## 8. Failure honesty

If any verification command fails — including for an unrelated environment reason (a native-module ABI mismatch, a locked database, a missing CLI, a flaky test) — **capture the exact output verbatim, explain what you believe caused it, and do not claim success.** A partial pass reported as a pass is worse than a clean failure, because the next session builds on it.

Specifically:

- If amendment (d)'s interactive verification fails, **stop and report** — do not route around it.
- If a runtime gate cannot be run, say so explicitly and name what was skipped. Do not silently drop it.

## 9. Final report — required format

**Status:** one of `DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`

Then:

1. **Files changed** — every path, with created/edited marked.
2. **The D4 measurements** — both CLIs' `--help` output and versions, amendment (d)'s interactive result, and the codex `-c`-position finding, with the captures.
3. **Build results** — `typecheck`, `npm test` (file and test counts, compared to the 56/1888 baseline), `grep:secrets`.
4. **Runtime results** — what you actually did and observed for each gate in §7. Not "verified" — say what you saw.
5. **Review outcomes** — the task's Review Checklist, item by item, with pass/fail.
6. **Non-goals confirmation** — explicitly confirm: `IpcChannel` still **86**; `sessionManager.ts`, `kimi.ts` and `opencode.ts` byte-identical to HEAD; **zero** hits for `resumeSession`/`ResumeSpec`; no npm dependency added; the §3 dirty files untouched.
7. **Residual risks and findings** — anything a later task should own. The highest finding number in the roadmap is currently **F60**, so propose **F61 or later** and say why.
8. **Final `git status --porcelain`** — and confirmation that only your intended code paths were staged.

---

## END OF PROMPT BODY

---

## Coordinator notes (not part of the prompt)

- **Task 4a-3 needs its own prompt once 4a-2 merges.** Its documents are already written — `Tasks/Task-4a-3.md` and `ImplementationSpecs/ImplementationSpec-4a-3.md` — and carry D143 amendments **(b)** (the automatic relaunch fires nine exit listeners; `wasKilledByChorus` is read by only one of them, so suppressing the fan-out is the load-bearing half), **(c)** (mint before argv, persist after the spawn succeeds), and **(g)** (the Q7 conversation boundary).
- **D143(g) is a change to ALREADY-SHIPPED behaviour** — `a6fab79` re-seeds a restarted pane silently — and belongs to 4a-3, not here.
- **The §3 dirty list is a snapshot.** The five Phase 4a documents, the two council briefs and `roadmap.md` were uncommitted when this prompt was generated. If they land first, the list shrinks — the next session should re-read `git status` rather than trusting it verbatim.
- **The codex `-c` position is a genuine unknown**, not a formality. `CODEX_BASELINE_ARGS` is first specifically so it is a real argv prefix, which is what keeps `adapters.test.ts`'s exact-equality assertions honest; inserting a subcommand disturbs that. If `-c` is silently dropped in the resume position, a resumed codex session loses its route, effort and status line — which is the "different session wearing the same pane" failure D139 exists to prevent.

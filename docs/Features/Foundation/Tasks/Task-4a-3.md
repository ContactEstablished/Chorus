# Task 4a-3 — Wiring Resume Into Launch, Restore And Restart

_Phase 4a, task 3 of 4. **One narrated commit (G3).** **This is the task that fixes the reported problem.** After it, a reboot returns agents that remember the conversation. This task governs scope; `ImplementationSpecs/ImplementationSpec-4a-3.md` governs exact contents._

> **✅ THE GATE IS OPEN. D139 IS RESOLVED (CR-4a.0, 2026-08-13) AND ITS RULING IS BINDING, AS ARE COORDINATOR AMENDMENTS D143 (b), (c) AND (g).**
> This task consumes the interface D139 settled. **Task 4a-2 must be merged before 4a-3 starts** — not because a council is pending, but because `PtyLaunchSpec.resume`, `classifyResumeFailure()` and `discoverSessionId()` do not compile until it lands.
>
> ⚠ **THIS DOCUMENT WAS REWRITTEN AGAINST THE RULING.** Its first draft (2026-08-12) was written while D139 was open and got two things wrong that a reader working from memory will reinstate by habit: it used `idSource` terminology, and it required a **pre-flight existence check** before every reopen. Both are gone. See §"What the ruling changed about this task".

## Source Of Truth

- `CouncilBriefs/CouncilBrief-4a.0-ResumeContract-Findings.md` — the ruling: **Q3** (discovery), **Q4** (failure), **Q7** (restart + scrollback), and action items 6–9, which are this task's. **⚠ Read its partial-run banner:** 3 of 4 members completed, GLM 5.2 gave no verdict token on any question, and nothing in it was compiled or tested by anyone who could see this repository.
- `Tasks/Phase-4a-Overview.md` — §2, §3, **D139 (RESOLVED)**, **D140**, **D142**; §7 (the one demonstration that matters).
- Roadmap §6 **D143** — the coordinator amendments. **(b)**, **(c)** and **(g)** are this task's and are binding.
- `Tasks/Task-4a-1.md` (the column), `Tasks/Task-4a-2.md` (the adapter contract), `Tasks/Task-4a-4.md` (the mirror this task now writes a boundary into).
- Roadmap §6 **D16** (the restore contract, and resolution **(a)**: `'running'` is written only *after* the spawn succeeds — the rule amendment (c) turns on), **D33 / F26** (a credentialed session is never auto-restored), **D129**, **D130** (the hook listener's read surface does not widen), **D45(1)** (one emit path).

### Verified line numbers — measured at `a6fab79`, 2026-08-13

**⚠ EVERY `sessionManager.ts` AND `ipc.ts` NUMBER IN THIS DOCUMENT'S FIRST DRAFT WAS STALE**, because Task 4a-4 edited both files. These are re-measured:

- `src/main/services/sessionManager.ts` — `BUFFER_MAX_CHARS` **:27**, `SCRUB_FLUSH_MS` **:34**, `RESTORE_STAGGER_MS` **:38**, `RESTORE_CAP = 16` **:42**, `attach()` **:300**, `restore()` **:321**, the credentialed heal **:370**, the relaunch `this.spawn()` **:395**, `kill()` **:499**, `wasKilledByChorus` **:543**, `dispose()` **:548**, `snapshot()`'s `capTail` composition **:577**, `private spawn()` **:583**, the `adapter.buildLaunch({` call **:619**, `pty.spawn` **:652**, `createSessionOutput` **:676**, the `replaySeed` IIFE **:721**, `child.onData` **:732**, `child.onExit` **:734**, the exit fan-out loop **:749**.
- `src/main/ipc.ts` — `SessionLaunch` **:1144**, the two `randomUUID()` row creations **:1373** and **:1478**, `SessionRestart` **:1591**.
- `src/main/services/sessionOutput.ts` — the single `emit` **:71**, `onPersist` **:89**, `onText` **:90**, `ingest` **:94**.
- `src/main/services/scrollbackCore.ts` — `stripAltScreen` **:113**, `replayEpilogue` **:126**.
- `src/main/services/storage.ts` — `setAgentSessionId` **:1681**, `clearAgentSessionId` **:1693**, `getAgentSessionId` **:1703**.
- `src/main/services/restore.ts:31` — `computeRestoreSet`, whose `RestoreCandidate` is **structurally typed** and therefore already accepts a row carrying `agentSessionId`.
- The nine exit listeners amendment (b) is about: `services/dispatches.ts:96`, `services/turns.ts:88`, `services/notifications.ts:24`, `index.ts:672`, `index.ts:678`, `services/dispatchAttribution.ts:275`, `ipc.ts:3966`, `ipc.ts:4011`, `ipc.ts:4169`.

## Goal

Make a restored session **the same conversation**, not a new one with the same id — while leaving restart, credentialed sessions, and every existing D16 guard behaving exactly as they do today, and while a failed resume costs the user **one honest line of terminal text** rather than a closed dispatch, a closed turn, a toast and a red project rail.

## What the ruling changed about this task

Three substantive changes from the 2026-08-12 draft. Each is written here because an implementer reading the old shape will otherwise re-derive it.

**1. `idSource` is gone. It is `strategy` + `action`.** The descriptor is discriminated `kind: 'assigned' | 'discovered'`, and the launch modifier is:

```ts
AgentSessionLaunch =
  | { strategy: 'assigned';   action: 'create' | 'resume'; agentSessionId: string }
  | { strategy: 'discovered'; action: 'resume';            agentSessionId: string }
```

`strategy` says *who names the conversation*; `action` says *whether this launch starts or reopens one*. The old doc's single `idSource` axis conflated them, which is why it needed a `fresh`-versus-`assign` warning to keep them apart. It does not need one now: **`assigned/create` is the assign case and it is spelled out in the type.**

**2. The pre-flight existence check is dropped as a hard rule. Classification is REACTIVE.**

> ⚠ **DO NOT REINSTATE `existsSync` ON A TRANSCRIPT PATH. IT WAS CONSIDERED AND IT LOST, AND IT LOST FOR A REASON THAT SURVIVES THE IMPLEMENTER'S INSTINCT TO ADD IT BACK.**
> The old design stat'ed the transcript before every reopen so a missing file meant "launch fresh". That put a **munged-cwd path format Chorus does not own** — Claude Code's `~/.claude/projects/<munged-cwd>/<uuid>.jsonl` — on the critical path of every restore, and it put vendor filesystem layout in shared code, which is exactly what the council forbade in Q2 and Q3. The ruled shape instead **attempts the resume and classifies the exit**: the adapter, which is the only thing that legitimately knows the vendor's error text, returns `not-found | in-use | transcript-unavailable | unusable-pointer`, and main applies the generic consequence.
> **The picker risk the pre-flight existed to prevent is still handled** — by 4a-2's argv rules (resume is by explicit id, never `--continue` / `--last` / a bare `--resume`) and by the fact that a failed resume is *classified and relaunched*, not left sitting in a TUI. If a picker is ever reached in practice, that is a 4a-2 argv bug and a finding, not a reason to add a stat call here.

**3. Codex rollout parsing moved into the adapter.** `discoverSessionId(context)` is a method on the codex adapter (4a-2). This task no longer creates `codexSessionDiscovery.ts`. **4a-3 owns the orchestration around it** — capturing `launchedAt`, supplying and firing the `AbortSignal`, checking the spawn generation, and being the only thing that ever calls `setAgentSessionId`. The honesty constraints in §"The codex discovery problem" are unchanged; they are now constraints this task *verifies at runtime* rather than *implements*.

## The three moments

| Moment | Today (at `a6fab79`) | After this task |
|---|---|---|
| **Launch** (`ipc.ts:1144`) | spawn bare; the CLI names its own conversation and Chorus never learns the name | **assigned** (claude): mint a UUID, put it in argv as `assigned/create`, **`setAgentSessionId` only after the spawn succeeds** (D143 c). **discovered** (codex): spawn bare, then bounded abortable discovery **after** the spawn succeeds (Q3) |
| **Restore** (`sessionManager.ts:321`, relaunch at `:395`) | `this.spawn(row.agent, row.cwd, row.id)` — a genuinely fresh conversation | a stored pointer produces **exactly one** resume launch; a classified failure clears the pointer, relaunches **once** fresh under the same row id, and says so visibly (Q4) |
| **Restart** (`ipc.ts:1591`) | fresh conversation, "Session restarted" badge — **and, since 4a-4, a silently re-seeded pane** | `clearAgentSessionId` **before** the relaunch (D142), **and** a visible boundary emitted through the output path before any new PTY output (Q7 / D143 g) |

**The restart row is still the one most likely to be got wrong by omission, and it now has two ways to be got wrong instead of one.** Omitting the clear means the next restore resumes a conversation the user deliberately abandoned. Omitting the boundary means the pane shows the old conversation's screen followed seamlessly by a new agent that has never seen it — history presented as memory, which is the one dishonest state Q7 exists to forbid.

## Exact Scope

| File | Change |
|---|---|
| `src/main/services/resumeCore.ts` | **Create.** The **pure** decisions: which `AgentSessionLaunch` (if any) this launch carries, and what an exit from it means. No `fs`, no `electron`, no `better-sqlite3`, no clock, no `randomUUID` import. |
| `src/main/services/resumeCore.test.ts` | **Create.** The launch truth table exhaustively, plus the exit-disposition table. |
| `src/main/services/sessionManager.ts` | **Edit.** Plan the launch inside `spawn()` (`:583`); forward the modifier through the single `buildLaunch` call (`:619`); persist an assigned id **after** `pty.spawn` returns (`:652`); orchestrate discovery; classify the exit and suppress-then-relaunch once (`:734`); emit the conversation boundary; abort discovery on quit/kill/restart/superseding spawn. |
| `src/main/services/scrollbackCore.ts` | **Edit.** One pure function producing the boundary string, beside `replayEpilogue` (`:126`). |
| `src/main/services/scrollbackCore.test.ts` | **Edit.** Assert the boundary's exact bytes. |
| `src/main/ipc.ts` | **Edit.** `SessionRestart` (`:1591`) clears the pointer **before** relaunching and asks for the boundary. |

Nothing else. **No new IPC channel — `IpcChannel` stays at 86.** No preload change, no renderer change, no schema change (v19 already shipped in 4a-1), no adapter change (4a-2 already shipped it), no npm dependency.

## The codex discovery problem, stated honestly

**This is still the least certain part of the phase and the task must still treat it that way.** The ruling constrained it; it did not make it certain.

Codex has no `--session-id`, so Chorus cannot name the conversation and must find out what codex named it. Verified 2026-08-12 on codex-cli 0.147.0:

- **F57:** `~/.codex/session_index.jsonl` carries only `{id, thread_name, updated_at}` — **no cwd**. The index alone cannot answer "which session did I just start in this directory", and the ruling explicitly forbids using it as identity evidence.
- The rollout file `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl` has a first line of `type: "session_meta"` carrying `session_id`, `cwd`, `originator`, `cli_version`, `source`. **This is the only verified discovery surface.**

Correlation is therefore **cwd + launch time**, and the ruling tightened both halves:

- The header `cwd` must **positively and exactly** match the launch cwd. Not a prefix, not a parent, not a case-folded near-miss beyond Windows' own path semantics.
- The header must be **current relative to `launchedAt`** — the epoch millisecond captured immediately **before** the fresh spawn, which is what stops an older matching rollout from the same worktree being claimed.
- The result must belong to the **current spawn generation**, checked immediately before persistence.

**Known limitations, to be written into the code as comments, not discovered later:**

- A user running `codex` **outside** Chorus in the same directory at the same moment could be matched. The window is seconds and the mitigation is the timestamp, not certainty.
- **Two Chorus panes launching codex in the same cwd within the same second are genuinely ambiguous.** The honest response is to claim **neither** — a pointer that might belong to the other pane is worse than no pointer, because resuming the wrong conversation is a silent, confusing data-crossing rather than a visible absence.
- An `originator` override env var would make this exact, but **none is documented in `codex --help` and none was found**. If the implementer finds one, use it and record the finding; do not invent one.

**If discovery proves unreliable in practice, ship claude-only resume and record codex as a finding.** Half the feature working correctly beats all of it working sometimes.

## The Q4 failure rule — and the distinction that is load-bearing

A **recognized failed resume** — `not-found`, `in-use`, `transcript-unavailable`, `unusable-pointer`, as returned by the adapter's own `classifyResumeFailure(observation)` — does exactly three things, in this order:

1. `clearAgentSessionId(sessionId)`.
2. Relaunch **once**, fresh, under **the same Chorus row id** (for an assigned adapter that means a newly minted id and `assigned/create`).
3. Show a **visible** notice that context was not restored.

**Never silent. Never a refusal to launch. Never a second attempt at the same pointer in the same spawn cycle.**

> ⚠ **A CODEX DISCOVERY MISS IS NOT A RESUME FAILURE, AND CONFLATING THE TWO WOULD PUT A FALSE ALARM ON THE MOST COMMON CODEX LAUNCH THERE IS.**
> A discovery miss follows a **fresh** launch. No context was promised, no stale pointer existed, and nothing was lost. So: the pointer **stays NULL**, **no notice is shown**, no relaunch happens, and the log line is an `info`, not a warning. A codex pane that starts fresh and cannot find its rollout is behaving exactly as today's app behaves, and the user must not be told that something failed.

The two paths must be structurally distinguishable in the code, not distinguished by a comment: the failure path is reachable **only** when the launch that just exited carried a `resume` modifier with `action: 'resume'`.

## Amendment D143 (b) — the automatic relaunch fires nine exit listeners

> ⚠ **AS Q4 SPECIFIES IT, ONE CLASSIFIED RESUME FAILURE CLOSES A DISPATCH, CLOSES A TURN, FIRES AN OS EXIT TOAST AND LIGHTS THE PROJECT RAIL RED — FOR A SESSION THAT CAME STRAIGHT BACK.**

The council could not see the repository and therefore could not see that `sessions.onExit` has **nine** registrations, measured 2026-08-13:

| Listener | Site | What a spurious fire costs |
|---|---|---|
| `dispatches.closeOnExit` | `services/dispatches.ts:96` | a dispatch record closed against a live session |
| `turns.closeOnSessionExit` | `services/turns.ts:88` | an open turn closed |
| exit toast | `services/notifications.ts:24` | an OS notification saying the agent exited |
| status persist | `index.ts:672` | the row written `'exited'` under a running PTY |
| `attention.onSessionExited` | `index.ts:678` | the pane's attention state dropped |
| `dispatchAttribution` | `services/dispatchAttribution.ts:275` | a key-usage read and revoke, settled early |
| `SessionExit` → renderer | `ipc.ts:3966` | the pane flips to exited chrome and flickers back |
| exit instant + rail recompute | `ipc.ts:4011` | **the project rail goes red** |
| the ninth | `ipc.ts:4169` | see `dispatchAttribution` above |

**The mechanism already exists and this task must use it.** `killRequested` is set on the session record **before** `pty.kill()` precisely so a deliberate end cannot misclassify as an agent failure (Task 3a-1, `sessionManager.ts:499` and `:548`). **A resume-failure relaunch is a deliberate end** and must be marked as one.

> ⚠ **BUT THE FLAG ALONE IS NOT SUFFICIENT, AND THIS WAS MEASURED RATHER THAN ASSUMED.** `wasKilledByChorus` (`sessionManager.ts:543`) is read by exactly **one** of the nine — `dispatches.ts:155`. The other eight see only an exit event. So the flag is necessary (it is what makes the dispatch classifier honest) and **suppressing the fan-out is what actually prevents the other eight**. Both, or the amendment is one-ninth done.

The suppression is narrow and must stay narrow: it applies **only** when the exiting launch carried a resume modifier, **only** when the adapter classified the exit as one of the four reasons, and **only** if the immediate relaunch succeeds. **If the relaunch throws, the exit must fan out normally after all** — suppressing an exit for a session that did not come back would leave a row saying `'running'` with no PTY behind it, which is the invisible-process failure D16 exists to prevent.

## Amendment D143 (c) — mint before argv, persist after the spawn

> ⚠ **THE FINDINGS' ACTION ITEM 6 SAYS "MINTS AND PERSISTS AN ID BEFORE LAUNCH". THE SECOND HALF OF THAT IS WRONG FOR THIS APP AND MUST NOT BE IMPLEMENTED AS WRITTEN.**

D16 resolution (a) — which this app already runs on, at `sessionManager.ts:395`–`:400` — writes `'running'` **only after** the spawn succeeds, so that a crash between the two leaves a self-consistent row. Persisting the pointer first inverts that guarantee for the new column: a failed spawn would leave a pointer to a conversation **that never existed**, the next launch would resume it, the resume would fail, Q4 would clear it and show a **"context was not restored"** notice — on a session that never had any context. A spurious accusation of data loss is worse than the loss it describes.

So the ordering is exactly: **mint** (it has to be in argv) → `buildLaunch` → `pty.spawn` → **only now** `setAgentSessionId`.

The worst case this ordering can produce is an **orphan transcript** — a conversation named on disk that Chorus forgot — which costs nothing and is invisible. The worst case the inverted ordering produces is a lie in the UI.

## Amendment D143 (g) — the Q7 boundary is emitted, not seeded

Q7 closed D142's open half: `session:restart` still clears the pointer, **but the scrollback mirror is retained** as user-visible terminal history. Before any output from the restarted PTY is replayed or emitted, Chorus inserts a visible boundary such as `── Session restarted: fresh conversation ──`. Continuous unseparated replay is prohibited.

> ⚠ **THE BOUNDARY GOES THROUGH THE EXISTING MAIN-PROCESS EMIT PATH, NOT INTO THE REPLAY SEED, AND THE DIFFERENCE IS PERMANENT VERSUS COSMETIC.** Emitted through `SessionOutput` (`sessionOutput.ts:94`), it is mirrored to disk like any other session text and becomes a **permanent, accurate record of when the session restarted** — visible again at every future restore, in the right place in history. Appended to `replaySeed` (`sessionManager.ts:721`) instead, it would be redrawn on *every* attach, would drift to the wrong place, and would never be recorded at all.

> ⚠ **AND THIS IS A CHANGE TO ALREADY-SHIPPED BEHAVIOUR, NOT MERELY A NEW RULE.** Task 4a-4 currently re-seeds a restarted pane **silently**. A restarted pane today shows the old conversation's last painted screen and then a fresh amnesiac agent with nothing between them. That is the exact state Q7 forbids, it is live in `main` right now, and fixing it is this task's work — so the commit must narrate it as a behaviour change to 4a-4, not as a new feature.

### ⚠ COORDINATOR RULING: the Q4 "visible badge" is the same emitted terminal line, not a pane chip

Q4 asks for a *"visible pane badge"*. **Implement it as an emitted boundary line, exactly like Q7's**, and not as renderer chrome. The council's own Q7 mitigation established the mechanism — *"write the separator as formatted terminal text through the existing main-process scrollback/output path. No new IPC channel or renderer feature is required"* — and the same reasoning applies here. It buys three things a chip cannot: it is **permanent** (mirrored to disk, still there next boot), it is **positioned** (in history, at the moment it happened, rather than floating in pane chrome), and it costs **no renderer file and no schema field**, which is what keeps this task's "no renderer change" claim true and the findings' own "renderer code unchanged" line honest.

The existing restart chip (`TerminalPane.vue:1249`, _"Session restarted — new conversation"_) is **untouched** and still fires from `consumeRestoredBadge`. **This substitution must be named in the commit message** so it is a visible decision rather than a quiet one.

## Non-Goals

- **⚠ NO TRANSCRIPT CONTENT IS READ, PARSED OR STORED BY THIS TASK.** Codex rollout-header reading now lives in the codex adapter (4a-2) and is bounded to a **first line**. This task reads **zero** transcript bytes of any kind — including, now, the `existsSync` the old draft required. `contextUsage.ts` remains the only transcript *content* reader in the app, under its own rules, and this task adds no second one.
- **⚠ D33 / F26 IS NOT RELAXED.** A session launched on a stored credential is still healed to `exited` at restore (`sessionManager.ts:370`) and **never keyless-restored**; `session:restart` still refuses it inline. Resume changes nothing here: the objection was unattended decryption at boot, not loss of context. The heal message may mention that the conversation is preserved and will resume when relaunched from the dialog — **the refusal itself does not move.**
- **No auto-resume for an agent with no pointer.** A NULL `agent_session_id` means fresh, silently and correctly.
- **No picker, ever.** No path may reach an interactive picker inside a PTY. Resume is by explicit id or not at all; `--continue`, `--last` and `--fork-session` appear nowhere.
- **No change to `RESTORE_CAP` (16, `:42`) or `RESTORE_STAGGER_MS` (500, `:38`).** Resume does not make restore cheaper or more urgent.
- **No change to the heal semantics** in `computeRestoreSet` (`restore.ts:31`) or its three inputs. The restore *set* is unchanged; only what happens to a member changes.
- **No change to `agentEvents.ts` or `agentEventsCore.ts`.** D130's read surface does not widen by one field. The transcript path Chorus already receives is a **tempting** second source for claude's id — **and it is not needed**, because claude's id is assigned, not discovered. Do not wire it.
- **No second emit path for the boundary.** D45(1): it goes through the one `SessionOutput` that already exists for that session, so it is provably post-scrub and provably mirrored.
- **No new IPC channel, no renderer file, no schema change, no npm dependency.**
- **Do not revert, stage, or commit unrelated or untracked files** — see Overview §6.

## Dependencies

- **Task 4a-1** — the column and its `setAgentSessionId` / `clearAgentSessionId` / `getAgentSessionId` accessors. **Landed.**
- **Task 4a-2** — `PtyLaunchSpec.resume`, the discriminated descriptor, `classifyResumeFailure()`, `discoverSessionId()`. **Hard compile dependency. Must be merged first.**
- **Task 4a-4** — the mirror, `replaySeed`, and `snapshot()`'s composition. **Landed**, and this task changes its restart behaviour.

## Test Expectations

`resumeCore.test.ts` — the launch truth table, exhaustively, in the ruled terminology:

| stored pointer | descriptor `kind` | launch modifier | discovery | pointer write |
|---|---|---|---|---|
| NULL | `null` (kimi · opencode) | **none** — argv byte-identical to today | never | never |
| NULL | `assigned` | `{strategy:'assigned', action:'create', agentSessionId: mint()}` | never | `setAgentSessionId` **after** the spawn succeeds |
| set | `assigned` | `{strategy:'assigned', action:'resume', agentSessionId: stored}` | never | none, unless the resume is classified as failed |
| NULL | `discovered` | **none** — bare fresh argv | **after** a successful spawn, bounded + abortable | only on a positive, current, generation-matched match |
| set | `discovered` | `{strategy:'discovered', action:'resume', agentSessionId: stored}` | **never** (Q3: never for a resume launch) | none, unless the resume is classified as failed |

`resumeCore.test.ts` — the exit-disposition table, which is amendment (b)'s unit:

| launch carried | adapter classified | → |
|---|---|---|
| no modifier | — | **fan out** the exit normally (today's behaviour, unchanged) |
| `action:'create'` | — | **fan out** — a create cannot be a resume failure, and the classifier is not consulted |
| `action:'resume'` | `null` | **fan out** — an ordinary exit of a successfully resumed session |
| `action:'resume'` | one of the four reasons | **suppress**, mark `killRequested`, clear pointer, relaunch once, notify |
| `action:'resume'` | a reason, but the relaunch throws | **fan out after all** — never leave a `'running'` row with no PTY |

`scrollbackCore.test.ts` — the boundary string's exact bytes, for both reasons, and that nothing is produced when no boundary was asked for.

Discovery orchestration is exercised at runtime (see Acceptance), not by a unit test that would only re-assert the adapter's own 4a-2 tests.

## Verification Commands

```bash
npm run typecheck
npm test
npm run grep:secrets
```

## Acceptance Criteria

**G2 — driven on the real app, not reasoned. This is the phase's headline claim and it must be shown.**

1. `npm run typecheck` exits 0; `npm test` passes with **no count regression against 56 files / 1888 tests**; `npm run grep:secrets` clean.
2. `IpcChannel` is still **86** — the assertions at `ipc.test.ts:3438` and `:3816` pass untouched.
3. **Claude, the real thing:** launch a claude session, establish a fact only that conversation knows, **quit Chorus completely**, reopen. Ask for the fact. **It answers correctly.** Screenshot both sides. Repeat once across a genuine machine reboot — that is the reported scenario.
4. **Codex, the real thing:** same demonstration. If discovery proves unreliable, this criterion converts to a recorded finding and codex ships without resume — **stated in the commit, not quietly dropped.**
5. **The assigned-pointer ordering (D143 c) is shown, not argued:** the row's `agent_session_id` is NULL before the spawn and non-NULL after. Demonstrate the failure direction too — force a spawn failure and show the pointer is **still NULL** afterwards, and that no "context was not restored" line appears on the next launch.
6. **A classified resume failure recovers cleanly and quietly (Q4 + D143 b):** corrupt or delete the transcript behind a stored pointer, restart the app, and show all six of —
   - the pane comes back **fresh and working**, with a **visible** "context was not restored" line;
   - `agent_session_id` is NULL, then non-NULL again under a **new** id;
   - **no OS exit toast fired**;
   - **the project rail did not go red**;
   - **no dispatch and no turn was closed** by that exit;
   - the row never reported `'exited'` to the renderer.
   The four negatives are the amendment (b) proof and they are the ones a reviewer cannot check by reading.
7. **A codex discovery miss is silent (Q4):** force discovery to miss. The pane runs normally, the pointer stays NULL, **no line and no badge appears**, and the log line is informational.
8. **Restart still forgets, and now says so (D142 + Q7 + D143 g):** press restart on a resumed pane. The agent is amnesiac, the "Session restarted" chip shows, `SELECT agent_session_id` is NULL immediately after and non-NULL again once the new conversation is named — **and the pane shows the retained history above a visible `── Session restarted: fresh conversation ──` boundary**, not continuous output. Screenshot. Then quit and reopen: **the boundary is still there, in the right place**, proving it was mirrored to disk rather than redrawn.
9. **A credentialed session still refuses to auto-restore** (D33/F26) — shown, not assumed.
10. **Discovery is abandoned cleanly:** quit Chorus during a codex discovery window. No write lands after quit; the next launch is fresh; nothing is logged after teardown.
11. Evidence under `_verify/4a-3/`.

## Review Checklist

- [ ] `IpcChannel` still 86; no new channel, no renderer file, no schema change.
- [ ] `agentEvents.ts` and `agentEventsCore.ts` byte-identical to HEAD (D130).
- [ ] **Zero transcript reads in this task** — no `existsSync` on a transcript path, no `.jsonl` reference outside the codex adapter and `contextUsage.ts`.
- [ ] The pre-flight existence check was **not** reinstated; failure handling is reactive classification only.
- [ ] `classifyResumeFailure` is consulted **only** for a launch that carried `action: 'resume'`.
- [ ] A discovery miss clears nothing, notifies nothing, relaunches nothing.
- [ ] `setAgentSessionId` for an assigned id runs **after** `pty.spawn` returns (D143 c) — grep proves the ordering.
- [ ] `clearAgentSessionId` is called on the restart path **before** the relaunch (D142) — grep proves both the call and the order.
- [ ] A classified resume failure sets `killRequested` **and** suppresses the exit fan-out; the suppression is reverted if the relaunch throws (D143 b).
- [ ] The relaunch happens at most **once** per spawn cycle, structurally — not by a counter that can be reset.
- [ ] `launchedAt` is captured **before** the spawn; discovery starts only **after** it succeeds and **never** for a resume launch (Q3).
- [ ] Discovery is aborted on quit, restart, disposal and superseding spawn, and the spawn generation is re-checked **immediately before** persistence.
- [ ] Ambiguous codex discovery claims **neither** candidate.
- [ ] Discovery failure is swallowed and logged, never propagated into a launch failure.
- [ ] The Q7 boundary is emitted through the **existing** `SessionOutput` emit path (D45(1)) and therefore appears in the mirror; it is **not** appended to `replaySeed`.
- [ ] The Q4 notice uses the same emitted-line mechanism, and the substitution is named in the commit.
- [ ] `RESTORE_CAP`, `RESTORE_STAGGER_MS`, `BUFFER_MAX_CHARS`, `SCRUB_FLUSH_MS` unchanged.
- [ ] `computeRestoreSet` and its three inputs unchanged; `restore()`'s relaunch call at `:395` byte-identical.
- [ ] D33/F26's credentialed refusal is untouched, at restore and at restart.
- [ ] No pointer is ever logged alongside a cwd in a way that reconstructs a transcript path in the log; `ResumeExitObservation.output` is never logged.

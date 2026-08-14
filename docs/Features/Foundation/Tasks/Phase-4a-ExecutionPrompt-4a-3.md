# Phase 4a — Execution Prompt (Task 4a-3)

_Generated 2026-08-13 against `main` at `9e3c83d`. Paste the body below into a **fresh** conversation._

> **⚠ THIS PROMPT COVERS THE FINAL TASK OF THE PHASE.**
> Tasks **4a-1** and **4a-4** landed on 2026-08-13 in `bbf6d32` (the dormant `agent_session_id` column and the scrollback mirror), with `a6fab79` completing 4a-4 by making restored scrollback *visible* rather than merely written. Task **4a-2** landed the same day in `9e3c83d` — the adapter resume contract you will now wire into the session lifecycle. There is **no open decision**: D139 RESOLVED, D140 RESOLVED, D142 RESOLVED (its scrollback half closed by CR-4a.0 Q7), D143 ADOPTED, all 2026-08-13.
>
> **This is the task that fixes the reported problem:** after it, a reboot returns agents that remember the conversation.

---

## PROMPT BODY — copy everything below this line

---

You are the **Coordinator** for Chorus **Phase 4a — Session Continuity**, executing **Task 4a-3** only.

Repository root: `C:\Projects\ContactEstablished\Chorus`
Expected branch: **`main`** — confirm with `git branch --show-current`. **Do not switch or create a branch without instruction.**
Expected HEAD at start: `9e3c83d` ("Agents can now be handed back their own conversation"). If HEAD differs, **re-verify every line number cited below before editing** and report any that moved.

## 1. Goal

Make a restored session **the same conversation**, not a new one with the same id — while leaving restart, credentialed sessions and every existing D16 guard behaving exactly as they do today. **Prime constraint: a failed resume must cost the user ONE honest line of terminal text, not a closed dispatch, a closed turn, an OS toast and a red project rail.** Task 4a-2 shipped the adapter contract and NOTHING calls it; this task is the wiring, and it is a hard compile dependency on 4a-2 (already merged).

## 2. Ground yourself first — read before editing

**Phase documents (your source of truth — read them, do not edit them, do not commit them). All are COMMITTED as of `9e3c83d` except `roadmap.md`, which is modified in the working tree and belongs to the coordinator:**

- `docs/Features/Foundation/Tasks/Task-4a-3.md` — governs scope
- `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-4a-3.md` — governs exact contents (542 lines; §3 through §9 detail the edits)
- `docs/Features/Foundation/Tasks/Phase-4a-Overview.md` — phase scope, verified ground facts, decisions
- `docs/Features/Foundation/CouncilBriefs/CouncilBrief-4a.0-ResumeContract-Findings.md` — the ruling. **⚠ Read its partial-run banner FIRST:** 3 of 4 members completed, GLM 5.2 returned no verdict token on any of the seven questions, and nothing in it was compiled, executed or tested by anyone who could see this repository.
- `docs/Features/Foundation/roadmap.md` §6 — decisions **D4**, **D16**, **D33**, **D45(1)**, **D129**, **D130**, **D139**, **D140**, **D142**, **D143**; findings **F26**, **F57**, **F59**, **F61**, **F62**, **F63**.

**Governing rules:**

- `CLAUDE.md` — locked architecture. Sessions live in main; all IPC is Zod-validated in main only; no new dependencies without asking.
- Roadmap §6 **D4** — verify CLI flags against the tool's own `--help`, never training memory.
- Roadmap §6 **G6** — re-count shared counters against the merged tree.

**Code to inspect before editing (verified at `9e3c83d`; confirm each):**

| Path | Line | What |
|---|---|---|
| `src/main/services/sessionManager.ts` | 27 | `BUFFER_MAX_CHARS` |
| `src/main/services/sessionManager.ts` | 34 | `SCRUB_FLUSH_MS` |
| `src/main/services/sessionManager.ts` | 38 | `RESTORE_STAGGER_MS` |
| `src/main/services/sessionManager.ts` | 42 | `RESTORE_CAP = 16` |
| `src/main/services/sessionManager.ts` | 300 | `attach()` |
| `src/main/services/sessionManager.ts` | 321 | `restore()` |
| `src/main/services/sessionManager.ts` | 370 | credentialed heal |
| `src/main/services/sessionManager.ts` | 395 | the relaunch `this.spawn(...)` — must stay byte-identical |
| `src/main/services/sessionManager.ts` | 499 | `kill()` |
| `src/main/services/sessionManager.ts` | 543 | `wasKilledByChorus()` |
| `src/main/services/sessionManager.ts` | 548 | `dispose()` |
| `src/main/services/sessionManager.ts` | 565 | `snapshot()` |
| `src/main/services/sessionManager.ts` | 577 | `capTail` composition |
| `src/main/services/sessionManager.ts` | 583 | `private spawn()` |
| `src/main/services/sessionManager.ts` | 619 | `adapter.buildLaunch({` |
| `src/main/services/sessionManager.ts` | 652 | `pty.spawn` |
| `src/main/services/sessionManager.ts` | 676 | `createSessionOutput({…onPersist})` |
| `src/main/services/sessionManager.ts` | 721 | `replaySeed:` IIFE |
| `src/main/services/sessionManager.ts` | 732 | `child.onData` |
| `src/main/services/sessionManager.ts` | 734 | `child.onExit` |
| `src/main/services/sessionManager.ts` | 743 | restart comment |
| `src/main/services/sessionManager.ts` | 749 | exit fan-out loop |
| `src/main/ipc.ts` | 1144 | `SessionLaunch` |
| `src/main/ipc.ts` | 1373 | `randomUUID()` row creation |
| `src/main/ipc.ts` | 1478 | `randomUUID()` row creation |
| `src/main/ipc.ts` | 1591 | `SessionRestart` |
| `src/main/ipc.ts` | 3966 | exit listener |
| `src/main/ipc.ts` | 4011 | exit listener |
| `src/main/ipc.ts` | 4169 | exit listener |
| `src/main/services/sessionOutput.ts` | 71 | the single `emit` |
| `src/main/services/sessionOutput.ts` | 89 | `onPersist` |
| `src/main/services/sessionOutput.ts` | 90 | `onText` |
| `src/main/services/sessionOutput.ts` | 94 | `ingest` |
| `src/main/services/scrollbackCore.ts` | 113 | `stripAltScreen` |
| `src/main/services/scrollbackCore.ts` | 126 | `replayEpilogue` |
| `src/main/services/storage.ts` | 1681 | `setAgentSessionId` |
| `src/main/services/storage.ts` | 1693 | `clearAgentSessionId` |
| `src/main/services/storage.ts` | 1703 | `getAgentSessionId` |
| `src/main/services/restore.ts` | 31 | `computeRestoreSet` (RestoreCandidate already accepts `agentSessionId`) |
| `src/main/services/dispatches.ts` | 96 | exit listener |
| `src/main/services/dispatches.ts` | 155 | `wasKilledByChorus` reader |
| `src/main/services/turns.ts` | 88 | exit listener |
| `src/main/services/notifications.ts` | 24 | exit listener |
| `src/main/index.ts` | 672 | exit listener |
| `src/main/index.ts` | 678 | exit listener |
| `src/renderer/src/components/TerminalPane.vue` | 1249 | restart chip — `Session restarted — new conversation` (UNTOUCHED by this task) |

**Git checks to run first:**

```bash
git branch --show-current      # expect: main
git log -1 --format="%H %s"    # expect: 9e3c83d …
git status --porcelain
```

## 3. ⚠ FOUR CORRECTIONS THE TASK DOCS GET WRONG

All four were measured at `9e3c83d`. **Trust these over the task documents where they disagree** — the documents were written against `a6fab79` and two of their claims did not survive re-measurement.

1. **The test baseline in both docs is STALE.** `Task-4a-3.md` Acceptance §1 and `ImplementationSpec-4a-3.md` §1 both say "56 files / 1888 tests". That was `a6fab79`. **At `9e3c83d` the real baseline is 57 files / 1924 tests.** ⚠ AND A RUN IN THE CURRENT DIRTY TREE REPORTS **1927 / 57**, because the tree carries an unrelated uncommitted `contextUsageCore.test.ts` change worth +3 tests (see the dirty-tree section). Measure your own baseline before you start and compare against what you measured, not against the docs.

2. **"The nine `sessions.onExit` listeners" is EIGHT registrations, not nine.** Both docs list nine sites and the list double-counts one. `src/main/services/dispatchAttribution.ts:275` is a **DOCBLOCK COMMENT** ("The fifth `sessions.onExit` listener…"), NOT a registration — `dispatchAttribution` never registers its own listener. The registration that invokes it is `src/main/ipc.ts:4169`, whose body is `void attribution.settleDispatch(sessionId)`. So the docs' table lists that one consequence twice. **Verified count: `grep -rn "sessions\.onExit(" src/main/` returns 8** — `dispatches.ts:96`, `turns.ts:88`, `notifications.ts:24`, `index.ts:672`, `index.ts:678`, `ipc.ts:3966`, `ipc.ts:4011`, `ipc.ts:4169`. **This changes nothing about the work** — suppressing the fan-out still prevents all of them, and `wasKilledByChorus` (`sessionManager.ts:543`) is still read by exactly one consumer (`dispatches.ts:155`), so the flag alone is still one-eighth of the job. It changes only the number you verify against, so an implementer does not hunt for a ninth registration that does not exist.

3. **HEAD moved from `a6fab79` to `9e3c83d`, but EVERY line number in both docs was re-verified and is UNCHANGED.** Task 4a-2 touched only `src/main/adapters/*` and `src/shared/ipc.ts` — none of the files 4a-3 edits. Every anchor in §2 was re-confirmed at `9e3c83d`, so the docs' own "re-confirm before editing anyway" warning still applies but should find nothing moved.

4. **The dirty-tree list in the docs is stale** — use the one below.

## 4. Pre-existing changes — DO NOT REVERT, STAGE, OR COMMIT THESE

The tree is **already dirty** when you start. **None of it is yours.**

```
 M docs/Features/Foundation/roadmap.md
 M docs/Plan.md
 M src/main/services/contextUsageCore.test.ts
 M src/main/services/contextUsageCore.ts
?? CLAUDE-PROJECT-MARKER.txt
?? docs/Features/Foundation/Investigations/Voice-Input-Feature-Requirements-source.md
?? docs/Features/Foundation/Phase-5-VoicePlan.md
?? "docs/Features/Voice Input/"
```

> ⚠ Two of these need naming explicitly:
> - **`roadmap.md`** is the coordinator's (`/architect`), carrying the F61–F63 additions and the Phase 4a update. Read it; do not edit it; do not commit it.
> - **`contextUsageCore.ts` + `contextUsageCore.test.ts`** are a THIRD PARTY'S uncommitted work — a codex status-line ellipsis fix, worth **+3 tests**. They are **not yours and not 4a-3's**, but ⚠ **they touch `parseCodexContextLeft`, which is the exact function F61 is about** — so read them before you touch anything nearby, and do not stage them.

**This task commits CODE ONLY.** Stage explicitly by path. **Never `git add -A` or `git add .`** in this repo.

## 5. Implementation scope — files owned, nothing else

| File | Change |
|---|---|
| `src/main/services/resumeCore.ts` | **Create.** The pure decisions: which `AgentSessionLaunch` (if any) a launch carries, and what an exit from it means. No `fs`, no `electron`, no `better-sqlite3`, no clock, **no `randomUUID` import** — the minter is injected. |
| `src/main/services/resumeCore.test.ts` | **Create.** The launch truth table exhaustively, plus the exit-disposition table. |
| `src/main/services/sessionManager.ts` | **Edit.** Plan the launch inside `spawn()` (`:583`); forward the modifier through the single `buildLaunch` call (`:619`); persist an assigned id **after** `pty.spawn` returns (`:652`); orchestrate discovery; classify the exit and suppress-then-relaunch once (`:734`); emit the conversation boundary; abort discovery on quit/kill/restart/superseding spawn. |
| `src/main/services/scrollbackCore.ts` | **Edit.** One pure function producing the boundary string, beside `replayEpilogue` (`:126`). |
| `src/main/services/scrollbackCore.test.ts` | **Edit.** Assert the boundary's exact bytes. |
| `src/main/ipc.ts` | **Edit.** `SessionRestart` (`:1591`) clears the pointer **before** relaunching and asks for the boundary. |

## 6. Resolved decisions — quote in code comments where they bite

- **D139 (RESOLVED 2026-08-13 by CR-4a.0)** — one launch path; `PtyLaunchSpec.resume` is the modifier; `buildLaunch` stays the only entry point. 4a-2 shipped it; this task consumes it.
- **D140 (RESOLVED 2026-08-12)** — claude assigns (`--session-id`), codex discovers (rollout `session_meta` header); the capability declares which.
- **D142 (RESOLVED 2026-08-12 / scrollback half CLOSED 2026-08-13)** — `session:restart` rotates the pointer, `restore()` preserves it.
- **D143(b) (ADOPTED 2026-08-13)** — the automatic relaunch fires the exit fan-out. `killRequested` is necessary but NOT sufficient: `wasKilledByChorus` is read by exactly ONE of the eight listeners (`dispatches.ts:155`), so **suppressing the fan-out is the load-bearing half**. The suppression must be narrow: only when the exiting launch carried a resume modifier, only when the adapter classified one of the four reasons, and **only if the immediate relaunch succeeds — if the relaunch throws, the exit must fan out after all**, or a `'running'` row is left with no PTY behind it.
- **D143(c) (ADOPTED 2026-08-13)** — the findings' action item 6 says "mints and persists an id before launch" and **the second half is wrong for this app**. D16 resolution (a) writes `'running'` only after the spawn succeeds. Ordering is exactly: **mint → `buildLaunch` → `pty.spawn` → only now `setAgentSessionId`.** Worst case of this ordering is an orphan transcript (invisible, costless); worst case of the inverted ordering is a **spurious "context was not restored" accusation on a session that never had context**.
- **D143(g) (ADOPTED 2026-08-13)** — the Q7 boundary is **emitted through `SessionOutput` (`sessionOutput.ts:94`), NOT appended to `replaySeed` (`sessionManager.ts:721`)**. Emitted, it is mirrored to disk and becomes a permanent, correctly-positioned record; seeded, it would be redrawn at every attach, drift, and never be recorded. ⚠ **This is a change to ALREADY-SHIPPED behaviour** — 4a-4 currently re-seeds a restarted pane silently — so the commit must narrate it as a behaviour change, not a new feature.
- **Coordinator ruling:** Q4's "visible pane badge" is implemented as **the same emitted terminal line as Q7's**, not renderer chrome. It is permanent, positioned in history, and costs no renderer file and no schema field. The existing restart chip (`TerminalPane.vue:1249`) is untouched. **This substitution must be named in the commit message.**

## 7. The Q4 failure rule — and the distinction that is load-bearing

A recognized failed resume (`not-found`, `in-use`, `transcript-unavailable`, `unusable-pointer`, as returned by the adapter's `classifyResumeFailure(observation)`) does exactly three things in order: (1) `clearAgentSessionId`, (2) relaunch **once** fresh under the same Chorus row id, (3) show a **visible** notice. Never silent, never a refusal to launch, never a second attempt at the same pointer in the same spawn cycle.

⚠ **A CODEX DISCOVERY MISS IS NOT A RESUME FAILURE.** A miss follows a **fresh** launch: no context was promised, no stale pointer existed, nothing was lost. The pointer stays NULL, **no notice appears**, no relaunch happens, and the log line is `info`. The two paths must be **structurally** distinguishable — the failure path is reachable **only** when the launch that just exited carried a modifier with `action: 'resume'`.

## 8. Strict non-goals

- **No transcript content read, parsed or stored by this task** — zero transcript bytes, including no `existsSync` on a transcript path. Rollout-header reading lives in the codex adapter (4a-2). `contextUsage.ts` remains the only transcript *content* reader.
- **⚠ DO NOT REINSTATE THE PRE-FLIGHT EXISTENCE CHECK.** The first draft of both docs required an `existsSync` before every reopen. It was considered and it lost: it put a munged-cwd path format Chorus does not own on the critical path of every restore, and put vendor filesystem layout in shared code — exactly what the council forbade in Q2/Q3. Failure handling is **reactive classification only**. If a picker is ever reached in practice, that is a 4a-2 argv bug and a finding, not a reason to add a stat call here.
- **D33 / F26 is NOT relaxed** — a credentialed session is still healed to `exited` at restore (`sessionManager.ts:370`) and never keyless-restored; `session:restart` still refuses it inline.
- No auto-resume for an agent with no pointer (NULL means fresh, silently).
- **No picker, ever.** No `--continue`, no `--last`, no `--fork-session`, no bare `--resume`.
- No change to `RESTORE_CAP` (16), `RESTORE_STAGGER_MS` (500), `BUFFER_MAX_CHARS`, `SCRUB_FLUSH_MS`.
- No change to `computeRestoreSet` or its three inputs; `restore()`'s relaunch call at `:395` stays byte-identical.
- **No change to `agentEvents.ts` or `agentEventsCore.ts`** — D130's read surface does not widen. The hook transcript path is a tempting second source for claude's id and is NOT needed (claude's id is assigned, not discovered). Do not wire it.
- **No second emit path for the boundary** (D45(1)).
- **No new IPC channel — `IpcChannel` stays 86.** No preload change, no renderer file, no schema change (v19 already shipped), no adapter change (4a-2 shipped it), no npm dependency.
- Do not revert, stage or commit the pre-existing dirty files.

## 9. Required workflow

1. **Ground** — read the phase documents and inspect every code anchor in §2 before editing. Report any line number that moved.
2. **Spec review** — re-read `ImplementationSpec-4a-3.md` and confirm the plan matches. Where the task doc and the spec disagree on scope, the **task doc** wins; on contents, the **spec** wins.
3. **Measure your own test baseline BEFORE editing** — do not trust the docs' 56/1888 (see §3 correction 1).
4. **Code-quality review** — review your own diff against the task's Review Checklist, item by item. Fix what fails.
5. **Verification** — run everything in §10, in full. **Run, don't just compile (G2).**
6. **One intentional narrated commit (G3)** — concise title, then a description a non-technical reader understands first and a technical reader second. Stage by explicit path. **Code only.**
7. **Do not push and do not open a PR** unless explicitly asked.

## 10. Verification commands

Run from the repo root.

### Build gates

```bash
npm run typecheck      # G1 — expect 0 errors
npm test               # compare against YOUR measured baseline, not the docs' 56/1888
npm run grep:secrets   # G4 — expect clean
```

### Channel tally (must not move)

```bash
grep -n "toHaveLength(86)" src/shared/ipc.test.ts    # expect two hits: 3438 and 3816
```

### Structural proofs

```bash
grep -rn "sessions\.onExit(" src/main/ | wc -l      # expect 8 (see §3 correction 2)
grep -rn "existsSync" src/main/services/sessionManager.ts src/main/services/resumeCore.ts   # expect ZERO
git diff --stat HEAD -- src/main/services/agentEvents.ts src/main/services/agentEventsCore.ts   # expect empty
```

### Ordering proofs (grep must show the order, not just the calls)

```bash
grep -n "setAgentSessionId\|pty.spawn" src/main/services/sessionManager.ts   # setAgentSessionId must come AFTER pty.spawn
grep -n "clearAgentSessionId" src/main/ipc.ts                                 # must precede the relaunch in SessionRestart
```

### Runtime gates (G2 — measure the app, do not reason about it)

Evidence under `_verify/4a-3/`.

| # | Do this | Expect |
|---|---|---|
| 1 | **The headline demonstration, claude:** launch a claude session, establish a fact only that conversation knows, **quit Chorus completely**, reopen, ask for the fact → **it answers correctly**. Screenshot both sides. Repeat once across a genuine machine reboot — that is the reported scenario. | both sides captured; fact retrieved correctly |
| 2 | **The headline demonstration, codex:** same. If discovery proves unreliable, this converts to a recorded finding and codex ships without resume — **stated in the commit, not quietly dropped**. | same as gate 1, or finding recorded and stated |
| 3 | **D143(c) ordering shown, not argued:** the row's `agent_session_id` is NULL before the spawn and non-NULL after. **Demonstrate the failure direction too** — force a spawn failure, show the pointer is still NULL and that no "context was not restored" line appears on the next launch. | NULL → spawn → non-NULL; failed spawn → NULL, no false notice on next launch |
| 4 | **A classified resume failure recovers cleanly AND quietly (Q4 + D143 b)** — corrupt or delete the transcript behind a stored pointer, restart the app, and show all six: the pane comes back fresh and working with a visible "context was not restored" line; `agent_session_id` is NULL then non-NULL under a **new** id; **no OS exit toast fired**; **the project rail did not go red**; **no dispatch and no turn was closed**; the row never reported `'exited'` to the renderer. ⚠ **The four negatives are the amendment (b) proof and they are the ones a reviewer cannot check by reading.** | all six observed; the four negatives documented |
| 5 | **A codex discovery miss is silent** — force a miss. The pane runs normally, pointer stays NULL, **no line and no badge**, log line is informational. | pointer NULL, no line, no badge, log info |
| 6 | **Restart still forgets, and now says so (D142 + Q7 + D143 g)** — restart a resumed pane: agent amnesiac, "Session restarted" chip shows, `agent_session_id` NULL immediately after and non-NULL once the new conversation is named, **and the pane shows retained history above a visible `── Session restarted: fresh conversation ──` boundary**, not continuous output. Then **quit and reopen: the boundary is still there, in the right place** — proving it was mirrored to disk rather than redrawn. | restart: chip shows, boundary appears, id NULL→non-NULL; reopen: boundary persisted in correct place |
| 7 | **A credentialed session still refuses to auto-restore** (D33/F26) — shown, not assumed. | healed to exited, no keyless-restore attempted |
| 8 | **Discovery is abandoned cleanly** — quit Chorus during a codex discovery window. No write lands after quit, the next launch is fresh, nothing is logged after teardown. | quit during discovery; next launch fresh; no writes after quit |

## 11. Findings this task inherits (from roadmap §5)

- **F57** — codex's `session_index.jsonl` carries no `cwd`; discovery must read the rollout header and **must never use the index as identity evidence**.
- **F59** — history replays only for sessions `restore()` actually relaunches; a session healed to `exited` shows an empty pane beside a complete mirror. OPEN, not this task's to fix, but do not make it worse.
- **F61 (NEW)** — **a resumed codex pane loses its context ring.** Measured: codex does not re-apply `-c tui.status_line` on resume in any `-c` position (0 renders, vs 8 on a fresh launch), while `-c model=` and effort overrides DO apply. `parseCodexContextLeft` matches `N% context left`, which a resumed session never prints, so the ring stays blank all session with nothing logged. ⚠ **This costs nothing today because nothing resumes — THIS TASK is what makes every resumed codex pane hit it.** Decide knowingly: fix it, or record it as shipped-with.
- **F62 (NEW)** — discovery's `cwd` compare is exact and therefore case-sensitive on a case-insensitive filesystem; a casing mismatch misses 100% of the time and is indistinguishable from "not discovered yet". Relevant the moment discovery orchestration runs against real paths.
- **F63 (NEW)** — `ResumeFailureReason` declares `transcript-unavailable` and `unusable-pointer` with no producer (`transcript-unavailable` proven unreachable for claude by planting a corrupt transcript). Either produce them or mark them reserved.

## 12. Failure honesty clause

If any verification command fails — including for an unrelated environment reason (a native-module ABI mismatch, a locked database, a missing CLI, a flaky test) — **capture the exact output verbatim, explain what you believe caused it, and do not claim success.** A partial pass reported as a pass is worse than a clean failure, because the next session builds on it. If a runtime gate cannot be run, say so explicitly and name what was skipped. Do not silently drop it.

## 13. Final report — required format

**Status:** one of `DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`

Then: 
1. **Files changed** (every path, created/edited marked). 
2. **Build results** — typecheck, `npm test` with file and test counts compared to YOUR measured baseline, `grep:secrets`. 
3. **Runtime results** — what you actually did and observed for each of the eight gates. Not "verified" — say what you saw, and attach the evidence. 
4. **Review outcomes** — the task's Review Checklist item by item, pass/fail. 
5. **Non-goals confirmation** — explicitly confirm: `IpcChannel` still 86; `agentEvents.ts`/`agentEventsCore.ts` byte-identical; zero transcript reads and zero `existsSync` on a transcript path; the pre-flight was NOT reinstated; `restore()`'s relaunch at `:395` byte-identical; no npm dependency; the §4 dirty files untouched. 
6. **The D143(b) negatives** — state the four explicitly with how each was observed. 
7. **Residual risks and findings** — anything a later task should own. **The highest finding in the roadmap is currently F63, so propose F64 or later**, and say why. Include a decision on F61. 
8. **Final `git status --porcelain`** and confirmation that only intended code paths were staged.

---

## END OF PROMPT BODY

---

## Coordinator notes (not part of the prompt)

- **This closes Phase 4a — there is no fifth task and no follow-up prompt to write.** 4a-1 and 4a-4 landed in `bbf6d32` with `a6fab79` completing 4a-4's visibility half; 4a-2 landed in `9e3c83d`. 4a-3 wires them together. After it merges, run `/architect` to close the phase: mark 4a-3 landed, settle F61 with whatever this task decided, and re-cut the §5 gate tally.
- **The §4 dirty-tree list is a snapshot at generation time.** `roadmap.md` and `Plan.md` were uncommitted when this prompt was generated. If they land first, the list shrinks — the next session should re-read `git status` rather than trusting it verbatim.
- **The `contextUsageCore` change in the tree belongs to someone else** and touches F61's exact function (`parseCodexContextLeft`). Read it before editing anything nearby; do not stage it.
- **No workflow kit exists in this repo** — there is no `.codex/workflows/subagents/`, so the coordinator pattern is followed manually. `Phase-4a-ExecutionPrompt-4a-2.md` is the format precedent and the record of how the previous task in this phase was run.

# Task 6b-4 — Write Nudge (CONDITIONAL)

_Phase 6b, task 4 of 4. Authored 2026-08-19 against `a3ba6f9`; amended 2026-08-19 after CR-6b.0 (D173)._

> **⚠ EXECUTE ONLY IF ALL THREE GATES BELOW HAVE PASSED; otherwise record *"deferred — milestone met
> without the nudge"* (or *"deferred — activation gate not passed"*) in the roadmap's Phase 6b table
> and stop.** D173 (CR-6b.0) turned the council's conditions into **hard gates**, not refinements:
>
> **(a) A CLEAN BASELINE FAILED.** 6b-1, 6b-2 and 6b-3 have landed **and** 6b-3's installed-app
> milestone drive has been run, and it recorded **`writes = 0`**. A baseline that was never run, or
> was run on the dev app instead of the installed one, is not a gate that passed — it is an unknown.
>
> **(b) THE LISTENER-DOWN BEHAVIOUR IS MEASURED AND SILENT IN THE PANE.** The non-zero-curl-exit case
> (exit **7** connection refused, exit **28** on `-m 2`) has been measured **on the installed claude**
> and shows **nothing in the user's pane**. **If it cannot be silenced, the nudge does not ship.**
> A pane-visible hook error on the non-`-o NUL` entry is a hard activation gate (D173 Q8), and no
> amount of the rest of this document overrides it.
>
> **(c) MATTHEW HAS EXPLICITLY AUTHORISED ACTIVATION**, after (a) and (b), in writing, recorded with
> its date in `_verify/6b-4/condition.txt`. Nobody else's judgement substitutes for it.
>
> D171 is explicit: *"the nudge is an escalation, not the plan."* It was decomposed now because its
> vehicle was D4-measured at the kickoff, not because it is expected to run. If 6b-1's write counter
> is non-zero after 6b-3's drive, this task's correct outcome is **one roadmap edit and no code**.

## Source Of Truth

| Document | Owns |
|---|---|
| `roadmap.md` §6 — **D171** | The ruling this task executes, verbatim: the vehicle, the refusals, and the execution condition. **⚠ Its v1 rule set is SUPERSEDED by D173's** — read both, and where they differ D173 wins |
| `roadmap.md` §6 — **D173** (CR-6b.0) | **The rule set this task implements** (Q8: never first prompt; contract emitted **and** graph reachable; no writes yet, **including reads-without-writes**; **at most once**; a line with no counters, timestamps, commands or imperatives), the **three hard activation gates**, and the **declined** "dormant route" |
| `roadmap.md` §6 — **D168** (6b-1), **D169** (6b-2), **D170** (6b-3) | The counters this task reads, the contract it presupposes, and the drive that decides whether it runs |
| `roadmap.md` §6 — **D130**, **D83**, **D55**, **D49** | The listener's read-surface posture, "a hook body is untrusted input", "no number without its denominator", "never write into the user's files" |
| `roadmap.md` §5 — **F92**, **F93** | Deferred MCP tools; TCP-vs-bolt false positives (context for what "reachable" means here) |
| [`Phase-6b-Overview.md`](Phase-6b-Overview.md) | The phase's verified ground table — **use its numbers, not this doc's, if the two ever disagree** |
| [`../ImplementationSpecs/ImplementationSpec-6b-4.md`](../ImplementationSpecs/ImplementationSpec-6b-4.md) | The four probes, the measured facts, the exact strings, the insertion points, the runtime checks |
| `code.claude.com/docs/en/hooks` (fetched 2026-08-19, kept at `_verify/6b-4/hooks.md`) | What a hook's exit code and stdout actually do — **the reference, not recall** |

## Initial Starting Point — verified 2026-08-19 at `a3ba6f9`; amended 2026-08-19 after CR-6b.0 (D173)

Every line number below was opened and read this session. **Re-verify all of them at pickup (G6):
6b-1, 6b-2 and 6b-3 land in these same three files first, and every number here will have moved.**

| Fact | Where | Value |
|---|---|---|
| `writeHooksConfig` | `claude.ts:200`–`:239` | resolves curl, builds ONE command, assigns ONE entry array to every classified event, writes `{hooks: config}`, returns `['--settings', path]` |
| The `-o NUL` rationale | `claude.ts:215`–`:221` | *"a hook command's STDOUT is a control channel"* — the comment this task must not weaken |
| The command string | `claude.ts:222`–`:224` | `"<curl>" -s -o NUL -m 2 -X POST -H "Content-Type: application/json" --data-binary @- "<endpointUrl>"` |
| **⚠ The shared entry array** | `claude.ts:225`–`:227` | `const entry = [...]` is assigned **by reference** to every key in the loop — one array object, N keys |
| `resolveCurl` | `claude.ts:407`–`:411` | `%SystemRoot%\System32\curl.exe` or `null`; `null` → no hooks, launch proceeds |
| `instructionsArgs` | `claude.ts:253` | the sibling that degrades the same way — the precedent for "losing this costs a hint, not the session" |
| `PtyLaunchHooks` | `types.ts:504`–`:526` | `endpointUrl` (`:521`, the capability warning) + `configPath` (`:525`). **Two fields today** |
| `SupportsHooks.writeHooksConfig` | `types.ts:836` | the signature; honesty pair at `adapters.test.ts:1383` |
| Listener header, security notes 1–5 | `agentEvents.ts:34`–`:75` | *"The surface is one route"* (note 3) and *"Two fields are read"* (note 5) — **both statements change and must be amended, not left standing** |
| `MAX_BODY_BYTES` | `agentEvents.ts:129` | `256 * 1024`; `REQUEST_TIMEOUT_MS` `5_000` at `:133` |
| `AgentEventListener` interface | `agentEvents.ts:135`–`:166` | `start` · `register` (`:144`) · `revoke` (`:146`) · `activityFor` · `recordFor` · `snapshot` · `onActivity` · `onTranscriptPath` (`:164`) · `dispose` |
| The token maps | `agentEvents.ts:170`–`:175` | `tokens` (token→sessionId) · `bySession` · `activity` |
| `record()` + the edge filter | `agentEvents.ts:181`, filter at `:198` | `if (prev?.activity === next && prev.reason === reason) return` |
| `reject()` — the 404 policy | `agentEvents.ts:223`–`:227` | `404` + `content-type: application/json` + `'{}'`, identical for every rejection |
| `handle()` | `agentEvents.ts:229`–`:302` | non-POST → reject (`:230`); `parseHookPath` (`:235`); unknown token → reject (`:237`); cap → `req.destroy()` (`:250`); **answers `200 {}` BEFORE parsing** (`:260`–`:261`); transcript listeners (`:276`); event name (`:289`) |
| `register()` | `agentEvents.ts:325`–`:336` | rotates the token, returns `http://127.0.0.1:${port}/hook/${token}` |
| `revoke()` | `agentEvents.ts:338`–`:343` | deletes from `tokens`, `bySession` **and `activity`** |
| `parseHookPath` | `agentEventsCore.ts:188`–`:202` | rejects `?`/`#`, requires the `/hook/` prefix, requires `^[0-9a-f]{64}$` |
| `readHookEventName` | `agentEventsCore.ts:219`–`:224` | string, 1..64 chars, else `null` |
| `classifiedHookEventNames()` | `agentEventsCore.ts:176` | `WORKING_EVENTS` (`:57`, includes **`UserPromptSubmit`** at `:60`) + `NEEDS_YOU_EVENTS` keys |
| The hooks mint | `sessionManager.ts:776`–`:788` | `endpointUrl: this.hooks.register(sessionId)` at `:780`, `configPath` at `:781` |
| The instructions mint | `sessionManager.ts:793`–`:799` | `opts.instructions && supportsInstructions(adapter)` — **the predicate the nudge's `graphReachable` reads** |
| `bindHooks` | `sessionManager.ts:324`–`:327` | `hooks` + `hookConfigDir`; `null` is a legal steady state (`:262`–`:266`) |
| `retireHooks` | `sessionManager.ts:395`–`:404`, called at `:712` and `:1022` | revokes the token and removes the file, on every exit path |
| `register` call sites | `sessionManager.ts:780` · `agentEvents.test.ts:61`, `:191` | **three, and that is all** |
| `PtyLaunchHooks` literals | `sessionManager.ts:779`–`:782` · `adapters.test.ts:1620`–`:1621` | **two construction sites, and that is all** |
| `parseHookPath` consumers | `agentEvents.ts:235` · `agentEventsCore.test.ts:170`–`:197` | one production caller, one describe block (13 rejection cases) |
| Baseline at kickoff | `roadmap.md` §Gates | typecheck **0** · vitest **2618 / 2618, 74 files** · `grep:secrets` clean · `IpcChannel` **107** · `MIGRATIONS.length` **20** · deps **9** · app **0.7.2** · claude **2.1.235** |

### ⚠ Four facts that will cost a session if they are not believed

1. **A non-zero exit with empty stdout puts a visible notice in the transcript.** The hooks reference,
   *Other exit codes*: *"With stdout that Claude Code treats as plain text, or with empty stdout, it's
   a non-blocking error for most hook events: the action proceeds, and the transcript shows a
   `<hook name> hook error` notice followed by the first line of stderr, prefixed with
   `Failed with non-blocking status code:`"* (`hooks.md:805`). **A curl that exits 7 (connection
   refused) or 28 (`-m 2` timeout) is exactly that case** — and `-o NUL` does not change it, because
   a failed curl writes nothing to stdout either way. **This is the thing D171 orders measured and
   silenced, and it is the single largest risk in the task.** **⚠ D173 PROMOTED IT TO A HARD
   ACTIVATION GATE (gate (b) above): if the pane-visible hook error cannot be silenced, the nudge does
   not ship at all.**
2. **The injected line is NOT visible in the pane.** *"Neither channel produces a visible transcript
   entry. Plain stdout and the `additionalContext` value are each injected as a system reminder that
   starts with the hook's name; Claude reads both. To confirm delivery, check the debug log"*
   (`hooks.md:1302`). **Do not write an acceptance criterion that says "the nudge appears in the
   pane" — it will not.** Delivery is confirmed from `claude --debug-file <path>` (`hooks.md:3434`),
   or behaviourally, from the agent making a graph read.
3. **The hook command runs through a shell whose identity is not fixed.** *"The `command` string is
   passed to a shell: `sh -c` on macOS and Linux, Git Bash on Windows, or PowerShell when Git Bash
   isn't installed"* (`hooks.md:462`). **`||` is a parse error in Windows PowerShell 5.1**, so a
   `curl … || exit 0` silencer would work on this dev machine (Git Bash present) and break on a user
   machine without it. Any silencer must be portable across `sh` and PowerShell — `; exit 0` is, and
   the spec's §0 measures it rather than assuming it.
4. **`const entry` at `claude.ts:225` is ONE ARRAY OBJECT shared by every event key.** `config[event]
   = entry` (`:227`) assigns the same reference N times. **Pushing the nudge entry into
   `config.UserPromptSubmit` would add it to every classified event** — a fifteen-fold multiplication
   of the nudge, silently, with no type error. Build a new array; never mutate `entry`.

## Goal

When 6b-3's drive proves an agent that has been told about the graph, given a compliable contract and
a reachable server **still writes nothing**, give it one more fact — at the only moment the CLI will
carry plain text into the model's context, in the only framing that will not be read as an attack.

Concretely: a second `UserPromptSubmit` hook entry whose stdout **is** the listener's HTTP response
body, a route that answers an empty body unless a narrow rule fires, and — when it fires — **one
invariant factual sentence**: that project memory is reachable for this session, and that sourced
memories can be recorded for completed milestones.

**⚠ THE RULE SET IS D173's, NOT THE DRAFT'S** (CR-6b.0 Q8, adopted — it supersedes D171's v1 list):

- **never on the first prompt** of a session;
- fire **only if the contract was emitted at launch** (6b-2's gate succeeded) **and the graph is
  currently reachable** — a session whose contract was withheld is never nudged. After D169 those are
  **one predicate** (the contract is emitted only when the launch-time MERGE succeeded), so one flag
  carries both; spec §1 names the accepted limit — the nudge path may not await anything, so it
  cannot probe, and *currently* is read as *as of launch*;
- fire **if the session has no memory writes yet — including reads-without-writes**. It is a *write*
  nudge, so an agent that has read but not written is a target, not an exemption. **The draft's "both
  counters zero" condition is dropped.**
- **at most ONCE per session** (the draft said twice);
- the line carries **no counters, no timestamps, no commands and no imperatives** — injected text is
  **replayed on `--resume`** (`hooks.md:976`), so anything that can go stale becomes durable false
  context. The sentence is invariant: it is as true on the replay as it was when it was injected.

The line itself — spec §1's `NUDGE_LINE`, D173's wording, and it must not open with a verb:

> `Project memory is reachable for this session; sourced memories can be recorded for completed milestones.`

Everything else about the hook bus, including the events entry's `-o NUL`, is untouched.

## Exact Scope

**Create**

- `src/main/services/nudgeCore.ts` — the pure rule. No `fs`, no `http`, no `electron`, no import of
  `agentEvents.ts`. **A new module rather than a function in `agentEventsCore.ts`**, because that
  file's subject is *classification of an untrusted body* and this one's is *a policy about when to
  speak*; they change for different reasons and the split keeps each testable alone.
- `src/main/services/nudgeCore.test.ts`

**Edit**

- `src/main/services/agentEventsCore.ts` — `parseHookPath` becomes `parseListenerPath`, returning
  `{ route: 'hook' | 'nudge'; token } | null`. **One parser, two prefixes, one token shape, one
  rejection policy.**
- `src/main/services/agentEvents.ts` — the `nudge` branch in `handle()`; three fields on the
  per-session record 6b-1 created; `register()` returns both URLs; `setGraphReachable`; the header's
  security notes 3 and 5 amended.
- `src/main/adapters/types.ts` — `PtyLaunchHooks.nudgeUrl`.
- `src/main/adapters/claude.ts` — the second `UserPromptSubmit` entry.
- `src/main/services/sessionManager.ts` — the mint (one destructure), and one
  `setGraphReachable` call beside the instructions mint.
- `src/main/services/agentEvents.test.ts` · `agentEventsCore.test.ts` · `src/main/adapters/adapters.test.ts`

**Nothing else.**

## Non-Goals

- **⚠ NO CHANGE TO THE `-o NUL` EVENTS ENTRY.** Not its flags, not its order, not its comment, not
  the events it is written for. It is the invariant a reviewer tests hardest.
- **⚠ NO "BUILD THE ROUTE NOW, DISABLED BY DEFAULT" — DECLINED BY MATTHEW ON 2026-08-19** (D173,
  CR-6b.0 Q8). The council asked for the vehicle to be built dormant. An entry that POSTs to `/nudge`
  on **every prompt** in order to receive an empty body is **not dormant**: it spawns a curl process
  per prompt, and it carries exactly the hook-error exposure the council itself made a **hard
  activation gate**. So **"disabled" can only mean THE ENTRY IS NOT WRITTEN** — which is precisely
  this task's conditional structure, so the structure stands and the council's rule set and gates are
  adopted inside it. Until the three gates above have passed, **nothing about the route or the entry
  exists in the code**: no `/nudge` prefix, no `nudgeUrl`, no `nudgeCore.ts`, no second entry.
- **No `Stop` or `SubagentStop` hook change, and no `decision` output from anywhere.** D171 refuses
  `Stop`-blocking for three named reasons: every fire costs a full extra model turn; an agent told it
  may not stop writes something to satisfy the gate — the *running commentary* the contract forbids;
  and the documented 8-consecutive-continuation cap is a trap for a rule that misfires.
- **No `PreCompact`.** Its only decision field is `decision: "block"` and nothing routes text into the
  post-compaction context (`hooks.md:984`, the Decision-control table). It is not a vehicle.
- **No `SessionStart` use.** The contract already travels by `--append-system-prompt-file` (D148,
  `claude.ts:253`); a second copy at session start would pay for the same words twice.
- **No reading of `prompt`, `tool_input`, `tool_response`, `last_assistant_message`, `cwd`,
  `permission_mode`, `prompt_id` or `session_id` off the nudge body.** `hook_event_name` **only** —
  and only to confirm the body is a `UserPromptSubmit`. D130's surface widens by **zero** fields in
  this task.
- **No persistence.** Turn ordinals and nudge counts are in-memory, cleared by `revoke()`. No
  migration: `MIGRATIONS.length` stays at whatever 6b-1 left it (**21**).
- **No codex change.** Codex has no hook bus (`codex.ts` capabilities: `hooks: null`), so it gets no
  nudge — *"an honest null, like its missing context ring"* (D171). Its argv must be byte-identical.
- **No new IPC channel, no new renderer route, no UI.** `IpcChannel` is unchanged by this task.
- **No new dependency.** Runtime deps stay **9**.
- **No user-owned file is read, written or created** (D49). The `--settings` file is Chorus-owned and
  deleted by `retireHooks`.
- **Do not revert, stage, commit or delete unrelated working-tree changes. Do not commit.**

## Dependencies

**Sequential — 6b-1 → 6b-2 → 6b-3 → 6b-4, and the last arrow is conditional.**

| Depends on | Why it is hard, not soft |
|---|---|
| **6b-1 (D168)** | The rule reads **`writes`** — and after D173 Q8 only `writes`, since reads-without-writes fires. Without that counter `composeNudge` has nothing to be conditional on and would fire on every session, forever. 6b-1 also owns the per-session record this task adds three fields to — **6b-4 must not create a second map.** |
| **6b-2 (D169)** | The nudge is meaningless without a compliable contract. Telling an agent "0 writes so far" when the contract cannot be complied with (F89) is telling it to fail again. 6b-2 also makes *reachable* mean something — the launch-time MERGE. |
| **6b-3 (D170)** | Always-on is what produces sessions that could nudge at all, and **its milestone drive is the gate on this task's existence.** |

### The execution condition, stated once so it cannot be skimmed

> **EXECUTE ONLY IF 6b-3's milestone drive recorded `writes = 0` on the installed app; otherwise
> record "deferred — milestone met without the nudge" in the roadmap's Phase 6b table and stop.**

**⚠ AND `writes = 0` IS ONLY GATE (a).** D173 made two more hard: **(b)** the listener-down /
non-zero-curl-exit behaviour measured on the installed claude and **silent in the pane** — if it
cannot be silenced the nudge does not ship — and **(c)** Matthew's explicit authorisation. All three
are recorded in `_verify/6b-4/condition.txt`, and any one of them failing is a deferral.

Read the condition off **6b-1's counters for the drive session** — the Memory section's `R reads · W
writes` line or the `sessions.memory_writes` column — **never off a transcript**, which is the
instrument the whole phase exists to replace. (6b-1's write counter is **PostToolUse-based**, so it
counts **successful** memory write-tool calls; a broken-Cypher call fires `PostToolUseFailure` and is
not counted — measured on claude 2.1.235, spec §0.) Record the number you read, its source and its
timestamp in `_verify/6b-4/condition.txt` **whichever way it goes**; a deferral with no evidence is
indistinguishable from a task nobody looked at.

## Step-by-step Work

1. **Check the condition first, before reading any code.** Write `_verify/6b-4/condition.txt` with the
   drive session's id, its `memory_reads` / `memory_writes`, where you read them, **the state of gates
   (b) and (c)**, and the decision.
   **If `writes > 0` — or if gate (b) or (c) has not passed: edit the roadmap's Phase 6b table row for
   6b-4 to `⬜ (conditional) → deferred — milestone met without the nudge` (or `deferred — activation
   gate not passed`), say so in your report, and stop.**
2. **Run the §0 probes** (spec §0) and record every output under `_verify/6b-4/`. They are: (a) what
   the pane shows when the listener is down and a non-`-o NUL` curl exits 7 or 28, and which silencer
   is quietest while still delivering stdout on success — **note that `a3`, today's `-o NUL` entry, is
   the baseline and may already show the notice**; (b) that a `UserPromptSubmit` hook's plain stdout
   still reaches the model on the **installed** claude at execution time — re-run the ZEBRA
   experiment, versions move; (c) that the **real nudge string** is acted on rather than surfaced as a
   suspected injection; and (d) **the one D171 does not name** — what `--resume` replays, since
   Chorus resumes claude conversations by design (D139) and an injected line is replayed rather than
   re-derived (`hooks.md:976`). **STOP and report if (b) fails** — the vehicle is gone and the design,
   not the code, needs fixing. **⚠ AND PROBE (a) IS ACTIVATION GATE (b) (D173 Q8): if no silencer
   makes the listener-down case silent in the user's pane, the nudge does not ship** — record the
   measurement, defer the task, and stop.
3. **Write `nudgeCore.ts`** — `NudgeState`, `composeNudge`, `NUDGE_LINE`, `MAX_NUDGES_PER_SESSION`,
   `FIRST_ELIGIBLE_TURN`. Pure; no imports at all. Exact strings in spec §1.
   **⚠ D173's shape, not the draft's: `MAX_NUDGES_PER_SESSION` is `1`, and `NudgeState` carries
   `turnOrdinal`, `writes`, `contractEmitted`, `graphReachable` and `nudgesSent` — there is no
   `reads` field, because reads-without-writes is a case that FIRES.**
4. **Widen the parser**: `parseHookPath` → `parseListenerPath` in `agentEventsCore.ts`, two prefixes,
   the same `^[0-9a-f]{64}$` shape check, the same reject-outright-on-`?`/`#`. Move
   `agentEventsCore.test.ts:170`–`:197` onto the new name and add the `/nudge/` mirror of every case.
5. **`agentEvents.ts`**: `register()` returns `{ endpointUrl, nudgeUrl }` from the one minted token;
   `setGraphReachable(sessionId, boolean)`; the `nudge` branch in `handle()`; the three record fields.
   **Amend security notes 3 and 5 in the header in the same commit** — D168 already establishes that a
   stale security claim must not outlive the code, and note 3's *"The surface is one route"* becomes
   false the moment this lands.
6. **`types.ts`**: `nudgeUrl` on `PtyLaunchHooks`, **required**, with the same capability warning as
   `endpointUrl` (it carries the same token).
7. **`claude.ts`**: the second entry, appended to `config.UserPromptSubmit` by building a **new
   array** (fact 4 above). The events entry, its flags and its comment are untouched.
8. **`sessionManager.ts`**: one destructure at the mint (`:779`–`:782`), one `setGraphReachable` call
   after the instructions mint (`:793`–`:799`). No new field, no new binder.
9. **Tests** (see below), then the runtime drive, then the roadmap row.

## Test Expectations

**New — `nudgeCore.test.ts`** (pure, `environment: 'node'`):

- **every rule, each alone** (D173's set): null when `graphReachable` is false — i.e. the contract was
  not emitted at launch; null at `turnOrdinal` 1; null at `nudgesSent` **1** (and 2, 3); null when
  `writes > 0`; the line at turn 2 with `writes = 0`, `nudgesSent = 0` and the flag true;
- **⚠ READS-WITHOUT-WRITES FIRES, IT DOES NOT SILENCE** — `reads` is not a field of `NudgeState` at
  all, and the case *"the session has read the graph but written nothing"* returns **the line**
  (D173 Q8; the draft's "both counters zero" condition is dropped, and this test is what stops a
  future edit reinstating it);
- **the exact string** — asserted as a literal, not by `toContain`, so a reword is a deliberate act;
- **at most ONCE per session** — driven as a loop over turns 1..10 that increments `nudgesSent` when
  the rule fires, asserting the total is exactly **1** (D173 Q8 — the draft's two is superseded);
- **the line carries nothing that can go stale** — a structural assertion, not a reading: it contains
  **no digit**, no colon, no path separator and no backtick or `$` (spec §7's `FORBIDDEN_SHAPES`), so
  a counter, a timestamp or a command cannot be added to it without a red test. This is the
  replay-safety rule (`--resume` replays injected text) made checkable;
- **the line is ASCII-only and one physical line** — `/^[\x20-\x7e]+$/` — because the body crosses a
  socket, a curl, a shell and a Windows console before the model sees it;
- **the line does not begin with `{`** (leading whitespace ignored). Claude Code decides plain-text
  vs JSON on the first non-whitespace character (`hooks.md:766`); a nudge that started with `{` would
  be parsed as a **hook decision object**;
- **the line contains no imperative opener and no directive phrase** — the forbidden list is in spec
  §Verification and lives in the test file, not in a comment.

**Extended — `agentEventsCore.test.ts`**: the 13 existing `parseHookPath` rejection cases become
`parseListenerPath` cases returning `null`, plus the `/nudge/` mirror of each, plus two acceptance
cases returning `{ route: 'hook' | 'nudge', token }`. **`/nudge/` with a bad token is `null`, not a
partial match** — the probe-resistance property is unchanged.

**Extended — `agentEvents.test.ts`** (driven through the real bound port, as the suite already does):

- `POST /nudge/<good token>` with a `UserPromptSubmit` body, on the **second** turn with `writes = 0`
  and `graphReachable` true → **`200`, `content-type: text/plain`, body === `NUDGE_LINE`**;
- the **first** turn → `200`, `text/plain`, **empty body**;
- a third, fourth and fifth eligible turn → **empty forever** (the **≤ 1** cap, D173 Q8: the line is
  never sent a second time in one session);
- a session that has **read** the graph but not written (`reads > 0`, `writes = 0`) → the line still
  fires;
- a body whose `hook_event_name` is anything else (`PreToolUse`, `Stop`, absent, not an object) →
  `200`, empty body, **and the turn counter does not move**;
- a **malformed** body (invalid JSON) → `200`, empty body, no throw;
- `POST /nudge/<unknown token>` → **`404` with `{}`** and `content-type: application/json`, byte for
  byte what `/hook` rejects with;
- `GET /nudge/<good token>` → `404 {}`;
- **`/hook` still behaves exactly as before** — the existing 11 edge-trigger cases pass unchanged,
  and a `UserPromptSubmit` on `/hook` still sets `working` **and does not increment the turn
  counter**;
- **⚠ the turn counter increments on the `/nudge` receipt ONLY.** Both entries fire on the same
  event and *"all matching hooks run in parallel"* (`hooks.md:410`), so counting on both routes would
  double-count and counting on `/hook` alone would race the nudge composition. Pinned by a test that
  POSTs to `/hook` five times and then to `/nudge` once, and asserts the nudge is still silent
  (turn 1);
- `revoke()` clears the turn count, the nudge count and the reachability flag — asserted by
  re-registering the same session id and finding turn 1 again.

**Extended — `adapters.test.ts`**: `writeHooksConfig` into a temp dir, then read the JSON back and
assert on the parsed object:

- **exactly one** command in the whole file lacks `-o NUL`, and it is `hooks.UserPromptSubmit[1]`;
- **every other event** has exactly **one** matcher group with exactly **one** handler, and that
  handler's command contains ` -o NUL ` and the `endpointUrl` — **this is the aliasing regression
  test** (fact 4);
- `hooks.UserPromptSubmit` has length **2**; `[0]` is the events entry, byte-identical to the entry
  written for `PostToolUse`;
- the nudge command contains `hooks.nudgeUrl` **exactly**, contains `--data-binary @-`, and contains
  no `-o NUL`;
- `writeHooksConfig` with no curl still returns `[]` and writes nothing (unchanged);
- a launch with `hooks` absent produces argv byte-identical to HEAD, for **all four PTY adapters**.

**Log hygiene** — a source-level assertion (the cheap half) plus a runtime grep (the real half): no
`logger.*` call in `claude.ts`, `agentEvents.ts` or `sessionManager.ts` interpolates `nudgeUrl`,
`endpointUrl` or a token; and the runtime drive greps the app log for the live token and finds
nothing. `claude.ts:234` already carries this rule for `endpointUrl`; `nudgeUrl` inherits it.

## Verification Commands

```
npm run typecheck
npx vitest run
npm run grep:secrets

# counters this task must NOT move
node -e "const s=require('fs').readFileSync('src/shared/ipc.ts','utf8');console.log('IpcChannel keys:',(s.match(/^\s+[A-Za-z]+: '/gm)||[]).length)"
node -e "const s=require('fs').readFileSync('src/main/services/storage.ts','utf8');const m=s.match(/const MIGRATIONS: string\[\] = \[([\s\S]*?)\n\]/);console.log('MIGRATIONS entries:',(m[1].match(/^\s*`/gm)||[]).length)"
node -e "console.log('deps:',Object.keys(require('./package.json').dependencies).length)"
```

```powershell
# the events entry is untouched: one emitter, one spelling
Select-String -Path src -Include *.ts -Pattern '\-o NUL' -Recurse

# no Stop/SubagentStop/PreCompact decision output anywhere in the diff
git diff -U0 | Select-String -Pattern 'hookSpecificOutput|"decision"|PreCompact|SubagentStop'
```

**Runtime drive — the task is not done until this has been observed, not compiled.** Dev app,
container up, memory configured, a claude pane in a project with memory:

1. **First prompt → no nudge.** Assert from the listener's own debug counter or a `logger.debug` line
   that prints **only** `nudge: none` — **never the text, never the URL, never the token**.
2. **Second prompt, still zero writes → the nudge fires.** `nudge: sent` in the log;
   the line **not** visible in the pane (fact 2 — record exactly what *is* visible, including nothing);
   and **6b-1's write counter moves** because the agent records a memory — with `memory:validate`
   saying whether it was *sourced*. That last clause is the only outcome that matters — the rest is
   plumbing. **A graph read with no write is a partial result and is recorded as one**, because this
   is a write nudge (D173 Q8).
3. **Third and later prompts → never again.** Drive at least five prompts and record the count; it
   must be exactly **1** (D173's ≤ 1 cap).
4. **Listener down.** Do **not** stop the dev app's listener (that would take the whole pane's lights
   with it). Instead hand-edit a copy of the session's `--settings` file so the nudge entry points at
   a closed port, run `claude -p --settings <copy>` from an empty directory, and **record exactly what
   the transcript shows** — the notice text if there is one, or its absence. Then repeat with the
   chosen silencer and show the difference.
5. **Resume the nudged conversation** and record whether the line replays (`hooks.md:976`) — and, if
   it does, that the replayed line is **still true**, which is exactly why D173 stripped the counters
   and timestamps out of it. A materially confusing replay is a **finding**, not a thing to patch in
   this task.
6. **Codex, same project**: argv byte-identical to the pre-task capture; no `/nudge/` anywhere.
7. **Close the pane**: the `--settings` file is gone (`retireHooks`), and a POST to the old
   `/nudge/<token>` gets `404 {}`.
8. **Log grep**: `Select-String` the app log for the session's token and for `/nudge/` — **zero hits**.

**Failure-honesty clause.** Paste the exact outputs into `_verify/6b-4/`, including the ones that did
not go your way. If step 2 fires the nudge and the agent still makes no memory write, **that is the
result** — record it, do not re-run until it passes, and do not report success. D171 called this an
escalation; an escalation that does not work is a finding, and F-numbering it is the correct outcome.

## Acceptance Criteria

- [ ] **ALL THREE ACTIVATION GATES PASSED BEFORE ANY CODE WAS WRITTEN** (D173), each recorded in
      `_verify/6b-4/condition.txt` with its evidence: **(a)** a clean baseline — 6b-1..3 landed and
      6b-3's installed-app milestone drive run — recorded **`writes = 0`**; **(b)** the listener-down /
      non-zero-curl-exit behaviour was **measured on the installed claude** and is **silent in the
      pane** (*if it could not be silenced, the task was deferred and no code was written*);
      **(c)** **Matthew explicitly authorised** activation, with the date.
- [ ] The execution condition was read off **6b-1's counters**, recorded in `_verify/6b-4/condition.txt`
      with its source, and honoured — including the "stop and defer" branch.
- [ ] All four §0 probes re-run against the **installed** claude this session; the version recorded;
      the silencer **measured, not assumed**, and the measurement kept.
- [ ] `composeNudge` is pure, imports nothing, and **every rule of D173's set** has its own
      failing-first test — including the one that **fires** on reads-without-writes.
- [ ] **At most ONE nudge per session** (D173 Q8), pinned by the turns-1..10 loop.
- [ ] The nudge line is **one ASCII line**, does not begin with `{`, contains **no counter, no
      timestamp, no command and no imperative opener** (D173 Q8), and is **invariant** — still true
      when `--resume` replays it (`hooks.md:976`).
- [ ] The listener has **exactly two** routes; everything else — every method, every path, every token
      shape — still gets an identical `404 {}`.
- [ ] The nudge route reads **`hook_event_name` and nothing else**; a non-`UserPromptSubmit` body gets
      an empty `200` and moves no counter.
- [ ] The turn counter increments on the `/nudge` receipt **only**, pinned by a test.
- [ ] The generated settings file has **exactly one** non-`-o NUL` command, under `UserPromptSubmit`,
      and every other event's entry is unchanged and unmultiplied.
- [ ] `revoke()` clears turn count, nudge count and reachability.
- [ ] Header security notes 3 and 5 in `agentEvents.ts` state the new truth.
- [ ] Neither URL nor token appears in any log line — asserted in tests **and** grepped at runtime.
- [ ] No migration, no IPC channel, no renderer change, no dependency, no codex change; codex argv
      byte-identical.
- [ ] typecheck **0** · vitest **≥ the 6b-3 baseline, plus the new cases** · `grep:secrets` clean.
- [ ] The roadmap's Phase 6b table row for 6b-4 records the outcome — shipped, or deferred with the
      number that deferred it.

## Review Checklist

A spec reviewer must confirm:

1. **The events entry is byte-identical to HEAD.** Diff `claude.ts:222`–`:227` and confirm only the
   lines *after* the loop changed. The `-o NUL` comment (`:215`–`:221`) must still be there and must
   still be true.
2. **`config.UserPromptSubmit` is a NEW array, not `entry` mutated.** Grep the diff for `.push(` and
   for `config.UserPromptSubmit[`. If `entry` is mutated anywhere, every classified event grew a nudge
   and the tests that would catch it are the ones in this task.
3. **The nudge route can never return a JSON decision object.** Grep the nudge branch for `writeHead`
   and confirm `content-type` is `text/plain` on every path, and that the only two bodies it can write
   are `NUDGE_LINE + '\n'` and `''`. A `{` reaching that socket is a hook decision Chorus never made.
4. **`readHookEventName` is the only reader on the nudge path.** Grep the branch for `body.` and
   `body[` — there must be no other property access. D168 widened the surface by one field; this task
   widens it by none.
5. **One parser, not two.** `parseListenerPath` must be the only place the token shape or the route
   set is written down. If `parseHookPath` still exists beside it, the rejection policy now has two
   homes and they will drift.
6. **`register()` mints both URLs from the same token, in one place.** If the implementer kept
   `register()` returning a string and added a second method, check that no call site can read the
   nudge URL *before* `register()` rotates the token — an object literal evaluates in source order,
   which makes that correct today and a one-line-move away from wrong.
7. **`graphReachable` defaults to `false`.** A session the app never told about is silent. Confirm
   there is no path where an unset flag reads as reachable — D171's rule is *silent when unreachable*,
   and "unknown" must fall on the silent side. **And confirm the one flag carries both of D173's
   launch conditions**: the contract was emitted at launch, which after D169 is the same fact as the
   launch-time MERGE having succeeded — one predicate, so there is no second signal that can disagree
   with the first.
8. **`revoke()` clears everything this task added.** A stale nudge count on a re-registered session id
   would silence a legitimate nudge; a stale reachability flag would fire one into a dead graph.
9. **No `Stop`, no `SubagentStop`, no `PreCompact`, no `SessionStart` in the diff.** All four are
   named refusals in D171 and the non-goals; a helpful extra entry is the failure mode this task is
   most likely to produce.
10. **The runtime evidence is real and includes the failure branch.** Step 4's "listener down" output
    must be a paste, not a paraphrase. Every argv and hook-behaviour regression this project has
    shipped was invisible to the person who made it and obvious in a captured diff.

> Council of 4 members plus an arbiter. All members completed.

> ⚠ **These findings are model deliberation, not verified fact.** Every claim below was produced by language models reading the brief. Nothing here was compiled, executed or tested, and no model in this council could see the repository. This project’s own CR-3b.0 was unanimous, its rulings were sound, and the code it shipped had four compile errors. Verify anything you are about to rely on.

# Council Findings — Brief 6b.0

## Decision summary

| Question | Council ruling |
|---|---|
| Q1 | **QUALIFY** — approve the bounded `tool_name` instrument with no-retention and semantic-scope safeguards. |
| Q2 | **QUALIFY** — persist minimal counters on `sessions`, but label denominator scope and lower-bound semantics honestly. |
| Q3 | **QUALIFY** — use the ordinal definition only after correcting vacuous passes, removing `Bash`, and handling unknown tools as inconclusive. |
| Q4 | **AGREE** — use launch-time `AgentSession` MERGE as both attribution creation and bolt reachability gate. |
| Q5 | **QUALIFY** — ship verified Cypher templates first, with self-verification and a pre-committed convenience-tool escalation. |
| Q6 | **QUALIFY** — launch-scoped auto-start and bolt wait are approved with fail-fast and cancellation conditions. |
| Q7 | **AGREE** — refresh once per `(project, HEAD)` after reachable launch, off the critical path. |
| Q8 | **QUALIFY** — build the dormant nudge vehicle, but activate only under a stricter replay-safe rule set. |

---

## Per-member positions

| Member | Q1 | Q2 | Q3 | Q4 | Q5 | Q6 | Q7 | Q8 |
|---|---|---|---|---|---|---|---|---|
| DeepSeek v4 Pro 0813 | Agree | Agree | Agree | Agree | Agree | Agree | Agree | Agree |
| GLM 5.3 | Agree | Agree | Qualify | Agree | Qualify | Agree | Agree | Agree |
| Grok 4.6 | Agree | Agree | Qualify | Agree | Disagree | Qualify | Agree | Qualify |
| Qwen 3.8 Max | Qualify | Qualify | Qualify | Agree | Qualify | Agree | Agree | Qualify |
| Arbiter | Qualify | Qualify | Qualify | Agree | Qualify | Qualify | Agree | Qualify |

The council is substantially aligned on the architecture: make memory reachable and usable at launch; repair the missing session attribution path; instrument Claude Code without reading content; measure a clean baseline before adding persuasion; and reject Stop-hook continuation.

The principal substantive disagreements are:

1. whether `Bash` is a valid proxy for filesystem exploration;
2. whether templates should be the first compliant-write vehicle or whether purpose-built MCP tools should ship immediately;
3. how narrowly to define metric denominators and nudge eligibility; and
4. how much replay risk a factual UserPromptSubmit nudge creates.

---

# Findings by question

## Q1: QUALIFY

Proceed with the `tool_name` widening.

The proposal is the narrowest workable instrument for the stated milestone. Chorus cannot determine that a memory read occurred before exploration without classifying both memory tool calls and exploration tool calls. The alternative of inspecting only the memory prefix leaves the ordering requirement unmeasurable except through transcripts, which the phase expressly rejects.

The instrument must read only `tool_name` on `PostToolUse`, shape-check it, length-cap it, compare it immediately against fixed classifications, and retain only counters and ordinals. It must not read `tool_input`, `tool_response`, prompts, transcript contents, assistant messages, or other hook-body fields. Counting from raw receipts before the edge filter is correct, because the edge filter is known to collapse calls and would destroy ordinal meaning. `PreToolUse` must not count: an attempted or denied call is not a completed invocation.

The scope of the metric must be stated honestly. A `PostToolUse` observation is evidence of a completed tool-call event, not necessarily evidence of a semantically successful graph read or write. The council was not given verified evidence that failed tool executions are excluded from `PostToolUse`. Until that is established, the counters must not be described as proof that a query succeeded or that a sourced memory was created.

### Recorded dissent and assessment

- **[Q1] Qwen’s qualification** that completed calls are not necessarily successful reads or writes is well-founded. The metric needs that explicit limitation.
- **[Q1] GLM, Grok, and Qwen’s concern** about error-path logging is well-founded. A diagnostic path that records raw `tool_name` or an entire hook body would defeat the stated “what is not taken cannot leak” posture.
- **[Q1] DeepSeek’s concern** that the security header must be revised to say that every completed tool name is classified is well-founded. The narrower wording would be misleading.
- **[Q1] The shared observation** that same-user possession of a per-session token could inflate counters is accepted as an [UNVERIFIED] bounded integrity risk, not a confidentiality expansion. It does not defeat the proposal, but the metrics should not be treated as adversarially tamper-proof.

### Checkable actions

1. Add a test that submits valid memory, exploration, unknown, malformed, and oversized `tool_name` values and verifies that no raw name or full hook body appears in logs, persisted state, UI broadcasts, or HTTP responses.
2. Count only `PostToolUse` receipts and classify before the listener’s edge filter.
3. Rename metric descriptions to “completed memory-tool calls” and “completed exploration-tool calls” unless successful-result semantics are separately verified.
4. Update the listener security-posture header to state that every completed tool-call name is inspected solely for classification and discarded.

---

## Q2: QUALIFY

Persist the minimal counters on the existing `sessions` table. This is the correct weight for the current requirement. In-memory state cannot survive restart and cannot support a durable session aggregate. A separate `memory_tool_calls` event table would add schema and retention surface without a current consumer requiring per-event, per-day, or per-tool history.

The migration-time denominator floor is also correct: sessions created before the instrument existed must not be included in a metric intended to evaluate post-instrument behavior. Monotonic counter persistence is appropriate because its known failure direction is under-count after restart, rather than double-counting.

The aggregate must be labelled with its actual scope. The evidence establishes a Claude Code hook path, not an equivalent Codex path. Therefore an unqualified label such as “across K sessions” would imply coverage the instrument does not provide. The display should say, at minimum, **“across K Claude Code sessions observed since \<migration date\>.”**

The council does not require a new eligibility model in this phase. However, Chorus must not silently call all post-v21 sessions “memory-enabled” or “memory opportunities.” If Chorus later needs an opportunity metric, it must define and record eligibility separately—for example, contract emitted at launch, graph reachable at launch, or memory configured—and name that denominator accurately.

### Recorded dissent and assessment

- **[Q2] Qwen’s proposal** to restrict the denominator to configured, reachable, contract-eligible sessions identifies a real interpretive issue. However, making that a hard v1 requirement would require a distinct eligibility model not otherwise proposed. The arbiter adopts explicit scope labelling now and permits a separate eligibility metric later.
- **[Q2] GLM, Grok, and Qwen’s Claude-only coverage concern** is well-founded. Codex sessions must not be counted as measured non-use merely because no equivalent hook instrument exists.
- **[Q2] GLM and Qwen’s lower-bound concern** is well-founded. Restart loss must be documented; it should not be hidden behind precise-looking totals.
- **[Q2] GLM’s recommendation** to write counters per event, rather than batch them, is prudent. It narrows the under-count window and is compatible with the minimal three-column design.
- **[Q2] GLM’s set-once requirement** for `memory_read_first` is well-founded. It is a derived ordering result and must not oscillate after subsequent events.

### Checkable actions

1. Add the three proposed columns to `sessions`: read count, write count, and read-first result.
2. Persist counter updates per observed receipt, using monotonic semantics that cannot double-count after restart.
3. Set `memory_read_first` only when its final condition becomes true; never reset a true result.
4. Display the aggregate as “R completed memory-tool calls · W completed memory-tool calls across K Claude Code sessions observed since \<migration date\>.”
5. Document that post-restart totals are lower bounds if events occurred after the last persisted update.
6. Do not include pre-v21 sessions in the aggregate denominator.

---

## Q3: QUALIFY

Use the two-ordinal approach, but revise the definition before implementing it.

The correct condition is:

> `memory_read_first = true` only when the session has at least one completed memory-read call and either no exploration call occurred or the first completed memory read preceded the first completed exploration call.

Without the first condition, a session with zero reads and zero exploration calls passes vacuously. That would inflate the read-first result and make the milestone appear satisfied by an inactive or unrelated session.

`ToolSearch` must remain excluded. The measured deferred-MCP behavior means that a compliant agent may need to call `ToolSearch` before it can access the memory tool. Counting it as exploration would make the intended behavior impossible to pass.

The arbiter’s exploration set is:

- retain: `Read`, `Glob`, `Grep`, `LS`;
- retain only after installed-version verification: `Agent`, or its actual equivalent name if the current CLI uses another name;
- remove from the pass/fail ordering set: `Bash`;
- exclude: `ToolSearch`;
- do not add mutation tools such as `Write`, `Edit`, or `MultiEdit` unless the milestone is deliberately broadened from filesystem exploration to repository interaction.

`Bash` is too broad when Chorus deliberately refuses to inspect `tool_input`. It can represent filesystem exploration, but it can also represent tests, builds, Git state inspection, package operations, process inspection, or unrelated shell work. Treating every shell call as exploration would depress the metric in a way that may trigger unnecessary escalation. Chorus may retain an aggregate shell-before-read diagnostic signal if it can do so without retaining names or inputs, but it must not make that signal dispositive for the milestone.

Unknown non-memory tools before the first read must not silently improve the agent’s result. The appropriate v1 result is **inconclusive**, not failure and not pass. This surfaces tool-set drift without falsely declaring a changed vendor tool to be exploration.

### Recorded dissent and assessment

- **[Q3] GLM’s vacuous-pass finding** is decisive and adopted.
- **[Q3] Grok and Qwen’s objection to `Bash`** is well-founded and adopted. DeepSeek’s argument that conservative over-inclusion is safer is not sufficient here because this metric controls escalation decisions, not merely a one-off compliance test.
- **[Q3] DeepSeek’s point** that `Bash` is a filesystem escape hatch is valid as a diagnostic concern, but does not justify treating every shell invocation as exploration.
- **[Q3] Qwen’s proposal** to add `Write`, `Edit`, and mutation tools would change the meaning of the milestone. The council rejects adding them unless the owner explicitly changes the target from “before filesystem exploration” to “before repository interaction.”
- **[Q3] GLM, Grok, and Qwen’s concern** about `Agent` versus historical alternative names such as `Task` is well-founded. Installed-CLI verification is load-bearing.
- **[Q3] Qwen’s unknown-tool safeguard** is adopted in refined form: unknown non-memory tools make the ordering result inconclusive rather than silently favorable or automatically exploratory.

### Checkable actions

1. Implement `memory_read_first = true` only if a completed memory read exists and precedes the first known exploration call, or if no known exploration call exists.
2. Exclude `ToolSearch`.
3. Include only verified installed names for `Read`, `Glob`, `Grep`, `LS`, and the current equivalent of `Agent`.
4. Exclude `Bash` from the pass/fail exploration ordinal; optionally retain a separate aggregate shell-before-read diagnostic.
5. Do not include mutation tools in the exploration set.
6. Mark a session’s ordering result inconclusive if an unknown non-memory tool occurs before its first memory read.
7. Re-verify exact built-in tool names against the installed Claude Code version before release.

---

## Q4: AGREE

Proceed as written.

A launch-time bolt `MERGE` for the Chorus-written `:AgentSession` node solves F89 directly: the contract can refer to a node that has actually been created, and the agent has the session identity required to create `PRODUCED` provenance. It also tests the actual capability that matters: a bolt-level graph write. The measured TCP-versus-bolt readiness gap supports rejecting TCP probing.

Withholding the contract when the MERGE fails is correct. A caveated contract would still instruct the agent to perform writes that depend on an unavailable graph and unavailable session provenance node. Launching with MCP wiring intact, logging the failure, and showing “graph unreachable at launch — contract withheld” in Chorus is the right division: the user sees the state, while the agent is not given an internally inconsistent contract.

This gate establishes only launch-time truth. A graph may fail after launch. That is ordinary mid-session tool failure and does not justify late contract injection, retroactive contract revision, or use of the nudge to introduce a previously withheld contract.

### Recorded dissent and assessment

- **[Q4] The shared concern** that the graph could die after a successful launch-time MERGE is well-founded but not a reason to reject the gate. It is a bounded residual condition.
- **[Q4] Qwen’s opposition to late contract injection** is adopted. The replay and conversational-context concerns are material.
- **[Q4] The kickoff’s behavioral prediction** that caveated contracts train agents to regard memory as flaky is [UNVERIFIED], but the stronger reason remains: a caveated contract is mechanically inconsistent with a failed provenance-write probe.

### Checkable actions

1. Perform the `AgentSession` MERGE before composing or injecting the usage contract.
2. Use bolt write success, not TCP port availability, as the reachability condition.
3. Inject the contract only after successful MERGE.
4. On MERGE failure, retain MCP wiring, launch normally, log the state, and display “graph unreachable at launch — contract withheld.”
5. Do not late-inject a withheld contract if the graph later becomes reachable.

---

## Q5: QUALIFY

Ship the parameterised Cypher templates as the first measured write path, but strengthen them and pre-register the alternative.

The historical zero write-tool calls do not isolate raw Cypher complexity as the cause. They occurred while the path was known to be structurally noncompliant: no `AgentSession` node was created, the agent did not know its session identity, the contract lacked property and query details, and the graph was not maintained as reachable. Therefore the evidence does not yet justify concluding that templates are inherently unworkable.

However, the concern raised by Grok, GLM, and Qwen is valid: a multi-clause write with composite-key matching can fail silently. A `CREATE` may succeed while a later `MATCH` finds no cited file or commit, yielding an uncited memory. A write-tool completion counter would then falsely suggest progress.

The WRITE template must therefore be self-verifying. Its result must reveal that all of the following were created:

1. the `:Memory` node;
2. exactly the intended `PRODUCED` edge from the current session; and
3. at least one `SUPPORTED_BY` edge.

The contract must state that a result lacking those confirmations is a failed write and should be corrected or retried. The sourced-memory validator—not the `write_neo4j_cypher` completion count—is the ground truth for the write side of the milestone. Where feasible, validator reporting should be scoped to memories produced by the launched session.

The council does not rule that a Chorus-owned MCP `remember`/`recall` pair is forbidden. An agent-invoked MCP tool can plausibly satisfy “agents write through MCP; Chorus measures,” but whether it satisfies the prior council’s “no app-mediated graph writes” ruling is [UNVERIFIED]. That interpretation must be explicitly decided if the convenience tools are introduced.

The escalation path is therefore:

1. run one clean baseline with the repaired contract, launch gate, reachability, and self-verifying templates;
2. distinguish lack of attempts from malformed or unsourced attempts;
3. if write attempts remain absent or sourced writes remain persistently malformed/unsourced, bring an optional agent-invoked `recall` / `remember` MCP path forward;
4. retain raw Cypher alongside any convenience path.

### Recorded dissent and assessment

- **[Q5] Grok’s recommendation** to ship purpose-built tools immediately is reasonable but premature on the available evidence. The zero-write observation is heavily confounded by F89 and F90.
- **[Q5] Grok’s strongest concern**—the silent `CREATE`/unmatched-citation failure mode—is well-founded and adopted through a required self-verifying template.
- **[Q5] GLM’s distinction** between willingness failure and ability failure is well-founded. Q8 cannot solve an inability to compose valid Cypher.
- **[Q5] Qwen’s template-first approach** is adopted, with the condition that it is an experiment rather than a permanent commitment.
- **[Q5] The 5.5k-character Codex rendering cost** is material, but not independently decisive: it is measured at about 17% of the Windows command-line limit, not a demonstrated failure. It should be retained as a compatibility check.
- **[Q5] The concern** that convenience tools hide graph shape is real but mitigated by retaining raw Cypher tools and documenting the schema/property set.
- **[Q5] The foreign `search` full-text index** is a real data-governance and compatibility risk. Its owner and relationship to `:Memory` writers are unknown from the evidence supplied. It must be investigated before validator figures become headline adoption metrics.

### Checkable actions

1. Provide project, workspace, repository, session, agent, and model identifiers in the contract.
2. Keep the `:Memory` property set verbatim and do not add `confidence`.
3. Include parameterized READ, WRITE, and SUPERSEDE templates only after verifying them against the target Neo4j version.
4. Make the WRITE template return explicit evidence of created memory, `PRODUCED`, and `SUPPORTED_BY` relationships.
5. State in the contract that missing provenance verification means the write failed.
6. Use sourced-memory validator output, scoped to the launched session where possible, as write-side milestone evidence.
7. Record the `remember` / `recall` convenience-path interpretation as an explicit future decision rather than treating it as already authorized by the prior ruling.
8. Investigate and document the owner, purpose, and writer implications of the foreign `:Memory` full-text index before publishing validator-derived adoption ratios.

---

## Q6: QUALIFY

Proceed with launch-scoped auto-start and bolt readiness waiting.

A late UserPromptSubmit contract cannot satisfy a memory-before-initial-exploration requirement. It arrives only after the first prompt has been submitted and may be replayed on resume. The measured warm-start bolt readiness of approximately 4.3 seconds supports a bounded wait as the less invasive path.

The launch click is a defensible user-initiated trigger for starting a Chorus-provisioned `local-docker` container. This is a narrowing of the prior “nothing runs unattended” rule and should remain explicitly recorded as such. Chorus must never start user-owned “existing” containers and must not start containers at application boot.

If `docker start` fails—for example because Docker Desktop or the daemon is unavailable—Chorus must fail fast to the no-contract path. It must not wait the full bolt deadline against a container that was never started. The launch dialog must also provide cancellation during the wait.

### Recorded dissent and assessment

- **[Q6] Grok’s qualification** requiring fail-fast after `docker start` failure is well-founded and adopted.
- **[Q6] GLM’s cancellation requirement** is well-founded. A 20-second busy state without a pane is acceptable only if the user can abandon it.
- **[Q6] The late-contract alternative** is rejected. The concern that it arrives too late for Q3 and persists through resume is supported by inspected hook behavior.
- **[Q6] The claim** that a typical wait is cheap enough is partly [UNVERIFIED] as a user-experience judgment, but the bounded 20-second deadline and timeout fallback constrain the risk.

### Checkable actions

1. Auto-start only stopped `local-docker` containers that Chorus provisioned.
2. Never auto-start a user-configured existing container or any container at app startup.
3. On successful `docker start`, poll bolt readiness against a 20-second wall-clock deadline.
4. Use bolt readiness, not TCP connectivity.
5. On `docker start` failure, skip polling and launch immediately without the contract.
6. Make the launch wait cancellable.
7. On timeout or failure, launch without contract and show the reason in the Memory section.

---

## Q7: AGREE

Proceed as written.

Refreshing once per `(project, HEAD)` after a reachable launch is the narrowest automatic policy that addresses the measured stale-index condition. It avoids the ongoing contention and unattended activity associated with timers, watchers, repository hooks, and app-start refreshes.

The run must be asynchronous from the launch path and protected by an in-flight guard keyed by `(project, HEAD)`, not by session. This matters when several agents launch concurrently against the same project and commit state.

The contract should disclose the indexed head. That makes the structural graph’s freshness legible and prevents agents from assuming that it reflects changes made later in a long-running session.

### Recorded dissent and assessment

- **[Q7] The shared concern** that HEAD may move during a session is accepted. Publishing indexed HEAD is the appropriate mitigation; continuous refresh is not required.
- **[Q7] GLM and Grok’s emphasis** on a `(project, HEAD)` guard is well-founded and adopted.
- **[Q7] The interpretation** that repository hooks cross the same user-repository boundary as forbidden instruction-file writes is prudent. No repository hook should be introduced.

### Checkable actions

1. Read current `HEAD` only after successful reachable launch.
2. Start indexing only if `lastIndexedHead` is absent or differs from current HEAD.
3. Key both deduplication and in-flight protection by `(project, HEAD)`.
4. Run indexing after launch returns; do not block pane creation.
5. Do not add timers, file watchers, post-commit hooks, or app-start refreshes.
6. Include the indexed HEAD in the emitted contract.

---

## Q8: QUALIFY

Build the dormant nudge vehicle now, but do not activate the draft rule set unchanged.

The vehicle is measured: UserPromptSubmit stdout can reach the model, while Stop continuation can force an extra model turn. The council agrees that Stop-hook continuation should be refused outright. It is coercive, expensive, vulnerable to misfire loops, and incompatible with an advisory-and-measured provenance policy.

The baseline must run without the nudge first. The nudge should be considered only after the repaired contract, reachability gate, session attribution, and indexing work are landed and measured. It should also not be used as the first response to an ability failure: if agents attempt malformed or unsourced writes, Q5’s convenience-tool escalation is the more relevant intervention.

If explicitly authorized after a failed clean baseline, ship this rule set:

- disabled until the baseline has failed and activation is authorized;
- never fire on the first user prompt;
- fire only where the memory contract was emitted at launch;
- fire only while the graph is currently reachable;
- fire only if the session still has no sourced-memory output;
- permit firing after reads without writes, because this is a write nudge rather than a read nudge;
- fire at most once per session;
- emit one short, declarative, non-imperative line;
- include no counters, timestamps, commands, urgency, or other facts likely to become false after replay;
- remain silent if the listener is unavailable or the HTTP invocation could expose a pane-visible hook error;
- do not use Stop-hook continuation.

A suitable invariant line is:

> “Project memory graph is reachable; sourced project memories are available for completed milestones.”

This is intentionally less specific than the draft’s “0 reads and 0 writes so far” line. The latter becomes stale after later graph activity and is replayed on resume.

### Recorded dissent and assessment

- **[Q8] Grok and Qwen’s replay concern** is well-founded and adopted. A counter-bearing zero-status line can become false after later reads or writes, yet persist in a resumed transcript.
- **[Q8] DeepSeek’s view** that the stale line is bounded and perhaps harmless understates the problem. The issue is not only frequency; it is durable false context.
- **[Q8] GLM’s support** for the draft’s two-fire limit is not adopted. One fire per session is sufficient for a dormant, measured intervention and minimizes replay burden.
- **[Q8] Qwen’s condition** that the contract must have been emitted is adopted. A session whose contract was withheld should not receive a late memory prompt through a different hook.
- **[Q8] Qwen’s original both-counters-zero condition** is not adopted. An agent that reads but does not write is an appropriate target for a write nudge.
- **[Q8] The open curl failure-surface concern** is a hard activation gate, not merely a future refinement. If a failed nudge request produces a hook error in the pane, the nudge must remain disabled.
- **[Q8] The shared Stop-hook refusal** is adopted outright. The measured ability to continue is a reason for restraint, not an invitation to use it.

### Checkable actions

1. Add the second UserPromptSubmit route and hook entry, but leave it disabled by default.
2. Preserve `-o NUL` on the existing lifecycle-events route.
3. Before activation, test listener-down, timeout, malformed-response, and non-zero curl exit behavior and verify that no pane-visible hook error occurs.
4. Activate only after a documented baseline failure and explicit authorization.
5. Enforce: contract emitted, graph reachable, not first prompt, no sourced session memory, maximum one fire per session.
6. Emit no counters, timestamps, commands, imperatives, or out-of-band framing.
7. Do not add Stop-hook continuation.

---

# Cross-cutting risks and mitigations

| Risk | Status | Mitigation |
|---|---|---|
| Completed tool-call events may include failed queries | Unverified from supplied evidence | Label counters as completed tool-call observations; use sourced-memory validator for write success; verify PostToolUse failure behavior separately. |
| Raw `tool_name` leaks through diagnostics | Credible implementation risk | Test ordinary, malformed, and exception paths for absence of names and bodies from logs, persistence, UI, and responses. |
| Vendor tool names drift | Unverified but expected maintenance risk | Verify names against installed CLI before release; mark unknown pre-read tool sessions inconclusive. |
| `Bash` creates false exploration results | Supported by tool ambiguity | Exclude from pass/fail ordering; optionally retain aggregate diagnostic signal only. |
| Codex lacks equivalent hook measurement | Established by supplied evidence | Scope aggregate explicitly to Claude Code observed sessions; do not represent it as all-agent adoption. |
| Counter loss after restart | Known design tradeoff | Persist per receipt; describe totals as lower bounds where appropriate. |
| Launch-time graph availability does not guarantee session-long availability | Ordinary operational risk | Do not late-inject contracts; treat later graph loss as normal tool failure. |
| Templates create unsourced memories through unmatched citations | Credible failure mode | Require self-verifying WRITE result; validate sourced state; escalate to optional convenience tools if baseline fails. |
| Convenience tools conflict with prior “no app-mediated writes” ruling | Unverified interpretation | Require explicit future decision before introducing them; keep raw Cypher available. |
| Late or replayed nudge becomes stale context | Inspected replay behavior | No late contract injection; nudge once only; invariant factual line with no counters. |
| Nudge hook errors become user-visible | Open measured requirement | Do not activate until failure behavior is measured and silent. |
| Foreign `:Memory` full-text index indicates an unknown external writer or schema state | Observed but ownership unknown | Identify owner and impact before treating validator denominator as a project adoption headline. |

---

# Final action register

The following actions are required before claiming the fixed milestone has been met:

1. **Instrument safely:** implement Q1’s PostToolUse-only classification, immediate reduction, no-retention tests, and completed-call metric labels.
2. **Persist honestly:** implement Q2’s three session columns, migration-floor aggregate, per-event monotonic persistence, Claude-only scope label, and lower-bound disclosure.
3. **Correct ordering logic:** implement Q3’s non-vacuous rule, verified tool set, excluded `Bash`, excluded ToolSearch, and unknown-tool-inconclusive outcome.
4. **Repair the launch contract:** implement Q4’s AgentSession MERGE gate and contract withholding on failure.
5. **Make templates verifiable:** implement Q5’s parameterized, self-verifying WRITE flow and source the write-side milestone from validator-confirmed sourced memory, not write-call counts.
6. **Make local Docker dependable:** implement Q6’s launch-only local-docker start, bolt wait, start-failure fast path, cancellation, and no-contract timeout behavior.
7. **Refresh structure narrowly:** implement Q7’s once-per-`(project, HEAD)` background index refresh and indexed-head disclosure.
8. **Measure before nudging:** ship Q8’s dormant route only; do not activate it until the repaired baseline fails, listener-failure behavior is silent, and the owner explicitly authorizes activation.
9. **Resolve graph ownership ambiguity:** identify the source and effect of the foreign `search` full-text index and determine whether another writer can affect the validator denominator.
10. **Report adapter scope:** ensure all milestone reporting distinguishes Claude Code hook-observed sessions from adapters for which equivalent counters do not exist.

The council’s final position is that the feature should first be made mechanically usable and honestly measurable. Persuasion must remain a conditional, replay-safe fallback—not a substitute for fixing reachability, attribution, write mechanics, and metric validity.

---

## How disagreement was detected

- **Q1** — detection: `structural` · members disagreed
- **Q2** — detection: `structural` · members disagreed
- **Q3** — detection: `structural` · members disagreed
- **Q4** — detection: `structural` · members agreed
- **Q5** — detection: `structural` · members disagreed
- **Q6** — detection: `structural` · members disagreed
- **Q7** — detection: `structural` · members agreed
- **Q8** — detection: `structural` · members disagreed

_`structural` means the orchestrator compared the members' own verdict tokens and counted the difference. `model-judged` means too few members answered in the required form, so the arbiter judged it from prose — a weaker signal, labelled rather than hidden._

## Dissents preserved

_30 preserved: 6 structural (computed from the members' own verdict tokens) · 24 from critique prose, from 4 members — DeepSeek v4 Pro 0813 6 · GLM 5.3 6 · Grok 4.6 6 · Qwen 3.8 Max 6._

_⚠ Read the per-member split before reading breadth into the total: several objections from one member is one member disagreeing repeatedly, not several members disagreeing. Nothing is dropped to make the total smaller._

- [Structural — Q1] Should Chorus's hook listener read the tool name off every Claude Code tool-call event — comparing it against two fixed sets and keeping only counters, never the name — as the instrument for measuring graph reads and writes? — AGREE: DeepSeek v4 Pro 0813, GLM 5.3, Grok 4.6 · QUALIFY: Qwen 3.8 Max
- [Structural — Q2] Should the per-session read and write counters be persisted as three columns on the existing sessions table, with the aggregate's denominator floored at the migration's own apply time, rather than kept in memory or written to a separate table? — AGREE: DeepSeek v4 Pro 0813, GLM 5.3, Grok 4.6 · QUALIFY: Qwen 3.8 Max
- [Structural — Q3] Is "the first completed memory read precedes the first completed call to a fixed set of built-in exploration tools" a sound operational definition of the milestone's "reads the graph before exploring the filesystem"? — AGREE: DeepSeek v4 Pro 0813 · QUALIFY: GLM 5.3, Grok 4.6, Qwen 3.8 Max
- [Structural — Q5] Should the usage contract hand agents three parameterised Cypher templates to copy, rather than Chorus shipping its own purpose-built MCP tools such as recall and remember that write the provenance edges themselves? — AGREE: DeepSeek v4 Pro 0813 · QUALIFY: GLM 5.3, Qwen 3.8 Max · DISAGREE: Grok 4.6
- [Structural — Q6] Should a launch of a memory-configured project start its stopped container and wait up to twenty seconds for the database before the agent starts, rather than launching immediately and delivering the contract later? — AGREE: DeepSeek v4 Pro 0813, GLM 5.3, Qwen 3.8 Max · QUALIFY: Grok 4.6
- [Structural — Q8] Should the write nudge be a second UserPromptSubmit hook whose stdout is one factual status line from the counters, built now but executed only if the milestone fails without it, with Stop-hook continuation refused outright? — AGREE: DeepSeek v4 Pro 0813, GLM 5.3 · QUALIFY: Grok 4.6, Qwen 3.8 Max
- [Critique — R1] DeepSeek v4 Pro 0813: I would not keep `Bash` in the exploration set as A does. Without reading `tool_input`, counting every `Bash` completion as “exploration” conflates `git status`, `npm test`, or a build with actual filesystem exploration and may make a compliant memory-first session fail. A calls that harshness acceptable, but it also makes the metric less credible as evidence of a real behavioural change. On Q8, A underweights the resume-replay problem: a stale "0 reads and 0 writes" line is not merely a harmless factual line once counters change. The nudge should not embed counters, or should be weakened to a single invariant line.
- [Critique — R1] DeepSeek v4 Pro 0813: A does not sufficiently address unknown non-memory tool names in Q3. Fixed sets drift as vendor tools change, and silently ignoring unknown pre-read tools fails open in the agent’s favour. A also does not explicitly decide what happens if the graph becomes reachable later in a session; Q4 withholds the contract, but late re-injection should be covered. ### Position B
- [Critique — R1] DeepSeek v4 Pro 0813: B moves too quickly from "`write_neo4j_cypher` has been called 0 times ever" to "ship purpose-built tools now." The measured zero is confounded by prior reachability/session-node failures, so it does not cleanly prove templates are unworkable; it proves the whole write path has never been usable. I would therefore make the named `recall`/`remember` pair the first escalation and possibly run them as the active write path, but I would not yet treat the template path as unrecoverable without one clean baseline. B’s Q5 conclusion is likely right, but its inference is slightly stronger than the evidence.
- [Critique — R1] DeepSeek v4 Pro 0813: B does not mention A’s Q3 zero-read/zero-exploration vacuous-pass bug. It also omits the error-path logging risk for `tool_name`. B’s Q2 denominator discussion misses C’s point that migration-time sessions may include non-memory-configured or ineligible sessions, so the denominator should be labelled carefully. ### Position C
- [Critique — R1] DeepSeek v4 Pro 0813: C is too committed to template-first in Q5. The measured zero raw-Cypher write calls, plus the known LLM failure mode of copying parameterised Cypher unreliably, makes another template-first run a likely wasted milestone cycle. The named `recall`/`remember` tools should be built earlier than C proposes, though not necessarily as the only path. C’s Q2 denominator filter is also slightly too demanding for v1; constraining the denominator to contract-eligible sessions requires a separate definition of eligibility and can hide reachability or configuration failures that should remain visible in the aggregate. A migration-time floor plus explicit scope labelling is sufficient now.
- [Critique — R1] DeepSeek v4 Pro 0813: C does not call out A’s zero-read/zero-exploration vacuous-pass condition. It also does not mention the error-path logging risk for `tool_name`, the foreign FULLTEXT index question, or the Codex adapter gap as explicitly as A and B do.
- [Critique — R1] GLM 5.3: First, Q3's acceptance of `Bash` rests on a flawed premise — that over-inclusion "creates false negatives rather than false passes, which is the safer failure direction." That is only safe if the metric is used solely for pass/fail. It isn't: the metric gates escalation (Q8's execute-only-if-milestone-fails) and could gate vehicle decisions (Q5). A systematically depressed `memory_read_first` rate caused by routine `git status`/`npm test` first-actions can trigger interventions that aren't warranted. Second, Q8's endorsement of "twice per session" as "appropriately restrained" ignores inspected evidence that injected stdout is replayed on resume; A never engages the replay problem at all, unlike both other members. Third, uniform AGREE across eight questions with no conditions, no new risks, and no execution gates reads as under-examination, not independent confirmation, given the material findings the other two members produced.
- [Critique — R1] GLM 5.3: The instrument is Claude-only — Codex has no hook bus, so the milestone is unmeasurable outside Claude Code and the UI/Memory section must say so or Codex sessions read as non-use. Completion ≠ semantic success; the write side needs the validator's sourced-memory count as ground truth. Denominator eligibility: post-v21 sessions where memory was never configured or contract-eligible dilute the ratio. The foreign FULLTEXT index `search` on `:Memory(name,type,observations)` in the live graph, which breaks template/recall assumptions. In Q5, the measured counter-evidence (0 lifetime `write_neo4j_cypher` calls; ~5.5k template characters ≈17% of the Windows Codex command-line limit) is never weighed. In Q6, no fail-fast when `docker start` itself fails. In Q8, no counter-condition or contract-emission restriction on firing. No requirement to re-verify tool names against the installed binary. ### Position B
- [Critique — R1] GLM 5.3: Q5's central evidence is confounded. The 0/0 history accrued under a pipeline F89 shows was broken end-to-end: the contract referenced an `:AgentSession` node nothing created (so any attempted write would fail) and launch-time reachability/auto-start did not exist. Zero attempts under a guaranteed-broken path is weak evidence about the *vehicle*; B itself recites that broken pipeline in Q4. B's vehicle-independent argument — the measured ~5.5k-character command-line cost on an already-fragile Codex path — is the strong one and should lead; as written, the DISAGREE over-reads its measurement. Second, Q8's fire condition ("writes zero") omits the read counter and the contract-emitted restriction: an agent that recalled but never wrote is arguably the nudge's primary target, and a session whose contract was withheld at launch should probably never see a nudge; B takes no position. Third, Q3 keeps `Agent` on an empirical claim ("how this CLI actually walks a tree") without the verification instruction B itself correctly demands for tool names.
- [Critique — R1] GLM 5.3: Denominator eligibility — flooring at v21 still admits sessions where memory was never configured or the contract never considered; the UI line is well-formed but the denominator's meaning needs that tightening or labeling. Restart under-count is acknowledged as mechanism but B never asks the UI to present counters as lower bounds. Read-side success semantics: erroring reads inflate the read ordinal and B says nothing, having backstopped only the write side. The escalation path if the weakened nudge still fails is mentioned only in passing ("record another deferral") rather than as a pre-registered rule. ### Position C
- [Critique — R1] GLM 5.3: First, Q3 is silent on `Bash` — the single most contested member of the set and the item B built its entire qualification around. A definition that rules on `Agent` and unknown tools but not `Bash` is incomplete. Second, the unknown-tool rule offers two options ("count as exploration or make the metric inconclusive") without choosing; given drift, these behave very differently over time and C should state a preference. Third, Q8 rule 4 (both counters zero) is stricter than B's without justification — the nudge is a *write* nudge, and an agent that reads but never writes is precisely the engaged-but-non-contributing case; C should defend or drop the restriction. Fourth, and most important, Q5's escalation trigger — "agents understand the intent but repeatedly produce malformed or unsourced Cypher" — cannot fire in the actually-observed failure mode: zero attempts. If agents never call the Cypher tool at all, C's trigger never activates and the experiment loops indefinitely.
- [Critique — R1] GLM 5.3: Adapter coverage. C's entire unprompted observation is about metric validity, yet it never notices the metric is structurally Claude-only (no Codex hook bus) — for a position centered on measurement semantics, this is the biggest omission in the set. The foreign FULLTEXT index on `:Memory`, directly relevant to C's own property-set concerns. Q8 bans timestamps and imperatives but never bans embedded counters, so the replayed-falsification problem B caught is only partially covered by once-per-session. Q6 inherits the 20-second budget without B's fail-fast on `docker start` failure. The measured command-line cost of templates (~5.5k characters) is never weighed in Q5, despite being material to C's own stance.
- [Critique — R1] Grok 4.6: Treating every answer as an unqualified AGREE flattens real defects. Q3 as drafted allows a vacuous pass (0 reads and 0 exploration scores 1); that must be fixed before the definition is “reasonable.” Q5’s “revisit later if templates fail” is too late: a silent CREATE-without-edges failure mode needs a self-verifying RETURN now, and the ability-vs-willingness escalation should be pre-registered. Q8’s curl/`-o NUL` hook-error is not merely an “execution gate”; if it cannot be silenced the nudge must not ship. “I would not add or remove a tool” also skips name verification (`Agent` vs `Task`) and the unknown-tool case.
- [Critique — R1] Grok 4.6: Error-path persistence of `tool_name` (a debug log undoes the posture). Whether `PostToolUse` fires on failed/denied tools, so counters can credit unsuccessful reads. Vacuous `memory_read_first`. Denominator scope beyond the floor (memory never configured / never contract-eligible; Claude Code–only instrument). Mid-session graph death after a true-at-launch contract. Codex/CLI template constraints. F91 coverage honesty and the foreign FULLTEXT `search` index implying an unknown writer in the validator denominator.
- [Critique — R1] Grok 4.6: Reading 6.0 as already allowing a Chorus-owned `remember` MCP tool “in spirit” is too strong to treat as nearly settled; record it as an interpretation and keep templates as the shipped v1 without implying the ruling is already satisfied. Pre-committing remember/recall as the *first* escalation is right as a ladder entry, not as a near-term build. The vacuous-pass QUALIFY is correct; the rest of Q3 need not have been only QUALIFY on that account.
- [Critique — R1] Grok 4.6: C’s tighter opportunity-set denominator (configured + contract-considered, or an honest “sessions observed by the instrument” label). Unknown non-memory tools before the first read should not silently favour the agent (count as exploration or mark inconclusive) and should be tallied internally without retaining names. Write-side ground truth belongs on the validator’s sourced `:Memory` count, not on write-tool completions. Q8 once-vs-twice under resume replay: the stale-line harm is small, but a second fire needs a higher bar than the draft’s two. File-mutation tools (Write/Edit) are outside a strict “exploration” test; the milestone text should say so explicitly rather than leave a write-before-read pass implicit.
- [Critique — R1] Grok 4.6: Removing `Agent` from the set unless verified is the wrong default: treat current drafts’ membership as the baseline and *verify* the installed name (`Agent`/`Task`); dropping it without that check opens the main delegation/filesystem hatch. Adding Write/Edit/MultiEdit is a different milestone (“do not mutate before memory”) and should not be smuggled into the exploration ordinal. “Any unknown non-memory tool counts as exploration or inconclusive” is the right *direction*, but making the session inconclusive is better than silently scoring it as exploration if the name set is still being verified. Tightening Q2’s denominator to “launch path considered the contract” is right if it is cheap; if it is not yet representable, insist on the label, not on blocking three columns. Q8 “at most once” is stricter than needed: ≤2 with both-counters-zero and a factual line is enough given the stale-replay residual; once is acceptable but not required. “Disabled by default / enable only after failure” matches the measurement plan already; restating it as a QUALIFY overstates disagreement with the draft.
- [Critique — R1] Grok 4.6: B’s vacuous `memory_read_first` (0/0 → 1). Error-path logging of `tool_name`. Self-verifying WRITE template as a v1 mitigation that does not require new tools. Per-event vs batched counter flush. Fail-fast when `docker start` itself fails. In-flight index guard keyed on (project, HEAD) under multi-agent launch. F91 Claude-Code-only scope on the Memory-section aggregate. The appendix FULLTEXT index / unknown writer polluting the validator denominator. Whether PostToolUse increments on errored tool results.
- [Critique — R1] Qwen 3.8 Max: Position A — its unqualified Q3 endorsement is too weak: counting Bash as filesystem exploration without reading tool_input makes ordinary non-filesystem shell commands fail otherwise compliant sessions, and its Q5 template confidence ignores the measured zero-write history and silent MATCH-nothing failure mode; Q1/Q8 also need error-path no-logging and curl-hook-error gates before ship.
- [Critique — R1] Qwen 3.8 Max: Position A — it does not handle zero-memory-read vacuous passes, crash-loss from batched counter flushes, set-once semantics for memory_read_first, PostToolUse behaviour on errored tool calls, Codex/non-Claude denominator scope, mid-session graph death after contract issue, or the foreign FULLTEXT index.
- [Critique — R1] Qwen 3.8 Max: Position B — keeping Bash in the exploration ordinal remains over-broad for a milestone that cannot inspect tool_input; I would exclude Bash from the read-first ordinal or make it diagnostic-only, while accepting that this creates a gaming residual that the sourced-write ratio and later input-aware instrumentation can address; its treatment of the foreign index and Codex scope as observations rather than launch-blocking scope limits is acceptable but still needs explicit denominator wording.
- [Critique — R1] Qwen 3.8 Max: Position B — although it raises PostToolUse-on-error uncertainty, it does not settle the intended semantics for failed memory reads in the milestone definition; it also does not fully address replayed stale nudge lines beyond calling them acceptable, and it could be clearer that if Bash is excluded, the task should still record shell calls separately to avoid losing the filesystem-escape-hatch signal.
- [Critique — R1] Qwen 3.8 Max: Position C — requiring purpose-built remember/recall tools immediately is premature before measuring contract v2 and the self-verifying template remedy; the safer ladder is templates with RETURN/edge validation first, then named tools if writes remain absent, because tool-building adds surface and may conflict with the prior measurement-first posture; its proposed nudge that omits counters may be too weak and arguably less transparent than a bounded, replay-safe factual counter line, and excluding Bash entirely without a separate shell diagnostic loses a real escape-hatch signal.
- [Critique — R1] Qwen 3.8 Max: Position C — it does not explicitly require at least one completed memory read to set memory_read_first, so a zero-read/no-exploration session could still pass unless its broader prose is tightened; it also under-specifies how the validator distinguishes ability failure from willingness failure if writes stay zero, and it does not address error-path logging of tool_name or counter loss from batched flushes.

## Provenance

- **Run id:** `2f158260-bf3f-4b06-baa0-cddb8a22eca5`
- **Started:** 2026-08-19T14:55:01.134Z

| Member | Role | Model | Turns |
|---|---|---|---|
| DeepSeek v4 Pro 0813 | member | `deepseek/deepseek-v4-pro-0813` | answered 2 turns |
| GLM 5.3 | member | `z-ai/glm-5.3` | answered 2 turns |
| Grok 4.6 | member | `x-ai/grok-4.6` | answered 2 turns |
| Qwen 3.8 Max | member | `qwen/qwen3.8-max` | answered 2 turns |
| GPT 5.6 Terra | arbiter | `openai/gpt-5.6-terra` | answered 2 turns |


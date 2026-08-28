> Council of 4 members plus an arbiter. All members completed.

> ⚠ **These findings are model deliberation, not verified fact.** Every claim below was produced by language models reading the brief. Nothing here was compiled, executed or tested, and no model in this council could see the repository. This project’s own CR-3b.0 was unanimous, its rulings were sound, and the code it shipped had four compile errors. Verify anything you are about to rely on.

## Per-model positions
DeepSeek v4 Pro 0813: Q1 hybrid(identity-first, display-only reconciliation) / Q2 socket-only / Q3 distinct / Q4 reshaped / Q5 none — `sessionId` is durable while the registry name is live state; drift must be visible, but Chorus must not fight the CLI by reasserting names. It supports a strictly directed, pull-only message timeline and permits only guarded future PTY input, never socket access. — Strongest counterargument: a PTY delivery capability can become a chat-composer loophole unless it remains an audited terminal-input action rather than messaging infrastructure.

GLM 5.3: Q1 hybrid(identity-first with drift surfacing) / Q2 socket-only / Q3 distinct / Q4 reshaped / Q5 none — Registry names are live-resolved attributes, while `requestedName` is retained only as launch intent and comparison baseline. Phase 0 must include a minimal live registry join if it renders an address chip; otherwise it presents a cached promise. — Strongest counterargument: adding polling and drift UI to Phase 0 exceeds its original half-day scope, though the added work is load-bearing and reusable in Phase 1.

Grok 4.6: Q1 hybrid(identity-first with live name display and drift signaling) / Q2 absolute / Q3 distinct / Q4 reshaped / Q5 Phase-2 presentation fork only — The current registry name must be the only name shown as presently routable, with a sticky, cause-specific drift state; no automatic reassertion is justified. It favors a permanent ban on a composer-like control, while accepting that ordinary focus-and-type remains sufficient. — Strongest counterargument: a permanent composer ban may unnecessarily foreclose a future explicit, guarded PTY-terminal action that never speaks the peer protocol.

Qwen 3.8 Max: Q1 hybrid(identity-first with live drift surfacing) / Q2 socket-only / Q3 distinct / Q4 reshaped / Q5 stable local alias versus volatile CLI address — A stable Chorus pane identity must be separate from the volatile CLI address, and unavailable registry state must never be represented by a stale live address. The timeline is justified only as an on-demand directed-message inspector with no ambient-feed mechanics. — Strongest counterargument: allowing PTY insertion in principle can create pressure for a composer unless the distinction between terminal input and protocol messaging remains enforceable.

## Council synthesis
Q1: **hybrid(identity-first with live drift surfacing, no reassertion).** Chorus keys and joins owned Claude panes exclusively by `sessionId`; `requestedName` is launch intent, while the registry `name` is the only current peer address. On a confirmed address change, the pane chip immediately changes to the current address and retains a sticky transition state, for example `Requested Zeta; current wt-e27d8654-6a · collision` or `Requested Zeta; current redesign-dictation-overlay · renamed`; the old name is historical context, never displayed as currently routable. If the registry is unreadable, the entry is stale, or liveness cannot be confirmed, Chorus shows `Address unavailable` or `Address unconfirmed`, not the last good name as live. (**unanimous 4-of-4**)

Q2: **socket-only prohibition.**  
**Enforceable rule:** *Chorus must never open `messagingSocketPath`, read `.key` files, or send peer-protocol bytes; no composer ships in Phases 0–3, and any later operator-send UI may only make an explicit, operator-confirmed, audited text-only PTY write to a Chorus-owned pane.*  
The socket boundary is permanent and absolute. The council does not authorize a composer now: focus-and-type remains the supported reply path, and Phase 3 broadcast is a separately scoped action. A future PTY-assisted terminal-input action is not ruled out in principle, but it must not become a protocol client, autonomous sender, or chat surface. (**majority 3-of-4**)

Q3: **distinct, conditionally.**  
**Distinguishing sentence:** *Every record in this view is an addressed message one agent deliberately sent to another; it is a consulted reconstruction of the conversation, not an ambient notification stream about activity.*  
The timeline is permitted only as a pull-only, on-demand directed-message inspector: no unread counts, notifications, presence pings, status events, ticker, or generalized transcript feed. It must index only canonical `queue-operation` / `enqueue` records, visibly state that it is Claude-only and partial, and remain separate from Mission Control’s prohibited activity-feed pattern. (**unanimous 4-of-4**)

Q4: **reshaped; ship before the AI-title experiment is settled.** Phase 0 becomes “requested launch name plus live verification,” not merely “pass `-n` and display it.” Thread `-n` through fresh and resume launches, persist the requested name, and include the minimal registry poll and `sessionId` join needed to show either a current verified address or an explicit unavailable/unconfirmed state. Whether AI titling overwrites explicit names then affects the frequency and wording of drift states, not Phase-0 correctness. (**unanimous 4-of-4**)

Q5: **none, with a clarification adopted.** A Chorus-controlled namespace is not routable by Claude peers; transcript-only reconstruction lacks current liveness, eligibility, and address state; declining the feature leaves Chorus blind to actual traffic passing through its PTYs. The adopted clarification is that Chorus must preserve a stable local pane identity distinct from the volatile CLI peer address. The remaining Phase-2 fork—global inspector versus pane-local decoration—is a presentation decision, not a competing addressing architecture. (**2-of-4 for “none”; two qualified positions adopted as clarifications**)

Dissents:  
- **Grok 4.6, Q2:** Absolute prohibition on a fleet composer. Its unresolved reason is that a PTY injection control can become a chat-composer loophole even if it never touches the protocol socket. The council considers this well-founded as a scope-control risk, but finds a permanent prohibition broader than the hard socket constraint; the Phase 0–3 ban and strict future gate address the risk.  
- **DeepSeek v4 Pro 0813, Q1:** The drift UI must remain salient and not collapse into a transient rename indication. The council agrees; the ruling requires a sticky transition state rather than a one-poll badge.  
- **Grok 4.6, Q5:** The only load-bearing alternative is the Phase-2 presentation fork between global and pane-local message visibility. The council agrees this remains a genuine Phase-2 decision, but not a replacement for the addressing model.  
- **Qwen 3.8 Max, Q5:** Stable local pane identity versus volatile CLI address is load-bearing. The council adopts this as part of the selected hybrid rather than treating it as a separate alternative.

## The addressing rule (concrete enough to implement)
Chorus persists, for each owned Claude pane:

- stable Chorus pane/session identity;
- Claude `sessionId`, obtained from the transcript filename and used as the sole registry and transcript join key;
- `requestedName`, the exact value passed to `claude -n`;
- launch/restore state sufficient to pass the same `requestedName` on `--resume`.

Chorus does **not** persist, key, index, or treat as authoritative the registry `name`.

On each validated registry refresh, main resolves:

- current registry `name`;
- `nameSource`;
- `status`;
- `peerProtocol`;
- liveness and start-time match;
- registry/read availability;
- duplicate-name state among currently live registry entries.

The renderer receives validated plain objects only. It never derives a live address from cached launch state.

Chorus never reasserts a name. It must not write a registry file, relaunch a process to reclaim a name, type a rename command, or otherwise compete with the CLI’s collision and rename behavior.

When `requestedName` and live `name` disagree:

- the live name is the only name presented as currently routable;
- the chip and roster retain the requested name as historical context;
- Chorus shows a sticky state until superseded by a newer stable state or explicitly acknowledged;
- the state is cause-specific where evidence permits.

Minimum states:

- `verified`: current live name equals requested name;
- `renamed`: current live name differs from requested name;
- `collided`: observed behavior indicates a collision fallback or another live session shares the address;
- `duplicate`: more than one live registry session currently exposes the same name;
- `unconfirmed`: a matching registry entry cannot yet be validated as live;
- `unavailable`: registry data cannot be read or parsed.

Examples:

- `Mae`
- `Requested Mae; current redesign-dictation-overlay · renamed`
- `Requested Zeta; current wt-e27d8654-6a · collision`
- `Address unavailable — registry unreadable`
- `Address unconfirmed — process identity not verified`

Roster anchoring, pane focus, owned-pane matching, deduplication, and persistence use stable Chorus identity and Claude `sessionId`, never `name`.

## What Phase 0 ships vs defers
**Shipped now**
- Thread `sessionName` to `claude -n` on both fresh-launch and `--resume` paths.
- Persist `requestedName` as launch intent.
- Apply launch-time deduplication against currently live registry names as advisory hygiene only; it is not a reservation.
- Prefer a `chorus-` name prefix for generated suggestions to reduce collisions with external sessions.
- Implement the minimal main-process registry reader needed to match an owned pane by `sessionId`.
- Validate the required registry fields and process identity before displaying a live address.
- Render a live-address chip with `verified`, drift, duplicate, unavailable, and unconfirmed states.
- Clearly render non-Claude panes as `Not addressable`, based on declared capabilities.
- Render visible degradation rather than stale live addresses when registry reads fail.

**Deferred**
- Full Claude fleet roster with idle/busy/shell state and explicit partial-fleet framing: Phase 1.
- Transcript offset tailing, canonical-message indexing, and the pull-only directed-message timeline: Phase 2.
- Explicit operator-triggered PTY broadcast, scoped independently from peer messaging: Phase 3.
- Any consideration of a PTY-assisted send action, only after Phase 3 has established and tested an audited PTY-write path.
- Measurement of whether explicit `-n` names can be overwritten by AI titling; this is a non-blocking verification task.

**Deliberately absent**
- Opening `messagingSocketPath`.
- Reading `.key` files.
- Peer-protocol framing, socket writes, or session impersonation.
- Automatic name reassertion, rename injection, or reclaim attempts.
- A composer in Phases 0–3.
- Unread counts, notifications, pulsing indicators, activity tickers, or presence/status events in the timeline.
- Claims that non-Claude panes are addressable or that the observed registry is a complete fleet.

## Risks & mitigations for the winner
1. **A registry name collides, is reclaimed, or changes after launch** → Use `sessionId` as the only durable identity; resolve names live; show persistent drift or duplicate state rather than trusting `requestedName`.

2. **The registry is unreadable, changes format, or is observed mid-write** → Zod-validate every read; tolerate missing files, invalid JSON, and torn reads; render `unavailable` or `unconfirmed` rather than a stale live address.

3. **A registry file leaks after a hard kill** → Do not trust file existence. Verify liveness before accepting the entry as live.

4. **PID reuse makes a stale entry appear live** → Compare registry `procStart` to a verified OS process-start value where reliable support is available. The implementer must verify the applicable Windows mechanism rather than assume a particular API or timestamp format.

5. **Repeated `agent-name` records cause address-chip flicker** → Use last-observed state with debounced rendering, last-write-wins display, and a sticky drift state. Do not let a transient badge be the only rename evidence.

6. **Resume silently loses the intended name** → Pass `-n` on both launch paths and add integration coverage that verifies registry `name` after fresh launch and resume.

7. **Duplicate names create misleading click targets** → Focus panes only by `sessionId` for owned-pane operations. In external-fleet displays, disambiguate duplicate live names with cwd and stable session context.

8. **The roster appears comprehensive** → Label it as observed local Claude peer-protocol sessions and state both limitations: non-Claude panes are not addressable, and external Claude sessions may be present.

9. **The timeline double-counts messages** → Index only `type: "queue-operation"` records with `operation: "enqueue"`; exclude the duplicate following `type: "user"` record.

10. **Timeline sender focus depends on an unstable name** → Inspect real canonical message records for sender `sessionId`. If unavailable, focus only when a sender name uniquely resolves to a currently live owned pane; otherwise show sender name only and do not guess.

11. **A future PTY-send feature interleaves with active agent input** → Keep it out of Phases 0–3 except for separately scoped broadcast. If later permitted, funnel all writes through one audited text-only path, require explicit confirmation, re-check target state immediately before writing, and reject unsafe control or escape sequences.

12. **An idle-state check is TOCTOU-prone** → Treat state verification as a best-effort safety gate rather than a delivery guarantee; make the operator action explicit and surface refusal or uncertainty rather than retrying automatically.

13. **The remotely toggled uniqueness behavior changes** → Treat deduplication as advisory, never as reservation. Render only registry-derived current address state.

14. **The timeline drifts into an anxiety-producing activity feed** → Enforce a hard contract: on-demand only, cross-session messages only, no unread state, no notifications, no status/presence stream, no ambient dashboard placement.

15. **Socket/key prohibitions regress through a later implementation** → Add repository-level guards, code review checks, and tests covering forbidden paths; require PTY writes to enter through one audited function.

## Action items for implementation
1. Thread the persisted `requestedName` through both Claude fresh-launch and `--resume` launch builders as `-n <requestedName>`.

2. Add an integration test that verifies the registry `name` after a fresh Claude launch and after `claude -n <requestedName> --resume <id>`.

3. Implement a main-process registry reader with Zod validation for at least `pid`, `procStart`, `sessionId`, `name`, `nameSource`, `status`, and `peerProtocol`.

4. Implement tolerant registry reads that classify missing files, invalid JSON, and transient parse failures as visible `unavailable` or `unconfirmed` states.

5. Verify the platform-appropriate Windows process-start-time mechanism before coding the liveness check; document the verified mechanism and add a test for stale-file rejection.

6. Join owned Chorus Claude panes to registry entries exclusively by Claude `sessionId`; add a test or invariant that rejects registry-name joins for owned-pane identity.

7. Persist stable Chorus pane identity, Claude `sessionId`, and `requestedName`; do not persist registry `name` as an address field.

8. Render the address chip from the current validated registry name only; when it differs from `requestedName`, render a sticky requested-to-current transition with cause-specific state.

9. Ensure that failed liveness checks, missing matching entries, or unreadable registry data remove the live-address claim rather than retaining the last good name.

10. Add tests for collision fallback, duplicate/reclaimed-name behavior, resume name retention, unavailable registry state, process-identity mismatch, and live-name drift without pane identity changes.

11. Generate name suggestions with a `chorus-` prefix and label collision checks as best-effort advisory checks.

12. Add a repository guard and code-review check prohibiting access to `messagingSocketPath` and files ending in `.key`.

13. Define the Phase-2 timeline contract before implementation: canonical source is `queue-operation/enqueue`; the view is pull-only, directed, Claude-only, and visibly partial; duplicate `user` records are excluded.

14. Capture and inspect real canonical message records to determine whether sender `sessionId` is available before implementing sender click-to-focus.

15. If sender `sessionId` is absent, implement sender focus only for a unique, currently live owned-pane name match; otherwise render sender identity as non-clickable text.

16. Run the long-duration explicit-`-n` titling experiment as a non-blocking verification task; record the result, but do not make Phase-0 correctness depend on it.

## Preserved disagreement record and arbiter commentary

### [R1; Q1] DeepSeek v4 Pro 0813
> The drift UI is too transient. Showing the current name immediately with a badge only for that poll cycle can hide a meaningful rename/collision, especially under fact 8’s churn. The previous requested name should remain visible until the state stabilizes or the operator acknowledges it. I also disagree with making AI-title overwrite of an explicit `-n` merely informational; if it overrides operator intent, it deserves warning severity. Q2’s post-Phase 3 PTY-send evaluation is acceptable only if it remains a guarded terminal action, not a composer; an idle-only check is TOCTOU-prone.

**Arbiter commentary:** Well-founded. The ruling therefore requires a sticky transition state and requested-to-current display, not a one-poll badge. AI-title drift remains a drift state; severity may be informational only where the UI can establish the rename was expected, but an overwrite of expressed launch intent must not be silently minimized. The TOCTOU objection is also accepted: idle checking is a safety gate, not a guarantee.

### [R1; Q1] DeepSeek v4 Pro 0813
> Liveness needs procStart/start-time verification, not pid check alone. “Stores exactly two things” is too minimal; a stable local Chorus identity and PTY/process handle are operationally necessary. The sender-join ambiguity is noted well, but the duplicate/stale-name mitigation is underspecified.

**Arbiter commentary:** Well-founded. The selected rule persists stable Chorus identity in addition to Claude `sessionId` and requested name, and requires process-start comparison where reliable platform support is verified. Timeline sender focus must not guess from stale or ambiguous names.

### [R1; Q2] DeepSeek v4 Pro 0813
> The permanent composer ban is slightly too blunt. The rule should absolutely forbid protocol-client behavior and a separate chat UI, but operator-confirmed text insertion into a Chorus-owned PTY is still just terminal input and should not be foreclosed forever if the socket/key prohibition already holds. B also shares A’s weakness: the immediate flip with only a short drift mark may not make identity drift salient enough.

**Arbiter commentary:** Well-founded. This is the majority basis for socket-only rather than absolute prohibition. The future exception is not authorization to ship a composer; it is a tightly bounded possibility after Phase 3, subject to audited PTY input and explicit operator action. The salience concern is resolved by the sticky state requirement.

### [R1; Q1/Q3] DeepSeek v4 Pro 0813
> Does not flag whether queue-operation records contain sender sessionId or only sender name; that determines whether timeline click-to-focus accidentally depends on the volatile name Q1 demoted. It also omits procStart/start-time liveness verification and does not specify behavior on registry parse failure beyond a generic unconfirmed/dead state.

**Arbiter commentary:** Well-founded. The sender identifier is an implementation gate for focus behavior, and parse failure must render visible degradation. The action items require observation of real records before sender focus is implemented.

### [R1; Q2] DeepSeek v4 Pro 0813
> The claim that PTY insertion is “equivalent to typing” understates the risk: it can interleave with real keystrokes and may include escape/control bytes. It should be implemented as a single audited text-only write path with explicit target-idle confirmation, not justified by equivalence. The UI state model may also be over-fragmented; verified/renamed/collided/unavailable/stale is clearer than missing/unverified/unreadable as separate states.

**Arbiter commentary:** Well-founded. “Equivalent to typing” is not sufficient safety reasoning. Any later PTY feature must use one audited text-only path and reject unsafe content; the state model is consolidated into verified, renamed, collided/duplicate, unconfirmed, and unavailable.

### [R1; Q1/Q3] DeepSeek v4 Pro 0813
> Does not explicitly address the sender-join gap: if sender sessionId is absent from queue-operation records, click-to-focus must resolve by current live name, which is the unstable identifier. It also lacks concrete hysteresis/debounce under repeated rename churn, and does not state a hard ban on notifications or presence pings as strongly as A/B.

**Arbiter commentary:** Well-founded. The ruling adopts unique-live-name-only focus as the fallback, requires debounce and sticky transition state, and states the no-notifications/no-presence condition as a hard timeline contract.

### [R1; Q1/Q2/Q4] Grok 4.6
> “never silently update the chip” as if the requested name should remain the primary glyph. Peers address whatever the CLI currently publishes; hiding that is the dishonest chip. The `Zeta → wt-…` transition is the right *state*, not a reason to freeze the old label. Q2’s one-liner also omits an idle/status gate, so a later PTY send could type into a busy agent. Phase 0 as “small plumbing only” can still ship a cached promise if any chip is rendered from `-n`.

**Arbiter commentary:** Well-founded. The current name is the primary and only current address; requested name is historical context. The Phase-0 reshape includes the minimal live registry join precisely to prevent a cached promise. A later PTY action must include a best-effort state check, while acknowledging the DeepSeek TOCTOU qualification.

### [R1; Q1/Q2/Q3/Q4] Grok 4.6
> cause-specific drift (collision vs AI title); debounce/hysteresis under fact 8’s re-assertion churn; `queue-operation` vs duplicate `type:"user"`; timeline sender join may be name-only; CI grep for socket/`.key`; resume-path `-n` threading; `chorus-` hygiene prefix; Zod + “fleet unreadable” on parse failure.

**Arbiter commentary:** Well-founded. These are adopted as implementation requirements or advisory hygiene. The `chorus-` prefix is helpful collision reduction, but does not alter the identity-first rule or imply any reservation.

### [R1; Q1/Q2/Q4] Grok 4.6
> making the current name the chip with only a *transient, one-cycle* badge. Collision is not the same as a wanted AI title; a badge that evaporates treats both as flicker. Last-write-wins rendering without a sticky `addressState` will look like a silent rename to anyone who blinked. Folding “idle-only PTY composer” into the standing one-liner mixes a permanent ban with a Phase-3 policy. The `chorus-` prefix is optional hygiene, not part of the addressing rule. Half-day Phase 0 plus poll+badge+dedupe+prefix is not “modest” unless the poll is truly the Phase 1 slice reused.

**Arbiter commentary:** Well-founded. The synthesis requires sticky state, not a transient badge, and distinguishes permanent socket prohibition from deferred PTY policy. The prefix remains optional hygiene. The Phase-0 scope increase is accepted only because the registry slice is reused directly by Phase 1 and prevents knowingly false address display.

### [R1; Q1/Q3] Grok 4.6
> `procStart`/creation-time liveness (pid-exists is not enough, including on Windows); tolerate torn JSON writes; persistent dual-label / `addressState` rather than debounce-only; a stable Chorus-local pane id distinct from Claude `sessionId`; collapsed-by-default as a feed-resistance tactic.

**Arbiter commentary:** Well-founded except that collapsed-by-default is treated as a useful UX reinforcement rather than the defining distinction between timeline and feed. The other points are adopted directly.

### [R1; Q5/Q1] Grok 4.6
> Q5 as QUALIFY. The “stable local alias vs volatile CLI address” split *is* the Q1 design, not a missing alternative; calling it load-bearing there blurs the vote. Phase 0 “label it requested until a poll exists” still ships a chip that looks like an address. Extra persisted fields (`chorusSessionId`, launch path) are optional diagnostics, not identity. Collapsed-by-default is UX, not what makes the view distinct from an activity feed.

**Arbiter commentary:** Well-founded. The Q5 clarification is absorbed into Q1 rather than elevated to an alternative architecture. Phase 0 must not show a requested name as a live address before live registry validation. Stable Chorus identity is required; launch-path diagnostics are optional.

### [R1; Q1/Q2/Q3/Q4] Grok 4.6
> fact-8 hysteresis; idle-status PTY rule and CI enforcement; name-based timeline sender join; `notifyCorrespondentsOfRename` as a possible event source; remotely togglable uniqueness (fact 7) so “settled” never is; mtime-aware poll interval; launch-name `chorus-` prefix as collision hygiene.

**Arbiter commentary:** Well-founded. The design must tolerate the uniqueness behavior changing rather than assuming measurement permanently settles it. Rename notifications and mtime-aware polling are optimization opportunities to verify, not prerequisites for correctness.

### [R1; Q2/Q1/Q3] Qwen 3.8 Max
> Position A — I disagree that a PTY-delivery rule is sufficient unless it explicitly requires operator-initiated action, idle-target verification, a single audited write function, and no composer abstraction; its “keep local identity stable” language risks letting the old requested name remain visually addressable rather than making the current CLI name the only live address; and its fallback to per-pane unread indicators if the timeline drifts could reintroduce the anxiety-producing notification feed the brief rejects.

**Arbiter commentary:** Well-founded. The chosen PTY exception is explicitly operator-initiated, audited, text-only, and deferred; it does not authorize a composer abstraction. Current CLI name remains the only live address. Per-pane unread indicators are not adopted because they would violate the timeline’s no-ambient-notification boundary.

### [R1; Q1/Q2/Q3/Q4] Qwen 3.8 Max
> Position A — it missed deduplicating queue-operation records from duplicate user records, labeling the timeline as a partial view for non-Chorus and non-Claude sessions, CI enforcement for socket/key prohibition, debounce/hysteresis for rename churn, explicit fresh and resume `-n` verification, nameSource cause-specific display, and the timeline sender-join ambiguity where sender identity may only be a live name.

**Arbiter commentary:** Well-founded. All listed items are incorporated into risks, action items, or the timeline contract.

### [R1; Q1/Q2] Qwen 3.8 Max
> Position B — I disagree that “never cached” should be absolute if it precludes transient, explicitly stale render state needed for debounce and graceful parse failures; that a post-Phase-3 composer evaluation is safe enough without a permanent prohibition on autonomous send controls; that CI grep is sufficient by itself for socket/key prohibition; and that immediate current-name rendering is safe without an unconfirmed/degraded state for partial writes, pid ambiguity, or registry read failure.

**Arbiter commentary:** Well-founded. “Never cached” applies to authoritative addressing and identity semantics, not transient UI state needed for debouncing. CI checks are one guard among repository architecture, tests, and review. Autonomous send controls remain prohibited; any later PTY action is explicit and operator-confirmed. Unconfirmed and unavailable states are required.

### [R1; Q1/Q2] Qwen 3.8 Max
> Position B — it missed comparing registry `procStart`/`startedAt` to OS process creation time to defeat Windows PID reuse, specifying atomic/tolerant reads for partially written JSON, defining a measurement threshold for poll interval/mtime strategy, and making the composer gate a dated revocable decision with explicit rollback criteria rather than a future vibe.

**Arbiter commentary:** The process identity and tolerant-read points are well-founded and adopted. Poll cadence must be measured or selected conservatively after implementation verification; the council does not prescribe an unverified interval. The composer remains absent through Phase 3; any reconsideration requires a new explicit product decision rather than an implicit future commitment.

### [R1; Q2/Q1/Q3] Qwen 3.8 Max
> Position C — I disagree that the composer prohibition should be framed so broadly that it could forbid future explicit operator-initiated, idle-checked PTY actions; its one-line rule should say never open/read/write socket or key files and never ship an autonomous composer, while still permitting focus-and-type navigation; immediate chip flip needs debounce/hysteresis under fact 8 churn; and “woke a peer and consumed a turn” is too narrow if it hides directed messages that are queued but not yet consumed.

**Arbiter commentary:** Well-founded. The ruling distinguishes permanent socket prohibition from the deferred PTY possibility and preserves ordinary focus-and-type. The timeline must represent canonical directed enqueue records; it must not claim that every such message has already been consumed merely because it was queued.

### [R1; Q1/Q2/Q3/Q4] Qwen 3.8 Max
> Position C — it missed Windows PID reuse/`procStart` validation, partially written registry JSON handling, CI enforcement and a single audited PTY-write path if any operator typing assistance exists, timeline sender-join ambiguity, rename-notification records as possible event-driven drift source, poll interval strategy, and cause-specific nameSource tooltips distinguishing collision from AI title.

**Arbiter commentary:** Well-founded. PID reuse, torn reads, sender identity, and audited future PTY writes are required safeguards. Rename notifications, poll strategy, and tooltip cause classification should be verified against actual records and behavior; they improve fidelity but must not become assumptions on which correctness depends.

---

## How disagreement was detected

- **Q1** — detection: `structural` · members agreed
- **Q2** — detection: `structural` · members agreed
- **Q3** — detection: `structural` · members agreed
- **Q4** — detection: `structural` · members agreed
- **Q5** — detection: `structural` · members disagreed

_`structural` means the orchestrator compared the members' own verdict tokens and counted the difference. `model-judged` means too few members answered in the required form, so the arbiter judged it from prose — a weaker signal, labelled rather than hidden._

## Dissents preserved

_19 preserved: 1 structural (computed from the members' own verdict tokens) · 18 from critique prose, from 3 members — DeepSeek v4 Pro 0813 6 · Grok 4.6 6 · Qwen 3.8 Max 6._

_⚠ Read the per-member split before reading breadth into the total: several objections from one member is one member disagreeing repeatedly, not several members disagreeing. Nothing is dropped to make the total smaller._

- [Structural — Q5] Q5: load-bearing alternative shapes only, or "none". — AGREE: DeepSeek v4 Pro 0813, GLM 5.3 · QUALIFY: Grok 4.6, Qwen 3.8 Max
- [Critique — R1] DeepSeek v4 Pro 0813: The drift UI is too transient. Showing the current name immediately with a badge only for that poll cycle can hide a meaningful rename/collision, especially under fact 8’s churn. The previous requested name should remain visible until the state stabilizes or the operator acknowledges it. I also disagree with making AI-title overwrite of an explicit `-n` merely informational; if it overrides operator intent, it deserves warning severity. Q2’s post-Phase 3 PTY-send evaluation is acceptable only if it remains a guarded terminal action, not a composer; an idle-only check is TOCTOU-prone.
- [Critique — R1] DeepSeek v4 Pro 0813: Liveness needs procStart/start-time verification, not pid check alone. “Stores exactly two things” is too minimal; a stable local Chorus identity and PTY/process handle are operationally necessary. The sender-join ambiguity is noted well, but the duplicate/stale-name mitigation is underspecified.
- [Critique — R1] DeepSeek v4 Pro 0813: The permanent composer ban is slightly too blunt. The rule should absolutely forbid protocol-client behavior and a separate chat UI, but operator-confirmed text insertion into a Chorus-owned PTY is still just terminal input and should not be foreclosed forever if the socket/key prohibition already holds. B also shares A’s weakness: the immediate flip with only a short drift mark may not make identity drift salient enough.
- [Critique — R1] DeepSeek v4 Pro 0813: Does not flag whether queue-operation records contain sender sessionId or only sender name; that determines whether timeline click-to-focus accidentally depends on the volatile name Q1 demoted. It also omits procStart/start-time liveness verification and does not specify behavior on registry parse failure beyond a generic unconfirmed/dead state.
- [Critique — R1] DeepSeek v4 Pro 0813: The claim that PTY insertion is “equivalent to typing” understates the risk: it can interleave with real keystrokes and may include escape/control bytes. It should be implemented as a single audited text-only write path with explicit target-idle confirmation, not justified by equivalence. The UI state model may also be over-fragmented; verified/renamed/collided/unavailable/stale is clearer than missing/unverified/unreadable as separate states.
- [Critique — R1] DeepSeek v4 Pro 0813: Does not explicitly address the sender-join gap: if sender sessionId is absent from queue-operation records, click-to-focus must resolve by current live name, which is the unstable identifier. It also lacks concrete hysteresis/debounce under repeated rename churn, and does not state a hard ban on notifications or presence pings as strongly as A/B.
- [Critique — R1] Grok 4.6: “never silently update the chip” as if the requested name should remain the primary glyph. Peers address whatever the CLI currently publishes; hiding that is the dishonest chip. The `Zeta → wt-…` transition is the right *state*, not a reason to freeze the old label. Q2’s one-liner also omits an idle/status gate, so a later PTY send could type into a busy agent. Phase 0 as “small plumbing only” can still ship a cached promise if any chip is rendered from `-n`.
- [Critique — R1] Grok 4.6: cause-specific drift (collision vs AI title); debounce/hysteresis under fact 8’s re-assertion churn; `queue-operation` vs duplicate `type:"user"`; timeline sender join may be name-only; CI grep for socket/`.key`; resume-path `-n` threading; `chorus-` hygiene prefix; Zod + “fleet unreadable” on parse failure.
- [Critique — R1] Grok 4.6: making the current name the chip with only a *transient, one-cycle* badge. Collision is not the same as a wanted AI title; a badge that evaporates treats both as flicker. Last-write-wins rendering without a sticky `addressState` will look like a silent rename to anyone who blinked. Folding “idle-only PTY composer” into the standing one-liner mixes a permanent ban with a Phase-3 policy. The `chorus-` prefix is optional hygiene, not part of the addressing rule. Half-day Phase 0 plus poll+badge+dedupe+prefix is not “modest” unless the poll is truly the Phase 1 slice reused.
- [Critique — R1] Grok 4.6: `procStart`/creation-time liveness (pid-exists is not enough, including on Windows); tolerate torn JSON writes; persistent dual-label / `addressState` rather than debounce-only; a stable Chorus-local pane id distinct from Claude `sessionId`; collapsed-by-default as a feed-resistance tactic.
- [Critique — R1] Grok 4.6: Q5 as QUALIFY. The “stable local alias vs volatile CLI address” split *is* the Q1 design, not a missing alternative; calling it load-bearing there blurs the vote. Phase 0 “label it requested until a poll exists” still ships a chip that looks like an address. Extra persisted fields (`chorusSessionId`, launch path) are optional diagnostics, not identity. Collapsed-by-default is UX, not what makes the view distinct from an activity feed.
- [Critique — R1] Grok 4.6: fact-8 hysteresis; idle-status PTY rule and CI enforcement; name-based timeline sender join; `notifyCorrespondentsOfRename` as a possible event source; remotely togglable uniqueness (fact 7) so “settled” never is; mtime-aware poll interval; launch-name `chorus-` prefix as collision hygiene.
- [Critique — R1] Qwen 3.8 Max: Position A — I disagree that a PTY-delivery rule is sufficient unless it explicitly requires operator-initiated action, idle-target verification, a single audited write function, and no composer abstraction; its “keep local identity stable” language risks letting the old requested name remain visually addressable rather than making the current CLI name the only live address; and its fallback to per-pane unread indicators if the timeline drifts could reintroduce the anxiety-producing notification feed the brief rejects.
- [Critique — R1] Qwen 3.8 Max: Position A — it missed deduplicating queue-operation records from duplicate user records, labeling the timeline as a partial view for non-Chorus and non-Claude sessions, CI enforcement for socket/key prohibition, debounce/hysteresis for rename churn, explicit fresh and resume `-n` verification, nameSource cause-specific display, and the timeline sender-join ambiguity where sender identity may only be a live name.
- [Critique — R1] Qwen 3.8 Max: Position B — I disagree that “never cached” should be absolute if it precludes transient, explicitly stale render state needed for debounce and graceful parse failures; that a post-Phase-3 composer evaluation is safe enough without a permanent prohibition on autonomous send controls; that CI grep is sufficient by itself for socket/key prohibition; and that immediate current-name rendering is safe without an unconfirmed/degraded state for partial writes, pid ambiguity, or registry read failure.
- [Critique — R1] Qwen 3.8 Max: Position B — it missed comparing registry `procStart`/`startedAt` to OS process creation time to defeat Windows PID reuse, specifying atomic/tolerant reads for partially written JSON, defining a measurement threshold for poll interval/mtime strategy, and making the composer gate a dated revocable decision with explicit rollback criteria rather than a future vibe.
- [Critique — R1] Qwen 3.8 Max: Position C — I disagree that the composer prohibition should be framed so broadly that it could forbid future explicit operator-initiated, idle-checked PTY actions; its one-line rule should say never open/read/write socket or key files and never ship an autonomous composer, while still permitting focus-and-type navigation; immediate chip flip needs debounce/hysteresis under fact 8 churn; and “woke a peer and consumed a turn” is too narrow if it hides directed messages that are queued but not yet consumed.
- [Critique — R1] Qwen 3.8 Max: Position C — it missed Windows PID reuse/`procStart` validation, partially written registry JSON handling, CI enforcement and a single audited PTY-write path if any operator typing assistance exists, timeline sender-join ambiguity, rename-notification records as possible event-driven drift source, poll interval strategy, and cause-specific nameSource tooltips distinguishing collision from AI title.

## Provenance

- **Run id:** `e2a6cf97-325b-48ff-8a43-3020237a08c4`
- **Started:** 2026-08-27T10:21:34.836Z

| Member | Role | Model | Turns |
|---|---|---|---|
| DeepSeek v4 Pro 0813 | member | `deepseek/deepseek-v4-pro-0813` | answered 2 turns |
| GLM 5.3 | member | `z-ai/glm-5.3` | answered 1, refused 1 |
| Grok 4.6 | member | `x-ai/grok-4.6` | answered 2 turns |
| Qwen 3.8 Max | member | `qwen/qwen3.8-max` | answered 2 turns |
| GPT 5.6 Terra | arbiter | `openai/gpt-5.6-terra` | answered 2 turns |


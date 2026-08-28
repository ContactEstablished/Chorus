# Council Brief FC-1.0 — Addressing and Visibility for a Multi-Agent Fleet

_Issued 2026-08-26 · Source spec: `docs/Features/Fleet Comms/chorus-fleet-comms-spec.md` · Decision owner: Matthew Wilson · Recorder: Claude_

**Your task is to ANSWER THE QUESTIONS IN §8. Do not review, critique, or copy-edit this document.** It is background material assembled for you, not a work product under review. Deliberate on the decision in §5 and return findings in the **Required Output Format** in §10.

You have no other context on this project — everything you need is in this document. Where you are uncertain about an external fact (a CLI's actual flags, an OS behaviour), **say so explicitly rather than guessing**; the implementer re-verifies every such fact against the tool itself before coding.

---

## 1. What Chorus is

Chorus is a local-first, bring-your-own-key Windows desktop app (Electron + Vue 3 + TypeScript + Pinia) for running multiple AI coding agents in parallel terminal panes. Each pane hosts an xterm.js terminal attached over typed IPC to a PTY (node-pty/ConPTY) owned by the Electron **main** process. It runs real interactive CLI agents — Claude Code, Codex CLI, opencode and others — often several at once, frequently across separate git worktrees of the same repository.

Locked rules, not up for review: sessions live in main and are owned by `SessionManager`; the renderer never spawns processes; all IPC is Zod-validated in main; SQLite with hand-rolled migrations; the UI renders from **declared capabilities, never from provider names**.

## 2. Why this decision exists now

Claude Code sessions on one machine already discover and message each other. Two agent-facing tools — `ListAgents` and `SendMessage` — let any session enumerate its live peers and send them text that **wakes an idle peer and enters its turn**. Every Chorus pane running Claude Code has been a member of that fleet since the feature shipped.

Chorus does not participate. It does not name its agents in a way the fleet can address, it does not know which of its panes are peers, and it cannot show the operator a single word of what the agents say to each other. The traffic is real, it flows through Chorus's own PTYs, and Chorus is blind to it.

The proposed feature closes that in three pieces: **the address** (pass Chorus's session name to `claude -n`), **peer awareness** (read the on-disk session registry), and **the timeline** (reconstruct the directed conversation from transcripts Chorus already receives). It is proposed as **read-only on the wire** — Chorus never speaks the messaging protocol.

This council exists because measurement turned one of those three pieces from "half a day of plumbing" into a genuine design question, and because two of the proposed non-goals are judgment calls rather than empirical facts.

## 3. Ground facts (measured 2026-08-26 against Claude Code 2.1.246 on Windows)

These were measured, not read from documentation. Treat them as fixed.

1. **The registry is plain JSON on disk.** One file per live session at `~/.claude/sessions/<pid>.json`, carrying `pid`, `sessionId` (which is also the transcript filename), `cwd`, `startedAt`, `procStart`, `version`, `peerProtocol`, `peerFeatures`, `messagingSocketPath`, `name`, `nameSource`, `nameSince`, and a `status` of `idle | busy | shell`. A sibling `<pid>.<sha256>.key` holds a per-session auth token.

2. **A message wakes an idle peer.** A message sent to an idle session flipped its registry `status` from `idle` to `busy`, it processed the message and replied inline. Messaging is a wake signal, not an inbox that drains when a human next types.

3. **Both halves land on disk, already structured.** The receiver's transcript gets a dedicated one-line record — `{"type":"queue-operation","operation":"enqueue","timestamp":…,"sessionId":<receiver>,"content":"<cross-session-message from-name=\"…\">…"}`. The entire directed conversation graph is reconstructable from receiver transcripts alone. A duplicate `type: "user"` record follows carrying the same content; counting both double-counts every message.

4. **Chorus already holds the join key.** Main receives each Claude session's transcript path per Chorus session, and the transcript filename is the registry's `sessionId`. No new capture is needed.

5. **Fleet membership is Claude-only and wider than Chorus.** Codex, opencode and the rest appear in no registry and cannot be addressed. Conversely the registry contains sessions Chorus did not launch — bare terminals in unrelated repos, and a desktop-app entrypoint. Any fleet view is a partial view in both directions.

6. **A name is a launch argument, not session state.** `claude -n Zeta` yields registry `name: "Zeta"`. `claude -n Zeta --resume <id>` also yields `Zeta` — the flag survives resume. But `claude --resume <id>` *without* the flag falls back to a derived name (`wt-e27d8654-fc`, `nameSource: "derived"`). Chorus's current restore path carries no name, so every pane would revert to a cwd slug on app restart unless the flag is threaded through both launch paths.

7. **Names collide, on a delay.** `-n Zeta` while another live session holds `Zeta` registers as a suffixed fallback (`wt-e27d8654-6a`, `nameSource: "derived"`). But once the original holder exits, the deferred session **takes the name it was denied** — two live sessions were observed simultaneously named `Zeta`. The CLI's naming subsystem confirms the shape: collision resolution yields to whichever session started earlier and hands the loser `<base>-<2 chars>`; the whole behaviour sits behind a remotely-togglable flag, and a `notifyCorrespondentsOfRename` routine exists because live renames are expected.

8. **An AI-generated title can become the peer address.** A session that had run 221 transcript records as the derived name `chorus-a1` emitted two consecutive records — `{"type":"ai-title","aiTitle":"redesign-dictation-overlay"}` then `{"type":"agent-name","agentName":"redesign-dictation-overlay"}` — and its registry `name` changed with no relaunch, then re-asserted 29 more times. `agent-name` is the record carrying the peer address. Launching with `-n` writes both an `agent-name` and a `custom-title` record; launching without writes neither. **Whether an AI title can overwrite a name set by `-n` is NOT established** — the observed case had no explicit name, a single-turn conversation does not generate a title, and the CLI's display resolver reads `agentName || customTitle || aiTitle || …`, which suggests but does not prove immunity.

9. **Registry files leak on a hard kill.** A force-killed session leaves its `<pid>.json` and `.key` behind; a session that exits normally removes them. Liveness must be a pid check.

**The consequence that drives this council: the peer address is not stable.** It can be taken by an earlier claimant, reclaimed by a later one, or rewritten by a generated title — at any time, with no event Chorus is guaranteed to see.

## 4. What the spec currently proposes

- **Phase 0 — the address.** Thread a Chorus-owned `sessionName` through the launch spec to `claude -n`, on both the fresh-launch and `--resume` paths. Dedupe suggestions against live registry names. Show a pane's peer address as a chip in its header. Roughly half a day.
- **Phase 1 — peer awareness (read-only).** Poll the registry, filter by pid liveness, gate on `peerProtocol`, join to Chorus panes by `sessionId`, render a fleet roster with idle/busy state.
- **Phase 2 — the timeline.** Tail transcripts by offset, index cross-session message records, render one chronological directed view with click-to-focus on the sending pane.
- **Phase 3 — broadcast (optional).** Write one text into every idle Claude pane via the PTY Chorus already owns. Not a protocol client.
- **Non-goal, stated firmly: no message composer in Chorus and no writing to the messaging socket.** The reasoning offered is that the agent composes better, addresses correctly, and already has the tool; Chorus's job is to make the target nameable and the traffic visible. Chorus would never open `messagingSocketPath` or read the `.key` files.
- **Related prior art in the same product:** a separate "Mission Control" feature holds a standing non-goal of **no activity feeds**, on the grounds that they generate anxiety and get ignored. The proposed timeline sits close to that line.

## 5. The decision

**Given a peer address that the CLI may change without warning, what should Chorus build — and how much of the fleet's behaviour should it try to own?**

### Q1 — The addressing model

- **Option A — name-first.** Thread `-n`, treat the registry `name` as the address, and dedupe at launch against live registry names. Simple, matches how the operator thinks and how a peer agent actually types a recipient. Weakness: ground facts 7 and 8 say the name can change afterwards; a launch-time check cannot prevent a collision that happens minutes later, and the UI would confidently display an address that has since moved.
- **Option B — identity-first.** Treat `sessionId` as the only durable identity. `name` becomes a display value resolved at render time and never cached, never stored, never used as a key. Chorus shows the current address but makes no promise it will persist. Weakness: the operator cannot rely on "send this to Mae" being true five minutes from now, and Chorus offers no help closing that gap.
- **Option C — identity-first with reconciliation.** As B, plus Chorus actively detects drift: the registry poll compares each pane's observed `name` against the name Chorus asked for, and surfaces a first-class state — *renamed*, *collided*, *address unstable* — in the roster and the pane chip. Optionally re-asserts the intended name. Weakness: more machinery, a reconciliation loop that can itself be wrong, and it may be fighting a CLI that has its own opinion.

State which option you would build, and — critically — **what the UI should show at the moment a pane's address changes under the operator**.

### Q2 — The composer non-goal

The spec forbids a message composer in Chorus, permanently and by design, and forbids ever writing to the messaging socket. Note that these are two separable prohibitions: Chorus **could** offer a composer that delivers by typing into a PTY it already owns, without ever speaking the protocol.

Is the no-composer rule correct? Consider that the operator can already type into any pane by hand; that an agent asked to relay a message will phrase and address it better than a human filling a form; that a composer invites Chorus to become a chat client, which is explicitly not the product; and against all that, the plain fact that an operator watching a timeline will immediately want to reply from it. Rule on whether the prohibition should be **absolute**, **absolute for the socket but relaxed for the PTY path**, or **abandoned**.

### Q3 — Does the timeline belong here at all?

The proposed timeline reconstructs agent-to-agent conversation into one chronological view. A sibling feature in the same product holds a standing non-goal of "no activity feeds" for anxiety and ignore-rate reasons.

Is the timeline meaningfully different from an activity feed, or is it the same thing wearing a different name? If it is different, name the difference in one sentence that would survive a skeptical reader. If it is the same, say what — if anything — should replace it, given that ground fact 3 makes the data trivially available and ground fact 2 means agents really are talking to each other unattended.

### Q4 — Sequencing under uncertainty

Ground fact 8 leaves one question open: whether an AI-generated title can overwrite an explicit `-n` name. Settling it requires driving a session through a long enough conversation to trigger titling — hours, not minutes.

Should Phase 0 ship **before** that is settled, **after**, or should it be **reshaped so the answer does not matter**? If reshaped, say how. Assume the implementer would rather ship something small and correct than wait.

### Q5 — Option-fixation check

Is there a materially different shape none of the above considers — for example, Chorus assigning addresses in a namespace it controls rather than the CLI's, ignoring the registry entirely and deriving everything from transcripts, or declining the whole feature and simply making panes easier to identify by hand? Load-bearing alternatives only; "none" is an acceptable answer.

## 6. Constraints the winner must survive

1. **Read-only on the wire is a hard constraint for the socket.** Chorus must never open `messagingSocketPath`, never read the `.key` files, never impersonate a session. Q2 may relax the *composer*, never this.
2. **Claude-only, and it must not look like parity.** No adapter change can make Codex or opencode addressable. Whatever the UI shows must make a non-participating pane read as *not addressable*, not as broken or missing.
3. **The fleet is larger than Chorus in both directions.** Any roster is a partial view and must say so rather than implying completeness.
4. **The renderer never spawns and never resolves executables.** Registry reads and transcript tailing happen in main; the renderer receives plain, validated objects.
5. **No new dependencies**, and no new persistent store beyond what an index would need.
6. **Bounded implementation.** Phase 0 is meant to be roughly half a day. A shape that turns it into a week is a worse answer than a plain one that lands, unless you argue the extra work is load-bearing.
7. **Degradation must be visible.** If the registry is unreadable, the CLI changes its format, or the remote uniqueness flag flips, the feature must fail in a way the operator can see rather than silently showing stale addresses.

## 7. Evaluation rubric (weigh in this order)

1. **Survives a moving address** — the design remains correct when a name collides, is reclaimed, or is rewritten mid-session (30%).
2. **Honest about what it knows** — never displays an address or a status it cannot currently vouch for; partial views announce themselves (25%).
3. **Earns its place in the product** — solves a problem the terminal genuinely cannot, rather than duplicating what a pane already shows (20%).
4. **Adoptable incrementally** — Phase 0 is shippable alone and each later phase is optional (15%).
5. **Simplicity** — a contributor can understand the join and the failure modes by reading one file (10%).

## 8. Questions for the council

Answer each of the five questions below. Do not add questions; do not review the document.

1. Q1: A, B, C, or a named hybrid — plus what the UI shows at the moment an address changes.
2. Q2: absolute prohibition, socket-only prohibition, or abandon — with the rule stated as one line an implementer could enforce.
3. Q3: is the timeline distinct from an activity feed, and if not, what replaces it.
4. Q4: ship Phase 0 before, after, or reshaped — and the reshaping if you choose it.
5. Q5: load-bearing alternative shapes only, or "none".

## 9. Success criteria for this council session

The council **succeeds** if it returns: (a) one committed answer per question Q1–Q5, or an explicit tie with the tie-breaker named; (b) for Q1, the addressing rule stated concretely enough to implement, including what is cached and what is resolved live; (c) an enumerated risk list with mitigations; (d) dissents preserved verbatim — do not average away disagreement. The council **fails** if it returns a survey without commitment, if it answers by proposing new features outside the four phases, or if it reaches unanimity by ignoring the rubric.

## 10. Required output format

```
## Per-model positions
<model>: Q1 <choice> / Q2 <absolute|socket-only|abandon> / Q3 <distinct|same + replacement> / Q4 <before|after|reshaped> / Q5 <one line> — <2-4 sentence rationale> — Strongest counterargument: <1-2 sentences>

## Council synthesis
Q1: <A|B|C|hybrid(named)> + what the UI shows on an address change, 2-4 sentences (<unanimous | majority N-of-M>)
Q2: <ruling + the one-line enforceable rule> (<vote>)
Q3: <ruling + the distinguishing sentence, or the replacement> (<vote>)
Q4: <ruling + reshaping if any> (<vote>)
Q5: <load-bearing alternatives, or "none"> (<vote>)
Dissents: <model: position and unresolved reason, or "none">

## The addressing rule (concrete enough to implement)
<what Chorus stores, what it resolves live, what it re-asserts, and what it shows when they disagree>

## What Phase 0 ships vs defers
<short list: shipped now / deferred to a later phase / deliberately absent>

## Risks & mitigations for the winner
1. <risk> → <mitigation>
...

## Action items for implementation
<numbered, imperative, each verifiable>
```

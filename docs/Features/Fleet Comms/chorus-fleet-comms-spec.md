# Chorus feature spec — Fleet Comms

**Status:** proposed, roadmap candidate — **council FC-1.0 reviewed and fully resolved 2026-08-27;
all five rulings adopted (§14)**
**Priority:** medium — §10 Phase 0 is ~half a day and unblocks everything else; Phases 1–2 are
read-only and can land beside phase work
**Owner:** Matt
**Depends on:** existing pane lifecycle, `agentEvents.onTranscriptPath`, the claude adapter
**Measured against:** claude 2.1.246 on `win32:ironman`, 2026-08-26 / 2026-08-27

---

## 1. Summary

Claude Code sessions on one machine already discover and message each other. Two tools —
`ListAgents` and `SendMessage` — let any session enumerate its live peers and send them text
that **wakes them and enters their turn**. Every Chorus pane running claude is already a
member of that fleet, and has been since the feature shipped.

Chorus does not participate in it. It does not name its agents in a way the fleet can address,
it does not know which of its panes are peers, and it cannot show the operator a single word of
what the agents say to each other. The traffic is real, it runs through Chorus's own PTYs, and
Chorus is blind to it.

Fleet Comms closes that in three pieces, in strict order of leverage:

1. **The address** — pass Chorus's own session name to `claude -n`, so the name in the rail and
   the name a peer must type start out as the same string. They can diverge afterwards, and §6.1
   is the rule for what Chorus does when they do.
2. **Peer awareness** — read the session registry Claude Code already maintains on disk, and
   show which panes are fleet members and whether they are idle or busy.
3. **The timeline** — reconstruct the directed conversation between panes from transcripts
   Chorus already receives, and render it as one chronological view.

It is deliberately **read-only on the wire**. Chorus never speaks the messaging protocol; it
reads a JSON registry and a set of transcripts, both of which it can already reach.

---

## 2. Why this belongs in Chorus rather than in the terminal

Sending is fine in the terminal. Tracking is impossible there.

A pane shows one agent's half of a conversation, interleaved with its own tool calls, scrolling
away as it works. To follow an exchange between three panes the operator must read three
scrollbacks and join them by memory. There is no view — anywhere, in any tool — that shows
"Bob asked Mae to check the tests at 19:47, Mae answered at 19:51". That information exists
only as a join across files, and Chorus is the only process holding all the keys:

- Chorus knows which pane is which project, worktree, and task — the fleet knows only a cwd slug.
- Chorus already receives each claude session's transcript path (`src/main/index.ts:651`), which
  is where both halves of every message land.
- Chorus owns the window, so it can focus the pane a message came from. A terminal cannot.
- Chorus is the process that would act on any of it anyway.

The inverse is also true and is why §3 has an unusually firm non-goal: **Chorus is the wrong place
to speak the messaging protocol**, and the wrong place to compose a directed reply while a pane and
a keyboard do it better. The agent composes better, addresses correctly, and already has the tool.
Chorus's job is to make the target nameable and the traffic visible. §7.4 states exactly where that
line falls and what would have to be true for anything to cross it.

---

## 3. Scope

### In scope

- Passing a Chorus-owned display name to the claude CLI at launch, on every launch path
- Reading the Claude Code session registry and joining it to Chorus panes
- Surfacing a pane's peer name and fleet-side status in the UI
- Tailing claude transcripts for cross-session message events and indexing them
- A chronological, directed message timeline with click-to-focus
- Degrading visibly and safely when any of the above is unavailable

### Explicitly out of scope

State these as non-goals so the feature does not drift into being a chat product.

- **No protocol implementation, ever.** Chorus never opens `messagingSocketPath`, never reads the
  `.key` files, never sends peer-protocol bytes, never impersonates a session. This is the single
  most important non-goal in this document and it is permanent. See §7.4.
- **No composer in Phases 0–3.** Directed replies go through focus-the-pane-and-type. A later
  operator-send control is not foreclosed, but it is bounded by the rule in §7.4 and may never
  become a protocol client.
- **No editing, deleting, retracting, or moderating messages.** The transcript is a record, not
  a mailbox.
- No message search, threading, or reactions. **And no unread counts at all** — an earlier draft
  allowed "a simple new-since-you-last-looked mark"; council FC-1.0 Q3 prohibited unread state
  outright as the exact mechanism that turns a consulted view into an activity feed (§7.3, §13).
- No cross-machine or cloud fleet view in v1, even though the registry admits such peers.
- No attempt to make non-claude agents (codex, opencode, kimi, grok) addressable. They are not
  fleet members and no Chorus code can make them one.

---

## 4. Ground facts

Everything below was measured on 2026-08-26 against claude 2.1.246, not read from
documentation. The design rests on these; if one changes, the section that depends on it
changes with it.

### 4.1 The registry is plain JSON on disk

One file per live session at `~/.claude/sessions/<pid>.json`:

```jsonc
{
  "pid": 112060,
  "sessionId": "25f6b24c-109d-4356-8232-8c30aeb9a567",  // == the transcript filename
  "cwd": "C:\\Projects\\ContactEstablished\\Chorus",
  "startedAt": 1787765601168,
  "procStart": "134322392003434636",                     // for liveness disambiguation
  "version": "2.1.246",
  "peerProtocol": 1,                                     // version-gate on this
  "peerFeatures": ["notify_idle", "artifact_yield"],
  "kind": "interactive",
  "entrypoint": "cli",                                   // also seen: "claude-desktop"
  "pidDomain": "win32:ironman",
  "messagingSocketPath": "\\\\.\\pipe\\LOCAL\\cc-msg-75ad72d014e79b32e1a712f615f53ef5",
  "name": "chorus-2a",
  "nameSource": "derived",                               // the lever — see §6
  "nameSince": 1787765601168,
  "status": "idle",                                      // idle | busy | shell
  "updatedAt": 1787766123664,
  "statusUpdatedAt": 1787766123664
}
```

A sibling `<pid>.<sha256>.key` holds a per-session auth token. **Chorus must never read it.**
Its only purpose is authenticating to the socket, and Chorus does not use the socket.

### 4.2 A message wakes an idle peer

The load-bearing measurement. A `SendMessage` was sent from this worktree's session to the
idle peer `chorus-2a`. Its registry `status` flipped `idle` → `busy` at `1787773673428`, it
processed the message, replied, and the reply arrived inline in the sender's turn:

```
<cross-session-message from="uds:\\.\pipe\LOCAL\cc-msg-75ad..." from-name="chorus-2a" from-mode="prompting">
OK
</cross-session-message>
```

Messaging is a **wake signal, not an inbox**. A fleet of idle panes is reachable without the
operator touching any of them. If it were otherwise — if messages sat queued until a human
typed — none of this feature would be worth building.

### 4.3 Both halves land on disk, already structured

In the **receiver's** transcript, a dedicated record type, one line, everything needed:

```jsonc
{
  "type": "queue-operation",
  "operation": "enqueue",
  "timestamp": "2026-08-26T19:47:53.406Z",
  "sessionId": "25f6b24c-...",        // the receiver
  "content": "<cross-session-message from=\"uds:...\" from-name=\"wt-e27d8654-dc\" from-mode=\"prompting\">\n…body…\n</cross-session-message>"
}
```

Timestamp, sender, receiver id, and body in a single record. **The entire directed conversation
graph is reconstructable from receiver transcripts alone** — sender transcripts are not required.
A second `type: "user"` entry follows carrying the same content wrapped in the safety preamble; it
is a duplicate for our purposes and must be skipped or every message double-counts.

⚠ **`queue-operation` / `enqueue` is NOT the message filter.** That pair is the transcript's
generic "something was pushed into this session's turn" record. In the measured transcript, **one
of four** such records was a cross-session message; the other three were background
task-notifications with the identical `type` and `operation`. Indexing on the pair alone fills the
timeline with an agent's own task noise.

**The canonical filter is the content: a `<cross-session-message …>` element.** Match on that, and
treat `type`/`operation` as a cheap pre-filter only.

#### The sender join — use the socket path, never the name

The record identifies its sender two ways:

```
from="uds:\\.\pipe\LOCAL\cc-msg-323e7193580c61e66defe8be3a96768b"
from-name="wt-e27d8654-dc"
```

`from-name` is the **volatile** address (§4.6–4.8) and must not be a join key. `from` is the
sender's `messagingSocketPath` — a registry field (§4.1), confirmed distinct across all live
sessions. So the durable join is:

```
from (socket path) → registry entry → sessionId → Chorus pane
```

Reading this string is not opening the socket; the §3 prohibition is untouched.

**One constraint that shapes the index:** the socket hash is *not* derived from the `sessionId` —
md5 and sha256 variants of the session id, with and without dashes and case-folded, all fail to
reproduce it. Chorus therefore cannot compute the mapping offline. It must **record
`messagingSocketPath` → `sessionId` during the registry poll it already runs** and persist that
mapping in the index. A sender observed live even once resolves for all its historical messages; a
sender that lived and died without ever being polled falls back to `from-name` as non-clickable
text. That makes the unresolvable case rare rather than normal.

In the **sender's** transcript, an ordinary assistant tool_use:

```jsonc
{ "name": "SendMessage",
  "input": { "to": "chorus-2a", "summary": "…", "message": "…",
             "type": "message", "recipient": "chorus-2a", "content": "…" } }
```

Useful for showing a message as *sent* before the receiver has drained it, and for attributing
a send to a pane whose peer had no transcript we could reach. Not required for the timeline.

### 4.4 The join key already exists

`src/main/index.ts:651` already wires `agentEvents.onTranscriptPath((sessionId, transcriptPath))`
— main receives each claude session's transcript path, keyed by **Chorus's** session id, and
`contextUsage` already consumes it. The transcript **filename is the claude sessionId**, which is
the registry's `sessionId` field.

So: `chorus session id → transcriptPath → claude sessionId → registry entry → peer name + status`,
with no new capture anywhere.

⚠ **Do not reach for the pid.** `src/main` tracks no PTY pid at all (grep confirms), and the
`.exe`/`.cmd` shim in `cliDetect` means the pty's pid is not reliably claude's. The transcript
path is the honest key and Chorus already has it.

### 4.5 Fleet membership is claude-only, and wider than Chorus

Of the agents Chorus launches, only claude participates. Codex, opencode, kimi and grok appear
in no registry and cannot be addressed.

Conversely the fleet is *larger* than Chorus: a session with `entrypoint: "claude-desktop"` and a
`bridgeSessionId` was observed alongside the CLI ones, as were sessions started from a bare
terminal in unrelated repos. **Any fleet view is a partial view in both directions**, and must say
so rather than implying the list is complete.

### 4.6 A name is a launch argument, not session state

Measured 2026-08-26 against claude 2.1.246 (`probe4.js`; each case a distinct process, teardown
confirmed by `tasklist` between cases, so no case reads a previous case's registry entry):

| Case | Command | Registry `name` | `nameSource` |
|---|---|---|---|
| A | `claude -n Zeta` | `Zeta` | *(absent)* |
| B | `claude -n Zeta --resume <id>` | `Zeta` | *(absent)* |
| C | `claude --resume <id>` | `wt-e27d8654-fc` | `derived` |

All three reported the **same** `sessionId` — a resume keeps its identity and re-registers under a
new pid.

Two consequences:

1. **`-n` survives `--resume`** (case B). Phase 0 is viable; nothing here blocks it.
2. **The name is not restored from session state** (case C). It must be re-asserted on every
   launch. This is despite the transcript's first record being
   `{"type":"custom-title","customTitle":"Zeta","sessionId":…}` — the custom title is written to
   the transcript but does **not** feed the peer address on resume. Do not treat the presence of
   that record as evidence the name will come back.

An earlier run of this measurement was invalid and is worth recording so it is not repeated: the
teardown between cases silently failed, all three cases reported one pid, and B and C were
reading case A's still-live entry. A resume-path measurement is only trustworthy if the pid
differs per case. A second run failed differently — case A was killed before it took a turn, so
it wrote no transcript and there was nothing to resume. **A session becomes resumable only once
it has conversed.**

### 4.7 Registry files leak on a hard kill

A session that exits with its PTY closed removes its own `<pid>.json` and `<pid>.*.key`
(observed: `staleFilesRemoved=0` across all three cases above). A session force-killed with
`taskkill /F` leaves both files behind — two such pids were confirmed dead by `tasklist` while
their files sat on disk. **Liveness must be a pid check. File presence proves nothing**, and a
crashed pane is exactly the case a fleet roster most needs to get right.

### 4.8 An address can change under a running session

Pid 92332 (`C:\Projects\ContactEstablished\Chorus`) was `name: "chorus-a1"` at 16:57 and
`name: "redesign-dictation-overlay"` at 18:12 — **same pid, no relaunch** — and its `nameSource`
had gone from `"derived"` to absent, which is the same signature an explicit `-n` produces.
Two other live sessions carry similar work-shaped names (`launch-presets-multi-agent`,
`add-tags-to-talking-points-qnas`) rather than cwd slugs.

**The mechanism is a conversation-derived title being promoted to the peer address.** In that
session's transcript, records 222 and 223 of 778 — it had run 221 records as the derived
`chorus-a1` — are consecutive:

```jsonc
{"type":"ai-title",   "aiTitle":   "redesign-dictation-overlay", "sessionId": "4da7049f-…"}
{"type":"agent-name", "agentName": "redesign-dictation-overlay", "sessionId": "4da7049f-…"}
```

The `agent-name` record then repeats 29 times through record 775 — the name is re-asserted, not
set once. `agent-name` is the record that carries the peer address: `-n Zeta` writes both
`{"type":"custom-title","customTitle":"Zeta"}` **and** `{"type":"agent-name","agentName":"Zeta"}`,
while a session launched with no `-n` writes neither.

So the address a peer must type can be rewritten by an AI-generated title derived from whatever
the pane happens to be working on.

The CLI's own naming subsystem confirms the shape. `nameSource` has four values — `derived`,
`collision`, `auto`, `user` — and around them sit `claimUniqueSessionName`, `decideNameCollision`,
`liveHoldersOf`, `suffixedName`, `reclaimSessionNameOnResume` and `notifyCorrespondentsOfRename`.
`decideNameCollision` yields to holders that started earlier (`claimantPrecedes` orders by
`startedAt`, then `procStart`, then pid) and hands the loser `<base>-<2 chars>` — which is exactly
where `chorus-2a`, `trupanionde-ca` and `wt-e27d8654-a9` come from. The whole behaviour sits
behind a remote gate, `isSessionNameUniquenessEnabled()` → `tengu_session_name_uniqueness`,
default on.

⚠ **`nameSource` usually will not tell you *why* an address drifted.** The `collision` value exists
in the CLI's code, but the session that actually lost a collision in the measurement — it asked for
`Zeta`, was live alongside the holder, and registered as `wt-e27d8654-6a` — wrote
`nameSource: "derived"`, indistinguishable from a session that simply never asked for a name.

So any UI promising a cause is promising something the data often cannot supply. Chorus can
*infer* a collision by noticing another live entry currently holds the requested name, but that is
an inference, and it evaporates the moment the other session exits. **Design the drift state to
read correctly with no cause at all**, and treat a cause as an enrichment that is frequently
absent.

**Not established: whether an `ai-title` can overwrite a name set by `-n`.** The measured case had
no explicit name. Argument that it cannot: the display-resolution chain in the CLI reads
`agentName || customTitle || aiTitle || summary || …`, putting an explicit name ahead of a
generated title. Argument for caution: that chain is a *display* resolver, not the registry
writer, and `notifyCorrespondentsOfRename` exists precisely because live renames are expected. A
one-turn conversation does not generate an `ai-title` (measured: neither a `-n` session nor an
unnamed control renamed within four minutes of a single exchange), so settling this needs a
session driven long enough to trigger titling — not a ten-minute probe. **Treat it as unresolved
and design so that being wrong is survivable** (see below).

This cuts both ways and both matter:

- **Against us:** an address is not stable for the lifetime of a pane. Anything that caches a
  name — a timeline row, a roster entry, a "send to Mae" affordance — must key on `sessionId`
  and treat `name` as a display value resolved at render time. §5's domain model already keys on
  `sessionId`; this is the reason to hold that line.
- **For us:** if a live session can be renamed without a relaunch, Phase 0 may not need the
  restart-to-rename dance at all, and a pane could be re-addressed the moment the operator edits
  its name. Worth establishing before building the launch-flag path as the only route.

---

## 5. Domain model

| Concept | Definition |
| --- | --- |
| **Pane identity** | Chorus's own stable session id. Never changes, never leaves Chorus, anchors everything the operator sees. |
| **Claude `sessionId`** | The CLI's durable identity for the same session. The **sole** join key to the registry and to transcripts. Survives resume (§4.6). |
| **Peer** | A live Claude Code session with a registry entry. May or may not be a Chorus pane. |
| **Fleet member** | A Chorus pane that is also a peer — a claude pane we can join to a registry entry. |
| **Requested name** | The exact string Chorus passed to `claude -n`. **Launch intent only.** Persisted, re-sent on every launch path, never treated as the address. |
| **Address** | The registry's *current* `name`. The only string a sending agent can use. **Live state, resolved per read — never persisted, never a key, never cached as truth.** |
| **Address state** | Whether the current address matches what Chorus asked for. See §6. |
| **Message** | One directed, timestamped delivery from one peer to another. Derived from a transcript record whose content is a `<cross-session-message>` (§4.3). |
| **Exchange** | Messages between the same pair, adjacent in time. A display grouping only, never stored. |
| **Fleet status** | The registry's own `idle` / `busy` / `shell`, for a claude pane. Authoritative; see §8.2. |

The split between **pane identity** and **address** is the load-bearing distinction in this
document. Everything durable — roster anchoring, pane focus, the message index, click-to-focus,
persistence — keys on pane identity and `sessionId`. The address is a value Chorus reads, displays,
and forgets.

A message is **immutable and derived**. Chorus never authors one, never edits one, and its index
can be dropped and rebuilt from transcripts at any time.

---

## 6. The address problem

This is the smallest change in the spec and the one that unlocks the other two.

Peer names today are cwd-derived and human-hostile. The six live peers when this was measured
were `wt-e27d8654-dc`, `chorus-2a`, `trupanionde-ca`, `trupanionde-de`,
`add-tags-to-talking-points-qnas`, and `redesign-ff` — a slug plus a two-character
disambiguator, which is how two panes in one repo become `trupanionde-ca` and `trupanionde-de`.
`nameSource` reads `"derived"`, which is the CLI telling us the name is a fallback.

Meanwhile Chorus already names its sessions. `src/shared/agentNames.ts` holds the pool the launch
dialog prefills from — Bob, Mae, Frank, Ruth — and the chosen name is stored per session. It just
never reaches the CLI: `PtyLaunchSpec` (`src/main/adapters/types.ts:434`) carries `sessionId`,
`cwd`, `modelId`, `effortOptionId`, `modelEffortId`, `permissionModeId`, `extraArgs` and
`credential`, and no name.

`claude --help` on 2.1.246 documents:

```
-n, --name <name>    Set a display name for this session
```

**The fix is to thread a `sessionName` from the launch payload through `LaunchOptions` →
`PtyLaunchSpec` → `claudeAdapter.buildLaunch`, exactly as D179 threaded `modelEffort`.** After
it, the name in the rail, the name in the pane header, and the name a peer agent types are one
string, and "tell Mae the migration landed" is a sentence the operator can actually write.

Three constraints on the implementation:

1. **Dedupe against the machine, not the project — and only as hygiene.** `suggestAgentName` takes
   the names already taken *in this project*. The peer namespace is per machine, so two projects
   each holding a "Bob" produce two identically-named peers. The suggestion should consider live
   registry names as taken, and prefixing generated suggestions with `chorus-` cheaply avoids
   collisions with sessions Chorus did not launch. **This is advisory, never a reservation** — §4.7
   shows a name can be taken after launch, and §4.8's uniqueness gate is remotely togglable.
2. **Only the claude adapter.** `-n` is a claude flag. Other adapters keep the name as a display
   string, as today. The capability descriptor should say so rather than implying parity, and a
   non-claude pane must read as *not addressable* rather than broken.
3. **It must be passed on the restore path too, not just first launch.** Measured (§4.6): `-n`
   *is* honoured alongside `--resume <id>`, but the name is **not** persisted in session state —
   a resume without `-n` falls back to a derived name. Chorus's restore path today is
   `claude --effort <e> --permission-mode <m> --settings <hooks>.json --resume <id>` with no
   name, so a pane named "Mae" becomes `wt-e27d8654-fc` on the next app start unless `-n` is
   threaded through resume as well as fresh launch.

### 6.1 The addressing rule

Ratified by council FC-1.0 Q1, unanimous (§14). This is the rule the rest of the document obeys.

**Chorus persists** pane identity, the claude `sessionId`, the `requestedName` it passed to `-n`,
and enough launch state to pass that same `requestedName` on `--resume`.

**Chorus does not persist, key, index, or treat as authoritative the registry `name`.**

**Chorus never re-asserts a name.** It does not write a registry file, relaunch to reclaim a name,
type a rename command, or otherwise compete with the CLI's own collision and rename machinery
(§4.8). It observes and reports.

On each validated registry read, main resolves the current `name`, `nameSource`, `status`,
`peerProtocol`, liveness, and whether any other live entry currently holds the same name. The
renderer receives plain validated objects and never derives an address from cached launch state.

When `requestedName` and the live `name` disagree, **the live name is the only string shown as
currently routable**; the requested name survives as historical context, never as an address. The
drift state is **sticky** — it persists until superseded by a newer stable state or acknowledged —
because §4.8's `agent-name` records repeat and a one-poll badge would read as flicker to anyone who
blinked.

Three states, not six:

| State | Meaning | Chip |
| --- | --- | --- |
| `verified` | Live name equals the requested name | `Mae` |
| `changed` | Live name differs — collision, reclaim, or AI title | `Requested Mae · now redesign-dictation-overlay` |
| `unknown` | Registry unreadable, entry unmatched, or liveness unconfirmed | `Address unknown` |

The council specified six (`verified`, `renamed`, `collided`, `duplicate`, `unconfirmed`,
`unavailable`). Collapsed here on the coordinator's ruling and DeepSeek's own dissent that the
model was over-fragmented: `unconfirmed` and `unavailable` are one sentence to an operator — *we
cannot vouch for this address* — and per §4.8 the data usually cannot distinguish `collided` from
`renamed` anyway. Cause is an enrichment on `changed` where evidence exists (another live entry
holds the requested name → collision; an `ai-title` record precedes the change → title), never a
state of its own.

**Liveness is a pid check plus a start-time check.** §4.7 shows a hard-killed session leaves its
registry files behind, so file presence proves nothing; and a recycled pid could make a stale entry
look live. The registry carries `procStart` for exactly this comparison. The implementer must
verify the Windows mechanism for reading a process's true start time rather than assuming an API
or a timestamp format.

---

## 7. UI

### 7.1 Pane address chip — highest daily value, but not free

Each claude pane's header shows its **current** address and a fleet dot when it is a member.

The dominant friction today is not that messaging is hard, it is that the operator does not know
what to call the thing on the other screen. A chip that reads **Mae** answers that permanently.

⚠ **This chip cannot be rendered from the launch flag.** An earlier draft treated it as a near-free
add-on to threading `-n`. Council FC-1.0 Q4 killed that, correctly: a chip drawn from
`requestedName` is a *cached promise*, and §§4.6–4.8 say the promise can be broken by a collision,
a reclaim, or an AI title at any moment. A chip is only honest on top of a live, liveness-checked
registry read — which is the Phase 1 machinery.

**So the chip ships in Phase 1, with the poll it depends on** (§10). Phase 0 threads the name and
draws nothing. That ordering is deliberate: threading `-n` alone already delivers the substantive
win — peers can address Chorus panes by a real name — whether or not Chorus renders anything.

The chip renders the three states in §6.1 and nothing else. A pane whose adapter is not claude
reads *Not addressable*, which is a fact about the agent, not a failure.

### 7.2 Fleet roster

Per project, the panes that are fleet members: name, fleet status dot, last activity. Panes that
cannot participate (codex, opencode, a claude pane with no registry match) render as explicitly
**not addressable** rather than being omitted — an absent row reads as "no agents", which is a
different and wrong claim.

Peers that are *not* Chorus panes (claude-desktop, a bare terminal, another repo) sit in a
separate, collapsed group. They are addressable and it would be dishonest to hide them, but they
are not ours to focus or manage.

### 7.3 Message timeline — the daily driver

One chronological, directed list across the project's panes:

```
19:47   Bob  →  Mae      check whether the billing tests pass on your worktree
19:51   Mae  →  Bob      3 failures, all in BillingSpec — sending the diff
19:52   Mae  →  Frank    heads up, the schema change landed
```

- Sender and recipient render as the pane's Chorus identity where we have one, and as the raw
  peer name where we do not.
- A row click focuses that pane. This is the feature's one genuinely irreplaceable gesture.
  It resolves through the sender's **socket path**, never the name (§4.3); a sender never observed
  live renders as non-clickable text rather than guessing.
- The `summary` field, when the sender supplied one, is the collapsed line; the body expands.
- Messages from peers outside Chorus are marked as such, because the safety rules in §12 apply
  to them differently.

**The contract that keeps this from becoming an activity feed** (council FC-1.0 Q3, unanimous —
see §13):

> Every record in this view is an addressed message one agent deliberately sent to another; it is
> a consulted reconstruction of the conversation, not an ambient notification stream about
> activity.

That sentence is only true if the implementation holds the line. The view is **pull-only and
on-demand**. It carries no unread counts, no notifications, no pulsing indicators, no presence or
status events, no ticker, no ambient dashboard placement, and no generalised transcript feed. It
indexes only records whose content is a `<cross-session-message>` — never the `queue-operation`
pair alone (§4.3), which would drag in every background task-notification — and excludes the
duplicate `type: "user"` twin. It states visibly that it is claude-only and partial in both
directions (§4.5).

If any of those are relaxed later, the distinguishing sentence above stops being true and §13's
non-goal is being violated, whatever the feature is called at that point.

### 7.4 Compose — the socket is closed, the send box is deferred

Council FC-1.0 Q2, ruled 3-of-4 and **adopted with guard-rails** on 2026-08-27 (§14).

#### The rule

> **Chorus must never open `messagingSocketPath`, read `.key` files, or send peer-protocol bytes.
> No composer ships in Phases 0–3. Any later operator-send UI may only make an explicit,
> operator-confirmed, audited, text-only PTY write to a Chorus-owned pane.**

The first sentence is permanent and not revisitable. The second is a phase boundary. The third is
the shape of anything that might one day cross it.

#### Why the line sits at the socket, not at the send box

Chorus cannot send a real cross-session message: the transport is a per-session named pipe with a
per-session key and an undocumented, versioned protocol (§4.1). Implementing it would mean
impersonating a session — a maintenance burden that breaks on a claude update, and a security
surface with no upside. That is a permanent no.

An earlier draft extended that no to cover any compose surface at all. It was withdrawn because
**Chorus already types into panes for the operator** — Phase 3 broadcast writes one text into every
idle claude pane, and it sits in this same document. A rule stated as "Chorus never composes" is
therefore not the rule being shipped, and a rule that is already bent teaches the next reader that
bending it is normal. The honest boundary is the protocol, and this rule names it.

What Chorus can already do remains the *preferred* path, not merely the permitted one: "Ask Mae
whether the tests pass" typed into Bob's pane produces a correctly-addressed message, composed by
the agent, with the agent's judgement about phrasing and timing applied. A Chorus send box is a
worse version of a thing that already works. Phase 2's click-to-focus exists so that reply is one
click and a sentence.

#### Guard-rails — the conditions of adoption

Grok 4.6 dissented for an absolute ban, on the grounds that a PTY-injection control becomes a
composer by drift: first a nudge button, then a text field, then a reply thread, and the socket
rule never fires as a brake because none of those steps touch the socket. **That objection is
accepted as correct about the risk and answered structurally rather than by exhortation.** DeepSeek
and Qwen, both of whom voted for this rule, attached the same warning from the other side.

Anything that ever writes to a pane on the operator's behalf — including Phase 3 broadcast, which
is the first and currently only such thing — must satisfy all five:

1. **One audited write path.** Every operator-initiated write to a pane goes through a single
   function. Not a convention, a chokepoint: if a second call site can write to a PTY on the
   operator's behalf, this rule has already failed. Reviewability is the point.
2. **Text only.** Control characters and escape sequences are rejected, not escaped or best-effort
   sanitised. The submit keystroke is the write path's own concern, never caller-supplied.
3. **Explicit and confirmed per action.** No implicit sends, no autonomous sends, no retry loops,
   no queued delivery. The operator sees which panes will be written to before it happens.
4. **Target state re-checked immediately before the write, and treated as best-effort.** An idle
   check is TOCTOU-prone — the pane can go busy between the check and the write. Surface a refusal
   or an uncertainty; never retry automatically, and never claim delivery as a guarantee.
5. **Never justified by "it's the same as typing".** It is not: a PTY write can interleave with the
   operator's real keystrokes and lands without the agent's own framing. Any proposal that leans on
   that equivalence is out of scope by this rule.

The drift Grok describes is a scope question, and the answer is the phase boundary: **no free-text
compose field exists in Phases 0–3.** Broadcast is a fixed operator announcement, not a reply
surface. Reopening this before Phase 3 has shipped and the audited path exists is out of order.

#### The one adjacent gesture

**Broadcast** — write the same text into every idle claude pane in a project — is PTY work Chorus
already performs, not protocol work. It is Phase 3, optional, and the first thing that must satisfy
all five guard-rails above.

---

## 8. Where the data comes from

### 8.1 The registry — poll, cheaply

`~/.claude/sessions/*.json`, read on an interval and on pane lifecycle events. Small files, a
handful of them. No watcher is warranted; a poll on the order of seconds is inside the noise of
everything else main does.

Entries must be **liveness-checked** before display. A crashed session can leave its file behind,
and a recycled pid could collide; `pid` plus `procStart` together identify the process
unambiguously, which is presumably why `procStart` is in the file at all.

Gate every read on `peerProtocol === 1`. On an unrecognised value, degrade to "fleet unavailable"
and log once — never guess at a changed shape.

### 8.2 Fleet status is better than what we compute

Worth stating plainly because it retires work: the registry's `status` is claude's own
`idle`/`busy`/`shell`, updated by the session itself.

Chorus currently reconstructs that signal from hook events plus PTY-output heuristics with stale
sweeps (`WORKING_STALE_MS` 45 s, `OUTPUT_STALE_MS` 10 s) — machinery that exists because no
authoritative source was available. For claude panes, one now is.

**This spec does not propose replacing the activity light.** The existing path covers every
adapter and the registry covers one; a swap would trade breadth for accuracy. But where the two
disagree on a claude pane, the registry is right, and that is worth knowing — a deliberate
comparison during Phase 1 would either validate the heuristics or find a bug in them, at the cost
of a log line.

### 8.3 Transcripts — tail by offset, never re-read

Chorus already holds each claude session's transcript path (§4.4). Message extraction is:

- Keep a byte offset per transcript. On each read, consume only the delta and advance.
- Parse each new line; keep `type === "queue-operation" && operation === "enqueue"`.
- **Skip the `type: "user"` twin** of each message or every row appears twice (§4.3).
- Optionally keep `SendMessage` tool_use blocks for sent-but-not-yet-delivered state.

Full re-reads are not viable: these files were already 250 KB after two hours and grow for the
life of the session. The offset must be persisted with the index, and invalidated when the file
shrinks (§11 Q4).

Reuse `contextUsage`'s throttle-and-never-stack discipline: a read in flight must not stack, and
the read must never be awaited on a hook's blocking path.

---

## 9. Architecture and storage

**Main process** owns everything that touches disk:

- Registry reader — poll, liveness filter, protocol gate
- Transcript tailer — offset tracking, delta parse, message extraction
- The join — chorus session id ↔ claude session id ↔ registry entry
- IPC, Zod-validated, plain-object snapshots per the bridge rule

**Renderer** owns the chip, the roster, and the timeline, fed over IPC. Consistent with every
other Chorus surface, the renderer reads no files and spawns nothing.

Storage splits the way Mission Control's does, for the same reason:

| What | Where | Committed? |
| --- | --- | --- |
| `requestedName` — launch intent, re-sent on every launch path | existing `sessions` row | No — already local |
| Message index (sender/recipient **`sessionId`**, ts, summary, body, chorus pane ids) | local SQLite, new table | No — gitignored |
| `messagingSocketPath` → `sessionId` mapping, recorded at poll time (§4.3) | alongside the index | No |
| Transcript byte offsets | alongside the index | No |

⚠ **The registry `name` appears in none of these.** Per §6.1 it is live state, resolved per read
and never stored as an address. A `name` column on any of these tables is the bug this design
exists to prevent — it would reintroduce the cached promise the whole addressing rule rejects. If
a name is denormalised into the index for display, it must be labelled as a historical snapshot of
what the sender was called at send time, never used as a key or a link target.

The message index is a **cache, not a record of truth**. The transcripts are the truth; the index
exists so the timeline survives a restart and does not re-parse megabytes on every render. It
must be safe to delete and rebuild, and a schema migration should be free to drop it.

---

## 10. Phasing

Council FC-1.0 Q4 ruled that Phase 0 must not ship an address chip without a live registry read,
because a chip drawn from the launch flag is a cached promise (§7.1). The council then folded the
registry reader, liveness checking, tolerant reads and six UI states into Phase 0 while still
calling it modest. It is not modest — Grok 4.6 said so and was overruled without the scope being
re-examined.

**Resolved by splitting rather than inflating** (coordinator ruling, Matthew-approved
2026-08-27): Phase 0 keeps the half-day threading work and renders nothing; the chip moves into
Phase 1 alongside the poll it depends on. The council's correctness is preserved — no chip is ever
drawn from cached launch state — without pretending the display is free.

### Phase 0 — the address, invisible *(~half a day)*

Thread `sessionName` to `claude -n`, **on the fresh-launch and the `--resume` path alike** (§4.6 —
the name is not session state). Persist `requestedName` as launch intent. Prefix generated
suggestions with `chorus-` and dedupe against live registry names as advisory hygiene, never as a
reservation (§6).

**No UI.** No chip, no roster, no registry read. This phase is invisible in the app and still
delivers the substantive win: peers can address Chorus panes by a real name.

*Acceptance:* a pane launched as "Mae" appears as `Mae` in another session's `ListAgents`, and
`SendMessage {to: "Mae"}` from a second pane is delivered. Verified by launching two panes and
messaging between them — not by reading the flag in `--help`. **Then restart Chorus and confirm
the pane is still `Mae` and still addressable** — the restore path is where this regresses
silently, and a green result before the restart means nothing.

### Phase 1 — peer awareness and the honest chip *(read-only)*

Registry reader with schema validation and tolerant reads (missing file, invalid JSON, torn write
→ `unknown`, never a stale address). Liveness by pid **and** start-time comparison against
`procStart` (§6.1). Protocol gate on `peerProtocol`. The `sessionId` join. Record
`messagingSocketPath` → `sessionId` on every poll, for Phase 2's sender join (§4.3). The pane
address chip with its three states (§7.1). Fleet roster (§7.2). Log registry-vs-heuristic status
disagreements for claude panes (§8.2).

*Acceptance:* every claude pane in a project shows a fleet dot matching its registry status within
one poll interval; a killed session disappears from the roster rather than lingering on its leaked
registry file (§4.7); a non-claude pane renders as *not addressable* rather than vanishing; a pane
whose address is taken by another session shows `changed` with both names, and keeps showing it
rather than flashing once; an unreadable registry renders `unknown`, never the last good name.

### Phase 2 — the timeline

Transcript tailer, message index, timeline view, click-to-focus. Index only records whose content
is a `<cross-session-message>`; exclude the duplicate `type: "user"` twin and every other
`queue-operation` record (§4.3). Resolve the sender through the socket-path mapping built in
Phase 1. Write the §7.3 contract down as an enforceable checklist before implementing.

*Acceptance:* a message sent between two Chorus panes appears in the timeline with correct sender,
recipient, and timestamp, **exactly once**; a background task-notification in the same transcript
does **not** appear at all; a message whose sender has since been renamed still focuses the right
pane; a message from a sender never observed live renders as non-clickable text rather than
focusing the wrong pane; the timeline survives an app restart without re-parsing; deleting the
index rebuilds it identically.

### Phase 3 — broadcast *(optional)*

Write one text into every idle claude pane in a project, via the PTY path Chorus already owns.
Explicitly not a protocol client (§7.4).

**This phase builds the audited write path, and is the first thing bound by it.** Broadcast is a
fixed operator announcement, not a reply surface and not a free-text compose field. All five
guard-rails in §7.4 apply to it, and the single write function it introduces is the chokepoint
every future operator-initiated pane write must go through.

*Acceptance:* the text lands in each targeted pane's prompt; busy panes are skipped rather than
interrupted; the operator sees which panes will be written to before confirming, and which were
actually written afterwards. Target state is re-checked immediately before each write and a pane
that went busy in between is reported as skipped, not retried. Control characters and escape
sequences in the operator's text are **rejected**, with a test that asserts it. A second code path
writing to a PTY on the operator's behalf fails review by definition.

---

## 11. Open questions

To resolve before implementation; do not guess at these.

1. ~~**Does `-n` reject a duplicate name, silently disambiguate it, or allow a collision?**~~
   **Answered — it allows a collision, on a delay.** `-n Zeta` while another live session holds
   `Zeta` registers as `wt-e27d8654-6a` / `nameSource: "derived"`. But once the original holder
   exits, the deferred session **takes the name it was denied**: a registry read caught pids
   36712 and 17752 simultaneously live and *both* named `Zeta`. So machine-wide dedupe is a
   correctness requirement, and — the part that bites — **it cannot be a check performed only at
   launch.** A pane can start uniquely named and collide minutes later with no event to react to.
   **Settled by §6.1:** dedupe is advisory hygiene only, the live registry name is the address, and
   drift surfaces as the sticky `changed` state. Chorus never re-asserts a name.

   *(Evidence caveat: this came from a run whose resume cases were confounded by a failed
   teardown. It stands anyway — the two pids are distinct and the duplicate names were read
   straight from two registry files. Re-measure only if the design depends on the reclaim's
   timing, which is unknown.)*
2. ~~**Is `-n` honoured alongside `--resume <id>`?**~~ **Answered — yes, and it must be passed
   there.** See §4.6. `-n` works on the resume path (case B), but the name is not persisted in
   session state, so a resume without it degrades to a derived name (case C). Phase 0 is
   unblocked, with the requirement that the flag go on *both* launch paths. The codex precedent
   cited here turned out not to apply — this is a plain flag, not an override token.
3. ~~**Are registry files cleaned up on crash, or do stale entries persist?**~~ **Answered — they
   persist on a hard kill, and are cleaned up on a normal exit.** See §4.7. The liveness check
   must verify the pid, not the file.
4. **Can a transcript shrink or be rewritten in place — `/compact`, a resume, a rotation?** If so,
   offset-based tailing needs an invalidation rule beyond "file got smaller".
5. **Should non-Chorus peers be addressable from the roster at all, or only listed?** They are
   real and reachable; the question is whether Chorus should encourage traffic to sessions it
   cannot see the state of.
6. **What does `notify_when_idle` (advertised as the `notify_idle` peer feature) do to a pane's
   turn?** A "tell me when Mae is done" primitive already exists at the agent level. Whether it
   belongs in Chorus's UI depends on whether the subscription costs the target session anything.
7. **Can an `ai-title` overwrite a name set by `-n`?** (§4.8) Answered in part: a generated title
   is promoted to the peer address via an `agent-name` record, measured on a session that had no
   explicit name. What is *not* established is whether `-n` is immune. Needs a session driven long
   enough to trigger titling; a single exchange does not do it.

   **Explicitly non-blocking** (council FC-1.0 Q4, unanimous). Because §6.1 treats *every* address
   as volatile and resolves it live, the answer changes only how often the `changed` state appears
   and what cause it can name — never whether the design is correct. Run it as a background
   verification task; do not gate Phase 0 or Phase 1 on it.
8. **Retention for the message index** — probably unbounded like the actuals store, but a project
   with months of fleet traffic should be checked for index growth before it is assumed harmless.

---

## 12. Risks

| Risk | Mitigation |
| --- | --- |
| The registry format is undocumented and will change | Gate on `peerProtocol`; degrade to "fleet unavailable"; never crash or guess. Treat the whole reader as best-effort telemetry. |
| Temptation to implement the messaging protocol | §3 and §7.4 are load-bearing non-goals. The socket half is permanent and not revisitable — not even if the protocol is documented later. |
| A pane-write control drifts into a chat composer | Grok 4.6's dissent (§7.4), accepted as a real risk. Answered structurally: no free-text compose field in Phases 0–3; one audited write function as a chokepoint; text-only with control sequences rejected; per-action operator confirmation. A second write path is the signal that this failed. |
| An idle check is treated as a delivery guarantee | It is TOCTOU-prone by nature. Re-check immediately before the write, report refusal or uncertainty, never retry automatically, never state delivery as fact. |
| Reading `.key` files to "just make sending work" | Never. They are session credentials. Chorus has no legitimate use for one. |
| Fleet view is claude-only and reads as complete | Render non-participating panes explicitly as not addressable; label the external-peer group. |
| Permission laundering between agents | The receiver's own preamble already warns agents not to launder denied actions. The timeline should make peer-originated instructions **visible** to the operator, which is an argument for the feature rather than against it. Chorus must never auto-approve anything on a peer's behalf. |
| Token amplification — agents waking each other costs money | Fleet traffic is a cost dimension. Surface message counts per pane; it is exactly the kind of telemetry Mission Control's cost model should consume. |
| Double-counting messages from the `user` twin record | Explicit skip rule in §8.3, and an acceptance test that asserts *exactly once*. |
| Transcript parsing is brittle by nature | It is the only path to message content, so it cannot be avoided — but the index is disposable and rebuildable, so a parse regression costs a rebuild, not data. |
| A stale name makes the operator address the wrong agent | §6.1: the live registry name is the only string shown as routable; disagreement with `requestedName` renders as the sticky `changed` state; an unverifiable entry renders `unknown`, never the last good name. |
| A recycled pid makes a leaked registry file look live | §4.7 leaves files behind on a hard kill, so liveness is a pid check **plus** a start-time comparison against the entry's `procStart`. Verify the Windows mechanism for reading true process start time before coding it — do not assume an API or a timestamp format. |
| The timeline's click-to-focus silently depends on the volatile name | Resolve the sender through `messagingSocketPath` → `sessionId` (§4.3). A sender never observed live is rendered as plain text; never guess by name, and never focus a pane on a name match alone. |
| Repeated `agent-name` records make the chip flicker | The `changed` state is sticky by §6.1, not a per-poll badge. Render last-observed state; a transition the operator blinked past must still be visible afterwards. |
| The socket and `.key` prohibitions regress through a later change | Add a repository guard and code-review check for any reference to `messagingSocketPath` or a `.key` path outside this spec's read-only registry parsing. A non-goal that is only prose gets edited away. |
| The remote uniqueness gate flips | `tengu_session_name_uniqueness` (§4.8) is server-controlled, so collision behaviour can change without a CLI update. Dedupe is advisory only and the UI renders observed state, so a flip changes frequency, not correctness. |

---

## 13. Relationship to Mission Control

Mission Control (`docs/Features/Mission Control/chorus-mission-control-spec.md`) plans dispatch
across an agent fleet but assumes the fleet is a set of independent workers coordinated only
through the operator. §4.2 shows they can coordinate directly, without him.

Fleet Comms is the communication substrate that would make Mission Control's dispatch model
richer — a dispatched agent that can ask another agent a question is a different scheduling
problem from one that cannot. Neither feature blocks the other, and Fleet Comms is by far the
smaller of the two.

One deliberate tension, **now resolved**: Mission Control lists "no comments, attachments,
notifications, or activity feeds" as an explicit non-goal, and the §7.3 timeline sits close to that
line. Council FC-1.0 Q3 ruled the timeline **distinct — conditionally**, unanimous, on this
sentence:

> Every record in this view is an addressed message one agent deliberately sent to another; it is
> a consulted reconstruction of the conversation, not an ambient notification stream about
> activity.

The distinction is real but it is *earned by the constraints, not by the subject matter*. An
activity feed and this view differ only in that one pushes and the other is consulted. The moment
§7.3's contract is relaxed — an unread count, a notification, a pulse on the rail, an ambient
dashboard slot — the sentence above becomes false and Mission Control's non-goal is being violated
under a different name.

Treat §7.3's list of prohibitions as the actual ruling, and this sentence as its justification.

---

## 14. Council FC-1.0 — what was adopted

Brief: `CouncilBrief-FleetComms-1.0-AddressAndVisibility.md`
Findings: `CouncilBrief-FleetComms-1.0-AddressAndVisibility-Findings.md`
Run `e2a6cf97-325b-48ff-8a43-3020237a08c4`, 2026-08-27. Four members plus an arbiter.

| Q | Ruling | Status |
| --- | --- | --- |
| Q1 addressing model | identity-first, live drift surfacing, **no re-assertion** (unanimous) | **Adopted** → §5, §6.1 |
| Q2 composer | socket-only prohibition (3-of-4, Grok dissenting for absolute) | **Adopted with guard-rails** 2026-08-27 → §3, §7.4 |
| Q3 timeline | distinct from an activity feed, conditionally (unanimous) | **Adopted** → §7.3, §13 |
| Q4 sequencing | reshape Phase 0; ship before the AI-title question is settled (unanimous) | **Adopted, re-cut** → §10 |
| Q5 alternatives | none load-bearing; stable local identity adopted into Q1 (2-of-4) | **Adopted into Q1** → §5 |

### Where this spec departs from the findings

Four departures. The first three were made on evidence the council could not see — no member had
repository or machine access, and the findings say so themselves.

1. **`queue-operation` / `enqueue` is not the message filter** (findings action item 13). In the
   real transcript, one of four such records was a cross-session message; three were background
   task-notifications. The filter is the `<cross-session-message>` content. See §4.3. This error
   originated in this spec and the council inherited it from the brief.
2. **The sender join is the socket path** (findings action items 14–15, which asked whether a
   sender `sessionId` exists and proposed falling back to the volatile name). It does not exist,
   but `from=` carries the sender's `messagingSocketPath`, which is a registry field and resolves
   to a `sessionId`. The hash is not derivable from the session id, so the mapping must be recorded
   during the poll. See §4.3.
3. **Three address states, not six**, and cause is an enrichment rather than a state. §4.8 shows a
   real collision wrote `nameSource: "derived"`, so the data usually cannot name a cause; DeepSeek
   independently flagged the state model as over-fragmented. See §6.1.
4. **Q2 is adopted with the dissent's concern promoted into binding conditions**, not merely noted.
   The council's rule permitted a future PTY-send UI; Grok 4.6's minority position was that such a
   control drifts into a composer regardless of the socket ban. Rather than pick a side, §7.4
   adopts the majority rule and makes the minority's failure mode structurally hard: one audited
   write function as a chokepoint, text-only with control sequences rejected, per-action
   confirmation, best-effort target re-check, and no free-text compose field before Phase 3. The
   deciding argument for the majority rule was one the council did not make — the absolute ban was
   *already* contradicted by Phase 3 broadcast sitting in the same document.

One scope correction: the council reshaped Phase 0 correctly but kept calling the result modest.
Grok 4.6 objected and was overruled without the scope being re-examined. Resolved by splitting
Phase 0 rather than inflating it — see the note opening §10.

### Confidence

Lower than the unanimity counts suggest. GLM 5.3 answered one turn and refused the other, so Q1's
"4-of-4" rests on three-and-a-half members. Q5 was 2-of-4 for "none". The 18 preserved critique
dissents come from three members at six each — repetition by a few, not breadth across the council,
as the findings' own warning notes. Nothing in the findings was compiled, executed, or tested.

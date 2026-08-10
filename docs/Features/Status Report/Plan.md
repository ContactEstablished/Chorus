# Plan: Pane Telemetry, Log Analysis, and Mobile Relay

**Status:** Proposed
**Owner:** Matt
**Target:** Chorus (Electron + Vue 3 + TypeScript)
**Audience:** Claude Code, implementing against the existing Chorus master plan

---

## 1. Goal

Let me leave the desk and still run the fleet.

Every agent pane in Chorus emits structured events to a single append-only log. A summarizer (GPT) reads that log and produces a short, actionable digest per pane. The digest is pushed to my phone with tappable choices, and my response is routed back into the correct pane's stdin.

Target interaction:

> **pane-3 · api-refactor** — Claude is asking to commit and push 4 files.
> `[1] Go` `[2] Show me the diff first` `[3] Hold`
> _…or reply with text and I'll relay it._

> **pane-1 · billing-migration** — Claude is asking which migration strategy to use.
> `[1] Expand/contract` `[2] Dual-write` `[3] Big-bang cutover`

## 2. Design Principles

1. **Aggregate at the Chorus layer, never per-CLI.** One event bus, one log, one schema. Adding Aider or Gemini CLI later is a shim, not a rewrite.
2. **Prefer structured signals over screen-scraping.** Claude Code hooks and Codex `notify` give reliable, typed events. PTY heuristics are a fallback for CLIs that have no hook system — clearly marked as lower-confidence.
3. **The log is the source of truth.** The analyzer, the UI, and the mobile relay are all readers. Nothing downstream holds authoritative state.
4. **Injection is privileged.** Text written into a live agent's stdin from a phone is the highest-risk path in the system. It is allow-listed, server-resolved, single-use, and fully audited.
5. **Attention is the scarce resource.** The digest exists to reduce the number of things I have to look at, not to mirror everything. Silence when nothing needs me is a feature.

## 3. Non-Goals (this phase)

- Full terminal mirroring / remote shell to the phone. That's a separate later effort.
- Multi-user or multi-machine. Single operator, single desktop.
- Replacing the Chorus desktop UI. This is an out-of-band channel.
- Autonomous action. The analyzer proposes; only I approve.

---

## 4. Architecture

```
┌──────────────── Chorus main process ────────────────┐
│                                                     │
│  node-pty panes ──┐                                 │
│                   ├──► EventBus ──► JSONL Log       │
│  Hook Ingest ─────┘        │        (append-only)   │
│  (127.0.0.1 HTTP)          │                        │
│                            ▼                        │
│                      PaneStateMachine               │
│                            │                        │
│                     (debounced change)              │
│                            ▼                        │
│                       Analyzer (GPT) ──► Digest     │
│                            │                        │
│                            ▼                        │
│                      RelayManager                   │
│                       │          ▲                  │
│                       ▼          │                  │
│                    Telegram / ntfy sink             │
│                       │          │                  │
│                  (outbound)  (inbound action)       │
│                                  │                  │
│                       ActionResolver ──► pty.write  │
└─────────────────────────────────────────────────────┘
```

### 4.1 Components

| Component | Responsibility |
|---|---|
| `EventBus` | In-process typed emitter. Single entry point for all pane events. |
| `EventLog` | Append-only JSONL writer with rotation + fsync policy. |
| `HookIngest` | Localhost HTTP listener receiving CLI hook callbacks. |
| `PtyObserver` | Derives events from raw PTY output for CLIs without hooks. |
| `PaneStateMachine` | Reduces the event stream into current status per pane. |
| `Analyzer` | Builds the GPT request, validates the JSON response into a `Digest`. |
| `RelayManager` | Fans the digest out to configured sinks; owns action lifecycle. |
| `ActionResolver` | Maps an inbound action id back to concrete pane input. Enforces safety. |

---

## 5. Event Schema

One JSON object per line. `logs/events-YYYY-MM-DD.jsonl`, rotated daily and at 64 MB.

```ts
interface ChorusEvent {
  v: 1;
  event_id: string;        // uuidv7 — sortable
  seq: number;             // monotonic per process run
  ts: string;              // ISO-8601 with ms, UTC
  pane_id: string;         // DURABLE — uuidv7, minted on pane creation, persisted in workspace.json
  run_id: string;          // EPHEMERAL — uuidv7, minted at each pty.spawn
  pane_label: string;      // human name, e.g. "api-refactor"
  agent: 'claude' | 'codex' | 'aider' | 'gemini' | 'shell';
  repo?: string;
  worktree?: string;
  branch?: string;
  type: EventType;
  confidence: 'high' | 'low';   // 'low' = PTY-derived heuristic
  payload: Record<string, unknown>;
}

type EventType =
  | 'pane.started'
  | 'pane.exited'
  | 'agent.turn_start'
  | 'agent.turn_complete'
  | 'agent.awaiting_input'      // open question to the operator
  | 'agent.awaiting_approval'   // permission gate (commit, push, write, bash)
  | 'agent.error'
  | 'tool.pre_use'
  | 'tool.post_use'
  | 'pane.output_tail'          // sampled, ANSI-stripped, truncated
  | 'user.input_injected';
```

**Payload conventions**

- `agent.awaiting_approval` → `{ action: 'git_commit' | 'git_push' | 'bash' | 'file_write' | ..., detail: string, files?: string[], command?: string }`
- `agent.awaiting_input` → `{ question: string, options?: string[] }` — `options` only when the CLI actually enumerated them
- `pane.output_tail` → `{ text: string }`, ANSI escapes stripped, last ~2 KB, emitted at most once per 5 s per pane
- `user.input_injected` → `{ source: 'telegram' | 'ui', action_id: string, text_hash: string, actor: string }` — **never log the raw injected text if it may contain secrets; log a hash plus the resolved action label**

**Redaction.** Run every `text` field through a redaction pass before write: common token shapes (`sk-`, `ghp_`, `AKIA`, JWT-like), `.env` line patterns, and anything matching the user-configured `redactPatterns`. This log will be shipped to an external API — treat it as untrusted-egress.

### 5.1 Identity Model (`pane_id` + `run_id`)

**Decided.** Two ids, because they answer two different questions. Do not collapse them into one.

| | `pane_id` | `run_id` |
|---|---|---|
| Lifetime | Pane creation → pane deletion | One `pty.spawn` → process exit |
| Minted | When the operator creates the pane in the Chorus UI | At every spawn/respawn |
| Persisted | Yes — `workspace.json` | No — in-memory, reconstructible from the log |
| Survives app restart | Yes | No |
| Answers | "Which pane is this?" | "Is this the same agent process that asked me the question?" |

Both are uuidv7 so they sort chronologically.

**`repo`, `worktree`, and `branch` are attributes of a pane, never its identity.** A worktree is something a pane *points at*. Paths get renamed, panes get repointed, and two panes can legitimately share one worktree — any id derived from a path breaks on all three. Identity belongs to the object Chorus already persists.

**Capture the CLI's own session id too.** Claude Code and Codex each mint one internally; store it in the `pane.started` payload as `agent_session_id`. It costs nothing now and it's exactly what a future "resume this pane where it left off" button needs (`claude --resume {agent_session_id}` after a Chorus restart).

**Restart procedure**

1. On boot, load `workspace.json` for the authoritative set of `pane_id`s.
2. Replay the event log filtered to those ids to rebuild `PaneStateMachine`. Events for unknown `pane_id`s are ignored (deleted panes).
3. Any pane whose last event is not `pane.exited` is marked `exited (unclean)` — its child process died with the app. **Never let a stale `working` status survive a restart**; a status that lies is worse than no status.
4. On respawn, mint a fresh `run_id` and emit `pane.started`.

**Enforcement.** `HookIngest` rejects any event whose `run_id` is not currently live — that's the cheap guard against a zombie shim POSTing after its process is gone.

**Forward compatibility.** If panes are later backed by tmux so agents outlive Chorus, reattaching an existing session **reuses the surviving `run_id`** rather than minting a new one — the process never ended, so the run never ended. Leave a comment at the mint site saying so.

---

## 6. Signal Sources

### 6.1 Claude Code (high confidence)

Register hooks in the per-worktree `.claude/settings.json` that Chorus already generates:

| Hook | Emitted event |
|---|---|
| `SessionStart` | `pane.started` |
| `Notification` | `agent.awaiting_input` / `agent.awaiting_approval` |
| `PreToolUse` | `tool.pre_use` (used to classify the approval type) |
| `PostToolUse` | `tool.post_use` |
| `Stop` | `agent.turn_complete` |

Each hook invokes a thin shim (`bin/chorus-hook`) that POSTs the hook JSON to `http://127.0.0.1:{ingestPort}/v1/events` with `Authorization: Bearer {sessionToken}`. `CHORUS_PANE_ID`, `CHORUS_RUN_ID`, and `CHORUS_TOKEN` are injected into the pane's environment at spawn time; the shim posts all three.

The shim must be non-blocking and fail-open: a dead Chorus must never wedge a coding session. Timeout 500 ms, exit 0 regardless.

### 6.2 Codex CLI (high confidence)

`notify` in `~/.codex/config.toml` pointed at the same shim with an `--source=codex` flag. Map its payload onto the same event types.

### 6.3 Aider / Gemini / arbitrary shell (low confidence)

`PtyObserver` maintains a rolling ANSI-stripped tail buffer per pane and emits:

- `agent.turn_complete` when output has been idle for `idleMs` (default 4000) **and** the tail matches a known prompt pattern
- `agent.awaiting_input` when the tail matches a configured question pattern (`/\(y\/n\)/i`, `/\[1\]/`, trailing `?` on the last non-empty line, etc.)

Patterns live in config per agent, not hardcoded. Every event from this path is `confidence: 'low'`, and the analyzer is told so.

---

## 7. Pane State Machine

Reduces events into:

```ts
type PaneStatus =
  | 'idle'         // no agent running
  | 'working'      // turn in flight
  | 'awaiting'     // needs me — question or approval
  | 'error'
  | 'exited';
```

Transitions are driven purely by the event stream so the machine can be rebuilt by replaying the log (important for crash recovery and for testing).

Only `awaiting` and `error` are notification-worthy by default. `working` → `idle` transitions are digest-worthy but silent unless `notifyOnComplete` is set.

---

## 8. Analyzer

### 8.1 Trigger

Debounced on state change, **not** polled. Fire when any pane enters `awaiting` or `error`, coalescing changes within a 3 s window so a burst of panes produces one digest. Hard floor of one analyzer call per 20 s.

Skip the model entirely when a deterministic classifier is sufficient — e.g. a `PreToolUse` event for `Bash(git push)` is unambiguously "asking to push". The GPT call is for *summarizing what's actually going on and proposing good options*, not for parsing what we already know. This keeps cost and latency down.

### 8.2 Request

Input assembled by Chorus (not the model):

- Current state of every pane (status, label, repo, branch, time in state)
- Last 30 events per `awaiting`/`error` pane
- ANSI-stripped tail (≤ 3 KB) for those panes only
- The `confidence` flag per event

System prompt requires strict JSON, no prose, no markdown fences.

### 8.3 Response contract

```ts
interface Digest {
  generated_at: string;
  global_summary: string;          // ≤ 200 chars, e.g. "2 panes need you, 1 still building"
  panes: PaneDigest[];
}

interface PaneDigest {
  pane_id: string;
  run_id: string;                  // the run that raised this — checked at injection time
  status: PaneStatus;
  headline: string;                // ≤ 90 chars — the push notification title
  detail: string;                  // ≤ 400 chars — what it's asking and why
  urgency: 0 | 1 | 2 | 3;          // 3 = blocking, destructive, or waiting > 10 min
  suggested_actions: SuggestedAction[];   // 0–4
  allow_freeform: boolean;
}

interface SuggestedAction {
  id: string;                      // short, unique within digest — "a1"
  label: string;                   // ≤ 40 chars — the button text
  send: string;                    // literal text to write to the pane
  risk: 'low' | 'medium' | 'high'; // high = destructive / irreversible
  rationale?: string;              // ≤ 120 chars
}
```

Validate with zod. On schema failure: retry once with the validation error appended, then fall back to a mechanically-generated digest (status + raw question + generic `Yes` / `No` / freeform). **The relay must never be blocked by a bad model response.**

---

## 9. Mobile Relay

### 9.1 Sink: Telegram (primary)

Inline keyboards map directly onto `suggested_actions`, which is the whole reason to prefer it over ntfy for v1.

- One message per `PaneDigest`, buttons from `suggested_actions`
- `callback_data` = `{digest_id}:{action_id}` — under the 64-byte limit, and opaque
- Freeform: operator replies to the message; `reply_to_message_id` maps back to the pane
- `high` risk actions require a second confirming tap ("Confirm push to main?")
- Inbound is restricted to an allow-list of chat IDs in config; everything else is dropped and logged

### 9.2 Sink: ntfy (secondary)

Notification-only fallback for when Telegram is unavailable. Actions render as text (`Reply 1/2/3`) and are unsupported for inbound in v1.

### 9.3 Sink interface

```ts
interface RelaySink {
  name: string;
  publish(digest: Digest): Promise<PublishResult>;
  onAction?(handler: (action: InboundAction) => Promise<void>): void;
}
```

New transports (a SignalR hub + Vue PWA, later) implement this and nothing else changes.

---

## 10. Action Resolution and Injection

**Never write inbound text directly to a PTY.** The flow is:

1. Inbound `{digest_id, action_id}` or `{digest_id, freeform_text}` arrives.
2. `ActionResolver` looks up the digest in an in-memory store keyed by `digest_id`.
3. Verifies: digest not expired (TTL 30 min), action not already consumed, pane still alive and still in `awaiting`.
4. **Verifies `digest.run_id === pane.currentRunId`.** This is the stale-injection guard — it catches the case where the agent process restarted between the notification going out and the button being tapped, so my "yes, push it" doesn't land in a fresh session that has no idea what it's agreeing to.

```ts
if (digest.run_id !== pane.currentRunId) {
  return refuse('The agent restarted since that question — nothing was sent.');
}
```

5. For a suggested action, `send` comes **from the stored digest**, not from the inbound message.
6. For freeform: cap 2000 chars, strip all C0 control characters and ANSI escapes, reject if it contains newline-plus-content sequences unless `allowMultiline` is set.
7. Write to the pane, then emit `user.input_injected` (carrying both `pane_id` and `run_id`).
8. Reply on the same message thread confirming what was sent.

**Refusals to handle explicitly:** pane died between digest and tap; the agent restarted (`run_id` mismatch); pane moved on by itself; action already used; digest superseded by a newer one for the same pane. Each gets a distinct, human-readable reply — silent failure here is worse than an error.

Control sequences (Ctrl-C, ESC) are only ever available as explicit, named actions the resolver knows about. They are never reachable through freeform.

---

## 11. Configuration

Extend the Chorus config with:

```jsonc
{
  "telemetry": {
    "enabled": true,
    "logDir": "${userData}/logs",
    "ingestPort": 47821,
    "redactPatterns": ["sk-[A-Za-z0-9]{20,}", "ghp_[A-Za-z0-9]{20,}"],
    "ptyIdleMs": 4000
  },
  "analyzer": {
    "provider": "openai",
    "model": "gpt-5",
    "minIntervalMs": 20000,
    "debounceMs": 3000,
    "maxTailBytes": 3072
  },
  "relay": {
    "sinks": ["telegram"],
    "notifyOn": ["awaiting", "error"],
    "telegram": {
      "botTokenRef": "keychain:chorus/telegram",
      "allowedChatIds": [123456789]
    }
  }
}
```

Secrets go through the OS keychain (`keytar` / Electron `safeStorage`), never the config file.

---

## 12. Implementation Phases

Each phase ships independently useful and has an autonomy gate — stop and check in before starting the next.

### Phase 1 — Event bus + log
`EventBus`, `EventLog`, event schema, the `pane_id`/`run_id` identity model (§5.1) including `workspace.json` persistence, redaction, rotation, replay loader.
**Done when:** a fake pane emitter produces a valid JSONL file that round-trips through the replay loader, and a simulated restart mid-run yields `exited (unclean)` rather than a stale `working`.

### Phase 2 — Real signals
`HookIngest` server, `bin/chorus-hook` shim, Claude Code settings generation, Codex `notify` wiring, `PtyObserver` heuristics.
**Done when:** a real Claude Code session in a Chorus pane produces `pane.started` → `tool.pre_use` → `agent.awaiting_approval` → `agent.turn_complete`, all four carrying the correct `pane_id` and a single consistent `run_id`.

### Phase 3 — State machine + desktop surfacing
`PaneStateMachine`, replayable from log, plus a status dot per pane in the existing Chorus UI.
**Done when:** pane status in the UI matches reality across a 30-minute multi-pane session, and survives an app restart via log replay.

### Phase 4 — Analyzer
Request assembly, prompt, zod validation, retry, mechanical fallback, deterministic pre-classifier, cost/latency logging.
**Done when:** contract tests pass against recorded fixtures, and a malformed model response still yields a usable digest.

### Phase 5 — Outbound relay
`RelaySink` interface, Telegram sink, digest → message rendering, urgency-based routing.
**Done when:** a real approval prompt in a pane produces a phone notification with correct buttons in under 10 seconds.

### Phase 6 — Inbound + injection
`ActionResolver`, allow-list auth, TTL/single-use, freeform sanitization, high-risk confirmation, audit events, all refusal paths.
**Done when:** the full loop works end to end and every entry in the abuse checklist (§13) is covered by a test.

### Phase 7 — Hardening
ntfy sink, offline queue and replay-on-reconnect, log retention policy, `pty` backpressure under high-output panes, docs.

---

## 13. Safety / Abuse Checklist

Every item needs a test before Phase 6 is considered done.

- [ ] Inbound from a non-allow-listed chat ID is dropped and logged
- [ ] Ingest endpoint rejects requests without a valid session token
- [ ] Ingest endpoint binds `127.0.0.1` only — never `0.0.0.0`
- [ ] `callback_data` cannot influence the text sent; only the stored digest can
- [ ] An action id cannot be replayed after consumption
- [ ] An expired digest cannot be acted on
- [ ] A digest whose `run_id` no longer matches the pane's current run is refused with a clear message
- [ ] `HookIngest` rejects events carrying a `run_id` that is not currently live
- [ ] A pane that was `working` when the app was killed comes back as `exited (unclean)`, never `working`
- [ ] Freeform text cannot inject control characters or ANSI escapes
- [ ] A destructive (`risk: high`) action requires two taps
- [ ] Secrets are redacted before anything leaves the machine for the analyzer
- [ ] Chorus being down never blocks or slows a coding session (hook shim fails open)
- [ ] Analyzer failure degrades to a mechanical digest rather than silence

---

## 14. Open Questions

1. ~~**Session identity across restarts.**~~ **Resolved** — see §5.1. Durable `pane_id` from `workspace.json` plus ephemeral `run_id` per spawn; worktree path is an attribute, not an identity.
2. **How much scrollback does the analyzer actually need?** Start at 3 KB; instrument whether digest quality drops when truncated.
3. **Should the analyzer see cross-pane context?** Two panes touching the same files is exactly the thing worth being told about — but it widens the prompt considerably. Defer to Phase 7 and measure.
4. **Cost ceiling.** Add a daily analyzer spend cap with a degrade-to-mechanical fallback when exceeded?
5. **Do the desktop UI and the phone share the digest?** Reusing it in-app would justify the analyzer cost even when I'm at the desk.

---

## 15. Dependencies

- `node-pty` (existing)
- `zod` — schema validation
- `uuid` v7 — sortable event ids
- `strip-ansi` — tail normalization
- `keytar` or Electron `safeStorage` — secrets
- OpenAI SDK — analyzer
- `grammy` or raw Bot API over `fetch` — Telegram (prefer raw fetch; the surface used here is small)

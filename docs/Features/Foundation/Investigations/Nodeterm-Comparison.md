# nodeterm vs Chorus — feature comparison and recommendations

**Date:** 2026-08-17 · **Author:** Claude (Fable 5) at Matthew's request · **Status:** recommendations, not decisions. Nothing here changes the roadmap until Matthew (or the council) says so.

> **Outcome (2026-08-18, roadmap D163):** Matthew ruled. **R1 and R3 are admitted as candidate features** — recorded in the roadmap's *Candidate features* section (after Phase 8) as **C1 Peer context & messaging** and **C2 Sub-agent visibility via transcript tail**; unscheduled, no phase number, not authoritative until an architect pass places them. **R2, R4–R11 are documented there for later consideration** (neither adopted nor rejected); **Tier 3 is recorded as considered-and-not-adopted.** §8 Out Of Scope gained a clarifying bullet that C1 is not orchestration.

## Sources

- Reddit r/ClaudeAI post (2026-08-17), 76 entries — https://www.reddit.com/r/ClaudeAI/comments/1vqx297/ (fetched via RSS; reddit.com blocks direct fetch)
- Reddit r/ClaudeCode post (2026-08-08), 212 entries, the thread with the substantive feedback — https://www.reddit.com/r/ClaudeCode/comments/1vj5ktu/
- Repo https://github.com/eneskirca/nodeterm @ `main` (2026-08-17), README, CLAUDE.md, `docs/*.md`, and the `src/core/context-link*`, `hook-server`, `agents/hooks/*`, `context-tail`, `commit-message`, canvas-control sources
- Claude Code docs: cross-session messaging (https://code.claude.com/docs/en/cross-session-messaging), agent view (https://code.claude.com/docs/en/agent-view)
- Chorus: `docs/PLAN.md`, `docs/Features/Foundation/roadmap.md` (D162 / F80 current), source under `src/main`

**License note.** nodeterm is BUSL-1.1 (MIT four years after each release). Every idea below is to be re-implemented from scratch; no code, generated shell text, or SKILL.md prose may be copied.

---

## 1. What nodeterm is, in one paragraph

macOS/Linux Electron + React Flow app: every terminal or agent is a draggable node on an infinite canvas, backed by tmux (sessions outlive the app). Claude Code / Codex / Gemini / Copilot / opencode / Grok supported. Status is hook-driven (RUNNING / NEEDS YOU), each node has a context-window pill, nodes can be *context-linked* so one agent can pull another's transcript on demand, agents can drive the canvas through a CLI, and there is a kanban view of the same live sessions, a git panel, worktree-per-group, voice dictation (local whisper), multiple Claude identities, SSH/remote projects, an iOS companion and a self-hosted server edition. Windows is "a PR under review". 671 stars.

## 2. Two facts that reframe the whole comparison

**2a. Claude Code now does session-to-session messaging natively — but not on Windows.**
Claude Code ≥ 2.1.224 (2026-08-08) ships `ListAgents` / `SendMessage` between independent sessions on the same machine (per-session Unix inbox socket, text only, never history or files, delivered between tool calls, held/refused by `crossSessionInbound`, loop-throttled). The docs state plainly: *"available on macOS and Linux, including Linux inside WSL 2. Claude Code doesn't offer cross-session messaging on native Windows."* Agent view (`claude agents`, background sessions under a daemon) is the same story: macOS-first research preview.

Chorus is Windows-only. **The Windows gap Anthropic left open is exactly the thing nodeterm's "context links" and Reddit's "terminals can communicate" excitement are about.** A Chorus-owned peer surface would not be a me-too on macOS; on Windows it would be the only one — and unlike Claude Code's, it can be cross-vendor (claude ↔ codex ↔ opencode) because Chorus already owns MCP config injection for all three.

**2b. nodeterm's context sharing is *pull*, not *push*, and the community already found the two failure modes.**
The author's own description: *"almost no context is passed directly. Instead, each terminal has access to read or fetch context from the others whenever it needs something."* Mechanically: a link edge → a per-node link doc → a shell shim the agent calls (`summary -n 15`, `transcript`, `terminal`) → main renders the *linked* node's Claude/Codex/Gemini transcript file (or `tmux capture-pane`) as flattened `user:/assistant:/$ tool/= result` text with tool args cut at 200 chars and results at 500. Discovery is a SKILL.md ("get-linked-context") plus a one-line idle-gated nudge on link creation ("just acknowledge briefly" — because Gemini otherwise launched an unsolicited investigation of the peer).

The two failure modes surfaced on Reddit:
- *"Why does linking two fresh CLIs use so many tokens?"* — the injected skill/nudge plus an agent that eagerly reads a full transcript. Pull only pays when the read is bounded and lazy.
- *"Sharing context is cool, but I consider it poisoned after a few turns … A spec, plan, handoff document works better."* — raw transcript ≠ good context. **Chorus already built the better answer to this** (the per-project Neo4j memory graph, Phase 6/6a) — durable, curated, written-after-milestone. What Chorus lacks is the *ephemeral* tier: "what is my peer doing right now?" and "tell my peer X".

So the recommendation is a **three-tier model**, two of which exist:

| Tier | Purpose | Chorus status |
|---|---|---|
| Durable shared knowledge | decisions, milestones, provenance | ✅ `chorus-memory` graph (Phase 6/6a) |
| Ephemeral peer read | "what is session B doing / what did it just print" | ❌ nothing |
| Peer message | "tell session B the migration landed" | ❌ nothing (and Claude Code's native one is absent on Windows) |

---

## 3. Recommendations, prioritised

Legend for *Fit*: **S** = shipped in Chorus, **P** = planned (phase/decision cited), **N** = nothing, **⚠D** = conflicts with a recorded decision that would need revisiting.

### Tier 1 — build these; they fit the architecture and fill real gaps

**R1. `chorus-peers` MCP server: list / read / message between sessions in a project.** (Fit: N; adjacent to D39/§8 but not the same thing)
- *Surface:* an MCP server Chorus writes into claude `.mcp.json`, codex argv and opencode config exactly as `chorus-memory` is today (`mcpConfigCore.ts`). Tools: `list_peers()` → same-project sessions with title, agent, cwd/worktree, hook-bus state (working / needs-you / idle), age; `peer_summary(sessionId, n≤30)` → last *n* turns rendered from the peer's transcript (Chorus already takes `transcript_path` off the hook body in `contextUsage.ts`); `peer_terminal(sessionId, lines≤200)` → tail of the scrollback mirror (`scrollbackStore.ts`, already on disk); `send_message(sessionId, text)`.
- *Why MCP and not nodeterm's curl shim:* nodeterm needs shell shims because tmux sessions outlive its app and it retired its MCP bridge for that reason. Chorus's sessions are main-process-owned and die with it; MCP is the surface Chorus already injects, and it needs no PATH/sh on Windows.
- *Authorization:* reuse the per-session capability tokens from the Phase 4 hook bus; the MCP process gets its own session's token in env at launch (same channel as keys, never argv). Reads are scoped to **explicitly linked peers**, not "anything in the project" — nodeterm's rule that "a caller holding the token still cannot read a node it was never linked to" is the right default. Link = a per-pair toggle in the pane header / a `link` palette command; optionally a project-level "everyone in this project may read everyone" switch, off by default.
- *Message delivery:* write into the target PTY **only when the target is idle per the hook bus** (nodeterm gates on hook-idle and waits for a hook receipt); otherwise queue and deliver on the next `Stop`. Frame it as a plain-text card and mirror Claude Code's own inbound rules in the framing text: it is from another session not the user, it cannot approve anything, it does not change config, slash commands are text. Loop-throttle (identical text within a window dropped, per-sender cap). This is `session:write` — the same channel Task 5-3 uses for dictation — so the "no auto-Enter" safety rule needs an explicit exception *for messages only*, or messages arrive as a pasted line the peer must submit. Decide which; the doc's own answer (Claude Code starts a new turn when idle) argues for submit-on-idle.
- *Bounds (learned from Reddit's token complaint):* injected contract ≤ 6 lines (fold into `instructionsCore.ts` — "you may query linked peers with `peer_summary`; prefer the memory graph for anything older than the current turn"); default `n=15`; hard char caps per tool arg/result; never a "read everything" tool without an explicit `n`.
- *Vendors:* claude and codex transcript parsers already exist in Chorus (`contextUsageCore.ts` reads both); opencode via `opencode export` as nodeterm does, or terminal-tail only.
- *Relation to D39/§8:* this is **not** orchestration (no agent spawns or stops another) — it is read + notify between human-launched siblings, the same boundary Anthropic drew for `SendMessage`. Worth stating in the D-entry so §8 stays intact.
- *Privacy posture:* `agentEvents.ts`'s header promises only `hook_event_name` (+ now `transcript_path`) is read; `peer_summary` would render message text out of a transcript and hand it to another agent. That is a deliberate widening and needs its own note in the header, plus "linked peers only" as the bound.

**R2. Hook-answered permission prompts in the Attention Inbox.** (Fit: ⚠D — Task 4-2 / Phase-4-Overview say "no inline answering", grounded in Plan.md:303 "the app sees rendered PTY output, not a controllable command stream")
- nodeterm shows the premise is no longer true for Claude Code: the `PermissionRequest` hook can *hold* and then return `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"|"deny"}}}`. Its script writes the request to a pending file, POSTs status, polls for an `.answer` written by the Approve/Deny button (default 45 s), and on timeout prints nothing → Claude shows its normal prompt (fail-open). The payload carries `tool_name` + `tool_input`, so the inbox can show *what* is being approved — which answers 4-2's own objection ("answering a prompt you cannot see is worse than not offering to").
- *Cost of adopting:* directly contradicts `agentEvents.ts`'s "ALWAYS ANSWER, AND ANSWER FAST" rule (Chorus responds to hooks immediately so it never stalls the agent). A held hook stalls only the session that is *already* waiting on a human, so the rule survives if the hold applies to `PermissionRequest` alone with a hard ceiling. It also widens the read posture to `tool_name`/`tool_input` (never `prompt`). And it must be verified on **Windows** Claude Code — hook decision output is documented, but 4-2's whole table needs re-measuring anyway (roadmap note: authored at IpcChannel 86, now 97).
- *Recommendation:* raise as a council question when 4-2 is picked up, not a unilateral flip. The value is large: it is the single most-praised "notch" interaction in the threads ("take action directly from notch"), and it composes with the Fleet Switcher (D132/D156).

**R3. Subagent visibility via transcript files, not hook classification.** (Fit: P — D39 chip "N sub-agents running"; roadmap :354 says it may be unbuildable as specced because `SubagentStart/Stop` both classify to `working`)
- nodeterm sidesteps the classification problem: correlate `PreToolUse`/`PostToolUse` on the `Agent`/`Task` tool by `tool_use_id`, and tail `<session>/subagents/agent-<id>.jsonl` (paired `.meta.json`) for live subagent transcripts; async subagent ends show up as task-notification lines in the parent transcript. That is a read-only file tail, upstream of nothing in the bus — so it does not need to tap `handle()` before `record()`. Unblocks the D39 chip and could later feed R1's `peer_summary` for subagents.

**R4. Palette search over what panes printed.** (Fit: partial — Ctrl+K palette focuses by title; scrollback search is Phase 7)
- The most-repeated praise for keyboard use in both threads: "⌘K matches the node's title *and its visible output*, so you can find a pane by something it printed." Chorus has the scrollback mirror on disk already; matching the palette's session rows against the last N KB of each mirror is small and high-value. Pair with **Ctrl+1..9 focus** (named in Plan.md:173, not implemented) and a "focus next needs-attention" — both threads' #1 complaint about nodeterm was mouse dependence, and Chorus's tiled model can be fully keyboard-driven where a canvas can't.

**R5. Free session names from Claude's own title records.** (Fit: ⚠D — D18 "no LLM summarization")
- nodeterm doesn't call a model for names: it reads `custom-title` / `ai-title` records from the transcript tail (Claude Code writes them itself) and writes back with `/rename`. That is zero-cost and does not violate D18's *reason* (cost/keys) — it is a fallback beside OSC 0/2 titles, and it also gives R1's `list_peers` a human name. Also relevant: Claude Code's `--name` flag / `/rename` now defines the address a session answers to in native messaging; if Chorus ever bridges to that on WSL2, names matter.

**R6. Extend the subscription meter to Codex rollouts.** (Fit: S with gap — `subscriptionMeter.ts` reads only `~/.claude/projects`)
- Reddit user complaint on nodeterm: "usage stats only show for the default provider … I use claude, codex, and gemini". Chorus has the same gap. nodeterm's Codex parser reads `last_token_usage.input_tokens` + `model_context_window` from `~/.codex/sessions/YYYY/MM/DD/rollout-*-<id>.jsonl`. Same file family F64 (codex resume) needs — one locator would serve both.

### Tier 2 — plan these; they need a decision or a phase to land in

**R7. Multiple Claude identities via `CLAUDE_CONFIG_DIR` per profile.** (Fit: N — `credential_profiles` covers API keys only; `env.ts` allow-list is closed by design)
- nodeterm's mechanism is just an env var pointing at `<userData>/claude-accounts/<id>`, plus stripping `ANTHROPIC_API_KEY`/`CLAUDE_CODE_OAUTH_TOKEN` from the child env and letting the CLI own `/login`; hooks and skills are re-installed per account dir. Demand in the threads is real ("multiple Max 20x plans", "profiles of the same account for different folders"). For Chorus it is a **subscription** identity type in `credential_profiles`, an imposed value (like `TERM`, D54) not an allow-listed copy, and per-profile hook/MCP injection. Note the interaction with R1: transcript readers become account-scoped.

**R8. Kanban of live sessions → fold into Mission Control (Phase 8).** (Fit: P — D41)
- nodeterm's board is nothing more than `{columns, assignments[{sessionId, columnId}]}` persisted with the project; cards *are* live sessions, dragging a card never touches the process, and agents may `assign` their own card. Worth recording in the Mission Control spec as the minimum viable board — Chorus already has `dispatches`/`agent_turns` telemetry that could drive columns.

**R9. Notes as agent-readable context, through the graph.** (Fit: N for sticky notes; S for the graph)
- nodeterm's sticky notes are agent-writable (`sticky --append`, verified callers only, byline shows author) and readable by linked agents. Chorus should not add a note pane; it should add a "pin a note to this project" affordance that writes a `:Memory` node with `source=user` into the existing graph, so every agent already sees it via the injected "query before assuming" contract. Cheap, and it gives the user a way to steer all agents without typing into each pane.

**R10. Layout undo/redo.** (Fit: N; cheap given D9's owned split-tree JSON)
- Debounced snapshots of the layout tree, past/future stacks, per project. Only worth doing when someone loses a layout to a mis-drag; note for Phase 7.

**R11. Commit-message drafting from the staged diff.** (Fit: N; §8 keeps commit/merge human, and Chorus has no git write ops)
- nodeterm runs `claude -p --permission-mode plan` (or `codex exec --sandbox read-only`) over a diff water-filled to 200 KB, output capped, 120 s kill. If ever, it belongs in the worktree panel as "draft message → clipboard", never as a commit button. Low priority.

### Tier 3 — do not copy, with reasons

- **Infinite canvas.** The threads are split ("the canvas actually clicked for me" vs "I absolutely HATE zoom in and out on every little thing"; "now I have to remember where my terminals are in a canvas?"). D9/D20 (owned split tree, Focus+Filmstrip) stand; keyboard-first tiling is Chorus's differentiator, not a deficit.
- **Agents driving the layout (canvas-control CLI, `spawn-team`, `--after` DAG).** §8 bars orchestration roles in v1 and D39 says the sanctioned path is one Chorus session per top-level agent. Claude Code's own agent teams / background sessions now cover the spawn-and-supervise case natively; Chorus should attach to those (R1 lists them as peers) rather than build a scheduler. Revisit only inside Phase 8.
- **tmux persistence / SSH / mobile / server edition / team presence.** §8 bars cloud, mobile, macOS/Linux; Windows has no tmux. Chorus's Phase 4a `--resume` continuity is the right shape for its architecture. (nodeterm's reboot story is weaker than advertised: "all the terminals came back but I had to restart the claude sessions".)
- **Notch HUD.** macOS-only; the Fleet Switcher (D132/D156) is the Windows-appropriate equivalent and is already owed placement.
- **Marketing the ADHD angle.** Called out as unevidenced in both threads; keep the mechanics, drop the label.

---

## 4. Lessons from the criticism worth carrying forward

1. **Bounded, lazy reads or the token bill shows up on day one.** (`summary -n 15`, char caps, tiny injected contract.)
2. **Idle-gate anything you inject into a peer, and tell the agent it's not a task** — Gemini launched an investigation off a link notice; Chorus's message framing must say "no action needed unless asked".
3. **Fail-open on every hook path** — a missing hook script "bricks every Claude session"; a held approval times out to the CLI's own prompt.
4. **A badge that sticks on a finished pane is a shipped failure** — nodeterm's normaliser deliberately no-ops unknown notification types; Chorus's `NEEDS_YOU_EVENTS` map should keep that discipline.
5. **Ctrl+W must not close a pane** — it is bash's delete-word; first bug report in the thread. Check Chorus's bindings before Task 5-3 adds a global hotkey.
6. **Keyboard-only is table stakes for a terminal tool** — the loudest, most repeated feedback across ~290 comments.

## 5. Suggested next steps (for Matthew to decide)

- Record R1 as a candidate feature ("Peer context & messaging", Windows-native, cross-vendor) and decide whether it precedes or follows the Phase 4 remainder. It reuses the hook bus, MCP injection, transcript parsers and scrollback mirror; the new code is one MCP server, a link toggle, and idle-gated `session:write`.
- Put R2 (hook-answered approvals) on the council docket for the Task 4-2 kickoff with the two objections above written down.
- R3, R4, R6 are small and can ride existing phases (D39 chip; palette; subscription meter).
- R7 (identities) needs a D-entry because it touches the env allow-list's stated invariant.

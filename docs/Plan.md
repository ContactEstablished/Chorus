# AgentDesk — Master Development Plan v2.1
### Merged from Claude plan v1 + GPT 5.6 plan + UI/UX principles · 2026-07-17

A local-first, BYOK desktop command center for running multiple coding agents (Claude Code, Codex CLI, Gemini CLI, Aider, OpenCode, direct API sessions) in parallel panes and windows, organized by project, with git-worktree isolation, push-to-talk voice, attention notifications, and one-click Neo4j project memory wired to agents via MCP.

**Locked decisions:** Electron + Vue 3 + TypeScript · Windows-only v1 · native Windows CLI runtime default, WSL2 optional per profile.

---

## 1. Product Model

A project contains multiple isolated agent sessions:

```text
Purchase Request Application (project tab)
├── Agent 1 — Claude Code · Fable 5 · Deep     · worktree: architecture
├── Agent 2 — Codex CLI  · gpt-5.x · high      · worktree: implementation
├── Agent 3 — Claude Code · Sonnet · Balanced  · worktree: tests
├── Agent 4 — API chat   · OpenRouter/GLM      · read-only repo
└── Shared project memory — Neo4j (Docker) via MCP
```

Every session record = provider + auth profile + model + effort + runtime (native/wsl) + workspace mode (worktree/current-tree/read-only) + role instruction + optional skills + memory access + notification policy. CLI agents and API agents are **different execution modes behind one adapter interface**.

### Product principles
1. **Local first** — repos, transcripts, credentials stay on the machine.
2. **Bring your own agent** — every engine is an adapter; official auth only (no scraping subscription login flows).
3. **Isolation by default** — parallel *writing* agents get git worktrees.
4. **Human-controlled integration** — agents propose; you approve merges/pushes/destructive ops.
5. **Memory with provenance** — every durable fact records its source.
6. **Capabilities, not provider names** — UI is driven by `AgentCapabilities`, never `if (agent === 'claude')`.
7. **No secret leakage** — keys never touch logs, transcripts, args, or repo files.
8. **Recoverability** — sessions, worktrees, and containers recover cleanly after crashes.

---

## 2. Tech Stack (locked)

| Layer | Choice |
|---|---|
| Shell | Electron 33+ |
| UI | Vue 3 + TypeScript + Vite + Pinia |
| Styling | Tailwind CSS (+ headless components as needed) |
| Terminal | xterm.js (+ fit, search, webgl addons) |
| PTY | node-pty (ConPTY on Windows) |
| Pane layout | splitpanes or custom binary split tree (serialize to JSON) |
| DB | SQLite via better-sqlite3 (+ Drizzle if you want typed queries) |
| Validation | Zod on every IPC boundary |
| Secrets | Electron safeStorage (DPAPI) — blobs in SQLite |
| Git | native git CLI through a controlled process adapter; worktrees |
| Docker | dockerode |
| Neo4j | neo4j-driver (JS) |
| Voice | whisper.cpp local (default) / OpenAI-Deepgram cloud (toggle) |
| PTT hook | uiohook-napi (true keydown/keyup) |
| Logging | pino (file-rotated; secret-redacting serializer) |
| Testing | Vitest + Playwright (terminal ANSI/resize/kill-tree tests) |
| Packaging | electron-builder (NSIS) + electron-updater |

.NET/Avalonia alternative retired — see v1 plan Appendix A if ever revisited.

---

## 3. Architecture

```text
┌─────────────────────────── Renderer (Vue 3) ───────────────────────────┐
│ Project tabs → Pane grid → TerminalPane (xterm) | ApiChatPane          │
│ LaunchDialog (capability-driven) · Settings · Notification center      │
│ Worktree/diff summary view · Memory status chip · Mic overlay          │
└──────────────────────────────┬─────────────────────────────────────────┘
                    typed IPC (contextBridge + Zod)
┌──────────────────────────────▼─────────────────────────────────────────┐
│ Main process — Local Agent Runtime                                     │
│ SessionManager (owns sessions; panes are attachable views)             │
│ PtyManager · AdapterRegistry · CredentialVault · CliDetection          │
│ GitWorktreeManager · SkillManager · NotificationEngine (+hook listener)│
│ VoiceService · Neo4jProvisioner · EventBus (append-only agent_events)  │
└───────┬───────────────────┬───────────────────────┬────────────────────┘
   CLI adapters        API adapters             Storage
   claude-code, codex, anthropic, openai,      SQLite · safeStorage
   gemini, aider,      openrouter/openai-      transcripts on disk
   opencode            compat, ollama          Neo4j · git worktrees
```

**Non-negotiable:** sessions live in main. A `PtySession` (PTY handle + ~50k-line ring buffer + state) is owned by SessionManager; windows/panes attach/detach by `sessionId`. This makes pop-out windows, tab moves, and renderer crashes non-events. Renderer never spawns processes; all launches go through validated `ProcessLaunchRequest` (executable resolved by main, args validated, cwd validated).

---

## 4. Adapter Abstraction

```ts
export interface AgentAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly executionMode: 'pty' | 'api';

  detectInstallation(): Promise<InstallationStatus>;       // found? version? authed?
  getAuthMethods(): AuthMethodDefinition[];                // subscription | api_key
  getModels(cred?: CredentialProfile): Promise<ModelInfo[]>; // static or live
  getEffortOptions(modelId: string): EffortOption[];
  getCapabilities(): AgentCapabilities;

  buildLaunch(spec: LaunchSpec): ProcessLaunchRequest;     // pty mode
  startApiSession?(spec: LaunchSpec): ApiSessionHandle;    // api mode
  resumeSession?(spec: ResumeSpec): ProcessLaunchRequest;  // e.g. claude --resume
  detectState(chunk: string, current: SessionState): SessionState;
  writeMcpConfig?(project: Project, servers: McpServer[]): void;
  writeHooks?(project: Project, listenerUrl: string): void; // Claude Code only
}

interface AgentCapabilities {
  interactiveTerminal: boolean; sessionResume: boolean;
  reasoningEffort: boolean; subscriptionLogin: boolean; apiKey: boolean;
  mcp: boolean; hooks: boolean; skills: boolean; worktreeSafe: boolean;
}
```

LaunchDialog renders only what the selected adapter's capabilities allow.

### Session state machine & events

```ts
type SessionStatus = 'created'|'preparing'|'starting'|'running'
  |'waiting-for-user'|'waiting-for-permission'|'idle'
  |'completed'|'failed'|'stopped'|'archived';
```

All transitions and notable moments append to `agent_events` (id, sessionId, type, ts, payload): `session.started`, `status.changed`, `agent.requested.permission`, `agent.requested.input`, `files.changed`, `session.completed`, `session.failed`. Notifications, UI badges, and future automation all subscribe to this bus — nothing reads PTY output directly except adapters.

### Concrete mappings (verify flags at build time — CLIs move fast)
- **Claude Code** — subscription: launch `claude` with no key env (uses Max/Pro login). API: inject `ANTHROPIC_API_KEY` (+ `ANTHROPIC_BASE_URL` for LiteLLM/proxy). Model: `--model`. Resume: `--resume/--continue`. Effort ↦ model tier + thinking conventions. MCP: project `.mcp.json`. Hooks: `.claude/settings.json`.
- **Codex CLI** — ChatGPT sign-in or `OPENAI_API_KEY`. Model `-m`; effort ↦ `model_reasoning_effort` (minimal/low/medium/high) via generated `~/.codex/config.toml` profile per Launch Profile. MCP via `mcp_servers` in config.toml.
- **OpenAI-compatible route** — OpenRouter / your LiteLLM proxy → council models (Kimi, GLM, Qwen, DeepSeek) through Aider (`--openai-api-base`) or Codex custom providers, or the built-in api-chat pane.
- **Gemini CLI** — `GEMINI_API_KEY` or Google login, `-m`.
- **Aider** — pure API-key workhorse, `--model provider/name`.
- **Ollama** — local, zero-key, OpenAI-compat adapter.
- **api-chat (built-in pane)** — direct streaming SDK chat, non-PTY. Phase 3.

### Effort normalization
One app-level slider — **Fast / Balanced / Deep / Max** — mapped per adapter; raw override always available in `extra_args`.

---

## 5. Git Isolation & Worktrees  *(adopted from GPT plan)*

Parallel writing agents must not share a working tree.

```text
C:\Source\Bryk                      ← main repo
C:\Source\.agentdesk\Bryk\
├── architecture/   ├── impl/   ├── tests/     ← one worktree per session
```

- Branch convention: `agentdesk/{project-slug}/{role}/{short-session-id}`
- Workspace modes at launch: **current working tree** (default for a single agent) · **new isolated worktree** (default when a 2nd writing agent launches in the same repo) · existing worktree · read-only.
- Flow: verify repo clean-ish → choose base branch → create branch+worktree → launch agent with worktree as cwd → watch file changes → diff summary in pane header → user commits/merges/discards → remove worktree on archive.
- **Never auto-merge in v1.** Crash recovery: on boot, reconcile `worktrees` table against `git worktree list`; offer cleanup for orphans.
- Note: worktrees share the repo's object store — cheap and fast, but tooling that assumes `.git` is a directory (rare) can hiccup; test with your .NET solutions early.

---

## 6. Credentials, Providers, BYOK

- `credential_profiles`: multiple keys per provider (per-client billing separation — Perficient vs Upwork vs personal), labeled, DPAPI-encrypted via safeStorage, decrypted only in main at launch, injected as **env vars into the child PTY** (never CLI args — visible in process lists), redacted from transcripts/logs via pino serializer + regex scrub on known key shapes.
- `model_catalog` cached per provider with refresh ("list models" doubles as the **Test key** button). Discovery hierarchy: provider list API → CLI model query → versioned bundled catalog → free-text custom model ID.
- Auth types kept open for growth: `cli-managed | api-key | oauth | azure-identity | aws-profile | local-endpoint` (Azure OpenAI via Entra and Bedrock slot in later without schema changes).
- Subscription auth status surfaced by `detectInstallation()` (e.g. parse `claude --version` / auth state) — show "logged in as…" or "needs login" chips in settings.

---

## 7. Terminal Grid, Tabs, Windows

Binary split tree per project (cap ~12–16 panes), serialized to `pane_layouts`. Pane header: agent icon · model · effort badge · status dot (running/waiting/done/error) · worktree branch · restart/kill/pop-out/duplicate-config/copy-transcript. Electron hardening everywhere: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, narrow Zod-validated preload API only. Pop-out = new BrowserWindow attaching to the same sessionId. Scrollback 10k lines in xterm + full transcript mirrored to disk (size-capped). Keyboard: `Ctrl+T` launch, `Ctrl+Shift+D` split, `Ctrl+1..9` focus, `Ctrl+Tab` projects, configurable global PTT.

Windows test matrix (from GPT plan, keep as a Playwright/CI checklist): PowerShell 7, Windows PowerShell, Git Bash, WSL, native claude/codex, paths with spaces, long paths, process-tree kill, Ctrl+C, ConPTY resize, Unicode/emoji, heavy ANSI.

---

## 7b. UI/UX Design Principles  *(deliberate departures from BridgeSpace)*

**Core thesis: attention is the scarce resource.** BridgeSpace optimizes for the demo (16 live terminals); AgentDesk optimizes for the operator — surface only what needs you, compress everything else to status.

1. **Focus + Filmstrip is the default layout.** One large focused pane; all other sessions collapse to compact status cards along an edge (state, elapsed, last meaningful event, running cost). Click a card to swap it into focus. The equal-split grid remains an alternate view, not the default.
2. **Attention Inbox ("Needs You").** An ordered queue of sessions in `waiting-for-user` / `waiting-for-permission`, fed by the event bus. Navigate with j/k, answer inline, auto-advance to the next. Triage, don't scan.
3. **Three color channels, never mixed:** hue = project (tab color bleeds into pane borders) · icon = provider/agent · **state = dot + subtle glow, always the most salient channel** (a waiting pane must pull the eye peripherally). Shape + color together for colorblind safety. One excellent dark theme + one light; no theme zoo.
4. **Event timeline over Warp blocks.** Agent TUIs (alt-screen) defeat command-block UIs. Instead: a collapsible per-session timeline sidebar rendered from `agent_events` — files changed, permissions requested, commits, status transitions — structured, clickable history beside the raw terminal.
5. **Mission-control overlay.** Small always-on-top strip (sibling of the mic overlay): one status dot per active agent across all projects, visible while AgentDesk sits behind Visual Studio. Click dot → focus pane.
6. **Command palette (`Ctrl+K`)** for everything: launch profile, jump to pane/project, provision memory, toggle overlay, run skill.
7. **Glanceability details:** auto-title sessions from first-prompt summary · project tab badges ("2 waiting") · per-project **and per-credential** cost rollups in the header (multi-client billing) · visible target ring on the pane that will receive voice dictation *before* speaking · launch dialog defaults to last-used profile + recent cwd list.

---

## 8. Notifications

Detection tiers, best signal first:
1. **Claude Code hooks** — `Notification` + `Stop` hooks written into `.claude/settings.json` POSTing to a localhost listener (127.0.0.1, random port, shared-secret header). Explicit "waiting for permission/input" and "finished" events — zero guessing.
2. **Process exit** — exit code ⇒ completed/failed. Universal.
3. **Per-adapter output heuristics** — approval-prompt regexes + idle timer (no output N seconds while running ⇒ waiting-for-user, low confidence).

Policy (per profile, with sane defaults): always notify on waiting-for-user / waiting-for-permission / failed; notify on completion only if runtime > 2 min; never for the focused pane. Delivery: OS toast (click focuses the exact pane) · tray badge count · in-app notification center · optional per-event sounds. Later: webhook out (your Hermes/Telegram bridge slots here).

---

## 9. Voice (push-to-talk)

Hold key (uiohook keydown) → capture 16 kHz mono → release → transcribe → insert into focused pane's stdin (**no auto-Enter by default**; auto-send is a setting). Local default: whisper.cpp `small.en`, models downloaded on first use to `%APPDATA%`. Cloud toggle: OpenAI/Deepgram STT with the user's own vault key. Floating always-on-top mic overlay; Esc cancels. Phase-2 voice: command grammar before dictation fallback ("switch to TaxApp", "restart pane 2"); TTS read-back deferred.

---

## 10. Neo4j Project Memory

Modes per project: **none** · local Docker (default) · existing Neo4j connection · AuraDB. One database per project by default (simple isolation, easy destroy); a shared cross-project graph is a later option.

**Provision flow (one click):** dockerode preflight (Docker Desktop up?) → run `neo4j:5-community` named `agentdesk-neo4j-<slug>`, free ports auto-allocated and stored, named volume, generated password → vault, APOC plugin, heap capped 512m–1g → seed schema → write MCP config into each CLI (`mcp-neo4j-cypher` via uvx/npx pointing at `bolt://localhost:<port>`) → drop a `MEMORY.md`/`CLAUDE.md` usage snippet ("query before assuming; write Decisions after milestones") → status chip on project tab (start/stop/browser link/destroy-with-confirm).

**Schema (template, pluggable — port the TaxApp graph as default):**
Nodes: Project, Repository, Commit, File, Namespace, Class, Interface, Method, DatabaseEntity, Task, Decision, AgentSession, Observation/Fact, Risk, Test.
Rels: `(Repository)-[:CONTAINS]->(File)-[:DECLARES]->(Class)-[:HAS_METHOD]->(Method)-[:CALLS]->(Method)`, `(Commit)-[:MODIFIED]->(File)`, `(AgentSession)-[:PRODUCED]->(Observation)-[:SUPPORTED_BY]->(File)`, `(Decision)-[:APPLIES_TO]->(Project)`. Uniqueness on File.path / Class.fqn; fulltext on Fact.text.

**Provenance on every durable memory** *(adopted from GPT plan)*:

```ts
interface MemoryRecord {
  type: 'fact'|'decision'|'observation'|'summary'|'question';
  content: string;
  sourceType: 'file'|'git-commit'|'agent-session'|'user'|'external-document';
  sourceReference: string; agentSessionId?: string;
  confidence: number; validFrom: string; supersededBy?: string;
}
```

Agents write via MCP directly in v1 (simplest); revisit app-mediated writes if graph quality degrades. Background **index-codebase** skill walks the repo → upserts File/Class/Method nodes (structural metadata only; no source chunks in v1). Refresh: manual + optional post-commit.

---

## 11. Skills / Automations

Provider-neutral folder format *(GPT's yaml, simplified)*:

```text
skills/<id>/skill.yaml + instructions.md + scripts/ + prompts/
```

`skill.yaml`: id, name, compatibleRuntimes (claude-code/codex/api), requiredTools, declared permissions, inputs. Two kinds: **agent skills** (inject instructions/prompts into a session) and **app automations** (scripts the app itself runs — these are where app-level permission enforcement is real). Launch set: provision-neo4j, index-codebase, backup-graph, repo-orientation, summarize-session. Grow toward: implement-issue, fix-failing-tests, review-pr.

---

## 12. Permissions — the honest version

The GPT plan's app-level command interceptor **cannot be reliably enforced on PTY agents**: Claude Code and Codex run their own tools inside their own process; the app sees rendered output, not a controllable command stream. So:

- **For CLI agents:** permission = *configuring the CLI's native mode per Launch Profile* (Claude Code plan / accept-edits / bypass; Codex approval modes) + worktree/read-only workspace modes as the real blast-radius control. Surface the chosen mode prominently on the pane header so it's always a deliberate choice.
- **For app automations & api-chat tool use:** a genuine broker is feasible — allowlisted commands per skill.yaml, approval prompts for environment-changing ops, hard blocks on push/deploy/rm-rf/credential access.
- Keep GPT's command-class taxonomy (safe-inspection / development / environment-changing / high-risk) as the vocabulary for both.

---

## 13. Data Model (SQLite)

```sql
projects            (id, name, root_path, color, memory_mode, neo4j_container_id,
                     neo4j_bolt_port, neo4j_http_port, created_at)
credential_profiles (id, provider_id, label, encrypted_blob, created_at, last_verified_at)
provider_configs    (id, name, kind, auth_mode, base_url, enabled)
model_catalog       (provider_id, model_id, display_name, tier, refreshed_at)
launch_profiles     (id, name, provider_id, agent, runtime /* native|wsl */,
                     model, effort, permission_mode, workspace_mode,
                     extra_args, env_json, default_cwd, mcp_config_json, icon, color)
sessions            (id, project_id, profile_id, title, cwd, worktree_id, status,
                     started_at, ended_at, pane_slot, transcript_path)
agent_events        (id, session_id, type, ts, payload_json)        -- append-only bus
worktrees           (id, project_id, session_id, path, branch, base_branch, status)
pane_layouts        (project_id, layout_json)
skills              (id, path, manifest_json, enabled)
notifications       (id, session_id, kind, message, created_at, acked)
usage_records       (id, session_id, provider_id, tokens_in, tokens_out, cost_est, ts)
settings            (key, value)
schema_migrations   (version, applied_at)
```

Disk: transcripts, logs, worktrees, skill files, whisper models. Neo4j: semantic/code/memory graph only.

---

## 14. Roadmap

**Phase 0 — Today (3–4 hrs):** repo + electron-vite Vue-TS scaffold → CLI detection (claude/codex/git/docker/node on PATH) → one window, one node-pty session running `claude`, xterm attached, resize+input via typed IPC → **SessionManager abstraction before anything else** → persist project + layout → toast on process exit.
*Milestone: Claude Code and Codex running side-by-side in your own app, restart-safe.*

**Phase 1 — Grid + Projects (d2–3):** split tree, project tabs, launch dialog, SQLite persistence + restore, status dots from exit codes, kill process trees cleanly. **Focus + Filmstrip as the default layout** (grid as alternate view); `Ctrl+K` command palette skeleton; session auto-titling.

**Phase 2 — Worktrees (d3–4):** GitWorktreeManager, workspace modes in launch dialog, auto-worktree when a 2nd writing agent targets the same repo, diff summary, cleanup + crash reconciliation.

**Phase 3 — BYOK + Adapters (d4–6):** vault, provider/credential settings, model catalog + test-key, Claude Code + Codex + OpenAI-compat adapters with capabilities, effort mapping, saved profiles. Begin per-credential usage capture (`usage_records`).

**Phase 4 — Notifications (d6–7):** hook listener + hook injection, event bus, policies, toasts→focus pane, tray badge, notification center. **Attention Inbox ("Needs You" queue)** + project tab badges + per-session event timeline sidebar (all read from the same bus).

**Phase 5 — Voice (wk 2):** uiohook PTT, whisper.cpp + cloud toggle, mic overlay, injection with **target ring on the receiving pane**. **Mission-control overlay** (shares the always-on-top window plumbing with the mic overlay).

**Phase 6 — Neo4j Memory + Skills (wk 2):** provisioner, schema templates + provenance, MCP wiring, index-codebase skill, lifecycle UI.

**Phase 7 — Polish & Ship:** pop-out windows, scrollback search, transcript export, **cost rollups per project/credential in headers**, secret-redaction audit, NSIS installer + updater, crash recovery pass, Windows terminal test matrix in CI.

**Horizon (explicitly deferred):** task board / card-dispatch, orchestration roles (Coordinator/Implementer/Reviewer), automation scheduler, built-in editor & diff viewer, TTS, wake word, cloud sync, plugin marketplace, mobile companion.

---

## 15. ADRs to write on day one

001 Electron runtime · 002 Vue 3 + TS renderer · 003 PTY-based CLI integration (sessions live in main) · 004 Adapter + capability architecture · 005 SQLite as app state source of truth · 006 safeStorage/DPAPI secrets · 007 Worktrees for agent isolation · 008 Neo4j as optional per-project memory with provenance · 009 CLI-native permission modes; app broker only for automations · 010 Local-first · 011 Append-only agent event bus · 012 Provider-neutral skill format

---

## 16. Repo structure

```text
agentdesk/
├─ src/main/        adapters/ services/(sessionManager, ptyManager, vault,
│                   worktrees, neo4jProvisioner, voice, notify, cliDetect,
│                   hooksListener, eventBus) db/(migrations, repos)
├─ src/preload/     typed contextBridge API (Zod-validated)
├─ src/renderer/    Vue app: views/ components/(PaneGrid, TerminalPane,
│                   LaunchDialog, WorktreePanel, Settings, NotificationCenter)
├─ src/shared/      types.ts (IPC contracts, LaunchSpec, SessionStatus, events)
├─ skills/          provision-neo4j/ index-codebase/ ...
├─ docs/adr/        ADR-001..012
├─ CLAUDE.md        conventions: sessions-in-main, IPC typing, "verify CLI flags
│                   against current docs before hardcoding", no secrets in logs
└─ PLAN.md          this file
```

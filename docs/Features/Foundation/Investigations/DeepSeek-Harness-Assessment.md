# DeepSeek Harness Assessment — can `dsh` back a "DeepSeek" launch card?

**Date:** 2026-08-19 · **Requested by:** Matthew · **Outcome:** assessment recorded as **D175**; no code built. This document is the full findings-and-recommendations record so the work can be picked up later without re-research.

**Question asked:** DeepSeek released the **DeepSeek Harness** (`github.com/deepseek-ai/deepseek-harness`, npm `@deepseek-ai/dsh`) as their preferred agentic-coding platform. Can Chorus add a "DeepSeek" button (like Claude/Codex/Grok) that opens an instance of the harness in a pane — or is that a monumental change? Matthew already runs the DeepSeek model through OpenCode and wanted the cost/benefit before committing.

---

## 1. What the harness actually is (verified against the repo, default branch `master`, pushed 2026-08-19)

- `@deepseek-ai/dsh` **v0.1.0-rc.8** — *developer preview, breaking changes expected*. Cordis plugin monorepo ("everything is a plugin"): `apps/cli`, `apps/web`, ~50 packages incl. `sdk`, `acp`, `api`, `terminal`, `mcp`.
- **There is no terminal TUI or REPL.** The interactive experience is a **local web server + browser UI**: `dsh web` (alias of `--profile web`), default `http://127.0.0.1:3080`, `--no-open` to suppress the browser. The CLI otherwise only boots profiles (`dsh --profile <name>`, from `$DSH_HOME/profiles/<name>`), manages plugins (forwards to pnpm), and runs **one-shot headless jobs** (`dsh --profile headless "job"` — prints the answer and exits).
- Web server config (`@deepseek-ai/dsh-host-webserver`): `host: '127.0.0.1' | '0.0.0.0'`, `port: number` with **`0` = OS-assigned**; the server **prints its URL on stdout** at startup. No single-instance lock documented.
- Providers: DeepSeek adapter keys via env — **`DEEPSEEK_API_KEY`** by default (`apiKeyEnv` configurable), `$DEEPSEEK_BASE_URL` override; a `pi-ai` provider speaks OpenAI-compatible protocols (OpenRouter reachable via `baseURL` + compat profile).
- Backend protocol: internal HTTP RPC (`POST /api/<ns>/<method>`), **not documented as stable for third-party clients**. **No auth on the localhost server is documented.**
- **Windows support: undocumented.** Untested here — `dsh` is not installed on this machine.

**Consequence:** "spawn it in a PTY pane like the other agents" cannot work. A pane running `dsh web` would show server logs while the user works in an external browser. Any faithful integration is a *different execution mode*, not a sixth PTY adapter.

## 2. What Chorus offers as seams (verified in-tree, 2026-08-19)

- `ExecutionMode = 'pty' | 'api'` already exists (`src/main/adapters/types.ts:14`); `AgentAdapter = PtyAgentAdapter | ApiAgentAdapter` (`:912`), `isPtyAdapter` is a discriminant check (`:914`). `'api'` is dormant (zero registry implementations), but the union + guards mean the type layer anticipated non-PTY agents. The mode is also a **wire enum** (`adapterDescriptorSchema`, `src/shared/ipc.ts:2631`) — any widening happens in both places.
- **SessionManager has no non-PTY branch**: `spawn()` throws for non-PTY adapters (`sessionManager.ts:761-763`) and its session record hard-holds `pty: pty.IPty` (`:88-93`). This is where the real work of any web-mode agent lives.
- `composeChildEnv` (`src/main/adapters/env.ts:131`) is **pure and not PTY-specific** — reusable for a `child_process` spawn.
- Panes have **no type discriminator**: `LayoutLeaf = { type: 'leaf'; sessionId }` (`src/shared/layout.ts:18`) and `LayoutRenderer.vue:46-53` mounts `TerminalPane` for every leaf. The session's agent kind → executionMode is the natural derived discriminator. The main window currently has **`webviewTag` disabled** (`src/main/index.ts:233-235`).
- The **id = CLI-name convention is convention only**: `DETECTED_TOOLS` entries answer through their own adapter's `detectInstallation()` (`cliDetect.ts:150-158`), and `resolveCli`/`probeCli` take any string — an adapter may probe/launch a binary that differs from its id.
- **OpenCode is already a shipped adapter** (D90) and already pins a model per launch: `buildLaunch` emits top-level `-m <qualified model>` from `spec.route.modelId` (`opencode.ts:198-230`, D4-verified); `qualifyModel` (`:293-312`) maps by base-URL host (only `openrouter.ai → 'openrouter'` today); `adapters.test.ts:521` verifies `deepseek/deepseek-v4-pro → openrouter/deepseek/deepseek-v4-pro`. Per-launch model choice is already in the dialog (rank-0 `modelChoice`, `LaunchDialog.vue:156/:682/:925`).
- Credentials force a **per-kind provider row**: `resolveCredential` refuses when `provider.adapterType !== harness` (`ipc.ts:953`, "Blocker B", deliberate) — a new kind never shares the opencode row. The Settings provider form is `adapter:list`-driven, so a new registry entry appears there automatically.
- Adding a PTY agent kind is a worked recipe: **commit `9740382`** (grok, 14 files, +623/−20).

## 3. Plan A (S–M, ~one session): "DeepSeek" card that launches the OpenCode CLI pinned to a DeepSeek model

A sixth registry entry `deepseek` (`displayName: 'DeepSeek'`, `executionMode: 'pty'`) whose `detectInstallation()` returns `probeCli('opencode')` and whose `buildLaunch` calls `resolveCli('opencode')` — everything else (secret injection, allow-list env, scrubbing, layout, filmstrip, attach/restore, worktrees) inherited unchanged because it *is* a PTY agent.

- **Key routing — two sub-routes, both riding the existing `route.modelId → -m` path:**
  - **A-direct (Matthew's choice, 2026-08-19):** provider row `adapter_type='deepseek'`, `base_url=https://api.deepseek.com`, adapter default `requiredEnvVar: 'DEEPSEEK_API_KEY'`. Needs **one evidence-gated addition** to the host→provider map near `qualifyModel` (`opencode.ts:293-312`): `api.deepseek.com → 'deepseek'`, verified at implementation time by running `opencode models deepseek` with the key set (the map's own comment demands measurement; CLAUDE.md forbids trusting remembered CLI flags). Model-catalog dropdown works iff DeepSeek's OpenAI-compatible `/models` answers — one curl to confirm.
  - **A-openrouter (fallback, already verified end-to-end today):** provider row `adapter_type='deepseek'`, `base_url=https://openrouter.ai/api/v1`, env-var override `OPENROUTER_API_KEY` (provider override beats adapter default — `resolveEnvVarName`, `env.ts:184`). Zero `qualifyModel` changes.
- **File-level checklist** (mirrors `9740382`): `shared/ipc.ts:849` schema + `adapters/deepseek.ts` (new, model on `grok.ts` — `AdapterAuthoring.md` is stale) + `registry.ts:40` + `cliDetect.ts:76` `DETECTED_TOOLS` + compiler-walked `Record<AgentKind,…>` sites (`notifications.ts:11`, `palette/commands.ts:45`, `LaunchDialog.vue:540` tile `ds`, `FilmstripRenderer.vue:77,89`, `TerminalPane.vue:32,41`) + `adapters.test.ts` fixtures (parity test `:804` and capability-honesty auto-cover) + README + roadmap decision. No migration (`sessions.agent` is unconstrained TEXT), no new IPC, no new deps.
- **Capabilities:** copy opencode's measured set (same binary); MCP may reuse `OPENCODE_MCP` with a delegating `writeMcpConfig` under a distinct filename (`deepseek.json`) to avoid the documented shared-file clobber (`opencode.ts:180-188`) — or `null` first commit. `USER_ROW_MARKER` and context-usage parsing: omit (unmeasured).
- **Accepted trades (agreed 2026-08-19):** the card's version line reads `opencode <version>` and the pane opens the OpenCode TUI (honest — that's the binary that runs). **Both cards stay visible** — DeepSeek pinned, OpenCode free-choice. New provider row means entering a key even though an opencode row exists (Blocker B stays; do not weaken).
- **Risks:** opencode 1.18.8→1.18.18 flag drift (re-probe `-m`, and remember `-c` is `--continue`, not `--config` — `opencode.ts:29-33`); native `deepseek` provider gating in opencode unverified on this machine (A-openrouter is the verified fallback).
- **Zero-code stopgap that works today:** the existing OpenCode card + rank-0 model picker already runs DeepSeek in a pane; only the branded button is missing.

## 4. Plan B (L, ~3–5 sessions after a gate): embedded harness web pane

Widen `ExecutionMode` with `'webapp'`; `WebAppAgentAdapter` with `buildServerLaunch(spec) → { executable, args, cwd, envAdditions, secretEnv, readyPattern, readyTimeoutMs }`; main spawns `dsh web --no-open` (config `port: 0`) via `child_process` with `composeChildEnv` output, parses the URL from stdout, exposes it via one new IPC read; a new `WebViewPane.vue` renders it; `LayoutRenderer.vue` branches per leaf on the session's executionMode.

- **The L item is SessionManager**: either a sibling `WebAppSessionManager` sharing session rows/status vocabulary (every one-manager consumer — restore, `session:restart`, kill/locks, attach, notifications — learns the fork) or an internal `PtySession | WebSession` union (fewer callers, more narrowing). **Sessions-live-in-main survives either way**; the pane stays a view on a sessionId.
- **Lifecycle:** ready-timeout → `exited`; crash → same exit path; kill must reap the **process tree** on Windows (`taskkill /PID /T /F` or spawn the resolved binary directly — npm shims orphan grandchildren); restore gets a **new** port each relaunch (port 0), pane re-reads the URL.
- **Renderer/security:** pragmatic call is `<webview>` in a dedicated partition + an `app.on('web-contents-created')` handler denying `window.open` and navigation off `http://127.0.0.1:<port>`, no node integration — enabling `webviewTag` is a deliberate posture change (alternative: main-owned `WebContentsView` with bounds-sync IPC against splitpanes drags and z-order fights with the voice overlay). New invariants: pane loads only the origin parsed from the server's own stdout; server child dies with session/app; **no dsh stdout beyond the ready-line parse ever reaches a log** (no PTY scrubber exists on this path; key joins the logger redaction set).
- **Explicit degradations in that pane:** no transcript capture/disk mirror, no scrubbed ring buffer or scrollback replay, no authorship glyphs, no context ring, no OSC titles, dictation can't target it, Chorus resume n/a (dsh owns its own persistence), council/attribution features reading session text n/a.
- **Security note:** `dsh web` binds localhost **with no documented auth** — any local process can drive an agent holding the key and FS access. Strictly weaker than every PTY agent Chorus runs.
- **Phase-0 gate (mandatory, before any code):** on this Windows machine, `npx @deepseek-ai/dsh web --no-open` with `DEEPSEEK_API_KEY` set — does it boot at all; does `port: 0` work; exact ready-line format; UI functional in a plain browser; two instances coexisting; clean taskkill. **Windows is undocumented — if this fails, Plan B is dead regardless of design.** Distribution: require a user-performed global install detected via `probeCli` (never runtime `npx`; no new package.json dep without asking).
- **Middle step worth pricing first ("B-lite"):** managed `dsh web` child + open in the external browser — Plan B's lifecycle half without the webview half.

## 5. Verdict and decision (D175)

**Possible: yes. Monumental: no — but Plan B is a new execution mode built on an rc-8 developer preview** whose stdout contract can break at any release, whose Windows behavior is unknown, whose embedded UI forfeits most of what makes a Chorus pane valuable, and which weakens the security posture. Plan A delivers the DeepSeek model in a first-class pane in one session through a binary already installed and working (opencode **1.18.18**).

**Decided 2026-08-19 (Matthew): build nothing now.** When the button is wanted, build **Plan A** with the agreed parameters (A-direct `DEEPSEEK_API_KEY`; both cards visible; opencode-version line accepted). Reconsider **Plan B only after** `dsh` ships a stable release with documented Windows support — and run the Phase-0 smoke test first, considering B-lite before the embedded pane.

**Re-verify at pickup time:** opencode flags against `--help` on the then-current version; the dsh release state (rc-8 as of today); the next free D-number per G6 (never trust this document's snapshot).

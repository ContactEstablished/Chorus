# Chorus Phase 0.3 Execution Prompt

## Role

You are the Coordinator for Chorus Phase 0.3 (multi-session foundation). Repo root: C:\Projects\ContactEstablished\Chorus. Expected branch: main — confirm with `git branch --show-current`; do not switch or create branches without instruction.

## Goal

Generalize the single-session terminal foundation into multiple concurrent PTY sessions and prove it by running Claude Code and Codex CLI side-by-side in two panes in one window. Add a CLI detection service reporting installed agent/tool CLIs. This completes Phase 0 items "SessionManager abstraction", "CLI detection", and "two agents side-by-side" from docs/PLAN.md — persistence and notifications are explicitly later.

## Ground yourself first

Before editing anything, read:

- **CLAUDE.md** — architecture rules: sessions live in main; renderer never spawns processes; typed Zod-validated IPC; contextIsolation on, nodeIntegration off; verify CLI flags against the tool's own --help, never from memory; no secrets in args/logs/transcripts.
- **docs/PLAN.md §3** (architecture), **§4** (adapter abstraction — a future shape, NOT to build now), **§14** Phase 0.
- **src/main/services/sessionManager.ts** — currently a SINGLETON: `private session: PtySession | null = null` (line 36), `attach(cwd)` (line 41), private `spawn(cwd)` (line 77, hardcodes resolveClaudeCli()), `requireSession` (line 111). Has a per-session replay ring buffer (BUFFER_MAX_CHARS = 4_000_000 chars) and onData/onExit listener sets.
- **src/main/services/cliDetect.ts** — `resolveClaudeCli()`: resolves via where.exe, prefers .exe, falls back to `cmd.exe /c <shim>` for .cmd/.bat. Generalize this; do not duplicate it.
- **src/shared/ipc.ts** — IpcChannel map (line 10) + Zod schemas: attachRequest (currently empty object), attachResponse {sessionId, buffer, status, exitCode}, writeRequest {sessionId, data}, resizeRequest {sessionId, cols, rows}, sessionDataEvent, sessionExitEvent.
- **src/main/ipc.ts** — all renderer->main payloads Zod-parsed in main; outbound main->renderer events also Zod-validated IN MAIN before webContents.send.
- **src/preload/index.ts** — pure typed forwarder exposing window.chorus (attachSession line 19, writeSession, resizeSession, onSessionData, onSessionExit). CONTAINS NO ZOD — see resolved decision D1.
- **src/renderer/src/components/TerminalPane.vue** — xterm + FitAddon, calls window.chorus.attachSession() with no args (line 40), ResizeObserver drives fit + resizeSession.
- **src/renderer/src/App.vue** (single pane + exit banner), **src/renderer/src/stores/session.ts** (singleton Pinia session store), **src/main/constants.ts** (DEV_WORKING_DIR, line 8, value 'C:\\Projects\\ContactEstablished\\Chorus').
- **Git checks to run:** `git branch --show-current` (expect main), `git status --porcelain` (expect clean), `git log --oneline -1` (expect 80e69c3 "Phase 0.2: Claude Code running live in an xterm.js terminal" or a descendant).

## Pre-existing changes warning

None — working tree was clean at prompt-generation time (2026-07-18). If `git status --porcelain` shows anything unexpected, stop and ask the user; do not revert, stage, or commit files you did not change.

## Verified environment facts (2026-07-18 — do not re-derive from memory)

- Windows 11, PowerShell 7. Node v22.14.0, npm 11.12.1.
- claude CLI: native exe at C:\Users\matth\.local\bin\claude.exe, version 2.1.207. node-pty/ConPTY spawns it directly.
- codex CLI: npm shim — where.exe finds C:\Users\matth\AppData\Roaming\npm\codex (extensionless, not spawnable) and C:\Users\matth\AppData\Roaming\npm\codex.cmd. Version: codex-cli 0.135.0. A .cmd cannot be spawned directly by node-pty — spawn via `cmd.exe /c <full path to codex.cmd>` (the existing fallback in cliDetect.ts already implements this pattern for .cmd/.bat).
- node-pty is 1.1.0 with N-API prebuilds already working — see resolved decision D2.

## Resolved decisions (all resolved 2026-07-18)

- **D1:** All Zod validation lives in the MAIN process only. Zod 4 compiles validators with new Function; the preload runs under the page CSP (script-src 'self', no unsafe-eval) and any .parse() there throws EvalError and silently drops IPC events. Preload stays a pure typed forwarder. Do not add Zod (or any eval-using library) to preload or renderer IPC paths.
- **D2:** No electron-rebuild step. node-pty 1.1.0 ships N-API prebuilds (prebuilds/win32-x64). Forcing a source rebuild fails on Windows (GetCommitHash.bat packaging bug) and must not be reintroduced in package.json postinstall.
- **D3 (CLAUDE.md, locked):** Sessions live in main, owned by SessionManager; panes/windows are views attached by sessionId; the renderer never spawns processes.
- **D4:** Two panes use a crude fixed 50/50 horizontal split (flexbox). The full binary split tree, project tabs, and Focus+Filmstrip layout are Phase 1 — do not build them now.
- **D5 (CLAUDE.md, locked):** Verify current CLI flags against the tool's own --help output at build time (`codex --help`, `claude --help`); never hardcode flags from training-data memory. For this phase both agents launch with NO extra args (bare interactive TUI) unless --help reveals a needed flag.
- **D6:** Child PTYs inherit process.env untouched. No credentials are injected, logged, or written anywhere in this phase.

## Implementation scope

### Task 1 — Multi-session SessionManager

Owns: src/main/services/sessionManager.ts, src/shared/ipc.ts, src/main/ipc.ts, src/preload/index.ts

- Replace the singleton `session` field with a Map<sessionId, PtySession>. Keep per-session ring buffer, status, exitCode, and the onData/onExit fan-out exactly as they behave today.
- attach() becomes per-agent: attachRequest gains a field (e.g. `agent: z.enum(['claude', 'codex'])`); main keeps ONE session per agent kind for this phase (attaching to an already-running agent returns its snapshot + replay buffer, same semantics as today's reload behavior).
- dispose() kills all live PTYs on app quit (app.on('before-quit') already calls it).
- Update IpcChannel/schemas/preload signatures accordingly (preload stays Zod-free per D1; main validates both directions per current src/main/ipc.ts pattern).
- Both sessions spawn with cwd DEV_WORKING_DIR from src/main/constants.ts (still the one obvious place to change).

### Task 2 — CLI detection service

Owns: src/main/services/cliDetect.ts, plus a new IPC channel

- Generalize resolveClaudeCli() into resolveCli(name) preserving the .exe-preference and cmd.exe /c shim fallback; claude and codex spawn paths both go through it.
- New detection function: for each of claude, codex, git, docker, node — report found/not-found, resolved path, and version string (run `<tool> --version`, capture first line, tolerate failure as "unknown"). Expose over a new Zod-validated invoke channel (e.g. cli:detect) and log a one-line summary per tool to the main-process console at startup. No UI beyond that — settings screens are a non-goal.

### Task 3 — Second pane running Codex

Owns: src/renderer/src/App.vue, TerminalPane.vue, stores/session.ts

- TerminalPane.vue takes an `agent` prop ('claude' | 'codex') and attaches to that agent's session; all existing xterm/fit/replay/exit-banner behavior preserved per pane.
- App.vue renders two TerminalPanes in a fixed 50/50 horizontal flexbox split (claude left, codex right) per D4.
- Rework the Pinia store to key session state by agent or sessionId (two concurrent sessions, independent status/exitCode).
- Per-pane input must route only to that pane's PTY; window resize must refit BOTH panes (each pane's ResizeObserver already handles its own container — verify both fire).
- Before launching codex, run `codex --help` in a terminal per D5 to confirm bare `codex` starts the interactive TUI and note any required flag; do the same check for `claude --help` only if changing its launch.

## Strict non-goals

Do not touch:
- Persistence/SQLite
- Exit toast/notifications (Phase 0 item 4, next chunk)
- Settings or launch-dialog UI
- Adapter interface from PLAN.md §4 (do not build AgentAdapter yet — a plain map/enum is correct at this scale)
- Git worktrees
- BYOK/credential vault
- Split-tree/pane-drag layout
- Pop-out windows
- Electron-builder packaging
- Effort/model selection
- docs/PLAN.md or CLAUDE.md

## Required workflow

No repo workflow kit exists (.codex/workflows and .claude/agents are absent) — use this sequence:

1. Ground yourself per the "Ground yourself first" section.
2. Implement task-by-task with small reviewable edits.
3. Self-review the diff against CLAUDE.md rules (especially D1/D3/D6) before verifying.
4. Run verification commands.
5. ONE intentional commit at the end narrating what changed and why, in the style of commit 80e69c3 (plain-English summary first, technical notes after); commit author must be Matthew Wilson <mwilson29072@gmail.com> — check `git config user.name` / `user.email` first and use `git -c user.name=... -c user.email=...` overrides if they differ; end the commit message with your standard Co-Authored-By footer (repo precedent: "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"). Do not push, do not open a PR, do not amend or rebase existing commits.

## Verification commands

Run from C:\Projects\ContactEstablished\Chorus:

- `npm run typecheck` — must pass with zero errors.
- `npm run dev` — RUN, don't just compile. Observe in the opened window: (a) two side-by-side terminal panes; (b) Claude Code TUI renders in the left pane and Codex TUI in the right (colors, cursor, box-drawing intact); (c) click each pane and type — keystrokes reach only that pane's agent; (d) resize the window — both TUIs reflow to new dimensions; (e) no cross-talk (output from one agent never appears in the other pane). A PowerShell screenshot/SendKeys helper may be written into the session scratchpad to automate observation if the agent cannot see the window otherwise.
- `git status --porcelain` after commit — clean except intentionally untracked files.

## Failure honesty clause

If any verification command fails — including for an environment reason unrelated to the change (e.g. codex not logged in, so its TUI shows a login prompt instead of a REPL) — capture the exact output, explain what it means, and report it. A login/auth prompt rendering correctly in the codex pane still verifies the terminal layer and may be reported as success WITH that observation noted; a blank pane, dropped keystrokes, or a crash may not. Never claim success that was not directly observed.

## Final reporting requirements

End with:
- Status (one of DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED)
- Files changed with one-line rationale each
- Typecheck + runtime verification results stating what was ACTUALLY observed on screen
- Confirmation that each strict non-goal was not touched
- Residual risks/follow-ups
- Final `git status` and `git log --oneline -2` output

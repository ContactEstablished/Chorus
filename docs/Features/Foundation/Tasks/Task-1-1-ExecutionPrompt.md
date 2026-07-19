# Kimi K3: Chorus Phase 1, Task 1-1 Execution Prompt

## 1. Role

You are Kimi K3, the implementation engineer for **Chorus Phase 1, Task 1-1** (Tailwind adoption + session lifecycle UI). Repo root: `C:\Projects\ContactEstablished\Chorus`. Expected branch: `main` — confirm with `git branch --show-current`; do not switch or create branches. Expected HEAD: `e71f353` ("Phase 1 Planning Docs") or a descendant. Planning was done by a separate coordinator (Claude); your final summary will be reviewed by that coordinator for accuracy against the task docs.

## 2. Goal

Introduce **Tailwind CSS as the renderer styling system** (decision D8) and give each terminal pane **lifecycle chrome** — a header bar with agent label + status dot (running=green / exited-ok=gray / exited-error=red), and per-pane Restart and Kill buttons backed by a new `session:kill` IPC channel. The bottom exit banner is removed. Layout stays a fixed 50/50 split; this task changes NO layout, persistence, or session-identity behavior.

## 3. Project Context

**Chorus architecture:**
- Local-first Windows-only Electron 43.1.1 + Vue 3 + TypeScript + Vite + Pinia desktop app that runs AI coding agent CLIs (Claude Code, Codex) as live interactive TUIs inside xterm.js terminal panes.
- PTY processes (node-pty, ConPTY) live in the Electron MAIN process, owned by a SessionManager; the renderer is a pure view that attaches to sessions by id over typed IPC.
- `contextIsolation: true`, `nodeIntegration: false`.

**Dev machine specs:**
- Windows 11, PowerShell 7, Node 22.14.0, npm 11.x.
- Agent CLIs installed: `claude.exe 2.1.207` (native exe), `codex-cli 0.135.0` (npm .cmd shim — spawned via `cmd.exe /c`, which matters for process-tree kill).

**Two environment quirks you MUST know:**

(a) **Windows OS toast notifications are disabled system-wide** (registry `ToastEnabled=0`). The app's exit-toast code fires and logs `[notify] toast shown: ...` then `[notify] toast failed: ... (HRESULT: -2143420140)` — this is **EXPECTED** and is the **pass condition** for notification checks; a visible toast will never appear.

(b) **The codex TUI may open with interactive first-run prompts:** an update-available prompt (press "2" to Skip — never "1", which runs npm install) and/or a directory-trust prompt (leave it for the user unless a test requires quitting codex, in which case "2. No, quit" exits without persisting anything). These prompts rendering crisply IS the terminal layer working, not a bug.

## 4. Ground Yourself First (Read BEFORE Editing)

**Docs** (all in-repo, committed):
- `CLAUDE.md` — locked architecture rules.
- `docs/Features/Foundation/roadmap.md` — §5 Verified Ground Facts, §6 Decisions & Gates.
- `docs/Features/Foundation/Tasks/Phase-1-Overview.md` — phase shape, file-ownership matrix.
- **`docs/Features/Foundation/Tasks/Task-1-1.md`** — THE task contract (scope, non-goals, acceptance criteria). This governs.
- `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-1-1.md` — exact insertion points, code sketches, invariants. Follow it; where it defers to live docs (Tailwind install), verify live.

**Code** (verified line anchors, 2026-07-18):
- `src/main/services/sessionManager.ts` — `Map<sessionId, PtySession>` line 38; `attach()` line 43; `getAgent()` line 71; `dispose()` line 84; `findByAgent()` line 93; `spawn()` line 100 (useConpty: true; onExit handler wired here is the **ONLY status writer**).
- `src/shared/ipc.ts` — `IpcChannel` object lines 10–25 (session:attach line 12, cli:detect line 22, layout:get line 24); `agentKindSchema` line 31; schemas exported here, parsed **ONLY in main**.
- `src/main/ipc.ts` — all handlers Zod-parse before acting; copy this pattern.
- `src/preload/index.ts` — Zod-free typed forwarders in a `chorusApi` object; `ChorusApi` type is inferred from it (index.d.ts needs no edit).
- `src/renderer/src/App.vue` — `panes` ref line 11, v-for line 22, bottom exit banner (to remove).
- `src/renderer/src/components/TerminalPane.vue` — props line 9, attach line 44, ResizeObserver → fit() + immediate resizeSession (do NOT add debounce — that's Task 1-3).
- `src/renderer/src/stores/session.ts` — sessions keyed by AgentKind lines 16–17 (keep this keying; rekeying is Task 1-2).

**Git checks** (run first):
```powershell
git branch --show-current  # expect: main
git status --porcelain     # expect: CLEAN (empty output)
git log --oneline -1       # expect: e71f353 or descendant
```

## 5. Pre-existing Changes Warning

Working tree was clean at prompt-generation time (2026-07-18, HEAD e71f353). If `git status --porcelain` shows anything, **stop and ask the user before proceeding**. Never revert, stage, or commit files you did not change.

## 6. Resolved Decisions That Bind This Task

Quote these — do not relitigate:

- **D1** (RESOLVED 2026-07-18): ALL Zod validation lives in the main process only. The preload and renderer run under a CSP with no `unsafe-eval`; Zod's `.parse()` there throws EvalError and silently drops IPC events. Shared files may EXPORT schemas; only `src/main/` calls `.parse()`.

- **D2** (RESOLVED 2026-07-18): NEVER run `electron-rebuild`. node-pty ships working prebuilds. better-sqlite3 is built for Electron's ABI via the repo's `.npmrc` + `npm run rebuild:better-sqlite3` (compiles with `/Od` due to an MSVC 17.14 internal compiler error). If ANY `npm install` re-fetches better-sqlite3 and the app then fails with a native-module ABI error, run `npm run rebuild:better-sqlite3` — nothing else.

- **D3** (locked, CLAUDE.md): Sessions live in main; the renderer never spawns processes.

- **D4** (locked, CLAUDE.md): Verify tooling/CLI setup against current official docs at execution time — never from model memory. Applies here to the Tailwind v4 + Vite install method: check Tailwind's own docs; the expected shape is `npm i -D tailwindcss @tailwindcss/vite`, plugin added to the RENDERER target of electron-vite config, `@import "tailwindcss";` in the renderer's global CSS — but the docs are the authority, not this prompt.

- **D8** (RESOLVED 2026-07-18): Tailwind CSS is adopted starting with this task. Dependency is pre-approved; do not ask.

## 7. Implementation Scope

Read **`docs/Features/Foundation/Tasks/Task-1-1.md`** and follow its **Exact Scope** table. You will edit these files (NOTHING else; explicitly do not touch storage.ts, notifications.ts, constants.ts, main/index.ts):
- `src/shared/ipc.ts`
- `src/main/ipc.ts`
- `src/main/services/sessionManager.ts`
- `src/preload/index.ts`
- `src/renderer/src/stores/session.ts`
- `src/renderer/src/components/TerminalPane.vue`
- `src/renderer/src/App.vue`
- `package.json`
- Tailwind config/CSS entry files (per live Tailwind docs)

Also read **`docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-1-1.md`** and follow its **10 Step-by-step Work items** exactly.

**Key invariants to restate:**
- `kill()` performs **no state mutation** (the existing `onExit` handler in `spawn()` is the single status writer).
- `Restart` must **AWAIT** the session's exit event before re-attaching (race guard).
- **Preload stays Zod-free.**
- **Windows process-tree caveat:** codex runs under `cmd.exe /c` — after Kill, verify no orphaned `cmd.exe`/`codex` children. Only escalate to `taskkill /PID <pid> /T /F` inside `kill()` if the plain `pty.kill()` demonstrably leaves an orphan.

## 8. Strict Non-Goals

From **Task-1-1.md** verbatim:
- No launch dialog.
- No layout changes (fixed 50/50 stays).
- No session-persistence changes (ids stay ephemeral).
- No Drizzle, no Vitest.
- No renaming existing IPC channels.
- No new notifications work.
- Do not revert/stage/commit unrelated files including anything under `docs/`.

## 9. Required Workflow

1. **Ground per §4** — read the task docs and implementation spec before editing.
2. **Implement step-by-step** — small, reviewable edits; wire Tailwind and verify a utility class renders **BEFORE** building the pane chrome.
3. **Self-review the diff** against CLAUDE.md + D1/D3 + the Task-1-1 Review Checklist.
4. **Run verification (§10).**
5. **ONE intentional commit** narrating what changed and why, in the style of repo commit `80e69c3` (plain-English summary paragraph first, "Technical notes:" bullet list after).
   - Commit author must be **Matthew Wilson <mwilson29072@gmail.com>** — check `git config user.name` / `user.email` and use `git -c user.name=... -c user.email=...` overrides if they differ.
   - End the message with a Co-Authored-By line crediting Kimi K3, following the repo's existing Co-Authored-By format.
   - **Do not push, do not open a PR, do not amend or rebase existing commits.**

## 10. Verification Commands

Run from `C:\Projects\ContactEstablished\Chorus`:

```powershell
npm run typecheck
```
Must pass with zero errors.

```powershell
npm run dev
```
**RUN the app, don't just compile.** Observe and document:
- **(a)** Both panes show live TUIs (Claude Code left, Codex right — codex may show its first-run prompts, see §3b).
- **(b)** Each pane has a header with agent label + green status dot; the old bottom exit banner is gone.
- **(c)** A Tailwind utility class visibly applies (e.g., text color, padding, border styling — note which one).
- **(d)** Kill on the codex pane → its TUI ends, dot goes gray/red, main-process console logs the `[notify]` lines (§3a — the toast will NOT appear on screen; the log is the pass signal).
- **(e)** Restart on a pane → old TUI ends, fresh TUI attaches, dot returns to green.
- **(f)** Typing in one pane never reaches the other.

**Process-tree check** — in a second PowerShell session, before and after Kill on the Claude pane:
```powershell
tasklist | findstr /i "claude cmd"
```
Rows present before must be gone after. If orphaned `cmd.exe` or `codex` remain, the implementation must escalate to `taskkill /PID <pid> /T /F` inside `kill()`.

**Note:** If you cannot visually observe the Electron window from your harness, you may write a PowerShell helper into a temp directory using user32.dll P/Invoke (EnumWindows to find the visible electron-process window titled "Chorus", GetWindowRect + Graphics.CopyFromScreen to screenshot, SetCursorPos + mouse_event to click, SendKeys to type) and inspect the screenshots. The window may sit at negative coordinates on a secondary monitor — use the rect from EnumWindows, don't assume the primary display.

## 11. Failure Honesty Clause

If any verification fails — including for an environment reason unrelated to your change — **capture the exact output, explain what it means, and report it.** Never claim success that was not directly observed. A codex pane showing its update/trust prompt still verifies the terminal layer (note it); a blank pane, dropped keystrokes, an orphaned process after Kill, or a missing `[notify]` log may **NOT** be reported as success.

## 12. Final Reporting Requirements

End your session with a **detailed summary** containing (this summary will be reviewed for accuracy by the planning coordinator — be precise, complete, and honest):

- **Status:** one of DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED.
- **Files changed:** every file, with a one-line rationale each, and any file you touched beyond the Exact Scope list flagged loudly with justification.
- **Deviations:** every place your implementation differs from ImplementationSpec-1-1.md (including Tailwind install steps if the live docs differed from the spec's sketch), with why.
- **Verification transcript:**
  - `typecheck` result.
  - Each runtime observation (a)–(f) from §10 stated individually with what you ACTUALLY saw (screenshots referenced if taken).
  - `tasklist` before/after output for the process-tree check.
  - Whether the `taskkill` escalation was needed.
- **Acceptance criteria:** the Task-1-1.md checklist restated with pass/fail per item.
- **Non-goals confirmation:** explicit statement that each non-goal was untouched.
- **Residual risks / notes** for Task 1-2's implementer.
- **Final git output:**
  ```
  git status --porcelain
  git log --oneline -2
  ```

# Chorus Phase 1, Task 1-3 Execution Prompt — Layout View

_Generated 2026-07-19 against HEAD `81e8a0b`. Ground facts in §4 were re-verified against the live code on that date._

## 1. Role

You are the implementation engineer for **Chorus Phase 1, Task 1-3** (spike gate → `LayoutRenderer` → debounced resize → close/kill). Repo root: `C:\Projects\ContactEstablished\Chorus`. Expected branch `main` — confirm with `git branch --show-current`; do not switch or create branches. Expected HEAD: `81e8a0b` ("Phase 1.2: data layer — Drizzle, stable session ids, layout tree, Vitest") or a descendant.

Planning was done by a separate coordinator (Claude). Your final summary will be reviewed by that coordinator against the task docs, so it must be precise and honest. Task 1-1 and 1-2 were implemented by other agents; their handoff notes are already folded into this prompt.

## 2. Goal

Replace the interim flatten adapter with the **real layout view**: a recursive `LayoutRenderer.vue` that renders the persisted `LayoutJson` binary split tree, mounting one `TerminalPane` per leaf by `sessionId`. Splitter drags write ratios back to the model and persist through a new `layout:set` IPC. `TerminalPane` gains the council-specified **debounced PTY resize**. Closing a pane kills its session and removes its leaf (sibling absorbs).

**A 4-hour timeboxed spike gates the renderer implementation** — it decides whether xterm survives inside `splitpanes`, or whether you build a custom renderer behind the identical adapter contract. Split is intentionally deferred (buttons rendered **disabled**) because Task 1-4 owns session creation.

## 3. Project Context

**Architecture:** local-first, Windows-only Electron 43.1.1 + Vue 3 + TypeScript + Vite + Pinia app running AI coding-agent CLIs (Claude Code, Codex) as live interactive TUIs in xterm.js panes. PTYs (node-pty / ConPTY) live in the **main** process, owned by `SessionManager`; the renderer is a pure view attaching by session id over typed IPC. `contextIsolation: true`, `nodeIntegration: false`.

**Dev machine:** Windows 11, PowerShell 7, Node 22.14.0. CLIs: `claude.exe` 2.1.207 (native exe), `codex-cli` 0.135.0 (npm `.cmd` shim, spawned via `cmd.exe /c`).

**Environment quirks you MUST know — all four are expected, none is a bug you caused:**

(a) **OS toast notifications are disabled system-wide** (registry `ToastEnabled=0`). Exit-toast code logs `[notify] toast shown: …` then `[notify] toast failed: … (HRESULT: -2143420140)`. The **log line is the pass signal**; a visible toast will never appear.

(b) **The codex TUI opens with first-run prompts** — an update-available prompt (press **2** to Skip — never **1**, which runs npm install), possibly a directory-trust prompt, and a `TERM is set to "dumb"` `[y/N]` prompt. These rendering crisply **is** the terminal layer working.

(c) **`node-pty` logs `AttachConsole failed` from `conpty_console_list_agent` on PTY teardown.** Pre-existing noise, present before Phase 1.

(d) **This automation harness strips `ComSpec` and runs a modified PATH** (reported by the Task 1-2 implementer). `npm install` and app launches need `ComSpec` restored and the registry user/machine PATH, or CLIs resolve to the wrong tools. Fix your environment before concluding a command "failed".

## 4. Ground Yourself First (Read BEFORE Editing)

### Docs (in-repo)
- `CLAUDE.md` — locked architecture rules.
- `docs/Features/Foundation/roadmap.md` — §5 Verified Ground Facts, §6 Decisions & Gates (**D9** binds this task).
- `docs/architecture/CR-1.2-pane-layout-council-findings.md` — **authoritative** on the layout engine.
- **`docs/Features/Foundation/Tasks/Task-1-3.md`** — THE task contract. Scope, non-goals, acceptance criteria. **This governs.**
- **`docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-1-3.md`** — exact component sketches, spike mechanics, deletion checklist, NO-GO fallback, verification script. Follow it, with the three known warts in §7 below.
- `docs/Features/Foundation/Tasks/Task-1-2-CompletionSummary.md` — the previous implementer's handoff.

### Code state — re-verified 2026-07-19, trust this over any older doc line
- `src/shared/layout.ts` — pure/immutable/no-op-on-invalid: `clampRatio`, `createLeaf`, `splitPane`, `removePane`, `setRatio`, `changeDirection`, `swapPanes`, `collectSessionIds`, `findLeaf`, `normalizeTree`, `convertLegacyFlatLayout`. Invariants at every boundary: exactly 2 children per internal node, ratios ∈ [0.05, 0.95], no duplicate `sessionId`s, ≥1 leaf, `version: 1`.
- `src/shared/ipc.ts` — `IpcChannel` has **8** entries: `session:attach`/`write`/`resize`/`kill`, `session:data`/`exit`, `cli:detect`, `layout:get`. **`layout:set` does not exist — you add it.** `layoutJsonSchema`, `layoutNodeSchema` (recursive via `z.lazy`), `layoutGetResponseSchema = {layout, sessions[{id,agent,status}]}` all exported here; `.parse()` is called **only** under `src/main/`.
- `src/main/ipc.ts` — every handler Zod-parses before acting. Copy the pattern exactly.
- `src/main/services/storage.ts` — `savePaneLayout(projectId, layout)` already exists and clamps + upserts; it is your `layout:set` persist path. `getPaneLayout` normalizes **in memory only** (D13 — a corrupt tree self-heals on first save, not on read).
- `src/main/services/sessionManager.ts` — `Map<string, PtySession>` keyed by stable DB session row id. `attach({sessionId?, agent}, cwd)`, `kill`, `write`, `resize`, `getAgent`, `onData`, `onExit`, `dispose`. **Do not touch this file** — `findByAgent()` still exists and is Task 1-4's to remove.
- `src/preload/index.ts` — Zod-free typed forwarders in a `chorusApi` object; `ChorusApi` is **inferred** from it, so `index.d.ts` needs no edit. Existing: `attachSession`, `writeSession`, `resizeSession`, `killSession`, `detectClis`, `getLayout`, `onSessionData`, `onSessionExit`. You add `setLayout`.
- `src/renderer/src/App.vue` — **currently the interim flatten adapter**: `collectSessionIds()` over the tree → fixed 50/50 flexbox row. You replace this.
- `src/renderer/src/components/TerminalPane.vue` — props `{sessionId, agent}`; attaches by `sessionId`; **scrollback 10 000**; ResizeObserver → `fit()` + **immediate** `resizeSession`. You rework the resize path, drop scrollback to 5 000, hide the scrollbar, and add the pane-header buttons.
- `src/renderer/src/stores/session.ts` — **still `Record<AgentKind, PaneSessionState>`** with two pre-seeded slots, and `TerminalPane` reads through `props.agent` (`store.sessions[props.agent]`, `dotStatus(props.agent)`, `setBusy(props.agent, …)`). **Leave it that way — see §6 D10.**
- `src/renderer/src/components` currently contains **only** `TerminalPane.vue`; `src/renderer/src/stores` contains **only** `session.ts`. You create `LayoutRenderer.vue` and `stores/layout.ts`.
- `package.json` — `test` script present, `vitest` 4.1.10 installed, 24 tests green. **`splitpanes` is NOT installed.**

### Git checks (run first)
```powershell
git branch --show-current   # expect: main
git status --porcelain
git log --oneline -1        # expect: 81e8a0b or a descendant
```

## 5. Pre-existing Changes Warning — READ THIS

**The working tree is NOT clean, and that is expected.** At prompt-generation time it held:

```
 M docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-1-2.md
 M docs/Features/Foundation/Tasks/Task-1-2.md
 M docs/Features/Foundation/Tasks/Task-1-4.md
 M docs/Features/Foundation/roadmap.md
?? _ui/
?? docs/Features/Foundation/Tasks/Task-1-1-ExecutionPrompt.md
?? docs/Features/Foundation/Tasks/Task-1-2-CompletionSummary.md
?? docs/Features/Foundation/Tasks/Task-1-2-ExecutionPrompt.md
```

These are the coordinator's planning docs plus `_ui/` (a UI mockup scratch directory). **All of it is none of your business.** Do not revert, stage, commit, edit, or "clean up" any of it. Your commit contains only files you changed for this task.

If you see modifications to anything under **`src/`** — that is not expected. Stop and ask the user.

## 6. Resolved Decisions That Bind This Task

Quote these; do not relitigate.

- **D1** (RESOLVED): ALL Zod validation lives in **main** only. Preload and renderer run under a CSP with no `unsafe-eval`; Zod's `.parse()` there throws EvalError and **silently drops IPC events**. Shared files may EXPORT schemas; only `src/main/` calls `.parse()`.
- **D2** (RESOLVED): **NEVER** run `electron-rebuild`. node-pty ships working prebuilds. If an `npm install` re-fetches better-sqlite3 and the app then hits a native-module ABI error, run `npm run rebuild:better-sqlite3` — nothing else. (Note: the 1-2 install needed no rebuild.)
- **D3** (locked, CLAUDE.md): Sessions live in main; the renderer never spawns processes.
- **D4** (locked, CLAUDE.md): Verify tooling against current official docs at execution time, never from model memory. Applies to the splitpanes API surface if the spike goes GO — check splitpanes' own docs for the `@resize` payload shape rather than trusting the spec's sketch.
- **D9** (RESOLVED, council unanimous 3-of-3): layout = **owned binary split tree as the persisted data model**; splitpanes as a **dumb renderer** behind a `LayoutRenderer.vue` adapter. Escape hatch: if the spike fails, custom renderer — the tree model is unchanged. PTY resize: continuous `fit()`, debounced `pty.resize` (150 ms / drag-end). **You must record your spike's GO/NO-GO result back into roadmap D9.**
- **D10** (RESOLVED 2026-07-19): the session-store rekey from `AgentKind` to `sessionId` belongs to **Task 1-4, not this task**. With one live session per kind the agent-keying is still correct. `LayoutRenderer` keys *pane components* by `sessionId` while the store stays per-kind. **Do not rekey the store.** If you find yourself wanting to, you have drifted out of scope — report it instead.

## 7. Implementation Scope

Follow the **Exact Scope** table in `Task-1-3.md` and the **10 step-by-step items** in `ImplementationSpec-1-3.md`.

**Create:**
- `src/renderer/src/components/LayoutRenderer.vue`
- `src/renderer/src/stores/layout.ts`
- `docs/architecture/spike-filmstrip-notes.md`
- _(temporary, deleted before commit)_ `SpikeLayout.vue`, `FilmstripRenderer.vue`, and the `?spike=layout` branch

**Edit:** `src/renderer/src/App.vue` · `src/renderer/src/components/TerminalPane.vue` · `src/shared/ipc.ts` · `src/main/ipc.ts` · `src/preload/index.ts` · `package.json` (**only on GO**)

**Explicitly do NOT touch:** `sessionManager.ts`, `storage.ts`, `main/index.ts`, `constants.ts`, `notifications.ts`, `db/schema.ts`, `stores/session.ts`, `shared/layout.ts`.

### Three known warts in ImplementationSpec-1-3 — handle these deliberately

1. **§10's `App.vue` sketch calls `getLayout()` twice** (once inline for `sessions`, once inside `layout.loadLayout()`). Make it **one** call: fetch `{layout, sessions}` once, hand the layout to the store and keep `sessions` for `agentFor`. Two IPC round-trips on boot is a needless race.
2. **§10's `agentFor` uses a non-null assertion** (`sessions.find(…)!.agent`). That will not survive strict typecheck cleanly and lies about a real case (a leaf whose session row is missing). Return `AgentKind | undefined` and have `LayoutRenderer` skip or placeholder that leaf — the current `App.vue` already filters exactly this case, so preserve the behavior.
3. **§4's `LayoutRenderer` sketch references `AgentKind` without importing it.** Import it from `../../../shared/ipc`.

### Key invariants to restate
- ResizeObserver attaches to **our** pane container div, **never** splitpanes internals.
- splitpanes `@resize` writes ratios **only** — splitpanes owns no layout state.
- Ratios clamped `[0.05, 0.95]` **both** client-side (store) and server-side (`layout:set` handler). Defense in depth, per council.
- PTY resize debounced 150 ms / drag-end. Alt-screen TUIs corrupt under SIGWINCH storms — this is the whole point.
- Scrollback 5 000 and `.xterm-viewport { overflow: hidden !important; }` — the scrollbar hiding prevents a fit → scrollbar-appears → ResizeObserver-refires loop.
- Preload stays **Zod-free**.
- Split buttons **disabled with tooltip**; no empty-leaf schema; the `sessionId`-non-empty invariant stays intact.

## 8. The Spike Gate — Do This FIRST (timebox 4h)

**Do not write `LayoutRenderer.vue` before the gate returns.** Build the scratch page per ImplementationSpec §1, mount 2–3 xterm terminals in nested splitpanes, and test at **1024 / 1440 / 2560 px** window widths against the §2 acceptance table:

| Check | Pass condition |
|---|---|
| Canvas paints | Terminal glyphs render, no blank canvas |
| No clipping / z-fighting | Splitter + canvas layer cleanly |
| ResizeObserver fires **during** drag | Callback logs mid-drag, not only at drag-end |
| `fit()` plausible cols/rows | cols/rows track pane pixel size sanely |

All green at all three widths → **GO**: `npm install splitpanes@~4.1.2` (pinned tilde; pre-approved by D9 — do not ask), implement over `Splitpanes`/`Pane`.

Any persistent red → **NO-GO**: do **not** install splitpanes; implement the CSS-grid + pointer-driven custom renderer per ImplementationSpec §3, behind the **identical** props/emits contract. The task continues either way; only `LayoutRenderer.vue`'s internals differ.

**This gate is genuinely two-way.** Do not talk yourself into GO because it is the shorter path — a NO-GO that is honestly reported is a successful outcome of this task, not a failure. Record the result and the per-check observations in roadmap **D9** either way.

## 9. Strict Non-Goals

From `Task-1-3.md`:
- **No** launch dialog, **no** session creation — Task 1-4. Split therefore creates nothing and stays disabled.
- **No** empty-leaf schema; the `sessionId` non-empty invariant is not weakened.
- **No** session-store rekey (D10 — Task 1-4).
- **No** keyboard shortcuts, command palette, or shipping filmstrip (filmstrip is a throwaway spike).
- **No** persistence-format changes beyond writing ratios back. No new tables, no migrations.
- **No** multi-session-per-kind, project tabs, or restore-on-launch.
- Do not revert, stage, or commit files you did not change — including anything under `docs/` except the one doc this task creates (`docs/architecture/spike-filmstrip-notes.md`).

## 10. Required Workflow

1. **Ground per §4** — read the task doc, spec, and council findings before editing.
2. **Run the spike gate (§8) and record GO/NO-GO in roadmap D9** before implementing the renderer.
3. **Implement step-by-step** per ImplementationSpec's 10 items — small, reviewable edits.
4. **Run the deletion checklist** (spec §1): delete `SpikeLayout.vue`, remove the `?spike` branch and `URLSearchParams` read, `grep -r "spike" src/` returns nothing in shipped code, delete `FilmstripRenderer.vue`, keep the notes doc, typecheck clean after removal.
5. **Self-review the diff** against CLAUDE.md, D1/D3/D9/D10, and the Task-1-3 Review Checklist.
6. **Run verification (§11).**
7. **ONE intentional commit** narrating what changed and why, in the style of `80e69c3` (plain-English summary paragraph first, "Technical notes:" bullets after).
   - Author must be **Matthew Wilson <mwilson29072@gmail.com>** — check `git config user.name` / `user.email`, use `git -c user.name=… -c user.email=…` if they differ.
   - End with a `Co-Authored-By:` line crediting yourself, matching the repo's existing format.
   - **Do not push, do not open a PR, do not amend or rebase existing commits.**

## 11. Verification Commands

From `C:\Projects\ContactEstablished\Chorus`:

```powershell
npm run typecheck   # zero errors (G1)
npx vitest run      # green — 24 existing + your store-clamp assertion
npm run dev
```

**RUN the app, don't just compile (G2).** This is a UI/PTY task; runtime observation is the primary verification, not a formality. Observe and document each:

- **(a)** The layout renders from the persisted tree — both TUIs live, one `TerminalPane` per leaf.
- **(b)** **Drag the splitter over the Claude TUI** — during the drag the TUI stays visually intact (continuous `fit()`); at drag-end it snaps to settled cols/rows; **no cursor or box-drawing corruption**. This is the headline check for the debounce.
- **(c)** **Close the Codex pane** → confirm dialog → session killed → Claude leaf absorbs full width → tree persisted.
- **(d)** **Restart the app** → the dragged split ratio is restored from `pane_layouts`.
- **(e)** Split buttons render **disabled** with the tooltip.
- **(f)** Typing in one pane never reaches the other.
- **(g)** **Spike fully gone** — `?spike=layout` no longer resolves, `grep -r spike src/` clean, `FilmstripRenderer.vue` absent, `docs/architecture/spike-filmstrip-notes.md` present.

**DB check** (per spec §11.5) — confirm `pane_layouts.layout_json` reflects the last dragged ratio, clamped. Use the `ELECTRON_RUN_AS_NODE` trick; better-sqlite3 is built against Electron's ABI and will not load in plain `node`.

**Process-tree check** — in a second PowerShell, before and after closing the Codex pane:
```powershell
tasklist | findstr /i "codex cmd"
```
Rows present before must be gone after (codex runs under `cmd.exe /c`, so its children matter).

**If you cannot visually observe the Electron window from your harness:** write a PowerShell helper into a temp directory using user32.dll P/Invoke — `EnumWindows` to find the visible electron-process window titled "Chorus", `GetWindowRect` + `Graphics.CopyFromScreen` to screenshot, `SetCursorPos` + `mouse_event` to click and drag (you need a real drag for check (b)), `SendKeys` to type. The window may sit at negative coordinates on a secondary monitor — use the rect from `EnumWindows`, don't assume the primary display. You will also need this to resize the window for the spike's three widths.

## 12. Failure Honesty Clause

If any verification fails — including for an environment reason unrelated to your change — **capture the exact output, explain what it means, and report it.** Never claim success you did not directly observe.

Specifically for this task: a codex pane showing its update/trust/TERM prompts still verifies the terminal layer (note it). But a blank canvas, a TUI that corrupts during splitter drag, dropped keystrokes, a ratio that does not survive restart, an orphaned `cmd.exe`/`codex` process after close, or leftover `spike` references in `src/` may **NOT** be reported as success. **A NO-GO spike result is not a failure — reporting a GO you did not actually observe is.**

## 13. Final Reporting Requirements

End your session with a **detailed summary** — the coordinator reviews it for accuracy:

- **Status:** DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED.
- **Spike result:** GO or NO-GO, with the §8 acceptance table filled in per width (1024 / 1440 / 2560) — 12 cells, each with what you actually observed. State the wall-clock time the spike took against its 4h timebox. Confirm the result was written into roadmap D9.
- **Files changed:** every file, one-line rationale each; anything beyond the Exact Scope list flagged loudly with justification.
- **Deviations** from `ImplementationSpec-1-3.md`, with why — including how you handled the three known warts in §7.
- **Verification transcript:** typecheck result; vitest result; runtime observations (a)–(g) each stated individually with what you actually saw (reference screenshots if taken); the DB `layout_json` dump; `tasklist` before/after.
- **Deletion checklist:** each of the four items in spec §1 confirmed, plus `FilmstripRenderer.vue` deleted.
- **Acceptance criteria:** the `Task-1-3.md` checklist restated with pass/fail per item.
- **Non-goals confirmation:** explicit statement that each §9 non-goal was untouched — call out the session store (D10) by name.
- **Residual risks / notes for Task 1-4's implementer** — especially anything you learned about the tree/renderer contract that affects enabling split.
- **Final git output:**
  ```
  git status --porcelain
  git log --oneline -2
  ```

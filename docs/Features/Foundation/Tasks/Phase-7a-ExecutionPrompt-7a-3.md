# Phase 7a — Task 7a-3 Execution Prompt

> **Regenerated 2026-08-27 at `102d36f`.** Tasks 7a-1 (`c2fe8dd`) and 7a-2 (`2e62ce5`)
> both edited `LaunchDialog.vue`, so **the line numbers in `Task-7a-3.md` and
> `ImplementationSpec-7a-3.md` decayed twice.** Section 3a below carries the re-verified
> numbers. **Where a task doc and this prompt disagree about a line number, this prompt
> is right and the task doc is stale** — the prose in those documents is still
> authoritative, only their citations moved.

---

## 1. Role

You are the **Coordinator for Chorus Foundation, Phase 7a, Task 7a-3 — Launch Presets,
"How Many", and Batch Launch**.

- **Repo root:** `C:\Projects\ContactEstablished\.chorus\Chorus\wt-2be8b104`
- **Expected branch:** `chorus/Chorus/2be8b104` — **confirm it; do not switch without instruction.**
- **Expected HEAD at start:** `102d36f` ("Renumber two decisions that collided with main")
- **Platform:** Windows 11, PowerShell primary. This is a **git worktree**, not the main
  checkout. Run everything from the root above; never `cd` to `C:\Projects\ContactEstablished\Chorus`.

⚠ **This worktree has no `node_modules`.** Every gate silently fails without it — `tsc` reports
*"not recognized"*, which reads as a broken toolchain rather than a missing junction. See §8.

---

## 2. Goal

Make one press of **Launch** start a *shape* of work rather than a single agent: **Solo**,
**Pair**, **Workbench**, or **Swarm**, with a count for the two shapes that take one, and a
"will launch" strip that shows exactly what is about to happen before it happens.

The contract, in one line: **the planning is a pure function in `src/shared/`, and the
execution is N sequential trips through the launch path that already exists.** No new IPC
channel, no change to `session:launch`'s contract, no bulk-append primitive.

---

## 3. Ground yourself first

Read before editing anything:

1. `docs/Features/Foundation/Tasks/Task-7a-3.md` — the task contract.
2. `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-7a-3.md` — the deeper spec.
3. `docs/Features/Foundation/Tasks/Phase-7a-Overview.md` — how the three tasks relate.
4. `docs/Features/Foundation/roadmap.md` — **D186** (this task's decision), **F104** (the pane-cap
   hole this task makes reachable), **D174** (one landing line for all launches), **F84** and
   **D160** (why there is no first-prompt field), **G6** (shared counters).
5. The code in §3a.

Then run:

```
git branch --show-current          # expect chorus/Chorus/2be8b104
git status --porcelain             # expect exactly:  M .mcp.json
git log -1 --format=%h             # expect 102d36f
```

### 3a. Re-verified line numbers — measured 2026-08-27 at `102d36f`

**Still correct as the task docs cite them:**

| Citation | What is there |
|---|---|
| `src/main/ipc.ts:366` | `const LAUNCH_PANE_CAP = 16` |
| `src/main/ipc.ts:1660` | `ipcMain.handle(IpcChannel.SessionLaunch, …)` |
| `src/main/ipc.ts:1669-1676` | the soft pane-cap comment and count — **the F104 site** |
| `src/main/ipc.ts:1697` | `if (req.launch_profile_id && req.credential_profile_id)` — the existing refusal |
| `src/renderer/src/stores/layout.ts:82` | `schedulePersist()`, **500 ms** at `:87` |
| `src/renderer/src/stores/view.ts:47` | `setMode(mode: ViewMode)` |
| `src/renderer/src/App.vue:854` | `function onLaunched(...)` |
| `src/main/services/git.ts:46` | `GIT_CHECKOUT_TIMEOUT_MS = 10 * 60_000` |
| `src/main/services/storage.ts:175` | `const MIGRATIONS: string[] = [` — **22 entries, next free `v23`** |

⚠ **MOVED — use these, not the task doc's:**

| Task doc says | **Actually now** | What is there |
|---|---|---|
| `LaunchDialog.vue:158-167` | **`:164`** (doctrine), **`:171`** (`capabilities` computed), **`:978` / `:1027`** (the live instances) | absent-not-disabled |
| `LaunchDialog.vue:724-767` | **`:770`** `submit()`, **`:783-826`** the payload object, **`:831`** `emit('launched', …)` | batch loop goes here |
| `LaunchDialog.vue:512` | **`:529`** | `HIDDEN_AGENTS = ['kimi']` |
| — | **`:546`** | `UNNAMED_AGENTS = ['shell']` (added by 7a-2) |
| `shared/ipc.ts:902` | **`:921`** | `agentKindSchema` — now **6** kinds incl. `shell` |
| — | **`:1100`** | `workspaceModeSchema` (3 members) |
| — | **`:1162`** | `launchRequestSchema` |
| `ipc.ts:1898-1974` | **`:1938`** branch, **`:1973`** `createWorktree` | `workspace_mode === 'new-worktree'` |
| `registry.ts:9-38` | **`:39`** F25 note, **`:46`** `staticRegistry` | six adapters |

**Two prerequisites the plan assumed — both confirmed to exist, do not re-implement:**

- `layout.persistNow(projectId, tree)` — `src/renderer/src/stores/layout.ts:89`
- `collectSessionIds(tree)` — `src/shared/layout.ts:173`

---

## 4. Pre-existing changes — do not touch

`git status --porcelain` should show exactly one entry:

```
 M .mcp.json
```

⚠ **Do not revert, stage, or commit `.mcp.json`.** It is a local MCP endpoint edit and is
deliberately uncommitted. If you see anything else modified, **stop and report** rather than
cleaning it up.

---

## 5. Implementation scope

### 5.1 New — `src/shared/launchPresets.ts`

Pure, **no imports**, unit-tested. ⚠ **A Zod import here would break the renderer**: it runs
under a CSP with no `unsafe-eval`, and Zod throws `EvalError` at module scope. `src/shared/layout.ts:1`
explains this; `src/shared/provenance.ts:6` follows the same rule.

Owns the preset table and one function:

```ts
planLaunches(input): PlannedLaunch[]
```

Given the preset, picked agent, installed agents, count, and the dialog's `suggestedMode`,
it returns the **ordered** list of launches. The shape lives here, not in the `.vue` file —
that is what makes the feature testable without mounting a dialog.

### 5.2 D186 — the four shapes (SETTLED 2026-08-26 by Matthew; quoted, not re-litigated)

| id | Label | Shape |
|---|---|---|
| `solo` | Solo | N × picked agent |
| `pair` | Pair | 2 × `current-tree`: picked agent, then a partner of a **different kind** |
| `workbench` | Workbench | 2 × `current-tree`: picked agent, then `shell` |
| `swarm` | Swarm | N × picked agent, **`new-worktree` each** |

> **(b) ⚠ THE SOLO RULE IS THE ONE GENUINELY AMBIGUOUS CASE AND IT WAS DECIDED EXPLICITLY:
> Solo above 1 gives agent 1 the dialog's `suggestedMode` and agents 2..N `new-worktree`** —
> because by the time agent 2 launches another live session IS writing the repo, which is
> exactly the condition `suggestMode()` already keys on (`liveSessionsInRepo >= 1`).

- **Pair's partner:** the first *installed, non-hidden* agent that is not the builder, from the
  fixed order `claude → codex → grok → opencode`. If there is no second installed agent, the
  Pair card is **shown and disabled with its reason**, never hidden.
- **Roles are a label, not an enforcement.** Chorus has no read-only workspace mode (`workspaceModeSchema`
  at `:1100` is `current-tree | new-worktree | existing-worktree`; read-only deferred since D22).
  The reviewer writes the same tree. Set the session `description` to `reviewer` and **say so in
  the blurb** rather than implying a sandbox.
- **Per-agent controls apply to the whole batch.** Model, effort and permission are chosen once
  and travel on every launch. State it in the dialog; build no per-slot matrix.

### 5.3 "How many"

Rendered **only for `solo` and `swarm`** — **absent, not disabled**, for Pair and Workbench,
whose shape is fixed at two. That is the standing rule (`LaunchDialog.vue:164`).

Options 1–6, **clamped to the remaining pane budget**: `LAUNCH_PANE_CAP` is 16 (`ipc.ts:366`)
and the renderer knows the current count from `layout.tree` via `collectSessionIds`
(`shared/layout.ts:173`). **Values past the budget are not rendered.**

### 5.4 F104 — the pane cap is checked against a debounced write

`session:launch` counts panes from the **persisted** layout (`ipc.ts:1669-1676`). The renderer
persists on a **500 ms debounce** (`stores/layout.ts:82`, `:87`). So N launches inside one
debounce window all see the same pre-batch count, and a batch of 6 starting from 14 panes
reaches 20 against a cap of 16.

**Take both mitigations:**
1. the renderer clamps the count (§5.3), and
2. the batch loop calls **`layout.persistNow(projectId, tree)` between launches** (`stores/layout.ts:89`),
   so main's own check is correct rather than merely redundant.

### 5.5 Batch execution in `LaunchDialog.vue`

`submit()` (**`:770`**) becomes a loop over `planLaunches(...)`. **Everything about the payload
construction at `:783-826` is preserved verbatim** — the `...(x ? {k:x} : {})` spread discipline
is what keeps an untouched control from sending a field, and it is load-bearing for several
recorded decisions.

- **Sequential `await`, never parallel.** `git worktree add` contends on the repo index, and the
  per-launch path already awaits a checkout with a 10-minute timeout (`git.ts:46`).
- **Progress:** the Launch button reads `Launching 2 of 4…`; each will-launch row ticks to done or failed.
- **Partial failure: stop on the first failure and keep what launched.** Show the inline reason
  plus "2 of 4 launched". **Never unwind a session that started.**
- **Emit `launched` once per success** (`:831`). `App.onLaunched` (`App.vue:854`) then runs unchanged
  per session.
  ⚠ **This is the one design constraint not to negotiate.** D174(b) collapsed all three launch
  paths onto the single line `layout.appendLaunchedLeaf(id)` *"so they can no longer disagree about
  where a session lands."* A batch is **N sequential trips through that same line**, in order — not
  a new bulk-append primitive.
- **Close the dialog** when the batch ends and at least one session started.
- **Switch to grid** when more than one launched (`viewStore.setMode('grid')`, `stores/view.ts:47`).

### 5.6 "Will launch" strip

A row per planned session at the foot of the dialog, above the buttons: mark, agent label, role,
and workspace target (`current tree` / `new worktree`). **Never render it empty or as "0 sessions"** —
D76's rule is omit, or give it a source.

This is the honesty surface for what Swarm actually costs, and **the roadmap has been bitten by
this exact thing once**: Phase 6b's notes record that the dialog's default workspace mode created a
fresh worktree per drive pane, so a multi-pane drive quietly accumulated worktrees. Nothing about a
swarm is destructive on close (D26 Q1 retention; **branches are never auto-deleted**, D26 Q4) — say
so in the blurb, because four branches sounds worse than it is.

---

## 6. Strict non-goals

- ❌ **No "TASK / first prompt" field.** **F84** measured that `session:write` into a still-starting
  agent **succeeds and the text is silently lost**. **D160** separately makes no-auto-Enter a safety
  rule. A staggered batch launch is the exact condition F84 was measured under.
- ❌ **No read-only workspace mode.** Deferred since D22; Pair's reviewer is a label.
- ❌ **No agent-driven spawning or layout.** §8 and D39 bar it; D163 re-states it. A human presses
  Launch once and gets N panes; no agent spawns, stops or steers another.
- ❌ **No new global hotkey.** D180(g): the listener is capture-phase and `preventDefault`s, so
  anything it binds is stolen from every agent terminal. Preset selection is dialog-local handling
  inside the existing focus trap.
- ❌ **No user-authored presets**, no per-slot settings matrix, no auto-merge of swarm branches.
- ❌ **No migration.** `sessions.agent` is unconstrained `TEXT`. `MIGRATIONS.length` **stays 22**.
- ❌ **Do not revert unrelated changes**, and do not touch `.mcp.json`.

---

## 7. Required workflow

There is **no `.codex/workflows/subagents/` kit in this repo** — do not go looking for one.

1. Implement, then self-review against `Task-7a-3.md` and `ImplementationSpec-7a-3.md`.
2. Review for code quality against the surrounding file's idiom.
3. Resolve findings before verifying.
4. Run the full gate set in §8.
5. **One intentional, narrated commit** in the style of `c2fe8dd` / `2e62ce5`: a plain-English
   subject describing the user-visible change, then a body explaining what and why.
6. **Do not push or open a PR unless explicitly asked.**

⚠ **CRLF discipline.** `core.autocrlf = true`; working-tree files must be CRLF or they show
permanently modified. If you author a file with LF, normalize it before committing.

---

## 8. Verification commands

### 8.0 First — the junction, or every gate is a false green

```powershell
$link = 'C:\Projects\ContactEstablished\.chorus\Chorus\wt-2be8b104\node_modules'
$src  = 'C:\Projects\ContactEstablished\Chorus\node_modules'
if (-not (Test-Path $link)) { New-Item -ItemType Junction -Path $link -Target $src | Out-Null }
if (-not (Test-Path "$link\.bin")) { throw 'junction missing - gates would be a false green' }
```

⚠ **Remove it when finished, by deleting the reparse point only.** A recursive delete follows the
link and destroys the main checkout's `node_modules`:

```powershell
$i = Get-Item $link -Force
if ($i.Attributes -band [IO.FileAttributes]::ReparsePoint) { $i.Delete() }
```

### 8.1 Gates

```
npm run typecheck        # node + web; expect 0 errors
npx vitest run           # baseline below
npm run grep:secrets     # 6 patterns, must stay clean
```

**Baseline at `102d36f`: `2967 / 2967` across **78 files**, with **1 file uncollected**.**
⚠ The uncollected file is `codeIndexCore.test.ts` (**F103**) — it reads a gitignored `_verify/`
fixture, so it is checkout-local. **This is expected and is not a regression.** Your run must add
tests; the total must grow, never shrink, relative to that baseline **allowing for F103**.

There is **no `lint` script** — `npm run lint` reports *Missing script*. Do not report that as a failure.

Also re-assert, and state the numbers in your report:

```
MIGRATIONS.length == 22      # AST-parse it; NEVER grep - the inter-element
                             # comments contain backticks and a character
                             # scanner reads one as a template literal
```

### 8.2 Unit tests — where this feature's correctness lives

`src/shared/launchPresets.test.ts` must cover **every preset × every count × missing-partner ×
missing-shell**, asserting the exact expected launch list, including:
- Solo at 1 → `suggestedMode`; **Solo above 1 → agent 1 `suggestedMode`, agents 2..N `new-worktree`** (D186(b));
- Pair with only one installed agent → the disabled reason, not a crash;
- Swarm at N → N × `new-worktree`;
- the clamp against the remaining pane budget.

### 8.3 App drive — run it, don't just compile (G2)

A real window against a `--user-data-dir` **seeded from `%APPDATA%\chorus-app`** (including
`Local State`, or every pre-existing credential blob is undecryptable), driven over CDP on
**port 9333**. ⚠ **Never 9222** — that is the stable installed instance. Kill the dev app by
command line matching `*9333*`, never by process name.

Observe and record:
1. **Solo → 1 pane, byte-identical payload to today.** This is the regression that matters most.
2. **Pair** → 2 panes, two different agent kinds, both current tree, reviewer's `description` set.
3. **Workbench** → agent + Terminal, same tree.
4. **Swarm at 4** → 4 panes, **4 distinct worktrees** under `<repo-parent>\.chorus\<repo>\wt-*`
   on 4 distinct `chorus/<repo>/<id>` branches; view switches to grid; `WorktreePanel` lists all four.
5. **Cap:** with 14 panes open, the count control offers **at most 2**.
6. **Failure path:** cwd at a non-git directory with Swarm selected → the first launch refuses with
   `Not a git repository`, **the batch stops**, the dialog stays open and says "0 of 4 launched".
7. **"How many" is absent** (not disabled) for Pair and Workbench.

⚠ CDP `.value` assignment does not update a Vue `v-model` — **dispatch an `input` event**, or the
model stays empty and the bug looks like the app's rather than the harness's.

---

## 9. Failure honesty

If a verification command fails for an unrelated environment reason, **capture the exact output,
explain it, and do not claim success.** Specifically:

- A `tsc is not recognized` error means **the junction is missing** (§8.0), not a broken toolchain.
- `codeIndexCore.test.ts` being uncollected is **F103** and expected here.
- If a drive step cannot be completed, say which one and why. **A step you did not run is not a
  step that passed** — do not infer runtime behaviour from a green typecheck.
- If you find the task docs disagree with the code beyond the line numbers in §3a, **report the
  disagreement rather than silently following either one.**

---

## 10. Final reporting requirements

Report in this shape:

1. **Status** — one of `DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`.
2. **Files changed** — created vs modified, with a one-line reason each.
3. **Build + runtime results** — typecheck, the vitest totals **before and after**, `grep:secrets`,
   `MIGRATIONS.length`, and **what you actually observed** in each of the seven drive steps in §8.3.
   Quote real output; do not paraphrase a pass.
4. **Review outcomes** — what the spec review and code-quality review raised, and how each resolved.
5. **Non-goals confirmation** — explicitly confirm §6, especially that no first-prompt field, no
   new IPC channel, and no migration were added.
6. **Residual risks** — anything a reviewer should watch, and any new finding worth an F-number.
   ⚠ **Do not claim an F-number yourself:** this branch's `F102`–`F107` are already *pre-collided*
   with `main` and `chorus/Chorus/e27d8654`, which both still read "next free F102" (**F105**).
   Describe the finding and let an `/architect` pass number it after a merge.
7. **Final `git status --porcelain`** — which must still show `M .mcp.json` and nothing unexpected.

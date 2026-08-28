# Phase 7a — Launch Presets & Terminal Panes — Task Overview

Created by **D189** (2026-08-26) at Matthew's request, from the **BridgeMind One** launch surface he
brought in as a reference — its Solo / Pair / Workbench / Swarm presets, its vendor-logo agent grid,
and its "how many sessions" counter. Decomposed 2026-08-26 at `3c70e87` against the verified tree.

Roadmap entry: [`roadmap.md` §7 — Phase 7a](../roadmap.md). Design authority for the surface being
extended: [`docs/design/v2/Chorus Launch Dialog.dc.html`](../../../design/v2/Chorus%20Launch%20Dialog.dc.html).

## The one thing to read before this document

**The multi-agent machinery already exists; only the front door is single-file.** `LaunchDialog.vue`
builds one `LaunchRequest`, `session:launch` creates one row, `SessionManager.spawn` starts one PTY,
`App.onLaunched` appends one leaf — **exactly one agent per press**. Everything downstream already
handles N panes: `GridRenderer` wraps them by window width (**D174**), the layout tree is an ordered
list, and `suggestMode()` already advises a new worktree the moment a second session writes the same
repo.

**So this phase adds almost nothing to main.** It adds no IPC channel, no migration, and no change to
`session:launch` beyond one refusal. Worktree-per-swarm-agent comes entirely free from
`workspace_mode: 'new-worktree'`, which already creates a worktree, a branch and a journal row per
launch. **If a task finds itself designing a bulk-launch primitive in main, it has taken a wrong
turn** — see the purity contract below.

## Verified ground facts — every one checked 2026-08-26 at `3c70e87`

| Fact | Value | Where |
|---|---|---|
| `HEAD` | `3c70e87` "Release 0.7.8", branch `chorus/Chorus/2be8b104`, identical to `main` and `origin/main` | `git log`, `git worktree list` |
| app version | **0.7.8** | `package.json` |
| typecheck | **0 errors**, node + web, both sub-scripts observed running | `npm run typecheck` |
| vitest | **2969 / 2969 across 79 files in the main checkout** — ⚠ **2941 / 2941 across 78 with one file uncollected in a clean worktree**, see F103 below | `npx vitest run` |
| `grep:secrets` | **clean, 6 patterns** | `npm run grep:secrets` |
| `MIGRATIONS.length` | **22**, AST-parsed; the installed DB agrees (`MAX(version)` 22, 22 rows, contiguous). **This phase authors none** | `storage.ts:175` |
| `IpcChannel` | **110 keys, 0 spreads**, AST-parsed. **This phase adds none** | `src/shared/ipc.ts` |
| `agentKindSchema` | **5** — `claude`, `codex`, `grok`, `kimi`, `opencode` | `src/shared/ipc.ts:902` |
| `staticRegistry` | **the same 5**, so the two agree and F25's trap is not armed | `src/main/adapters/registry.ts:40` |
| `workspaceModeSchema` | **3** — `current-tree`, `new-worktree`, `existing-worktree`. **Read-only is still deferred (D22)** | `src/shared/ipc.ts:1081` |
| `LAUNCH_PANE_CAP` | **16** per project | `src/main/ipc.ts:366` |
| `sessions.agent` | unconstrained **TEXT** — which is why a new kind needs no migration | `src/main/db/schema.ts:73` |
| runtime dependencies | **9**, unchanged. **This phase adds none** — `CLAUDE.md` locks the stack | `package.json` |
| `.vue` component tests | **none exist in this repo** | — |
| `lint` | **⚠ there is no `lint` script** (`npm run lint` → *Missing script*) | `package.json` |

### ⚠ THE TEST NUMBER IS CHECKOUT-LOCAL — F103, AND EVERY TASK INHERITS IT

`src/main/services/codeIndexCore.test.ts:42` does a module-level `readFileSync` on
`_verify/6a-2/log-name-only.txt`; **`_verify/` is gitignored at `.gitignore:165` and `git ls-files
_verify` returns ZERO tracked files.** So an implementer working in a worktree will see **one file
fail to collect and 2941 / 2941 across 78 pass** — 28 tests unreachable, arriving as an `ENOENT`
collection error rather than a test failure.

**⚠ THAT IS THE EXPECTED BASELINE IN A WORKTREE AND MUST NOT BE "FIXED".** The test's own docblock
argues, correctly, that failing loudly beats an invented fixture; the defect is that the evidence was
never committed, and it belongs to whichever task first stands up CI (Phase 7). A task that weakens
that test, or copies the fixture in to make the number look right, has done the wrong thing.

### ⚠ A worktree has no `node_modules`, and the gates lie without it

Junction the main checkout's in before running anything — `C:\Projects\ContactEstablished\Chorus\node_modules`
— or `tsc` is *"not recognized"* and the gate reports a **false green**, which this document's own §5
records as the first of four false-green shapes. **Remove the junction afterwards:** left in place, an
`npm install` in the worktree writes into the main checkout.

## The decisions this kickoff settles — D184, D185, D186

**D189 created the phase and deliberately took none of these.** All three were put to Matthew on
2026-08-26 and resolved the same day.

**D184 — vendor marks, faithful and monochrome.** The icon channel finally gets an icon.
`PLAN.md` §7b names three colour channels that must never mix — **hue = project · icon =
provider/agent · state = dot + glow** — and **D38** adopts that as *"project identity by hue only;
agent identity by glyph only, never color"*. **The icon channel is therefore already assigned to the
agent**, and the rule being protected is that agent identity must never travel on **hue**, because hue
identifies projects (`shared/projectColors.ts`) and a second colour axis would collide. That rule is
preserved in full: marks are monochrome, tint with `currentColor`, no vendor brand hue enters the
palette, and the badge chrome is untouched. What changes is that the glyph gets better at being a
glyph — `cc` is a two-letter code standing in for an icon. **The override is against the mock**, which
draws the two-letter tile, and **D73** makes the mock the authority — hence a decision rather than an
edit. Precedent for exactly this scope: the seven-bar `ChorusMark`, which four v2 mocks draw wrongly.
**⚠ Marks are redrawn from each vendor's own current source at implementation time, never from memory**
— the D4 discipline `CLAUDE.md` applies to CLI flags, for the same reason: marks get restyled, and a
wrong one is worse than the two letters it replaced.

**D185 — the shell is a real `AgentKind`, and main refuses to hand it a key.**
`'shell'` joins `agentKindSchema` **and** `staticRegistry` in the same change (**F25**). The rejected
alternative is named: a `session.kind` discriminator would say structurally that a shell is not an
agent, and it is rejected **on cost** — it touches the DB schema, the wire and every session surface to
buy a distinction the six null capabilities already enforce at every call site. The binary is
**`pwsh.exe` falling back to `powershell.exe`**, resolved through the existing `resolveCli()`; the
label is **`Terminal`** everywhere. **⚠ AND THE SECURITY HALF IS A REFUSAL THE ADAPTER ROUTE DOES NOT
GIVE FOR FREE:** `session:launch` must reject a `shell` launch carrying a credential or launch
profile, keyed on `getCapabilities().apiKey === false` so it generalises. **A decrypted API key
injected into a raw shell is readable by the human at the prompt; every other adapter hands its key to
a CLI that spends it, this one would hand it to a person** — and `getAuthMethods()` returning `[]`
means the dialog never offers it, which is not the same as main refusing it.

**D186 — the preset shapes, and the Solo rule.** Four presets, a pure `shared/launchPresets.ts`
owning the table and `planLaunches()`, sequential batching, stop-on-first-failure. **⚠ THE ONE
GENUINELY AMBIGUOUS CASE WAS DECIDED EXPLICITLY: Solo at count > 1 gives agent 1 the dialog's
`suggestedMode` and agents 2..N `new-worktree`** — because by the time agent 2 launches another live
session IS writing the repo, which is precisely the condition `suggestMode()` already keys on
(`liveSessionsInRepo >= 1`). No new rule is invented; the preset applies the existing one forward
through the batch. Alternatives named and rejected: all-N-in-current-tree (they collide on any shared
file) and locking Solo to 1 (cleanest semantics, but it removes the count row the reference puts under
Solo).

## The tasks

Ordered so **the self-contained, independently shippable change lands first**, then the wire widening,
then the surface that consumes both. **Each ships as its own single narrated commit in its own
execution session** (Matthew's choice, 2026-08-26) — so each is independently reviewable and
independently revertable.

| Task | Scope | Decision | Migration | Depends on |
|---|---|---|---|---|
| **[7a-1](Task-7a-1.md)** | **Vendor marks.** New `AgentMark.vue` on `PaneIcon.vue`'s pattern, keyed off a **`Record<AgentMarkName, Mark>`** where `AgentMarkName = AgentKind | 'shell'` — the union is needed because **7a-1 ships BEFORE 7a-2, so `AgentKind` does not yet contain `'shell'` when this file is written**, and it collapses harmlessly once 7a-2 widens the enum. A record rather than a bare `v-else-if` chain because the chain is **not** exhaustiveness-checked: a missing branch renders an empty `<svg>`, which reads as a CSS bug; replaces the three `codes` maps and their tiles in `LaunchDialog.vue`, `FilmstripRenderer.vue`, `TerminalPane.vue`. Includes the `shell` mark up front so 7a-2 need not touch this file. **Renderer only; nothing crosses the wire.** | D184 | none | **None** |
| **[7a-2](Task-7a-2.md)** | **`shell` as an agent kind.** `agentKindSchema` + `staticRegistry` widen together; new `src/main/adapters/shell.ts` modelled on `grok.ts`, six capability descriptors explicitly `null`; `DETECTED_TOOLS` gains `shell`; the `Record<AgentKind, …>` label maps; **and the credential refusal in `session:launch`**. | D185 | **none** — `sessions.agent` is TEXT | 7a-1 (for the mark) |
| **[7a-3](Task-7a-3.md)** | **Presets, "how many", batch launch.** New pure `src/shared/launchPresets.ts` + tests owning the preset table and `planLaunches()`; `submit()` becomes a sequential loop; preset row, count row and "Will launch" strip in the dialog; **both F104 mitigations**. | D186 | none | 7a-1 **and** 7a-2 |

**⚠ NO TASK IN THIS PHASE ADDS AN IPC CHANNEL, A MIGRATION, OR A DEPENDENCY.** `IpcChannel` stays
**110**, `MIGRATIONS.length` stays **22**, runtime deps stay **9**. A task that finds it needs one has
found a design problem, not a number — **stop and raise it** rather than claiming the next value.
Re-count at pickup regardless (**G6**): never quote a counter from this document.

**⚠ THE THREE TASK DOCUMENTS WERE AUTHORED IN PARALLEL AGAINST `3c70e87`, SO EVERY LINE NUMBER IN A
LATER TASK'S *Initial Starting Point* IS A KICKOFF-DAY POINTER AND IS RE-TAKEN AT PICKUP.** Concretely:
7a-1 **deletes** the three `codes` maps, so 7a-2 finds `LaunchDialog.vue:608`, `FilmstripRenderer.vue:100`
and `TerminalPane.vue:80` already gone and touches no `.vue` glyph code at all; 7a-3 builds its
Will-launch strip on *7a-1's* `AgentMark`, and its Workbench preset on *7a-2's* `shell` kind. An
implementer who trusts a stale line number will edit the wrong line.

### ⚠ The trap in 7a-2 that would otherwise cost a session

`src/main/adapters/adapters.test.ts` holds **FIVE hand-maintained sites a new registry adapter
interacts with, and they fall into three different kinds.** Task 7a-2 carries the full treatment; the
shape of the trap is that **the compiler catches none of them.**

**(i) Three GUARDED tables that must gain a `shell: false` row**, typed `Record<string, boolean>`
rather than `Record<AgentKind, …>`: `RESUME_SUPPORT` (`:934`), `MCP_SUPPORT` (`:990`),
`HOOKS_SUPPORT` (`:1037`). Each is asserted to name every registry key, so omitting one fails
loudly — the good case.

**(ii) Two UNGUARDED hand-lists that must ALSO gain `shell`, and which fail SILENTLY if they do
not** — `:1488-1494` (the no-resume-modifier `it.each`) and `:1902-1907` (`supportsInstructions`).
Neither carries a registry-coverage assertion, so omitting `shell` leaves the suite **green while
covering less** — precisely the failure shape that let kimi and opencode pass through three phases
without ever seeing capability honesty.

**(iii) One list that must be LEFT ALONE — `const adapters` at `:59`**, the launch-behaviour list.
It breaks **two** ways for a null-capability adapter: its cases dereference the effort descriptor with
a non-null assertion (`:258`), **and** the `expectedArgs()` helper at `:162` calls
**`resolveCli(adapter.id)`**, which **throws** for a name that is not on PATH
(`cliDetect.ts:117-131`) — and there is no `shell.exe`. kimi and opencode are already excluded for
the first reason and the file says so.

**⚠ THE SAME `resolveCli` FACT CONSTRAINS THE ADAPTER ITSELF:** `detectInstallation` must resolve
`pwsh`/`powershell` explicitly and must **not** probe its own `id`, because `resolveCli('shell')`
throws rather than returning a miss.

`capabilityAdapters` (`:88`) is derived from the registry and needs no edit.

## The milestone

**From one press of Launch, a Swarm of four lands as four panes on four distinct worktrees** under
`<repo-parent>\.chorus\<repo>\wt-*`, on four distinct `chorus/<repo>/<id>` branches, all four listed
in `WorktreePanel`, with the view switched to grid — **and Solo still sends a payload byte-identical
to today's dialog.**

That second clause is the one that matters most. Every preset is new surface; **Solo is the
regression**, and a phase that ships four working presets and a changed Solo payload has failed.

## The purity contract for this phase

1. **No new IPC channel, no migration, no dependency.** Stated above; repeated because it is the
   cheapest thing to violate by accident.
2. **`session:launch` gains exactly one thing: a refusal.** No batch handler, no bulk primitive, no
   second launch entry point. **D174(b)** collapsed all three launch paths onto the single line
   `layout.appendLaunchedLeaf(id)` *"so they can no longer disagree about where a session lands"* — **a
   batch is N sequential trips through that same line**, in order.
3. **The `...(x ? {k:x} : {})` spread discipline in `submit()` (`LaunchDialog.vue:724-767`) is
   preserved verbatim.** It is what keeps an untouched control from sending a field, and it is
   load-bearing for D90's rank 0, D179 and the authored identity. **The loop wraps that payload; it
   does not rewrite it.**
   **⚠ AND D186's "the per-agent controls apply to the whole batch" IS TRUE ONLY WHERE EVERY SLOT IS
   THE PICKED AGENT — i.e. Solo and Swarm.** Task 7a-3 found the correction and it is load-bearing:
   `main/ipc.ts:1728-1729` refuses a mismatched profile outright (*"That launch profile is for codex,
   not claude."*), so a Pair that forwarded `launch_profile_id` to its partner slot would fail at
   slot 2 **on the happy path**; `permissionModeSchema` is one enum spanning two different ladders
   (D183); and a model id is route-scoped. The rule is therefore `own = slot.agent === picked`,
   gating the agent-specific fields — not a blanket copy.
4. **Absent, not disabled**, for any control that cannot apply — the standing rule at
   `LaunchDialog.vue:158-167`. The count row does not render for Pair and Workbench; a Terminal card
   renders no model, effort or permission control.
5. **Never render a fact the app cannot source** (**D76**): the Will-launch strip is omitted rather
   than shown empty or as "0 sessions".
6. **No new global hotkey** (**D180(g)**): the hotkey listener is capture-phase and `preventDefault`s,
   so anything it binds is stolen from every agent terminal. Preset selection is dialog-local
   keyboard handling inside the existing focus trap.
7. **Roles are a label, not an enforcement.** Chorus has no read-only workspace mode (**D22**), so
   Pair's reviewer writes the same tree as the builder. The blurb must say so rather than implying a
   sandbox.

## Verification every task runs

```
# a worktree has no node_modules — junction the main checkout's in FIRST, remove it after
npm run typecheck          # 0 errors, node + web
npx vitest run             # ⚠ 2941 / 78 in a worktree (F103), 2969 / 79 in the main checkout
npm run grep:secrets       # clean, 6 patterns
```

Plus, per task, the runtime drive named in its own *Verification Commands* section — **this project
does not accept a compiled feature as a delivered one** (roadmap §3, step 4). Drives run against a
real window on a `--user-data-dir` **seeded from `%APPDATA%\chorus-app`** (the dev DB has no
credentials, so credential paths look broken without it), driven over CDP on **port 9333 — never
9222**, which is the stable instance. **The failure-honesty clause applies**: a command that fails for
any reason, including an environmental one, is reported with its output and the step is not claimed.

Also re-assert, by AST and not by grep: `MIGRATIONS.length` **22**, `IpcChannel` **110**, runtime
dependencies **9** — all three unchanged by every task in this phase.

## ⚠ Pre-existing working-tree state at kickoff

`git status` at `3c70e87` carries **two modified files and no untracked files**:

- **`.mcp.json`** — a **line-ending artifact only** (`git diff` reports no content change, just an
  LF/CRLF warning). It predates this kickoff.
- **`docs/Features/Foundation/roadmap.md`** — this session's architect pass (D189 and D187, F102–F104, the
  Phase 7a entry, the §5 re-verification, and the SHA stamps on D179/D180/F101).

**⚠ NO TASK MAY REVERT, COMMIT, OR ABSORB EITHER OF THEM**, and a task that finds *other* modified
files must report them rather than tidying them away. This kickoff's own additions are this document
plus `Task-7a-1..3.md` and `ImplementationSpec-7a-1..3.md`.

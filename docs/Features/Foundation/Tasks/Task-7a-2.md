# Task 7a-2 — `shell` as an agent kind

_Phase 7a, task 2 of 3. Authored 2026-08-26 against `3c70e87`. Every `file:line` below was opened and
checked in this authoring session; **re-take them at pickup**, because 7a-1 lands first and deletes
three `codes` maps out of the two `.vue` files this task also touches (Overview, "authored in
parallel")._

## Source Of Truth

| Document | Owns |
|---|---|
| [`Phase-7a-Overview.md`](Phase-7a-Overview.md) | The verified ground facts, the phase's purity contract, the F103 baseline and the pre-existing working-tree state. **Use its table, never a number recalled from a decision row** |
| `roadmap.md` §6 — **D185** | The ruling this task executes, word for word: a real `AgentKind`, `pwsh`→`powershell` through `resolveCli()`, the label `Terminal`, and **the refusal the adapter route does not give for free** |
| `roadmap.md` §6 — **D189(d)**, **D34(b)**, **F25** | Why `agentKindSchema` and `staticRegistry` widen in the SAME change, and what breaks when they do not |
| `roadmap.md` §6 — D34 Q1, **D148**, D129, D76, D22 | Declared-iff-implemented; the six required-and-nullable descriptors; three lights not four; never render a fact the app cannot source; no read-only workspace mode |
| [`../AdapterAuthoring.md`](../AdapterAuthoring.md) | The adapter contract in prose — the shape, the narrowing idiom, why each guard checks BOTH halves, and the `null` vs `undefined` rule. **Read it before opening `grok.ts`** |
| [`../ImplementationSpecs/ImplementationSpec-7a-2.md`](../ImplementationSpecs/ImplementationSpec-7a-2.md) | Exact insertion points, the adapter's code shape, the refusal's wording, the test cases, the runtime checks |
| `src/main/adapters/grok.ts` (322 lines) | **The model to follow.** The newest adapter, written to the current contract, and the one whose file layout this task copies — `id`/`displayName`/`executionMode` `:48`–`:50`, `requiredEnvVars` `:61`, `detectInstallation` `:63`, `getAuthMethods` `:71`, `getCapabilities` `:102`, `buildLaunch` `:141` |
| `src/main/adapters/registry.ts:9`–`:38` | The widen-together rule in the file that enforces it, with D86/D90/D165 as three worked precedents. The new entry's comment is written in that voice |

## Initial Starting Point — verified 2026-08-26 at `3c70e87`

| Fact | Where | Value |
|---|---|---|
| Tree | `git status` | `HEAD` `3c70e87`, branch `chorus/Chorus/2be8b104` == `main` == `origin/main`. Modified: **`.mcp.json`** (a line-ending artifact) and **`docs/Features/Foundation/roadmap.md`** (the architect pass). Untracked: this phase's own documents |
| Gates | Overview | typecheck **0** · vitest **2969 / 79 in the MAIN CHECKOUT**, **2941 / 78 + one file uncollected in a clean worktree (F103)** · `grep:secrets` clean, 6 patterns · **there is no `lint` script** |
| Migration | `schema.ts:73` | **NONE.** `sessions.agent` is unconstrained `TEXT` — *"an AgentKind (`agentKindSchema`) — unconstrained TEXT, see storage.ts"*. `MIGRATIONS.length` is **22** and stays 22 |
| The widen-together pair | `src/shared/ipc.ts:902` · `src/main/adapters/registry.ts:40` | `z.enum(['claude','codex','grok','kimi','opencode'])` and `Readonly<Record<AgentKind, AgentAdapter>>` — **5 and 5, so F25's trap is not armed today**. Both become 6 in one change |
| The pin that proves it | `adapters.test.ts:845` | `expect(Object.keys(staticRegistry).sort()).toEqual([...agentKindSchema.options].sort())` — green if both widen, red if one does |
| The id pin | `adapters.test.ts:446`–`:448` | `staticRegistry[kind].id` must equal the kind, so the adapter's `id` is exactly `'shell'` |
| `AgentCapabilities` | `src/main/adapters/types.ts:45`–`:69` | **five booleans** (`interactiveTerminal`, `worktreeSafe`, `skills`, `subscriptionLogin`, `apiKey`) + **six required-and-nullable descriptors** (`reasoningEffort`, `permissionMode`, `sessionResume`, `mcp`, `hooks`, `instructions`). `:64`–`:68` records that they are required-and-nullable *"precisely so the capability-honesty test in `adapters.test.ts` [can] prove declared-iff-implemented across the whole registry (D148)"* |
| The wire already accepts all-nulls | `src/shared/ipc.ts:2928`–`:2944` · `:2959` | `agentCapabilitiesSchema` makes all six `.nullable()` and `adapterDescriptorSchema.authMethods` is a bare `z.array` — **so an empty `authMethods` and six nulls need NO schema change** |
| `PtyAgentAdapter` · `PtyLaunchRequest` | `types.ts:421` · `types.ts:634` | `buildLaunch` is **synchronous by necessity** (`:428`–`:430`: `SessionManager.launch()` returns a snapshot synchronously). The request is `{executable, args, cwd, envAdditions, secretEnv}` |
| CLI resolution | `cliDetect.ts:36` `pickSpawnable` · `:117` `resolveCli` · `:167` `probeCli` | `resolveCli(name)` runs `where.exe <name>` and **throws** when nothing spawnable is found. `probeCli(name)` additionally spawns `<name> --version` with a 10 s timeout |
| `DETECTED_TOOLS` | `cliDetect.ts:145` | `['claude','codex','kimi','opencode','grok','git','docker','node']`. `probeAll` (`:220`) routes a name through `detectViaAdapter` when `getAdapter(name)` hits and through `detectOne` otherwise, so **registering the adapter is what makes `'shell'` an agent probe rather than a plain tool** |
| The dialog's agent filter | `LaunchDialog.vue:516` · `:512` | cards are `c.agentKind !== null` minus `HIDDEN_AGENTS = ['kimi']`. `git`/`docker`/`node` carry `agentKind: null` (`cliDetect.ts:200`) and are excluded there |
| The card's version line | `LaunchDialog.vue:886` | `{{ a.found ? a.version : 'not found' }}` — **a `found: true, version: null` card renders a BLANK line**, which is the honest form of "no version claimed" and is what this task ships |
| The existing refusal | `src/main/ipc.ts:1697`–`:1699` | `if (req.launch_profile_id && req.credential_profile_id) return { ok: false, reason: 'Pick a launch profile or a credential, not both.' }` — **the new guard goes immediately beside it**, in the same voice |
| `LAUNCH_PANE_CAP` | `src/main/ipc.ts:366` | **16** per project. Unchanged by this task |
| The compiler-enforced label maps | `notifications.ts:11` · `palette/commands.ts:49` · `FilmstripRenderer.vue:88` · `TerminalPane.vue:71` | four `Record<AgentKind, string>` maps. `notifications.ts:6`–`:10` says out loud that the compiler finding them *"is the property working, not a chore"* — D86, D90 and D165 each proved it |
| The map that is NOT enforced | `TerminalPane.vue:112` | `USER_ROW_MARKER: Partial<Record<AgentKind, string>>` — **and `:107`–`:109` says an agent with no entry renders exactly as it does today.** It gets no `shell` entry |
| The name pool | `src/shared/agentNames.ts` (79 lines) | 40 names; `suggestAgentName` at `:71`. Called from `LaunchDialog.vue:591` (once per open) and `:94` (`rerollName`) |
| Env policy | `src/main/adapters/env.ts:131` `composeChildEnv` | with an **empty `secretEnv`** the launch takes the no-credential branch and **inherits `process.env` wholesale** plus `PINNED_ENV_VARS` — today's behaviour for every subscription-auth launch, unchanged |
| Hookless activity | `sessionManager.ts:820` | `if (this.hooks && !supportsHooks(adapter)) this.hooks.registerOutputDriven(sessionId)` — **so a `shell` session is output-driven at spawn** (D183). See fact 6 below |
| Baseline for this task | — | `MIGRATIONS.length` **22** · `IpcChannel` **110** · runtime deps **9** · `agentKindSchema` **5 → 6** · `staticRegistry` **5 → 6** |

### ⚠ Six facts that will cost a session if they are not believed

1. **`src/main/adapters/adapters.test.ts` HOLDS FOUR LISTS A NEW REGISTRY ADAPTER INTERACTS WITH, THEY
   BEHAVE DIFFERENTLY, AND THE COMPILER CATCHES NONE OF THE THREE THAT NEED EDITING.**

   - **`const adapters` at `:59`** = `[claudeAdapter, codexAdapter, grokAdapter]` — the
     **LAUNCH-BEHAVIOUR** list driving the `describe.each` at `:214`. **⚠ DO NOT ADD `shell` TO IT.**
     It breaks **two** ways, and the file already documents the first: `:258` reads
     `adapter.getCapabilities().reasoningEffort!.levels` through a non-null assertion, so an adapter
     with `reasoningEffort: null` **crashes the suite** — the comment at `:62`–`:85` says widening
     `adapters` *"breaks EIGHT tests"* and that kimi and opencode are excluded for exactly this.
     **`shell` is the third such adapter.** The second way is measured in this session and is
     *unique to `shell`*: the helper `expectedArgs()` at `:162` calls **`resolveCli(adapter.id)`**
     (`:168`), and `resolveCli('shell')` **throws** — there is no `shell.exe` on PATH and there never
     will be. The same trap sits in the hand-listed `it.each` at **`:1488`–`:1494`** ("a launch with
     NO resume modifier adds no resume tokens for %s"), which names all five adapters and calls
     `expectedArgs(adapter)`. **`shell` joins neither.**
   - **`capabilityAdapters` at `:88`** = `Object.values(staticRegistry).filter(isPtyAdapter)` —
     **automatic**. `shell` joins it the moment it is registered, because it is a PTY adapter. `:909`
     asserts the list equals `Object.keys(staticRegistry)`, and its comment names the failure it
     guards: *"a new adapter that failed to reach `capabilityAdapters` would make every loop below
     pass by covering less — the failure mode that let kimi and opencode go through three phases
     without ever seeing capability honesty."*
   - **Three hand-maintained tables, each `Readonly<Record<string, boolean>>` — typed `string`, NOT
     `AgentKind`, so the compiler will not help** — each asserted to name every registry key:
     `RESUME_SUPPORT` `:934` (asserted `:962`), `MCP_SUPPORT` `:990` (asserted `:1012`),
     `HOOKS_SUPPORT` `:1037` (asserted `:1046`). **Each needs a `shell: false` entry with a reason
     comment**, matching the file's own stated intent that *"each `false` below is a MEASURED position
     with a reason attached, not a default."* Omit one and the suite goes red with a clear message;
     that failure is the mechanism working.
   - `:845` pins `Object.keys(staticRegistry).sort()` against `[...agentKindSchema.options].sort()` —
     **the widen-together pin**, green only if both widen.

   **⚠ AND THERE IS A FIFTH SITE THE OVERVIEW'S "four lists" DOES NOT COVER, BECAUSE IT IS NOT A LIST
   AND IT FAILS *QUIETLY* RATHER THAN LOUDLY.** `:1902`–`:1907` is a hand-written `it` naming all five
   adapters by hand: `expect(supportsInstructions(claudeAdapter)).toBe(true)` … `(grokAdapter)).toBe(false)`.
   Nothing asserts it covers the registry, so **omitting `shell` there leaves it green and
   under-covering** — the exact shape of Overview FINDING 1. Add the line.

2. **`detectInstallation()` MUST NOT BE `return probeCli(this.id)`, AND COPYING `grok.ts:68` VERBATIM
   IS THE SINGLE EASIEST WAY TO LOSE THIS SESSION.** `this.id` is `'shell'`; there is no `shell.exe`,
   so `probeCli('shell')` returns `{found: false, path: null, version: null}` **every time, with no
   error anywhere**. The card renders "not found", the Terminal option looks broken, and every unit
   test still passes because no test asserts detection succeeds. The id is the **registry key**, not
   the binary — for the first time in this codebase those are different things, and the whole shape of
   this adapter follows from that one divergence.

3. **THE CREDENTIAL REFUSAL IS NOT THEORETICAL — IT IS REACHABLE IN TWO CLICKS TODAY, AND THE DIALOG
   DOES NOT CLOSE IT.** Measured this session: selecting a launch profile sets
   `selected.value = profile.agent` (`LaunchDialog.vue:447`) but **clicking a different agent card
   does not clear `selectedLaunchProfileId`** — and `submit()` sends `launch_profile_id` whenever it
   is set (`:737`–`:739`). So *pick a credential-bearing profile, then click **Terminal**, then
   Launch* reaches `session:launch` with `agent: 'shell'` **and** a profile that main resolves to a
   decrypted key. Main injects it into the child env, and a human at a PowerShell prompt reads it with
   `echo $env:ANTHROPIC_API_KEY`. **Every other adapter hands its key to a CLI that spends it; this one
   would hand it to a person.** The dialog is not the security boundary — main is: `getAuthMethods()`
   returning `[]` means the dialog never *offers* it, which is a different statement from main
   refusing it.

4. **⚠ `apiKey === false` IS NOT UNIQUE TO `shell` — `kimi.ts:94` DECLARES IT TOO, FOR A DIFFERENT
   REASON, AND A GUARD WRITTEN WITHOUT CHECKING THIS CHANGES KIMI'S BEHAVIOUR.** kimi's comment
   (`:87`–`:94`) is explicit: *"There is no `--api-key` flag and no env var kimi reads for one … Chorus
   cannot hand this CLI a key at launch."* So D185's predicate — deliberately general, and correctly
   so — sweeps kimi in. For the **credential** half that is strictly an improvement (a key that
   reaches kimi is ignored by kimi and gains nothing but exposure). For the **launch-profile** half it
   is a live behaviour change: a *credential-free* kimi profile would start being refused. **§0
   measures whether any such row exists** and the spec's §5 states the default and the divergence
   rule. **Do not resolve this by narrowing the predicate to the string `'shell'`** — that is the one
   move D185 explicitly rules out.

5. **THE GATES LIE IN A WORKTREE UNLESS YOU JUNCTION `node_modules` FIRST, AND THEN THEY REPORT A
   NUMBER THAT IS NOT THE MAIN CHECKOUT'S.** Without the junction `tsc` is *"not recognized"* and
   typecheck reports a **false green**. With it, the expected baseline is **2941 / 78 with one file
   uncollected** — `codeIndexCore.test.ts:42` does a module-level `readFileSync` on `_verify/6a-2/…`,
   `_verify/` is gitignored at `.gitignore:165`, and `git ls-files _verify` returns **zero** tracked
   files (**F103**). **That is the expected baseline and must NOT be "fixed"**: copying the fixture in
   or weakening the test is the wrong answer, and the right one belongs to whichever task stands up
   CI. **Remove the junction afterwards** — left in place, an `npm install` in the worktree writes
   into the main checkout. ⚠ And remove it with a link-aware delete: a recursive force-delete of a
   junction has historically deleted *through* it, and the target is the main checkout's
   `node_modules`.

6. **A `shell` PANE'S ACTIVITY LIGHT WILL FLICKER WHILE THE USER TYPES, AND THAT IS D183 WORKING, NOT
   A DEFECT THIS TASK INTRODUCES.** `shell` declares `hooks: null`, so `supportsHooks` is false, so
   `sessionManager.ts:820` registers the session **output-driven** — PTY output may *create* a
   `working` claim, expiring on `OUTPUT_STALE_MS` (10 s). A shell echoes the user's own keystrokes, so
   the bar lights while a human types and goes out ten seconds after they stop. **The pane still has
   the same three states `codex` and `opencode` have (D129), not four** — no amber, because
   `needs-you` rides the hook bus. **This task changes none of it.** Expect it in the drive, record it,
   and do not "fix" the activity mechanism from inside an adapter task; if it should be suppressed for
   no-agent kinds, that is a decision, not an edit.

## Goal

**Make a real shell one of the things a pane can be**, so that Workbench — *"an agent plus a shell in
the same tree"*, D189(b) — has something to launch, and so that a user who wants a terminal beside
their agents gets one from the surface they already use instead of alt-tabbing to Windows Terminal.

The whole feature is **one adapter and one refusal**. Everything else Chorus already does for a pane —
spawn, attach, restore, restart, rename, close, worktree, grid — is agent-kind-agnostic and comes free
the moment `'shell'` is a kind the registry answers for. That is the *argument for the adapter route
and against a `session.kind` discriminator*, and it is the decision D185 took: a discriminator would
say structurally that a shell is not an agent, and it is **rejected on cost** — it touches the DB
schema, the wire and every session surface to buy a distinction **the six null capabilities already
enforce at every call site**. `supportsMcp`, `supportsHooks`, `supportsResume` and
`supportsInstructions` each narrow to `false` for this adapter *by the existing rule*, so `withMcpEnv`
writes nothing, no hook config is minted, no resume pointer is assigned and no instructions file is
written — without one line of `if (kind === 'shell')` anywhere.

**The one thing the adapter route does not give for free is a refusal, and it is the security half of
this task.** An adapter can decline to *ask* for a credential; it cannot stop main from *resolving*
one that arrived on the launch payload. Fact 3 above is the reachable path. So `session:launch` grows
one guard, keyed on a **capability** rather than on the string `'shell'`, so the next no-auth adapter
inherits it.

## Exact Scope

**Create**

- `src/main/adapters/shell.ts` — the adapter. **One file.** Modelled on `grok.ts`'s layout, which is
  the newest adapter written to the current contract.

**Edit**

- `src/shared/ipc.ts` — `agentKindSchema` gains `'shell'` (**`:902`**), with the docblock paragraph the
  four kinds before it each got.
- `src/main/adapters/registry.ts` — the import and the sixth `staticRegistry` entry, with the
  widen-together note in `:19`–`:38`'s voice.
- `src/main/services/cliDetect.ts` — `'shell'` joins `DETECTED_TOOLS` (`:145`) **after `'grok'` and
  before `'git'`**, so the Terminal card lands last among agents and ahead of the plain tools.
- `src/main/ipc.ts` — **the refusal**, immediately beside `:1697`–`:1699`.
- `src/main/services/notifications.ts` — `AGENT_LABELS` (`:11`) gains `shell: 'Terminal'`.
- `src/renderer/src/palette/commands.ts` — `labels` (`:49`) gains the same.
- `src/renderer/src/components/FilmstripRenderer.vue` — `labels` (`:88`) gains the same.
- `src/renderer/src/components/TerminalPane.vue` — `labels` (`:71`) gains the same. **`USER_ROW_MARKER`
  at `:112` does NOT.**
- `src/renderer/src/components/LaunchDialog.vue` — **two behaviours, no glyph code**: the name
  suggestion is withheld for `shell`, and the Auth control does not render for an adapter that
  declares no auth methods.
- `src/main/adapters/adapters.test.ts` — a `shell` block; **one row each** in `RESUME_SUPPORT`,
  `MCP_SUPPORT` and `HOOKS_SUPPORT`; one line in the `supportsInstructions` case at `:1902`.

**Nothing else.**

## Non-Goals

- **⚠ NO MIGRATION.** `sessions.agent` is unconstrained `TEXT` (`schema.ts:73`), so a new kind needs no
  schema version. `MIGRATIONS.length` stays **22** — **AST-parse `storage.ts:171`, never grep**: the
  comments *between* array elements contain backticks (`storage.ts:196`), so any character scanner
  returns garbage. If a `MIGRATIONS` edit feels necessary, something else is wrong.
- **No new IPC channel and no schema change on the wire.** `IpcChannel` stays **110**.
  `agentCapabilitiesSchema` already makes all six descriptors `.nullable()` and `authMethods` is a
  bare `z.array` — an all-null, no-auth adapter is a shape the wire has always accepted, and this task
  proves it rather than widening it.
- **No new dependency.** Runtime deps stay **9**; `CLAUDE.md` locks the stack.
- **No `session.kind` discriminator.** D185's rejected alternative, rejected on cost (Goal, above).
  Nothing in this task may introduce a second axis for "is this an agent".
- **No second shell option — no `cmd.exe`, no `bash`, no WSL, no user-chosen shell, and no startup
  profile or `-NoProfile` flag.** One kind, one binary policy (`pwsh` → `powershell`), zero arguments.
  A shell picker is a settings surface, and this phase builds none; **`-NoProfile` in particular is a
  judgement about the user's own machine and is deliberately not taken** — the user's PowerShell
  profile is the shell they expect.
- **⚠ NO `.vue` GLYPH CODE.** The `codes` maps are **7a-1's to delete**, and 7a-1 already supplies the
  `shell` mark in `AgentMark.vue`. If 7a-1 has landed, there is nothing to draw here; see Dependencies
  for the one-branch fallback if it has not.
- **No `shell` entry in `USER_ROW_MARKER`** (`TerminalPane.vue:112`). It is
  `Partial<Record<AgentKind, string>>` — not compiler-enforced — and `:107`–`:109` states the rule: an
  agent with no entry renders exactly as it does today, because the alternative is *"a fallback that
  guesses a marker and mis-colours the agent's own output."* Every glyph in that map is measured from
  a real PTY capture; a shell has no author glyph to measure.
- **No change to the activity-light mechanism.** Fact 6. `shell` is output-driven at spawn like every
  hookless adapter; three states, not four (D129). Observe it, report it, change nothing.
- **⚠ DO NOT ADD `shell` TO `const adapters` (`adapters.test.ts:59`) OR TO THE `it.each` AT `:1488`.**
  Two separate crashes — the `reasoningEffort!` dereference and `resolveCli('shell')` throwing (fact
  1). Both lists are launch-behaviour lists for adapters with levelled descriptors and a real binary
  on PATH under their own id.
- **No weakening of any existing assertion.** `adapters.test.ts` must pass **unchanged in structure**:
  the three tables gain a row each, one hand-listed case gains a line, and a new `describe` is added.
  Nothing is relaxed from `toEqual` to `toContain`, and no loop is narrowed.
- **⚠ Do not revert, stage, or absorb the two pre-existing modified files.** `.mcp.json` (a
  line-ending artifact) and `roadmap.md` (this session's architect pass) were modified before this
  task and **must not appear in its commit**. Report anything else you find; tidy nothing.
- **This task does not touch presets, the count row, or batch launch.** That is 7a-3, and it depends
  on this one.

## Dependencies

**Task 7a-1 — for one reason only: the mark.** 7a-1 creates `AgentMark.vue` keyed off a
`Record<AgentKind, …>` and includes the `shell` entry up front *"so 7a-2 need not touch this file"*
(Overview). If 7a-1 has landed, this task touches **no `.vue` glyph code at all** — the three `codes`
maps are gone and the mark exists.

> ### ⚠ IF 7a-1 HAS NOT LANDED, THIS TASK MUST ADD THAT ONE BRANCH ITSELF — AND IT IS THE COMPILER THAT
> WILL TELL YOU WHICH WORLD YOU ARE IN.
>
> At `3c70e87` **`AgentMark.vue` does not exist** and the `codes` maps do (`FilmstripRenderer.vue:100`,
> `TerminalPane.vue:80`, `LaunchDialog.vue:608`), each typed `Record<AgentKind, string>`. In that
> world the typecheck flags **three more sites**, and this task adds a two-letter code to each rather
> than inventing a mark — **`>_`** is the entry, matching what 7a-1 will draw. Do not build a mark
> component here; that is 7a-1's scope and duplicating it creates the second home D48's whole family
> of decisions exists to prevent. **Say in the report which world you were in.**

**Nothing else.** No task in Phase 7a has landed in main; 7a-3 depends on this one, not the reverse.

**Ships as its own single narrated commit in its own execution session** (Matthew, 2026-08-26), so it
is independently reviewable and independently revertable.

## Step-by-step Work

1. **Run §0 of the spec before writing a line.** Re-take the gates with the junction in place; AST-parse
   `MIGRATIONS.length` (expect **22**) and `IpcChannel` (expect **110**); **resolve both shell
   candidates by hand** (`where.exe pwsh`, `where.exe powershell`) and record what came back, whether
   each is a real `.exe`, and **how long `where.exe` takes** — `resolveCli` is synchronous and
   `detectInstallation` will pay for it on every dialog open; and **run the `launch_profiles` census**
   that decides fact 4's open question. **Paste every output into the report.** A number quoted from
   this document rather than measured is the thing G6 exists to stop.
2. **`src/main/adapters/shell.ts`.** `id: 'shell'`, `displayName: 'Terminal'`, `executionMode: 'pty'`,
   `requiredEnvVars: []`. One shared resolver — `pwsh` first, `powershell` second — used by **both**
   `detectInstallation` and `buildLaunch`, so detection and launch can never disagree about which
   binary the user gets. That is the same "ONE probe implementation, not a per-adapter copy that
   drifts" rule `probeCli`'s docblock (`cliDetect.ts:157`–`:163`) already states, applied one level
   in.
3. **`detectInstallation()`: the resolved `path`, and `version: null`.** **Not `probeCli`** (fact 2:
   `this.id` is not a binary — and `probeCli` would additionally spawn `<shell> --version` on every
   dialog open, with a 10-second timeout, for a string this card does not need). `version: null`
   renders a blank line at `LaunchDialog.vue:886`, which is the honest form of "no version claimed"
   (D76: omit rather than stub). **Say in the code why the `$PSVersionTable` probe was refused**: it
   is a process spawn per dialog open to print a number that identifies the user's Windows install,
   not the agent, and nothing in Chorus acts on it.
4. **`getAuthMethods(): []`.** The empty array **is** the declaration — kimi's comment at `:60`–`:62`
   makes the same move for the same reason (*"the ABSENCE of `api_key` is the declaration"*). A
   Terminal has nothing to log into and nothing to bill.
5. **`getCapabilities()`: five booleans, six explicit nulls, and a reason on every one.**
   `interactiveTerminal: true` · `worktreeSafe: true` · `skills: false` · `subscriptionLogin: false` ·
   `apiKey: false` · and `reasoningEffort`, `permissionMode`, `sessionResume`, `mcp`, `hooks`,
   `instructions` **all `null`**. **⚠ Each null here means "this thing does not exist for a shell",
   which is a stronger claim than the "unmeasured" that `grok.ts:126`/`:132`/`:137` records — say so,
   because the two look identical in the type and are opposite statements.** Spell out what each null
   buys, since the point of the design is that they buy everything: no model select, no effort
   segment, no permission segment (**absent, not disabled** — `LaunchDialog.vue:158`–`:167`);
   `supportsMcp` / `supportsInstructions` / `supportsResume` / `supportsHooks` all narrow to `false`,
   so `withMcpEnv` writes nothing, no hook config is minted, no resume pointer is assigned; and the
   pane gets the same **three** lights `codex` and `opencode` get (D129), not four.
6. **`buildLaunch(spec)`: the resolved shell, no arguments Chorus authors, `{}` and `{}`.** It reads
   **`spec.cwd` and nothing else** — not `credential`, not `route`, not `modelId`, not
   `effortOptionId`, not `permissionModeId`, not `resume`, not `extraArgs`. **`secretEnv: {}` written
   as a literal, NOT through `buildSecretEnv(spec.credential)`**, and the spec's §1 argues that
   divergence from kimi's precedent explicitly: kimi routes through the shared helper *"so that if D87
   ever gives kimi a key path it inherits the same handling"*, which is a reason to keep a door open —
   here the door is the defect, and a literal `{}` is a promise the type system keeps.
7. **`src/shared/ipc.ts` and `src/main/adapters/registry.ts`, in the SAME edit.** F25 is why
   (`registry.ts:31`–`:38`): `layout:get`'s filter treats registry membership as proof of schema
   validity, so a kind in one and not the other passes the filter and then fails the outbound parse.
   The `Record<AgentKind, …>` type makes it a build failure **in both directions** — which is a reason
   to do them together in one commit, not a licence to do them in either order and lean on `tsc`.
8. **`DETECTED_TOOLS`.** `'shell'` after `'grok'`, before `'git'`. Extend the D86/D90/D165 comment
   block at `:135`–`:144` with the same shape of note — it is the one home for launch-card order, and
   it says so.
9. **The four `Record<AgentKind, string>` label maps.** `shell: 'Terminal'` in each, sourced from the
   adapter's own `displayName` (the rule `notifications.ts:10` already states: *"Labels mirror each
   adapter's own `displayName`"*). The compiler finds all four; **let it**, and record in the report
   that it did.
10. **`src/main/ipc.ts`: the refusal.** Beside `:1697`–`:1699`, keyed on
    **`getCapabilities().apiKey === false`**, with the one-sentence reason in the code: *a decrypted
    API key injected into a raw shell is readable by the human at the prompt; every other adapter
    hands its key to a CLI that spends it, this one would hand it to a person.* Add the second
    sentence a reviewer needs: **the dialog is not the security boundary, main is** —
    `getAuthMethods()` returning `[]` means the dialog never offers it, which is not the same as main
    refusing it. **Resolve fact 4's kimi question from §0's census, in the code comment, with the
    number.**
11. **`LaunchDialog.vue`: the name suggestion.** A terminal called "Bob" is noise — the pane already
    reads `Terminal`, which is correct and needs no name. Withhold the suggestion and **do not render**
    the reroll glyph for `shell` (absent, not disabled, `:158`–`:167`). Three requirements, however it
    is written: (i) selecting Terminal never leaves a person's name in a field the user did not type;
    (ii) **text the user typed is never destroyed by an agent switch**; (iii) switching away from
    Terminal restores what was suppressed rather than rolling a fresh name. Key it off a named
    `readonly AgentKind[]` in `HIDDEN_AGENTS`'s idiom (`:512`), not off a capability — see the spec's
    §7 for why inventing a capability to carry a naming preference is the wrong trade.
12. **`LaunchDialog.vue`: the Auth control.** With `getAuthMethods()` empty, the "Auth" segment still
    renders a lone `subscription` button today (`:959`–`:978`) — a control with nothing behind it, on
    the one card where the app's answer is *"there is no auth here"*. Gate the **section** (not the
    row — the Model section shares it) on the selected adapter's declared `authMethods`, **three-state:
    render while the list is unknown, hide only once it is known-empty.** That is
    `AdapterAuthoring.md`'s `null` vs `undefined` rule applied to a render decision, and without it
    every card loses its Auth control for the moment before `adapter:list` lands.
13. **`adapters.test.ts`.** A `describe('shell (D185)')` block, **one row each** in the three tables
    with a reason comment, and one line in `:1902`'s hand-written case. **Nothing else in the file
    moves.**
14. **Run every gate, then the runtime drive.** A compiled feature is not a delivered one (roadmap §3,
    step 4).

## Test Expectations

**`src/main/adapters/adapters.test.ts` — a new `describe('shell (D185)')`, in `grok`'s block's shape
(`:690`–`:825`):**

- **identity**: `id === 'shell'`, `displayName === 'Terminal'`, `executionMode === 'pty'`,
  `requiredEnvVars` is `[]`;
- **`getAuthMethods()` is exactly `[]`** — asserted as an equality, not a length, so a method added
  later fails here and is forced through review;
- **the six descriptors are `null`, each asserted individually** (`reasoningEffort`, `permissionMode`,
  `sessionResume`, `mcp`, `hooks`, `instructions`). **Individually, not as one `toEqual` on the whole
  object**, so removing one null cannot pass under cover of the others — the discipline
  `schema.test.ts` uses for its column assertions;
- **the five booleans are exactly `true, true, false, false, false`** in the order above;
- **`supportsMcp`, `supportsHooks`, `supportsResume`, `supportsInstructions` are all `false`** — three
  of them fall out of the tables below, and the fourth is the `:1902` line;
- **`buildLaunch` reproduces the adapter's own resolver EXACTLY, and contributes nothing of its own**:
  `executable` equals the resolved shell's `file`, `args` carries **no token Chorus authored**, `cwd`
  is `spec.cwd` verbatim, `envAdditions` is `{}` and `secretEnv` is `{}`. Asserted against the live
  resolver, never a literal path — the rule `:216` already states, *"a literal expectation would
  silently encode this machine's install layout … and pass on a machine where the CLI resolves
  differently"*;
- **⚠ THE CANARY: `buildLaunch` IGNORES A CREDENTIAL.** Build with a spec carrying a `credential`
  whose `value` is a distinctive canary string, plus a `route`, a `modelId`, an `effortOptionId`, a
  `permissionModeId` and `extraArgs`, and assert **`secretEnv` is `{}`**, `args` is unchanged from the
  bare spec, and **the canary appears nowhere in `JSON.stringify(request)`**. This is the assertion
  that makes the security claim structural rather than reviewed: an adapter that ignores a field
  cannot leak it, and the test proves the ignoring rather than trusting it;
- **`buildLaunch` reads no field but `cwd`** — the same spec with every optional field populated
  produces a request **deeply equal** to the bare spec's except for `cwd`;
- **it is a valid `AdapterDescriptor` on the wire** — the same `adapterDescriptorSchema.safeParse` grok
  runs at `:811`–`:825`, so an all-null, no-auth declaration the wire cannot carry fails **here**
  rather than at the first dialog open. This is the case that proves the Non-Goal "no wire change" is
  true rather than assumed.

**The three tables — one row each, with a reason, and no assertion weakened:**

- `RESUME_SUPPORT` → `shell: false` — *there is no conversation to resume; a shell's history is the
  user's own PowerShell history file and Chorus neither owns nor reopens it.* **Not "not yet"** — the
  distinction kimi's and opencode's rows already draw;
- `MCP_SUPPORT` → `shell: false` — *there is no agent here to give tools to.* Distinguish it in the
  comment from grok's `false`, which is *unmeasured*: this one is **inapplicable**, and the two are
  the same boolean for opposite reasons;
- `HOOKS_SUPPORT` → `shell: false` — *no lifecycle events, because there is no agent lifecycle. The
  pane keeps exactly three states (D129).*

Each of the three has a `names EVERY registry adapter` guard (`:962`, `:1012`, `:1046`); **all three go
red on a missing row, and that failure is the mechanism working.**

**The registry-derived assertions that must go green with NO edit** — check them explicitly and say so
in the report, because a green that required an edit somewhere is a green that stopped being derived:

- `:909` `capabilityAdapters` covers every registry adapter (**6 now**);
- `:845` `Object.keys(staticRegistry)` equals `agentKindSchema.options`;
- `:446`–`:448` every option resolves to an adapter whose `id` **is** the kind;
- the `it.each(capabilityAdapters …)` loops at `:967`, `:1017` and `:1051` each gain a sixth case for
  free.

**And the assertions that must go red if this task is done wrong**, worth running deliberately once:

- delete the `agentKindSchema` half of the widening → `:845` fails **and** `registry.ts:40` fails to
  compile. Confirm both, because that pair is F25's entire mitigation.

## Verification Commands

Runnable as written from the repository root (PowerShell).

```powershell
# ⚠ A WORKTREE HAS NO node_modules. Without this the gates report a FALSE GREEN.
New-Item -ItemType Junction -Path .\node_modules -Target C:\Projects\ContactEstablished\Chorus\node_modules

npm run typecheck          # 0 errors, node + web
npx vitest run             # ⚠ 2941 / 78 + ONE FILE UNCOLLECTED in a worktree (F103), plus this task's cases
npm run grep:secrets       # clean, 6 patterns
# there is NO `lint` script — do not invent one

# ⚠ REMOVE THE JUNCTION, AND REMOVE IT LINK-AWARE. A recursive force-delete of a
#   junction has historically deleted THROUGH it, and the target is the main
#   checkout's node_modules.
(Get-Item .\node_modules).Delete()
```

**The counters this task must NOT move, each measured with the TypeScript AST rather than a grep** —
`MIGRATIONS` holds template literals and the comments *between* its elements contain backticks
(`storage.ts:196`), so a character scanner returns garbage:

```powershell
# MIGRATIONS: 22, before and after
node -e "const ts=require('typescript'),fs=require('fs');const p='src/main/services/storage.ts';const sf=ts.createSourceFile(p,fs.readFileSync(p,'utf8'),ts.ScriptTarget.Latest,true);let i=null;const w=n=>{if(ts.isVariableDeclaration(n)&&n.name.text==='MIGRATIONS')i=n.initializer;ts.forEachChild(n,w)};w(sf);console.log('MIGRATIONS.length =',i.elements.length)"

# IpcChannel: 110, before and after
node -e "const ts=require('typescript'),fs=require('fs');const p='src/shared/ipc.ts';const sf=ts.createSourceFile(p,fs.readFileSync(p,'utf8'),ts.ScriptTarget.Latest,true);let i=null;const w=n=>{if(ts.isVariableDeclaration(n)&&n.name.text==='IpcChannel')i=n.initializer;ts.forEachChild(n,w)};w(sf);while(i&&(ts.isAsExpression(i)||ts.isSatisfiesExpression(i)))i=i.expression;console.log('IpcChannel keys =',i.properties.filter(p=>ts.isPropertyAssignment(p)).length)"

# runtime dependencies: 9
node -e "console.log('deps =',Object.keys(require('./package.json').dependencies).length)"
```

**The two vocabularies moved together, and the four lists behaved as predicted:**

```powershell
Select-String -Path src/shared/ipc.ts        -Pattern "agentKindSchema = z.enum"
Select-String -Path src/main/adapters/registry.ts -Pattern "shell: shellAdapter"
# three rows added, `const adapters` untouched
Select-String -Path src/main/adapters/adapters.test.ts -Pattern "^\s*shell: (true|false)"
Select-String -Path src/main/adapters/adapters.test.ts -Pattern "^const adapters"
# and NO glyph map gained an entry it should not have
Select-String -Path src/renderer/src/components/TerminalPane.vue -Pattern "USER_ROW_MARKER" -Context 0,6
```

**The security property, greppable:**

```powershell
# `spec.credential` must not appear in shell.ts at all, and neither must buildSecretEnv
Select-String -Path src/main/adapters/shell.ts -Pattern "credential|buildSecretEnv|secretEnv"
# the guard is keyed on the CAPABILITY, not on the string
Select-String -Path src/main/ipc.ts -Pattern "apiKey === false" -Context 6,10
Select-String -Path src/main/ipc.ts -Pattern "'shell'"          # expect ZERO hits
```

**Runtime drive — the task is not done until this has been observed, not compiled.** A real window on
a `--user-data-dir` **seeded from `%APPDATA%\chorus-app`** (the dev DB has no credentials, so the
credential path looks broken without it), driven over CDP on **port 9333 — never 9222**, which is the
stable installed instance. Evidence under `_verify/7a-2/`.

1. **The card.** Open the launch dialog. **Terminal appears LAST among the agents and BEFORE
   git/docker/node** (which are not agent cards at all), carrying its `>_` mark and the label
   `Terminal`. Screenshot it. **Confirm the default selection did not move** — claude is still
   preselected, which is `LaunchDialog.vue:585`'s `find(a => a.found)` reading the same first entry.
2. **The absences.** With Terminal selected: **no Model select, no Effort segment, no Permission
   segment, no Auth segment, and no reroll glyph** — and **no greyed control and no explanatory text
   in any of their places** (`:158`–`:167`). Read the DOM, do not judge from a screenshot: assert each
   selector is absent rather than hidden. **And the Name field is empty, not "Bob".**
3. **Launch it in the current tree**, `workspace_mode: current-tree`. A PowerShell prompt appears in
   the pane. Run `git status` and capture the output. **Record which binary ran** —
   `$PSVersionTable.PSVersion` in the pane itself is free at this point and settles whether `pwsh` or
   `powershell` resolved; note that this is the drive asking, not the app.
4. **Kill it and restart it.** `session:restart` gives a fresh shell — deliberately, exactly as it does
   for every agent (D142).
5. **Quit and reopen the app.** **The Terminal pane RESTORES** — a fresh shell under the same session
   row id, which is what the restore engine gives every kind. This is the observation that proves the
   adapter route bought the whole session lifecycle for free; if it fails, the design claim in the
   Goal is wrong and that is a **stop and report**, not a patch.
6. **⚠ THE NEGATIVE DRIVE — THE STEP THIS TASK EXISTS FOR.** Reproduce fact 3's two-click path: select
   a **credential-bearing launch profile**, then click **Terminal**, then Launch. **Main must refuse,
   with the authored reason visible in the dialog's inline error** (`:768`–`:771`). **Paste the
   rendered sentence verbatim.** Then confirm the negative of the negative: **no session row was
   created and no PTY was spawned** — the refusal returns before `sessions.launch`, so `git status` in
   the project shows nothing and the pane count is unchanged. A refusal that leaves an orphan row is a
   failed step.
7. **The control case.** Launch **claude** with the same credential-bearing profile in the same
   project. It must succeed exactly as it does today. Without this, step 6 proves only that something
   is broken.
8. **The activity light (fact 6).** Type in the Terminal pane and watch the rail's activity bar: it
   lights while output flows and goes out roughly ten seconds after you stop (`OUTPUT_STALE_MS`).
   **Record it. Do not fix it.** Confirm the pane shows **three** states, never `needs-you`.

**⚠ Failure-honesty clause.** A command that fails for any reason — a missing CLI, a locked DB, a CDP
port already held, an ABI mismatch — is reported **with its output**, and the step is **not claimed**.
A drive that did not run is not a drive that passed.

## Acceptance Criteria

- [ ] §0's probes re-run this session and **pasted into the report**: gates with the junction in place;
      `MIGRATIONS.length` **22** and `IpcChannel` **110** by AST, before and after; `where.exe pwsh`
      and `where.exe powershell` with their resolved forms and **the measured cost of a `where.exe`
      call**; and the `launch_profiles` census that settles fact 4.
- [ ] `agentKindSchema` and `staticRegistry` are **6 and 6, widened in the same change**, and
      `adapters.test.ts:845` proves it. The implementer confirms they read `registry.ts:9`–`:38`
      before editing either.
- [ ] `src/main/adapters/shell.ts` declares **`id: 'shell'`, `displayName: 'Terminal'`,
      `getAuthMethods(): []`, five booleans and SIX EXPLICIT NULLS**, each null carrying a reason that
      says *inapplicable*, not *unmeasured*.
- [ ] **`detectInstallation` does not call `probeCli(this.id)`** and reports the resolved shell's
      `path` with `version: null`, with the refused `$PSVersionTable` probe explained in the file.
- [ ] **`buildLaunch` reads `spec.cwd` and nothing else**, returns `args` carrying no Chorus-authored
      token, `envAdditions: {}` and a **literal `secretEnv: {}`** — proven by the canary case, not by
      inspection.
- [ ] **`session:launch` refuses a `shell` launch carrying a credential OR a launch profile**, keyed on
      **`getCapabilities().apiKey === false`** and **not** on the string `'shell'` (grep proves zero
      `'shell'` literals in `ipc.ts`), with the one-sentence reason and the "main is the boundary, the
      dialog is not" note in the code. **The kimi consequence is resolved from §0's census and recorded
      in the comment with the number.**
- [ ] `DETECTED_TOOLS` gains `'shell'` after `'grok'`; the Terminal card renders **last among agents**
      and the **default selection does not move**.
- [ ] All four `Record<AgentKind, string>` label maps say `Terminal`, **found by the compiler**, and
      `USER_ROW_MARKER` (`TerminalPane.vue:112`) gained **nothing**.
- [ ] **No model, effort, permission or auth control renders for Terminal** — absent, not disabled,
      asserted against the DOM. **The name field is empty and the reroll glyph does not render**, and
      typed text survives an agent switch in both directions.
- [ ] **`adapters.test.ts` passes UNCHANGED IN STRUCTURE**: three tables gain one row each with a
      reason, `:1902` gains one line, a new `describe` is added, **`const adapters` (`:59`) and the
      `it.each` at `:1488` are untouched**, and **no assertion is weakened**.
- [ ] `MIGRATIONS.length` **22** · `IpcChannel` **110** · runtime deps **9** · **no new file outside
      `src/main/adapters/shell.ts`**.
- [ ] typecheck **0** · vitest **≥ 2941 in a worktree (F103's one uncollected file expected and NOT
      "fixed")** plus this task's new cases · `grep:secrets` clean, 6 patterns.
- [ ] The runtime drive's eight observations are captured under `_verify/7a-2/`, including **the
      refused credential-bearing launch with its sentence pasted verbatim**, its claude control case,
      and the restore.
- [ ] `git diff --stat` shows **no file outside the Exact Scope list**, and neither `.mcp.json` nor
      `roadmap.md` appears in this task's commit.
- [ ] The report says **which world 7a-1 left this task in** — mark present, or three `codes` maps
      still to feed.

## Review Checklist

A spec reviewer must confirm:

1. **The two vocabularies moved in one commit.** `git show --stat` must carry `shared/ipc.ts` and
   `adapters/registry.ts` together. F25's defect is precisely a tree where one moved and the other did
   not, and `registry.ts:31`–`:38` explains at length why the compiler catching it afterwards is not
   the same as never having shipped it.
2. **The adapter reads nothing it should not.** Grep `shell.ts` for `credential`, `secretEnv`,
   `buildSecretEnv`, `route`, `modelId`, `effort`, `permission`, `resume`, `extraArgs`: the only
   permitted hit is the literal `secretEnv: {}`. **A `buildSecretEnv(spec.credential)` here would
   compile, pass every existing test, and reintroduce the exact hole the refusal exists to close** —
   defence in depth is the point: the guard stops the key arriving, and the literal `{}` stops it
   being used if the guard is ever moved.
3. **The refusal is keyed on the capability, not the kind.** Read the guard: `apiKey === false`, and no
   `'shell'` literal anywhere in `ipc.ts`. A guard keyed on the string passes every test in this task
   and silently fails to protect the next no-auth adapter, which is exactly what D185 anticipated.
4. **The refusal's reason is authored, not generic.** A user who hits it must learn *why* from the
   sentence. `'Invalid launch'` is a failed review.
5. **The kimi consequence is addressed, not discovered later.** `kimi.ts:94` also declares
   `apiKey: false`. Confirm the implementer measured the `launch_profiles` census, took a position,
   and wrote the number into the comment. **An unremarked guard that silently starts refusing kimi
   profiles is a defect even if no row exists today** — the next one will.
6. **Six nulls, each with a reason that distinguishes *inapplicable* from *unmeasured*.** `grok.ts`'s
   nulls mean "nobody has run `--help` for it"; these mean "the thing does not exist". They are the
   same `null` and opposite claims, and a reader who cannot tell them apart will one day "finish"
   this adapter.
7. **The three tables gained a row each and nothing was relaxed.** Diff `adapters.test.ts` and confirm
   the only changes are three rows, one `supportsInstructions` line, and one new `describe`. **A
   `toContain` where a `toEqual` was, or a loop narrowed to skip `shell`, is the failure this whole
   file exists to prevent** — and `:62`–`:85` records the last time someone read the launch-behaviour
   list as the capability list.
8. **`const adapters` (`:59`) and the `it.each` (`:1488`) are untouched.** Two independent crashes if
   they are not (fact 1). Check by diff, not by test result: a suite that crashed on collection can
   look like an unrelated failure.
9. **No glyph code, and no `USER_ROW_MARKER` entry.** If the diff touches a mark or a code map, either
   7a-1 had not landed (legitimate, and the report must say so) or scope has leaked.
10. **Absent, not disabled — asserted against the DOM.** Four controls must be *gone* for Terminal, not
    greyed and not replaced by a note. A screenshot does not distinguish `display:none` from absent;
    the drive must.
11. **Nothing was persisted, migrated, or added to the wire.** `MIGRATIONS.length` 22, `IpcChannel`
    110, deps 9 — re-measured by AST from the merged tree, never deltaed from this document.
12. **The pre-existing working-tree changes are still there and still uncommitted.** `.mcp.json` and
    `roadmap.md` were modified before this task started; a diff that includes either has absorbed
    someone else's work.

# Implementation Spec 7a-3 — Launch presets, "how many", and batch launch

_Pairs with [`../Tasks/Task-7a-3.md`](../Tasks/Task-7a-3.md). Authored 2026-08-26 against `3c70e87`,
**in parallel with Tasks 7a-1 and 7a-2**._

**Read the task doc first**, and its five "facts that will cost a session" before the first edit.
This document adds what a task doc should not carry: the module's exact shape, the insertion points,
the payload rules, the UI strings, and the runtime checks that decide whether it worked.

**⚠ EVERY `file:line` HERE IS A KICKOFF-DAY POINTER AND MOVES UNDER 7a-1.** 7a-1 deletes
`LaunchDialog.vue`'s `codes` map at `:608`, so everything below it in that file shifts; 7a-2 gives
`AgentKind` a sixth member. **Re-take every anchor at pickup** — §0 tells you how — and treat a line
number that no longer matches its quoted text as a signal to re-read, never as a rounding error.

**TypeScript blocks below are SKETCHES** — the shape and the reasoning, not text to paste unread.

---

## §0 — Probe before you build (do not skip)

### (1) The checkout can run its own gates

**⚠ A WORKTREE HAS NO `node_modules`, AND WITHOUT IT EVERY GATE REPORTS A FALSE GREEN.** `tsc` is
*"not recognized"*, the shell returns a non-zero nobody reads, and a summary says "typecheck passed".

```powershell
New-Item -ItemType Junction -Path "C:\Projects\ContactEstablished\.chorus\Chorus\wt-2be8b104\node_modules" `
  -Target "C:\Projects\ContactEstablished\Chorus\node_modules" | Out-Null
# ⚠ ASSERT IT EXISTS BEFORE TRUSTING ANY GATE BELOW. Whichever form you use, a
#   junction that was not created surfaces as `'tsc' is not recognized`, which
#   reads as a broken toolchain rather than a missing directory.
if (-not (Test-Path "C:\Projects\ContactEstablished\.chorus\Chorus\wt-2be8b104\node_modules\.bin\tsc.cmd")) { throw 'junction missing — gates below would be a false green' }
npm run typecheck ; npx vitest run ; npm run grep:secrets
```

Expect **0** · **2941 / 2941 across 78 files with ONE FILE UNCOLLECTED** · **clean, 6 patterns**.

**⚠ 2941 / 78 IS THE CORRECT ANSWER IN A WORKTREE, NOT A PROBLEM TO FIX** (**F103**).
`codeIndexCore.test.ts:42` does a module-level `readFileSync` on `_verify/6a-2/log-name-only.txt`;
`_verify/` is gitignored at `.gitignore:165` and `git ls-files _verify` returns **0**, so the file
cannot exist in a fresh checkout and Vitest reports an `ENOENT` **collection** error rather than a
test failure. The main checkout reports **2969 / 79**. **Record what YOU get** — every later "≥"
claim is measured against your number, not this one. **Do not weaken that test and do not copy the
fixture in**; it belongs to whichever task stands up CI (Phase 7).

**⚠ Remove the junction when you are done.** Left in place, an `npm install` in this worktree writes
into the main checkout.

### (2) The two dependencies are actually merged

This task **cannot compile** without them, and the failure mode of guessing is a half-written dialog.

```powershell
Test-Path src/renderer/src/components/AgentMark.vue        # 7a-1 — must be True
Select-String -Path src/shared/ipc.ts -Pattern "'shell'"   # 7a-2 — agentKindSchema must include it
Select-String -Path src/main/adapters/registry.ts -Pattern "shell"
```

**⚠ AND CONFIRM THE TWO AGREE — F25's TRAP IS ARMED WHEN THEY DO NOT.** `layout:get`'s filter treats
`staticRegistry` membership as proof of schema validity, so a kind in one and not the other passes
the filter and then fails the **outbound** parse — a failure that surfaces as a blank layout, not as
an error at the edit. `registry.ts:9`–`:38` records this at length.

### (3) Re-take the anchors this spec points at

7a-1 removed a ~10-line block from the middle of `LaunchDialog.vue`. Re-take, and **paste the new
numbers into the report**:

```powershell
Select-String -Path src/renderer/src/components/LaunchDialog.vue `
  -Pattern "^async function submit|^const MODES|^const modeLabels|^function cancel|launch-grid\"|overlay-footer launch-foot|ABSENT, NOT DISABLED"
Select-String -Path src/renderer/src/App.vue -Pattern "function onLaunched|dialogOpen.value = false|appendLaunchedLeaf"
Select-String -Path src/renderer/src/stores/layout.ts -Pattern "appendLaunchedLeaf|schedulePersist|persistNow"
Select-String -Path src/main/ipc.ts -Pattern "LAUNCH_PANE_CAP|Pane cap reached"
```

### (4) The counters this task must NOT move

```powershell
# MIGRATIONS: 22 — AST, never a grep (the array holds template literals)
node -e "const ts=require('typescript'),fs=require('fs');const p='src/main/services/storage.ts';const sf=ts.createSourceFile(p,fs.readFileSync(p,'utf8'),ts.ScriptTarget.Latest,true);let i=null;const w=n=>{if(ts.isVariableDeclaration(n)&&n.name.text==='MIGRATIONS')i=n.initializer;ts.forEachChild(n,w)};w(sf);console.log('MIGRATIONS.length =',i.elements.length)"

# IpcChannel: 110 — AST, never a grep (the map holds comments)
node -e "const ts=require('typescript'),fs=require('fs');const p='src/shared/ipc.ts';const sf=ts.createSourceFile(p,fs.readFileSync(p,'utf8'),ts.ScriptTarget.Latest,true);let i=null;const w=n=>{if(ts.isVariableDeclaration(n)&&n.name.text==='IpcChannel')i=n.initializer;ts.forEachChild(n,w)};w(sf);while(i&&(ts.isAsExpression(i)||ts.isSatisfiesExpression(i)))i=i.expression;console.log('IpcChannel keys =',i.properties.filter(p=>ts.isPropertyAssignment(p)).length)"

# runtime dependencies: 9
node -e "console.log(Object.keys(require('./package.json').dependencies).length)"
```

**All three must be unchanged at the end.** A task that needs one of them to move has found a design
problem, not a number — **stop and raise it**.

### (5) The Solo baseline, captured BEFORE anything changes

**⚠ THIS IS THE ONE PROBE THAT CANNOT BE RE-RUN LATER, AND IT IS THE MILESTONE'S SECOND CLAUSE.**
Before the first edit, launch one agent from the current dialog and **capture the exact
`session:launch` payload** — key set and values. Save it to `_verify/7a-3/solo-before.json`. Drive
step (1) diffs against this file; without it, "byte-identical" is an assertion nobody can check.

The cheapest capture is a temporary `logger.info({ payload }, ...)` at the top of the
`SessionLaunch` handler (`main/ipc.ts:1660`) — **removed before the commit**, and its removal
verified in `git diff --stat`.

---

## §1 — `src/shared/launchPresets.ts` (new)

**Placement rationale:** `src/shared/` because the renderer imports it and main must never be
imported by the renderer. **Pure**, because that is what makes this feature testable at all — this
repository has **no `.vue` component tests**, so a rule that lives in the template is a rule nothing
can check. It is the same split `launchProfiles.ts:9`–`:26` draws one directory over: *"Everything
in this module is a DECISION; everything in storage.ts is rows-in-rows-out; everything in ipc.ts is
wiring."* This module is the decision half of the launch **shape**.

### The import line, and the one rule about it

```ts
import type { AgentKind, WorkspaceMode } from './ipc'
```

**⚠ `import type`, AND NOTHING ELSE, EVER — AND THE FAILURE IS SILENT.** `src/shared/layout.ts:1`–`:16`
records why in the file the renderer already loads: the renderer runs under a CSP with **no
`unsafe-eval`**, so **a Zod import in a shared module the renderer pulls in throws `EvalError`** —
and D1's history is that this fails *quietly*, dropping events rather than erroring where anyone
looks. `layout.ts` (255 lines) and `agentNames.ts` (79 lines) are both pure with **zero** imports and
are the precedent.

A **type-only** import is erased at build time and adds nothing at runtime, so it is permitted here
where `layout.ts` chose to declare its own types — and it is *better* than declaring them, because
retyping `WorkspaceMode`'s three members would be a second home for a fact `workspaceModeSchema`
already owns (`shared/ipc.ts:1081`), drifting in the direction that matters: a renderer offering a
mode main refuses. **§2 adds a source-text guard so the next edit cannot quietly make it a value
import.**

### The preset table

```ts
/**
 * The four launch shapes (D186, from D183(b)'s table).
 *
 * ⚠ HARDCODED IN v1, AND THAT IS A DECISION RATHER THAN A SHORTCUT. Saved
 * LAUNCH PROFILES (D43) already own the per-agent axis — model, effort,
 * credential, permission. A preset is the ORTHOGONAL axis: the shape of the
 * fan-out. The dialog already renders a profile chip row, and a second chip row
 * that looked identical but meant something else would read as one control.
 * Do not merge the two surfaces.
 */
export type PresetId = 'solo' | 'pair' | 'workbench' | 'swarm'

/** What a slot is FOR. ⚠ A LABEL, NOT AN ENFORCEMENT — see `PRESETS.pair.note`. */
export type LaunchRole = 'builder' | 'reviewer' | 'shell'

export interface PresetRow {
  readonly id: PresetId
  readonly label: string
  readonly blurb: string
  /** Whether the "how many" row renders. ⚠ Pair and Workbench are fixed at 2,
   *  so for them the row is ABSENT — not disabled (LaunchDialog.vue:158-167). */
  readonly countable: boolean
  /** The badge a fixed-size card shows instead of that row. */
  readonly fixedCount: number | null
  /** The extra sentence shown when THIS preset is selected, or null. */
  readonly note: string | null
}

export const LAUNCH_PRESETS: readonly PresetRow[] = [
  {
    id: 'solo',
    label: 'Solo',
    blurb: 'One agent in one terminal',
    countable: true,
    fixedCount: null,
    note: null
  },
  {
    id: 'pair',
    label: 'Pair',
    blurb: 'One builds, one reviews the same tree',
    countable: false,
    fixedCount: 2,
    // ⚠ THIS SENTENCE IS REQUIRED BY D186 AND IS NOT DECORATION. Chorus has NO
    // read-only workspace mode — the v2 mock draws one, `workspaceModeSchema`
    // has three members, and read-only has been deferred since D22. The
    // reviewer writes the same files the builder does. A card that said
    // "reviews" and nothing else would imply a sandbox this app does not have.
    note: 'Both agents write the same tree — the reviewer is a role, not a sandbox.'
  },
  {
    id: 'workbench',
    label: 'Workbench',
    blurb: 'An agent plus a shell in the same tree',
    countable: false,
    fixedCount: 2,
    // D185: the shell is handed no credential, ever. Saying so is cheap and it
    // is the one thing about a Terminal pane a user might otherwise assume.
    note: 'The terminal is a plain shell — Chorus never hands it a key.'
  },
  {
    id: 'swarm',
    label: 'Swarm',
    blurb: 'Agents fan out on parallel work',
    countable: true,
    fixedCount: null,
    // ⚠ THE HONESTY SURFACE FOR WHAT SWARM COSTS, AND THE ROADMAP HAS BEEN
    // BITTEN BY EXACTLY THIS ONCE: the Phase 6b housekeeping notes record that
    // the dialog's default workspace mode created a fresh worktree per drive
    // pane, so a multi-pane drive quietly ACCUMULATED worktrees. Swarm makes
    // that the INTENDED behaviour, which is only an improvement if the
    // checkouts are visible BEFORE Launch is pressed.
    //
    // What happens afterwards needs no new work — D26 Q1/Q4 already govern it:
    // a worktree outlives its session, a clean close offers removal, a dirty
    // one detaches into WorktreePanel's retained list, and branches are NEVER
    // auto-deleted. Four branches sounds worse than it is, so say it.
    note: 'Each agent gets its own worktree and branch. They outlive the session — closing a clean one offers removal, and branches are never deleted for you.'
  }
]
```

### The partner rule

```ts
/**
 * Pair's partner preference order (D186).
 *
 * ⚠ A LITERAL LIST, NOT A FILTER OVER `AgentKind`, AND THAT IS THE POINT. Two
 * kinds must never become a reviewer by accident: `shell` (a raw prompt reviews
 * nothing) and `kimi` (withheld from the picker by HIDDEN_AGENTS — a
 * presentation filter, not a removal). A filter would admit both the moment
 * either list changed; a literal makes the next agent kind an explicit
 * decision, and §2's drift guard makes it a RED TEST rather than a silent one.
 */
export const PARTNER_ORDER: readonly AgentKind[] = ['claude', 'codex', 'grok', 'opencode']

/** The first installed, non-hidden agent that is not the builder — or null,
 *  which is a legitimate answer on a machine with one CLI installed. */
export function partnerFor(builder: AgentKind, installed: readonly AgentKind[]): AgentKind | null {
  for (const kind of PARTNER_ORDER) {
    if (kind !== builder && installed.includes(kind)) return kind
  }
  return null
}
```

### The count

```ts
/** The ceiling on one press. ⚠ EXPORTED so the dialog and the tests read ONE
 *  number; a `6` retyped in a template is a second home for it. */
export const MAX_LAUNCH_COUNT = 6

/**
 * The counts the dialog may OFFER, clamped to the pane budget — F104's first
 * mitigation.
 *
 * ⚠ A VALUE PAST THE BUDGET IS NOT RENDERED, NOT GREYED (the absent-not-
 * disabled rule at LaunchDialog.vue:158-167).
 *
 * ⚠ AND IT NEVER RETURNS AN EMPTY LIST, DELIBERATELY. At a budget of 0 it still
 * offers `1`: a renderer that refused to offer any count would be INVENTING a
 * refusal main owns, and main's own inline reason — "Pane cap reached (16 per
 * project)" — is both truer and more useful than an empty control.
 */
export function offeredCounts(remainingBudget: number): number[] {
  const top = Math.min(MAX_LAUNCH_COUNT, Math.max(1, Math.floor(remainingBudget)))
  return Array.from({ length: top }, (_, i) => i + 1)
}
```

### The plan

```ts
export interface PlanInput {
  readonly preset: PresetId
  /** The agent the user picked in the grid. */
  readonly agent: AgentKind
  /** What the count row shows. Ignored by the fixed-size presets. */
  readonly count: number
  /**
   * ⚠ THE DIALOG'S CURRENT MODE, NOT `ctx.suggestedMode`. They are the same
   * until the user touches the workspace cards, and slot 1 of a Solo launch
   * must reproduce TODAY'S payload exactly — including `existing-worktree` and
   * the worktree_id that rides with it.
   */
  readonly mode: WorkspaceMode
  /** Installed, non-hidden agent kinds — the dialog's own card list. */
  readonly installed: readonly AgentKind[]
}

export interface PlannedLaunch {
  readonly agent: AgentKind
  readonly workspaceMode: WorkspaceMode
  /** null for Solo and Swarm, where every slot is doing the same job. */
  readonly role: LaunchRole | null
  /** The preset's OWN note for this slot, or null to inherit what the user
   *  typed. ⚠ ALWAYS null for slot 0 — see the invariant below. */
  readonly description: string | null
}

/** ⚠ Both ≤ AGENT_DESCRIPTION_MAX (50). The module may not import that cap
 *  (it lives in the Zod module), so §2's test ties the two together — which is
 *  why there is no second literal anywhere. */
const REVIEWER_NOTE = 'Reviewing the same tree'
const SHELL_NOTE = 'Shell in the same tree'

/** 7a-2's kind. ⚠ Before 7a-2 lands this does not typecheck, and that is the
 *  dependency made structural rather than documentary. */
const SHELL_AGENT: AgentKind = 'shell'

/**
 * The batch, in launch order.
 *
 * ⚠ INVARIANT — SLOT 0 IS ALWAYS THE USER'S. `plan[0].description` is null for
 * every preset and every count, and `plan[0].agent` is always the picked agent.
 * That is what lets the dialog hand slot 0 the typed name and the typed note
 * untouched, which is in turn what makes Solo-at-1 BYTE-IDENTICAL to today.
 *
 * ⚠ AN EMPTY ARRAY IS A REAL ANSWER, not an error condition: it means "this
 * shape cannot be built here" (no second agent for Pair, no shell for
 * Workbench). The dialog omits the Will-launch strip (D76) and disables Launch
 * off the SAME emptiness, so the two can never disagree — and
 * `presetDisabledReason` supplies the sentence that says why.
 */
export function planLaunches(input: PlanInput): readonly PlannedLaunch[] {
  const n = Math.min(MAX_LAUNCH_COUNT, Math.max(1, Math.floor(input.count)))
  switch (input.preset) {
    case 'solo':
      // ⚠ D186'S SOLO RULE, AND THE ONE GENUINELY AMBIGUOUS CASE IN THIS FILE.
      // Agent 1 launches at the mode the dialog is showing. Agents 2..N launch
      // into a NEW WORKTREE — not because a new rule was invented, but because
      // by the time agent 2 starts, another live session IS writing the repo,
      // which is EXACTLY the condition `suggestMode()` already keys on
      // (`liveSessionsInRepo >= 1`, shared/ipc.ts:1133-1136). The preset simply
      // applies the existing rule forward through the batch.
      //
      // ⚠ Alternatives named and REJECTED (D186): all-N-in-current-tree — they
      // collide on any shared file, which is the failure `suggestMode` exists
      // to avoid; and locking Solo to 1 — the cleanest semantics, but it
      // removes the count row the reference screenshot puts under Solo.
      //
      // ⚠ AND IT COVERS `existing-worktree` FOR FREE: slot 1 keeps the user's
      // attached worktree, and slots 2..N cannot attach the same one (main
      // refuses a worktree owned by a live session), so `new-worktree` is the
      // only honest answer there too.
      return Array.from({ length: n }, (_, i) => ({
        agent: input.agent,
        workspaceMode: i === 0 ? input.mode : ('new-worktree' as WorkspaceMode),
        role: null,
        description: null
      }))

    case 'pair': {
      const partner = partnerFor(input.agent, input.installed)
      if (partner === null) return []
      return [
        { agent: input.agent, workspaceMode: 'current-tree', role: 'builder', description: null },
        { agent: partner, workspaceMode: 'current-tree', role: 'reviewer', description: REVIEWER_NOTE }
      ]
    }

    case 'workbench': {
      if (!input.installed.includes(SHELL_AGENT)) return []
      return [
        { agent: input.agent, workspaceMode: 'current-tree', role: 'builder', description: null },
        { agent: SHELL_AGENT, workspaceMode: 'current-tree', role: 'shell', description: SHELL_NOTE }
      ]
    }

    case 'swarm':
      // ⚠ `new-worktree` EVERY SLOT, INCLUDING THE FIRST — the one shape
      // decision D183(c) took up front, because four writers in one tree
      // collide. It costs nothing new in main: `workspace_mode: 'new-worktree'`
      // already creates a worktree, a branch and a journal row per launch
      // (ipc.ts:1898-1974).
      return Array.from({ length: n }, () => ({
        agent: input.agent,
        workspaceMode: 'new-worktree' as WorkspaceMode,
        role: null,
        description: null
      }))
  }
}

/**
 * Why a preset cannot run here, or null.
 *
 * ⚠ SHOWN AND DISABLED WITH ITS REASON, NEVER HIDDEN — the treatment
 * `launchProfileWireSchema`'s `disabled_reason` already establishes
 * (`shared/ipc.ts:1270`, rendered at LaunchDialog.vue:856) for a row a user
 * might reasonably expect to see. A Pair card that vanished on a one-CLI
 * machine would read as a missing feature rather than an unmet condition.
 *
 * ⚠ IT MUST AGREE WITH `planLaunches` EXACTLY: non-null here iff the plan is
 * empty. §2 asserts the biconditional rather than the two halves separately.
 */
export function presetDisabledReason(
  preset: PresetId,
  input: Omit<PlanInput, 'preset' | 'count' | 'mode'>
): string | null {
  if (preset === 'pair' && partnerFor(input.agent, input.installed) === null) {
    return 'Pair needs a second agent CLI — only one was detected.'
  }
  if (preset === 'workbench' && !input.installed.includes(SHELL_AGENT)) {
    return 'Workbench needs the Terminal, which was not detected on this machine.'
  }
  return null
}
```

### The wording — all of it, because no `.vue` file may assemble a string

```ts
/** The Will-launch strip's role column. ⚠ A LOOKUP, exactly as `modeLabels`
 *  already is (LaunchDialog.vue:621) — not a chain of `v-if`s in a template. */
export const roleLabels: Record<LaunchRole, string> = {
  builder: 'Builds',
  reviewer: 'Reviews',
  shell: 'Terminal'
}

/**
 * The Launch button while a batch runs.
 *
 * ⚠ A SINGLE LAUNCH STILL READS EXACTLY "Launching…" — the string Task 6b-3
 * put there (D170: a launch into a memory-configured project may wait up to
 * 20 s, and a button still reading `Launch` behind that wait reads as a FROZEN
 * APP). Solo-at-1 must not gain a "1 of 1".
 */
export function progressLabel(completed: number, planned: number): string {
  if (planned <= 1) return 'Launching…'
  return `Launching ${Math.min(completed + 1, planned)} of ${planned}…`
}

/**
 * What a stopped batch says, beside main's own refusal reason.
 *
 * ⚠ NULL FOR A SINGLE LAUNCH, so a Solo failure reads character-for-character
 * as it does today — a lone inline reason, with no count sentence appearing
 * under it that never used to be there.
 *
 * ⚠ AND IT IS A COUNT WITH ITS DENOMINATOR (D55's habit applied to a UI
 * string): "2 launched" would leave the user to work out what happened to the
 * other two.
 */
export function batchOutcomeLine(launched: number, planned: number): string | null {
  if (planned <= 1) return null
  return `${launched} of ${planned} launched`
}
```

---

## §2 — `src/shared/launchPresets.test.ts` (new)

**⚠ THIS FILE IS WHERE THE FEATURE'S CORRECTNESS LIVES, BECAUSE THERE ARE NO `.vue` TESTS IN THIS
REPOSITORY.** Nothing mounts a dialog; nothing can. Written beside `src/shared/layout.test.ts`, which
is the precedent for testing a pure shared module.

**The test file MAY import from `shared/ipc`** — it runs in node under Vitest, where Zod is fine.
That is what lets it tie the module's numbers to the wire's without the module importing anything.

### The matrix

```ts
describe('planLaunches — solo', () => { … })
```

- **solo at 1** — one row; `agent` = picked; `workspaceMode` = the passed mode; `role` null;
  `description` null. **Assert this case FIRST**, with a comment naming it the byte-identity case;
- **solo at 3** — `[mode, 'new-worktree', 'new-worktree']`. **Put D186's reason in the test's own
  comment** (by the time agent 2 launches another live session is writing the repo — the condition
  `suggestMode` already keys on). **This assertion is the one that silently reverts** if someone
  "simplifies" Solo to N × the chosen mode, and a reviewer should treat its deletion as a scope
  change;
- **solo at 3 from `existing-worktree`** — slot 1 keeps it, slots 2–3 are `new-worktree`;
- **pair** — two rows for `count` 1, 2 **and 5** (the count is ignored); builder then partner; both
  `current-tree`; the reviewer carries `REVIEWER_NOTE` and the builder carries `null`;
- **workbench** — two rows; second is `'shell'`; both `current-tree`;
- **swarm at 4** — four rows, all `new-worktree`, all the picked agent;
- **clamping** — `0`, `-1` and `NaN`-adjacent inputs give 1 row; `99` gives `MAX_LAUNCH_COUNT` rows,
  asserted against the **imported constant** rather than a literal `6`.

### The partner rule and its drift guard

- `partnerFor` returns the first of `claude → codex → grok → opencode` that is installed and is not
  the builder — asserted for each builder in turn;
- **`shell` and `kimi` are never partners**, even when both are in `installed`;
- **⚠ THE DRIFT GUARD, AND IT IS THE ASSERTION THAT SURVIVES THE NEXT AGENT KIND:**

```ts
// agentKindSchema is the closed list; PARTNER_ORDER is a deliberate subset.
// Every kind must be in one or the other, so a SIXTH kind fails here until
// someone decides IN WRITING whether it can review.
const EXCLUDED: AgentKind[] = [
  'shell', // a raw prompt reviews nothing
  'kimi'   // withheld from the picker by HIDDEN_AGENTS (a presentation filter)
]
expect([...PARTNER_ORDER, ...EXCLUDED].sort()).toEqual([...agentKindSchema.options].sort())
```

### The invariants — the assertions that are worth more than the cases

- **slot 0 is the user's**: for every preset × every count in the matrix,
  `plan[0]?.description === null` and `plan[0]?.agent === input.agent`. One loop, every combination;
- **empty plan ⟺ disabled reason**: for every preset and every plausible `installed` set,
  `(planLaunches(...).length === 0) === (presetDisabledReason(...) !== null)`. **Assert the
  biconditional**, not the two halves — the failure that matters is the two disagreeing, which is
  a Launch button enabled over a strip that renders nothing;
- **every authored description fits the wire**:

```ts
import { AGENT_DESCRIPTION_MAX } from './ipc'
// The module cannot import this cap (it lives in the Zod module and the
// renderer's CSP forbids pulling Zod in through a shared module — §1). So the
// two numbers are tied together HERE, and there is no second literal anywhere.
for (const p of everyPlan) {
  if (p.description) expect(p.description.length).toBeLessThanOrEqual(AGENT_DESCRIPTION_MAX)
}
```

- **the picked agent is the shell**: `workbench` yields two Terminals and `pair` pairs a Terminal
  with the first ordinary agent. **Both legal, neither special-cased** — the test pins the behaviour
  so nobody adds a rule for it later, and the Will-launch strip shows exactly what will happen.

### The purity guard

```ts
// ⚠ THREE LINES THAT CATCH A SILENT RUNTIME FAILURE. A value import of
// `./ipc` from launchPresets.ts pulls Zod into a module the RENDERER loads,
// and the page CSP has no `unsafe-eval`: it throws EvalError where nobody is
// looking (D1). `import type` is erased at build time and is fine.
// Same source-text technique db/schema.test.ts uses over storage.ts.
const SRC = readFileSync(new URL('./launchPresets.ts', import.meta.url), 'utf8')
for (const line of SRC.split('\n').filter((l) => l.startsWith('import'))) {
  expect(line.startsWith('import type ')).toBe(true)
}
```

### The wording

- `progressLabel(0, 1) === 'Launching…'` — **asserted character for character**, ellipsis included,
  because it is the string Task 6b-3 chose and a Solo launch must not gain a "1 of 1";
- `progressLabel(1, 4) === 'Launching 2 of 4…'`; `progressLabel(4, 4) === 'Launching 4 of 4…'` (the
  clamp, so a finished batch cannot read "5 of 4");
- `batchOutcomeLine(0, 1) === null` and `batchOutcomeLine(2, 4) === '2 of 4 launched'`;
- `offeredCounts(0) === [1]`, `offeredCounts(2) === [1, 2]`, `offeredCounts(99).length ===
  MAX_LAUNCH_COUNT`.

---

## §3 — `src/shared/ipc.ts`

**One change: `LAUNCH_PANE_CAP` is declared here.** Placed beside `PIN_MIN_LENGTH` / `PIN_MAX_LENGTH`
(`:1108`–`:1121`), whose docblock is the template and whose rule is quoted verbatim below.

```ts
/**
 * Soft cap on panes per project. Moved here from `main/ipc.ts` by Task 7a-3 so
 * that the renderer can CLAMP against the same number main ENFORCES.
 *
 * ⚠ DECLARED HERE, IN SHARED, AND IMPORTED BY MAIN — never the reverse. That is
 * the PIN_MIN_LENGTH rule above, for its reason: "a copy of the numbers there
 * would be a second home for one rule, and the drift would be silent in the
 * direction that matters (a renderer accepting what main refuses)." Here the
 * drift is the mirror image and just as bad — a dialog offering six launches
 * that main will refuse at the fourth, halfway through a batch.
 *
 * ⚠ IT IS STILL SOFT AND MAIN IS STILL THE AUTHORITY. This constant lets the
 * dialog avoid RENDERING an impossible option (F104's first mitigation); it
 * does not move the check, which stays exactly where it is at
 * `main/ipc.ts:1669-1676` and still refuses at `>= LAUNCH_PANE_CAP`.
 */
export const LAUNCH_PANE_CAP = 16
```

**No new `IpcChannel` key. No schema change. `IpcChannel` stays 110.**

**⚠ Alternatives named.** (a) *A second literal `16` in the renderer* — rejected: two homes for one
rule, and the drift surfaces as a refused launch mid-batch. (b) *A `paneBudget` field on
`launchContextResponseSchema`* — rejected because it would be computed **at dialog-open time** and
would therefore be **stale by slot 2 of the very batch it exists to bound**, which is F104's own
failure mode reproduced in the renderer. The layout store holds the live tree, including the leaves
this batch just added; that is the number to clamp against.

---

## §4 — `src/main/ipc.ts`

Delete the module-local constant at `:366`–`:367`:

```ts
/** Soft cap on panes per project (spec §6/§12): bounds how many agent
 *  processes one project can hold; launches beyond it are rejected. */
const LAUNCH_PANE_CAP = 16
```

and import it instead, from the existing `shared/ipc` import block:

```ts
import { LAUNCH_PANE_CAP, /* …the names already imported… */ } from '../shared/ipc'
```

**⚠ NOTHING ELSE IN THIS FILE CHANGES.** The cap check at `:1669`–`:1676`, its comment, and the
refusal string are untouched — a pure relocation. The phase's purity contract allows
`session:launch` exactly one addition (7a-2's credential refusal) and **this task adds none**.

Move the constant's own comment to `shared/ipc.ts` with it rather than leaving a stub behind: a
comment describing a constant that is no longer there is the stale-guarantee failure the codebase
already has a name for.

---

## §5 — `src/renderer/src/stores/layout.ts`

**F104's second mitigation, and it is one line of behaviour with a paragraph of reason.**

`appendLaunchedLeaf` (`:65`–`:72`) currently ends in `this.schedulePersist()` — a **500 ms** debounce
(`:82`–`:88`). `session:launch` counts panes from the **persisted** layout, so during a batch every
launch after the first measures a world that does not include the leaves the batch already added.

```ts
    appendLaunchedLeaf(newSessionId: string) {
      this.tree = {
        version: 1,
        root: this.tree ? appendPane(this.tree.root, newSessionId) : createLeaf(newSessionId)
      }
      this.dirty = true
      // ⚠ WRITE THROUGH, DO NOT DEBOUNCE — F104. `session:launch` counts panes
      // off the PERSISTED layout (ipc.ts:1669-1676); this store persisted on a
      // 500 ms debounce; so N launches inside one window all saw the SAME
      // pre-batch count, and a batch of 6 from 14 panes reached 20 against a
      // cap of 16. Task 7a-3's batch loop is what made that reachable.
      //
      // ⚠ THE DEBOUNCE IS NARROWED, NOT DELETED. It exists for drag-resize
      // storms — and there are no splitters left to drag (see this file's own
      // header on why `applyRatio` is gone). A LAUNCH is a discrete,
      // user-initiated event: at most six of them, sequential, each already
      // costing a process spawn. `removeLeaf` keeps the debounce, because pane
      // closes really can arrive in bursts.
      //
      // The main-side handler is SYNCHRONOUS (ipc.ts:3875, `(_event, payload):
      // void`), and IPC from one renderer is delivered in order, so the write
      // has completed before the next `session:launch` message is handled.
      if (this.projectId) {
        clearTimeout(persistTimer)
        this.persistNow(this.projectId, this.tree)
        this.dirty = false
      } else {
        // No project id yet — nothing to persist against. Falling back keeps
        // the old behaviour rather than dropping the write on the floor.
        this.schedulePersist()
      }
    },
```

**⚠ `persistNow` TAKES TWO ARGUMENTS** (`persistNow(projectId: string, tree: LayoutJson | null)`,
`:89`). A nullary call will not compile, which is the pleasant case; what will not be caught is
passing the *store's* reactive tree without a snapshot — `persistNow` already does the
`JSON.parse(JSON.stringify(...))` (D14: Electron's structured clone refuses a Vue Proxy with no
compile-time signal), so **call it, never re-implement it**.

**⚠ Alternative named and rejected:** flushing from the dialog's batch loop. It would work — the
parent's `onLaunched` runs synchronously inside `emit`, so the leaf is already appended by then — but
it would give `LaunchDialog.vue` its **first store import** (it has none today), and it would put the
flush one component away from the append it is flushing, where a future launch path could miss it.
D174(b)'s whole point is that every launch path reaches **one** line; the flush belongs on that line.

---

## §6 — `src/renderer/src/stores/layout.test.ts`

Add beside the existing `appendLaunchedLeaf` cases (`:62`, `:78`, `:89`, `:105`):

```ts
  it('F104: a launched leaf is persisted IMMEDIATELY, not on the 500 ms debounce', () => {
    // `session:launch` counts panes off the PERSISTED layout (ipc.ts:1669-1676).
    // Before this, a batch of launches inside one debounce window all saw the
    // same pre-batch count and could walk straight past the cap of 16.
    // ⚠ NO TIMER ADVANCE ANYWHERE IN THIS TEST — that is the whole assertion.
    const store = useLayoutStore()
    store.loadLayout(twoLeafTree(), PID)

    store.appendLaunchedLeaf('x')

    const setLayout = (window as unknown as { chorus: { setLayout: ReturnType<typeof vi.fn> } })
      .chorus.setLayout
    expect(setLayout).toHaveBeenCalledTimes(1)
    expect(collectSessionIds(setLayout.mock.calls[0][0].layout.root)).toEqual(['a', 'b', 'x'])
  })

  it('removeLeaf STILL debounces — the narrowing is deliberate and bounded', () => {
    // The debounce exists for bursts. Closes can burst; launches cannot.
    const store = useLayoutStore()
    store.loadLayout(twoLeafTree(), PID)
    const setLayout = (window as unknown as { chorus: { setLayout: ReturnType<typeof vi.fn> } })
      .chorus.setLayout

    store.removeLeaf('a')
    expect(setLayout).not.toHaveBeenCalled()
  })
```

**The four existing cases stay green untouched**: they advance timers and assert with
`toHaveBeenLastCalledWith`, both of which a write-through satisfies. **Confirm that rather than
assuming it** — if one goes red, read it before editing it.

---

## §7 — `src/renderer/src/components/LaunchDialog.vue`

The largest edit, and the one with the least testable surface — which is why everything that **can**
live in §1 already does. This file gains state, a computed plan, a loop, and four blocks of markup.

### Imports

```ts
import { LAUNCH_PANE_CAP, AGENT_DESCRIPTION_MAX, AGENT_NAME_MAX } from '../../../shared/ipc'
import {
  LAUNCH_PRESETS,
  batchOutcomeLine,
  offeredCounts,
  planLaunches,
  presetDisabledReason,
  progressLabel,
  roleLabels,
  type PresetId
} from '../../../shared/launchPresets'
import AgentMark from './AgentMark.vue' // 7a-1
```

**No store import.** This component has never had one and does not gain one here — see §8 for how the
pane count arrives.

### The new prop

```ts
const props = defineProps<{ projectId: string; paneCount: number }>()
```

**⚠ A PROP, NOT A STORE READ.** `App.vue` already owns the layout store and already imports
`collectSessionIds` (`:22`); passing the number keeps this component store-free, and because it is a
computed in the parent it stays **live** — including for leaves this very batch just appended, which
is precisely the staleness F104 is about.

### The new emit

```ts
const emit = defineEmits<{
  cancel: []
  launched: [payload: { agent: AgentKind; snapshot: AttachResponse }]
  /**
   * The batch ended and AT LEAST ONE session started (D186 / Task 7a-3).
   *
   * ⚠ A SECOND EVENT RATHER THAN A FLAG ON `launched`, because `launched`
   * must keep meaning exactly what it means today — "one session exists, wire
   * it up" — so `App.onLaunched` runs UNCHANGED per session. What moves out of
   * that handler is the DIALOG CLOSE, which was never a per-session fact and is
   * what would otherwise unmount this component after slot 1.
   *
   * ⚠ NOT EMITTED WHEN NOTHING STARTED. A batch that failed at slot 1 leaves
   * the dialog open with main's reason inline — today's behaviour, preserved.
   */
  done: [payload: { launched: number }]
}>()
```

### The new state

```ts
/* ── Launch presets (Task 7a-3 / D186) ───────────────────────────────────
 *
 * ⚠ THE SHAPE LIVES IN `shared/launchPresets.ts`, NOT HERE. This repository has
 * NO `.vue` component tests, so a rule written in this file is a rule nothing
 * can check. Everything below is state and rendering; every decision is one
 * function call away in a module with an exhaustive test.
 */
const preset = ref<PresetId>('solo')
const count = ref(1)
/** Per-slot progress for the Will-launch strip. Index-aligned with `plan`. */
type SlotState = 'pending' | 'running' | 'done' | 'failed'
const rowStates = ref<SlotState[]>([])
const completed = ref(0)
```

### The computeds

```ts
/** Installed, non-hidden agent kinds — the same list the grid renders, so the
 *  partner rule can never offer a card the user cannot see. */
const installedAgents = computed(() => agents.value.filter((a) => a.found).map((a) => a.name))

/**
 * ⚠ A COMPUTED, NOT SOMETHING BUILT INSIDE `submit()`. The Will-launch strip
 * exists to show what will happen BEFORE Launch is pressed; a plan computed at
 * submit time would make that strip a guess, and the honesty surface this task
 * exists to build would be decoration.
 */
const plan = computed(() =>
  selected.value === null
    ? []
    : planLaunches({
        preset: preset.value,
        agent: selected.value,
        count: count.value,
        // ⚠ THE DIALOG'S CURRENT MODE. Same as ctx.suggestedMode until the user
        // touches the workspace cards — and slot 1 must reproduce today's
        // payload exactly, `existing-worktree` included.
        mode: mode.value,
        installed: installedAgents.value
      })
)

const presetReason = computed(() =>
  selected.value === null
    ? null
    : presetDisabledReason(preset.value, { agent: selected.value, installed: installedAgents.value })
)

/** F104's first mitigation: never RENDER a count the cap would refuse. */
const counts = computed(() => offeredCounts(LAUNCH_PANE_CAP - props.paneCount))

const outcomeText = computed(() => batchOutcomeLine(completed.value, plan.value.length))
```

**⚠ Clamp `count` when the offered list shrinks** — a `watch(counts, …)` that pulls `count.value`
down to the largest offered value. Without it, closing panes elsewhere while the dialog is open can
leave a selected `4` that is no longer rendered, and the plan would silently keep building four.

### `submit()` — the batch loop

Replaces `:711`–`:779`. **⚠ The payload literal at `:724`–`:767` is preserved verbatim; the loop
WRAPS it.** Only the fields named below are touched.

```ts
async function submit(): Promise<void> {
  if (!selected.value || !cwd.value || busy.value) return
  const slots = plan.value
  // An empty plan means the preset cannot run here (§1). The button is already
  // disabled on the same condition; this is the belt to that brace.
  if (slots.length === 0) return
  if (slots.some((s) => s.workspaceMode === 'existing-worktree') && !selectedWorktree.value) return

  busy.value = true
  error.value = ''
  completed.value = 0
  rowStates.value = slots.map(() => 'pending')

  /* The names already spoken for, GROWING as the batch hands more out — so a
   * swarm of four cannot produce four sessions called "Bob", which is the whole
   * reason names exist (see this file's authored-identity block).
   * ⚠ AN EMPTY NAME FIELD STAYS EMPTY FOR EVERY SLOT: clearing it is a
   * legitimate choice and an unnamed batch is unnamed, not auto-named. */
  const taken = [...usedAgentNames.value]
  const typedName = sessionName.value.trim()
  if (typedName) taken.push(typedName)

  try {
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]
      rowStates.value[i] = 'running'

      /* ⚠ THE PER-AGENT CONTROLS TRAVEL ONLY ON SLOTS RUNNING THE PICKED
       * AGENT, AND THIS IS MEASURED RATHER THAN CAUTIOUS. D186's "the controls
       * apply to the whole batch" is about Solo and Swarm, where every slot IS
       * the picked agent. Pair's partner and Workbench's shell are a DIFFERENT
       * agent, and forwarding these fields to them is wrong three ways:
       *   · main REFUSES a mismatched profile outright — "That launch profile
       *     is for codex, not claude." (ipc.ts:1728-1729) — so the batch would
       *     stop at slot 2 on the HAPPY PATH;
       *   · `permissionModeSchema` is ONE enum spanning TWO ladders (`plan` is
       *     claude's, `full-access` codex's — D188), so a rung chosen for the
       *     builder may not exist for the partner;
       *   · a model id is route-scoped (D90 rank 0) and fails at the provider
       *     minutes later, where nothing points back to this dialog.
       *   · and D185 requires main to refuse a `shell` launch carrying a
       *     credential at all.
       * Omitting them drops that slot onto the ADAPTER'S declared defaults —
       * byte-identical to what an untouched dialog would send for that agent. */
      const own = slot.agent === selected.value

      /* Slot 0's identity is the USER'S, always (the `plan[0]` invariant in
       * launchPresets.ts). Later slots get a fresh suggestion from the same
       * pure pool the dialog already uses, and the preset's own note.
       *
       * ⚠ FOUR IDENTICAL "Bob"s IS THE FAILURE THIS AVOIDS. A rail of eight
       * panes all reading the same thing is precisely the problem names were
       * added to solve (this file's authored-identity block), and a swarm is
       * the fastest way to create it. `suggestAgentName` is already imported
       * here and already takes a used-list; `taken` grows as the batch hands
       * names out, so one batch cannot issue a name twice.
       *
       * ⚠ AND A KIND THAT TAKES NO SUGGESTED NAME GETS NONE — reuse 7a-2's
       * named `readonly AgentKind[]` (the HIDDEN_AGENTS idiom, LaunchDialog.vue
       * :512) rather than testing `=== 'shell'` here. A Terminal pane's header
       * already reads "Terminal"; 7a-2's rule is that selecting it never leaves
       * a person's name in a field the user did not type, and a batch must not
       * be the one path that puts one there. */
      const name =
        i === 0 ? typedName : typedName && !UNNAMED_AGENTS.includes(slot.agent) ? suggestAgentName(taken) : ''
      if (name && i > 0) taken.push(name)
      const note = slot.description ?? sessionNote.value.trim()

      const res = await window.chorus.launch({
        project_id: props.projectId,
        agent: slot.agent,
        cwd: cwd.value,
        workspace_mode: slot.workspaceMode,
        ...(slot.workspaceMode === 'existing-worktree' && selectedWorktree.value
          ? { worktree_id: selectedWorktree.value }
          : {}),
        ...(own && selectedLaunchProfileId.value
          ? { launch_profile_id: selectedLaunchProfileId.value }
          : own && authChoice.value === 'api_key' && selectedProfile.value
            ? { credential_profile_id: selectedProfile.value }
            : {}),
        ...(own && effort.value !== null ? { effort: effort.value } : {}),
        ...(own && modelEffort.value !== null ? { model_effort: modelEffort.value } : {}),
        ...(own && permissionMode.value !== null ? { permission_mode: permissionMode.value } : {}),
        ...(own && modelChoice.value !== null ? { model: modelChoice.value } : {}),
        ...(name ? { name } : {}),
        ...(note ? { description: note } : {})
      })

      if ('ok' in res) {
        // ⚠ STOP AT THE FIRST FAILURE AND KEEP WHAT LAUNCHED. Nothing in this
        // codebase silently undoes user-visible state, and a half-swarm the
        // user can SEE beats a rollback they cannot. Continuing past a failure
        // would be worse still: the usual reason is environmental (a git lock,
        // a missing repo, the cap), so slots 3..6 would fail the same way and
        // bury the first reason under five copies of itself.
        error.value = res.reason
        rowStates.value[i] = 'failed'
        break
      }
      rowStates.value[i] = 'done'
      completed.value += 1
      // Unchanged per session: App.onLaunched registers the row, appends the
      // leaf (D174's single line) and focuses it. The batch is N sequential
      // trips through that same line.
      emit('launched', { agent: slot.agent, snapshot: res })
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    const running = rowStates.value.indexOf('running')
    if (running >= 0) rowStates.value[running] = 'failed'
  } finally {
    busy.value = false
  }

  // ⚠ ONLY WHEN SOMETHING STARTED. Nothing started = the dialog stays open with
  // main's reason and "0 of 4 launched" beside it.
  if (completed.value > 0) emit('done', { launched: completed.value })
}
```

**⚠ SEQUENTIAL, AND NEVER `Promise.all`.** `git worktree add` contends on the repository's index, and
each worktree launch already awaits a checkout under **`GIT_CHECKOUT_TIMEOUT_MS = 10 * 60_000`**
(`services/git.ts:46`, `:268`). Six concurrent `worktree add`s against one index is a lock fight
whose failure mode is a dialog that appears hung for minutes. The `await` inside the `for` is the
feature, not an oversight.

### The template — four blocks

**(a) The preset row — above `PROFILES`** (`:838`), which is where the v2 mock puts it.

```html
      <!-- Launch presets (Task 7a-3 / D186). One press starts a SHAPE of work.
           ⚠ A disabled card is SHOWN WITH ITS REASON, never hidden — the
           treatment launch profiles' `disabled_reason` already establishes for
           a row a user might reasonably expect to see. -->
      <div class="launch-section">
        <span class="overlay-label">Preset</span>
        <div class="launch-grid launch-grid-4">
          <button
            v-for="p in LAUNCH_PRESETS"
            :key="p.id"
            type="button"
            class="overlay-card"
            :class="{ 'overlay-card-selected': preset === p.id }"
            :disabled="disabledReasonFor(p.id) !== null"
            :title="disabledReasonFor(p.id) ?? undefined"
            data-launch-preset
            @click="preset = p.id"
          >
            <span class="launch-mode-name">
              {{ p.label }}
              <!-- Pair and Workbench are fixed at two; the badge says so where
                   the count row would otherwise be. -->
              <span v-if="p.fixedCount" class="launch-preset-badge">{{ p.fixedCount }}</span>
            </span>
            <span class="launch-mode-note">{{ p.blurb }}</span>
          </button>
        </div>
        <p v-if="selectedPreset.note" class="overlay-note">{{ selectedPreset.note }}</p>
        <p v-if="presetReason" class="launch-warn">{{ presetReason }}</p>
      </div>
```

`disabledReasonFor(id)` is a one-line wrapper over `presetDisabledReason` so the template does no
work; `selectedPreset` is `LAUNCH_PRESETS.find(p => p.id === preset.value)!`.

**(b) The count row — only for `countable` presets.**

```html
      <!-- ⚠ ABSENT, NOT DISABLED, for Pair and Workbench: their size is fixed
           at two and shows as a badge on the card. The standing rule of this
           file since 3a-4 (:158-167).
           ⚠ AND THE OPTIONS ARE CLAMPED TO THE REMAINING PANE BUDGET (F104) —
           a value the cap would refuse is NOT RENDERED. -->
      <div v-if="selectedPreset.countable" class="launch-section">
        <span class="overlay-label">How many</span>
        <div class="overlay-segmented">
          <button
            v-for="n in counts"
            :key="n"
            type="button"
            class="overlay-segment"
            :class="{ 'overlay-segment-on': count === n }"
            data-launch-count
            @click="count = n"
          >
            {{ n }}
          </button>
        </div>
      </div>
```

**(c) The workspace cards render ONLY for `solo`.** Wrap the existing block (`:1147`–`:1182`, from
the `<!-- workspace mode (2-2 / D22) -->` comment to the `existing-worktree` `<select>`'s closing
`</div>`) in `v-if="preset === 'solo'"`.

**⚠ THIS IS A DELIBERATE REMOVAL OF A CONTROL, NOT AN OVERSIGHT.** Pair and Workbench are
`current-tree` by definition — a reviewer in a different worktree is reviewing different files — and
every Swarm slot is `new-worktree`. Leaving the cards rendered would give the user a control the plan
ignores, which is exactly what this file's own comment at `:1120`–`:1128` refuses for the permission
control: *"Leaving the toggle in would give the user a click that appears to turn something off and
does not."* The Will-launch strip states the target for every row, so nothing is hidden — it is
**shown as an outcome instead of offered as a choice**.

**(d) The Will-launch strip — at the foot of `.launch-body`, above the footer** (`:1252`).

```html
      <!-- ⚠ NEVER RENDERED EMPTY OR AS "0 sessions" (D76: omit, or give it a
           source). An empty plan means the preset cannot run here, and the
           reason is already on the card above.
           ⚠ THIS IS THE HONESTY SURFACE FOR WHAT SWARM COSTS. The Phase 6b
           housekeeping notes record a multi-pane drive quietly accumulating a
           worktree per pane; Swarm makes that INTENDED, which is only an
           improvement if the checkouts are visible BEFORE Launch is pressed. -->
      <div v-if="plan.length > 0" class="launch-section">
        <span class="overlay-label">Will launch</span>
        <ul class="launch-plan">
          <li v-for="(s, i) in plan" :key="i" class="launch-plan-row" :data-state="rowStates[i]">
            <!-- ⚠ THE PROP IS `name`, NOT `agent` (7a-1: `defineProps<{ name:
                 AgentMarkName; size?: number }>()`, default size 11), and
                 `AgentMarkName` is `AgentKind | 'shell'` so a slot's agent
                 assigns with no cast. -->
            <AgentMark :name="s.agent" :size="12" class="launch-plan-mark" />
            <span class="launch-plan-name">{{ agentLabel(s.agent) }}</span>
            <span v-if="s.role" class="launch-plan-role">{{ roleLabels[s.role] }}</span>
            <span class="launch-plan-target">{{ modeLabels[s.workspaceMode] }}</span>
          </li>
        </ul>
        <!-- One line, because the alternative is a per-slot settings matrix and
             D186 refuses one. -->
        <p class="launch-plan-hint">Model, effort and permission apply to every {{ selectedLabel }} in this batch.</p>
      </div>
```

`agentLabel(kind)` is a lookup over the existing `agents` cards (`agents.find(a => a.name === kind)?.label ?? kind`)
— **the wire's `displayName`, never a hardcoded name**, which is this file's standing rule since
3-3/D34f. Row state is expressed with `[data-state]` in CSS (a muted row for `pending`, the accent
for `done`, the error colour for `failed`) rather than four `v-if`s.

### The footer

```html
        <button
          type="button"
          class="overlay-btn-primary"
          :disabled="!selected || !cwd || busy || plan.length === 0 || (plan.some((s) => s.workspaceMode === 'existing-worktree') && !selectedWorktree)"
          @click="submit"
        >
          {{ busy ? progressLabel(completed, plan.length) : 'Launch' }}
        </button>
```

**⚠ KEEP THE 6b-3 COMMENT ABOVE IT.** `progressLabel` returns exactly `'Launching…'` for a single
launch, which is the string D170 put there and the reason it is there (a launch into a
memory-configured project may wait 20 s, and a button still reading `Launch` behind that wait reads
as a frozen app).

And beside the existing inline error, the outcome:

```html
        <p v-if="error && outcomeText" class="launch-warn">{{ outcomeText }}</p>
```

`batchOutcomeLine` returns `null` for a one-slot plan, so **a Solo failure renders exactly what it
renders today** — a lone reason with nothing new under it.

### Styles

`.launch-grid-4 { grid-template-columns: repeat(4, 1fr); }` beside `.launch-grid-3` (`:1326`);
`.launch-preset-badge` in the badge chrome the agent tile already uses (`--color-surface-badge`,
`--color-border-badge`, `--font-mono`, 9 px); `.launch-plan` a flex column of 22 px rows with
`.launch-plan-target` in the quiet colour and `white-space: nowrap`. **No new colour tokens** —
`[data-state="failed"]` uses the existing error token, `done` the existing jade.

---

## §8 — `src/renderer/src/App.vue`

Three small changes, and the first one is fact 1 from the task doc.

```ts
/** Panes in the ACTIVE project, for the launch dialog's count clamp (F104).
 *  A computed, so it includes leaves the current batch just appended. */
const paneCount = computed(() => (layout.tree ? collectSessionIds(layout.tree.root).length : 0))
```

`collectSessionIds` is already imported at `:22` and `layout` already exists at `:35`.

**Remove `dialogOpen.value = false` from `onLaunched` (`:892`)** and leave a comment where it was:

```ts
  // ⚠ THE DIALOG IS NO LONGER CLOSED HERE (Task 7a-3). `launched` fires ONCE
  // PER SESSION, and a batch fires it N times — closing on the first would
  // unmount the dialog after slot 1, taking the progress line, the per-row
  // ticks and the place slot 3's failure has to render with it. The close now
  // rides the `done` event, which fires once when the batch ENDS.
```

Everything else in `onLaunched` stays: `sessionStore.attached`, the `sessions` push,
**`layout.appendLaunchedLeaf(snapshot.sessionId)`** (D174's single line — a batch is N sequential
trips through it), `viewStore.setFocused(...)` and `void projectStore.load()`.

**⚠ TWO CONSEQUENCES OF LEAVING IT UNCHANGED, IN THE OPEN RATHER THAN DISCOVERED.** (i) `void
projectStore.load()` now runs once per launched session — four `project:list` refetches for a swarm
of four. It is a cheap list and hoisting it to `done` would change behaviour for every non-batch
path, so it stays. (ii) `setFocused` runs per launch, so **the LAST launched pane ends focused**.
That is what the existing comment promises ("the agent you just launched is the one you can type
at") and the grid shows all of them anyway; it is recorded here so a reviewer knows it was seen
rather than missed.

Then the new handler:

```ts
/**
 * The batch ended and at least one session started (Task 7a-3).
 *
 * ⚠ THE GRID SWITCH IS A JUDGEMENT CALL AND IS FLAGGED AS ONE. Switching the
 * user's view is a real intrusion, and Chorus persists the choice per project
 * (`view:set`). It is taken anyway for one reason: the filmstrip shows ONE pane
 * full-size, so a swarm of four landing there shows the user one agent and
 * hides the three they just paid for — which defeats the preset they chose one
 * second earlier. It fires only for a batch (`> 1`), so a Solo launch never
 * moves anyone's view.
 */
function onLaunchDone(payload: { launched: number }): void {
  dialogOpen.value = false
  if (payload.launched > 1) viewStore.setMode('grid')
}
```

and the mount (`:990`–`:995`):

```html
    <LaunchDialog
      v-if="dialogOpen && projectStore.activeId"
      :project-id="projectStore.activeId"
      :pane-count="paneCount"
      @cancel="dialogOpen = false"
      @launched="onLaunched"
      @done="onLaunchDone"
    />
```

---

## §9 — Verification

### Build

```powershell
npm run typecheck        # 0, node + web
npx vitest run           # >= your §0(1) baseline (2941 / 78 in a worktree), plus this task's cases
npm run grep:secrets     # clean, 6 patterns
```

### Structural — the limits this task rests on

```powershell
# ⚠ The pure module has NO runtime import. Every hit must begin `import type`.
Select-String -Path src/shared/launchPresets.ts -Pattern "^import"

# ONE home for the pane cap: a declaration in shared, an import in main, and no
# stray literal anywhere.
Get-ChildItem -Path src -Recurse -Include *.ts,*.vue | Select-String -Pattern "LAUNCH_PANE_CAP"

# The loop is SEQUENTIAL. Any hit here is a defect, not a style question.
Select-String -Path src/renderer/src/components/LaunchDialog.vue -Pattern "Promise\.(all|allSettled|race)"

# Nothing unwinds a started session on failure.
Select-String -Path src/renderer/src/components/LaunchDialog.vue -Pattern "deleteSession|removeLeaf|rollback"

# The spread discipline survived the rewrite (D90 rank 0, D179, the identity).
Select-String -Path src/renderer/src/components/LaunchDialog.vue -Pattern "\.\.\.\(.*\? \{"

# D174(b): still ONE append, and no bulk primitive appeared.
Get-ChildItem -Path src -Recurse -Include *.ts,*.vue | Select-String -Pattern "appendLaunchedLeaf"

# The counters are unchanged — AST, re-run from §0(4). 22 / 110 / 9.

# The temporary payload logger from §0(5) is GONE.
git diff --stat
```

### Runtime — the part that decides the task

A real window on a `--user-data-dir` **seeded from `%APPDATA%\chorus-app`** (copy `Local State`
beside `chorus.db`, or every pre-existing credential blob is undecryptable and the credential paths
look broken for reasons that have nothing to do with this task), driven over **CDP port 9333 — never
9222**, which is the stable instance. Evidence under `_verify/7a-3/`.

1. **⚠ SOLO — THE BYTE-IDENTICAL PAYLOAD, AND THE STEP THAT DECIDES THIS TASK.** Launch one agent
   with the same settings as §0(5). Capture the payload, `Compare-Object` it against
   `_verify/7a-3/solo-before.json`, and **paste both files plus the diff**. The key set and every
   value must match: **no `preset`, no `count`, no field that was previously absent, and no field
   that was previously present now missing.** A screenshot of a working Solo launch is **not** this
   step. If they differ, stop — every preset in this task is new surface a user can ignore, and Solo
   is the path they already use.
2. **Pair → two panes, two different agents, both `current-tree`.** Confirm the reviewer's row
   carries the preset's description and the builder's carries whatever was typed; confirm
   `sessions.cwd` is identical for both. **And confirm the partner slot carries no model, effort,
   permission or profile** — read the payloads, not the UI.
3. **Workbench → an agent plus a Terminal in the same tree.** Both `current-tree`; the Terminal's
   payload carries **no credential and no launch profile** (D185); the pane header shows 7a-1's
   shell mark.
4. **Swarm at 4 → four panes, four worktrees, four branches, and the grid.**

```powershell
git -C <repo> worktree list
git -C <repo> branch --list "chorus/*"
```

   Expect four fresh `<repo-parent>\.chorus\<repo>\wt-*` paths on four distinct
   `chorus/<repo>/<id>` branches, **all four listed in `WorktreePanel`**, and the view switched to
   grid. Paste both command outputs and a screenshot of the panel.

   **And read the four `sessions.name` values: they must be FOUR DIFFERENT NAMES.** Four identical
   "Bob"s is the precise failure names exist to prevent, and it is invisible in a screenshot of four
   panes whose headers are cropped. If the name field was cleared before launching, all four must be
   **null** — an unnamed batch stays unnamed rather than being auto-named.
5. **Solo at 3 → agent 1 in the current tree, agents 2 and 3 in worktrees.** D186's Solo rule
   observed rather than asserted. Paste the three sessions' `cwd` values.
6. **The cap, both halves.** With **14 panes** open in one project, confirm the count row offers
   **at most 2** and that `3`–`6` are **absent from the DOM**, not greyed:

```js
// over CDP
[...document.querySelectorAll('[data-launch-count]')].map((b) => b.textContent.trim())
```

   Then the second mitigation: with **13 panes** open, run a Swarm of 4 and confirm the **fourth**
   launch is refused by main with *"Pane cap reached (16 per project)"* — i.e. main counted the
   leaves this batch added. **Before this task's flush, all four would have passed a stale check.**
   Paste the refusal and the resulting pane count.
7. **The failure paths, both shapes.**
   - **Non-git cwd + Swarm**: the first launch refuses *"Not a git repository: …"*, **the batch
     stops**, the dialog **stays open**, and it reads **"0 of 4 launched"** with that reason inline.
     ⚠ Note what is NOT done here: the dialog does not pre-refuse Swarm on a non-git project root,
     because `repoRoot` describes the **project root** while main re-resolves the **typed cwd**
     (`ipc.ts:1901`). A renderer-side gate would refuse launches main would allow and allow ones it
     refuses; **main is the authority and its reason is the honest one.**
   - **Mid-batch failure**: make slot 3 of 4 fail (a cwd deleted between launches, or the cap) and
     confirm **"2 of 4 launched"**, the two panes **still open and usable**, the failed row marked,
     and **nothing unwound**.

**⚠ Failure-honesty clause.** Any command that fails — a git lock, a missing CLI, CDP not attaching,
a worktree path collision — is reported **with its output**, and the step is **not claimed**.
Environmental failure is a legitimate result; a silently skipped step is not.

### The invariants a reviewer should test hardest

1. **SOLO'S PAYLOAD.** Do not accept it from a summary or a screenshot — read the captured diff. The
   mechanism that makes it true is structural (`plan[0]` overrides `agent` and `workspace_mode` and
   nothing else; the `...(x ? {k:x} : {})` spreads are preserved character for character), so a
   reviewer can also check it by **reading the payload literal against `git show 3c70e87` line by
   line**. Any field that became unconditional, or any spread that lost its guard, is the defect.

2. **THE CONTROLS DO NOT CROSS AN AGENT BOUNDARY.** Grep the payload for `own &&`: `model`, `effort`,
   `model_effort`, `permission_mode`, `launch_profile_id` and `credential_profile_id` must **each**
   be gated. This one fails **on the happy path** and looks like a batching bug: main refuses a
   mismatched profile with an authored reason (`ipc.ts:1728`), so Pair stops at slot 2 and reports
   *"1 of 2 launched"* while every unit test stays green — because no unit test can reach the
   payload builder.

3. **BOTH F104 MITIGATIONS EXIST, AND THE REVIEWER CAN POINT AT EACH.** One is
   `offeredCounts(LAUNCH_PANE_CAP - paneCount)` in the dialog; the other is the write-through in
   `appendLaunchedLeaf`, proved by a test that **advances no timers**. **If only the clamp is there,
   main's check is still measuring a stale world** — it merely happens not to be asked an impossible
   question by this particular caller, which is the weakest kind of correct. And if only the flush is
   there, the user is offered options the app will refuse mid-batch. Drive step 6 exercises both
   halves for exactly this reason.

4. **THE MODULE IS PURE AND STAYS PURE.** Every `import` line begins `import type`; there is no `z.`,
   no `window`, no `Date`, no clock, no `fs`. Break it deliberately — add `import { z } from 'zod'` —
   and watch §2's guard go red. If it does not, the guard is wrong and the CSP will find the problem
   instead, silently, in the renderer, where D1 already recorded how quiet that failure is.

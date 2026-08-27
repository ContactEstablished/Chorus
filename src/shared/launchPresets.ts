/**
 * The launch SHAPE — how many sessions one press of Launch starts, which agent
 * runs in each, and where each one works (Task 7a-3 / D186).
 *
 * ⚠ PURE, AND THAT IS WHAT MAKES THIS FEATURE TESTABLE AT ALL. This repository
 * has NO `.vue` component tests — nothing mounts a dialog and nothing can — so a
 * rule written in `LaunchDialog.vue` is a rule nothing can check. Everything
 * here has an exhaustive test in `launchPresets.test.ts`; the dialog is left
 * with state and rendering.
 *
 * It is the same split `launchProfiles.ts` draws one directory over:
 * "Everything in this module is a DECISION; everything in storage.ts is
 * rows-in-rows-out; everything in ipc.ts is wiring." This module is the
 * decision half of the launch shape.
 *
 * ⚠ `import type`, AND NOTHING ELSE, EVER — AND THE FAILURE IS SILENT.
 * `shared/layout.ts` records why in the file the renderer already loads: the
 * renderer runs under a CSP with no `unsafe-eval`, so a VALUE import of a module
 * that pulls in Zod throws `EvalError` — quietly, dropping events rather than
 * erroring where anyone looks. A type-only import is erased at build time and
 * adds nothing at runtime, which is why it is allowed here where `layout.ts`
 * chose to declare its own types: retyping `WorkspaceMode`'s three members would
 * be a second home for a fact `workspaceModeSchema` already owns, drifting in
 * the direction that matters — a renderer offering a mode main refuses.
 * The test file guards this with a source-text assertion.
 */
import type { AgentKind, WorkspaceMode } from './ipc'

/**
 * The four launch shapes (D186).
 *
 * ⚠ HARDCODED IN v1, AND THAT IS A DECISION RATHER THAN A SHORTCUT. Saved
 * LAUNCH PROFILES (D43) already own the per-agent axis — model, effort,
 * credential, permission. A preset is the ORTHOGONAL axis: the shape of the
 * fan-out. The dialog already renders a profile chip row, and a second chip row
 * that looked identical but meant something else would read as one control.
 * Do not merge the two surfaces.
 */
export type PresetId = 'solo' | 'pair' | 'workbench' | 'swarm'

/** What a slot is FOR. ⚠ A LABEL, NOT AN ENFORCEMENT — see `pair`'s note. */
export type LaunchRole = 'builder' | 'reviewer' | 'shell'

export interface PresetRow {
  readonly id: PresetId
  readonly label: string
  readonly blurb: string
  /**
   * Whether the "how many" row renders. ⚠ Pair and Workbench are fixed at two,
   * so for them the row is ABSENT — not disabled. That is the standing rule of
   * the launch dialog: a control that cannot apply does not render.
   */
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
    // D185: the shell is handed no credential, ever. Saying so is cheap, and it
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

/**
 * Pair's partner preference order (D186).
 *
 * ⚠ A LITERAL LIST, NOT A FILTER OVER `AgentKind`, AND THAT IS THE POINT. Two
 * kinds must never become a reviewer by accident: `shell` (a raw prompt reviews
 * nothing) and `kimi` (withheld from the picker by `HIDDEN_AGENTS` — a
 * presentation filter, not a removal). A filter would admit both the moment
 * either list changed; a literal makes the next agent kind an explicit
 * decision, and the test file's drift guard makes it a RED TEST rather than a
 * silent one.
 */
export const PARTNER_ORDER: readonly AgentKind[] = ['claude', 'codex', 'grok', 'opencode']

/**
 * The first installed, non-hidden agent that is not the builder — or null,
 * which is a legitimate answer on a machine with one CLI installed.
 */
export function partnerFor(builder: AgentKind, installed: readonly AgentKind[]): AgentKind | null {
  for (const kind of PARTNER_ORDER) {
    if (kind !== builder && installed.includes(kind)) return kind
  }
  return null
}

/**
 * The ceiling on one press. ⚠ EXPORTED so the dialog and the tests read ONE
 * number; a `6` retyped in a template is a second home for it.
 */
export const MAX_LAUNCH_COUNT = 6

/**
 * The counts the dialog may OFFER, clamped to the pane budget — F104's first
 * mitigation.
 *
 * ⚠ A VALUE PAST THE BUDGET IS NOT RENDERED, NOT GREYED — the absent-not-
 * disabled rule the launch dialog has followed since 3a-4.
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

export interface PlanInput {
  readonly preset: PresetId
  /** The agent the user picked in the grid. */
  readonly agent: AgentKind
  /** What the count row shows. Ignored by the fixed-size presets. */
  readonly count: number
  /**
   * ⚠ THE DIALOG'S CURRENT MODE, NOT the suggested one. They are the same until
   * the user touches the workspace cards, and slot 1 of a Solo launch must
   * reproduce TODAY'S payload exactly — including `existing-worktree` and the
   * `worktree_id` that rides with it.
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
  /**
   * The preset's OWN note for this slot, or null to inherit what the user
   * typed. ⚠ ALWAYS null for slot 0 — see the invariant on `planLaunches`.
   */
  readonly description: string | null
}

/**
 * ⚠ Both ≤ `AGENT_DESCRIPTION_MAX` (50). This module may not import that cap —
 * it lives in the Zod module — so the test file ties the two together, which is
 * why there is no second literal anywhere.
 */
const REVIEWER_NOTE = 'Reviewing the same tree'
const SHELL_NOTE = 'Shell in the same tree'

/**
 * 7a-2's kind. ⚠ Before 7a-2 lands this does not typecheck, and that is the
 * dependency made structural rather than documentary.
 */
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
 * Workbench). The dialog omits the Will-launch strip and disables Launch off
 * the SAME emptiness, so the two can never disagree — and
 * `presetDisabledReason` supplies the sentence that says why.
 */
export function planLaunches(input: PlanInput): readonly PlannedLaunch[] {
  const n = Math.min(MAX_LAUNCH_COUNT, Math.max(1, Math.floor(input.count) || 1))
  switch (input.preset) {
    case 'solo':
      // ⚠ D186'S SOLO RULE, AND THE ONE GENUINELY AMBIGUOUS CASE IN THIS FILE.
      // Agent 1 launches at the mode the dialog is showing. Agents 2..N launch
      // into a NEW WORKTREE — not because a new rule was invented, but because
      // by the time agent 2 starts, another live session IS writing the repo,
      // which is EXACTLY the condition `suggestMode()` already keys on
      // (`liveSessionsInRepo >= 1`). The preset applies the existing rule
      // forward through the batch.
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
        {
          agent: partner,
          workspaceMode: 'current-tree',
          role: 'reviewer',
          description: REVIEWER_NOTE
        }
      ]
    }

    case 'workbench': {
      if (!input.installed.includes(SHELL_AGENT)) return []
      return [
        { agent: input.agent, workspaceMode: 'current-tree', role: 'builder', description: null },
        {
          agent: SHELL_AGENT,
          workspaceMode: 'current-tree',
          role: 'shell',
          description: SHELL_NOTE
        }
      ]
    }

    case 'swarm':
      // ⚠ `new-worktree` EVERY SLOT, INCLUDING THE FIRST — the one shape
      // decision D183 took up front, because four writers in one tree collide.
      // It costs nothing new in main: `workspace_mode: 'new-worktree'` already
      // creates a worktree, a branch and a journal row per launch.
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
 * `launchProfileWireSchema`'s `disabled_reason` already establishes for a row a
 * user might reasonably expect to see. A Pair card that vanished on a one-CLI
 * machine would read as a missing feature rather than an unmet condition.
 *
 * ⚠ IT MUST AGREE WITH `planLaunches` EXACTLY: non-null here iff the plan is
 * empty. The test file asserts the biconditional rather than the two halves
 * separately — the failure that matters is the two disagreeing, which is a
 * Launch button enabled over a strip that renders nothing.
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

/**
 * The Will-launch strip's role column. ⚠ A LOOKUP, exactly as the dialog's
 * `modeLabels` already is — not a chain of `v-if`s in a template.
 */
export const roleLabels: Record<LaunchRole, string> = {
  builder: 'Builds',
  reviewer: 'Reviews',
  shell: 'Terminal'
}

/**
 * The Launch button while a batch runs.
 *
 * ⚠ A SINGLE LAUNCH STILL READS EXACTLY "Launching…" — the string Task 6b-3 put
 * there (D170: a launch into a memory-configured project may wait up to 20 s,
 * and a button still reading `Launch` behind that wait reads as a FROZEN APP).
 * Solo-at-1 must not gain a "1 of 1".
 */
export function progressLabel(completed: number, planned: number): string {
  if (planned <= 1) return 'Launching…'
  return `Launching ${Math.min(completed + 1, planned)} of ${planned}…`
}

/**
 * What a stopped batch says, beside main's own refusal reason.
 *
 * ⚠ NULL FOR A SINGLE LAUNCH, so a Solo failure reads character-for-character
 * as it does today — a lone inline reason, with no count sentence under it that
 * never used to be there.
 *
 * ⚠ AND IT IS A COUNT WITH ITS DENOMINATOR (D55's habit applied to a UI string):
 * "2 launched" would leave the user to work out what happened to the other two.
 */
export function batchOutcomeLine(launched: number, planned: number): string | null {
  if (planned <= 1) return null
  return `${launched} of ${planned} launched`
}

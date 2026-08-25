import type { AgentKind, ProjectsList, ViewMode } from '../../../shared/ipc'

/**
 * Command palette registry (Task 1b-3 / D21). Pure module: no store imports,
 * no window.chorus reach-in, no Zod — everything the commands need arrives
 * through PaletteContext, so the module is unit-testable and later phases add
 * commands by appending to buildCommands' array (the palette component never
 * changes per-command).
 */
export interface PaletteCommand {
  id: string
  label: string
  /** Extra fuzzy-match tokens (agent kind, title, project name). */
  keywords: string[]
  enabled(): boolean
  run(): void | Promise<void>
}

/** Everything the five D21 commands need, handed in from App so the module
 *  stays pure and testable (no store imports, no window.chorus reach-in). */
export interface PaletteContext {
  openLaunchDialog: () => void
  /** ⚠ READ ONLY TO ANSWER "IS THERE ANYWHERE TO GO?" — the palette no longer
   *  lists projects (see `project.switch` below). The rows, their order and
   *  their numbers belong to `projectSwitcher.ts`. */
  projects: ProjectsList
  /** D180: open the Ctrl+G project switcher. */
  openProjectSwitcher: () => void
  leaves: { id: string; agent: AgentKind | undefined; title: string | null }[]
  focusSession: (id: string) => void
  focusedSessionId: string | null
  toggleMode: () => void
  currentMode: ViewMode
  restartFocused: () => void | Promise<void>
  /** 2-3 (D26g): open the retained-worktree panel overlay. */
  manageWorktrees: () => void
  /** 3-4 (D29): switch to the settings view (not project-scoped). */
  openSettings: () => void
  /** 3b-4 (D64(1)): switch to the council view. A view/route, not a pane. */
  openCouncil: () => void
  /** D153: switch to the day summary view. */
  openDaySummary: () => void
  /** ⚠ A FACT, NOT A STORE READ. The registry is pure (D21): it is told whether
   *  a project is active rather than reaching for one, which is what keeps the
   *  `council.run` enablement rule unit-testable without a Pinia instance. */
  hasActiveProject: boolean
}

const labels: Record<AgentKind, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  grok: 'Grok', // D165
  kimi: 'Kimi Code', // D86
  opencode: 'opencode' // D90
}

export function buildCommands(ctx: PaletteContext): PaletteCommand[] {
  const cmds: PaletteCommand[] = []

  // 1. Launch agent
  cmds.push({
    id: 'launch',
    label: 'Launch agent…',
    keywords: ['new', 'session', 'claude', 'codex', 'start'],
    enabled: () => true,
    run: () => ctx.openLaunchDialog()
  })

  // 2. Switch project — ONE entry that opens the Ctrl+G switcher (D180).
  //
  // ⚠ THIS USED TO BE `N` ENTRIES, ONE PER PROJECT ("Switch to Chorus", "Switch
  // to Trupanion", …), AND REPLACING THEM WITH ONE IS THE POINT OF D180. Nine
  // of the palette's thirteen rows were the same command repeated, which buried
  // every other command in the app; and it made the single most frequent action
  // in Chorus a fuzzy search, so switching to a project you switch to twenty
  // times a day still meant reading a list. The switcher numbers the rail
  // instead, and Ctrl+G 2 costs no reading at all.
  //
  // ⚠ THE PALETTE ENTRY SURVIVES THE MOVE ON PURPOSE, EVEN THOUGH THE HOTKEY IS
  // THE REAL ROUTE. Ctrl+G is not guessable; the palette is where a user looks
  // for a thing they cannot remember the key for, and an entry that names the
  // shortcut is how they stop needing the entry. Deleting it would make the new
  // feature discoverable only by having been told about it.
  //
  // ⚠ ARCHIVED-vs-HIDDEN: the rule did not change, it MOVED — to
  // buildSwitcherRows, with its reasoning intact. What is left here is only the
  // enablement question, and it asks the same thing the rows do (is there any
  // non-archived project at all?) so the palette cannot offer a door onto an
  // empty room.
  cmds.push({
    id: 'project.switch',
    label: 'Switch project…   (Ctrl+G)',
    keywords: ['project', 'switch', 'jump', 'goto', 'change', 'open', 'workspace'],
    enabled: () => ctx.projects.some((p) => p.status !== 'archived'),
    run: () => ctx.openProjectSwitcher()
  })

  // 3. Focus pane — one entry per leaf. Label composes agent + persisted
  // title (F12: Codex titles are just the cwd basename — same-project Codex
  // sessions collide on title alone), so the fuzzy filter narrows by either.
  for (const leaf of ctx.leaves) {
    const agentLabel = leaf.agent ? labels[leaf.agent] : 'session'
    const title = leaf.title ?? '(untitled)'
    cmds.push({
      id: `focus:${leaf.id}`,
      label: `Focus ${agentLabel} — ${title}`,
      keywords: ['focus', 'pane', agentLabel, title],
      enabled: () => leaf.id !== ctx.focusedSessionId,
      run: () => ctx.focusSession(leaf.id)
    })
  }

  // 4. Toggle filmstrip / grid
  cmds.push({
    id: 'toggle-mode',
    label: ctx.currentMode === 'filmstrip' ? 'Switch to grid view' : 'Switch to filmstrip view',
    keywords: ['view', 'toggle', 'filmstrip', 'grid', 'layout'],
    enabled: () => true,
    run: () => ctx.toggleMode()
  })

  // 5. Restart focused session
  cmds.push({
    id: 'restart-focused',
    label: 'Restart focused session',
    keywords: ['restart', 'reload', 'focused'],
    enabled: () => ctx.focusedSessionId !== null,
    run: () => ctx.restartFocused()
  })

  // 6. Manage worktrees (2-3 / D26g) — opens the retained-worktree panel
  cmds.push({
    id: 'manage-worktrees',
    label: 'Manage worktrees…',
    keywords: ['worktree', 'worktrees', 'git', 'branch', 'cleanup', 'remove'],
    enabled: () => true,
    run: () => ctx.manageWorktrees()
  })

  // 7. Open settings (3-4 / D29) — the workspace ⇄ settings view switch.
  // ALWAYS enabled: settings are not project-scoped, so a user with no
  // active project must still reach them (fuzzyFilter omits disabled
  // commands, so this is the difference between reachable and not).
  cmds.push({
    id: 'settings.open',
    label: 'Open settings',
    keywords: ['settings', 'providers', 'credentials', 'keys', 'config'],
    enabled: () => true,
    run: () => ctx.openSettings()
  })

  // 8. Council (3b-4 / D64(1) / D27, amended by D112–D115) — opens the council
  // view, which now LANDS ON THE DOCKET: this project's council history, with
  // "New council" as the primary action.
  //
  // ⚠ THE LABEL CHANGED AND THE ID DID NOT. "Run council…" promised a run and
  // now delivers a list first, so the label has to move; but the id is what the
  // palette's own tests and any future keybinding address, and renaming it would
  // be a silent break for no gain.
  //
  // ⚠ STILL DISABLED WITHOUT AN ACTIVE PROJECT, and the reason has gotten
  // stronger rather than weaker. It was: a run is RECORDED AGAINST A PROJECT
  // (`council_runs.project_id`), so with none active there is nothing to record
  // it against. Now the view's landing surface is a per-project history read on
  // that same column, so with no project there is nothing to LIST either.
  // fuzzyFilter omits disabled commands, so it simply does not render rather
  // than offering an action that would refuse.
  cmds.push({
    id: 'council.run',
    label: 'Council…',
    keywords: [
      'council',
      'review',
      'brief',
      'deliberate',
      'findings',
      'cr',
      'docket',
      'history',
      'past',
      'runs'
    ],
    enabled: () => ctx.hasActiveProject,
    run: () => ctx.openCouncil()
  })

  // 9. Day summary (D153) — what was worked on, across every project.
  //
  // ⚠ ALWAYS ENABLED, unlike the council above, and the asymmetry is the whole
  // point of the feature. A council run is recorded against ONE project; this
  // report sweeps EVERY active project at once, so "no active project" is not
  // a reason it cannot run — it is arguably the moment it is most useful.
  cmds.push({
    id: 'day.summary',
    label: 'Day summary…',
    keywords: [
      'day',
      'summary',
      'today',
      'timesheet',
      'notes',
      'standup',
      'report',
      'worked',
      'log',
      'hours'
    ],
    enabled: () => true,
    run: () => ctx.openDaySummary()
  })

  return cmds
}

/** Subsequence match: every char of `query` appears in order somewhere in the
 *  haystack (label + keywords), case-insensitive. Score rewards contiguity and
 *  an early first match so a tight hit outranks a scattered one. An empty
 *  query returns all enabled commands in registry order. Disabled commands
 *  never appear (in-repo filter, no dependency — D21). */
export function fuzzyFilter(commands: PaletteCommand[], query: string): PaletteCommand[] {
  const enabled = commands.filter((c) => c.enabled())
  const q = query.trim().toLowerCase()
  if (q === '') return enabled

  const scored: { cmd: PaletteCommand; score: number }[] = []
  for (const cmd of enabled) {
    const hay = `${cmd.label} ${cmd.keywords.join(' ')}`.toLowerCase()
    const s = subsequenceScore(hay, q)
    if (s !== null) scored.push({ cmd, score: s })
  }
  // Array.prototype.sort is stable: equal scores keep registry order.
  scored.sort((a, b) => b.score - a.score)
  return scored.map((s) => s.cmd)
}

function subsequenceScore(hay: string, q: string): number | null {
  let hi = 0
  let firstIdx = -1
  let contiguous = 0
  let lastMatch = -2
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]
    let found = -1
    for (let j = hi; j < hay.length; j++) {
      if (hay[j] === ch) {
        found = j
        break
      }
    }
    if (found === -1) return null // not a subsequence
    if (firstIdx === -1) firstIdx = found
    if (found === lastMatch + 1) contiguous++
    lastMatch = found
    hi = found + 1
  }
  // higher = better: contiguity bonus minus how late the first match starts
  return contiguous * 10 - firstIdx
}

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
  projects: ProjectsList
  selectProject: (id: string) => void | Promise<void>
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
  /** ⚠ A FACT, NOT A STORE READ. The registry is pure (D21): it is told whether
   *  a project is active rather than reaching for one, which is what keeps the
   *  `council.run` enablement rule unit-testable without a Pinia instance. */
  hasActiveProject: boolean
}

const labels: Record<AgentKind, string> = { claude: 'Claude Code', codex: 'Codex' }

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

  // 2. Switch project — one entry per project (fuzzy by name)
  for (const p of ctx.projects) {
    cmds.push({
      id: `project:${p.id}`,
      label: `Switch to ${p.name}`,
      keywords: ['project', 'switch', p.name],
      enabled: () => !p.active,
      run: () => ctx.selectProject(p.id)
    })
  }

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

  // 8. Run council (3b-4 / D64(1) / D27) — opens the council view.
  //
  // ⚠ DISABLED WITHOUT AN ACTIVE PROJECT, and that is the opposite of the
  // settings entry above for a reason: a run is RECORDED AGAINST A PROJECT
  // (`council_runs.project_id`), so with none active there is nothing to record
  // it against. fuzzyFilter omits disabled commands, so it simply does not
  // render rather than offering an action that would refuse.
  cmds.push({
    id: 'council.run',
    label: 'Run council…',
    keywords: ['council', 'review', 'brief', 'deliberate', 'findings', 'cr'],
    enabled: () => ctx.hasActiveProject,
    run: () => ctx.openCouncil()
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

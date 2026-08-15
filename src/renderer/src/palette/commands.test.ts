import { describe, expect, it } from 'vitest'
import { buildCommands, fuzzyFilter, type PaletteCommand, type PaletteContext } from './commands'

const cmd = (
  id: string,
  label: string,
  keywords: string[] = [],
  enabled = true
): PaletteCommand => ({ id, label, keywords, enabled: () => enabled, run: () => {} })

function stubCtx(overrides: Partial<PaletteContext> = {}): PaletteContext {
  return {
    openLaunchDialog: () => {},
    projects: [],
    selectProject: () => {},
    leaves: [],
    focusSession: () => {},
    focusedSessionId: null,
    toggleMode: () => {},
    currentMode: 'filmstrip',
    restartFocused: () => {},
    manageWorktrees: () => {},
    openSettings: () => {},
    openCouncil: () => {},
    openDaySummary: () => {},
    hasActiveProject: false,
    ...overrides
  }
}

/** A representative populated context: two projects (first active), two
 *  leaves (Claude + Codex), the first leaf focused. */
function populatedCtx(): PaletteContext {
  return stubCtx({
    // sessionCount is required by projectsListSchema as of D80. The palette
    // reads neither it nor `active` — these two rows only have to BE a
    // ProjectsList, so the field is present and no assertion here changes.
    // `color`/`description` are likewise required-nullable as of the project
    // identity migration (v13); the palette reads neither.
    //
    // ⚠ AND `status`/`color_seed` MAKE IT THREE (migration v15). This fixture
    // has now been broken by a new required field three separate times, which
    // is worth stating rather than quietly patching a fourth: a shared wire
    // type with required fields means every fixture of it is a place the next
    // migration lands. Unlike the first two, `status` is one the palette WILL
    // read — Phase 3h filters archived projects out of the switcher and keeps
    // hidden ones in — so both rows here are deliberately `active`, and the
    // filtering gets its own fixtures beside the behaviour that does it.
    projects: [
      {
        id: 'p1',
        name: 'Chorus',
        root_path: 'C:\\one',
        color: '#3BCFAE',
        description: null,
        status: 'active',
        color_seed: 0,
        active: true,
        sessionCount: 2
      },
      {
        id: 'p2',
        name: 'Chorus-Second',
        root_path: 'C:\\two',
        color: null,
        description: null,
        status: 'active',
        color_seed: 1,
        active: false,
        sessionCount: 0
      }
    ],
    leaves: [
      { id: 's1', agent: 'claude', title: 'fix the tests' },
      { id: 's2', agent: 'codex', title: 'build' }
    ],
    focusedSessionId: 's1',
    hasActiveProject: true
  })
}

describe('council.run (3b-4 / D64(1), amended by D112–D115)', () => {
  it('appears in the registry with the label the spec names', () => {
    const entry = buildCommands(populatedCtx()).find((c) => c.id === 'council.run')
    expect(entry).toBeDefined()
    // ⚠ RELABELLED WHEN THE DOCKET LANDED. The command opens the council view,
    // which now lands on this project's HISTORY with "New council" as the primary
    // action — so "Run council…" promised something the command no longer does.
    expect(entry?.label).toBe('Council…')
  })

  it('⚠ keeps the id `council.run` across the relabel', () => {
    // The id is what these tests and any future keybinding address; the label is
    // what the user reads. Renaming the id to match the new label would be a
    // silent break for no gain.
    expect(buildCommands(populatedCtx()).some((c) => c.id === 'council.run')).toBe(true)
  })

  it('is findable by the history vocabulary, not only the run vocabulary', () => {
    // Someone looking for past councils searches "docket" or "history", not "run".
    for (const q of ['docket', 'history', 'past', 'council']) {
      expect(fuzzyFilter(buildCommands(populatedCtx()), q).map((c) => c.id)).toContain('council.run')
    }
  })

  it('⚠ is DISABLED without an active project — a run is recorded against one', () => {
    const entry = buildCommands(stubCtx({ hasActiveProject: false })).find((c) => c.id === 'council.run')
    expect(entry?.enabled()).toBe(false)
  })

  it('is enabled with an active project', () => {
    const entry = buildCommands(populatedCtx()).find((c) => c.id === 'council.run')
    expect(entry?.enabled()).toBe(true)
  })

  it('⚠ does not RENDER while disabled — fuzzyFilter drops disabled commands', () => {
    const none = fuzzyFilter(buildCommands(stubCtx({ hasActiveProject: false })), 'council')
    expect(none.map((c) => c.id)).not.toContain('council.run')
    const some = fuzzyFilter(buildCommands(populatedCtx()), 'council')
    expect(some.map((c) => c.id)).toContain('council.run')
  })

  it('opens the council VIEW and nothing else — the registry stays pure', () => {
    let opened = 0
    const ctx = stubCtx({ hasActiveProject: true, openCouncil: () => void opened++ })
    buildCommands(ctx).find((c) => c.id === 'council.run')?.run()
    expect(opened).toBe(1)
  })
})

describe('fuzzyFilter', () => {
  it('returns all enabled commands in registry order for an empty query', () => {
    const cmds = [cmd('a', 'Alpha'), cmd('b', 'Beta'), cmd('c', 'Gamma')]
    expect(fuzzyFilter(cmds, '').map((c) => c.id)).toEqual(['a', 'b', 'c'])
    expect(fuzzyFilter(cmds, '   ').map((c) => c.id)).toEqual(['a', 'b', 'c'])
  })

  it("matches 'grid' against the toggle command", () => {
    const cmds = buildCommands(stubCtx({ currentMode: 'filmstrip' }))
    const hits = fuzzyFilter(cmds, 'grid')
    expect(hits.map((c) => c.id)).toContain('toggle-mode')
    expect(hits[0].label).toBe('Switch to grid view')
  })

  it("matches the subsequence 'tgv' against the toggle command", () => {
    const cmds = buildCommands(stubCtx({ currentMode: 'filmstrip' }))
    expect(fuzzyFilter(cmds, 'tgv').map((c) => c.id)).toContain('toggle-mode')
  })

  it('returns nothing for a non-subsequence query', () => {
    const cmds = buildCommands(populatedCtx())
    expect(fuzzyFilter(cmds, 'zzz')).toEqual([])
  })

  it('ranks a contiguous match above a scattered one', () => {
    // Scattered first in registry order so the ranking, not the input order,
    // must put the contiguous hit on top.
    const scattered = cmd('scattered', 'a-x-b-x-c')
    const contiguous = cmd('contiguous', 'abc')
    expect(fuzzyFilter([scattered, contiguous], 'abc')[0].id).toBe('contiguous')
  })

  it('excludes disabled commands for empty and non-empty queries', () => {
    const cmds = [cmd('on', 'Alpha'), cmd('off', 'Alpha copy', [], false)]
    expect(fuzzyFilter(cmds, '').map((c) => c.id)).toEqual(['on'])
    expect(fuzzyFilter(cmds, 'alpha').map((c) => c.id)).toEqual(['on'])
  })
})

describe('buildCommands', () => {
  it('produces the five D21 command groups plus manage-worktrees (2-3), settings.open (3-4), council.run (3b-4) and day.summary (D153)', () => {
    const ids = buildCommands(populatedCtx()).map((c) => c.id)
    expect(ids).toEqual([
      'launch',
      'project:p1',
      'project:p2',
      'focus:s1',
      'focus:s2',
      'toggle-mode',
      'restart-focused',
      'manage-worktrees',
      'settings.open',
      'council.run',
      'day.summary'
    ])
  })

  it('disables restart-focused when there is no focused session', () => {
    const cmds = buildCommands(stubCtx({ focusedSessionId: null }))
    const restart = cmds.find((c) => c.id === 'restart-focused')
    expect(restart?.enabled()).toBe(false)
  })

  it('has no switch entries when there are no projects', () => {
    const cmds = buildCommands(stubCtx({ projects: [] }))
    expect(cmds.some((c) => c.id.startsWith('project:'))).toBe(false)
  })

  it("disables the active project's own switch entry", () => {
    const cmds = buildCommands(populatedCtx())
    expect(cmds.find((c) => c.id === 'project:p1')?.enabled()).toBe(false)
    expect(cmds.find((c) => c.id === 'project:p2')?.enabled()).toBe(true)
  })

  it("disables a focus entry for the already-focused id", () => {
    const cmds = buildCommands(populatedCtx())
    expect(cmds.find((c) => c.id === 'focus:s1')?.enabled()).toBe(false)
    expect(cmds.find((c) => c.id === 'focus:s2')?.enabled()).toBe(true)
  })

  it('composes focus labels from agent + persisted title (F12)', () => {
    const cmds = buildCommands(populatedCtx())
    expect(cmds.find((c) => c.id === 'focus:s1')?.label).toBe('Focus Claude Code — fix the tests')
    expect(cmds.find((c) => c.id === 'focus:s2')?.label).toBe('Focus Codex — build')
  })

  it('falls back to "session" / "(untitled)" for missing agent or title', () => {
    const cmds = buildCommands(
      stubCtx({ leaves: [{ id: 's9', agent: undefined, title: null }] })
    )
    expect(cmds.find((c) => c.id === 'focus:s9')?.label).toBe('Focus session — (untitled)')
  })

  it('labels the toggle command by the current mode', () => {
    const film = buildCommands(stubCtx({ currentMode: 'filmstrip' }))
    const grid = buildCommands(stubCtx({ currentMode: 'grid' }))
    expect(film.find((c) => c.id === 'toggle-mode')?.label).toBe('Switch to grid view')
    expect(grid.find((c) => c.id === 'toggle-mode')?.label).toBe('Switch to filmstrip view')
  })
})

describe('manage-worktrees command (Task 2-3 / D26g)', () => {
  it('is present and always enabled', () => {
    const cmd = buildCommands(stubCtx()).find((c) => c.id === 'manage-worktrees')
    expect(cmd).toBeDefined()
    expect(cmd?.label).toBe('Manage worktrees…')
    expect(cmd?.enabled()).toBe(true)
  })

  it('run() invokes the manageWorktrees callback', () => {
    let called = 0
    const cmds = buildCommands(stubCtx({ manageWorktrees: () => called++ }))
    cmds.find((c) => c.id === 'manage-worktrees')?.run()
    expect(called).toBe(1)
  })

  it("survives fuzzyFilter('worktree')", () => {
    const hits = fuzzyFilter(buildCommands(populatedCtx()), 'worktree')
    expect(hits.map((c) => c.id)).toContain('manage-worktrees')
  })
})

describe('settings.open command (Task 3-4 / D29)', () => {
  it('is present with the expected label (3b-4 appended council.run after it)', () => {
    const cmds = buildCommands(stubCtx())
    const cmd = cmds.find((c) => c.id === 'settings.open')
    expect(cmd).toBeDefined()
    expect(cmd?.label).toBe('Open settings')
    // Was the last entry until 3b-4, then council.run was until D153; the
    // registry grows by APPENDING (D21), so this assertion moves with the tail
    // rather than pinning a position nothing needs.
    expect(cmds[cmds.length - 1].id).toBe('day.summary')
  })

  it('is enabled with and without an active project (settings are not project-scoped)', () => {
    // Empty context: no projects at all.
    expect(buildCommands(stubCtx()).find((c) => c.id === 'settings.open')?.enabled()).toBe(true)
    // Populated context: an active project exists.
    expect(buildCommands(populatedCtx()).find((c) => c.id === 'settings.open')?.enabled()).toBe(
      true
    )
  })

  it('run() invokes the openSettings callback', () => {
    let called = 0
    const cmds = buildCommands(stubCtx({ openSettings: () => called++ }))
    cmds.find((c) => c.id === 'settings.open')?.run()
    expect(called).toBe(1)
  })

  it("surfaces for the natural query 'set'", () => {
    const hits = fuzzyFilter(buildCommands(populatedCtx()), 'set')
    expect(hits.map((c) => c.id)).toContain('settings.open')
  })
})

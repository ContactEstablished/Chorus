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
    ...overrides
  }
}

/** A representative populated context: two projects (first active), two
 *  leaves (Claude + Codex), the first leaf focused. */
function populatedCtx(): PaletteContext {
  return stubCtx({
    projects: [
      { id: 'p1', name: 'Chorus', root_path: 'C:\\one', active: true },
      { id: 'p2', name: 'Chorus-Second', root_path: 'C:\\two', active: false }
    ],
    leaves: [
      { id: 's1', agent: 'claude', title: 'fix the tests' },
      { id: 's2', agent: 'codex', title: 'build' }
    ],
    focusedSessionId: 's1'
  })
}

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
  it('produces the five D21 command groups from a populated context', () => {
    const ids = buildCommands(populatedCtx()).map((c) => c.id)
    expect(ids).toEqual([
      'launch',
      'project:p1',
      'project:p2',
      'focus:s1',
      'focus:s2',
      'toggle-mode',
      'restart-focused'
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

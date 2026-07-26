import { describe, expect, it } from 'vitest'
import { claudeAdapter } from './claude'
import { codexAdapter } from './codex'
import { overridesEffort, resolveEffortArgs } from './effort'
import type { EffortDescriptor } from './types'

/**
 * Task 3a-4: the effort resolver's mapping table and precedence cases.
 *
 * ⚠ Every assertion is over the TOKEN ARRAY, never a joined string. A
 * whitespace-joined assertion would pass against the broken single-string
 * design this task replaced, which is the whole reason `cliFlag` became
 * `args`.
 */

const CLAUDE = claudeAdapter.getCapabilities().reasoningEffort!
const CODEX = codexAdapter.getCapabilities().reasoningEffort!

describe('the mapping table (spec §7.2, D4-verified 2026-07-25)', () => {
  /**
   * The four app levels against both installed CLIs. claude's values come from
   * its own `--help`; codex's from a config key the installed binary was made
   * to accept (`-c model_reasoning_effort="high"` survives `--strict-config`,
   * which rejects an invented key by name).
   */
  const CASES: ReadonlyArray<readonly [string, EffortDescriptor, string, readonly string[]]> = [
    ['claude', CLAUDE, 'fast', ['--effort', 'low']],
    ['claude', CLAUDE, 'balanced', ['--effort', 'medium']],
    ['claude', CLAUDE, 'deep', ['--effort', 'high']],
    ['claude', CLAUDE, 'max', ['--effort', 'max']],
    ['codex', CODEX, 'fast', ['-c', 'model_reasoning_effort="low"']],
    ['codex', CODEX, 'balanced', ['-c', 'model_reasoning_effort="medium"']],
    ['codex', CODEX, 'deep', ['-c', 'model_reasoning_effort="high"']],
    ['codex', CODEX, 'max', ['-c', 'model_reasoning_effort="max"']]
  ]

  it.each(CASES)('%s / %s -> exact argv tokens', (_name, descriptor, level, expected) => {
    expect(resolveEffortArgs(descriptor, level, [])).toEqual(expected)
  })

  it('codex values are TOML-quoted — the reason a single string could not express this', () => {
    // If `args` were a string that got whitespace-split, this value would be
    // torn apart the moment it contained a space; the quoting is why the token
    // array exists.
    for (const level of CODEX.levels) {
      expect(level.args).toHaveLength(2)
      expect(level.args[0]).toBe('-c')
      expect(level.args[1]).toMatch(/^model_reasoning_effort="[a-z]+"$/)
    }
  })
})

describe('the degenerate inputs — all yield [], none throw', () => {
  it('a null descriptor yields an empty array for EVERY level', () => {
    for (const level of ['fast', 'balanced', 'deep', 'max']) {
      expect(resolveEffortArgs(null, level, [])).toEqual([])
    }
  })

  it('an absent level yields an empty array (the behaviour-neutral default)', () => {
    expect(resolveEffortArgs(CLAUDE, undefined, [])).toEqual([])
    expect(resolveEffortArgs(CODEX, undefined, [])).toEqual([])
  })

  it('⚠ a level OUTSIDE the four-level vocabulary yields no tokens and no throw', () => {
    // A database, a stale renderer, or a hand-edited profile can hand over
    // anything.
    for (const junk of ['high', 'HIGH', 'ultra', '', 'fast ', '__proto__', 'toString']) {
      expect(resolveEffortArgs(CLAUDE, junk, [])).toEqual([])
      expect(resolveEffortArgs(CODEX, junk, [])).toEqual([])
    }
  })

  it('a descriptor with no levels yields [] rather than throwing', () => {
    expect(resolveEffortArgs({ mode: 'static', levels: [] }, 'deep', [])).toEqual([])
    expect(overridesEffort({ mode: 'static', levels: [] }, ['--effort', 'high'])).toBe(false)
  })

  it('extraArgs defaults to empty when omitted', () => {
    expect(resolveEffortArgs(CLAUDE, 'deep')).toEqual(['--effort', 'high'])
  })
})

describe('⚠ rank 1: the raw override beats the slider AND SUPPRESSES IT ENTIRELY', () => {
  it('claude — an --effort in extraArgs leaves ZERO Chorus tokens', () => {
    // Not "the override merely comes last": the array is EMPTY. Chorus does
    // not emit both and rely on the CLI's last-wins parsing, which is per-CLI
    // and unverified.
    expect(resolveEffortArgs(CLAUDE, 'deep', ['--effort', 'xhigh'])).toEqual([])
    expect(resolveEffortArgs(CLAUDE, 'max', ['--effort=xhigh'])).toEqual([])
  })

  it('codex — a model_reasoning_effort in extraArgs leaves ZERO Chorus tokens', () => {
    expect(resolveEffortArgs(CODEX, 'deep', ['-c', 'model_reasoning_effort="ultra"'])).toEqual([])
    // The glued form `-cKEY=VALUE` is the same override.
    expect(resolveEffortArgs(CODEX, 'fast', ['-cmodel_reasoning_effort="none"'])).toEqual([])
  })
})

describe('⚠ the suppression predicate must be SPECIFIC, not a substring match', () => {
  /**
   * A loose predicate silently disables the whole feature the first time a
   * user passes an unrelated argument — and it looks like it works. Each of
   * these must NOT suppress.
   */
  const CLAUDE_NON_SUPPRESSING: readonly string[][] = [
    ['--effortless'],
    ['--effortless', 'true'],
    ['--no-effort'],
    ['--effort-summary', 'x'],
    ['--verbose'],
    ['effort'],
    ['--EFFORT', 'high'], // case-sensitive: a different flag
    ['some--effort']
  ]

  it.each(CLAUDE_NON_SUPPRESSING)('claude: %j does not suppress', (...extra) => {
    expect(overridesEffort(CLAUDE, extra)).toBe(false)
    expect(resolveEffortArgs(CLAUDE, 'deep', extra)).toEqual(['--effort', 'high'])
  })

  const CODEX_NON_SUPPRESSING: readonly string[][] = [
    ['-c', 'model_reasoning_effort_summary="detailed"'],
    ['-c', 'plan_mode_reasoning_effort="high"'],
    ['-c', 'model_reasoning_summary="auto"'],
    ['-c', 'model="gpt-5.5"'],
    ['-c', 'model_verbosity="high"'],
    ['model_reasoning_effort'], // no assignment: not an override
    ['-c'],
    ['--search']
  ]

  it.each(CODEX_NON_SUPPRESSING)('codex: %j does not suppress', (...extra) => {
    expect(overridesEffort(CODEX, extra)).toBe(false)
    expect(resolveEffortArgs(CODEX, 'deep', extra)).toEqual([
      '-c',
      'model_reasoning_effort="high"'
    ])
  })

  it('a token merely CONTAINING the knob name does not suppress', () => {
    expect(overridesEffort(CODEX, ['-c', 'x_model_reasoning_effort="high"'])).toBe(false)
    expect(overridesEffort(CODEX, ['-c', 'features.model_reasoning_effort_v2=true'])).toBe(false)
    expect(overridesEffort(CLAUDE, ['--prefix--effort', 'high'])).toBe(false)
  })

  it('an unrelated extra arg alongside a REAL override still suppresses', () => {
    expect(resolveEffortArgs(CODEX, 'deep', ['--search', '-c', 'model_reasoning_effort="low"'])).toEqual([])
    expect(resolveEffortArgs(CLAUDE, 'deep', ['--verbose', '--effort', 'low'])).toEqual([])
  })

  it('a non-string / blank token cannot crash the predicate', () => {
    expect(overridesEffort(CODEX, ['', '   '])).toBe(false)
    // A hand-edited profile can hold anything; the cast models that reality.
    expect(overridesEffort(CODEX, [null as unknown as string, 42 as unknown as string])).toBe(false)
  })
})

describe('a collapsed mapping is LEGAL and VISIBLE (the descriptor is its one home)', () => {
  /** Three CLI levels for four slider positions: Deep and Max both resolve to
   *  `high`. Intended behaviour, and the descriptor is the single source of
   *  that fact — nothing infers it, and the dialog shows the resolved tokens
   *  so the user is not misled that Max ≠ Deep. */
  const COLLAPSED: EffortDescriptor = {
    mode: 'static',
    levels: [
      { id: 'fast', label: 'Fast', args: ['--effort', 'low'] },
      { id: 'balanced', label: 'Balanced', args: ['--effort', 'medium'] },
      { id: 'deep', label: 'Deep', args: ['--effort', 'high'] },
      { id: 'max', label: 'Max', args: ['--effort', 'high'] }
    ]
  }

  it('two levels resolving to the same value is asserted as intended', () => {
    expect(resolveEffortArgs(COLLAPSED, 'deep', [])).toEqual(['--effort', 'high'])
    expect(resolveEffortArgs(COLLAPSED, 'max', [])).toEqual(['--effort', 'high'])
  })

  it('and the override still suppresses both', () => {
    expect(resolveEffortArgs(COLLAPSED, 'max', ['--effort', 'low'])).toEqual([])
  })
})

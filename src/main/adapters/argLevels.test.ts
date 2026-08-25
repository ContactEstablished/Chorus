import { describe, expect, it } from 'vitest'
import { claudeAdapter } from './claude'
import { codexAdapter } from './codex'
import { overridesLevel, resolveLevelArgs } from './argLevels'
import type { EffortDescriptor, PermissionModeDescriptor } from './types'

/**
 * Task 3a-4's effort-resolver suite, widened on 2026-08-14 when the resolver
 * became generic (`effort.ts` -> `argLevels.ts`) and grew rank 3, the
 * descriptor's own `defaultLevelId`.
 *
 * ⚠ Every assertion is over the TOKEN ARRAY, never a joined string. A
 * whitespace-joined assertion would pass against the broken single-string
 * design this task replaced, which is the whole reason `cliFlag` became
 * `args`.
 */

const CLAUDE = claudeAdapter.getCapabilities().reasoningEffort!
const CODEX = codexAdapter.getCapabilities().reasoningEffort!
const CLAUDE_PERMISSION = claudeAdapter.getCapabilities().permissionMode!

/** claude's declared starting rungs, read from the descriptors rather than
 *  re-stated — if the defaults move, these follow and the tests below keep
 *  asserting the RULE rather than one day's values. */
const CLAUDE_DEFAULT_EFFORT = CLAUDE.levels.find((l) => l.id === CLAUDE.defaultLevelId)!.args
const CLAUDE_DEFAULT_PERMISSION = CLAUDE_PERMISSION.levels.find(
  (l) => l.id === CLAUDE_PERMISSION.defaultLevelId
)!.args

describe('the mapping table (spec §7.2, D4-verified 2026-08-14 against claude 2.1.232)', () => {
  /**
   * The four app levels against both installed CLIs. claude's values come from
   * its own `--help`; codex's from a config key the installed binary was made
   * to accept (`-c model_reasoning_effort="high"` survives `--strict-config`,
   * which rejects an invented key by name).
   *
   * ⚠ claude's COLUMN MOVED UP ONE RUNG on 2026-08-14 and codex's did not. That
   * asymmetry is the decision, not a copy-paste slip: see `CLAUDE_EFFORT` in
   * claude.ts. `low` is now the vendor value the slider cannot reach.
   */
  const CASES: ReadonlyArray<readonly [string, EffortDescriptor, string, readonly string[]]> = [
    ['claude', CLAUDE, 'fast', ['--effort', 'medium']],
    ['claude', CLAUDE, 'balanced', ['--effort', 'high']],
    ['claude', CLAUDE, 'deep', ['--effort', 'xhigh']],
    ['claude', CLAUDE, 'max', ['--effort', 'max']],
    ['codex', CODEX, 'fast', ['-c', 'model_reasoning_effort="low"']],
    ['codex', CODEX, 'balanced', ['-c', 'model_reasoning_effort="medium"']],
    ['codex', CODEX, 'deep', ['-c', 'model_reasoning_effort="high"']],
    ['codex', CODEX, 'max', ['-c', 'model_reasoning_effort="max"']]
  ]

  it.each(CASES)('%s / %s -> exact argv tokens', (_name, descriptor, level, expected) => {
    expect(resolveLevelArgs(descriptor, level, [])).toEqual(expected)
  })

  it('⚠ claude reaches xhigh and NOT low — the 2026-08-14 ladder shift, pinned', () => {
    const values = CLAUDE.levels.map((l) => l.args[1])
    expect(values).toContain('xhigh')
    expect(values).not.toContain('low')
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

  /**
   * The permission table, D4-verified 2026-08-14 against the installed claude
   * 2.1.232. `claude --help` prints the choices verbatim as "acceptEdits",
   * "auto", "bypassPermissions", "manual", "dontAsk", "plan" — so these four
   * VENDOR SPELLINGS are transcribed, not guessed, and camelCase matters.
   */
  const PERMISSION_CASES: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['auto', ['--permission-mode', 'auto']],
    ['accept-edits', ['--permission-mode', 'acceptEdits']],
    ['plan', ['--permission-mode', 'plan']],
    ['manual', ['--permission-mode', 'manual']]
  ]

  it.each(PERMISSION_CASES)('claude permission / %s -> exact argv tokens', (level, expected) => {
    expect(resolveLevelArgs(CLAUDE_PERMISSION, level, [])).toEqual(expected)
  })

  it('⚠ bypassPermissions is UNREACHABLE from the control — the omission is the decision', () => {
    // Deliberate, and asserted so that "someone adds the obvious missing one"
    // has to argue with a test first. It stays reachable via extra_args.
    const values = CLAUDE_PERMISSION.levels.map((l) => l.args[1])
    expect(values).not.toContain('bypassPermissions')
    expect(values).not.toContain('dontAsk')
  })
})

describe('⚠ rank 3: the descriptor’s own default (added 2026-08-14)', () => {
  it('claude declares a default for BOTH levelled capabilities, and each names a real level', () => {
    expect(CLAUDE.defaultLevelId).toBe('deep')
    expect(CLAUDE_PERMISSION.defaultLevelId).toBe('auto')
    expect(CLAUDE.levels.some((l) => l.id === CLAUDE.defaultLevelId)).toBe(true)
    expect(CLAUDE_PERMISSION.levels.some((l) => l.id === CLAUDE_PERMISSION.defaultLevelId)).toBe(
      true
    )
  })

  it('an absent level falls to the declared default rather than to nothing', () => {
    expect(resolveLevelArgs(CLAUDE, undefined, [])).toEqual(CLAUDE_DEFAULT_EFFORT)
    expect(resolveLevelArgs(CLAUDE_PERMISSION, undefined, [])).toEqual(CLAUDE_DEFAULT_PERMISSION)
  })

  it('⚠ and rank 1 still suppresses the DEFAULT, not merely an explicit choice', () => {
    // The failure this pins: a default applied after the override check would
    // put two `--permission-mode` flags on the command line and leave which one
    // wins to the CLI's unverified last-wins parsing.
    expect(resolveLevelArgs(CLAUDE, undefined, ['--effort', 'low'])).toEqual([])
    expect(
      resolveLevelArgs(CLAUDE_PERMISSION, undefined, ['--permission-mode', 'bypassPermissions'])
    ).toEqual([])
  })

  it('a defaultLevelId naming a level the descriptor does not declare emits nothing', () => {
    // A declaration bug must not become a spawn-time throw. The per-adapter
    // test above is where it gets caught.
    const BROKEN: EffortDescriptor = {
      mode: 'static',
      levels: [{ id: 'fast', label: 'Fast', args: ['--effort', 'medium'] }],
      defaultLevelId: 'max'
    }
    expect(resolveLevelArgs(BROKEN, undefined, [])).toEqual([])
  })

  it('an adapter with NO declared default is byte-identical to the pre-2026-08-14 rule', () => {
    expect(CODEX.defaultLevelId).toBeUndefined()
    expect(resolveLevelArgs(CODEX, undefined, [])).toEqual([])
  })
})

describe('the degenerate inputs — none throw', () => {
  it('a null descriptor yields an empty array for EVERY level', () => {
    for (const level of ['fast', 'balanced', 'deep', 'max']) {
      expect(resolveLevelArgs(null, level, [])).toEqual([])
    }
  })

  it('⚠ a level OUTSIDE the vocabulary falls to the default, or to [] when there is none', () => {
    // A database, a stale renderer, or a hand-edited profile can hand over
    // anything. When the adapter has stated where it starts, starting there is
    // a better answer to garbage than starting somewhere else.
    for (const junk of ['high', 'HIGH', 'ultra', '', 'fast ', '__proto__', 'toString']) {
      expect(resolveLevelArgs(CLAUDE, junk, [])).toEqual(CLAUDE_DEFAULT_EFFORT)
      expect(resolveLevelArgs(CLAUDE_PERMISSION, junk, [])).toEqual(CLAUDE_DEFAULT_PERMISSION)
      expect(resolveLevelArgs(CODEX, junk, [])).toEqual([])
    }
  })

  it('a descriptor with no levels yields [] rather than throwing', () => {
    expect(resolveLevelArgs({ levels: [] }, 'deep', [])).toEqual([])
    expect(overridesLevel({ levels: [] }, ['--effort', 'high'])).toBe(false)
  })

  it('extraArgs defaults to empty when omitted', () => {
    expect(resolveLevelArgs(CLAUDE, 'deep')).toEqual(['--effort', 'xhigh'])
    expect(resolveLevelArgs(CLAUDE_PERMISSION, 'manual')).toEqual(['--permission-mode', 'manual'])
  })
})

describe('⚠ rank 1: the raw override beats the control AND SUPPRESSES IT ENTIRELY', () => {
  it('claude — an --effort in extraArgs leaves ZERO Chorus tokens', () => {
    // Not "the override merely comes last": the array is EMPTY. Chorus does
    // not emit both and rely on the CLI's last-wins parsing, which is per-CLI
    // and unverified.
    expect(resolveLevelArgs(CLAUDE, 'deep', ['--effort', 'low'])).toEqual([])
    expect(resolveLevelArgs(CLAUDE, 'max', ['--effort=low'])).toEqual([])
  })

  it('claude — a --permission-mode in extraArgs leaves ZERO Chorus tokens', () => {
    // This is how `bypassPermissions` stays reachable without a control
    // position: the user names it in the CLI's own vocabulary and Chorus stands
    // down completely.
    expect(
      resolveLevelArgs(CLAUDE_PERMISSION, 'auto', ['--permission-mode', 'bypassPermissions'])
    ).toEqual([])
    expect(resolveLevelArgs(CLAUDE_PERMISSION, 'plan', ['--permission-mode=dontAsk'])).toEqual([])
  })

  it('⚠ the two knobs are INDEPENDENT — overriding one must not silence the other', () => {
    // The bug this pins is a shared-state one: a single "did the user override
    // anything" flag would make `--effort low` in extra_args also drop the
    // permission flag, which is a permission change the user never asked for.
    expect(resolveLevelArgs(CLAUDE, 'deep', ['--effort', 'low'])).toEqual([])
    expect(resolveLevelArgs(CLAUDE_PERMISSION, 'auto', ['--effort', 'low'])).toEqual([
      '--permission-mode',
      'auto'
    ])
  })

  it('codex — a model_reasoning_effort in extraArgs leaves ZERO Chorus tokens', () => {
    expect(resolveLevelArgs(CODEX, 'deep', ['-c', 'model_reasoning_effort="ultra"'])).toEqual([])
    // The glued form `-cKEY=VALUE` is the same override.
    expect(resolveLevelArgs(CODEX, 'fast', ['-cmodel_reasoning_effort="none"'])).toEqual([])
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
    expect(overridesLevel(CLAUDE, extra)).toBe(false)
    expect(resolveLevelArgs(CLAUDE, 'deep', extra)).toEqual(['--effort', 'xhigh'])
  })

  const CLAUDE_PERMISSION_NON_SUPPRESSING: readonly string[][] = [
    ['--permission-mode-file', 'x'],
    ['--permission'],
    ['--no-permission-mode'],
    ['permission-mode', 'auto'],
    ['--PERMISSION-MODE', 'auto'], // case-sensitive: a different flag
    ['--allow-dangerously-skip-permissions'],
    ['--dangerously-skip-permissions']
  ]

  it.each(CLAUDE_PERMISSION_NON_SUPPRESSING)('claude permission: %j does not suppress', (...extra) => {
    // ⚠ The last two are REAL claude flags that bypass permissions by another
    // route entirely. They are not the `--permission-mode` knob, so they must
    // not suppress it — Chorus still emits its own flag and the CLI resolves
    // the interaction, which is the CLI's business and not Chorus's to model.
    expect(overridesLevel(CLAUDE_PERMISSION, extra)).toBe(false)
    expect(resolveLevelArgs(CLAUDE_PERMISSION, 'auto', extra)).toEqual([
      '--permission-mode',
      'auto'
    ])
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
    expect(overridesLevel(CODEX, extra)).toBe(false)
    expect(resolveLevelArgs(CODEX, 'deep', extra)).toEqual([
      '-c',
      'model_reasoning_effort="high"'
    ])
  })

  it('a token merely CONTAINING the knob name does not suppress', () => {
    expect(overridesLevel(CODEX, ['-c', 'x_model_reasoning_effort="high"'])).toBe(false)
    expect(overridesLevel(CODEX, ['-c', 'features.model_reasoning_effort_v2=true'])).toBe(false)
    expect(overridesLevel(CLAUDE, ['--prefix--effort', 'high'])).toBe(false)
    expect(overridesLevel(CLAUDE_PERMISSION, ['--x--permission-mode', 'auto'])).toBe(false)
  })

  it('an unrelated extra arg alongside a REAL override still suppresses', () => {
    expect(resolveLevelArgs(CODEX, 'deep', ['--search', '-c', 'model_reasoning_effort="low"'])).toEqual([])
    expect(resolveLevelArgs(CLAUDE, 'deep', ['--verbose', '--effort', 'low'])).toEqual([])
    expect(
      resolveLevelArgs(CLAUDE_PERMISSION, 'auto', ['--verbose', '--permission-mode', 'manual'])
    ).toEqual([])
  })

  it('a non-string / blank token cannot crash the predicate', () => {
    expect(overridesLevel(CODEX, ['', '   '])).toBe(false)
    // A hand-edited profile can hold anything; the cast models that reality.
    expect(overridesLevel(CODEX, [null as unknown as string, 42 as unknown as string])).toBe(false)
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
    expect(resolveLevelArgs(COLLAPSED, 'deep', [])).toEqual(['--effort', 'high'])
    expect(resolveLevelArgs(COLLAPSED, 'max', [])).toEqual(['--effort', 'high'])
  })

  it('and the override still suppresses both', () => {
    expect(resolveLevelArgs(COLLAPSED, 'max', ['--effort', 'low'])).toEqual([])
  })

  it('the resolver is genuinely generic — a permission descriptor takes the same path', () => {
    // The point of the 2026-08-14 rename: one implementation, two capabilities,
    // no copied matching rules. A structural descriptor it has never seen works.
    const INVENTED: PermissionModeDescriptor = {
      mode: 'static',
      levels: [{ id: 'plan', label: 'Plan', args: ['-c', 'approval="plan"'] }],
      defaultLevelId: 'plan'
    }
    expect(resolveLevelArgs(INVENTED, undefined, [])).toEqual(['-c', 'approval="plan"'])
    expect(resolveLevelArgs(INVENTED, 'plan', ['-c', 'approval="never"'])).toEqual([])
  })
})

/**
 * ⚠ A POSITION THAT TURNS TWO KNOBS (2026-08-24).
 *
 * Every descriptor shipped before this date turned exactly one, and `knobsOf`
 * was `knobOf` — it registered the FIRST knob it found and stopped. codex's
 * permission mapping is the first that cannot be expressed that way: where the
 * sandbox may write (`sandbox_mode`) and when a human is asked
 * (`approval_policy`) are independent axes with no single key joining them.
 *
 * The failure the singular version would have shipped is silent and specific:
 * `overridesLevel` would answer FALSE for a user whose `extra_args` overrode
 * only the second knob, so Chorus would emit its own `approval_policy` beside
 * the user's — two authorities on one command line, resolved by a last-wins
 * rule this module's header explicitly refuses to depend on.
 */
describe('⚠ a descriptor whose position turns TWO knobs (codex permission)', () => {
  const CODEX_PERMISSION = codexAdapter.getCapabilities().permissionMode!
  const FULL_ACCESS = CODEX_PERMISSION.levels.find((l) => l.id === 'full-access')!.args

  it('declares a full-access default that resolves with NO level chosen', () => {
    // The user-facing fix in one assertion: a plain codex launch now carries the
    // permission it used to be given by hand in the TUI's /approvals menu.
    expect(resolveLevelArgs(CODEX_PERMISSION, undefined, [])).toEqual(FULL_ACCESS)
    expect(FULL_ACCESS).toEqual([
      '-c',
      'sandbox_mode="danger-full-access"',
      '-c',
      'approval_policy="never"'
    ])
  })

  it('every level emits BOTH keys — a position is never half a permission', () => {
    for (const level of CODEX_PERMISSION.levels) {
      const keys = level.args.filter((a) => a !== '-c').map((a) => a.slice(0, a.indexOf('=')))
      expect(keys).toEqual(['sandbox_mode', 'approval_policy'])
    }
  })

  it('⚠ an override of the FIRST knob suppresses the whole position', () => {
    expect(resolveLevelArgs(CODEX_PERMISSION, 'auto', ['-c', 'sandbox_mode="read-only"'])).toEqual(
      []
    )
  })

  it('⚠ an override of the SECOND knob suppresses it too — the regression this exists for', () => {
    // Under `knobOf`, only `sandbox_mode` was registered and this returned the
    // level's four tokens, putting a second `approval_policy` on the argv.
    expect(resolveLevelArgs(CODEX_PERMISSION, 'auto', ['-c', 'approval_policy="never"'])).toEqual(
      []
    )
    // And through the DEFAULT path (rank 3), which is the one a real launch
    // takes when nobody touches the control.
    expect(
      resolveLevelArgs(CODEX_PERMISSION, undefined, ['-c', 'approval_policy="on-request"'])
    ).toEqual([])
  })

  it('the glued spelling of either knob suppresses as well', () => {
    expect(resolveLevelArgs(CODEX_PERMISSION, 'auto', ['-capproval_policy="never"'])).toEqual([])
    expect(resolveLevelArgs(CODEX_PERMISSION, 'auto', ['-csandbox_mode="read-only"'])).toEqual([])
  })

  it('⚠ still SPECIFIC — a near-miss on either key does not suppress', () => {
    // The rule the whole `overridesLevel` suite exists for, re-checked on the
    // second knob: a wider match here would silently disable the permission
    // control for anyone passing an unrelated config override.
    expect(
      resolveLevelArgs(CODEX_PERMISSION, 'auto', ['-c', 'approval_policy_granular="x"'])
    ).not.toEqual([])
    expect(resolveLevelArgs(CODEX_PERMISSION, 'auto', ['-c', 'sandbox_mode_extra="x"'])).not.toEqual(
      []
    )
    // ⚠ AND A BARE `-c`, which every other codex override also uses, must not
    // suppress: `-c` alone identifies no knob at all. This is the assertion that
    // would have caught a `knobsOf` that keyed its dedupe on the flag.
    expect(
      resolveLevelArgs(CODEX_PERMISSION, 'auto', ['-c', 'model_reasoning_effort="high"'])
    ).not.toEqual([])
  })

  it('⚠ the effort ladder is unaffected by the permission override, and vice versa', () => {
    // Two capabilities, both spelled `-c`, resolved independently. If knob
    // identity ever collapses to the flag, these two cross-suppress and the
    // symptom is an agent silently launched at the CLI's default effort.
    const CODEX_EFFORT = codexAdapter.getCapabilities().reasoningEffort!
    expect(resolveLevelArgs(CODEX_EFFORT, 'deep', ['-c', 'approval_policy="never"'])).toEqual([
      '-c',
      'model_reasoning_effort="high"'
    ])
    expect(
      resolveLevelArgs(CODEX_PERMISSION, 'auto', ['-c', 'model_reasoning_effort="high"'])
    ).toEqual(['-c', 'sandbox_mode="workspace-write"', '-c', 'approval_policy="on-request"'])
  })

  it('a single-knob descriptor is entirely unchanged by the widening', () => {
    // claude's permission ladder is still one flag, one position. The
    // generalization must be invisible to it.
    expect(overridesLevel(CLAUDE_PERMISSION, ['--permission-mode', 'plan'])).toBe(true)
    expect(overridesLevel(CLAUDE_PERMISSION, ['--permission-modes'])).toBe(false)
    expect(resolveLevelArgs(CLAUDE_PERMISSION, undefined, [])).toEqual(CLAUDE_DEFAULT_PERMISSION)
  })
})

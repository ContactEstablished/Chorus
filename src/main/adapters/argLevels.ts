/**
 * Task 3a-4's effort resolver, GENERALIZED on 2026-08-14 when permission mode
 * became the second capability with the identical shape. Beside `env.ts`, the
 * same kind of module — no I/O, no clock, no electron, total.
 *
 * ⚠ THE FILE WAS `effort.ts` AND THE FUNCTIONS WERE `resolveEffortArgs` /
 * `overridesEffort`. Nothing about the logic was effort-specific: a descriptor
 * with `levels: [{id, label, args}]` is a mapping from an app-level position to
 * argv tokens, and "effort" was simply the first fact that needed one. The
 * alternative — copying 100 lines of matching rules into a `permission.ts` —
 * would have put the `--effortless` / `model_reasoning_effort_summary` near-miss
 * rules in two places, where only one of them would get fixed next time.
 *
 * ⚠ THE PRECEDENCE ORDER, and it mirrors the model table's deliberately so
 * the app has ONE philosophy rather than two:
 *
 *   1 (wins)  the raw override in extra_args — the user has said what they
 *             want in the CLI's own vocabulary
 *   2         the app-level level chosen for THIS launch (Fast/Balanced/Deep/
 *             Max, or Auto/Accept edits/Plan/Manual), mapped per adapter
 *   3         the descriptor's OWN `defaultLevelId` — the adapter's opinion,
 *             added 2026-08-14 (see below)
 *   4 (floor) nothing emitted — the CLI's own default
 *
 * And the rule that makes rank 1 mean something: when `extraArgs` contains a
 * token Chorus recognises as THAT ADAPTER'S knob, Chorus emits NO argument of
 * its own at all — INCLUDING rank 3. It does not emit both and rely on the
 * CLI's last-wins parsing — last-wins is per-CLI, unverified, and differs
 * between an argv flag (`claude --effort`) and a config override
 * (`codex -c model_reasoning_effort=`). ONE AUTHORITY PER LAUNCH, decided in
 * one pure function.
 *
 * ⚠ RANK 3 IS THE 2026-08-14 ADDITION AND IT CHANGES ARGV FOR A DECLARING
 * ADAPTER. Before it, "nobody chose" and "emit nothing" were the same
 * statement, and `adapters.test.ts` asserted that as behaviour neutrality. They
 * are now different statements: an adapter may declare where it starts, and the
 * neutrality test was rewritten to assert the stricter, still-meaningful
 * property — that argv is the base plus THE DECLARED DEFAULTS AND NOTHING ELSE.
 * An adapter that declares no default is byte-identical to what it always was.
 *
 * (Same shape as `composeChildEnv`'s ordering under D54 — inherited < pins <
 * envAdditions < secretEnv — and it should read as familiar.)
 */

/**
 * The structural shape both `EffortDescriptor` and `PermissionModeDescriptor`
 * satisfy. Deliberately STRUCTURAL rather than a union of the two named types:
 * this module must not have to be edited to admit the third capability that
 * takes a levelled flag, and it has no business knowing which ones exist.
 */
export interface LevelledDescriptor {
  readonly levels: readonly {
    readonly id: string
    readonly label: string
    readonly args: readonly string[]
  }[]
  readonly defaultLevelId?: string
}

/**
 * The adapter's knob, derived FROM THE DESCRIPTOR'S OWN `args` rather than
 * hardcoded a second time — one home again.
 *
 * Two shapes exist among the shipped adapters and both are covered:
 *   `['--effort', 'high']`                       -> flag  `--effort`
 *   `['-c', 'model_reasoning_effort="high"']`    -> flag  `-c`, key `model_reasoning_effort`
 */
interface Knob {
  /** The first token, e.g. `--effort`, `--permission-mode` or `-c`. */
  readonly flag: string
  /** For `-c`-style knobs, the config key before the `=`. Null for plain
   *  flags, where the flag alone identifies the knob. */
  readonly configKey: string | null
}

function knobOf(descriptor: LevelledDescriptor): Knob | null {
  for (const level of descriptor.levels) {
    const [flag, value] = level.args
    if (typeof flag !== 'string' || flag.length === 0) continue
    if (typeof value === 'string') {
      const eq = value.indexOf('=')
      // A `key=value` second token means the KEY is the real knob; the flag
      // alone (`-c`) is shared with every other config override.
      if (eq > 0) return { flag, configKey: value.slice(0, eq) }
    }
    return { flag, configKey: null }
  }
  return null
}

/**
 * ⚠ SPECIFIC BY CONSTRUCTION. A substring match, a case-insensitive match, or
 * a match on the knob's name without its flag context would silently disable
 * the whole feature the first time a user passed an unrelated argument — and
 * it would look like it works. The named unit tests assert that `--effortless`,
 * `model_reasoning_effort_summary`, and a token merely CONTAINING the knob's
 * name do not suppress.
 *
 * Matching rules:
 *   - a plain flag knob (`--effort`) matches an exact whole token `--effort`,
 *     or the `--effort=value` long-option form;
 *   - a config-key knob (`-c` + `model_reasoning_effort`) matches only a token
 *     that is exactly `<key>=…` (or `<key> =`-free assignment), whether it
 *     follows a `-c` or arrives as `-c<key>=…`.
 */
export function overridesLevel(
  descriptor: LevelledDescriptor | null,
  extraArgs: readonly string[]
): boolean {
  if (descriptor === null) return false
  const knob = knobOf(descriptor)
  if (knob === null) return false

  for (const raw of extraArgs) {
    if (typeof raw !== 'string') continue
    const token = raw.trim()
    if (token.length === 0) continue

    if (knob.configKey === null) {
      // `--effort` exactly, or `--effort=high`. NOT `--effortless`, because
      // the character after the flag must be an `=` or nothing at all.
      if (token === knob.flag) return true
      if (token.startsWith(`${knob.flag}=`)) return true
      continue
    }

    // Config-key knob. The token carrying the assignment may arrive on its own
    // (`-c` `model_reasoning_effort="high"`) or glued to the flag
    // (`-cmodel_reasoning_effort="high"`).
    const body = token.startsWith(knob.flag) ? token.slice(knob.flag.length) : token
    const eq = body.indexOf('=')
    if (eq <= 0) continue
    // EXACT key equality — `model_reasoning_effort_summary=…` is a DIFFERENT
    // knob and must not suppress ours.
    if (body.slice(0, eq).trim() === knob.configKey) return true
  }
  return false
}

/**
 * Resolve the argv tokens this launch contributes for one levelled capability.
 *
 *   - `descriptor === null`                    -> `[]`, for every level, never a throw
 *   - a raw override present in `extraArgs`    -> `[]` (rank 1 SUPPRESSES everything below)
 *   - `level` names a declared level           -> that level's `args`
 *   - `level` absent or outside the vocabulary -> the descriptor's
 *                                                 `defaultLevelId`'s args, if it
 *                                                 declares one and that id is real
 *   - otherwise                                -> `[]`
 *
 * ⚠ AN UNRECOGNISED `level` FALLS TO THE DEFAULT RATHER THAN TO NOTHING, and
 * that is a deliberate change of the pre-2026-08-14 rule ("degrade to emit
 * nothing"). A database, a stale renderer, or a hand-edited profile can hand
 * over anything; when the adapter has stated where it starts, starting there is
 * a better answer to garbage than silently starting somewhere else. For an
 * adapter with no declared default the two rules are identical, so nothing that
 * relied on the old one changed.
 */
export function resolveLevelArgs(
  descriptor: LevelledDescriptor | null,
  level: string | undefined,
  extraArgs: readonly string[] = []
): readonly string[] {
  if (descriptor === null) return []
  if (overridesLevel(descriptor, extraArgs)) return []
  const chosen = level === undefined ? undefined : descriptor.levels.find((l) => l.id === level)
  if (chosen) return chosen.args
  if (descriptor.defaultLevelId === undefined) return []
  // ⚠ THE DEFAULT IS LOOKED UP, NOT TRUSTED. A `defaultLevelId` naming a level
  // the descriptor does not declare emits nothing rather than throwing at
  // spawn time — the declaration bug is caught by the per-adapter test, and a
  // launch is never the place to discover it.
  return descriptor.levels.find((l) => l.id === descriptor.defaultLevelId)?.args ?? []
}

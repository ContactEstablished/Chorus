import type { EffortDescriptor } from './types'

/**
 * Task 3a-4: effort normalization's pure resolver. Beside `env.ts`, the same
 * shape of module — no I/O, no clock, no electron, total.
 *
 * ⚠ THE PRECEDENCE ORDER, and it mirrors the model table's deliberately so
 * the app has ONE philosophy rather than two:
 *
 *   1 (wins)  the raw override in extra_args — the user has said what they
 *             want in the CLI's own vocabulary
 *   2         the app-level Fast/Balanced/Deep/Max level, mapped per adapter
 *   3 (floor) nothing emitted — the CLI's own default
 *
 * And the rule that makes rank 1 mean something: when `extraArgs` contains a
 * token Chorus recognises as THAT ADAPTER'S effort knob, Chorus emits NO
 * effort argument of its own at all. It does not emit both and rely on the
 * CLI's last-wins parsing — last-wins is per-CLI, unverified, and differs
 * between an argv flag (`claude --effort`) and a config override
 * (`codex -c model_reasoning_effort=`). ONE AUTHORITY PER LAUNCH, decided in
 * one pure function.
 *
 * (Same shape as `composeChildEnv`'s ordering under D54 — inherited < pins <
 * envAdditions < secretEnv — and it should read as familiar.)
 */

/**
 * The adapter's effort knob, derived FROM THE DESCRIPTOR'S OWN `args` rather
 * than hardcoded a second time — one home again.
 *
 * Two shapes exist among the shipped adapters and both are covered:
 *   `['--effort', 'high']`                       -> flag  `--effort`
 *   `['-c', 'model_reasoning_effort="high"']`    -> flag  `-c`, key `model_reasoning_effort`
 */
interface EffortKnob {
  /** The first token, e.g. `--effort` or `-c`. */
  readonly flag: string
  /** For `-c`-style knobs, the config key before the `=`. Null for plain
   *  flags, where the flag alone identifies the knob. */
  readonly configKey: string | null
}

function knobOf(descriptor: EffortDescriptor): EffortKnob | null {
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
export function overridesEffort(
  descriptor: EffortDescriptor | null,
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
 * Resolve the effort tokens this launch contributes.
 *
 *   - `descriptor === null`                  -> `[]`, for every level, never a throw
 *   - `level` absent or outside the vocabulary -> `[]`, never a throw
 *   - a raw override present in `extraArgs`  -> `[]` (rank 1 SUPPRESSES rank 2)
 *   - otherwise                              -> the matching option's `args`
 *
 * A database, a stale renderer, or a hand-edited profile can hand over
 * anything; every one of those degrades to "emit nothing", which is exactly
 * today's behaviour and therefore always safe.
 */
export function resolveEffortArgs(
  descriptor: EffortDescriptor | null,
  level: string | undefined,
  extraArgs: readonly string[] = []
): readonly string[] {
  if (descriptor === null || level === undefined) return []
  if (overridesEffort(descriptor, extraArgs)) return []
  const option = descriptor.levels.find((l) => l.id === level)
  if (!option) return []
  return option.args
}

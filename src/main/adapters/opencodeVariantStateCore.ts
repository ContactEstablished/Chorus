import path from 'node:path'

/**
 * Model Routing Task 4a-2 (MR-D25): the pure half of keeping opencode's remembered per-model TUI
 * variant (`<stateHome>/opencode/model.json`, `variant[<model as sent>]`) in step with the effort a
 * Chorus launch writes. The format and the state-directory rule were MEASURED on 1.18.33 (see
 * ImplementationSpec-4a-2) and re-measured on 1.18.34; any version outside
 * OPENCODE_VARIANT_STATE_VERSIONS is left alone.
 */

/**
 * The opencode versions whose state format and directory rule were measured: 1.18.33
 * (ImplementationSpec-4a-2 "Measured facts"), and 1.18.34 (2026-10-04: the same seven
 * `opencode debug paths` environments, its TUI's own model.json write, and
 * `verify-routing-body.mjs` checks 11 and 13–16). Add a version only after re-running all three.
 */
export const OPENCODE_VARIANT_STATE_VERSIONS = ['1.18.33', '1.18.34'] as const

/** True only for a version string that is exactly one of OPENCODE_VARIANT_STATE_VERSIONS (no trimming, prefixes or ranges). */
export function isVerifiedOpencodeStateVersion(version: string | null): boolean {
  return version !== null && (OPENCODE_VARIANT_STATE_VERSIONS as readonly string[]).includes(version)
}

/** A model.json above this many bytes is never touched (the measured file is 1,157). */
export const OPENCODE_STATE_FILE_CAP_BYTES = 1_000_000
/** modelEffortSchema's charset (shared/ipc.ts:1081–1085): a bare lowercase token. */
const EFFORT = /^[a-z0-9_-]{1,40}$/
const MODEL_KEY_MAX = 300

export type RememberedVariantState = 'invalid' | 'unreadable' | 'absent' | 'equal' | 'differs'

/** `<stateHome>/opencode/model.json`. */
export function opencodeModelStatePath(stateHome: string): string {
  return path.join(stateHome, 'opencode', 'model.json')
}

/** Windows environment names are case-insensitive: the exact name first, then any casing. */
function envValue(env: Readonly<Record<string, string | undefined>>, name: string): string | undefined {
  if (typeof env[name] === 'string') return env[name]
  const key = Object.keys(env).find((k) => k.toUpperCase() === name)
  return key === undefined ? undefined : env[key]
}

/**
 * C13, measured on 1.18.33 and 1.18.34 with `opencode debug paths`: the state root an opencode child resolves
 * from ITS environment — XDG_STATE_HOME when non-empty, else <USERPROFILE>/.local/state. HOME is
 * ignored. `fallbackHome` stands in when USERPROFILE is absent (main passes os.homedir(), which
 * resolves the same OS profile directory the child falls back to).
 */
export function opencodeStateHome(childEnv: Readonly<Record<string, string | undefined>>, fallbackHome: string): string {
  const xdg = envValue(childEnv, 'XDG_STATE_HOME')
  if (xdg) return xdg
  const profile = envValue(childEnv, 'USERPROFILE')
  return path.join(profile ? profile : fallbackHome, '.local', 'state')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * C12: 'invalid' (an empty, over-long or `__proto__` key, or an effort that is not a bare token);
 * 'unreadable' (no text, not JSON, a non-object root, a non-object `variant`); 'absent' (no
 * `variant` key, or no entry for this model); 'equal'; 'differs' (any other existing value).
 */
export function classifyRememberedVariant(currentText: string | null, modelKey: string, effort: string): RememberedVariantState {
  if (modelKey.length === 0 || modelKey.length > MODEL_KEY_MAX || modelKey === '__proto__' || !EFFORT.test(effort)) return 'invalid'
  if (currentText === null) return 'unreadable'
  let root: unknown
  try {
    root = JSON.parse(currentText)
  } catch {
    return 'unreadable'
  }
  if (!isPlainObject(root)) return 'unreadable'
  if (!Object.prototype.hasOwnProperty.call(root, 'variant')) return 'absent'
  const variant = root.variant
  if (!isPlainObject(variant)) return 'unreadable'
  if (!Object.prototype.hasOwnProperty.call(variant, modelKey)) return 'absent'
  return variant[modelKey] === effort ? 'equal' : 'differs'
}

/**
 * MR-D25: the new file text with ONLY `variant[modelKey]` set to `effort`, every other key and value
 * preserved as JSON, in the measured versions' own format (1.18.33 and 1.18.34 both write compact
 * `JSON.stringify`, one line, no trailing newline), or null
 * (= write nothing) unless `classifyRememberedVariant` says 'differs'.
 */
export function patchRememberedVariant(currentText: string | null, modelKey: string, effort: string): string | null {
  if (currentText === null || classifyRememberedVariant(currentText, modelKey, effort) !== 'differs') return null
  const root = JSON.parse(currentText) as Record<string, unknown>
  ;(root.variant as Record<string, unknown>)[modelKey] = effort
  return JSON.stringify(root)
}

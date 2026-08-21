import { execFile, execFileSync } from 'child_process'
import { existsSync, readFileSync, statSync } from 'fs'
import path from 'path'
import { promisify } from 'util'
import type { AgentKind, DetectedCli } from '../../shared/ipc'
import { getAdapter } from '../adapters/registry'
import type { AgentAdapter, InstallationStatus } from '../adapters/types'
import { MAX_SHIM_BYTES, parseNpmShim } from './cliShimCore'

const execFileAsync = promisify(execFile)

export interface ResolvedCli {
  /** absolute path to the executable node-pty should spawn */
  file: string
  /** args to prepend (only used for .cmd/.bat shims that need cmd.exe) */
  args: string[]
  /** the CLI's own location on disk (the .exe or the shim itself) */
  path: string
}

/**
 * Pick a spawnable form from where.exe output.
 *
 * node-pty/ConPTY can spawn a real .exe directly. Prefer the .exe when one is
 * on PATH; otherwise read what the .cmd shim launches and spawn THAT
 * (`resolveShim`), and only fall back to `cmd.exe /c` when the shim is a shape
 * we do not recognise.
 *
 * ⚠ THE cmd.exe ROUTE IS A LAST RESORT, NOT THE DEFAULT, SINCE F96. cmd.exe
 * re-parses the command line it is given, and node-pty's `\"` escaping desyncs
 * its quote tracking — after which `>` `<` `|` `&` in an argument VALUE are
 * read as operators. That is what killed every codex launch carrying contract
 * v2 (its Cypher arrows became a redirection into a file named `(old)`).
 * See `cliShimCore.ts` for the measurements.
 */
function pickSpawnable(candidates: string[]): ResolvedCli | null {
  const exe = candidates.find((c) => c.toLowerCase().endsWith('.exe'))
  if (exe) {
    return { file: exe, args: [], path: exe }
  }

  const shim = candidates.find(
    (c) => c.toLowerCase().endsWith('.cmd') || c.toLowerCase().endsWith('.bat')
  )
  if (shim) {
    // `path` stays the shim either way: it is what the user installed and what
    // detection reports, whatever we end up spawning on their behalf.
    return resolveShim(shim) ?? { file: 'cmd.exe', args: ['/c', shim], path: shim }
  }

  return null
}

/**
 * Resolve an npm shim to a direct spawn, or `null` to leave it to cmd.exe.
 *
 * ⚠ EVERY FAILURE HERE IS A `null`, NEVER A THROW. A shim we cannot read, a
 * template we do not recognise, a target that has been uninstalled from under
 * its shim, a missing node — each falls back to the behaviour that shipped
 * before this function existed. A resolver that threw would turn "we could not
 * improve this launch" into "this agent no longer launches".
 */
export function resolveShim(shim: string): ResolvedCli | null {
  let text: string
  try {
    if (statSync(shim).size > MAX_SHIM_BYTES) return null
    text = readFileSync(shim, 'utf8')
  } catch {
    return null
  }

  const target = parseNpmShim(text, shim)
  if (!target || !existsSync(target.file)) return null

  if (target.kind === 'executable') {
    return { file: target.file, args: [], path: shim }
  }

  const node = nodeInterpreter(shim)
  return node === null ? null : { file: node, args: [target.file], path: shim }
}

/** Memoised only on success — node arriving mid-session should be picked up. */
let cachedNodeExe: string | null = null

/**
 * The interpreter for a node-script shim, resolved the way npm's own template
 * resolves it: a `node.exe` sitting beside the shim wins, otherwise PATH.
 *
 * ⚠ NEVER `process.execPath`. In a packaged build that is Chorus.exe, and
 * handing it a script path would launch a second copy of the app rather than
 * node — a mistake with no compile-time signal and a spectacular runtime one.
 */
function nodeInterpreter(shim: string): string | null {
  const beside = path.join(path.dirname(shim), 'node.exe')
  if (existsSync(beside)) return beside

  if (cachedNodeExe !== null) return cachedNodeExe
  try {
    const out = execFileSync('where.exe', ['node'], { encoding: 'utf8' })
    const found = parseWhereOutput(out).find((c) => c.toLowerCase().endsWith('.exe'))
    if (found) cachedNodeExe = found
    return found ?? null
  } catch {
    return null
  }
}

function parseWhereOutput(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

/** Resolve a CLI on PATH via where.exe. Throws if no spawnable form exists. */
export function resolveCli(name: string): ResolvedCli {
  let output: string
  try {
    output = execFileSync('where.exe', [name], { encoding: 'utf8' })
  } catch {
    throw new Error(
      `Could not find the '${name}' CLI on PATH. Install it and ensure \`${name} --version\` works in a terminal.`
    )
  }

  const candidates = parseWhereOutput(output)
  const resolved = pickSpawnable(candidates)
  if (!resolved) {
    throw new Error(`Found '${name}' on PATH but no spawnable form: ${candidates.join(', ')}`)
  }
  return resolved
}

/** Tools reported by CLI detection. Agent CLIs first, then supporting tools. */
// D86: 'kimi' joins the agent probes. Order matters only for the rendered list;
// the agent entries lead so cli:detect reads agents-then-tools.
// D90: 'opencode' joins them, placed AFTER kimi because this list is the one
// home for launch-card order and Matthew asked for the OpenRouter option to sit
// beside the Kimi card.
// D165: 'grok' joins them, LAST among the agents — the three cards Matthew
// launches today keep their positions and the new one takes the slot after
// them (kimi's card is withheld by LaunchDialog's presentation filter, so on
// screen the order reads claude · codex · opencode · grok).
export const DETECTED_TOOLS = [
  'claude',
  'codex',
  'kimi',
  'opencode',
  'grok',
  'git',
  'docker',
  'node'
] as const

/**
 * The raw installation probe, shared by detectOne (plain tools) and by the
 * adapters' detectInstallation (agents) — ONE implementation, because the
 * byte-identical cli:detect response is Task 3-3's acceptance criterion and
 * two copies of this logic are how it drifts. Semantics unchanged from the
 * original detectOne: where.exe, pickSpawnable, then `<tool> --version` with
 * a 10 s timeout and windowsHide, first line only, 'unknown' when the probe
 * fails, nulls when nothing spawnable is found.
 */
export async function probeCli(name: string): Promise<InstallationStatus> {
  let candidates: string[]
  try {
    const { stdout } = await execFileAsync('where.exe', [name], { encoding: 'utf8' })
    candidates = parseWhereOutput(stdout)
  } catch {
    return { found: false, path: null, version: null }
  }

  const resolved = pickSpawnable(candidates)
  if (!resolved) {
    return { found: false, path: null, version: null }
  }

  let version = 'unknown'
  try {
    const { stdout } = await execFileAsync(resolved.file, [...resolved.args, '--version'], {
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true
    })
    const firstLine = stdout.split(/\r?\n/, 1)[0].trim()
    if (firstLine.length > 0) version = firstLine
  } catch {
    // Tool exists but the version probe failed (hung, non-zero exit, no --version).
  }

  return { found: true, path: resolved.path, version }
}

async function detectOne(name: string): Promise<DetectedCli> {
  const status = await probeCli(name)
  // Plain tools are not agents: no display data (D34(f)). Required-nullable
  // fields, so they are present-and-null rather than absent.
  return { name, ...status, displayName: null, agentKind: null }
}

/** Agents answer through their own adapter (CR-3.1 action 6), mapping
 *  InstallationStatus onto the wire shape and supplying the D34(f) display
 *  fields the renderer's launch cards now build from. */
async function detectViaAdapter(adapter: AgentAdapter): Promise<DetectedCli> {
  const status = await adapter.detectInstallation()
  return {
    name: adapter.id,
    found: status.found,
    path: status.path,
    version: status.version,
    displayName: adapter.displayName,
    agentKind: adapter.id as AgentKind // registry membership proves this
  }
}

let detection: Promise<DetectedCli[]> | null = null

function probeAll(): Promise<DetectedCli[]> {
  return Promise.all(
    DETECTED_TOOLS.map((name) => {
      const adapter = getAdapter(name)
      // Agents answer through their own adapter (CR-3.1 action 6); git, docker
      // and node stay on the plain tool probe, which is all they ever were.
      return adapter ? detectViaAdapter(adapter) : detectOne(name)
    })
  )
}

/**
 * Probe all known tools in parallel. Memoized: the first call per app launch
 * does the work and every later one reuses it.
 *
 * ⚠ THE MEMO IS RIGHT FOR THE BOOT SUMMARY AND WRONG FOR A DIALOG. `index.ts`
 * logs one line per tool at startup and must not pay for a second probe; a
 * launch dialog opened forty minutes later is asking a question about the
 * machine's CURRENT state. Both callers want this function, so the refresh is
 * a second entry point rather than a parameter nobody at boot would pass.
 */
export function detectClis(): Promise<DetectedCli[]> {
  detection ??= probeAll()
  return detection
}

/**
 * Re-probe, discarding the memo — what the launch dialog calls on open.
 *
 * ⚠ IT EXISTS BECAUSE THE MEMO CAN BE CONFIDENTLY WRONG, NOT MERELY STALE. A
 * version upgraded in a terminal leaves the dialog advertising a version that is
 * no longer installed — and since launching resolves the binary FRESH through
 * `resolveCli` on every spawn, the card and the process disagree. Worse, an
 * agent INSTALLED after Chorus started stays greyed out as undetected, with
 * nothing on screen to suggest a restart would fix it.
 *
 * ⚠ IT ALWAYS ASSIGNS RATHER THAN CLEARING-THEN-CALLING. `detection = null`
 * followed by `detectClis()` looks equivalent and is not: a concurrent caller
 * arriving between the two lines would see the null and start its own probe, so
 * one refresh could become several. Assigning the new promise in one statement
 * means late callers always join whichever probe is current.
 *
 * Measured at ~480ms wall clock across the (then) four agents (`kimi` dominates at
 * ~470ms), which is why the dialog renders the memo first and swaps this in when
 * it lands rather than blocking on it.
 */
export function refreshClis(): Promise<DetectedCli[]> {
  detection = probeAll()
  return detection
}

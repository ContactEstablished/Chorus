import { execFile, execFileSync } from 'child_process'
import { promisify } from 'util'
import type { AgentKind, DetectedCli } from '../../shared/ipc'
import { getAdapter } from '../adapters/registry'
import type { AgentAdapter, InstallationStatus } from '../adapters/types'

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
 * node-pty/ConPTY can spawn a real .exe directly, but npm-style .cmd shims
 * must go through cmd.exe. Prefer the .exe when both are present.
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
    return { file: 'cmd.exe', args: ['/c', shim], path: shim }
  }

  return null
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
export const DETECTED_TOOLS = ['claude', 'codex', 'git', 'docker', 'node'] as const

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

/** Probe all known tools in parallel. Memoized: runs once per app launch. */
export function detectClis(): Promise<DetectedCli[]> {
  detection ??= Promise.all(
    DETECTED_TOOLS.map((name) => {
      const adapter = getAdapter(name)
      // Agents answer through their own adapter (CR-3.1 action 6); git, docker
      // and node stay on the plain tool probe, which is all they ever were.
      return adapter ? detectViaAdapter(adapter) : detectOne(name)
    })
  )
  return detection
}

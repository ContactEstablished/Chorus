import { execFileSync } from 'child_process'

export interface ResolvedCli {
  /** absolute path to the executable node-pty should spawn */
  file: string
  /** args to prepend (only used for .cmd/.bat shims that need cmd.exe) */
  args: string[]
}

/**
 * Resolve the `claude` CLI on PATH via where.exe.
 *
 * node-pty/ConPTY can spawn a real .exe directly, but npm-style .cmd shims
 * must go through cmd.exe. Prefer the .exe when both are present.
 */
export function resolveClaudeCli(): ResolvedCli {
  let output: string
  try {
    output = execFileSync('where.exe', ['claude'], { encoding: 'utf8' })
  } catch {
    throw new Error(
      "Could not find the 'claude' CLI on PATH. Install Claude Code and ensure `claude --version` works in a terminal."
    )
  }

  const candidates = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  const exe = candidates.find((c) => c.toLowerCase().endsWith('.exe'))
  if (exe) {
    return { file: exe, args: [] }
  }

  const shim = candidates.find(
    (c) => c.toLowerCase().endsWith('.cmd') || c.toLowerCase().endsWith('.bat')
  )
  if (shim) {
    return { file: 'cmd.exe', args: ['/c', shim] }
  }

  throw new Error(`Found 'claude' on PATH but no spawnable form: ${candidates.join(', ')}`)
}

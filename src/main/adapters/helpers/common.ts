import { execFile } from 'node:child_process'
import path from 'node:path'
import { BASELINE_ENV_VARS, PINNED_ENV_VARS } from '../env'
import { resolveCli } from '../../services/cliDetect'
import type { HelperCapabilities, HelperExecutionInput, HelperId, HelperLaunchRequest } from './types'
import { applyVerifiedHelperEvidence } from './evidence'

export const MAX_HELPER_RECORD_BYTES = 1024 * 1024
export const MAX_HELPER_BRIEF_BYTES = 64 * 1024

/** Always allowlisted, including subscription launches. No ambient provider/bridge variables. */
export function composeHelperEnv(
  parent: NodeJS.ProcessEnv,
  request: Pick<HelperLaunchRequest, 'envAdditions' | 'secretEnv'>
): NodeJS.ProcessEnv {
  const baseline = new Set(BASELINE_ENV_VARS.map((name) => name.toUpperCase()))
  const env: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(parent)) {
    if (baseline.has(name.toUpperCase()) && value !== undefined) env[name] = value
  }
  for (const name of Object.keys(request.envAdditions)) {
    if (!['OPENCODE_DISABLE_AUTOUPDATE', 'OPENCODE_DISABLE_LSP_DOWNLOAD', 'OPENCODE_CONFIG_CONTENT', 'DISABLE_AUTOUPDATER'].includes(name)) {
      throw new Error('A helper environment addition may not carry authorization.')
    }
  }
  for (const name of Object.keys(request.secretEnv)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(name) || /^CHORUS_TEAM_/i.test(name) || baseline.has(name) || ['NODE_OPTIONS', 'COMSPEC', 'PATHEXT', 'ELECTRON_RUN_AS_NODE'].includes(name)) {
      throw new Error('Invalid helper credential environment name.')
    }
  }
  if (Object.keys(request.secretEnv).length > 1) throw new Error('Only the selected helper credential is allowed.')
  // Measured 2026-09-20: PowerShell cannot resolve node.exe without PATHEXT.
  // Measured 2026-09-30: npm's script shell cannot find cmd.exe when the host PATH
  // lacks System32. Pin the Windows shell path; never inherit a host ComSpec override.
  const systemRoot = Object.entries(env).find(([name]) => name.toUpperCase() === 'SYSTEMROOT')?.[1]
  return { ...env, ...PINNED_ENV_VARS, PATHEXT: '.COM;.EXE;.BAT;.CMD', ...(systemRoot ? { ComSpec: path.join(systemRoot, 'System32', 'cmd.exe') } : {}), ...request.envAdditions, ...request.secretEnv }
}

export function helperLaunch(id: HelperId, input: HelperExecutionInput): HelperLaunchRequest {
  input.signal.throwIfAborted()
  if (!path.isAbsolute(input.cwd)) throw new Error('Helper cwd must be absolute and verified by its owner.')
  if (!input.attemptId.trim() || !input.model.trim() || input.model.startsWith('-')) throw new Error('Missing helper identity or model.')
  if (!input.brief.trim() || Buffer.byteLength(input.brief, 'utf8') > MAX_HELPER_BRIEF_BYTES) throw new Error('Helper brief must contain 1–65536 UTF-8 bytes.')
  if (input.roleInstructions && Buffer.byteLength(input.roleInstructions, 'utf8') > 32768) throw new Error('Helper role instructions exceed their bounds.')
  if (input.context && Buffer.byteLength(input.context, 'utf8') > MAX_HELPER_BRIEF_BYTES) throw new Error('Helper context exceeds 65536 UTF-8 bytes.')
  if (input.acceptance && (input.acceptance.length > 32 || input.acceptance.some(s => !s.trim() || Buffer.byteLength(s, 'utf8') > 4096))) throw new Error('Helper acceptance criteria exceed their bounds.')
  if (input.credential && (!input.route || !input.credential.value || !/^[A-Z][A-Z0-9_]*$/.test(input.credential.envVarName))) throw new Error('An API helper requires its selected credential and route.')
  if (input.route && !input.credential) throw new Error('An API route cannot fall back to ambient subscription authentication.')
  const cli = resolveCli(id)
  const contract = input.kind === 'code'
    ? 'CHORUS CODE HELPER: Edit and test only your assigned workspace files. Do not stage, commit, change Git refs, push or remove worktrees. Chorus captures the finished working-tree changes as an immutable artifact after your process exits; no helper commit is needed. Report your changes, test commands/results and any permission blocker. This capture contract applies even if the task brief asks you to commit.'
    : 'CHORUS ANALYSIS HELPER: Inspect the assigned workspace and report advice. Do not edit files, commit, change Git refs or delegate to other agents.'
  // Interactive adapters retain their fallback. Structured helpers never invoke an unknown shell shim.
  if (/(?:^|[\\/])(?:cmd|powershell|pwsh)(?:\.exe)?$/i.test(cli.file) || /\.(?:cmd|bat)$/i.test(cli.file)) throw new Error('This helper CLI shim cannot be spawned without a shell.')
  return {
    executable: cli.file, args: [...cli.args], cwd: input.cwd,
    envAdditions: {}, secretEnv: input.credential ? { [input.credential.envVarName]: input.credential.value } : {},
    stdin: contract + '\nUse native read, glob and grep tools for file inspection and discovery. Never use bash/PowerShell for directory listing or reading: Get-ChildItem, Get-Location, ls, dir, cat, pwd and their piped variants are denied. Read the named reference files directly; a discovery shell command is unnecessary. A denied shell probe makes this attempt unsuccessful even if later edits are correct.' + (input.allowedCommands?.length ? '\nExact permitted shell commands (one standalone call each, no added flags, pipes, redirects or chaining): ' + input.allowedCommands.join('; ') + '. All other shell commands and delegation tools are denied. Report missing inputs instead of probing denied commands.' : '') + (input.references?.length ? '\n\nCommitted read-only contracts (read these before implementation; they supply the detailed requirements):\n' + input.references.join('\n') + '\nIf an input is missing, report the blocker instead of inventing requirements.' : '') + (input.roleInstructions ? '\n\nMember role (subject to the helper contract above):\n' + input.roleInstructions : '') + '\n\nTask brief:\n' + input.brief + (input.context ? '\n\nContext:\n' + input.context : '') + (input.acceptance?.length ? '\n\nAcceptance criteria:\n' + input.acceptance.join('\n') : '') + '\n', parserKind: id,
    permission: { mode: input.kind, cooperative: true, nativeDelegation: 'disabled' }
  }
}

export async function probeHelper(id: HelperId, signal: AbortSignal): Promise<HelperCapabilities> {
  const unverified = (reason: string) => ({ status: 'unverified' as const, reason })
  const result: HelperCapabilities = {
    id, executable: null, version: null,
    structured: unverified('Installed structured-output help has not been checked.'),
    subscription: unverified('Requires an installed-version, CLI-managed account probe.'),
    apiKey: unverified('Requires selected route/model/credential evidence.'),
    analysis: unverified('Requires native edit-denial evidence.'),
    code: unverified('Requires a real edit/test and unattended denial probe.'),
    cancellation: unverified('Requires owned descendant termination evidence.'),
    nativeSubagents: unverified('Requires native delegation suppression evidence.')
  }
  signal.throwIfAborted()
  try {
    const cli = resolveCli(id)
    if (/(?:^|[\\/])(?:cmd|powershell|pwsh)(?:\.exe)?$/i.test(cli.file) || /\.(?:cmd|bat)$/i.test(cli.file)) throw new Error('Unsupported structured helper shim.')
    result.executable = cli.file
    const run = (args: string[]) => new Promise<string>((resolve, reject) => {
      execFile(cli.file, [...cli.args, ...args], { windowsHide: true, signal, timeout: 10000, maxBuffer: MAX_HELPER_RECORD_BYTES }, (err, stdout) => err ? reject(err) : resolve(stdout))
    })
    result.version = (await run(['--version'])).trim().split(/\r?\n/)[0]
    const help = await run(id === 'claude' ? ['--help'] : [id === 'codex' ? 'exec' : 'run', '--help'])
    const flag = id === 'claude' ? '--output-format' : id === 'codex' ? '--json' : '--format'
    result.structured = help.includes(flag)
      ? { status: 'verified', reason: `${result.version}: installed help advertises ${flag}; this is syntax evidence only.` }
      : { status: 'unsupported', reason: `Installed help does not advertise ${flag}.` }
    if (id === 'opencode') result.subscription = { status: 'unsupported', reason: 'No subscription account routing has been verified for this helper adapter.' }
  } catch {
    signal.throwIfAborted()
    result.structured = { status: 'unsupported', reason: 'CLI resolution/version/help probe failed.' }
  }
  return applyVerifiedHelperEvidence(result)
}

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import type { TeamRun } from '../../shared/team'
import { teamAssert } from './teamCore'
import { HelperProcess } from './helperProcess'
import type { HelperEventParser } from '../adapters/helpers/types'
import { scrubSecrets } from './logger'

export type TeamCheck = 'node-test' | 'test' | 'typecheck' | 'build' | 'install'
export function teamAcceptanceChecks(profile: TeamRun['config']['verificationProfile']): TeamCheck[] {
  return profile === 'npm-project' ? ['test', 'typecheck', 'build'] : ['node-test']
}
export function teamCheckSpec(profile: TeamRun['config']['verificationProfile'], command: TeamCheck): { command: string; args: string[]; sourcePaths: string[] } {
  teamAssert(command === 'node-test' || profile === 'npm-project', 'CHECK_UNAVAILABLE', 'Select the npm project verification profile to use npm checks.')
  if (command === 'node-test') return { command: 'node --test', args: ['--test'], sourcePaths: ['.'] }
  if (command === 'install') return { command: 'npm ci', args: ['ci', '--no-audit', '--no-fund'], sourcePaths: ['package.json', 'package-lock.json'] }
  return { command: command === 'test' ? 'npm test' : `npm run ${command}`, args: command === 'test' ? ['test'] : ['run', command], sourcePaths: ['package.json'] }
}
export function teamNativeCheckLaunch(cwd: string, spec: ReturnType<typeof teamCheckSpec>) {
  const node = execFileSync('where.exe', ['node.exe'], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/).find(p => path.isAbsolute(p) && fs.existsSync(p))
  teamAssert(node, 'NODE_UNAVAILABLE', 'Native Node.js is required for project verification.')
  if (spec.command.startsWith('node ')) return { executable: node, args: spec.args, cwd }
  const npmPaths = execFileSync('where.exe', ['npm.cmd'], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/)
  const cli = npmPaths.map(p => path.join(path.dirname(p), 'node_modules/npm/bin/npm-cli.js')).find(p => fs.existsSync(p))
  teamAssert(cli, 'NPM_UNAVAILABLE', 'Native npm CLI could not be resolved; no shell fallback is used.')
  return { executable: node, args: [cli, ...spec.args], cwd }
}

/** Reuses the owned-process executor; checks cannot leave unaccounted-for shell descendants. */
export async function executeTeamCheck(cwd: string, spec: ReturnType<typeof teamCheckSpec>, options: {
  executionMs: number; authorize(): void; observed: ConstructorParameters<typeof HelperProcess>[0]['onProcessObservation']; intent: ConstructorParameters<typeof HelperProcess>[0]['onTerminationIntent']; signal?: AbortSignal
  retiring?: ConstructorParameters<typeof HelperProcess>[0]['onCompletionRetirement']
}) {
  let output = ''
  const parser: HelperEventParser = {
    push(chunk) { output = (output + scrubSecrets(Buffer.from(chunk).toString('utf8'))).slice(-16384); return [] },
    finish() { return [{ type: 'result', summary: 'Project command exited; exit status and process cessation determine acceptance.', isError: false }] }
  }
  const launch = teamNativeCheckLaunch(cwd, spec)
  // The native Node wrapper stays alive until identity publication; even a millisecond check is owned.
  const runner = "const {spawn}=require('node:child_process');process.stdin.resume();process.stdin.once('end',()=>{const child=spawn(process.execPath,process.argv.slice(1),{stdio:['ignore','inherit','inherit'],shell:false,windowsHide:true});child.once('error',()=>process.exit(1));child.once('close',code=>process.exit(code===null?1:code));});"
  const process = new HelperProcess({ gateInputUntilIdentified: true, request: { ...launch, args: ['-e', runner, '--', ...launch.args], envAdditions: {}, secretEnv: {}, stdin: '', parserKind: 'opencode', permission: { mode: 'code', cooperative: true, nativeDelegation: 'disabled' } }, parser,
    executionMs: options.executionMs, authorizeSpawn: options.authorize, onEvent(event) { if (event.type === 'activity' && event.category === 'stderr') output = (output + event.text).slice(-16384) }, onProcessObservation: options.observed, onTerminationIntent: options.intent, onCompletionRetirement: options.retiring })
  const cancel = () => { void process.cancel('cancelled') }
  options.signal?.addEventListener('abort', cancel, { once: true })
  if (options.signal?.aborted) cancel()
  try {
    const result = await process.done
    await process.retireCompleted()
    const state = process.inspect()
    return { ...result, cessation: state.cessation === 'confirmed' ? 'confirmed' as const : 'unknown' as const, process: state.process, descendants: state.descendants, intent: state.intent, output }
  } finally { options.signal?.removeEventListener('abort', cancel); await process.dispose() }
}

export function helperCheckCommands(profile: TeamRun['config']['verificationProfile']): string[] {
  return profile === 'npm-project' ? ['node --test', 'npm test', 'npm run typecheck', 'npm run build'] : ['node --test']
}

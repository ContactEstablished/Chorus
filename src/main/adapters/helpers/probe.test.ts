import { beforeEach, describe, expect, it, vi } from 'vitest'
import { probeHelper } from './common'

const stub = vi.hoisted(() => ({
  answers: new Map<string, { stdout: string; stderr: string; error?: Error }>(),
  calls: [] as { file: string; args: string[]; options: Record<string, unknown> }[]
}))
vi.mock('node:child_process', () => ({ execFile: vi.fn((file: string, args: string[], options: Record<string, unknown>, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
  stub.calls.push({ file, args: [...args], options })
  const answer = stub.answers.get(args.join(' '))
  if (!answer) throw new Error('Unexpected probe call.')
  callback(answer.error ?? null, answer.stdout, answer.stderr)
}) }))
vi.mock('../../services/cliDetect', () => ({ resolveCli: (id: string) => ({ file: `C:\\Program Files\\${id}.exe`, args: [] }) }))
const HELP = 'OpenCode run usage: --format json'
const probe = (id: 'claude' | 'codex' | 'opencode' = 'opencode') => probeHelper(id, new AbortController().signal)
beforeEach(() => {
  stub.calls.length = 0
  stub.answers.clear()
  stub.answers.set('--version', { stdout: '1.18.34\n', stderr: '' })
  stub.answers.set('run --help', { stdout: '', stderr: HELP })
})

describe('Table PR — installed helper syntax probe', () => {
  it('PR1: OpenCode help on stderr is found with bounded hidden calls', async () => {
    const result = await probe()
    expect(result.version).toBe('1.18.34')
    expect(result.executable).toBe('C:\\Program Files\\opencode.exe')
    expect(result.structured).toStrictEqual({ status: 'verified', reason: '1.18.34: installed help advertises --format; this is syntax evidence only.' })
    expect(result.subscription).toStrictEqual({ status: 'unsupported', reason: 'No subscription account routing has been verified for this helper adapter.' })
    expect(stub.calls.map(c => c.args)).toEqual([['--version'], ['run', '--help']])
    for (const call of stub.calls) expect(call.options).toMatchObject({ windowsHide: true, timeout: 10000, maxBuffer: 1048576 })
  })
  it('PR2: syntax evidence does not change admission evidence', async () => {
    const result = await probe()
    for (const key of ['apiKey', 'analysis', 'code', 'cancellation', 'nativeSubagents'] as const) expect(result[key].status).toBe('unverified')
  })
  it('PR3: version stays stdout-only even when stderr has warnings or a version', async () => {
    stub.answers.set('--version', { stdout: '1.18.34\n', stderr: 'Warning: a newer version is available\n' })
    expect((await probe()).version).toBe('1.18.34')
    stub.answers.set('--version', { stdout: '', stderr: '1.18.34\n' })
    expect((await probe()).version).toBe('')
  })
  it('PR4: neither stream invents a missing structured-output flag', async () => {
    stub.answers.set('run --help', { stdout: 'usage', stderr: 'usage' })
    expect((await probe()).structured).toStrictEqual({ status: 'unsupported', reason: 'Installed help does not advertise --format.' })
  })
  it('PR5: Codex and Claude stdout help still provide syntax evidence', async () => {
    stub.answers.set('--version', { stdout: 'codex-cli 0.155.1\n', stderr: '' })
    stub.answers.set('exec --help', { stdout: 'usage --json', stderr: '' })
    expect((await probe('codex')).structured).toStrictEqual({ status: 'verified', reason: 'codex-cli 0.155.1: installed help advertises --json; this is syntax evidence only.' })
    stub.answers.set('--version', { stdout: '2.1.278 (Claude Code)\n', stderr: '' })
    stub.answers.set('--help', { stdout: 'usage --output-format', stderr: '' })
    expect((await probe('claude')).structured).toStrictEqual({ status: 'verified', reason: '2.1.278 (Claude Code): installed help advertises --output-format; this is syntax evidence only.' })
  })
  it('PR6: help errors keep the known version and refuse syntax evidence', async () => {
    stub.answers.set('run --help', { stdout: '', stderr: '', error: new Error('help failed') })
    const result = await probe()
    expect(result.version).toBe('1.18.34')
    expect(result.structured).toStrictEqual({ status: 'unsupported', reason: 'CLI resolution/version/help probe failed.' })
  })
})

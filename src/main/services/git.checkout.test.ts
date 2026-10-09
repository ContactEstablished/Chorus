import { afterEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, basename } from 'node:path'
import { worktreeAdd, teamResolveCommit } from './git'

const exec = promisify(execFile), roots: string[] = []
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const quote = (path: string) => `'${path.replace(/\\/g, '/').replace(/'/g, `'"'"'`)}'`
async function git(cwd: string, ...args: string[]) { return (await exec('git', args, { cwd, windowsHide: true, timeout: 15000 })).stdout }
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'chorus-checkout-test-')); roots.push(root)
  const source = join(root, 'source'), target = join(root, 'workspace'); await mkdir(source)
  await git(source, 'init', '-qb', 'main')
  await git(source, 'config', 'core.autocrlf', 'false')
  await writeFile(join(source, 'input.txt'), 'fixture\n')
  await git(source, 'add', '--all')
  await git(source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'fixture')
  return { root, source, target, base: await teamResolveCommit(source, 'HEAD') }
}
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('chorus-checkout-test-')) throw Error('Unsafe fixture cleanup')
    await rm(root, { recursive: true, force: true })
  }
})

describe('cancellable managed Git checkout', () => {
  it('checks out the selected commit and reports bounded progress', async () => {
    const f = await fixture(), progress: string[] = []
    await worktreeAdd(f.source, f.target, 'fixture-team', f.base, { signal: new AbortController().signal, onProgress: message => progress.push(message) })
    expect(await teamResolveCommit(f.target, 'HEAD')).toBe(f.base)
    expect(await readFile(join(f.target, 'input.txt'), 'utf8')).toBe('fixture\n')
    expect(progress.length).toBeGreaterThan(0)
    expect(progress.every(message => message.length <= 500)).toBe(true)
  })
  it('Stop terminates the checkout and its Windows descendants without deleting the reserved workspace', async () => {
    const f = await fixture(), controller = new AbortController(), marker = join(f.root, 'child-pid.txt'), runner = join(f.root, 'wait.cjs')
    await writeFile(runner, `require('node:fs').writeFileSync(process.argv[2], String(process.pid)); setInterval(() => {}, 1000)\n`)
    // A deliberately slow native post-checkout child represents a bulk checkout
    // still running after the UI has requested Stop. No model or network calls.
    await writeFile(join(f.source, '.git', 'hooks', 'post-checkout'), `#!/bin/sh\n${quote(process.execPath)} ${quote(runner)} ${quote(marker)}\n`, { mode: 0o755 })
    const work = worktreeAdd(f.source, f.target, 'fixture-stop', f.base, { signal: controller.signal })
    const settled = work.then(() => null, error => error)
    try {
      let pid = 0
      const deadline = Date.now() + 10000
      while (!pid && Date.now() < deadline) { try { pid = Number(await readFile(marker, 'utf8')) } catch {} if (!pid) await sleep(25) }
      expect(pid).toBeGreaterThan(0)
      controller.abort(new Error('Preparation stopped by user'))
      expect(await settled).toMatchObject({ message: 'Preparation stopped by user' })
      if (process.platform === 'win32') expect(() => process.kill(pid, 0)).toThrow()
      expect(await readFile(join(f.target, 'input.txt'), 'utf8')).toBe('fixture\n')
    } finally { controller.abort(); await settled }
  })
  it('an already cancelled request creates no Git worktree', async () => {
    const f = await fixture(), controller = new AbortController(); controller.abort(new Error('Cancelled before checkout'))
    await expect(worktreeAdd(f.source, f.target, 'fixture-never-started', f.base, { signal: controller.signal })).rejects.toThrow('Cancelled before checkout')
    expect(await git(f.source, 'worktree', 'list', '--porcelain')).not.toContain('fixture-never-started')
  })
})

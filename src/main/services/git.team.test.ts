import { afterEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, writeFile, readFile, rename, unlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { teamCreateArtifactObjects, teamPublishArtifactRef, teamResolveCommit, teamStatus, teamIsAncestor } from './git'
import { teamFixtureId as id, TEAM_FIXTURE_TIME as now } from './teamTestFixtures'
const exec = promisify(execFile), roots: string[] = []
async function git(cwd: string, ...args: string[]) { return (await exec('git', args, { cwd, windowsHide: true, timeout: 15000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })).stdout }
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !root.includes('chorus-team-git-test-')) throw Error('Refusing cleanup outside fixture root.')
    await rm(root, { recursive: true, force: true })
  }
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'chorus-team-git-test-')); roots.push(root)
  const source = join(root, 'source'), helper = join(root, 'helper'); await mkdir(source)
  await git(source, 'init', '-b', 'main')
  await writeFile(join(source, '.gitignore'), '*.log\n')
  await writeFile(join(source, 'keep.txt'), 'base\n'); await writeFile(join(source, 'rename.txt'), 'rename me\n'); await writeFile(join(source, 'delete.txt'), 'delete me\n')
  await git(source, 'add', '--all')
  await git(source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-m', 'base')
  const base = await teamResolveCommit(source, 'HEAD')
  await git(source, 'worktree', 'add', '-b', 'fixture-helper', helper, base)
  const reservation = { runId: id(1), attemptId: id(20), captureId: id(30), baseSha: base, ref: `refs/chorus/teams/${id(1)}/artifacts/${id(20)}`, authorName: 'Chorus' as const, authorEmail: 'chorus@localhost' as const, at: now }
  return { root, source, helper, base, reservation }
}
describe('real Git team artifact objects', () => {
  it('restores an exactly attributed tracked launch blob and excludes only attributed untracked configuration', async () => {
    const f = await fixture(), originalBlob = (await git(f.helper, 'rev-parse', `${f.base}:keep.txt`)).trim()
    await writeFile(join(f.helper, 'keep.txt'), 'generated tracked configuration\n')
    await writeFile(join(f.helper, '.mcp.json'), '{"generated":true}\n')
    await writeFile(join(f.helper, 'real-result.txt'), 'keep helper output\n')
    const generated = [{ path: 'keep.txt', writtenSha256: hash('generated tracked configuration\n'), original: { blobSha: originalBlob, mode: '100644' as const } }, { path: '.mcp.json', writtenSha256: hash('{"generated":true}\n'), original: null }]
    const result = await teamCreateArtifactObjects(f.helper, f.reservation, generated)
    expect(await git(f.helper, 'show', `${result.commitSha}:keep.txt`)).toBe('base\n')
    expect(result.manifest).toContain('real-result.txt'); expect(result.manifest).not.toContain('.mcp.json')
    expect(await readFile(join(f.helper, 'keep.txt'), 'utf8')).toBe('generated tracked configuration\n')
    await writeFile(join(f.helper, 'keep.txt'), 'helper also edited this file\n')
    await expect(teamCreateArtifactObjects(f.helper, f.reservation, generated)).rejects.toThrow(/Helper changed/)
  }, 30000)
  it('refuses gitlink/submodule index state rather than silently omit it', async () => {
    const f = await fixture()
    await git(f.helper, 'update-index', '--add', '--cacheinfo', '160000', f.base, 'submodule')
    await expect(teamCreateArtifactObjects(f.helper, f.reservation)).rejects.toThrow(/Submodule capture/)
  }, 30000)
  it('squashes helper commits plus final dirt using a temporary index and preserves source content', async () => {
    const f = await fixture()
    await writeFile(join(f.source, 'keep.txt'), 'uncommitted source must remain\n')
    const sourceBefore = hash(await readFile(join(f.source, 'keep.txt'))), sourceStatus = await git(f.source, 'status', '--porcelain=v1', '-z')
    await writeFile(join(f.helper, 'committed.txt'), 'helper commit\n'); await git(f.helper, 'add', '--all')
    await git(f.helper, '-c', 'user.name=Helper', '-c', 'user.email=helper@localhost', 'commit', '-m', 'helper intermediate')
    const finalHead = await teamResolveCommit(f.helper, 'HEAD')
    await rename(join(f.helper, 'rename.txt'), join(f.helper, 'renamed ü space.txt')); await unlink(join(f.helper, 'delete.txt'))
    await writeFile(join(f.helper, 'keep.txt'), 'staged version\n'); await git(f.helper, 'add', '--all')
    await writeFile(join(f.helper, 'keep.txt'), 'final working version\n'); await writeFile(join(f.helper, '-leading.txt'), 'leading name\n')
    await writeFile(join(f.helper, 'binary.dat'), Buffer.from([0, 255, 1, 128, 0])); await writeFile(join(f.helper, 'ignored.log'), 'must stay ignored')
    const indexPath = (await git(f.helper, 'rev-parse', '--path-format=absolute', '--git-path', 'index')).trim(), indexBefore = hash(await readFile(indexPath))
    const objects = await teamCreateArtifactObjects(f.helper, f.reservation)
    expect(objects.noChanges).toBe(false); expect(objects.finalHelperHead).toBe(finalHead)
    expect(objects.manifest).toEqual(expect.arrayContaining(['committed.txt', 'keep.txt', 'renamed ü space.txt', '-leading.txt', 'binary.dat']))
    expect(objects.manifest).not.toContain('ignored.log'); expect(objects.manifest).not.toContain('delete.txt'); expect(objects.manifest).not.toContain('rename.txt')
    expect((await git(f.helper, 'show', `${objects.commitSha}:keep.txt`))).toBe('final working version\n')
    const binary = (await exec('git', ['show', `${objects.commitSha}:binary.dat`], { cwd: f.helper, encoding: 'buffer', windowsHide: true })).stdout
    expect(binary).toEqual(Buffer.from([0, 255, 1, 128, 0]))
    expect((await git(f.helper, 'rev-list', '--parents', '-n', '1', objects.commitSha!)).trim()).toBe(`${objects.commitSha} ${f.base}`)
    expect((await git(f.helper, 'show', '-s', '--format=%an <%ae>', objects.commitSha!)).trim()).toBe('Chorus <chorus@localhost>')
    expect(hash(await readFile(indexPath))).toBe(indexBefore); expect(hash(await readFile(join(f.source, 'keep.txt')))).toBe(sourceBefore)
    expect(await git(f.source, 'status', '--porcelain=v1', '-z')).toBe(sourceStatus)
    await expect(git(f.helper, 'show-ref', '--verify', f.reservation.ref)).rejects.toThrow()
    await teamPublishArtifactRef(f.helper, f.reservation, objects.commitSha!)
    await teamPublishArtifactRef(f.helper, f.reservation, objects.commitSha!)
    expect(await teamResolveCommit(f.helper, f.reservation.ref)).toBe(objects.commitSha)
    await expect(teamPublishArtifactRef(f.helper, f.reservation, f.base)).rejects.toThrow()
    expect(await teamResolveCommit(f.helper, 'HEAD')).toBe(finalHead)
  }, 30000)
  it('reports no-change code without inventing an applied artifact and excludes ignored analysis dirt', async () => {
    const f = await fixture(); await writeFile(join(f.helper, 'ignored.log'), 'ignored write')
    expect((await teamStatus(f.helper)).clean).toBe(true)
    const objects = await teamCreateArtifactObjects(f.helper, f.reservation)
    expect(objects).toMatchObject({ noChanges: true, commitSha: null, baseSha: f.base })
    await expect(git(f.helper, 'show-ref', '--verify', f.reservation.ref)).rejects.toThrow()
    await expect(teamResolveCommit(f.source, '--help')).rejects.toThrow()
    expect(await teamIsAncestor(f.helper, f.base, f.base)).toBe(true)
  }, 30000)
  it('rejects unresolved index state and unrelated history without overwriting retained work', async () => {
    const f = await fixture()
    const blob = (await git(f.helper, 'rev-parse', 'HEAD:keep.txt')).trim()
    const child = execFile('git', ['update-index', '--index-info'], { cwd: f.helper, windowsHide: true })
    child.stdin!.end(`0 ${'0'.repeat(40)}\tkeep.txt\n100644 ${blob} 1\tkeep.txt\n100644 ${blob} 2\tkeep.txt\n100644 ${blob} 3\tkeep.txt\n`)
    await new Promise<void>((resolveDone, reject) => { child.once('error', reject); child.once('close', code => code === 0 ? resolveDone() : reject(Error('Fixture index injection failed'))) })
    const before = await git(f.helper, 'ls-files', '--unmerged', '-z')
    await expect(teamCreateArtifactObjects(f.helper, f.reservation)).rejects.toThrow(/Unresolved/)
    expect(await git(f.helper, 'ls-files', '--unmerged', '-z')).toBe(before)
  }, 30000)
})

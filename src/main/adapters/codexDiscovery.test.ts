import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Task 4a-2: `codexAdapter.discoverSessionId`.
 *
 * ⚠ A SEPARATE FILE BECAUSE THE `os.homedir()` MOCK IS MODULE-WIDE. Discovery
 * reads `~/.codex/sessions`, and the ruled signature takes only a
 * `DiscoverSessionContext` — there is no root parameter to inject. Mocking here
 * keeps `adapters.test.ts` on the real `node:os`, which its hooks fixture uses.
 *
 * ⚠ NOTHING IN THE APP CALLS THIS FUNCTION. 4a-3 owns its invocation, bounding
 * and persistence; these tests are its only caller, which is the same
 * deliberate shape Task 4a-1 shipped its database column in.
 */
let fakeHome: string

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, default: { ...actual, homedir: () => fakeHome } }
})

const { codexAdapter } = await import('./codex')

/** Write a rollout file whose FIRST LINE is a `session_meta` header, in the
 *  shape measured off a real codex 0.147.0 session. */
function writeRollout(
  day: string,
  sessionId: string,
  cwd: string,
  startedAtIso: string,
  extraLines: readonly string[] = []
): void {
  const dir = path.join(fakeHome, '.codex', 'sessions', day)
  fs.mkdirSync(dir, { recursive: true })
  const header = JSON.stringify({
    timestamp: startedAtIso,
    type: 'session_meta',
    payload: {
      session_id: sessionId,
      id: sessionId,
      timestamp: startedAtIso,
      cwd,
      originator: 'codex_cli',
      cli_version: '0.147.0'
    }
  })
  fs.writeFileSync(
    path.join(dir, `rollout-${startedAtIso.replace(/[:.]/g, '-')}-${sessionId}.jsonl`),
    [header, ...extraLines].join('\n')
  )
}

const CWD = 'C:\\Projects\\Chorus'
const T0 = Date.parse('2026-08-13T12:00:00.000Z')
const ctx = (over: Partial<{ cwd: string; launchedAt: number; signal: AbortSignal }> = {}) => ({
  cwd: CWD,
  launchedAt: T0,
  signal: new AbortController().signal,
  ...over
})

describe('codex discoverSessionId (D139 Q3 / D140)', () => {
  beforeEach(() => {
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'chorus-4a2-discover-'))
  })
  afterEach(() => {
    fs.rmSync(fakeHome, { recursive: true, force: true })
  })

  it('finds the session whose header cwd matches exactly and is not older than launchedAt', async () => {
    writeRollout('2026/08/13', 'aaaa-1', CWD, '2026-08-13T12:00:05.000Z')
    expect(await codexAdapter.discoverSessionId(ctx())).toBe('aaaa-1')
  })

  it('returns null when the sessions tree does not exist at all', async () => {
    // A missing tree is "not found", not an error — every null-ish outcome is
    // the same answer to the caller.
    expect(await codexAdapter.discoverSessionId(ctx())).toBeNull()
  })

  // ⚠ EXACT EQUALITY, AND THIS IS THE TEST THAT STOPS A PANE ADOPTING A SIBLING
  // WORKTREE'S CONVERSATION. Not a prefix, not case-insensitive, not a realpath
  // guess — `.chorus/worktrees/x` is a different checkout and a different
  // conversation.
  it.each([
    ['a sibling worktree', 'C:\\Projects\\Chorus\\.chorus\\worktrees\\feature'],
    ['a parent directory', 'C:\\Projects'],
    ['a different case', 'c:\\projects\\chorus']
  ])('rejects %s — cwd equality is exact', async (_label, otherCwd) => {
    writeRollout('2026/08/13', 'bbbb-1', otherCwd, '2026-08-13T12:00:05.000Z')
    expect(await codexAdapter.discoverSessionId(ctx())).toBeNull()
  })

  // ⚠ launchedAt IS A HARD LOWER BOUND. Without it, a second Chorus launch in a
  // worktree that already had a codex session would adopt the OLD conversation
  // — matching cwd, wrong session.
  it('rejects a rollout older than launchedAt even when the cwd matches', async () => {
    writeRollout('2026/08/13', 'cccc-old', CWD, '2026-08-13T11:59:59.000Z')
    expect(await codexAdapter.discoverSessionId(ctx())).toBeNull()
  })

  // ⚠ AMBIGUITY IS NULL, NEVER "THE NEWEST". Preferring the newest is precisely
  // how a pane resumes someone else's conversation; an empty pointer only costs
  // a manual relaunch (D140).
  it('returns null when two candidates match — it never picks the newest', async () => {
    writeRollout('2026/08/13', 'dddd-1', CWD, '2026-08-13T12:00:05.000Z')
    writeRollout('2026/08/13', 'dddd-2', CWD, '2026-08-13T12:00:09.000Z')
    expect(await codexAdapter.discoverSessionId(ctx())).toBeNull()
  })

  it('returns null when the signal is already aborted, and never persists a result', async () => {
    writeRollout('2026/08/13', 'eeee-1', CWD, '2026-08-13T12:00:05.000Z')
    const ac = new AbortController()
    ac.abort()
    expect(await codexAdapter.discoverSessionId(ctx({ signal: ac.signal }))).toBeNull()
  })

  // ⚠ F57: `session_index.jsonl` CARRIES NO `cwd`, so it cannot answer "the
  // session I just launched in this directory" and must never be identity
  // evidence. Planted here with a matching id to prove it is not read.
  it('ignores session_index.jsonl entirely (F57 — it has no cwd)', async () => {
    const dir = path.join(fakeHome, '.codex')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'session_index.jsonl'),
      JSON.stringify({ id: 'ffff-index', thread_name: 'x', updated_at: '2026-08-13T12:00:05.000Z' })
    )
    expect(await codexAdapter.discoverSessionId(ctx())).toBeNull()
  })

  it('skips files that are not rollout headers rather than throwing', async () => {
    const dir = path.join(fakeHome, '.codex', 'sessions', '2026/08/13')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'rollout-broken.jsonl'), 'not json at all\n')
    fs.writeFileSync(
      path.join(dir, 'rollout-wrongtype.jsonl'),
      JSON.stringify({ type: 'response_item', payload: {} })
    )
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignored')
    writeRollout('2026/08/13', 'gggg-1', CWD, '2026-08-13T12:00:05.000Z')
    expect(await codexAdapter.discoverSessionId(ctx())).toBe('gggg-1')
  })

  // Only the FIRST line is identity evidence — reading further would mean
  // parsing conversation content to answer a question about identity.
  it('reads only the first line, not later records', async () => {
    writeRollout('2026/08/13', 'hhhh-1', CWD, '2026-08-13T12:00:05.000Z', [
      JSON.stringify({ type: 'session_meta', payload: { session_id: 'IMPOSTER', cwd: CWD } })
    ])
    expect(await codexAdapter.discoverSessionId(ctx())).toBe('hhhh-1')
  })
})

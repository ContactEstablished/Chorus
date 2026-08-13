import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * `codexAdapter.discoverSessionId` — Task 4a-2, REWRITTEN for F64's contract.
 *
 * ⚠ THE CONTRACT CHANGED FROM "SCAN ONCE AND ANSWER" TO "RESOLVE WHEN THE
 * ANSWER EXISTS", AND THAT IS THE FIX RATHER THAN A SIDE EFFECT. F64 measured
 * that codex does not write its rollout file until the user submits their FIRST
 * TURN — 22.6 s after spawn in one run, 3 m 19 s in another — so a function that
 * scanned once and returned could only ever answer "not found". It now waits on
 * the signal, which is why every no-match assertion below has to ABORT to get
 * its `null`: waiting is the point.
 *
 * ⚠ A SEPARATE FILE BECAUSE THE `os.homedir()` MOCK IS MODULE-WIDE (unchanged
 * from 4a-2): discovery reads `~/.codex/sessions` and the ruled signature takes
 * no root parameter.
 */
let fakeHome: string

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, default: { ...actual, homedir: () => fakeHome } }
})

const { codexAdapter } = await import('./codex')

/** Write a rollout whose FIRST LINE is a `session_meta` header, in the shape
 *  measured off a real codex 0.147.0 session. */
function writeRollout(
  day: string,
  sessionId: string,
  cwd: string,
  startedAtIso: string,
  extraLines: readonly string[] = [],
  originator = 'codex-tui'
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
      originator,
      cli_version: '0.147.0'
    }
  })
  fs.writeFileSync(
    path.join(dir, `rollout-${startedAtIso.replace(/[:.]/g, '-')}-${sessionId}.jsonl`),
    [header, ...extraLines].join('\n')
  )
}

const CWD = 'C:\\Projects\\Chorus'
/** Chosen so its LOCAL and UTC dates are both 2026-08-13 in any plausible test
 *  timezone, since the day-directory bound derives from `launchedAt`. */
const T0 = Date.parse('2026-08-13T12:00:00.000Z')
const DAY = '2026/08/13'

const SESSION = 'row-abc'
/** What `buildLaunch` puts in the child's environment for `SESSION`. */
const STAMP = `chorus-${SESSION}`

const ctx = (
  over: Partial<{ sessionId: string; cwd: string; launchedAt: number; signal: AbortSignal }> = {}
) => ({
  sessionId: SESSION,
  cwd: CWD,
  launchedAt: T0,
  signal: new AbortController().signal,
  ...over
})

/**
 * Run discovery and abort it shortly after, returning whatever it settled on.
 *
 * ⚠ THIS IS HOW "NO MATCH" IS ASSERTED NOW. Discovery waits, so a negative can
 * only be observed by ending the wait — exactly as the app does when the session
 * exits or Chorus quits. A test that simply awaited would hang, which is the
 * failure mode the pre-F64 tests hit when the contract changed under them.
 */
async function discoverThenAbort(
  over: Partial<{ sessionId: string; cwd: string; launchedAt: number }> = {},
  ms = 120
): Promise<string | null> {
  const ac = new AbortController()
  const p = codexAdapter.discoverSessionId(ctx({ ...over, signal: ac.signal }))
  const timer = setTimeout(() => ac.abort(), ms)
  try {
    return await p
  } finally {
    clearTimeout(timer)
  }
}

describe('codex discoverSessionId (D139 Q3 / D140 / F64)', () => {
  beforeEach(() => {
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'chorus-f64-discover-'))
  })
  afterEach(() => {
    fs.rmSync(fakeHome, { recursive: true, force: true })
  })

  it('finds the session whose header cwd matches and whose start is at the launch instant', async () => {
    writeRollout(DAY, 'aaaa-1', CWD, '2026-08-13T12:00:05.000Z')
    expect(await discoverThenAbort()).toBe('aaaa-1')
  })

  it('resolves as soon as the rollout APPEARS, having waited for it (the F64 case)', async () => {
    // The real sequence: nothing on disk at launch, the file lands when the user
    // finally submits a turn. The pre-F64 scan-once contract答 "not found" here
    // every single time, which is precisely why codex never resumed.
    const ac = new AbortController()
    const p = codexAdapter.discoverSessionId(ctx({ signal: ac.signal }))
    const late = setTimeout(() => writeRollout(DAY, 'late-1', CWD, '2026-08-13T12:00:02.000Z'), 150)
    const giveUp = setTimeout(() => ac.abort(), 8000)
    try {
      expect(await p).toBe('late-1')
    } finally {
      clearTimeout(late)
      clearTimeout(giveUp)
    }
  })

  it('returns null when the sessions tree does not exist at all', async () => {
    expect(await discoverThenAbort()).toBeNull()
  })

  // ⚠ EXACT EQUALITY, AND THIS IS THE TEST THAT STOPS A PANE ADOPTING A SIBLING
  // WORKTREE'S CONVERSATION. Not a prefix, not case-insensitive, not a realpath
  // guess (F62 remains a named, deliberate hazard).
  it.each([
    ['a sibling worktree', 'C:\\Projects\\Chorus\\.chorus\\worktrees\\feature'],
    ['a parent directory', 'C:\\Projects'],
    ['a different case', 'c:\\projects\\chorus']
  ])('rejects %s — cwd equality is exact', async (_label, otherCwd) => {
    writeRollout(DAY, 'bbbb-1', otherCwd, '2026-08-13T12:00:05.000Z')
    expect(await discoverThenAbort()).toBeNull()
  })

  // ⚠ launchedAt IS A HARD LOWER BOUND — without it a relaunch in a directory
  // that already had a codex session would adopt the OLD conversation.
  it('rejects a rollout older than launchedAt even when the cwd matches', async () => {
    writeRollout(DAY, 'cccc-old', CWD, '2026-08-13T11:59:59.000Z')
    expect(await discoverThenAbort()).toBeNull()
  })

  // ⚠ F64's UPPER BOUND, AND IT IS WHAT MAKES WAITING INDEFINITELY SAFE. The old
  // rule had no upper edge, so a pane still waiting would claim a rollout
  // written by a codex launched in the same directory much later — a silent
  // cross-claim of someone else's conversation.
  it('rejects a rollout that starts LONG AFTER the launch — the window has two edges', async () => {
    writeRollout(DAY, 'dddd-later', CWD, '2026-08-13T12:05:00.000Z')
    expect(await discoverThenAbort()).toBeNull()
  })

  it('accepts a start within the forward skew allowance', async () => {
    // Real measurements were +413 / +428 / +520 ms; the allowance is far wider
    // to survive a cold CLI start, and this pins that it is genuinely allowed.
    writeRollout(DAY, 'eeee-skew', CWD, '2026-08-13T12:00:09.000Z')
    expect(await discoverThenAbort()).toBe('eeee-skew')
  })

  // ⚠ AMBIGUITY IS NULL, NEVER "THE NEWEST", and it gives up rather than waiting
  // — a second candidate cannot be un-discovered by waiting longer.
  it('returns null when two candidates match — it never picks the newest', async () => {
    writeRollout(DAY, 'ffff-1', CWD, '2026-08-13T12:00:05.000Z')
    writeRollout(DAY, 'ffff-2', CWD, '2026-08-13T12:00:09.000Z')
    expect(await discoverThenAbort()).toBeNull()
  })

  it('returns null when the signal is already aborted, and never persists a result', async () => {
    writeRollout(DAY, 'gggg-1', CWD, '2026-08-13T12:00:05.000Z')
    const ac = new AbortController()
    ac.abort()
    expect(await codexAdapter.discoverSessionId(ctx({ signal: ac.signal }))).toBeNull()
  })

  // ⚠ F57: `session_index.jsonl` CARRIES NO `cwd`, so it can never be identity
  // evidence. Planted with a matching id to prove it is not read.
  it('ignores session_index.jsonl entirely (F57 — it has no cwd)', async () => {
    const dir = path.join(fakeHome, '.codex')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'session_index.jsonl'),
      JSON.stringify({ id: 'hhhh-index', thread_name: 'x', updated_at: '2026-08-13T12:00:05.000Z' })
    )
    expect(await discoverThenAbort()).toBeNull()
  })

  it('skips files that are not rollout headers rather than throwing', async () => {
    const dir = path.join(fakeHome, '.codex', 'sessions', DAY)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'rollout-broken.jsonl'), 'not json at all\n')
    fs.writeFileSync(
      path.join(dir, 'rollout-wrongtype.jsonl'),
      JSON.stringify({ type: 'response_item', payload: {} })
    )
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignored')
    writeRollout(DAY, 'iiii-1', CWD, '2026-08-13T12:00:05.000Z')
    expect(await discoverThenAbort()).toBe('iiii-1')
  })

  // Only the FIRST line is identity evidence — reading further would mean
  // parsing conversation content to answer a question about identity.
  it('reads only the first line, not later records', async () => {
    writeRollout(DAY, 'jjjj-1', CWD, '2026-08-13T12:00:05.000Z', [
      JSON.stringify({ type: 'session_meta', payload: { session_id: 'IMPOSTER', cwd: CWD } })
    ])
    expect(await discoverThenAbort()).toBe('jjjj-1')
  })

  // ⚠ F64's cost half: the walk is bounded to the days the launch could fall in,
  // so an old rollout is not merely rejected — its header is never read.
  it('does not read rollouts filed under unrelated days', async () => {
    writeRollout('2026/01/02', 'kkkk-old', CWD, '2026-08-13T12:00:05.000Z')
    expect(await discoverThenAbort()).toBeNull()
  })

  describe('the originator stamp (F64) — identity instead of inference', () => {
    it('matches its OWN stamp exactly, ignoring cwd and the time window', async () => {
      // ⚠ NEITHER IS TESTED ON THIS PATH, ON PURPOSE. The stamp is unique to this
      // launch, so adding a directory or clock comparison could only turn a
      // certain answer into a missed one — which is exactly F62's failure shape.
      writeRollout(DAY, 'stamped-1', 'C:\\somewhere\\else', '2026-08-13T12:04:00.000Z', [], STAMP)
      expect(await discoverThenAbort()).toBe('stamped-1')
    })

    // ⚠ THE CASE THE STAMP WAS ADOPTED FOR, AND THE ONE THE HEURISTIC CANNOT
    // GET RIGHT. Two panes, one directory, launched within the skew window —
    // which is NORMAL here, because restore staggers relaunches 500 ms apart.
    // Both panes' windows contain the other's rollout.
    it('claims its own and NEVER the other pane launched moments earlier', async () => {
      writeRollout(DAY, 'mine', CWD, '2026-08-13T12:00:01.000Z', [], STAMP)
      writeRollout(DAY, 'theirs', CWD, '2026-08-13T12:00:00.500Z', [], 'chorus-row-other')
      expect(await discoverThenAbort()).toBe('mine')
    })

    // ⚠ AND WITHOUT THIS THE FALLBACK WOULD RE-INTRODUCE THE BUG. A pane whose
    // own rollout does not exist yet must not drop through to the cwd+time rule
    // and claim a sibling pane's freshly written conversation.
    it('never falls back onto a rollout stamped by a DIFFERENT Chorus pane', async () => {
      writeRollout(DAY, 'theirs-only', CWD, '2026-08-13T12:00:02.000Z', [], 'chorus-row-other')
      expect(await discoverThenAbort()).toBeNull()
    })

    // The degradation path: a future codex that ignores the override writes
    // `codex-tui` again, and the cwd + window rule is all there is.
    it('falls back to cwd + window for an unstamped rollout', async () => {
      writeRollout(DAY, 'unstamped', CWD, '2026-08-13T12:00:02.000Z', [], 'codex-tui')
      expect(await discoverThenAbort()).toBe('unstamped')
    })

    it('prefers its stamp over an unstamped rollout that also fits the window', async () => {
      writeRollout(DAY, 'unstamped', CWD, '2026-08-13T12:00:02.000Z', [], 'codex-tui')
      writeRollout(DAY, 'stamped', CWD, '2026-08-13T12:00:03.000Z', [], STAMP)
      expect(await discoverThenAbort()).toBe('stamped')
    })
  })

  it('tolerates a header with no trailing newline — the header IS the file', async () => {
    // The single-line shape every one of these fixtures writes, and the case a
    // naive "read until newline" prefix read rejects outright.
    const dir = path.join(fakeHome, '.codex', 'sessions', DAY)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'rollout-nonewline.jsonl'),
      JSON.stringify({
        type: 'session_meta',
        payload: {
          session_id: 'llll-1',
          cwd: CWD,
          timestamp: '2026-08-13T12:00:03.000Z'
        }
      })
    )
    expect(await discoverThenAbort()).toBe('llll-1')
  })
})

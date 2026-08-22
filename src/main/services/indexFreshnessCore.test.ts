import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  isIndexStale,
  shouldScheduleIndex,
  shortSha,
  freshnessKey,
  createIndexGate,
  NEVER_INDEXED,
  LAUNCH_BOLT_TIMEOUT,
  CONTAINER_GONE
} from './indexFreshnessCore'

const A = 'a92099d934dd95548e59525b7231fd4b5f5d5f6f'
const B = '1c146036edcec92aae29cbc0b146ffd6d2db5305'

describe('6b-3: isIndexStale — the branch table IS the test', () => {
  it('a graph that has never been indexed is stale', () => {
    // Every graph indexed before this task: the property does not exist.
    expect(isIndexStale(null, A)).toBe(true)
  })

  it('⚠ `undefined` is stale too — a missing graph property is not null', () => {
    // `toPlainValue` hands back `undefined` for a property that does not exist,
    // so the null check alone would let every pre-6b-3 graph read as fresh.
    expect(isIndexStale(undefined, A)).toBe(true)
  })

  it('an empty string is stale', () => {
    expect(isIndexStale('', A)).toBe(true)
  })

  it('the same head is NOT stale', () => {
    expect(isIndexStale(A, A)).toBe(false)
  })

  it('a different head is stale', () => {
    expect(isIndexStale(A, B)).toBe(true)
  })

  it('⚠ A NULL HEAD IS NOT STALE, AND THIS IS THE BRANCH THAT MATTERS', () => {
    // A project that is not a git repository, or one with no commits, has no
    // HEAD to compare. `true` here would schedule an index on EVERY launch
    // forever for a project `memoryService.index` refuses outright — a retry
    // loop with no timer in it.
    expect(isIndexStale(null, null)).toBe(false)
    expect(isIndexStale(undefined, null)).toBe(false)
    expect(isIndexStale('', null)).toBe(false)
    expect(isIndexStale(A, null)).toBe(false)
  })

  it('⚠ THE COMPARISON IS CASE-SENSITIVE, ASSERTED SO NOBODY FOLDS IT', () => {
    // git emits lowercase 40-hex and nothing normalises it. A fold would hide a
    // genuinely different head.
    expect(isIndexStale(A.toUpperCase(), A)).toBe(true)
  })

  it('does not trim or otherwise normalise — a stored head with whitespace is a different head', () => {
    expect(isIndexStale(` ${A}`, A)).toBe(true)
  })
})

describe('6b-3: shortSha', () => {
  it('is the 7 characters git itself abbreviates to', () => {
    expect(shortSha(A)).toBe('a92099d')
    expect(shortSha(B)).toBe('1c14603')
  })

  it('is null-safe', () => {
    expect(shortSha(null)).toBeNull()
    expect(shortSha('')).toBeNull()
  })

  it('⚠ DOES NOT THROW ON A SHORT INPUT — the value is a graph property Chorus did not necessarily write', () => {
    expect(shortSha('abc')).toBe('abc')
  })
})

describe('6b-3: freshnessKey — (project, HEAD), never the session (D173 Q7)', () => {
  it('is stable for the same pair', () => {
    expect(freshnessKey('p1', A)).toBe(freshnessKey('p1', A))
  })

  it('⚠ DISTINGUISHES TWO PROJECTS AT THE SAME HEAD', () => {
    // Keyed on the head alone, two projects sitting at the same commit would
    // block each other's index.
    expect(freshnessKey('p1', A)).not.toBe(freshnessKey('p2', A))
  })

  it('⚠ DISTINGUISHES TWO HEADS IN THE SAME PROJECT', () => {
    // Keyed on the project alone, a legitimate re-index after a commit would be
    // skipped for the life of the process.
    expect(freshnessKey('p1', A)).not.toBe(freshnessKey('p1', B))
  })
})

describe('6b-3: the in-flight gate — two panes launched at once index ONCE', () => {
  it('the first claim wins and the second is refused', () => {
    const gate = createIndexGate()
    const key = freshnessKey('p1', A)
    expect(gate.claim(key)).toBe(true)
    expect(gate.claim(key)).toBe(false)
    expect(gate.size()).toBe(1)
  })

  it('a launch at a DIFFERENT head is not blocked by one in flight', () => {
    const gate = createIndexGate()
    expect(gate.claim(freshnessKey('p1', A))).toBe(true)
    expect(gate.claim(freshnessKey('p1', B))).toBe(true)
  })

  it('two different projects at the same head both claim', () => {
    const gate = createIndexGate()
    expect(gate.claim(freshnessKey('p1', A))).toBe(true)
    expect(gate.claim(freshnessKey('p2', A))).toBe(true)
  })

  it('⚠ RELEASE LETS THE NEXT LAUNCH RETRY — the Set is in-flight, not a memo', () => {
    // The memo is the graph: a SUCCESSFUL run writes lastIndexedHead, so the
    // next launch is not stale. A FAILED run leaves it stale and must be able
    // to retry on the next click.
    const gate = createIndexGate()
    const key = freshnessKey('p1', A)
    expect(gate.claim(key)).toBe(true)
    gate.release(key)
    expect(gate.size()).toBe(0)
    expect(gate.claim(key)).toBe(true)
  })

  it('releasing a key never claimed is harmless', () => {
    const gate = createIndexGate()
    gate.release('never-claimed')
    expect(gate.size()).toBe(0)
  })
})

describe('6b-3: the authored sentences are Chorus words, not a driver or docker message', () => {
  it('names no URI, port, path or docker verb', () => {
    for (const sentence of [NEVER_INDEXED, LAUNCH_BOLT_TIMEOUT, CONTAINER_GONE]) {
      expect(sentence).not.toMatch(/bolt:\/\//)
      expect(sentence).not.toMatch(/127\.0\.0\.1|localhost|:\d{4}/)
      expect(sentence).not.toMatch(/[A-Za-z]:\\/)
    }
  })

  it('⚠ THE TIMEOUT SENTENCE SAYS WHAT THE SESSION LOST, not that the launch failed', () => {
    // The launch proceeds on a timeout; a sentence implying otherwise would be
    // the "this feature is flaky" impression D169 exists to prevent.
    expect(LAUNCH_BOLT_TIMEOUT).toContain('memory contract')
  })
})

describe('6b-3: shouldScheduleIndex — the launch path rule, testable without Electron', () => {
  const base = { projectId: 'p1', lastIndexedHead: A, headSha: B }

  it('a stale, reachable launch schedules, keyed (project, HEAD)', () => {
    expect(shouldScheduleIndex({ ...base, reachable: true })).toEqual({
      schedule: true,
      key: freshnessKey('p1', B)
    })
  })

  it('⚠ A LAUNCH WHOSE MERGE FAILED SCHEDULES NOTHING', () => {
    // An index against a graph that did not answer would spend a git walk and a
    // batch of writes proving what the MERGE already reported.
    expect(shouldScheduleIndex({ ...base, reachable: false })).toEqual({
      schedule: false,
      key: null
    })
  })

  it('a launch whose graph is already FRESH schedules nothing', () => {
    expect(
      shouldScheduleIndex({ projectId: 'p1', lastIndexedHead: B, headSha: B, reachable: true })
    ).toEqual({ schedule: false, key: null })
  })

  it('a never-indexed graph schedules — every graph built before this task', () => {
    expect(
      shouldScheduleIndex({ projectId: 'p1', lastIndexedHead: null, headSha: B, reachable: true })
        .schedule
    ).toBe(true)
  })

  it('⚠ A PROJECT WITH NO HEAD SCHEDULES NOTHING, AND HAS NO KEY', () => {
    // It would otherwise re-index on every launch forever, against an `index`
    // that refuses it — and there would be nothing to key the guard on.
    expect(
      shouldScheduleIndex({ projectId: 'p1', lastIndexedHead: null, headSha: null, reachable: true })
    ).toEqual({ schedule: false, key: null })
  })

  it('⚠ TWO PANES ON THE SAME PROJECT AND HEAD PRODUCE ONE RUN (D173 Q7)', () => {
    // The decision is the same for both launches; the GATE is what makes it one
    // run. Asserted together here because separately each half looks correct
    // while the pair can still index twice.
    const gate = createIndexGate()
    const one = shouldScheduleIndex({ ...base, reachable: true })
    const two = shouldScheduleIndex({ ...base, reachable: true })
    expect(one.schedule && two.schedule).toBe(true)
    expect(one.key).toBe(two.key)
    const claimed = [one.key, two.key].filter((k) => k !== null && gate.claim(k))
    expect(claimed).toHaveLength(1)
  })

  it('a launch at a DIFFERENT head after a commit indexes again', () => {
    const gate = createIndexGate()
    const first = shouldScheduleIndex({ projectId: 'p1', lastIndexedHead: A, headSha: B, reachable: true })
    gate.claim(first.key as string)
    gate.release(first.key as string)
    const second = shouldScheduleIndex({ projectId: 'p1', lastIndexedHead: B, headSha: A, reachable: true })
    expect(second.schedule).toBe(true)
    expect(second.key).not.toBe(first.key)
  })
})

/*
 * ⚠ A SOURCE SWEEP, AND IT GUARDS THE ONE ASSUMPTION `setImmediate` RESTS ON.
 * "The index runs after the launch returned" is true only because everything
 * between `await withMcpEnv(...)` and the response `parse` at each of the four
 * call sites is SYNCHRONOUS. That is a property of code a later edit can break
 * silently — no unit test of the memory service would notice, and the symptom
 * would be an index that sometimes runs inside the click. So the property is
 * asserted over the source itself, the way codeIndexCore's no-deletion sweep is.
 */
describe('6b-3: the four withMcpEnv call sites stay synchronous after the await', () => {
  const src = readFileSync(join(process.cwd(), 'src/main/ipc.ts'), 'utf8')

  it('every call site is followed by a synchronous stretch up to its response parse', () => {
    // ⚠ `(?!\.\.\.)` EXCLUDES THE PROSE. The comments beside this mechanism
    // write `await withMcpEnv(...)` when explaining it, and a sweep that
    // counted those would move every time somebody improved a comment.
    const sites = [...src.matchAll(/await withMcpEnv\((?!\.\.\.)/g)].map((m) => m.index as number)
    // Three launch sites plus the restore relaunch — the list IS the design.
    expect(sites).toHaveLength(4)

    for (const at of sites) {
      const after = src.slice(at + 'await withMcpEnv('.length)
      const end = after.search(/ResponseSchema\.parse\(/)
      expect(end).toBeGreaterThan(0)
      const stretch = after.slice(0, end)
      // The call's own closing arguments may mention `await` only for the
      // withMcpEnv call itself, which we have already stepped past.
      expect(stretch).not.toMatch(/\bawait\b/)
    }
  })
})

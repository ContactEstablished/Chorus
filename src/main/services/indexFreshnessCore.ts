/**
 * Task 6b-3 (D170(b)) — is this project's structural index built at the commit
 * the checkout is actually on, and may this launch rebuild it?
 *
 * ⚠ PURE, AND THE PURITY IS THE POINT. No `fs`, no driver, no `electron`, no
 * clock. Two consumers ask the same question — the launch path in `ipc.ts`
 * (which schedules the background index) and `memoryService.freshness` (which
 * answers the settings screen) — and two copies of "is this stale" is how a
 * graph gets re-indexed on every launch, or never.
 */

/**
 * ⚠ A NULL `headSha` IS **NOT** STALE, AND THIS IS THE BRANCH THAT MATTERS.
 * `git rev-parse HEAD` (git.ts `headSha`) answers null for a project that is
 * not a repository and for a repository with no commits — `rootCommitShas`'s
 * own two stated cases. Returning `true` there would schedule an index on
 * EVERY launch, forever, for a project `memoryService.index` refuses outright
 * with *"this project is not a git repository"* — a retry loop with no timer
 * in it, which is precisely the shape D170 refuses.
 *
 * ⚠ EXACT STRING COMPARISON, NEVER CASE-FOLDED. git emits lowercase 40-hex and
 * nothing in this codebase normalises it; folding would hide a genuinely
 * different head. The case-sensitivity is asserted by a test so that nobody
 * "fixes" it into a fold.
 *
 * ⚠ `undefined` AND `''` JOIN `null` ON THE STALE SIDE ON PURPOSE. The value
 * arrives from a graph property Chorus did not necessarily write: absent on
 * every graph indexed before this task, and `toPlainValue` hands back
 * `undefined` for a property that does not exist rather than null.
 */
export function isIndexStale(
  lastIndexedHead: string | null | undefined,
  headSha: string | null
): boolean {
  if (headSha === null) return false
  if (lastIndexedHead === null || lastIndexedHead === undefined || lastIndexedHead === '') {
    return true
  }
  return lastIndexedHead !== headSha
}

/**
 * The 7 characters git itself abbreviates to.
 *
 * ⚠ NULL-SAFE AND SHORT-INPUT-SAFE, because the input is a graph property
 * rather than something this process just computed. `slice` does not throw on
 * a string shorter than 7, and a value Chorus did not write must not be able to
 * crash a settings screen.
 */
export function shortSha(sha: string | null): string | null {
  if (sha === null || sha === '') return null
  return sha.slice(0, 7)
}

/**
 * The once-per-run key — **(project, HEAD)**, and D173 Q7 adopted exactly this.
 *
 * ⚠ BOTH HALVES ARE LOAD-BEARING. Keyed on the project alone it would skip a
 * legitimate re-index after a commit; keyed on the head alone two projects
 * sitting at the same head would block each other.
 *
 * ⚠ AND NEVER THE SESSION. Two panes launched concurrently on the same project
 * at the same HEAD must index ONCE, which a session-keyed guard cannot do —
 * that is the whole reason the key is not simply `sessionId`.
 */
export function freshnessKey(projectId: string, headSha: string): string {
  return `${projectId}@${headSha}`
}

/**
 * Should this launch schedule a background index, and under what key?
 *
 * ⚠ EXTRACTED SO THE LAUNCH PATH'S RULE IS TESTABLE WITHOUT ELECTRON. There is
 * no `src/main/ipc.test.ts`, so a decision written inline in `withMcpEnv` could
 * not be asserted by any test — which is exactly how F75 survived a whole
 * phase. The three conditions are the whole rule:
 *
 *  1. **The MERGE succeeded.** An index scheduled against a graph that did not
 *     answer would spend a git walk and a batch of writes proving what the
 *     MERGE already reported.
 *  2. **HEAD has moved** (or the graph has never been indexed).
 *  3. **There is a HEAD at all** — a project with no git history has nothing to
 *     key on and `index` refuses it outright.
 */
export function shouldScheduleIndex(input: {
  readonly reachable: boolean
  readonly lastIndexedHead: string | null | undefined
  readonly headSha: string | null
  readonly projectId: string
}): { readonly schedule: boolean; readonly key: string | null } {
  if (!input.reachable) return { schedule: false, key: null }
  if (input.headSha === null) return { schedule: false, key: null }
  if (!isIndexStale(input.lastIndexedHead, input.headSha)) return { schedule: false, key: null }
  return { schedule: true, key: freshnessKey(input.projectId, input.headSha) }
}

/**
 * The in-flight guard, as a value rather than a bare `Set` at module scope, so
 * the "two panes index once" rule can be asserted without Electron.
 *
 * ⚠ THIS IS THE **IN-FLIGHT** GUARD AND NOT THE MEMO. The memo is the graph:
 * a successful run writes `:Project.lastIndexedHead = HEAD`, so the next launch
 * reads it back and is not stale. A FAILED run leaves the head stale and the
 * next launch retries — once per launch, which is once per click, which is the
 * rule. A reader who assumed this Set was meant to be permanent would turn a
 * retry-on-next-click into a never-retry.
 */
export interface IndexGate {
  /** True when the caller now owns the run for this key; false when another
   *  launch is already running it. */
  claim(key: string): boolean
  /** ⚠ ALWAYS FROM A `finally`. A key never released is a project that can
   *  never re-index for the life of the process. */
  release(key: string): void
  /** For assertions only. */
  size(): number
}

export function createIndexGate(): IndexGate {
  const inFlight = new Set<string>()
  return {
    claim(key) {
      if (inFlight.has(key)) return false
      inFlight.add(key)
      return true
    },
    release(key) {
      inFlight.delete(key)
    },
    size: () => inFlight.size
  }
}

/**
 * The authored sentences, exported as constants so the UI, the log and the
 * tests share one wording — the `dockerCore.ts` precedent.
 *
 * ⚠ NONE OF THESE IS A DOCKER OR DRIVER MESSAGE. A refusal's own text names a
 * URI on several paths; these are Chorus's words about Chorus's own outcome.
 */
export const NEVER_INDEXED = 'Never indexed'

export const LAUNCH_BOLT_TIMEOUT =
  'The memory graph did not answer in time, so this session was not given the memory contract.'

/** ⚠ NOT A `dockerRefusal` CASE. That helper covers a call docker REFUSED; this
 *  covers a container docker says is not there at all, which a launch reports
 *  and never repairs — provisioning is a click (D58) and may pull ~600 MB. */
export const CONTAINER_GONE =
  'The container this project names is no longer on this machine, so Chorus did not start it.'

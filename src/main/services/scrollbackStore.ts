import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { appendFile, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { logger } from './logger'
import { exceedsSlack, planReplay, SCROLLBACK_MAX_CHARS, SCROLLBACK_SLACK_RATIO } from './scrollbackCore'

/**
 * The scrollback mirror's IMPURE half (Task 4a-4 / D141): one flat file per
 * session, holding the text that pane already displayed, so a restored pane
 * comes back with its history instead of an empty terminal.
 *
 * ⚠ THE DIRECTORY IS PASSED IN RATHER THAN RESOLVED HERE, and that is not
 * indirection for its own sake. `app.getPath('userData')` needs Electron, and
 * an 'electron' import at module scope would make this file untestable under
 * Vitest — the same reason `attentionCore.ts` keeps its header ban. `index.ts`
 * resolves `join(app.getPath('userData'), 'scrollback')` beside the
 * `agent-hooks` directory it already owns, and hands it here.
 *
 * ⚠ AND IT MUST BE UNDER `userData`, NEVER `TEMP` AND NEVER A PROJECT
 * DIRECTORY. This is a plaintext record of the user's work: it gets the same
 * location, and therefore the same OS protection, as `chorus.db`. A file in a
 * project directory eventually gets committed by an agent that was told to
 * `git add -A`, and a file in TEMP is world-readable on a shared machine.
 *
 * ⚠ NOTHING HERE MAY THROW INTO A CALLER. `append` runs on the PTY data path;
 * `readTail` runs inside a spawn. A corrupt, locked or missing mirror costs one
 * pane its history and must never cost anyone a launch — every operation
 * degrades to "no scrollback" and a log line.
 */
export interface ScrollbackStore {
  /** Mirror one already-scrubbed chunk. Fire-and-forget, never throws, never
   *  blocks: the caller is `sessionOutput`'s single emit path. */
  append(sessionId: string, text: string): void
  /** The capped tail of this session's mirror, or `''` for missing/unreadable. */
  readTail(sessionId: string): string
  /** Delete a session's mirror. A missing file is a no-op. */
  remove(sessionId: string): void
  /** Boot sweep: delete every `.log` with no live session row. Returns the
   *  number removed. */
  pruneOrphans(liveSessionIds: ReadonlySet<string>): number
  /**
   * Resolve once every append queued so far has landed.
   *
   * ⚠ THIS EXISTS BECAUSE `append` IS FIRE-AND-FORGET BY CONTRACT, AND AN
   * ASYNC CONTRACT WITH NO HANDLE IS AN UNTESTABLE ONE. No production caller
   * awaits it — the data path must not — but a test that instead guessed a
   * `setTimeout` would be a flake waiting for a slow machine, and this task's
   * cap and ordering guarantees are exactly the kind that a flaky test stops
   * protecting.
   */
  whenIdle(): Promise<void>
}

/**
 * Map a session id to its file name, or refuse it.
 *
 * ⚠ EXPLICIT, NOT IMPLIED, AND CURRENTLY UNREACHABLE — WHICH IS EXACTLY WHY IT
 * IS WRITTEN DOWN. Row ids are `randomUUID()` today (`ipc.ts:1373`, `:1474`), so
 * nothing can reach this guard. The day a session id comes from anywhere else —
 * an import, a migration, a hand-edited database — `../../` must ALREADY be
 * refused, because the code that introduces that id will not think to add it.
 *
 * The allow-list is positive rather than a blocklist of bad sequences: `.` is
 * excluded outright, which makes `..` unrepresentable rather than merely
 * filtered, and no path separator on any platform can survive it.
 */
export function safeName(sessionId: string): string | null {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) return null
  return `${sessionId}.log`
}

export function createScrollbackStore(
  dir: string,
  opts: { maxChars?: number; slackRatio?: number } = {}
): ScrollbackStore {
  const maxChars = opts.maxChars ?? SCROLLBACK_MAX_CHARS
  const slackRatio = opts.slackRatio ?? SCROLLBACK_SLACK_RATIO

  /** Per-session write chain: the promise the next append must wait for. Two
   *  concurrent appends to one file could otherwise interleave mid-chunk and
   *  produce text neither pane ever showed. */
  const chains = new Map<string, Promise<void>>()
  /** Per-session character count of what is on disk, so the slack check costs
   *  no stat. Seeded once per session from the file itself, because a RESTORED
   *  session appends to history it did not write this run. */
  const lengths = new Map<string, number>()
  /** Sessions this process has written for. Two jobs: `pruneOrphans` must never
   *  delete a file being actively appended to (the boot race), and a chunk that
   *  was queued before `remove()` must not recreate the file after it. */
  const live = new Set<string>()

  let dirReady = false
  const ensureDir = (): void => {
    if (dirReady) return
    mkdirSync(dir, { recursive: true })
    dirReady = true
  }

  const pathFor = (name: string): string => join(dir, name)

  async function writeChunk(sessionId: string, name: string, text: string): Promise<void> {
    // Cancelled by a remove() that landed while this chunk was queued. Without
    // this the file would come back seconds after the user closed the pane.
    if (!live.has(sessionId)) return
    ensureDir()
    const file = pathFor(name)

    let length = lengths.get(sessionId)
    if (length === undefined) {
      // Once per session per run. A restored pane's file already holds the
      // history this session is about to continue, and the cap has to count it.
      try {
        length = (await readFile(file, 'utf8')).length
      } catch {
        length = 0
      }
    }

    await appendFile(file, text, 'utf8')
    length += text.length

    if (exceedsSlack(length, maxChars, slackRatio)) {
      // The rare path: rewrite to the capped tail. Via a temp file and a
      // rename, so a crash mid-rewrite cannot leave a half-written mirror where
      // a whole one used to be — the truncate-then-write shape would.
      const capped = planReplay(await readFile(file, 'utf8'), maxChars)
      const tmp = `${file}.tmp`
      await writeFile(tmp, capped, 'utf8')
      await rename(tmp, file)
      length = capped.length
    }

    lengths.set(sessionId, length)
  }

  return {
    append(sessionId: string, text: string): void {
      // ⚠ THIS RUNS ON THE PTY DATA PATH, AT `SCRUB_FLUSH_MS` CADENCE, FOR EVERY
      // OPEN PANE. It does no I/O synchronously and it cannot throw into
      // `sessionOutput`'s emit — terminal responsiveness is the feature this
      // task must not spend.
      if (text.length === 0) return
      const name = safeName(sessionId)
      if (!name) {
        logger.warn({ sessionId }, '[scrollback] refusing unsafe session id; not mirroring')
        return
      }
      live.add(sessionId)
      const previous = chains.get(sessionId) ?? Promise.resolve()
      const next = previous
        .then(() => writeChunk(sessionId, name, text))
        .catch((err) => {
          // A full disk, a locked file, a deleted directory — all cost history,
          // none may cost the session. The chain continues either way, so one
          // bad chunk does not wedge every later one.
          logger.warn({ err, sessionId }, '[scrollback] mirror write failed; history may be incomplete')
        })
      chains.set(sessionId, next)
    },

    readTail(sessionId: string): string {
      // ⚠ SYNCHRONOUS, AND DELIBERATELY SO. This is read ONCE, inside `spawn`,
      // to seed a restored pane's replay — it is NOT on the data path. A promise
      // here would race the renderer's `session:attach`: history would appear
      // when the read happened to win and silently not appear when it did not,
      // which is the shape of bug that gets called "flaky" and never fixed.
      const name = safeName(sessionId)
      if (!name) return ''
      try {
        return planReplay(readFileSync(pathFor(name), 'utf8'), maxChars)
      } catch (err) {
        // A session with no history yet is the NORMAL case, not a problem.
        if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
          logger.warn({ err, sessionId }, '[scrollback] could not read mirror; pane starts empty')
        }
        return ''
      }
    },

    remove(sessionId: string): void {
      // D16 resolution (d): the row is deleted on pane close, and the file must
      // not outlive it. An orphan is a plaintext record of the user's work with
      // nothing left pointing at it.
      const name = safeName(sessionId)
      if (!name) return
      // Dropped from `live` FIRST, so any chunk still queued on the chain sees
      // the cancellation and does not recreate the file behind us.
      live.delete(sessionId)
      chains.delete(sessionId)
      lengths.delete(sessionId)
      try {
        rmSync(pathFor(name), { force: true })
        rmSync(`${pathFor(name)}.tmp`, { force: true })
      } catch (err) {
        logger.warn({ err, sessionId }, '[scrollback] could not remove mirror')
      }
    },

    pruneOrphans(liveSessionIds: ReadonlySet<string>): number {
      if (!existsSync(dir)) return 0
      let removed = 0
      let entries: string[]
      try {
        entries = readdirSync(dir)
      } catch (err) {
        logger.warn({ err }, '[scrollback] could not scan mirror directory; skipping orphan sweep')
        return 0
      }
      for (const entry of entries) {
        const isTmp = entry.endsWith('.log.tmp')
        const isLog = !isTmp && entry.endsWith('.log')
        if (!isTmp && !isLog) continue
        const id = entry.slice(0, entry.length - (isTmp ? '.log.tmp'.length : '.log'.length))
        // ⚠ NEVER SWEEP A FILE THIS RUN IS WRITING. The sweep works from a
        // snapshot of the session rows; a session created between that snapshot
        // and this loop would otherwise have its brand-new mirror deleted
        // underneath it.
        if (live.has(id)) continue
        // A live row keeps its mirror. A `.log.tmp` never does: it is debris
        // from a rewrite whose rename never happened, and the whole file it was
        // meant to replace is still in place.
        if (isLog && liveSessionIds.has(id)) continue
        try {
          rmSync(join(dir, entry), { force: true })
          removed++
        } catch (err) {
          logger.warn({ err, file: entry }, '[scrollback] could not remove orphan mirror')
        }
      }
      if (removed > 0) logger.info(`[scrollback] swept ${removed} orphan mirror file(s)`)
      return removed
    },

    async whenIdle(): Promise<void> {
      // Chains grow while we wait — a chunk queued during the await lands on
      // the end of its session's chain — so settle repeatedly until a pass
      // finds nothing new. Every chain already swallows its own errors, so
      // this can only resolve.
      for (let pass = 0; pass < 100; pass++) {
        const before = [...chains.values()]
        if (before.length === 0) return
        await Promise.all(before)
        const after = [...chains.values()]
        if (after.length === before.length && after.every((p, i) => p === before[i])) return
      }
    }
  }
}

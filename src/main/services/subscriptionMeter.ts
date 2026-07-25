import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { logger } from './logger'
import { parseCount, type TokenBreakdown } from './attributionCore'

/**
 * Task 3a-3 (D42 clause 2): best-effort metering of **subscription** sessions
 * from the CLI's own local session logs.
 *
 * ⚠ THREE PROPERTIES, ALL DELIBERATE, AND THE FIRST IS THE POINT OF THE MODULE:
 *
 *  1. **It cannot route anything anywhere.** There is no `fetch` in this file,
 *     no base URL, no key of any kind, and no import that could supply one —
 *     look at the import list. Routing a flat-rate subscription through a
 *     gateway would convert it to per-token billing, so a cost-TRACKING feature
 *     would INCREASE cost. That is the single worst outcome available in this
 *     task, and this module is built so it is not reachable from here.
 *  2. **Failure is normal.** A missing directory, a changed format, a locked
 *     file, an ambiguous window: all yield `null` and a debug log. Never a
 *     throw, never a user-facing error, and never a fabricated number.
 *  3. **Its output is explicitly lower fidelity**, labelled `tokens_source =
 *     'cli-logs'` so no consumer can mistake it for gateway-grade data.
 *
 * ── The log location and field names were read off THIS MACHINE (D4), 2026-07-25 ──
 *
 * `~/.claude/projects/<encoded-cwd>/<claude-session-id>.jsonl`, one JSON object
 * per line. The encoding replaces the drive colon and every path separator with
 * `-`: `C:\Projects\ContactEstablished\Chorus` →
 * `C--Projects-ContactEstablished-Chorus` (confirmed against all 12 project
 * directories present).
 *
 * The fields used, verified against a real line:
 *   { timestamp, cwd, sessionId, message: { model, usage: {
 *       input_tokens, output_tokens,
 *       cache_creation_input_tokens, cache_read_input_tokens } } }
 *
 * ⚠ TOKEN SEMANTICS DIFFER BETWEEN THE TWO SOURCES, AND THE COLUMNS MUST NOT.
 * OpenRouter's `tokens_prompt` is the TOTAL prompt tokens with the cached
 * portion as a subset. Anthropic's `input_tokens` EXCLUDES both cache reads and
 * cache creation. To keep `tokens_in` meaning one thing in the table, this
 * module reports the total and the subset the same way the analytics path does:
 *
 *   tokensIn     = input_tokens + cache_creation_input_tokens + cache_read_input_tokens
 *   tokensCached = cache_read_input_tokens                       (a SUBSET of tokensIn)
 *   tokensOut    = output_tokens
 *
 * Folding differently in the two paths would make the same column mean two
 * things, which is worse than either convention.
 */

/** Injected so the module is unit-testable without touching a real filesystem
 *  and without a fixture tree in the repo. Defaults to `node:fs`. */
export interface MeterFs {
  existsSync(p: string): boolean
  readdirSync(p: string): string[]
  statSync(p: string): { mtimeMs: number }
  readFileSync(p: string, enc: 'utf8'): string
}

export interface SubscriptionMeter {
  /** Tokens for one subscription dispatch, or `null` for "unknown" — which is
   *  a real and frequent answer and NEVER a zero. */
  meter(input: { cwd: string; startedAt: string; endedAt: string }): TokenBreakdown | null
}

export interface SubscriptionMeterDeps {
  readonly fsImpl?: MeterFs
  /** The `~/.claude/projects` root. Injected for tests; defaults to the real
   *  location on this machine. */
  readonly projectsRoot?: string
}

/**
 * `C:\Projects\ContactEstablished\Chorus` → `C--Projects-ContactEstablished-Chorus`.
 *
 * Verified against every project directory on this machine 2026-07-25. A dot in
 * a path was NOT observed in any sample, so its handling is unverified — which
 * costs nothing, because a derived name that does not exist yields "unknown"
 * rather than a wrong number.
 */
export function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[\\/:]/g, '-')
}

class SubscriptionMeterImpl implements SubscriptionMeter {
  private readonly fs: MeterFs
  private readonly projectsRoot: string

  constructor(deps: SubscriptionMeterDeps) {
    this.fs = deps.fsImpl ?? fs
    this.projectsRoot = deps.projectsRoot ?? path.join(os.homedir(), '.claude', 'projects')
  }

  meter(input: { cwd: string; startedAt: string; endedAt: string }): TokenBreakdown | null {
    try {
      return this.read(input)
    } catch (err) {
      // Rule 2. A meter that throws would take a session's exit handler with it.
      logger.debug({ err }, '[attribution] subscription meter failed; tokens unknown')
      return null
    }
  }

  private read(input: { cwd: string; startedAt: string; endedAt: string }): TokenBreakdown | null {
    const from = Date.parse(input.startedAt)
    const to = Date.parse(input.endedAt)
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null

    const dir = path.join(this.projectsRoot, encodeProjectDir(input.cwd))
    if (!this.fs.existsSync(dir)) return null

    let tokensIn = 0
    let tokensOut = 0
    let tokensCached = 0
    let matched = 0
    // ⚠ THE AMBIGUITY GUARD. Several agent sessions routinely run in the same
    // cwd at the same time on this machine, and Chorus does not know the CLI's
    // own session id — so summing every log that overlaps the window would
    // attribute other panes' work to this dispatch. When more than one CLI
    // session has usage inside the window the honest answer is UNKNOWN, not a
    // number that is confidently too big.
    const sessionsSeen = new Set<string>()

    for (const name of this.fs.readdirSync(dir)) {
      if (!name.endsWith('.jsonl')) continue
      const file = path.join(dir, name)
      // A file last written before the dispatch began cannot hold an entry
      // inside the window. Cheap, and it keeps this off the big historical logs.
      if (this.fs.statSync(file).mtimeMs < from) continue

      for (const line of this.fs.readFileSync(file, 'utf8').split('\n')) {
        if (line.length === 0) continue
        let entry: Record<string, unknown>
        try {
          entry = JSON.parse(line) as Record<string, unknown>
        } catch {
          continue // a partially-flushed last line is normal, not an error
        }
        const at = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : Number.NaN
        if (!Number.isFinite(at) || at < from || at > to) continue

        const message = asRecord(entry.message)
        const usage = asRecord(message?.usage)
        if (!usage) continue

        const fresh = parseCount(usage.input_tokens)
        const out = parseCount(usage.output_tokens)
        const cacheWrite = parseCount(usage.cache_creation_input_tokens)
        const cacheRead = parseCount(usage.cache_read_input_tokens)
        // An entry with no usable numbers is skipped rather than counted as 0.
        if (fresh === null && out === null && cacheRead === null && cacheWrite === null) continue

        matched++
        if (typeof entry.sessionId === 'string') sessionsSeen.add(entry.sessionId)
        tokensIn += (fresh ?? 0) + (cacheWrite ?? 0) + (cacheRead ?? 0)
        tokensOut += out ?? 0
        tokensCached += cacheRead ?? 0
      }
    }

    if (matched === 0) return null
    if (sessionsSeen.size > 1) {
      logger.debug(
        `[attribution] ${sessionsSeen.size} CLI sessions overlap this dispatch's window; tokens unknown`
      )
      return null
    }
    return { tokensIn, tokensOut, tokensCached, source: 'cli-logs' }
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function createSubscriptionMeter(deps: SubscriptionMeterDeps = {}): SubscriptionMeter {
  return new SubscriptionMeterImpl(deps)
}

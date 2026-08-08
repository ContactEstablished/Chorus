import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { OpenRouterKeyClient } from './openrouterKeys'
import type { StorageService } from './storage'
import {
  createCouncilService,
  type CouncilService,
  defaultMaxOutputTokens,
  describeSecretHits,
  findingsPathFor,
  nextFreeFindingsPath,
  scanBriefForSecrets,
  validateBriefPath,
  MAX_BRIEF_BYTES,
  MAX_OUTPUT_TOKENS_DEFAULT_ARBITER,
  MAX_OUTPUT_TOKENS_DEFAULT_MEMBER
} from './councilService'

/**
 * Task 3b-4: the FILE BOUNDARY, tested in main and before any UI exists.
 *
 * ⚠ Only the boundary functions are imported. `createCouncilService` is never
 * constructed here: it needs a `StorageService`, and storage.ts's better-sqlite3
 * binding is built for the Electron ABI (D2) — the first `new Database()` under
 * Vitest's Node would throw. Importing the module is fine; instantiating the DB
 * is not, which is why these three exports are pure enough to test on their own.
 *
 * The pure refusals run with no filesystem. The stat-dependent ones run against
 * real temp files, because "is this a regular file" is not a question a string
 * can answer — and passing a DIRECTORY is exactly the case `existsSync` alone
 * gets wrong.
 */

let dir: string
let briefPath: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'chorus-council-'))
  briefPath = join(dir, 'Brief.md')
  writeFileSync(briefPath, '# A brief\n\n## Questions\n\n1. Is this sound enough?\n', 'utf8')
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('validateBriefPath — the ordered refusal table (spec §1)', () => {
  it('accepts a real, absolute, local .md file', () => {
    const result = validateBriefPath(briefPath)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.path).toBe(briefPath)
  })

  it('refuses an EMPTY path', () => {
    expect(validateBriefPath('')).toEqual({ ok: false, reason: 'No brief was chosen.' })
    expect(validateBriefPath('   ').ok).toBe(false)
  })

  it('refuses a RELATIVE path — it would resolve against main’s cwd', () => {
    expect(validateBriefPath('docs/brief.md')).toEqual({
      ok: false,
      reason: 'A brief must be an absolute path.'
    })
    expect(validateBriefPath('.\\brief.md').ok).toBe(false)
  })

  it('⚠ refuses a NULL BYTE, and does so before the filesystem is touched', () => {
    expect(validateBriefPath('C:\\docs\\brief\0.md')).toEqual({
      ok: false,
      reason: 'That path contains a null byte.'
    })
  })

  it('⚠ refuses a UNC path — statting one can block on the network', () => {
    expect(validateBriefPath('\\\\server\\share\\brief.md').ok).toBe(false)
    expect(validateBriefPath('//server/share/brief.md').ok).toBe(false)
  })

  it('refuses anything that is not .md, case-insensitively', () => {
    expect(validateBriefPath('C:\\docs\\brief.txt')).toEqual({
      ok: false,
      reason: 'A brief must be a .md file.'
    })
    expect(validateBriefPath('C:\\docs\\brief').ok).toBe(false)
    // .MD is a brief; the check is on the extension, not on the spelling — so a
    // missing .MD file gets past the extension gate and fails on the stat.
    const upper = validateBriefPath(join(dir, 'nope.MD'))
    expect(upper).toEqual({ ok: false, reason: 'That file does not exist, or cannot be read.' })
  })

  it('refuses a path that does not EXIST', () => {
    expect(validateBriefPath(join(dir, 'no-such-brief.md'))).toEqual({
      ok: false,
      reason: 'That file does not exist, or cannot be read.'
    })
  })

  it('⚠ refuses a DIRECTORY named .md — the case existsSync alone passes', () => {
    const dirPath = join(dir, 'looks-like-a-brief.md')
    mkdirSync(dirPath, { recursive: true })
    expect(validateBriefPath(dirPath)).toEqual({ ok: false, reason: 'That path is not a file.' })
  })

  it('refuses a brief OVER THE SIZE CAP — every member pays for every byte', () => {
    const fat = join(dir, 'Fat.md')
    writeFileSync(fat, 'x'.repeat(MAX_BRIEF_BYTES + 1), 'utf8')
    const result = validateBriefPath(fat)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('the limit is')
  })

  it('⚠ NORMALIZES before re-checking, and returns the normalized path', () => {
    // A traversal that lands back on the real brief is legitimate — and what
    // comes back has no `..` left in it, so everything downstream (the run row,
    // the derived findings path) sees one canonical string.
    const traversal = join(dir, 'sub', '..', 'Brief.md')
    const result = validateBriefPath(traversal)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.path).toBe(briefPath)
      expect(result.path).not.toContain('..')
    }
  })

  it('⚠ a traversal that ESCAPES the directory still has to pass every check', () => {
    // Escaping is not itself a refusal — the user may legitimately pick a brief
    // anywhere — so what stops this one is that the resolved target has to
    // exist and be a regular file like any other. The refusal is measured on
    // the RESOLVED path, which is the property the re-check buys.
    const escaping = join(dir, 'Brief.md', '..', '..', 'hosts.txt', '..', 'passwd.md')
    expect(validateBriefPath(escaping)).toEqual({
      ok: false,
      reason: 'That file does not exist, or cannot be read.'
    })
  })

  it('⚠ NO refusal names a path fragment that was not supplied', () => {
    const supplied = 'C:\\somewhere\\secret-folder\\brief.txt'
    const result = validateBriefPath(supplied)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      // Not even the caller's own path is echoed: a resolved relative path
      // would leak main's cwd, and the user already knows what they chose.
      expect(result.reason).not.toContain('secret-folder')
      expect(result.reason).not.toContain(supplied)
    }
  })
})

describe('findingsPathFor — DERIVED, never supplied', () => {
  it('lands beside the brief with the -Findings suffix', () => {
    expect(findingsPathFor(join('C:', 'docs', 'Brief.md'))).toBe(
      join('C:', 'docs', 'Brief-Findings.md')
    )
  })

  it('⚠ stays in the brief’s own directory — there is no path the caller can steer', () => {
    const out = findingsPathFor(join(dir, 'Brief.md'))
    expect(out.startsWith(dir)).toBe(true)
  })

  it('strips a .MD extension too, rather than emitting Brief.MD-Findings.md', () => {
    expect(findingsPathFor(join('C:', 'docs', 'Brief.MD'))).toBe(
      join('C:', 'docs', 'Brief-Findings.md')
    )
  })
})

describe('nextFreeFindingsPath — the overwrite ruling: SUFFIX, never replace', () => {
  const brief = join('C:', 'docs', 'Brief.md')

  it('uses the plain name when nothing is there', () => {
    expect(nextFreeFindingsPath(brief, () => false)).toBe(join('C:', 'docs', 'Brief-Findings.md'))
  })

  it('⚠ suffixes rather than overwriting a previous council’s output', () => {
    const existing = new Set([join('C:', 'docs', 'Brief-Findings.md')])
    expect(nextFreeFindingsPath(brief, (p) => existing.has(p))).toBe(
      join('C:', 'docs', 'Brief-Findings-2.md')
    )
    existing.add(join('C:', 'docs', 'Brief-Findings-2.md'))
    expect(nextFreeFindingsPath(brief, (p) => existing.has(p))).toBe(
      join('C:', 'docs', 'Brief-Findings-3.md')
    )
  })

  it('returns NULL rather than improvising once the suffixes are exhausted', () => {
    expect(nextFreeFindingsPath(brief, () => true)).toBeNull()
  })
})

describe('scanBriefForSecrets — the pre-pass, over the ONE pattern list (D63(f))', () => {
  // ⚠ SHAPES, NOT REAL KEYS. Every fixture below is assembled at runtime from
  // fragments so this file itself stays clean under `npm run grep:secrets` —
  // the same discipline logger.test.ts and settings.test.ts already follow.
  const shape = (prefix: string, body: string): string => `${prefix}${body}`

  it('⚠ catches each known credential shape, and names the pattern and the line', () => {
    const cases: { text: string; pattern: string }[] = [
      { text: shape('sk-ant-', 'A'.repeat(24)), pattern: 'anthropic' },
      { text: shape('sk-or-v1-', 'b'.repeat(24)), pattern: 'openrouter' },
      { text: shape('sk-proj-', 'C'.repeat(24)), pattern: 'openai-project' },
      { text: shape('sk-', 'd'.repeat(40)), pattern: 'openai-classic' },
      { text: shape('ghp_', 'E'.repeat(40)), pattern: 'github' },
      { text: shape('AKIA', 'F'.repeat(16)), pattern: 'aws-access-key-id' }
    ]
    for (const c of cases) {
      const hits = scanBriefForSecrets(`# Brief\n\nSome prose.\nkey = ${c.text}\n`)
      expect(hits.length).toBeGreaterThan(0)
      expect(hits.map((h) => h.pattern)).toContain(c.pattern)
      expect(hits[0].line).toBe(4)
    }
  })

  it('⚠ the hit carries NO field able to hold the matched value', () => {
    const hits = scanBriefForSecrets(`x\n${shape('AKIA', 'G'.repeat(16))}\n`)
    expect(hits).toEqual([{ pattern: 'aws-access-key-id', line: 2 }])
    expect(Object.keys(hits[0]).sort()).toEqual(['line', 'pattern'])
  })

  it('⚠ the refusal message names the pattern and the line and NEVER the value', () => {
    const secret = shape('AKIA', 'H'.repeat(16))
    const message = describeSecretHits(scanBriefForSecrets(`a\nb\n${secret}\n`))
    expect(message).toContain('line 3')
    expect(message).toContain('aws-access-key-id')
    expect(message).not.toContain(secret)
    expect(message).not.toContain('AKIA')
  })

  it('⚠ THE FALSE-POSITIVE GUARD: a brief nobody can run is not a feature', () => {
    // The four fixtures logger.test.ts already establishes for this same list.
    // A pre-pass that refuses every brief containing a git SHA is unusable.
    const ordinary = [
      'Verified at commit 456d3d7a1b2c3d4e5f60718293a4b5c6d7e8f900 on main.',
      'The database lives at C:\\Users\\matth\\AppData\\Local\\chorus\\chorus.db',
      'Run id 9ba9b0da-cecd-4960-815d-f36166cf8c00 is the worktree fixture.',
      'Branch chorus/Chorus/24b5c1fe was retained deliberately.',
      'See docs/PLAN.md §4 and the sk- prefixed providers listed there.'
    ].join('\n')
    expect(scanBriefForSecrets(ordinary)).toEqual([])
  })

  it('is clean on a real brief’s worth of ordinary prose', () => {
    expect(scanBriefForSecrets('# Brief\n\n## Questions\n\n1. Is this sound enough?\n')).toEqual([])
  })

  it('reports EVERY offending line, in document order', () => {
    const text = ['ok', shape('AKIA', 'I'.repeat(16)), 'ok', shape('ghp_', 'J'.repeat(40))].join('\n')
    expect(scanBriefForSecrets(text).map((h) => h.line)).toEqual([2, 4])
  })
})

/**
 * The OUTPUT-BUDGET FALLBACK, and the regression it exists to stop repeating.
 *
 * ⚠ A LIVE FAILURE, NOT A HYPOTHETICAL (2026-08-06). Three reasoning members,
 * every one with `params_json = NULL`, returned `tokens_out: 1200` EXACTLY —
 * the old single default — and NO VISIBLE TEXT: the whole allowance went to
 * reasoning before a token of the answer was emitted. 0 of 3 answered, the run
 * failed on the refusal floor, and it billed for the privilege. The fallback
 * had never been in any of the measurements this file's ceilings were raised
 * on, because every measured run SET `max_tokens` on its members.
 */
describe('defaultMaxOutputTokens — the fallback, per role', () => {
  it('gives a member the measured member ceiling', () => {
    expect(defaultMaxOutputTokens('member')).toBe(MAX_OUTPUT_TOKENS_DEFAULT_MEMBER)
  })

  it('⚠ gives the ARBITER more, because the arbiter writes the document', () => {
    expect(defaultMaxOutputTokens('arbiter')).toBe(MAX_OUTPUT_TOKENS_DEFAULT_ARBITER)
    expect(MAX_OUTPUT_TOKENS_DEFAULT_ARBITER).toBeGreaterThan(MAX_OUTPUT_TOKENS_DEFAULT_MEMBER)
  })

  /**
   * ⚠ THE ACTUAL REGRESSION GUARD. 1200 was chosen when a council turn was 700
   * tokens; a reasoning model spends that on thought and emits nothing. Neither
   * default may fall back into that range without this test being deleted on
   * purpose — and the floor is stated as a NUMBER rather than as the old
   * constant, so removing the constant cannot quietly remove the bound.
   */
  it('never falls back into the range that produced an empty answer', () => {
    for (const role of ['member', 'arbiter'] as const) {
      expect(defaultMaxOutputTokens(role)).toBeGreaterThanOrEqual(16_000)
    }
  })
})

/* ====================================================================== */
/* The run's LIFECYCLE STAGES, and what `cancel` says about each          */
/* ====================================================================== */

/**
 * ⚠ THIS BLOCK CONSTRUCTS `createCouncilService`, WHICH THE HEADER OF THIS FILE
 * SAYS IS NEVER DONE HERE. That note is about the real `StorageService` — its
 * better-sqlite3 binding is built for the Electron ABI (D2) and the first
 * `new Database()` under Vitest's Node would throw. A structural STUB typed as
 * one is a different thing entirely, and it is the shape `dispatches.test.ts`
 * already uses. Nothing here opens a database.
 *
 * ⚠ AND IT DRIVES A REAL RUN OVER A REAL SOCKET, because the thing under test is
 * a timing window and there is no honest way to fake one. `createApiSession` is
 * imported by `councilService.ts` rather than injected, so the members are
 * pointed at a loopback server that speaks the SSE frames the transport needs.
 * It costs nothing and spends nothing: the "gateway" is a `node:http` listener
 * on 127.0.0.1 and the "minted key" is a string.
 *
 * What it proves is the defect `cancel` was rewritten for. A run leaves main's
 * `live` map in the protocol loop's `finally` — BEFORE the key is read back and
 * revoked and before the cost is reconciled, deliberately, because that ordering
 * is what stops a late cancel from re-flagging a finished run as cancelled. For
 * that whole tail the old `cancel` answered `false`, documented as "there was no
 * such live run — a race the user cannot see". The renderer discarded it, so a
 * Cancel click during those seconds changed nothing at all on a surface that
 * already looked hung. Each case below is one stage of that.
 */
describe('cancel reports the run STAGE — live, settling, or neither', () => {
  /** A promise with its trigger pulled out, so a test can hold main inside one
   *  await and assert what `cancel` says while it is there. No timers: a sleep
   *  long enough to be reliable makes a slow suite and a short one makes a
   *  flake. */
  function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void } {
    let resolve!: (v: T) => void
    const promise = new Promise<T>((r) => {
      resolve = r
    })
    return { promise, resolve }
  }

  const CRED = '11111111-2222-4333-8444-555555555555'
  const PROV = '66666666-7777-4888-8999-aaaaaaaaaaaa'

  /** The three frames a turn needs: one content delta, one usage-bearing final
   *  frame, and the terminator. */
  function sseBody(text: string): string {
    return (
      'data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n' +
      'data: ' +
      JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } }) +
      '\n\n' +
      'data: [DONE]\n\n'
    )
  }

  interface Harness {
    service: CouncilService
    /** Resolves with the run id the instant `council:opened` is emitted. */
    opened: Promise<string>
    /** Everything main did to the ledger row, in order. */
    updates: Array<{ runId: string; patch: Record<string, unknown> }>
    close: () => Promise<void>
  }

  async function harness(
    over: {
      /** Held before the gateway answers a member, so a run can be caught
       *  mid-deliberation. */
      gate?: Promise<void>
      /** Swaps in a `readUsage` that can be held open, so a run can be caught in
       *  its settle tail. */
      readUsage?: () => Promise<unknown>
    } = {}
  ): Promise<Harness> {
    const server = createServer((req, res) => {
      void (async () => {
        // The request body is drained rather than ignored: an unread body can
        // leave the socket half-open and hang the close below.
        for await (const chunk of req) void chunk
        if (over.gate) await over.gate
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.end(sseBody('A position, briefly held.\n\nVERDICT: AGREE'))
      })()
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as AddressInfo).port
    const gatewayBaseUrl = `http://127.0.0.1:${port}`

    const member = (id: string, label: string, role: string): unknown => ({
      id,
      label,
      credentialProfileId: CRED,
      model: 'test/model',
      role,
      paramsJson: JSON.stringify({ max_tokens: 200 })
    })
    const updates: Array<{ runId: string; patch: Record<string, unknown> }> = []
    const storage = {
      listCouncilMembers: () => [
        member('aaaaaaa1-0000-4000-8000-000000000001', 'Alpha', 'member'),
        member('aaaaaaa1-0000-4000-8000-000000000002', 'Beta', 'member'),
        member('aaaaaaa1-0000-4000-8000-000000000003', 'Arbiter', 'arbiter')
      ],
      getCredentialProfileById: () => ({
        id: CRED,
        providerId: PROV,
        label: 'test key',
        unavailableSince: null
      }),
      getProviderConfigById: () => ({
        id: PROV,
        name: 'OpenRouter',
        authMode: 'api_key',
        model: 'test/model',
        baseUrl: gatewayBaseUrl
      }),
      createCouncilRun: () => undefined,
      updateCouncilRun: (runId: string, patch: Record<string, unknown>) => {
        updates.push({ runId, patch })
      },
      appendCouncilMessage: () => undefined
    } as unknown as StorageService

    const keys = {
      mint: async () => ({
        ok: true,
        value: { key: 'sk-test-not-a-real-key', hash: 'deadbeef', limit: 10 }
      }),
      readUsage:
        over.readUsage ?? (async () => ({ ok: true, value: { usageUsd: 0.01, limitRemaining: 9.99 } })),
      revoke: async () => ({ ok: true, value: undefined }),
      // Answers immediately with "nothing posted yet", which is a legitimate
      // reading rather than zero. The tests never wait for the six reconcile
      // attempts: every assertion lands while `readUsage` is still held.
      queryKeyCost: async () => ({ ok: true, value: null })
    } as unknown as OpenRouterKeyClient

    const openedGate = deferred<string>()
    const service = createCouncilService({
      storage,
      keys,
      hasManagementKey: () => true,
      resolveMemberRoute: async () => ({
        ok: true,
        route: { baseUrl: gatewayBaseUrl, envVarName: 'TEST_API_KEY' }
      }),
      emitOpened: (event) => openedGate.resolve(event.runId),
      emitProgress: () => undefined,
      emitSummary: () => undefined,
      gatewayBaseUrl
    })

    return {
      service,
      opened: openedGate.promise,
      updates,
      close: () => new Promise<void>((r) => server.close(() => r()))
    }
  }

  /* ---- window A: the id exists long before the first token -------------- */

  it.concurrent('⚠ announces the run id at the MINT, so Cancel has something to name', async () => {
    const gate = deferred()
    const h = await harness({ gate: gate.promise })
    const run = h.service.start({ projectId: null, briefPath })

    // Nothing has streamed — the gateway is holding every member request — and
    // the id is already here. This is the whole of window A: it used to arrive
    // only with a member's FIRST TOKEN, which for a reasoning model is minutes,
    // and until it did `Cancel run` sat disabled over a run that was live and
    // spending.
    const runId = await h.opened
    expect(runId).toMatch(/^[0-9a-f-]{36}$/)
    expect(h.service.cancel(runId)).toBe('deliberating')

    gate.resolve()
    const result = await run
    // A cancelled run aborts; the point here is the stage, not the reason.
    expect(result.ok).toBe(false)
    // ⚠ AND THE CANCEL REACHED THE LEDGER. `settle` reads the flag the abort
    // set, so the row says cancelled rather than merely failed — a fact a cancel
    // that "did nothing" could never have produced.
    expect(h.updates.some((u) => u.patch.status === 'cancelled')).toBe(true)
    await h.close()
  }, 30_000)

  /* ---- window B: the settle-and-reconcile tail -------------------------- */

  it.concurrent('⚠⚠ answers `settling` for a run whose invoke is still outstanding', async () => {
    const entered = deferred()
    const held = deferred()
    const h = await harness({
      readUsage: async () => {
        entered.resolve()
        await held.promise
        return { ok: true, value: { usageUsd: 0.01, limitRemaining: 9.99 } }
      }
    })
    const run = h.service.start({ projectId: null, briefPath })
    const runId = await h.opened

    // Main is now exactly where the defect lived: the deliberation is over, the
    // run has left `live`, the key is being read back — and `council:start` has
    // NOT resolved. The old answer here was `false`, meaning "no such run".
    await entered.promise
    expect(h.service.cancel(runId)).toBe('settling')
    // ⚠ AND IT CHANGED NOTHING ABOUT THE RUN. A cancel that flipped the flag here
    // would record a COMPLETED deliberation as cancelled, because `settle` has
    // already read it — which is why the run leaves `live` where it does.
    expect(h.service.cancel(runId)).toBe('settling')

    held.resolve()
    await run
    // ⚠ AND `settling` ENDS WITH THE INVOKE, in the same tick the renderer's
    // promise resolves. There is no instant in which the surface is unlocked and
    // a cancel would still claim the run is finishing.
    expect(h.service.cancel(runId)).toBe('unknown')
    await h.close()
  }, 60_000)

  it('a run this process never opened is `unknown`, and that is still not an error', async () => {
    const h = await harness()
    expect(h.service.cancel('00000000-0000-4000-8000-000000000000')).toBe('unknown')
    await h.close()
  })
})

import { randomUUID } from 'node:crypto'
import { buildMintRequest } from './attributionCore'
import { createApiSession, type TokenUsage } from './apiSession'
import {
  assembleRun,
  computeRunAccounting,
  nextAction,
  routeAcceptsMintedKey,
  type AssemblyCandidate,
  type CouncilAction,
  type CouncilPhase,
  type CouncilState,
  type CouncilTranscriptEntry,
  type PlannedMember,
  type PlannedRun,
  type RunAccounting,
  type TurnRecord
} from './councilCore'
import { logger } from './logger'
import type { OpenRouterKeyClient } from './openrouterKeys'
import { createSessionOutput } from './sessionOutput'
import {
  COUNCIL_RUN_ABANDONED,
  COUNCIL_RUN_CANCELLED,
  COUNCIL_RUN_COMPLETE,
  COUNCIL_RUN_FAILED,
  COUNCIL_RUN_RUNNING,
  type StorageService
} from './storage'

/**
 * Task 3b-3: the council orchestrator — I/O ONLY.
 *
 * ⚠ IT CONTAINS NO `if` THAT DECIDES WHAT HAPPENS NEXT IN THE DELIBERATION.
 * Every such decision is `councilCore.nextAction`'s, and this file's whole job
 * is to perform the actions it returns, persist the results, and feed them
 * back. The branches below are all about I/O outcomes — a mint failed, a stream
 * refused, the user cancelled — never about what the council should ask next.
 *
 * ⚠ IT ALSO OWNS NO TRANSPORT AND NO SCRUBBER. Every request goes through
 * `createApiSession` (D45(2)/D63 Q1) and every byte of model text goes through
 * `createSessionOutput().ingest()` (D63 Q4/(d)). A "just for the arbiter"
 * client is the shape this fails in: it looks like reasonable specialization
 * and it forks the one mechanism the whole app's api mode is being built on.
 *
 * ── THE MONEY, IN ONE PLACE ──────────────────────────────────────────────
 * One minted OpenRouter key per RUN (D64(2)), created before the first request
 * and destroyed after the last one, on EVERY exit path. Every member's request
 * carries that key rather than the member's own credential, so the run has a
 * single bounded spend surface. Read usage back, THEN revoke — always in that
 * order, because revocation is a `DELETE` and a deleted key's usage may no
 * longer be readable (3a-3).
 */

/* ------------------------------------------------------------------ */
/* Tunables — argued, not chosen                                       */
/* ------------------------------------------------------------------ */

/**
 * ⚠ A PRE-AUTHORIZATION CEILING, NOT A BUDGET, AND THE ARITHMETIC IS BELOW.
 *
 * OpenRouter pre-authorizes each request against the key's REMAINING limit and
 * refuses it outright before doing any work (measured 2026-07-25, Task 3a-3):
 *
 *   402 Payment Required: This request requires more credits, or fewer
 *   max_tokens. You requested up to 65536 tokens, but can only afford 46666.
 *
 * That implies ≈$0.0000107 per allocated output token at the model 3a-3
 * measured — a frontier rate, far above what this task's drive models charge.
 * The cap must therefore clear the run's COMBINED max output allocation, since
 * `remaining` shrinks as the run proceeds and the LAST request must still
 * pre-authorize.
 *
 *   worst case per request : MAX_OUTPUT_TOKENS_DEFAULT (1200) × $0.0000107
 *                          ≈ $0.0128
 *   worst case per run     : MAX_COUNCIL_PARTICIPANTS (12) × MAX_ROUNDS (4)
 *                            + arbiter + synthesis ≈ 50 requests
 *                          ≈ 50 × $0.0128 ≈ $0.64
 *
 * $1.00 clears that with headroom, and it is the SAME number `MINT_LIMIT_USD`
 * carries for a dispatch — deliberately. One number with one argument does not
 * drift; two numbers need two arguments and the second one goes stale first.
 *
 * ⚠ AND F34 IS WHY THE HEADROOM IS NOT WASTE. `moonshotai/kimi-k3` — the
 * standing route's default — is a REASONING model, and OpenRouter bills
 * reasoning tokens as output tokens. Measured in Task 3b-1: a probe capped at
 * 60 returned exactly 60 output tokens with an EMPTY answer. Live pricing read
 * 2026-07-26: kimi-k3 is $15/M output, so 1200 allocated tokens is ≈$0.018 of
 * pre-authorization per request — more than the rate above. The cap must clear
 * the reasoning budget PLUS the answer, not merely "the answer".
 *
 * What this number bounds is the worst case of ONE orphaned key, and that worst
 * case is bounded twice more: by `expires_at`, and by the boot reconcile — which
 * as of D66 can finally see a council run at all.
 */
export const COUNCIL_MINT_LIMIT_USD = 1.0

/** `expires_at` = mint + this. Shorter than a dispatch's 12 h because a council
 *  run is minutes, not a working session. The third orphan defence and the
 *  weakest of the three (D4 obligation 5 could not confirm OpenRouter stops
 *  honouring a key at that instant), so nothing here leans on it. */
export const COUNCIL_MINT_TTL_MS = 60 * 60 * 1000

/**
 * ⚠ THE ONLY REQUEST PARAMETER THIS SERVICE SENDS, AND THE DECISION IS STATED
 * RATHER THAN IMPLIED (`ImplementationSpec-3b-2.md` §8 left it open).
 *
 * `createApiSession` builds its body from exactly four things — `model`,
 * `messages`, `stream`, and an optional `max_tokens`. There is no channel for
 * `temperature`, `top_p` or anything else, and opening one means editing
 * `apiSession.ts`, which this task must leave byte-identical. So:
 *
 *   · `max_tokens` from a member's `params_json` IS honoured, clamped to the
 *     bounds below — it is the one parameter F34 makes consequential;
 *   · every OTHER key in `params_json` is stored, read, and DELIBERATELY NOT
 *     SENT. Widening that needs a transport change, which is a raise.
 *
 * Silently dropping them would be the wrong half of that: the log line in
 * `driveMember` names them, so a user who set `temperature` learns it did
 * nothing instead of believing it did something.
 */
export const MAX_OUTPUT_TOKENS_DEFAULT = 1200
const MAX_OUTPUT_TOKENS_CEILING = 4000
const MAX_OUTPUT_TOKENS_FLOOR = 200

/** The transcript ring per member. Generous — a position is prose, not a log. */
const MEMBER_BUFFER_CHARS = 200_000
const MEMBER_FLUSH_MS = 50

/**
 * ⚠ A RUNAWAY GUARD, NOT A PROTOCOL RULE. If `nextAction` ever returns `ask`
 * for something already answered, the loop below would spin forever making
 * billable calls. This bounds that, and it bounds nothing else: the protocol's
 * own round structure is the core's business and is expected to terminate well
 * inside it. Exceeding this is a BUG, and it aborts loudly rather than
 * completing quietly with whatever it had.
 */
const MAX_PROTOCOL_STEPS = 24

/** The cap's arithmetic above assumes a bounded council. Stated as a refusal so
 *  the assumption is checkable rather than implied. */
export const MAX_COUNCIL_PARTICIPANTS = 12

/* ------------------------------------------------------------------ */
/* Deps                                                                */
/* ------------------------------------------------------------------ */

/** What the pre-flight learned about one member's route. ⚠ NO KEY MATERIAL:
 *  the plaintext this resolution decrypted is dropped at the call site. */
export interface MemberRoute {
  readonly baseUrl: string
  /** Non-secret metadata, carried so the credential handed to the transport is
   *  shaped honestly rather than with an invented variable name. */
  readonly envVarName: string
}

export interface CouncilProgressEvent {
  readonly runId: string
  readonly phase: CouncilPhase
  readonly round: number
  readonly memberId: string | null
  /** ⚠ SCRUBBED. It comes from `SessionOutput`'s `onText`, never from the raw
   *  stream — see `driveMember`. */
  readonly delta: string
}

export interface CouncilServiceDeps {
  readonly storage: StorageService
  /** ⚠ THE SAME CLIENT `DispatchAttribution` HOLDS, threaded from `index.ts`.
   *  Not a second one: a second client means a second management-key path, and
   *  the management key's decrypt-per-use discipline has exactly one home. */
  readonly keys: OpenRouterKeyClient
  readonly hasManagementKey: () => boolean
  /**
   * ⚠ `ipc.ts`'s OWN `resolveCredential`, REUSED AND NEVER FORKED — all five
   * ordered refusals, with the management refusal still sitting BEFORE
   * decryption (D58/D60).
   *
   * It returns only the ROUTE, because the route is the only thing this service
   * needs from it. The credential it decrypts is DISCARDED at the call site:
   * every request carries the run's minted key instead, so the member's own key
   * is decrypted and thrown away. That is deliberate and it is the price of not
   * forking the refusal ladder — the alternative is a second, shorter ladder
   * that drifts from the first.
   */
  readonly resolveMemberRoute: (
    credentialProfileId: string
  ) => Promise<{ ok: true; route: MemberRoute | null } | { ok: false; reason: string }>
  readonly emitProgress: (event: CouncilProgressEvent) => void
  /** The gateway the minted key authenticates against. Injected so the pure
   *  core never learns a URL and this file never hard-codes a second one. */
  readonly gatewayBaseUrl: string
  readonly now?: () => Date
}

export type CouncilStartResult =
  | { readonly ok: true; readonly runId: string; readonly findings: string; readonly accounting: RunAccounting; readonly costUsd: number | null }
  | { readonly ok: false; readonly reason: string }

export interface CouncilService {
  start(input: { projectId: string | null; briefPath: string; briefText: string }): Promise<CouncilStartResult>
  /** Returns false when there is no such live run — a cancel for a finished run
   *  is not an error, it is a race the user cannot see. */
  cancel(runId: string): boolean
  /**
   * `app 'before-quit'`. ⚠ SYNCHRONOUS AND HONEST ABOUT ITS LIMITS: it aborts
   * every in-flight request and marks the run abandoned, but it CANNOT complete
   * a network revoke — `before-quit` does not await, and the process is about to
   * die. The ledger row therefore stays OPEN, which is exactly what makes the
   * boot reconcile the backstop for this one path (D66). Claiming a quit-time
   * revocation here would be claiming something the runtime cannot deliver.
   */
  abandonOpenRunsOnQuit(): void
}

interface LiveRun {
  readonly runId: string
  readonly controller: AbortController
  cancelled: boolean
}

export function createCouncilService(deps: CouncilServiceDeps): CouncilService {
  const now = deps.now ?? ((): Date => new Date())
  const live = new Map<string, LiveRun>()

  /* ---------------------------------------------------------------- */

  async function start(input: {
    projectId: string | null
    briefPath: string
    briefText: string
  }): Promise<CouncilStartResult> {
    if (!deps.hasManagementKey()) {
      return {
        ok: false,
        reason:
          'A council run needs an OpenRouter management key to mint the capped key that bounds its spend. Add one in Settings.'
      }
    }

    // ── 1. Assembly. PURE, and before anything is spent or created. ───────
    const assembly = assembleRun(loadCandidates(), input.briefText, deps.gatewayBaseUrl)
    if (!assembly.ok) return { ok: false, reason: assembly.reason }
    const run = assembly.run
    const participants = [...run.members, run.arbiter]
    if (participants.length > MAX_COUNCIL_PARTICIPANTS) {
      return {
        ok: false,
        reason: `A council is limited to ${MAX_COUNCIL_PARTICIPANTS} participants; this one has ${participants.length}.`
      }
    }

    // ── 2. Pre-flight: resolve every route BEFORE minting. ────────────────
    // ⚠ ORDER MATTERS AND IT IS ABOUT MONEY. Every refusal below happens with
    // nothing minted and nothing spent. Discovering a bad route after the mint
    // would leave a funded key to clean up for a run that never began.
    const routes = new Map<string, MemberRoute>()
    for (const member of participants) {
      const resolved = await deps.resolveMemberRoute(member.credentialProfileId)
      if (!resolved.ok) {
        return { ok: false, reason: `Council member '${member.label}': ${resolved.reason}` }
      }
      if (resolved.route === null) {
        return { ok: false, reason: `Council member '${member.label}' has no base URL to send a request to.` }
      }
      // ⚠ RE-CHECKED AGAINST THE EFFECTIVE ROUTE, not the provider row.
      // A credential envelope may override the provider's base URL (D33(e)), so
      // the URL assembly saw and the URL the request goes to are not guaranteed
      // to be the same one. The minted key is only valid at the gateway, and
      // this is the check that sees what will actually be dialled.
      if (!routeAcceptsMintedKey(resolved.route.baseUrl, deps.gatewayBaseUrl)) {
        return {
          ok: false,
          reason:
            `Council member '${member.label}' resolves to a route outside the OpenRouter gateway, so it cannot use ` +
            `the single capped key that bounds this run's spend.`
        }
      }
      routes.set(member.memberId, resolved.route)
    }

    // ── 3. Mint. ONE key for the whole run (D64(2)). ──────────────────────
    const runId = randomUUID()
    const mintedAt = now()
    const request = buildMintRequest({
      owner: { kind: 'council', runId },
      limitUsd: COUNCIL_MINT_LIMIT_USD,
      now: mintedAt,
      ttlMs: COUNCIL_MINT_TTL_MS
    })
    if (!request.ok) {
      // The refusal path that guarantees no uncapped council key can exist.
      return { ok: false, reason: `Could not start the run: ${request.reason}` }
    }
    const minted = await deps.keys.mint(request.body)
    if (!minted.ok) {
      // ⚠ A MINT FAILURE REFUSES THE RUN — it does NOT degrade to the members'
      // own keys. That is the deliberate opposite of `mintForDispatch`, and the
      // boundary is exact: there, attribution is telemetry over a launch that
      // must not be blocked; here, the minted key IS the spend bound, so running
      // without it would be running unbounded.
      return { ok: false, reason: `Could not start the run: ${minted.reason}` }
    }
    if (minted.value.limit === null || !(minted.value.limit > 0)) {
      // A mint that came back WITHOUT a limit is a mint we do not trust — the
      // cap is the whole blast-radius bound. Revoke and refuse.
      logger.error('[council] OpenRouter returned a key with no positive limit; revoking immediately')
      await revokeQuietly(minted.value.hash)
      return { ok: false, reason: 'Could not start the run: the provider returned a key with no spend limit.' }
    }
    const mintedKey = minted.value.key

    // The write-ahead ledger row. `revoked_at` NULL IS the open-row predicate
    // the boot reconcile queries — the same definition v8 uses, deliberately,
    // and as of D66 actually read.
    deps.storage.createCouncilRun({
      id: runId,
      projectId: input.projectId,
      briefPath: input.briefPath,
      findingsPath: null,
      status: COUNCIL_RUN_RUNNING,
      startedAt: mintedAt.toISOString(),
      endedAt: null,
      mintedKeyHash: minted.value.hash,
      mintedKeyLimit: minted.value.limit,
      mintedAt: mintedAt.toISOString(),
      revokedAt: null,
      tokensIn: null,
      tokensOut: null,
      tokensCached: null,
      costUsd: null
    })
    logger.info(
      `[council] run ${runId} opened · ${run.members.length} member(s) + 1 arbiter · key capped at $${minted.value.limit}`
    )

    const controller = new AbortController()
    const liveRun: LiveRun = { runId, controller, cancelled: false }
    live.set(runId, liveRun)

    const turns: TurnRecord[] = []
    let transcript: readonly CouncilTranscriptEntry[] = []
    let outcome: { kind: 'complete'; findings: string } | { kind: 'abort'; reason: string } = {
      kind: 'abort',
      reason: 'The run ended without reaching a conclusion.'
    }

    try {
      // ── 4. The protocol loop. EVERY decision below is the core's. ───────
      for (let step = 0; step < MAX_PROTOCOL_STEPS; step++) {
        // ⚠ `runId` and `startedAt` are PROVENANCE the core renders and cannot
        // derive: it has no clock and no uuid source (D68(2)). Both are already
        // on the ledger row above, so the findings file and the DB agree by
        // construction rather than by two independent stamps.
        const state: CouncilState = {
          run,
          transcript,
          cancelled: liveRun.cancelled,
          runId,
          startedAt: mintedAt.toISOString()
        }
        const actions = nextAction(state)
        const terminal = actions.find((a): a is Extract<CouncilAction, { kind: 'complete' | 'abort' }> =>
          a.kind !== 'ask'
        )
        if (terminal) {
          outcome = terminal.kind === 'complete' ? { kind: 'complete', findings: terminal.findings } : terminal
          break
        }
        const asks = actions.filter((a): a is Extract<CouncilAction, { kind: 'ask' }> => a.kind === 'ask')
        if (asks.length === 0) {
          outcome = { kind: 'abort', reason: 'The protocol returned no next step.' }
          break
        }

        // ⚠ THE BLIND ROUND, MADE REAL. Every ask in this batch is issued
        // concurrently, so no member's request can contain another's answer —
        // none of those answers exists yet. Awaiting them in sequence and
        // feeding each into the next is precisely what the array shape exists
        // to make impossible to do by accident.
        const results = await Promise.all(
          asks.map((ask) => driveMember(ask, run, routes, mintedKey, liveRun))
        )
        // ⚠ PERSISTED IMMEDIATELY, INCLUDING THE REFUSALS. A batch that is held
        // in memory until the run ends is a batch a cancel or a crash loses —
        // and the transcript is the only artefact that can show a run was
        // partial. Written here rather than inside `driveMember` so every DB
        // write in this file lives on one path.
        for (const result of results) persistTurn(runId, result)
        transcript = [...transcript, ...results.map((r) => r.entry)]
        turns.push(...results.map((r) => r.record))
      }
    } catch (err) {
      // A protocol-loop throw must still reach the `finally` below, which is
      // the only thing standing between a crash and a live funded key.
      logger.error({ err }, `[council] run ${runId} failed mid-deliberation`)
      outcome = { kind: 'abort', reason: 'The run failed part-way through.' }
    } finally {
      live.delete(runId)
    }

    // ── 5. Read usage back, THEN revoke. ALWAYS in that order. ────────────
    const costUsd = await settle(runId, minted.value.hash, liveRun.cancelled, outcome.kind)

    const accounting = computeRunAccounting({ membersPlanned: participants.length, turns })
    logger.info(
      `[council] run ${runId} ${outcome.kind === 'complete' ? 'complete' : 'aborted'} · ` +
        `${accounting.membersAnswered}/${accounting.membersPlanned} members answered · ${accounting.membersRefused} refused · ` +
        `${accounting.turnsAnswered} turn(s) answered, ${accounting.turnsRefused} refused · ` +
        `usage reported for ${accounting.usageReported}, absent for ${accounting.usageAbsent} · ` +
        `cost ${costUsd === null ? 'UNKNOWN' : '$' + costUsd}`
    )

    if (outcome.kind === 'abort') return { ok: false, reason: outcome.reason }
    return { ok: true, runId, findings: outcome.findings, accounting, costUsd }
  }

  /* ---------------------------------------------------------------- */

  /**
   * Drive ONE member's turn. The sequence is `ImplementationSpec-3b-3.md` §4's,
   * and three things it gets right would break under a rearrangement:
   *
   *  · `output.flush()` BEFORE persisting, or the scrubber's held carry — the
   *    partial tail it withholds in case it is the prefix of a secret — never
   *    reaches the transcript;
   *  · `handle.dispose()` in a `finally`, or a member that throws mid-stream
   *    leaves an HTTP request running and spending;
   *  · ONE `SessionOutput` PER MEMBER. A scrubber holds a carry across chunk
   *    boundaries, so sharing one across members would interleave two streams
   *    through one carry and corrupt both.
   */
  async function driveMember(
    ask: Extract<CouncilAction, { kind: 'ask' }>,
    run: PlannedRun,
    routes: ReadonlyMap<string, MemberRoute>,
    mintedKey: string,
    liveRun: LiveRun
  ): Promise<{ entry: CouncilTranscriptEntry; record: TurnRecord }> {
    const member = [...run.members, run.arbiter].find((m) => m.memberId === ask.memberId)
    const route = routes.get(ask.memberId)
    if (!member || !route) {
      // Unreachable: the core only asks members assembly planned. Recorded as a
      // refusal rather than thrown, because a transcript that is missing a turn
      // is worse than one that says the turn failed.
      return refusal(ask, 'This member could not be resolved for the run.')
    }

    let refused: string | null = null
    let usage: TokenUsage | null = null
    const handle = createApiSession(
      {
        sessionId: `${liveRun.runId}:${member.memberId}:${ask.phase}:${ask.round}`,
        modelId: member.model,
        // ⚠ THE MINTED KEY, NOT THE MEMBER'S OWN. This is what gives the run one
        // bounded spend surface. The member's credential was decrypted during
        // the pre-flight — for its refusals and for its route — and discarded
        // there; `envVarName` below is the only thing that survived it, and it
        // is not secret.
        credential: { envVarName: route.envVarName, value: mintedKey, isSecret: true }
      },
      {
        baseUrl: route.baseUrl,
        maxOutputTokens: resolveMaxOutputTokens(member),
        // Session-scoped external abort: cancelling the RUN aborts every member
        // at once without this loop tracking each handle (D63 Q3's note).
        signal: liveRun.controller.signal,
        // D63(g): both facts arrive on the FACTORY's contract, never through the
        // text stream — a refusal or a usage total yielded as text would flow
        // through the scrubber and be rendered as though the model had said it.
        onUsage: (u) => {
          usage = u
        },
        onRefusal: (r) => {
          refused = r
        }
      }
    )

    // ⚠ THE SEAM (D45(1)/D46/D63 Q4). The factory emits raw text; THIS scrubs
    // it, with the run's minted key registered as a secret. Omitting that
    // registration leaves a wired-but-inert seam that passes every structural
    // check — which is why 3b-1's drive 5 planted a secret and asserted the
    // INGESTED text came back redacted.
    //
    // Honest coverage wording (F27, sharpened by D63 Q4): Chorus redacts
    // registered exact values on ingest; it cannot redact values an agent
    // derives, and it cannot redact content it was asked to read.
    const output = createSessionOutput({
      secrets: [mintedKey],
      maxChars: MEMBER_BUFFER_CHARS,
      flushMs: MEMBER_FLUSH_MS,
      // ⚠ THE PROGRESS BROADCAST'S ONLY SOURCE. Wiring it to the raw stream
      // instead would bypass the seam at the last possible moment, which is
      // exactly where it would be least visible in review.
      onText: (delta) =>
        deps.emitProgress({
          runId: liveRun.runId,
          phase: ask.phase,
          round: ask.round,
          memberId: member.memberId,
          delta
        })
    })

    try {
      await handle.send(ask.prompt)
      for await (const chunk of handle.receive()) output.ingest(chunk)
      output.flush()
    } catch (err) {
      logger.error({ err }, `[council] member ${member.memberId} failed mid-stream`)
      refused = refused ?? 'The response stream failed.'
    } finally {
      await handle.dispose()
      output.dispose()
    }

    if (refused !== null) return refusal(ask, refused, usage)
    if (output.buffer.trim() === '') {
      // ⚠ F34's SIGNATURE, AND IT LOOKS EXACTLY LIKE A BROKEN TRANSPORT. A
      // reasoning model can consume the entire output cap on reasoning tokens
      // and emit no `delta.content` at all — billed in full, answer empty. It is
      // recorded as a refusal with its own wording so the transcript says which
      // of the two happened.
      return refusal(ask, 'The model returned an empty answer (its output budget may have gone to reasoning).', usage)
    }
    return {
      entry: {
        memberId: member.memberId,
        round: ask.round,
        phase: ask.phase,
        content: output.buffer,
        outcome: 'answered'
      },
      record: { memberId: member.memberId, outcome: 'answered', usage }
    }
  }

  function refusal(
    ask: Extract<CouncilAction, { kind: 'ask' }>,
    reason: string,
    usage: TokenUsage | null = null
  ): { entry: CouncilTranscriptEntry; record: TurnRecord } {
    // ⚠ PERSISTED LIKE ANY OTHER TURN. A council that ran with three of five
    // members must SAY so in its own transcript; an absent row is an absence
    // nobody downstream can distinguish from a smaller council.
    return {
      entry: { memberId: ask.memberId, round: ask.round, phase: ask.phase, content: reason, outcome: 'refused' },
      record: { memberId: ask.memberId, outcome: 'refused', usage }
    }
  }

  /* ---------------------------------------------------------------- */

  /**
   * Read the key's usage, then revoke it, then close the ledger row.
   *
   * ⚠ NEVER THROWS, because it is called from a path that has already decided
   * the run's outcome. A settle failure leaves `revoked_at` NULL, which is not a
   * loss — it is the open-row predicate, and the boot reconcile is the backstop
   * (bounded meanwhile by the key's own cap).
   */
  async function settle(
    runId: string,
    hash: string,
    cancelled: boolean,
    outcomeKind: 'complete' | 'abort'
  ): Promise<number | null> {
    let costUsd: number | null = null
    try {
      // 1. READ FIRST, always. Revocation is a DELETE and whether usage survives
      //    it is UNDOCUMENTED (D4 obligation 6); reading first makes the
      //    question irrelevant.
      const usage = await deps.keys.readUsage(hash)
      costUsd = usage.ok ? usage.value.usageUsd : null
      if (!usage.ok) logger.warn(`[council] usage read failed; revoking anyway: ${usage.reason}`)

      // 2. Revoke. This matters more than the number above.
      const revoked = await deps.keys.revoke(hash)
      const status = cancelled
        ? COUNCIL_RUN_CANCELLED
        : outcomeKind === 'complete'
          ? COUNCIL_RUN_COMPLETE
          : COUNCIL_RUN_FAILED
      deps.storage.updateCouncilRun(runId, {
        status,
        endedAt: new Date().toISOString(),
        costUsd,
        // ⚠ NULL ON A FAILED REVOKE, DELIBERATELY. "We called revoke" and "the
        // key is gone" are different claims, and writing a timestamp for the
        // first would tell the boot reconcile there is nothing left to do.
        revokedAt: revoked.ok ? new Date().toISOString() : null
      })
      if (!revoked.ok) {
        logger.error(`[council] revoke FAILED for run ${runId}; the ledger row stays open: ${revoked.reason}`)
      }
    } catch (err) {
      logger.error({ err }, `[council] settle failed for run ${runId}; the ledger row stays open`)
    }
    return costUsd
  }

  async function revokeQuietly(hash: string): Promise<void> {
    const result = await deps.keys.revoke(hash)
    if (!result.ok) {
      logger.error(`[council] could not revoke a key we cannot use; the boot reconcile will catch it: ${result.reason}`)
    }
  }

  /**
   * One transcript row. `member_id` is carried even for a refusal — the row's
   * whole value is saying WHICH member did not answer.
   *
   * ⚠ THE TOKEN COLUMNS TAKE `null` WHEN THE PROVIDER REPORTED NOTHING, NEVER 0
   * (D55). A zero here would be indistinguishable from a genuinely zero-token
   * turn, and every total computed from the column downstream would be quietly
   * wrong in the cheap direction.
   */
  function persistTurn(
    runId: string,
    result: { entry: CouncilTranscriptEntry; record: TurnRecord }
  ): void {
    try {
      deps.storage.appendCouncilMessage({
        id: randomUUID(),
        runId,
        memberId: result.entry.memberId,
        round: result.entry.round,
        phase: result.entry.phase,
        content: result.entry.content,
        tokensIn: result.record.usage?.tokensIn ?? null,
        tokensOut: result.record.usage?.tokensOut ?? null,
        createdAt: new Date().toISOString()
      })
    } catch (err) {
      // A transcript write must never take down a run that is already spending.
      logger.error({ err }, `[council] could not persist a turn for run ${runId}`)
    }
  }

  /** Every saved member, widened with the two rows assembly needs. Rows in,
   *  decisions out — the policy is all in `assembleRun`. */
  function loadCandidates(): AssemblyCandidate[] {
    return deps.storage.listCouncilMembers().map((member) => {
      const credential = deps.storage.getCredentialProfileById(member.credentialProfileId)
      const provider = credential ? deps.storage.getProviderConfigById(credential.providerId) : null
      return {
        member: {
          id: member.id,
          label: member.label,
          credentialProfileId: member.credentialProfileId,
          model: member.model,
          role: member.role,
          paramsJson: member.paramsJson
        },
        provider: provider
          ? { id: provider.id, name: provider.name, authMode: provider.authMode, model: provider.model }
          : null,
        credential: credential
          ? {
              id: credential.id,
              providerId: credential.providerId,
              label: credential.label,
              unavailableSince: credential.unavailableSince
            }
          : null,
        baseUrl: provider?.baseUrl ?? null
      }
    })
  }

  /** `max_tokens` from `params_json`, clamped. A member that asks for a million
   *  gets the ceiling, not a 402 — the pre-authorization refuses the whole
   *  request, so an out-of-range parameter would take the run down rather than
   *  degrade it. */
  function resolveMaxOutputTokens(member: PlannedMember): number {
    const raw = member.params.max_tokens
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return MAX_OUTPUT_TOKENS_DEFAULT
    return Math.min(MAX_OUTPUT_TOKENS_CEILING, Math.max(MAX_OUTPUT_TOKENS_FLOOR, Math.floor(raw)))
  }

  /* ---------------------------------------------------------------- */

  return {
    start,

    cancel(runId: string): boolean {
      const target = live.get(runId)
      if (!target) return false
      target.cancelled = true
      // The session-scoped signal aborts every in-flight member at once; each
      // member's own `finally` still calls dispose(), which is the sole
      // cancellation mechanism (D63 Q3) and the only thing that clears the
      // deadline timer.
      target.controller.abort()
      logger.info(`[council] run ${runId} cancelled by the user`)
      return true
    },

    abandonOpenRunsOnQuit(): void {
      for (const target of live.values()) {
        target.cancelled = true
        target.controller.abort()
        try {
          // Status only. `revoked_at` is deliberately NOT written: nothing here
          // can revoke, and a revocation timestamp for a key that still exists
          // would tell the boot reconcile to leave it alone.
          deps.storage.updateCouncilRun(target.runId, {
            status: COUNCIL_RUN_ABANDONED,
            endedAt: new Date().toISOString()
          })
        } catch {
          // Quitting. The ledger row is already open; that is the backstop.
        }
        logger.warn(`[council] run ${target.runId} abandoned at quit; its key is left to the boot reconcile`)
      }
      live.clear()
    }
  }
}

import { logger } from './logger'
import type { ApiLaunchSpec, ApiSessionHandle, ResolvedCredential } from '../adapters/types'
import { API_SESSION_FAILURE, type ApiSessionDeps, type TokenUsage } from './apiSession'
import type { NewDispatchRow } from '../db/schema'
import {
  fallbackOutcome,
  isNetworkMode,
  judgeReply,
  outputTokenCap,
  promptFor,
  type RefineFallback,
  type RefineOutcome,
  type RefinementMode
} from './voiceRefineCore'

/**
 * The impure half of voice refinement (Task 5-4): one `createApiSession` call
 * per Clean up / Organize dictation, `onUsage` wired, and the spend written to
 * a `dispatches` row.
 *
 * ⚠ REUSES THE BYOK PATH EXACTLY AND GROWS NO SECOND CLIENT (D45(2)). There is
 * no `fetch` in this file. `createApiSession` is injected rather than imported
 * so the five failure paths — transport, timeout, refusal, empty, validation —
 * are drivable in `voiceRefine.test.ts` with a scripted handle and no network.
 *
 * ⚠ VERBATIM NEVER REACHES ANY DEPENDENCY. `refine()` returns before
 * `resolveRoute` is called, so the offline floor (D155) does not even decrypt
 * a key. A Verbatim path that resolved a credential "just in case" would fail
 * on a machine with no vault, which is precisely the machine the floor exists
 * for.
 *
 * ⚠ THE ORIGINAL IS NEVER LOST. Every path returns an outcome whose `text` is
 * either a VALIDATED refinement or the original itself, and `voice.ts` still
 * holds the original independently. Losing the dictation is the worse bug and
 * the easier one to write; nothing here can produce it.
 *
 * ⚠ NO TRANSCRIPT TEXT REACHES A LOG. Every log line below carries a mode, a
 * fallback reason from a closed vocabulary, counts and durations. The tempting
 * place to put the transcript is the refinement-failed error, and it is not
 * there.
 */

/* ────────────────────────────── the route ────────────────────────────────── */

/** What a network mode needs to dial: a decrypted credential and an endpoint. */
export interface RefineRoute {
  readonly credential: ResolvedCredential
  readonly baseUrl: string
  readonly modelId: string
  /** For the dispatch row's `provider_name`; never used to route. */
  readonly providerName: string | null
  readonly extraHeaders?: Readonly<Record<string, string>>
}

export type RefineRouteResult =
  | { readonly ok: true; readonly route: RefineRoute }
  /** `not-configured` = no refiner chosen in settings; `no-credential` = a
   *  refiner is chosen but its profile cannot be resolved (deleted,
   *  undecryptable, no base URL). Both fall back to the original. */
  | { readonly ok: false; readonly reason: 'not-configured' | 'no-credential' }

/* ────────────────────────────── the deps ─────────────────────────────────── */

export interface VoiceRefineDeps {
  /**
   * `createApiSession`, injected. The ONE shared BYOK primitive; the council
   * and the day report ride the same function.
   */
  readonly createSession: (spec: ApiLaunchSpec, deps: ApiSessionDeps) => ApiSessionHandle
  /**
   * Resolve the configured refiner into a dialable route.
   *
   * ⚠ CALLED PER REFINEMENT, NEVER CACHED, AND ONLY FOR NETWORK MODES. The
   * credential can be rotated or deleted between two dictations; a cached
   * route would keep dialling a profile the user has removed. `ipc.ts` binds
   * this to `resolveCredential` — the same refusal ladder every other consumer
   * uses, because a second, shorter one drifts from the first.
   */
  readonly resolveRoute: () => Promise<RefineRouteResult>
  /** Write the spend row. Bound to `storage.createDispatch`. */
  readonly recordDispatch: (row: NewDispatchRow) => void
  readonly now: () => Date
  readonly newId: () => string
  /** Wall-clock bound for the one send/receive cycle. Default REFINE_TIMEOUT_MS. */
  readonly timeoutMs?: number
}

export interface RefineRequest {
  readonly original: string
  readonly mode: RefinementMode
  /**
   * Where the words are going, for the dispatch row. Opaque strings — a
   * dispatch deliberately outlives its session row (schema.ts, D48) — and
   * NEVER re-resolved here: `voice.ts` owns the target and this file records
   * what it was told.
   */
  readonly target: {
    readonly sessionId: string | null
    readonly projectId: string | null
    readonly cwd: string | null
  }
}

export interface VoiceRefiner {
  refine(req: RefineRequest): Promise<RefineOutcome>
}

/**
 * ⚠ SHORT, BECAUSE THE USER IS WAITING FOR THEIR OWN WORDS. A refinement is a
 * single turn over at most ~120 s of speech (a few hundred tokens); a
 * responsive model answers in one to five seconds. The transport's 120 s
 * default would leave a dictation hanging for two minutes before the original
 * was inserted, which is a worse experience than no refinement. On timeout the
 * ORIGINAL is inserted immediately.
 */
export const REFINE_TIMEOUT_MS = 20_000

/**
 * Classify a transport refusal into the closed fallback vocabulary.
 *
 * ⚠ BY IDENTITY AGAINST `API_SESSION_FAILURE`, NOT BY MATCHING PROSE. The
 * strings are the transport's contract and may be reworded; matching on
 * `/timed out/` would silently reclassify a timeout as a transport error the
 * day someone edits the sentence.
 */
export function classifyRefusal(reason: string): Exclude<RefineFallback, 'verbatim' | 'not-configured' | 'no-credential' | 'empty' | 'validation'> {
  if (reason === API_SESSION_FAILURE.timedOut) return 'timeout'
  if (
    reason === API_SESSION_FAILURE.authFailed ||
    reason === API_SESSION_FAILURE.paymentRequired ||
    reason === API_SESSION_FAILURE.rateLimited ||
    reason === API_SESSION_FAILURE.busy ||
    reason === API_SESSION_FAILURE.disposed
  ) {
    return 'refused'
  }
  return 'transport'
}

export function createVoiceRefiner(deps: VoiceRefineDeps): VoiceRefiner {
  const timeoutMs = deps.timeoutMs ?? REFINE_TIMEOUT_MS

  /**
   * The spend row.
   *
   * ⚠ WRITTEN FOR EVERY NETWORK ATTEMPT — succeeded, refused, timed out or
   * rejected by the invention check — because spend happened (or may have) on
   * every one of them. Verbatim writes nothing: it made no call.
   *
   * ⚠ NULL AND ZERO ARE DIFFERENT FACTS. If `onUsage` never fired, every token
   * column and the cost are NULL — never 0. F42 exists because "measured as
   * zero" and "never measured" were conflated once already, and a zero
   * silently understates every rollup built on top of it.
   */
  function record(input: {
    readonly id: string
    readonly req: RefineRequest
    readonly route: RefineRoute
    readonly startedAt: Date
    readonly usage: TokenUsage | null
    readonly outcome: 'completed' | 'failed'
  }): void {
    const { id, req, route, startedAt, usage, outcome } = input
    const row: NewDispatchRow = {
      id,
      sessionId: req.target.sessionId,
      projectId: req.target.projectId,
      taskId: null,
      // ⚠ 'voice' IS OUTSIDE agentKindSchema (shared/ipc.ts — claude|codex|
      // kimi|opencode), AND THAT IS A DELIBERATE, RECORDED CHOICE (D164)
      // RATHER THAN AN OVERSIGHT.
      //
      // Safe TODAY: no IPC schema parses dispatches.agent — verified at the
      // 2026-08-17 kickoff and again here. But F25 is EXACTLY this defect one
      // layer up: one session row whose `agent` held an unknown value made an
      // outbound Zod parse throw and blanked an entire project view. When
      // Phase 7's cost rollups read dispatch rows, an enum parse over `agent`
      // meets 'voice' and repeats it.
      //
      // The ruled fix is F25's own: TOLERATE AT THE PROJECTION, not by widening
      // the enum reflexively — and if the enum is ever widened, it moves
      // TOGETHER with staticRegistry in one change, as a numbered decision
      // (D86's precedent). `attributionCore.computeAttributionSummary` already
      // does this for `tokens_source` (an unknown value counts as unknown, it
      // does not throw), and D164 records that any dispatch-shaped read schema
      // must do the same for `agent`.
      agent: 'voice',
      model: route.modelId,
      providerName: route.providerName,
      // It IS an API-key call on the user's own key: the summary counts
      // 'subscription' rows separately, and this is not one.
      authMode: 'api_key',
      // NOT NULL in the schema; the target pane's cwd when known, else empty —
      // a refinement has no working directory of its own.
      cwd: req.target.cwd ?? '',
      startedAt: startedAt.toISOString(),
      endedAt: deps.now().toISOString(),
      outcome,
      // No process closed this; the vocabulary ('exit'|'kill'|'dispose'|
      // 'boot-heal') is the PTY's, and null is legal — OPEN means outcome IS
      // NULL, never closed_by IS NULL.
      closedBy: null,
      exitCode: null,
      tokensIn: usage?.tokensIn ?? null,
      tokensOut: usage?.tokensOut ?? null,
      tokensCached: usage?.tokensCached ?? null,
      // ⚠ F42 APPLIES HARDER HERE THAN ANYWHERE IT HAS BEEN MEASURED. The
      // council's cost_usd under-reports because it reads the MINTED KEY's
      // spend counter milliseconds after the last stream closes — before the
      // provider has settled the final turn — and then deletes the key, so the
      // reading can never be revised. Brute-forcing run A's charges showed the
      // recorded figure matched "every turn EXCEPT the last".
      //
      // A refinement is a SINGLE SHORT TURN. All of it is the final turn. The
      // minted-key method would be maximally wrong.
      //
      // So the cost comes off the SAME `usage` frame as the tokens — the
      // gateway's own charge for this generation (`usage.cost`, read by
      // `apiSession.readUsage`), which cannot race because it rides the frame
      // that ends the generation it prices. Not a local tokens × rate
      // calculation: there is deliberately no price table (F42's own record —
      // `glm-5.2` moved $0.67/$2.10 → $0.72/$2.25 in six days). NULL when the
      // provider reported none; NEVER a key-spend scalar.
      costUsd: usage?.costUsd ?? null,
      // No mint: the user's own key was used, so nothing was minted, revoked
      // or attributed. 'none' is exactly true (attributionCore).
      mintedKeyHash: null,
      mintedKeyLimit: null,
      mintedAt: null,
      revokedAt: null,
      attributionState: 'none',
      // 'api-usage' = read from the provider's own usage frame on the
      // completing response. NULL when no usage frame arrived: unknown, not
      // zero.
      tokensSource: usage === null ? null : 'api-usage'
    }
    try {
      deps.recordDispatch(row)
    } catch (err) {
      // Metering must never cost the user their dictation: the outcome is
      // already decided by the time this runs, and a storage error is logged
      // and dropped.
      logger.error({ err }, '[voice] refinement spend row could not be written')
    }
  }

  return {
    async refine(req: RefineRequest): Promise<RefineOutcome> {
      const { original, mode } = req

      // ⚠ THE OFFLINE FLOOR. Nothing below this line runs for Verbatim: no
      // route, no key, no clock, no row.
      if (!isNetworkMode(mode)) return fallbackOutcome(original, mode, 'verbatim')

      if (original.trim().length === 0) return fallbackOutcome(original, mode, 'empty')

      const routed = await deps.resolveRoute()
      if (!routed.ok) {
        logger.info({ mode, fallback: routed.reason }, '[voice] refinement skipped')
        return fallbackOutcome(original, mode, routed.reason)
      }
      const { route } = routed

      const id = deps.newId()
      const startedAt = deps.now()
      const prompt = promptFor(mode, original)

      let usage: TokenUsage | null = null
      let refused: string | null = null
      let reply = ''
      let handle: ApiSessionHandle | null = null
      try {
        handle = deps.createSession(
          {
            sessionId: `voice-refine:${id}`,
            modelId: route.modelId,
            credential: route.credential,
            systemPrompt: prompt.system
          },
          {
            baseUrl: route.baseUrl,
            extraHeaders: route.extraHeaders,
            maxOutputTokens: outputTokenCap(original),
            maxWallClockMs: timeoutMs,
            // ⚠ WIRED (D157). The day-report summarizer at ipc.ts wires none and
            // meters nothing; that is the anti-pattern this task exists to not
            // repeat. Fires at most once, only when the provider reported usage.
            onUsage: (u) => {
              usage = u
            },
            // D63(g): a refusal arrives here, never as text through the stream.
            onRefusal: (r) => {
              refused = r
            }
          }
        )
        await handle.send(prompt.user)
        for await (const chunk of handle.receive()) reply += chunk
      } catch (err) {
        // `send`/`receive` refuse rather than throw by contract; a throw here
        // is a bug in the transport or the handle, and it is still a transport
        // failure from the dictation's point of view — the original is used.
        logger.error({ mode, err }, '[voice] refinement transport threw')
        record({ id, req, route, startedAt, usage, outcome: 'failed' })
        return fallbackOutcome(original, mode, 'transport')
      } finally {
        // ⚠ DISPOSED ON EVERY PATH — success, refusal, timeout, throw. The
        // handle holds a live reader and the only reference to the credential
        // this call decrypted.
        try {
          await handle?.dispose()
        } catch (err) {
          logger.error({ err }, '[voice] refinement handle dispose failed')
        }
      }

      const durationMs = deps.now().getTime() - startedAt.getTime()

      if (refused !== null) {
        const fallback = classifyRefusal(refused)
        record({ id, req, route, startedAt, usage, outcome: 'failed' })
        logger.info(
          { mode, fallback, durationMs, tokensOut: (usage as TokenUsage | null)?.tokensOut ?? null },
          '[voice] refinement did not complete; original inserted'
        )
        return fallbackOutcome(original, mode, fallback)
      }

      const outcome = judgeReply(original, mode, reply)
      // A completed call is a completed run, even when the reply is rejected —
      // the spend is real and belongs to the ledger.
      record({ id, req, route, startedAt, usage, outcome: 'completed' })
      logger.info(
        {
          mode,
          refined: outcome.refined,
          fallback: outcome.fallback,
          failure: outcome.failure,
          durationMs,
          // ⚠ LENGTHS AND COUNTS, NEVER THE TEXT.
          originalChars: original.length,
          replyChars: reply.length,
          tokensIn: (usage as TokenUsage | null)?.tokensIn ?? null,
          tokensOut: (usage as TokenUsage | null)?.tokensOut ?? null,
          costUsd: (usage as TokenUsage | null)?.costUsd ?? null
        },
        outcome.refined ? '[voice] refinement applied' : '[voice] refinement rejected; original inserted'
      )
      return outcome
    }
  }
}

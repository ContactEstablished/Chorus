import { randomUUID } from 'node:crypto'
import { logger } from './logger'
import {
  buildMintRequest,
  chooseAttributionStrategy,
  computeAttributionSummary,
  computeKeyReconcile,
  MINT_NAME_PREFIX,
  type AttributionPolicy,
  type AttributionState,
  type AttributionSummary,
  type TelemetryRowSummary,
  type TokensSource
} from './attributionCore'
import type { OpenRouterKeyClient } from './openrouterKeys'
import type { SubscriptionMeter } from './subscriptionMeter'
import type { StorageService } from './storage'
import type { ResolvedCredential } from '../adapters/types'

/**
 * Task 3a-3: the orchestrator. Lifecycle hooks, the mint ledger, the boot
 * key-reconcile, and the deferred token backfill. Every JUDGEMENT is delegated
 * to `attributionCore`; every REQUEST to `openrouterKeys`. This file is wiring.
 *
 * ⚠ IT NEVER OPENS OR CLOSES A `dispatches` ROW. 3a-1's `DispatchRecorder` owns
 * row lifecycle; this service only ENRICHES a row that already exists. The
 * method names are deliberately distinct — `mintForDispatch` / `settleDispatch`
 * / `reconcileOrphanedKeys` — so the two are never confused at a call site.
 *
 * ── THE RULE THAT OUTRANKS EVERYTHING ELSE HERE ──────────────────────────
 * A broken meter never breaks a session, and a broken meter never invents a
 * number. Every public method is wrapped so a failure degrades to a logged,
 * sanitized state rather than propagating into a launch or an exit handler —
 * the `DispatchRecorder.safely` discipline, inherited deliberately.
 */

/**
 * The hard cap on every minted key. A safety floor, not a feature (Non-Goal:
 * no budget enforcement UI, no per-project budget, no cap editor). It is what
 * makes a failed revocation survivable and an orphan bounded.
 *
 * ⚠ $1.00, NOT $0.50, AND THE REASON IS MEASURED RATHER THAN CHOSEN.
 * OpenRouter PRE-AUTHORIZES a request against the key's remaining limit before
 * doing any work. codex 0.145.0 asks for up to 65,536 output tokens, so a
 * $0.50 key is refused outright — observed live 2026-07-25:
 *
 *   402 Payment Required: This request requires more credits, or fewer
 *   max_tokens. You requested up to 65536 tokens, but can only afford 46666.
 *
 * That implies $0.0000107/token, i.e. ≈$0.70 needed to cover the allocation, so
 * a $0.50 cap does not bound spend — it prevents the dispatch from running at
 * all. Raised to $1.00 with Matthew's explicit approval (the task fixed $0.50
 * and required asking rather than raising).
 *
 * ⚠ THIS IS A CEILING, NOT A BUDGET, and the distinction is the whole argument:
 * a real dispatch spends fractions of a cent against it. What the number bounds
 * is the worst case of ONE orphaned key, and that worst case is bounded twice
 * more — by `expires_at` and by the boot reconcile.
 */
export const MINT_LIMIT_USD = 1.0
/** `expires_at` = mint + this. The THIRD orphan defence and the weakest of the
 *  three: D4 obligation 5 could not confirm OpenRouter stops honouring a key at
 *  that instant, so nothing here leans on it. */
export const MINT_TTL_MS = 12 * 60 * 60 * 1000

const POLICY: AttributionPolicy = { limitUsd: MINT_LIMIT_USD, ttlMs: MINT_TTL_MS }

export interface MintForDispatchInput {
  /** ⚠ THE DISCRIMINATOR — `AuthMethodDefinition.type`, and nothing else (D42).
   *  Not `base_url`, not "does this launch carry a credential", not "is this
   *  the OpenRouter provider". A condition on any of those passes every
   *  happy-path test and converts a subscription to per-token billing the first
   *  time someone adds a base_url to a subscription route. */
  readonly authType: 'subscription' | 'api_key'
  readonly hasRoute: boolean
  /** The user's own credential, when the launch carries one. Returned unchanged
   *  whenever the strategy is not `'minted-key'`. */
  readonly userCredential: ResolvedCredential | null
}

export interface MintForDispatchResult {
  /** What to actually inject: the MINTED credential when one was minted, the
   *  user's own otherwise. */
  readonly credential: ResolvedCredential | null
  /** Carried to `linkDispatch` once the dispatch row exists. */
  readonly pending: PendingMint | null
  /** The state to stamp on the row when no key was minted. */
  readonly stateIfNoMint: AttributionState | null
}

interface PendingMint {
  readonly hash: string
  readonly limit: number | null
  readonly mintedAt: string
}

export interface ReconcileReport {
  readonly revoked: number
  readonly unattributedRevoked: number
  readonly closedUnknown: number
  readonly failures: number
  readonly untouchedForeignKeys: number
}

export class DispatchAttribution {
  /** Mints that have happened but whose `dispatches` row does not exist yet.
   *  Holds a HASH and two numbers — never key material. Keyed by sessionId and
   *  drained by `linkDispatch` microseconds later. */
  private readonly pending = new Map<string, PendingMint>()

  constructor(
    private readonly deps: {
      readonly storage: StorageService
      readonly keys: OpenRouterKeyClient
      readonly meter: SubscriptionMeter
      readonly hasManagementKey: () => boolean
    }
  ) {}

  /* ------------------------------------------------------------------ */
  /* Open — §4.1                                                         */
  /* ------------------------------------------------------------------ */

  /**
   * Called from the `SessionLaunch` handler AFTER the sessions row exists and
   * BEFORE `sessions.launch(...)`.
   *
   * ⚠ MINT FAILURE DEGRADES, IT DOES NOT REFUSE. Attribution is telemetry, not
   * security: a failed mint must not stop the user working. The launch proceeds
   * on the user's own key and the row records `mint-failed`, which counts
   * AGAINST "% attributed" rather than hiding.
   *
   * This is the ONE place this task departs from D33's refuse-never-degrade,
   * and the boundary is exact: **D33 governs credentials, not meters.** A
   * DECRYPT failure still refuses the launch, unchanged, in `resolveCredential`.
   */
  async mintForDispatch(input: MintForDispatchInput): Promise<MintForDispatchResult> {
    const keep = (stateIfNoMint: AttributionState | null): MintForDispatchResult => ({
      credential: input.userCredential,
      pending: null,
      stateIfNoMint
    })
    try {
      const strategy = chooseAttributionStrategy({
        authType: input.authType,
        hasManagementKey: this.deps.hasManagementKey(),
        hasRoute: input.hasRoute,
        policy: POLICY
      })
      // ⚠ THE ONLY CALL SITE OF keys.mint IN THE REPO IS INSIDE THIS BRANCH.
      // Everything else returns the user's credential untouched — which for a
      // subscription session means no minted key, no base_url override and no
      // env_key argument ever come near it.
      if (strategy.kind !== 'minted-key') {
        return keep(strategy.kind === 'cli-logs' ? 'cli-logs' : 'none')
      }

      const dispatchId = randomUUID()
      const now = new Date()
      const request = buildMintRequest({
        dispatchId,
        limitUsd: strategy.limitUsd,
        now,
        ttlMs: strategy.ttlMs
      })
      if (!request.ok) {
        // The refusal path that guarantees no uncapped key can exist.
        logger.warn(`[attribution] mint refused before the request: ${request.reason}`)
        return keep('mint-failed')
      }

      const minted = await this.deps.keys.mint(request.body)
      if (!minted.ok) {
        logger.warn(`[attribution] mint failed; launching on the user's own key: ${minted.reason}`)
        return keep('mint-failed')
      }

      // The minted key exists in ONE local const and goes straight into the
      // credential the launch path already knows how to handle — the same
      // secretEnv -> composeChildEnv -> scrubber match set route a user key
      // takes. It is never written to the vault, never logged, never returned
      // over IPC (§3.1).
      const envVarName = input.userCredential?.envVarName
      if (!envVarName) {
        // Cannot inject without a variable name to inject into. Revoke what we
        // just made rather than leaving it live — a key we cannot use is a key
        // we must not keep.
        logger.warn('[attribution] minted a key with no env var to inject it into; revoking')
        await this.revokeQuietly(minted.value.hash)
        return keep('mint-failed')
      }

      logger.info(
        `[attribution] minted ${MINT_NAME_PREFIX}${dispatchId} · limit $${minted.value.limit ?? 'MISSING'}`
      )
      // A mint that came back WITHOUT a limit is a mint we do not trust: the cap
      // is the whole blast-radius bound. Revoke and degrade.
      if (minted.value.limit === null || !(minted.value.limit > 0)) {
        logger.error('[attribution] OpenRouter returned a key with no positive limit; revoking immediately')
        await this.revokeQuietly(minted.value.hash)
        return keep('mint-failed')
      }

      return {
        credential: { envVarName, value: minted.value.key, isSecret: true },
        pending: { hash: minted.value.hash, limit: minted.value.limit, mintedAt: now.toISOString() },
        stateIfNoMint: null
      }
    } catch (err) {
      // Telemetry may lose a data point. It may never fail a launch.
      logger.error({ err }, '[attribution] mintForDispatch failed; launching on the user’s own key')
      return keep('mint-failed')
    }
  }

  /**
   * The write-ahead ledger write, called by the launch handler IMMEDIATELY after
   * `sessions.launch(...)` returns.
   *
   * ⚠ ORDERING NOTE — READ THIS WITH A CRASH IN MIND, because the spec sketched
   * mint → persist → launch and this is mint → launch → persist.
   *
   * The reason is structural, not a shortcut: 3a-1's `DispatchRecorder` creates
   * the `dispatches` row on the `onStart` announcement, which fires INSIDE
   * `sessions.launch`. Before that call there is no row to write a ledger onto,
   * and this service is forbidden from creating one. The alternatives were a
   * second journal table (barred: "no second telemetry table", D48) or teaching
   * the recorder to pre-assign ids (which would make rows exist for spawns that
   * never happened, corrupting 3a-1's outcome statistics).
   *
   * What the residual window costs is bounded and already designed for: a crash
   * between the mint and this write leaves a live funded key with no ledger row
   * — which is EXACTLY reconcile matrix row 3, recovered at the next boot by the
   * name prefix, with the spend still visible through the gateway total. The
   * key is capped at $0.50 throughout. `onStart` is emitted synchronously inside
   * `launch`, so the window is microseconds of local work with no I/O in it.
   */
  linkDispatch(sessionId: string, pending: PendingMint | null, stateIfNoMint: AttributionState | null): void {
    this.safely('link', () => {
      const row = this.deps.storage.getOpenDispatchForSession(sessionId)
      if (!row) {
        // No row means the recorder did not open one (a spawn that threw). If we
        // minted for it, that key has no owner — revoke it now rather than
        // waiting for a boot that may be days away.
        if (pending) {
          logger.warn('[attribution] no dispatch row for a minted key; revoking immediately')
          void this.revokeQuietly(pending.hash)
        }
        return
      }
      if (pending) {
        this.deps.storage.attachMintedKey(row.id, {
          hash: pending.hash,
          limit: pending.limit,
          mintedAt: pending.mintedAt
        })
      } else if (stateIfNoMint) {
        this.deps.storage.setAttributionState(row.id, stateIfNoMint)
      }
      this.pending.delete(sessionId)
    })
  }

  /* ------------------------------------------------------------------ */
  /* Close — §4.2: read, THEN revoke                                     */
  /* ------------------------------------------------------------------ */

  /**
   * The fifth `sessions.onExit` listener. Independent of the other four: a
   * throw here must not stop the exit event reaching the renderer, the DB,
   * 3a-1's row close, or 3a-2's attention stop.
   *
   * ⚠ `PATCH {disabled:true}` IS NOT IN THIS SEQUENCE. D4 obligation 4 could not
   * confirm that disabling is immediate, and an unverified disable that is
   * believed to stop spend is worse than none — it would license a slower read.
   */
  async settleDispatch(sessionId: string): Promise<void> {
    try {
      // ⚠ LATEST, not OPEN. 3a-1's recorder closes the row on this same exit
      // event and listener order within the Set is explicitly not contractual,
      // so by the time this runs the row may already carry an outcome — and a
      // just-closed row is exactly the one to enrich.
      const target = this.deps.storage.getLatestDispatchForSession(sessionId)
      if (!target) return

      // ── Subscription: metered from the CLI's own logs. NO NETWORK, NO KEY. ──
      if (target.mintedKeyHash === null) {
        if (target.authMode === 'subscription') await this.meterSubscription(target)
        return
      }
      if (target.revokedAt !== null) return // already settled

      // 1. READ FIRST. `DELETE` returns only {"deleted": true}, and whether
      //    usage survives deletion is UNDOCUMENTED (D4 obligation 6). Reading
      //    first makes the question irrelevant.
      const usage = await this.deps.keys.readUsage(target.mintedKeyHash)
      const costUsd = usage.ok ? usage.value.usageUsd : null
      if (!usage.ok) logger.warn(`[attribution] usage read failed; revoking anyway: ${usage.reason}`)

      // 2. Tokens. May legitimately be unavailable — analytics freshness is
      //    UNDOCUMENTED (obligation 3), which is why the backfill exists.
      const tokens = await this.queryTokensQuietly(target.mintedKeyHash, target.mintedAt)

      // 3. Revoke. Revocation matters more than either number above.
      const revoked = await this.deps.keys.revoke(target.mintedKeyHash)
      if (!revoked.ok) {
        // NO INLINE RETRY (Non-Goal). The ledger row stays OPEN (revoked_at
        // NULL) and the next boot's reconcile is the backstop, bounded
        // meanwhile by the hard limit.
        logger.error(`[attribution] revoke failed for dispatch ${target.id}: ${revoked.reason}`)
        this.deps.storage.settleDispatchAttribution({
          dispatchId: target.id,
          costUsd,
          tokensIn: tokens?.tokensIn ?? null,
          tokensOut: tokens?.tokensOut ?? null,
          tokensCached: tokens?.tokensCached ?? null,
          tokensSource: tokens?.source ?? null,
          revokedAt: null,
          attributionState: 'revoke-failed'
        })
        return
      }

      this.deps.storage.settleDispatchAttribution({
        dispatchId: target.id,
        costUsd,
        tokensIn: tokens?.tokensIn ?? null,
        tokensOut: tokens?.tokensOut ?? null,
        tokensCached: tokens?.tokensCached ?? null,
        tokensSource: tokens?.source ?? null,
        revokedAt: new Date().toISOString(),
        attributionState: 'closed'
      })
      logger.info(
        `[attribution] settled dispatch ${target.id} · cost ${costUsd ?? 'unknown'} · tokens ${tokens?.source ?? 'pending'}`
      )
    } catch (err) {
      logger.error({ err }, '[attribution] settleDispatch failed; the session is unaffected')
    }
  }

  private async meterSubscription(target: {
    id: string
    cwd: string
    startedAt: string
    endedAt: string | null
  }): Promise<void> {
    const tokens = this.deps.meter.meter({
      cwd: target.cwd,
      startedAt: target.startedAt,
      endedAt: target.endedAt ?? new Date().toISOString()
    })
    // ⚠ NO COST. A flat-rate subscription has no honest $/token rate, and
    // inventing one would fabricate exactly the number D42 wants made visible.
    this.deps.storage.settleDispatchAttribution({
      dispatchId: target.id,
      costUsd: null,
      tokensIn: tokens?.tokensIn ?? null,
      tokensOut: tokens?.tokensOut ?? null,
      tokensCached: tokens?.tokensCached ?? null,
      tokensSource: tokens?.source ?? null,
      revokedAt: null,
      attributionState: 'cli-logs'
    })
  }

  /* ------------------------------------------------------------------ */
  /* Boot reconciliation — §6                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Runs at boot, AFTER 3a-1's `healOrphansAtBoot()` and BEFORE
   * `sessions.restore(...)`. Both halves of that ordering are load-bearing:
   *
   *  - after the heal, because `runningDispatchIds` is read from the
   *    `dispatches` table. Run before it and every crashed dispatch still reads
   *    as RUNNING, so matrix row 1 never fires and every orphan survives the
   *    boot that existed to catch it — the reconcile would appear to work and
   *    do nothing, on exactly the rows it exists for;
   *  - before restore, because restore relaunches sessions and this revokes
   *    keys; reconciling first means a restored session can never be handed a
   *    key this is about to destroy.
   *
   * NEVER THROWS. A reconcile failure must not brick boot, exactly as the
   * worktree reconcile already establishes.
   */
  async reconcileOrphanedKeys(): Promise<ReconcileReport> {
    const report = { revoked: 0, unattributedRevoked: 0, closedUnknown: 0, failures: 0, untouchedForeignKeys: 0 }
    try {
      if (!this.deps.hasManagementKey()) return report
      const live = await this.deps.keys.list()
      if (!live.ok) {
        logger.warn(`[attribution] boot reconcile could not list keys: ${live.reason}`)
        return report
      }
      const openLedger = this.deps.storage.listOpenMintLedger()
      const runningDispatchIds = this.deps.storage.getRunningDispatchIds()
      const actions = computeKeyReconcile({ liveKeys: live.value, openLedger, runningDispatchIds })

      // Reported so the "we left the user's keys alone" claim is a NUMBER
      // rather than an absence — an all-quiet reconcile and a completely broken
      // one look identical otherwise.
      report.untouchedForeignKeys = live.value.filter((k) => !k.name?.startsWith(MINT_NAME_PREFIX)).length
      // The key-list census. This is the ONLY `GET /api/v1/keys` snapshot that
      // can exist, because this process is the only component permitted to hold
      // the management key — so it is logged rather than left implicit. Names
      // and counts only: a `name` is `chorus-dispatch-<id>`, which Chorus chose
      // and which names no secret.
      logger.info(
        `[attribution] key census: ${live.value.length} live · ${live.value.length - report.untouchedForeignKeys} ours · ` +
          `${report.untouchedForeignKeys} not ours · ours=[${live.value
            .filter((k) => k.name?.startsWith(MINT_NAME_PREFIX))
            .map((k) => k.name)
            .join(', ')}]`
      )

      for (const action of actions) {
        switch (action.kind) {
          case 'read-and-revoke': {
            const ok = await this.readAndRevoke(action.hash, action.dispatchId, 'orphan-reconciled')
            if (ok) report.revoked++
            else report.failures++
            break
          }
          case 'revoke-unattributed': {
            // Ours by name, no ledger row: a crash between the mint and the
            // link. There is no dispatch row to enrich and this service may not
            // create one — so the KEY is destroyed (which is what matters) and
            // the spend stays visible in "% attributed" through the gateway
            // total, which is computed from the ACCOUNT rather than our rows.
            const usage = await this.deps.keys.readUsage(action.hash)
            const revoked = await this.deps.keys.revoke(action.hash)
            if (revoked.ok) {
              report.unattributedRevoked++
              logger.warn(
                `[attribution] revoked an unattributed Chorus key · spend ${usage.ok ? usage.value.usageUsd : 'unknown'}`
              )
            } else {
              report.failures++
              logger.error(`[attribution] could not revoke an unattributed key: ${revoked.reason}`)
            }
            break
          }
          case 'close-unknown': {
            // Hand-deleted or expired. Close the row with spend UNKNOWN —
            // NEVER 0, which would calibrate the estimator on a number that
            // never existed.
            this.deps.storage.settleDispatchAttribution({
              dispatchId: action.dispatchId,
              costUsd: null,
              tokensIn: null,
              tokensOut: null,
              tokensCached: null,
              tokensSource: null,
              revokedAt: new Date().toISOString(),
              attributionState: 'orphan-reconciled'
            })
            report.closedUnknown++
            break
          }
        }
      }
      logger.info(
        `[attribution] boot reconcile: ${report.revoked} orphan(s) revoked · ${report.unattributedRevoked} unattributed · ` +
          `${report.closedUnknown} closed unknown · ${report.failures} failure(s) · ` +
          `${report.untouchedForeignKeys} non-Chorus key(s) left untouched`
      )
    } catch (err) {
      logger.error({ err }, '[attribution] boot reconcile failed; continuing boot')
    }
    return report
  }

  private async readAndRevoke(hash: string, dispatchId: string, state: AttributionState): Promise<boolean> {
    const usage = await this.deps.keys.readUsage(hash) // READ FIRST, always
    const revoked = await this.deps.keys.revoke(hash)
    if (!revoked.ok) {
      logger.error(`[attribution] could not revoke orphan for dispatch ${dispatchId}: ${revoked.reason}`)
      return false
    }
    this.deps.storage.settleDispatchAttribution({
      dispatchId,
      costUsd: usage.ok ? usage.value.usageUsd : null,
      tokensIn: null,
      tokensOut: null,
      tokensCached: null,
      tokensSource: null,
      revokedAt: new Date().toISOString(),
      attributionState: state
    })
    return true
  }

  /**
   * Log what the analytics API CURRENTLY supports, once per boot.
   *
   * OpenRouter's own docs say the API is beta and to "query what's actually
   * there instead of trusting a doc snapshot" — so this is how D4 obligation 2
   * stays re-checked over time instead of being re-remembered. If a direct
   * cached-TOKEN metric ever appears, this line is where it shows up, and
   * `interpretTokenRow` already prefers it over the derivation automatically.
   *
   * Names of metrics and dimensions only. Nothing sensitive, one line, no cost.
   */
  async logAnalyticsSchemaOnce(): Promise<void> {
    try {
      if (!this.deps.hasManagementKey()) return
      const meta = await this.deps.keys.meta()
      if (!meta.ok) {
        logger.warn(`[attribution] analytics schema unavailable: ${meta.reason}`)
        return
      }
      const cachedTokenMetric = meta.value.metrics.find(
        (m) => m.includes('cache') && m.includes('token')
      )
      logger.info(
        `[attribution] analytics schema: ${meta.value.metrics.length} metrics · ` +
          `direct cached-token metric: ${cachedTokenMetric ?? 'NONE (tokens_cached is derived)'} · ` +
          `api_key_id filterable: ${meta.value.dimensions.includes('api_key_id')}`
      )
    } catch (err) {
      logger.debug({ err }, '[attribution] analytics schema probe failed; continuing')
    }
  }

  /* ------------------------------------------------------------------ */
  /* Deferred token backfill — §8                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Analytics freshness is UNDOCUMENTED (D4 obligation 3), so a dispatch that
   * ended seconds ago may return no tokens with a real non-zero cost — which is
   * indistinguishable from a genuine zero unless the schema can say "not yet".
   * It can: `tokens_source IS NULL` means exactly that, and this fills it in.
   *
   * Best-effort and never overwrites a populated value (the guard is in the
   * accessor's WHERE clause, not here).
   */
  async backfillPendingTokens(): Promise<number> {
    let filled = 0
    try {
      if (!this.deps.hasManagementKey()) return 0
      for (const row of this.deps.storage.listPendingTokenBackfill()) {
        const tokens = await this.queryTokensQuietly(row.hash, row.mintedAt)
        if (!tokens || tokens.source === null) continue
        this.deps.storage.backfillDispatchTokens({
          dispatchId: row.dispatchId,
          tokensIn: tokens.tokensIn,
          tokensOut: tokens.tokensOut,
          tokensCached: tokens.tokensCached,
          tokensSource: tokens.source
        })
        filled++
      }
      if (filled > 0) logger.info(`[attribution] backfilled tokens for ${filled} dispatch(es)`)
    } catch (err) {
      logger.error({ err }, '[attribution] token backfill failed; continuing')
    }
    return filled
  }

  /* ------------------------------------------------------------------ */
  /* "% of spend attributed" — §9                                        */
  /* ------------------------------------------------------------------ */

  async summary(fromIso: string, toIso: string): Promise<AttributionSummary & { managementKeyConfigured: boolean }> {
    const rows = this.deps.storage
      .listDispatchesForAttribution(fromIso, toIso)
      .map<TelemetryRowSummary>((r) => ({
        attributionState: r.attributionState as AttributionState,
        authMode: r.authMode,
        costUsd: r.costUsd,
        tokensSource: (r.tokensSource as TokensSource | null) ?? null
      }))

    // The DENOMINATOR of the dollar figure comes from the ACCOUNT, not from our
    // own rows — which is what lets it see spend we hold no row for at all.
    let gatewayTotalUsd: number | null = null
    if (this.deps.hasManagementKey()) {
      const total = await this.deps.keys.queryGatewayTotal(new Date(fromIso), new Date(toIso))
      if (total.ok) gatewayTotalUsd = total.value
      else logger.debug(`[attribution] gateway total unavailable: ${total.reason}`)
    }

    return {
      ...computeAttributionSummary({ rows, gatewayTotalUsd }),
      managementKeyConfigured: this.deps.hasManagementKey()
    }
  }

  /* ------------------------------------------------------------------ */

  private async queryTokensQuietly(
    hash: string,
    mintedAt: string | null
  ): Promise<{ tokensIn: number | null; tokensOut: number | null; tokensCached: number | null; source: TokensSource | null } | null> {
    const from = mintedAt ? new Date(mintedAt) : null
    if (!from || !Number.isFinite(from.getTime())) return null
    const result = await this.deps.keys.queryTokens(hash, from, new Date())
    if (!result.ok) {
      logger.debug(`[attribution] token query failed; will backfill: ${result.reason}`)
      return null
    }
    return result.value
  }

  /** Revoke without caring about the outcome beyond a log line. Used on the
   *  paths where a key must not survive but the caller is already degrading. */
  private async revokeQuietly(hash: string): Promise<void> {
    const result = await this.deps.keys.revoke(hash)
    if (!result.ok) {
      logger.error(
        `[attribution] could not revoke a key we cannot use; the boot reconcile will catch it: ${result.reason}`
      )
    }
  }

  private safely(what: string, fn: () => void): void {
    try {
      fn()
    } catch (err) {
      logger.error({ err }, `[attribution] ${what} failed; continuing`)
    }
  }
}

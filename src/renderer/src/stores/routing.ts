import { defineStore } from 'pinia'
import type {
  RoutingCredential, RoutingErrorCode, RoutingModelList, RoutingObservationSettings, RoutingProfileId,
  RoutingProgressEvent, RoutingRefreshResult, RoutingReply, RoutingSettings, RoutingStatus, TierResult
} from '../../../shared/routing'
import { ROUTING_INSPECTOR_EFFORT, defaultRefreshCredential, type RefreshPhase } from '../../../shared/routingView'

/**
 * Model Routing Task 3-2: the routing inspector's renderer store
 * (ImplementationSpec-3-2, Table RS). Talks to `window.chorus.routing` only.
 *
 * - Every renderer-to-main argument is a `plainRoutingInput` snapshot or the
 *   literal `{}` (D14, MR-G5). Replies are never parsed here; main is the
 *   authority (C13).
 * - No action throws or rejects to its caller; failures land in state with
 *   their code (C14).
 * - Nothing here starts a timer, refreshes on load, or calls `flashSaved()`
 *   (K3, K9): the view decides when to refresh and when to flash.
 */

export interface RoutingFailureInfo { code: RoutingErrorCode; message: string }

/** D14, MR-G5: a JSON snapshot. Pinia state is a Proxy (nested objects too); structured clone rejects it. */
export function plainRoutingInput<T>(input: T): T { return JSON.parse(JSON.stringify(input)) as T }

/** K4, C14: unlike teamValue, the code survives. */
export class RoutingReplyError extends Error {
  constructor(readonly code: RoutingErrorCode, message: string) { super(message); this.name = 'RoutingReplyError' }
}
export function routingValue<T>(reply: RoutingReply<T>): T {
  if (!reply.ok) throw new RoutingReplyError(reply.code, reply.message)
  return reply.value
}
/** A RoutingReplyError keeps its code; an Error (a bridge rejection) is OPERATION_FAILED with its own message; anything else the fixed one. */
export function routingFailure(err: unknown): RoutingFailureInfo {
  if (err instanceof RoutingReplyError) return { code: err.code, message: err.message }
  if (err instanceof Error && err.message !== '') return { code: 'OPERATION_FAILED', message: err.message }
  return { code: 'OPERATION_FAILED', message: 'Routing operation failed.' }
}

export interface RoutingRefreshState {
  phase: RefreshPhase
  model: string | null
  refreshId: string | null
  events: RoutingProgressEvent[]
  result: RoutingRefreshResult | null
  error: RoutingFailureInfo | null
  endedAtMs: number | null // C12: set only when the refresh reached the network
}

function idleRefresh(): RoutingRefreshState {
  return { phase: 'idle', model: null, refreshId: null, events: [], result: null, error: null, endedAtMs: null }
}

// Module scope, as stores/team.ts: one progress subscription shared by every consumer.
let unsubscribe: (() => void) | null = null
let consumers = 0
/** Orders `loadTiers` responses: only the latest request may write `tiers`. */
let tiersSeq = 0

export const useRoutingStore = defineStore('routing', {
  state: () => ({
    loaded: false,
    loading: false,
    loadError: null as RoutingFailureInfo | null,
    models: [] as RoutingModelList['models'],
    credentials: [] as RoutingCredential[],
    settings: null as RoutingSettings | null,
    observation: null as RoutingObservationSettings | null,
    status: null as RoutingStatus | null,
    model: null as string | null,
    profile: 'interactive' as RoutingProfileId,
    /** The "Refresh with" choice (K5). */
    credentialProfileId: null as string | null,
    tiers: null as TierResult | null,
    tiersError: null as RoutingFailureInfo | null,
    refresh: idleRefresh(),
    saving: false,
    actionError: null as RoutingFailureInfo | null
  }),
  actions: {
    /** Reference-counted progress subscription (team.ts). The release is idempotent. */
    connect(): () => void {
      consumers++
      if (!unsubscribe) unsubscribe = window.chorus.routing.onProgress((event) => this.ingestProgress(event))
      let released = false
      return () => { if (released) return; released = true; if (--consumers === 0) { unsubscribe?.(); unsubscribe = null } }
    },

    /**
     * K4: progress is broadcast to every window. Adopt only while our own
     * refresh runs, only for its model, and bind the first id seen
     * (stores/council.ts); events with another id are someone else's.
     */
    ingestProgress(event: RoutingProgressEvent): void {
      const refresh = this.refresh
      if (refresh.phase !== 'running' || event.model !== refresh.model) return
      if (refresh.refreshId === null) refresh.refreshId = event.refreshId
      else if (event.refreshId !== refresh.refreshId) return
      refresh.events.push(event)
    },

    async load(): Promise<void> {
      this.loading = true
      this.loadError = null
      let models: RoutingModelList, credentials: RoutingCredential[], settings: RoutingSettings
      let observation: RoutingObservationSettings, status: RoutingStatus
      try {
        const api = window.chorus.routing
        const replies = await Promise.all([api.models({}), api.credentials({}), api.settingsGet({}), api.observationGet({}), api.status({})])
        models = routingValue(replies[0])
        credentials = routingValue(replies[1]).credentials
        settings = routingValue(replies[2])
        observation = routingValue(replies[3])
        status = routingValue(replies[4])
      } catch (err) {
        this.loadError = routingFailure(err)
        this.loading = false
        return
      }
      this.models = models.models
      this.credentials = credentials
      this.settings = settings
      this.observation = observation
      this.status = status
      if (this.model === null || !models.models.some((m) => m.slug === this.model)) this.model = models.models[0]?.slug ?? null
      if (this.credentialProfileId === null || !credentials.some((c) => c.id === this.credentialProfileId)) {
        this.credentialProfileId = defaultRefreshCredential(credentials, observation)
      }
      this.loaded = true
      this.loading = false
      await this.loadTiers()
    },

    /** Free (no network). A response that is no longer the latest request is dropped. */
    async loadTiers(): Promise<void> {
      const seq = ++tiersSeq
      if (this.model === null) {
        this.tiers = null
        this.tiersError = null
        return
      }
      try {
        const value = routingValue(
          await window.chorus.routing.tiers(
            plainRoutingInput({ model: this.model, profile: this.profile, effort: ROUTING_INSPECTOR_EFFORT, credentialProfileId: this.credentialProfileId })
          )
        )
        if (seq !== tiersSeq) return
        this.tiers = value
        this.tiersError = null
      } catch (err) {
        if (seq !== tiersSeq) return
        this.tiers = null
        this.tiersError = routingFailure(err) // NO_SNAPSHOT is the view's no-snapshot state, not an error
      }
    },

    /** A failure leaves `status` as it was. */
    async loadStatus(): Promise<void> {
      try {
        this.status = routingValue(await window.chorus.routing.status({}))
      } catch {
        // Keep the last status.
      }
    },

    async selectModel(slug: string): Promise<void> {
      this.model = slug
      await this.loadTiers()
    },

    async selectProfile(profile: RoutingProfileId): Promise<void> {
      this.profile = profile
      await this.loadTiers()
    },

    async selectCredential(id: string | null): Promise<void> {
      this.credentialProfileId = id
      await this.loadTiers()
    },

    /**
     * K3, K5, C12: an explicit refresh with the "Refresh with" credential.
     * The countdown (`endedAtMs`) starts only when the refresh reached the
     * network: an ok reply, or at least one adopted event before a failure.
     */
    async startRefresh(): Promise<void> {
      if (this.refresh.phase === 'running' || this.model === null || this.credentialProfileId === null) return
      const model = this.model
      const credentialProfileId = this.credentialProfileId
      this.refresh = { phase: 'running', model, refreshId: null, events: [], result: null, error: null, endedAtMs: null }
      try {
        const result = routingValue(
          await window.chorus.routing.refresh(plainRoutingInput({ model, credentialProfileId, profile: this.profile, effort: ROUTING_INSPECTOR_EFFORT }))
        )
        const refresh = this.refresh
        refresh.refreshId = result.refreshId
        refresh.events = refresh.events.filter((e) => e.refreshId === result.refreshId)
        refresh.result = result
        refresh.phase = 'done'
        refresh.endedAtMs = Date.now()
      } catch (err) {
        const refresh = this.refresh
        refresh.error = routingFailure(err)
        refresh.phase = 'failed'
        refresh.endedAtMs = refresh.events.length > 0 ? Date.now() : null
      }
      await Promise.all([this.loadTiers(), this.loadStatus()])
    },

    /** MR-D24: read-modify-write of the whole settings object, from a fresh read, flipping only `dataCollection`. */
    async setDataCollection(value: RoutingSettings['dataCollection']): Promise<boolean> {
      if (this.saving) return false
      this.saving = true
      this.actionError = null
      try {
        const api = window.chorus.routing
        const current = routingValue(await api.settingsGet({}))
        const stored = routingValue(await api.settingsSet(plainRoutingInput({ settings: { ...current, dataCollection: value } })))
        this.settings = stored
        this.saving = false
      } catch (err) {
        this.actionError = routingFailure(err)
        this.saving = false
        return false
      }
      await this.loadTiers()
      return true
    },

    /** MR-D23, C11: turning observation off always clears the designation. */
    async setObservation(enabled: boolean, credentialProfileId: string | null): Promise<boolean> {
      if (this.saving) return false
      this.saving = true
      this.actionError = null
      let ok = false
      try {
        const api = window.chorus.routing
        const input: RoutingObservationSettings = enabled ? { enabled: true, credentialProfileId } : { enabled: false, credentialProfileId: null }
        this.observation = routingValue(await api.observationSet(plainRoutingInput(input)))
        ok = true
      } catch (err) {
        this.actionError = routingFailure(err)
        try {
          this.observation = routingValue(await window.chorus.routing.observationGet({}))
        } catch {
          // Best effort: keep the last known observation settings.
        }
      }
      this.saving = false
      await this.loadStatus()
      return ok
    }
  }
})

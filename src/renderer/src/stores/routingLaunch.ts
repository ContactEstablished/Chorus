import { defineStore } from 'pinia'
import type {
  RoutingCredential, RoutingLaunchPreferences, RoutingModelList, RoutingProgressEvent, RoutingSettings, TierResult
} from '../../../shared/routing'
import { ROUTING_LAUNCH_PROFILE } from '../../../shared/routingView'
import { plainRoutingInput, routingFailure, routingValue, type RoutingFailureInfo, type RoutingRefreshState } from './routing'

/**
 * Model Routing Task 4a-4: the launch dialog's routing store
 * (ImplementationSpec-4a-4, Table LS). Talks to `window.chorus.routing` only.
 *
 * ⚠ NOT THE SETTINGS STORE. `stores/routing.ts` is the inspector's singleton,
 * ranking at its fixed effort for the profile the user picked there. A launch
 * ranks for `interactive`, at the launch's own effort, with the launch's own
 * credential (K4), so this store has its own state, its own progress
 * subscription and its own request counters. It imports that module's helper
 * functions, never its state.
 *
 * - Every renderer-to-main argument is a `plainRoutingInput` snapshot or the
 *   literal `{}` (D14, MR-G5). Replies are never parsed here (Phase 3 C13).
 * - No action throws or rejects to its caller; failures land in state.
 * - Nothing here starts a timer or refreshes on its own (MR-D26): `rank` is
 *   free, and `startRefresh` runs only when the dialog's Refresh is clicked.
 * - Nothing here writes: main records the remembered choice after a launch (K8).
 */

/** K4: what one launch ranks with. The credential is the launch's own (MR-D19, MR-D20). */
export interface RoutingLaunchRankInput { model: string; effort: string | null; credentialProfileId: string }

function idleRefresh(): RoutingRefreshState {
  return { phase: 'idle', model: null, refreshId: null, events: [], result: null, error: null, endedAtMs: null }
}

// This module's own subscription and counters (never the Settings store's).
let unsubscribe: (() => void) | null = null
let consumers = 0
/** Orders `rank` replies: only the latest request (or clear) may write `tiers`. */
let tiersSeq = 0
/** Orders `load` replies: a reply from before the latest `reset()` is dropped. */
let loadSeq = 0

export const useRoutingLaunchStore = defineStore('routing-launch', {
  state: () => ({
    loaded: false,
    loading: false,
    loadError: null as RoutingFailureInfo | null,
    models: [] as RoutingModelList['models'],
    credentials: [] as RoutingCredential[],
    settings: null as RoutingSettings | null,
    preferences: null as RoutingLaunchPreferences | null,
    input: null as RoutingLaunchRankInput | null,
    tiers: null as TierResult | null,
    tiersError: null as RoutingFailureInfo | null,
    tiersLoading: false,
    refresh: idleRefresh()
  }),
  actions: {
    /** Reference-counted, as stores/routing.ts, on this module's variables. The release is idempotent. */
    connect(): () => void {
      consumers++
      if (!unsubscribe) {
        try {
          unsubscribe = window.chorus.routing.onProgress((event) => this.ingestProgress(event))
        } catch {
          unsubscribe = null // no bridge: nothing to subscribe to, and nothing escapes to the caller
        }
      }
      let released = false
      return () => {
        if (released) return
        released = true
        if (--consumers === 0) {
          unsubscribe?.()
          unsubscribe = null
        }
      }
    },

    /** Progress is broadcast to every window: adopt only our running refresh's model, binding the first id seen. */
    ingestProgress(event: RoutingProgressEvent): void {
      const refresh = this.refresh
      if (refresh.phase !== 'running' || event.model !== refresh.model) return
      if (refresh.refreshId === null) refresh.refreshId = event.refreshId
      else if (event.refreshId !== refresh.refreshId) return
      refresh.events.push(event)
    },

    /**
     * C30: one per dialog open. Every field returns to its initial value except
     * `refresh`, so a reopened dialog keeps its own countdown (Phase 3 C12) and
     * an in-flight refresh still lands; late `load` and `rank` replies are dropped.
     */
    reset(): void {
      ++loadSeq
      ++tiersSeq
      this.loaded = false
      this.loading = false
      this.loadError = null
      this.models = []
      this.credentials = []
      this.settings = null
      this.preferences = null
      this.input = null
      this.tiers = null
      this.tiersError = null
      this.tiersLoading = false
    },

    /** The four free reads; the first failure in request order wins. It never ranks. */
    async load(): Promise<void> {
      if (this.loading) return
      const seq = ++loadSeq
      this.loading = true
      this.loadError = null
      let models: RoutingModelList['models'], credentials: RoutingCredential[]
      let settings: RoutingSettings, preferences: RoutingLaunchPreferences
      try {
        const api = window.chorus.routing
        const replies = await Promise.all([api.models({}), api.credentials({}), api.settingsGet({}), api.launchPreferences({})])
        models = routingValue(replies[0]).models
        credentials = routingValue(replies[1]).credentials
        settings = routingValue(replies[2])
        preferences = routingValue(replies[3])
      } catch (err) {
        if (seq !== loadSeq) return
        this.loadError = routingFailure(err)
        this.loading = false
        return
      }
      if (seq !== loadSeq) return
      this.models = models
      this.credentials = credentials
      this.settings = settings
      this.preferences = preferences
      this.loaded = true
      this.loading = false
    },

    /** K4: free (no network). A reply that is no longer the latest request is dropped. */
    async rank(input: RoutingLaunchRankInput): Promise<void> {
      const seq = ++tiersSeq
      const { model, effort, credentialProfileId } = input
      this.input = { model, effort, credentialProfileId }
      this.tiersLoading = true
      try {
        const value = routingValue(
          await window.chorus.routing.tiers(plainRoutingInput({ model, profile: ROUTING_LAUNCH_PROFILE, effort, credentialProfileId }))
        )
        if (seq !== tiersSeq) return
        this.tiers = value
        this.tiersError = null
      } catch (err) {
        if (seq !== tiersSeq) return
        this.tiers = null
        this.tiersError = routingFailure(err) // NO_SNAPSHOT is the view's no-snapshot state, not an error
      }
      this.tiersLoading = false
    },

    /** The launch is not routable (or no longer): forget the ranking and drop any pending reply. */
    clearTiers(): void {
      ++tiersSeq
      this.input = null
      this.tiers = null
      this.tiersError = null
      this.tiersLoading = false
    },

    /**
     * MR-D19, MR-D26: an explicit refresh with the launch's credential and
     * effort, then a free re-rank. The countdown (`endedAtMs`) starts only when
     * the refresh reached the network (Phase 3 C12). A cooldown BUSY means the
     * numbers were just refreshed: main's message (which names the seconds left)
     * stays in `refresh.error` and the re-rank shows the fresh numbers (C32).
     */
    async startRefresh(): Promise<void> {
      if (this.refresh.phase === 'running' || this.input === null) return
      const { model, effort, credentialProfileId } = this.input
      this.refresh = { phase: 'running', model, refreshId: null, events: [], result: null, error: null, endedAtMs: null }
      try {
        const result = routingValue(
          await window.chorus.routing.refresh(plainRoutingInput({ model, credentialProfileId, profile: ROUTING_LAUNCH_PROFILE, effort }))
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
      if (this.input !== null) await this.rank(this.input)
    }
  }
})

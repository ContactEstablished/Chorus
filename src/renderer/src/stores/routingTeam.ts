import { defineStore } from 'pinia'
import type { RoutingCredential, RoutingModelList, RoutingSettings, TierResult } from '../../../shared/routing'
import { ROUTING_HELPER_PROFILE } from '../../../shared/routingView'
import { plainRoutingInput, routingFailure, routingValue, type RoutingFailureInfo } from './routing'

/**
 * Model Routing Task 4b-3: the Team dialog's routing store (ImplementationSpec-4b-3, Table HS).
 * Talks to `window.chorus.routing` only, and only to its free reads.
 *
 * ⚠ NOT THE SETTINGS STORE AND NOT THE LAUNCH STORE. A Team dialog ranks one
 * input per helper slot (K5): the helper profile, the slot's own credential and
 * effort. It has no progress subscription, no refresh (K11, Q2), no timer and
 * no write. It imports `stores/routing.ts`'s helper functions, never its state.
 *
 * - Every renderer-to-main argument is a `plainRoutingInput` snapshot or the
 *   literal `{}` (D14, MR-G5). Replies are never parsed here (Phase 3 C13).
 * - No action throws or rejects to its caller; failures land in state.
 */

/** K5: what one helper slot ranks with: the base registry slug, the member's own effort and credential. */
export interface RoutingTeamRankInput { model: string; effort: string | null; credentialProfileId: string }
/** One ranking's state. `loading` while the request is in flight; `tiers` or `error` once it answered. */
export interface RoutingTeamResult { input: RoutingTeamRankInput; loading: boolean; tiers: TierResult | null; error: RoutingFailureInfo | null }

/** C11: one ranking per distinct (credential, base model, effort); slots that share it share the answer. */
export function routingTeamKey(input: RoutingTeamRankInput): string {
  return `${input.credentialProfileId}|${input.model}|${input.effort ?? ''}`
}

// This module's own counters (never another routing store's).
/** Orders `load` replies: a reply from before the latest `reset()` is dropped. */
let loadSeq = 0
/** Orders `rank` replies per key: only the latest request for a key may write that key. */
let rankSeq = 0
const latestRank = new Map<string, number>()

export const useRoutingTeamStore = defineStore('routing-team', {
  state: () => ({
    loaded: false,
    loading: false,
    loadError: null as RoutingFailureInfo | null,
    models: [] as RoutingModelList['models'],
    credentials: [] as RoutingCredential[],
    settings: null as RoutingSettings | null,
    results: {} as Record<string, RoutingTeamResult>
  }),
  actions: {
    /** C11: one per dialog open. Every field returns to its initial value; late `load` and `rank` replies are dropped. */
    reset(): void {
      ++loadSeq
      latestRank.clear()
      this.loaded = false
      this.loading = false
      this.loadError = null
      this.models = []
      this.credentials = []
      this.settings = null
      this.results = {}
    },

    /** The three free reads; the first failure in request order wins. It never ranks. */
    async load(): Promise<void> {
      if (this.loading) return
      const seq = ++loadSeq
      this.loading = true
      this.loadError = null
      let models: RoutingModelList['models'], credentials: RoutingCredential[], settings: RoutingSettings
      try {
        const api = window.chorus.routing
        const replies = await Promise.all([api.models({}), api.credentials({}), api.settingsGet({})])
        models = routingValue(replies[0]).models
        credentials = routingValue(replies[1]).credentials
        settings = routingValue(replies[2])
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
      this.loaded = true
      this.loading = false
    },

    /**
     * K5, K11: free (no network). The key's entry is set to loading BEFORE the
     * first await, so a second slot with the same key in the same pass sees it.
     * A reply that is no longer the latest request for its key is dropped.
     */
    async rank(input: RoutingTeamRankInput): Promise<void> {
      const { model, effort, credentialProfileId } = input
      const key = routingTeamKey({ model, effort, credentialProfileId })
      const seq = ++rankSeq
      latestRank.set(key, seq)
      this.results[key] = { input: { model, effort, credentialProfileId }, loading: true, tiers: null, error: null }
      try {
        const value = routingValue(
          await window.chorus.routing.tiers(plainRoutingInput({ model, profile: ROUTING_HELPER_PROFILE, effort, credentialProfileId }))
        )
        if (latestRank.get(key) !== seq) return
        this.results[key] = { input: { model, effort, credentialProfileId }, loading: false, tiers: value, error: null }
      } catch (err) {
        if (latestRank.get(key) !== seq) return
        // NO_SNAPSHOT is the view's no-snapshot state, not an error.
        this.results[key] = { input: { model, effort, credentialProfileId }, loading: false, tiers: null, error: routingFailure(err) }
      }
    }
  }
})

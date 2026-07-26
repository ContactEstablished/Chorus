import { defineStore } from 'pinia'
import type {
  AdapterDescriptor,
  CredentialProfileMetaWire,
  ModelListResponse,
  ProviderConfig,
  ProviderCreateRequest,
  ProviderUpdateRequest
} from '../../../shared/ipc'

interface SettingsState {
  providers: ProviderConfig[]
  profiles: CredentialProfileMetaWire[]
  adapters: AdapterDescriptor[]
  /** Task 3a-4: the cached model list per provider, exactly as main sent it —
   *  including the `freshness` MAIN computed. The renderer stores no
   *  threshold and does no date arithmetic. */
  modelsByProvider: Record<string, ModelListResponse>
  loading: boolean
  /** Providers with a refresh in flight, so one card's spinner cannot be
   *  cleared by another card's response. */
  refreshingProviderIds: string[]
  /** The latest mutation refusal or load failure, renderable verbatim. */
  error: string | null
  /** Store-level supersede token (the view.ts::loadSeq pattern): a component-
   *  level token cannot cancel an await already running INSIDE the store. */
  loadSeq: number
  /** ⚠ PER-PROVIDER supersede tokens, NOT the global `loadSeq`, and the
   *  difference is a bug rather than a style choice: two providers can be
   *  refreshed independently, so a single global token would let provider B's
   *  response cancel provider A's still-valid load. The global token is the
   *  wrong shape here and choosing it silently is the failure. */
  modelSeqByProvider: Record<string, number>
}

/**
 * Settings store (Task 3-4 / D29): providers, credential profile metadata,
 * and the static adapter descriptors the forms render from. Modeled on
 * view.ts — flat lists that mirror the wire; grouping is presentation.
 *
 * There is NO `key` field in this state, and there never will be. D33
 * clause 3 is write-only inbound IPC: a plaintext key travels as an action
 * PARAMETER, crosses the bridge once, and is never assigned to state. Pinia
 * state is devtools-inspectable — a key placed here would be readable by
 * anyone with the window open, which is exactly the exposure clause 3 exists
 * to prevent. The unit test deep-scans $state to keep this true.
 */
export const useSettingsStore = defineStore('settings', {
  state: (): SettingsState => ({
    providers: [],
    profiles: [],
    adapters: [],
    modelsByProvider: {},
    loading: false,
    refreshingProviderIds: [],
    error: null,
    loadSeq: 0,
    modelSeqByProvider: {}
  }),
  actions: {
    /** Record a refusal/failure reason and hand it back verbatim so the
     *  caller can render it inline next to the originating form. */
    refuse(reason: string): string {
      this.error = reason
      return reason
    },

    async load(): Promise<void> {
      const seq = ++this.loadSeq
      this.loading = true
      try {
        const [providers, profiles, adapters] = await Promise.all([
          window.chorus.listProviders(),
          window.chorus.listCredentials(),
          window.chorus.listAdapters()
        ])
        if (seq !== this.loadSeq) return // superseded — drop the whole result
        this.providers = providers
        this.profiles = profiles
        this.adapters = adapters
      } catch (e) {
        if (seq !== this.loadSeq) return
        this.error = e instanceof Error ? e.message : String(e)
      } finally {
        // Guarded: an UNGUARDED `loading = false` lets a stale load clear a
        // live one's spinner (spec §2's trap).
        if (seq === this.loadSeq) this.loading = false
      }
    },

    /* Mutations. Each returns null on success or the refusal reason VERBATIM
     * (mirrored into `error`) — components render it inline and must never
     * enrich it with form values (spec §4.3). A successful mutation triggers
     * exactly one reload; a failed one leaves the lists untouched.
     *
     * D14: callers build `input` from component-local refs of primitives, so
     * the spread below is already a plain object. If any field ever becomes
     * store-sourced it must be snapshotted (JSON.parse(JSON.stringify(...)))
     * before crossing the bridge — structured clone failures throw at runtime
     * with no compile-time signal. */

    async createProvider(input: ProviderCreateRequest): Promise<string | null> {
      try {
        const res = await window.chorus.createProvider({ ...input })
        if (!res.ok) return this.refuse(res.reason)
        this.error = null
        await this.load()
        return null
      } catch (e) {
        return this.refuse(e instanceof Error ? e.message : String(e))
      }
    },

    async updateProvider(input: ProviderUpdateRequest): Promise<string | null> {
      try {
        const res = await window.chorus.updateProvider({ ...input })
        if (!res.ok) return this.refuse(res.reason)
        this.error = null
        await this.load()
        return null
      } catch (e) {
        return this.refuse(e instanceof Error ? e.message : String(e))
      }
    },

    async deleteProvider(providerId: string): Promise<string | null> {
      try {
        const res = await window.chorus.deleteProvider(providerId)
        if (!res.ok) return this.refuse(res.reason)
        this.error = null
        await this.load()
        return null
      } catch (e) {
        return this.refuse(e instanceof Error ? e.message : String(e))
      }
    },

    /** The plaintext key arrives as a PARAMETER and is passed straight
     *  through — never assigned to state, never logged, never interpolated. */
    async createProfile(input: {
      providerId: string
      label: string
      key: string
    }): Promise<string | null> {
      try {
        const res = await window.chorus.createCredential({ ...input })
        if (!res.ok) return this.refuse(res.reason)
        this.error = null
        await this.load()
        return null
      } catch (e) {
        return this.refuse(e instanceof Error ? e.message : String(e))
      }
    },

    /** Replace is the ONLY way to change a stored key — there is no read
     *  path, so "forgot which key" means "re-enter it" (D33 clause 3). A
     *  successful replace also clears an unavailable mark (F-5a). */
    async replaceProfile(profileId: string, key: string): Promise<string | null> {
      try {
        const res = await window.chorus.replaceCredential({ id: profileId, key })
        if (!res.ok) return this.refuse(res.reason)
        this.error = null
        await this.load()
        return null
      } catch (e) {
        return this.refuse(e instanceof Error ? e.message : String(e))
      }
    },

    /** Task 3-6 (spec §7): ONE live auth probe, fired only by the Test-key
     *  button — never from boot, a timer, launch, or profile creation
     *  ("at your request" is load-bearing). Success refreshes
     *  lastVerifiedAt via the reload; failure returns main's sanitized
     *  reason verbatim. No key-shaped state is involved. */
    async testProfile(profileId: string): Promise<string | null> {
      try {
        const res = await window.chorus.testCredential(profileId)
        if (!res.ok) return this.refuse(res.reason)
        this.error = null
        await this.load()
        return null
      } catch (e) {
        return this.refuse(e instanceof Error ? e.message : String(e))
      }
    },

    async deleteProfile(profileId: string): Promise<string | null> {
      try {
        const res = await window.chorus.deleteCredential(profileId)
        if (!res.ok) return this.refuse(res.reason)
        this.error = null
        await this.load()
        return null
      } catch (e) {
        return this.refuse(e instanceof Error ? e.message : String(e))
      }
    },

    /* ---- Task 3a-4: the model catalog ------------------------------------
     *
     * ⚠ NEITHER ACTION EVER TOUCHES A PROVIDER'S `model` FIELD. The catalog is
     * a list of what exists; the route's default model is edited only through
     * the provider form's free-text input, by the user. A "helpful" clear of a
     * model the refresh reported missing is the exact convenience this task
     * exists to refuse.
     *
     * The store still holds NO KEY. `refreshModels` passes a CREDENTIAL ID —
     * key material has no path into this state and the deep-scan unit test on
     * $state keeps that honest. */

    /** PURE READ of the cache. Safe to call on mount: it makes no network
     *  call and decrypts nothing. */
    async loadModels(providerId: string): Promise<string | null> {
      const seq = (this.modelSeqByProvider[providerId] ?? 0) + 1
      this.modelSeqByProvider[providerId] = seq
      try {
        const res = await window.chorus.listModels(providerId)
        // Per-provider guard: a superseded load for THIS provider is dropped,
        // and another provider's traffic cannot cancel it.
        if (seq !== this.modelSeqByProvider[providerId]) return null
        this.modelsByProvider[providerId] = res
        return null
      } catch (e) {
        if (seq !== this.modelSeqByProvider[providerId]) return null
        return this.refuse(e instanceof Error ? e.message : String(e))
      }
    },

    /**
     * ⚠ ONE LIVE CALL, AND IT HAPPENS ONLY BECAUSE THE USER PRESSED REFRESH.
     * There is no watcher, no onMounted, no timer and no post-create hook that
     * reaches this action — a convenience call at Settings-open would send the
     * user's key without them asking, which is exactly what D33 resolution
     * (d)'s carve-out is narrow about.
     *
     * `credentialId` is null for the unauthenticated path, which is a shipped
     * behaviour: a user can populate a catalog before storing any key.
     */
    async refreshModels(providerId: string, credentialId: string | null): Promise<string | null> {
      if (this.refreshingProviderIds.includes(providerId)) return null
      this.refreshingProviderIds = [...this.refreshingProviderIds, providerId]
      try {
        const res = await window.chorus.refreshModels(providerId, credentialId)
        if (!res.ok) return this.refuse(res.reason) // verbatim from main
        this.error = null
        // Re-read the cache rather than reconstructing it from the counts —
        // main is the authority on what actually landed.
        await this.loadModels(providerId)
        return null
      } catch (e) {
        return this.refuse(e instanceof Error ? e.message : String(e))
      } finally {
        this.refreshingProviderIds = this.refreshingProviderIds.filter((id) => id !== providerId)
      }
    }
  }
})

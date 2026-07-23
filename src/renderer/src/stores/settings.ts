import { defineStore } from 'pinia'
import type {
  AdapterDescriptor,
  CredentialProfileMetaWire,
  ProviderConfig,
  ProviderCreateRequest,
  ProviderUpdateRequest
} from '../../../shared/ipc'

interface SettingsState {
  providers: ProviderConfig[]
  profiles: CredentialProfileMetaWire[]
  adapters: AdapterDescriptor[]
  loading: boolean
  /** The latest mutation refusal or load failure, renderable verbatim. */
  error: string | null
  /** Store-level supersede token (the view.ts::loadSeq pattern): a component-
   *  level token cannot cancel an await already running INSIDE the store. */
  loadSeq: number
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
    loading: false,
    error: null,
    loadSeq: 0
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
    }
  }
})

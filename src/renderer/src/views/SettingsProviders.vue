<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  MANAGEMENT_AUTH_MODE,
  type CouncilMemberWire,
  type ModelCatalogEntry,
  type ProviderConfig
} from '../../../shared/ipc'
import { useSettingsStore } from '../stores/settings'
import ModelCombobox from '../components/ModelCombobox.vue'
import SettingsCredentials from './SettingsCredentials.vue'

/**
 * Providers content region (Task 3-4, spec §5; D38 grouped layout): one card
 * per provider with its credential rows nested inside — grouping is a
 * computed over the store's flat wire lists and mirrors the
 * provider_configs -> credential_profiles FK exactly. Provider create/edit
 * lives in a single inline form (create mode or edit mode); delete is the
 * WorktreePanel inline-confirm idiom with main's structured refusal rendered
 * inline (main is the authority — the renderer never pre-disables by
 * counting profiles, which could be stale).
 */
const settings = useSettingsStore()

/* ---- provider form (one instance, create or edit mode) ---- */
const formOpen = ref(false)
const editingId = ref<string | null>(null)
const fName = ref('')
const fAdapterId = ref('')
const fAuthMode = ref('')
const fEnvVar = ref('')
const fBaseUrl = ref('')
const fModel = ref('')
const formBusy = ref(false)
const formError = ref<string | null>(null)

/* ---- delete confirm (one card at a time) ---- */
const deleteConfirmId = ref<string | null>(null)
const deleteBusy = ref(false)
const deleteError = ref<string | null>(null)

/** profiles grouped by providerId — presentation only; the store stays flat. */
const profilesByProvider = computed(() => {
  const map = new Map<string, typeof settings.profiles>()
  for (const p of settings.profiles) {
    const list = map.get(p.providerId) ?? []
    list.push(p)
    map.set(p.providerId, list)
  }
  return map
})

const selectedAdapter = computed(
  () => settings.adapters.find((a) => a.id === fAdapterId.value) ?? null
)
const adapterAuthMethods = computed(() => selectedAdapter.value?.authMethods ?? [])

/**
 * Task 3a-3 (D42's operational note): the ACCOUNT-LEVEL credential class.
 *
 * ⚠ THIS IS NOT AN ADAPTER AUTH METHOD, AND THAT IS THE WHOLE POINT. It is
 * appended here, from the shared IPC constant, rather than declared by
 * `claude.ts`/`codex.ts` — because widening `AuthMethodDefinition.type` would
 * make "Management key" appear in the LAUNCH picker as a way to run an agent.
 * That is semantically false (OpenRouter refuses management keys at the
 * completion endpoints) and it would push the highest-privilege credential in
 * the app toward the one path this task exists to keep it away from.
 *
 * Two guards keep it out of a launch, and neither lives in this file:
 *  - `LaunchDialog.vue` filters `auth_mode === 'api_key'`, so a management row
 *    is invisible to the picker for free;
 *  - `resolveCredential` in MAIN refuses it outright, before the decrypt —
 *    because main never trusts the renderer, and a filter here is not an
 *    invariant.
 */
const MANAGEMENT_METHOD = {
  type: MANAGEMENT_AUTH_MODE,
  label: 'OpenRouter management key (account-level — cannot launch an agent)',
  requiredEnvVar: null
} as const

const authMethods = computed(() => [...adapterAuthMethods.value, MANAGEMENT_METHOD])

/* ---- management routes: last, and shut ---------------------------------
 *
 * A management key mints and revokes the per-dispatch keys that meter spend.
 * It is the highest-privilege credential in the app and the one route that can
 * never launch anything — so it has no business sitting in the middle of the
 * list, open, looking exactly like the routes you use every day.
 *
 * Two cheap protections, both presentational (main's refusals are the real
 * guards — see MANAGEMENT_METHOD above): it sorts to the BOTTOM, and its card
 * renders SHUT until you deliberately open it.
 */
function isManagement(provider: ProviderConfig): boolean {
  return provider.auth_mode === MANAGEMENT_AUTH_MODE
}

/** Working routes first, management routes last; original order preserved
 *  inside each group (a stable partition, not a sort — `providers` is ordered
 *  by main and that order still means something). */
const orderedProviders = computed(() => [
  ...settings.providers.filter((p) => !isManagement(p)),
  ...settings.providers.filter(isManagement)
])

/** Which management cards the user has opened THIS VISIT. Deliberately not
 *  persisted: "collapsed" is a protection, and a protection that remembers
 *  being switched off is not one. Every trip to settings starts shut. */
const openedManagement = ref<Record<string, boolean>>({})

function isCardOpen(provider: ProviderConfig): boolean {
  return !isManagement(provider) || openedManagement.value[provider.id] === true
}

function toggleCard(provider: ProviderConfig): void {
  if (!isManagement(provider)) return
  openedManagement.value[provider.id] = !openedManagement.value[provider.id]
}

/**
 * The eyebrow that opens a run of cards, or null mid-run. Emitted from inside
 * the single `v-for` rather than by splitting the loop in two — the card body
 * is ~180 lines of markup and duplicating it to get two headings is how the
 * two copies start to drift.
 */
function groupHeadingFor(index: number): { label: string; note: string } | null {
  const provider = orderedProviders.value[index]
  const prev = index > 0 ? orderedProviders.value[index - 1] : null
  if (prev !== null && isManagement(prev) === isManagement(provider)) return null
  return isManagement(provider)
    ? { label: 'PROTECTED', note: 'account-level · mints and revokes keys · cannot launch an agent' }
    : { label: 'PROVIDERS', note: 'routes an agent can launch through' }
}
const selectedAuthMethod = computed(
  () => authMethods.value.find((m) => m.type === fAuthMode.value) ?? null
)
const managementSelected = computed(() => fAuthMode.value === MANAGEMENT_AUTH_MODE)

/** Everything the selects render comes from adapter:list — no hardcoded
 *  adapter names, auth modes, or env-var strings in this file. */
function adapterLabel(provider: ProviderConfig): string {
  return (
    settings.adapters.find((a) => a.id === provider.adapter_type)?.displayName ??
    provider.adapter_type
  )
}
function authLabel(provider: ProviderConfig): string {
  // 3a-3: the account-level class is not on any adapter, so it is resolved
  // first — otherwise a management row would render the bare column value.
  if (provider.auth_mode === MANAGEMENT_AUTH_MODE) return 'Management key · not launchable'
  const adapter = settings.adapters.find((a) => a.id === provider.adapter_type)
  return (
    adapter?.authMethods.find((m) => m.type === provider.auth_mode)?.label ?? provider.auth_mode
  )
}

/**
 * The mock's 18px provider tile carries a two-letter code (`an`, `oa`, `go`,
 * `or`). It is DERIVED from the provider's own name rather than looked up in a
 * table of known vendors: a table would have to answer "what tile does a
 * provider I have never heard of get", and D76 forbids rendering a placeholder.
 * The name is data the user typed, so an initialism of it invents nothing.
 */
function providerCode(provider: ProviderConfig): string {
  const letters = provider.name.replace(/[^A-Za-z0-9]/g, '')
  return (letters.slice(0, 2) || '··').toLowerCase()
}

/**
 * The card header's status chip. ⚠ EVERY BRANCH CARRIES ITS DENOMINATOR (D55)
 * — "1 unavailable" alone would leave the reader guessing whether the other
 * credentials are fine. The mock's chip says "2 keys active"; this says how
 * many of how many, which is the same sentence with the missing half restored.
 */
function credentialState(
  provider: ProviderConfig
): { tone: 'ok' | 'idle' | 'warn'; text: string } {
  const list = profilesByProvider.value.get(provider.id) ?? []
  if (list.length === 0) return { tone: 'idle', text: 'no credential stored' }
  const broken = list.filter((p) => p.unavailableSince).length
  if (broken > 0) {
    return { tone: 'warn', text: `${broken} of ${list.length} unavailable` }
  }
  const verified = list.filter((p) => p.lastVerifiedAt).length
  // ⚠ ZERO VERIFIED IS NOT A HEALTHY STATE, and the green tone would say it
  // was. Caught by looking at the running app: the management route reads
  // "0 of 1 verified" — true, and rendered in the same green as "1 of 1"
  // until this branch existed. The denominator was carrying the whole message
  // and the colour was contradicting it.
  return {
    tone: verified === 0 ? 'idle' : 'ok',
    text: `${verified} of ${list.length} verified`
  }
}

function openCreate(): void {
  formOpen.value = true
  editingId.value = null
  fName.value = ''
  fAdapterId.value = settings.adapters[0]?.id ?? ''
  fAuthMode.value = settings.adapters[0]?.authMethods[0]?.type ?? ''
  fEnvVar.value = ''
  fBaseUrl.value = ''
  fModel.value = ''
  formError.value = null
}

function openEdit(provider: ProviderConfig): void {
  formOpen.value = true
  editingId.value = provider.id
  fName.value = provider.name
  fAdapterId.value = provider.adapter_type
  fAuthMode.value = provider.auth_mode
  fEnvVar.value = provider.env_var_name ?? ''
  fBaseUrl.value = provider.base_url ?? ''
  fModel.value = provider.model ?? ''
  formError.value = null
  deleteConfirmId.value = null
}

function closeForm(): void {
  formOpen.value = false
  editingId.value = null
  formError.value = null
}

function onAdapterChange(): void {
  /**
   * An adapter switch invalidates the auth-mode choice ONLY IF the new adapter
   * cannot honour it. Keep a still-valid mode; fall back to the new adapter's
   * first declared method otherwise.
   *
   * ⚠ WHY THIS IS NOT "default to the first method" ANY MORE (2026-07-28,
   * observed live). Every adapter declares `subscription` FIRST, so the old
   * line silently rewrote a working `api_key` route to `subscription` on any
   * adapter change — and the rewrite is invisible: the auth select just moves,
   * the form still saves, and the damage only shows up later as a credential
   * that is no longer eligible in the launch dialog (`eligibleProfiles` filters
   * on `auth_mode === 'api_key'`). It bit the very first real use: repointing
   * `OpenRouter (route only)` from `none` to `opencode` turned a key-bearing
   * route into a subscription one, which is the exact opposite of the intent.
   *
   * `authMethods` (not `adapterAuthMethods`) is the right list to test against:
   * it includes MANAGEMENT_METHOD, which belongs to no adapter and must
   * therefore survive an adapter switch rather than being silently downgraded —
   * the management key is the highest-privilege credential in the app and
   * quietly relabelling it is the last thing this form should do.
   */
  const stillValid = authMethods.value.some((m) => m.type === fAuthMode.value)
  if (stillValid) return
  fAuthMode.value = selectedAdapter.value?.authMethods[0]?.type ?? ''
}

async function submitForm(): Promise<void> {
  if (!fName.value || !fAdapterId.value || !fAuthMode.value || formBusy.value) return
  formBusy.value = true
  formError.value = null
  try {
    // D14: fresh literals of primitives from component-local refs.
    // env_var_name is an OVERRIDE: empty means "use the adapter's default"
    // (create omits it; edit sends null to clear a previously set override).
    // base_url follows the same semantics: the route's OpenAI-compatible
    // endpoint (D47) — plaintext and documented non-secret (D33(e)).
    // model (D48) follows the same patch semantics: the route's DEFAULT
    // model id, hand-entered — there is deliberately NO list or fetch (a
    // model catalog is a hard non-goal).
    const reason =
      editingId.value === null
        ? await settings.createProvider({
            name: fName.value,
            adapter_type: fAdapterId.value,
            auth_mode: fAuthMode.value,
            ...(fEnvVar.value ? { env_var_name: fEnvVar.value } : {}),
            ...(fBaseUrl.value ? { base_url: fBaseUrl.value } : {}),
            ...(fModel.value ? { model: fModel.value } : {})
          })
        : await settings.updateProvider({
            id: editingId.value,
            name: fName.value,
            adapter_type: fAdapterId.value,
            auth_mode: fAuthMode.value,
            env_var_name: fEnvVar.value ? fEnvVar.value : null,
            base_url: fBaseUrl.value ? fBaseUrl.value : null,
            model: fModel.value ? fModel.value : null
          })
    if (reason !== null) {
      formError.value = reason // verbatim
      return
    }
    closeForm()
  } finally {
    formBusy.value = false
  }
}

function toggleDelete(id: string): void {
  deleteConfirmId.value = deleteConfirmId.value === id ? null : id
  deleteError.value = null
}

async function confirmDelete(id: string): Promise<void> {
  if (deleteBusy.value) return
  deleteBusy.value = true
  deleteError.value = null
  try {
    const reason = await settings.deleteProvider(id)
    if (reason !== null) {
      // 3-2's structured refusal (provider still has credential profiles) —
      // rendered inline, never thrown.
      deleteError.value = reason
      return
    }
    deleteConfirmId.value = null
  } finally {
    deleteBusy.value = false
  }
}

/* ---- Task 3a-4: the model catalog section -----------------------------
 *
 * ⚠ NOTHING HERE WRITES A PROVIDER'S `model`. The catalog is a LIST OF WHAT
 * EXISTS — it is not authoritative over the route's default, and a miss warns
 * rather than clearing, defaulting or substituting. The UI expression of that
 * ruling is the picker below: `fModel` STAYS A FREE-TEXT INPUT and the picker
 * is a <datalist> ATTACHED to it, never a closed <select>. A closed select
 * would make the catalog authoritative by UI construction, without anyone
 * deciding to — and it is the single most likely thing to be "cleaned up" by a
 * later contributor. */

/** Which credential each card's Refresh will send, per provider. */
const refreshCredential = ref<Record<string, string | null>>({})
/** Main's sanitized refusal for a card's last refresh, rendered verbatim. */
const refreshError = ref<Record<string, string | null>>({})

/**
 * PURE READ of the cache when the provider list changes. This calls
 * `loadModels` and NOTHING ELSE: `refreshModels` — the live, key-bearing call
 * — is reachable ONLY from the Refresh button's click handler. There is no
 * boot hook, no settings-open hook, no timer and no watcher that fires it,
 * because a convenience refresh here would send the user's key without them
 * asking.
 */
watch(
  () => settings.providers.map((p) => p.id).join(','),
  () => {
    for (const p of settings.providers) {
      void settings.loadModels(p.id)
      if (!(p.id in refreshCredential.value)) {
        const owned = profilesByProvider.value.get(p.id) ?? []
        // Exactly one profile -> that one. Zero OR several -> none, because
        // the unauthenticated path is a first-class shipped path and sending
        // a key nobody picked is the wrong default.
        refreshCredential.value[p.id] = owned.length === 1 ? owned[0].id : null
      }
    }
  },
  { immediate: true }
)

function catalogFor(providerId: string): ModelCatalogEntry[] {
  return settings.modelsByProvider[providerId]?.models ?? []
}

/** The three freshness states, straight from MAIN. The renderer stores no
 *  threshold and computes none — `freshness` is a fact it was handed. */
function freshnessOf(providerId: string): 'never' | 'fresh' | 'stale' {
  return settings.modelsByProvider[providerId]?.freshness ?? 'never'
}

/** Display-only relative age. This is PRESENTATION, not policy: it decides
 *  nothing — the fresh/stale call was already made in main. */
function ageLabel(providerId: string): string {
  const iso = settings.modelsByProvider[providerId]?.refreshedAt
  if (!iso) return ''
  const ms = Date.now() - Date.parse(iso)
  if (!Number.isFinite(ms) || ms < 0) return 'just now'
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

function isRefreshing(providerId: string): boolean {
  return settings.refreshingProviderIds.includes(providerId)
}

/** THE ONLY CALLER of the live refresh in this file, and it is a click. */
async function onRefresh(providerId: string): Promise<void> {
  refreshError.value[providerId] = null
  const reason = await settings.refreshModels(
    providerId,
    refreshCredential.value[providerId] ?? null
  )
  // Verbatim from main, NEVER enriched with form values (spec §4.3 — the
  // likeliest way a secret reaches the DOM, and it looks like helpful
  // diagnostics while you write it).
  refreshError.value[providerId] = reason
}

/**
 * ⚠ WORKED EXAMPLE 8 — the route's default model was catalogued and has since
 * disappeared. It still launches; this is a warning, not a gate.
 *
 * ⚠ AND WORKED EXAMPLE 11, WHICH IS EQUALLY LOAD-BEARING: a model the catalog
 * has NEVER SEEN produces NO warning. An id that was never catalogued is not
 * the same fact as one that disappeared — users legitimately name ids a
 * provider's list does not carry, and a warning that fires on the normal case
 * is a warning nobody reads.
 */
function missingRouteModel(provider: ProviderConfig): ModelCatalogEntry | null {
  if (!provider.model) return null
  const row = catalogFor(provider.id).find((m) => m.modelId === provider.model)
  if (!row || row.missingSince === null) return null
  return row
}

/** Worked example 12: the provider ANNOUNCED a retirement date, so the notice
 *  can fire BEFORE the model vanishes rather than after. Softer than the
 *  missing warning, and factual — the date is the provider's own. */
function expiringRouteModel(provider: ProviderConfig): ModelCatalogEntry | null {
  if (!provider.model) return null
  const row = catalogFor(provider.id).find((m) => m.modelId === provider.model)
  if (!row || row.expiresAt === null || row.missingSince !== null) return null
  return row
}

function shortDate(iso: string): string {
  return iso.slice(0, 10)
}

/* ---- D85 (Task 3d-2): the model SHORTLIST -----------------------------
 *
 * OpenRouter returns ~340 models. A launch picker built on that is not a
 * picker, so the user marks the handful they actually intend to use.
 *
 * ⚠ THE INPUT IS FREE TEXT WITH A <datalist>, NOT A <select>, FOR THE THIRD
 * TIME IN THIS FILE — and for the same reason as the other two (D48/D56). The
 * catalog is a list of what a provider SAID EXISTS; it is not a list of what
 * the user is allowed to want. An id the catalog has never returned must be
 * shortlistable, so the shortlist is stored with no foreign key onto
 * `model_catalog` (v12) and this input refuses to constrain itself to it.
 *
 * ⚠ AND NOTHING HERE CALLS `refreshModels`. Shortlisting is a local write; a
 * "helpful" refresh-on-open would send the user's key on a gesture that asked
 * for nothing of the sort. Same rule as the Refresh button above: the live
 * call has exactly one caller and it is a click.
 */

/** The pending free-text entry, per provider card. */
const shortlistDraft = ref<Record<string, string>>({})

/** Main's answer, never a local guess — the store replaces it wholesale from
 *  the write's response. */
function shortlistFor(providerId: string): string[] {
  return settings.modelsByProvider[providerId]?.shortlist ?? []
}

/** Catalog ids NOT already shortlisted — the datalist's suggestions. Missing
 *  ids are not offered for new selections, exactly as in the two pickers
 *  above; they still RENDER wherever they are already named. */
function shortlistSuggestions(providerId: string): ModelCatalogEntry[] {
  const chosen = new Set(shortlistFor(providerId))
  return catalogFor(providerId).filter((m) => m.missingSince === null && !chosen.has(m.modelId))
}

/** ⚠ A model on the shortlist that the last refresh did NOT return. This is
 *  shown rather than hidden: it is the user's own choice, and silently
 *  dropping it would be the catalog quietly overruling them. */
function shortlistedMissing(providerId: string): Set<string> {
  const known = new Set(
    catalogFor(providerId)
      .filter((m) => m.missingSince === null)
      .map((m) => m.modelId)
  )
  const seenAtAll = catalogFor(providerId).length > 0
  if (!seenAtAll) return new Set() // never refreshed — absence proves nothing
  return new Set(shortlistFor(providerId).filter((id) => !known.has(id)))
}

/**
 * Add to the shortlist. `explicit` is the id the combobox submitted (a picked
 * suggestion or Enter on raw text); without it, the draft field is used — the
 * Add button's path.
 *
 * ⚠ THE ARGUMENT EXISTS BECAUSE OF A RACE, not for tidiness. The combobox
 * emits `update:modelValue` and `submit` for the same gesture, and reading the
 * draft here would depend on the v-model write having landed first. Taking the
 * value the event carried makes picking a suggestion deterministic.
 */
async function addToShortlist(providerId: string, explicit?: string): Promise<void> {
  const id = (explicit ?? shortlistDraft.value[providerId] ?? '').trim()
  if (id === '') return
  const reason = await settings.setModelShortlisted(providerId, id, true)
  if (reason === null) shortlistDraft.value[providerId] = ''
}

async function removeFromShortlist(providerId: string, modelId: string): Promise<void> {
  await settings.setModelShortlisted(providerId, modelId, false)
}

/** The catalog for the provider currently being EDITED, which is the only one
 *  whose ids can meaningfully populate the form's picker (a provider being
 *  CREATED has no id and therefore no catalog yet). */
const pickableModels = computed<ModelCatalogEntry[]>(() => {
  if (editingId.value === null) return []
  // ⚠ Missing models are NOT offered for new selections. They still RENDER
  // (struck through, on the card) wherever they are already named.
  return catalogFor(editingId.value).filter((m) => m.missingSince === null)
})

/* ------------------------------------------------------------------ */
/* Task 3a-5 / D43: saved launch profiles — LIST, RENAME, DELETE only.  */
/* No board, no panel, no dashboard: the place you PICK one is the      */
/* launch dialog, and nothing here renders dispatch data or spend.      */
/* ------------------------------------------------------------------ */

const renamingProfileId = ref<string | null>(null)
const renameLabel = ref('')
const deletingProfileId = ref<string | null>(null)
const profileError = ref('')

void settings.loadLaunchProfiles()

function beginRename(id: string, current: string): void {
  renamingProfileId.value = id
  renameLabel.value = current
  profileError.value = ''
}

async function commitRename(): Promise<void> {
  if (renamingProfileId.value === null || renameLabel.value.trim() === '') return
  // ⚠ D43: this is a PURE UI EVENT. Nothing downstream is rewritten — every
  // reference stores the immutable id.
  const reason = await settings.renameLaunchProfile(renamingProfileId.value, renameLabel.value.trim())
  if (reason !== null) {
    profileError.value = reason
    return
  }
  renamingProfileId.value = null
  profileError.value = ''
}

async function confirmDeleteProfile(id: string): Promise<void> {
  const reason = await settings.deleteLaunchProfile(id)
  deletingProfileId.value = null
  profileError.value = reason ?? ''
}

/* ------------------------------------------------------------------ */
/* Task 3b-2 / D62: the council. WHO deliberates — list / create /      */
/* rename / delete, and nothing else.                                   */
/*                                                                      */
/* ⚠ NOTHING IN THIS SECTION RUNS A COUNCIL, MAKES AN API CALL OR       */
/* SPENDS A CENT. 3b-3 owns orchestration; 3b-4 owns the run view.      */
/*                                                                      */
/* ⚠ AND THERE IS DELIBERATELY NO "TEST THIS MEMBER" BUTTON. It would   */
/* be a live billable /chat/completions call, and D57 is the standing   */
/* warning about tests that cannot fail. If it is ever wanted, it        */
/* belongs where the transport lives, not on a configuration form.      */
/* ------------------------------------------------------------------ */

const councilFormOpen = ref(false)
const cLabel = ref('')
const cCredentialId = ref('')
const cModel = ref('')
const cRole = ref<'member' | 'arbiter'>('member')
const cParams = ref('')
const councilBusy = ref(false)
const councilFormError = ref('')
const councilError = ref('')
const renamingMemberId = ref<string | null>(null)
const renameMemberLabel = ref('')
const deletingMemberId = ref<string | null>(null)

void settings.loadCouncilMembers()

/**
 * ⚠ MANAGEMENT CREDENTIALS ARE NOT OFFERED, and the filter is NOT the
 * invariant. A management key is an ACCOUNT-LEVEL credential that mints and
 * revokes keys and cannot do inference (D42), so a member naming one could
 * never deliberate. This mirrors LaunchDialog.vue's `auth_mode === 'api_key'`
 * filter exactly — and, exactly as there, MAIN REFUSES IT ANYWAY, at create
 * (validateMemberShape) and again at resolve (resolveCouncilMember), because
 * main never trusts the renderer and `auth_mode` is an unconstrained TEXT
 * column that a hand-edited row can hold before any UI produces it. See D62:
 * 3a-5 shipped the version of this that trusted the filter.
 */
const councilCredentials = computed(() =>
  settings.profiles.filter((p) => {
    const provider = settings.providers.find((r) => r.id === p.providerId)
    return provider !== undefined && provider.auth_mode !== MANAGEMENT_AUTH_MODE
  })
)

/** How many were excluded — said out loud, so an empty picker is never a
 *  mystery. Hiding the fact would make a broken configuration invisible. */
const excludedManagementCount = computed(
  () => settings.profiles.length - councilCredentials.value.length
)

/**
 * Why `+ member` is disabled, or null when it is not.
 *
 * ⚠ THE GUARD ITSELF IS CORRECT AND STAYS. D62: a council member ALWAYS
 * authenticates — it names its route BY naming a credential — so with no
 * eligible credential there is nothing a member could be, and main refuses the
 * create anyway. What was wrong is that the button simply went dead: no title,
 * no sentence, nothing but a deny cursor to reason from.
 *
 * ⚠ AND THE MANAGEMENT-KEY CASE WAS WORSE THAN SILENT. Its explanation (the
 * `excludedManagementCount` hint below) lives INSIDE the create form — which is
 * exactly the door this guard closes. A user whose only stored credential was a
 * management key was told why by a sentence they could not reach.
 *
 * This is the file's own stated principle — "said out loud, so an empty picker
 * is never a mystery" — applied one level up, to the button that opens it.
 */
const councilBlockedReason = computed<string | null>(() => {
  if (councilCredentials.value.length > 0) return null
  if (excludedManagementCount.value > 0) {
    const s = excludedManagementCount.value === 1
    return `The ${s ? 'only stored credential is a management key' : `${excludedManagementCount.value} stored credentials are all management keys`} — a management key mints and revokes keys and cannot do inference, so no member can authenticate as one. Add an API-key credential to a route above.`
  }
  return 'No credentials stored yet. A council member authenticates as one, so add a credential to a route above (+ credential) before adding a member.'
})

function credentialRouteName(credentialProfileId: string): string {
  const profile = settings.profiles.find((p) => p.id === credentialProfileId)
  if (!profile) return ''
  return settings.providers.find((r) => r.id === profile.providerId)?.name ?? ''
}

/** The route's own default model, shown as a HINT beside a NULL model input so
 *  the user can see what an empty field will inherit (D56 rank 2). It is a
 *  placeholder and a sentence — it is NEVER copied into the field, because that
 *  is the back-write into rank 1 that D48 exists to prevent. */
const selectedRouteDefaultModel = computed<string | null>(() => {
  const profile = settings.profiles.find((p) => p.id === cCredentialId.value)
  if (!profile) return null
  return settings.providers.find((r) => r.id === profile.providerId)?.model ?? null
})

/**
 * ⚠ D56's THIRD ENFORCEMENT SITE. The catalog populates a <datalist> ATTACHED
 * to a FREE-TEXT input — it must never become a closed <select>. A dropdown
 * sourced from `model_catalog` would make the catalog AUTHORITATIVE BY UI
 * CONSTRUCTION, with nobody deciding to; a user has to be able to type an id
 * the catalog has never heard of. Missing ids are not offered for new
 * selections, exactly as in the provider form above.
 */
const councilPickableModels = computed<ModelCatalogEntry[]>(() => {
  const profile = settings.profiles.find((p) => p.id === cCredentialId.value)
  if (!profile) return []
  return catalogFor(profile.providerId).filter((m) => m.missingSince === null)
})

function openCouncilCreate(): void {
  councilFormOpen.value = true
  cLabel.value = ''
  cCredentialId.value = councilCredentials.value[0]?.id ?? ''
  cModel.value = ''
  cRole.value = 'member'
  cParams.value = ''
  councilFormError.value = ''
}

async function submitCouncilMember(): Promise<void> {
  if (!cLabel.value.trim() || !cCredentialId.value || councilBusy.value) return
  councilBusy.value = true
  councilFormError.value = ''
  try {
    // D14: fresh literals of primitives from component-local refs — no Pinia
    // object crosses the bridge.
    //
    // ⚠ AN EMPTY MODEL FIELD SENDS `null`, NOT THE ROUTE'S DEFAULT. NULL means
    // "inherit at read time" (D56 rank 2); substituting the route's model here
    // would write rank 2 into rank 1 and create D48's second home from the UI
    // side, which is the single most tempting "helpful" line in this file.
    const reason = await settings.createCouncilMember({
      label: cLabel.value.trim(),
      credentialProfileId: cCredentialId.value,
      model: cModel.value.trim() ? cModel.value.trim() : null,
      role: cRole.value,
      paramsJson: cParams.value.trim() ? cParams.value.trim() : null
    })
    if (reason !== null) {
      councilFormError.value = reason // verbatim from main, never enriched
      return
    }
    councilFormOpen.value = false
  } finally {
    councilBusy.value = false
  }
}

function beginRenameMember(id: string, current: string): void {
  renamingMemberId.value = id
  renameMemberLabel.value = current
  councilError.value = ''
}

async function commitRenameMember(): Promise<void> {
  if (renamingMemberId.value === null || renameMemberLabel.value.trim() === '') return
  // ⚠ D43: a PURE UI EVENT. Nothing downstream is rewritten — every transcript
  // row stores the member's immutable id.
  const reason = await settings.renameCouncilMember(
    renamingMemberId.value,
    renameMemberLabel.value.trim()
  )
  if (reason !== null) {
    councilError.value = reason
    return
  }
  renamingMemberId.value = null
  councilError.value = ''
}

async function confirmDeleteMember(id: string): Promise<void> {
  const reason = await settings.deleteCouncilMember(id)
  deletingMemberId.value = null
  councilError.value = reason ?? ''
}

/* ---- a member's parameters, after it exists ----------------------------
 *
 * Until this editor they were CREATE-ONLY, and the cost of that was measured on
 * 2026-08-06: a roster of three reasoning models inherited the old 1200-token
 * output default, spent the whole budget on reasoning, and returned nothing —
 * and the only way to change one number was to delete the member and rebuild
 * it, losing the name the user had given it.
 *
 * ⚠ THE JSON FIELD IS WRITE-ONLY, AND THAT IS NOT AN OVERSIGHT. Parameter
 * VALUES never cross the bridge (main sends `maxTokens` and `otherParamNames` —
 * a number and a list of names, neither able to carry a pasted key), so this
 * form cannot prefill them and does not pretend to. Blank means "leave them
 * alone"; main merges. `max_tokens` gets a field of its own because it is the
 * one parameter the transport actually sends.
 */
const editingParamsMemberId = ref<string | null>(null)
const editMaxTokens = ref('')
const editOtherParams = ref('')

function beginEditParams(m: CouncilMemberWire): void {
  editingParamsMemberId.value = m.id
  // The member's OWN value, or empty — which renders the role default as the
  // placeholder. Showing the default as a VALUE would write it into the row on
  // the next save, which is the rank-2-into-rank-1 mistake D56 forbids for
  // models, in the one other column that has a default behind it.
  editMaxTokens.value = m.maxTokens === null ? '' : String(m.maxTokens)
  editOtherParams.value = ''
  renamingMemberId.value = null
  councilError.value = ''
}

function cancelEditParams(): void {
  editingParamsMemberId.value = null
  councilError.value = ''
}

/** What the write-only field is standing in front of — NAMES, never values. */
function otherParamsPlaceholder(m: CouncilMemberWire): string {
  return m.otherParamNames.length === 0
    ? 'other parameters, as JSON — e.g. {"temperature": 0.2}'
    : `replace ${m.otherParamNames.join(', ')} — full JSON object`
}

async function commitEditParams(m: CouncilMemberWire): Promise<void> {
  const raw = editMaxTokens.value.trim()
  let maxTokens: number | null = null
  if (raw !== '') {
    // Refused HERE so the user reads a sentence. The wire schema takes an
    // integer, and a schema rejection at the bridge surfaces as an exception
    // with no advice in it.
    if (!/^[0-9]+$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
      councilError.value =
        'Max output tokens must be a whole number, or empty to use the default.'
      return
    }
    maxTokens = Number(raw)
  }
  // ⚠ ABSENT, NOT EMPTY-STRING, when untouched. `paramsJson: ''` would CLEAR
  // every other parameter this member holds — the exact silent loss this form
  // is built to avoid — while omitting the field leaves them alone.
  const others = editOtherParams.value.trim()
  const patch: { maxTokens: number | null; paramsJson?: string } =
    others === '' ? { maxTokens } : { maxTokens, paramsJson: others }
  const reason = await settings.setCouncilMemberParams(m.id, patch)
  if (reason !== null) {
    councilError.value = reason
    return
  }
  editingParamsMemberId.value = null
  councilError.value = ''
}
</script>

<template>
  <div class="set-page max-w-4xl">
    <div class="set-head">
      <h1 class="set-title">Providers &amp; keys</h1>
      <span class="set-subtitle">encrypted with Windows DPAPI · keys never leave this machine</span>
      <span class="flex-1"></span>
      <button v-if="!formOpen" class="set-pill set-pill-lg" @click="openCreate">+ provider</button>
    </div>

    <!-- provider create/edit form. ⚠ UNMOCKED — the mock draws no open form,
         so this is token-and-primitive conformance, not a screenshot diff. -->
    <div v-if="formOpen" class="set-card p-4">
      <h2 class="set-section-title">
        {{ editingId === null ? 'Add provider' : 'Edit provider' }}
      </h2>
      <div class="mt-3 grid grid-cols-2 gap-3">
        <label class="set-field-label">
          Name
          <input
            v-model="fName"
            maxlength="120"
            placeholder='e.g. "Anthropic"'
            class="set-input mt-1 w-full"
          />
        </label>
        <label class="set-field-label">
          Adapter
          <select v-model="fAdapterId" class="set-select mt-1 w-full" @change="onAdapterChange">
            <option v-for="a in settings.adapters" :key="a.id" :value="a.id">
              {{ a.displayName }}
            </option>
          </select>
        </label>
        <label class="set-field-label">
          Auth method
          <select v-model="fAuthMode" class="set-select mt-1 w-full">
            <option v-for="m in authMethods" :key="m.type" :value="m.type">{{ m.label }}</option>
          </select>
          <!-- 3a-3: the account-level class needs its two properties said out
               loud at the moment of choosing, because both are surprising:
               it never launches anything, and testing it fails BY DESIGN. -->
          <span v-if="managementSelected" class="set-hint-warn mt-1 block">
            Mints and revokes the short-lived per-dispatch keys that meter spend. It can never launch an
            agent, and “test” will fail by design — OpenRouter blocks management keys from the
            completion endpoints.
          </span>
        </label>
        <label class="set-field-label">
          Env var name <span class="set-hint">(optional override)</span>
          <!-- Empty input, adapter default as PLACEHOLDER (spec §5): pre-filling
               would persist a copy of today's default, so a later adapter
               correction would silently not apply to this provider. -->
          <input
            v-model="fEnvVar"
            :placeholder="selectedAuthMethod?.requiredEnvVar ?? 'adapter default'"
            maxlength="120"
            class="set-input mt-1 w-full"
          />
        </label>
        <label class="set-field-label">
          Base URL <span class="set-hint">(optional — OpenAI-compatible endpoint)</span>
          <!-- D47: the route's endpoint (e.g. https://openrouter.ai/api/v1 —
               no trailing slash). Plaintext, documented non-secret (D33(e)).
               Empty = the provider's native default endpoint. -->
          <input
            v-model="fBaseUrl"
            placeholder="https://openrouter.ai/api/v1"
            maxlength="2048"
            class="set-input mt-1 w-full"
          />
        </label>
        <label class="set-field-label">
          Default model <span class="set-hint">(optional)</span>
          <!-- D48: the ROUTE's default model — a default, not an authority.
               Task 3a-4 adds a catalog-sourced picker that is strictly
               ADDITIVE: this stays a FREE-TEXT input with a <datalist>
               attached, and must never become a closed <select>. A user has to
               be able to type an id the catalog has never heard of — a closed
               select would make the catalog authoritative by construction,
               which is precisely the ruling this task exists to write down. -->
          <ModelCombobox
            v-model="fModel"
            :options="pickableModels"
            class="mt-1 w-full"
            placeholder='search, or type e.g. "moonshotai/kimi-k3"'
            :empty-hint="`${pickableModels.length} ids from the last refresh — type to search`"
          />
          <span v-if="editingId && pickableModels.length > 0" class="set-hint mt-1 block">
            {{ pickableModels.length }} model{{ pickableModels.length === 1 ? '' : 's' }} from the
            last refresh are offered as suggestions — any id can still be typed.
          </span>
        </label>
      </div>
      <p v-if="formError" class="set-error mt-2">{{ formError }}</p>
      <div class="mt-3 flex justify-end gap-2">
        <button class="set-action" @click="closeForm">Cancel</button>
        <button
          class="set-btn-primary"
          :disabled="!fName || !fAdapterId || !fAuthMode || formBusy"
          @click="submitForm"
        >
          {{ editingId === null ? 'Add provider' : 'Save changes' }}
        </button>
      </div>
    </div>

    <!-- loading / error / empty states -->
    <div v-if="settings.loading && settings.providers.length === 0" class="set-note">Loading…</div>
    <div v-else-if="settings.providers.length === 0" class="set-blank">
      No providers configured yet. Add a provider, then store a credential under it — keys are
      write-only and can be replaced but never read back.
    </div>

    <!-- one card per provider, credential rows nested inside (D38).
         Against the mock's provider card: 18px code tile, name, status chip,
         mono route meta on the right, actions.
         ⚠ ITERATES `orderedProviders`, NOT `settings.providers` — management
         routes sort to the bottom. The store stays in main's order. -->
    <template v-for="(provider, i) in orderedProviders" :key="provider.id">
      <div v-if="groupHeadingFor(i)" class="set-group">
        <span class="set-group-label">{{ groupHeadingFor(i)!.label }}</span>
        <span class="set-group-rule"></span>
        <span class="set-group-note">{{ groupHeadingFor(i)!.note }}</span>
      </div>

      <div class="set-card" :class="isManagement(provider) && 'set-card-protected'">
        <div
          class="set-card-head"
          :class="isCardOpen(provider) && 'set-card-head-ruled'"
          :data-provider-card="provider.id"
          :data-provider-open="isCardOpen(provider)"
        >
          <!-- The disclosure, on protected cards only. Everything else is
               always open; a chevron there would be ceremony. -->
          <button
            v-if="isManagement(provider)"
            class="set-card-toggle"
            :title="isCardOpen(provider) ? 'Close this protected route' : 'Open this protected route'"
            :aria-expanded="isCardOpen(provider)"
            :data-provider-toggle="provider.id"
            @click="toggleCard(provider)"
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path :d="isCardOpen(provider) ? 'M3 4.5 6 7.5l3-3' : 'M4.5 3 7.5 6l-3 3'" />
            </svg>
          </button>
          <span class="set-tile">{{ providerCode(provider) }}</span>
          <span class="set-card-name">{{ provider.name }}</span>
          <span class="set-chip" :class="`set-chip-${credentialState(provider).tone}`">
            <span class="set-chip-dot"></span>
            {{ credentialState(provider).text }}
          </span>
          <span class="flex-1"></span>
          <span
            class="set-meta min-w-0 truncate"
            :title="`${adapterLabel(provider)} · ${authLabel(provider)}`"
          >
            {{ adapterLabel(provider) }} · {{ authLabel(provider) }}
            <template v-if="provider.env_var_name"> · {{ provider.env_var_name }}</template>
            <template v-if="provider.base_url"> · {{ provider.base_url }}</template>
            <template v-if="provider.model"> · {{ provider.model }}</template>
          </span>
          <!-- ⚠ EDIT AND DELETE ARE BEHIND THE DISCLOSURE ON A PROTECTED CARD.
               Leaving them on a shut card would keep the accident this collapse
               exists to prevent one click away, which is where it already was. -->
          <template v-if="isCardOpen(provider)">
            <button class="set-action" @click="openEdit(provider)">edit</button>
            <button class="set-action set-action-danger" @click="toggleDelete(provider.id)">
              delete
            </button>
          </template>
        </div>

        <template v-if="isCardOpen(provider)">
      <!-- inline delete confirmation; main's refusal renders here -->
      <div v-if="deleteConfirmId === provider.id" class="set-row-block px-4 py-2">
        <div class="set-confirm">
          <p class="set-note">
            Delete provider <span class="set-strong">{{ provider.name }}</span
            >?
          </p>
          <div class="mt-2 flex items-center justify-end gap-2">
            <span v-if="deleteError" class="set-error mr-auto min-w-0 truncate" :title="deleteError">
              {{ deleteError }}
            </span>
            <button class="set-action" @click="toggleDelete(provider.id)">Cancel</button>
            <button class="set-btn-danger" :disabled="deleteBusy" @click="confirmDelete(provider.id)">
              Delete provider
            </button>
          </div>
        </div>
      </div>

      <SettingsCredentials
        :provider="provider"
        :profiles="profilesByProvider.get(provider.id) ?? []"
        :auth-label="authLabel(provider)"
      />

      <!-- Task 3a-4: the model catalog. A CACHE of what this route offers —
           it never changes what launches, and nothing below writes the
           provider's `model`. -->
      <div class="set-row-block px-4 py-2.5" data-models-section>
        <div class="flex items-center gap-2">
          <span class="set-section-title">Models</span>

          <!-- THREE STATES, RENDERED AS THREE DIFFERENT THINGS. 'never' is its
               own thing — not a spinner, and not an empty list styled as
               stale. An implementation that renders it through the stale
               branch looks right on a populated database and wrong on every
               fresh install, which is every new user. -->
          <span
            v-if="freshnessOf(provider.id) === 'never'"
            class="set-meta"
            data-models-freshness="never"
          >
            No model list yet
          </span>
          <span
            v-else-if="freshnessOf(provider.id) === 'fresh'"
            class="set-meta"
            data-models-freshness="fresh"
          >
            {{ catalogFor(provider.id).length }} models · updated {{ ageLabel(provider.id) }}
          </span>
          <span v-else class="set-row-warn" data-models-freshness="stale">
            ⚠ {{ catalogFor(provider.id).length }} models · last updated {{ ageLabel(provider.id) }}
          </span>

          <span class="flex-1"></span>

          <!-- The credential is OPTIONAL: "no credential" is a first-class
               shipped path, not a fallback. -->
          <select
            v-if="(profilesByProvider.get(provider.id) ?? []).length > 0"
            v-model="refreshCredential[provider.id]"
            class="set-select set-select-sm"
            data-models-credential
          >
            <option :value="null">no credential</option>
            <option v-for="p in profilesByProvider.get(provider.id) ?? []" :key="p.id" :value="p.id">
              {{ p.label }}
            </option>
          </select>
          <button
            class="set-pill"
            :disabled="isRefreshing(provider.id)"
            data-models-refresh
            @click="onRefresh(provider.id)"
          >
            {{ isRefreshing(provider.id) ? 'Refreshing…' : 'Refresh' }}
          </button>
        </div>

        <!-- main's sanitized reason, VERBATIM -->
        <p v-if="refreshError[provider.id]" class="set-error mt-1.5" data-models-error>
          {{ refreshError[provider.id] }}
        </p>

        <!-- ⚠ WORKED EXAMPLE 8. The route still launches — nothing is
             cleared, substituted or blocked. This is the whole point of the
             table: make the F-36-4 failure legible EARLY, at pick time,
             instead of at launch as a sanitized "Unexpected response (400)." -->
        <p
          v-if="missingRouteModel(provider)"
          class="set-hint-warn mt-1.5 block"
          data-models-missing-warning
        >
          ⚠ <span class="set-mono">{{ provider.model }}</span> was not in the last refresh ({{
            shortDate(missingRouteModel(provider)!.missingSince!)
          }}). It may have been retired — launches naming it will fail at the provider.
        </p>

        <!-- Worked example 12: the provider announced a retirement date. -->
        <p
          v-else-if="expiringRouteModel(provider)"
          class="set-note mt-1.5"
          data-models-expiry-notice
        >
          The provider lists <span class="set-mono">{{ provider.model }}</span> as retiring on
          {{ expiringRouteModel(provider)!.expiresAt }}.
        </p>

        <!-- ⚠ THE CATALOG IS NO LONGER DRAWN AS A LIST OF CHIPS, AND THE
             REASONING THAT PUT IT THERE IS WORTH KEEPING. It existed so a
             stale list stayed visible — "hiding it would push the user back to
             typing ids from memory", the behaviour that produced kimi-k2.7.
             That need is now met better: the searchable picker below is fed by
             this same catalog, so every catalogued id is one keystroke away
             instead of twelve-of-343 being spilled onto the page. The count and
             the freshness line above still say what was fetched and when, which
             is the part that was carrying the warning. Nothing was hidden;
             it moved somewhere you can actually search it. -->

        <!-- D85: the SHORTLIST. Distinct from the cache above it in both
             direction and authority — that list is what the provider says
             exists, this one is what the USER chose, and no refresh may ever
             write it. Rendered for every route, including one with no catalog
             at all: an id can be shortlisted before any refresh has run. -->
        <!-- ⚠ UNMOCKED. `Chorus Settings Providers.dc.html` was drawn before
             D85 existed and says nothing about a shortlist — token-and-
             primitive conformance only, recorded as such in the 3c-5 report
             rather than presented as a match. -->
        <div class="set-subsection mt-2 pt-2" data-shortlist-section>
          <div class="flex items-center gap-2">
            <span class="set-section-title">Shortlist</span>
            <span class="set-meta">
              {{
                shortlistFor(provider.id).length === 0
                  ? 'the models you actually use — these are what a launch offers'
                  : `${shortlistFor(provider.id).length} chosen`
              }}
            </span>
          </div>

          <div class="mt-1.5 flex items-center gap-2">
            <!-- ⚠ STILL FREE TEXT, NEVER A <select> (D48/D56, third enforcement
                 site in this file) — the <datalist> became a real searchable
                 panel, which is a change of AFFORDANCE, not of authority. The
                 catalog suggests; it does not decide. See ModelCombobox.vue,
                 where the "no highlight -> submit the raw text" branch is what
                 keeps an uncatalogued id reachable. Picking a suggestion adds
                 it immediately: that is the gesture the datalist was failing
                 to offer. -->
            <ModelCombobox
              v-model="shortlistDraft[provider.id]"
              :options="shortlistSuggestions(provider.id)"
              input-class="set-input-sm"
              class="w-72"
              placeholder="search or type any model id"
              :empty-hint="`${shortlistSuggestions(provider.id).length} catalogued ids — type to search`"
              :data-shortlist-input="provider.id"
              @submit="(id: string) => addToShortlist(provider.id, id)"
            />
            <!-- ⚠ `set-pill-pending`, NOT PLAIN `:disabled`. An empty field
                 means "nothing to add yet", but the shared disabled style paints
                 `cursor: not-allowed` — which reads as "you are not permitted to
                 shortlist", and did: it was reported as being blocked from
                 adding. Same disabled state, honest cursor, and a title that
                 says what to do. -->
            <button
              class="set-pill set-pill-pending"
              :disabled="!(shortlistDraft[provider.id] ?? '').trim()"
              :title="
                (shortlistDraft[provider.id] ?? '').trim()
                  ? 'Add this model id to the shortlist'
                  : 'Search or type a model id first — then Add'
              "
              :data-shortlist-add="provider.id"
              @click="addToShortlist(provider.id)"
            >
              Add
            </button>
          </div>

          <div v-if="shortlistFor(provider.id).length > 0" class="mt-1.5 flex flex-wrap gap-1">
            <span
              v-for="id in shortlistFor(provider.id)"
              :key="id"
              class="set-model-chip flex items-center gap-1"
              :class="shortlistedMissing(provider.id).has(id) && 'set-model-chip-kept'"
              :title="
                shortlistedMissing(provider.id).has(id)
                  ? 'not in the last refresh — kept, because it is your choice, not the catalog’s'
                  : id
              "
            >
              {{ id }}
              <button
                class="set-chip-x"
                :data-shortlist-remove="id"
                @click="removeFromShortlist(provider.id, id)"
              >
                ✕
              </button>
            </span>
          </div>
        </div>
      </div>
        </template>

        <!-- What a shut protected card says instead of its body. It names the
             route's purpose so the card is still legible closed — a bare
             chevron would make the user open it to find out what it is, which
             is the click this collapse exists to avoid. -->
        <p v-else class="set-protected-note" :data-provider-closed="provider.id">
          Closed by default so it is not touched by accident. It mints and revokes the short-lived
          keys that meter spend, and can never launch an agent.
        </p>
      </div>
    </template>

    <!-- 3a-5 (D43): saved launch profiles. Rendered only when some exist —
         with none, this view is byte-for-byte the pre-3a-5 view. -->
    <template v-if="settings.launchProfiles.length > 0">
      <div class="set-group">
        <span class="set-group-label">LAUNCH PROFILES</span>
        <span class="set-group-rule"></span>
        <span class="set-group-note">saved picks · chosen in the launch dialog</span>
      </div>
    </template>
    <div v-if="settings.launchProfiles.length > 0" class="set-card">
      <div class="set-card-head set-card-head-ruled">
        <h2 class="set-card-name">Saved launch profiles</h2>
        <span class="set-meta">
          pick one in the launch dialog · renaming here changes nothing else
        </span>
      </div>
      <p v-if="profileError" class="set-error px-4 pt-2">{{ profileError }}</p>
      <ul class="flex flex-col">
        <li
          v-for="p in settings.launchProfiles"
          :key="p.id"
          class="set-row"
          data-launch-profile-row
        >
          <template v-if="renamingProfileId === p.id">
            <input
              v-model="renameLabel"
              class="set-input set-input-sm flex-1"
              data-rename-input
              @keydown.enter="commitRename"
              @keydown.esc="renamingProfileId = null"
            />
            <button class="set-action" data-rename-confirm @click="commitRename">Save</button>
            <button class="set-action" @click="renamingProfileId = null">Cancel</button>
          </template>
          <template v-else>
            <span class="set-row-name">{{ p.label }}</span>
            <span class="set-row-detail min-w-0 truncate">
              {{ p.agent }}{{ p.provider_name ? ' · ' + p.provider_name : '' }}
              {{ p.model ? ' · ' + p.model : '' }}
              {{ p.credential_label ? ' · ' + p.credential_label : '' }}
            </span>
            <!-- SHOWN, DISABLED AND EXPLAINED — never hidden. -->
            <span v-if="p.disabled_reason" class="set-row-warn">⚠ {{ p.disabled_reason }}</span>
            <span class="flex-1"></span>
            <button class="set-action" data-rename-profile @click="beginRename(p.id, p.label)">
              Rename
            </button>
            <template v-if="deletingProfileId === p.id">
              <span class="set-meta">delete?</span>
              <button
                class="set-action set-action-danger"
                data-delete-confirm
                @click="confirmDeleteProfile(p.id)"
              >
                Yes
              </button>
              <button class="set-action" @click="deletingProfileId = null">No</button>
            </template>
            <button
              v-else
              class="set-action"
              data-delete-profile
              @click="deletingProfileId = p.id"
            >
              Delete
            </button>
          </template>
        </li>
      </ul>
    </div>

    <!-- 3b-2 (D62): the council's members. WHO deliberates — nothing here runs
         a council, calls an API, or spends anything. -->
    <!-- ⚠ UNMOCKED. The settings mock predates 3b-2 and contains the word
         "council" zero times — token-and-primitive conformance only. -->
    <div class="set-group">
      <span class="set-group-label">COUNCIL</span>
      <span class="set-group-rule"></span>
      <span class="set-group-note">who deliberates · nothing here runs one</span>
    </div>
    <div class="set-card" data-council-section>
      <div class="set-card-head set-card-head-ruled">
        <h2 class="set-card-name">Council members</h2>
        <span class="set-meta">
          who deliberates · a member names its route by naming a credential
        </span>
        <span class="flex-1"></span>
        <button
          v-if="!councilFormOpen"
          class="set-pill"
          :disabled="councilCredentials.length === 0"
          :title="councilBlockedReason ?? undefined"
          data-council-add
          @click="openCouncilCreate"
        >
          + member
        </button>
      </div>

      <!-- create form -->
      <div v-if="councilFormOpen" class="set-row-block p-4" data-council-form>
        <div class="grid grid-cols-2 gap-3">
          <label class="set-field-label">
            Name
            <input
              v-model="cLabel"
              maxlength="120"
              placeholder='e.g. "OpenRouter/kimi-k3"'
              class="set-input mt-1 w-full"
              data-council-label
            />
          </label>
          <label class="set-field-label">
            Credential
            <!-- The credential IS the route (D48): there is no base-URL field
                 and no route picker on this form, because there is no such
                 column on the row. -->
            <select v-model="cCredentialId" class="set-select mt-1 w-full" data-council-credential>
              <option v-for="p in councilCredentials" :key="p.id" :value="p.id">
                {{ p.label }}{{ credentialRouteName(p.id) ? ' · ' + credentialRouteName(p.id) : '' }}
              </option>
            </select>
            <span v-if="excludedManagementCount > 0" class="set-hint mt-1 block">
              {{ excludedManagementCount }} management
              credential{{ excludedManagementCount === 1 ? '' : 's' }} not offered — a management
              key mints and revokes keys and cannot do inference.
            </span>
          </label>
          <label class="set-field-label">
            Model <span class="set-hint">(optional)</span>
            <!-- ⚠ D56's THIRD ENFORCEMENT SITE. FREE TEXT with an ADDITIVE
                 <datalist>, never a closed <select> — a closed select sourced
                 from model_catalog would make the catalog authoritative by UI
                 construction, with nobody deciding to. -->
            <ModelCombobox
              v-model="cModel"
              :options="councilPickableModels"
              class="mt-1 w-full"
              :placeholder="selectedRouteDefaultModel ?? 'the route’s default'"
              :empty-hint="`${councilPickableModels.length} ids on this route — type to search`"
              data-council-model
            />
            <!-- The route default is a SENTENCE, never a prefilled value:
                 copying it into the field is the rank-2-into-rank-1 back-write
                 D48 exists to prevent. -->
            <span v-if="selectedRouteDefaultModel" class="set-hint mt-1 block" data-council-inherit-hint>
              Leave empty to inherit this route’s default
              (<span class="set-mono">{{ selectedRouteDefaultModel }}</span>) at run time — the
              member’s own model stays unset.
            </span>
          </label>
          <label class="set-field-label">
            Role
            <select v-model="cRole" class="set-select mt-1 w-full" data-council-role>
              <option value="member">member — argues a position</option>
              <option value="arbiter">arbiter — rules on disagreement</option>
            </select>
          </label>
          <label class="set-field-label col-span-2">
            Parameters <span class="set-hint">(optional JSON — e.g. temperature)</span>
            <input
              v-model="cParams"
              maxlength="4096"
              placeholder='{"temperature": 0.2}'
              class="set-input mt-1 w-full"
              data-council-params
            />
            <span class="set-hint mt-1 block">
              Stored in plaintext and never read back — a value that looks like a key is refused.
            </span>
          </label>
        </div>
        <p v-if="councilFormError" class="set-error mt-2" data-council-form-error>
          {{ councilFormError }}
        </p>
        <div class="mt-3 flex justify-end gap-2">
          <button class="set-action" @click="councilFormOpen = false">Cancel</button>
          <button
            class="set-btn-primary"
            :disabled="!cLabel.trim() || !cCredentialId || councilBusy"
            data-council-submit
            @click="submitCouncilMember"
          >
            Add member
          </button>
        </div>
      </div>

      <p v-if="councilError" class="set-error px-4 pt-2" data-council-error>{{ councilError }}</p>

      <!-- ⚠ THE BLOCKER OUTRANKS THE EMPTY STATE. "No council members yet —
           add three or four" describes the destination; when the button is
           dead, what the user needs is the obstacle. A title alone would not do
           it: a tooltip you must already suspect something to go looking for is
           not an explanation. -->
      <p v-if="councilBlockedReason" class="set-empty" data-council-blocked>
        {{ councilBlockedReason }}
      </p>
      <p
        v-else-if="settings.councilMembers.length === 0"
        class="set-empty"
        data-council-empty
      >
        No council members yet. A member is a credential, a model and a role — add three or four
        plus one arbiter.
      </p>

      <!-- Not `v-else`: a blocked card that somehow still has members must show
           them rather than swapping the roster for the notice. -->
      <ul v-if="settings.councilMembers.length > 0" class="flex flex-col">
        <template v-for="m in settings.councilMembers" :key="m.id">
        <li
          class="set-row"
          data-council-member-row
          :data-council-member-id="m.id"
          :data-council-member-available="m.available"
        >
          <template v-if="renamingMemberId === m.id">
            <input
              v-model="renameMemberLabel"
              class="set-input set-input-sm flex-1"
              data-council-rename-input
              @keydown.enter="commitRenameMember"
              @keydown.esc="renamingMemberId = null"
            />
            <button class="set-action" data-council-rename-confirm @click="commitRenameMember">
              Save
            </button>
            <button class="set-action" @click="renamingMemberId = null">Cancel</button>
          </template>
          <template v-else>
            <span class="set-row-name" :class="!m.available && 'set-row-dim'">{{ m.label }}</span>
            <span class="set-role-chip">{{ m.role }}</span>
            <span class="set-row-detail">
              {{ m.providerName ?? '—' }}{{ m.credentialLabel ? ' · ' + m.credentialLabel : '' }}
            </span>
            <!-- ⚠ THE D56 PROOF, RENDERED. A member with no model of its own
                 says so and names what it inherits — the two facts stay
                 distinguishable, which is what stops the inherited value from
                 being "helpfully" written into the row. -->
            <span v-if="m.model" class="set-mono" data-council-model-own>{{ m.model }}</span>
            <span
              v-else-if="m.resolvedModel"
              class="set-mono set-mono-inherited"
              data-council-model-inherited
            >
              inherits {{ m.resolvedModel }}
            </span>
            <span v-else class="set-hint" data-council-model-none>no model</span>
            <!-- SHOWN, DISABLED AND EXPLAINED — never hidden. Naming the
                 credential BY LABEL ONLY: no URL, no env var, no fragment. -->
            <span v-if="!m.available" class="set-row-warn" data-council-unavailable-reason>
              ⚠ {{ m.unavailableReason }}
            </span>
            <span class="flex-1"></span>
            <!-- ⚠ THE ROLE DEFAULT IS SHOWN ON THE ROW, not only inside the
                 editor. A member carrying no `max_tokens` of its own still gets
                 a number at run time, and the run that made this editor
                 necessary failed because that number was invisible until it had
                 already been spent. Same discipline as the model column beside
                 it: an inherited value is LABELLED as inherited, never dressed
                 up as the row's own. -->
            <span v-if="m.maxTokens !== null" class="set-mono" data-council-max-tokens-own>
              {{ m.maxTokens.toLocaleString() }} tok
            </span>
            <span v-else class="set-mono set-mono-inherited" data-council-max-tokens-default>
              {{ m.defaultMaxTokens.toLocaleString() }} tok default
            </span>
            <button class="set-action" data-council-rename @click="beginRenameMember(m.id, m.label)">
              Rename
            </button>
            <button class="set-action" data-council-params-edit @click="beginEditParams(m)">
              Params
            </button>
            <template v-if="deletingMemberId === m.id">
              <span class="set-meta">delete?</span>
              <button
                class="set-action set-action-danger"
                data-council-delete-confirm
                @click="confirmDeleteMember(m.id)"
              >
                Yes
              </button>
              <button class="set-action" @click="deletingMemberId = null">No</button>
            </template>
            <button v-else class="set-action" data-council-delete @click="deletingMemberId = m.id">
              Delete
            </button>
          </template>
        </li>

        <!-- The parameters editor, attached BENEATH its own row rather than
             replacing it (the rename branch swaps the row; this does not) —
             the label, role and model are exactly the context you need while
             deciding a token budget. No border of its own, so it reads as part
             of the row above rather than as the next one. -->
        <li
          v-if="editingParamsMemberId === m.id"
          class="px-4 pb-3"
          data-council-params-editor
        >
          <div class="flex items-center gap-3">
            <span class="set-meta">max output tokens</span>
            <input
              v-model="editMaxTokens"
              class="set-input set-input-sm w-24"
              maxlength="9"
              inputmode="numeric"
              :placeholder="String(m.defaultMaxTokens)"
              data-council-max-tokens-input
              @keydown.enter="commitEditParams(m)"
              @keydown.esc="cancelEditParams"
            />
            <input
              v-model="editOtherParams"
              class="set-input set-input-sm min-w-0 flex-1"
              maxlength="4096"
              :placeholder="otherParamsPlaceholder(m)"
              data-council-other-params-input
              @keydown.enter="commitEditParams(m)"
              @keydown.esc="cancelEditParams"
            />
            <button class="set-action" data-council-params-confirm @click="commitEditParams(m)">
              Save
            </button>
            <button class="set-action" @click="cancelEditParams">Cancel</button>
          </div>
          <p class="set-hint mt-1">
            Empty uses this {{ m.role }}’s {{ m.defaultMaxTokens.toLocaleString() }}-token
            default; a run clamps whatever is here to 200–32,000.
            <template v-if="m.otherParamNames.length > 0">
              This member also carries {{ m.otherParamNames.join(', ') }} — kept as they are
              unless the second field replaces them. Their values are never read back, so a
              replacement must be the whole object; <span class="set-mono">{}</span> clears them.
            </template>
            <template v-else>
              The second field sets this member’s other parameters, which are stored but not
              sent — only max_tokens reaches the request.
            </template>
          </p>
        </li>
        </template>
      </ul>
    </div>

    <span class="flex-1"></span>
    <p class="set-foot">
      <svg width="9" height="11" viewBox="0 0 9 11" fill="none" stroke="currentColor" stroke-width="1">
        <rect x="1" y="4.5" width="7" height="5.5" rx="1" />
        <path d="M2.5 4.5V3a2 2 0 0 1 4 0v1.5" />
      </svg>
      stored per-credential in the Windows credential vault · export excludes keys
    </p>
  </div>
</template>

<style src="../assets/settings.css"></style>

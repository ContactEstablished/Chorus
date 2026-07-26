<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  MANAGEMENT_AUTH_MODE,
  type ModelCatalogEntry,
  type ProviderConfig
} from '../../../shared/ipc'
import { useSettingsStore } from '../stores/settings'
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
  // Adapter switch invalidates the auth-mode choice; default to the new
  // adapter's first declared method.
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

/** The catalog for the provider currently being EDITED, which is the only one
 *  whose ids can meaningfully populate the form's picker (a provider being
 *  CREATED has no id and therefore no catalog yet). */
const pickableModels = computed<ModelCatalogEntry[]>(() => {
  if (editingId.value === null) return []
  // ⚠ Missing models are NOT offered for new selections. They still RENDER
  // (struck through, on the card) wherever they are already named.
  return catalogFor(editingId.value).filter((m) => m.missingSince === null)
})
</script>

<template>
  <div class="flex max-w-4xl flex-col gap-4">
    <div class="flex items-baseline gap-3">
      <h1 class="text-base font-semibold text-neutral-100">Providers &amp; keys</h1>
      <span class="text-[11px] text-neutral-500">
        encrypted with Windows DPAPI · keys never leave this machine
      </span>
      <span class="flex-1"></span>
      <button
        v-if="!formOpen"
        class="rounded border border-neutral-700 bg-neutral-800 px-3 py-1 text-xs text-neutral-200 hover:border-neutral-500"
        @click="openCreate"
      >
        + provider
      </button>
    </div>

    <!-- provider create/edit form -->
    <div v-if="formOpen" class="rounded-md border border-neutral-700 bg-neutral-900 p-4">
      <h2 class="text-xs font-semibold text-neutral-200">
        {{ editingId === null ? 'Add provider' : 'Edit provider' }}
      </h2>
      <div class="mt-3 grid grid-cols-2 gap-3">
        <label class="block text-[11px] text-neutral-400">
          Name
          <input
            v-model="fName"
            maxlength="120"
            placeholder='e.g. "Anthropic"'
            class="mt-1 w-full rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-100"
          />
        </label>
        <label class="block text-[11px] text-neutral-400">
          Adapter
          <select
            v-model="fAdapterId"
            class="mt-1 w-full rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-100"
            @change="onAdapterChange"
          >
            <option v-for="a in settings.adapters" :key="a.id" :value="a.id">
              {{ a.displayName }}
            </option>
          </select>
        </label>
        <label class="block text-[11px] text-neutral-400">
          Auth method
          <select
            v-model="fAuthMode"
            class="mt-1 w-full rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-100"
          >
            <option v-for="m in authMethods" :key="m.type" :value="m.type">{{ m.label }}</option>
          </select>
          <!-- 3a-3: the account-level class needs its two properties said out
               loud at the moment of choosing, because both are surprising:
               it never launches anything, and testing it fails BY DESIGN. -->
          <span v-if="managementSelected" class="mt-1 block text-[10px] leading-snug text-amber-300">
            Mints and revokes the short-lived per-dispatch keys that meter spend. It can never launch an
            agent, and “test” will fail by design — OpenRouter blocks management keys from the
            completion endpoints.
          </span>
        </label>
        <label class="block text-[11px] text-neutral-400">
          Env var name <span class="text-neutral-600">(optional override)</span>
          <!-- Empty input, adapter default as PLACEHOLDER (spec §5): pre-filling
               would persist a copy of today's default, so a later adapter
               correction would silently not apply to this provider. -->
          <input
            v-model="fEnvVar"
            :placeholder="selectedAuthMethod?.requiredEnvVar ?? 'adapter default'"
            maxlength="120"
            class="mt-1 w-full rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-100"
          />
        </label>
        <label class="block text-[11px] text-neutral-400">
          Base URL <span class="text-neutral-600">(optional — OpenAI-compatible endpoint)</span>
          <!-- D47: the route's endpoint (e.g. https://openrouter.ai/api/v1 —
               no trailing slash). Plaintext, documented non-secret (D33(e)).
               Empty = the provider's native default endpoint. -->
          <input
            v-model="fBaseUrl"
            placeholder="https://openrouter.ai/api/v1"
            maxlength="2048"
            class="mt-1 w-full rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-100"
          />
        </label>
        <label class="block text-[11px] text-neutral-400">
          Default model <span class="text-neutral-600">(optional)</span>
          <!-- D48: the ROUTE's default model — a default, not an authority.
               Task 3a-4 adds a catalog-sourced picker that is strictly
               ADDITIVE: this stays a FREE-TEXT input with a <datalist>
               attached, and must never become a closed <select>. A user has to
               be able to type an id the catalog has never heard of — a closed
               select would make the catalog authoritative by construction,
               which is precisely the ruling this task exists to write down. -->
          <input
            v-model="fModel"
            :list="editingId ? `models-${editingId}` : undefined"
            placeholder='e.g. "moonshotai/kimi-k3"'
            maxlength="200"
            class="mt-1 w-full rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-100"
          />
          <datalist v-if="editingId" :id="`models-${editingId}`">
            <option v-for="m in pickableModels" :key="m.modelId" :value="m.modelId">
              {{ m.displayName }}
            </option>
          </datalist>
          <span v-if="editingId && pickableModels.length > 0" class="mt-1 block text-[10px] text-neutral-600">
            {{ pickableModels.length }} model{{ pickableModels.length === 1 ? '' : 's' }} from the
            last refresh are offered as suggestions — any id can still be typed.
          </span>
        </label>
      </div>
      <p v-if="formError" class="mt-2 text-[11px] text-red-400">{{ formError }}</p>
      <div class="mt-3 flex justify-end gap-2">
        <button class="text-xs text-neutral-400 hover:text-neutral-200" @click="closeForm">
          Cancel
        </button>
        <button
          class="rounded bg-sky-600 px-3 py-1 text-xs text-white hover:bg-sky-500 disabled:opacity-40"
          :disabled="!fName || !fAdapterId || !fAuthMode || formBusy"
          @click="submitForm"
        >
          {{ editingId === null ? 'Add provider' : 'Save changes' }}
        </button>
      </div>
    </div>

    <!-- loading / error / empty states -->
    <div v-if="settings.loading && settings.providers.length === 0" class="text-xs text-neutral-500">
      Loading…
    </div>
    <div
      v-else-if="settings.providers.length === 0"
      class="rounded-md border border-dashed border-neutral-800 p-6 text-center text-xs text-neutral-500"
    >
      No providers configured yet. Add a provider, then store a credential under it — keys are
      write-only and can be replaced but never read back.
    </div>

    <!-- one card per provider, credential rows nested inside (D38) -->
    <div
      v-for="provider in settings.providers"
      :key="provider.id"
      class="overflow-hidden rounded-md border border-neutral-800 bg-neutral-900"
    >
      <div class="flex items-center gap-3 px-4 py-2.5">
        <span class="text-xs font-semibold text-neutral-100">{{ provider.name }}</span>
        <span class="text-[11px] text-neutral-500">
          {{ adapterLabel(provider) }} · {{ authLabel(provider) }}
          <template v-if="provider.env_var_name"> · {{ provider.env_var_name }}</template>
          <template v-if="provider.base_url"> · {{ provider.base_url }}</template>
          <template v-if="provider.model"> · {{ provider.model }}</template>
        </span>
        <span class="flex-1"></span>
        <button class="text-[11px] text-neutral-400 hover:text-neutral-200" @click="openEdit(provider)">
          edit
        </button>
        <button class="text-[11px] text-red-300 hover:text-red-200" @click="toggleDelete(provider.id)">
          delete
        </button>
      </div>

      <!-- inline delete confirmation; main's refusal renders here -->
      <div
        v-if="deleteConfirmId === provider.id"
        class="border-t border-neutral-800/60 bg-neutral-900/80 px-4 py-2 ring-1 ring-neutral-700"
      >
        <p class="text-[11px] text-neutral-300">
          Delete provider <span class="text-neutral-100">{{ provider.name }}</span>?
        </p>
        <div class="mt-2 flex items-center justify-end gap-2">
          <span
            v-if="deleteError"
            class="mr-auto min-w-0 truncate text-[11px] text-red-400"
            :title="deleteError"
          >
            {{ deleteError }}
          </span>
          <button class="text-[11px] text-neutral-400 hover:text-neutral-200" @click="toggleDelete(provider.id)">
            Cancel
          </button>
          <button
            class="rounded bg-red-700 px-3 py-1 text-[11px] text-white hover:bg-red-600 disabled:opacity-40"
            :disabled="deleteBusy"
            @click="confirmDelete(provider.id)"
          >
            Delete provider
          </button>
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
      <div class="border-t border-neutral-800/60 px-4 py-2.5" data-models-section>
        <div class="flex items-center gap-2">
          <span class="text-[11px] font-semibold text-neutral-300">Models</span>

          <!-- THREE STATES, RENDERED AS THREE DIFFERENT THINGS. 'never' is its
               own thing — not a spinner, and not an empty list styled as
               stale. An implementation that renders it through the stale
               branch looks right on a populated database and wrong on every
               fresh install, which is every new user. -->
          <span
            v-if="freshnessOf(provider.id) === 'never'"
            class="text-[11px] text-neutral-500"
            data-models-freshness="never"
          >
            No model list yet
          </span>
          <span
            v-else-if="freshnessOf(provider.id) === 'fresh'"
            class="text-[11px] text-neutral-500"
            data-models-freshness="fresh"
          >
            {{ catalogFor(provider.id).length }} models · updated {{ ageLabel(provider.id) }}
          </span>
          <span v-else class="text-[11px] text-amber-300" data-models-freshness="stale">
            ⚠ {{ catalogFor(provider.id).length }} models · last updated {{ ageLabel(provider.id) }}
          </span>

          <span class="flex-1"></span>

          <!-- The credential is OPTIONAL: "no credential" is a first-class
               shipped path, not a fallback. -->
          <select
            v-if="(profilesByProvider.get(provider.id) ?? []).length > 0"
            v-model="refreshCredential[provider.id]"
            class="rounded bg-neutral-800 px-2 py-0.5 text-[11px] text-neutral-200"
            data-models-credential
          >
            <option :value="null">no credential</option>
            <option v-for="p in profilesByProvider.get(provider.id) ?? []" :key="p.id" :value="p.id">
              {{ p.label }}
            </option>
          </select>
          <button
            class="rounded border border-neutral-700 bg-neutral-800 px-2 py-0.5 text-[11px] text-neutral-200 hover:border-neutral-500 disabled:opacity-40"
            :disabled="isRefreshing(provider.id)"
            data-models-refresh
            @click="onRefresh(provider.id)"
          >
            {{ isRefreshing(provider.id) ? 'Refreshing…' : 'Refresh' }}
          </button>
        </div>

        <!-- main's sanitized reason, VERBATIM -->
        <p
          v-if="refreshError[provider.id]"
          class="mt-1.5 text-[11px] text-red-400"
          data-models-error
        >
          {{ refreshError[provider.id] }}
        </p>

        <!-- ⚠ WORKED EXAMPLE 8. The route still launches — nothing is
             cleared, substituted or blocked. This is the whole point of the
             table: make the F-36-4 failure legible EARLY, at pick time,
             instead of at launch as a sanitized "Unexpected response (400)." -->
        <p
          v-if="missingRouteModel(provider)"
          class="mt-1.5 text-[11px] leading-snug text-amber-300"
          data-models-missing-warning
        >
          ⚠ <span class="font-mono">{{ provider.model }}</span> was not in the last refresh ({{
            shortDate(missingRouteModel(provider)!.missingSince!)
          }}). It may have been retired — launches naming it will fail at the provider.
        </p>

        <!-- Worked example 12: the provider announced a retirement date. -->
        <p
          v-else-if="expiringRouteModel(provider)"
          class="mt-1.5 text-[11px] leading-snug text-neutral-400"
          data-models-expiry-notice
        >
          The provider lists <span class="font-mono">{{ provider.model }}</span> as retiring on
          {{ expiringRouteModel(provider)!.expiresAt }}.
        </p>

        <!-- A STALE LIST IS STILL SHOWN. Hiding it would push the user back to
             typing ids from memory — the exact behaviour that produced
             kimi-k2.7. Missing rows render struck through with their date. -->
        <div v-if="catalogFor(provider.id).length > 0" class="mt-1.5 flex flex-wrap gap-1">
          <span
            v-for="m in catalogFor(provider.id).slice(0, 12)"
            :key="m.modelId"
            class="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-[10px]"
            :class="m.missingSince ? 'text-neutral-500 line-through' : 'text-neutral-300'"
            :title="
              m.missingSince
                ? `missing since ${shortDate(m.missingSince)}`
                : m.contextLength
                  ? `${m.displayName} · ${m.contextLength} ctx`
                  : m.displayName
            "
          >
            {{ m.modelId }}
          </span>
          <span
            v-if="catalogFor(provider.id).length > 12"
            class="px-1.5 py-0.5 text-[10px] text-neutral-500"
          >
            +{{ catalogFor(provider.id).length - 12 }} more
          </span>
        </div>
      </div>
    </div>

    <p class="text-[10px] text-neutral-600">
      stored per-credential in the Windows credential vault · export excludes keys
    </p>
  </div>
</template>

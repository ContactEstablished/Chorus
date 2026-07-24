<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ProviderConfig } from '../../../shared/ipc'
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
const authMethods = computed(() => selectedAdapter.value?.authMethods ?? [])
const selectedAuthMethod = computed(
  () => authMethods.value.find((m) => m.type === fAuthMode.value) ?? null
)

/** Everything the selects render comes from adapter:list — no hardcoded
 *  adapter names, auth modes, or env-var strings in this file. */
function adapterLabel(provider: ProviderConfig): string {
  return (
    settings.adapters.find((a) => a.id === provider.adapter_type)?.displayName ??
    provider.adapter_type
  )
}
function authLabel(provider: ProviderConfig): string {
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
          <!-- D48: hand-entered text ONLY — no list, no fetch, no refresh.
               A model catalog is a hard non-goal. -->
          <input
            v-model="fModel"
            placeholder='e.g. "moonshotai/kimi-k2.7"'
            maxlength="200"
            class="mt-1 w-full rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-100"
          />
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
    </div>

    <p class="text-[10px] text-neutral-600">
      stored per-credential in the Windows credential vault · export excludes keys
    </p>
  </div>
</template>

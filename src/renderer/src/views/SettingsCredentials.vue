<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import type { CredentialProfileMetaWire, ProviderConfig } from '../../../shared/ipc'
import { useSettingsStore } from '../stores/settings'

/**
 * Credential rows + add/replace form, rendered INSIDE a provider card
 * (Task 3-4, spec §4 — the write-only surface; D33 clause 3).
 *
 * The renderer's complete knowledge of a credential profile is the wire meta
 * row: label, providerId, createdAt, lastVerifiedAt, unavailableSince. There
 * is no key, no fingerprint, no length, no masked preview — and nothing here
 * may invent one. The plaintext key exists ONLY as a component-local ref
 * bound to a password input; it crosses the bridge once, is cleared on
 * success and on unmount (never on failure — clearing then would destroy a
 * long pasted key over a transient refusal), and is NEVER interpolated into
 * an error string, a log, or any other rendered text.
 */
const props = defineProps<{
  provider: ProviderConfig
  profiles: CredentialProfileMetaWire[]
  /** Resolved by the parent from adapter:list (raw auth_mode as fallback). */
  authLabel: string
}>()

const settings = useSettingsStore()

/* ---- add form ---- */
const addOpen = ref(false)
const label = ref('')
const keyValue = ref('') // component-local by design — never store state
const addBusy = ref(false)
const addError = ref<string | null>(null)

/* ---- replace form (one row at a time) ---- */
const replacingId = ref<string | null>(null)
const replaceKey = ref('')
const replaceBusy = ref(false)
const replaceError = ref<string | null>(null)

/* ---- delete confirm (WorktreePanel inline idiom — never window.confirm) ---- */
const deleteConfirmId = ref<string | null>(null)
const deleteBusy = ref(false)
const deleteError = ref<string | null>(null)

// A ref on an unmounted component is garbage eventually, not immediately —
// explicit clearing shortens the window at zero cost (spec §4.2).
onBeforeUnmount(() => {
  keyValue.value = ''
  replaceKey.value = ''
})

function toggleAdd(): void {
  addOpen.value = !addOpen.value
  label.value = ''
  keyValue.value = ''
  addError.value = null
  replacingId.value = null
  replaceKey.value = ''
}

async function submitAdd(): Promise<void> {
  if (!label.value || !keyValue.value || addBusy.value) return
  addBusy.value = true
  addError.value = null
  try {
    // D14: a fresh literal of primitives from component-local refs. The key
    // is passed THROUGH as a parameter — never stored, never logged.
    const reason = await settings.createProfile({
      providerId: props.provider.id,
      label: label.value,
      key: keyValue.value
    })
    if (reason !== null) {
      // Verbatim from main (spec §4.3) — NEVER interpolate the submitted
      // value; that is the single likeliest clause-3 breach in this phase.
      addError.value = reason
      return
    }
    keyValue.value = '' // cleared on success — and NOT on failure
    label.value = ''
    addOpen.value = false
  } finally {
    addBusy.value = false
  }
}

function toggleReplace(id: string): void {
  replacingId.value = replacingId.value === id ? null : id
  replaceKey.value = ''
  replaceError.value = null
}

async function submitReplace(id: string): Promise<void> {
  if (!replaceKey.value || replaceBusy.value) return
  replaceBusy.value = true
  replaceError.value = null
  try {
    const reason = await settings.replaceProfile(id, replaceKey.value)
    if (reason !== null) {
      replaceError.value = reason // verbatim — D36's `duplicate` refusal lands here
      return
    }
    replaceKey.value = ''
    replacingId.value = null
  } finally {
    replaceBusy.value = false
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
    const reason = await settings.deleteProfile(id)
    if (reason !== null) {
      deleteError.value = reason
      return
    }
    deleteConfirmId.value = null
  } finally {
    deleteBusy.value = false
  }
}

/** Compact relative time for created/verified/unavailable timestamps. */
function rel(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}
</script>

<template>
  <div>
    <p v-if="profiles.length === 0 && !addOpen" class="px-4 py-2 text-[11px] text-neutral-500">
      No credentials yet. Stored keys are write-only — they can be replaced but never read back.
    </p>

    <!-- credential rows: label · auth method · verified · state · actions.
         NO key-hint column — the design mock's masked hint is D33-forbidden. -->
    <div
      v-for="p in profiles"
      :key="p.id"
      class="border-t border-neutral-800/60 px-4 py-2"
    >
      <div class="flex items-center gap-4">
        <span class="w-40 shrink-0 truncate text-xs font-medium text-neutral-200" :title="p.label">
          {{ p.label }}
        </span>
        <span class="w-32 shrink-0 truncate text-[11px] text-neutral-500">{{ authLabel }}</span>
        <span class="w-32 shrink-0 text-[11px] text-neutral-500">
          {{ p.lastVerifiedAt ? `verified ${rel(p.lastVerifiedAt)}` : 'never verified' }}
        </span>
        <!-- F-5a: an unavailable mark clears ONLY on a successful replace —
             render it as a distinct, actionable state, not a healthy row
             with a subtitle. The red dot reuses the pane-header `exited`
             vocabulary. -->
        <span v-if="p.unavailableSince" class="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] text-red-400">
          <span class="inline-block h-2 w-2 shrink-0 rounded-full bg-red-500"></span>
          unavailable since {{ rel(p.unavailableSince) }} — re-enter the credential
        </span>
        <span v-else class="min-w-0 flex-1 text-[11px] text-neutral-600" :title="`added ${p.createdAt}`">
          added {{ rel(p.createdAt) }}
        </span>
        <span class="flex shrink-0 gap-2">
          <button
            class="text-[11px] text-neutral-400 hover:text-neutral-200"
            :class="p.unavailableSince && 'text-amber-300 hover:text-amber-200'"
            @click="toggleReplace(p.id)"
          >
            replace
          </button>
          <button class="text-[11px] text-red-300 hover:text-red-200" @click="toggleDelete(p.id)">
            delete
          </button>
        </span>
      </div>

      <!-- replace form: there is no read path, so rotation = re-entry -->
      <div v-if="replacingId === p.id" class="mt-2 flex items-center gap-2">
        <input
          v-model="replaceKey"
          type="password"
          autocomplete="off"
          spellcheck="false"
          placeholder="new key — replaces the stored one"
          class="w-80 rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-100"
          @keydown.enter="submitReplace(p.id)"
        />
        <button
          class="rounded bg-sky-600 px-2 py-1 text-[11px] text-white hover:bg-sky-500 disabled:opacity-40"
          :disabled="!replaceKey || replaceBusy"
          @click="submitReplace(p.id)"
        >
          Replace key
        </button>
        <button class="text-[11px] text-neutral-400 hover:text-neutral-200" @click="toggleReplace(p.id)">
          Cancel
        </button>
        <span v-if="replaceError" class="min-w-0 truncate text-[11px] text-red-400" :title="replaceError">
          {{ replaceError }}
        </span>
      </div>

      <!-- inline delete confirmation (never window.confirm) -->
      <div v-if="deleteConfirmId === p.id" class="mt-2 rounded bg-neutral-900/80 p-2 ring-1 ring-neutral-700">
        <p class="text-[11px] text-neutral-300">
          Delete credential profile <span class="text-neutral-100">{{ p.label }}</span>? The stored
          key is destroyed; launches naming this profile will fail.
        </p>
        <div class="mt-2 flex items-center justify-end gap-2">
          <span v-if="deleteError" class="mr-auto min-w-0 truncate text-[11px] text-red-400" :title="deleteError">
            {{ deleteError }}
          </span>
          <button class="text-[11px] text-neutral-400 hover:text-neutral-200" @click="toggleDelete(p.id)">
            Cancel
          </button>
          <button
            class="rounded bg-red-700 px-3 py-1 text-[11px] text-white hover:bg-red-600 disabled:opacity-40"
            :disabled="deleteBusy"
            @click="confirmDelete(p.id)"
          >
            Delete credential
          </button>
        </div>
      </div>
    </div>

    <!-- per-provider "+ credential" affordance -->
    <div class="border-t border-neutral-800/60 px-4 py-2">
      <button
        v-if="!addOpen"
        class="text-[11px] text-neutral-400 hover:text-neutral-200"
        @click="toggleAdd"
      >
        + credential
      </button>

      <div v-else class="mt-1">
        <p class="text-[11px] text-neutral-500">
          The key is encrypted with Windows DPAPI and never leaves this machine. Chorus can never
          show it back to you — pick a label you will recognize later.
        </p>
        <div class="mt-2 flex items-center gap-2">
          <input
            v-model="label"
            placeholder='e.g. "Anthropic — personal"'
            maxlength="120"
            class="w-56 rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-100"
          />
          <input
            v-model="keyValue"
            type="password"
            autocomplete="off"
            spellcheck="false"
            placeholder="paste the key"
            class="w-80 rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-100"
            @keydown.enter="submitAdd"
          />
          <button
            class="rounded bg-sky-600 px-2 py-1 text-[11px] text-white hover:bg-sky-500 disabled:opacity-40"
            :disabled="!label || !keyValue || addBusy"
            @click="submitAdd"
          >
            Add credential
          </button>
          <button class="text-[11px] text-neutral-400 hover:text-neutral-200" @click="toggleAdd">
            Cancel
          </button>
        </div>
        <p v-if="addError" class="mt-1 text-[11px] text-red-400">{{ addError }}</p>
      </div>
    </div>
  </div>
</template>

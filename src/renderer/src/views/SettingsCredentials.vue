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

/* ---- test-key (Task 3-6, spec §7): the ONLY caller of the auth probe.
 *  One test at a time; the result is a per-row {ok, message} rendered
 *  inline and cleared when a new test starts. The message is either the
 *  fixed success text or main's sanitized reason — verbatim, never
 *  enriched, never interpolated with secret material. */
const testingId = ref<string | null>(null)
const testResult = ref<{ id: string; ok: boolean; message: string } | null>(null)

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

async function testProfile(id: string): Promise<void> {
  if (testingId.value) return
  testingId.value = id
  testResult.value = null // a new test clears the previous row's result
  try {
    const reason = await settings.testProfile(id)
    // Success: the store's reload has already refreshed lastVerifiedAt, so
    // the row's own "verified …" text is authoritative — the message below
    // is a fixed confirmation. Failure: main's sanitized reason, VERBATIM.
    testResult.value =
      reason === null
        ? { id, ok: true, message: 'verified just now' }
        : { id, ok: false, message: reason }
  } finally {
    testingId.value = null
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
    <p v-if="profiles.length === 0 && !addOpen" class="set-empty">
      No credentials yet. Stored keys are write-only — they can be replaced but never read back.
    </p>

    <!-- credential rows: label · auth method · verified · state · actions.
         ⚠ NO key-hint column — the design mock's masked hint is D33-forbidden.
         The mock renders `sk-ant-…Xq4F` in this exact position and 3c-5
         deliberately does not: clause 3 admits no exception, and there is no
         .set-row-hint class in settings.css so there is nowhere to put one.
         The rest of the row IS the mock's — its rhythm, its rule, its hover. -->
    <div v-for="p in profiles" :key="p.id" class="set-row-block">
      <div class="set-row">
        <span class="set-row-name w-40 shrink-0 truncate" :title="p.label">{{ p.label }}</span>
        <span class="set-row-detail w-32 shrink-0 truncate">{{ authLabel }}</span>
        <span
          class="w-32 shrink-0"
          :class="p.lastVerifiedAt ? 'set-row-ok' : 'set-meta'"
        >
          {{ p.lastVerifiedAt ? `verified ${rel(p.lastVerifiedAt)}` : 'never verified' }}
        </span>
        <!-- F-5a: an unavailable mark clears ONLY on a successful replace —
             render it as a distinct, actionable state, not a healthy row
             with a subtitle. The dot reuses the pane-header `exited`
             vocabulary, now on the state token rather than a stock red. -->
        <span v-if="p.unavailableSince" class="set-chip set-chip-err min-w-0 flex-1">
          <span class="set-chip-dot"></span>
          unavailable since {{ rel(p.unavailableSince) }} — re-enter the credential
        </span>
        <span v-else class="set-meta min-w-0 flex-1" :title="`added ${p.createdAt}`">
          added {{ rel(p.createdAt) }}
        </span>
        <button class="set-action" :disabled="testingId !== null" @click="testProfile(p.id)">
          {{ testingId === p.id ? 'testing…' : 'test' }}
        </button>
        <button
          class="set-action"
          :class="p.unavailableSince && 'set-action-attention'"
          @click="toggleReplace(p.id)"
        >
          replace
        </button>
        <button class="set-action set-action-danger" @click="toggleDelete(p.id)">delete</button>
      </div>

      <!-- test-key result: fixed success text or main's sanitized reason,
           rendered verbatim -->
      <div
        v-if="testResult && testResult.id === p.id"
        class="truncate px-4 pb-2"
        :class="testResult.ok ? 'set-ok' : 'set-error'"
        :title="testResult.message"
      >
        {{ testResult.message }}
      </div>

      <!-- replace form: there is no read path, so rotation = re-entry -->
      <div v-if="replacingId === p.id" class="flex items-center gap-2 px-4 pb-2">
        <input
          v-model="replaceKey"
          type="password"
          autocomplete="off"
          spellcheck="false"
          placeholder="new key — replaces the stored one"
          class="set-input w-80"
          @keydown.enter="submitReplace(p.id)"
        />
        <button class="set-btn-primary" :disabled="!replaceKey || replaceBusy" @click="submitReplace(p.id)">
          Replace key
        </button>
        <button class="set-action" @click="toggleReplace(p.id)">Cancel</button>
        <span v-if="replaceError" class="set-error min-w-0 truncate" :title="replaceError">
          {{ replaceError }}
        </span>
      </div>

      <!-- inline delete confirmation (never window.confirm) -->
      <div v-if="deleteConfirmId === p.id" class="mx-4 mb-2 set-confirm">
        <p class="set-note">
          Delete credential profile <span class="set-strong">{{ p.label }}</span>? The stored key is
          destroyed; launches naming this profile will fail.
        </p>
        <div class="mt-2 flex items-center justify-end gap-2">
          <span v-if="deleteError" class="set-error mr-auto min-w-0 truncate" :title="deleteError">
            {{ deleteError }}
          </span>
          <button class="set-action" @click="toggleDelete(p.id)">Cancel</button>
          <button class="set-btn-danger" :disabled="deleteBusy" @click="confirmDelete(p.id)">
            Delete credential
          </button>
        </div>
      </div>
    </div>

    <!-- per-provider "+ credential" affordance -->
    <div class="set-row-block px-4 py-2">
      <button v-if="!addOpen" class="set-pill" @click="toggleAdd">+ credential</button>

      <div v-else>
        <p class="set-note">
          The key is encrypted with Windows DPAPI and never leaves this machine. Chorus can never
          show it back to you — pick a label you will recognize later.
        </p>
        <div class="mt-2 flex items-center gap-2">
          <input
            v-model="label"
            placeholder='e.g. "Anthropic — personal"'
            maxlength="120"
            class="set-input w-56"
          />
          <input
            v-model="keyValue"
            type="password"
            autocomplete="off"
            spellcheck="false"
            placeholder="paste the key"
            class="set-input w-80"
            @keydown.enter="submitAdd"
          />
          <button class="set-btn-primary" :disabled="!label || !keyValue || addBusy" @click="submitAdd">
            Add credential
          </button>
          <button class="set-action" @click="toggleAdd">Cancel</button>
        </div>
        <p v-if="addError" class="set-error mt-1">{{ addError }}</p>
      </div>
    </div>
  </div>
</template>

<style src="../assets/settings.css"></style>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { JevStatus } from '../../../shared/ipc'

const status = ref<JevStatus | null>(null)
const key = ref('') // Local input only; never store or read a saved key back.
const busy = ref(false)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const confirmingRemove = ref(false)
let alive = true
onBeforeUnmount(() => { alive = false; key.value = '' })

async function refresh(): Promise<void> {
  const next = await window.chorus.getJevStatus()
  if (alive) status.value = next
}
onMounted(async () => {
  try { await refresh() }
  catch { if (alive) error.value = 'Could not load JEV settings. Reopen Settings to try again.' }
})

async function act(action: 'save' | 'remove' | 'test'): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = null
  notice.value = null
  try {
    const result = action === 'save' ? await window.chorus.saveJevKey(key.value)
      : action === 'remove' ? await window.chorus.removeJevKey()
        : await window.chorus.testJevKey()
    if (!alive) return
    if (!result.ok) { error.value = result.reason; return }
    if (action !== 'test') key.value = ''
    confirmingRemove.value = false
    notice.value = action === 'save' ? 'API key saved.'
      : action === 'remove' ? 'API key removed.' : 'Connection verified — JEV returned a valid answer.'
    await refresh()
  } catch {
    if (alive) error.value = 'Could not complete the JEV action. Try again.'
  } finally {
    if (alive) busy.value = false
  }
}
</script>

<template>
  <div class="set-page max-w-4xl">
    <div class="set-head">
      <h1 class="set-title">JEV AI</h1>
      <span class="set-subtitle">TypeSafe structured decisions</span>
    </div>
    <div class="set-card p-4">
      <h2 class="set-section-title">API key</h2>
      <p class="set-hint mt-2">Connect your TypeSafe account to use JEV for choices, scoring and yes/no evaluations.</p>
      <p class="set-note mt-2">The saved key is available to Chorus API calls. Coding agents do not receive it automatically.</p>
      <p class="set-note mt-2">Your key is encrypted on this machine with Windows DPAPI. It can be replaced or removed, but never displayed again. API requests send it securely to TypeSafe.</p>
      <p v-if="!status && !error" class="set-blank mt-3">Loading…</p>
      <template v-if="status">
        <p class="mt-3" :class="status.configured ? 'set-ok' : 'set-meta'">{{ status.configured ? 'API key saved' : 'No API key saved' }}</p>
        <p v-if="!status.encryptionAvailable" class="set-error mt-2">Windows encryption is unavailable. A key cannot be saved.</p>
        <form class="mt-4 flex flex-wrap items-end gap-3" @submit.prevent="act('save')">
          <label class="set-field-label flex-1 min-w-0">
            {{ status.configured ? 'Replacement API key' : 'TypeSafe API key' }}
            <input v-model="key" type="password" autocomplete="off" spellcheck="false" maxlength="8192"
              class="set-input mt-1 w-full" placeholder="Paste your API key" :disabled="busy || !status.encryptionAvailable" />
          </label>
          <button type="submit" class="set-btn-primary" :disabled="busy || !key.trim() || !status.encryptionAvailable">{{ status.configured ? 'Replace key' : 'Save key' }}</button>
        </form>
        <div v-if="status.configured" class="mt-4 flex items-center gap-3">
          <button class="set-pill" :disabled="busy || !!key" @click="act('test')">{{ busy ? 'Working…' : 'Test connection' }}</button>
          <button class="set-action set-action-danger" :disabled="busy" @click="confirmingRemove = !confirmingRemove">Remove key</button>
        </div>
        <p class="set-note mt-2">Test connection sends a small fixed sample to JEV using the saved key and may use API credits. Saving a key makes no API call.</p>
        <div v-if="confirmingRemove" class="set-confirm mt-3">
          <p class="set-note">Remove the stored JEV API key?</p>
          <div class="mt-2 flex justify-end gap-3">
            <button class="set-action" :disabled="busy" @click="confirmingRemove = false">Cancel</button>
            <button class="set-btn-danger" :disabled="busy" @click="act('remove')">Remove key</button>
          </div>
        </div>
      </template>
      <p v-if="error" role="alert" class="set-error mt-3">{{ error }}</p>
      <p v-if="notice" role="status" class="set-ok mt-3">{{ notice }}</p>
    </div>
  </div>
</template>

<style src="../assets/settings.css"></style>

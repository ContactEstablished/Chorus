<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH } from '../../../shared/ipc'

/**
 * Agent lock settings (v16): set, change, or remove the PIN asked for when
 * unlocking an agent.
 *
 * ⚠ THIS SCREEN IS HONEST ABOUT WHAT THE LOCK IS, AND THAT COPY IS PART OF THE
 * FEATURE RATHER THAN DECORATION. The PIN can be removed here WITHOUT entering
 * it (Matthew's decision: "it can be set and unset without any other
 * security"), which means it is a guard against your own mis-aimed click and
 * not a guard against another person at this keyboard. A settings screen that
 * showed a PIN field, a lock icon and no caveat would imply the second, and a
 * user could reasonably rely on it. So the page says so in plain words.
 * `agentLockCore.ts` carries the same argument for the next implementer.
 *
 * ⚠ THERE IS NO READ PATH AND NO MASKED HINT, the D33 clause 3 posture this
 * settings surface already takes with API keys (see settings.css's header on
 * why `sk-ant-…Xq4F` is deliberately absent). The renderer learns ONE bit —
 * whether a PIN exists — and the stored scrypt digest never crosses the bridge.
 * "Forgot it" therefore means "remove it and set a new one", which is exactly
 * what the Remove button is for and why it needs no PIN.
 */

/** Main's one bit. Re-read after every mutation rather than predicted, the
 *  `setModelShortlisted` discipline: the rendered state is never this
 *  component's optimistic guess about what it just sent. */
const hasPin = ref(false)
const loading = ref(true)

const pin = ref('')
const confirmPin = ref('')
const busy = ref(false)
const error = ref<string | null>(null)
/** Cleared on the next action; the one piece of positive feedback this page
 *  gives, because nothing else on it visibly changes when a PIN is replaced. */
const notice = ref<string | null>(null)

/** F13: the view can unmount while a call is in flight — set before the first
 *  await, checked after every one. */
let alive = true

onMounted(async () => {
  await refresh()
})

onBeforeUnmount(() => {
  alive = false
  // A ref on an unmounted component is garbage eventually, not immediately —
  // explicit clearing shortens the window at zero cost. Same reasoning, and the
  // same comment, as SettingsCredentials' key refs.
  pin.value = ''
  confirmPin.value = ''
})

async function refresh(): Promise<void> {
  try {
    const res = await window.chorus.getAgentLockPinStatus()
    if (!alive) return
    hasPin.value = res.hasPin
  } catch (e) {
    if (!alive) return
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    if (alive) loading.value = false
  }
}

/**
 * ⚠ THE CONFIRM FIELD IS CHECKED HERE, IN THE RENDERER, AND THAT IS THE RIGHT
 * PLACE FOR IT — the one rule on this page that legitimately does not belong in
 * main. "You typed two different things" is a fact about this FORM, not about
 * the stored value; main receives one PIN and has no second string to compare
 * it against. Every rule about the PIN ITSELF (length, whitespace) is enforced
 * in main by `validatePin` and merely echoed here.
 */
async function save(): Promise<void> {
  if (busy.value) return
  error.value = null
  notice.value = null
  if (pin.value !== confirmPin.value) {
    error.value = 'Those two PINs do not match.'
    return
  }
  busy.value = true
  try {
    const res = await window.chorus.setAgentLockPin(pin.value)
    if (!alive) return
    if (!res.ok) {
      error.value = res.reason // verbatim from main
      return
    }
    notice.value = hasPin.value ? 'PIN changed.' : 'PIN set.'
    pin.value = ''
    confirmPin.value = ''
    await refresh()
  } catch (e) {
    if (alive) error.value = e instanceof Error ? e.message : String(e)
  } finally {
    if (alive) busy.value = false
  }
}

/** Two-step, the WorktreePanel inline idiom — never window.confirm. */
const confirmingRemove = ref(false)

async function remove(): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = null
  notice.value = null
  try {
    const res = await window.chorus.clearAgentLockPin()
    if (!alive) return
    if (!res.ok) {
      error.value = res.reason
      return
    }
    confirmingRemove.value = false
    // ⚠ Says what actually happened, including the part a user might assume
    // otherwise: removing the PIN does NOT unlock anything (storage.ts).
    notice.value = 'PIN removed. Locked agents stay locked — unlocking now takes one confirm.'
    await refresh()
  } catch (e) {
    if (alive) error.value = e instanceof Error ? e.message : String(e)
  } finally {
    if (alive) busy.value = false
  }
}
</script>

<template>
  <div class="set-page max-w-4xl">
    <div class="set-head">
      <h1 class="set-title">Agent lock</h1>
      <span class="set-subtitle">a deliberate pause before an agent is stopped or closed</span>
    </div>

    <div class="set-card p-4">
      <h2 class="set-section-title">Unlock PIN</h2>

      <p class="set-hint mt-2">
        Locking an agent stops it being killed or closed, and stops its project being archived or
        deleted, until you unlock it. With a PIN set, unlocking asks for it; without one, unlocking
        takes a single confirm.
      </p>

      <!-- ⚠ THE CAVEAT IS NOT BURIED. See this component's header: the PIN is
           removable from this page without entering it, so the feature guards
           against your own slip and not against another person. Saying it
           plainly is cheaper than a user relying on something untrue. -->
      <p class="set-hint set-hint-warn mt-2">
        This is an accident guard, not a security control — the PIN can be removed on this screen
        without entering it, and Chorus never shows or recovers a forgotten one.
      </p>

      <div v-if="loading" class="set-blank mt-3">Loading…</div>

      <template v-else>
        <div class="mt-4 flex items-end gap-3">
          <label class="set-field-label">
            {{ hasPin ? 'New PIN' : 'PIN' }}
            <input
              v-model="pin"
              type="password"
              autocomplete="new-password"
              :maxlength="PIN_MAX_LENGTH"
              :placeholder="`${PIN_MIN_LENGTH}+ characters`"
              class="set-input set-input-sm mt-1"
              @keydown.enter.prevent="save"
            />
          </label>
          <label class="set-field-label">
            Confirm
            <input
              v-model="confirmPin"
              type="password"
              autocomplete="new-password"
              :maxlength="PIN_MAX_LENGTH"
              class="set-input set-input-sm mt-1"
              @keydown.enter.prevent="save"
            />
          </label>
          <button
            class="set-btn-primary"
            :disabled="busy || pin.length === 0 || confirmPin.length === 0"
            @click="save"
          >
            {{ hasPin ? 'Change PIN' : 'Set PIN' }}
          </button>
        </div>

        <div v-if="hasPin" class="set-row mt-4">
          <span class="set-row-name">A PIN is set</span>
          <span class="set-row-detail">unlocking an agent asks for it</span>
          <span class="flex-1"></span>
          <template v-if="confirmingRemove">
            <span class="set-row-warn mr-2">Remove it?</span>
            <button class="set-action set-action-danger" :disabled="busy" @click="remove">
              Remove PIN
            </button>
            <button class="set-action" :disabled="busy" @click="confirmingRemove = false">
              Cancel
            </button>
          </template>
          <button v-else class="set-action set-action-danger" @click="confirmingRemove = true">
            Remove
          </button>
        </div>

        <p v-if="error" class="set-hint set-hint-warn mt-3">{{ error }}</p>
        <p v-else-if="notice" class="set-hint mt-3">{{ notice }}</p>
      </template>
    </div>
  </div>
</template>

<style src="../assets/settings.css"></style>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ModelCombobox from '../components/ModelCombobox.vue'
import { useSettingsStore } from '../stores/settings'
import {
  DEFAULT_VOICE_SETTINGS,
  type ModelCatalogEntry,
  type VoiceHotkeyStatus,
  type VoiceModelStatus,
  type VoiceRefinementMode,
  type VoiceSettings
} from '../../../shared/ipc'

/**
 * Voice & dictation settings (Phase 5, Task 5-4) — the first real occupant of
 * the section the mock draws and `SettingsView.vue` withheld under D76.
 *
 * ⚠ THE DISCLOSURE LIVES WHERE THE MODE IS CHOSEN, NOT BURIED (VoicePlan §5).
 * Clean up and Organize send the transcript TEXT to a model on the user's own
 * key — the moment refinement is enabled, what was said leaves the machine.
 * That is a disclosure obligation and it is stated beside the mode picker,
 * where the choice is made. Verbatim + local whisper is the offline floor and
 * is ONE setting change away from anything else on this page.
 *
 * ⚠ THE PAGE RENDERS WHAT MAIN STORED, NEVER ITS OWN DRAFT. `draft` is edited
 * here; `saved` is what came back from `voice:settings-set`, and every read of
 * "current state" (the hotkey status, the model status, the "unsaved changes"
 * flag) is against `saved`. An unparseable hotkey comes back `ok:false` with
 * the UNCHANGED stored settings, and the page shows main's reason verbatim.
 *
 * ⚠ THE MICROPHONE LABEL STAYS IN THIS PROCESS. `enumerateDevices()` exposes
 * device labels once the microphone has been granted (F79 recorded that
 * Electron does); they are shown here so a person can pick a device, and only
 * the opaque per-origin `deviceId` is ever sent to main. Nothing here logs or
 * forwards a label.
 */

const settings = useSettingsStore()

const loading = ref(true)
const saving = ref(false)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)

/** What main has stored — the source of truth for everything rendered as fact. */
const saved = ref<VoiceSettings>({ ...DEFAULT_VOICE_SETTINGS })
/** What the user is editing. Diverges from `saved` until Save. */
const draft = ref<VoiceSettings>({ ...DEFAULT_VOICE_SETTINGS })

const hotkeyStatus = ref<VoiceHotkeyStatus | null>(null)
const modelStatus = ref<VoiceModelStatus[]>([])
const devices = ref<Array<{ deviceId: string; label: string }>>([])
const devicesError = ref<string | null>(null)

/** The hotkey box: a text field plus an on/off switch. Off stores `null`. */
const hotkeyEnabled = ref(true)
const hotkeyText = ref(DEFAULT_VOICE_SETTINGS.hotkey ?? '')

/** The refiner picker, in the day-report shape: a credential + a model id. */
const refinerProfileId = ref('')
const refinerModelId = ref('')

/** F13: the view can unmount while a call is in flight. */
let alive = true

const dirty = computed(() => JSON.stringify(assembleDraft()) !== JSON.stringify(saved.value))

const modelSizeLabel = (bytes: number): string => `${Math.round(bytes / 1_048_576)} MB`

const modelRow = (id: VoiceSettings['model']): VoiceModelStatus | undefined =>
  modelStatus.value.find((m) => m.id === id)

const modelStateText = (id: VoiceSettings['model']): string => {
  const row = modelRow(id)
  if (!row) return ''
  if (row.state === 'ready') return 'installed'
  if (row.state === 'wrong-size') return 'incomplete on disk — re-downloads on next use'
  return `downloads on first use (${modelSizeLabel(row.bytes)})`
}

/** Suggestions for the chosen profile's provider — a FREE-TEXT combobox, never
 *  a closed select (D48/D56, as the provider screen and the day report do). */
const refinerModelOptions = computed<ModelCatalogEntry[]>(() => {
  const profile = settings.profiles.find((p) => p.id === refinerProfileId.value)
  if (profile === undefined) return []
  return (settings.modelsByProvider[profile.providerId]?.models ?? []).filter((m) => m.missingSince === null)
})

const savedRefinerLabel = computed(() => {
  const r = saved.value.refiner
  if (r === null) return null
  const profile = settings.profiles.find((p) => p.id === r.credentialProfileId)
  return `${r.modelId} · ${profile?.label ?? 'a deleted credential'}`
})

/** A network mode with no model behind it inserts verbatim and says so. */
const modeNeedsModel = computed(() => draft.value.refinement !== 'verbatim' && assembleDraft().refiner === null)

const modeDescriptions: Record<VoiceRefinementMode, { name: string; detail: string }> = {
  verbatim: {
    name: 'Verbatim',
    detail: 'Exactly what the recogniser heard. No network, no key, no model — works offline.'
  },
  cleanup: {
    name: 'Clean up',
    detail: 'Removes filler words and false starts, fixes obvious mis-hearings, adds punctuation. Changes nothing else.'
  },
  organize: {
    name: 'Organize',
    detail: 'Everything Clean up does, plus sentences, paragraphs and bullets where you clearly listed things.'
  }
}

function assembleDraft(): VoiceSettings {
  const refiner =
    refinerProfileId.value !== '' && refinerModelId.value.trim() !== ''
      ? { credentialProfileId: refinerProfileId.value, modelId: refinerModelId.value.trim() }
      : null
  return {
    ...draft.value,
    hotkey: hotkeyEnabled.value ? hotkeyText.value.trim() : null,
    refiner
  }
}

function adopt(next: VoiceSettings): void {
  saved.value = next
  draft.value = { ...next }
  hotkeyEnabled.value = next.hotkey !== null
  hotkeyText.value = next.hotkey ?? DEFAULT_VOICE_SETTINGS.hotkey ?? ''
  refinerProfileId.value = next.refiner?.credentialProfileId ?? ''
  refinerModelId.value = next.refiner?.modelId ?? ''
}

async function loadAll(): Promise<void> {
  try {
    const [res, hk, models] = await Promise.all([
      window.chorus.getVoiceSettings(),
      window.chorus.getVoiceHotkeyStatus(),
      window.chorus.getVoiceModelStatus()
    ])
    if (!alive) return
    adopt(res.settings)
    hotkeyStatus.value = hk
    modelStatus.value = models.models
  } catch (e) {
    if (!alive) return
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    if (alive) loading.value = false
  }
}

/**
 * The microphones this renderer can see. Labels appear only once the
 * microphone has been granted at least once; before that Chromium hands back
 * empty strings, and the list shows a numbered placeholder rather than
 * nothing. Nothing here leaves the renderer.
 */
async function loadDevices(): Promise<void> {
  try {
    const all = await navigator.mediaDevices.enumerateDevices()
    if (!alive) return
    devices.value = all
      .filter((d) => d.kind === 'audioinput' && d.deviceId !== '')
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }))
    devicesError.value = null
  } catch (e) {
    if (!alive) return
    devicesError.value = e instanceof Error ? e.name : 'could not list microphones'
  }
}

/** The stored device may have been unplugged; say so rather than silently
 *  showing the default as selected. */
const savedDeviceMissing = computed(
  () => saved.value.inputDeviceId !== null && !devices.value.some((d) => d.deviceId === saved.value.inputDeviceId)
)

async function save(): Promise<void> {
  if (saving.value) return
  saving.value = true
  error.value = null
  notice.value = null
  try {
    const res = await window.chorus.setVoiceSettings(assembleDraft())
    if (!alive) return
    // ⚠ MAIN'S STORED SETTINGS EITHER WAY — a refused save re-renders what is
    // actually in force, not the rejected draft.
    if (!res.ok) {
      error.value = res.reason ?? 'Main refused the settings.'
      saved.value = res.settings
      return
    }
    adopt(res.settings)
    notice.value = res.reason ?? 'Saved.'
    hotkeyStatus.value = await window.chorus.getVoiceHotkeyStatus()
  } catch (e) {
    if (alive) error.value = e instanceof Error ? e.message : String(e)
  } finally {
    if (alive) saving.value = false
  }
}

function revert(): void {
  adopt(saved.value)
  error.value = null
  notice.value = null
}

onMounted(async () => {
  await Promise.all([settings.load(), loadAll(), loadDevices()])
  if (!alive) return
  // Model suggestions for the refiner picker come from the last catalog
  // refresh — a read, never a key-bearing refresh (the provider screen's rule).
  for (const p of settings.providers) void settings.loadModels(p.id)
  navigator.mediaDevices.addEventListener?.('devicechange', onDeviceChange)
})

function onDeviceChange(): void {
  void loadDevices()
}

onBeforeUnmount(() => {
  alive = false
  navigator.mediaDevices.removeEventListener?.('devicechange', onDeviceChange)
})

// Choosing a different credential clears a model id that belonged to another
// provider's catalog; the combobox is free text, so a stale id would otherwise
// be sent to the wrong provider.
watch(refinerProfileId, (next, prev) => {
  if (prev !== '' && next !== prev) refinerModelId.value = ''
})
</script>

<template>
  <div class="set-page max-w-4xl">
    <div class="set-head">
      <h1 class="set-title">Voice &amp; dictation</h1>
      <span class="set-subtitle">hold a key, talk, and the words land at the pane you were pointing at</span>
    </div>

    <div v-if="loading" class="set-blank">Loading…</div>

    <template v-else>
      <!-- ── Activation ─────────────────────────────────────────────── -->
      <div class="set-card p-4">
        <h2 class="set-section-title">Push-to-talk</h2>
        <p class="set-hint mt-2">
          A system-wide key: hold it while another program owns the screen, speak, let go. Nothing
          is ever sent — the text stops on the input line and you press Enter yourself. Every pane
          also has a microphone button that needs no key at all.
        </p>

        <div class="mt-4 flex items-end gap-3">
          <label class="set-field-label">
            Activation
            <select v-model="draft.activation" class="set-select set-select-sm mt-1" data-voice-activation>
              <option value="hold">Hold to talk — release to stop</option>
              <option value="toggle">Press to start, press again to stop</option>
            </select>
          </label>
          <label class="set-field-label">
            Hotkey
            <input
              v-model="hotkeyText"
              type="text"
              class="set-input set-input-sm set-mono mt-1"
              :disabled="!hotkeyEnabled"
              placeholder="Ctrl+Shift+Space"
              spellcheck="false"
              data-voice-hotkey
              @keydown.enter.prevent="save"
            />
          </label>
          <label class="set-field-label flex items-center gap-2" style="padding-bottom: 6px">
            <input v-model="hotkeyEnabled" type="checkbox" data-voice-hotkey-enabled />
            <span>Global hotkey on</span>
          </label>
        </div>
        <p class="set-hint mt-2">
          One of <span class="set-mono">ScrollLock</span>, <span class="set-mono">Insert</span>,
          <span class="set-mono">F8</span>–<span class="set-mono">F12</span>,
          <span class="set-mono">Space</span>, <span class="set-mono">Tab</span> or
          <span class="set-mono">Escape</span>, alone or with modifiers — e.g.
          <span class="set-mono">ScrollLock</span> or <span class="set-mono">Ctrl+Shift+Space</span>.
          The key still reaches whatever app is in front, so avoid ones other programs use
          (Ctrl+R reloads a browser; Ctrl+D closes a terminal). Turning the hotkey off removes
          the system-wide keyboard hook entirely; the microphone button keeps working.
        </p>
        <label class="set-field-label mt-3 flex items-center gap-2">
          <input v-model="draft.autoStop" type="checkbox" data-voice-autostop />
          <span>Stop automatically after 5 minutes</span>
        </label>
        <p class="set-hint mt-1">
          On, a forgotten toggle or a stuck key cannot hold the microphone open: the capture ends
          at five minutes and what was said is transcribed. Off, audio past five minutes is
          dropped and the microphone stays open until you stop it.
        </p>

        <div v-if="hotkeyStatus" class="set-row mt-3">
          <span class="set-row-name">Right now</span>
          <span v-if="hotkeyStatus.available" class="set-chip set-chip-ok">
            <span class="set-chip-dot"></span>listening for {{ hotkeyStatus.chord }}
          </span>
          <span v-else-if="hotkeyStatus.chord === null" class="set-chip set-chip-idle">
            <span class="set-chip-dot"></span>off
          </span>
          <span v-else class="set-chip set-chip-warn">
            <span class="set-chip-dot"></span>unavailable
          </span>
          <span v-if="!hotkeyStatus.available && hotkeyStatus.chord !== null" class="set-row-detail">
            {{ hotkeyStatus.reason }} — click-to-talk is unaffected
          </span>
        </div>

        <div class="mt-4 flex items-end gap-3">
          <label class="set-field-label flex-1">
            Microphone
            <select v-model="draft.inputDeviceId" class="set-select set-select-sm mt-1 w-full" data-voice-device>
              <option :value="null">System default</option>
              <option v-for="d in devices" :key="d.deviceId" :value="d.deviceId">{{ d.label }}</option>
            </select>
          </label>
        </div>
        <p v-if="devicesError" class="set-hint set-hint-warn mt-2">Could not list microphones ({{ devicesError }}).</p>
        <p v-else-if="savedDeviceMissing" class="set-hint set-hint-warn mt-2">
          The saved microphone is not connected right now; dictation uses the system default until it is.
        </p>
        <p v-else-if="devices.length > 0 && devices.every((d) => d.label.startsWith('Microphone '))" class="set-hint mt-2">
          Names appear after the first dictation grants the microphone.
        </p>
      </div>

      <!-- ── Transcription ──────────────────────────────────────────── -->
      <div class="set-card p-4 mt-4">
        <h2 class="set-section-title">Transcription</h2>
        <p class="set-hint mt-2">
          Speech is recognised on this machine by whisper. Audio never leaves it. The first dictation
          with a model downloads it once.
        </p>
        <div class="set-row-block mt-3">
          <label class="set-row" style="cursor: pointer">
            <input v-model="draft.model" type="radio" value="base.en" data-voice-model="base.en" />
            <span class="set-row-name ml-2">base.en</span>
            <span class="set-row-detail">{{ modelSizeLabel(modelRow('base.en')?.bytes ?? 147_964_211) }} · the default; good for close-mic English dictation</span>
            <span class="flex-1"></span>
            <span class="set-row-detail">{{ modelStateText('base.en') }}</span>
          </label>
          <label class="set-row" style="cursor: pointer">
            <input v-model="draft.model" type="radio" value="small.en" data-voice-model="small.en" />
            <span class="set-row-name ml-2">small.en</span>
            <span class="set-row-detail">{{ modelSizeLabel(modelRow('small.en')?.bytes ?? 487_614_201) }} · more accurate, slower, a much larger download</span>
            <span class="flex-1"></span>
            <span class="set-row-detail">{{ modelStateText('small.en') }}</span>
          </label>
        </div>
      </div>

      <!-- ── Refinement ─────────────────────────────────────────────── -->
      <div class="set-card p-4 mt-4">
        <h2 class="set-section-title">Refinement</h2>
        <p class="set-hint mt-2">
          What happens to the words between the recogniser and the pane. Chosen here, before you
          dictate — once text has landed at a prompt it cannot be taken back.
        </p>

        <div class="set-row-block mt-3">
          <label v-for="(m, key) in modeDescriptions" :key="key" class="set-row" style="cursor: pointer">
            <input v-model="draft.refinement" type="radio" :value="key" :data-voice-mode="key" />
            <span class="set-row-name ml-2">{{ m.name }}</span>
            <span class="set-row-detail">{{ m.detail }}</span>
          </label>
        </div>

        <!-- ⚠ THE DISCLOSURE, WHERE THE MODE IS CHOSEN (VoicePlan §5). Not a
             tooltip, not a footnote, not another page. -->
        <p class="set-hint set-hint-warn mt-3" data-voice-disclosure>
          Clean up and Organize send the transcript text to the model below, on your own key.
          The moment either is selected, what you say leaves this machine. Numbers, names,
          identifiers and quotes are checked against your original words and the original is
          inserted instead if a refinement changed any of them. Verbatim stays offline entirely.
        </p>

        <div class="set-row mt-4">
          <span class="set-row-name">Refinement model</span>
          <span class="set-row-detail">
            {{ savedRefinerLabel ?? 'none — Clean up and Organize insert your original words until one is chosen' }}
          </span>
        </div>
        <div class="mt-3 flex items-end gap-3">
          <label class="set-field-label">
            Credential
            <select v-model="refinerProfileId" class="set-select set-select-sm mt-1" data-voice-refiner-credential>
              <option value="">None</option>
              <option v-for="p in settings.profiles" :key="p.id" :value="p.id">{{ p.label }}</option>
            </select>
          </label>
          <label class="set-field-label flex-1">
            Model
            <ModelCombobox
              v-model="refinerModelId"
              :options="refinerModelOptions"
              class="mt-1 w-full"
              placeholder='search, or type e.g. "anthropic/claude-haiku-4.5"'
              :empty-hint="`${refinerModelOptions.length} ids from the last refresh — type to search`"
            />
          </label>
        </div>
        <p class="set-hint mt-2">
          A dictation is a few hundred tokens and you are waiting for it, so a small, fast model is
          the right choice — it is tidying your own sentence, not thinking about it. Good picks:
          <span class="set-mono">anthropic/claude-haiku-4.5</span>,
          <span class="set-mono">google/gemini-2.5-flash-lite</span>,
          <span class="set-mono">openai/gpt-4.1-nano</span>. Avoid reasoning models (Gemini 3.x,
          o-series, DeepSeek R1, anything "-thinking"): they spend the reply's token budget
          thinking, the text comes back cut off, and your original words are inserted instead.
          Refinement gives up after 20 seconds and inserts your original words.
        </p>
        <p v-if="modeNeedsModel" class="set-hint set-hint-warn mt-2" data-voice-needs-model>
          {{ modeDescriptions[draft.refinement].name }} needs a refinement model. Until one is chosen
          and saved, dictation is inserted verbatim.
        </p>
      </div>

      <!-- ── Save ───────────────────────────────────────────────────── -->
      <div class="mt-4 flex items-center gap-3">
        <button class="set-btn-primary" :disabled="saving || !dirty" data-voice-save @click="save">
          {{ saving ? 'Saving…' : 'Save changes' }}
        </button>
        <button v-if="dirty" class="set-action" :disabled="saving" @click="revert">Revert</button>
        <span v-if="dirty" class="set-hint">Unsaved changes — settings apply on save, without a restart.</span>
        <p v-if="error" class="set-hint set-hint-warn" data-voice-error>{{ error }}</p>
        <p v-else-if="notice" class="set-hint" data-voice-notice>{{ notice }}</p>
      </div>
    </template>
  </div>
</template>

<style src="../assets/settings.css"></style>

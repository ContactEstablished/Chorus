<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { DEFAULT_APPEARANCE_SETTINGS } from '../../../shared/ipc'
import {
  UI_ZOOM_DEFAULT_PERCENT,
  UI_ZOOM_MAX_PERCENT,
  UI_ZOOM_MIN_PERCENT,
  UI_ZOOM_STEP_PERCENT
} from '../../../shared/uiZoom'

/**
 * Appearance: the text size — a whole-app zoom on a 5% ladder (`uiZoom.ts`).
 *
 * ⚠ APPLIED ON RELEASE (`change`), NOT WHILE DRAGGING (`input`). The slider is
 * inside the page it zooms: applying mid-drag rescales the track under the
 * pointer, the thumb jumps away from the cursor, and the next pointer move sets
 * a different value — a feedback loop. The number beside the slider follows the
 * drag; the window follows the release. Arrow keys on the focused slider fire
 * `change` per press, so the keyboard nudges one step at a time.
 *
 * ⚠ NO SAVE BUTTON, UNLIKE THE OTHER SECTIONS. A size is judged by looking at
 * it, so it applies (and is stored) immediately, like a browser's zoom.
 * Ctrl+= / Ctrl+- / Ctrl+0 change the same value from anywhere; main pushes
 * those changes here so this screen never shows a stale number.
 */

/** What main has stored — and therefore what the window is drawn at. */
const saved = ref(DEFAULT_APPEARANCE_SETTINGS.zoomPercent)
/** The slider's position. Ahead of `saved` only during a drag. */
const draft = ref(DEFAULT_APPEARANCE_SETTINGS.zoomPercent)
const loading = ref(true)
const error = ref<string | null>(null)

/** F13: the view can unmount while a call is in flight. */
let alive = true
let unsubscribe: (() => void) | null = null

function adopt(zoomPercent: number): void {
  saved.value = zoomPercent
  draft.value = zoomPercent
}

async function commit(zoomPercent: number): Promise<void> {
  if (zoomPercent === saved.value) return
  error.value = null
  try {
    const res = await window.chorus.setAppearanceSettings({ zoomPercent })
    if (!alive) return
    adopt(res.settings.zoomPercent)
  } catch (e) {
    if (!alive) return
    error.value = e instanceof Error ? e.message : String(e)
    draft.value = saved.value
  }
}

onMounted(async () => {
  unsubscribe = window.chorus.onAppearanceSettingsChanged((event) => adopt(event.settings.zoomPercent))
  try {
    const res = await window.chorus.getAppearanceSettings()
    if (!alive) return
    adopt(res.settings.zoomPercent)
  } catch (e) {
    if (!alive) return
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    if (alive) loading.value = false
  }
})

onBeforeUnmount(() => {
  alive = false
  unsubscribe?.()
})
</script>

<template>
  <div class="set-page max-w-4xl">
    <div class="set-head">
      <h1 class="set-title">Appearance</h1>
      <span class="set-subtitle">how large Chorus draws everything</span>
    </div>

    <div v-if="loading" class="set-blank">Loading…</div>

    <div v-else class="set-card p-4">
      <h2 class="set-section-title">Text size</h2>
      <p class="set-hint mt-2">
        Scales all of Chorus together — terminal panes, the project rail, pane headers and dialogs —
        in {{ UI_ZOOM_STEP_PERCENT }}% steps. It applies as soon as you let go of the slider and is
        remembered across restarts.
      </p>

      <div class="mt-4 flex items-center gap-3">
        <span class="set-row-detail">{{ UI_ZOOM_MIN_PERCENT }}%</span>
        <input
          v-model.number="draft"
          type="range"
          class="set-range flex-1"
          :min="UI_ZOOM_MIN_PERCENT"
          :max="UI_ZOOM_MAX_PERCENT"
          :step="UI_ZOOM_STEP_PERCENT"
          aria-label="Text size"
          data-appearance-zoom
          @change="commit(draft)"
        />
        <span class="set-row-detail">{{ UI_ZOOM_MAX_PERCENT }}%</span>
        <span class="set-zoom-value" data-appearance-zoom-value>{{ draft }}%</span>
        <button
          class="set-action"
          :disabled="saved === UI_ZOOM_DEFAULT_PERCENT"
          data-appearance-zoom-reset
          @click="commit(UI_ZOOM_DEFAULT_PERCENT)"
        >
          Reset to {{ UI_ZOOM_DEFAULT_PERCENT }}%
        </button>
      </div>

      <p class="set-hint mt-3">
        From anywhere in Chorus: <span class="set-keycap">Ctrl</span> <span class="set-keycap">=</span> larger,
        <span class="set-keycap">Ctrl</span> <span class="set-keycap">-</span> smaller,
        <span class="set-keycap">Ctrl</span> <span class="set-keycap">0</span> back to
        {{ UI_ZOOM_DEFAULT_PERCENT }}%.
      </p>
      <p v-if="error" class="set-hint set-hint-warn mt-2" data-appearance-error>{{ error }}</p>
    </div>
  </div>
</template>

<style src="../assets/settings.css"></style>

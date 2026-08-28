<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import type { CapturedPromptDto } from '../../../shared/ipc'
import { formatPromptAge } from '../promptAge'

const props = defineProps<{ sessionId: string; label: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const prompts = ref<CapturedPromptDto[] | null>(null)
const failed = ref(false)
const copiedIndex = ref<number | null>(null)
/** Stamped once when the overlay opens. The ages are relative to the moment
 *  you looked; a ticking clock would redraw the list under a reader for a
 *  change of one minute in a panel that is open for seconds. */
const openedAt = new Date()
let copiedTimer: ReturnType<typeof setTimeout> | undefined

/**
 * ⚠ ESC IS BOUND ON `window`, NOT ON THE SCRIM, AND THAT IS A DELIBERATE
 * DEPARTURE FROM THE OTHER OVERLAYS. The house idiom — `@keydown` on the
 * scrim — has a known failure recorded against it: a mousedown landing on
 * anything non-focusable blurs to `<body>`, which is OUTSIDE the scrim, and Esc
 * silently stops working for the rest of the overlay's life (`CommandPalette`
 * carries the fix; `LaunchDialog` and `WorktreePanel` still carry the defect).
 * This panel's body is SELECTABLE PROSE — dragging across a prompt to copy part
 * of it is a thing users will do here and nowhere else — so it would meet that
 * failure by design rather than by accident, and the usual fix
 * (preventDefault on mousedown) is precisely what would break the selection.
 *
 * App's capture-phase global handler binds no Escape, so nothing is stolen.
 */
function onWindowKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.stopPropagation()
    emit('close')
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onWindowKeydown)
  try {
    const res = await window.chorus.sessionPrompts(props.sessionId)
    prompts.value = res.prompts
  } catch {
    // Main answers this out of memory with no I/O, so a rejection means the
    // session is gone or the bridge is down. Say that, rather than showing an
    // empty list — which would read as "you never asked it anything".
    failed.value = true
    prompts.value = []
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', onWindowKeydown)
  clearTimeout(copiedTimer)
})

async function copy(prompt: CapturedPromptDto, index: number): Promise<void> {
  try {
    await navigator.clipboard.writeText(prompt.text)
    copiedIndex.value = index
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      copiedIndex.value = null
    }, 1400)
  } catch {
    // Nothing to announce: the text is on screen and selectable, so a failed
    // copy costs a convenience, not the feature.
  }
}
</script>

<template>
  <div class="overlay-scrim overlay-scrim-dialog" @mousedown.self="emit('close')">
    <div class="overlay-panel overlay-panel-dialog ph-panel" role="dialog" aria-modal="true">
      <div class="overlay-header ph-header">
        <div class="ph-heading">
          <span class="overlay-eyebrow">Prompts you've sent</span>
          <span class="ph-target">{{ props.label }}</span>
        </div>
        <span class="ph-spacer" />
        <span class="overlay-keycap">esc</span>
      </div>

      <div class="overlay-body ph-body">
        <p v-if="prompts === null" class="ph-note">Reading…</p>
        <p v-else-if="failed" class="ph-note">This session is no longer available.</p>
        <p v-else-if="prompts.length === 0" class="ph-note">
          Nothing sent from Chorus to this agent yet. The history starts when you do — it is
          not saved between runs of the app.
        </p>
        <ol v-else class="ph-list">
          <li v-for="(prompt, i) in prompts" :key="`${prompt.at}-${i}`" class="ph-row">
            <div class="ph-row-head">
              <span class="ph-age">{{ formatPromptAge(prompt.at, openedAt) }}</span>
              <span v-if="i === 0" class="ph-latest">latest</span>
              <span class="ph-spacer" />
              <button type="button" class="ph-copy" aria-label="Copy this prompt" @click="copy(prompt, i)">
                {{ copiedIndex === i ? 'Copied' : 'Copy' }}
              </button>
            </div>
            <p class="ph-text">{{ prompt.text }}</p>
          </li>
        </ol>
      </div>

      <div class="overlay-footer ph-footer">
        <!-- The bound, stated where it is relevant rather than only in the
             decision: this is reconstructed from what Chorus SENT, so it covers
             typing, pasting and dictation, and does not cover what the agent's
             own TUI filled in on your behalf. -->
        <span class="ph-foot-text">
          Captured from what Chorus sent this session — typed, pasted or dictated.
        </span>
      </div>
    </div>
  </div>
</template>

<style src="../assets/overlays.css"></style>

<style scoped>
/* Every value here is a 3c-1 token — no raw hex, the same rule TerminalPane's
   own style block states and keeps. */
.ph-panel {
  width: min(720px, calc(100vw - 96px));
}

.ph-header {
  padding: 12px 16px;
}

.ph-heading {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.ph-target {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--color-text-body);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ph-spacer {
  flex: 1;
}

.ph-body {
  padding: 6px 16px 12px;
}

.ph-note {
  padding: 18px 0 14px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-text-quiet);
  max-width: 52ch;
}

.ph-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.ph-row {
  padding: 12px 0;
  border-bottom: 1px solid var(--color-border-panel);
}

.ph-row:last-child {
  border-bottom: none;
}

.ph-row-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.ph-age {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-text-quiet);
}

/* The newest row is the answer to "what is it working on now"; the rest are
   context. A quiet label rather than a different type size, so the list stays
   one scannable column. */
.ph-latest {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-accent-jade);
  border: 1px solid color-mix(in srgb, var(--color-accent-jade) 35%, transparent);
  border-radius: var(--radius-chip);
  padding: 1px 5px;
}

.ph-copy {
  flex: none;
  font-family: var(--font-sans);
  font-size: 11px;
  color: var(--color-text-tertiary);
  background: var(--color-surface-field);
  border: 1px solid var(--color-border-badge);
  border-radius: var(--radius-icon);
  padding: 2px 8px;
  cursor: pointer;
}

.ph-copy:hover {
  color: var(--color-text-body);
  background: var(--color-surface-icon-hover);
}

/* `pre-wrap` because a prompt's own line breaks are part of what was sent — a
   multi-line prompt collapsed onto one line is a different thing to read.
   `overflow-wrap` so a pasted path or URL cannot widen the panel. */
.ph-text {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.55;
  color: var(--color-text-body);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
}

.ph-footer {
  padding: 9px 16px;
}

.ph-foot-text {
  font-size: 11px;
  color: var(--color-text-eyebrow);
}
</style>

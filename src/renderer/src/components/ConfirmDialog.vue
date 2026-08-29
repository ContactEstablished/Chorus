<script setup lang="ts">
/**
 * "Are you sure?" — the shared confirm modal.
 *
 * ⚠ IT EXISTS TO REPLACE `window.confirm`, WHICH BLOCKS THE RENDERER THREAD —
 * the same reason the pane's unlock prompt and clean-removal offer are inline
 * surfaces rather than native dialogs. It is presentation only: it owns no
 * action, resolves no promise and knows nothing about sessions. The caller
 * renders it with `v-if`, reads `@confirm` / `@cancel`, and does the work.
 *
 * ⚠ THE MARK IS PART OF THE DIALOG, not chrome bolted on top (Matthew, this
 * session: "I would like for it to be a part of that window"). It sits IN the
 * body, on the baseline of the question, so the panel reads as Chorus asking —
 * which is the point of interrupting someone mid-flow with a modal at all.
 *
 * Anatomy — scrim, panel, footer rule, both buttons — is `overlays.css`, the
 * same set the palette, the launch dialog and the worktree panel use. Nothing
 * here re-derives a colour or a radius.
 */
import { onMounted, ref } from 'vue'
import ChorusMark from './ChorusMark.vue'

withDefaults(
  defineProps<{
    /** The question. One line, and it must END IN A QUESTION MARK — the body
     *  below explains the consequence, this asks the thing. */
    title: string
    /** What actually happens if they say yes. Written as consequence, never as
     *  a restatement of the button label. */
    message: string
    /** The jade button's verb. Defaults to OK; every caller should say the
     *  actual verb instead ("Kill session"), because a user who reads only the
     *  buttons must still know which one acts. */
    confirmLabel?: string
  }>(),
  { confirmLabel: 'OK' }
)

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

const panel = ref<HTMLDivElement | null>(null)
const cancelBtn = ref<HTMLButtonElement | null>(null)

/**
 * ⚠ CANCEL TAKES THE FOCUS, NOT THE JADE BUTTON, AND THAT IS THE WHOLE POINT.
 * This dialog is a speed bump in front of verbs that end a running agent; if
 * Enter confirmed it, the reflex that fires the keystroke would sail straight
 * through the gate the dialog was added to provide. The jade button still reads
 * as primary — it is the one you MEAN to press — it just has to be pressed.
 *
 * It is also what makes the scrim's `@keydown` fire at all: the handler is on
 * the scrim, so something inside it must hold the keyboard.
 */
onMounted(() => cancelBtn.value?.focus())

/** Basic focus trap: Tab/Shift-Tab cycle within the panel; Esc cancels.
 *  Matched to LaunchDialog's, deliberately — a second, subtly different trap
 *  in the same app is how one of them ends up broken. */
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    emit('cancel')
    return
  }
  if (e.key !== 'Tab' || !panel.value) return
  const focusables = Array.from(panel.value.querySelectorAll<HTMLElement>('button:not([disabled])'))
  if (focusables.length === 0) return
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  const active = document.activeElement
  if (e.shiftKey && active === first) {
    last.focus()
    e.preventDefault()
  } else if (!e.shiftKey && active === last) {
    first.focus()
    e.preventDefault()
  }
}
</script>

<template>
  <!-- ⚠ `@click.self` ON THE SCRIM CANCELS. A modal you cannot dismiss by
       clicking away from is a trap, and this one guards nothing secret. The
       `.self` matters: a click that started on the panel must not bubble up
       and cancel the thing the user is reading. -->
  <div class="overlay-scrim overlay-scrim-confirm" @keydown="onKeydown" @click.self="emit('cancel')">
    <div
      ref="panel"
      class="overlay-panel overlay-panel-dialog confirm"
      role="alertdialog"
      aria-modal="true"
      :aria-label="title"
    >
      <div class="confirm-body">
        <!-- The mark, at 30px: large enough to read as the logo, small enough
             that the question stays the loudest thing in the panel. Static —
             `animated` is the splash's alone, and a logo that re-ran an
             entrance animation every time you clicked Kill would turn a
             warning into a flourish. -->
        <ChorusMark :height="30" class="confirm-mark" />
        <div class="confirm-copy">
          <p class="confirm-title">{{ title }}</p>
          <p class="confirm-message">{{ message }}</p>
        </div>
      </div>

      <div class="overlay-footer confirm-foot">
        <span class="overlay-note confirm-hint">esc cancels</span>
        <button ref="cancelBtn" type="button" class="overlay-btn-ghost" @click="emit('cancel')">
          Cancel
        </button>
        <button type="button" class="overlay-btn-primary" @click="emit('confirm')">
          {{ confirmLabel }}
        </button>
      </div>
    </div>
  </div>
</template>

<style src="../assets/overlays.css"></style>

<style scoped>
/* Centred rather than top-anchored: the launch dialog and the palette are
   places you GO, so they hang from the top of the window like a sheet; this is
   an interruption of whatever you were looking at, and it belongs over it. The
   scrim alpha is the dialog one — a third value would have been invented for
   no reason (see overlays.css on the two that already exist). */
.overlay-scrim-confirm {
  background: rgb(5 6 8 / 0.55);
  align-items: center;
}

.confirm {
  width: 380px;
  max-width: calc(100vw - 48px);
}

/* Mark and copy share a row, top-aligned so the mark sits on the question's
   line rather than floating beside a paragraph of unknown height. */
.confirm-body {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 18px 18px 16px;
}

/* Lifted so the mark's own centre line sits on the QUESTION's, not on the top
   of the copy block: it is 30px tall against a 14px title, so `flex-start`
   alone leaves it visibly low and reads as a second paragraph rather than as
   the thing asking. */
.confirm-mark {
  margin-top: -5px;
}

/* ⚠ THIS DIALOG'S CANCEL IS FOCUSED ON MOUNT, so it is the one control whose
   focus ring the user gets without having asked for it — and Chromium's
   default is a bright orange-yellow, the one foreign colour in a panel of jade
   and graphite. (ProjectRail and CouncilView style their own `:focus-visible`
   for the same reason; there is no app-wide rule to inherit.)
   ⚠ AND IT IS DELIBERATELY NOT JADE. Cancel holds the focus when this opens,
   so a jade ring would put two jade shapes in the footer and undo the one
   thing the two buttons are meant to say at a glance: the green one acts. */
.confirm :focus-visible {
  outline: 2px solid var(--color-text-secondary);
  outline-offset: 2px;
}

.confirm-copy {
  min-width: 0;
}

.confirm-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.confirm-message {
  margin-top: 6px;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--color-text-secondary);
}

.confirm-foot {
  justify-content: flex-end;
  padding: 11px 14px;
}

/* Pushes both buttons right and keeps the keycap hint out of their gap. */
.confirm-hint {
  margin-right: auto;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--color-text-quiet);
}
</style>

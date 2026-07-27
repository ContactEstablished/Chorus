<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * The custom titlebar (Task 3c-2 / D74).
 *
 * `frame: false` removed the native window frame, so this 36px bar IS the
 * window chrome: the chorus glyph and wordmark at the left, a drag region
 * across the middle, and minimize / maximize-restore / close at the right.
 * Geometry and colour are read from the `<!-- ══ titlebar ══ -->` block of
 * docs/design/v2/Chorus Workspace.dc.html (D73 — the mock is the authority),
 * and every value is a 3c-1 token: this file contains no raw hex, which a
 * grep gate asserts.
 *
 * ⚠ IT IS WINDOW CHROME, NOT WORKSPACE CHROME. App.vue mounts it above the
 * view switcher, so it renders in all three views (workspace | settings |
 * council). A titlebar that vanished on the settings screen would leave that
 * screen with no way to close the window.
 *
 * ⚠ WHAT THIS COMPONENT DOES **NOT** IMPLEMENT, DELIBERATELY. Dragging,
 * double-click-to-maximize, snapping (Win+←/→, drag-to-edge) and resizing from
 * every edge and corner are all given by Windows itself: `-webkit-app-region:
 * drag` buys the first two and a frameless Electron window keeps its resize
 * border and snap behaviour by default. They are VERIFIED here, not written.
 * If one of them ever appears broken, the cause is almost always a renderer
 * element covering the window edge — the fix is CSS, never a manual hit-test.
 */

const maximized = ref(false)

/**
 * F13 listener discipline (the `CouncilView.vue:35–50` house pattern):
 * subscribed on mount, released on unmount, never leaked. The preload's
 * forwarder hands back its own unsubscribe.
 */
let unsubscribe: (() => void) | null = null

onMounted(() => {
  unsubscribe = window.chorus.onWindowMaximizedChanged((event) => {
    maximized.value = event.maximized
  })
})

onBeforeUnmount(() => {
  unsubscribe?.()
  unsubscribe = null
})

/**
 * ⚠ `false` IS THE CORRECT SEED, AND IT IS NOT AN ASSUMPTION. The app never
 * boots maximized: `persistBounds` saves `getNormalBounds()`, which is a
 * maximized window's RESTORED size, so a relaunch always comes back restored.
 * Every route into the maximized state therefore happens after this component
 * has mounted and subscribed — the button below, a double-click, Win+↑, or an
 * OS snap — and each of them fires `window:maximized-changed`. There is no
 * moment where a maximized window is looking at an unmounted titlebar, so no
 * fifth "read the current state" channel is needed to close a gap. (In dev, an
 * HMR reload while maximized re-seeds `false` until the next state change; that
 * is a dev-only artefact of reloading the renderer under a live window.)
 */
async function onToggleMaximize(): Promise<void> {
  // Settle the icon from the RETURNED state rather than by flipping the local
  // boolean: the window is the authority on whether the toggle took, and the
  // event below would only correct a wrong guess a frame later.
  const result = await window.chorus.toggleMaximizeWindow()
  maximized.value = result.maximized
}

// Thin wrappers rather than `window.chorus.…` inline in the template: Vue 3
// resolves template identifiers against the component instance plus a fixed
// globals allowlist, and `window` is not on it.
function onMinimize(): void {
  void window.chorus.minimizeWindow()
}

function onClose(): void {
  void window.chorus.closeWindow()
}
</script>

<template>
  <div class="titlebar" data-testid="titlebar">
    <!-- Left group. It drags too: the mock's bar is draggable everywhere the
         controls are not, and a wordmark that refused to move the window would
         read as a dead zone. -->
    <div class="titlebar-brand titlebar-drag">
      <!-- The six-bar chorus glyph, at the mock's exact geometry: 20×14, bars
           2px wide at x = 0 / 3.6 / 7.2 / 10.8 / 14.4 / 18, rx 1, heights
           4 / 8 / 12 / 14 / 8 / 4 vertically centred. ⚠ THE FOURTH BAR IS THE
           JADE ONE — it is the tallest and the only coloured one, and the glyph
           reads as a different mark if it moves. -->
      <svg width="20" height="14" viewBox="0 0 20 14" aria-hidden="true">
        <rect x="0" y="5" width="2" height="4" rx="1" fill="var(--color-logo-bar-low)" />
        <rect x="3.6" y="3" width="2" height="8" rx="1" fill="var(--color-logo-bar-mid)" />
        <rect x="7.2" y="1" width="2" height="12" rx="1" fill="var(--color-logo-bar-high)" />
        <rect x="10.8" y="0" width="2" height="14" rx="1" fill="var(--color-accent-jade)" />
        <rect x="14.4" y="3" width="2" height="8" rx="1" fill="var(--color-logo-bar-mid)" />
        <rect x="18" y="5" width="2" height="4" rx="1" fill="var(--color-logo-bar-low)" />
      </svg>
      <span class="titlebar-wordmark">chorus</span>
    </div>

    <!-- The drag region proper: everything between the wordmark and the
         controls. Windows gives double-click-to-maximize and drag-to-snap on
         this for free. -->
    <div class="titlebar-drag titlebar-spacer" />

    <div class="titlebar-controls">
      <button
        type="button"
        class="titlebar-control"
        title="Minimize"
        aria-label="Minimize"
        @click="onMinimize"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" stroke-width="1" />
        </svg>
      </button>

      <button
        type="button"
        class="titlebar-control"
        :title="maximized ? 'Restore' : 'Maximize'"
        :aria-label="maximized ? 'Restore' : 'Maximize'"
        @click="onToggleMaximize"
      >
        <!-- Restored: one square. Maximized: the two-square restore glyph. The
             swap is the only thing on this bar that reports window state, which
             is why it is driven by the event and not by the click alone. -->
        <svg v-if="maximized" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path
            d="M3 3V1h6v6H7"
            fill="none"
            stroke="currentColor"
            stroke-width="1"
          />
          <rect x="1" y="3" width="6" height="6" fill="none" stroke="currentColor" stroke-width="1" />
        </svg>
        <svg v-else width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <rect x="1" y="1" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1" />
        </svg>
      </button>

      <button
        type="button"
        class="titlebar-control titlebar-control-close"
        title="Close"
        aria-label="Close"
        @click="onClose"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" stroke-width="1" />
          <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" stroke-width="1" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.titlebar {
  height: 36px;
  flex: none;
  display: flex;
  align-items: center;
  background: var(--color-surface-chrome);
  border-bottom: 1px solid var(--color-border-chrome);
  /* The bar is chrome, not content: a stray double-click must never select the
     wordmark, the way it never selects a native titlebar's text. */
  user-select: none;
}

/* ⚠ BOTH DIRECTIONS MATTER, AND `no-drag` IS NOT OPTIONAL. Inside a drag
   region a button still receives `click` on Windows, but press-and-move moves
   the WINDOW instead of feeling like a button — so a few pixels of mouse drift
   during a click drags the window rather than closing it. */
.titlebar-drag {
  -webkit-app-region: drag;
}

.titlebar-control {
  -webkit-app-region: no-drag;
}

.titlebar-brand {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 14px;
}

.titlebar-wordmark {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.3em;
  color: var(--color-text-muted);
}

.titlebar-spacer {
  flex: 1;
  /* Full height so the draggable area is the whole middle of the bar, not a
     zero-height strip. */
  align-self: stretch;
}

.titlebar-controls {
  display: flex;
  align-items: stretch;
  height: 36px;
}

.titlebar-control {
  width: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-tertiary);
  background: transparent;
  border: 0;
  padding: 0;
  cursor: default;
}

.titlebar-control:hover {
  background: var(--color-surface-titlebar-hover);
  color: var(--color-text-body);
}

/* Close is the one control with its own hover, per the mock and D74. */
.titlebar-control-close:hover {
  background: var(--color-state-close-hover);
  color: var(--color-text-on-close-hover);
}
</style>

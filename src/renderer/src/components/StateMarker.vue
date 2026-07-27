<script setup lang="ts">
/**
 * State marker (Task 3c-1): the four session states as four DISTINCT
 * GEOMETRIES — diamond / circle / triangle / square — so the app stays
 * readable without colour vision. Colour reinforces the shape and is never
 * the only signal; a later surface that renders a state as "the amber one"
 * has broken the contract this component exists to keep.
 *
 * Sizes, fills and glows are read from the filmstrip cards in
 * docs/design/v2/Chorus Workspace.dc.html (D73) — not approximations.
 *
 * ⚠ THIS COMPONENT NEVER ANIMATES. In the mock the chorusPulse animation and
 * its [data-pulse] hook sit on the 88px filmstrip CARD, not on the marker;
 * Task 3c-3 places it there. A marker that pulsed on its own would double up
 * and read as a different design.
 *
 * ⚠ D77 — the runtime proof of this component is OWED BY TASK 3c-3. Task 3c-1
 * restyles nothing, so this is mounted NOWHERE when it ships and there is
 * nothing for CDP to photograph. It is verified here STRUCTURALLY only (four
 * distinct geometries in the rendered output). The colourblind claim itself —
 * all four still distinguishable under filter: grayscale(1) — is 3c-3's
 * grayscale filmstrip screenshot. Same shape as the attention_spans (v7)
 * precedent: written one task before its first caller, with the gap named.
 */
defineProps<{ state: 'needs-you' | 'running' | 'error' | 'done' }>()
</script>

<template>
  <!-- diamond: a square turned 45°. -->
  <span v-if="state === 'needs-you'" class="marker marker-needs-you" />

  <!-- circle: fully rounded. -->
  <span v-else-if="state === 'running'" class="marker marker-running" />

  <!-- triangle: a real <svg> path, not a rotated square — which is what keeps
       it distinguishable from the diamond at 7px. The element-type asymmetry
       with the other three states is the mock's and is deliberate. -->
  <svg
    v-else-if="state === 'error'"
    class="marker marker-error"
    width="11"
    height="10"
    viewBox="0 0 11 10"
  >
    <path d="M5.5 0.5 10.5 9.5H0.5Z" fill="var(--color-state-error)" />
  </svg>

  <!-- square: no rotation, no radius, no glow. -->
  <span v-else class="marker marker-done" />
</template>

<style scoped>
/* flex: none on all four so a marker never shrinks inside a flex row. */
.marker {
  flex: none;
}

.marker-needs-you {
  width: 7px;
  height: 7px;
  background: var(--color-state-attention);
  transform: rotate(45deg);
  box-shadow: 0 0 8px rgb(245 158 11 / 0.6);
}

.marker-running {
  width: 8px;
  height: 8px;
  background: var(--color-state-running);
  border-radius: 50%;
  box-shadow: 0 0 8px rgb(34 197 94 / 0.55);
}

.marker-error {
  filter: drop-shadow(0 0 4px rgb(239 68 68 / 0.6));
}

.marker-done {
  width: 7px;
  height: 7px;
  background: var(--color-state-done);
}
</style>

import { createApp } from 'vue'
import VoiceOverlay from './VoiceOverlay.vue'

/**
 * The dictation overlay's entry point (Task 5-3) — a SECOND renderer entry,
 * with its own tiny bundle.
 *
 * ⚠ NO PINIA AND NO `assets/main.css`. This window is an indicator that floats
 * above every application on the desktop; pulling in the main app's store graph
 * and stylesheet would load the whole application into it. `VoiceOverlay.vue`
 * carries its own scoped styles.
 *
 * ⚠ IT NEVER OPENS THE MICROPHONE. Capture belongs to the main window
 * (`capture.ts`); this window only renders state pushed from main. Two windows
 * both calling `getUserMedia` would be two captures.
 */
createApp(VoiceOverlay).mount('#overlay')

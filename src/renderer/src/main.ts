import './assets/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
/**
 * Task 5-1: voice capture, imported for effect and NOT rendered anywhere.
 *
 * ⚠ WHAT THIS IMPORT ACTUALLY DOES, MEASURED AGAINST THE BUILT BUNDLE RATHER
 * THAN ASSUMED — because the first version of this comment claimed more than was
 * true and `npm run build` disproved it.
 *
 * It puts `capture.ts` in Vite's module graph, which is what makes Vite EMIT
 * `pcm-worklet.js` as a real hashed asset into `out/renderer/assets/`. That much
 * is verified: the file ships, untransformed, and loads over `file://` under the
 * app's own CSP. F80 is the reason it must be a file at all, and this is what
 * guarantees the file is there to be loaded.
 *
 * ⚠ IT DOES NOT KEEP `capture.ts`'s CODE IN THE PRODUCTION BUNDLE, AND THAT IS
 * CORRECT RATHER THAN BROKEN. Nothing in the production graph calls
 * `startCapture` — the hotkey is Task 5-3 and D76 forbids a settings row with
 * nothing behind it — so Rollup shakes the unreachable code and keeps only the
 * `pagehide` listener. Grepping the built bundle for `AudioWorkletNode`,
 * `getUserMedia` and `pcm-capture` returns nothing, by design.
 *
 * The consequence, stated so 5-3 inherits it as a task rather than a surprise:
 * **the packaged-build gate is only half met here.** The asset ships and
 * resolves; the production code path that loads it does not exist yet, so
 * `capture.ts`'s own `?url` reference is exercised in dev only. The first real
 * call site — 5-3's hotkey — is what completes that gate, and it should re-run
 * the packaged check rather than trusting this one.
 *
 * ⚠ IT ADDS NO UI AND NO NAV ROW (D76). There is still nothing behind a Voice
 * settings entry after this task, so none is added.
 */
import './voice/capture'

createApp(App).use(createPinia()).mount('#app')

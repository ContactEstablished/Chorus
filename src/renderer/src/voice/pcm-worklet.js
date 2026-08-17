/**
 * The capture processor (Phase 5, Task 5-1).
 *
 * ⚠ THIS IS A FILE ON PURPOSE, AND IT MUST STAY ONE. F80, measured 2026-08-17
 * under the app's own CSP:
 *
 *     audioWorklet.addModule('./pcm-worklet.js')                       -> OK
 *     audioWorklet.addModule(URL.createObjectURL(new Blob([...])))      -> AbortError, BLOCKED
 *
 * `default-src 'self'` carries no `blob:`, and the phase's purity contract
 * forbids widening the CSP — D1's lesson on its fourth registry (Zod-in-preload
 * `EvalError`, then the missing `connect-src`, then the missing
 * `wasm-unsafe-eval`, now `blob:` worklets): *the answer to "the CSP blocks this
 * library" is to change the code, never the policy.*
 *
 * ⚠ GENERATING THIS SOURCE AS A BLOB AT RUNTIME IS THE COMMON AUDIOWORKLET
 * IDIOM — it is what most examples and several libraries do, because it avoids a
 * build-tool question — SO AN IMPLEMENTER FOLLOWING ORDINARY PRACTICE HITS IT.
 * The failure arrives as a bare `AbortError: Unable to load a worklet's module`
 * naming neither the CSP nor the directive. `capture.ts` imports this path with
 * Vite's `?url` so the bundler emits it as a real asset in both dev and build.
 *
 * ⚠ IT IS PLAIN JS, NOT TS, AND HAS NO IMPORTS. A worklet runs in its own
 * global scope (`AudioWorkletGlobalScope`) where `registerProcessor`,
 * `AudioWorkletProcessor` and `currentFrame` are globals and the DOM is absent.
 * Keeping it import-free is what lets Vite hand the file over untransformed.
 */

/**
 * Samples per frame. 1024 = 64 ms at 16 kHz.
 *
 * ⚠ DUPLICATED FROM `VOICE_FRAME_SAMPLES` IN `shared/ipc.ts`, AND THAT IS
 * FORCED RATHER THAN CHOSEN. A worklet module cannot import — it is loaded by
 * URL into a scope with no module resolution and no bundler pass. The value is
 * asserted against main's own reply in `capture.ts` (`frameSamples`), so a
 * divergence fails loudly at capture start instead of silently producing frames
 * of the wrong size.
 */
const FRAME_SAMPLES = 1024

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    /**
     * The partial frame being filled.
     *
     * ⚠ WEB AUDIO DELIVERS 128 SAMPLES PER CALL AND WILL NOT NEGOTIATE. 1024 is
     * eight of those, so this accumulator exists to turn the fixed render quantum
     * into the frame size the wire wants. Choosing a non-multiple of 128 would
     * mean carrying a partial quantum across frames for no benefit.
     */
    this._buffer = new Float32Array(FRAME_SAMPLES)
    this._filled = 0
    this._stopped = false
    this.port.onmessage = (event) => {
      if (event.data && event.data.type === 'stop') this._stopped = true
    }
  }

  process(inputs) {
    if (this._stopped) return false
    const input = inputs[0]
    // No input connected yet, or a disconnected source: keep the processor alive
    // rather than returning false, which would retire it permanently.
    if (!input || input.length === 0) return true
    // ⚠ CHANNEL 0 ONLY — MONO IS THE CONTRACT, NOT A SIMPLIFICATION. The device
    // reports channelCount 1 (F79 measured it), the AudioContext is constructed
    // mono, and the transcriber expects 16 kHz mono. Summing channels here would
    // silently double the level on a stereo device.
    const channel = input[0]
    if (!channel) return true

    for (let i = 0; i < channel.length; i++) {
      this._buffer[this._filled++] = channel[i]
      if (this._filled === FRAME_SAMPLES) {
        // ⚠ A COPY, NOT A VIEW, AND NOT THE ACCUMULATOR ITSELF. `postMessage`
        // structured-clones the payload, but the accumulator is reused on the
        // very next call — posting it directly would be a live buffer racing the
        // main thread's read. `slice()` on a Float32Array returns a fresh one.
        //
        // ⚠ Float32 CROSSES HERE AND IS CONVERTED TO Int16 ON THE MAIN THREAD
        // (`toInt16`, which CLAMPS rather than wraps). The conversion is 1,024
        // multiplications 16 times a second; doing it here would put it on the
        // audio render thread, where overrunning the quantum's deadline is a
        // dropout rather than a slow frame.
        this.port.postMessage(this._buffer.slice(0))
        this._filled = 0
      }
    }
    return true
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor)

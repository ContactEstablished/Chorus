import { VOICE_SAMPLE_RATE } from '../../shared/ipc'

/**
 * The pure half of local transcription (Task 5-2).
 *
 * ⚠ NO `fs`, NO `child_process`, NO `electron`, NO CLOCK, NO NETWORK. Everything
 * here is decided from its arguments and unit-tested in `whisperCore.test.ts`.
 * The impure half — spawning `whisper-cli.exe`, resolving and downloading the
 * model — lives in `whisper.ts` with every effect injected.
 *
 * ⚠ EVERY FLAG AND EVERY OUTPUT SHAPE IN THIS FILE WAS READ FROM THE BINARY, NOT
 * RECALLED. whisper.cpp v1.9.2, `whisper-bin-x64.zip`, sha256
 * 49dcc16de826f20bd53d44f947a1ae49dfa81f86cad67a64d80820cb192d674a. The captured
 * `--help`, the observed-vs-expected flag table, and the JSON structure are in
 * `_verify/5-2/`. `CLAUDE.md` requires this and D87 is why: `-c` is `--continue`
 * on kimi, not `--config`.
 */

/** whisper-cli is fed exactly what Task 5-1 captures: 16 kHz mono Int16. */
export const WHISPER_SAMPLE_RATE = VOICE_SAMPLE_RATE

/**
 * The models Chorus offers, with the byte counts to validate a download against.
 *
 * ⚠ THE SIZES ARE EXACT `content-length` VALUES READ FROM HUGGINGFACE ON
 * 2026-08-17, NOT ROUNDED MEGABYTES. They are the only thing that distinguishes a
 * complete model from a truncated one, and the spec is explicit that a truncated
 * `base.en` is the nastiest failure here: whisper does not refuse it, it produces
 * plausible garbage — which reads as "voice is inaccurate", not "the download
 * broke".
 *
 * `tiny.en` (77,704,715) and `medium.en` were measured in the same pass and are
 * deliberately NOT offered in v1 — recorded here in prose rather than as entries,
 * because an entry is a thing a settings screen can offer (D76).
 */
export const WHISPER_MODELS = {
  /** D159's default: 3.3x smaller than `small.en` and adequate for close-mic
   *  English dictation, which is the whole v1 use case. */
  'base.en': {
    id: 'base.en' as const,
    fileName: 'ggml-base.en.bin',
    bytes: 147_964_211,
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin'
  },
  /** The opt-in upgrade. Resolved here; CHOSEN in 5-4's settings (D76). */
  'small.en': {
    id: 'small.en' as const,
    fileName: 'ggml-small.en.bin',
    bytes: 487_614_201,
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin'
  }
} as const

export type WhisperModelId = keyof typeof WHISPER_MODELS
export const DEFAULT_WHISPER_MODEL: WhisperModelId = 'base.en'

export function whisperModel(id: WhisperModelId): (typeof WHISPER_MODELS)[WhisperModelId] {
  return WHISPER_MODELS[id]
}

/* ──────────────────────────── WAV assembly ────────────────────────────────── */

const WAV_HEADER_BYTES = 44
const BITS_PER_SAMPLE = 16
const CHANNELS = 1

/**
 * A canonical 44-byte RIFF/WAVE header for 16 kHz mono Int16.
 *
 * ⚠ BOTH SIZE FIELDS ARE LITTLE-ENDIAN AND BOTH COUNT **BYTES**, NOT SAMPLES.
 * Writing `sampleCount` where a byte count belongs yields a file that opens,
 * plays at half length, and transcribes as truncated speech — it fails as a
 * QUALITY problem rather than as an error, which is the hardest kind to trace
 * back to a header.
 */
export function wavHeader(sampleCount: number): Uint8Array {
  if (!Number.isInteger(sampleCount) || sampleCount < 0) {
    throw new Error(`wavHeader: sampleCount must be a non-negative integer, got ${sampleCount}`)
  }
  const dataBytes = sampleCount * (BITS_PER_SAMPLE / 8) * CHANNELS
  const byteRate = WHISPER_SAMPLE_RATE * CHANNELS * (BITS_PER_SAMPLE / 8)
  const blockAlign = CHANNELS * (BITS_PER_SAMPLE / 8)

  const header = new Uint8Array(WAV_HEADER_BYTES)
  const view = new DataView(header.buffer)
  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) header[offset + i] = text.charCodeAt(i)
  }

  ascii(0, 'RIFF')
  // ⚠ "Everything after this field", i.e. total length - 8. NOT the data length.
  view.setUint32(4, 36 + dataBytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size, always 16 for PCM
  view.setUint16(20, 1, true) // format 1 = PCM, uncompressed
  view.setUint16(22, CHANNELS, true)
  view.setUint32(24, WHISPER_SAMPLE_RATE, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, BITS_PER_SAMPLE, true)
  ascii(36, 'data')
  view.setUint32(40, dataBytes, true)
  return header
}

/**
 * Header + samples, as one buffer ready to write.
 *
 * ⚠ A ZERO-LENGTH CAPTURE PRODUCES A VALID **EMPTY** WAV, NOT A MALFORMED ONE.
 * The user who taps the hotkey by accident must get an empty transcript, not a
 * crash. (Measured: whisper-cli given such a file exits 0, prints nothing, and
 * writes no JSON at all — see `parseWhisperJson`'s note on the absent-file case.)
 */
export function buildWav(samples: Int16Array): Uint8Array {
  const header = wavHeader(samples.length)
  const out = new Uint8Array(header.length + samples.length * 2)
  out.set(header, 0)
  // Little-endian on every platform Chorus targets, but written explicitly rather
  // than by aliasing the Int16Array's buffer: an implicit host-endianness
  // dependency in a FILE FORMAT is a bug waiting for a big-endian port.
  const view = new DataView(out.buffer, header.length)
  for (let i = 0; i < samples.length; i++) view.setInt16(i * 2, samples[i], true)
  return out
}

/**
 * Join a capture's frames into one buffer.
 *
 * ⚠ ONE ALLOCATION, AT THE END. Growing a buffer per frame is O(n²) copying, and
 * a two-minute capture is ~1,875 frames — the spec calls out `Buffer.concat`
 * inside the frame loop as something a reviewer should distrust. This sums the
 * lengths first and copies once.
 */
export function concatFrames(frames: ReadonlyArray<Int16Array>): Int16Array {
  let total = 0
  for (const f of frames) total += f.length
  const out = new Int16Array(total)
  let offset = 0
  for (const f of frames) {
    out.set(f, offset)
    offset += f.length
  }
  return out
}

/* ─────────────────────── the speech gate (the F-finding) ──────────────────── */

/** 100 ms at 16 kHz. The window the peak test slides. */
export const SPEECH_WINDOW_SAMPLES = 1_600

/**
 * The RMS a 100 ms window must exceed to count as speech.
 *
 * ⚠ MEASURED, NOT TUNED BY FEEL. Anchors from 2026-08-17:
 *
 *   real speech (`jfk.wav`), loudest 100 ms window   0.38238
 *   real speech (`jfk.wav`), whole file              0.14210
 *   THIS threshold                                   0.01000
 *   live microphone, ambient room, this machine      0.00150  (Task 5-1 gate 4b)
 *   quiet synthetic noise                            0.00053
 *   digital silence                                  0
 *
 * Two orders of magnitude separate live ambient from real speech, so this is not
 * a delicate number: ~7x above measured ambient and ~38x below real speech's
 * loudest window. Anywhere in 0.005–0.02 would behave identically.
 */
export const SPEECH_RMS_THRESHOLD = 0.01

/**
 * The loudest 100 ms window's RMS, normalized to [0, 1].
 *
 * ⚠ A PEAK WINDOW, NOT A WHOLE-FILE RMS, AND THE DIFFERENCE IS THE FEATURE. A
 * real dictation is mostly pause — someone who says one short word in a
 * ten-second capture has a low whole-file RMS and a high peak window. Averaging
 * over the whole capture would discard exactly the shortest, most deliberate
 * utterances, which are the ones a voice feature is most useful for.
 *
 * A capture shorter than one window is measured over whatever it has, so a
 * 40 ms blip is not silently exempt.
 */
export function peakWindowRms(samples: Int16Array): number {
  if (samples.length === 0) return 0
  const window = Math.min(SPEECH_WINDOW_SAMPLES, samples.length)
  let best = 0
  // Half-window hop: a word straddling a window boundary would otherwise be split
  // across two windows and read quieter than it is.
  const hop = Math.max(1, Math.floor(window / 2))
  for (let start = 0; start + window <= samples.length; start += hop) {
    let sum = 0
    for (let i = start; i < start + window; i++) {
      const f = samples[i] / 32768
      sum += f * f
    }
    const rms = Math.sqrt(sum / window)
    if (rms > best) best = rms
  }
  return best
}

/**
 * Is there any speech-level audio in this capture?
 *
 * ⚠ THIS IS THE PRIMARY DEFENCE AGAINST TRANSCRIBING SILENCE, AND IT REPLACES THE
 * MARKER FILTER THE SPEC PROPOSED. Measured 2026-08-17 against v1.9.2 +
 * `base.en`: pure digital silence does NOT transcribe as `[BLANK_AUDIO]` — it
 * transcribes as the word **" you"**, at every duration from 0.3 s to 30 s, and
 * NO flag suppresses it (`-sns`, `-nth 0.9`, `-nth 0.99`, `-nf` were all tried;
 * `[BLANK_AUDIO]` appeared zero times in eleven runs). Full write-up in
 * `_verify/5-2/F-silence-hallucination.md`.
 *
 * So a marker filter would pass every test the spec asks for and still inject
 * "you" into an agent's prompt on every accidental hotkey tap — worse than the
 * marker case, because `[BLANK_AUDIO]` is obviously wrong on sight and "you"
 * reads as something the user might have said.
 *
 * A capture that fails this gate is never handed to whisper at all, which also
 * means an accidental tap costs no process spawn.
 */
export function hasSpeech(samples: Int16Array): boolean {
  return peakWindowRms(samples) >= SPEECH_RMS_THRESHOLD
}

/* ──────────────────────────── argv construction ───────────────────────────── */

export interface WhisperArgsOptions {
  readonly modelPath: string
  readonly wavPath: string
  /** Output path WITHOUT an extension — whisper appends `.json` itself. */
  readonly outputBase: string
  readonly threads?: number
}

/**
 * The argv, every flag read from `whisper-cli.exe --help` (v1.9.2).
 *
 * ⚠ `-oj` WRITES A **FILE**, IT DOES NOT PRINT JSON TO STDOUT. The help text is
 * "output result in a JSON file", paired with `-of FNAME  output file path
 * (without file extension)`. `ImplementationSpec-5-2.md` §0 assumed
 * machine-readable output meant stdout; a stdout JSON parser written from that
 * assumption gets an empty string and no error. The instinct was right, the
 * mechanism is a temp file to read and then delete.
 *
 * ⚠ `-np` IS WHAT MAKES THE OUTPUT USABLE AT ALL, and its behaviour was verified
 * with the streams SEPARATED: stdout becomes the bare transcript, while
 * `load_backend: …` and `read_audio_data: …` go to stderr. Merging the streams
 * makes `-np` look broken; it is not.
 *
 * ⚠ AN ARGUMENT ARRAY, NEVER A SHELL STRING — `git.ts`'s standing rule in this
 * codebase, and the reason paths with spaces need no quoting here.
 */
export function whisperArgs(opts: WhisperArgsOptions): string[] {
  const threads = opts.threads ?? 4
  return [
    '-m',
    opts.modelPath,
    '-f',
    opts.wavPath,
    // English-only models cannot translate or auto-detect; stating it costs
    // nothing and stops a multilingual model from guessing a language later.
    '-l',
    'en',
    // No timestamps: the transcript goes to an agent's prompt, not a subtitle file.
    '-nt',
    // Keep stdout to the result alone. See the note above.
    '-np',
    '-oj',
    '-of',
    opts.outputBase,
    '-t',
    String(threads)
  ]
}

/** The file `-of <base>` causes whisper to write. */
export function whisperJsonPath(outputBase: string): string {
  return `${outputBase}.json`
}

/* ───────────────────────────── output parsing ─────────────────────────────── */

/**
 * whisper's non-speech markers.
 *
 * ⚠ DEFENCE IN DEPTH, NOT THE PRIMARY CONTROL — and that ordering is a measured
 * correction to the spec rather than a preference. v1.9.2 + `base.en` emits NONE
 * of these for silence (see `hasSpeech`). They stay because `small.en` is D159's
 * 5-4 upgrade path and a different model may well behave differently, and because
 * a marker reaching an agent's prompt is a bad enough outcome to keep two
 * defences against. It must not be REPORTED as the silence protection.
 */
const NON_SPEECH_MARKERS = [
  '[BLANK_AUDIO]',
  '[SILENCE]',
  '[MUSIC]',
  '[INAUDIBLE]',
  '[NOISE]',
  '(silence)',
  '(music)',
  '(inaudible)'
]

/**
 * Is this whole transcript nothing but non-speech markers?
 *
 * Case-insensitive, and it only fires when markers are ALL that is left — a
 * genuine sentence that happens to contain a bracketed aside must survive.
 */
export function isNonSpeechOnly(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length === 0) return true
  let remaining = trimmed
  for (const marker of NON_SPEECH_MARKERS) {
    // Global, case-insensitive, literal — the markers contain regex
    // metacharacters (`[`, `(`), so they are removed by split/join rather than
    // by a constructed pattern.
    const lower = remaining.toLowerCase()
    const needle = marker.toLowerCase()
    let idx = lower.indexOf(needle)
    while (idx !== -1) {
      remaining = remaining.slice(0, idx) + remaining.slice(idx + marker.length)
      const nextLower = remaining.toLowerCase()
      idx = nextLower.indexOf(needle)
    }
  }
  // Also drop the bare `[…]` shape the spec names, e.g. `[_BEG_]`.
  remaining = remaining.replace(/\[[^\]]*\]/g, '')
  return remaining.trim().length === 0
}

export interface WhisperResult {
  readonly text: string
  readonly segments: number
}

/**
 * Read the transcript out of whisper's own JSON.
 *
 * The observed shape (v1.9.2, captured in `_verify/5-2/run-a-output.json`):
 *
 *     { "systeminfo": "…", "model": {…}, "params": {…}, "result": {…},
 *       "transcription": [ { "timestamps": {…}, "offsets": {…},
 *                           "text": " And so my fellow Americans, …" } ] }
 *
 * ⚠ THE JSON ALSO CARRIES `params.model`, AN ABSOLUTE FILESYSTEM PATH. Nothing
 * but `transcription[].text` is read, and the raw document must never be logged.
 *
 * ⚠ EVERY SEGMENT'S `text` CARRIES A LEADING SPACE. Joining without care yields
 * doubled spaces mid-sentence, which then reach an agent's prompt.
 */
export function parseWhisperJson(raw: string): WhisperResult {
  let doc: unknown
  try {
    doc = JSON.parse(raw)
  } catch {
    // ⚠ THE UNPARSEABLE BODY IS NOT INCLUDED IN THE ERROR. It is a transcript.
    throw new Error('whisper produced output that was not valid JSON')
  }
  const segments =
    typeof doc === 'object' && doc !== null && Array.isArray((doc as { transcription?: unknown }).transcription)
      ? ((doc as { transcription: unknown[] }).transcription as unknown[])
      : []

  const parts: string[] = []
  for (const segment of segments) {
    const text = (segment as { text?: unknown })?.text
    if (typeof text === 'string' && text.trim().length > 0) parts.push(text.trim())
  }
  const joined = parts.join(' ').replace(/\s+/g, ' ').trim()
  return { text: isNonSpeechOnly(joined) ? '' : joined, segments: segments.length }
}

/**
 * whisper wrote no JSON, and exited 0.
 *
 * ⚠ A LEGAL OUTCOME MEANING "EMPTY", NOT A FAILURE. Measured: given a valid WAV
 * with zero samples, whisper-cli exits 0, prints nothing, and writes no `.json`
 * whatsoever. Treating the absent file as an error would turn an accidental
 * hotkey tap into an error dialog.
 */
export const EMPTY_RESULT: WhisperResult = { text: '', segments: 0 }

/* ─────────────────────────── model file validation ───────────────────────── */

export type ModelState =
  | { readonly state: 'ready' }
  | { readonly state: 'missing' }
  | { readonly state: 'wrong-size'; readonly actual: number; readonly expected: number }

/**
 * Is the model on disk usable?
 *
 * ⚠ "PRESENT" IS NOT "VALID", AND SIZE-ZERO IS NOT THE TEST. The spec is explicit
 * that a truncated 40 MB `base.en` is the nastiest case here: whisper does not
 * politely refuse it, and a partially-valid model produces plausible garbage — a
 * failure that reads as "voice is inaccurate" rather than "the download broke".
 * So the size must match the expected `content-length` EXACTLY, and a mismatch is
 * a re-download rather than a run.
 */
export function modelState(actualBytes: number | null, expectedBytes: number): ModelState {
  if (actualBytes === null) return { state: 'missing' }
  if (actualBytes !== expectedBytes) {
    return { state: 'wrong-size', actual: actualBytes, expected: expectedBytes }
  }
  return { state: 'ready' }
}

/** The `.part` path a download writes to before it is renamed into place. */
export function partialPath(finalPath: string): string {
  return `${finalPath}.part`
}

/**
 * Download progress, clamped and monotonic-safe.
 *
 * ⚠ A MISSING OR ZERO `content-length` YIELDS `null`, NOT `NaN` OR `0`. The spec
 * names "progress computed from a `content-length` that was never checked for
 * presence" as something a reviewer should distrust: `received / 0` is `Infinity`,
 * and a progress bar given `NaN` renders at zero forever while the download is
 * in fact working.
 */
export function downloadProgress(received: number, total: number | null): number | null {
  if (total === null || !Number.isFinite(total) || total <= 0) return null
  return Math.max(0, Math.min(1, received / total))
}

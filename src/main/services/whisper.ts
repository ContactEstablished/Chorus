import { logger } from './logger'
import {
  DEFAULT_WHISPER_MODEL,
  EMPTY_RESULT,
  WHISPER_SAMPLE_RATE,
  buildWav,
  downloadProgress,
  hasSpeech,
  modelState,
  parseWhisperJson,
  partialPath,
  whisperArgs,
  whisperJsonPath,
  whisperModel,
  type ModelState,
  type WhisperModelId,
  type WhisperResult
} from './whisperCore'

/**
 * Local transcription via `whisper-cli.exe` (Task 5-2) — the impure half.
 *
 * ⚠ A CHILD PROCESS, NOT A NATIVE ADDON, AND THAT IS THE RULING RATHER THAN A
 * CONVENIENCE. whisper.cpp ships prebuilt x64 Windows binaries, so there is no
 * `node-gyp`, no source build and **no Electron ABI coupling at all** — this is
 * the `docker` CLI case (D147(d)), not the better-sqlite3 case. It also puts
 * process ownership in main, which is where `CLAUDE.md` wants it, and it is why
 * this task adds zero runtime dependencies.
 *
 * ⚠ NO TRANSCRIPT TEXT IN ANY LOG LINE OR ANY ERROR, AT ANY LEVEL. This is the
 * first code in the app's history to hold a transcript, so this is where the
 * discipline starts. G4's secret-grep cannot see this category — it greps for key
 * SHAPES — so the control is review plus the phase's own grep. Concretely, and
 * measured: **the child's STDOUT IS the transcript** (with `-np`), and its STDERR
 * carries absolute filesystem paths. Neither stream is ever logged. An error says
 * WHICH STAGE failed and HOW LONG the audio was. Never what was said.
 *
 * Every effect is injected so `whisper.test.ts` can drive every failure path with
 * no binary, no model and no network present.
 */

export type WhisperFailureCode =
  | 'binary-missing'
  | 'model-missing'
  | 'model-truncated'
  | 'download-failed'
  | 'download-aborted'
  | 'spawn-failed'
  | 'exit-nonzero'
  | 'timeout'
  | 'bad-output'

export class WhisperError extends Error {
  constructor(
    readonly code: WhisperFailureCode,
    /** A sanitized, author-written detail. ⚠ NEVER transcript text, never the
     *  child's stdout, never a Zod-style echo of the payload. */
    readonly detail: string,
    /** How much audio was involved. A duration is diagnostic and carries no
     *  content — it is the most this class of error may say about the audio. */
    readonly audioSeconds: number | null = null
  ) {
    super(`whisper ${code}: ${detail}`)
    this.name = 'WhisperError'
  }
}

export interface RunProcessResult {
  readonly stdout: string
  readonly stderr: string
}

export interface WhisperDeps {
  /**
   * Where `whisper-cli.exe` lives.
   *
   * ⚠ ONE RESOLVER, BOTH PATHS, AND BOTH PROVEN. Under `electron-vite dev` the
   * binaries sit in the repo at `resources/whisper/`; in a packaged build
   * `extraResources` puts them at `process.resourcesPath/whisper/`. A path that
   * works only in dev is the classic way this ships broken, because every unit
   * test and every dev drive passes. Injected here so the resolver lives in
   * `index.ts` next to `app.isPackaged` and this module stays testable.
   */
  readonly binaryPath: () => string
  /** Directory the model lives in — `userData/models` in production. */
  readonly modelDir: () => string
  /** Directory for the throwaway WAV and JSON of one transcription. */
  readonly tempDir: () => string

  readonly runProcess: (
    binary: string,
    args: string[],
    opts: { cwd: string; timeoutMs: number }
  ) => Promise<RunProcessResult>

  readonly fileSize: (path: string) => Promise<number | null>
  readonly readTextFile: (path: string) => Promise<string>
  readonly writeBinaryFile: (path: string, data: Uint8Array) => Promise<void>
  /**
   * Append one chunk to a file, creating it if absent.
   *
   * ⚠ THE DOWNLOAD STREAMS TO DISK RATHER THAN BUFFERING IN MEMORY, AND DRIVING
   * THE ABORT GATE IS WHAT EXPOSED THE NEED. A first version accumulated every
   * chunk in an array and wrote once at the end: crash-safe by accident (nothing
   * reached the final path), but it held the WHOLE model in RAM — 141 MB for
   * `base.en` and 465 MB for `small.en`, plus the chunk array before the copy —
   * and it made the `.part` file vestigial, existing only for the instant
   * between write and rename. Streaming keeps memory flat and makes `.part` mean
   * what the spec intends: the place an interrupted transfer's bytes live, at a
   * path that is never mistaken for an installed model.
   */
  readonly appendBinaryFile: (path: string, data: Uint8Array) => Promise<void>
  readonly removeFile: (path: string) => Promise<void>
  readonly renameFile: (from: string, to: string) => Promise<void>
  readonly ensureDir: (path: string) => Promise<void>
  /** Injected so the download's failure modes can be driven without a network. */
  readonly fetch: (url: string, init?: { signal?: AbortSignal }) => Promise<Response>
  /** Unique component for this transcription's temp files. */
  readonly newId: () => string
  readonly joinPath: (...parts: string[]) => string
}

export interface TranscribeOptions {
  readonly modelId?: WhisperModelId
  readonly threads?: number
  readonly signal?: AbortSignal
}

export interface TranscribeOutcome {
  readonly text: string
  readonly audioSeconds: number
  /** Set when the audio never reached whisper at all. */
  readonly skipped: 'no-speech' | null
  readonly durationMs: number
}

export type DownloadProgressListener = (p: {
  readonly receivedBytes: number
  readonly totalBytes: number | null
  readonly fraction: number | null
}) => void

export interface WhisperService {
  modelStatus(modelId?: WhisperModelId): Promise<ModelState>
  ensureModel(modelId?: WhisperModelId, onProgress?: DownloadProgressListener, signal?: AbortSignal): Promise<void>
  transcribe(samples: Int16Array, opts?: TranscribeOptions): Promise<TranscribeOutcome>
}

/**
 * How long a transcription may take before it is killed.
 *
 * ⚠ SIZED FROM A MEASUREMENT, NOT A GUESS. `base.en` transcribed 11 s of speech
 * in 0.94 s on this machine — roughly 12x faster than realtime. Task 5-1 bounds a
 * capture at 120 s, so the realistic worst case is ~10 s. Five minutes is
 * therefore ~30x headroom for a slower CPU, and it exists to stop a wedged child
 * hanging the feature forever rather than to be reached.
 */
const TRANSCRIBE_TIMEOUT_MS = 5 * 60 * 1000

/**
 * ⚠ BOUNDED, AND IT HOLDS THE TRANSCRIPT. 120 s of speech is a few KB of text;
 * 16 MB matches `git.ts` and is far beyond anything this can legitimately
 * produce, so hitting it means something is wrong rather than something is long.
 */
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024

export function createWhisperService(deps: WhisperDeps): WhisperService {
  function modelPathFor(id: WhisperModelId): string {
    return deps.joinPath(deps.modelDir(), whisperModel(id).fileName)
  }

  async function statusOf(id: WhisperModelId): Promise<ModelState> {
    const size = await deps.fileSize(modelPathFor(id))
    return modelState(size, whisperModel(id).bytes)
  }

  /**
   * Fetch the model to `.part`, verify, then rename into place.
   *
   * ⚠ DOWNLOAD TO `.part`, RENAME ON SUCCESS — the scrollback mirror's discipline
   * (Task 4a-4), for the same reason: an abort at the FINAL path leaves a file
   * that exists, is the wrong size, and looks installed. Renaming is the only
   * step that makes the model visible, and it happens only after the size checks
   * out.
   */
  async function download(
    id: WhisperModelId,
    onProgress?: DownloadProgressListener,
    signal?: AbortSignal
  ): Promise<void> {
    const model = whisperModel(id)
    const finalPath = modelPathFor(id)
    const partPath = partialPath(finalPath)

    await deps.ensureDir(deps.modelDir())
    // A `.part` from a previous failed attempt is never resumed. Resuming would
    // need a byte-range request and a way to trust what is already on disk, and
    // an appended-to file is exactly the oversized case `modelState` rejects.
    await deps.removeFile(partPath).catch(() => {})

    let response: Response
    try {
      response = await deps.fetch(model.url, { signal })
    } catch (err) {
      // ⚠ OFFLINE IS THE EXPECTED CASE HERE, NOT AN EXCEPTIONAL ONE, and the
      // message must name the size so the user knows what is being asked of
      // their connection. It must NOT be a toast — toasts are proven dead on
      // this machine (ToastEnabled=0).
      throw new WhisperError(
        signal?.aborted ? 'download-aborted' : 'download-failed',
        `could not reach the model host to fetch ${model.fileName} ` +
          `(${Math.round(model.bytes / 1048576)} MB): ${(err as Error).name}`
      )
    }
    if (!response.ok || !response.body) {
      throw new WhisperError(
        'download-failed',
        `model host answered ${response.status} for ${model.fileName}`
      )
    }

    // ⚠ CHECKED FOR PRESENCE BEFORE IT IS DIVIDED BY. A missing content-length
    // yields null progress rather than NaN — a bar given NaN renders at zero
    // forever while the download is in fact working.
    const header = response.headers.get('content-length')
    const totalBytes = header !== null && /^\d+$/.test(header) ? Number(header) : null

    // ⚠ STREAMED TO `.part`, CHUNK BY CHUNK — memory stays flat at one chunk
    // regardless of whether the model is 141 MB or 465 MB. See
    // `appendBinaryFile`'s note for the version this replaced and why.
    let received = 0
    const reader = response.body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          await deps.appendBinaryFile(partPath, value)
          received += value.byteLength
          onProgress?.({
            receivedBytes: received,
            totalBytes,
            fraction: downloadProgress(received, totalBytes)
          })
        }
        if (signal?.aborted) throw new WhisperError('download-aborted', 'cancelled by the user')
      }
    } catch (err) {
      // ⚠ THE `.part` IS REMOVED, AND NOTHING WAS EVER AT THE FINAL PATH. Disk
      // full lands here too: the write throws mid-stream and is cleaned up the
      // same way.
      await deps.removeFile(partPath).catch(() => {})
      if (err instanceof WhisperError) throw err
      throw new WhisperError('download-failed', `the transfer failed: ${(err as Error).name}`)
    }

    // ⚠ VERIFY BEFORE THE RENAME, NOT AFTER. The rename is the ONLY step that
    // makes the model visible under its real name; a size check afterwards would
    // already have published a bad model.
    if (received !== model.bytes) {
      await deps.removeFile(partPath).catch(() => {})
      throw new WhisperError(
        'download-failed',
        `${model.fileName} arrived as ${received} bytes, expected ${model.bytes} — not installed`
      )
    }

    try {
      await deps.renameFile(partPath, finalPath)
    } catch (err) {
      await deps.removeFile(partPath).catch(() => {})
      throw new WhisperError('download-failed', `could not install the model: ${(err as Error).name}`)
    }
    logger.info(
      { model: model.id, bytes: model.bytes },
      '[whisper] model downloaded and verified'
    )
  }

  async function ensure(
    id: WhisperModelId,
    onProgress?: DownloadProgressListener,
    signal?: AbortSignal
  ): Promise<void> {
    const state = await statusOf(id)
    if (state.state === 'ready') return
    if (state.state === 'wrong-size') {
      // ⚠ A TRUNCATED MODEL IS RE-DOWNLOADED, NEVER RUN. whisper does not
      // politely refuse a partial model — it produces plausible garbage, which
      // reads as "voice is inaccurate" rather than "the download broke". The old
      // file is removed first so a failed re-download cannot leave the bad one
      // looking installed.
      logger.info(
        { model: id, actual: state.actual, expected: state.expected },
        '[whisper] model file is the wrong size; re-downloading rather than running it'
      )
      await deps.removeFile(modelPathFor(id)).catch(() => {})
    }
    await download(id, onProgress, signal)
  }

  return {
    modelStatus: (modelId = DEFAULT_WHISPER_MODEL) => statusOf(modelId),

    ensureModel: (modelId = DEFAULT_WHISPER_MODEL, onProgress, signal) =>
      ensure(modelId, onProgress, signal),

    async transcribe(samples: Int16Array, opts: TranscribeOptions = {}): Promise<TranscribeOutcome> {
      const started = Date.now()
      const audioSeconds = samples.length / WHISPER_SAMPLE_RATE
      const modelId = opts.modelId ?? DEFAULT_WHISPER_MODEL

      /**
       * ⚠ THE SPEECH GATE RUNS BEFORE ANYTHING ELSE, AND IT IS NOT AN
       * OPTIMISATION. Measured 2026-08-17: silence does NOT transcribe as
       * `[BLANK_AUDIO]` — it transcribes as the word " you", at every duration,
       * and no whisper-cli flag suppresses it. Without this gate an accidental
       * hotkey tap would put "you" into an agent's prompt. It also means such a
       * tap costs no model load and no process spawn.
       */
      if (!hasSpeech(samples)) {
        logger.info(
          { audioSeconds: Math.round(audioSeconds * 10) / 10 },
          '[whisper] capture held no speech-level audio; not transcribed'
        )
        return { text: '', audioSeconds, skipped: 'no-speech', durationMs: Date.now() - started }
      }

      await ensure(modelId)

      const binary = deps.binaryPath()
      if ((await deps.fileSize(binary)) === null) {
        throw new WhisperError(
          'binary-missing',
          'the bundled whisper engine was not found where this build expects it',
          audioSeconds
        )
      }

      const id = deps.newId()
      const base = deps.joinPath(deps.tempDir(), `chorus-voice-${id}`)
      const wavPath = `${base}.wav`
      const jsonPath = whisperJsonPath(base)

      try {
        await deps.ensureDir(deps.tempDir())
        await deps.writeBinaryFile(wavPath, buildWav(samples))

        const args = whisperArgs({
          modelPath: modelPathFor(modelId),
          wavPath,
          outputBase: base,
          threads: opts.threads
        })

        try {
          // ⚠ THE RESULT IS DELIBERATELY DISCARDED. `stdout` IS the transcript
          // and `stderr` carries absolute paths; the transcript is read from the
          // JSON file instead, so neither stream is bound to a variable that
          // could later be logged by accident.
          await deps.runProcess(binary, args, {
            // The binary's own directory, so its twelve sibling DLLs resolve.
            cwd: deps.binaryPath().replace(/[\\/][^\\/]+$/, ''),
            timeoutMs: TRANSCRIBE_TIMEOUT_MS
          })
        } catch (err) {
          const e = err as { code?: number | null; killed?: boolean; signal?: string | null }
          // Node reports a timeout kill as code=null with killed=true, so `code`
          // alone cannot distinguish it from an ordinary non-zero exit —
          // `git.ts` records the same trap and the bug it caused there.
          const timedOut = e.killed === true || (e.signal !== undefined && e.signal !== null)
          if (timedOut) {
            throw new WhisperError(
              'timeout',
              `the engine did not finish within ${TRANSCRIBE_TIMEOUT_MS / 1000}s and was stopped`,
              audioSeconds
            )
          }
          if (typeof e.code === 'number') {
            // ⚠ stderr IS NOT ATTACHED. It names the audio file's full path.
            throw new WhisperError('exit-nonzero', `the engine exited with code ${e.code}`, audioSeconds)
          }
          throw new WhisperError('spawn-failed', `the engine could not be started: ${(err as Error).name}`, audioSeconds)
        }

        let raw: string | null = null
        try {
          raw = await deps.readTextFile(jsonPath)
        } catch {
          raw = null
        }

        /**
         * ⚠ NO JSON PLUS A CLEAN EXIT MEANS "EMPTY", NOT "FAILED". Measured:
         * given a valid WAV with zero samples, whisper-cli exits 0, prints
         * nothing and writes no `.json` at all. Treating the absent file as an
         * error would turn a very short capture into an error dialog.
         */
        let result: WhisperResult = EMPTY_RESULT
        if (raw !== null) {
          if (raw.length > MAX_OUTPUT_BYTES) {
            throw new WhisperError('bad-output', 'the engine produced an implausibly large result', audioSeconds)
          }
          try {
            result = parseWhisperJson(raw)
          } catch {
            // ⚠ THE BODY IS NOT INCLUDED. It is a transcript.
            throw new WhisperError('bad-output', 'the engine produced output that could not be read', audioSeconds)
          }
        }

        const durationMs = Date.now() - started
        logger.info(
          {
            model: modelId,
            audioSeconds: Math.round(audioSeconds * 10) / 10,
            durationMs,
            segments: result.segments,
            // ⚠ A LENGTH, NOT THE TEXT. Enough to tell "it transcribed nothing"
            // from "it transcribed something" in a log, and nothing more.
            characters: result.text.length
          },
          '[whisper] transcription complete'
        )
        return { text: result.text, audioSeconds, skipped: null, durationMs }
      } finally {
        // ⚠ EVERY EXIT PATH, INCLUDING THE FAILURES. The WAV holds the user's
        // audio and the JSON holds their transcript; leaving either behind would
        // put both on disk indefinitely, which D161 explicitly does not do.
        await deps.removeFile(wavPath).catch(() => {})
        await deps.removeFile(jsonPath).catch(() => {})
      }
    }
  }
}

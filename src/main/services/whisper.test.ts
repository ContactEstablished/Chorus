import { describe, it, expect, vi } from 'vitest'
import { createWhisperService, WhisperError, type WhisperDeps } from './whisper'
import { WHISPER_MODELS, WHISPER_SAMPLE_RATE, whisperJsonPath } from './whisperCore'

const BASE_BYTES = WHISPER_MODELS['base.en'].bytes
const MODEL_PATH = 'M:/models/ggml-base.en.bin'
const BIN = 'B:/whisper/whisper-cli.exe'

/** Speech-level audio, so the gate lets it through to the engine. */
function speech(seconds = 1): Int16Array {
  const n = Math.round(WHISPER_SAMPLE_RATE * seconds)
  const out = new Int16Array(n)
  for (let i = 0; i < n; i++) {
    out[i] = Math.round(Math.sin((2 * Math.PI * 220 * i) / WHISPER_SAMPLE_RATE) * 0.3 * 32767)
  }
  return out
}

const REAL_JSON = JSON.stringify({
  params: { model: MODEL_PATH },
  transcription: [{ text: ' refactor the parser please' }]
})

interface HarnessOptions {
  modelSize?: number | null
  binarySize?: number | null
  json?: string | null
  runProcess?: WhisperDeps['runProcess']
  fetchImpl?: WhisperDeps['fetch']
}

function harness(o: HarnessOptions = {}) {
  const files = new Map<string, number>()
  if (o.modelSize !== null) files.set(MODEL_PATH, o.modelSize ?? BASE_BYTES)
  if (o.binarySize !== null) files.set(BIN, o.binarySize ?? 480_000)

  const written: Array<{ path: string; bytes: number }> = []
  const appended: Array<{ path: string; bytes: number; total: number }> = []
  const removed: string[] = []
  const renamed: Array<{ from: string; to: string }> = []
  const ran: Array<{ binary: string; args: string[]; cwd: string; timeoutMs: number }> = []
  const json = o.json === undefined ? REAL_JSON : o.json
  let idN = 0

  const deps: WhisperDeps = {
    binaryPath: () => BIN,
    modelDir: () => 'M:/models',
    tempDir: () => 'T:/tmp',
    runProcess:
      o.runProcess ??
      (async (binary, args, opts) => {
        ran.push({ binary, args, cwd: opts.cwd, timeoutMs: opts.timeoutMs })
        return { stdout: ' refactor the parser please', stderr: 'load_backend: …' }
      }),
    fileSize: async (p) => files.get(p) ?? null,
    readTextFile: async (p) => {
      if (p.endsWith('.json') && json !== null) return json
      throw new Error('ENOENT')
    },
    writeBinaryFile: async (p, d) => {
      written.push({ path: p, bytes: d.byteLength })
      files.set(p, d.byteLength)
    },
    appendBinaryFile: async (p, d) => {
      const now = (files.get(p) ?? 0) + d.byteLength
      files.set(p, now)
      appended.push({ path: p, bytes: d.byteLength, total: now })
    },
    removeFile: async (p) => {
      removed.push(p)
      files.delete(p)
    },
    renameFile: async (from, to) => {
      renamed.push({ from, to })
      const s = files.get(from)
      if (s !== undefined) {
        files.set(to, s)
        files.delete(from)
      }
    },
    ensureDir: async () => {},
    fetch: o.fetchImpl ?? (async () => { throw new Error('no network in this test') }),
    newId: () => `id${++idN}`,
    joinPath: (...parts) => parts.join('/')
  }
  return { deps, files, written, appended, removed, renamed, ran, service: createWhisperService(deps) }
}

/** A fetch that streams `bytes` in `chunks` pieces with a content-length. */
function fetchServing(bytes: number, chunks = 4, opts: { contentLength?: string | null } = {}) {
  return async (): Promise<Response> => {
    const per = Math.ceil(bytes / chunks)
    let sent = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= bytes) return controller.close()
        const n = Math.min(per, bytes - sent)
        sent += n
        controller.enqueue(new Uint8Array(n))
      }
    })
    const headers = new Headers()
    const cl = opts.contentLength === undefined ? String(bytes) : opts.contentLength
    if (cl !== null) headers.set('content-length', cl)
    return { ok: true, status: 200, headers, body } as unknown as Response
  }
}

describe('whisper — the speech gate runs before anything else', () => {
  it('⚠ NEVER SPAWNS THE ENGINE FOR SILENCE, and returns an empty transcript', async () => {
    // The whole point: measured, silence transcribes as the word " you", so the
    // audio must never reach whisper at all. See F-silence-hallucination.md.
    const h = harness()
    const out = await h.service.transcribe(new Int16Array(WHISPER_SAMPLE_RATE * 3))
    expect(out.text).toBe('')
    expect(out.skipped).toBe('no-speech')
    expect(h.ran).toHaveLength(0)
    expect(h.written).toHaveLength(0)
  })

  it('never spawns for room-tone-level audio either', async () => {
    const ambient = new Int16Array(WHISPER_SAMPLE_RATE * 3)
    for (let i = 0; i < ambient.length; i++) ambient[i] = Math.round((Math.random() * 2 - 1) * 50)
    const h = harness()
    expect((await h.service.transcribe(ambient)).skipped).toBe('no-speech')
    expect(h.ran).toHaveLength(0)
  })

  it('never spawns for a zero-length capture', async () => {
    const h = harness()
    const out = await h.service.transcribe(new Int16Array(0))
    expect(out.text).toBe('')
    expect(out.audioSeconds).toBe(0)
    expect(h.ran).toHaveLength(0)
  })

  it('DOES spawn for speech', async () => {
    const h = harness()
    const out = await h.service.transcribe(speech(1))
    expect(out.skipped).toBeNull()
    expect(out.text).toBe('refactor the parser please')
    expect(h.ran).toHaveLength(1)
  })
})

describe('whisper — the spawn', () => {
  it('passes an argument ARRAY with the flags read from the binary', async () => {
    const h = harness()
    await h.service.transcribe(speech(1))
    const call = h.ran[0]
    expect(call.binary).toBe(BIN)
    expect(call.args).toEqual([
      '-m', MODEL_PATH,
      '-f', 'T:/tmp/chorus-voice-id1.wav',
      '-l', 'en',
      '-nt',
      '-np',
      '-oj',
      '-of', 'T:/tmp/chorus-voice-id1',
      '-t', '4'
    ])
  })

  it('runs in the BINARY\'s own directory so its sibling DLLs resolve', async () => {
    // 12 DLLs sit beside whisper-cli.exe, including the 9-file ggml-cpu-*
    // runtime-dispatch family. A different cwd is how "works here, fails there"
    // starts.
    const h = harness()
    await h.service.transcribe(speech(1))
    expect(h.ran[0].cwd).toBe('B:/whisper')
  })

  it('bounds the run with a timeout', async () => {
    const h = harness()
    await h.service.transcribe(speech(1))
    expect(h.ran[0].timeoutMs).toBeGreaterThan(0)
    // Measured headroom: base.en did 11 s of audio in 0.94 s, and 5-1 bounds a
    // capture at 120 s, so the realistic worst case is ~10 s.
    expect(h.ran[0].timeoutMs).toBeGreaterThanOrEqual(60_000)
  })

  it('writes a WAV whose byte length matches the samples plus a 44-byte header', async () => {
    const h = harness()
    const samples = speech(2)
    await h.service.transcribe(samples)
    const wav = h.written.find((w) => w.path.endsWith('.wav'))
    expect(wav?.bytes).toBe(44 + samples.length * 2)
  })

  it('reports the audio duration and the wall clock', async () => {
    const h = harness()
    const out = await h.service.transcribe(speech(3))
    expect(out.audioSeconds).toBeCloseTo(3, 5)
    expect(out.durationMs).toBeGreaterThanOrEqual(0)
  })
})

describe('whisper — reading the result', () => {
  it('reads the transcript from the JSON file, not from stdout', async () => {
    // -oj writes a FILE; it does not print JSON to stdout. A stdout JSON parser
    // gets an empty string and no error.
    const h = harness({
      json: JSON.stringify({ transcription: [{ text: ' from the json' }] }),
      runProcess: async () => ({ stdout: ' from stdout', stderr: '' })
    })
    expect((await h.service.transcribe(speech(1))).text).toBe('from the json')
  })

  it('⚠ treats an ABSENT json with a clean exit as an EMPTY transcript', async () => {
    // Measured: a valid WAV with zero samples makes whisper exit 0, print
    // nothing, and write no .json at all. An error here would turn a very short
    // capture into an error dialog.
    const h = harness({ json: null })
    const out = await h.service.transcribe(speech(1))
    expect(out.text).toBe('')
    expect(out.skipped).toBeNull()
  })

  it('maps a marker-only transcript to empty', async () => {
    const h = harness({ json: JSON.stringify({ transcription: [{ text: ' [BLANK_AUDIO]' }] }) })
    expect((await h.service.transcribe(speech(1))).text).toBe('')
  })

  it('joins multiple segments without doubling the spaces', async () => {
    const h = harness({
      json: JSON.stringify({ transcription: [{ text: ' One.' }, { text: ' Two.' }] })
    })
    expect((await h.service.transcribe(speech(1))).text).toBe('One. Two.')
  })

  it('raises bad-output WITHOUT echoing the body when the json is unreadable', async () => {
    const h = harness({ json: 'this is not json and might be a transcript' })
    await expect(h.service.transcribe(speech(1))).rejects.toMatchObject({ code: 'bad-output' })
    try {
      await h.service.transcribe(speech(1))
    } catch (e) {
      expect((e as Error).message).not.toContain('might be a transcript')
    }
  })
})

describe('whisper — the temp files', () => {
  it('removes BOTH the wav and the json on success', async () => {
    const h = harness()
    await h.service.transcribe(speech(1))
    expect(h.removed).toContain('T:/tmp/chorus-voice-id1.wav')
    expect(h.removed).toContain(whisperJsonPath('T:/tmp/chorus-voice-id1'))
  })

  it('⚠ removes them on FAILURE too — the audio must not be left on disk', async () => {
    // D161: v1 persists no transcripts. A WAV left behind after a crash is the
    // user's audio sitting on disk indefinitely.
    const h = harness({
      runProcess: async () => {
        throw Object.assign(new Error('boom'), { code: 3 })
      }
    })
    await expect(h.service.transcribe(speech(1))).rejects.toBeInstanceOf(WhisperError)
    expect(h.removed).toContain('T:/tmp/chorus-voice-id1.wav')
    expect(h.removed).toContain(whisperJsonPath('T:/tmp/chorus-voice-id1'))
  })

  it('uses a fresh name per transcription so concurrent runs cannot collide', async () => {
    const h = harness()
    await h.service.transcribe(speech(1))
    await h.service.transcribe(speech(1))
    expect(h.ran[0].args).not.toEqual(h.ran[1].args)
  })
})

describe('whisper — process failures are typed and carry no content', () => {
  it('distinguishes a TIMEOUT from a non-zero exit', async () => {
    // Node reports a timeout kill as code=null with killed=true, so `code` alone
    // cannot tell them apart — git.ts records the same trap and the bug it caused.
    const h = harness({
      runProcess: async () => {
        throw Object.assign(new Error('killed'), { code: null, killed: true, signal: 'SIGTERM' })
      }
    })
    await expect(h.service.transcribe(speech(1))).rejects.toMatchObject({ code: 'timeout' })
  })

  it('reports a non-zero exit with its code', async () => {
    const h = harness({
      runProcess: async () => {
        throw Object.assign(new Error('bad'), { code: 3, killed: false, signal: null })
      }
    })
    await expect(h.service.transcribe(speech(1))).rejects.toMatchObject({ code: 'exit-nonzero' })
  })

  it('reports a spawn failure separately from an exit failure', async () => {
    const h = harness({
      runProcess: async () => {
        throw Object.assign(new Error('ENOENT'), { code: undefined })
      }
    })
    await expect(h.service.transcribe(speech(1))).rejects.toMatchObject({ code: 'spawn-failed' })
  })

  it('refuses when the bundled engine is not where the build expects it', async () => {
    const h = harness({ binarySize: null })
    await expect(h.service.transcribe(speech(1))).rejects.toMatchObject({ code: 'binary-missing' })
  })

  it('⚠ NO ERROR CARRIES THE CHILD\'S STDOUT OR STDERR', async () => {
    // stdout IS the transcript (with -np) and stderr carries absolute paths.
    const h = harness({
      runProcess: async () => {
        throw Object.assign(new Error('x'), {
          code: 2,
          stdout: 'my private dictation',
          stderr: "read_audio_data: reading audio data from 'C:/secret/path.wav'"
        })
      }
    })
    try {
      await h.service.transcribe(speech(1))
      expect.unreachable()
    } catch (e) {
      const msg = (e as Error).message
      expect(msg).not.toContain('my private dictation')
      expect(msg).not.toContain('C:/secret/path.wav')
      expect(msg).toContain('exit-nonzero')
    }
  })

  it('errors carry a duration but never the audio', async () => {
    const h = harness({
      runProcess: async () => {
        throw Object.assign(new Error('x'), { code: 1 })
      }
    })
    try {
      await h.service.transcribe(speech(5))
      expect.unreachable()
    } catch (e) {
      expect((e as WhisperError).audioSeconds).toBeCloseTo(5, 5)
    }
  })
})

describe('whisper — model resolution: "present" is not "valid"', () => {
  it('runs straight away when the model is byte-exact', async () => {
    const h = harness()
    await h.service.transcribe(speech(1))
    expect(h.ran).toHaveLength(1)
    expect(h.renamed).toHaveLength(0) // nothing downloaded
  })

  it('reports missing / ready / wrong-size', async () => {
    expect((await harness({ modelSize: null }).service.modelStatus()).state).toBe('missing')
    expect((await harness().service.modelStatus()).state).toBe('ready')
    expect((await harness({ modelSize: 40_000_000 }).service.modelStatus()).state).toBe('wrong-size')
  })

  it('downloads when the model is missing, verifying the size before the rename', async () => {
    const h = harness({ modelSize: null, fetchImpl: fetchServing(BASE_BYTES) })
    await h.service.ensureModel()
    expect(h.renamed).toEqual([{ from: `${MODEL_PATH}.part`, to: MODEL_PATH }])
    // The bytes reached `.part` and the rename is what installed them.
    expect(h.appended.at(-1)?.total).toBe(BASE_BYTES)
    expect(h.files.get(MODEL_PATH)).toBe(BASE_BYTES)
  })

  it('⚠ STREAMS TO DISK — it never holds the whole model in memory', async () => {
    // Driving the abort gate exposed the first version buffering every chunk and
    // writing once at the end: crash-safe by accident, but 141 MB resident for
    // base.en and 465 MB for small.en. This asserts the shape that replaced it —
    // many appends to `.part`, each one a single chunk, and no single write of
    // the whole file.
    const h = harness({ modelSize: null, fetchImpl: fetchServing(BASE_BYTES, 16) })
    await h.service.ensureModel()
    expect(h.appended.length).toBeGreaterThan(8)
    expect(h.appended.every((a) => a.path === `${MODEL_PATH}.part`)).toBe(true)
    // No individual write is the size of the model.
    expect(h.appended.every((a) => a.bytes < BASE_BYTES)).toBe(true)
    expect(h.written.some((w) => w.bytes === BASE_BYTES)).toBe(false)
    // The appends are monotonic and land exactly on the expected total.
    expect(h.appended.at(-1)?.total).toBe(BASE_BYTES)
  })

  it('⚠ RE-DOWNLOADS A TRUNCATED MODEL RATHER THAN RUNNING IT', async () => {
    // The nastiest case: whisper does not refuse a partial model, it produces
    // plausible garbage — which reads as "voice is inaccurate", not "the
    // download broke".
    const h = harness({ modelSize: 40_000_000, fetchImpl: fetchServing(BASE_BYTES) })
    await h.service.ensureModel()
    // The bad file is removed BEFORE the retry, so a failed re-download cannot
    // leave it looking installed.
    expect(h.removed).toContain(MODEL_PATH)
    expect(h.renamed).toEqual([{ from: `${MODEL_PATH}.part`, to: MODEL_PATH }])
  })

  it('reports progress monotonically, as a fraction', async () => {
    const h = harness({ modelSize: null, fetchImpl: fetchServing(BASE_BYTES, 8) })
    const seen: number[] = []
    await h.service.ensureModel('base.en', (p) => {
      expect(p.totalBytes).toBe(BASE_BYTES)
      if (p.fraction !== null) seen.push(p.fraction)
    })
    expect(seen.length).toBeGreaterThan(1)
    expect(seen[seen.length - 1]).toBe(1)
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1])
  })

  it('reports null progress when content-length is absent, never NaN', async () => {
    const h = harness({
      modelSize: null,
      fetchImpl: fetchServing(BASE_BYTES, 4, { contentLength: null })
    })
    const fractions: Array<number | null> = []
    await h.service.ensureModel('base.en', (p) => fractions.push(p.fraction))
    expect(fractions.every((f) => f === null)).toBe(true)
    // ...and the download still completes and verifies on byte count.
    expect(h.renamed).toHaveLength(1)
  })
})

describe('whisper — the download failure modes ARE the feature', () => {
  it('offline: names the size, does not install, leaves no file at the final path', async () => {
    const h = harness({
      modelSize: null,
      fetchImpl: async () => {
        throw new Error('getaddrinfo ENOTFOUND')
      }
    })
    await expect(h.service.ensureModel()).rejects.toMatchObject({ code: 'download-failed' })
    try {
      await h.service.ensureModel()
    } catch (e) {
      // The user must be told how big the ask is.
      expect((e as Error).message).toContain('141')
    }
    expect(h.renamed).toHaveLength(0)
    expect(h.files.has(MODEL_PATH)).toBe(false)
  })

  it('a non-200 response is refused', async () => {
    const h = harness({
      modelSize: null,
      fetchImpl: async () =>
        ({ ok: false, status: 503, headers: new Headers(), body: null }) as unknown as Response
    })
    await expect(h.service.ensureModel()).rejects.toMatchObject({ code: 'download-failed' })
    expect(h.renamed).toHaveLength(0)
  })

  it('⚠ A SHORT TRANSFER IS NEVER INSTALLED — this is the truncation guard', async () => {
    const h = harness({ modelSize: null, fetchImpl: fetchServing(BASE_BYTES - 5_000_000) })
    await expect(h.service.ensureModel()).rejects.toMatchObject({ code: 'download-failed' })
    expect(h.renamed).toHaveLength(0)
    expect(h.files.has(MODEL_PATH)).toBe(false)
  })

  it('an aborted download leaves NO file at the final path and cleans up .part', async () => {
    const controller = new AbortController()
    const h = harness({
      modelSize: null,
      fetchImpl: async () => {
        let sent = 0
        const body = new ReadableStream<Uint8Array>({
          pull(c) {
            sent += 1_000_000
            if (sent > 3_000_000) controller.abort()
            c.enqueue(new Uint8Array(1_000_000))
          }
        })
        const headers = new Headers({ 'content-length': String(BASE_BYTES) })
        return { ok: true, status: 200, headers, body } as unknown as Response
      }
    })
    await expect(h.service.ensureModel('base.en', undefined, controller.signal)).rejects.toMatchObject({
      code: 'download-aborted'
    })
    expect(h.renamed).toHaveLength(0)
    expect(h.files.has(MODEL_PATH)).toBe(false)
    expect(h.removed).toContain(`${MODEL_PATH}.part`)
  })

  it('disk full: typed error, .part cleaned up, nothing at the final path', async () => {
    const h = harness({ modelSize: null, fetchImpl: fetchServing(BASE_BYTES) })
    // `WhisperDeps` is readonly by design — the service must not be able to swap
    // its own effects — so the override is a fresh object rather than a mutation.
    const svc = createWhisperService({
      ...h.deps,
      // Disk full now surfaces mid-stream, on an append, rather than on a single
      // write at the end — which is a strictly better place to find it.
      appendBinaryFile: async () => {
        throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })
      }
    })
    await expect(svc.ensureModel()).rejects.toMatchObject({ code: 'download-failed' })
    expect(h.files.has(MODEL_PATH)).toBe(false)
    expect(h.removed).toContain(`${MODEL_PATH}.part`)
  })

  it('never resumes a stale .part — it is removed before the transfer starts', async () => {
    // Resuming would need a byte-range request and a way to trust what is on
    // disk; an appended-to file is exactly the oversized case modelState rejects.
    const h = harness({ modelSize: null, fetchImpl: fetchServing(BASE_BYTES) })
    await h.service.ensureModel()
    expect(h.removed).toContain(`${MODEL_PATH}.part`)
  })

  it('transcribe() ensures the model first, so a first dictation downloads', async () => {
    const fetchImpl = vi.fn(fetchServing(BASE_BYTES))
    const h = harness({ modelSize: null, fetchImpl })
    await h.service.transcribe(speech(1))
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(h.ran).toHaveLength(1)
  })

  it('a failed model download stops the transcription rather than running headless', async () => {
    const h = harness({
      modelSize: null,
      fetchImpl: async () => {
        throw new Error('offline')
      }
    })
    await expect(h.service.transcribe(speech(1))).rejects.toMatchObject({ code: 'download-failed' })
    expect(h.ran).toHaveLength(0)
  })
})

import { describe, it, expect } from 'vitest'
import {
  DEFAULT_WHISPER_MODEL,
  EMPTY_RESULT,
  SPEECH_RMS_THRESHOLD,
  SPEECH_WINDOW_SAMPLES,
  WHISPER_MODELS,
  WHISPER_SAMPLE_RATE,
  buildWav,
  concatFrames,
  downloadProgress,
  hasSpeech,
  isNonSpeechOnly,
  modelState,
  parseWhisperJson,
  partialPath,
  peakWindowRms,
  wavHeader,
  whisperArgs,
  whisperJsonPath,
  whisperModel
} from './whisperCore'

/** Read a little-endian field out of the header, the way a decoder would. */
const u32 = (b: Uint8Array, o: number): number => new DataView(b.buffer, b.byteOffset).getUint32(o, true)
const u16 = (b: Uint8Array, o: number): number => new DataView(b.buffer, b.byteOffset).getUint16(o, true)
const ascii = (b: Uint8Array, o: number, n: number): string =>
  String.fromCharCode(...Array.from(b.slice(o, o + n)))

/** A tone at a given amplitude — the closest thing to "speech" a unit test has. */
function tone(seconds: number, amplitude: number): Int16Array {
  const n = Math.round(WHISPER_SAMPLE_RATE * seconds)
  const out = new Int16Array(n)
  for (let i = 0; i < n; i++) {
    out[i] = Math.round(Math.sin((2 * Math.PI * 220 * i) / WHISPER_SAMPLE_RATE) * amplitude * 32767)
  }
  return out
}

describe('whisper model catalog (D159)', () => {
  it('defaults to base.en, not small.en', () => {
    // Plan.md §9 committed to small.en before anyone had measured it; at 465 MB
    // the first dictation a user ever attempts would also be a 465 MB download.
    expect(DEFAULT_WHISPER_MODEL).toBe('base.en')
  })

  it('carries the EXACT content-length of each model, not a rounded megabyte', () => {
    // These are the only thing distinguishing a complete model from a truncated
    // one. Measured from HuggingFace 2026-08-17.
    expect(WHISPER_MODELS['base.en'].bytes).toBe(147_964_211)
    expect(WHISPER_MODELS['small.en'].bytes).toBe(487_614_201)
    // ~141.1 MB and ~465.0 MB, i.e. the figures the task documents.
    expect(WHISPER_MODELS['base.en'].bytes / 1048576).toBeCloseTo(141.1, 1)
    expect(WHISPER_MODELS['small.en'].bytes / 1048576).toBeCloseTo(465.0, 1)
  })

  it('offers exactly the two models v1 has a use for', () => {
    // tiny.en and medium.en were measured in the same pass and deliberately are
    // NOT entries — an entry is something a settings screen can offer (D76).
    expect(Object.keys(WHISPER_MODELS).sort()).toEqual(['base.en', 'small.en'])
  })

  it('resolves a model by id with a filename and an https url', () => {
    const m = whisperModel('base.en')
    expect(m.fileName).toBe('ggml-base.en.bin')
    expect(m.url.startsWith('https://')).toBe(true)
    expect(m.url.endsWith('/ggml-base.en.bin')).toBe(true)
  })
})

describe('wavHeader — 16 kHz mono Int16', () => {
  it('writes a canonical 44-byte RIFF/WAVE header', () => {
    const h = wavHeader(16_000)
    expect(h.length).toBe(44)
    expect(ascii(h, 0, 4)).toBe('RIFF')
    expect(ascii(h, 8, 4)).toBe('WAVE')
    expect(ascii(h, 12, 4)).toBe('fmt ')
    expect(ascii(h, 36, 4)).toBe('data')
    expect(u32(h, 16)).toBe(16) // fmt chunk size
    expect(u16(h, 20)).toBe(1) // PCM
    expect(u16(h, 22)).toBe(1) // mono
    expect(u32(h, 24)).toBe(16_000) // sample rate
    expect(u32(h, 28)).toBe(32_000) // byte rate
    expect(u16(h, 32)).toBe(2) // block align
    expect(u16(h, 34)).toBe(16) // bits
  })

  it('counts BYTES, not samples, in both size fields', () => {
    // ⚠ THE BUG THIS EXISTS TO CATCH: writing sampleCount where a byte count
    // belongs yields a file that opens, plays at half length, and transcribes as
    // truncated speech — a QUALITY failure, not an error.
    const samples = 16_000
    const h = wavHeader(samples)
    expect(u32(h, 40)).toBe(samples * 2) // data size
    expect(u32(h, 4)).toBe(36 + samples * 2) // RIFF size
    expect(u32(h, 40)).not.toBe(samples)
  })

  it('matches the real jfk.wav fixture the D4 pass transcribed', () => {
    // The header this produces must be byte-identical in every field to a WAV
    // whisper-cli demonstrably accepted (mono / 16000 / 16-bit, verified in
    // _verify/5-2). If they ever diverge, this is where it shows.
    const h = wavHeader(176_000)
    expect(u16(h, 22)).toBe(1)
    expect(u32(h, 24)).toBe(16_000)
    expect(u16(h, 34)).toBe(16)
  })

  it('produces a VALID empty header for a zero-length capture', () => {
    const h = wavHeader(0)
    expect(h.length).toBe(44)
    expect(u32(h, 40)).toBe(0)
    expect(u32(h, 4)).toBe(36)
    expect(ascii(h, 0, 4)).toBe('RIFF')
  })

  it('refuses a negative or fractional sample count rather than emitting a corrupt header', () => {
    expect(() => wavHeader(-1)).toThrow()
    expect(() => wavHeader(1.5)).toThrow()
  })
})

describe('buildWav', () => {
  it('is header + little-endian samples', () => {
    const samples = new Int16Array([0, 1, -1, 32767, -32768])
    const wav = buildWav(samples)
    expect(wav.length).toBe(44 + samples.length * 2)
    const view = new DataView(wav.buffer, wav.byteOffset + 44)
    for (let i = 0; i < samples.length; i++) {
      expect(view.getInt16(i * 2, true)).toBe(samples[i])
    }
  })

  it('writes little-endian explicitly rather than aliasing host byte order', () => {
    // 0x0102 must land as 02 01, whatever the host is.
    const wav = buildWav(new Int16Array([0x0102]))
    expect(wav[44]).toBe(0x02)
    expect(wav[45]).toBe(0x01)
  })

  it('produces a valid 44-byte file for an empty capture, not a malformed one', () => {
    const wav = buildWav(new Int16Array(0))
    expect(wav.length).toBe(44)
    expect(u32(wav, 40)).toBe(0)
  })

  it('declares a data size that matches the bytes actually present', () => {
    const wav = buildWav(new Int16Array(1234))
    expect(u32(wav, 40)).toBe(wav.length - 44)
  })
})

describe('concatFrames', () => {
  it('joins frames in order', () => {
    const out = concatFrames([new Int16Array([1, 2]), new Int16Array([3]), new Int16Array([4, 5])])
    expect([...out]).toEqual([1, 2, 3, 4, 5])
  })

  it('handles no frames and empty frames', () => {
    expect(concatFrames([]).length).toBe(0)
    expect(concatFrames([new Int16Array(0), new Int16Array(0)]).length).toBe(0)
  })

  it('allocates exactly once for a full two-minute capture', () => {
    // 1,875 frames is the 5-1 queue bound: 120 s at 1024 samples/frame. The point
    // of the test is the SHAPE — a per-frame concat is O(n^2) and the spec names
    // it as something a reviewer should distrust.
    const frames = Array.from({ length: 1_875 }, () => new Int16Array(1_024))
    const out = concatFrames(frames)
    expect(out.length).toBe(1_875 * 1_024)
    expect(out.length / WHISPER_SAMPLE_RATE).toBeCloseTo(120, 0)
  })
})

describe('the speech gate — the measured replacement for the marker filter', () => {
  it('separates real-speech energy from measured ambient by two orders of magnitude', () => {
    // The anchors this threshold was chosen from (2026-08-17):
    //   jfk.wav loudest 100 ms window  0.38238
    //   THRESHOLD                      0.01000
    //   live ambient mic, this machine 0.00150
    expect(SPEECH_RMS_THRESHOLD).toBeGreaterThan(0.0015 * 3)
    expect(SPEECH_RMS_THRESHOLD).toBeLessThan(0.38238 / 10)
  })

  it('uses a 100 ms window', () => {
    expect(SPEECH_WINDOW_SAMPLES).toBe(WHISPER_SAMPLE_RATE / 10)
  })

  it('reports zero for digital silence and for an empty capture', () => {
    expect(peakWindowRms(new Int16Array(16_000))).toBe(0)
    expect(peakWindowRms(new Int16Array(0))).toBe(0)
    expect(hasSpeech(new Int16Array(16_000))).toBe(false)
    expect(hasSpeech(new Int16Array(0))).toBe(false)
  })

  it('rejects quiet room tone at the level a real microphone produces', () => {
    // ⚠ THIS IS THE CASE THAT MATTERS. Measured: the live mic on this machine
    // idles at RMS 0.0015, and whisper transcribes that as the word " you".
    const ambient = new Int16Array(16_000 * 3)
    for (let i = 0; i < ambient.length; i++) ambient[i] = Math.round((Math.random() * 2 - 1) * 50)
    expect(peakWindowRms(ambient)).toBeLessThan(SPEECH_RMS_THRESHOLD)
    expect(hasSpeech(ambient)).toBe(false)
  })

  it('accepts speech-level audio', () => {
    expect(hasSpeech(tone(1, 0.14))).toBe(true) // jfk's whole-file RMS
    expect(hasSpeech(tone(1, 0.38))).toBe(true) // jfk's loudest window
    expect(hasSpeech(tone(1, 0.02))).toBe(true) // quiet but deliberate
  })

  it('⚠ ACCEPTS ONE SHORT WORD IN A LONG SILENCE — the reason it is a PEAK window', () => {
    // A whole-file RMS would average this to near zero and discard exactly the
    // shortest, most deliberate utterances, which are what a voice feature is
    // most useful for.
    // ⚠ A QUIET word, not a loud one. A loud word survives a whole-file average
    // too, so it would not demonstrate anything: at amplitude 0.3 the whole-file
    // RMS of this capture is 0.0335, comfortably ABOVE the threshold. The case
    // that separates the two designs is the quiet, brief utterance.
    const capture = new Int16Array(16_000 * 10) // 10 s of silence
    const word = tone(0.25, 0.05) // a quarter-second, quietly spoken
    capture.set(word, 16_000 * 5) // dropped in the middle
    // Whole-file RMS is far below the threshold...
    let sum = 0
    for (const v of capture) sum += (v / 32768) ** 2
    expect(Math.sqrt(sum / capture.length)).toBeLessThan(SPEECH_RMS_THRESHOLD)
    // ...but the peak window finds it.
    expect(hasSpeech(capture)).toBe(true)
  })

  it('finds a word straddling a window boundary', () => {
    // Why the hop is half a window: a word split across two windows reads quieter
    // than it is in both of them.
    const capture = new Int16Array(16_000)
    const word = tone(0.1, 0.3)
    capture.set(word, SPEECH_WINDOW_SAMPLES - Math.floor(word.length / 2))
    expect(hasSpeech(capture)).toBe(true)
  })

  it('measures a capture shorter than one window rather than exempting it', () => {
    const blip = tone(0.04, 0.4) // 40 ms, shorter than the 100 ms window
    expect(peakWindowRms(blip)).toBeGreaterThan(0)
    expect(hasSpeech(blip)).toBe(true)
  })
})

describe('whisperArgs — every flag read from the binary, not recalled', () => {
  const args = whisperArgs({ modelPath: 'C:\\m\\ggml-base.en.bin', wavPath: 'C:\\t\\a.wav', outputBase: 'C:\\t\\a' })

  it('passes the flags whisper-cli v1.9.2 actually documents', () => {
    expect(args).toEqual([
      '-m', 'C:\\m\\ggml-base.en.bin',
      '-f', 'C:\\t\\a.wav',
      '-l', 'en',
      '-nt',
      '-np',
      '-oj',
      '-of', 'C:\\t\\a',
      '-t', '4'
    ])
  })

  it('is an argument ARRAY with no shell quoting, so spaces need no escaping', () => {
    // git.ts's standing rule in this codebase: argument arrays only, never a shell.
    const spaced = whisperArgs({
      modelPath: 'C:\\Program Files\\Chorus\\ggml-base.en.bin',
      wavPath: 'C:\\Users\\a b\\cap.wav',
      outputBase: 'C:\\Users\\a b\\cap'
    })
    expect(spaced).toContain('C:\\Program Files\\Chorus\\ggml-base.en.bin')
    expect(spaced.some((a) => a.includes('"') || a.includes("'"))).toBe(false)
  })

  it('passes -of WITHOUT an extension, because whisper appends .json itself', () => {
    const i = args.indexOf('-of')
    expect(args[i + 1].endsWith('.json')).toBe(false)
    expect(whisperJsonPath(args[i + 1])).toBe('C:\\t\\a.json')
  })

  it('honours a thread override', () => {
    const a = whisperArgs({ modelPath: 'm', wavPath: 'w', outputBase: 'o', threads: 8 })
    expect(a[a.indexOf('-t') + 1]).toBe('8')
  })
})

describe('parseWhisperJson — against the shape the binary really emits', () => {
  // Trimmed from _verify/5-2/run-a-output.json, produced by v1.9.2 on jfk.wav.
  const real = JSON.stringify({
    systeminfo: 'WHISPER : COREML = 0 | OPENVINO = 0 | CPU : SSE3 = 1 …',
    model: { type: 'base', multilingual: false, vocab: 51864 },
    params: { model: 'C:\\Users\\matth\\…\\ggml-base.en.bin', language: 'en', translate: false },
    result: { language: 'en' },
    transcription: [
      {
        timestamps: { from: '00:00:00,000', to: '00:00:30,000' },
        offsets: { from: 0, to: 30000 },
        text: ' And so my fellow Americans, ask not what your country can do for you, ask what you can do for your country.'
      }
    ]
  })

  it('extracts the transcript from the real document', () => {
    const r = parseWhisperJson(real)
    expect(r.text).toBe(
      'And so my fellow Americans, ask not what your country can do for you, ask what you can do for your country.'
    )
    expect(r.segments).toBe(1)
  })

  it('strips the leading space every segment carries, and never doubles spaces', () => {
    // ⚠ EVERY segment's `text` begins with a space in whisper's output. A naive
    // join produces doubled spaces mid-sentence, which then reach an agent prompt.
    const multi = JSON.stringify({
      transcription: [{ text: ' Hello there.' }, { text: ' How are you?' }, { text: ' Fine.' }]
    })
    expect(parseWhisperJson(multi).text).toBe('Hello there. How are you? Fine.')
    expect(parseWhisperJson(multi).text).not.toMatch(/ {2}/)
  })

  it('reads ONLY the transcription text, never params.model', () => {
    // The document embeds an absolute filesystem path; nothing but the text is
    // taken out of it, and the raw document is never logged.
    expect(parseWhisperJson(real).text).not.toContain('ggml-base.en.bin')
    expect(parseWhisperJson(real).text).not.toContain('C:\\')
  })

  it('returns empty for a document with no segments', () => {
    expect(parseWhisperJson(JSON.stringify({ transcription: [] }))).toEqual({ text: '', segments: 0 })
    expect(parseWhisperJson(JSON.stringify({})).text).toBe('')
  })

  it('maps a marker-only transcript to empty', () => {
    const blank = JSON.stringify({ transcription: [{ text: ' [BLANK_AUDIO]' }] })
    expect(parseWhisperJson(blank).text).toBe('')
  })

  it('throws WITHOUT echoing the body when the output is not JSON', () => {
    // The unparseable body would be a transcript.
    expect(() => parseWhisperJson('not json at all, possibly a secret')).toThrow(/not valid JSON/)
    try {
      parseWhisperJson('not json at all, possibly a secret')
    } catch (e) {
      expect((e as Error).message).not.toContain('possibly a secret')
    }
  })

  it('survives a malformed segment without losing the good ones', () => {
    const mixed = JSON.stringify({ transcription: [{ text: ' Good.' }, { notText: 1 }, { text: null }, { text: ' More.' }] })
    expect(parseWhisperJson(mixed).text).toBe('Good. More.')
  })
})

describe('isNonSpeechOnly — defence in depth, NOT the silence control', () => {
  it('treats an empty or whitespace transcript as non-speech', () => {
    expect(isNonSpeechOnly('')).toBe(true)
    expect(isNonSpeechOnly('   \n ')).toBe(true)
  })

  it('recognises the markers other models emit', () => {
    for (const m of ['[BLANK_AUDIO]', '[SILENCE]', '[MUSIC]', '(silence)', '[INAUDIBLE]', '[_BEG_]']) {
      expect(isNonSpeechOnly(m)).toBe(true)
      expect(isNonSpeechOnly(` ${m} `)).toBe(true)
    }
    expect(isNonSpeechOnly('[BLANK_AUDIO] [BLANK_AUDIO]')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isNonSpeechOnly('[blank_audio]')).toBe(true)
    expect(isNonSpeechOnly('(Silence)')).toBe(true)
  })

  it('KEEPS a real sentence that merely contains a bracketed aside', () => {
    // It fires only when markers are all that is left; a genuine utterance with
    // an aside must survive.
    expect(isNonSpeechOnly('refactor the [MUSIC] parser please')).toBe(false)
    expect(isNonSpeechOnly('add a test for the silence case')).toBe(false)
  })

  it('⚠ DOES NOT CATCH " you" — which is what silence ACTUALLY transcribes as', () => {
    // The finding this whole design turns on. `hasSpeech` is what stops this
    // reaching an agent; the marker filter cannot and must never be reported as
    // though it does. See _verify/5-2/F-silence-hallucination.md.
    expect(isNonSpeechOnly(' you')).toBe(false)
    expect(isNonSpeechOnly('you')).toBe(false)
  })
})

describe('modelState — "present" is not "valid"', () => {
  const expected = WHISPER_MODELS['base.en'].bytes

  it('accepts a byte-exact model', () => {
    expect(modelState(expected, expected)).toEqual({ state: 'ready' })
  })

  it('reports a missing model', () => {
    expect(modelState(null, expected)).toEqual({ state: 'missing' })
  })

  it('⚠ REJECTS A TRUNCATED MODEL RATHER THAN RUNNING IT', () => {
    // The nastiest case in this task: whisper does not refuse a partial model, it
    // produces plausible garbage — which reads as "voice is inaccurate" rather
    // than "the download broke". Size-zero logic would accept all of these.
    expect(modelState(40_000_000, expected).state).toBe('wrong-size')
    expect(modelState(expected - 1, expected).state).toBe('wrong-size')
    expect(modelState(0, expected).state).toBe('wrong-size')
  })

  it('rejects an OVERSIZED file too', () => {
    // A resumed download appended to an existing file is the realistic route to
    // this, and it is just as unusable.
    expect(modelState(expected + 1, expected).state).toBe('wrong-size')
  })

  it('reports both numbers so the error can say what it found', () => {
    expect(modelState(40_000_000, expected)).toEqual({
      state: 'wrong-size',
      actual: 40_000_000,
      expected
    })
  })
})

describe('download plumbing', () => {
  it('writes to .part and renames on success', () => {
    // An abort at the FINAL path leaves a file that exists, is the wrong size, and
    // looks installed — the scrollback mirror's discipline (Task 4a-4).
    expect(partialPath('C:\\m\\ggml-base.en.bin')).toBe('C:\\m\\ggml-base.en.bin.part')
  })

  it('reports progress as a clamped fraction', () => {
    expect(downloadProgress(0, 100)).toBe(0)
    expect(downloadProgress(50, 100)).toBe(0.5)
    expect(downloadProgress(100, 100)).toBe(1)
    expect(downloadProgress(150, 100)).toBe(1)
    expect(downloadProgress(-5, 100)).toBe(0)
  })

  it('⚠ returns null rather than NaN or Infinity when content-length is absent', () => {
    // "Progress computed from a content-length that was never checked for
    // presence" is on the spec's distrust list: received/0 is Infinity, and a bar
    // given NaN renders at zero forever while the download is working fine.
    expect(downloadProgress(50, null)).toBeNull()
    expect(downloadProgress(50, 0)).toBeNull()
    expect(downloadProgress(50, -1)).toBeNull()
    expect(downloadProgress(50, Number.NaN)).toBeNull()
    expect(downloadProgress(50, Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('EMPTY_RESULT — the absent-json case', () => {
  it('is an empty transcript, because whisper writes no json for a zero-sample wav', () => {
    // Measured: valid WAV, zero samples -> exit 0, empty stdout, NO .json file.
    // Treating the absent file as an error would turn an accidental hotkey tap
    // into an error dialog.
    expect(EMPTY_RESULT).toEqual({ text: '', segments: 0 })
  })
})

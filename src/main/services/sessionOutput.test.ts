import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CREDENTIAL_PLACEHOLDER } from './scrubber'
import { createSessionOutput, type SessionOutput } from './sessionOutput'

// Task 3-6 Commit 1 (D46): the session-shaped ingest-scrub seam. These tests
// pin the FIVE invariants the extraction out of SessionManager.spawn must
// preserve — each is load-bearing, not stylistic. Synthetic values of
// realistic shape ONLY, built by concatenation (same gate discipline as
// scrubber.test.ts). Never a real credential.

const KEY = 'sk-ant-api03-' + 'x9Y8w7V6'.repeat(5) // 53 chars, realistic shape

interface Harness {
  output: SessionOutput
  emitted: string[]
}

function make(opts: { secrets?: string[]; maxChars?: number; flushMs?: number } = {}): Harness {
  const emitted: string[] = []
  const output = createSessionOutput({
    secrets: opts.secrets ?? [KEY],
    maxChars: opts.maxChars ?? 4_000_000,
    flushMs: opts.flushMs ?? 50,
    onText: (text) => emitted.push(text)
  })
  return { output, emitted }
}

describe('createSessionOutput (Task 3-6 Commit 1)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  describe('invariant 1 — ONE push per chunk; buffer and broadcast consume the SAME string', () => {
    it('emits exactly one string per chunk and the buffer is their concatenation', () => {
      const { output, emitted } = make()
      output.ingest(`key is ${KEY} ok`)
      // A second push() on the same chunk would advance the carry twice and
      // emit the chunk twice — the buffer and the broadcast would diverge from
      // the single scrubbed stream.
      expect(emitted).toEqual([`key is ${CREDENTIAL_PLACEHOLDER} ok`])
      expect(output.buffer).toBe(emitted.join(''))
    })

    it('concatenation invariant across many chunks: emitted stream equals scrubbed input', () => {
      const { output, emitted } = make()
      const chunks = [`a=${KEY} b=`, `middle ${KEY.slice(0, 10)}`, `${KEY.slice(10)} end`, 'plain']
      for (const c of chunks) output.ingest(c)
      output.flush()
      const stream = emitted.join('')
      expect(stream).toBe(`a=${CREDENTIAL_PLACEHOLDER} b=middle ${CREDENTIAL_PLACEHOLDER} endplain`)
      expect(output.buffer).toBe(stream)
    })
  })

  describe('invariant 2 — a pending flush never overtakes an already-arrived chunk', () => {
    it('a chunk arriving with a flush pending: clear -> push -> reschedule', () => {
      const { output, emitted } = make()
      // Split the secret across two chunks so the first leaves a held carry
      // and schedules a flush.
      output.ingest(`prefix ${KEY.slice(0, 20)}`)
      expect(emitted).toEqual(['prefix ']) // the possible-secret tail is held
      // Before the timer fires, the rest of the secret arrives. The pending
      // flush must be cleared FIRST; had it fired, the held tail would have
      // been released raw ahead of the completing chunk.
      output.ingest(`${KEY.slice(20)} suffix`)
      vi.advanceTimersByTime(1000) // let any (rescheduled) timer fire
      expect(emitted.join('')).toBe(`prefix ${CREDENTIAL_PLACEHOLDER} suffix`)
      // No raw fragment of the key ever appeared, in any order.
      expect(emitted.join('')).not.toContain(KEY.slice(0, 20))
      expect(output.buffer).toBe(emitted.join(''))
    })

    it('a held carry flushes on the timer when no further chunk arrives', () => {
      const { output, emitted } = make({ flushMs: 50 })
      output.ingest(`tail ${KEY.slice(0, 20)}`)
      expect(emitted).toEqual(['tail '])
      vi.advanceTimersByTime(49)
      expect(emitted).toEqual(['tail '])
      vi.advanceTimersByTime(1)
      // The held tail is released RAW — it turned out not to be a secret.
      expect(emitted).toEqual(['tail ', KEY.slice(0, 20)])
      expect(output.buffer).toBe(`tail ${KEY.slice(0, 20)}`)
    })
  })

  describe('invariant 3 — flush() releases the held tail synchronously (exit ordering)', () => {
    it('flush emits the carry immediately, ahead of any listener notification', () => {
      const { output, emitted } = make()
      output.ingest(`end ${KEY.slice(0, 20)}`)
      expect(emitted).toEqual(['end '])
      output.flush() // spawn calls this BEFORE notifying exit listeners
      expect(emitted).toEqual(['end ', KEY.slice(0, 20)])
      // And the scheduled timer is gone: advancing time emits nothing more.
      vi.advanceTimersByTime(1000)
      expect(emitted).toEqual(['end ', KEY.slice(0, 20)])
    })
  })

  describe('invariant 4 — dispose() clears a pending timer', () => {
    it('nothing is emitted after dispose, even when a flush was scheduled', () => {
      const { output, emitted } = make()
      output.ingest(`held ${KEY.slice(0, 20)}`)
      expect(emitted).toEqual(['held '])
      output.dispose()
      vi.advanceTimersByTime(1000)
      // A leaked timer would emit the held tail here — and would hold a
      // closure over the secret match set past teardown.
      expect(emitted).toEqual(['held '])
    })
  })

  describe('ring buffer — trim applies to the SCRUBBED text', () => {
    it('caps the buffer at maxChars measured on scrubbed output', () => {
      const { output, emitted } = make({ maxChars: 40 })
      output.ingest(`[${KEY}]`)
      output.flush()
      const stream = emitted.join('') // `[${CREDENTIAL_PLACEHOLDER}]` — 23 chars, under cap
      expect(stream.length).toBeLessThanOrEqual(40)
      expect(output.buffer).toBe(stream)

      output.ingest('x'.repeat(100))
      output.flush()
      const full = emitted.join('')
      expect(output.buffer).toBe(full.slice(full.length - 40))
      expect(output.buffer.length).toBe(40)
    })
  })

  describe('identity fast path — no secrets registered', () => {
    it('input passes through untouched; no timer is ever scheduled', () => {
      const { output, emitted } = make({ secrets: [] })
      output.ingest(`the value ${KEY} is not registered`)
      output.ingest('more text')
      vi.advanceTimersByTime(1000)
      expect(emitted).toEqual([`the value ${KEY} is not registered`, 'more text'])
      expect(output.buffer).toBe(`the value ${KEY} is not registeredmore text`)
      output.flush() // nothing held — a no-op emit
      expect(emitted).toHaveLength(2)
    })
  })
})

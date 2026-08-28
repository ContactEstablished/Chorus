import { describe, expect, it } from 'vitest'
import { CREDENTIAL_PLACEHOLDER, createScrubber } from './scrubber'
import { MAX_PROMPTS_PER_SESSION, createPromptCapture } from './promptCapture'

const A = 'session-a'
const B = 'session-b'

/** A fixed, monotonic clock so `at` is assertable. */
function clock(): () => Date {
  let t = Date.parse('2026-08-27T10:00:00.000Z')
  return () => {
    t += 1000
    return new Date(t)
  }
}

function send(
  svc: ReturnType<typeof createPromptCapture>,
  sessionId: string,
  text: string,
  scrub?: (t: string) => string
): void {
  for (const ch of text) svc.note(sessionId, ch, scrub)
  svc.note(sessionId, '\r', scrub)
}

describe('prompt capture service', () => {
  it('returns prompts newest first', () => {
    const svc = createPromptCapture({ now: clock() })
    send(svc, A, 'first')
    send(svc, A, 'second')
    send(svc, A, 'third')
    expect(svc.history(A).map((p) => p.text)).toEqual(['third', 'second', 'first'])
  })

  it('stamps each prompt with an ISO time', () => {
    const svc = createPromptCapture({ now: clock() })
    send(svc, A, 'hello')
    expect(svc.history(A)[0].at).toBe('2026-08-27T10:00:01.000Z')
  })

  it('keeps sessions apart', () => {
    const svc = createPromptCapture({ now: clock() })
    send(svc, A, 'for a')
    send(svc, B, 'for b')
    expect(svc.history(A).map((p) => p.text)).toEqual(['for a'])
    expect(svc.history(B).map((p) => p.text)).toEqual(['for b'])
  })

  it('is empty for a session that has sent nothing', () => {
    expect(createPromptCapture().history('never-seen')).toEqual([])
  })

  it('does not commit a partially typed prompt', () => {
    const svc = createPromptCapture({ now: clock() })
    for (const ch of 'still typing') svc.note(A, ch)
    expect(svc.history(A)).toEqual([])
  })

  it('caps the ring at the newest N and drops the oldest', () => {
    const svc = createPromptCapture({ now: clock() })
    for (let i = 1; i <= MAX_PROMPTS_PER_SESSION + 5; i++) send(svc, A, `prompt ${i}`)
    const history = svc.history(A)
    expect(history).toHaveLength(MAX_PROMPTS_PER_SESSION)
    expect(history[0].text).toBe(`prompt ${MAX_PROMPTS_PER_SESSION + 5}`)
    expect(history.at(-1)?.text).toBe('prompt 6')
  })

  it('a short dialog answer does not evict the real prompt underneath it', () => {
    const svc = createPromptCapture({ now: clock() })
    send(svc, A, 'do the big refactor')
    send(svc, A, 'y')
    expect(svc.history(A).map((p) => p.text)).toEqual(['y', 'do the big refactor'])
  })

  it('forget drops one session and leaves the others', () => {
    const svc = createPromptCapture({ now: clock() })
    send(svc, A, 'for a')
    send(svc, B, 'for b')
    svc.forget(A)
    expect(svc.history(A)).toEqual([])
    expect(svc.history(B)).toHaveLength(1)
  })

  it('clear drops everything', () => {
    const svc = createPromptCapture({ now: clock() })
    send(svc, A, 'for a')
    send(svc, B, 'for b')
    svc.clear()
    expect(svc.history(A)).toEqual([])
    expect(svc.history(B)).toEqual([])
  })

  it('the returned array cannot be used to mutate the ring', () => {
    const svc = createPromptCapture({ now: clock() })
    send(svc, A, 'kept')
    svc.history(A).push({ text: 'injected', at: 'now' })
    expect(svc.history(A).map((p) => p.text)).toEqual(['kept'])
  })
})

describe('prompt capture — scrubbing through the session match set', () => {
  const SECRET = 'sk-ant-supersecretvalue'

  it('redacts a credential pasted into a prompt', () => {
    const svc = createPromptCapture({ now: clock() })
    const scrubber = createScrubber([SECRET])
    send(svc, A, `use the key ${SECRET} please`, (t) => scrubber.replaceAll(t))
    expect(svc.history(A)[0].text).toBe(`use the key ${CREDENTIAL_PLACEHOLDER} please`)
  })

  it('leaves ordinary prompt text untouched', () => {
    const svc = createPromptCapture({ now: clock() })
    const scrubber = createScrubber([SECRET])
    send(svc, A, 'fix the palette', (t) => scrubber.replaceAll(t))
    expect(svc.history(A)[0].text).toBe('fix the palette')
  })

  it('shows a prompt that was nothing but the secret as the placeholder', () => {
    // Kept rather than hidden: "you pasted a credential here" is true and
    // worth seeing. Only a scrub that leaves NOTHING is dropped, below.
    const svc = createPromptCapture({ now: clock() })
    const scrubber = createScrubber([SECRET])
    send(svc, A, SECRET, (t) => scrubber.replaceAll(t))
    expect(svc.history(A)[0].text).toBe(CREDENTIAL_PLACEHOLDER)
  })

  it('drops a prompt a scrub emptied entirely, rather than showing a blank row', () => {
    const svc = createPromptCapture({ now: clock() })
    send(svc, A, 'anything', () => '')
    expect(svc.history(A)).toEqual([])
  })

  it('a one-shot scrub does not disturb the streaming scrubber it shares', () => {
    // The output path holds a carry across chunks; the input path must not
    // touch it. Push a partial secret, run a prompt through replaceAll, then
    // complete the secret — the output must still redact correctly.
    const scrubber = createScrubber([SECRET])
    const held = scrubber.push(`prefix ${SECRET.slice(0, 8)}`)
    expect(scrubber.replaceAll(`a prompt mentioning ${SECRET}`)).toBe(
      `a prompt mentioning ${CREDENTIAL_PLACEHOLDER}`
    )
    const rest = scrubber.push(`${SECRET.slice(8)} suffix`)
    expect(held + rest + scrubber.flush()).toBe(`prefix ${CREDENTIAL_PLACEHOLDER} suffix`)
  })
})

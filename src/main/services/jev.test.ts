import { describe, expect, it, vi } from 'vitest'
import { JEV_API_URL, testJevKey } from './jev'
import { jevActionResponseSchema, jevSaveKeyRequestSchema, jevStatusSchema } from '../../shared/ipc'

const key = 'synthetic-jev-test-secret'
const vault = { decryptJevKey: vi.fn(async () => ({ ok: true as const, value: { key } })) }

describe('JEV connection test', () => {
  it('decrypts per request, authenticates only to TypeSafe and sends a fixed sample', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ answers: { ready: { type: 'noul', noul: 0.9 } } })))
    expect(await testJevKey(vault, fetcher)).toEqual({ ok: true })
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe(JEV_API_URL)
    expect(init?.headers).toEqual({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' })
    expect(init?.redirect).toBe('error')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    expect(JSON.parse(init?.body as string)).toMatchObject({ model: 'jev-latest', questions: { ready: { type: 'noul' } } })
    expect(init?.body).not.toContain(key)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('does not call the network when the key cannot be resolved', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const result = await testJevKey({ decryptJevKey: async () => ({ ok: false, kind: 'not-found', message: 'Save a key first.' }) }, fetcher)
    expect(result).toEqual({ ok: false, reason: 'Save a key first.' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([401, 403, 402, 429, 500, 529])('sanitizes HTTP %s without retrying or returning response content', async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(key, { status }))
    const result = await testJevKey(vault, fetcher)
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).not.toContain(key)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each([null, {}, { answers: { ready: { type: 'noul', noul: 2 } } }, { answers: { ready: { type: 'choice', noul: 0.5 } } }])('rejects malformed success responses', async (body) => {
    expect((await testJevKey(vault, vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body))))).ok).toBe(false)
  })

  it('never exposes thrown errors, including timeout/transport errors', async () => {
    const result = await testJevKey(vault, vi.fn<typeof fetch>().mockRejectedValue(new Error(key)))
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).not.toContain(key)
  })
})

describe('JEV IPC boundary', () => {
  it('normalizes pasted whitespace and refuses empty, multiline and oversized keys', () => {
    expect(jevSaveKeyRequestSchema.parse({ key: ` ${key}\n` }).key).toBe(key)
    for (const invalid of ['', '  ', 'a\nb', 'a b', 'a\u0000b', 'x'.repeat(8193)]) {
      expect(jevSaveKeyRequestSchema.safeParse({ key: invalid }).success).toBe(false)
    }
  })
  it('outbound schemas reject secret fields', () => {
    expect(jevStatusSchema.safeParse({ configured: true, encryptionAvailable: true, key }).success).toBe(false)
    expect(jevActionResponseSchema.safeParse({ ok: true, key }).success).toBe(false)
  })
})

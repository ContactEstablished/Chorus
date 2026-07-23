import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  decodeEnvelope,
  encodeEnvelope,
  failureMessage,
  fingerprint,
  toProfileMeta,
  type CredentialEnvelope,
  type VaultFailureKind
} from './vaultCore'
import type { CredentialProfileRow } from '../db/schema'

// Task 3-2 (D33): unit tests for the Electron-free vault core. This module
// must NOT import electron — these run in plain Node with zero mocks.
//
// Synthetic keys of realistic shape ONLY, built by concatenation so no literal
// in this file forms a full key shape for scripts/secret-grep.mjs (the G4
// gate scans src/). Never a real credential.
const fakeKey = 'sk-ant-api03-' + 'Ch0rusT3st'.repeat(5) // 63 chars, fake filler

describe('envelope round-trip (Task 3-2)', () => {
  it('deep-equals the input for a minimal {key} envelope', () => {
    const env: CredentialEnvelope = { key: fakeKey }
    expect(decodeEnvelope(encodeEnvelope(env))).toEqual({ ok: true, envelope: { key: fakeKey, baseUrl: undefined, extraHeaders: undefined } })
  })

  it('deep-equals the input for a full {key, baseUrl, extraHeaders} envelope', () => {
    const env: CredentialEnvelope = {
      key: fakeKey,
      baseUrl: 'https://api.anthropic.com',
      extraHeaders: { 'x-org': 'chorus', 'x-tier': 'dev' }
    }
    const decoded = decodeEnvelope(encodeEnvelope(env))
    expect(decoded).toEqual({ ok: true, envelope: env })
  })

  it('survives header values needing JSON escaping', () => {
    const env: CredentialEnvelope = {
      key: fakeKey,
      extraHeaders: { 'x-quote': 'va"l\\ue\nnext\t☃' }
    }
    expect(decodeEnvelope(encodeEnvelope(env))).toEqual({ ok: true, envelope: env })
  })
})

describe('envelope rejection (Task 3-2)', () => {
  it.each([
    ['malformed JSON', 'not json at all {'],
    ['valid JSON, not an object', '"just a string"'],
    ['valid JSON array', '["a"]'],
    ['object missing key', '{"baseUrl":"https://x"}'],
    ['object with non-string key', '{"key":42}'],
    ['object with empty key', '{"key":""}']
  ])('classifies %s as corrupt, without throwing', (_name, raw) => {
    let result: ReturnType<typeof decodeEnvelope> | undefined
    expect(() => {
      result = decodeEnvelope(raw)
    }).not.toThrow()
    expect(result).toEqual({ ok: false, kind: 'corrupt' })
  })

  it('never carries the raw input anywhere in the failure result', () => {
    const raw = `{"key":${JSON.stringify(fakeKey)}` // malformed, but contains the key
    const result = decodeEnvelope(raw)
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).not.toContain(fakeKey)
  })

  it('drops malformed optional fields rather than propagating them', () => {
    const decoded = decodeEnvelope('{"key":"k","baseUrl":42,"extraHeaders":{"a":1}}')
    expect(decoded).toEqual({ ok: true, envelope: { key: 'k', baseUrl: undefined, extraHeaders: undefined } })
  })
})

describe('fingerprint (Task 3-2)', () => {
  it('is deterministic for the same input', () => {
    expect(fingerprint(fakeKey)).toBe(fingerprint(fakeKey))
  })

  it('differs for a one-character change', () => {
    const other = fakeKey.slice(0, -1) + (fakeKey.endsWith('t') ? 'u' : 't')
    expect(fingerprint(other)).not.toBe(fingerprint(fakeKey))
  })

  it('is SALTED — never equal to the unsalted sha256 of the key', () => {
    // This is what actually proves the salt is applied: a "fingerprint" that
    // forgot FINGERPRINT_SALT would equal this digest.
    const unsalted = createHash('sha256').update(fakeKey).digest('hex')
    expect(fingerprint(fakeKey)).not.toBe(unsalted)
  })

  it('outputs 64 lowercase hex characters', () => {
    expect(fingerprint(fakeKey)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('contains no >=8-char substring of the key (no embedded prefix)', () => {
    const fp = fingerprint(fakeKey)
    for (let i = 0; i + 8 <= fakeKey.length; i++) {
      expect(fp.includes(fakeKey.slice(i, i + 8))).toBe(false)
    }
  })
})

describe('toProfileMeta (Task 3-2)', () => {
  const row: CredentialProfileRow = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    providerId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    label: 'Work key',
    encryptedBlob: Buffer.from([1, 2, 3, 4, 5]),
    fingerprintHash: 'a'.repeat(64),
    createdAt: '2026-07-23T00:00:00.000Z',
    lastVerifiedAt: null,
    unavailableSince: '2026-07-23T01:00:00.000Z',
    reencryptedAt: null
  }

  it('enumerates EXACTLY the metadata keys — never encryptedBlob/fingerprintHash', () => {
    // Asserted by key enumeration, not by reading two properties: a future
    // secret column added to the row fails this test even if nobody updates it.
    expect(Object.keys(toProfileMeta(row)).sort()).toEqual(
      ['createdAt', 'id', 'label', 'lastVerifiedAt', 'providerId', 'unavailableSince'].sort()
    )
  })

  it('projects the metadata values through unchanged', () => {
    expect(toProfileMeta(row)).toEqual({
      id: row.id,
      providerId: row.providerId,
      label: row.label,
      createdAt: row.createdAt,
      lastVerifiedAt: null,
      unavailableSince: row.unavailableSince
    })
  })
})

describe('failureMessage (Task 3-2)', () => {
  const kinds: VaultFailureKind[] = [
    'encryption-unavailable',
    'undecryptable',
    'corrupt',
    'duplicate',
    'duplicate-label',
    'not-found'
  ]

  it('maps every VaultFailureKind to its own distinct message', () => {
    const messages = kinds.map((k) => failureMessage(k, 'Work key'))
    expect(new Set(messages).size).toBe(kinds.length)
  })

  it('every message contains the label', () => {
    for (const k of kinds) {
      expect(failureMessage(k, 'Work key')).toContain('Work key')
    }
  })

  it('no message carries key material, a key substring, blob bytes, or a digest run', () => {
    const blobHex = 'deadbeef'.repeat(16)
    for (const k of kinds) {
      const msg = failureMessage(k, fakeKey) // even with the KEY as the label...
      expect(msg).not.toContain(blobHex)
      expect(msg).not.toMatch(/[0-9a-f]{64}/) // no 64-hex fingerprint run
      // ...and with an ordinary label, no key substring can appear at all.
      const ordinary = failureMessage(k, 'Work key')
      for (let i = 0; i + 8 <= fakeKey.length; i++) {
        expect(ordinary.includes(fakeKey.slice(i, i + 8))).toBe(false)
      }
    }
  })
})

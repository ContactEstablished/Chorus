import { describe, expect, it } from 'vitest'

import { MANAGEMENT_AUTH_MODE } from '../../shared/ipc'
import type { CredentialProfileRow, ProviderConfigRow } from '../db/schema'
import {
  CREDENTIAL_REFUSALS,
  checkEnvelopeBaseUrl,
  checkRoutingCredential,
  credentialRefusalMessage,
  normalizeBaseUrl,
  type CredentialCheck,
  type CredentialRefusal,
  type RoutingCredentialRow,
  type RoutingProviderRow
} from './routingCredentialCore'

/** Model Routing Task 2-1, Table K (ImplementationSpec-2-1). */

const GATEWAY = 'https://openrouter.ai/api/v1'
const PROVIDER: RoutingProviderRow = { id: 'p', authMode: 'api_key', baseUrl: 'https://openrouter.ai/api/v1' }
const PROFILE: RoutingCredentialRow = { id: 'c', providerId: 'p', label: 'OR key', unavailableSince: null }

function refusalOf(check: CredentialCheck): CredentialRefusal | null {
  return check.ok ? null : check.refusal
}

describe('Table K — checkRoutingCredential (C10)', () => {
  it('K1: the base rows pass', () => {
    expect(checkRoutingCredential(PROFILE, PROVIDER, GATEWAY)).toStrictEqual({ ok: true })
  })

  it('K2: a trailing slash on the provider base URL passes', () => {
    expect(checkRoutingCredential(PROFILE, { ...PROVIDER, baseUrl: 'https://openrouter.ai/api/v1/' }, GATEWAY)).toStrictEqual({ ok: true })
  })

  it('K3: no profile → not-found', () => {
    const check = checkRoutingCredential(null, PROVIDER, GATEWAY)
    expect(check).toStrictEqual({ ok: false, refusal: 'not-found', message: 'The routing credential was not found.' })
  })

  it('K4: no provider, or a provider with another id → provider-missing', () => {
    expect(refusalOf(checkRoutingCredential(PROFILE, null, GATEWAY))).toBe('provider-missing')
    expect(refusalOf(checkRoutingCredential(PROFILE, { ...PROVIDER, id: 'q' }, GATEWAY))).toBe('provider-missing')
  })

  it('K5: management is refused as management, even when also unavailable (class first)', () => {
    const management = { ...PROVIDER, authMode: 'management' }
    expect(refusalOf(checkRoutingCredential(PROFILE, management, GATEWAY))).toBe('management')
    const unavailable = { ...PROFILE, unavailableSince: '2026-10-01T00:00:00Z' }
    expect(refusalOf(checkRoutingCredential(unavailable, management, GATEWAY))).toBe('management')
    // Also ahead of a base-URL mismatch.
    expect(refusalOf(checkRoutingCredential(PROFILE, { ...management, baseUrl: null }, GATEWAY))).toBe('management')
  })

  it('K6: an auth mode other than api_key → not-api-key', () => {
    expect(refusalOf(checkRoutingCredential(PROFILE, { ...PROVIDER, authMode: 'subscription' }, GATEWAY))).toBe('not-api-key')
  })

  it('K7: no base URL, another host, or a different case → not-openrouter (no case folding)', () => {
    for (const baseUrl of [null, 'https://example.invalid/api/v1', 'https://OpenRouter.ai/api/v1']) {
      expect(refusalOf(checkRoutingCredential(PROFILE, { ...PROVIDER, baseUrl }, GATEWAY)), String(baseUrl)).toBe('not-openrouter')
    }
  })

  it('K8: unavailable_since → unavailable, by label', () => {
    const check = checkRoutingCredential({ ...PROFILE, unavailableSince: '2026-10-01T00:00:00Z' }, PROVIDER, GATEWAY)
    expect(check).toStrictEqual({
      ok: false,
      refusal: 'unavailable',
      message: "Credential profile 'OR key' is unavailable. Re-enter the credential in Settings."
    })
  })

  it('the full order: each refusal wins over every later one', () => {
    const unavailable = { ...PROFILE, unavailableSince: '2026-10-01T00:00:00Z' }
    // provider-missing beats management.
    expect(refusalOf(checkRoutingCredential(unavailable, { ...PROVIDER, id: 'q', authMode: 'management' }, GATEWAY))).toBe('provider-missing')
    // not-api-key beats not-openrouter and unavailable.
    expect(refusalOf(checkRoutingCredential(unavailable, { ...PROVIDER, authMode: 'oauth', baseUrl: null }, GATEWAY))).toBe('not-api-key')
    // not-openrouter beats unavailable.
    expect(refusalOf(checkRoutingCredential(unavailable, { ...PROVIDER, baseUrl: 'https://example.invalid' }, GATEWAY))).toBe('not-openrouter')
  })
})

describe('Table K — checkEnvelopeBaseUrl, messages and types', () => {
  it('K9: no envelope base URL passes; a trailing slash passes; another URL is envelope-mismatch', () => {
    expect(checkEnvelopeBaseUrl(undefined, 'OR key', GATEWAY)).toStrictEqual({ ok: true })
    expect(checkEnvelopeBaseUrl('https://openrouter.ai/api/v1/', 'OR key', GATEWAY)).toStrictEqual({ ok: true })
    expect(checkEnvelopeBaseUrl('https://proxy.invalid/v1', 'OR key', GATEWAY)).toStrictEqual({
      ok: false,
      refusal: 'envelope-mismatch',
      message: "Credential profile 'OR key' points at a different base URL; routing only calls the OpenRouter gateway."
    })
  })

  it('K10: the management literal equals MANAGEMENT_AUTH_MODE', () => {
    expect(MANAGEMENT_AUTH_MODE).toBe('management')
    expect(refusalOf(checkRoutingCredential(PROFILE, { ...PROVIDER, authMode: MANAGEMENT_AUTH_MODE }, GATEWAY))).toBe('management')
  })

  it('K11: real CredentialProfileRow and ProviderConfigRow values are accepted (compile-time)', () => {
    const provider: ProviderConfigRow = {
      id: 'prov-1',
      name: 'OpenRouter',
      adapterType: 'opencode',
      authMode: 'api_key',
      envVarName: 'OPENROUTER_API_KEY',
      baseUrl: 'https://openrouter.ai/api/v1',
      extraHeadersJson: null,
      model: null,
      createdAt: '2026-07-01T00:00:00.000Z'
    }
    const profile: CredentialProfileRow = {
      id: 'prof-1',
      providerId: 'prov-1',
      label: 'Unit test profile',
      encryptedBlob: Buffer.from([1, 2, 3]),
      fingerprintHash: 'not-a-real-hash',
      createdAt: '2026-07-01T00:00:00.000Z',
      lastVerifiedAt: null,
      unavailableSince: null,
      reencryptedAt: null
    }
    expect(checkRoutingCredential(profile, provider, GATEWAY)).toStrictEqual({ ok: true })
  })

  it('every refusal has its exact message', () => {
    const expected: Record<CredentialRefusal, string> = {
      'not-found': 'The routing credential was not found.',
      'provider-missing': 'The routing credential has no provider.',
      management: 'Routing is not available for a management credential.',
      'not-api-key': 'Routing needs an OpenRouter API-key credential.',
      'not-openrouter': 'Routing needs a credential for the OpenRouter gateway.',
      unavailable: "Credential profile 'OR key' is unavailable. Re-enter the credential in Settings.",
      'envelope-mismatch': "Credential profile 'OR key' points at a different base URL; routing only calls the OpenRouter gateway."
    }
    expect(Object.keys(expected)).toEqual([...CREDENTIAL_REFUSALS])
    for (const refusal of CREDENTIAL_REFUSALS) expect(credentialRefusalMessage(refusal, 'OR key'), refusal).toBe(expected[refusal])
  })

  it('normalizeBaseUrl strips trailing slashes only', () => {
    expect(normalizeBaseUrl('https://openrouter.ai/api/v1///')).toBe('https://openrouter.ai/api/v1')
    expect(normalizeBaseUrl('https://OpenRouter.ai/api/v1')).toBe('https://OpenRouter.ai/api/v1')
  })
})

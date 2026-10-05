import { describe, expect, it } from 'vitest'

import type { ModelRegistryEntry, VerificationRecord } from '../../shared/routing'
import { modelRegistryEntrySchema } from '../../shared/routing'
import { activeVerification, bundledModelRegistry, findModel, isVerificationActive, parseModelRegistry } from './registryCore'

/** Model Routing Task 1-1, Table R (ImplementationSpec-1-1). */

const SLUG = 'deepseek/deepseek-v4.1-flash'

function record(over: Partial<VerificationRecord> = {}): VerificationRecord {
  return {
    model: SLUG,
    tag: 'together',
    referenceTag: 'deepinfra/fp8',
    suiteVersion: '1',
    score: 0.97,
    verifiedAt: '2026-10-01T00:00:00Z',
    expiresAt: '2026-11-01T00:00:00Z',
    reviewer: 'coordinator',
    ...over
  }
}

/** A registry entry validated by its schema, so every fixture here is a legal entry. */
function entry(verified: VerificationRecord[]): ModelRegistryEntry {
  const base = bundledModelRegistry().models[SLUG]
  return modelRegistryEntrySchema.parse({ ...base, verified })
}

function file(models: Record<string, unknown>, version: unknown = 1): unknown {
  return { version, models }
}

const validEntry = {
  slug: 'a/b',
  displayName: 'A B',
  nativePrecision: 'fp8',
  nativePrecisionSource: 'test',
  firstPartyProviders: ['A'],
  verified: [],
  minContext: 1000
}

describe('Table R — model registry', () => {
  it('R1: the bundled registry parses and holds only DeepSeek V4.1 Flash with the specified values', () => {
    const registry = bundledModelRegistry()
    expect(registry.version).toBe(1)
    expect(Object.keys(registry.models)).toEqual([SLUG])
    const model = findModel(registry, SLUG)
    expect(model).not.toBeNull()
    expect(model?.slug).toBe(SLUG)
    expect(model?.displayName).toBe('DeepSeek V4.1 Flash')
    expect(model?.nativePrecision).toBe('fp8')
    expect(model?.firstPartyProviders).toEqual(['DeepSeek'])
    expect(model?.verified).toEqual([])
    expect(model?.minContext).toBe(262144)
  })

  it('R1: each call returns a fresh value (callers cannot mutate the bundled registry)', () => {
    const a = bundledModelRegistry()
    a.models[SLUG].firstPartyProviders.push('Someone')
    expect(bundledModelRegistry().models[SLUG].firstPartyProviders).toEqual(['DeepSeek'])
  })

  it('R2: a key differing from its slug, version 2, and nativePrecision unknown each throw', () => {
    expect(parseModelRegistry(file({ 'a/b': validEntry }))).toBeTruthy()
    expect(() => parseModelRegistry(file({ 'a/b': { ...validEntry, slug: 'c/d' } }))).toThrow(/^Invalid model registry/)
    expect(() => parseModelRegistry(file({ 'a/b': validEntry }, 2))).toThrow(/^Invalid model registry/)
    expect(() => parseModelRegistry(file({ 'a/b': { ...validEntry, nativePrecision: 'unknown' } }))).toThrow(
      /^Invalid model registry/
    )
  })

  it('R2: the thrown message names the first issue as <path>: <message>', () => {
    expect(() => parseModelRegistry(file({ 'a/b': { ...validEntry, nativePrecision: 'unknown' } }))).toThrow(
      /^Invalid model registry: models\.a\/b\.nativePrecision: /
    )
  })

  it('R2: a verification record naming another model is rejected', () => {
    const bad = { ...validEntry, verified: [record({ model: 'x/y' })] }
    expect(() => parseModelRegistry(file({ 'a/b': bad }))).toThrow(/^Invalid model registry/)
  })

  it('R3: nativePrecision null (closed weights) is accepted', () => {
    const registry = parseModelRegistry(file({ 'a/b': { ...validEntry, nativePrecision: null } }))
    expect(registry.models['a/b'].nativePrecision).toBeNull()
  })

  it('R4: findModel with an unknown slug returns null, including inherited property names', () => {
    const registry = bundledModelRegistry()
    expect(findModel(registry, 'nope/nope')).toBeNull()
    expect(findModel(registry, 'constructor')).toBeNull()
    expect(findModel(registry, 'toString')).toBeNull()
  })

  it('R5: verifiedAt is inclusive and expiresAt exclusive', () => {
    const r = record({ verifiedAt: '2026-10-01T00:00:00Z', expiresAt: '2026-11-01T00:00:00Z' })
    expect(isVerificationActive(r, '2026-10-01T00:00:00Z')).toBe(true)
    expect(isVerificationActive(r, '2026-10-31T23:59:59Z')).toBe(true)
    expect(isVerificationActive(r, '2026-11-01T00:00:00Z')).toBe(false)
    expect(isVerificationActive(r, '2026-09-30T23:59:59Z')).toBe(false)

    const e = entry([r])
    expect(activeVerification(e, 'together', '2026-10-01T00:00:00Z')).toEqual(r)
    expect(activeVerification(e, 'together', '2026-10-31T23:59:59Z')).toEqual(r)
    expect(activeVerification(e, 'together', '2026-11-01T00:00:00Z')).toBeNull()
    expect(activeVerification(e, 'together', '2026-09-30T23:59:59Z')).toBeNull()
  })

  it('R6: a record matches its exact tag only, never a tag prefix or a provider name', () => {
    const e = entry([record({ tag: 'together' })])
    const now = '2026-10-15T00:00:00Z'
    expect(activeVerification(e, 'together', now)).not.toBeNull()
    expect(activeVerification(e, 'together/fp8', now)).toBeNull()
    expect(activeVerification(e, 'Together', now)).toBeNull()
  })

  it('R7: with two active records for one tag the later verifiedAt wins; ties keep registry order', () => {
    const now = '2026-10-15T00:00:00Z'
    const older = record({ verifiedAt: '2026-10-01T00:00:00Z', score: 0.9 })
    const newer = record({ verifiedAt: '2026-10-10T00:00:00Z', score: 0.95 })
    expect(activeVerification(entry([older, newer]), 'together', now)).toEqual(newer)
    expect(activeVerification(entry([newer, older]), 'together', now)).toEqual(newer)

    // Equal verifiedAt: registry order decides, not any property of the record.
    const first = record({ reviewer: 'first' })
    const second = record({ reviewer: 'second' })
    expect(activeVerification(entry([first, second]), 'together', now)?.reviewer).toBe('first')
    expect(activeVerification(entry([second, first]), 'together', now)?.reviewer).toBe('second')
  })

  it('an unparseable now throws RangeError', () => {
    expect(() => isVerificationActive(record(), 'garbage')).toThrow(RangeError)
    expect(() => isVerificationActive(record(), 'garbage')).toThrow('Invalid time: now')
    expect(() => activeVerification(entry([record()]), 'together', 'garbage')).toThrow(RangeError)
  })

  it('an expired newer record does not shadow an active older one', () => {
    const now = '2026-10-15T00:00:00Z'
    const active = record({ verifiedAt: '2026-10-01T00:00:00Z', expiresAt: '2026-11-01T00:00:00Z' })
    const expired = record({ verifiedAt: '2026-10-05T00:00:00Z', expiresAt: '2026-10-06T00:00:00Z' })
    expect(activeVerification(entry([active, expired]), 'together', now)).toEqual(active)
  })
})

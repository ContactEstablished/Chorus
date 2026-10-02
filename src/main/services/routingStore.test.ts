import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  routingCacheFileSchema,
  routingObservationsFileSchema,
  type AccountEligibility,
  type CacheVerification,
  type EndpointSnapshot
} from '../../shared/routing'
import { extractObservations, parseEndpointsResponse } from '../routing/endpointsCore'
import { STORE_FILE_CAP_BYTES, snapshotFileText, storeWarning } from '../routing/storeCore'
import { logger, scrubSecrets } from './logger'
import { RoutingStore } from './routingStore'

/** Model Routing Task 2-2, Table F (ImplementationSpec-2-2): real file I/O in a temp directory. */

const M = 'deepseek/deepseek-v4.1-flash'
const DIR = 'deepseek%2Fdeepseek-v4.1-flash'
const ID_A = '5f0c1a2e-8a3b-4c5d-9e6f-0123456789ab'
const ID_B = '0b6d2c4e-1f3a-4b5c-8d7e-9f0a1b2c3d4e'
const ID_C = 'c1d2e3f4-a5b6-4c7d-8e9f-a0b1c2d3e4f5'

const FIXTURE_TEXT = readFileSync(
  join(__dirname, '../routing/__fixtures__/endpoints-deepseek-v4.1-flash-2026-10-02.json'),
  'utf8'
)
const golden: EndpointSnapshot = {
  fetchedAt: (JSON.parse(FIXTURE_TEXT) as { fetchedAt: string }).fetchedAt,
  endpoints: parseEndpointsResponse(JSON.parse(FIXTURE_TEXT)).endpoints
}
const small: EndpointSnapshot = { fetchedAt: '2026-10-02T09:35:00Z', endpoints: golden.endpoints.slice(0, 2) }
const NOW = '2026-10-02T09:35:00Z'

let root: string
let warn: ReturnType<typeof vi.fn<(message: string) => void>>
let store: RoutingStore

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'chorus-routing-store-'))
  warn = vi.fn<(message: string) => void>()
  store = new RoutingStore(root, { warn })
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

/** Every file under root, relative, with forward slashes. */
function filesUnder(dir: string): string[] {
  return (readdirSync(dir, { recursive: true }) as string[])
    .map((p) => p.replace(/\\/g, '/'))
    .filter((p) => statSync(join(dir, p)).isFile())
    .sort()
}

const snapshotPath = (): string => join(root, DIR, 'snapshot.json')

function corruptSnapshot(text: string): void {
  mkdirSync(join(root, DIR), { recursive: true })
  writeFileSync(snapshotPath(), text, 'utf8')
}

describe('Table F — routing store', () => {
  it('F1: writeSnapshot then readSnapshot round-trips at <root>/<dir>/snapshot.json with no temp file left', () => {
    store.writeSnapshot(M, small)
    expect(store.readSnapshot(M)).toEqual(small)
    expect(existsSync(snapshotPath())).toBe(true)
    expect(filesUnder(root)).toEqual([`${DIR}/snapshot.json`])
    expect(filesUnder(root).some((p) => p.endsWith('.tmp'))).toBe(false)
    expect(warn).not.toHaveBeenCalled()
  })

  it('F2: the golden snapshot (33 parsed rows) is strictly equal after the round trip', () => {
    expect(golden.endpoints).toHaveLength(33)
    store.writeSnapshot(M, golden)
    expect(store.readSnapshot(M)).toStrictEqual(golden)
    // A second instance (a restart) reads the same thing.
    expect(new RoutingStore(root, { warn }).readSnapshot(M)).toStrictEqual(golden)
  })

  it('F3: a corrupt snapshot reads as null twice, warns once, and is left byte-for-byte in place', () => {
    corruptSnapshot('garbage')
    const before = readFileSync(snapshotPath())
    expect(store.readSnapshot(M)).toBeNull()
    expect(store.readSnapshot(M)).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(storeWarning('snapshot', M, 'json'))
    expect(warn.mock.calls[0][0]).not.toContain('garbage')
    expect(warn.mock.calls[0][0]).not.toContain(root)
    expect(existsSync(snapshotPath())).toBe(true)
    expect(readFileSync(snapshotPath()).equals(before)).toBe(true)
  })

  it('F4: a write replaces the corrupt file, and a new corruption warns once more', () => {
    corruptSnapshot('garbage')
    expect(store.readSnapshot(M)).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)

    store.writeSnapshot(M, small)
    expect(store.readSnapshot(M)).toEqual(small)
    expect(warn).toHaveBeenCalledTimes(1)

    writeFileSync(snapshotPath(), '{"version":1}', 'utf8')
    expect(store.readSnapshot(M)).toBeNull()
    expect(store.readSnapshot(M)).toBeNull()
    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenLastCalledWith(storeWarning('snapshot', M, 'schema'))
  })

  it('F5: appending the golden 32 observations twice stores 32 with no duplicates', () => {
    const observations = extractObservations(golden)
    expect(observations).toHaveLength(32)
    const first = store.appendObservations(M, observations, NOW, 7)
    const second = store.appendObservations(M, observations, NOW, 7)
    expect(first).toHaveLength(32)
    expect(second).toHaveLength(32)
    expect(new Set(second.map((o) => `${o.tag}|${o.observedAt}`)).size).toBe(32)
    const file = routingObservationsFileSchema.parse(JSON.parse(readFileSync(join(root, DIR, 'observations.json'), 'utf8')))
    expect(file.model).toBe(M)
    expect(second).toEqual(file.observations)
    expect(store.readObservations(M)).toEqual(second)
    expect(filesUnder(root)).toEqual([`${DIR}/observations.json`])
  })

  it('F6: with nothing on disk, reads are empty, silent, and create nothing', () => {
    expect(store.readSnapshot(M)).toBeNull()
    expect(store.readObservations(M)).toEqual([])
    expect(store.readCache(M)).toEqual({})
    expect(store.readAccount(M, ID_A)).toBeNull()
    expect(warn).not.toHaveBeenCalled()
    expect(readdirSync(root)).toEqual([])
  })

  it('F7: mergeCache twice with overlapping tags — the file holds the merged record the call returned', () => {
    const t1 = '2026-10-02T09:15:39Z'
    const t2 = '2026-10-02T10:15:39Z'
    store.mergeCache(M, { 'baseten/fp8': { verified: false, checkedAt: t1 }, 'morph/fp8': { verified: true, checkedAt: t1 } })
    const returned = store.mergeCache(M, { 'baseten/fp8': { verified: true, checkedAt: t2 }, 'baidu/fp8': { verified: false, checkedAt: t2 } })
    const expected: CacheVerification = {
      'baidu/fp8': { verified: false, checkedAt: t2 },
      'baseten/fp8': { verified: true, checkedAt: t2 },
      'morph/fp8': { verified: true, checkedAt: t1 }
    }
    expect(returned).toStrictEqual(expected)
    const file = routingCacheFileSchema.parse(JSON.parse(readFileSync(join(root, DIR, 'cache.json'), 'utf8')))
    expect(file.verifications).toStrictEqual(returned)
    expect(store.readCache(M)).toStrictEqual(returned)
  })

  it('F8: two credential ids get two account files, each reading back its own eligibility', () => {
    const a: AccountEligibility = { guardrailRemoved: ['deepseek'], dataPolicyRemoved: ['deepseek'], checkedAt: '2026-10-02T09:15:39Z' }
    const b: AccountEligibility = { guardrailRemoved: null, dataPolicyRemoved: [], checkedAt: '2026-10-02T09:20:00Z' }
    store.writeAccount(M, ID_A, a)
    store.writeAccount(M, ID_B, b)
    expect(filesUnder(root)).toEqual([`${DIR}/account-${ID_A}.json`, `${DIR}/account-${ID_B}.json`].sort())
    expect(store.readAccount(M, ID_A)).toEqual(a)
    expect(store.readAccount(M, ID_B)).toEqual(b)
    expect(store.readAccount(M, ID_C)).toBeNull()
    expect(warn).not.toHaveBeenCalled()
  })

  it('F9: every method refuses a model outside the registry before touching the disk', () => {
    const other = 'other/model'
    const calls: (() => unknown)[] = [
      () => store.readSnapshot(other),
      () => store.writeSnapshot(other, small),
      () => store.readObservations(other),
      () => store.appendObservations(other, extractObservations(small), NOW, 7),
      () => store.readCache(other),
      () => store.mergeCache(other, { 'x/y': { verified: true, checkedAt: NOW } }),
      () => store.readAccount(other, ID_A),
      () => store.writeAccount(other, ID_A, { guardrailRemoved: null, dataPolicyRemoved: null, checkedAt: null }),
      // The model check comes first, even ahead of a bad credential id.
      () => store.readAccount(other, 'not-a-uuid')
    ]
    for (const call of calls) expect(call).toThrow('routing store: unknown model')
    expect(readdirSync(root)).toEqual([])
    expect(warn).not.toHaveBeenCalled()
  })

  it('F10: a snapshot above the size cap reads as null with one size warning', () => {
    corruptSnapshot(snapshotFileText(M, small))
    truncateSync(snapshotPath(), STORE_FILE_CAP_BYTES + 1)
    expect(statSync(snapshotPath()).size).toBe(16_000_001)
    expect(store.readSnapshot(M)).toBeNull()
    expect(store.readSnapshot(M)).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(storeWarning('snapshot', M, 'size'))
    expect(statSync(snapshotPath()).size).toBe(16_000_001)
  })

  it('F11: a directory where snapshot.json belongs fails the write with the fixed message and leaves no temp file', () => {
    mkdirSync(snapshotPath(), { recursive: true })
    let thrown: unknown
    try {
      store.writeSnapshot(M, small)
    } catch (err) {
      thrown = err
    }
    // The temp file is written first (the model directory is writable) and the
    // rename onto the directory is what fails, so the cleanup path runs.
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toBe('routing store: could not write the snapshot file for deepseek/deepseek-v4.1-flash')
    expect((thrown as Error).cause).toBeUndefined()
    expect(readdirSync(join(root, DIR))).toEqual(['snapshot.json'])
    expect(statSync(snapshotPath()).isDirectory()).toBe(true)
    expect(readdirSync(snapshotPath())).toEqual([])
    expect(filesUnder(root)).toEqual([])

    // Reading it is a `read` problem: empty, one warning, and the directory is still there.
    expect(store.readSnapshot(M)).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(storeWarning('snapshot', M, 'read'))
    expect(statSync(snapshotPath()).isDirectory()).toBe(true)
  })

  // Windows only (Chorus v1 is Windows-only): the read-only attribute makes the
  // rename over the target fail (EPERM). POSIX rename ignores the target's mode.
  it.skipIf(process.platform !== 'win32')(
    'a failed write over an existing valid file leaves it byte-identical and leaves no temp file',
    () => {
      store.writeSnapshot(M, golden)
      const before = readFileSync(snapshotPath())
      chmodSync(snapshotPath(), 0o444)
      try {
        expect(() => store.writeSnapshot(M, small)).toThrow(
          'routing store: could not write the snapshot file for deepseek/deepseek-v4.1-flash'
        )
        expect(readFileSync(snapshotPath()).equals(before)).toBe(true)
        expect(filesUnder(root)).toEqual([`${DIR}/snapshot.json`])
        expect(store.readSnapshot(M)).toStrictEqual(golden)
        expect(warn).not.toHaveBeenCalled()
      } finally {
        chmodSync(snapshotPath(), 0o666) // so afterEach can delete it
      }
    }
  )

  it('F12: after writing all four kinds, no file under root changes under scrubSecrets', () => {
    // Negative control: the scrubber does rewrite a key shape (assembled so grep:secrets never sees one).
    const keyShaped = 'sk-or-v1-' + '0123456789abcdef'.repeat(4)
    expect(scrubSecrets(keyShaped)).not.toBe(keyShaped)

    store.writeSnapshot(M, golden)
    store.appendObservations(M, extractObservations(golden), NOW, 7)
    store.mergeCache(M, { 'baseten/fp8': { verified: true, checkedAt: NOW } })
    store.writeAccount(M, ID_A, { guardrailRemoved: ['deepseek'], dataPolicyRemoved: null, checkedAt: NOW })
    const files = filesUnder(root)
    expect(files).toEqual(
      [`${DIR}/account-${ID_A}.json`, `${DIR}/cache.json`, `${DIR}/observations.json`, `${DIR}/snapshot.json`].sort()
    )
    for (const file of files) {
      const text = readFileSync(join(root, file), 'utf8')
      expect(scrubSecrets(text) === text, file).toBe(true)
    }
  })

  it('default warn goes to logger.warn with the [routing] prefix', () => {
    const spy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    corruptSnapshot('garbage')
    expect(new RoutingStore(root).readSnapshot(M)).toBeNull()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith(`[routing] ${storeWarning('snapshot', M, 'json')}`)
  })
})

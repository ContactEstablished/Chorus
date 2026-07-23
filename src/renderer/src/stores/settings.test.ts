import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSettingsStore } from './settings'
import type { CredentialProfileMetaWire, ProviderConfig } from '../../../shared/ipc'

// Settings store unit tests (Task 3-4). window.chorus is stubbed — test the
// logic, not the bridge (the stores/layout.test.ts precedent).
//
// The headline case is the DEEP SCAN: after a createProfile action carrying a
// fake key, the serialized $state must contain no substring of that key. It
// is written as a scan rather than two named field checks so a future added
// field cannot quietly hold one (D33 clause 3 at the store layer).
//
// Fixtures are obviously-fake values whose shape matches NOTHING in
// secret-patterns.json — the renderer test tree stays grep:secrets-clean
// without purges.

const PROVIDER_ID = '550e8400-e29b-41d4-a716-446655440000'
const PROFILE_ID = '6f1d2c3b-9a4e-4c8d-b7f6-1a2b3c4d5e6f'
const FAKE_KEY = 'fake-unit-test-key-not-a-real-credential'

const providerRow = (name: string): ProviderConfig => ({
  id: PROVIDER_ID,
  name,
  adapter_type: 'test-adapter',
  auth_mode: 'test-auth',
  env_var_name: null,
  base_url: null,
  extra_headers_json: null,
  created_at: '2026-07-23T00:00:00.000Z'
})

const profileRow = (label: string): CredentialProfileMetaWire => ({
  id: PROFILE_ID,
  providerId: PROVIDER_ID,
  label,
  createdAt: '2026-07-23T00:00:00.000Z',
  lastVerifiedAt: null,
  unavailableSince: null
})

interface ChorusStub {
  listProviders: ReturnType<typeof vi.fn>
  listCredentials: ReturnType<typeof vi.fn>
  listAdapters: ReturnType<typeof vi.fn>
  createProvider: ReturnType<typeof vi.fn>
  updateProvider: ReturnType<typeof vi.fn>
  deleteProvider: ReturnType<typeof vi.fn>
  createCredential: ReturnType<typeof vi.fn>
  replaceCredential: ReturnType<typeof vi.fn>
  deleteCredential: ReturnType<typeof vi.fn>
}

function stubChorus(): ChorusStub {
  const stub: ChorusStub = {
    listProviders: vi.fn().mockResolvedValue([]),
    listCredentials: vi.fn().mockResolvedValue([]),
    listAdapters: vi.fn().mockResolvedValue([]),
    createProvider: vi.fn().mockResolvedValue({ ok: true, provider: providerRow('p') }),
    updateProvider: vi.fn().mockResolvedValue({ ok: true }),
    deleteProvider: vi.fn().mockResolvedValue({ ok: true }),
    createCredential: vi.fn().mockResolvedValue({ ok: true, id: PROFILE_ID }),
    replaceCredential: vi.fn().mockResolvedValue({ ok: true }),
    deleteCredential: vi.fn().mockResolvedValue({ ok: true })
  }
  ;(globalThis as Record<string, unknown>).window = { chorus: stub }
  return stub
}

describe('settings store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window
  })

  it('never retains a key: deep scan of $state after createProfile', async () => {
    const stub = stubChorus()
    const store = useSettingsStore()

    const reason = await store.createProfile({
      providerId: PROVIDER_ID,
      label: 'unit test profile',
      key: FAKE_KEY
    })
    expect(reason).toBeNull()
    // The key crossed as a parameter — prove the bridge saw it once…
    expect(stub.createCredential).toHaveBeenCalledWith({
      providerId: PROVIDER_ID,
      label: 'unit test profile',
      key: FAKE_KEY
    })
    // …and that NO substring of it survives anywhere in store state: not the
    // whole value, and not any 8-char slice of it.
    const state = JSON.stringify(store.$state)
    expect(state.includes(FAKE_KEY)).toBe(false)
    for (let i = 0; i + 8 <= FAKE_KEY.length; i++) {
      expect(state.includes(FAKE_KEY.slice(i, i + 8))).toBe(false)
    }
  })

  it('supersede guard: overlapping loads resolving in reverse order keep the LATER data', async () => {
    const stub = stubChorus()
    // Two deferred listProviders gates: load 1 and load 2 block here.
    const gates: Array<(rows: ProviderConfig[]) => void> = []
    stub.listProviders.mockImplementation(
      () => new Promise<ProviderConfig[]>((resolve) => gates.push(resolve))
    )
    const store = useSettingsStore()

    const first = store.load()
    const second = store.load()
    expect(gates.length).toBe(2)

    // The LATER call resolves first and wins.
    gates[1]([providerRow('later')])
    await second
    expect(store.providers[0]?.name).toBe('later')
    expect(store.loading).toBe(false)

    // The STALE call resolving last must not clobber the later data…
    gates[0]([providerRow('stale')])
    await first
    expect(store.providers[0]?.name).toBe('later')
    // …and its guarded finally must not clear a spinner it does not own
    // (already false here; the assertion pins the no-corruption behavior).
    expect(store.loading).toBe(false)
  })

  it('each successful mutation triggers exactly one reload', async () => {
    stubChorus()
    const store = useSettingsStore()
    const loadsBefore = (window as unknown as { chorus: ChorusStub }).chorus.listProviders.mock
      .calls.length

    await store.createProfile({ providerId: PROVIDER_ID, label: 'l', key: FAKE_KEY })
    await store.replaceProfile(PROFILE_ID, FAKE_KEY)
    await store.deleteProfile(PROFILE_ID)
    await store.createProvider({ name: 'p', adapter_type: 'test-adapter', auth_mode: 'test-auth' })
    await store.updateProvider({ id: PROVIDER_ID, name: 'p2' })
    await store.deleteProvider(PROVIDER_ID)

    const listProviders = (window as unknown as { chorus: ChorusStub }).chorus.listProviders
    expect(listProviders.mock.calls.length - loadsBefore).toBe(6) // one reload each
  })

  it('a {ok:false, reason} mutation surfaces the reason and does NOT corrupt the list', async () => {
    const stub = stubChorus()
    stub.listProviders.mockResolvedValue([providerRow('kept')])
    stub.listCredentials.mockResolvedValue([profileRow('kept-profile')])
    const store = useSettingsStore()
    await store.load()
    expect(store.providers.length).toBe(1)

    const reloadsBefore = stub.listProviders.mock.calls.length
    stub.createCredential.mockResolvedValue({ ok: false, reason: 'duplicate label' })
    const reason = await store.createProfile({
      providerId: PROVIDER_ID,
      label: 'dup',
      key: FAKE_KEY
    })

    expect(reason).toBe('duplicate label') // returned verbatim
    expect(store.error).toBe('duplicate label') // exposed renderable
    expect(stub.listProviders.mock.calls.length).toBe(reloadsBefore) // no reload
    expect(store.providers[0]?.name).toBe('kept') // list untouched
    expect(store.profiles[0]?.label).toBe('kept-profile')
  })

  it('a rejected invoke (bridge throw) is caught and surfaced, never thrown to the caller', async () => {
    const stub = stubChorus()
    stub.replaceCredential.mockRejectedValue(new Error('bridge down'))
    const store = useSettingsStore()

    const reason = await store.replaceProfile(PROFILE_ID, FAKE_KEY)
    expect(reason).toBe('bridge down')
    expect(store.error).toBe('bridge down')
  })

  it('replace refusal (D36 duplicate detection) is returned verbatim for inline rendering', async () => {
    const stub = stubChorus()
    stub.replaceCredential.mockResolvedValue({
      ok: false,
      reason: 'another profile already stores this key'
    })
    const store = useSettingsStore()

    const reason = await store.replaceProfile(PROFILE_ID, FAKE_KEY)
    expect(reason).toBe('another profile already stores this key')
    expect(store.error).toBe('another profile already stores this key')
    const state = JSON.stringify(store.$state)
    expect(state.includes(FAKE_KEY)).toBe(false)
  })

  it('load failure surfaces a renderable error and ends the spinner', async () => {
    const stub = stubChorus()
    stub.listAdapters.mockRejectedValue(new Error('adapter:list broke'))
    const store = useSettingsStore()

    await store.load()
    expect(store.error).toBe('adapter:list broke')
    expect(store.loading).toBe(false)
  })
})

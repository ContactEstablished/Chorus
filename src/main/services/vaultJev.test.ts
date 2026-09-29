import { beforeEach, describe, expect, it, vi } from 'vitest'
import { safeStorage } from 'electron'
import { CredentialVault } from './vault'
import type { StorageService } from './storage'

vi.mock('electron', () => ({ safeStorage: {
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn(() => Buffer.from('opaque-encrypted-data')),
  decryptStringAsync: vi.fn()
} }))
vi.mock('./logger', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))

const key = 'synthetic-jev-test-secret'
function harness() {
  let blob: Buffer | null = null
  const storage = {
    readJevKeyBlob: () => blob,
    writeJevKeyBlob: vi.fn((next: Buffer | null) => { blob = next })
  }
  return { storage, vault: new CredentialVault(storage as unknown as StorageService) }
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true)
  vi.mocked(safeStorage.encryptString).mockReturnValue(Buffer.from('opaque-encrypted-data'))
  vi.mocked(safeStorage.decryptStringAsync).mockResolvedValue({ result: JSON.stringify({ key }), shouldReEncrypt: false })
})

describe('JEV vault', () => {
  it('persists only ciphertext and resolves the saved key after vault recreation', async () => {
    const { storage, vault } = harness()
    expect(vault.hasJevKey()).toBe(false)
    expect(vault.saveJevKey(key).ok).toBe(true)
    expect(storage.writeJevKeyBlob).toHaveBeenCalledWith(Buffer.from('opaque-encrypted-data'))
    expect(storage.readJevKeyBlob()?.toString()).not.toContain(key)
    const restarted = new CredentialVault(storage as unknown as StorageService)
    expect(restarted.hasJevKey()).toBe(true)
    expect(await restarted.decryptJevKey()).toMatchObject({ ok: true, value: { key } })
    restarted.removeJevKey()
    expect(restarted.hasJevKey()).toBe(false)
    expect((await restarted.decryptJevKey()).ok).toBe(false)
  })

  it('preserves the previous key when replacement encryption fails', () => {
    const { storage, vault } = harness()
    vault.saveJevKey(key)
    vi.mocked(safeStorage.encryptString).mockImplementation(() => { throw new Error(key) })
    const result = vault.saveJevKey('replacement')
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).not.toContain(key)
    expect(storage.writeJevKeyBlob).toHaveBeenCalledTimes(1)
  })

  it('refuses storage without encryption', () => {
    const { storage, vault } = harness()
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false)
    expect(vault.saveJevKey(key).ok).toBe(false)
    expect(storage.writeJevKeyBlob).not.toHaveBeenCalled()
  })

  it('keeps undecryptable keys for replacement and returns a sanitized error', async () => {
    const { vault } = harness()
    vault.saveJevKey(key)
    vi.mocked(safeStorage.decryptStringAsync).mockRejectedValue(new Error(key))
    const result = await vault.decryptJevKey()
    expect(result).toMatchObject({ ok: false, kind: 'undecryptable' })
    expect(JSON.stringify(result)).not.toContain(key)
    expect(vault.hasJevKey()).toBe(true)
  })

  it('does not resurrect a removed key during DPAPI rotation', async () => {
    const { vault } = harness()
    vault.saveJevKey(key)
    vi.mocked(safeStorage.decryptStringAsync).mockImplementation(async () => {
      vault.removeJevKey()
      return { result: JSON.stringify({ key }), shouldReEncrypt: true }
    })
    await vault.decryptJevKey()
    expect(vault.hasJevKey()).toBe(false)
  })
})

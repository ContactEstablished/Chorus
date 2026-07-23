import { safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { logger } from './logger'
import type { StorageService } from './storage'
import {
  decodeEnvelope,
  encodeEnvelope,
  failureMessage,
  fingerprint,
  toProfileMeta,
  type CredentialProfileMeta,
  type ResolvedEnvelope,
  type VaultResult
} from './vaultCore'

/**
 * Task 3-2 (D33): the credential vault — the ONLY module in the repo that may
 * call safeStorage.encryptString / decryptString*. Everything that can be
 * decided without DPAPI lives in the Electron-free vaultCore.ts.
 *
 * Reading this file top to bottom, three questions must stay answerable
 * without running anything (spec §10):
 *  - where does plaintext enter?  One parameter, on createProfile /
 *    replaceProfile — handed over by the credential:create / credential:replace
 *    IPC handlers, which never log it.
 *  - where does it leave?         One return value, from decryptForLaunch —
 *    which has exactly ONE future legal caller (Task 3-6's launch path) and
 *    ZERO callers in this commit.
 *  - what happens when DPAPI says no?  A refusal naming the profile by LABEL
 *    only (D33 clause 8). No plaintext fallback exists anywhere in this file,
 *    behind any flag, in any build.
 *
 * Retention: this class retains NOTHING. No cache, no memo, no "last
 * decrypted" field — the one sanctioned plaintext retention is the per-session
 * scrubber match set (D33 resolution a), which is Task 3-5/3-6's business.
 * `reencryptedThisRun` holds profile IDs only — never key material.
 */
export class CredentialVault {
  /** D33 risk 7 throttle: profile ids already re-encrypted THIS APP RUN. A
   *  corrupted shouldReEncrypt cycle must not re-encrypt on every read. A
   *  Set, not a timestamp: process start time is not persisted and a
   *  clock-based rule reintroduces the F10 class of bug. */
  private readonly reencryptedThisRun = new Set<string>()

  constructor(private readonly storage: StorageService) {}

  isAvailable(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  /** Store a new credential: encrypt the D33 clause-1 envelope, persist the
   *  opaque blob + salted fingerprint. Refusals (never throws for contract
   *  paths): encryption unavailable, duplicate key on this provider, or
   *  duplicate (provider_id, label) — each with a label-only message. */
  createProfile(input: {
    providerId: string
    label: string
    key: string
    baseUrl?: string
    extraHeaders?: Record<string, string>
  }): VaultResult<{ id: string }> {
    if (!safeStorage.isEncryptionAvailable()) {
      // D33 Q3, unanimous: refuse. No plaintext fallback exists anywhere in
      // this file, behind any flag, in any build.
      return {
        ok: false,
        kind: 'encryption-unavailable',
        message: failureMessage('encryption-unavailable', input.label)
      }
    }
    // D33 resolution (b): main-side duplicate detection by salted fingerprint
    // — "that key is already stored as profile X". Scoped to THIS provider:
    // the same key on two different providers is a legitimate configuration.
    const fingerprintHash = fingerprint(input.key)
    const existing = this.storage.getCredentialProfileByFingerprint(
      input.providerId,
      fingerprintHash
    )
    if (existing) {
      return { ok: false, kind: 'duplicate', message: failureMessage('duplicate', existing.label) }
    }
    let blob: Buffer
    try {
      blob = safeStorage.encryptString(
        encodeEnvelope({
          key: input.key,
          baseUrl: input.baseUrl,
          extraHeaders: input.extraHeaders
        })
      )
    } catch (err) {
      // encryptString is documented to throw on encryption failure — same
      // refusal class as unavailable encryption: nothing is stored. The raw
      // exception text stays in the log (which redacts); it never crosses IPC.
      logger.error({ err }, '[vault] encryptString failed; credential NOT stored')
      return {
        ok: false,
        kind: 'encryption-unavailable',
        message: failureMessage('encryption-unavailable', input.label)
      }
    }
    const id = randomUUID()
    try {
      this.storage.createCredentialProfile({
        id,
        providerId: input.providerId,
        label: input.label,
        encryptedBlob: blob,
        fingerprintHash,
        createdAt: new Date().toISOString(),
        lastVerifiedAt: null,
        unavailableSince: null,
        reencryptedAt: null
      })
    } catch (err) {
      // UNIQUE (provider_id, label) is enforced by the hand-rolled DDL (D7):
      // convert the constraint throw into a structured refusal (spec §2.2).
      if (isSqliteError(err, 'SQLITE_CONSTRAINT_UNIQUE')) {
        return {
          ok: false,
          kind: 'duplicate-label',
          message: failureMessage('duplicate-label', input.label)
        }
      }
      throw err
    }
    // Ids only — never the label (a user-chosen string we do not need in the
    // log), and NEVER the key (D33 redaction rule 4).
    logger.info({ profileId: id, providerId: input.providerId }, '[vault] credential profile created')
    return { ok: true, value: { id } }
  }

  /** Replace a profile's key (rotation): new blob + new fingerprint, and a
   *  successful replace clears unavailable_since (D33 clause 8). */
  replaceProfile(
    id: string,
    input: { key: string; baseUrl?: string; extraHeaders?: Record<string, string> }
  ): VaultResult<void> {
    const row = this.storage.getCredentialProfileById(id)
    if (!row) return { ok: false, kind: 'not-found', message: failureMessage('not-found', id) }
    if (!safeStorage.isEncryptionAvailable()) {
      return {
        ok: false,
        kind: 'encryption-unavailable',
        message: failureMessage('encryption-unavailable', row.label)
      }
    }
    // F-4 (D36 chore): replace must not bypass create's duplicate-fingerprint
    // detection — same provider scope, same refusal. The OWN-ROW exemption
    // (existing.id !== id) keeps a same-key replace of the profile's own row
    // working: that is the legitimate rotation / re-encrypt path, not a dup.
    const fingerprintHash = fingerprint(input.key)
    const existing = this.storage.getCredentialProfileByFingerprint(row.providerId, fingerprintHash)
    if (existing && existing.id !== id) {
      return { ok: false, kind: 'duplicate', message: failureMessage('duplicate', existing.label) }
    }
    let blob: Buffer
    try {
      blob = safeStorage.encryptString(
        encodeEnvelope({
          key: input.key,
          baseUrl: input.baseUrl,
          extraHeaders: input.extraHeaders
        })
      )
    } catch (err) {
      logger.error({ err }, '[vault] encryptString failed on replace; profile unchanged')
      return {
        ok: false,
        kind: 'encryption-unavailable',
        message: failureMessage('encryption-unavailable', row.label)
      }
    }
    this.storage.updateCredentialBlob(id, blob, fingerprintHash)
    logger.info({ profileId: id }, '[vault] credential profile replaced')
    return { ok: true, value: undefined }
  }

  deleteProfile(id: string): void {
    this.storage.deleteCredentialProfile(id)
    logger.info({ profileId: id }, '[vault] credential profile deleted')
  }

  /** Metadata only — toProfileMeta's explicit construction is the first of
   *  the two barriers that keep blobs and fingerprints off the wire. */
  listProfiles(): CredentialProfileMeta[] {
    return this.storage.listCredentialProfiles().map(toProfileMeta)
  }

  /**
   * Decrypt a profile's envelope for an imminent launch. ASYNC because D33
   * resolution (e): shouldReEncrypt is reported ONLY by decryptStringAsync —
   * rotation detection requires the async API (D4-verified against Electron
   * 43.1.1's typings: the plaintext field is `result`, NOT `decrypted`).
   *
   * Task 3-6 note: SessionManager.launch() is synchronous, so the launch
   * handler must await this BEFORE calling it.
   *
   * ZERO CALLERS in this commit — the one future legal caller is Task 3-6.
   * Returns the envelope to its caller and retains nothing itself.
   */
  async decryptForLaunch(id: string): Promise<VaultResult<ResolvedEnvelope>> {
    const row = this.storage.getCredentialProfileById(id)
    if (!row) return { ok: false, kind: 'not-found', message: failureMessage('not-found', id) }
    let plaintext: string
    let shouldReEncrypt: boolean
    try {
      const decrypted = await safeStorage.decryptStringAsync(row.encryptedBlob)
      plaintext = decrypted.result
      shouldReEncrypt = decrypted.shouldReEncrypt
    } catch (err) {
      // D33 clause 8: mark unavailable, KEEP the row, refuse by label only.
      // The raw exception is wrapped into the log; its text never propagates.
      this.storage.markCredentialUnavailable(id, new Date().toISOString())
      logger.error({ err, profileId: id }, '[vault] decrypt failed; profile marked unavailable')
      return {
        ok: false,
        kind: 'undecryptable',
        message: failureMessage('undecryptable', row.label)
      }
    }
    const decoded = decodeEnvelope(plaintext)
    if (!decoded.ok) {
      this.storage.markCredentialUnavailable(id, new Date().toISOString())
      logger.error({ profileId: id }, '[vault] decrypted blob is not a valid envelope; marked unavailable')
      return { ok: false, kind: 'corrupt', message: failureMessage('corrupt', row.label) }
    }
    if (shouldReEncrypt && !this.reencryptedThisRun.has(id)) {
      // D33 Q3 + risk 7: re-encrypt on read, throttled to once per app run.
      // Never block or fail the operation on a re-encrypt error — the
      // plaintext is already in hand; log and proceed.
      this.reencryptedThisRun.add(id)
      try {
        const newBlob = await safeStorage.encryptStringAsync(plaintext)
        this.storage.updateCredentialBlob(id, newBlob, row.fingerprintHash)
        this.storage.markCredentialReencrypted(id, new Date().toISOString())
        logger.info({ profileId: id }, '[vault] credential re-encrypted (DPAPI key rotation)')
      } catch (err) {
        logger.error({ err, profileId: id }, '[vault] re-encrypt failed; proceeding with decrypted value')
      }
    }
    return { ok: true, value: decoded.envelope }
  }
}

/** better-sqlite3 errors carry a `code` string (D4-probed on 12.11.1:
 *  SQLITE_CONSTRAINT_UNIQUE / SQLITE_CONSTRAINT_FOREIGNKEY). */
function isSqliteError(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === code
}

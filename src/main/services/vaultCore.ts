import { createHash } from 'node:crypto'
import type { CredentialProfileRow } from '../db/schema'

/**
 * Task 3-2 (D33): the Electron-free pure core of the credential vault.
 *
 * Every decision that can be made WITHOUT DPAPI lives here, so the unit tests
 * run under plain Vitest (any module importing `electron` cannot). The house
 * precedent is restore.ts ↔ sessionManager.ts and computeWorktreeReconcile ↔
 * GitWorktreeManager. `vault.ts` owns safeStorage and nothing else.
 */

/** D33 clause 1: the shape that gets encrypted. JSON, because safeStorage
 *  encrypts strings, not objects. */
export interface CredentialEnvelope {
  readonly key: string
  readonly baseUrl?: string
  readonly extraHeaders?: Record<string, string>
}

/** What decryptForLaunch hands its (future, Task 3-6) caller. Same shape as
 *  the envelope; named separately because the launch path will join it with
 *  provider-level defaults (envelope overrides provider — D33 resolution e). */
export type ResolvedEnvelope = CredentialEnvelope

export function encodeEnvelope(env: CredentialEnvelope): string {
  return JSON.stringify(env)
}

export type DecodeResult =
  | { ok: true; envelope: CredentialEnvelope }
  | { ok: false; kind: 'corrupt' }

function isStringRecord(v: unknown): v is Record<string, string> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  return Object.values(v).every((x) => typeof x === 'string')
}

/** Decode a decrypted envelope. Returns a discriminated result rather than
 *  throwing, because the failure path is a CONTRACT path (D33 clause 8) — and
 *  because a thrown Error would tend to carry the decrypted plaintext into a
 *  stack trace. Never include `raw` in any returned message. */
export function decodeEnvelope(raw: string): DecodeResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, kind: 'corrupt' }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, kind: 'corrupt' }
  }
  const o = parsed as Record<string, unknown>
  if (typeof o.key !== 'string' || o.key.length === 0) return { ok: false, kind: 'corrupt' }
  // Optional fields are accepted only in their declared shapes; anything else
  // is dropped rather than propagated, so a hand-edited blob cannot inject a
  // non-string into the env block that Task 3-6 will build from this.
  const baseUrl = typeof o.baseUrl === 'string' ? o.baseUrl : undefined
  const extraHeaders = isStringRecord(o.extraHeaders) ? o.extraHeaders : undefined
  return { ok: true, envelope: { key: o.key, baseUrl, extraHeaders } }
}

/** Fixed application salt for credential fingerprints. NOT A SECRET — an
 *  attacker holding the binary can extract it (D33 risk 4), and the contract
 *  says so explicitly. Its only job is to defeat precomputed rainbow tables
 *  against a stolen database, since key formats are public and short-prefixed.
 *  The fingerprint disambiguates and detects rotation; it never authenticates.
 *  Generated once (`crypto.randomBytes(32).toString('hex')`) and pasted as a
 *  literal: it must stay stable across reinstalls (rotation detection depends
 *  on it) and must live in CODE, never in the database, so a stolen DB alone
 *  is not enough to build the table. */
const FINGERPRINT_SALT = 'f231a05fb5d0a62ae8947dc3f0e5f7439d7db8199a43fe0ed0861608fb1b3998'

/** Salted SHA-256 over a plaintext key. MAIN-SIDE ONLY (D33 resolution b):
 *  never returned over IPC, never logged, never rendered. Two update() calls
 *  rather than one concatenated string: a small, free reduction in how many
 *  transient strings carry the plaintext. */
export function fingerprint(plaintextKey: string): string {
  return createHash('sha256').update(FINGERPRINT_SALT).update(plaintextKey).digest('hex')
}

export type VaultFailureKind =
  | 'encryption-unavailable' // safeStorage says no — refuse creation (D33 Q3)
  | 'undecryptable' // DPAPI refused: profile migration, machine change, key rotation
  | 'corrupt' // decrypted, but not a valid envelope
  | 'duplicate' // same key already stored on this provider (fingerprint match)
  | 'duplicate-label' // UNIQUE (provider_id, label) violated
  | 'not-found' // no row for the id given

/** The user-facing message for a failure. The ONLY variable admitted is a
 *  non-secret handle — the profile LABEL, or for 'not-found' the opaque id,
 *  which names no secret either (D33 clause 8): never the blob, never a byte
 *  length, never the underlying exception text, which for decryptString can
 *  be implementation-defined and is not worth trusting. */
export function failureMessage(kind: VaultFailureKind, label: string): string {
  switch (kind) {
    case 'encryption-unavailable':
      return `Credential profile '${label}' was NOT stored: Windows DPAPI encryption is unavailable. There is no plaintext fallback.`
    case 'undecryptable':
      return `Credential profile '${label}' is unavailable: decryption failed. Re-enter the credential in Settings.`
    case 'corrupt':
      return `Credential profile '${label}' is unavailable: the stored credential is corrupt. Re-enter the credential in Settings.`
    case 'duplicate':
      return `That key is already stored as credential profile '${label}'.`
    case 'duplicate-label':
      return `A credential profile labelled '${label}' already exists for this provider.`
    case 'not-found':
      return `Credential profile '${label}' was not found.`
  }
}

export type VaultResult<T> =
  | { ok: true; value: T }
  | { ok: false; kind: VaultFailureKind; message: string }

/** The metadata a credential row may show the renderer — the outbound
 *  contract mirrored by credentialProfileMetaSchema in shared/ipc.ts. */
export interface CredentialProfileMeta {
  id: string
  providerId: string
  label: string
  createdAt: string
  lastVerifiedAt: string | null
  unavailableSince: string | null
}

/** Project a stored row down to what may leave the main process. Written as an
 *  EXPLICIT CONSTRUCTION, never a spread-and-delete: `{...row}` minus two keys
 *  silently re-admits every column a future migration adds, which is exactly
 *  how a fingerprint or a blob ends up on the wire by accident. */
export function toProfileMeta(row: CredentialProfileRow): CredentialProfileMeta {
  return {
    id: row.id,
    providerId: row.providerId,
    label: row.label,
    createdAt: row.createdAt,
    lastVerifiedAt: row.lastVerifiedAt,
    unavailableSince: row.unavailableSince
  }
}

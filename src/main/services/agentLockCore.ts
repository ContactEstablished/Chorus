import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH } from '../../shared/ipc'

/**
 * The agent lock's PIN primitives, factored PURE so Vitest's `environment:
 * 'node'` covers them without Electron, a database or an IPC boundary — the
 * `vaultCore` / `attentionCore` / `agentEventsCore` shape.
 *
 * ─── WHAT THIS IS, AND WHAT IT IS DELIBERATELY NOT ────────────────────────
 * This is an ACCIDENT GUARD, and the whole design follows from saying so out
 * loud. The threat it defends against is a mis-aimed click on the ✕ of a pane
 * that has been running for forty minutes — a mistake by the machine's owner,
 * against themself. It is NOT an authorization system, it does not protect an
 * agent from another person at the same keyboard, and it must never be
 * described to the user as though it did.
 *
 * ⚠ THAT LIMIT IS STRUCTURAL, NOT A GAP TO CLOSE LATER. The PIN can be SET AND
 * CLEARED WITH NO PRIOR PIN (Matthew, this session — "it can be set and unset
 * without any other security"), so anyone who can reach the Settings screen can
 * clear the guard outright and then unlock everything. That is the intended
 * trade: a PIN you can lock yourself out of is worse than useless for a feature
 * whose entire job is to slow YOU down for one second. Nothing here should be
 * hardened without first changing that product decision, because hardening the
 * hash while `clearPin` stays unauthenticated buys precisely nothing.
 *
 * ─── SO WHY scrypt, IF IT GUARDS SO LITTLE ───────────────────────────────
 * Because the cost is one line and the alternative has a failure mode that
 * outlives this feature: PEOPLE REUSE PINS. The four digits typed here are
 * plausibly a phone unlock or a bank card, and a fast unsalted digest of a
 * 4-digit secret is a 10,000-entry rainbow table — one that anything with read
 * access to `chorus.db` could invert instantly and carry off the machine. scrypt
 * with a per-PIN random salt makes the stored row worthless anywhere else, which
 * is a property worth having even when the lock it guards is only a speed bump.
 *
 * Contrast `vaultCore.fingerprint`, which is deliberately a plain salted SHA-256:
 * it hashes a HIGH-ENTROPY API key for equality comparison only, where a rainbow
 * table cannot exist. Different input, different risk, different primitive — the
 * two are not an inconsistency.
 */

/** Stored form: `scrypt$<salt hex>$<derived hex>`. Self-describing so a future
 *  parameter change can be detected on read rather than silently mis-verified. */
const SCHEME = 'scrypt'
const SALT_BYTES = 16
const KEY_BYTES = 32

export type PinRefusal = 'too-short' | 'too-long' | 'has-whitespace'

/**
 * Validate a candidate PIN, returning null when it is acceptable.
 *
 * ⚠ WHITESPACE IS REFUSED RATHER THAN TRIMMED, and the reason is that a PIN is
 * WRITE-ONLY. A trim at set-time and a missing trim at verify-time is an
 * asymmetry nobody can debug from the outside: the user typed the same thing
 * twice and was told it was wrong, and no read path exists to show them what was
 * actually stored. Refusing the input at the door means the two sides cannot
 * disagree, because only one spelling was ever accepted.
 */
export function validatePin(pin: string): PinRefusal | null {
  if (/\s/.test(pin)) return 'has-whitespace'
  if (pin.length < PIN_MIN_LENGTH) return 'too-short'
  if (pin.length > PIN_MAX_LENGTH) return 'too-long'
  return null
}

/** Human-readable form of a refusal, authored here so main and the renderer
 *  cannot word the same rule two ways. */
export function describePinRefusal(refusal: PinRefusal): string {
  switch (refusal) {
    case 'too-short':
      return `PIN must be at least ${PIN_MIN_LENGTH} characters.`
    case 'too-long':
      return `PIN must be at most ${PIN_MAX_LENGTH} characters.`
    case 'has-whitespace':
      return 'PIN cannot contain spaces.'
  }
}

/** Derive the stored form. A fresh random salt per call, so setting the same
 *  PIN twice produces two different rows. */
export function hashPin(pin: string): string {
  const salt = randomBytes(SALT_BYTES)
  const derived = scryptSync(pin, salt, KEY_BYTES)
  return `${SCHEME}$${salt.toString('hex')}$${derived.toString('hex')}`
}

/**
 * Constant-time verification against the stored form.
 *
 * ⚠ EVERY MALFORMED-STORED-VALUE PATH RETURNS `false`, NEVER THROWS. `settings`
 * is a hand-editable table (getWindowBounds' defensive-read precedent), and a
 * corrupt row here would otherwise throw inside an IPC handler on the unlock
 * path — turning "your PIN is wrong" into an unhandled rejection with a locked
 * agent behind it. False is also the honest answer: a row that cannot be parsed
 * cannot confirm anything.
 *
 * ⚠ `timingSafeEqual` THROWS ON A LENGTH MISMATCH, which is why the lengths are
 * compared first. Doing that leaks the DERIVED KEY's length, which is a
 * compile-time constant, not the PIN's.
 */
export function verifyPin(pin: string, stored: string): boolean {
  const parts = stored.split('$')
  if (parts.length !== 3 || parts[0] !== SCHEME) return false
  let expected: Buffer
  let salt: Buffer
  try {
    salt = Buffer.from(parts[1], 'hex')
    expected = Buffer.from(parts[2], 'hex')
  } catch {
    return false
  }
  if (salt.length === 0 || expected.length !== KEY_BYTES) return false
  let actual: Buffer
  try {
    actual = scryptSync(pin, salt, KEY_BYTES)
  } catch {
    return false
  }
  return timingSafeEqual(actual, expected)
}

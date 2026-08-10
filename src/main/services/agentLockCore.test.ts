import { describe, it, expect } from 'vitest'
import { describePinRefusal, hashPin, validatePin, verifyPin } from './agentLockCore'
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH } from '../../shared/ipc'

describe('validatePin', () => {
  it('accepts a PIN at and above the floor', () => {
    expect(validatePin('1234')).toBeNull()
    expect(validatePin('correct-horse')).toBeNull()
    expect(validatePin('x'.repeat(PIN_MAX_LENGTH))).toBeNull()
  })

  it('refuses below the floor and above the ceiling', () => {
    expect(validatePin('123')).toBe('too-short')
    expect(validatePin('')).toBe('too-short')
    expect(validatePin('x'.repeat(PIN_MAX_LENGTH + 1))).toBe('too-long')
  })

  it('⚠ REFUSES whitespace rather than trimming it', () => {
    // A PIN is write-only: there is no read path, so a trim at set-time and a
    // missing trim at verify-time is an asymmetry nobody can debug from the
    // outside — the user types the same thing twice and is told it is wrong.
    // Refusing at the door means only one spelling was ever accepted.
    expect(validatePin('12 34')).toBe('has-whitespace')
    expect(validatePin(' 1234')).toBe('has-whitespace')
    expect(validatePin('1234 ')).toBe('has-whitespace')
    expect(validatePin('12\t34')).toBe('has-whitespace')
  })

  it('⚠ checks whitespace BEFORE length, so "   " is not merely "too short"', () => {
    // Four spaces clears the length floor; reporting it as short would send the
    // user off to type a longer string of spaces.
    expect(validatePin('    ')).toBe('has-whitespace')
  })

  it('every refusal has a sentence', () => {
    expect(describePinRefusal('too-short')).toContain(String(PIN_MIN_LENGTH))
    expect(describePinRefusal('too-long')).toContain(String(PIN_MAX_LENGTH))
    expect(describePinRefusal('has-whitespace')).toMatch(/space/i)
  })
})

describe('hashPin / verifyPin', () => {
  it('round-trips the correct PIN', () => {
    const stored = hashPin('4821')
    expect(verifyPin('4821', stored)).toBe(true)
  })

  it('rejects the wrong PIN', () => {
    const stored = hashPin('4821')
    expect(verifyPin('4822', stored)).toBe(false)
    expect(verifyPin('', stored)).toBe(false)
    expect(verifyPin('4821 ', stored)).toBe(false)
  })

  it('⚠ SALTS PER CALL — the same PIN hashes to two different rows', () => {
    // This is what makes the stored value worthless off this machine. People
    // reuse PINs; an unsalted digest of a 4-digit secret is a 10,000-entry
    // rainbow table that anything with read access to chorus.db could invert.
    const a = hashPin('4821')
    const b = hashPin('4821')
    expect(a).not.toBe(b)
    expect(verifyPin('4821', a)).toBe(true)
    expect(verifyPin('4821', b)).toBe(true)
  })

  it('stores a self-describing scheme rather than a bare digest', () => {
    // So a later parameter change is detectable on read instead of silently
    // mis-verifying every existing PIN.
    expect(hashPin('4821').startsWith('scrypt$')).toBe(true)
    expect(hashPin('4821').split('$')).toHaveLength(3)
  })

  it('⚠ NEVER CONTAINS THE PIN', () => {
    expect(hashPin('correct-horse')).not.toContain('correct-horse')
  })

  it('⚠ RETURNS false FOR A CORRUPT STORED VALUE — never throws', () => {
    // `settings` is a hand-editable table (the getWindowBounds defensive-read
    // precedent). A throw here would surface inside the unlock IPC handler as
    // an unhandled rejection, with a locked agent behind it and no way out.
    for (const corrupt of [
      '',
      'garbage',
      'scrypt$',
      'scrypt$onlytwo',
      'scrypt$aa$bb$cc',
      'bcrypt$aabb$ccdd',
      'scrypt$$',
      'scrypt$zz$zz', // non-hex
      `scrypt$${'aa'}$${'bb'}` // right shape, wrong key length
    ]) {
      expect(() => verifyPin('4821', corrupt)).not.toThrow()
      expect(verifyPin('4821', corrupt)).toBe(false)
    }
  })

  it('⚠ a truncated derived key is refused, not partially matched', () => {
    const stored = hashPin('4821')
    const [scheme, salt, key] = stored.split('$')
    const truncated = `${scheme}$${salt}$${key.slice(0, 32)}`
    // timingSafeEqual throws on a length mismatch — the length check in front
    // of it is what turns that into a plain `false`.
    expect(() => verifyPin('4821', truncated)).not.toThrow()
    expect(verifyPin('4821', truncated)).toBe(false)
  })

  it('handles a full-length passphrase, not just digits', () => {
    const long = 'x'.repeat(PIN_MAX_LENGTH)
    const stored = hashPin(long)
    expect(verifyPin(long, stored)).toBe(true)
    expect(verifyPin(long.slice(0, -1), stored)).toBe(false)
  })
})

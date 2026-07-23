import { describe, expect, it } from 'vitest'
import { CREDENTIAL_PLACEHOLDER, createScrubber } from './scrubber'

// Task 3-5: the pure streaming scrubber core. Synthetic values of realistic
// shape ONLY — built by concatenation so no literal in this file (or in the
// repo, for scripts/secret-grep.mjs) ever forms a full key shape. Never a
// real credential. (`KEY`'s tail is 46 chars once concatenated; the literals
// below the floor, like `sk-ant-api03-AAAA`, stay under the 20-char pattern
// floor on purpose — if the gate trips, the fixture is wrong, not the gate.)

const KEY = 'sk-ant-api03-' + 'x9Y8w7V6'.repeat(5) // 53 chars, realistic shape
const KEY2 = 'ghp_' + 'N3m8Q2r7'.repeat(5) // a second, different value

/** All length-8 windows of s — a surviving fragment at/above this size is a leak. */
function fragmentsOf(s: string, size = 8): string[] {
  const frags: string[] = []
  for (let i = 0; i + size <= s.length; i++) frags.push(s.slice(i, i + size))
  return frags
}

describe('createScrubber (Task 3-5)', () => {
  describe('identity fast path — no secrets registered', () => {
    it.each([
      ['plain text', 'hello world'],
      ['a square bracket', 'array[5] = 1'],
      ['ANSI escapes', '[1;32mgreen[0m [38;5;204mpink'],
      ['CRLF', 'line one\r\nline two\r\n'],
      ['non-ASCII', 'héllo wörld — 日本語 ✓']
    ])('returns the SAME reference for %s', (_name, chunk) => {
      const s = createScrubber([])
      // Reference equality: no copy, no scan, no allocation — every session
      // pays this on every chunk forever.
      expect(s.push(chunk)).toBe(chunk)
      expect(s.pendingLength()).toBe(0)
      expect(s.flush()).toBe('')
    })
  })

  describe('correctness', () => {
    it('replaces a single occurrence in one chunk', () => {
      const s = createScrubber([KEY])
      expect(s.push(`key is ${KEY} ok`)).toBe(`key is ${CREDENTIAL_PLACEHOLDER} ok`)
    })

    it('replaces multiple occurrences in one chunk', () => {
      const s = createScrubber([KEY])
      expect(s.push(`${KEY} and ${KEY}`)).toBe(
        `${CREDENTIAL_PLACEHOLDER} and ${CREDENTIAL_PLACEHOLDER}`
      )
    })

    it('replaces two different registered secrets', () => {
      const s = createScrubber([KEY, KEY2])
      expect(s.push(`a=${KEY} b=${KEY2}`)).toBe(
        `a=${CREDENTIAL_PLACEHOLDER} b=${CREDENTIAL_PLACEHOLDER}`
      )
    })

    it('overlapping secrets: the longer match wins with no residue', () => {
      const SHORT = 'sk-ant-api03-AAAABBBB' // tail 16 chars — under the gate floor
      const LONG = SHORT + 'CCCCDDDD'
      const s = createScrubber([SHORT, LONG])
      const out = s.push(`x${LONG}y`)
      expect(out).toBe(`x${CREDENTIAL_PLACEHOLDER}y`)
      expect(out).not.toContain('CCCCDDDD')
      // The shorter secret alone still matches.
      const s2 = createScrubber([SHORT, LONG])
      expect(s2.push(`x${SHORT}y`)).toBe(`x${CREDENTIAL_PLACEHOLDER}y`)
    })

    it('preserves text adjacent to a secret byte-for-byte', () => {
      const s = createScrubber([KEY])
      expect(s.push(`KEY=${KEY}\nnext line`)).toBe(`KEY=${CREDENTIAL_PLACEHOLDER}\nnext line`)
    })

    it('filters empty-string secrets (would match everywhere)', () => {
      const s = createScrubber(['', KEY])
      const out = s.push('plain')
      expect(out).toBe('plain')
      expect(s.push(KEY)).toBe(CREDENTIAL_PLACEHOLDER)
    })
  })

  describe('boundaries — the streaming half', () => {
    it('catches the secret split across two chunks at EVERY split point', () => {
      // The loop is the proof: a single hand-picked midpoint passes several
      // wrong implementations. Fresh scrubber per split point.
      for (let i = 1; i < KEY.length; i++) {
        const s = createScrubber([KEY])
        const out = s.push(KEY.slice(0, i)) + s.push(KEY.slice(i)) + s.flush()
        expect(out).toBe(CREDENTIAL_PLACEHOLDER)
        for (const frag of fragmentsOf(KEY)) expect(out).not.toContain(frag)
      }
    })

    it('catches the secret split across three chunks', () => {
      const s = createScrubber([KEY])
      const a = KEY.slice(0, 7)
      const b = KEY.slice(7, 31)
      const c = KEY.slice(31)
      const out = s.push(a) + s.push(b) + s.push(c) + s.flush()
      expect(out).toBe(CREDENTIAL_PLACEHOLDER)
      for (const frag of fragmentsOf(KEY)) expect(out).not.toContain(frag)
    })

    it('releases a false prefix INTACT when the next chunk diverges', () => {
      // Dropping the carry on divergence silently deletes user output — a
      // data-loss bug no security test notices.
      const s = createScrubber([KEY])
      const prefix = 'sk-ant-api03-AAAA'
      const first = s.push(prefix)
      const second = s.push('NOT-THE-KEY')
      expect(first + second + s.flush()).toBe(prefix + 'NOT-THE-KEY')
    })

    it('holds a proper prefix rather than emitting it early', () => {
      const s = createScrubber([KEY])
      const out = s.push(KEY.slice(0, 20))
      expect(out).toBe('')
      expect(s.pendingLength()).toBe(20)
    })

    it('bounds the carry at maxSecretLen - 1', () => {
      const s = createScrubber([KEY])
      // Feed the longest possible proper prefix and then some: the hold can
      // never reach the secret's full length (a full-length suffix would have
      // been replaced, not held).
      s.push(KEY.slice(0, KEY.length - 1))
      expect(s.pendingLength()).toBe(KEY.length - 1)
      s.push(KEY.slice(0, KEY.length - 1))
      // KEY.length-1 + KEY.length-1 chars held-candidate; the completed match
      // is replaced, and the residue hold stays below maxLen.
      expect(s.pendingLength()).toBeLessThan(KEY.length)
    })

    it('conservation: sum(outputs) + pendingLength === sum(inputs), observably', () => {
      // One property that catches drops, duplications, and unbounded carry
      // growth together — asserted on a sequence that exercises the carry
      // (proper prefixes that then diverge) but completes no match.
      const s = createScrubber([KEY])
      const chunks = [
        'sk-ant-api03-',
        'NOT-THE-KEY plain ',
        'sk-ant-api03-x9Y8',
        'w7 diverges here',
        'plain text with no prefix at all ',
        'sk-',
        'ant-api03-x9Y8w7V6 short again'
      ]
      let outLen = 0
      let inLen = 0
      for (const c of chunks) {
        outLen += s.push(c).length
        inLen += c.length
        expect(outLen + s.pendingLength()).toBe(inLen)
      }
      outLen += s.flush().length
      expect(outLen).toBe(inLen)
      expect(s.pendingLength()).toBe(0)
    })

    it('flush() emits the held carry, then returns empty', () => {
      const s = createScrubber([KEY])
      s.push(KEY.slice(0, 12))
      expect(s.flush()).toBe(KEY.slice(0, 12))
      expect(s.pendingLength()).toBe(0)
      expect(s.flush()).toBe('')
    })

    it('order preservation: concat(push returns) + flush === input, exactly', () => {
      // Long deterministic secret-free input, irregular chunk sizes, secrets
      // registered (the NON-identity path) — the render-correctness property.
      const charset = 'abcXYZ019 ._-[](){}#$%^&* \r\n'
      let input = ''
      let state = 42
      for (let i = 0; i < 5000; i++) {
        state = (state * 1103515245 + 12345) % 2147483648
        input += charset[state % charset.length]
      }
      const s = createScrubber([KEY, KEY2])
      let out = ''
      for (let i = 0; i < input.length; ) {
        state = (state * 1103515245 + 12345) % 2147483648
        const size = 1 + (state % 97)
        out += s.push(input.slice(i, i + size))
        i += size
      }
      out += s.flush()
      expect(out).toBe(input)
    })
  })
})

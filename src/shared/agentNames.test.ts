import { describe, expect, it } from 'vitest'
import {
  AGENT_NAMES,
  MAX_PEER_ADDRESS_LENGTH,
  suggestAgentName,
  toPeerAddress
} from './agentNames'
import { AGENT_DESCRIPTION_MAX, AGENT_NAME_MAX } from './ipc'

describe('agent name suggestions', () => {
  it('every name in the pool fits the wire cap', () => {
    // The dialog prefills the field from this pool and sends it straight back
    // through launchRequestSchema — a pool entry longer than the cap would be
    // a suggestion that cannot be launched.
    for (const name of AGENT_NAMES) {
      expect(name.length).toBeGreaterThan(0)
      expect(name.length).toBeLessThanOrEqual(AGENT_NAME_MAX)
    }
  })

  it('the caps are the ones the feature was specified with', () => {
    expect(AGENT_DESCRIPTION_MAX).toBe(50)
  })

  it('picks from the pool, deterministically for a given random', () => {
    expect(suggestAgentName([], () => 0)).toBe(AGENT_NAMES[0])
    // The clamp: Math.random() is [0,1) so 1 is out of contract, but a caller
    // passing it must still land on a real entry rather than undefined.
    expect(suggestAgentName([], () => 1)).toBe(AGENT_NAMES[AGENT_NAMES.length - 1])
  })

  it('skips names already used in the project', () => {
    const taken = [AGENT_NAMES[0], AGENT_NAMES[1]]
    expect(suggestAgentName(taken, () => 0)).toBe(AGENT_NAMES[2])
  })

  it('matches taken names case- and whitespace-insensitively', () => {
    // The user types the name by hand, so "  bob " and "Bob" are the same
    // person as far as a suggestion is concerned.
    expect(suggestAgentName(['  bOb  '], () => 0)).not.toBe('Bob')
  })

  it('ignores empty entries in the taken list', () => {
    // Sessions with no name arrive as filtered-out nulls upstream, but a blank
    // string must never be able to poison the pool.
    expect(suggestAgentName(['', '   '], () => 0)).toBe(AGENT_NAMES[0])
  })

  it('falls back to the whole pool when every name is taken', () => {
    // Unreachable past the pane cap, but it must return a NAME rather than
    // undefined or an invented "Bob 2" — the field is editable for this reason.
    const suggestion = suggestAgentName(AGENT_NAMES, () => 0)
    expect(AGENT_NAMES).toContain(suggestion)
  })
})

describe('toPeerAddress — a session name on its way to argv', () => {
  it('passes an ordinary pool name through untouched', () => {
    // The common case by far: the dialog prefills "Mae", nobody edits it, and
    // the address a peer types is the name the rail shows.
    expect(toPeerAddress('Mae')).toBe('Mae')
  })

  it('returns null for a name that is absent, empty, or only whitespace', () => {
    // An unnamed session is first-class (see AGENT_NAMES' own note). Null means
    // the adapter omits `-n` entirely and the CLI derives its own name, which
    // is byte-identical to every launch before D182.
    expect(toPeerAddress(null)).toBeNull()
    expect(toPeerAddress(undefined)).toBeNull()
    expect(toPeerAddress('')).toBeNull()
    expect(toPeerAddress('   ')).toBeNull()
  })

  it('⚠ strips every character that could matter to a shell, rather than escaping it', () => {
    // The point of the allow-list: a claude launch can still be resolved
    // through `cmd.exe /c` on the shim fallback (D176), where quote state is a
    // real defect surface — F96 killed every codex launch on exactly that. If
    // a quote cannot survive the sanitiser, no quoting rule has to be correct.
    expect(toPeerAddress('a"b')).toBe('ab')
    expect(toPeerAddress("a'b")).toBe('ab')
    expect(toPeerAddress('a^b')).toBe('ab')
    expect(toPeerAddress('a&b')).toBe('ab')
    expect(toPeerAddress('a|b')).toBe('ab')
    expect(toPeerAddress('a>b')).toBe('ab')
    // Built from a char code rather than written as an escape: a backslash is
    // exactly the character most likely to be mangled by whatever writes this
    // file, and a test that silently asserts on U+0008 instead proves nothing.
    expect(toPeerAddress(`a${String.fromCharCode(92)}b`)).toBe('ab')
    expect(toPeerAddress('a`b')).toBe('ab')
    expect(toPeerAddress('a$b')).toBe('ab')
    expect(toPeerAddress('a%b%')).toBe('ab')
  })

  it('collapses whitespace into single separators', () => {
    // `sessions.name` is free text and users type sentences into it.
    expect(toPeerAddress('Bug Fix Missing Color')).toBe('Bug-Fix-Missing-Color')
    expect(toPeerAddress('  Bug   Fix  ')).toBe('Bug-Fix')
  })

  it('never emits a leading or trailing separator, including after the length cut', () => {
    // A trailing dash reads as a truncation artefact in a peer's listing, and
    // the cut can expose one that was interior a moment earlier.
    expect(toPeerAddress('--Mae--')).toBe('Mae')
    expect(toPeerAddress('...Mae...')).toBe('Mae')
    const cutAtSeparator = 'a'.repeat(MAX_PEER_ADDRESS_LENGTH - 1) + ' bcd'
    expect(toPeerAddress(cutAtSeparator)).toBe('a'.repeat(MAX_PEER_ADDRESS_LENGTH - 1))
  })

  it('caps the length', () => {
    const long = 'M'.repeat(MAX_PEER_ADDRESS_LENGTH + 40)
    expect(toPeerAddress(long)).toHaveLength(MAX_PEER_ADDRESS_LENGTH)
  })

  it('returns null when nothing survives the allow-list', () => {
    // "!!!" is a name to a human and nothing to argv. Omitting the flag is the
    // honest outcome — better than publishing an empty address.
    expect(toPeerAddress('!!!')).toBeNull()
    expect(toPeerAddress('***')).toBeNull()
    expect(toPeerAddress('  ""  ')).toBeNull()
  })

  it('keeps the characters a derived CLI name already uses', () => {
    // The CLI's own names look like `wt-e27d8654-a9` and `chorus-2a`, so dots,
    // dashes and digits must survive or Chorus could not reproduce one.
    expect(toPeerAddress('wt-e27d8654-a9')).toBe('wt-e27d8654-a9')
    expect(toPeerAddress('chorus-2a')).toBe('chorus-2a')
    expect(toPeerAddress('v1.2_build')).toBe('v1.2_build')
  })
})

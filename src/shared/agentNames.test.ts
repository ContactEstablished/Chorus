import { describe, expect, it } from 'vitest'
import { AGENT_NAMES, suggestAgentName } from './agentNames'
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

import { describe, it, expect } from 'vitest'
import {
  BOLT_SCHEMES,
  DEFAULT_BOLT_PORT,
  DEFAULT_DATABASE_NAME,
  MEMORY_AUTH_MODES,
  MEMORY_MODES,
  boltHostOf,
  boltPortOf,
  containerNameFor,
  isDockerLegalName,
  isMemoryMode,
  isValidPort,
  projectSlug,
  supportedAuthMode,
  supportedMode,
  validateBoltUri,
  volumeNameFor
} from './memoryConfigCore'

/**
 * Task 6-3's pure core, tested exhaustively because it is pure and therefore
 * cheap — plan §9's bargain. The suite is deliberately heaviest on
 * `validateBoltUri`: that function is the structural guard keeping a password
 * out of `project_memory.bolt_uri`, which is the only free-text column in a
 * table designed to have no password column at all.
 */

describe('memoryConfigCore — vocabulary', () => {
  it('names all three modes, so the enum can be widened without a second home', () => {
    expect([...MEMORY_MODES]).toEqual(['local-docker', 'existing', 'aura'])
    expect([...MEMORY_AUTH_MODES]).toEqual(['none', 'credential'])
  })

  it('isMemoryMode is total over the vocabulary and refuses anything else', () => {
    for (const m of MEMORY_MODES) expect(isMemoryMode(m)).toBe(true)
    expect(isMemoryMode('sqlite')).toBe(false)
    expect(isMemoryMode('')).toBe(false)
    expect(isMemoryMode('Existing')).toBe(false)
  })

  it('Community Edition has exactly one database, and it is named here once', () => {
    // Measured by the 6-1 D4 pass: CREATE DATABASE is refused outright, and
    // SHOW DATABASES returns only `neo4j` and `system`.
    expect(DEFAULT_DATABASE_NAME).toBe('neo4j')
  })
})

describe('memoryConfigCore — mode support (the authored-refusal precedent)', () => {
  it('admits exactly one mode in this phase', () => {
    const supported = MEMORY_MODES.filter((m) => supportedMode(m).ok)
    expect(supported).toEqual(['existing'])
  })

  it('the two unsupported modes give DIFFERENT reasons, because they differ', () => {
    const local = supportedMode('local-docker')
    const aura = supportedMode('aura')
    if (local.ok || aura.ok) throw new Error('both should be refused in this phase')
    // A shared "not supported yet" would tell a user nothing about which one is
    // coming (local-docker, Stage 5) and which is waiting on a decision (aura,
    // which is inherently credentialed and travels with D128(a)).
    expect(local.reason).not.toEqual(aura.reason)
    expect(local.reason).toMatch(/container/)
    expect(aura.reason).toMatch(/Aura/)
  })

  it('every refusal is a sentence a user can act on, not a code', () => {
    for (const m of MEMORY_MODES) {
      const r = supportedMode(m)
      if (r.ok) continue
      expect(r.reason.length).toBeGreaterThan(20)
      expect(r.reason).toMatch(/\.$/)
      // Never an error code, never a symbol name.
      expect(r.reason).not.toMatch(/[A-Z_]{4,}|Error|undefined|null/)
    }
  })

  it('auth mode admits none only — credentialed memory left the phase (D128(a))', () => {
    expect(supportedAuthMode('none')).toEqual({ ok: true, value: 'none' })
    const cred = supportedAuthMode('credential')
    expect(cred.ok).toBe(false)
    expect(!cred.ok && cred.reason).toMatch(/not part of this release/)
  })
})

describe('memoryConfigCore — validateBoltUri: the four schemes', () => {
  it.each([...BOLT_SCHEMES])('accepts %s and makes the port explicit', (scheme) => {
    const r = validateBoltUri(`${scheme}://127.0.0.1`)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.scheme).toBe(scheme)
    expect(r.value.host).toBe('127.0.0.1')
    expect(r.value.port).toBe(DEFAULT_BOLT_PORT)
    // Normalisation makes the port explicit rather than leaving it implied:
    // two rows that differ only in whether 7687 was typed are one endpoint.
    expect(r.value.uri).toBe(`${scheme}://127.0.0.1:7687`)
  })

  it('keeps an explicit port', () => {
    const r = validateBoltUri('bolt://127.0.0.1:7688')
    expect(r.ok && r.value.port).toBe(7688)
    expect(r.ok && r.value.uri).toBe('bolt://127.0.0.1:7688')
  })

  it('refuses http — a Neo4j browser address is not a bolt address', () => {
    const r = validateBoltUri('http://localhost:7474')
    expect(r.ok).toBe(false)
    // The likely mistake is named, so the message tells the user what they did.
    expect(!r.ok && r.reason).toMatch(/bolt/)
  })

  it.each(['ftp://h', 'file://h', 'neo4j+ssc://h', 'bolt+ssc://h'])('refuses %s', (uri) => {
    expect(validateBoltUri(uri).ok).toBe(false)
  })
})

describe('memoryConfigCore — validateBoltUri: THE INLINE-CREDENTIALS REFUSAL', () => {
  /**
   * ⚠ THE CASE THIS MODULE EXISTS FOR. `project_memory` has no password column;
   * `bolt_uri` is free text. Accepting `bolt://user:pass@host` would store a
   * password in that table anyway, through the one door left open (D93).
   */
  /**
   * ⚠ THESE ASSERT WHICH GUARD FIRED, NOT MERELY THAT SOMETHING REFUSED.
   * `ok: false` alone would stay green if the userinfo check were deleted and
   * some unrelated branch (a host or port complaint) happened to refuse the
   * same string — a test passing for the wrong reason, which is the false-green
   * shape this phase has already been burned by once. Matching the userinfo
   * sentence pins the actual guard.
   */
  const USERINFO_REFUSAL = /Remove the username and password/

  it('refuses a URI carrying a username and password', () => {
    const r = validateBoltUri('bolt://neo4j:hunter2@127.0.0.1:7687')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toMatch(USERINFO_REFUSAL)
  })

  it('refuses a bare username too — the form that admits one admits both', () => {
    const r = validateBoltUri('bolt://neo4j@127.0.0.1:7687')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toMatch(USERINFO_REFUSAL)
  })

  it('refuses an empty password that is still a userinfo section', () => {
    const r = validateBoltUri('bolt://neo4j:@127.0.0.1:7687')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toMatch(USERINFO_REFUSAL)
  })

  it('the userinfo guard fires on an OTHERWISE PERFECTLY VALID address', () => {
    // The control for the three above: strip only the userinfo and the very
    // same string is accepted. So the refusal can only be coming from the
    // userinfo check — nothing else about this address is objectionable.
    expect(validateBoltUri('bolt://127.0.0.1:7687').ok).toBe(true)
    expect(validateBoltUri('bolt://neo4j:hunter2@127.0.0.1:7687').ok).toBe(false)
  })

  it('⚠ NEVER ECHOES THE PASSWORD BACK IN THE REFUSAL', () => {
    // Quoting the offending string is the obvious friendly thing to do and it
    // would copy the secret onto a surface that gets logged, screenshotted and
    // pasted into bug reports. Refusals name the PROBLEM, never the VALUE.
    const secret = 'hunter2SuperSecret'
    const r = validateBoltUri(`bolt://neo4j:${secret}@127.0.0.1:7687`)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).not.toContain(secret)
    expect(r.reason).not.toContain('neo4j:')
    expect(r.reason).not.toContain('127.0.0.1')
  })

  it('no refusal in the module echoes the input at all', () => {
    const inputs = [
      'bolt://neo4j:pw@h:7687',
      'http://h:7474',
      'bolt://h/some-db',
      'bolt://h?password=pw',
      'bolt://h:0',
      'not a uri at all',
      ''
    ]
    for (const input of inputs) {
      const r = validateBoltUri(input)
      expect(r.ok).toBe(false)
      if (r.ok) continue
      // The reason may contain the EXAMPLE address the module authors; it must
      // not contain the caller's own string.
      const meaningful = input.replace(/^bolt:\/\//, '')
      if (meaningful.length > 3) expect(r.reason).not.toContain(meaningful)
    }
  })
})

describe('memoryConfigCore — validateBoltUri: smuggling routes and hygiene', () => {
  it('refuses a path rather than stripping it', () => {
    // `bolt://h/db` is a user telling us the database name, which has its own
    // field and on Community can only be `neo4j`. Silently discarding it would
    // connect to something other than what was typed.
    expect(validateBoltUri('bolt://127.0.0.1:7687/mydb').ok).toBe(false)
  })

  it('accepts a bare trailing slash — that is not a path', () => {
    const r = validateBoltUri('bolt://127.0.0.1:7687/')
    expect(r.ok).toBe(true)
    expect(r.ok && r.value.uri).toBe('bolt://127.0.0.1:7687')
  })

  it('refuses a query string — the same smuggling route by another door', () => {
    expect(validateBoltUri('bolt://127.0.0.1:7687?password=hunter2').ok).toBe(false)
  })

  it('refuses a fragment', () => {
    expect(validateBoltUri('bolt://127.0.0.1:7687#tok').ok).toBe(false)
  })

  it('requires a host', () => {
    expect(validateBoltUri('bolt://').ok).toBe(false)
    expect(validateBoltUri('bolt:/nohost').ok).toBe(false)
  })

  it('refuses empty and whitespace-only input with an example, not a code', () => {
    for (const empty of ['', '   ', '\t\n']) {
      const r = validateBoltUri(empty)
      expect(r.ok).toBe(false)
      expect(!r.ok && r.reason).toMatch(/bolt:\/\//)
    }
  })

  it('trims surrounding whitespace — a pasted address usually carries some', () => {
    const r = validateBoltUri('  bolt://127.0.0.1:7688  ')
    expect(r.ok && r.value.uri).toBe('bolt://127.0.0.1:7688')
  })

  it('lower-cases the host, which URL does NOT do for a non-special scheme', () => {
    // Measured: `bolt+s://Host.Example.COM` keeps its capitals through `new
    // URL`. Two rows differing only in case would compare as two endpoints.
    const r = validateBoltUri('bolt+s://Host.Example.COM:7687')
    expect(r.ok && r.value.host).toBe('host.example.com')
    expect(r.ok && r.value.uri).toBe('bolt+s://host.example.com:7687')
  })

  it('lower-cases the scheme', () => {
    expect(validateBoltUri('BOLT://127.0.0.1')).toEqual({
      ok: true,
      value: { scheme: 'bolt', host: '127.0.0.1', port: 7687, uri: 'bolt://127.0.0.1:7687' }
    })
  })

  it('handles an IPv6 literal', () => {
    const r = validateBoltUri('bolt://[::1]:7687')
    expect(r.ok).toBe(true)
    expect(r.ok && r.value.host).toBe('[::1]')
  })

  it.each(['not a uri at all', 'bolt', '://h', 'bolt//h'])('refuses malformed input %s', (bad) => {
    expect(validateBoltUri(bad).ok).toBe(false)
  })
})

describe('memoryConfigCore — ports', () => {
  it('isValidPort is 1..65535 and integral', () => {
    expect(isValidPort(1)).toBe(true)
    expect(isValidPort(7687)).toBe(true)
    expect(isValidPort(65535)).toBe(true)
    expect(isValidPort(0)).toBe(false)
    expect(isValidPort(65536)).toBe(false)
    expect(isValidPort(-1)).toBe(false)
    expect(isValidPort(7687.5)).toBe(false)
    expect(isValidPort(Number.NaN)).toBe(false)
    expect(isValidPort(Number.POSITIVE_INFINITY)).toBe(false)
  })

  it('refuses port 0 — a legal integer, and not an endpoint', () => {
    const r = validateBoltUri('bolt://127.0.0.1:0')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toMatch(/between 1 and 65535/)
  })

  it('refuses an out-of-range port even though URL throws on it first', () => {
    // Measured: `new URL('bolt://h:65536')` throws ERR_INVALID_URL, so this
    // lands in the malformed-input branch. Both branches must refuse.
    expect(validateBoltUri('bolt://127.0.0.1:65536').ok).toBe(false)
    expect(validateBoltUri('bolt://127.0.0.1:-1').ok).toBe(false)
  })

  it('accepts the extremes', () => {
    expect(validateBoltUri('bolt://h:1').ok && boltPortOf('bolt://h:1')).toBe(1)
    expect(boltPortOf('bolt://h:65535')).toBe(65535)
  })
})

describe('memoryConfigCore — the chip’s port and host extractors', () => {
  it('boltPortOf returns the explicit port', () => {
    // This is the `● neo4j :7688` the status chip draws. It comes from a tested
    // function rather than from a split(':') inside a .vue file.
    expect(boltPortOf('bolt://127.0.0.1:7688')).toBe(7688)
  })

  it('boltPortOf falls back to bolt’s registered port when none is stated', () => {
    expect(boltPortOf('neo4j://example.test')).toBe(DEFAULT_BOLT_PORT)
  })

  it('boltPortOf returns null for an unparseable stored value, never a guess', () => {
    // D76 one field down: the chip omits the port rather than claiming a wrong
    // one, which is what a fallback-to-7687 would do for a corrupt row.
    expect(boltPortOf('garbage')).toBeNull()
    expect(boltPortOf('http://h:7474')).toBeNull()
    expect(boltPortOf('')).toBeNull()
  })

  it('boltHostOf mirrors it', () => {
    expect(boltHostOf('bolt://127.0.0.1:7688')).toBe('127.0.0.1')
    expect(boltHostOf('garbage')).toBeNull()
  })
})

describe('memoryConfigCore — Docker-legal naming (written here, consumed at Stage 5)', () => {
  it('produces the D92 prefix, not Plan.md’s stale agentdesk- one (D102)', () => {
    expect(containerNameFor('chorus')).toBe('chorus-neo4j-chorus')
    expect(containerNameFor('chorus')).not.toMatch(/agentdesk/)
    expect(volumeNameFor('chorus')).toBe('chorus-neo4j-chorus-data')
  })

  it.each([
    ['Chorus', 'chorus'],
    ['Chorus Second', 'chorus-second'],
    ['my_project.v2', 'my_project.v2'],
    ['  Padded  ', 'padded'],
    ['UPPER', 'upper'],
    ['a/b\\c', 'a-b-c'],
    ['café', 'caf'],
    ['---leading', 'leading'],
    ['trailing---', 'trailing'],
    ['9lives', '9lives']
  ])('slugs %s to %s', (name, expected) => {
    const r = projectSlug(name)
    expect(r.ok && r.value).toBe(expected)
  })

  it('every emitted name satisfies Docker’s own grammar', () => {
    const names = [
      'Chorus',
      'Chorus Second',
      'my_project.v2',
      '  Padded  ',
      'a/b\\c',
      'café',
      '---leading',
      'trailing---',
      'A'.repeat(200)
    ]
    for (const name of names) {
      const slug = projectSlug(name)
      expect(slug.ok).toBe(true)
      if (!slug.ok) continue
      expect(isDockerLegalName(containerNameFor(slug.value))).toBe(true)
      expect(isDockerLegalName(volumeNameFor(slug.value))).toBe(true)
    }
  })

  it('caps the slug so a very long project name cannot make an unusable name', () => {
    const r = projectSlug('A'.repeat(200))
    expect(r.ok && r.value.length).toBe(40)
  })

  it('refuses a name with nothing Docker can use, rather than emitting a bad one', () => {
    // A project named only in a non-Latin script is a real project; it just
    // cannot lend its name to a container. Saying so beats emitting something
    // the daemon refuses at provision time, a long way from here.
    for (const name of ['日本語', '   ', '...', '--', '']) {
      const r = projectSlug(name)
      expect(r.ok).toBe(false)
      expect(!r.ok && r.reason).toMatch(/Docker/)
    }
  })

  it('isDockerLegalName rejects what Docker rejects', () => {
    expect(isDockerLegalName('chorus-neo4j-x')).toBe(true)
    expect(isDockerLegalName('-leading-dash')).toBe(false)
    expect(isDockerLegalName('has space')).toBe(false)
    expect(isDockerLegalName('has/slash')).toBe(false)
    expect(isDockerLegalName('')).toBe(false)
  })
})

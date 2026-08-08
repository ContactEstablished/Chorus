import { describe, expect, it } from 'vitest'
import {
  assertNoSecretInRendered,
  renderMcpConfig,
  renderMcpLaunchArgs,
  tomlBasicString
} from './mcpConfigCore'
import { staticRegistry } from './registry'
import { supportsMcp, type McpDescriptor, type McpServerRef } from './types'

/**
 * Task 6-2 — the MCP security core's suite. The headline is the PROPERTY at the
 * bottom: every adapter × every server ref, no known-secret value survives into
 * anything Chorus would emit.
 *
 * ⚠ SECRET-SHAPED STRINGS ARE ASSEMBLED AT RUNTIME AND NEVER WRITTEN AS
 * LITERALS. `npm run grep:secrets` (G4) scans `src/` line by line with these
 * very patterns, so a literal `sk-ant-…` here would fail the gate this file
 * exists to complement. Splitting each prefix across a `+` means no SOURCE LINE
 * matches while the ASSEMBLED value does — which is exactly what the tests need,
 * and the assembled values are asserted to match below so the trick cannot rot
 * into a test that smuggles nothing.
 */
const SHAPED_ANTHROPIC = 'sk-' + 'ant-' + 'A'.repeat(28)
const SHAPED_OPENROUTER = 'sk-' + 'or-' + 'v1-' + 'b'.repeat(28)
const SHAPED_GITHUB = 'gh' + 'p_' + 'C'.repeat(40)
const SHAPED_AWS = 'AKI' + 'A' + 'ABCDEFGHIJKLMNOP'

/** A credential that LOOKS LIKE PROSE. No pattern list can recognise it, which
 *  is the whole reason the guard has an exact-value half as well as a shape
 *  half — a bolt password is far more likely to look like this than like an
 *  `sk-` key. */
const PROSE_SECRET = 'correct horse battery staple 42'

/** What the caller knows it injected — the exact-value half's input. */
const KNOWN_SECRETS: readonly string[] = [PROSE_SECRET, SHAPED_OPENROUTER]

/** The oracle, deliberately INDEPENDENT of `secret-patterns.json`: a plain
 *  substring test over the concrete values the refs were built from. Asking the
 *  pattern list whether the pattern list caught something would be circular. */
const SECRET_VALUES: readonly string[] = [
  SHAPED_ANTHROPIC,
  SHAPED_OPENROUTER,
  SHAPED_GITHUB,
  SHAPED_AWS,
  PROSE_SECRET
]

function oracleHasSecret(text: string): boolean {
  return SECRET_VALUES.some((v) => text.includes(v))
}

const JSON_FILE_DESCRIPTOR: Extract<
  McpDescriptor,
  { mechanism: 'project-file' | 'env-named-file' }
> = {
  mode: 'static',
  mechanism: 'project-file',
  format: 'json',
  location: 'project',
  configPath: '.mcp.json'
}

/** The real thing Phase 6 wires: local mode, no secret anywhere in the ref
 *  (D128(a) — `NEO4J_AUTH=none`, so there is nothing to pass). */
const CLEAN_REF: McpServerRef = {
  name: 'chorus_memory',
  command: 'uvx',
  args: ['mcp-neo4j-cypher'],
  // 6-1: NEO4J_URL is read FIRST and wins over NEO4J_URI (utils.py:68).
  env: { NEO4J_URL: 'bolt://127.0.0.1:7688' },
  envPassthrough: ['NEO4J_PASSWORD']
}

/** One ref per field a secret could travel in. The point of the corpus is that
 *  it is ADVERSARIAL: a property test whose inputs are all clean proves only
 *  that clean inputs stay clean. */
function smugglingRefs(secret: string, label: string): readonly (readonly [string, McpServerRef])[] {
  return [
    [
      `${label} in name`,
      { name: `chorus_${secret}`, command: 'uvx', args: ['mcp-neo4j-cypher'] }
    ],
    [`${label} in command`, { name: 'chorus_memory', command: secret, args: [] }],
    [`${label} in args`, { name: 'chorus_memory', command: 'uvx', args: [secret] }],
    [
      `${label} in env value`,
      {
        name: 'chorus_memory',
        command: 'uvx',
        args: [],
        env: { NEO4J_PASSWORD: secret }
      }
    ],
    [
      `${label} in envPassthrough`,
      { name: 'chorus_memory', command: 'uvx', args: [], envPassthrough: [secret] }
    ]
  ]
}

const REFS: readonly (readonly [string, McpServerRef])[] = [
  ['clean local-mode ref', CLEAN_REF],
  ...smugglingRefs(SHAPED_ANTHROPIC, 'anthropic-shaped key'),
  ...smugglingRefs(PROSE_SECRET, 'prose-shaped password'),
  ...smugglingRefs(SHAPED_GITHUB, 'github-shaped token')
]

describe('the secret-shaped fixtures actually carry the shapes they claim', () => {
  // Without this, a typo in the concatenation would turn the whole property
  // test into a suite that smuggles nothing and passes for the wrong reason.
  it.each([
    ['anthropic', SHAPED_ANTHROPIC],
    ['openrouter', SHAPED_OPENROUTER],
    ['github', SHAPED_GITHUB],
    ['aws-access-key-id', SHAPED_AWS]
  ])('the %s fixture is matched by the shape half with NO knownSecrets', (_name, value) => {
    expect(assertNoSecretInRendered(value, [])).not.toBeNull()
  })

  it('⚠ the prose-shaped password is NOT matched by the shape half — that is the point', () => {
    expect(assertNoSecretInRendered(PROSE_SECRET, [])).toBeNull()
    expect(assertNoSecretInRendered(PROSE_SECRET, [PROSE_SECRET])).not.toBeNull()
  })
})

describe('tomlBasicString (moved from codex.ts by 6-2, algorithm unchanged)', () => {
  it('wraps in double quotes', () => {
    expect(tomlBasicString('low')).toBe('"low"')
  })

  it('escapes backslashes BEFORE quotes, so escapes are not themselves escaped', () => {
    expect(tomlBasicString('C:\\Program Files\\x')).toBe('"C:\\\\Program Files\\\\x"')
    expect(tomlBasicString('say "hi"')).toBe('"say \\"hi\\""')
    expect(tomlBasicString('back\\"slash')).toBe('"back\\\\\\"slash"')
  })

  it('leaves a user-authored provider name with spaces as ONE string', () => {
    expect(tomlBasicString('My OpenRouter Route')).toBe('"My OpenRouter Route"')
  })
})

describe('renderMcpLaunchArgs (codex\u2019s per-launch argv \u2014 writes nothing)', () => {
  it('emits `-c` and its payload as TWO SEPARATE argv entries, matching buildLaunch', () => {
    const args = renderMcpLaunchArgs([CLEAN_REF])
    expect(args).toEqual([
      '-c',
      'mcp_servers.chorus_memory.command="uvx"',
      '-c',
      'mcp_servers.chorus_memory.args=["mcp-neo4j-cypher"]',
      '-c',
      'mcp_servers.chorus_memory.env_vars=["NEO4J_PASSWORD"]'
    ])
  })

  it('⚠ NEVER emits `.env=` — env_vars carries NAMES, env would carry VALUES', () => {
    const joined = renderMcpLaunchArgs([CLEAN_REF]).join(' ')
    expect(joined).toContain('.env_vars=')
    expect(joined).not.toContain('.env=')
    // The placeholder map is codex-irrelevant and must not reach argv at all.
    expect(joined).not.toContain('NEO4J_URL')
    expect(joined).not.toContain('bolt://')
  })

  it('omits env_vars entirely when the ref passes nothing through', () => {
    const args = renderMcpLaunchArgs([{ name: 's', command: 'uvx', args: [] }])
    expect(args).toEqual(['-c', 'mcp_servers.s.command="uvx"', '-c', 'mcp_servers.s.args=[]'])
  })

  it('renders several servers in order, and an empty list as no argv at all', () => {
    expect(renderMcpLaunchArgs([])).toEqual([])
    const two = renderMcpLaunchArgs([
      { name: 'a', command: 'x', args: ['1'] },
      { name: 'b', command: 'y', args: ['2', '3'] }
    ])
    expect(two).toEqual([
      '-c',
      'mcp_servers.a.command="x"',
      '-c',
      'mcp_servers.a.args=["1"]',
      '-c',
      'mcp_servers.b.command="y"',
      '-c',
      'mcp_servers.b.args=["2","3"]'
    ])
  })

  it('quotes array elements through the same TOML quoter', () => {
    const args = renderMcpLaunchArgs([{ name: 's', command: 'c', args: ['a "b"', 'c\\d'] }])
    expect(args[3]).toBe('mcp_servers.s.args=["a \\"b\\"","c\\\\d"]')
  })
})

describe('renderMcpConfig (bytes only \u2014 Stage 1 writes no file anywhere)', () => {
  it('renders the mcpServers object with command, args and placeholder env', () => {
    const text = renderMcpConfig(JSON_FILE_DESCRIPTOR, [CLEAN_REF])
    expect(JSON.parse(text)).toEqual({
      mcpServers: {
        chorus_memory: {
          command: 'uvx',
          args: ['mcp-neo4j-cypher'],
          env: { NEO4J_URL: 'bolt://127.0.0.1:7688' }
        }
      }
    })
    expect(text.endsWith('\n')).toBe(true)
  })

  it('omits `env` entirely for a ref that has none, rather than emitting null', () => {
    const text = renderMcpConfig(JSON_FILE_DESCRIPTOR, [
      { name: 's', command: 'uvx', args: ['x'] }
    ])
    expect(JSON.parse(text).mcpServers.s).toEqual({ command: 'uvx', args: ['x'] })
    expect(text).not.toContain('env')
  })

  it('⚠ does NOT render envPassthrough — it is codex\u2019s argv vocabulary, not a file\u2019s', () => {
    const text = renderMcpConfig(JSON_FILE_DESCRIPTOR, [CLEAN_REF])
    expect(text).not.toContain('NEO4J_PASSWORD')
    expect(text).not.toContain('envPassthrough')
  })

  it('⚠ REFUSES toml and yaml — the absent TOML branch is why no TOML writer is a dependency', () => {
    for (const format of ['toml', 'yaml'] as const) {
      expect(() => renderMcpConfig({ ...JSON_FILE_DESCRIPTOR, format }, [CLEAN_REF])).toThrow(
        /no toml renderer|no yaml renderer/
      )
    }
  })
})

describe('assertNoSecretInRendered (the guard)', () => {
  it('returns null for a clean render', () => {
    expect(assertNoSecretInRendered(renderMcpConfig(JSON_FILE_DESCRIPTOR, [CLEAN_REF]), KNOWN_SECRETS)).toBeNull()
    expect(
      assertNoSecretInRendered(renderMcpLaunchArgs([CLEAN_REF]).join(' '), KNOWN_SECRETS)
    ).toBeNull()
  })

  it('⚠ refuses a VALUE but allows its NAME — the distinction the whole design rests on', () => {
    expect(assertNoSecretInRendered('env_vars=["NEO4J_PASSWORD"]', KNOWN_SECRETS)).toBeNull()
    expect(
      assertNoSecretInRendered(`env={NEO4J_PASSWORD="${PROSE_SECRET}"}`, KNOWN_SECRETS)
    ).not.toBeNull()
  })

  it('⚠ an EMPTY knownSecrets does not make the guard vacuous — the shape half still runs', () => {
    expect(assertNoSecretInRendered(`command="${SHAPED_ANTHROPIC}"`, [])).not.toBeNull()
    expect(assertNoSecretInRendered(`command="${SHAPED_AWS}"`, [])).not.toBeNull()
  })

  it('catches a prose credential ONLY through the exact-value half', () => {
    const rendered = `command="${PROSE_SECRET}"`
    expect(assertNoSecretInRendered(rendered, [])).toBeNull()
    expect(assertNoSecretInRendered(rendered, [PROSE_SECRET])).not.toBeNull()
  })

  it('⚠ NEVER echoes the matched text back in the refusal', () => {
    for (const secret of [PROSE_SECRET, SHAPED_ANTHROPIC, SHAPED_GITHUB]) {
      const reason = assertNoSecretInRendered(`x="${secret}"`, [secret])
      expect(reason).not.toBeNull()
      expect(reason).not.toContain(secret)
    }
  })

  it('⚠ ignores an EMPTY entry in knownSecrets — "" is a substring of everything', () => {
    // A guard that refuses every render gets switched off, which is how a guard
    // dies. The empty entry must be skipped, not treated as a universal match.
    expect(assertNoSecretInRendered('command="uvx"', ['', PROSE_SECRET])).toBeNull()
  })

  it('runs over the RENDERED BYTES, so JSON escaping cannot smuggle a value past it', () => {
    // The ref object is not what is checked; the output string is. A secret
    // embedded next to characters JSON escapes still lands in the file.
    const ref: McpServerRef = { name: 's', command: 'uvx', args: [`--pw=${PROSE_SECRET}`] }
    const rendered = renderMcpConfig(JSON_FILE_DESCRIPTOR, [ref])
    expect(rendered).toContain(PROSE_SECRET)
    expect(assertNoSecretInRendered(rendered, KNOWN_SECRETS)).not.toBeNull()
  })
})

/* ─── THE HEADLINE PROPERTY ──────────────────────────────────────────── */

/** Every surface Chorus could emit for one adapter and one ref. Named, so a
 *  failure says WHICH one leaked rather than just that something did. */
function surfacesFor(adapterId: string, ref: McpServerRef): readonly (readonly [string, string])[] {
  const adapter = staticRegistry[adapterId as keyof typeof staticRegistry]
  const surfaces: (readonly [string, string])[] = [
    // The pure renderers, run for EVERY adapter — so the property is
    // non-vacuous even for the three adapters that declare `mcp: null` today
    // and would otherwise contribute nothing to check.
    ['renderMcpLaunchArgs', renderMcpLaunchArgs([ref]).join('\u0000')],
    ['renderMcpConfig', renderMcpConfig(JSON_FILE_DESCRIPTOR, [ref])]
  ]
  // …and the adapter's OWN implementation, when it has one. This is the surface
  // that actually reaches a child process.
  if (supportsMcp(adapter)) {
    surfaces.push(['adapter.mcpLaunchArgs', adapter.mcpLaunchArgs([ref]).join('\u0000')])
  }
  return surfaces
}

describe('⚠ PROPERTY: no secret value survives into anything Chorus emits', () => {
  const cases = Object.keys(staticRegistry).flatMap((id) =>
    REFS.map(([refLabel, ref]) => [id, refLabel, ref] as const)
  )

  it.each(cases)(
    'adapter %s × ref "%s": the guard refuses every surface that carries a secret',
    (adapterId, refLabel, ref) => {
      for (const [surface, rendered] of surfacesFor(adapterId, ref)) {
        const refusal = assertNoSecretInRendered(rendered, KNOWN_SECRETS)
        // ⚠ THE PROPERTY, and it is stated as an implication rather than as
        // "the output is clean": the renderers do not filter — the GUARD is
        // what holds the line. If a secret reached the bytes, the guard must
        // have refused them.
        const leaked = oracleHasSecret(rendered) && refusal === null
        expect({ adapter: adapterId, ref: refLabel, surface, leaked }).toEqual({
          adapter: adapterId,
          ref: refLabel,
          surface,
          leaked: false
        })
      }
    }
  )

  it('⚠ the corpus is ADVERSARIAL: every smuggling ref is actually refused somewhere', () => {
    // Without this, the property above could pass because nothing ever tried.
    // The clean ref is excluded by name — it is the one ref that must NOT be
    // refused on any surface.
    for (const [refLabel, ref] of REFS) {
      const surfaces = surfacesFor('codex', ref)
      const refusals = surfaces.map(([, r]) => assertNoSecretInRendered(r, KNOWN_SECRETS))
      const anyRefused = refusals.some((r) => r !== null)
      expect({ ref: refLabel, anyRefused }).toEqual({
        ref: refLabel,
        anyRefused: refLabel !== 'clean local-mode ref'
      })
    }
  })
})

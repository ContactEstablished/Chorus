import { describe, expect, it } from 'vitest'
import {
  assertNoSecretInRendered,
  guardRendered,
  mergeMcpConfig,
  renderMcpConfig,
  renderMcpLaunchArgs,
  tomlBasicString
} from './mcpConfigCore'
import { staticRegistry } from './registry'
import { supportsMcp, type McpFileDescriptor, type McpServerRef } from './types'

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

/** claude's real descriptor shape — `project-file`, and 6-5's `dialect`. */
const JSON_FILE_DESCRIPTOR: McpFileDescriptor = {
  mode: 'static',
  mechanism: 'project-file',
  format: 'json',
  location: 'project',
  configPath: '.mcp.json',
  dialect: 'claude'
}

/** opencode's — the SAME `format: 'json'`, a DIFFERENT dialect. The pair is the
 *  point: `format` never distinguished these two and 6-1 Finding 1 measured how
 *  far apart their shapes are. */
const OPENCODE_FILE_DESCRIPTOR: McpFileDescriptor = {
  mode: 'static',
  mechanism: 'env-named-file',
  format: 'json',
  location: 'custom',
  configPath: 'opencode.json',
  pathEnvVar: 'OPENCODE_CONFIG',
  dialect: 'opencode'
}

/** Both file dialects, for the property test and every "each dialect" case. */
const FILE_DESCRIPTORS: readonly (readonly [string, McpFileDescriptor])[] = [
  ['claude', JSON_FILE_DESCRIPTOR],
  ['opencode', OPENCODE_FILE_DESCRIPTOR]
]

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

/* ─── Task 6-5: the second dialect ───────────────────────────────────── */

describe('⚠ renderMcpConfig speaks TWO dialects, and they are not interchangeable', () => {
  /**
   * ⚠ THE EXACT BYTES 6-1 FINDING 1 READ BACK OUT OF `opencode debug config`
   * ON 1.18.15, asserted as a whole object rather than field by field. A
   * field-by-field test would pass while a WRONG EXTRA KEY sat beside the right
   * ones — and opencode's schema is `additionalProperties: false`, so an extra
   * key is precisely what gets the whole config rejected.
   */
  it('renders opencode’s measured shape: `mcp`, ONE command array, `environment`, type local', () => {
    const text = renderMcpConfig(OPENCODE_FILE_DESCRIPTOR, [CLEAN_REF])
    expect(JSON.parse(text)).toEqual({
      $schema: 'https://opencode.ai/config.json',
      mcp: {
        chorus_memory: {
          type: 'local',
          command: ['uvx', 'mcp-neo4j-cypher'],
          enabled: true,
          environment: { NEO4J_URL: 'bolt://127.0.0.1:7688' }
        }
      }
    })
    expect(text.endsWith('\n')).toBe(true)
  })

  it('⚠ the two dialects share NO top-level key — claude’s shape in opencode’s file is rejected, not tolerated', () => {
    const claude = JSON.parse(renderMcpConfig(JSON_FILE_DESCRIPTOR, [CLEAN_REF]))
    const opencode = JSON.parse(renderMcpConfig(OPENCODE_FILE_DESCRIPTOR, [CLEAN_REF]))
    expect(Object.keys(claude)).toEqual(['mcpServers'])
    expect(Object.keys(opencode).sort()).toEqual(['$schema', 'mcp'])
    // The three differences 6-1 measured, stated as assertions rather than as
    // a comment: split command vs one array, `env` vs `environment`.
    expect(claude.mcpServers.chorus_memory.command).toBe('uvx')
    expect(claude.mcpServers.chorus_memory.args).toEqual(['mcp-neo4j-cypher'])
    expect(opencode.mcp.chorus_memory.command).toEqual(['uvx', 'mcp-neo4j-cypher'])
    expect(claude.mcpServers.chorus_memory).not.toHaveProperty('environment')
    expect(opencode.mcp.chorus_memory).not.toHaveProperty('env')
    expect(opencode.mcp.chorus_memory).not.toHaveProperty('args')
  })

  it('⚠ the DIALECT decides, not the mechanism — the coupling that would break the fourth adapter', () => {
    // A hypothetical CLI that reads a PROJECT file in opencode's dialect. If
    // anything inferred the schema from `mechanism`, this would come back in
    // claude's shape.
    const hybrid: McpFileDescriptor = { ...JSON_FILE_DESCRIPTOR, dialect: 'opencode' }
    expect(Object.keys(JSON.parse(renderMcpConfig(hybrid, [CLEAN_REF]))).sort()).toEqual([
      '$schema',
      'mcp'
    ])
  })

  it('omits the env map entirely, in EITHER dialect, for a ref that carries none', () => {
    const bare: McpServerRef = { name: 's', command: 'uvx', args: ['x'] }
    expect(JSON.parse(renderMcpConfig(JSON_FILE_DESCRIPTOR, [bare])).mcpServers.s).toEqual({
      command: 'uvx',
      args: ['x']
    })
    expect(JSON.parse(renderMcpConfig(OPENCODE_FILE_DESCRIPTOR, [bare])).mcp.s).toEqual({
      type: 'local',
      command: ['uvx', 'x'],
      enabled: true
    })
  })

  it.each(FILE_DESCRIPTORS)(
    '⚠ %s never renders envPassthrough — it is codex’s argv vocabulary',
    (_label, descriptor) => {
      const text = renderMcpConfig(descriptor, [CLEAN_REF])
      expect(text).not.toContain('NEO4J_PASSWORD')
      expect(text).not.toContain('envPassthrough')
    }
  )
})

describe('⚠ mergeMcpConfig — MERGE, DO NOT CLOBBER, AND REFUSE RATHER THAN GUESS', () => {
  const CHORUS: McpServerRef = { ...CLEAN_REF, name: 'chorus-memory' }
  const PATH = 'C:\\Projects\\p\\.mcp.json'

  it('writes a fresh config when there is no file (and when the file is empty)', () => {
    for (const existing of [null, '', '   \n']) {
      const merged = mergeMcpConfig(JSON_FILE_DESCRIPTOR, [CHORUS], existing, PATH)
      expect(merged.ok).toBe(true)
      if (!merged.ok) return
      expect(Object.keys(JSON.parse(merged.rendered).mcpServers)).toEqual(['chorus-memory'])
    }
  })

  it('⚠ keeps the user’s OWN servers and their other top-level keys untouched', () => {
    const existing = JSON.stringify({
      $comment: 'a key Chorus has never heard of',
      mcpServers: {
        'their-server': { command: 'node', args: ['their-server.js'], env: { THEIR: 'value' } }
      }
    })
    const merged = mergeMcpConfig(JSON_FILE_DESCRIPTOR, [CHORUS], existing, PATH)
    expect(merged.ok).toBe(true)
    if (!merged.ok) return
    const out = JSON.parse(merged.rendered)
    expect(out.$comment).toBe('a key Chorus has never heard of')
    expect(out.mcpServers['their-server']).toEqual({
      command: 'node',
      args: ['their-server.js'],
      env: { THEIR: 'value' }
    })
    expect(Object.keys(out.mcpServers).sort()).toEqual(['chorus-memory', 'their-server'])
  })

  it('replaces ONLY its own key when re-run — a second write is not a second server', () => {
    const first = mergeMcpConfig(JSON_FILE_DESCRIPTOR, [CHORUS], null, PATH)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const moved: McpServerRef = { ...CHORUS, env: { NEO4J_URL: 'bolt://127.0.0.1:7699' } }
    const second = mergeMcpConfig(JSON_FILE_DESCRIPTOR, [moved], first.rendered, PATH)
    expect(second.ok).toBe(true)
    if (!second.ok) return
    const out = JSON.parse(second.rendered)
    expect(Object.keys(out.mcpServers)).toEqual(['chorus-memory'])
    expect(out.mcpServers['chorus-memory'].env).toEqual({ NEO4J_URL: 'bolt://127.0.0.1:7699' })
  })

  it('⚠ REFUSES a file that does not parse, and NAMES it — never overwrites it', () => {
    const merged = mergeMcpConfig(JSON_FILE_DESCRIPTOR, [CHORUS], '{ this is not json', PATH)
    expect(merged.ok).toBe(false)
    if (merged.ok) return
    expect(merged.reason).toContain(PATH)
    // ⚠ AND IT NEVER QUOTES THE CONTENT BACK — a user's own server entry could
    // hold anything, including a credential.
    expect(merged.reason).not.toContain('this is not json')
  })

  it.each([
    ['a JSON array', '[]'],
    ['a JSON null', 'null'],
    ['a bare string', '"hello"'],
    ['a servers key of the wrong type', '{"mcpServers": "not a map"}'],
    ['a servers key that is an array', '{"mcpServers": []}']
  ])('⚠ REFUSES %s rather than spreading it into something meaningless', (_label, existing) => {
    const merged = mergeMcpConfig(JSON_FILE_DESCRIPTOR, [CHORUS], existing, PATH)
    expect(merged.ok).toBe(false)
    if (merged.ok) return
    expect(merged.reason).toContain(PATH)
  })

  it('merges opencode’s file under ITS key, not claude’s', () => {
    const existing = JSON.stringify({ mcp: { theirs: { type: 'local', command: ['x'] } } })
    const merged = mergeMcpConfig(OPENCODE_FILE_DESCRIPTOR, [CHORUS], existing, 'x.json')
    expect(merged.ok).toBe(true)
    if (!merged.ok) return
    const out = JSON.parse(merged.rendered)
    expect(Object.keys(out.mcp).sort()).toEqual(['chorus-memory', 'theirs'])
    expect(out.mcp.theirs).toEqual({ type: 'local', command: ['x'] })
  })
})

describe('⚠ guardRendered — the guard as a TOKEN, so the write cannot skip it', () => {
  it('mints a token carrying the exact bytes when the render is clean', () => {
    const rendered = renderMcpConfig(JSON_FILE_DESCRIPTOR, [CLEAN_REF])
    const guard = guardRendered(rendered, KNOWN_SECRETS)
    expect(guard.ok).toBe(true)
    if (!guard.ok) return
    // ⚠ THE BYTES ARE THE ONES THAT WERE CHECKED. Anything that transformed
    // them after the guard would be writing bytes the guard never saw.
    expect(guard.guarded.bytes).toBe(rendered)
  })

  it('⚠ mints NOTHING when a secret is present — there is no other way to get a token', () => {
    const leaky = renderMcpConfig(JSON_FILE_DESCRIPTOR, [
      { name: 's', command: 'uvx', args: [], env: { NEO4J_PASSWORD: PROSE_SECRET } }
    ])
    const guard = guardRendered(leaky, KNOWN_SECRETS)
    expect(guard.ok).toBe(false)
    if (guard.ok) return
    expect(guard.reason).not.toContain(PROSE_SECRET)
  })

  it('refuses on SHAPE alone with an empty knownSecrets — in both dialects', () => {
    for (const [, descriptor] of FILE_DESCRIPTORS) {
      const rendered = renderMcpConfig(descriptor, [
        { name: 's', command: SHAPED_ANTHROPIC, args: [] }
      ])
      expect(guardRendered(rendered, []).ok).toBe(false)
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
    // ⚠ 6-5: BOTH FILE DIALECTS, AND THE MERGE OUTPUT TOO. The cross-product
    // now covers all three mechanisms — a renderer that leaked only through
    // opencode's `environment` map would have sailed straight past the
    // single-shape version of this list, and the merge is what actually reaches
    // the disk now that rendering is no longer the last transform.
    ...FILE_DESCRIPTORS.map(
      ([label, descriptor]) =>
        [`renderMcpConfig:${label}`, renderMcpConfig(descriptor, [ref])] as const
    ),
    ...FILE_DESCRIPTORS.map(([label, descriptor]) => {
      const merged = mergeMcpConfig(descriptor, [ref], null, 'x.json')
      return [`mergeMcpConfig:${label}`, merged.ok ? merged.rendered : ''] as const
    })
  ]
  // …and the adapter's OWN implementation, when it has one. This is the surface
  // that actually reaches a child process.
  if (supportsMcp(adapter)) {
    surfaces.push(['adapter.mcpLaunchArgs', adapter.mcpLaunchArgs([ref]).join('\u0000')])
    // ⚠ AND ITS OWN DECLARED DESCRIPTOR, not a fixture — this is the exact
    // dialect that adapter's `writeMcpConfig` renders with, so a wrong
    // `dialect` on a REAL adapter is caught here rather than by inspection.
    // `writeMcpConfig` itself is not called: it touches the filesystem, and
    // this suite is the pure core's.
    const descriptor = adapter.getCapabilities().mcp
    if (descriptor && descriptor.mechanism !== 'launch-args') {
      surfaces.push([`adapter.render:${descriptor.dialect}`, renderMcpConfig(descriptor, [ref])])
    }
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

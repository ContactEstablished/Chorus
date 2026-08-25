import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { claudeAdapter } from './claude'
import { codexAdapter } from './codex'
import { kimiAdapter } from './kimi'
import { opencodeAdapter } from './opencode'
import { wireMcpForLaunch, writeMcpConfigFile } from './mcpConfigWrite'
import type { McpFileDescriptor, McpServerRef, McpWriteContext } from './types'

/**
 * Task 6-5 — the WRITE layer's suite. The pure core's suite
 * (`mcpConfigCore.test.ts`) proves what the bytes say; this one proves what
 * lands on disk, which is a different question and the one D49 cares about.
 *
 * ⚠ IT WRITES INTO A REAL TEMP DIRECTORY, DELIBERATELY. Mocking `fs` would test
 * the mock's idea of rename semantics — and "temp file beside the target, then
 * rename" is precisely a claim about the real filesystem. Every test cleans up
 * after itself, and nothing here touches a path outside `os.tmpdir()`.
 */

let root: string
/** Stands in for the user's project — claude's file is project-scoped. */
let projectRoot: string
/** Stands in for Chorus's own userData directory — opencode's file lives here
 *  and NOT in the project, which is the security property. */
let chorusConfigDir: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'chorus-mcp-test-'))
  projectRoot = path.join(root, 'project')
  chorusConfigDir = path.join(root, 'chorus', 'mcp')
  fs.mkdirSync(projectRoot, { recursive: true })
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

const CLEAN_REF: McpServerRef = {
  name: 'chorus-memory',
  command: 'uvx',
  args: ['mcp-neo4j-cypher'],
  env: { NEO4J_URL: 'bolt://127.0.0.1:7688', NEO4J_DATABASE: 'neo4j' }
}

/** Assembled at runtime so no SOURCE line in this file matches the shapes
 *  `npm run grep:secrets` scans for — the mcpConfigCore suite's rule, and the
 *  same reason. */
const SHAPED_KEY = 'sk-' + 'ant-' + 'A'.repeat(28)
const PROSE_SECRET = 'correct horse battery staple 42'

function ctx(over: Partial<McpWriteContext> = {}): McpWriteContext {
  return { projectRoot, chorusConfigDir, servers: [CLEAN_REF], knownSecrets: [], ...over }
}

const CLAUDE_DESCRIPTOR: McpFileDescriptor = {
  mode: 'static',
  mechanism: 'project-file',
  format: 'json',
  location: 'project',
  configPath: '.mcp.json',
  dialect: 'claude'
}

const claudeFile = (): string => path.join(projectRoot, '.mcp.json')
const opencodeFile = (): string => path.join(chorusConfigDir, 'opencode.json')

describe('claude.writeMcpConfig — the project-scoped file', () => {
  it('writes `.mcp.json` into the PROJECT ROOT, in claude’s dialect', async () => {
    const result = await claudeAdapter.writeMcpConfig(ctx())
    expect(result).toEqual({ ok: true, path: claudeFile(), serversWritten: 1 })
    expect(JSON.parse(fs.readFileSync(claudeFile(), 'utf8'))).toEqual({
      mcpServers: {
        'chorus-memory': {
          command: 'uvx',
          args: ['mcp-neo4j-cypher'],
          env: { NEO4J_URL: 'bolt://127.0.0.1:7688', NEO4J_DATABASE: 'neo4j' }
        }
      }
    })
  })

  it('⚠ MERGES — a server the user wrote survives Chorus writing its own', async () => {
    fs.writeFileSync(
      claudeFile(),
      JSON.stringify({ mcpServers: { theirs: { command: 'node', args: ['x.js'] } } }, null, 2),
      'utf8'
    )
    expect((await claudeAdapter.writeMcpConfig(ctx())).ok).toBe(true)
    const out = JSON.parse(fs.readFileSync(claudeFile(), 'utf8'))
    expect(Object.keys(out.mcpServers).sort()).toEqual(['chorus-memory', 'theirs'])
    expect(out.mcpServers.theirs).toEqual({ command: 'node', args: ['x.js'] })
  })

  it('⚠ REFUSES an unparseable file and LEAVES IT EXACTLY AS IT WAS', async () => {
    const precious = '{ half a config the user was editing'
    fs.writeFileSync(claudeFile(), precious, 'utf8')
    const result = await claudeAdapter.writeMcpConfig(ctx())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('.mcp.json')
    // The whole point of the refusal: the bytes are untouched.
    expect(fs.readFileSync(claudeFile(), 'utf8')).toBe(precious)
  })

  it('⚠ REFUSES a zero-server write rather than truncating a config', async () => {
    fs.writeFileSync(claudeFile(), JSON.stringify({ mcpServers: { theirs: {} } }), 'utf8')
    const result = await claudeAdapter.writeMcpConfig(ctx({ servers: [] }))
    expect(result.ok).toBe(false)
    // Still theirs, still there.
    expect(JSON.parse(fs.readFileSync(claudeFile(), 'utf8')).mcpServers.theirs).toEqual({})
  })
})

describe('opencode.writeMcpConfig — the Chorus-owned file', () => {
  it('writes into CHORUS’s directory, creating it, in opencode’s dialect', async () => {
    const result = await opencodeAdapter.writeMcpConfig(ctx())
    expect(result).toEqual({ ok: true, path: opencodeFile(), serversWritten: 1 })
    expect(JSON.parse(fs.readFileSync(opencodeFile(), 'utf8'))).toEqual({
      $schema: 'https://opencode.ai/config.json',
      mcp: {
        'chorus-memory': {
          type: 'local',
          command: ['uvx', 'mcp-neo4j-cypher'],
          enabled: true,
          environment: { NEO4J_URL: 'bolt://127.0.0.1:7688', NEO4J_DATABASE: 'neo4j' }
        }
      }
    })
  })

  it('⚠ writes NOTHING into the project — the location IS the security property', async () => {
    await opencodeAdapter.writeMcpConfig(ctx())
    expect(fs.readdirSync(projectRoot)).toEqual([])
  })
})

describe('⚠ the guard, wired so a leak REFUSES and writes nothing at all', () => {
  it.each([
    ['a prose password the shape half cannot see', PROSE_SECRET, [PROSE_SECRET]],
    ['a key-shaped value, with NO knownSecrets at all', SHAPED_KEY, [] as string[]]
  ])('refuses %s', async (_label, secret, knownSecrets) => {
    const leaky: McpServerRef = { ...CLEAN_REF, env: { NEO4J_PASSWORD: secret } }
    const result = await claudeAdapter.writeMcpConfig(ctx({ servers: [leaky], knownSecrets }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    // ⚠ THE REFUSAL NEVER ECHOES THE VALUE — it would put the credential into a
    // log line and a screenshot, which is the exposure the refusal exists for.
    expect(result.reason).not.toContain(secret)
    // ⚠ AND NOTHING REACHED THE DISK: not the file, not the temp file beside it.
    expect(fs.existsSync(claudeFile())).toBe(false)
    expect(fs.readdirSync(projectRoot)).toEqual([])
  })

  it('⚠ refuses a secret that arrived in the EXISTING file, not from Chorus', async () => {
    // The merge writes the user's own entries back out, so the guard has to run
    // over the MERGED bytes. Guarding only what Chorus rendered would let this
    // through — Chorus would be the process that wrote the credential to disk.
    fs.writeFileSync(
      claudeFile(),
      JSON.stringify({ mcpServers: { theirs: { command: 'node', env: { K: SHAPED_KEY } } } }),
      'utf8'
    )
    const before = fs.readFileSync(claudeFile(), 'utf8')
    const result = await claudeAdapter.writeMcpConfig(ctx())
    expect(result.ok).toBe(false)
    expect(fs.readFileSync(claudeFile(), 'utf8')).toBe(before)
  })
})

describe('writeMcpConfigFile — atomicity and the temp file', () => {
  it('leaves NO temp file behind on success', async () => {
    await claudeAdapter.writeMcpConfig(ctx())
    expect(fs.readdirSync(projectRoot)).toEqual(['.mcp.json'])
  })

  it('⚠ puts the temp file BESIDE the target, not in TEMP — rename is atomic per volume', () => {
    // Asserted through the failure path, which is the only place the temp path
    // is observable: an unwritable TARGET DIRECTORY (here, a path whose parent
    // is a FILE) must fail without having created anything anywhere.
    const blocked = path.join(projectRoot, 'a-file')
    fs.writeFileSync(blocked, 'not a directory', 'utf8')
    const result = writeMcpConfigFile(
      CLAUDE_DESCRIPTOR,
      path.join(blocked, 'nested', '.mcp.json'),
      ctx()
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('Could not write')
    expect(fs.readFileSync(blocked, 'utf8')).toBe('not a directory')
  })

  it('⚠ reports a target it cannot READ rather than overwriting it', () => {
    // A directory where the config should be: `readFileSync` fails with EISDIR
    // rather than ENOENT, and treating that as "no file here" would be the
    // clobber the merge exists to prevent.
    const asDir = path.join(projectRoot, '.mcp.json')
    fs.mkdirSync(asDir)
    const result = writeMcpConfigFile(CLAUDE_DESCRIPTOR, asDir, ctx())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('Could not read')
    expect(fs.statSync(asDir).isDirectory()).toBe(true)
  })

  it('rewrites cleanly when run twice — the second launch is not a second server', async () => {
    await claudeAdapter.writeMcpConfig(ctx())
    await claudeAdapter.writeMcpConfig(ctx())
    const out = JSON.parse(fs.readFileSync(claudeFile(), 'utf8'))
    expect(Object.keys(out.mcpServers)).toEqual(['chorus-memory'])
    expect(fs.readdirSync(projectRoot)).toEqual(['.mcp.json'])
  })
})

describe('wireMcpForLaunch — descriptor-driven, and it never throws', () => {
  it('gives opencode its OPENCODE_CONFIG path, taken from the descriptor’s pathEnvVar', async () => {
    const wiring = await wireMcpForLaunch(opencodeAdapter, ctx())
    expect(wiring.envAdditions).toEqual({ OPENCODE_CONFIG: opencodeFile() })
    expect(wiring.result).toEqual({ ok: true, path: opencodeFile(), serversWritten: 1 })
    expect(fs.existsSync(opencodeFile())).toBe(true)
  })

  it('⚠ gives claude NO env addition — its file is found by convention, not by a variable', async () => {
    const wiring = await wireMcpForLaunch(claudeAdapter, ctx())
    expect(wiring.envAdditions).toEqual({})
    expect(wiring.result?.ok).toBe(true)
  })

  it('⚠ writes NO FILE for codex — argv-only, and the control case for D49', async () => {
    const wiring = await wireMcpForLaunch(codexAdapter, ctx())
    // F75/D150: NOT `NOTHING_TO_DO` any more. The file half is still nothing —
    // that is D49 — but the launch half is now populated, and the two halves of
    // this assertion are the whole of the repair.
    expect(wiring.result).toBeNull()
    expect(wiring.launchServers).toEqual([
      {
        name: 'chorus-memory',
        command: 'uvx',
        args: ['mcp-neo4j-cypher'],
        // NAMES only. The `env` map is dropped, not forwarded.
        envPassthrough: ['NEO4J_URL', 'NEO4J_DATABASE']
      }
    ])
    // ⚠ AND THE VALUES LEFT BY THE OTHER CHANNEL. A `launchServers` that
    // carried these would be the D150 violation this task exists to avoid.
    expect(wiring.envAdditions).toEqual({
      NEO4J_URL: 'bolt://127.0.0.1:7688',
      NEO4J_DATABASE: 'neo4j'
    })
    expect(wiring.launchServers[0]).not.toHaveProperty('env')
    // D49 is untouched: still not one byte written anywhere.
    expect(fs.readdirSync(projectRoot)).toEqual([])
    expect(fs.existsSync(chorusConfigDir)).toBe(false)
  })

  it('⚠ writes NOTHING for kimi — `mcp: null` stays, as a decision', async () => {
    const wiring = await wireMcpForLaunch(kimiAdapter, ctx())
    expect(wiring).toEqual({ envAdditions: {}, result: null, launchServers: [] })
    expect(fs.readdirSync(projectRoot)).toEqual([])
  })

  it('does nothing for an unknown agent, and nothing when there are no servers', async () => {
    expect(await wireMcpForLaunch(null, ctx())).toEqual({
      envAdditions: {},
      result: null,
      launchServers: []
    })
    expect(await wireMcpForLaunch(claudeAdapter, ctx({ servers: [] }))).toEqual({
      envAdditions: {},
      result: null,
      launchServers: []
    })
    expect(fs.readdirSync(projectRoot)).toEqual([])
  })

  it('⚠ a file-mechanism adapter gets NO launchServers — one mechanism per adapter', async () => {
    // The other half of the D150 rule: if claude ever returned servers here as
    // well as writing its `.mcp.json`, the same servers would be configured
    // twice by two mechanisms, and the second one would be invisible in review.
    expect((await wireMcpForLaunch(claudeAdapter, ctx())).launchServers).toEqual([])
    expect((await wireMcpForLaunch(opencodeAdapter, ctx())).launchServers).toEqual([])
  })

  it('⚠ REFUSES the memory server, not the launch, when a value trips the guard', async () => {
    // The guard proven to bite on the ARGV path, not only on the file path.
    const wiring = await wireMcpForLaunch(
      codexAdapter,
      ctx({
        servers: [{ ...CLEAN_REF, env: { NEO4J_URL: SHAPED_KEY } }],
        knownSecrets: [SHAPED_KEY]
      })
    )
    expect(wiring.result?.ok).toBe(false)
    // No servers AND no additions: a refusal costs the whole memory server.
    expect(wiring.launchServers).toEqual([])
    expect(wiring.envAdditions).toEqual({})
  })

  it('⚠ reports a refusal instead of env additions, and does not throw', async () => {
    fs.writeFileSync(claudeFile(), 'not json at all', 'utf8')
    const wiring = await wireMcpForLaunch(claudeAdapter, ctx())
    expect(wiring.envAdditions).toEqual({})
    expect(wiring.result?.ok).toBe(false)
  })
})

/* ================================================================== */
/* D179 — the effort write, including the launch with NO memory        */
/* ================================================================== */

describe('D179 — opencode\'s reasoning effort reaches the file', () => {
  const ROUTE = {
    modelId: 'z-ai/glm-5.2',
    baseUrl: 'https://openrouter.ai/api/v1',
    modelEffort: 'xhigh'
  }

  it('writes the effort BESIDE the servers, qualifying the model as `-m` does', async () => {
    const result = await opencodeAdapter.writeMcpConfig(ctx({ agentDefaults: ROUTE }))
    expect(result.ok).toBe(true)
    const out = JSON.parse(fs.readFileSync(opencodeFile(), 'utf8'))
    // ⚠ THE SAME SPELLING ARGV USES. opencode applies the variant only when the
    // block's model equals the model the session runs, so `-m` and this block
    // must name one string — hence one qualifier, `qualifyModel`.
    expect(out.agent).toEqual({ build: { model: 'openrouter/z-ai/glm-5.2', variant: 'xhigh' } })
    expect(Object.keys(out.mcp)).toEqual(['chorus-memory'])
  })

  /**
   * ⚠ THE POINT OF D179's PLUMBING, AND THE THING THAT WOULD SILENTLY NOT WORK.
   * Before it, this file was written only when the project had a memory server
   * to put in it — so an effort would have inherited memory's gate, and every
   * user without a graph would have had a control that did nothing.
   */
  it('⚠ writes with ZERO servers — the effort does not inherit memory\'s gate', async () => {
    const wiring = await wireMcpForLaunch(opencodeAdapter, ctx({ servers: [], agentDefaults: ROUTE }))
    expect(wiring.result?.ok).toBe(true)
    expect(wiring.envAdditions).toEqual({ OPENCODE_CONFIG: opencodeFile() })
    const out = JSON.parse(fs.readFileSync(opencodeFile(), 'utf8'))
    expect(out.agent.build.variant).toBe('xhigh')
    expect(out.mcp).toEqual({})
  })

  /**
   * ⚠ THE TEST THIS FILE GOT WRONG FIRST TIME, AND THE DRIVE CAUGHT.
   *
   * It used to assert that a launch with no servers and no effort did NOTHING —
   * which reads as conservative and is the invisible bug: the block a previous
   * launch wrote is still on disk, so opencode goes on applying an effort the
   * user cleared. MEASURED on the real CLI 2026-08-25 before the fix: after a
   * no-effort launch the message record still came back carrying
   * `variant: "xhigh"`. Chorus REWRITES the file it owns at every launch, so
   * the removal happens; the assertion below is that the file exists and is
   * empty of both, not that nothing happened.
   */
  it('⚠ REWRITES its own file even with nothing to say — that is how a cleared effort is undone', async () => {
    const wiring = await wireMcpForLaunch(
      opencodeAdapter,
      ctx({ servers: [], agentDefaults: { ...ROUTE, modelEffort: null } })
    )
    expect(wiring.result?.ok).toBe(true)
    expect(wiring.envAdditions).toEqual({ OPENCODE_CONFIG: opencodeFile() })
    const out = JSON.parse(fs.readFileSync(opencodeFile(), 'utf8'))
    expect('agent' in out).toBe(false)
    expect(out.mcp).toEqual({})
  })

  /** The whole round trip THROUGH THE LAUNCH PATH rather than through the
   *  adapter alone — the gap the earlier version of this suite left open, and
   *  the one the runtime probe found. */
  it('⚠ a no-effort launch REMOVES the block a previous launch wrote (via wireMcpForLaunch)', async () => {
    await wireMcpForLaunch(opencodeAdapter, ctx({ servers: [], agentDefaults: ROUTE }))
    expect(JSON.parse(fs.readFileSync(opencodeFile(), 'utf8')).agent.build.variant).toBe('xhigh')
    await wireMcpForLaunch(
      opencodeAdapter,
      ctx({ servers: [], agentDefaults: { ...ROUTE, modelEffort: null } })
    )
    expect('agent' in JSON.parse(fs.readFileSync(opencodeFile(), 'utf8'))).toBe(false)
  })

  /** ⚠ AND THE USER'S OWN FILE IS STILL PROTECTED. The rule is about a file
   *  CHORUS owns (`location: 'custom'`); claude's `.mcp.json` lives in the
   *  user's repository, and an empty write there would discard their entries. */
  it('does NOT write a user-owned project file with nothing to put in it', async () => {
    const wiring = await wireMcpForLaunch(claudeAdapter, ctx({ servers: [], agentDefaults: ROUTE }))
    expect(wiring.result).toBeNull()
    expect(fs.existsSync(claudeFile())).toBe(false)
  })

  /**
   * The round trip a real user makes: launch with an effort, then launch
   * without. The second write must undo the first — see the core suite for why
   * preserving it would be a permanent, invisible setting.
   */
  it('⚠ a later launch with no effort REMOVES the earlier one from the file', async () => {
    expect((await opencodeAdapter.writeMcpConfig(ctx({ agentDefaults: ROUTE }))).ok).toBe(true)
    expect(JSON.parse(fs.readFileSync(opencodeFile(), 'utf8')).agent.build.variant).toBe('xhigh')
    const second = await opencodeAdapter.writeMcpConfig(
      ctx({ agentDefaults: { ...ROUTE, modelEffort: null } })
    )
    expect(second.ok).toBe(true)
    const out = JSON.parse(fs.readFileSync(opencodeFile(), 'utf8'))
    expect('agent' in out).toBe(false)
    // The servers are untouched by the removal.
    expect(Object.keys(out.mcp)).toEqual(['chorus-memory'])
  })

  it('writes NO block when the launch names no model, however clear the effort is', async () => {
    // A variant with no model beside it is discarded by opencode in silence
    // (D179(b), control B), so writing one would be writing a lie into a file.
    const result = await opencodeAdapter.writeMcpConfig(
      ctx({ agentDefaults: { ...ROUTE, modelId: null } })
    )
    expect(result.ok).toBe(true)
    expect('agent' in JSON.parse(fs.readFileSync(opencodeFile(), 'utf8'))).toBe(false)
  })

  it('⚠ claude ignores agentDefaults entirely — no `agent` key in a `.mcp.json`', async () => {
    expect((await claudeAdapter.writeMcpConfig(ctx({ agentDefaults: ROUTE }))).ok).toBe(true)
    const out = JSON.parse(fs.readFileSync(claudeFile(), 'utf8'))
    expect(Object.keys(out)).toEqual(['mcpServers'])
  })

  /** codex declares `source: undefined` (its four rungs are its own), so the
   *  descriptor-driven gate answers false for it and the launch-args path is
   *  unchanged — asserted rather than assumed, because the gate reads a
   *  capability and a future adapter could change that answer. */
  it('an adapter whose efforts are its OWN is untouched by this path', async () => {
    const wiring = await wireMcpForLaunch(
      codexAdapter,
      ctx({ servers: [], agentDefaults: ROUTE })
    )
    expect(wiring.result).toBeNull()
    expect(wiring.launchServers).toEqual([])
  })
})

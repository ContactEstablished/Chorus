import { describe, expect, it } from 'vitest'
import {
  adapterDescriptorSchema,
  agentKindSchema,
  NO_HARNESS_ADAPTER_TYPE
} from '../../shared/ipc'
import { resolveCli } from '../services/cliDetect'
import { buildSecretEnv, mergeCapabilities } from './capabilities'
import { claudeAdapter } from './claude'
import { codexAdapter } from './codex'
import { resolveEnvVarName } from './env'
import { kimiAdapter } from './kimi'
import { NO_HARNESS_DESCRIPTOR, noHarnessAuthMethods } from './noHarness'
import { opencodeAdapter, qualifyModel } from './opencode'
import { getAdapter, getAdapterOrThrow, staticRegistry } from './registry'
import {
  isPtyAdapter,
  supportsHooks,
  supportsMcp,
  supportsResume,
  UnknownAgentError,
  type AgentCapabilities,
  type PtyAgentAdapter,
  type ResolvedCredential,
  type SupportsHooks,
  type SupportsMcp,
  type SupportsResume
} from './types'

/**
 * Task 3-3: the adapter unit suite. Imports neither `electron` nor `node-pty`
 * — the adapters only reach `child_process` through cliDetect, which runs
 * fine under Vitest.
 *
 * buildLaunch neutrality is asserted against resolveCli's LIVE output, never
 * against hardcoded strings: a literal expectation would silently encode this
 * machine's install layout (`.local\bin\claude.exe`, the npm shim path) into
 * the suite and pass on a machine where the CLI resolves differently.
 */

const adapters: readonly PtyAgentAdapter[] = [claudeAdapter, codexAdapter]

/** Obvious fake, short enough and wrong-shaped enough to never trip G4. */
const FAKE_CREDENTIAL: ResolvedCredential = {
  envVarName: 'CHORUS_UNITTEST_FAKE_KEY',
  value: 'fake-unit-test-credential-not-a-key',
  isSecret: true
}

describe.each(adapters.map((a) => [a.id, a] as const))('PtyAgentAdapter "%s"', (_id, adapter) => {
  it('buildLaunch reproduces resolveCli EXACTLY (the neutrality rule, spec §4.1)', () => {
    const expected = resolveCli(adapter.id)
    const request = adapter.buildLaunch({ sessionId: 'unit-test-session', cwd: 'C:\\Projects' })
    expect(request.executable).toBe(expected.file)
    expect(request.args).toEqual(expected.args)
    expect(request.cwd).toBe('C:\\Projects')
  })

  it('contributes NO environment for a credential-free spec (the non-goal test)', () => {
    const request = adapter.buildLaunch({ sessionId: 's', cwd: 'C:\\Projects' })
    expect(request.envAdditions).toEqual({})
    expect(request.secretEnv).toEqual({})
  })

  it('puts a credential in secretEnv under its env var name, never in envAdditions', () => {
    const request = adapter.buildLaunch({ sessionId: 's', cwd: 'C:\\Projects', credential: FAKE_CREDENTIAL })
    expect(request.secretEnv).toEqual({ CHORUS_UNITTEST_FAKE_KEY: FAKE_CREDENTIAL.value })
    expect(request.envAdditions).toEqual({})
    expect(JSON.stringify(request.envAdditions)).not.toContain(FAKE_CREDENTIAL.value)
  })

  it('buildLaunch is SYNCHRONOUS (SessionManager.launch is synchronous)', () => {
    const request = adapter.buildLaunch({ sessionId: 's', cwd: 'C:\\Projects' })
    expect(request).not.toBeInstanceOf(Promise)
  })

  /* ---- Task 3a-4: effort normalization -------------------------------- */

  it('capability honesty: a populated reasoningEffort carries non-empty levels, each with non-empty args', () => {
    const descriptor = adapter.getCapabilities().reasoningEffort
    expect(descriptor).not.toBeNull()
    expect(descriptor!.levels.length).toBeGreaterThan(0)
    for (const level of descriptor!.levels) {
      expect(level.args.length).toBeGreaterThan(0)
      for (const token of level.args) expect(token.length).toBeGreaterThan(0)
    }
  })

  it('declares all four app levels exactly once (the slider has four positions)', () => {
    const ids = adapter.getCapabilities().reasoningEffort!.levels.map((l) => l.id)
    expect([...ids].sort()).toEqual(['balanced', 'deep', 'fast', 'max'])
  })

  it('⚠ BEHAVIOUR NEUTRALITY: no effort chosen -> args byte-identical to resolveCli', () => {
    // The unit-level statement of the runtime acceptance criterion. A diff that
    // quietly altered every launch in the app would fail here first.
    const expected = resolveCli(adapter.id)
    expect(adapter.buildLaunch({ sessionId: 's', cwd: 'C:\\Projects' }).args).toEqual(expected.args)
    // …and an effortOptionId outside the vocabulary is equally inert.
    expect(
      adapter.buildLaunch({ sessionId: 's', cwd: 'C:\\Projects', effortOptionId: 'turbo' }).args
    ).toEqual(expected.args)
  })

  it('a chosen level appends exactly that level’s declared tokens, and nothing else', () => {
    const base = resolveCli(adapter.id).args
    for (const level of adapter.getCapabilities().reasoningEffort!.levels) {
      const args = adapter.buildLaunch({
        sessionId: 's',
        cwd: 'C:\\Projects',
        effortOptionId: level.id
      }).args
      expect(args).toEqual([...base, ...level.args])
    }
  })

  it('⚠ a raw override in extraArgs suppresses Chorus’s own effort tokens ENTIRELY', () => {
    const base = resolveCli(adapter.id).args
    const descriptor = adapter.getCapabilities().reasoningEffort!
    const deep = descriptor.levels.find((l) => l.id === 'deep')!
    // The user's own knob, in the CLI's vocabulary — the same shape the
    // descriptor emits, but a value Chorus never picks.
    const override = deep.args[1].replace('high', 'xhigh')
    const args = adapter.buildLaunch({
      sessionId: 's',
      cwd: 'C:\\Projects',
      effortOptionId: 'deep',
      extraArgs: [deep.args[0], override]
    }).args
    // Chorus emits NOTHING of its own; it does not emit both and rely on
    // last-wins parsing.
    expect(args).toEqual(base)
  })
})

describe('mergeCapabilities (the null-vs-undefined rule, CR-3.1 risk 7)', () => {
  const base: AgentCapabilities = {
    interactiveTerminal: true,
    worktreeSafe: true,
    skills: false,
    subscriptionLogin: true,
    apiKey: true,
    // 3a-4: `cliFlag: string` was REPLACED by `args: readonly string[]` — a
    // single string cannot express `['-c','model_reasoning_effort="high"']`.
    reasoningEffort: { mode: 'static', levels: [{ id: 'deep', label: 'Deep', args: ['--effort', 'high'] }] },
    sessionResume: null,
    mcp: { mode: 'static', format: 'json', location: 'project', configPath: '.mcp.json' },
    hooks: null
  }

  it('undefined detected -> the base itself (identity)', () => {
    expect(mergeCapabilities(base)).toBe(base)
    expect(mergeCapabilities(base, undefined)).toBe(base)
  })

  it('empty object -> nothing overridden', () => {
    expect(mergeCapabilities(base, {})).toEqual(base)
  })

  it('a partial with one defined field overrides ONLY that field', () => {
    const out = mergeCapabilities(base, { skills: true })
    expect(out.skills).toBe(true)
    expect(out.mcp).toEqual(base.mcp)
    expect(out.reasoningEffort).toEqual(base.reasoningEffort)
    expect(out.interactiveTerminal).toBe(base.interactiveTerminal)
  })

  it('an explicit NULL overrides a non-null base (probe determined ABSENT)', () => {
    const out = mergeCapabilities(base, { mcp: null, reasoningEffort: null })
    expect(out.mcp).toBeNull()
    expect(out.reasoningEffort).toBeNull()
  })

  it('an explicit UNDEFINED field preserves the base value (not probed)', () => {
    const out = mergeCapabilities(base, { mcp: undefined })
    expect(out.mcp).toEqual(base.mcp)
  })
})

describe('buildSecretEnv', () => {
  it('is empty without a credential (Phase 3: always)', () => {
    expect(buildSecretEnv(undefined)).toEqual({})
  })

  it('maps a credential under its envVarName', () => {
    expect(buildSecretEnv(FAKE_CREDENTIAL)).toEqual({ CHORUS_UNITTEST_FAKE_KEY: FAKE_CREDENTIAL.value })
  })
})

describe('staticRegistry (D34(b): compiler-enforced coverage of the wire vocabulary)', () => {
  it('every agentKindSchema option resolves to an adapter whose id IS the kind', () => {
    // Iterate the enum's options — deliberately NOT two hardcoded names, so
    // the test survives Phase 3a widening the vocabulary (a kind without an
    // adapter fails HERE and at the registry's Record<AgentKind, …> type).
    for (const kind of agentKindSchema.options) {
      expect(getAdapter(kind)).toBeDefined()
      expect(staticRegistry[kind].id).toBe(kind)
    }
  })

  it("getAdapter('nope') is undefined; getAdapterOrThrow('nope') throws UnknownAgentError naming the id", () => {
    expect(getAdapter('nope')).toBeUndefined()
    expect(() => getAdapterOrThrow('nope')).toThrow(UnknownAgentError)
    expect(() => getAdapterOrThrow('nope')).toThrow(/nope/)
    try {
      getAdapterOrThrow('nope')
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(UnknownAgentError)
      expect((err as UnknownAgentError).agentId).toBe('nope')
    }
  })
})

describe('D86: the kimi adapter (D4-verified against kimi.exe 0.29.1)', () => {
  it('⚠ NEVER emits `-c` — on kimi that is --continue, not --config', () => {
    // THE trap this adapter exists to not fall into. codex carries its whole
    // OpenRouter route in `-c key=value` overrides (D47); on kimi 0.29.1 `-c`
    // is `--continue`, so a copied buildLaunch would silently RESUME a stale
    // session instead of configuring anything. Asserted over the real argv.
    const req = kimiAdapter.buildLaunch({
      sessionId: 's',
      cwd: 'C:\\Projects',
      credential: FAKE_CREDENTIAL,
      route: {
        providerKey: 'chorus',
        providerName: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        modelId: 'kimi-code/k3'
      }
    })
    expect(req.args).not.toContain('-c')
    expect(req.args).not.toContain('--continue')
    // …and no route material reached argv either: kimi has no per-launch
    // config door, so a base URL simply cannot be applied to this child.
    expect(req.args.join(' ')).not.toContain('openrouter.ai')
    expect(req.args.join(' ')).not.toContain('base_url')
  })

  it('emits `-m <alias>` only when the route names a model, never the string "null"', () => {
    const withModel = kimiAdapter.buildLaunch({
      sessionId: 's',
      cwd: 'C:\\Projects',
      credential: FAKE_CREDENTIAL,
      route: { providerKey: 'chorus', providerName: 'R', baseUrl: 'https://x.invalid', modelId: 'kimi-code/k3' }
    })
    expect(withModel.args).toContain('-m')
    expect(withModel.args[withModel.args.indexOf('-m') + 1]).toBe('kimi-code/k3')

    const noModel = kimiAdapter.buildLaunch({
      sessionId: 's',
      cwd: 'C:\\Projects',
      credential: FAKE_CREDENTIAL,
      route: { providerKey: 'chorus', providerName: 'R', baseUrl: 'https://x.invalid', modelId: null }
    })
    expect(noModel.args).not.toContain('-m')
    expect(noModel.args.join(' ')).not.toContain('null')
  })

  it('⚠ declares apiKey FALSE and effort NULL — both measured absences, not oversights', () => {
    const caps = kimiAdapter.getCapabilities()
    // No --api-key flag and no env var kimi reads for one: auth is
    // ~/.kimi-code state. Declaring true would put a dead option in the
    // provider form that the launch dialog would then act on.
    expect(caps.apiKey).toBe(false)
    // kimi HAS an effort ladder (per-model support_efforts) but NO CLI flag to
    // set it, and Chorus's slider emits argv. Null means the control does not
    // render, which is the honest outcome.
    expect(caps.reasoningEffort).toBeNull()
    expect(caps.subscriptionLogin).toBe(true)
    expect(caps.skills).toBe(true) // --skills-dir, verified via --help
  })

  it('offers subscription auth ONLY — the absence of api_key is the declaration', () => {
    const methods = kimiAdapter.getAuthMethods()
    expect(methods.map((m) => m.type)).toEqual(['subscription'])
    expect(methods[0].requiredEnvVar).toBeNull()
  })

  it('contributes no environment for a credential-free spec, like every adapter', () => {
    const req = kimiAdapter.buildLaunch({ sessionId: 's', cwd: 'C:\\Projects' })
    expect(req.envAdditions).toEqual({})
    expect(req.secretEnv).toEqual({})
    expect(req.cwd).toBe('C:\\Projects')
  })
})

describe('D90: the opencode adapter (D4-verified against opencode 1.18.8)', () => {
  /* ── qualifyModel: the one piece of NEW logic, tested as a pure function ──
   *
   * Deliberately separated from buildLaunch so these cases need no `where.exe`
   * and no installed binary: the translation is the thing most likely to be
   * "fixed" wrongly later, and it should fail on any machine when it breaks.
   */
  it('prefixes an OpenRouter id with opencode’s own provider namespace', () => {
    // D4: `opencode models openrouter` returns `openrouter/deepseek/deepseek-v4-pro`.
    // Chorus stores the OpenRouter id; opencode wants it namespaced.
    expect(qualifyModel('deepseek/deepseek-v4-pro', 'https://openrouter.ai/api/v1')).toBe(
      'openrouter/deepseek/deepseek-v4-pro'
    )
    expect(qualifyModel('z-ai/glm-5.2', 'https://openrouter.ai/api/v1')).toBe(
      'openrouter/z-ai/glm-5.2'
    )
  })

  it('is IDEMPOTENT — an already-qualified id is never double-prefixed', () => {
    expect(qualifyModel('openrouter/qwen/qwen3-coder', 'https://openrouter.ai/api/v1')).toBe(
      'openrouter/qwen/qwen3-coder'
    )
  })

  it('⚠ PASSES THROUGH UNTOUCHED for a base URL it cannot name from evidence', () => {
    // Inventing a prefix from an arbitrary hostname would produce a model id
    // nobody chose. An unrecognised route yields the id exactly as stored and
    // lets opencode accept or reject it on its own terms — a legible failure.
    expect(qualifyModel('some/model', 'https://api.example.invalid/v1')).toBe('some/model')
    expect(qualifyModel('some/model', null)).toBe('some/model')
    // A malformed base_url is not a routing decision to guess at.
    expect(qualifyModel('some/model', 'not a url')).toBe('some/model')
  })

  it('matches on HOST, so a path or trailing slash cannot defeat it', () => {
    expect(qualifyModel('a/b', 'https://openrouter.ai/api/v1/')).toBe('openrouter/a/b')
    expect(qualifyModel('a/b', 'https://OpenRouter.AI/api/v1')).toBe('openrouter/a/b')
  })

  it('returns null for a null model — "null" must never reach argv as a string', () => {
    expect(qualifyModel(null, 'https://openrouter.ai/api/v1')).toBeNull()
  })

  /* ── the adapter's declarations ─────────────────────────────────────────── */

  it('⚠ NEVER emits `-c` — on opencode that is --continue, not --config', () => {
    // The SAME trap kimi sets, verified independently against opencode 1.18.8:
    // `-c, --continue  continue the last session`. A copied codex buildLaunch
    // would silently resume a stale session instead of configuring a route.
    const req = opencodeAdapter.buildLaunch({
      sessionId: 's',
      cwd: 'C:\\Projects',
      credential: FAKE_CREDENTIAL,
      route: {
        providerKey: 'chorus',
        providerName: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        modelId: 'deepseek/deepseek-v4-pro'
      }
    })
    expect(req.args).not.toContain('-c')
    expect(req.args).not.toContain('--continue')
    // The route's base URL is NOT forwarded: opencode carries OpenRouter's
    // endpoint itself and selects it by model prefix + env var.
    expect(req.args.join(' ')).not.toContain('openrouter.ai')
    // The model DID make it through, namespaced.
    expect(req.args[req.args.indexOf('-m') + 1]).toBe('openrouter/deepseek/deepseek-v4-pro')
  })

  it('⚠ the key travels in secretEnv, NEVER in argv', () => {
    const req = opencodeAdapter.buildLaunch({
      sessionId: 's',
      cwd: 'C:\\Projects',
      credential: FAKE_CREDENTIAL,
      route: {
        providerKey: 'chorus',
        providerName: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        modelId: 'z-ai/glm-5.2'
      }
    })
    expect(req.secretEnv).toEqual({ CHORUS_UNITTEST_FAKE_KEY: FAKE_CREDENTIAL.value })
    expect(req.args.join(' ')).not.toContain(FAKE_CREDENTIAL.value)
    expect(JSON.stringify(req.envAdditions)).not.toContain(FAKE_CREDENTIAL.value)
  })

  it('emits no `-m` at all when the route names no model', () => {
    const req = opencodeAdapter.buildLaunch({
      sessionId: 's',
      cwd: 'C:\\Projects',
      credential: FAKE_CREDENTIAL,
      route: {
        providerKey: 'chorus',
        providerName: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        modelId: null
      }
    })
    expect(req.args).not.toContain('-m')
    expect(req.args.join(' ')).not.toContain('null')
  })

  it('⚠ declares apiKey TRUE and effort NULL — both measured, neither assumed', () => {
    const caps = opencodeAdapter.getCapabilities()
    // TRUE: proven by env-var gating — with OPENROUTER_API_KEY set,
    // `opencode providers list` reports an Environment section; without it,
    // `opencode models openrouter` fails "Provider not found: openrouter".
    expect(caps.apiKey).toBe(true)
    // NULL: `--variant` (the effort knob) exists ONLY under `opencode run`.
    // Chorus launches the top-level TUI, where the flag does not exist.
    expect(caps.reasoningEffort).toBeNull()
    // FALSE, and a DIFFERENT answer from the other three — opencode 1.18.8 has
    // no skills concept in --help at all. Declaring true by analogy would be
    // the training-memory guess CLAUDE.md's CLI rule forbids.
    expect(caps.skills).toBe(false)
    expect(caps.subscriptionLogin).toBe(true)
  })

  it('offers api_key auth defaulting to OPENROUTER_API_KEY (a default, not a law)', () => {
    const methods = opencodeAdapter.getAuthMethods()
    const apiKey = methods.find((m) => m.type === 'api_key')
    expect(apiKey).toBeDefined()
    expect(apiKey!.requiredEnvVar).toBe('OPENROUTER_API_KEY')
    // D34(e): a provider row's own env_var_name still beats it.
    expect(resolveEnvVarName('ANTHROPIC_API_KEY', apiKey!.requiredEnvVar)).toBe(
      'ANTHROPIC_API_KEY'
    )
  })

  it('claims NOTHING beyond the Windows baseline environment (measured, 2026-07-28)', () => {
    // opencode was spawned under a CLEARED env block containing only
    // BASELINE_ENV_VARS + PINNED_ENV_VARS + OPENROUTER_API_KEY: exit 0, 339
    // models listed. Nothing extra is needed, so nothing extra is claimed.
    expect(opencodeAdapter.requiredEnvVars).toEqual([])
  })
})

describe('D84: the harness-less provider type (NOT an adapter, NOT in the registry)', () => {
  it('is NOT reachable through the agent registry, and does NOT widen the wire vocabulary', () => {
    // ⚠ THE INVARIANT THIS TASK MUST NOT BREAK, asserted rather than assumed.
    // agentKindSchema and staticRegistry widen TOGETHER or F25 returns; D84
    // widens neither, so 'none' must miss BOTH.
    expect(getAdapter(NO_HARNESS_ADAPTER_TYPE)).toBeUndefined()
    expect(agentKindSchema.safeParse(NO_HARNESS_ADAPTER_TYPE).success).toBe(false)
    expect(Object.keys(staticRegistry)).not.toContain(NO_HARNESS_ADAPTER_TYPE)
    // ⚠ THE PROPERTY, NOT A HEADCOUNT. This assertion used to pin the registry
    // to exactly ['claude','codex'] and D86 correctly broke it by adding
    // 'kimi'. What D84 actually needs is that the two vocabularies stay
    // IDENTICAL and that 'none' is in neither — which is true at two entries,
    // at three, and at whatever Phase 6 brings. Re-pinning the list here would
    // make every future adapter fail a test about something else.
    expect(Object.keys(staticRegistry).sort()).toEqual([...agentKindSchema.options].sort())
  })

  it('is a VALID AdapterDescriptor on the wire, and the only one with executionMode "api"', () => {
    // The schema already permitted this shape before D84 produced one:
    // `id` is z.string() (not agentKindSchema) and executionMode carries 'api'.
    expect(() => adapterDescriptorSchema.parse(NO_HARNESS_DESCRIPTOR)).not.toThrow()
    expect(NO_HARNESS_DESCRIPTOR.id).toBe(NO_HARNESS_ADAPTER_TYPE)
    expect(NO_HARNESS_DESCRIPTOR.executionMode).toBe('api')
    for (const adapter of adapters) expect(adapter.executionMode).toBe('pty')
  })

  it('declares NO subscription method and exactly one api_key method', () => {
    // A subscription mode means "some CLI is already logged in"; with no CLI
    // there is nothing to be logged into, so offering it would create a
    // provider that can never resolve a credential.
    const types = noHarnessAuthMethods().map((m) => m.type)
    expect(types).toEqual(['api_key'])
  })

  it('⚠ its api_key method has a NON-NULL requiredEnvVar — the ruling depends on it', () => {
    // resolveCredential refuses outright when the resolved env var name is
    // null, and a harness-less provider is resolved on the COUNCIL path. A
    // null default would ship a provider that looks valid in Settings and
    // dies at spend time — the precise failure D84 exists to prevent.
    const apiKey = noHarnessAuthMethods().find((m) => m.type === 'api_key')
    expect(apiKey).toBeDefined()
    expect(apiKey?.requiredEnvVar).not.toBeNull()
    expect(resolveEnvVarName(null, apiKey?.requiredEnvVar ?? null)).not.toBeNull()
    // …and a provider's own override still wins (D34(e)) — this is how a
    // DeepSeek-direct row says DEEPSEEK_API_KEY.
    expect(resolveEnvVarName('DEEPSEEK_API_KEY', apiKey?.requiredEnvVar ?? null)).toBe(
      'DEEPSEEK_API_KEY'
    )
  })

  it('publishes the SAME auth methods resolveCredential resolves against (one home)', () => {
    expect(NO_HARNESS_DESCRIPTOR.authMethods).toEqual([...noHarnessAuthMethods()])
  })

  it('declares no locally-runnable capability', () => {
    const caps = NO_HARNESS_DESCRIPTOR.capabilities
    expect(caps.interactiveTerminal).toBe(false)
    expect(caps.worktreeSafe).toBe(false)
    expect(caps.subscriptionLogin).toBe(false)
    expect(caps.reasoningEffort).toBeNull()
    // The one true statement: a credential CAN be stored against it.
    expect(caps.apiKey).toBe(true)
  })
})

describe('guards (D34 Q1: supported and implemented are the same fact)', () => {
  it.each(adapters.map((a) => [a.id, a] as const))('isPtyAdapter is true for %s', (_id, adapter) => {
    expect(isPtyAdapter(adapter)).toBe(true)
  })

  // Asserted EXPLICITLY (not as an absence): a future adapter that declares a
  // descriptor without implementing its method must fail here.
  it.each(adapters.map((a) => [a.id, a] as const))(
    'supportsMcp / supportsHooks / supportsResume are all FALSE for %s in Phase 3',
    (_id, adapter) => {
      expect(supportsMcp(adapter)).toBe(false)
      expect(supportsHooks(adapter)).toBe(false)
      expect(supportsResume(adapter)).toBe(false)
    }
  )
})

describe('capability honesty (generic — catches a declare-without-implement adapter)', () => {
  const EXTENSION_METHODS = [
    ['mcp', 'writeMcpConfig'],
    ['hooks', 'writeHooksConfig'],
    ['sessionResume', 'resumeSession']
  ] as const

  it.each(adapters.map((a) => [a.id, a] as const))(
    'every non-null descriptor of %s has its implemented method, and vice versa',
    (_id, adapter) => {
      const caps = adapter.getCapabilities()
      const ext = adapter as Partial<SupportsMcp & SupportsHooks & SupportsResume>
      for (const [capKey, method] of EXTENSION_METHODS) {
        const declared = caps[capKey] !== null
        const implemented = typeof ext[method] === 'function'
        expect({ capKey, fact: declared }).toEqual({ capKey, fact: implemented })
      }
    }
  )
})

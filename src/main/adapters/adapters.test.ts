import { describe, expect, it } from 'vitest'
import {
  adapterDescriptorSchema,
  agentKindSchema,
  NO_HARNESS_ADAPTER_TYPE,
  type Project
} from '../../shared/ipc'
import { resolveCli } from '../services/cliDetect'
import { parseCodexContextLeft } from '../services/contextUsageCore'
import { buildSecretEnv, mergeCapabilities } from './capabilities'
import { claudeAdapter } from './claude'
import { CODEX_BASELINE_ARGS, codexAdapter } from './codex'
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
  type McpServerRef,
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

/**
 * Task 6-2: the CAPABILITY-HONESTY list — every adapter in `staticRegistry`.
 *
 * ⚠ THIS IS A SECOND LIST RATHER THAN A WIDENING OF `adapters`, AND THE REASON
 * IS MEASURED. `ImplementationSpec-6-2.md` §6 says to widen `adapters` itself
 * from two to five. Widening it breaks EIGHT tests: `adapters` drives the
 * `describe.each` below, which includes four reasoning-effort cases that
 * dereference the descriptor — and `kimi.ts:107` and `opencode.ts:134` both
 * carry `reasoningEffort: null`. `adapters` is the LAUNCH-BEHAVIOUR list; the
 * spec read it as the capability list. Splitting is what lets capability
 * honesty cover four adapters WITHOUT weakening the effort arm, which the task
 * doc forbids in as many words.
 *
 * ⚠ AND IT IS FOUR, NOT FIVE. The spec's table names `none` as a fifth key, but
 * `noHarness.ts` exports a DESCRIPTOR and auth methods — there is no adapter
 * object, so nothing to put through `supportsMcp()`. Making one would mean
 * widening `staticRegistry`, which `shared/ipc.ts:441` and the D84 block below
 * forbid (agentKindSchema and staticRegistry widen TOGETHER or F25 returns; the
 * freeze is D34 Q5 / D63 Q1). `none`'s absence is already asserted at the D84
 * block — that IS the honest form of the spec's `none: false`, and duplicating
 * it here would be a second thing to keep in step.
 *
 * ⚠ DERIVED FROM THE REGISTRY, NEVER HAND-LISTED. A hand-written array is a
 * list that silently stops covering the next adapter someone adds; reading
 * `staticRegistry` means a new kind is covered the moment it is registered,
 * which is the whole point of the loops below.
 */
const capabilityAdapters: readonly PtyAgentAdapter[] = Object.values(staticRegistry).filter(
  isPtyAdapter
)

/**
 * The tokens an adapter adds to EVERY launch, whatever the spec — i.e. the true
 * baseline the neutrality rule (spec §4.1) should be measured against.
 *
 * ⚠ THIS EXISTS SO ONE ADAPTER'S EXCEPTION DOES NOT WEAKEN THE RULE FOR ALL
 * FOUR. v17 gives codex a permanent `-c status_line=…` so its TUI reports the
 * context window the progress ring needs (see `CODEX_BASELINE_ARGS`). The lazy
 * fix would have been to relax these assertions to `toContain` or to slice off
 * an unknown tail; instead the exception is NAMED and IMPORTED, so every
 * assertion below stays an exact-equality pin and a SEVENTH token appearing in
 * codex's argv still fails.
 *
 * ⚠ AND IT IS KEYED OFF THE ADAPTER ID, NOT A LOOSENED PREDICATE. Every other
 * adapter's baseline is empty, so claude/kimi/opencode are asserted exactly as
 * strictly as before this change — the neutrality rule is intact for them and
 * is intact for codex with one documented constant.
 */
function baselineArgs(id: string): readonly string[] {
  return id === 'codex' ? CODEX_BASELINE_ARGS : []
}

/** `resolveCli(id).args` plus that adapter's permanent additions. */
function expectedBase(id: string): string[] {
  return [...resolveCli(id).args, ...baselineArgs(id)]
}

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
    // Exact equality, including codex's one named permanent addition — see
    // `baselineArgs`. Empty for every other adapter, so this is unchanged there.
    expect(request.args).toEqual(expectedBase(adapter.id))
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
    const expected = expectedBase(adapter.id)
    expect(adapter.buildLaunch({ sessionId: 's', cwd: 'C:\\Projects' }).args).toEqual(expected)
    // …and an effortOptionId outside the vocabulary is equally inert.
    expect(
      adapter.buildLaunch({ sessionId: 's', cwd: 'C:\\Projects', effortOptionId: 'turbo' }).args
    ).toEqual(expected)
  })

  it('a chosen level appends exactly that level’s declared tokens, and nothing else', () => {
    const base = expectedBase(adapter.id)
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
    const base = expectedBase(adapter.id)
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
    // 6-2: `McpDescriptor` became a discriminated union on `mechanism`, so a
    // file-shaped descriptor must now SAY it is one. Unchanged in intent — a
    // non-null mcp descriptor for the merge rules to move around.
    mcp: {
      mode: 'static',
      mechanism: 'project-file',
      format: 'json',
      location: 'project',
      configPath: '.mcp.json'
    },
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
  it.each(capabilityAdapters.map((a) => [a.id, a] as const))(
    'isPtyAdapter is true for %s',
    (_id, adapter) => {
      expect(isPtyAdapter(adapter)).toBe(true)
    }
  )

  // ⚠ THE REGISTRY AND THIS LIST MUST NOT DRIFT. Without this, a new adapter
  // that failed to reach `capabilityAdapters` would make every loop below pass
  // by covering less — the failure mode that let kimi and opencode go through
  // three phases without ever seeing capability honesty (Overview FINDING 1).
  it('covers every registry adapter — the loops below cannot silently shrink', () => {
    expect(capabilityAdapters.map((a) => a.id).sort()).toEqual(Object.keys(staticRegistry).sort())
  })

  // Asserted EXPLICITLY (not as an absence): a future adapter that declares a
  // descriptor without implementing its method must fail here.
  //
  // ⚠ Task 6-2 WIDENED THIS FROM TWO ADAPTERS TO FOUR AND DID NOT RELAX IT.
  // kimi and opencode arrived in Phase 3d (D86, D90) and had never been through
  // these loops. Blanket-false over four adapters is strictly stronger than
  // over two.
  //
  // ⚠ AND IT IS NOW `supportsResume` ALONE — TWO CAPABILITIES LEFT THIS LOOP,
  // FROM TWO DIFFERENT BRANCHES, AND THE MERGE IS WHERE THAT WAS NOTICED.
  // Task 6-2 split `supportsMcp` out when codex gained a descriptor; the
  // activity-lights work split `supportsHooks` out when claude gained one.
  // Each was the true statement on its own branch, and each would have SILENTLY
  // RE-ASSERTED THE OTHER'S FALSE as blanket-false if the conflict had been
  // resolved by taking one side. Both arms are kept below, in the same
  // named-table idiom. Resume is the only one left that is genuinely false
  // everywhere.
  it.each(capabilityAdapters.map((a) => [a.id, a] as const))(
    'supportsResume is FALSE for %s',
    (_id, adapter) => {
      expect(supportsResume(adapter)).toBe(false)
    }
  )

  /**
   * ⚠ THE MCP ARM, SPLIT OUT OF THE BLANKET-FALSE LOOP RATHER THAN LOOSENED
   * (Task 6-2 / spec §6 step 3). codex's descriptor is non-null from this task
   * on, so a blanket `false` would now be a FALSE STATEMENT — the honest
   * replacement is a table that names every adapter, not a weaker assertion.
   *
   * ⚠ THE TABLE'S PURPOSE IS TO FORCE THE NEXT ADAPTER TO DECIDE rather than to
   * inherit an answer from a blanket assertion. Each `false` below is a
   * MEASURED position with a reason attached, not a default.
   *
   * ⚠ AND IT IS FOUR KEYS, NOT FIVE. `ImplementationSpec-6-2.md` §6 lists
   * `none: false` as a fifth — but `noHarness.ts` exports a descriptor and auth
   * methods, with no adapter object to put through `supportsMcp()`. Creating
   * one would mean widening `staticRegistry`, which the D84 block below forbids
   * (agentKindSchema and staticRegistry widen TOGETHER). `none`'s absence is
   * already asserted there; duplicating it here would be a second thing to keep
   * in step.
   */
  const MCP_SUPPORT: Readonly<Record<string, boolean>> = {
    claude: false, // Stage 4 (Task 6-5) — and 6-1 found .mcp.json is gated behind interactive approval
    codex: true, // Stage 1 — per-launch argv, writes nothing
    opencode: false, // Stage 4 (Task 6-5)
    kimi: false // 6-1: no evidence of env interpolation, unchanged at 0.29.1. NOT an oversight.
  }

  // ⚠ A MISSING KEY MUST FAIL, NOT DEFAULT TO FALSE. `Record<string, boolean>`
  // would happily hand back `undefined` for an adapter nobody thought about,
  // and `expect(false).toBe(undefined)` is the kind of failure that gets
  // "fixed" by adding a `?? false`. Naming the whole set here is what stops it.
  it('MCP_SUPPORT names EVERY registry adapter — a new adapter must decide', () => {
    expect(Object.keys(MCP_SUPPORT).sort()).toEqual(Object.keys(staticRegistry).sort())
  })

  it.each(capabilityAdapters.map((a) => [a.id, a] as const))(
    'supportsMcp for %s is exactly what the table declares',
    (id, adapter) => {
      expect(Object.prototype.hasOwnProperty.call(MCP_SUPPORT, id)).toBe(true)
      expect(supportsMcp(adapter)).toBe(MCP_SUPPORT[id])
    }
  )

  /**
   * ⚠ THE HOOKS ARM, IN 6-2's IDIOM RATHER THAN ITS OWN. The activity-lights
   * branch split `supportsHooks` out of the blanket-false loop as a bare
   * `adapter.id === 'claude'` loop — correct, but a second shape for a job this
   * file had already solved one commit earlier. The named table is the better
   * of the two and it wins: it forces the NEXT adapter to decide instead of
   * inheriting an answer, and it fails on a missing key rather than defaulting.
   *
   * ⚠ EACH `false` IS A MEASURED POSITION. Only Claude Code's hook bus has been
   * verified against the running CLI. The other three are not "not yet wired" —
   * nothing has established that they emit lifecycle events at all, and until
   * something does, their filmstrip cards must keep exactly three states. A
   * false amber is worse than no amber (D78's durable half, D129).
   */
  const HOOKS_SUPPORT: Readonly<Record<string, boolean>> = {
    claude: true, // D129/D130 — localhost listener, verified end to end against 2.1.225
    codex: false, // no hook bus observed
    opencode: false, // no hook bus observed
    kimi: false // no hook bus observed
  }

  it('HOOKS_SUPPORT names EVERY registry adapter — a new adapter must decide', () => {
    expect(Object.keys(HOOKS_SUPPORT).sort()).toEqual(Object.keys(staticRegistry).sort())
  })

  it.each(capabilityAdapters.map((a) => [a.id, a] as const))(
    'supportsHooks for %s is exactly what the table declares',
    (id, adapter) => {
      expect(Object.prototype.hasOwnProperty.call(HOOKS_SUPPORT, id)).toBe(true)
      expect(supportsHooks(adapter)).toBe(HOOKS_SUPPORT[id])
    }
  )

  it('claude declares the hook mechanism it actually uses', () => {
    expect(claudeAdapter.getCapabilities().hooks).toEqual({
      mode: 'static',
      mechanism: 'http_listener'
    })
  })
})

/**
 * Task 6-2: codex's MCP wiring. The descriptor and both `SupportsMcp` members,
 * asserted against the adapter itself rather than against the pure core — the
 * core's own suite (`mcpConfigCore.test.ts`) proves the rendering; this proves
 * codex is actually wired to it.
 */
describe('Task 6-2: codex MCP (argv, and NOTHING is written)', () => {
  const REF: McpServerRef = {
    name: 'chorus_memory',
    command: 'uvx',
    args: ['mcp-neo4j-cypher'],
    envPassthrough: ['NEO4J_PASSWORD']
  }

  it('declares the launch-args mechanism, and the type gives it no file to name', () => {
    const mcp = codexAdapter.getCapabilities().mcp
    expect(mcp).toEqual({ mode: 'static', mechanism: 'launch-args' })
    // ⚠ THE POINT OF THE DISCRIMINATED UNION: `configPath` is not reachable on
    // this variant, so the type's own vocabulary can no longer name
    // ~/.codex/config.toml — the file D49 forbids writing.
    expect(mcp).not.toHaveProperty('configPath')
    expect(mcp).not.toHaveProperty('format')
    expect(mcp).not.toHaveProperty('location')
  })

  it('supportsMcp(codexAdapter) is TRUE — descriptor AND both methods', () => {
    expect(supportsMcp(codexAdapter)).toBe(true)
    expect(typeof codexAdapter.mcpLaunchArgs).toBe('function')
    expect(typeof codexAdapter.writeMcpConfig).toBe('function')
  })

  it('emits the `-c` tokens in buildLaunch’s own idiom — flag and payload SEPARATE', () => {
    expect(codexAdapter.mcpLaunchArgs([REF])).toEqual([
      '-c',
      'mcp_servers.chorus_memory.command="uvx"',
      '-c',
      'mcp_servers.chorus_memory.args=["mcp-neo4j-cypher"]',
      '-c',
      'mcp_servers.chorus_memory.env_vars=["NEO4J_PASSWORD"]'
    ])
  })

  it('⚠ passes env var NAMES and never a value — `.env_vars=`, never `.env=`', () => {
    const joined = codexAdapter.mcpLaunchArgs([REF]).join(' ')
    expect(joined).toContain('.env_vars=["NEO4J_PASSWORD"]')
    expect(joined).not.toContain('.env=')
  })

  it('⚠ writeMcpConfig REFUSES with a reason — not a throw, not a no-op', async () => {
    const project: Project = {
      id: '00000000-0000-4000-8000-000000000000',
      name: 'P',
      root_path: 'C:\\Projects\\p',
      color: null,
      description: null,
      status: 'active',
      color_seed: 0
    }
    const result = await codexAdapter.writeMcpConfig(project, [REF])
    expect(result).toEqual({
      ok: false,
      reason: 'codex is configured by launch arguments, not by a file.'
    })
  })

  it('⚠ MCP support changes buildLaunch NOT AT ALL — argv is opt-in, per launch', () => {
    // The descriptor going non-null must not have quietly added tokens to every
    // codex launch. A session with no MCP servers is byte-identical to before.
    const req = codexAdapter.buildLaunch({ sessionId: 's', cwd: 'C:\\Projects' })
    // Still exact: the MCP descriptor going non-null must add NOTHING. The
    // baseline now carries v17's status_line and nothing else.
    expect(req.args).toEqual(expectedBase('codex'))
  })

  /* ---- v17: the status-line override the context ring depends on ------- */

  it('⚠ EVERY codex launch asks for the context item — the ring has no other source', () => {
    // Not "contains -c": the exact rendered TOML, because the CLI parses this
    // string and a stray space or a single quote is a silently ignored override
    // rather than an error. `["a","b"]` is codex's own emitted form (6-1).
    expect(CODEX_BASELINE_ARGS).toEqual([
      '-c',
      'tui.status_line=["model-with-reasoning","current-dir","context-remaining"]'
    ])
    // And it is genuinely on a bare launch, not only on a configured one.
    const bare = codexAdapter.buildLaunch({ sessionId: 's', cwd: 'C:\\Projects' })
    expect(bare.args).toContain('tui.status_line=["model-with-reasoning","current-dir","context-remaining"]')
  })

  it('⚠ `context-remaining` is the id the PARSER expects — they move together', () => {
    // `parseCodexContextLeft` matches `N% context left`, which is the phrasing
    // `context-remaining` renders. Choosing `context-used` here without changing
    // that regex would leave the ring permanently blank and log nothing. This
    // asserts the coupling that the two files' comments describe.
    const arg = CODEX_BASELINE_ARGS[1]
    expect(arg).toContain('context-remaining')
    expect(arg).not.toContain('context-used')
    expect(parseCodexContextLeft('42% context left')?.usedPercent).toBe(58)
  })

  it('⚠ restates codex’s OWN defaults, because `-c` replaces rather than appends', () => {
    // Emitting only the context item would take the model and directory OFF the
    // user's status line — a regression bought with a feature. Verified against
    // the /statusline picker on 0.147.0: these two are the checked defaults.
    const arg = CODEX_BASELINE_ARGS[1]
    expect(arg).toContain('model-with-reasoning')
    expect(arg).toContain('current-dir')
  })

  it('⚠ BEHAVIOUR NEUTRALITY of the moved quoter: route + effort tokens unchanged', () => {
    // `tomlString` moved to mcpConfigCore as `tomlBasicString` in this task, and
    // NOTHING pinned its output bytes before. These are the exact tokens codex
    // has emitted since D47/3a-4 — pinned now so the move is provable rather
    // than asserted.
    const req = codexAdapter.buildLaunch({
      sessionId: 's',
      cwd: 'C:\\Projects',
      effortOptionId: 'deep',
      credential: FAKE_CREDENTIAL,
      route: {
        providerKey: 'chorus',
        providerName: 'My OpenRouter Route',
        baseUrl: 'https://openrouter.ai/api/v1/',
        modelId: 'z-ai/glm-5.2'
      }
    })
    expect(req.args.slice(expectedBase('codex').length)).toEqual([
      '-c', 'model_provider="chorus"',
      '-c', 'model_providers.chorus.name="My OpenRouter Route"',
      '-c', 'model_providers.chorus.base_url="https://openrouter.ai/api/v1"',
      '-c', 'model_providers.chorus.env_key="CHORUS_UNITTEST_FAKE_KEY"',
      '-c', 'model_providers.chorus.wire_api="responses"',
      '-m', 'z-ai/glm-5.2',
      '-c', 'model_reasoning_effort="high"'
    ])
  })
})

describe('capability honesty (generic — catches a declare-without-implement adapter)', () => {
  const EXTENSION_METHODS = [
    ['mcp', 'writeMcpConfig'],
    ['hooks', 'writeHooksConfig'],
    ['sessionResume', 'resumeSession']
  ] as const

  // ⚠ THIS CASE IS BYTE-IDENTICAL EXCEPT FOR THE LIST IT ITERATES, AND THAT IS
  // DELIBERATE. It has been vacuous since Phase 3 because every descriptor was
  // null. It now does real work for FOUR adapters — two of which (kimi,
  // opencode) it has never covered at all — the moment any of them declares a
  // descriptor. The assertion itself is untouched.
  it.each(capabilityAdapters.map((a) => [a.id, a] as const))(
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

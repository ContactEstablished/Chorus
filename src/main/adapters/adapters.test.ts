import { afterEach, describe, expect, it } from 'vitest'
// Task 4a-2: the resume suite builds a hooks configPath under the OS temp dir
// rather than a literal, so it does not encode this machine's layout.
import nodeFs from 'node:fs'
import nodeOs from 'node:os'
import nodePath from 'node:path'
// 6-5 dropped `type Project`: `McpWriteContext` carries the project's root path
// rather than the wire row, so this suite no longer builds one to call
// `writeMcpConfig`.
import {
  adapterDescriptorSchema,
  agentCapabilitiesSchema,
  agentKindSchema,
  NO_HARNESS_ADAPTER_TYPE
} from '../../shared/ipc'
import { resolveCli } from '../services/cliDetect'
import { parseCodexContextLeft } from '../services/contextUsageCore'
import { buildSecretEnv, mergeCapabilities } from './capabilities'
import { claudeAdapter } from './claude'
import { CODEX_BASELINE_ARGS, CODEX_JADE_ECHO_INSTRUCTIONS, codexAdapter } from './codex'
import { resolveEnvVarName } from './env'
import { grokAdapter } from './grok'
import { kimiAdapter } from './kimi'
import { NO_HARNESS_DESCRIPTOR, noHarnessAuthMethods } from './noHarness'
import { opencodeAdapter, qualifyModel } from './opencode'
import { getAdapter, getAdapterOrThrow, staticRegistry } from './registry'
import {
  isPtyAdapter,
  supportsHooks,
  supportsInstructions,
  supportsMcp,
  supportsResume,
  UnknownAgentError,
  type AgentCapabilities,
  type McpServerRef,
  type PtyAgentAdapter,
  type ResolvedCredential,
  type ResumeExitObservation,
  type SupportsHooks,
  type SupportsInstructions,
  type SupportsMcp
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

// D165: grok joins the launch-behaviour list — it declares BOTH levelled
// descriptors (effort with a default, permission with a default), so every
// effort/permission/neutrality case below is a real assertion for it, not a
// dereference of null. kimi and opencode still cannot join (see below).
const adapters: readonly PtyAgentAdapter[] = [claudeAdapter, codexAdapter, grokAdapter]

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
 * FOUR. Codex has reviewed permanent `-c` overrides for the context status line
 * and the jade reply delimiter (see `CODEX_BASELINE_ARGS`). The lazy fix would
 * have been to relax these assertions to `toContain` or to slice off an unknown
 * tail; instead the exception is NAMED and IMPORTED, so every assertion below
 * stays an exact-equality pin and any unreviewed token still fails.
 *
 * ⚠ AND IT IS KEYED OFF THE ADAPTER ID, NOT A LOOSENED PREDICATE. Every other
 * adapter's baseline is empty, so claude/kimi/opencode are asserted exactly as
 * strictly as before this change — the neutrality rule is intact for them and
 * is intact for codex with one documented constant.
 *
 * ⚠ TASK 6a-1 SPLIT CODEX'S BASELINE ACROSS TWO SOURCES AND THIS FUNCTION IS
 * WHERE THEY REJOIN. The `developer_instructions` pair moved out of
 * `CODEX_BASELINE_ARGS` into `instructionsArgs` (D148, so the key has exactly
 * one emitter) and `buildLaunch` calls that method UNCONDITIONALLY — so a
 * launch with no memory contract still emits the pair, in the same position, and
 * every pin below stays an exact-equality assertion over the same tokens it
 * asserted before. `instructionsArgs(null)` is composed from the real method
 * rather than re-typed, so a change to either half fails the pins rather than
 * quietly agreeing with itself.
 */
function baselineArgs(id: string): readonly string[] {
  return id === 'codex' ? [...CODEX_BASELINE_ARGS, ...codexAdapter.instructionsArgs(null)] : []
}

/**
 * The argv tokens an adapter contributes from its DECLARED DEFAULTS when
 * nothing was chosen — rank 3 of `resolveLevelArgs`, added 2026-08-14.
 *
 * ⚠ READ OFF THE DESCRIPTORS, NEVER RE-STATED. A literal `['--effort','xhigh',
 * '--permission-mode','auto']` here would make every neutrality assertion below
 * a test of this file's memory rather than of the adapter's declaration, and it
 * would have to be edited every time a default moved — which is exactly when
 * you want the test to keep asserting the RULE unchanged.
 *
 * ⚠ ORDER MATTERS AND MIRRORS `buildLaunch`: effort, then permission. These are
 * exact-equality assertions, so a reordering in the adapter is a failure here,
 * which is intended — argv order is a thing the adapter decides once.
 */
interface Levelled {
  readonly levels: readonly { readonly id: string; readonly args: readonly string[] }[]
  readonly defaultLevelId?: string
}

/** The tokens one levelled capability contributes for `id`, or for its own
 *  declared default when `id` is undefined. Mirrors `resolveLevelArgs`'s ranks
 *  2 and 3 — deliberately NOT by calling it, so the two can disagree and be
 *  caught rather than agreeing because they are the same code. */
function levelArgs(descriptor: Levelled | null, id: string | undefined): readonly string[] {
  const chosen = id ?? descriptor?.defaultLevelId
  if (chosen === undefined) return []
  return descriptor?.levels.find((l) => l.id === chosen)?.args ?? []
}

/**
 * Exactly what this adapter's argv should be for a given set of choices —
 * `resolveCli`'s output, the adapter's permanent additions, then the levelled
 * capabilities in `buildLaunch`'s own order (effort, then permission).
 *
 * ⚠ THE DEFAULTS ARE READ OFF THE DESCRIPTORS, NEVER RE-STATED. A literal
 * `['--effort','xhigh','--permission-mode','auto']` here would make every
 * assertion below a test of this file's memory rather than of the adapter's
 * declaration, and it would need editing every time a default moved — which is
 * precisely when you want the test to go on asserting the RULE unchanged.
 */
function expectedArgs(
  adapter: PtyAgentAdapter,
  choice: { effort?: string; permission?: string } = {}
): string[] {
  const caps = adapter.getCapabilities()
  return [
    ...resolveCli(adapter.id).args,
    ...baselineArgs(adapter.id),
    ...levelArgs(caps.reasoningEffort, choice.effort),
    ...levelArgs(caps.permissionMode, choice.permission)
  ]
}

/** What an UNCONFIGURED launch of this adapter produces: the CLI's own argv,
 *  the adapter's permanent additions, and whatever defaults it declares.
 *
 *  ⚠ THIS IS NOT A PREFIX OF A CONFIGURED LAUNCH, and it stopped being one on
 *  2026-08-24 when codex gained a permission default. Declared defaults are
 *  emitted where their capability sits in `buildLaunch` — AFTER the route
 *  overrides, the model and the effort ladder — so a test that wants to skip
 *  past the invariant head of an argv wants `fixedPrefix` below, not this. */
function expectedBase(adapter: PtyAgentAdapter): string[] {
  return expectedArgs(adapter)
}

/** The part of an argv no launch option can move or suppress: the resolved CLI
 *  and the adapter's permanent additions. The honest thing to `slice` past. */
function fixedPrefix(adapter: PtyAgentAdapter): string[] {
  return [...resolveCli(adapter.id).args, ...baselineArgs(adapter.id)]
}

/**
 * The NON-SECRET environment an adapter is expected to contribute — empty for
 * every adapter but codex, which stamps its launch so discovery can recognise
 * its own rollout (F64).
 *
 * ⚠ SPELLED OUT PER ADAPTER RATHER THAN RELAXED TO "anything", exactly as
 * `expectedBase` does for codex's permanent argv additions. A blanket
 * loosening here would stop these two tests noticing the day some adapter starts
 * shipping environment nobody decided on — which is the whole point of them.
 */
function expectedEnvAdditions(id: string, sessionId: string): Record<string, string> {
  return id === 'codex' ? { CODEX_INTERNAL_ORIGINATOR_OVERRIDE: `chorus-${sessionId}` } : {}
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
    // Exact equality, including codex's named permanent additions — see
    // `baselineArgs`. Empty for every other adapter, so this is unchanged there.
    expect(request.args).toEqual(expectedBase(adapter))
    expect(request.cwd).toBe('C:\\Projects')
  })

  it('contributes NO SECRET environment, and only its declared additions', () => {
    const request = adapter.buildLaunch({ sessionId: 's', cwd: 'C:\\Projects' })
    expect(request.envAdditions).toEqual(expectedEnvAdditions(adapter.id, 's'))
    expect(request.secretEnv).toEqual({})
  })

  it('puts a credential in secretEnv under its env var name, never in envAdditions', () => {
    const request = adapter.buildLaunch({ sessionId: 's', cwd: 'C:\\Projects', credential: FAKE_CREDENTIAL })
    expect(request.secretEnv).toEqual({ CHORUS_UNITTEST_FAKE_KEY: FAKE_CREDENTIAL.value })
    // ⚠ THE LOAD-BEARING HALF IS THE LINE BELOW, NOT THE SHAPE ABOVE: whatever an
    // adapter adds to the non-secret environment, the credential is never in it.
    expect(request.envAdditions).toEqual(expectedEnvAdditions(adapter.id, 's'))
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

  /**
   * ⚠ THIS TEST WAS "args byte-identical to resolveCli" AND IT WAS WEAKENED ON
   * PURPOSE ON 2026-08-14, WHICH IS THE KIND OF EDIT THAT DESERVES A PARAGRAPH.
   *
   * Until then, "nobody chose" and "emit nothing" were the same statement, and
   * this asserted the second to protect the first. `defaultLevelId` separates
   * them: claude now declares where it starts, so an unconfigured claude launch
   * legitimately carries `--effort xhigh --permission-mode auto`.
   *
   * What survives is the property that actually mattered — ARGV IS THE CLI'S
   * OWN PLUS WHAT THE ADAPTER DECLARED, AND NOTHING ELSE. `expectedArgs` builds
   * that from the descriptors, so a stray token appearing in `buildLaunch` still
   * fails here first, and an adapter that declares no default (codex, today) is
   * asserted to be byte-identical to resolveCli exactly as before.
   */
  it('⚠ BEHAVIOUR NEUTRALITY: nothing chosen -> the CLI’s argv plus DECLARED defaults, and nothing else', () => {
    const expected = expectedBase(adapter)
    expect(adapter.buildLaunch({ sessionId: 's', cwd: 'C:\\Projects' }).args).toEqual(expected)
    // …and an id outside the vocabulary resolves the same way a missing one
    // does: to the declared default, or to nothing when there is none.
    expect(
      adapter.buildLaunch({
        sessionId: 's',
        cwd: 'C:\\Projects',
        effortOptionId: 'turbo',
        permissionModeId: 'yolo'
      }).args
    ).toEqual(expected)
  })

  it('an adapter that declares NO default is still byte-identical to resolveCli', () => {
    const caps = adapter.getCapabilities()
    if (caps.reasoningEffort?.defaultLevelId !== undefined) return
    if (caps.permissionMode?.defaultLevelId !== undefined) return
    expect(adapter.buildLaunch({ sessionId: 's', cwd: 'C:\\Projects' }).args).toEqual([
      ...resolveCli(adapter.id).args,
      ...baselineArgs(adapter.id)
    ])
  })

  it('a chosen level appends exactly that level’s declared tokens, and nothing else', () => {
    for (const level of adapter.getCapabilities().reasoningEffort!.levels) {
      const args = adapter.buildLaunch({
        sessionId: 's',
        cwd: 'C:\\Projects',
        effortOptionId: level.id
      }).args
      // ⚠ The chosen level REPLACES the declared default; it does not stack on
      // top of it. Two `--effort` flags on one command line would leave the
      // outcome to the CLI's unverified last-wins parsing.
      expect(args).toEqual(expectedArgs(adapter, { effort: level.id }))
    }
  })

  it('a chosen PERMISSION mode likewise replaces the declared default', () => {
    const descriptor = adapter.getCapabilities().permissionMode
    if (descriptor === null) return // absent, not disabled — nothing to assert
    for (const level of descriptor.levels) {
      const args = adapter.buildLaunch({
        sessionId: 's',
        cwd: 'C:\\Projects',
        permissionModeId: level.id
      }).args
      expect(args).toEqual(expectedArgs(adapter, { permission: level.id }))
      // Exactly one occurrence of EVERY knob this level turns, whichever level
      // was picked.
      //
      // ⚠ THIS COUNTED `level.args[0]` UNTIL 2026-08-24, WHICH WORKED ONLY
      // WHILE EVERY DESCRIPTOR TURNED ONE KNOB SPELLED AS A FLAG. codex's
      // permission positions turn TWO (`sandbox_mode` and `approval_policy`)
      // and both are spelled `-c` — a token it shares with the route overrides,
      // the jade pair and the effort ladder — so the old assertion was counting
      // "how many config overrides does this launch have", which is not a fact
      // about permission at all. Walking the level's args in pairs asks the
      // question the test meant to ask.
      for (let i = 0; i < level.args.length; i += 2) {
        const flag = level.args[i]
        const value = level.args[i + 1]
        const eq = typeof value === 'string' ? value.indexOf('=') : -1
        if (eq > 0) expect(args.filter((a) => a.startsWith(`${value.slice(0, eq)}=`))).toHaveLength(1)
        else expect(args.filter((a) => a === flag)).toHaveLength(1)
      }
    }
  })

  it('⚠ a raw override in extraArgs suppresses Chorus’s own effort tokens ENTIRELY', () => {
    const descriptor = adapter.getCapabilities().reasoningEffort!
    const deep = descriptor.levels.find((l) => l.id === 'deep')!
    // The user's own knob, in the CLI's vocabulary — the same shape the
    // descriptor emits, but a value Chorus never picks — suppression keys on
    // the KNOB, not on the value, so `ultra` being nonsense to both CLIs is
    // exactly what makes it a good probe.
    const override = deep.args[1].includes('=')
      ? deep.args[1].replace(/=.*$/, '="ultra"') // codex's `key="value"` form
      : 'ultra' // claude's plain `--effort <value>` form
    const args = adapter.buildLaunch({
      sessionId: 's',
      cwd: 'C:\\Projects',
      effortOptionId: 'deep',
      extraArgs: [deep.args[0], override]
    }).args
    // Chorus emits NOTHING of its own for THIS knob; it does not emit both and
    // rely on last-wins parsing. ⚠ The permission default is untouched — the
    // two knobs are independent, and an override of one must never silence the
    // other (that would be a permission change nobody asked for).
    expect(args).toEqual(expectedArgs(adapter, { effort: '__none__' }))
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
    permissionMode: null,
    sessionResume: null,
    // 6a-1: required and nullable, like its siblings — a fixture that omits it
    // no longer compiles, which is the point of making it required.
    instructions: null,
    // 6-2: `McpDescriptor` became a discriminated union on `mechanism`, so a
    // file-shaped descriptor must now SAY it is one. Unchanged in intent — a
    // non-null mcp descriptor for the merge rules to move around.
    // 6-5: and it must now name the DIALECT its bytes have to satisfy — see
    // `McpDialect`. Still unchanged in intent.
    mcp: {
      mode: 'static',
      mechanism: 'project-file',
      format: 'json',
      location: 'project',
      configPath: '.mcp.json',
      dialect: 'claude'
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

  it('⚠ declares apiKey TRUE and a MODEL-SOURCED effort — both measured, neither assumed', () => {
    const caps = opencodeAdapter.getCapabilities()
    // TRUE: proven by env-var gating — with OPENROUTER_API_KEY set,
    // `opencode providers list` reports an Environment section; without it,
    // `opencode models openrouter` fails "Provider not found: openrouter".
    expect(caps.apiKey).toBe(true)
    // D179: this WAS null, and the reason it was null still holds — `--variant`
    // exists only under `opencode run`, never on the TUI invocation Chorus
    // launches. What changed is the mechanism: the effort travels in the config
    // file, so the descriptor exists and declares that its POSITIONS come from
    // the model rather than from this adapter.
    expect(caps.reasoningEffort).not.toBeNull()
    expect(caps.reasoningEffort!.source).toBe('model')
    // ⚠ AND IT CARRIES NO LEVELS, which is the assertion that keeps the two
    // kinds of emptiness apart: a `source: 'model'` descriptor with levels
    // would be an adapter claiming to know a vocabulary it cannot see.
    expect(caps.reasoningEffort!.levels).toEqual([])
    // No default: an adapter cannot name a rung from a vocabulary it does not
    // hold, so a launch nobody clicked through writes no effort at all.
    expect(caps.reasoningEffort!.defaultLevelId).toBeUndefined()
    // The words are the adapter's; the ids are the model's.
    expect(caps.reasoningEffort!.labels?.xhigh).toBe('Extra-high')
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

describe('D165: the grok adapter (D4-verified against grok 1.0.5, 2026-08-18)', () => {
  const SPEC = { sessionId: 's', cwd: 'C:\\Projects' } as const
  const XAI_ROUTE = {
    providerKey: 'chorus',
    providerName: 'xAI',
    baseUrl: 'https://api.x.ai/v1',
    modelId: 'grok-4.5'
  } as const

  it('⚠ NEVER emits `-c` — on grok that is --continue, not --config (the third time)', () => {
    // `grok --help`: `-c, --continue  Continue the most recent session for the
    // current working directory`. With several panes on one cwd that adopts
    // someone else's conversation — D139's failure exactly.
    const req = grokAdapter.buildLaunch({
      ...SPEC,
      credential: FAKE_CREDENTIAL,
      route: XAI_ROUTE,
      effortOptionId: 'max',
      permissionModeId: 'manual',
      resume: { strategy: 'assigned', action: 'resume', agentSessionId: '1cf4b139-8f0c-48f5-884c-86f11ec3bd8e' }
    })
    expect(req.args).not.toContain('-c')
    expect(req.args).not.toContain('--continue')
  })

  it('emits `-m <model id>` only when the route names one, never the string "null"', () => {
    const withModel = grokAdapter.buildLaunch({ ...SPEC, route: XAI_ROUTE }).args
    expect(withModel).toEqual([...expectedArgs(grokAdapter), '-m', 'grok-4.5'])
    const noModel = grokAdapter.buildLaunch({ ...SPEC, route: { ...XAI_ROUTE, modelId: null } }).args
    expect(noModel).toEqual(expectedArgs(grokAdapter))
    expect(noModel).not.toContain('-m')
    expect(noModel).not.toContain('null')
  })

  it('⚠ the route base_url is NOT forwarded — grok has no per-launch endpoint flag', () => {
    // Custom endpoints on grok are `[model.<name>]` tables in config.toml
    // (11-custom-models.md); nothing on argv can carry one. Pretending
    // otherwise would half-apply a route.
    const req = grokAdapter.buildLaunch({ ...SPEC, credential: FAKE_CREDENTIAL, route: XAI_ROUTE })
    expect(req.args.join(' ')).not.toContain('api.x.ai')
  })

  it('⚠ the key travels in secretEnv, NEVER in argv', () => {
    const req = grokAdapter.buildLaunch({ ...SPEC, credential: FAKE_CREDENTIAL, route: XAI_ROUTE })
    expect(req.secretEnv).toEqual({ CHORUS_UNITTEST_FAKE_KEY: FAKE_CREDENTIAL.value })
    expect(req.args.join(' ')).not.toContain(FAKE_CREDENTIAL.value)
    expect(JSON.stringify(req.envAdditions)).not.toContain(FAKE_CREDENTIAL.value)
  })

  it('maps the four app levels ONE-TO-ONE onto grok-4.6’s ladder, `--reasoning-effort` first token', () => {
    // Measured: `grok models` menus — 4.6 low/medium/high/xhigh, 4.5 low/
    // medium/high; an unlisted value is rejected AT LAUNCH ("unknown effort
    // level 'xhigh'; use one of: high, medium, low"). The pin below is what
    // makes that a documented trap on `Max` × grok-4.5 rather than a surprise.
    const levels = grokAdapter.getCapabilities().reasoningEffort!.levels
    expect(levels.map((l) => [l.id, ...l.args])).toEqual([
      ['fast', '--reasoning-effort', 'low'],
      ['balanced', '--reasoning-effort', 'medium'],
      ['deep', '--reasoning-effort', 'high'],
      ['max', '--reasoning-effort', 'xhigh']
    ])
    // The default is grok's OWN default (`high` on both models), so an
    // unconfigured launch is legal on either.
    expect(grokAdapter.getCapabilities().reasoningEffort!.defaultLevelId).toBe('deep')
  })

  it('declares THREE permission positions in `--permission-mode` vocabulary, defaulting to auto', () => {
    // `[possible values: default, acceptEdits, auto, dontAsk, bypassPermissions,
    // plan]`. Three of six: bypass is `permissionModeSchema`'s standing
    // exclusion, `plan` is "accepted for compatibility" (unmeasured meaning),
    // `dontAsk` is a CI posture. Chorus's `manual` is grok's `default` (ask).
    const descriptor = grokAdapter.getCapabilities().permissionMode!
    expect(descriptor.levels.map((l) => [l.id, ...l.args])).toEqual([
      ['auto', '--permission-mode', 'auto'],
      ['accept-edits', '--permission-mode', 'acceptEdits'],
      ['manual', '--permission-mode', 'default']
    ])
    expect(descriptor.defaultLevelId).toBe('auto')
    expect(descriptor.levels.map((l) => l.args[1])).not.toContain('bypassPermissions')
    expect(descriptor.levels.map((l) => l.args[1])).not.toContain('plan')
  })

  it('an unconfigured launch carries EXACTLY the two declared defaults and nothing else', () => {
    // The whole argv, pinned by value once (the generic suite pins it by
    // descriptor): `resolveCli` + `--reasoning-effort high --permission-mode auto`.
    expect(grokAdapter.buildLaunch(SPEC).args).toEqual([
      ...resolveCli('grok').args,
      '--reasoning-effort',
      'high',
      '--permission-mode',
      'auto'
    ])
  })

  it('offers subscription AND api_key auth, the key under XAI_API_KEY', () => {
    // Measured by running the binary in an ISOLATED home with a bogus key:
    // `grok models` -> "You are using XAI_API_KEY."; the debug log resolved
    // `auth_type=ApiKey` and the server rejected the key. The variable is read.
    const methods = grokAdapter.getAuthMethods()
    expect(methods.map((m) => m.type)).toEqual(['subscription', 'api_key'])
    expect(methods.find((m) => m.type === 'api_key')?.requiredEnvVar).toBe('XAI_API_KEY')
    expect(grokAdapter.getCapabilities().apiKey).toBe(true)
    expect(grokAdapter.getCapabilities().subscriptionLogin).toBe(true)
  })

  it('claims NOTHING beyond the Windows baseline environment (measured, 2026-08-18)', () => {
    // `grok models` under a CLEARED env of exactly BASELINE_ENV_VARS +
    // PINNED_ENV_VARS + XAI_API_KEY exited 0 and listed both models.
    expect(grokAdapter.requiredEnvVars).toEqual([])
    expect(grokAdapter.buildLaunch(SPEC).envAdditions).toEqual({})
  })

  it('⚠ mcp, hooks and instructions are NULL — unmeasured, not absent', () => {
    const caps = grokAdapter.getCapabilities()
    expect(caps.mcp).toBeNull()
    expect(caps.hooks).toBeNull()
    expect(caps.instructions).toBeNull()
    expect(supportsMcp(grokAdapter)).toBe(false)
    expect(supportsHooks(grokAdapter)).toBe(false)
  })

  it('is a valid AdapterDescriptor on the wire, with the resume descriptor intact', () => {
    // The same parse `adapter:list` performs, so a declaration the wire cannot
    // carry fails HERE rather than at the first dialog open.
    const parsed = adapterDescriptorSchema.safeParse({
      id: grokAdapter.id,
      displayName: grokAdapter.displayName,
      executionMode: grokAdapter.executionMode,
      authMethods: grokAdapter.getAuthMethods(),
      capabilities: grokAdapter.getCapabilities()
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.capabilities.sessionResume).toEqual({
        mode: 'static',
        kind: 'assigned',
        cliFlag: '--resume'
      })
    }
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
  // ⚠ AND RESUME HAS NOW LEFT IT TOO — TASK 4a-2 WAS THE THIRD SPLIT, NOT A
  // RELAXATION. Task 6-2 split `supportsMcp` out when codex gained a
  // descriptor; the activity-lights work split `supportsHooks` out when claude
  // gained one; D139 gives claude and codex resume descriptors, so the old
  // blanket `supportsResume is FALSE for %s` is now a FALSE STATEMENT for half
  // the registry. The honest replacement is the same named-table idiom the two
  // arms below already use — never a weaker assertion.
  //
  // ⚠ THE TEST'S PURPOSE IS UNCHANGED AND IS NOW STRONGER: catching a
  // descriptor that has drifted from its methods. `supportsResume()` no longer
  // asks "is there a method spelled `resumeSession`?" — it asks whether the
  // adapter provides what its OWN DECLARED KIND requires (`assigned` forbids
  // `discoverSessionId`, `discovered` requires it, both must classify). So each
  // `true` below is a claim about two things agreeing, not one thing existing.
  const RESUME_SUPPORT: Readonly<Record<string, boolean>> = {
    // D140, measured: `claude --session-id <uuid>` names the conversation at
    // launch, verified INTERACTIVELY on 2.1.229 (D143(d)), and `--resume <uuid>`
    // reopens it. Companion method: classifyResumeFailure.
    claude: true,
    // D140, measured: codex has no launch-time id option on 0.147.0; it names
    // its own conversation and is asked afterwards. Companion methods:
    // discoverSessionId AND classifyResumeFailure.
    codex: true,
    // D165, measured on grok 1.0.5 (2026-08-18): `--session-id <uuid>` names a
    // NEW conversation at launch, `--resume <uuid>` reopens it, and reusing a
    // live id fails with claude's own wording. ASSIGNED, companion method
    // classifyResumeFailure. See grok.ts.
    grok: true,
    // ⚠ NOT AN OVERSIGHT, AND NOT "NOT YET". Both CLIs' `-c` means `--continue`,
    // which resumes THE MOST RECENT CONVERSATION FOR THE DIRECTORY — not this
    // pane's. With several panes on one cwd that silently adopts someone else's
    // session, which is the failure D139 exists to prevent. See the warnings in
    // kimi.ts and opencode.ts before changing either of these.
    kimi: false,
    opencode: false
  }

  // ⚠ A MISSING KEY MUST FAIL, NOT DEFAULT TO FALSE — same reasoning as
  // MCP_SUPPORT below. Four adapters, not five: `noHarness` has no adapter
  // object to put through a guard (D84 keeps it out of staticRegistry), and its
  // `sessionResume: null` is asserted where its descriptor is asserted.
  it('RESUME_SUPPORT names EVERY registry adapter — a new adapter must decide', () => {
    expect(Object.keys(RESUME_SUPPORT).sort()).toEqual(Object.keys(staticRegistry).sort())
  })

  it.each(capabilityAdapters.map((a) => [a.id, a] as const))(
    'supportsResume matches the declared table for %s',
    (id, adapter) => {
      expect({ id, resume: supportsResume(adapter) }).toEqual({ id, resume: RESUME_SUPPORT[id] })
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
    // ⚠ TRUE FROM TASK 6-5, AND IT MEANS "CHORUS WRITES THE CONFIG" — NOT
    // "THE SERVER IS CONNECTED". 6-1 measured that claude reports a
    // Chorus-written `.mcp.json` server as `⏸ Pending approval` until a human
    // approves it interactively, and Chorus is forbidden to write that approval
    // (D49; CR-6.0 Q6, unanimous). The two facts are deliberately not conflated
    // anywhere, including here.
    claude: true, // Stage 4 — project-scoped .mcp.json, claude dialect
    codex: true, // Stage 1 — per-launch argv, writes nothing
    opencode: true, // Stage 4 — Chorus-owned file, reached by OPENCODE_CONFIG
    kimi: false, // 6-1: no evidence of env interpolation, unchanged at 0.29.1. NOT an oversight.
    // D165: `grok mcp` exists, but its config dialect and location are
    // UNMEASURED and Chorus's writers know two dialects. null until someone
    // runs it; not "no".
    grok: false
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
    kimi: false, // no hook bus observed
    grok: false // D165: a hook bus is DOCUMENTED (10-hooks.md) but no per-launch load flag; unmeasured
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
    // 6-5 reshaped the argument into one `McpWriteContext` — see its docblock
    // for the three things the old `(project, servers, signal?)` shape got
    // wrong. codex's answer is unchanged and permanent: it is argv-only, and
    // `~/.codex/config.toml` is the file D49 forbids writing.
    const result = await codexAdapter.writeMcpConfig({
      projectRoot: 'C:\\Projects\\p',
      chorusConfigDir: 'C:\\Users\\test\\AppData\\Roaming\\chorus\\mcp',
      servers: [REF],
      knownSecrets: []
    })
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
    // The baseline carries the v17 status line and the Codex-only jade reply
    // instruction; MCP still contributes nothing unless a launch asks for it.
    expect(req.args).toEqual(expectedBase(codexAdapter))
  })

  /* ---- v17: the status-line override the context ring depends on ------- */

  it('⚠ EVERY codex launch asks for the context item — the ring has no other source', () => {
    // Not "contains -c": the exact rendered TOML, because the CLI parses this
    // string and a stray space or a single quote is a silently ignored override
    // rather than an error. `["a","b"]` is codex's own emitted form (6-1).
    expect(CODEX_BASELINE_ARGS.slice(0, 2)).toEqual([
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

  /* ---- the per-turn jade user-message delimiter ----------------------- */

  it('⚠ EVERY codex launch injects the complete jade echo rule as developer instructions', () => {
    // Task 6a-1 / D148: the pair now comes from `instructionsArgs`, which is the
    // ONE emitter of this key. With no memory contract it must still produce
    // exactly what `CODEX_BASELINE_ARGS` used to carry in slots 2 and 3.
    expect(codexAdapter.instructionsArgs(null)).toEqual([
      '-c',
      `developer_instructions=${JSON.stringify(CODEX_JADE_ECHO_INSTRUCTIONS)}`
    ])
    // ...and the baseline no longer carries it, so there is no second home.
    expect(CODEX_BASELINE_ARGS).toHaveLength(2)

    const bare = codexAdapter.buildLaunch({ sessionId: 's', cwd: 'C:\\Projects' })
    expect(bare.args).toContain(
      `developer_instructions=${JSON.stringify(CODEX_JADE_ECHO_INSTRUCTIONS)}`
    )
  })

  it('pins the ANSI bytes, line resets, rule width, truncation, and no-wrapper requirements', () => {
    expect(CODEX_JADE_ECHO_INSTRUCTIONS).toContain('real 0x1B control byte')
    expect(CODEX_JADE_ECHO_INSTRUCTIONS).toContain('ESC[38;2;0;168;107m')
    expect(CODEX_JADE_ECHO_INSTRUCTIONS).toContain('exactly 60 U+2500')
    expect(CODEX_JADE_ECHO_INSTRUCTIONS).toContain('START of every line')
    expect(CODEX_JADE_ECHO_INSTRUCTIONS).toContain('longer than 8 lines')
    expect(CODEX_JADE_ECHO_INSTRUCTIONS).toContain('one final jade line containing "> ..."')
    expect(CODEX_JADE_ECHO_INSTRUCTIONS).toContain('no code fence, blockquote, or Markdown wrapper')
    // A raw newline would make this invalid as a TOML basic string on argv.
    expect(CODEX_JADE_ECHO_INSTRUCTIONS).not.toContain('\n')
    // Caret is cmd.exe's escape character and disappears even when Node quotes
    // this argv token. ⚠ THE RULE OUTLIVED ITS ORIGINAL REASON AND STILL HOLDS.
    // Since F96 (2026-08-21) codex normally launches as node + the shim's own
    // entry point, with no cmd.exe in the chain — but `pickSpawnable` still
    // falls back to `cmd.exe /c` for any shim it cannot read, so an argv token
    // carrying a caret would be corrupted on exactly the machines where the
    // fallback fires and nowhere else. That is the worst kind of bug to ship.
    expect(CODEX_JADE_ECHO_INSTRUCTIONS).not.toContain('^')
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
    expect(req.args.slice(fixedPrefix(codexAdapter).length)).toEqual([
      '-c', 'model_provider="chorus"',
      '-c', 'model_providers.chorus.name="My OpenRouter Route"',
      '-c', 'model_providers.chorus.base_url="https://openrouter.ai/api/v1"',
      '-c', 'model_providers.chorus.env_key="CHORUS_UNITTEST_FAKE_KEY"',
      '-c', 'model_providers.chorus.wire_api="responses"',
      '-m', 'z-ai/glm-5.2',
      '-c', 'model_reasoning_effort="high"',
      // The permission default, added 2026-08-24 — same `-c` quoter, so it is
      // covered by this test's subject (the moved `tomlBasicString`) and pinned
      // here for the same reason: nothing else pins its exact bytes.
      '-c', 'sandbox_mode="danger-full-access"',
      '-c', 'approval_policy="never"'
    ])
  })
})

/**
 * Task 6-5: the two FILE adapters' declarations. What they WRITE is
 * `mcpConfigWrite.test.ts`'s subject; what they DECLARE is this one's, because
 * a wrong declaration here silently produces a file the CLI ignores.
 */
describe('Task 6-5: the file mechanisms claude and opencode declare', () => {
  it('claude declares a PROJECT file in claude’s dialect', () => {
    expect(claudeAdapter.getCapabilities().mcp).toEqual({
      mode: 'static',
      mechanism: 'project-file',
      format: 'json',
      location: 'project',
      configPath: '.mcp.json',
      dialect: 'claude'
    })
  })

  it('opencode declares a CHORUS-OWNED file, named by OPENCODE_CONFIG, in opencode’s dialect', () => {
    expect(opencodeAdapter.getCapabilities().mcp).toEqual({
      mode: 'static',
      mechanism: 'env-named-file',
      format: 'json',
      location: 'custom',
      // ⚠ A BARE FILENAME, NOT AN ABSOLUTE PATH. The directory is main's to
      // choose (`McpWriteContext.chorusConfigDir`); an adapter that hardcoded
      // one would be an adapter that knows Electron's userData layout.
      configPath: 'opencode.json',
      pathEnvVar: 'OPENCODE_CONFIG',
      dialect: 'opencode'
    })
  })

  it('⚠ the two adapters declare DIFFERENT dialects — the whole reason the field exists', () => {
    const claude = claudeAdapter.getCapabilities().mcp
    const opencode = opencodeAdapter.getCapabilities().mcp
    expect(claude?.mechanism).not.toBe('launch-args')
    expect(opencode?.mechanism).not.toBe('launch-args')
    if (!claude || claude.mechanism === 'launch-args') return
    if (!opencode || opencode.mechanism === 'launch-args') return
    // Same `format`, different `dialect`. `format` never told them apart, which
    // is exactly how 6-2's single renderer came to emit claude's shape for both.
    expect(claude.format).toBe(opencode.format)
    expect(claude.dialect).not.toBe(opencode.dialect)
  })

  it('⚠ kimi STILL declares `mcp: null`, and that is a DECISION', () => {
    // 6-1 found no evidence of env interpolation at 0.29.1 and none has arrived
    // since. D87's scoped authorization to write `~/.kimi-code/config.toml`
    // does NOT extend to writing a secret there, and a `${VAR}` that does not
    // expand leaves a literal placeholder where a password was expected — the
    // one failure mode whose natural "fix" is to write the value.
    expect(kimiAdapter.getCapabilities().mcp).toBeNull()
    expect(supportsMcp(kimiAdapter)).toBe(false)
  })

  it('⚠ neither adapter’s buildLaunch changed — MCP support adds no argv anywhere', () => {
    // The descriptors going non-null must not have quietly altered a launch.
    // The file is written by the LAUNCH PATH before spawn, never by buildLaunch,
    // which is synchronous and must stay that way.
    expect(claudeAdapter.buildLaunch({ sessionId: 's', cwd: 'C:\\Projects' }).args).toEqual(
      expectedBase(claudeAdapter)
    )
    expect(opencodeAdapter.buildLaunch({ sessionId: 's', cwd: 'C:\\Projects' }).args).toEqual(
      expectedBase(opencodeAdapter)
    )
    // ⚠ AND NEITHER ADDS AN ENV ENTRY OF ITS OWN. `OPENCODE_CONFIG` is composed
    // by main at launch (it names a path main owns) and merged there — an
    // adapter cannot know it.
    expect(claudeAdapter.buildLaunch({ sessionId: 's', cwd: 'C:\\Projects' }).envAdditions).toEqual({})
    expect(opencodeAdapter.buildLaunch({ sessionId: 's', cwd: 'C:\\Projects' }).envAdditions).toEqual({})
  })

  it('⚠ both file adapters return NO launch args — `SupportsMcp` makes them say so', () => {
    const ref = { name: 'chorus-memory', command: 'uvx', args: ['mcp-neo4j-cypher'] }
    expect(claudeAdapter.mcpLaunchArgs([ref])).toEqual([])
    expect(opencodeAdapter.mcpLaunchArgs([ref])).toEqual([])
  })
})

/**
 * F75 — THE GENERIC CASE, AND THE REASON THIS BLOCK IS GENERIC RATHER THAN A
 * CODEX TEST.
 *
 * `codex.mcpLaunchArgs` was built, unit-tested and CORRECT for an entire phase,
 * and shipped nothing, because no `buildLaunch` ever called it. Every test that
 * existed passed. A test of the renderer cannot catch that; only a test that
 * asks whether the renderer's OUTPUT REACHES THE ARGV can.
 *
 * ⚠ SO THIS RUNS OVER `staticRegistry`, NOT OVER CODEX. For claude and opencode
 * the expected sequence is empty and the case is trivially true; for codex it is
 * the whole of the repair; FOR THE FIFTH ADAPTER IT IS THE TEST THAT WOULD HAVE
 * CAUGHT F75 ON THE DAY IT WAS WRITTEN.
 */
describe('F75 — every adapter composes its own mcpLaunchArgs into buildLaunch', () => {
  /** CONTIGUOUS, deliberately. A scattered-subsequence check would pass on an
   *  argv that interleaved other tokens between the `-c` flags and their
   *  payloads — which is exactly the shape that would not survive the shim. */
  function containsContiguous(haystack: readonly string[], needle: readonly string[]): boolean {
    if (needle.length === 0) return true
    for (let i = 0; i + needle.length <= haystack.length; i++) {
      if (needle.every((tok, j) => haystack[i + j] === tok)) return true
    }
    return false
  }

  const SERVERS = [
    {
      name: 'chorus-memory',
      command: 'uvx',
      args: ['mcp-neo4j-cypher'],
      envPassthrough: ['NEO4J_URL', 'NEO4J_DATABASE']
    }
  ]

  /**
   * ⚠ EVERY `buildLaunch` IN THIS BLOCK IS COMPUTED ONCE, HERE, AND THE REASON
   * IS NOT TIDINESS. `resolveCli` runs `execFileSync('where.exe', …)` on every
   * single call with NO CACHE, so each `buildLaunch` is a synchronous process
   * spawn. Calling it per-assertion across five adapters added ~20 spawns to
   * this file and made unrelated claude argv tests fail INTERMITTENTLY under the
   * full parallel suite (never when this file ran alone) — measured, not
   * theorised. Three spawns per adapter, computed once, is the whole fix.
   */
  const built = capabilityAdapters.map((adapter) => ({
    id: adapter.id,
    adapter,
    expected: supportsMcp(adapter) ? adapter.mcpLaunchArgs(SERVERS) : [],
    argvNone: adapter.buildLaunch({ sessionId: 's', cwd: 'C:\\Projects' }).args,
    argvEmpty: adapter.buildLaunch({ sessionId: 's', cwd: 'C:\\Projects', mcpServers: [] }).args,
    argvServers: adapter.buildLaunch({ sessionId: 's', cwd: 'C:\\Projects', mcpServers: SERVERS })
      .args
  }))

  it('the helper itself rejects a NON-contiguous match', () => {
    expect(containsContiguous(['a', 'b', 'c'], ['a', 'b'])).toBe(true)
    expect(containsContiguous(['a', 'x', 'b'], ['a', 'b'])).toBe(false)
    expect(containsContiguous([], [])).toBe(true)
  })

  it.each(built.map((b) => [b.id, b] as const))(
    '%s — its mcpLaunchArgs appear contiguously in its own buildLaunch argv',
    (_id, b) => {
      if (!supportsMcp(b.adapter)) return
      expect(containsContiguous(b.argvServers, b.expected)).toBe(true)
    }
  )

  it.each(built.map((b) => [b.id, b] as const))(
    '%s — argv with NO mcpServers is byte-identical to argv with an empty list',
    (_id, b) => {
      expect(b.argvEmpty).toEqual(b.argvNone)
    }
  )

  it('⚠ no adapter ever renders `mcp_servers` and `env=` together, in any argv', () => {
    for (const b of built) {
      const joined = b.argvServers.join(' ')
      if (joined.includes('mcp_servers')) {
        // The D150 line: names may travel argv, values may not.
        expect(joined).toContain('.env_vars=')
        expect(joined).not.toContain('.env=')
        expect(joined).not.toContain('bolt://')
      }
    }
  })
})

describe('capability honesty (generic — catches a declare-without-implement adapter)', () => {
  /**
   * ⚠ `['sessionResume','resumeSession']` LEFT THIS TABLE IN TASK 4a-2 BECAUSE
   * THE CHECK GOT STRONGER, NOT WEAKER (CR-4a.0 Q5). `resumeSession` no longer
   * exists — D139 deleted it along with `ResumeSpec` — and claude now declares a
   * descriptor with no method of that name, so the generic name-pairing would
   * FAIL ON A TRUE STATEMENT.
   *
   * Its replacement is structural rather than nominal: `supportsResume()` asks
   * whether the adapter provides what its OWN DECLARED KIND requires —
   * `assigned` forbids `discoverSessionId`, `discovered` requires it, and both
   * must classify their failures — and the named table in the guards block
   * above pins the answer per adapter. That is a question about capability, not
   * about a spelling.
   *
   * ⚠ THE OTHER TWO ROWS STAY EXACTLY AS THEY ARE. Only resume left.
   */
  const EXTENSION_METHODS = [
    ['mcp', 'writeMcpConfig'],
    ['hooks', 'writeHooksConfig'],
    // Task 6a-1 / D148. ONE ROW, and it makes the case below prove
    // declared-iff-implemented for THREE descriptors across all five adapters —
    // including the three that answer `null` and would otherwise be untested in
    // both directions.
    ['instructions', 'instructionsArgs']
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
      const ext = adapter as Partial<SupportsMcp & SupportsHooks & SupportsInstructions>
      for (const [capKey, method] of EXTENSION_METHODS) {
        const declared = caps[capKey] !== null
        const implemented = typeof ext[method] === 'function'
        expect({ capKey, fact: declared }).toEqual({ capKey, fact: implemented })
      }
    }
  )
})

/**
 * Task 4a-2 / D139 — the adapter resume contract.
 *
 * ⚠ NOTHING IN THE APP CALLS THIS SURFACE YET. The adapters gain a capability
 * and 4a-3 uses it, so these tests are the ONLY consumer — which makes them the
 * whole safety net rather than a supplement to one.
 *
 * ⚠ AND ARGV IS ASSERTED EXACTLY, NEVER BY DIFFERENCE (CR-4a.0 Q5). A test that
 * only proves two argv arrays differ passes just as happily for an adapter that
 * appended garbage.
 */
describe('Task 4a-2: the resume contract (D139)', () => {
  const SPEC = { sessionId: 's', cwd: 'C:\\Projects' } as const
  const UUID = '1cf4b139-8f0c-48f5-884c-86f11ec3bd8e'

  /* ── argv: the no-modifier path must not move ───────────────────────────── */

  // ⚠ THE REGRESSION THAT WOULD BE HARDEST TO NOTICE AND MOST EXPENSIVE TO HAVE
  // SHIPPED. Every launch in the app flows through buildLaunch, and the
  // overwhelming majority carry no modifier at all. Asserted against
  // resolveCli's LIVE output, never a literal, so it cannot encode this
  // machine's install layout.
  // ⚠ `expectedArgs` REPLACED THE PER-ADAPTER `extra` COLUMN ON 2026-08-14. The
  // column listed each adapter's permanent argv additions by hand; it now also
  // has to account for `defaultLevelId`, and reading BOTH off the descriptors is
  // the only version of this that does not need re-editing every time a default
  // moves. The property asserted is unchanged: no modifier, no modifier tokens.
  it.each([
    ['claude', claudeAdapter],
    ['codex', codexAdapter],
    ['grok', grokAdapter],
    ['kimi', kimiAdapter],
    ['opencode', opencodeAdapter]
  ] as const)('a launch with NO resume modifier adds no resume tokens for %s', (_id, adapter) => {
    expect(adapter.buildLaunch(SPEC).args).toEqual(expectedArgs(adapter))
  })

  /* ── claude: assigned ───────────────────────────────────────────────────── */

  it('claude assigned/create emits --session-id and NOT --resume', () => {
    const args = claudeAdapter.buildLaunch({
      ...SPEC,
      resume: { strategy: 'assigned', action: 'create', agentSessionId: UUID }
    }).args
    expect(args).toEqual([...expectedArgs(claudeAdapter), '--session-id', UUID])
    expect(args).not.toContain('--resume')
  })

  it('claude assigned/resume emits --resume and NOT --session-id', () => {
    const args = claudeAdapter.buildLaunch({
      ...SPEC,
      resume: { strategy: 'assigned', action: 'resume', agentSessionId: UUID }
    }).args
    expect(args).toEqual([...expectedArgs(claudeAdapter), '--resume', UUID])
    // Measured: `--session-id` on a live id gives "Session ID … is already in
    // use." The two flags are mutually exclusive AT THE CLI, not by convention.
    expect(args).not.toContain('--session-id')
  })

  // ⚠ AMENDMENT (e) — THE TEST THAT STOPS A SESSION PICKER OPENING IN A PANE
  // NOBODY IS WATCHING. `claude --help` on 2.1.229: "-r, --resume [value]" —
  // the square brackets mean the value is OPTIONAL TO THE CLI, so a bare
  // `--resume` does not error. It opens an interactive picker and waits
  // forever, with no log line anywhere. No value, no flag.
  it.each([['create' as const], ['resume' as const]])(
    'claude with an EMPTY agentSessionId (%s) emits neither flag',
    (action) => {
      const args = claudeAdapter.buildLaunch({
        ...SPEC,
        resume: { strategy: 'assigned', action, agentSessionId: '' }
      }).args
      expect(args).toEqual(claudeAdapter.buildLaunch(SPEC).args)
      expect(args).not.toContain('--resume')
      expect(args).not.toContain('--session-id')
    }
  )

  /* ── grok: assigned (D165) ──────────────────────────────────────────────── */

  it('grok assigned/create emits --session-id and NOT --resume', () => {
    const args = grokAdapter.buildLaunch({
      ...SPEC,
      resume: { strategy: 'assigned', action: 'create', agentSessionId: UUID }
    }).args
    expect(args).toEqual([...expectedArgs(grokAdapter), '--session-id', UUID])
    expect(args).not.toContain('--resume')
  })

  it('grok assigned/resume emits --resume and NOT --session-id', () => {
    const args = grokAdapter.buildLaunch({
      ...SPEC,
      resume: { strategy: 'assigned', action: 'resume', agentSessionId: UUID }
    }).args
    expect(args).toEqual([...expectedArgs(grokAdapter), '--resume', UUID])
    // Measured on 1.0.5: `--session-id` on a live id -> "Session ID … is
    // already in use." Mutually exclusive AT THE CLI, as on claude.
    expect(args).not.toContain('--session-id')
  })

  // `grok --help`: "-r, --resume [<SESSION_ID_OR_TITLE>] … or the most recent if
  // omitted" — the same optional value as claude's, with a WORSE default: a bare
  // `--resume` adopts another pane's conversation on the same cwd (D139).
  it.each([['create' as const], ['resume' as const]])(
    'grok with an EMPTY agentSessionId (%s) emits neither flag',
    (action) => {
      const args = grokAdapter.buildLaunch({
        ...SPEC,
        resume: { strategy: 'assigned', action, agentSessionId: '' }
      }).args
      expect(args).toEqual(grokAdapter.buildLaunch(SPEC).args)
      expect(args).not.toContain('--resume')
      expect(args).not.toContain('--session-id')
    }
  )

  it('grok resume rides AFTER the model and the levelled defaults, never before', () => {
    const args = grokAdapter.buildLaunch({
      ...SPEC,
      route: {
        providerKey: 'chorus',
        providerName: 'xAI',
        baseUrl: 'https://api.x.ai/v1',
        modelId: 'grok-4.5'
      },
      resume: { strategy: 'assigned', action: 'resume', agentSessionId: UUID }
    }).args
    expect(args).toEqual([...expectedArgs(grokAdapter), '-m', 'grok-4.5', '--resume', UUID])
  })

  /* ── codex: discovered ──────────────────────────────────────────────────── */

  it('codex discovered/resume appends the `resume` token and the id POSITIONAL', () => {
    // The measured ordering (_verify/4a-2/codex-c-position.md): the subcommand
    // goes AFTER the baseline/route/effort options, which keeps
    // CODEX_BASELINE_ARGS a genuine argv prefix. Verified against 0.147.0 in a
    // real TTY — `codex -c … resume <id>` dispatches to the subcommand and the
    // `-c` overrides survive into the resumed session.
    const args = codexAdapter.buildLaunch({
      ...SPEC,
      resume: { strategy: 'discovered', action: 'resume', agentSessionId: UUID }
    }).args
    // ⚠ THE PERMISSION DEFAULT SITS BETWEEN THE BASELINE AND THE SUBCOMMAND,
    // which is the placement this test exists to pin: `resume` and its id must
    // stay LAST, after every option, however many options later versions add.
    expect(args).toEqual([
      ...resolveCli('codex').args,
      ...baselineArgs('codex'),
      '-c',
      'sandbox_mode="danger-full-access"',
      '-c',
      'approval_policy="never"',
      'resume',
      UUID
    ])
    // ⚠ Here `-c` is --config. On kimi and opencode it is --continue. The
    // baseline's `-c` must never be read as a continue flag by a future reader.
    // FOUR of them since 2026-08-24: the status line, the ONE
    // developer_instructions token `instructionsArgs` emits (Task 6a-1), and the
    // permission default's two keys.
    expect(args.filter((a) => a === '-c')).toHaveLength(4)
    expect(args).not.toContain('--last')
    expect(args).not.toContain('--continue')
  })

  it('codex with an EMPTY agentSessionId emits no subcommand — bare `codex resume` is a PICKER', () => {
    const args = codexAdapter.buildLaunch({
      ...SPEC,
      resume: { strategy: 'discovered', action: 'resume', agentSessionId: '' }
    }).args
    expect(args).toEqual(codexAdapter.buildLaunch(SPEC).args)
    expect(args).not.toContain('resume')
  })

  it('codex keeps the baseline, route, model and effort overrides on a RESUME launch', () => {
    // The whole of D139 turned on a second launch path dropping these. The
    // single path must be SHOWN not to — and the CLI agrees: a real resume with
    // `-m` and an effort override rendered `gpt-5.6-codex high` in its own
    // status line (_verify/4a-2/full-A.log).
    const args = codexAdapter.buildLaunch({
      ...SPEC,
      credential: FAKE_CREDENTIAL,
      route: {
        providerKey: 'chorus',
        providerName: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        modelId: 'deepseek/deepseek-v4-pro'
      },
      effortOptionId: 'deep',
      resume: { strategy: 'discovered', action: 'resume', agentSessionId: UUID }
    }).args
    expect(args).toEqual([
      ...resolveCli('codex').args,
      ...baselineArgs('codex'),
      '-c',
      'model_provider="chorus"',
      '-c',
      'model_providers.chorus.name="OpenRouter"',
      '-c',
      'model_providers.chorus.base_url="https://openrouter.ai/api/v1"',
      '-c',
      `model_providers.chorus.env_key="${FAKE_CREDENTIAL.envVarName}"`,
      '-c',
      'model_providers.chorus.wire_api="responses"',
      '-m',
      'deepseek/deepseek-v4-pro',
      '-c',
      'model_reasoning_effort="high"',
      '-c',
      'sandbox_mode="danger-full-access"',
      '-c',
      'approval_policy="never"',
      'resume',
      UUID
    ])
  })

  /* ── the D139 risk case ─────────────────────────────────────────────────── */

  it('⚠ a resume launch preserves credential, route AND hooks — the risk D139 turned on', () => {
    // A SECOND launch path would have rebuilt all three beside the first, and
    // the two would then have had to agree forever. One path makes this
    // structurally likely; this test makes it checked.
    const req = claudeAdapter.buildLaunch({
      ...SPEC,
      credential: FAKE_CREDENTIAL,
      hooks: {
        endpointUrl: 'http://127.0.0.1:1/hooks/tok',
        configPath: nodePath.join(nodeOs.tmpdir(), 'chorus-4a2-test', 'settings.json')
      },
      resume: { strategy: 'assigned', action: 'resume', agentSessionId: UUID }
    })
    // credential -> secretEnv (never argv)
    expect(req.secretEnv[FAKE_CREDENTIAL.envVarName]).toBe(FAKE_CREDENTIAL.value)
    // hooks -> argv, still present alongside the resume flag
    expect(req.args).toContain('--settings')
    // and the resume pair survived the company
    expect(req.args.slice(-2)).toEqual(['--resume', UUID])
  })

  /* ── kimi + opencode: declared incapable, and they must ACT incapable ───── */

  // ⚠ GROK'S EXPLICIT REQUEST, AND THE CHEAPEST TEST IN THE SET. "An adapter
  // silently honours a modifier it never declared" is the FIRST risk the ruling
  // names. Both of these keep `sessionResume: null`, so a `resume` field must
  // change nothing at all.
  it.each([
    ['kimi', kimiAdapter],
    ['opencode', opencodeAdapter]
  ])('%s IGNORES a resume field it never declared', (_id, adapter) => {
    const withModifier = adapter.buildLaunch({
      ...SPEC,
      resume: { strategy: 'assigned', action: 'resume', agentSessionId: UUID }
    }).args
    expect(withModifier).toEqual(adapter.buildLaunch(SPEC).args)
    expect(withModifier).not.toContain(UUID)
    expect(withModifier).not.toContain('resume')
    expect(adapter.getCapabilities().sessionResume).toBeNull()
  })

  /* ── structural support (the runtime half of `?: never`) ────────────────── */

  it('codex exposes discoverSessionId; claude does NOT', () => {
    expect(typeof codexAdapter.discoverSessionId).toBe('function')
    // ⚠ ASSERTED AT RUNTIME BECAUSE `discoverSessionId?: never` IS ONLY A
    // COMPILE-TIME CLAIM. `assigned` FORBIDS discovery — it is deterministic,
    // so a discovery method here would be a race that cannot happen pretending
    // it can.
    expect((claudeAdapter as { discoverSessionId?: unknown }).discoverSessionId).toBeUndefined()
    // D165: grok is assigned too, so the same runtime claim holds for it.
    expect((grokAdapter as { discoverSessionId?: unknown }).discoverSessionId).toBeUndefined()
  })

  it('all three capable adapters classify their failures', () => {
    expect(typeof claudeAdapter.classifyResumeFailure).toBe('function')
    expect(typeof codexAdapter.classifyResumeFailure).toBe('function')
    expect(typeof grokAdapter.classifyResumeFailure).toBe('function')
  })

  /* ── classifier fixtures, from MEASURED output ──────────────────────────── */

  const exit = (output: string, exitCode = 1): ResumeExitObservation => ({
    exitCode,
    signal: null,
    output
  })

  it('claude: measured unknown-id output -> not-found', () => {
    // claude 2.1.229, `--resume <unknown uuid>`
    expect(
      claudeAdapter.classifyResumeFailure(exit(`No conversation found with session ID: ${UUID}`))
    ).toBe('not-found')
  })

  it('claude: measured in-use output -> in-use', () => {
    // claude 2.1.229, `--session-id <live uuid>`
    expect(
      claudeAdapter.classifyResumeFailure(exit(`Error: Session ID ${UUID} is already in use.`))
    ).toBe('in-use')
  })

  it('codex: measured unknown-id output -> not-found', () => {
    // codex-cli 0.147.0, `codex resume <unknown uuid>`, captured in a real TTY
    expect(
      codexAdapter.classifyResumeFailure(
        exit(
          `ERROR: No saved session found with ID ${UUID}. Run codex resume without an ID to choose from existing sessions.`
        )
      )
    ).toBe('not-found')
  })

  it('grok: measured unknown-id output -> not-found (matched on the 404, not the prefix)', () => {
    // grok 1.0.5, `grok --resume <unknown uuid>`, 2026-08-18 — grok tries a
    // REMOTE restore first, so the prefix alone is not evidence of absence.
    expect(
      grokAdapter.classifyResumeFailure(
        exit(
          `Session "${UUID}" not found locally, restoring conversation from remote...\n` +
            `  [0.000s] 🔎 Fetching session record — Loading restore metadata from the registry\n` +
            `Error: Failed to restore session from remote: fetching session record: session get failed: 404 Not Found`
        )
      )
    ).toBe('not-found')
    // ⚠ A remote failure that is NOT a 404 (offline, 5xx) is NOT classified — a
    // healthy pointer must survive a network outage. Same prefix, different tail.
    expect(
      grokAdapter.classifyResumeFailure(
        exit(
          `Session "${UUID}" not found locally, restoring conversation from remote...\n` +
            `Error: Failed to restore session from remote: fetching session record: connection refused`
        )
      )
    ).toBeNull()
  })

  it('grok: measured in-use output -> in-use', () => {
    // grok 1.0.5, `grok --session-id <live uuid>`, 2026-08-18
    expect(
      grokAdapter.classifyResumeFailure(exit(`Error: Error: Session ID ${UUID} is already in use.`))
    ).toBe('in-use')
  })

  // ⚠ THE `null` ROWS ARE NOT FILLER — THEY ARE THE POINT. Once 4a-3 wires this,
  // EVERY ordinary end of EVERY ordinary session reaches the classifier. A
  // classifier generous with reasons turns normal exits into pointer-clearing
  // relaunches badged "context was not restored", which is worse for the user
  // than never having shipped resume at all.
  it.each([
    ['claude', claudeAdapter],
    ['codex', codexAdapter],
    ['grok', grokAdapter]
  ])('%s: a clean exit with ordinary output -> null', (_id, adapter) => {
    expect(adapter.classifyResumeFailure(exit('Goodbye! Session ended.', 0))).toBeNull()
    expect(adapter.classifyResumeFailure(exit('', 0))).toBeNull()
    // Ordinary prose that merely mentions sessions must not trip it either.
    expect(
      adapter.classifyResumeFailure(exit('I resumed reading the session notes for you.', 0))
    ).toBeNull()
  })

  // ⚠ THE FALSE-POSITIVE CASE, AND IT IS NOT HYPOTHETICAL FOR THIS APP.
  // `output` is agent conversation, and Chorus is a tool whose users read and
  // write about Chorus — an agent quoting these very error strings while
  // discussing this file exits 0 like any other turn. Without the exit-code
  // gate that would clear a HEALTHY pointer and relaunch the pane. Both CLIs
  // were measured exiting 1 on a real failed resume, so the gate costs nothing.
  it.each([
    ['claude', claudeAdapter, `No conversation found with session ID: ${UUID}`],
    ['codex', codexAdapter, `ERROR: No saved session found with ID ${UUID}.`],
    [
      'grok',
      grokAdapter,
      `Error: Failed to restore session from remote: fetching session record: session get failed: 404 Not Found`
    ]
  ])('%s: the failure string on a CLEAN exit is still null', (_id, adapter, text) => {
    expect(adapter.classifyResumeFailure(exit(text, 0))).toBeNull()
    // …and a signal kill (exitCode null) is a Chorus-side stop, never a vendor
    // resume failure.
    expect(adapter.classifyResumeFailure({ exitCode: null, signal: 'SIGTERM', output: text })).toBeNull()
    // The same text on a genuine non-zero exit IS classified.
    expect(adapter.classifyResumeFailure(exit(text, 1))).toBe('not-found')
  })

  /* ── the wire (amendment (f)) ───────────────────────────────────────────── */

  it('⚠ resumeDescriptorSchema keeps `kind` — z.object STRIPS silently, so a passing parse proves nothing', () => {
    // Parsed from claude's REAL getCapabilities(), not a hand-built fixture: the
    // failure this guards against is a `kind` that exists on the runtime object
    // and not on the schema, which vanishes on the wire with no error anywhere.
    const parsed = agentCapabilitiesSchema.parse(claudeAdapter.getCapabilities())
    expect(parsed.sessionResume).toEqual({ mode: 'static', kind: 'assigned', cliFlag: '--resume' })
    expect(agentCapabilitiesSchema.parse(codexAdapter.getCapabilities()).sessionResume).toEqual({
      mode: 'static',
      kind: 'discovered',
      cliFlag: null
    })
    // `mode` is a VALIDATED WIRE FIELD and was retained deliberately (D143(f)).
    expect(parsed.sessionResume?.mode).toBe('static')
  })
})

/**
 * Task 6a-1 / D148 — the memory usage contract.
 *
 * ⚠ THE INVARIANT TO TEST HARDEST IS THE ABSENT ONE. Most launches carry no
 * contract, so "a launch with no memory configured is byte-identical to HEAD"
 * is the assertion that protects every existing user, and it is asserted as
 * EXACT EQUALITY built from `resolveCli`'s live output — never by difference,
 * never with `toContain`, never by comparing lengths.
 */
describe('Task 6a-1: the memory usage contract (D148)', () => {
  const SPEC = { sessionId: 's', cwd: 'C:\Projects' } as const
  const CONTRACT = {
    text: 'MEMORY CONTRACT TEXT',
    filePath: nodePath.join(nodeOs.tmpdir(), 'chorus-6a1-test', 's.md')
  } as const

  afterEach(() => {
    nodeFs.rmSync(nodePath.join(nodeOs.tmpdir(), 'chorus-6a1-test'), { recursive: true, force: true })
  })

  /* ── who declares what ─────────────────────────────────────────────────── */

  it('exactly two adapters declare the capability, and the other three answer null', () => {
    // The nulls are a DECISION, not an omission (D148): kimi's
    // `--agent-file` replaces a profile wholesale, opencode's key is
    // unmeasured behind an `additionalProperties: false` schema, and grok's
    // `--rules` is argv-only and unmeasured against the TUI (D165).
    expect(claudeAdapter.getCapabilities().instructions).toEqual({
      mode: 'static',
      mechanism: 'append-system-prompt-file'
    })
    expect(codexAdapter.getCapabilities().instructions).toEqual({
      mode: 'static',
      mechanism: 'config-override'
    })
    expect(kimiAdapter.getCapabilities().instructions).toBeNull()
    expect(opencodeAdapter.getCapabilities().instructions).toBeNull()
    expect(grokAdapter.getCapabilities().instructions).toBeNull()
  })

  it('supportsInstructions narrows on BOTH halves, so a declaration without a method is caught', () => {
    expect(supportsInstructions(claudeAdapter)).toBe(true)
    expect(supportsInstructions(codexAdapter)).toBe(true)
    expect(supportsInstructions(kimiAdapter)).toBe(false)
    expect(supportsInstructions(opencodeAdapter)).toBe(false)
    expect(supportsInstructions(grokAdapter)).toBe(false)
  })

  /* ── claude: the file mechanism ────────────────────────────────────────── */

  // ⚠ THE BASELINE IS `expectedArgs`, NOT `resolveCli` — CHANGED 2026-08-15 WHEN
  // D148's PERMISSION/EFFORT DEFAULTS LANDED. This pin was written when a
  // no-contract claude launch was byte-identical to bare `resolveCli` output;
  // claude now declares `defaultLevelId` on both levelled descriptors, so every
  // launch carries `--effort xhigh --permission-mode auto` from rank 3. The
  // property asserted is UNCHANGED and is the one that matters: no contract, no
  // CONTRACT tokens. Reading the baseline off the descriptors rather than
  // re-stating it is what keeps this a test of the adapter instead of a test of
  // this file's memory the next time a default moves.
  it('⚠ claude with NO contract adds no contract tokens and writes nothing', () => {
    expect(claudeAdapter.buildLaunch(SPEC).args).toEqual(expectedArgs(claudeAdapter))
    expect(claudeAdapter.instructionsArgs(null)).toEqual([])
    expect(nodeFs.existsSync(CONTRACT.filePath)).toBe(false)
  })

  it('claude with a contract adds EXACTLY two tokens, the second being the reserved path', () => {
    const args = claudeAdapter.buildLaunch({ ...SPEC, instructions: CONTRACT }).args
    expect(args).toEqual([
      ...expectedArgs(claudeAdapter),
      '--append-system-prompt-file',
      CONTRACT.filePath
    ])
    // The flag is worthless without the bytes: assert the file, not just argv.
    expect(nodeFs.readFileSync(CONTRACT.filePath, 'utf8')).toBe(CONTRACT.text)
  })

  it('claude degrades to NO tokens when the file cannot be written — it never throws', () => {
    // An unwritable path (a directory where the file should be) stands in for
    // the real-world causes: a full disk, a locked profile, a roaming redirect.
    // Losing the contract costs a hint; throwing here would cost the session.
    const dirAsFile = nodePath.join(nodeOs.tmpdir(), 'chorus-6a1-test', 'blocked.md')
    nodeFs.mkdirSync(dirAsFile, { recursive: true })
    expect(() =>
      claudeAdapter.instructionsArgs({ text: 'x', filePath: dirAsFile })
    ).not.toThrow()
    expect(claudeAdapter.instructionsArgs({ text: 'x', filePath: dirAsFile })).toEqual([])
  })

  /* ── codex: the one emitter ────────────────────────────────────────────── */

  it('⚠ codex with NO contract emits the jade pair and nothing of D148’s, in position', () => {
    // ⚠ THE TITLE SAID "byte-identical to HEAD" UNTIL 2026-08-24. It was a claim
    // about THIS task — that a launch with no memory contract carries none of
    // D148's tokens — but it was WRITTEN as a claim that codex's whole argv is
    // frozen, which no test can honestly promise and which the permission
    // default below duly broke. The assertion is unchanged in substance: no
    // `developer_instructions` contract part, and the jade pair still in its
    // position ahead of everything a launch option can add.
    expect(codexAdapter.buildLaunch(SPEC).args).toEqual([
      ...resolveCli('codex').args,
      '-c',
      'tui.status_line=["model-with-reasoning","current-dir","context-remaining"]',
      '-c',
      `developer_instructions=${JSON.stringify(CODEX_JADE_ECHO_INSTRUCTIONS)}`,
      '-c',
      'sandbox_mode="danger-full-access"',
      '-c',
      'approval_policy="never"'
    ])
  })

  it('⚠ codex emits EXACTLY ONE developer_instructions token, carrying BOTH parts', () => {
    // This is the regression the whole task is shaped around. `-c` REPLACES:
    // measured on 0.147.0, the LAST duplicate wins and the first value vanishes
    // with no warning (_verify/6a-1/codex-duplicate-c.txt). Two tokens would
    // therefore have silently deleted the jade formatting rule.
    const args = codexAdapter.buildLaunch({ ...SPEC, instructions: CONTRACT }).args
    const tokens = args.filter((a) => a.startsWith('developer_instructions='))
    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toContain('FORMATTING RULE')
    expect(tokens[0]).toContain(CONTRACT.text)
  })

  it('codex renders the composed value as ONE physical line', () => {
    const args = codexAdapter.buildLaunch({ ...SPEC, instructions: CONTRACT }).args
    const token = args.find((a) => a.startsWith('developer_instructions='))!
    // A raw newline is an illegal TOML basic string and `tomlBasicString` does
    // not escape one — codex would discard the override in silence.
    expect(token).not.toMatch(/[\r\n]/)
  })

  it('⚠ the key has exactly ONE emitter — the baseline no longer carries it', () => {
    expect(CODEX_BASELINE_ARGS.join(' ')).not.toContain('developer_instructions')
  })

  /* ── F75/D150: the MCP tokens, in position ─────────────────────────────── */

  // Computed ONCE — `buildLaunch` spawns `where.exe` synchronously every call
  // (see the F75 block's note on why that matters to this file).
  const CODEX_MCP_ARGV = codexAdapter.buildLaunch({
    ...SPEC,
    mcpServers: [
      {
        name: 'chorus-memory',
        command: 'uvx',
        args: ['mcp-neo4j-cypher'],
        envPassthrough: ['NEO4J_URL', 'NEO4J_DATABASE']
      }
    ]
  }).args

  it('⚠ codex with one server emits the six MCP tokens, AFTER the fixed prefix', () => {
    // EXACT EQUALITY over the whole argv, not a `toContain`: this pins the
    // POSITION as well as the contents, which is what keeps the baseline a
    // genuine prefix and every other pin in this file an equality.
    expect(CODEX_MCP_ARGV).toEqual([
      ...resolveCli('codex').args,
      '-c',
      'tui.status_line=["model-with-reasoning","current-dir","context-remaining"]',
      '-c',
      `developer_instructions=${JSON.stringify(CODEX_JADE_ECHO_INSTRUCTIONS)}`,
      '-c',
      // ⚠ THE NAME IS RENDERED VERBATIM, HYPHEN AND ALL — `renderMcpLaunchArgs`
      // does not transform it, and the real server is `chorus-memory`. (The
      // older fixture in this file uses an underscore because its REF is named
      // that way, not because anything rewrites the name.) A hyphen is a legal
      // TOML bare key, which is what makes the dotted `-c` path valid.
      'mcp_servers.chorus-memory.command="uvx"',
      '-c',
      'mcp_servers.chorus-memory.args=["mcp-neo4j-cypher"]',
      '-c',
      'mcp_servers.chorus-memory.env_vars=["NEO4J_URL","NEO4J_DATABASE"]',
      // The permission default (2026-08-24), AFTER the MCP tokens — which is
      // the position this exact-equality assertion exists to pin. Nothing here
      // may sit between the MCP tokens and the fixed prefix.
      '-c',
      'sandbox_mode="danger-full-access"',
      '-c',
      'approval_policy="never"'
    ])
  })

  it('⚠ NO VALUE reaches codex argv — only the two NAMES (D150)', () => {
    const joined = CODEX_MCP_ARGV.join(' ')
    // The exact failure this task is most likely to ship is a server codex can
    // SEE but cannot REACH; the opposite failure is a bolt URI in a
    // world-readable command line. This pins the second one shut.
    expect(joined).not.toContain('bolt://')
    expect(joined).not.toContain('.env=')
    expect(joined).toContain('.env_vars=')
  })

  /* ── the three that answer null ────────────────────────────────────────── */

  it.each([
    ['kimi', kimiAdapter],
    ['opencode', opencodeAdapter]
  ])('%s exposes no instructionsArgs at all, so a contract cannot reach it', (_id, adapter) => {
    expect((adapter as Partial<SupportsInstructions>).instructionsArgs).toBeUndefined()
  })
})

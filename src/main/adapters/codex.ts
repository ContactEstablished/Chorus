import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { probeCli, resolveCli } from '../services/cliDetect'
import { buildSecretEnv } from './capabilities'
import { resolveEffortArgs } from './effort'
import { assertSingleLine } from './instructionsCore'
import { renderMcpLaunchArgs, tomlBasicString, tomlStringArray } from './mcpConfigCore'
import type {
  AgentCapabilities,
  AuthMethodDefinition,
  DiscoveredResumeSupport,
  DiscoverSessionContext,
  EffortDescriptor,
  InstallationStatus,
  McpDescriptor,
  McpServerRef,
  McpWriteResult,
  PtyAgentAdapter,
  PtyLaunchInstructions,
  PtyLaunchRequest,
  PtyLaunchSpec,
  ResumeExitObservation,
  ResumeFailureReason,
  SupportsInstructions,
  SupportsMcp
} from './types'

/**
 * The `codex` (Codex CLI) PTY adapter. Everything declared here was verified
 * THIS SESSION against codex-cli 0.145.0's own `--help` / `login --help` /
 * official config reference (D4); anything unverified or unimplemented is
 * null/false (spec §4.2).
 */
export const codexAdapter: PtyAgentAdapter &
  SupportsInstructions &
  SupportsMcp &
  DiscoveredResumeSupport = {
  id: 'codex',
  displayName: 'Codex',
  executionMode: 'pty',

  // Nothing beyond the Windows baseline (main owns it) — today this adapter
  // needs no env var preserved into an allow-list launch.
  requiredEnvVars: [],

  async detectInstallation(): Promise<InstallationStatus> {
    // The same where.exe -> pickSpawnable -> --version probe cliDetect has
    // always run (10 s timeout, windowsHide, first line, 'unknown' on
    // failure) — shared, not reimplemented; codex resolves to its npm .cmd
    // shim via the same pickSpawnable logic SessionManager used directly.
    return probeCli(this.id)
  },

  getAuthMethods(): readonly AuthMethodDefinition[] {
    return [
      {
        type: 'subscription',
        label: 'ChatGPT account (codex login)',
        requiredEnvVar: null,
        helpUrl: 'https://github.com/openai/codex'
      },
      {
        type: 'api_key',
        label: 'OpenAI API key',
        // D4-verified against `codex login --help` (0.145.0, this session):
        // "--with-api-key  Read the API key from stdin (e.g. `printenv
        // OPENAI_API_KEY | codex login --with-api-key`)".
        requiredEnvVar: 'OPENAI_API_KEY',
        helpUrl: 'https://github.com/openai/codex'
      }
    ]
  },

  getCapabilities(): AgentCapabilities {
    // Honesty rules (spec §4.2) — declare only what this session verified:
    //  - skills: TRUE — 0.145.0's official config reference documents
    //    `skills.config` per-skill enablement, `skill_approval` under
    //    approval_policy.granular, and `features.skill_mcp_dependency_install`
    //    (stable, on by default). Corrected from the 0.144.6-era `false`.
    //  - reasoningEffort: POPULATED by Task 3a-4 — see CODEX_EFFORT below for
    //    the D4 evidence, which this session obtained by making the binary
    //    ACCEPT and REJECT the key rather than by reading strings out of it.
    //  - hooks: NULL even though the CLI has a hook-trust flag — the extension
    //    METHOD is unimplemented (see claude.ts).
    //  - sessionResume: NOW POPULATED by Task 4a-2 (D139/D140), and it no
    //    longer shares a sentence with `hooks`: the two were null for the same
    //    reason and are not any more. `discoverSessionId` and
    //    `classifyResumeFailure` below are the methods that earn it.
    //
    //    `kind: 'discovered'` is D140's other half, and it is a MEASURED
    //    asymmetry rather than a style choice: `codex --help` on 0.147.0 has no
    //    `--session-id` equivalent, so there is no way to tell codex what to
    //    call a conversation. It names its own and Chorus must ask afterwards
    //    what it chose, by reading rollout `session_meta` headers.
    //
    //    ⚠ `cliFlag: null` IS MEANINGFUL HERE RATHER THAN A PLACEHOLDER. It
    //    says "resumption is not flag-driven for this CLI", which is exactly
    //    true — codex resumes by SUBCOMMAND (`codex resume <id>`), so there is
    //    no flag to name. `kind` carries the rest.
    //  - mcp: POPULATED by Task 6-2 — see CODEX_MCP below.
    return {
      interactiveTerminal: true, // observed since Phase 0
      worktreeSafe: true, // proven across Phase 2
      skills: true, // 0.145.0 config reference: skills.config, skill_approval
      subscriptionLogin: true, // ChatGPT account login today
      apiKey: true, // the capability Phase 3 is building (3-4 renders, 3-6 acts)
      reasoningEffort: CODEX_EFFORT,
      sessionResume: { mode: 'static', kind: 'discovered', cliFlag: null },
      mcp: CODEX_MCP,
      hooks: null,
      // D148: codex is told things through `-c developer_instructions`, which
      // it has ALREADY been told things through since v17 (the jade rule).
      // That is why this adapter's mechanism is `config-override` and why the
      // method below is the single home of that key.
      instructions: { mode: 'static', mechanism: 'config-override' }
    }
  },

  /**
   * Task 6-2: codex's MCP mechanism is ARGV, so "supporting MCP" here costs no
   * filesystem access at all. Delegates to the pure core — the guard
   * (`assertNoSecretInRendered`) and this renderer must never have two homes.
   */
  mcpLaunchArgs(servers: readonly McpServerRef[]): readonly string[] {
    return renderMcpLaunchArgs(servers)
  },

  /**
   * ⚠ THE STRUCTURED REFUSAL, AND IT IS NOT A NO-OP AND NOT A THROW. A caller
   * that reaches this has made a category error and deserves a reason.
   *
   * ⚠ AND IT IS THE D49 BRIGHT LINE EXPRESSED AS CODE. The only file codex is
   * configured by is `~/.codex/config.toml`, which Chorus must never write —
   * so the honest implementation of "write a config file" for this adapter is
   * to decline, permanently, rather than to grow one later.
   */
  async writeMcpConfig(): Promise<McpWriteResult> {
    return { ok: false, reason: 'codex is configured by launch arguments, not by a file.' }
  },

  /**
   * ⚠ THE ONE HOME OF THE `developer_instructions` TOKEN. NOTHING ELSE IN THIS
   * FILE MAY EMIT THAT KEY.
   *
   * `-c` REPLACES rather than appends (see CODEX_JADE_ECHO_INSTRUCTIONS above),
   * so a second `-c developer_instructions=` token destroys one of the two
   * values — and codex says NOTHING about a duplicated or unknown `-c` path.
   * Measured on the installed 0.147.0, 2026-08-14
   * (`_verify/6a-1/codex-duplicate-c.txt`):
   *
   *   codex debug -c developer_instructions="A" -c developer_instructions="B" prompt-input
   *   -> the rendered developer message is "B". "A" appears nowhere. Exit 0,
   *      no warning, no diagnostic.
   *
   * The LAST one wins, and the jade rule is emitted FIRST — so the naive
   * "append a second token" implementation would have silently deleted the
   * formatting rule, with no symptom but a convention that quietly stopped
   * being followed. Both parts are therefore composed into one value here.
   *
   * ⚠ CALLED UNCONDITIONALLY, AND THE NULL CASE IS NOT A NO-OP. With no memory
   * contract this still emits the jade rule, which is why the parameter is
   * nullable rather than the method optional.
   */
  instructionsArgs(instructions: PtyLaunchInstructions | null): readonly string[] {
    const parts = instructions
      ? [CODEX_JADE_ECHO_INSTRUCTIONS, instructions.text]
      : [CODEX_JADE_ECHO_INSTRUCTIONS]
    // assertSingleLine, not a comment hoping for one: a raw newline here is an
    // illegal TOML basic string (`tomlBasicString` escapes \ and " and NOT
    // newlines) and codex would discard the whole override in silence.
    return ['-c', `developer_instructions=${tomlBasicString(assertSingleLine(parts.join(' ')))}`]
  },

  buildLaunch(spec: PtyLaunchSpec): PtyLaunchRequest {
    // Behavior-neutral (Task 3-3): resolveCli is the same synchronous
    // where.exe resolution SessionManager used directly before this refactor.
    // For codex that yields { file: 'cmd.exe', args: ['/c', <shim>] } — the
    // cmd.exe indirection is the shim mechanics, preserved EXACTLY.
    const cli = resolveCli(this.id)
    // v17: FIRST, so it is a genuine prefix of every codex command line. `-c`
    // overrides distinct keys and is order-independent, so position is free
    // here — and putting it at the front is what lets every "base + extras"
    // assertion in adapters.test.ts stay an exact-equality pin instead of
    // having to reason about a tail. See `CODEX_BASELINE_ARGS`.
    // D148: `instructionsArgs` occupies EXACTLY the position the
    // `developer_instructions` pair held inside CODEX_BASELINE_ARGS before
    // Task 6a-1, so with no memory configured this expression reproduces the
    // pre-6a-1 argv token for token. That byte-identity is an acceptance
    // criterion, not an aspiration — and it is what keeps the baseline a
    // genuine argv PREFIX, which is what lets every assertion below stay an
    // exact-equality pin instead of reasoning about a tail.
    const args = [
      ...cli.args,
      ...CODEX_BASELINE_ARGS,
      ...this.instructionsArgs(spec.instructions ?? null)
    ]

    // D47 (Task 3-6): the OpenRouter route. A credential whose provider
    // carries a base_url points codex at that OpenAI-compatible endpoint via
    // PER-LAUNCH `-c` dotted-path overrides — ~/.codex/config.toml is never
    // written, and nothing here is secret: the key itself reaches the child
    // ONLY through secretEnv -> composeChildEnv -> the environment block.
    // `-c` is argv; a base URL, an env-var NAME, and a wire-api string are
    // legal there; a key never is (Non-Goal #1).
    //
    // D4-verified against the INSTALLED 0.145.0 this session:
    //  - `wire_api = "chat"` is REJECTED ("no longer supported") — the only
    //    supported value is `responses` (the default; emitted explicitly).
    //  - `model_providers.<id>.name` is REQUIRED ("provider name must not be
    //    empty") — the user-authored provider name supplies it.
    //  - `env_key` = the NAME of the env var codex reads at runtime for the
    //    bearer token — exactly what composeChildEnv injects (D33 clause 5).
    if (spec.credential && spec.route) {
      const key = spec.route.providerKey
      const baseUrl = spec.route.baseUrl.replace(/\/+$/, '') // a trailing slash is a known failure mode
      args.push(
        '-c', `model_provider=${tomlBasicString(key)}`,
        '-c', `model_providers.${key}.name=${tomlBasicString(spec.route.providerName)}`,
        '-c', `model_providers.${key}.base_url=${tomlBasicString(baseUrl)}`,
        '-c', `model_providers.${key}.env_key=${tomlBasicString(spec.credential.envVarName)}`,
        '-c', `model_providers.${key}.wire_api=${tomlBasicString('responses')}`
      )
      // D48: the route's DEFAULT model. Emitted only when the provider
      // carries one — a NULL model must never reach argv as "null".
      if (spec.route.modelId) args.push('-m', spec.route.modelId)
    }

    // Task 3a-4: the effort override, AFTER the route's `-c` overrides and the
    // `-m` model, through the SAME `-c` mechanism one line up. NO `switch` on
    // the level here — the descriptor is the mapping and this only reads it.
    // With no level chosen (the default) this contributes nothing and the
    // command line stays byte-identical to the pre-3a-4 one.
    args.push(...resolveEffortArgs(CODEX_EFFORT, spec.effortOptionId, spec.extraArgs ?? []))

    // Task 4a-2 / D139: resume is a SUBCOMMAND, so the modifier changes argv
    // SHAPE rather than merely its contents — and it is appended LAST, after
    // every option the normal path emits. With no modifier this contributes
    // nothing and the command line is byte-identical to HEAD.
    //
    // ⚠ THE POSITION IS MEASURED, NOT ASSUMED (spec §3's open question).
    // Against the installed 0.147.0, in a real TTY (_verify/4a-2/):
    //   - `codex -c … resume <id>` DOES dispatch to the resume subcommand —
    //     proven by the subcommand's own error, "No saved session found with ID
    //     …", not by an exit code;
    //   - the `-c` overrides SURVIVE in this position — `-c model=` drew
    //     codex's own "This session was recorded with model X but is resuming
    //     with Y" warning, and a full baseline + `-m` + effort argv resumed
    //     showing `gpt-5.6-codex high`, i.e. BOTH overrides applied.
    // The subcommand-first ordering (`codex resume -c … <id>`) also works. This
    // one is chosen because it keeps CODEX_BASELINE_ARGS a genuine argv PREFIX,
    // which is what lets adapters.test.ts's assertions stay exact-equality pins
    // instead of reasoning about a tail (see CODEX_BASELINE_ARGS).
    //
    // ⚠ `-c` HERE IS `--config`, NOT `--continue`. On kimi and opencode the
    // same two characters mean `--continue` and would silently resume a stale
    // session (kimi.ts, opencode.ts). Nothing in this function may be copied
    // there without re-reading those warnings.
    args.push(...codexResumeArgs(spec))

    return {
      executable: cli.file,
      args,
      cwd: spec.cwd,
      // F64: stamp this launch so discovery can recognise its OWN rollout rather
      // than inferring ownership from a directory and a clock. Non-secret, and
      // it travels in the ENVIRONMENT rather than argv — argv is world-readable
      // (`Get-CimInstance Win32_Process`), and while a session row id is not a
      // credential, the standing rule is that Chorus adds nothing to argv it
      // does not have to.
      envAdditions: { [ORIGINATOR_ENV_VAR]: originatorStamp(spec.sessionId) },
      secretEnv: buildSecretEnv(spec.credential)
    }
  },

  /**
   * Ask codex what it called the conversation it just started, by reading
   * rollout `session_meta` headers.
   *
   * ⚠ NOTHING CALLS THIS IN TASK 4a-2. Its invocation, bounding and persistence
   * are 4a-3's — this ships a tested function with no caller, the same
   * deliberate shape Task 4a-1 shipped its database column in.
   *
   * ⚠ ROLLOUT HEADERS ONLY, NEVER `session_index.jsonl`. F57 measured that the
   * index carries `{id, thread_name, updated_at}` and NO `cwd`, so it cannot
   * answer "the session I just launched in THIS directory" — which is the only
   * question worth asking. Header shape verified against a real 0.147.0 session
   * this task created: first line `{type:'session_meta', payload:{session_id,
   * cwd, timestamp, …}}`.
   *
   * ⚠ AND A WRONG ANSWER IS WORSE THAN NO ANSWER. A mistaken pointer resumes
   * SOMEONE ELSE'S CONVERSATION INTO THIS PANE; an empty one costs a manual
   * relaunch (D140). So ambiguity returns null rather than "the newest", the
   * cwd compare is exact, and `launchedAt` is a hard lower bound.
   */
  async discoverSessionId(context: DiscoverSessionContext): Promise<string | null> {
    if (context.signal.aborted) return null
    const root = path.join(os.homedir(), '.codex', 'sessions')
    const dirs = candidateDayDirs(root, context.launchedAt)

    // Headers are IMMUTABLE once written (the first line of an append-only
    // file), so a file inspected once never needs inspecting again. This is
    // what makes the safety-net re-scan below effectively free: after the first
    // pass, each tick reads only files that did not exist before.
    const seen = new Map<string, SessionMeta | null>()

    const stamp = originatorStamp(context.sessionId)

    /** `undefined` = keep waiting · `string` = this launch's id · `null` = give
     *  up (ambiguous — claim NEITHER). */
    const scan = (): string | null | undefined => {
      let heuristic: string | null = null
      for (const dir of dirs) {
        for (const file of rolloutFilesIn(dir)) {
          let meta = seen.get(file)
          if (meta === undefined) {
            meta = readSessionMeta(file)
            // A file caught mid-creation has no complete first line yet; leave
            // it UNCACHED so the next event re-reads it.
            if (meta !== null) seen.set(file, meta)
          }
          if (!meta) continue

          // ── Pass 1: the stamp. An identity, not an inference. ──────────────
          // No cwd test and no time test, deliberately: the marker is unique to
          // this launch, so adding a directory comparison could only ever turn a
          // certain answer into a missed one (F62's casing hazard is exactly
          // that failure).
          if (meta.originator === stamp) return meta.sessionId

          // ⚠ A ROLLOUT STAMPED BY A DIFFERENT CHORUS PANE IS NEVER A FALLBACK
          // CANDIDATE, AND THIS LINE IS WHAT KEEPS THE FALLBACK SAFE. Without
          // it, pane A — still waiting, its own stamp not yet on disk — would
          // reach the cwd+time rule and happily claim pane B's freshly written
          // conversation, which is the precise data-crossing the stamp was
          // adopted to prevent. Seeing someone else's stamp also PROVES stamping
          // works here, so the heuristic is not needed for this file.
          if (meta.originator?.startsWith(CHORUS_ORIGINATOR_PREFIX)) continue

          // ── Pass 2: the fallback, for a codex that ignores the stamp ───────
          // Exact equality. Not a prefix, not case-insensitive, not a realpath
          // guess — a sibling worktree is a DIFFERENT conversation.
          if (meta.cwd !== context.cwd) continue
          if (!withinLaunchWindow(meta.startedAt, context.launchedAt)) continue
          // Two candidates is null, not "the newest": preferring the newest is
          // exactly how a pane adopts the wrong conversation. Waiting longer
          // cannot un-ambiguate it, so this gives up rather than holding on.
          if (heuristic !== null && heuristic !== meta.sessionId) return null
          heuristic = meta.sessionId
        }
      }
      return heuristic ?? undefined
    }

    return await new Promise<string | null>((resolve) => {
      let settled = false
      let watcher: fs.FSWatcher | null = null
      let timer: ReturnType<typeof setInterval> | null = null

      const settle = (id: string | null): void => {
        if (settled) return
        settled = true
        watcher?.close()
        if (timer) clearInterval(timer)
        context.signal.removeEventListener('abort', onAbort)
        resolve(id)
      }
      function onAbort(): void {
        settle(null)
      }
      const look = (): void => {
        if (settled) return
        let out: string | null | undefined
        try {
          out = scan()
        } catch {
          // A tree that vanished mid-scan is "not yet", never a throw.
          return
        }
        if (out !== undefined) settle(out)
      }

      // ⚠ THE WATCH IS RE-ATTEMPTED, NOT ATTEMPTED ONCE, because at launch the
      // tree may not exist at all — `~/.codex/sessions` is absent until codex
      // has run once, and the `YYYY/MM/DD` directory is created with the very
      // file being waited for. A single attempt at t=0 would fail on a fresh
      // machine and never be retried, leaving the safety net as the whole
      // mechanism.
      const ensureWatcher = (): void => {
        if (watcher || settled) return
        try {
          watcher = fs.watch(root, { recursive: true }, () => look())
        } catch {
          // Still no tree, or a platform without recursive watch. The tick below
          // keeps both the retry and the scan going.
          watcher = null
        }
      }

      context.signal.addEventListener('abort', onAbort, { once: true })

      // ⚠ ESTABLISHED BEFORE THE FIRST SCAN, NOT AFTER. A rollout created in the
      // gap between scanning and watching would otherwise be missed forever, and
      // being awake when that file appears is this function's whole job.
      ensureWatcher()
      // Safety net AND watcher retry. Cheap on both counts: `seen` means a tick
      // with no new files reads nothing, and the day-bounded dirs mean a tick is
      // a handful of `readdir` calls that mostly return nothing.
      timer = setInterval(() => {
        ensureWatcher()
        look()
      }, DISCOVERY_RESCAN_MS)
      look()
    })
  },

  /**
   * Map a MEASURED codex resume failure to a generic reason. Same discipline as
   * claude's: pure, no I/O, no logging, and `null` for everything unrecognised
   * — including every clean exit, which is what stops 4a-3 turning an ordinary
   * session end into a pointer-clearing relaunch.
   */
  classifyResumeFailure(observation: ResumeExitObservation): ResumeFailureReason | null {
    // ⚠ SAME EXIT-CODE GATE AS CLAUDE'S, FOR THE SAME REASON: `output` is agent
    // conversation, and a clean exit is never a failed resume however the text
    // reads. Measured — codex 0.147.0 `resume <unknown uuid>` exits 1 in a TTY
    // (_verify/4a-2/); `exitCode === null` is a signal kill Chorus caused.
    if (observation.exitCode === 0 || observation.exitCode === null) return null
    // Measured 2026-08-13 in a real TTY, codex-cli 0.147.0 (_verify/4a-2/):
    //   `codex resume <unknown uuid>` -> "ERROR: No saved session found with ID
    //   <uuid>. Run `codex resume` without an ID to choose from existing
    //   sessions."
    if (/No saved session found with ID/i.test(observation.output)) return 'not-found'
    return null
  }
}

/**
 * The `resume` subcommand and its positional id, or nothing.
 *
 * ⚠ AN EMPTY POINTER EMITS NO SUBCOMMAND AT ALL, for the same reason claude's
 * guard exists: `codex resume` with no positional SHOWS A PICKER
 * (`codex resume --help`: "picker by default"), which would strand a pane
 * waiting for a human who is not looking at it.
 *
 * ⚠ NO `--last`, EVER. It resumes the most recent session for the directory,
 * which is emphatically not "this pane's conversation" when several panes share
 * a cwd. Resume is by explicit id or not at all.
 */
function codexResumeArgs(spec: PtyLaunchSpec): readonly string[] {
  const resume = spec.resume
  if (!resume) return []
  if (resume.agentSessionId.length === 0) return []
  // codex is a DISCOVERED adapter; an 'assigned' modifier is unreachable and
  // degrades to a normal fresh launch rather than throwing.
  if (resume.strategy !== 'discovered') return []
  return ['resume', resume.agentSessionId]
}

interface SessionMeta {
  readonly sessionId: string
  readonly cwd: string
  readonly startedAt: number
  /** The header's own `originator`. Carries this launch's Chorus stamp when the
   *  override is honoured, and the vendor's own value (`codex-tui`) otherwise —
   *  which is exactly how `discoverSessionId` tells the two regimes apart. */
  readonly originator: string | null
}

/**
 * The env var that stamps the rollout header's `originator` field, and the
 * prefix that marks a stamp as Chorus's.
 *
 * ⚠ MEASURED, NOT DOCUMENTED, AND THAT IS A NAMED RISK RATHER THAN AN OVERSIGHT
 * (D4). It appears in no `codex --help` output. It was found by testing the two
 * plausible mechanisms directly against codex-cli 0.147.0: `-c originator="…"`
 * is IGNORED (header still read `codex-tui`), and `CODEX_ORIGINATOR` is IGNORED,
 * while `CODEX_INTERNAL_ORIGINATOR_OVERRIDE` IS honoured — the header came back
 * carrying the exact stamp. **The session was verified to still work under the
 * override**: the model answered normally, with no error text, which is the half
 * that mattered before adopting it.
 *
 * ⚠ WHY TAKE AN UNDOCUMENTED SURFACE AT ALL. Without a stamp, ownership can only
 * be inferred from cwd + launch time, and that CANNOT separate two panes started
 * in the same directory within the skew window — which is the normal case here,
 * because `RESTORE_STAGGER_MS` relaunches panes 500 ms apart. Both panes' windows
 * would contain the one rollout, both would claim it, and both would resume the
 * same conversation. The stamp turns that from a guess into an identity.
 *
 * ⚠ AND IT DEGRADES RATHER THAN BREAKS. If a future codex drops the variable,
 * headers simply read `codex-tui` again and `discoverSessionId` falls back to the
 * cwd + window rule — the behaviour that would otherwise have shipped anyway.
 * `originator` is a CLIENT IDENTIFIER sent to the provider; overriding it is a
 * deliberate, user-approved trade recorded here so it is never mistaken for an
 * accident.
 */
const ORIGINATOR_ENV_VAR = 'CODEX_INTERNAL_ORIGINATOR_OVERRIDE'
const CHORUS_ORIGINATOR_PREFIX = 'chorus-'

/** This launch's marker. Derived from the Chorus session id at BOTH ends —
 *  `buildLaunch` and `discoverSessionId` — so nothing has to be remembered
 *  between them. Not a secret: it is a row id Chorus already owns. */
function originatorStamp(sessionId: string): string {
  return `${CHORUS_ORIGINATOR_PREFIX}${sessionId}`
}

/**
 * How far AFTER the launch instant a rollout header's own timestamp may sit and
 * still be this launch. See `withinLaunchWindow` for why both edges matter and
 * for the three measurements that size it.
 */
const DISCOVERY_FORWARD_SKEW_MS = 10_000

/**
 * Re-scan cadence — the safety net for a watch event that never arrives, and the
 * retry that establishes the watch in the first place when the sessions tree
 * does not exist yet.
 *
 * Nearly free, twice over: every header already read is cached for the lifetime
 * of the call, and the walk is bounded to the launch day and its neighbours — so
 * a tick with no new files performs a handful of `readdir` calls and reads
 * nothing at all.
 */
const DISCOVERY_RESCAN_MS = 2_000

/** First read of a rollout header. Measured at ~18.6 KB on codex-cli 0.147.0. */
const HEADER_READ_BYTES = 128 * 1024
/** Refuse to page in a conversation looking for a newline that is not coming. */
const HEADER_READ_MAX = 2 * 1024 * 1024

/**
 * Is this rollout's own start instant close enough to the launch to BE that
 * launch?
 *
 * ⚠ TWO-SIDED, AND THE UPPER BOUND IS THE WHOLE POINT (F64). The original rule
 * was `startedAt >= launchedAt`, which has NO upper edge — so a pane waiting for
 * its own rollout would happily claim one written by a codex launched in the
 * same directory an hour later. That is the silent cross-claim D140 ranks as
 * worse than having no pointer at all, and it is what made a long wait unsafe.
 * With both edges, waiting indefinitely is safe: the window is a fixed few
 * seconds around one instant, and a later launch simply falls outside it.
 *
 * ⚠ AND IT ONLY WORKS BECAUSE THE HEADER TIMESTAMP IS THE SESSION'S START, NOT
 * THE FILE'S WRITE TIME. Measured three times on codex-cli 0.147.0 — the file is
 * created when the user submits their FIRST TURN (22.6 s after spawn in one run,
 * 3 m 19 s in another), while its header reads **launch + 413 ms / 428 ms /
 * 520 ms**. So the backdated stamp identifies the launch even though the file
 * appears at an arbitrary later time. `DISCOVERY_FORWARD_SKEW_MS` is ~20× the
 * largest observed skew: wide enough for a cold CLI start, narrow enough that
 * two panes started seconds apart do not share a window.
 */
function withinLaunchWindow(startedAt: number, launchedAt: number): boolean {
  return startedAt >= launchedAt && startedAt <= launchedAt + DISCOVERY_FORWARD_SKEW_MS
}

/**
 * The `YYYY/MM/DD` directories that could hold THIS launch's rollout — never the
 * whole tree.
 *
 * ⚠ THE UNBOUNDED WALK WAS A REAL COST, NOT A TIDINESS POINT (F64): measured at
 * **320 files / 499 MB / 2.5 s cold** on one developer machine, per scan. codex
 * files a rollout under the date its SESSION STARTED, and `withinLaunchWindow`
 * already confines that to a few seconds around `launchedAt` — so at most the
 * launch day and its neighbours can qualify. Both the local and UTC dates are
 * included because which one codex uses is not something this adapter should
 * have to guess, and the extra directory costs one `readdir` that usually
 * returns nothing.
 */
function candidateDayDirs(root: string, launchedAt: number): readonly string[] {
  const out = new Set<string>()
  for (const offset of [-86_400_000, 0, 86_400_000]) {
    const d = new Date(launchedAt + offset)
    const local = [
      String(d.getFullYear()),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0')
    ]
    const utc = [
      String(d.getUTCFullYear()),
      String(d.getUTCMonth() + 1).padStart(2, '0'),
      String(d.getUTCDate()).padStart(2, '0')
    ]
    out.add(path.join(root, ...local))
    out.add(path.join(root, ...utc))
  }
  return [...out]
}

/** Rollout files directly inside ONE day directory. A missing directory is an
 *  empty list — most of the candidates above will not exist. */
function rolloutFilesIn(dir: string): readonly string[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: string[] = []
  for (const entry of entries) {
    if (entry.isFile() && entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl')) {
      out.push(path.join(dir, entry.name))
    }
  }
  return out
}

/**
 * The FIRST LINE only. A rollout's `session_meta` record is its header, and
 * reading further would mean parsing conversation content to answer a question
 * about identity.
 *
 * ⚠ A BOUNDED PREFIX READ, NOT `readFileSync` (F64). Headers were measured at
 * ~18.6 KB on 0.147.0 — but the FILES they head grow to tens of megabytes (53 MB
 * on the machine where this was found), and reading a whole transcript to take
 * its first 18 KB is what made the old scan cost half a gigabyte. Reads one
 * chunk, grows only if no newline has appeared yet, and gives up at
 * `HEADER_READ_MAX` rather than paging in a conversation.
 */
function readSessionMeta(file: string): SessionMeta | null {
  let firstLine: string
  try {
    const fd = fs.openSync(file, 'r')
    try {
      let size = HEADER_READ_BYTES
      for (;;) {
        const buf = Buffer.alloc(size)
        const read = fs.readSync(fd, buf, 0, size, 0)
        const nl = buf.indexOf(10, 0)
        if (nl !== -1 && nl < read) {
          firstLine = buf.toString('utf8', 0, nl)
          break
        }
        // ⚠ NO NEWLINE BUT THE WHOLE FILE IS IN HAND: the header IS the file,
        // with no trailing newline yet. The pre-F64 whole-file read handled this
        // implicitly (`nl === -1 ? buf : buf.slice(0, nl)`), and dropping it
        // rejected every single-line rollout — caught by the 4a-2 unit tests,
        // which write exactly that shape.
        if (read < size) {
          firstLine = buf.toString('utf8', 0, read)
          break
        }
        // The header is longer than this read. Grow, then give up rather than
        // paging in a conversation.
        if (size >= HEADER_READ_MAX) return null
        size = Math.min(size * 4, HEADER_READ_MAX)
      }
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return null
  }
  try {
    const rec = JSON.parse(firstLine) as {
      type?: unknown
      payload?: { session_id?: unknown; cwd?: unknown; timestamp?: unknown; originator?: unknown }
    }
    if (rec.type !== 'session_meta') return null
    const p = rec.payload
    if (!p || typeof p.session_id !== 'string' || typeof p.cwd !== 'string') return null
    const startedAt = typeof p.timestamp === 'string' ? Date.parse(p.timestamp) : NaN
    if (Number.isNaN(startedAt)) return null
    return {
      sessionId: p.session_id,
      cwd: p.cwd,
      startedAt,
      originator: typeof p.originator === 'string' ? p.originator : null
    }
  } catch {
    return null
  }
}

/**
 * Task 6-2: codex's MCP descriptor.
 *
 * ⚠ `mode` IS `DescriptorMode` ('static' = "known ahead of time rather than
 * probed", the same value CODEX_EFFORT carries), NOT A SUPPORT FLAG. Support is
 * expressed by the descriptor being non-null AND both `SupportsMcp` methods
 * existing — that is what `supportsMcp()` checks, and inventing a
 * `mode: 'supported'` would be adding a third value to a closed union.
 *
 * ⚠ `mechanism: 'launch-args'` MEANS THERE IS NO `configPath` FIELD TO FILL IN.
 * Before 6-2 the only descriptor shape that fit codex was
 * `{format:'toml', location:'home', configPath:'.codex/config.toml'}` — the
 * type's own vocabulary naming the file D49 forbids writing. It cannot be
 * named here now, which is the type doing the work a comment was doing badly.
 *
 * Evidence (6-1, live-probed against the INSTALLED codex 0.147.0, not inherited
 * from the design plan): `codex mcp list --json -c 'mcp_servers.chorus_probe.…'`
 * returned the probe server in parsed JSON with `env_vars` intact, and
 * `~/.codex/config.toml` was byte-identical afterwards — same size, same mtime,
 * same sha256. Per-invocation `-c mcp_servers.*` MERGES into the existing
 * config rather than replacing it: Chorus's argv ADDS a server, it does not
 * define the set.
 */
const CODEX_MCP: McpDescriptor = {
  mode: 'static',
  mechanism: 'launch-args'
}

/**
 * The status-line items a Chorus-launched codex session shows (v17).
 *
 * ⚠ THIS EXISTS BECAUSE CODEX DOES NOT REPORT CONTEXT BY DEFAULT, which was
 * MEASURED rather than assumed: on codex-cli 0.147.0 a fresh session printed no
 * context anywhere, `/status` showed model / directory / account / weekly limits
 * and no context line at all, and `/statusline` revealed why — `context-remaining`
 * and `context-used` are OPT-IN items, unchecked out of the box. Without this
 * override the progress ring simply never appears for codex, and the failure is
 * silent (an absent ring is indistinguishable from an agent with no source).
 *
 * ⚠ THE FIRST TWO ARE CODEX'S OWN DEFAULTS AND ARE RESTATED ON PURPOSE. `-c`
 * SETS a value, it does not append, so emitting only `context-remaining` would
 * REPLACE the status line rather than extend it — the user would gain a context
 * reading and lose the model and directory they have always had. Listing the
 * defaults first reproduces the stock appearance exactly and adds one item to
 * the end. (Verified against the `/statusline` picker on 0.147.0: `[x]
 * model-with-reasoning`, `[x] current-dir`, everything else unchecked.)
 *
 * ⚠ AND IT OVERRIDES A CUSTOMISED STATUS LINE, WHICH IS THE HONEST COST. A user
 * who has curated their own items in `~/.codex/config.toml` sees THIS list
 * inside Chorus instead. Merging their list would mean READING that file and
 * parsing TOML to compose the override — buying a better default by taking a
 * dependency on the one file D49 exists to keep Chorus away from. The trade was
 * made deliberately (Matthew, this session, asking for the flag); it is
 * per-launch, so their own `codex` outside Chorus is untouched.
 *
 * ⚠ `context-remaining`, NOT `context-used`, AND THE PARSER DEPENDS ON IT.
 * `contextUsageCore.parseCodexContextLeft` matches `N% context left` — the
 * phrasing `context-remaining` renders. Switching this id without switching that
 * regex would leave the ring permanently blank, with nothing in the logs.
 *
 * ⚠ THE KEY IS `tui.status_line`, NOT `status_line`, AND THE BARE FORM FAILS
 * SILENTLY — which is the whole reason this warning exists. A first attempt
 * emitted `-c status_line=[…]`; the token reached argv intact (confirmed on the
 * live child's command line), codex accepted it without a word, and the status
 * line was simply unchanged. There is no error, no warning and no log: an
 * unknown `-c` path is ignored, so the only symptom is a ring that never
 * appears. Verified by reading the CLI's own config struct out of the shipped
 * 0.147.0 binary, where `status_line` sits in the same field group as
 * `alternate_screen` / `status_line_use_colors` / `terminal_title` and beside
 * the already-dotted `tui.keymap.*` paths.
 */
const CODEX_STATUS_LINE: readonly string[] = [
  'model-with-reasoning',
  'current-dir',
  'context-remaining'
]

/**
 * The developer instruction that makes each Codex reply visually begin at the
 * user's turn. This is deliberately ONE physical line: it travels as a TOML
 * basic string in `-c developer_instructions=...`, and raw newlines are illegal
 * inside that form. The instruction still describes the emitted line breaks
 * explicitly, so its argv representation and its output contract stay separate.
 *
 * ⚠ THE ESCAPE BYTE IS OUTPUT, NEVER ARGV. Putting a literal ESC in this value
 * would make the child command line itself terminal-active when inspected or
 * logged. Codex receives the textual instruction `real 0x1B` and emits the byte
 * only in its reply, where xterm is supposed to interpret it.
 *
 * ⚠ THIS OVERRIDES A USER'S `developer_instructions` INSIDE CHORUS. Like the
 * status-line override above, `-c` replaces rather than appends. Preserving a
 * user value would require reading and parsing `~/.codex/config.toml`, crossing
 * D49's bright line. The override is per-launch, so Codex sessions started
 * outside Chorus are untouched. Official config reference and the installed
 * 0.147.0 `debug prompt-input` both verify that this key injects a developer
 * message into the session; the latter was exercised with the exact argv shape
 * used here on 2026-08-13.
 */
export const CODEX_JADE_ECHO_INSTRUCTIONS = [
  'FORMATTING RULE — apply on every single turn, without exception, before anything else in your reply.',
  'Begin every reply by echoing the user\'s current message back as a jade-coloured block, written with raw ANSI escape bytes:',
  'first emit a rule line consisting of ESC[38;2;0;168;107m, then exactly 60 U+2500 box-drawing characters, then ESC[0m;',
  'then emit one line per line of the message, each consisting of ESC[38;2;0;168;107m, then "> ", then that line\'s exact text, then ESC[0m;',
  'then emit a second rule line identical to the first.',
  'After the closing rule, emit a blank line and then the normal reply.',
  'Emit the real 0x1B control byte; never emit the literal text \\033, \\x1b, caret followed by left bracket, or [38;2;0;168;107m without ESC.',
  'Re-emit the colour escape at the START of every line because the terminal resets colour at each newline.',
  'Use no code fence, blockquote, or Markdown wrapper around the jade block; emit raw text only.',
  'If the message is longer than 8 lines, echo only its first 8 lines and then one final jade line containing "> ...".',
  'Do this even when the normal reply is a single word, a question, an error, or an approval request.'
].join(' ')

/**
 * The tokens EVERY codex launch carries, whatever the spec.
 *
 * ⚠ THIS IS THE ONE DELIBERATE EXCEPTION TO THE NEUTRALITY RULE (spec §4.1:
 * "buildLaunch reproduces resolveCli EXACTLY"), and it is exported so the rule
 * can keep being tested rather than being loosened to accommodate it.
 * `adapters.test.ts` asserts `resolveCli(id).args` PLUS this exact array, so any
 * unreviewed token appearing here still fails the pin — which is what the rule
 * is for. Every
 * other adapter's baseline stays empty and its assertion is unchanged.
 *
 * ⚠ THE `developer_instructions` PAIR THAT USED TO LIVE HERE MOVED TO
 * `instructionsArgs` (Task 6a-1, D148) — IT WAS NOT DROPPED, AND A READER WHO
 * NOTICES IT MISSING NEEDS TO KNOW WHICH. Task 6a-1 composes the jade rule and
 * the memory usage contract into ONE value, because `-c` replaces rather than
 * appends and a second token would have silently destroyed one of the two.
 * `buildLaunch` still emits the pair unconditionally and in this exact
 * position, so a launch with no memory configured is byte-identical to before.
 */
export const CODEX_BASELINE_ARGS: readonly string[] = [
  '-c',
  `tui.status_line=${tomlStringArray(CODEX_STATUS_LINE)}`
]

/**
 * The codex effort mapping. ONE HOME, built through the SAME `tomlBasicString`
 * quoter `buildLaunch` already uses for its route overrides — there is no
 * second quoter in this file and there must not be — Task 6-2 MOVED it to
 * `mcpConfigCore.ts` so `mcpLaunchArgs` could share the one quoter rather than
 * grow a copy, and pinned its escaping behaviour with tests that did not exist
 * when the rule was first written.
 *
 * ⚠ D4 — this is the fact the task doc called the weakest in the authoring set,
 * and it was re-established this session (2026-07-25) by MAKING THE INSTALLED
 * BINARY ACCEPT AND REJECT IT, not by reading strings out of the executable:
 *
 *   `codex --help`                                  -> NO `--effort` flag exists on
 *                                                      0.145.0; only -c/--config and
 *                                                      -m/--model. The knob must be
 *                                                      a config key.
 *   `codex --strict-config -c chorus_not_a_real_key="x"`
 *        -> "Error loading config.toml: unknown configuration field
 *            `chorus_not_a_real_key` in -c/--config override"
 *   `codex --strict-config -c model_reasoning_effort="high"`
 *        -> passes config load (fails later, only because the harness has no
 *           tty). It SURVIVES the exact check that kills the invented key.
 *   `codex --strict-config -c model_reasoning_effort=123`
 *        -> "Error loading config.toml: invalid type: integer `123`, expected
 *            a string in `model_reasoning_effort`"
 *
 * The last one is the strongest single piece of evidence: codex NAMES the
 * field and states its type. A non-existent field cannot produce that.
 *
 * ⚠ AND THE MEASURED LIMIT OF THAT EVIDENCE. The field is typed String, not a
 * closed enum — `-c model_reasoning_effort="banana"` also loads cleanly, while
 * the control `-c sandbox_mode="banana"` is rejected with "unknown variant …
 * expected one of read-only, workspace-write, danger-full-access". So codex
 * does police enum config fields, and deliberately does not police this one.
 * Consequences: no launch can FAIL AT CONFIG LOAD because of the effort value,
 * and what codex does at REQUEST time with a level the selected model does not
 * support (`codex debug models` shows the ladder is per-model) is NOT
 * established — observing it costs a real completion. `mode: 'static'` and the
 * `'dynamic'` seam stay exactly where they were.
 */
const CODEX_EFFORT: EffortDescriptor = {
  mode: 'static',
  levels: [
    { id: 'fast', label: 'Fast', args: ['-c', `model_reasoning_effort=${tomlBasicString('low')}`] },
    { id: 'balanced', label: 'Balanced', args: ['-c', `model_reasoning_effort=${tomlBasicString('medium')}`] },
    { id: 'deep', label: 'Deep', args: ['-c', `model_reasoning_effort=${tomlBasicString('high')}`] },
    { id: 'max', label: 'Max', args: ['-c', `model_reasoning_effort=${tomlBasicString('max')}`] }
  ]
}

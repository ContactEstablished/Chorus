import fs from 'node:fs'
import path from 'node:path'
import {
  assertNoSecretInRendered,
  guardRendered,
  mergeMcpConfig,
  type GuardedRender
} from './mcpConfigCore'
import {
  supportsMcp,
  type BaseAgentAdapter,
  type McpFileDescriptor,
  type McpServerRef,
  type McpWriteContext,
  type McpWriteResult
} from './types'

/**
 * Task 6-5 (Phase 6 Stage 4) — THE ONE PLACE CHORUS WRITES A FILE INTO ANOTHER
 * TOOL'S CONFIGURATION.
 *
 * ⚠ THIS IS THE FIRST MODULE IN THIS REPO'S HISTORY THAT DOES THAT. Everything
 * before it either passed argv or wrote inside Chorus's own userData directory.
 * D49 and the AUTH-PRECEDENCE FINDING exist because the obvious way to do this
 * is the forbidden way, so the boundaries are stated here rather than trusted:
 *
 *  · The only files this module writes are the ones a `McpFileDescriptor`
 *    names — claude's PROJECT-scoped `.mcp.json` and a Chorus-owned file under
 *    `chorusConfigDir`. **Never `~/.codex/config.toml`, never
 *    `~/.claude/settings.json`, never a `--settings` file, never an
 *    `apiKeyHelper` script** (D49, verbatim).
 *  · It writes CONFIGURATION and never an APPROVAL OR TRUST RECORD. claude
 *    reports a Chorus-written server as `⏸ Pending approval` until a human
 *    approves it interactively, and pre-approving would forge that consent and
 *    couple Chorus to undocumented internals. The council was unanimous. A
 *    human approves it, or the server stays unconnected — which is the correct
 *    outcome, not a gap to close.
 *
 * ⚠ IT IS A SEPARATE MODULE FROM `mcpConfigCore.ts` BECAUSE THAT ONE IS PURE
 * AND MUST STAY PURE — *"logic that is not in a pure core is logic that cannot
 * be tested"* (plan §9), and the rendering, merging and guarding are exactly
 * the logic worth testing. What is left here is `fs` and nothing else: read,
 * mkdir, write-temp, rename. The split is also what lets the guard be
 * structural — see `writeGuardedConfig`.
 */

/** The suffix of the temp file, kept BESIDE the target. Named once. */
const TEMP_SUFFIX = '.chorus-tmp'

/**
 * ⚠ THE ONLY FUNCTION IN CHORUS THAT WRITES ONE OF THESE FILES, AND IT CANNOT
 * BE CALLED WITHOUT THE GUARD HAVING RUN. It takes a `GuardedRender`, which
 * only `guardRendered` can mint, so a caller that skipped the guard does not
 * fail a review — it fails to compile.
 *
 * ⚠ ATOMIC: TEMP + RENAME, WITH THE TEMP FILE BESIDE THE TARGET. `fs.rename` is
 * atomic only within a volume, so a temp file in `%TEMP%` would be a copy — and
 * a copy is exactly the half-written window this exists to close. A CLI reading
 * a half-written config gets a parse error at best; at worst it caches a
 * truncated one.
 *
 * ⚠ AND IT REFUSES RATHER THAN THROWS. Every failure mode here (unwritable
 * directory, locked file, read-only volume) is an ordinary condition on a user's
 * machine, and a launch must survive one — `SupportsMcp.writeMcpConfig`'s
 * contract is a structured refusal, not an exception.
 */
export function writeGuardedConfig(
  targetPath: string,
  guarded: GuardedRender,
  serversWritten: number
): McpWriteResult {
  const tempPath = `${targetPath}${TEMP_SUFFIX}`
  try {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    fs.writeFileSync(tempPath, guarded.bytes, 'utf8')
    // Overwrites the target if it exists — the POSIX rename semantics Node
    // keeps on Windows for a same-volume rename onto an existing file.
    fs.renameSync(tempPath, targetPath)
  } catch (err) {
    // Best-effort cleanup: a stranded temp file beside a user's config is
    // debris they would reasonably ask about. Failure to remove it is not worth
    // a second error — the write already failed and that is what gets reported.
    try {
      fs.rmSync(tempPath, { force: true })
    } catch {
      /* the reported failure is the write's, not the cleanup's */
    }
    return {
      ok: false,
      reason: `Could not write ${targetPath}: ${err instanceof Error ? err.message : String(err)}`
    }
  }
  return { ok: true, path: targetPath, serversWritten }
}

/**
 * The whole pipeline for ONE file adapter: read what is there → merge → guard →
 * refuse or write. Both file adapters delegate to this, which is what keeps the
 * ORDER in one place instead of in each of them.
 *
 * ⚠ ZERO SERVERS IS A REFUSAL, NOT AN EMPTY WRITE. Rendering `{}` over
 * `.mcp.json` would truncate a config the user authored — the caller is asking
 * for something that cannot be done safely, and it deserves a reason.
 */
export function writeMcpConfigFile(
  descriptor: McpFileDescriptor,
  targetPath: string,
  ctx: McpWriteContext
): McpWriteResult {
  if (ctx.servers.length === 0) {
    return {
      ok: false,
      reason: 'No MCP servers to write, and writing an empty config would discard whatever is there.'
    }
  }

  // `null` when the file is absent — the ordinary first run. A read that fails
  // for any OTHER reason (a directory in its place, a permissions error) is
  // reported rather than treated as absent: overwriting something we could not
  // read is precisely the clobber this refuses to do.
  let existing: string | null = null
  try {
    existing = fs.readFileSync(targetPath, 'utf8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      return {
        ok: false,
        reason: `Could not read the existing ${targetPath}: ${err instanceof Error ? err.message : String(err)}`
      }
    }
  }

  const merged = mergeMcpConfig(descriptor, ctx.servers, existing, targetPath)
  if (!merged.ok) return { ok: false, reason: merged.reason }

  // ⚠ THE GUARD RUNS OVER THE FINAL BYTES — after the merge, not before it. A
  // user's own server entry could itself carry a credential, and those bytes
  // are about to be written back out by Chorus. Guarding the fresh render alone
  // would check only the half we authored.
  const guard = guardRendered(merged.rendered, ctx.knownSecrets)
  if (!guard.ok) return { ok: false, reason: guard.reason }

  return writeGuardedConfig(targetPath, guard.guarded, ctx.servers.length)
}

/** What a launch needs to know once the config has been written. */
export interface McpLaunchWiring {
  /** NON-SECRET additions for the child environment — in practice the single
   *  `pathEnvVar` entry an `env-named-file` adapter needs to find its file.
   *  ⚠ A PATH, WHICH IS WHY `envAdditions` IS THE RIGHT CHANNEL. A password
   *  through this channel would destroy the invariant D89 repaired (D33
   *  clause 5); nothing secret ever travels here. */
  readonly envAdditions: Readonly<Record<string, string>>
  /** The write's outcome, or null when there was nothing to do (no memory
   *  configured, or an adapter with no MCP support). Carried so the caller can
   *  log an honest line instead of inferring success from silence. */
  readonly result: McpWriteResult | null
  /** F75/D150: for a `launch-args` adapter, the refs to hand to `buildLaunch`
   *  via `PtyLaunchSpec.mcpServers` — ALREADY CONVERTED, so only NAMES can
   *  reach argv and every value is in `envAdditions` above. EMPTY for every
   *  other mechanism, and empty on a guard refusal. */
  readonly launchServers: readonly McpServerRef[]
}

const NOTHING_TO_DO: McpLaunchWiring = { envAdditions: {}, result: null, launchServers: [] }

/**
 * Write this project's MCP config for ONE adapter, and report what the launch
 * must add to the child environment.
 *
 * ⚠ EVERY DECISION HERE READS THE DESCRIPTOR — there is no `id === 'opencode'`
 * anywhere in it. Which mechanism, which file, which env var: all three come
 * off the adapter's own declaration, so the fifth adapter is wired by declaring
 * a descriptor rather than by editing this function.
 *
 * ⚠ AND IT NEVER THROWS. A launch must not fail because a config file could not
 * be written — the agent still starts, simply without the memory server, and
 * the refusal is the caller's to log.
 */
export async function wireMcpForLaunch(
  adapter: BaseAgentAdapter | null,
  ctx: McpWriteContext
): Promise<McpLaunchWiring> {
  if (!adapter || ctx.servers.length === 0) return NOTHING_TO_DO
  if (!supportsMcp(adapter)) return NOTHING_TO_DO

  const descriptor = adapter.getCapabilities().mcp
  // ⚠ THE NULL CASE IS SPLIT OUT FIRST, ON PURPOSE. It used to share a line
  // with the `launch-args` test; the branch below dereferences the adapter, and
  // folding the two conditions back together is the easiest way to reintroduce
  // a null dereference here.
  if (!descriptor) return NOTHING_TO_DO

  // `launch-args` adapters (codex) write NO FILE by design: the servers travel
  // as argv on every launch, composed by `buildLaunch` from
  // `PtyLaunchSpec.mcpServers` — which this branch supplies through
  // `launchServers`. Calling `writeMcpConfig` on one returns its permanent
  // refusal, and treating that refusal as a failure would log an error for the
  // one adapter behaving exactly as designed.
  //
  // ⚠ THIS COMMENT WAS ONCE FALSE, AND THE FALSEHOOD COST A MILESTONE CRITERION
  // (F75). It described `buildLaunch` as composing argv it did not compose, and
  // the sentence read so much like a description of shipped code that the
  // missing half survived review. If the wiring below is ever removed, REMOVE
  // THIS SENTENCE WITH IT rather than leaving it to describe an intention.
  if (descriptor.mechanism === 'launch-args') {
    // ⚠ `env` IS DROPPED, NOT FORWARDED. It is the FILE mechanisms' placeholder
    // channel (`${VAR}` / `{env:VAR}`); codex interpolates nothing, so
    // forwarding it would put literal placeholder text into argv. Its KEYS
    // become `envPassthrough` — names, which is all codex's `env_vars` carries
    // — and its VALUES leave through `envAdditions` (D150).
    const launchServers = ctx.servers.map((s) => ({
      name: s.name,
      command: s.command,
      args: s.args,
      envPassthrough: Object.keys(s.env ?? {})
    }))
    const envAdditions: Record<string, string> = Object.assign(
      {},
      ...ctx.servers.map((s) => s.env ?? {})
    )

    // ⚠ THE GUARD RUNS ON THIS PATH TOO. A file mechanism guards its BYTES; the
    // argv mechanism has no bytes, so it guards the two surfaces that actually
    // leave this function — the rendered argv and the env VALUES. Joined with a
    // NUL so a secret cannot be manufactured across a boundary that does not
    // exist in either surface.
    const rendered = [
      ...adapter.mcpLaunchArgs(launchServers),
      ...Object.values(envAdditions)
    ].join('\u0000')
    const refusal = assertNoSecretInRendered(rendered, ctx.knownSecrets)
    // A hit costs the MEMORY SERVER and never the launch — this function's own
    // contract, stated above and unchanged by this branch.
    if (refusal) return { ...NOTHING_TO_DO, result: { ok: false, reason: refusal } }

    return { envAdditions, launchServers, result: null }
  }

  const result = await adapter.writeMcpConfig(ctx)
  // ⚠ `launchServers: []` ON EVERY FILE-MECHANISM PATH, AND THE FIELD IS
  // REQUIRED RATHER THAN OPTIONAL SO THE COMPILER SAYS SO. A file mechanism's
  // servers travel in the file that was just written; handing the same servers
  // to `buildLaunch` as well would configure them TWICE by two mechanisms.
  if (!result.ok) return { envAdditions: {}, result, launchServers: [] }

  // The env var that NAMES the file, for the mechanism whose whole point is
  // that the CLI has no other way to find a Chorus-owned config.
  const pathEnvVar = descriptor.mechanism === 'env-named-file' ? descriptor.pathEnvVar : undefined
  return {
    envAdditions: pathEnvVar ? { [pathEnvVar]: result.path } : {},
    result,
    launchServers: []
  }
}

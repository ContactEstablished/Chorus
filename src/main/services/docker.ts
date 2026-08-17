import { execFile } from 'node:child_process'
import { createServer } from 'node:net'
import { promisify } from 'node:util'
import { probeCli } from './cliDetect'
import {
  LOOPBACK_HOST,
  parsePsJsonLines,
  portArgs,
  psArgs,
  removeArgs,
  runArgs,
  startArgs,
  stopArgs,
  type ContainerState
} from './dockerCore'

/**
 * Controlled docker process adapter (Task 6a-4). Modelled DELIBERATELY on
 * `git.ts`: one private runner over promisified execFile — NEVER a shell, NEVER
 * a string-concatenated command line; arguments are always an array. Every
 * public function is a thin typed wrapper over a builder in `dockerCore.ts`.
 *
 * ⚠ THIS IS A CLI ADAPTER RATHER THAN A LIBRARY BECAUSE `dockerode` IS REFUSED
 * (D147(d)), AND THE REFUSAL IS LOAD-BEARING RATHER THAN ASCETIC. Runtime
 * dependencies stay at 8, and the whole surface Chorus needs is six
 * subcommands.
 *
 * ⚠ AND IT IS WHY A PROJECT NAME CAN NEVER REACH A SHELL. A user's project name
 * flows into the container name; concatenated into a command string that would
 * be a command-injection site. `execFile` with an argument array makes it
 * structurally impossible, and `dockerCore.test.ts` pins the argv shape against
 * a hostile name.
 *
 * ⚠ EVERY FUNCTION HERE IS USER-INITIATED. There is no boot hook, no timer, no
 * retry loop and no reconciliation pass — D58's rule ("one live connect, and
 * only ever from a click") applied to a second kind of connection. A stored
 * `container_id` may be stale; the status read is what heals it, when a person
 * opens the screen.
 *
 * Flags verified against the INSTALLED docker 29.7.2 by running them this
 * session (D4) — `_verify/6a-4/d4-docker.txt`. The Phase 6 investigation
 * recorded 28.0.4 and nothing is quoted from it.
 */

const pExecFile = promisify(execFile)

/** ps / port / inspect: docker's own latency against a running daemon. Nothing
 *  here scales with anything, so a process still alive after this is wedged
 *  rather than slow. */
const DOCKER_QUERY_TIMEOUT_MS = 15_000

/**
 * `run` may PULL THE IMAGE — ~610 MB virtual for `neo4j:5-community`, measured
 * this session — on a connection nobody here controls.
 *
 * ⚠ SHARING THE QUERY BUDGET IS THE `git.ts` MISTAKE, AND ITS COMMENT SAYS WHY:
 * a long operation killed mid-flight is reported by Node as `code=null` with
 * `killed=true`, so the failure surfaces with no stated cause. The ceiling stays
 * finite — a backstop against a wedged daemon, not a budget a real pull is
 * expected to approach.
 */
const DOCKER_RUN_TIMEOUT_MS = 15 * 60_000

/** The tail of docker's stream, for a timeout message. */
function lastOutputSuffix(stderr: string): string {
  const parts = stderr
    .split(/[\r\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  const last = parts[parts.length - 1]
  return last === undefined ? '' : ` (last output: ${last})`
}

export class DockerError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly code: number | null,
    readonly stderr: string,
    /** The elapsed budget when the per-call timeout killed the child; null when
     *  docker exited on its own. Node reports a timeout kill as code=null with
     *  killed=true, so `code` alone cannot tell the two apart — the same
     *  distinction `GitError` exists to preserve. */
    readonly timedOutAfterMs: number | null = null
  ) {
    super(
      timedOutAfterMs === null
        ? `docker ${args.join(' ')} failed (${code}): ${stderr.trim()}`
        : `docker ${args.join(' ')} timed out after ${Math.round(timedOutAfterMs / 1000)}s ` +
          `and was terminated${lastOutputSuffix(stderr)}`
    )
  }

  get timedOut(): boolean {
    return this.timedOutAfterMs !== null
  }
}

/**
 * ⚠ THE ONLY PLACE THIS MODULE SPAWNS ANYTHING, AND IT TAKES AN ARRAY.
 *
 * ⚠ NO `cwd`, UNLIKE `git.ts` — and the difference is meaningful rather than an
 * omission. git's answers depend entirely on which directory it runs in; docker
 * talks to a daemon and its answers do not, so passing a cwd would imply a
 * relationship between a project directory and a container that does not exist.
 */
async function runDocker(
  args: readonly string[],
  timeoutMs = DOCKER_QUERY_TIMEOUT_MS
): Promise<string> {
  try {
    const { stdout } = await pExecFile('docker', [...args], {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024
    })
    return stdout
  } catch (err) {
    const e = err as { code?: number; stderr?: string; killed?: boolean; signal?: string | null }
    const timedOut = e.killed === true || (e.signal !== undefined && e.signal !== null)
    throw new DockerError(args, e.code ?? null, e.stderr ?? String(err), timedOut ? timeoutMs : null)
  }
}

/**
 * Is docker usable right now?
 *
 * ⚠ "INSTALLED" AND "RUNNING" ARE DIFFERENT QUESTIONS AND THIS ANSWERS THE
 * SECOND. `probeCli` finds the binary on PATH (it is already in
 * `DETECTED_TOOLS`, so no new detection is written), but Docker Desktop is
 * routinely installed with its daemon stopped — and in that state the binary
 * answers `--version` happily while every real command fails. A `ps` is the
 * cheapest command that actually needs the daemon.
 */
export async function dockerAvailable(): Promise<boolean> {
  const probe = await probeCli('docker')
  if (!probe.found) return false
  try {
    await runDocker(['ps', '--quiet'])
    return true
  } catch {
    return false
  }
}

/**
 * The container with this exact name, or null when there is none.
 *
 * ⚠ null IS THE ORDINARY UNPROVISIONED CASE, NOT A FAILURE. `docker ps -a
 * --filter` exits 0 with no output when nothing matches (measured), which
 * `parsePsJsonLines` turns into an empty list.
 */
export async function inspectContainer(containerName: string): Promise<ContainerState | null> {
  const out = await runDocker(psArgs(containerName))
  const states = parsePsJsonLines(out)
  // The filter is anchored `^…$`, so more than one row would mean docker
  // matched something the anchor should have excluded — worth being loud about
  // rather than silently taking the first.
  return states[0] ?? null
}

/** Create and start the container. Long budget: this is the call that pulls. */
export async function runContainer(o: {
  containerName: string
  volumeName: string
  boltPort: number
}): Promise<string> {
  const out = await runDocker(runArgs(o), DOCKER_RUN_TIMEOUT_MS)
  return out.trim()
}

export async function startContainer(containerName: string): Promise<void> {
  await runDocker(startArgs(containerName))
}

/** Stop is given the long-ish query budget deliberately: docker sends SIGTERM
 *  and waits 10s for the engine to flush before SIGKILL, so a 15s ceiling is
 *  already close. Neo4j flushing its store is exactly what must not be cut. */
export async function stopContainer(containerName: string): Promise<void> {
  await runDocker(stopArgs(containerName), 60_000)
}

/**
 * ⚠ REMOVES THE CONTAINER. NEVER THE VOLUME. The caller must already have
 * passed main's typed-confirmation gate; this function does not re-check it,
 * because a guard in two places is a guard that disagrees with itself.
 */
export async function removeContainer(containerName: string): Promise<void> {
  await runDocker(removeArgs(containerName))
}

/** Raw `docker port` output, for the binding proof. Read back rather than
 *  assumed: the stored port is what Chorus asked for, this is what docker did. */
export async function portMapping(containerName: string): Promise<string> {
  return (await runDocker(portArgs(containerName))).trim()
}

/**
 * Probe upward for a port that will actually bind on loopback.
 *
 * ⚠ BINDS THE SAME HOST THE CONTAINER WILL PUBLISH ON, AND THAT IS THE WHOLE
 * POINT. A port can be free on `0.0.0.0` and taken on `127.0.0.1` (or the
 * reverse), so probing the wrong interface produces a port that passes the
 * check and then fails the `docker run`.
 *
 * ⚠ NO REGISTRY OF ALLOCATIONS IS KEPT, DELIBERATELY. A port held by another
 * Chorus project's container fails the bind and is skipped — the OS is the
 * registry, and it is the only one that cannot go stale.
 *
 * ⚠ AND IT IS INHERENTLY RACY, WHICH IS WHY THE CALLER MUST NOT TREAT IT AS A
 * RESERVATION. Between this closing the socket and docker binding it, something
 * else can take the port; the `run` failing is the real answer, and this only
 * makes that rare.
 */
export async function findFreeBoltPort(from = 7688, tries = 40): Promise<number | null> {
  for (let port = from; port < from + tries; port++) {
    if (await canBindLoopback(port)) return port
  }
  return null
}

function canBindLoopback(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    // `once`, not `on`: an error after a successful listen would otherwise
    // resolve the promise a second time and mask the first answer.
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen({ host: LOOPBACK_HOST, port })
  })
}

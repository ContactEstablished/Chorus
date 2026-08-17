/**
 * Pure core for the memory provisioner (Task 6a-4). Naming, argv, parsing and
 * the authored refusal sentences — no `child_process`, no `electron`, no clock.
 * `docker.ts` is the process half; everything worth testing lives here.
 *
 * ⚠ EVERY FACT BELOW WAS MEASURED AGAINST THE INSTALLED docker 29.7.2 THIS
 * SESSION, NOT READ OUT OF DOCKER'S DOCUMENTATION (D4). Evidence:
 * `_verify/6a-4/d4-docker.txt`. The Phase 6 investigation recorded 28.0.4 and a
 * whole major has moved since, so nothing is quoted from it.
 */

/** The image Phase 6 measured — resolving to Kernel 5.26.29, no APOC, idle
 *  ~496 MiB. The tag floats within 5.x, which is why the provision report
 *  records the version the database actually answers with over bolt rather
 *  than restating this string. */
export const NEO4J_IMAGE = 'neo4j:5-community'

/**
 * ⚠ THE SECURITY CONTENT OF THIS TASK, AS A CONSTANT RATHER THAN AS A HABIT.
 *
 * Every Phase 6 drive used `-p 7688:7687`, which binds `0.0.0.0` — an
 * auth-disabled Neo4j published to the whole local network. That was acceptable
 * for a by-hand probe on a dev box and is not acceptable for something Chorus
 * starts on a user's machine.
 *
 * D93's no-credential argument is *"local Docker runs `NEO4J_AUTH=none` ON
 * `127.0.0.1`, so no secret exists"*. The loopback half of that sentence was the
 * operator's habit until now; here it becomes the app's code.
 *
 * ⚠ A REGRESSION IN THIS IS INVISIBLE TO EVERY FUNCTIONAL CHECK — the database
 * works perfectly either way — which is why `dockerCore.test.ts` asserts the
 * literal `127.0.0.1:` inside the emitted `-p` token.
 */
export const LOOPBACK_HOST = '127.0.0.1'

/** Neo4j's bolt port INSIDE the container. The published side is allocated per
 *  project; this side never varies. */
export const CONTAINER_BOLT_PORT = 7687

/** Where the neo4j image keeps its store. The named volume mounts here, and it
 *  is what survives `docker rm` (observed, `_verify/6a-4/d4-docker.txt`). */
const CONTAINER_DATA_PATH = '/data'

/** How much of a user's project name survives into the container name. Long
 *  enough to be recognisable in `docker ps`, short enough that the id suffix is
 *  still visible on a narrow terminal. */
const SLUG_MAX = 24

/* ────────────────────────────── naming ────────────────────────────────── */

/**
 * ⚠ PURE AND STABLE: the same project MUST always resolve to the same container
 * name, or a second provision creates a second container beside the first
 * instead of adopting the one already there. That failure is near-invisible —
 * everything works, twice — so stability is a test, not an intention.
 *
 * The id suffix is what keeps two projects both called "api" apart; the
 * sanitised name is what makes `docker ps` readable to a human. D92 fixes the
 * `chorus-` prefix (the plan's `agentdesk-neo4j-<slug>` is stale).
 *
 * ⚠ AND THE PREFIX IS WHAT MAKES THE RESULT LEGAL. Docker requires
 * `[a-zA-Z0-9][a-zA-Z0-9_.-]*`, so a project named "2024 Rewrite" or "🎉" would
 * otherwise produce a name docker rejects. Because every result starts with
 * `chorus-`, the first character is always legal no matter what the user typed.
 */
export function containerNameFor(projectId: string, projectName: string): string {
  const slug = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    // The slice can land mid-run and leave a trailing separator.
    .replace(/-+$/, '')
  const id8 = projectId.replace(/-/g, '').slice(0, 8).toLowerCase()
  // A name that sanitises to nothing (unicode-only, punctuation-only) drops the
  // slug segment rather than emitting `chorus--<id8>` with an empty middle.
  return slug ? `chorus-${slug}-${id8}` : `chorus-${id8}`
}

/** The data volume for a container. Derived from the container name so the pair
 *  is always consistent and a re-provision re-attaches the same store. */
export function volumeNameFor(containerName: string): string {
  return `${containerName}-data`
}

/* ─────────────────────────────── argv ─────────────────────────────────── */

/**
 * ⚠ THERE IS NO AUTO-DELETE FLAG, NO VOLUME FLAG ON REMOVE, AND NO
 * VOLUME-REMOVAL BUILDER AT ALL. THE ABSENCE IS THE FEATURE.
 *
 * F49 gates durability on an export/restore path that does not exist, so there
 * must be no code path in Chorus capable of destroying a graph (D151). The
 * volume outlives the container and a re-provision re-attaches it — observed on
 * the installed docker, not assumed (`_verify/6a-4/d4-docker.txt`).
 *
 * `dockerCore.test.ts` sweeps every builder in `ARGV_BUILDERS` for those flags,
 * and the review checklist repeats it — because this is exactly the kind of
 * flag a later edit adds while being helpful.
 *
 * ⚠ THE DESTRUCTIVE TOKENS ARE DELIBERATELY NOT SPELLED OUT IN THIS FILE, so
 * that a grep for them over the implementation is expected to return NOTHING
 * and any hit is a real finding rather than a comment quoting itself.
 */
export function runArgs(o: {
  containerName: string
  volumeName: string
  boltPort: number
  image?: string
}): readonly string[] {
  return [
    'run',
    '-d',
    '--name',
    o.containerName,
    // The loopback binding, built from the constant rather than interpolated
    // from a host that a later edit could default to ''.
    '-p',
    `${LOOPBACK_HOST}:${o.boltPort}:${CONTAINER_BOLT_PORT}`,
    // D128(a): local docker is credential-free BECAUSE it is loopback-only.
    // These two tokens are one decision and must not drift apart.
    '-e',
    'NEO4J_AUTH=none',
    '-v',
    `${o.volumeName}:${CONTAINER_DATA_PATH}`,
    o.image ?? NEO4J_IMAGE
  ]
}

/**
 * ⚠ ANCHORED WITH `^…$`. `--filter name=chorus-api` is a SUBSTRING match, so an
 * unanchored filter reports `chorus-api-2` when asked about `chorus-api` — and
 * the caller would then adopt, stop or remove the wrong container.
 */
export function psArgs(containerName: string): readonly string[] {
  return ['ps', '-a', '--filter', `name=^${containerName}$`, '--format', '{{json .}}']
}

export function startArgs(containerName: string): readonly string[] {
  return ['start', containerName]
}

export function stopArgs(containerName: string): readonly string[] {
  return ['stop', containerName]
}

/** ⚠ THE NAME AND NOTHING ELSE. Removing the container must never remove its
 *  data (F49/D151); the flag that would do so is the one edit in this task
 *  capable of destroying a user's graph silently. */
export function removeArgs(containerName: string): readonly string[] {
  return ['rm', containerName]
}

/** Read back what docker actually published, for the binding proof. */
export function portArgs(containerName: string): readonly string[] {
  return ['port', containerName]
}

/**
 * Every argv builder this module exports, so a test can sweep all of them for
 * destructive flags without having to remember to add each new one by hand.
 * ⚠ A NEW BUILDER THAT IS NOT LISTED HERE IS NOT COVERED BY THE F49 GREP.
 */
export const ARGV_BUILDERS: readonly ((name: string) => readonly string[])[] = [
  (n) => runArgs({ containerName: n, volumeName: volumeNameFor(n), boltPort: 7688 }),
  psArgs,
  startArgs,
  stopArgs,
  removeArgs,
  portArgs
]

/* ────────────────────────────── parsing ───────────────────────────────── */

/**
 * One container, projected from `docker ps --format '{{json .}}'`.
 *
 * ⚠ ONLY THE FIELDS CHORUS USES ARE PROJECTED, AND THAT IS DELIBERATE RATHER
 * THAN LAZY. docker 29.7.2 emits `"Platform":{"architecture":"amd64","os":"linux"}`
 * — an OBJECT, not a string — so a `Record<string, string>` shape over the whole
 * line is wrong on the installed version. Measured, not assumed; the
 * implementation spec's all-strings interface was written before that probe.
 */
export interface ContainerState {
  /** docker's short id, 12 hex. */
  readonly id: string
  readonly name: string
  /** docker's own lowercase `State`: 'running' | 'exited' | 'created' | … */
  readonly state: string
  /** Human sentence, e.g. 'Up 3 seconds' or 'Exited (137) 2 minutes ago'. */
  readonly status: string
  /**
   * e.g. `127.0.0.1:7699->7687/tcp`.
   * ⚠ EMPTY WHEN THE CONTAINER IS STOPPED — measured. A state line that
   * interpolates this unguarded renders "published on " with nothing after it.
   */
  readonly ports: string
}

/** Thrown when docker's output parses as JSON but is not the shape this module
 *  was written against. */
export class DockerShapeError extends Error {}

/**
 * ⚠ EMPTY OUTPUT IS "NO SUCH CONTAINER", NOT AN ERROR. `docker ps -a --filter`
 * exits 0 with no lines when nothing matches (measured), and treating that as a
 * failure would make the ordinary unprovisioned case look broken.
 *
 * ⚠ BUT A SHAPE CHANGE IS LOUD, AND THAT ASYMMETRY IS THE POINT. If a future
 * docker renames `ID` or `Names`, a forgiving parser would return `[]` — which
 * this caller reads as "no container exists", so provision would create a
 * SECOND container beside the running one. Silence there costs the user a
 * duplicate database; a thrown error costs them one legible message.
 */
export function parsePsJsonLines(out: string): readonly ContainerState[] {
  const states: ContainerState[] = []
  for (const line of out.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    let raw: unknown
    try {
      raw = JSON.parse(trimmed)
    } catch {
      // Not JSON at all — a daemon warning on stdout, say. Skipping is right:
      // it is not a container, and it is not a claim about the shape either.
      continue
    }
    if (typeof raw !== 'object' || raw === null) continue
    const rec = raw as Record<string, unknown>
    const id = rec.ID
    const name = rec.Names
    if (typeof id !== 'string' || typeof name !== 'string') {
      throw new DockerShapeError(
        "Chorus could not read docker's container list: the output did not carry the expected ID and Names fields."
      )
    }
    states.push({
      id,
      name,
      state: typeof rec.State === 'string' ? rec.State : '',
      status: typeof rec.Status === 'string' ? rec.Status : '',
      ports: typeof rec.Ports === 'string' ? rec.Ports : ''
    })
  }
  return states
}

/**
 * Docker's SHORT id — the 12-hex form `ps` prints.
 *
 * ⚠ THE TWO SOURCES DISAGREE ON LENGTH AND ONE PLACE HAS TO SETTLE IT. `docker
 * run` answers with the full 64-hex id; `docker ps --format` answers with 12.
 * So a container that was CREATED stored a long id and the same container
 * ADOPTED stored a short one — measured, both in one drive
 * (`_verify/6a-4/drive-provision-output.txt`).
 *
 * Nothing compares these today, which is exactly why it is worth fixing now:
 * the first code that does — a "is this the container we recorded?" check —
 * would be wrong for one of the two paths and right for the other, and would
 * look correct in every test that only exercised one.
 */
export function shortContainerId(id: string): string {
  return id.trim().slice(0, 12)
}

/** True when docker considers the container to be up. Centralised so the UI and
 *  the service agree on one vocabulary rather than each testing a string. */
export function isRunning(state: ContainerState | null): boolean {
  return state?.state === 'running'
}

/**
 * The published loopback endpoint, or null when the container is stopped (its
 * `Ports` is empty) or publishes nothing recognisable.
 *
 * ⚠ RETURNS null RATHER THAN A GUESS. The stored `bolt_port` is what Chorus
 * *asked* for; this is what docker *did*, and the state line shows the second so
 * a hand-edited container cannot quietly disagree with the row.
 */
export function publishedBoltEndpoint(state: ContainerState | null): string | null {
  if (!state) return null
  const match = state.ports.match(
    new RegExp(`(${LOOPBACK_HOST.replace(/\./g, '\\.')}:\\d+)->${CONTAINER_BOLT_PORT}/tcp`)
  )
  return match ? match[1] : null
}

/* ───────────────────────────── refusals ───────────────────────────────── */

/**
 * ⚠ NO REFUSAL QUOTES DOCKER'S RAW stderr WHOLESALE — the rule `mergeMcpConfig`
 * already follows for a file it cannot parse. A tool's message can contain
 * anything, including a path, a mount point or an environment value, and these
 * sentences are rendered in the UI and pasted into bug reports.
 *
 * Exported as constants so the UI, the service and the tests share one wording
 * rather than three that drift.
 */

/** ⚠ SAYS WHAT STILL WORKS. Memory against a hand-started database is what
 *  Phase 6 shipped and it is unaffected by docker's absence — a refusal that
 *  only says "no" would read as "the feature is broken". */
export const DOCKER_NOT_AVAILABLE =
  'Docker is not available on this machine, so Chorus cannot create a database for this project. ' +
  'Memory still works against a Neo4j database you start yourself — point this project at its address instead.'

export function containerNameTaken(containerName: string): string {
  return (
    `A container called "${containerName}" already exists on this machine and Chorus did not create it. ` +
    'Rename or remove that container yourself, then provision again.'
  )
}

export function noFreePort(from: number, tried: number): string {
  return (
    `Chorus could not find a free port on ${LOOPBACK_HOST} after trying ${tried} from ${from} upward. ` +
    'Stop something that is holding those ports, then provision again.'
  )
}

/** ⚠ THE TYPED-CONFIRMATION REFUSAL. Enforced in main, never by a disabled
 *  button — the `project:delete` (D123) and `worktree:remove` (D26 clause 7)
 *  precedent, because a renderer-only guard is walked past by the command
 *  palette, by a second window, and by any future caller. */
export const CONTAINER_NAME_MISMATCH =
  'The container name you typed does not match this project’s container, so nothing was removed.'

/**
 * ⚠ THE "THREE DESTRUCTIONS" COPY LIVES WITH THE UI, NOT HERE, AND THE REASON
 * IS A CONFLICT BETWEEN TWO OF THIS TASK'S OWN REQUIREMENTS.
 *
 * Spec §6 requires the copy at the control to tell the user how to remove the
 * volume BY HAND — which means naming the very command whose absence the
 * acceptance grep checks for in this file. Holding that sentence here would
 * make the F49 grep permanently dirty and train a reviewer to skim past its
 * hits, which is worse than the sentence being one module away.
 *
 * So: the refusals above are shared constants because the service and the tests
 * both assert on them; the destruction copy is rendered where §6 says it
 * belongs — at the control, in `ProjectSettingsView.vue`.
 */

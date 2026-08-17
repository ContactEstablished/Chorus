/**
 * Task 6-3 (Phase 6 Stage 2) — THE MEMORY CONFIGURATION CORE.
 *
 * PURE: no `electron`, no `storage`, no `neo4j-driver`, no `dockerode`. Plan
 * §9's reason rather than a style rule — tests cannot import `storage.ts`
 * (Electron ABI 148 vs Node 127), so *"logic that is not in a pure core is
 * logic that cannot be tested"*. Everything in here is therefore exhaustively
 * tested, which is cheap precisely because it is pure.
 *
 * ⚠ THIS FILE IS THE SWAP SEAM. The roadmap's Phase 6 entry records that if the
 * storage engine is ever revisited (Memgraph was, and was closed on
 * measurement), *"the swap seam is `memoryConfigCore.ts` plus the MCP
 * descriptor, not the architecture."* It is written so that something other
 * than Neo4j could one day arrive behind it: the vocabulary, the URI rules and
 * the container naming are all data or narrow functions, not assumptions spread
 * through a service.
 *
 * ⚠ AND IT IS WHERE THE NO-PASSWORD RULE IS ACTUALLY ENFORCED. `project_memory`
 * has no password-shaped column, but `bolt_uri` is free text and a bolt URI can
 * carry inline credentials (`bolt://user:pass@host`). A schema with no password
 * column and a validator that waves that form through would store a password in
 * a table that claims to have none. `validateBoltUri` refuses it (D93).
 */

/* ─── Vocabulary ─────────────────────────────────────────────────────── */

/**
 * Where a project's graph lives. All three are admitted by the vocabulary and
 * by the IPC schema; only one is admitted by `supportedMode` in this phase.
 *
 * ⚠ THE FULL VOCABULARY STAYS IN THE TYPE AND IN THE ZOD INPUT, AND THE REFUSAL
 * HAPPENS HERE — it is deliberately NOT narrowed to a single value. A Zod parse
 * failure is a stack trace where a sentence belongs, and a one-value enum would
 * have to be widened at Stage 5 anyway. This is the `resolveLaunchProfile`
 * precedent (`launchProfiles.ts:158–168`), whose own comment gives the reason a
 * disabled thing must say why: *"a named entry that silently vanishes is worse
 * than one that says why it cannot launch."*
 */
export const MEMORY_MODES = ['local-docker', 'existing', 'aura'] as const
export type MemoryMode = (typeof MEMORY_MODES)[number]

/**
 * How the connection authenticates. `'credential'` names a `credential_profiles`
 * row; it never carries a value (D93).
 *
 * ⚠ ONLY `'none'` IS REACHABLE IN PHASE 6. D128(a) took credentialed mode out
 * of the phase entirely after CR-6.0 returned `REVISE` on Q3 and attached eight
 * preconditions to it. The vocabulary keeps both for the same reason the mode
 * vocabulary keeps all three.
 */
export const MEMORY_AUTH_MODES = ['none', 'credential'] as const
export type MemoryAuthMode = (typeof MEMORY_AUTH_MODES)[number]

/**
 * The one database Community Edition has. Measured, not assumed: the 6-1 D4
 * pass ran `CREATE DATABASE chorusprobe` against `neo4j:5-community` and got
 * *"Unsupported administration command"*, with `SHOW DATABASES` returning
 * exactly `neo4j` and `system` (ITEM 4). Isolation therefore comes from the
 * CONTAINER boundary, which is what D92 already said and now has evidence for.
 */
export const DEFAULT_DATABASE_NAME = 'neo4j'

/** Bolt's registered port, used when a URI states no port of its own. */
export const DEFAULT_BOLT_PORT = 7687

/**
 * The four URI schemes the driver speaks. `+s` is bolt/neo4j over TLS with a
 * full certificate check; `neo4j://` is the routing form. Anything else — an
 * `http://` pasted from the browser console being the likely mistake — is
 * refused by name rather than silently coerced.
 */
export const BOLT_SCHEMES = ['bolt', 'bolt+s', 'neo4j', 'neo4j+s'] as const
export type BoltScheme = (typeof BOLT_SCHEMES)[number]

/* ─── Results ────────────────────────────────────────────────────────── */

/**
 * The authored-refusal shape used throughout this module — `ProfileResolution`'s
 * (`launchProfiles.ts:158`), deliberately. `reason` is a sentence a user can act
 * on and is rendered verbatim; it is never a boolean, never an error code, and
 * never contains the URI it is refusing (see `SUPPRESSED` below).
 */
export type Refusable<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string }

/**
 * ⚠ NO REFUSAL IN THIS FILE ECHOES THE INPUT URI, AND THAT IS THE WHOLE POINT
 * OF THE INLINE-CREDENTIALS CASE. Quoting the offending string back — the
 * obvious, friendly thing to do — would copy the password out of the field the
 * user just typed it into and onto a surface that gets logged, screenshotted and
 * pasted into bug reports. Refusals here name the PROBLEM, never the VALUE. The
 * same discipline `resolveCredential` keeps for keys, one layer over.
 */

/* ─── Mode support ───────────────────────────────────────────────────── */

/**
 * Is this mode shippable in the current phase, and if not, why not — in a
 * sentence the settings screen renders beside the disabled option.
 *
 * The two unsupported modes are unsupported for DIFFERENT reasons and say so.
 * A single "not supported yet" for both would tell a user nothing about which
 * one is coming and which one is waiting on a decision.
 */
export function supportedMode(mode: MemoryMode): Refusable<MemoryMode> {
  switch (mode) {
    case 'existing':
      return { ok: true, value: mode }
    // ⚠ ADMITTED BY TASK 6a-4, IN EXACTLY THIS ONE PLACE. The provisioner can
    // now start a container, so the refusal that stood here is gone rather than
    // softened.
    //
    // ⚠ AND `row.mode` IS WHAT DRIVES THE UI — never `container_id !== null`.
    // There is one answer to "is this a Chorus-managed database", and it is this
    // value; inferring it from a nullable column would make an adopted or
    // hand-removed container change the app's mind about what the row means.
    case 'local-docker':
      return { ok: true, value: mode }
    case 'aura':
      return {
        ok: false,
        reason:
          'Aura needs a stored username and password, and credentialed memory is not part of this release. Use a local Neo4j with authentication disabled.'
      }
  }
}

/** A total predicate over the vocabulary — `mode` arrives from Zod already
 *  narrowed to the enum, so an unknown string cannot reach this. */
export function isMemoryMode(v: string): v is MemoryMode {
  return (MEMORY_MODES as readonly string[]).includes(v)
}

/**
 * The auth modes this phase admits. Separate from `supportedMode` because the
 * two constraints are independent: a future release could ship `local-docker`
 * (still `auth_mode: 'none'`) long before it ships a credentialed anything.
 */
export function supportedAuthMode(authMode: MemoryAuthMode): Refusable<MemoryAuthMode> {
  if (authMode === 'none') return { ok: true, value: authMode }
  return {
    ok: false,
    reason:
      'Stored credentials for memory are not part of this release. Use a Neo4j with authentication disabled.'
  }
}

/* ─── Bolt URIs ──────────────────────────────────────────────────────── */

/**
 * A bolt endpoint, decomposed. ⚠ THIS — NOT THE URI STRING — IS WHAT CROSSES
 * IPC. `memory:get` sends host and port, because a normalised string is still a
 * string that a future edit could allow to carry a userinfo section, and the
 * renderer has no use for one it cannot get from these fields.
 */
export interface BoltEndpoint {
  readonly scheme: BoltScheme
  readonly host: string
  readonly port: number
  /** The canonical `scheme://host:port` — port always explicit, host lower-cased,
   *  no userinfo, no path, no query, no fragment. What gets stored. */
  readonly uri: string
}

const MIN_PORT = 1
const MAX_PORT = 65535

/** Is this a port a TCP service could actually be listening on? 0 is a legal
 *  integer and a legal thing to type; it is not an endpoint. */
export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT
}

/**
 * Parse, validate and normalise a bolt URI, or refuse with a reason.
 *
 * ⚠ THE INLINE-CREDENTIALS REFUSAL IS THE REASON THIS FUNCTION EXISTS. Every
 * other check here is hygiene; this one is the structural guard that keeps a
 * password out of `project_memory.bolt_uri`, which is the only free-text column
 * in a table designed to have no password column at all (D93). It refuses a
 * bare `user@host` too — a username is not a secret, but the form that admits
 * one is the form that admits `user:pass@host`, and there is no reason to
 * accept either when auth travels by credential id.
 *
 * ⚠ PATH, QUERY AND FRAGMENT ARE REFUSED RATHER THAN STRIPPED. `bolt://h/db` is
 * a user telling us something (the database name, which has its own field and
 * on Community can only ever be `neo4j`), and `?password=…` is the same
 * smuggling route by another door. Silently discarding either would connect to
 * something other than what was typed.
 */
export function validateBoltUri(raw: string): Refusable<BoltEndpoint> {
  const trimmed = raw.trim()
  if (trimmed === '') {
    return { ok: false, reason: 'Enter the address of your Neo4j, for example bolt://127.0.0.1:7687' }
  }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    // ⚠ THE URL CONSTRUCTOR ALREADY REJECTS SOME OUT-OF-RANGE PORTS (measured:
    // `:65536` and `:-1` both throw ERR_INVALID_URL), so a port complaint can
    // legitimately land here rather than in the range check below. The message
    // covers both without guessing which.
    return {
      ok: false,
      reason: 'That is not a valid address. Use the form bolt://host:port, for example bolt://127.0.0.1:7687'
    }
  }

  // `URL` lower-cases the scheme for us (measured: `BOLT://h` -> `bolt:`).
  const scheme = url.protocol.replace(/:$/, '')
  if (!(BOLT_SCHEMES as readonly string[]).includes(scheme)) {
    return {
      ok: false,
      reason: `Chorus speaks ${BOLT_SCHEMES.join(', ')} — not ${scheme}. A Neo4j browser address (http) is not a bolt address.`
    }
  }

  if (url.username !== '' || url.password !== '') {
    return {
      ok: false,
      reason:
        'Remove the username and password from the address. Chorus never stores a password in a connection string; connect to a Neo4j with authentication disabled.'
    }
  }

  if (url.pathname !== '' && url.pathname !== '/') {
    return {
      ok: false,
      reason: 'Remove the path from the address — it should be just the host and port, like bolt://127.0.0.1:7687'
    }
  }
  if (url.search !== '' || url.hash !== '') {
    return {
      ok: false,
      reason: 'Remove everything after the port — the address should be just the host and port.'
    }
  }

  // ⚠ NOT LOWER-CASED FOR US. `URL` normalises the case of a SPECIAL scheme's
  // host (http, https, ws…) but leaves a non-special scheme's alone — measured:
  // `bolt+s://Host.Example.COM` keeps its capitals. Two rows differing only in
  // case would be two endpoints as far as any comparison is concerned.
  const host = url.hostname.toLowerCase()
  if (host === '') {
    return { ok: false, reason: 'The address needs a host, for example bolt://127.0.0.1:7687' }
  }

  const port = url.port === '' ? DEFAULT_BOLT_PORT : Number(url.port)
  if (!isValidPort(port)) {
    return { ok: false, reason: `A port must be between ${MIN_PORT} and ${MAX_PORT}.` }
  }

  return {
    ok: true,
    value: { scheme: scheme as BoltScheme, host, port, uri: `${scheme}://${host}:${port}` }
  }
}

/**
 * The port a stored URI names — what the `● neo4j :7688` chip renders.
 *
 * ⚠ IT IS A FUNCTION, TESTED, RATHER THAN A `.split(':')` INSIDE A `.vue` FILE.
 * That is the whole instruction: the chip's port is derived, and derived facts
 * that live in templates are derived facts nobody can test. Returns null rather
 * than a fallback when the stored string is unparseable, so the chip omits the
 * port instead of claiming a wrong one (D76's rule, one field down).
 */
export function boltPortOf(uri: string): number | null {
  const parsed = validateBoltUri(uri)
  return parsed.ok ? parsed.value.port : null
}

/** The host a stored URI names, or null when it cannot be parsed. Same
 *  omit-rather-than-guess contract as `boltPortOf`. */
export function boltHostOf(uri: string): string | null {
  const parsed = validateBoltUri(uri)
  return parsed.ok ? parsed.value.host : null
}

/* ─── Docker naming (written here, consumed at Stage 5) ──────────────── */

/**
 * The container-name prefix. **`chorus-`, not `agentdesk-`** — `Plan.md:214`'s
 * prefix is superseded by D102, and it is not cosmetic: D92's whole argument is
 * that this name is the human's index in Docker Desktop, so a stale product
 * name sits in the one string a person actually reads.
 */
const CONTAINER_PREFIX = 'chorus-neo4j-'

/**
 * Docker's own legal-name grammar: `[a-zA-Z0-9][a-zA-Z0-9_.-]*`. Reproduced
 * here because a name this function emits is handed to the daemon, and a name
 * the daemon refuses fails at provision time — a long way from where it was
 * built.
 */
const DOCKER_NAME_LEGAL = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/

/**
 * Turn a project name into a Docker-legal slug.
 *
 * ⚠ WRITTEN AND TESTED IN STAGE 2 THOUGH NOTHING IN STAGE 2 CALLS IT, and the
 * reason is stated rather than assumed: it is PURE, and Stage 5 — where the
 * container lifecycle lives — is where the expensive debugging is. A naming bug
 * discovered while also debugging image pulls and port allocation costs far more
 * than the same bug discovered by a unit test now. This is the one piece of
 * Stage 5 that can be finished early without shipping a stub.
 */
export function projectSlug(projectName: string): Refusable<string> {
  const slug = projectName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/-+$/, '')
    .slice(0, 40)
    .replace(/-+$/, '')

  if (slug === '' || !DOCKER_NAME_LEGAL.test(slug)) {
    // A project named only in a non-Latin script, or only in punctuation, is a
    // real project — it just cannot lend its name to a container. The caller
    // needs a name from somewhere else (the project id), and saying so beats
    // emitting something the daemon will refuse later.
    return {
      ok: false,
      reason: 'The project name has no letters or digits Docker can use in a container name.'
    }
  }
  return { ok: true, value: slug }
}

/** `chorus-neo4j-<slug>` (D92) — the name a human reads in Docker Desktop. */
export function containerNameFor(slug: string): string {
  return `${CONTAINER_PREFIX}${slug}`
}

/** `chorus-neo4j-<slug>-data` — the volume, named off the same slug so the two
 *  sort together in `docker volume ls` beside the container they belong to. */
export function volumeNameFor(slug: string): string {
  return `${containerNameFor(slug)}-data`
}

/** Would Docker accept this as a container or volume name? Exported so the
 *  naming tests can assert the emitted names against the grammar rather than
 *  against a second copy of it. */
export function isDockerLegalName(name: string): boolean {
  return DOCKER_NAME_LEGAL.test(name)
}

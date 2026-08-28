import { z } from 'zod'

/**
 * Fleet Comms Phase 1 / D182 — the pure decision layer for peer awareness.
 *
 * PURE — the house pattern of `resumeCore.ts`, `attentionCore.ts`,
 * `turnsCore.ts` and `codeIndexCore.ts`: no `fs`, no `electron`, no
 * `better-sqlite3`, no clock, no logger. Process facts arrive as an injected
 * `ProcessProbe`; everything here is a fold over supplied values. Task 1-2's
 * service is the thin shell that gathers the facts and calls in.
 *
 * That split is load-bearing rather than stylistic. The whole of this phase's
 * correctness is decision logic — is this entry live, is this address still
 * true, is this a collision — and a poll loop over a directory is close to
 * untestable while a fold over supplied facts is trivially testable.
 *
 * ⚠ THE SCHEMA LIVES HERE RATHER THAN IN `src/shared/ipc.ts`, WHICH IS WHERE
 * EVERY OTHER ZOD SCHEMA IN THIS REPO LIVES — INCLUDING `layoutJsonSchema`,
 * WHICH ALSO VALIDATES A NON-IPC SHAPE. The deviation is deliberate: `ipc.ts`
 * is shared because an IPC contract must be, and D1's rule is that validation
 * happens in MAIN and never in the preload (where a Zod import throws
 * `EvalError` under CSP and silently drops events). This validates a file on
 * disk that only main ever opens; it is not a contract with the renderer, and
 * nothing outside main has a reason to import it. Task 1-3's IPC payload
 * schemas DO belong in `ipc.ts` and go there.
 */

/** The peer protocol version this code understands. Spec §8.1: gate every read
 *  on it, and on an unrecognised value degrade rather than guess at a changed
 *  shape. The caller owns the "log once" half of that rule. */
export const SUPPORTED_PEER_PROTOCOL = 1

/**
 * A session's self-reported state.
 *
 * ⚠ `unrecognised` EXISTS SO THAT A NEW CLAUDE STATUS CANNOT DELETE A SESSION
 * FROM THE FLEET. A strict enum would fail the whole parse on an added value,
 * dropping a live, reachable peer because it reported a word we had not seen —
 * which is the brittleness §8.1 warns against, expressed as a validation rule.
 * Status is display-only here; nothing in the addressing decision reads it.
 */
export type FleetStatus = 'idle' | 'busy' | 'shell' | 'unrecognised'

const KNOWN_STATUSES = new Set<FleetStatus>(['idle', 'busy', 'shell'])

/** A registry entry after validation. Unknown keys are DISCARDED rather than
 *  carried: the CLI adds fields over time (`peerFeatures` arrived after
 *  `peerProtocol`), and a passthrough object invites a consumer to reach for
 *  one we never validated. */
export interface FleetEntry {
  readonly pid: number
  readonly sessionId: string
  readonly cwd: string
  /** The process's true start time, as the CLI recorded it. Compared by
   *  EQUALITY only — this module never parses or interprets the format. */
  readonly procStart: string
  readonly peerProtocol: number
  /**
   * ⚠ LIVE STATE. Never persist it, never key on it, never index it
   * (D182 / spec §6.1). It is read, displayed, and forgotten.
   */
  readonly name: string
  readonly status: FleetStatus
  /** Opaque. Carried for Phase 2's sender join and for Task 1-2 to record.
   *  ⚠ NEVER OPENED — spec §7.4's socket prohibition is permanent. Reading the
   *  string is not connecting to it. */
  readonly messagingSocketPath: string | null
  readonly nameSource: string | null
  readonly startedAt: number | null
}

export type ParseResult =
  | { readonly ok: true; readonly entry: FleetEntry }
  | { readonly ok: false; readonly reason: string }

/**
 * Process facts the CALLER gathered.
 *
 * Injected rather than imported so this module stays pure, and so the Windows
 * start-time mechanism lives in exactly one place in Task 1-2 — where it must
 * be MEASURED against a live session rather than assumed. This module only
 * requires that `startTimeOf` returns something comparable by equality to
 * `procStart`.
 */
export interface ProcessProbe {
  readonly alive: (pid: number) => boolean
  readonly startTimeOf: (pid: number) => string | null
}

/**
 * What Chorus can currently say about a pane's address.
 *
 * ⚠ EXACTLY THREE MEMBERS, AND THE COUNCIL PROPOSED SIX. The rejected four
 * were `renamed`, `collided`, `duplicate`, `unconfirmed`/`unavailable`. Two
 * reasons, both measured rather than aesthetic:
 *
 *  - `unconfirmed` and `unavailable` are ONE SENTENCE to an operator — *we
 *    cannot vouch for this address*. Two spellings of that produce two code
 *    paths and one meaning.
 *  - `collided` and `renamed` are usually INDISTINGUISHABLE IN THE DATA. A
 *    real collision wrote `nameSource: "derived"` (spec §4.8), identical to a
 *    session that never asked for a name. A state whose evidence is usually
 *    absent is a state that is usually wrong.
 *
 * Cause is therefore an ENRICHMENT on `changed`, present only in the one case
 * Chorus can actually demonstrate: another live entry currently holds the name
 * we asked for.
 */
export type AddressState =
  | { readonly kind: 'verified'; readonly address: string }
  | {
      readonly kind: 'changed'
      readonly requested: string
      readonly current: string
      readonly cause: 'collision' | null
    }
  | { readonly kind: 'unknown'; readonly reason: string }

/* ── parsing ─────────────────────────────────────────────────────────────── */

const registryFileSchema = z.object({
  pid: z.number().int().positive(),
  sessionId: z.string().min(1),
  cwd: z.string().min(1),
  procStart: z.string().min(1),
  peerProtocol: z.number().int(),
  name: z.string().min(1),
  status: z.string().optional(),
  messagingSocketPath: z.string().min(1).optional(),
  nameSource: z.string().optional(),
  startedAt: z.number().optional()
})

/**
 * Validate one registry file's already-parsed contents.
 *
 * ⚠ NEVER THROWS. A malformed entry is a VALUE, because spec §8.1 requires a
 * tolerant read: the failure modes are ordinary, not exceptional. The CLI
 * writes these files while we read them (a torn write), a session can exit
 * between `readdir` and `readFile`, and an empty file is a legal intermediate
 * state. One bad file must never end a poll over the others.
 */
export function parseRegistryEntry(raw: unknown): ParseResult {
  const parsed = registryFileSchema.safeParse(raw)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const where = first?.path?.length ? first.path.join('.') : 'entry'
    return { ok: false, reason: `${where}: ${first?.message ?? 'invalid'}` }
  }
  const v = parsed.data
  const status = v.status as FleetStatus | undefined
  return {
    ok: true,
    entry: {
      pid: v.pid,
      sessionId: v.sessionId,
      cwd: v.cwd,
      procStart: v.procStart,
      peerProtocol: v.peerProtocol,
      name: v.name,
      status: status && KNOWN_STATUSES.has(status) ? status : 'unrecognised',
      messagingSocketPath: v.messagingSocketPath ?? null,
      nameSource: v.nameSource ?? null,
      startedAt: v.startedAt ?? null
    }
  }
}

/** Spec §8.1. An unrecognised value is not an error — it is "degrade and log
 *  once", and the logging belongs to the caller so this stays pure. */
export function isProtocolSupported(entry: FleetEntry): boolean {
  return entry.peerProtocol === SUPPORTED_PEER_PROTOCOL
}

/* ── liveness ────────────────────────────────────────────────────────────── */

/**
 * ⚠ BOTH HALVES ARE REQUIRED, AND A PID CHECK ALONE IS THE BUG.
 *
 * Spec §4.7, measured: a force-killed session leaves its `<pid>.json` and
 * `.key` behind, so file presence proves nothing. And the OS recycles pids, so
 * a pid that exists is not necessarily THIS session — `procStart` is
 * presumably in the file for exactly that reason.
 *
 * The two failures look identical from the outside (a stale entry rendered as
 * a live peer) and one of them is a pane the operator might try to message.
 */
export function isLive(entry: FleetEntry, probe: ProcessProbe): boolean {
  if (!probe.alive(entry.pid)) return false
  const started = probe.startTimeOf(entry.pid)
  return started !== null && started === entry.procStart
}

/* ── names ───────────────────────────────────────────────────────────────── */

/** Trim + case-fold, matching `suggestAgentName`'s treatment of taken names
 *  (`agentNames.ts:75`), so "  bob " and "Bob" are one address app-wide. */
export function normaliseAddress(name: string): string {
  return name.trim().toLowerCase()
}

/**
 * Normalised names held by more than one of the supplied entries.
 *
 * Pass LIVE entries only — a dead session's leaked file must not be able to
 * make a live one look collided. Returns a Set rather than a map of holders
 * because the only consumer asks a membership question; if a future caller
 * needs the holders, widen it then rather than now.
 */
export function duplicateNames(entries: readonly FleetEntry[]): ReadonlySet<string> {
  const seen = new Set<string>()
  const dupes = new Set<string>()
  for (const e of entries) {
    const key = normaliseAddress(e.name)
    if (seen.has(key)) dupes.add(key)
    else seen.add(key)
  }
  return dupes
}

/* ── the address decision ────────────────────────────────────────────────── */

export function addressStateFor(input: {
  readonly requestedName: string | null
  /** The LIVE entry joined by sessionId, or null when there is none. */
  readonly entry: FleetEntry | null
  readonly duplicates: ReadonlySet<string>
}): AddressState {
  const { requestedName, entry, duplicates } = input

  if (entry === null) {
    return { kind: 'unknown', reason: 'no live registry entry for this session' }
  }

  // A pane Chorus never named is not DRIFTING — it simply wears whatever
  // address the CLI derived, and reporting that as `verified` is honest. The
  // alternative (calling it `changed` against a null request) would light a
  // warning on every pane launched before Phase 0 shipped.
  if (requestedName === null || normaliseAddress(requestedName).length === 0) {
    return { kind: 'verified', address: entry.name }
  }

  if (normaliseAddress(requestedName) === normaliseAddress(entry.name)) {
    return { kind: 'verified', address: entry.name }
  }

  return {
    kind: 'changed',
    requested: requestedName,
    current: entry.name,
    // The one demonstrable cause: someone else currently holds what we asked
    // for. Anything else (an AI title, a reclaim we did not witness) leaves no
    // evidence in the registry — see the AddressState note.
    cause: duplicates.has(normaliseAddress(requestedName)) ? 'collision' : null
  }
}

/* ── stickiness ──────────────────────────────────────────────────────────── */

/**
 * Fold the previous state with the incoming one.
 *
 * ⚠ NOT A TIMER, AND NOT A TTL. Spec §4.8 measured the `agent-name` record
 * repeating 29 times through a single session; a time-based badge would
 * flicker along with it. Both council members who made this the condition of
 * their vote said the same thing from opposite directions — Grok 4.6: *"a
 * badge that evaporates treats [a collision and a wanted AI title] both as
 * flicker"*; DeepSeek v4 Pro: *"last-write-wins rendering without a sticky
 * addressState will look like a silent rename to anyone who blinked."*
 *
 * So a `changed` STAYS until the operator acknowledges it, and losing the
 * registry never counts as evidence the old name came back.
 */
export function nextStickyState(
  previous: AddressState | null,
  incoming: AddressState,
  acknowledged: boolean
): AddressState {
  if (acknowledged) return incoming
  if (previous === null || previous.kind !== 'changed') return incoming

  // An `unknown` does NOT clear a remembered `changed`: not being able to read
  // the registry is not the same as the name having come back.
  if (incoming.kind === 'unknown') return previous

  // A later `verified` does not silently erase the transition either — the
  // operator has not seen it yet. Only a NEWER divergence supersedes it.
  if (incoming.kind === 'verified') return previous

  return incoming
}

import type { AgentKind, FleetAddressState, FleetSnapshotPayload } from './ipc'

/**
 * Fleet Comms Phase 1, Task 1-4 — what the roster shows, as data.
 *
 * ⚠ THE RULES LIVE HERE RATHER THAN IN THE COMPONENT BECAUSE THIS REPOSITORY
 * HAS NO `.vue` TESTS. D186 states the consequence plainly: a rule written in a
 * component is a rule nothing can check. Every claim the roster makes — that an
 * unparticipating pane still gets a row, that an unreadable registry is not an
 * empty fleet, that there is no unread state anywhere — is decided here and
 * asserted in `fleetRoster.test.ts`. `FleetRoster.vue` only draws the result.
 */

/** A pane in the current project, as the roster needs to see it. */
export interface RosterPane {
  readonly sessionId: string
  readonly agent: AgentKind
  /** Chorus's own label for the pane — the rail's name, not the peer address. */
  readonly label: string
}

export type RosterReason =
  /** The agent does not participate at all. Permanent, and a property of the
   *  tool rather than a fault. */
  | 'not-claude'
  /** A claude pane with no live registry entry — probably temporary. */
  | 'no-entry'

export interface RosterRow {
  readonly sessionId: string
  readonly label: string
  readonly agent: AgentKind
  readonly address: FleetAddressState
  /** `idle` / `busy` / `shell` from the registry, or null when unknown. */
  readonly status: string | null
  readonly addressable: boolean
  /** Why not, when `addressable` is false. ⚠ THE TWO REASONS ARE KEPT APART
   *  DELIBERATELY: one is permanent and one is probably temporary, and
   *  collapsing them into a single "unavailable" would tell the operator to
   *  stop waiting for something that is about to arrive. */
  readonly reason: RosterReason | null
}

export interface ExternalRow {
  readonly name: string
  readonly cwd: string
  readonly status: string
}

export interface Roster {
  /** ⚠ EVERY PANE IN THE PROJECT, including ones that cannot participate. §7.2:
   *  "an absent row reads as 'no agents', which is a different and wrong
   *  claim." */
  readonly panes: readonly RosterRow[]
  /** Peers on this machine that Chorus did not launch. Collapsed in the UI, and
   *  carrying NO actions — they are real and it would be dishonest to hide
   *  them, but they are not ours to focus or manage. */
  readonly external: readonly ExternalRow[]
  /** ⚠ FALSE MEANS "WE CANNOT SAY", NOT "THERE ARE NO PEERS". The roster must
   *  render this as its own state; an empty list would be a confident claim
   *  built on missing data. */
  readonly readable: boolean
}

const UNKNOWN_NO_READING: FleetAddressState = { kind: 'unknown', reason: 'no fleet reading yet' }

/**
 * Build the roster.
 *
 * `snapshot` is null before the first poll arrives, which is a real state and
 * not an error — it means the same thing as unreadable, and is rendered the
 * same way.
 */
export function buildRoster(
  panes: readonly RosterPane[],
  snapshot: FleetSnapshotPayload | null
): Roster {
  const readable = snapshot?.readable ?? false

  const rows = panes.map((pane): RosterRow => {
    if (pane.agent !== 'claude') {
      return {
        sessionId: pane.sessionId,
        label: pane.label,
        agent: pane.agent,
        address: { kind: 'unknown', reason: 'this agent does not join the fleet' },
        status: null,
        addressable: false,
        reason: 'not-claude'
      }
    }
    const address = !snapshot
      ? UNKNOWN_NO_READING
      : !snapshot.readable
        ? { kind: 'unknown' as const, reason: 'registry unreadable' }
        : (snapshot.states[pane.sessionId] ?? { kind: 'unknown' as const, reason: 'not in fleet' })
    const status = snapshot?.readable ? (snapshot.statuses[pane.sessionId] ?? null) : null
    return {
      sessionId: pane.sessionId,
      label: pane.label,
      agent: pane.agent,
      address,
      status,
      // A claude pane is addressable exactly when we can currently name it.
      addressable: address.kind !== 'unknown',
      reason: address.kind === 'unknown' ? 'no-entry' : null
    }
  })

  return { panes: rows, external: snapshot?.readable ? snapshot.externalPeers : [], readable }
}

/**
 * The one line the roster must always show.
 *
 * §4.5 makes this a correctness requirement rather than politeness: the fleet
 * is larger than Chorus in both directions — there are claude sessions Chorus
 * did not launch, and Chorus panes that are not claude — so a list that looks
 * complete is a claim, and a false one.
 */
export const ROSTER_PARTIALITY_NOTE =
  'Claude sessions with a peer-protocol registry entry on this machine. Other agents cannot participate; sessions on other machines are not visible.'

/** How a drifted address reads, shared with the pane chip so the two cannot
 *  drift apart the first time one is edited. */
export function describeAddress(state: FleetAddressState): string {
  if (state.kind === 'verified') return state.address
  if (state.kind === 'changed') {
    return state.cause === 'collision'
      ? `${state.current} (requested ${state.requested} — taken)`
      : `${state.current} (requested ${state.requested})`
  }
  return 'Address unknown'
}

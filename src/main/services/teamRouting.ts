import { HELPER_ROUTING_REFUSALS, helperAttemptRefusal, planHelperRouting, type HelperRoutingPlan } from '../routing/helperRoutingCore'
import { LAUNCH_MESSAGES } from '../routing/launchCore'
import type { RoutingLaunchSelection } from '../../shared/routing'
import type { TeamMember } from '../../shared/team'
import { RoutingError, type RoutingService } from './routingService'

/**
 * Model Routing Task 4b-2 (ImplementationSpec-4b-2; overview K2–K5, K8, C7): how TeamService reaches the routing
 * service for a helper's tier. `check` (team:launch) reads only the two lists eligibility needs — no snapshot, no
 * clock. `resolve` (immediately before each routed attempt's decrypt) plans, then asks RoutingService.resolveLaunch
 * on the helper profile for the member's own credential and effort (MR-D32). Neither decrypts, sends a request,
 * calls anything else on RoutingService, or throws: every failure is a stated reason.
 */

export type TeamRoutingServiceLike = Pick<RoutingService, 'credentials' | 'models' | 'resolveLaunch' | 'getSettings'>
export type HelperRoutingCheck = { readonly ok: true } | { readonly ok: false; readonly reason: string }
/** `selection` is null exactly for a member with no routingTier (OpenRouter default). */
export type HelperRoutingResolution =
  | { readonly ok: true; readonly selection: RoutingLaunchSelection | null }
  | { readonly ok: false; readonly reason: string }

export interface TeamRoutingPort {
  check(member: TeamMember): HelperRoutingCheck
  resolve(member: TeamMember): HelperRoutingResolution
}

export function createTeamRoutingPort(routing: () => TeamRoutingServiceLike | null): TeamRoutingPort {
  /** One thunk read, then both lists. A null service, a throwing thunk or a throwing list read is "unavailable". */
  function plan(member: TeamMember): { plan: HelperRoutingPlan; service: TeamRoutingServiceLike | null } {
    let service: TeamRoutingServiceLike | null = null
    let lists: { credentialIds: string[]; registrySlugs: string[] } | null = null
    try {
      service = routing()
      if (service !== null) {
        lists = {
          credentialIds: service.credentials().credentials.map((c) => c.id),
          registrySlugs: service.models().models.map((m) => m.slug)
        }
      }
    } catch {
      lists = null
    }
    return {
      service,
      plan: planHelperRouting({
        harness: member.harness,
        authMode: member.authMode,
        tier: member.routingTier ?? null,
        credentialProfileId: member.credentialProfileId,
        model: member.model,
        routingAvailable: lists !== null,
        routingCredentialIds: lists?.credentialIds ?? [],
        registrySlugs: lists?.registrySlugs ?? []
      })
    }
  }

  return {
    check(member) {
      if (member.routingTier === undefined) return { ok: true }
      const { plan: p } = plan(member)
      return p.kind === 'refused' ? { ok: false, reason: p.reason } : { ok: true }
    },
    resolve(member) {
      if (member.routingTier === undefined) return { ok: true, selection: null }
      const { plan: p, service } = plan(member)
      if (p.kind === 'refused') return { ok: false, reason: p.reason }
      // A member with a tier never plans 'unrouted', and a null service plans 'refused'; refuse rather than go unrouted.
      if (p.kind !== 'routed' || service === null) return { ok: false, reason: HELPER_ROUTING_REFUSALS.unavailable }
      try {
        const selection = service.resolveLaunch({
          model: p.model,
          tier: p.tier,
          effort: member.effort,
          credentialProfileId: p.credentialProfileId,
          profile: 'helper'
        })
        return { ok: true, selection }
      } catch (err) {
        const code = err instanceof RoutingError ? err.code : 'OPERATION_FAILED'
        const message = err instanceof RoutingError ? err.message : LAUNCH_MESSAGES.failed
        return { ok: false, reason: helperAttemptRefusal(p.tier, p.model, code, message, code === 'SNAPSHOT_STALE' ? maxAgeMinutes(service) : null) }
      }
    }
  }
}

/** SNAPSHOT_STALE's `<N>` (C2): the settings' snapshotMaxAgeMinutes, or null when the settings cannot be read. */
function maxAgeMinutes(service: TeamRoutingServiceLike): number | null {
  try {
    return service.getSettings().snapshotMaxAgeMinutes
  } catch {
    return null
  }
}

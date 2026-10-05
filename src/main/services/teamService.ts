import { randomUUID } from 'node:crypto'
import { teamLaunchSchema, teamDelegateSchema, teamReviseSchema, teamReviewSchema, teamIntegrateSchema, teamCancelSchema, teamLifecycleSchema, teamIntegrationDecisionSchema, teamStatusSchema, teamWaitSchema, TEAM_LIMITS, type TeamRun, type TeamMember, type TeamTask, type TeamAttempt, type TeamSnapshot, type TeamToolName, type TeamReview, type TeamIntegrate } from '../../shared/team'
import { TeamStorage, type TeamAcknowledgment, type TeamJson } from './teamStorage'
import { assertLeadAuthority, assertDispatchFence, assertDependencies, reserveNextAttempt, refreshTaskReadiness, failPreparation, fitUtf8, startAttempt, settleAttempt, requestAttemptTermination, reviseTask, transitionRun, canFinishDraining, holdsSlot, teamAssert, TeamDomainError, type TeamActor, type TeamLease, type TeamCredentialFence } from './teamCore'
import type { HelperProcess, HelperProcessOptions, HelperProcessOutcome } from './helperProcess'
import type { ResolvedCredential, PtyLaunchRoute } from '../adapters/types'
import { helperRegistry } from '../adapters/helpers/registry'
import { allowedHelperCombination, allowedLeadCombination } from '../adapters/helpers/evidence'
import { compactTeamStatus, compactTeamChecks } from './teamStatusCore'
import { teamDetailSchema, teamVerifySchema, teamFinishSchema, teamDelegateManySchema, teamReviewManySchema } from '../../shared/team'
import { helperCheckCommands } from './teamChecks'
import { scrubSecrets } from './logger'
import { dependencyState, taskScopeBusy } from './teamCore'
import type { HelperEvent } from '../adapters/helpers/types'
import type { TeamRoutingPort } from './teamRouting'
import { HELPER_ROUTING_REFUSALS, routedHelperFailureNote } from '../routing/helperRoutingCore'
import type { RoutingLaunchSelection } from '../../shared/routing'

export interface TeamServiceDependencies {
  storage: TeamStorage
  executor: { spawnHelper(attemptId: string, options: HelperProcessOptions): Pick<HelperProcess, 'done' | 'identified' | 'cancel' | 'inspect'>; cancelHelper(attemptId: string, intent?: 'cancelled' | 'timed-out'): Promise<void> }
  workspace: {
    prepareRun(run: TeamRun, signal: AbortSignal): Promise<{ baseSha: string; head: string; worktreeId: string }>
    prepareAttempt(run: TeamRun, attempt: TeamAttempt, signal: AbortSignal): Promise<{ cwd: string; baseSha: string; worktreeId: string }>
    validateResult(run: TeamRun, task: TeamTask, attempt: TeamAttempt): Promise<void>
    inspectRecovery(run: TeamRun): Promise<{ writersStopped: boolean; ordinaryDirty: boolean; ambiguousIntegration: boolean }>
    review?(run: TeamRun, command: TeamReview, actor: TeamActor): Promise<TeamAcknowledgment>
    reviewMany?(run: TeamRun, command: ReturnType<typeof teamReviewManySchema.parse>, actor: TeamActor): Promise<TeamAcknowledgment>
    integrate?(run: TeamRun, command: TeamIntegrate, actor: TeamActor): Promise<TeamAcknowledgment>
    decideIntegration?(run: TeamRun, command: ReturnType<typeof teamIntegrationDecisionSchema.parse>, actor: TeamActor): Promise<TeamAcknowledgment>
    subscribe?(listener: (runId: string) => void): () => void
    settle?(): Promise<void>
    refreshIntegrationHead?(run: TeamRun): Promise<void>
    detail?(run: TeamRun, command: ReturnType<typeof teamDetailSchema.parse>): Promise<unknown>
    verify?(run: TeamRun, command: ReturnType<typeof teamVerifySchema.parse>): Promise<TeamAcknowledgment>
    finish?(run: TeamRun, command: ReturnType<typeof teamFinishSchema.parse>): Promise<TeamAcknowledgment>
    preflight?(run: TeamRun, command: ReturnType<typeof teamDelegateSchema.parse>): Promise<void>
  }
  credentials: {
    inspect(member: TeamMember): TeamCredentialFence | undefined
    resolve(member: TeamMember, fence: TeamCredentialFence): Promise<ResolvedCredential>
    route(member: TeamMember): PtyLaunchRoute | undefined
  }
  lead: {
    launch(run: TeamRun, lease: TeamLease, authorization: { assertAuthorized(): void; resolveCredential(): Promise<ResolvedCredential | undefined> }): Promise<{ sessionId: string; replacementReason?: string }>
    stopped(run: TeamRun): Promise<boolean>
    stop(run: TeamRun): Promise<boolean>
  }
  /** Production composition rechecks installed binary versions, provider/model route, and project ownership. */
  validateMember(member: TeamMember, role: 'lead' | 'helper'): Promise<void>
  validateProject(projectId: string): void
  /**
   * Model Routing Phase 4b (K3, K8, C7): how a helper's routing tier is checked at launch and resolved before each
   * attempt. Optional, so the scripts that build a TeamService keep compiling; without it every routingTier is
   * refused as unavailable, never silently unrouted (C8).
   */
  routing?: TeamRoutingPort
  autoActivate?: boolean
  leaseIssued?(lease: TeamLease): void
  leaseRevoked?(runId: string): void
  publish?(snapshot: TeamSnapshot): void
  now?: () => string
  id?: () => string
}

/** Main-only coordinator. Construction/boot never creates a lease, resolves a credential or spawns. */
export class TeamService {
  private readonly storage: TeamStorage
  private readonly leases = new Map<string, TeamLease>()
  private readonly ready = new Map<string, string>()
  private readonly launchedLeads = new Set<string>()
  private readonly preparations = new Map<string, AbortController>()
  private readonly pumping = new Set<string>()
  private readonly stoppedLeads = new Set<string>()
  private readonly unavailableRuns = new Map<string, string>()
  private readonly inFlight = new Set<Promise<unknown>>()
  private readonly activity = new Map<string, { runId: string; taskId: string; text: string; bytes: number; truncated: boolean; truncationRecorded: boolean; timer?: ReturnType<typeof setTimeout> }>()
  private closing = false
  private readonly listeners = new Set<(snapshot: TeamSnapshot) => void>()
  private readonly now: () => string
  private readonly id: () => string
  constructor(private readonly deps: TeamServiceDependencies) {
    this.storage = deps.storage; this.now = deps.now ?? (() => new Date().toISOString()); this.id = deps.id ?? randomUUID
    deps.workspace.subscribe?.(runId => { try { if (this.storage.getRun(runId).status === 'blocked') this.revoke(runId); this.publish(runId); this.drain(runId); this.schedule(runId) } catch { this.blockRun(runId, 'Workspace outcome could not be published.') } })
  }
  private user(actor: TeamActor): void { teamAssert(actor.role === 'user', 'USER_REQUIRED', 'This action requires the registered user transport.') }
  private track(work: Promise<unknown>): void { this.inFlight.add(work); void work.then(() => this.inFlight.delete(work), () => this.inFlight.delete(work)) }
  private helperActivity(runId: string, taskId: string, attemptId: string, event: HelperEvent): void {
    if (this.closing) return
    if (!['activity', 'permission-blocked', 'protocol-error'].includes(event.type)) return
    if (event.type === 'permission-blocked' || event.type === 'protocol-error') {
      const snapshot = this.getSnapshot(runId), attempt = snapshot.attempts.find(a => a.id === attemptId), task = snapshot.tasks.find(t => t.id === taskId)
      const reason = scrubSecrets(event.reason).slice(0, 900)
      if (attempt && task && attempt.blocker !== reason) {
        this.storage.command({ ...this.operation(snapshot.run, 'helper-blocker', { role: 'system' }), entityId: taskId }, tx => {
          tx.writeAttempt({ ...attempt, blocker: reason, version: attempt.version + 1 }, attempt.version)
          if (task.currentAttemptId === attemptId) tx.writeTask({ ...task, blocker: reason, version: task.version + 1, updatedAt: this.now() }, task.version)
          return { acknowledgment: {}, event: { attemptId, reason, category: event.type } }
        })
        this.publish(runId)
      }
    }
    const state = this.activity.get(attemptId) ?? { runId, taskId, text: '', bytes: 0, truncated: false, truncationRecorded: false }
    this.activity.set(attemptId, state)
    if (state.truncated) return
    const text = event.type === 'activity' ? `[${event.category}] ${event.text}\n` : 'reason' in event ? `[${event.type}] ${event.reason}\n` : ''
    const clean = Buffer.from(scrubSecrets(text)), remaining = Math.max(0, 65536 - state.bytes)
    state.text += clean.subarray(0, remaining).toString('utf8'); state.bytes += Math.min(clean.length, remaining)
    state.truncated = clean.length > remaining
    if (!state.timer) { state.timer = setTimeout(() => this.flushActivity(attemptId), 1000); state.timer.unref() }
  }
  private flushActivity(attemptId: string): void {
    const state = this.activity.get(attemptId); if (!state) return
    if (state.timer) clearTimeout(state.timer); state.timer = undefined
    if (!state.text && (!state.truncated || state.truncationRecorded)) return
    try {
      const run = this.storage.getRun(state.runId)
      this.storage.command({ ...this.operation(run, 'helper-activity', { role: 'system' }), entityId: state.taskId }, () => ({ acknowledgment: {}, event: { attemptId, text: state.text, truncated: state.truncated } }))
      state.text = ''; state.truncationRecorded ||= state.truncated; this.publish(run.id)
    } catch { this.blockRun(state.runId, 'Helper activity could not be retained; inspect the run before continuing.') }
  }
  private assertCombination(member: TeamMember, role: 'lead' | 'helper' = 'helper'): void {
    const combination = { id: member.harness, version: member.installedVersion, authMode: member.authMode, model: member.model, baseUrl: this.deps.credentials.route(member)?.baseUrl, customModel: member.customModel }
    teamAssert(role === 'lead' ? allowedLeadCombination(combination) : allowedHelperCombination(combination), 'UNVERIFIED_COMBINATION', 'This CLI version/model/route needs an explicit compatibility check; open Team launch diagnostics.')
  }
  /** Model Routing Phase 4b (K4, C8): why this helper's routing tier cannot be served, or null (no tier, or servable). Reads no snapshot. */
  private routingRefusal(member: TeamMember): string | null {
    if (member.routingTier === undefined) return null
    const check = this.deps.routing ? this.deps.routing.check(member) : { ok: false as const, reason: HELPER_ROUTING_REFUSALS.unavailable }
    return check.ok ? null : check.reason
  }
  /** Model Routing Phase 4b (K8, MR-D32): this attempt's selection, or null for an unrouted member. A refusal throws its stated reason. */
  private resolveRouting(member: TeamMember): RoutingLaunchSelection | null {
    if (member.routingTier === undefined) return null
    const resolution = this.deps.routing ? this.deps.routing.resolve(member) : { ok: false as const, reason: HELPER_ROUTING_REFUSALS.unavailable }
    if (!resolution.ok) throw new TeamDomainError('ROUTING_REFUSED', resolution.reason)
    if (resolution.selection === null) throw new TeamDomainError('ROUTING_REFUSED', HELPER_ROUTING_REFUSALS.unavailable)
    return resolution.selection
  }
  authorizeLead(actor: Extract<TeamActor, { role: 'lead' }>, operation: TeamToolName): void { assertLeadAuthority(this.storage.getRun(actor.runId), this.leases.get(actor.runId), actor, operation) }
  markBridgeReady(actor: Extract<TeamActor, { role: 'lead' }>): void { this.authorizeLead(actor, 'team_roster'); this.ready.set(actor.runId, actor.epoch); this.activateReady(actor.runId) }
  private activateReady(runId: string): void {
    const run = this.storage.getRun(runId), lease = this.leases.get(runId)
    if (!this.deps.autoActivate || !lease || !this.launchedLeads.has(runId) || run.status !== 'preparing' || this.ready.get(runId) !== lease.epoch) return
    const next = transitionRun(run, 'activate', { now: this.now(), bridgeReady: true })
    this.storage.command(this.operation(run, 'bridge-activated', { role: 'system' }), tx => { tx.updateRun(run.version, next); return { acknowledgment: {}, event: { status: next.status } } })
    this.publish(runId); this.schedule(runId)
  }
  getSnapshot(runId: string, afterSequence = 0): TeamSnapshot {
    const blocker = this.unavailableRuns.get(runId)
    if (blocker) throw new TeamDomainError('RUN_STORAGE_BLOCKED', blocker)
    return this.storage.snapshot(runId, afterSequence)
  }
  getRestoreBlockers(): Array<{ runId: string; status: 'blocked'; reason: string }> { return [...this.unavailableRuns].map(([runId, reason]) => ({ runId, status: 'blocked', reason })) }
  finishRetired(runId: string): void { this.revoke(runId); this.publish(runId) }
  /** Retain historical decisions; release obsolete approval waits without applying Git changes. */
  retireApprovalGates(): void {
    for (const runId of this.storage.listRunIds()) {
      try {
        const snapshot = this.getSnapshot(runId)
        const pending = snapshot.integrations.filter(i => i.status === 'awaiting-approval')
        const waiting = snapshot.tasks.filter(t => t.status === 'awaiting-approval')
        if (!pending.length && !waiting.length) continue
        this.storage.command(this.operation(snapshot.run, 'human-approval-gate-retired', { role: 'system' }), tx => {
          tx.updateRun(snapshot.run.version, { ...snapshot.run, version: snapshot.run.version + 1, updatedAt: this.now() })
          for (const i of pending) tx.writeIntegration({ ...i, status: 'prepared', version: i.version + 1, updatedAt: this.now() }, i.version)
          for (const task of waiting) tx.writeTask({ ...task, status: 'awaiting-review', version: task.version + 1, updatedAt: this.now(), blocker: null }, task.version)
          return { acknowledgment: {}, event: { integrationIds: pending.map(i => i.id), explanation: 'The lead may apply reviewed results without human approval. Existing content and history are retained.' } }
        })
      } catch { this.recordRestoreBlocker(runId, 'Retained approval state could not be upgraded; inspect the preserved Team history.') }
    }
  }
  recordRestoreBlocker(runId: string, reason: string): void { this.revoke(runId); if (!this.unavailableRuns.has(runId)) this.unavailableRuns.set(runId, reason) }
  subscribe(listener: (snapshot: TeamSnapshot) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  leadExited(runId: string): void {
    const run = this.storage.getRun(runId)
    if (['preparing', 'active', 'recovering'].includes(run.status)) this.blockRun(runId, 'The lead terminal exited. Retained tasks and workspaces require explicit Resume or Stop.')
  }
  bridgeTimedOut(runId: string, generation: number): void {
    const run = this.storage.getRun(runId)
    if (run.status !== 'preparing' || run.generation !== generation || this.ready.has(runId)) return
    const reason = 'The Team bridge has not connected after 60 seconds. Finish CLI trust prompts in the lead terminal, then retry activation or Stop.'
    this.storage.command(this.operation(run, 'bridge-timeout', { role: 'system' }), tx => { tx.updateRun(run.version, { ...run, version: run.version + 1, blocker: reason, updatedAt: this.now() }); return { acknowledgment: {}, event: { reason } } })
    this.publish(runId)
  }
  private publish(runId: string): void {
    const snapshot = this.getSnapshot(runId)
    try { this.deps.publish?.(snapshot) } catch { /* A view cannot roll back committed domain state. */ }
    for (const listener of this.listeners) try { listener(snapshot) } catch { /* Isolate view/subscription failures. */ }
  }
  async dispatch(actor: Extract<TeamActor, { role: 'lead' }>, operation: TeamToolName, input: unknown, signal: AbortSignal): Promise<unknown> {
    this.authorizeLead(actor, operation)
    switch (operation) {
      case 'team_roster': { const run = this.storage.getRun(actor.runId); return { members: run.config.helpers, lead: run.config.lead, limits: { concurrency: run.config.concurrency, attempts: TEAM_LIMITS.attempts, executionMinutes: run.config.executionMinutes }, status: run.status } }
      case 'team_delegate': {
        const command = teamDelegateSchema.parse(input)
        if (!this.storage.acknowledgment(actor.runId, 'delegate', command.clientRequestId, command)) await this.deps.workspace.preflight?.(this.storage.getRun(actor.runId), command)
        this.authorizeLead(actor, operation)
        return this.submitTask(actor.runId, command, actor)
      }
      case 'team_delegate_many': return this.delegateMany(actor, teamDelegateManySchema.parse(input))
      case 'team_revise': return this.revise(actor.runId, input, actor)
      case 'team_review': return this.review(actor.runId, input, actor)
      case 'team_review_many': return this.reviewMany(actor, teamReviewManySchema.parse(input))
      case 'team_integrate': return this.integrate(actor.runId, input, actor)
      case 'team_cancel': return this.cancelTask(actor.runId, input, actor)
      case 'team_status': {
        const command = teamStatusSchema.parse(input), snapshot = this.getSnapshot(actor.runId, command.afterSequence)
        if (command.taskId) teamAssert(snapshot.tasks.some(t => t.id === command.taskId), 'UNKNOWN_TASK', 'Status task does not belong to this run.')
        const ids = command.taskId ? [command.taskId] : []
        return compactTeamStatus(snapshot, this.storage.actionableCursor(actor.runId, ids), ids, compactTeamChecks(this.storage.verificationEvents(actor.runId)))
      }
      case 'team_wait': {
        const command = teamWaitSchema.parse(input)
        if (command.target === 'events') {
          const result = await this.wait(actor.runId, command.taskIds, command.afterSequence, command.timeoutMs, signal)
          this.authorizeLead(actor, operation)
          return compactTeamStatus(result, this.storage.actionableCursor(actor.runId, command.taskIds), command.taskIds, compactTeamChecks(this.storage.verificationEvents(actor.runId)))
        }
        const { snapshot, wakeReason } = await this.waitDecision(actor.runId, command, signal)
        this.authorizeLead(actor, operation)
        const checks = command.verificationIds.length ? command.verificationIds.flatMap(id => compactTeamChecks(this.storage.verificationEvents(actor.runId, id))) : compactTeamChecks(this.storage.verificationEvents(actor.runId))
        return { ...compactTeamStatus(snapshot, this.storage.actionableCursor(actor.runId, command.taskIds), command.taskIds, checks), wakeReason }
      }
      case 'team_detail': {
        const command = teamDetailSchema.parse(input), snapshot = this.getSnapshot(actor.runId, command.afterSequence)
        if (command.section === 'checks') {
          const events = this.storage.verificationEvents(actor.runId, command.verificationId), completed = events.filter(e => e.operation === 'verification-completed').at(-1)
          return { checks: compactTeamChecks(events), evidence: completed?.payload.evidence ?? null }
        }
        if (command.section === 'diff') { teamAssert(this.deps.workspace.detail, 'UNAVAILABLE', 'Diff inspection is unavailable.'); return this.deps.workspace.detail(snapshot.run, command) }
        const task = snapshot.tasks.find(t => t.id === command.taskId); teamAssert(command.section === 'events' || task, 'UNKNOWN_TASK', 'Select a task in this run.')
        const json = command.section === 'events' ? JSON.stringify({ events: snapshot.events, nextSequence: snapshot.events.at(-1)?.sequence ?? command.afterSequence, hasMore: snapshot.hasMoreEvents }) : JSON.stringify({ task, attempts: snapshot.attempts.filter(a => a.taskId === task!.id), integrations: snapshot.integrations.filter(i => i.taskId === task!.id) })
        const end = Math.min(json.length, command.offset + 16384)
        return { encoding: 'json-fragment', data: json.slice(command.offset, end), nextOffset: end < json.length ? end : null, totalCharacters: json.length }
      }
      case 'team_verify': { teamAssert(this.deps.workspace.verify, 'UNAVAILABLE', 'Recorded verification is unavailable.'); return this.deps.workspace.verify(this.storage.getRun(actor.runId), teamVerifySchema.parse(input)) }
      case 'team_finish': { teamAssert(this.deps.workspace.finish, 'UNAVAILABLE', 'Team finish is unavailable.'); return this.deps.workspace.finish(this.storage.getRun(actor.runId), teamFinishSchema.parse(input)) }
    }
  }
  private operation(run: TeamRun, operation: string, actor: TeamActor, requestId?: string, payload?: unknown) {
    return { runId: run.id, generation: run.generation, operation, actor: actor.role, clientRequestId: requestId, payload, eventId: this.id(), now: this.now() }
  }
  private revoke(runId: string): void {
    const old = this.leases.get(runId)
    if (old) old.revoked = true
    this.leases.delete(runId); this.ready.delete(runId); this.launchedLeads.delete(runId); this.deps.leaseRevoked?.(runId)
  }
  private issue(run: TeamRun, mode: 'normal' | 'recovery'): TeamLease {
    this.revoke(run.id)
    const members = mode === 'recovery' ? [run.config.lead] : [run.config.lead, ...run.config.helpers]
    const credentials = members.flatMap(member => {
      const fence = this.deps.credentials.inspect(member)
      teamAssert(member.authMode === 'subscription' ? fence === undefined : fence !== undefined && fence.credentialId === member.credentialProfileId && fence.providerId === member.providerId && fence.authMode === member.authMode, 'CREDENTIAL_UNAVAILABLE', 'The selected credential relationship is unavailable.')
      return fence ? [{ ...fence }] : []
    })
    const lease: TeamLease = { runId: run.id, generation: run.generation, epoch: this.id(), mode, credentials, leadCredentialId: run.config.lead.credentialProfileId, revoked: false }
    this.leases.set(run.id, lease); this.deps.leaseIssued?.(lease)
    return lease
  }
  async createRun(input: unknown, actor: TeamActor): Promise<TeamAcknowledgment> {
    this.user(actor)
    teamAssert(!this.closing, 'SHUTTING_DOWN', 'New teams cannot launch during shutdown.')
    const command = teamLaunchSchema.parse(input)
    const replay = this.storage.launchAcknowledgment(command.projectId, command.clientRequestId, command)
    if (replay) return replay
    this.deps.validateProject(command.projectId)
    await this.deps.validateMember(command.config.lead, 'lead')
    this.assertCombination(command.config.lead, 'lead')
    for (const member of command.config.helpers) {
      await this.deps.validateMember(member, 'helper'); this.assertCombination(member)
      // Model Routing Phase 4b (K4, C8): a tier main cannot serve refuses the whole launch, before anything is stored.
      const refusal = this.routingRefusal(member)
      if (refusal !== null) throw new TeamDomainError('ROUTING_REFUSED', `Helper "${scrubSecrets(member.label)}": ${refusal}`)
    }
    teamAssert(!this.closing, 'SHUTTING_DOWN', 'New teams cannot launch during shutdown.')
    this.deps.validateProject(command.projectId)
    const now = this.now(), run: TeamRun = { id: this.id(), projectId: command.projectId, leadSessionId: null, config: { ...command.config, integrationPolicy: 'lead-integrates' }, status: 'preparing', generation: 1, version: 1, policyVersion: 1, baseSha: null, integrationWorktreeId: null, integrationHead: null, createdAt: now, updatedAt: now, blocker: null }
    const acknowledgment = this.storage.createRun(run, command.clientRequestId, command, this.id())
    if (acknowledgment.runId === run.id) {
      try { this.issue(run, 'normal'); this.track(this.prepareRun(run).catch(error => { if (this.storage.getRun(run.id).status === 'preparing') this.blockRun(run.id, error instanceof TeamDomainError ? error.message : 'Team preparation failed.'); else this.drain(run.id) })) }
      catch { this.blockRun(run.id, 'Selected team authorization is unavailable.') }
      this.publish(run.id)
    }
    return acknowledgment
  }
  private async prepareRun(run: TeamRun): Promise<void> {
    const controller = new AbortController(); this.preparations.set(run.id, controller)
    const timer = setTimeout(() => controller.abort(), TEAM_LIMITS.preparationMs)
    try {
      const workspace = await this.deps.workspace.prepareRun(run, controller.signal)
      controller.signal.throwIfAborted()
      const current = this.storage.getRun(run.id), lease = this.leases.get(run.id)
      teamAssert(current.status === 'preparing' && current.generation === run.generation && lease && !lease.revoked, 'STALE_GENERATION', 'Run preparation was revoked.')
      const updated = { ...current, baseSha: workspace.baseSha, integrationHead: workspace.head, integrationWorktreeId: workspace.worktreeId, version: current.version + 1, updatedAt: this.now() }
      this.storage.command(this.operation(current, 'workspace-ready', { role: 'system' }), tx => { tx.updateRun(current.version, updated); return { acknowledgment: {}, event: { worktreeId: workspace.worktreeId, baseSha: workspace.baseSha } } })
      await this.launchLead(updated, lease)
    } finally { clearTimeout(timer); this.preparations.delete(run.id) }
  }
  private assertLeadLease(runId: string, lease: TeamLease): TeamRun {
    const run = this.storage.getRun(runId)
    this.deps.validateProject(run.projectId)
    teamAssert(this.leases.get(runId) === lease && !lease.revoked && run.generation === lease.generation && (lease.mode === 'normal' ? run.status === 'preparing' : run.status === 'recovering'), 'LEASE_REVOKED', 'Lead launch authorization changed.')
    return run
  }
  private async launchLead(run: TeamRun, lease: TeamLease): Promise<void> {
    this.stoppedLeads.delete(run.id)
    const authorization = {
      assertAuthorized: () => {
        this.assertLeadLease(run.id, lease)
        const member = run.config.lead, current = this.deps.credentials.inspect(member)
        if (member.authMode === 'subscription') teamAssert(current === undefined, 'AUTH_MODE_CHANGED', 'Lead authentication mode changed.')
        else teamAssert(current && lease.credentials.some(c => c.credentialId === member.credentialProfileId && c.fingerprint === current.fingerprint && c.providerId === current.providerId && c.routeIdentity === current.routeIdentity && c.authMode === current.authMode), 'CREDENTIAL_CHANGED', 'Lead credential changed before spawn.')
      },
      resolveCredential: async (): Promise<ResolvedCredential | undefined> => {
        this.assertLeadLease(run.id, lease)
        const member = run.config.lead, before = this.deps.credentials.inspect(member)
        if (member.authMode === 'subscription') { teamAssert(!before, 'AUTH_MODE_CHANGED', 'Subscription lead cannot use a credential fallback.'); return undefined }
        const allowed = lease.credentials.find(c => c.credentialId === member.credentialProfileId)
        teamAssert(before && allowed && JSON.stringify(before) === JSON.stringify(allowed), 'CREDENTIAL_CHANGED', 'Lead credential changed.')
        const credential = await this.deps.credentials.resolve(member, before)
        this.assertLeadLease(run.id, lease)
        teamAssert(JSON.stringify(this.deps.credentials.inspect(member)) === JSON.stringify(before), 'CREDENTIAL_CHANGED', 'Lead credential rotated during resolution.')
        return credential
      }
    }
    authorization.assertAuthorized()
    const launched = await this.deps.lead.launch(run, lease, authorization)
    try {
      const current = this.assertLeadLease(run.id, lease)
      teamAssert(!run.leadSessionId || run.leadSessionId === launched.sessionId || !!launched.replacementReason?.trim(), 'UNLABELED_REPLACEMENT', 'A replacement lead session must preserve its pointer or explicitly explain why context was not restored.')
      this.storage.command(this.operation(current, 'lead-started', { role: 'system' }), tx => { tx.updateRun(current.version, { ...current, leadSessionId: launched.sessionId, version: current.version + 1, updatedAt: this.now() }); return { acknowledgment: {}, event: { sessionId: launched.sessionId, previousSessionId: run.leadSessionId, replacementReason: launched.replacementReason ?? null } } })
      this.publish(run.id)
      this.launchedLeads.add(run.id); this.activateReady(run.id)
    } catch (error) { await this.deps.lead.stop({ ...run, leadSessionId: launched.sessionId }); throw error }
  }
  submitTask(runId: string, input: unknown, actor: TeamActor): TeamAcknowledgment {
    const run = this.storage.getRun(runId), command = teamDelegateSchema.parse(input)
    const acknowledgment = this.storeTask(run, command, actor)
    this.publish(runId); this.schedule(runId)
    return acknowledgment
  }
  private storeTask(run: TeamRun, command: ReturnType<typeof teamDelegateSchema.parse>, actor: TeamActor): TeamAcknowledgment {
    const runId = run.id
    assertLeadAuthority(run, this.leases.get(runId), actor, 'team_delegate')
    teamAssert(run.config.helpers.some(m => m.id === command.memberId), 'UNKNOWN_MEMBER', 'Helper is not in the authorized roster.')
    const tasks = this.storage.tasks(runId); assertDependencies(runId, command.dependsOn, tasks)
    const now = this.now(), task: TeamTask = { id: this.id(), runId, command, status: 'queued', version: 1, currentAttemptId: null, attemptCount: 0, readyAt: command.dependsOn.every(id => tasks.find(t => t.id === id)?.status === 'completed') ? now : null, createdAt: now, updatedAt: now, blocker: null }
    const acknowledgment = this.storage.command(this.operation(run, 'delegate', actor, command.clientRequestId, command), tx => { tx.writeTask(task); return { acknowledgment: { taskId: task.id }, event: { taskId: task.id, state: 'queued' } } })
    return acknowledgment
  }
  private async delegateMany(actor: Extract<TeamActor, { role: 'lead' }>, batch: ReturnType<typeof teamDelegateManySchema.parse>): Promise<TeamAcknowledgment> {
    const runId = actor.runId, replay = this.storage.acknowledgment(runId, 'delegate-many', batch.clientRequestId, batch)
    if (replay) return replay
    for (const task of batch.tasks) {
      const run = this.storage.getRun(runId)
      teamAssert(run.config.helpers.some(m => m.id === task.memberId), 'UNKNOWN_MEMBER', 'Helper is not in the authorized roster.')
      assertDependencies(runId, task.dependsOn, this.storage.tasks(runId))
      if (!this.storage.acknowledgment(runId, 'delegate', task.clientRequestId, task)) await this.deps.workspace.preflight?.(run, task)
    }
    this.authorizeLead(actor, 'team_delegate_many')
    const run = this.storage.getRun(runId)
    const acknowledgment = this.storage.command(this.operation(run, 'delegate-many', actor, batch.clientRequestId, batch), () => {
      const tasks = batch.tasks.map(task => this.storeTask(run, task, actor))
      return { acknowledgment: { tasks }, event: { taskIds: tasks.map(t => t.taskId) } }
    })
    this.publish(runId); this.schedule(runId); return acknowledgment
  }
  private schedule(runId: string): void {
    if (this.closing || this.pumping.has(runId)) return
    this.pumping.add(runId)
    queueMicrotask(() => { this.track((async () => {
      try {
        for (;;) {
          let snapshot = this.getSnapshot(runId)
          if (snapshot.run.status !== 'active') break
          const refreshed = snapshot.tasks.map(t => {
            let next = refreshTaskReadiness(t, snapshot.tasks, this.now())
            if (next.status === 'queued') {
              const blocker = taskScopeBusy(next, snapshot.tasks, snapshot.attempts) ? 'Waiting for earlier work on overlapping or unspecified files to finish. Independent file scopes can run in parallel.' : null
              if (next.blocker !== blocker) next = { ...next, blocker, version: t.version + 1, updatedAt: this.now() }
            }
            return next
          }).filter((t, i) => t !== snapshot.tasks[i])
          if (refreshed.length) {
            this.storage.command(this.operation(snapshot.run, 'dependencies-refreshed', { role: 'system' }), tx => { for (const task of refreshed) tx.writeTask(task, task.version - 1); return { acknowledgment: {}, event: { changedTasks: refreshed.length } } })
            snapshot = this.getSnapshot(runId)
          }
          if (!snapshot.tasks.some(t => t.status === 'queued' && dependencyState(t, snapshot.tasks) === 'ready') || snapshot.attempts.filter(holdsSlot).length >= snapshot.run.config.concurrency) break
          if (this.deps.workspace.refreshIntegrationHead) {
            await this.deps.workspace.refreshIntegrationHead(snapshot.run)
            snapshot = this.getSnapshot(runId)
            if (snapshot.run.status !== 'active' || this.closing) break
          }
          const lease = this.leases.get(runId)
          assertDispatchFence(snapshot.run, lease, { generation: snapshot.run.generation, epoch: lease?.epoch ?? '' })
          const reservation = reserveNextAttempt(snapshot.run, snapshot.tasks, snapshot.attempts, this.id(), this.now())
          if (!reservation) break
          this.storage.command(this.operation(snapshot.run, 'attempt-reserved', { role: 'system' }), tx => { tx.writeAttempt(reservation.attempt); tx.writeTask(reservation.task, reservation.task.version - 1); return { acknowledgment: { attemptId: reservation.attempt.id }, event: { taskId: reservation.task.id, attemptId: reservation.attempt.id, number: reservation.attempt.number } } })
          this.track(this.executeAttempt(snapshot.run, reservation.task, reservation.attempt, lease!).catch(() => this.blockRun(runId, 'Helper preparation or ownership could not be settled.')))
        }
      } catch { if (this.storage.getRun(runId).status === 'active') this.blockRun(runId, 'Team dispatch was blocked by changed workspace state or authorization.') }
      finally { this.pumping.delete(runId) }
    })()) })
  }
  private async executeAttempt(run: TeamRun, task: TeamTask, original: TeamAttempt, lease: TeamLease): Promise<void> {
    const controller = new AbortController(); this.preparations.set(original.id, controller)
    const timer = setTimeout(() => {
      try {
        const freshRun = this.storage.getRun(run.id), attempt = this.storage.attempts(run.id).find(a => a.id === original.id)
        if (attempt?.status === 'preparing' && !attempt.terminalIntent) this.storage.command(this.operation(freshRun, 'preparation-timeout', { role: 'system' }), tx => { tx.writeAttempt(requestAttemptTermination(attempt, 'timed-out'), attempt.version); return { acknowledgment: {}, event: { attemptId: attempt.id } } })
      } catch { this.blockRun(run.id, 'Preparation timeout could not be recorded.') }
      finally { controller.abort() }
    }, TEAM_LIMITS.preparationMs)
    let spawned = false, spawnedAt = this.now(), helper: Pick<HelperProcess, 'done' | 'identified' | 'cancel' | 'inspect'> | undefined
    try {
      const member = run.config.helpers.find(m => m.id === original.memberId)!
      await this.deps.validateMember(member, 'helper')
      assertDispatchFence(this.storage.getRun(run.id), this.leases.get(run.id), { generation: original.generation, epoch: lease.epoch })
      const workspace = await this.deps.workspace.prepareAttempt(run, original, controller.signal)
      controller.signal.throwIfAborted()
      teamAssert(workspace.baseSha === original.baseSha, 'WRONG_BASE', 'Attempt workspace differs from its reserved integration base.')
      let current = this.storage.attempts(run.id).find(a => a.id === original.id)!
      teamAssert(current.status === 'preparing' && !current.terminalIntent, 'ATTEMPT_REVOKED', 'Attempt preparation was cancelled.')
      this.storage.command(this.operation(run, 'attempt-workspace-ready', { role: 'system' }), tx => { tx.writeAttempt({ ...current, worktreeId: workspace.worktreeId, version: current.version + 1 }, current.version); return { acknowledgment: {}, event: { attemptId: current.id, worktreeId: workspace.worktreeId } } })
      await this.deps.validateMember(member, 'helper')
      const fence = this.deps.credentials.inspect(member), expected = { generation: original.generation, epoch: lease.epoch, credential: fence }
      teamAssert(member.authMode === 'subscription' ? fence === undefined : fence !== undefined, 'CREDENTIAL_UNAVAILABLE', 'Selected credential is unavailable.')
      assertDispatchFence(this.storage.getRun(run.id), this.leases.get(run.id), expected, this.deps.credentials.inspect(member))
      // Model Routing Phase 4b (K8, C9, MR-D32): this attempt's tier, resolved on main's own numbers immediately before the
      // decrypt. A refusal throws into preparation-failed below: no decrypt, no spawn, the attempt consumed. The selection
      // is recorded on the attempt (K9) before the decrypt, so what was sent can never be lost.
      const routing = this.resolveRouting(member)
      if (routing !== null) {
        current = this.storage.attempts(run.id).find(a => a.id === original.id)!
        teamAssert(current.status === 'preparing' && !current.terminalIntent, 'ATTEMPT_REVOKED', 'Attempt preparation was cancelled.')
        this.storage.command(this.operation(run, 'helper-routing-resolved', { role: 'system' }), tx => { tx.writeAttempt({ ...current, routing, version: current.version + 1 }, current.version); return { acknowledgment: {}, event: { attemptId: current.id, tier: routing.tier, sentModelId: routing.sentModelId, endpoints: [...routing.endpoints] } } })
      }
      let credential: ResolvedCredential | undefined
      if (fence) credential = await this.deps.credentials.resolve(member, fence)
      const authorize = () => {
        controller.signal.throwIfAborted()
        this.deps.validateProject(run.projectId)
        const fresh = this.storage.attempts(run.id).find(a => a.id === original.id)
        teamAssert(fresh?.status === 'preparing' && fresh.generation === original.generation && !fresh.terminalIntent && Date.parse(this.now()) < Date.parse(fresh.preparationDeadline), 'ATTEMPT_REVOKED', 'Attempt spawn is no longer authorized.')
        assertDispatchFence(this.storage.getRun(run.id), this.leases.get(run.id), expected, this.deps.credentials.inspect(member))
      }
      try {
        authorize()
        const route = this.deps.credentials.route(member)
        teamAssert(allowedHelperCombination({ id: member.harness, version: member.installedVersion, authMode: member.authMode, model: routing?.sentModelId ?? member.model, baseUrl: route?.baseUrl, customModel: member.customModel }), 'UNVERIFIED_COMBINATION', 'This exact helper configuration has not passed compatibility checks.')
        const adapter = helperRegistry[member.harness]
        const request = adapter.buildExecution({ attemptId: original.id, cwd: workspace.cwd, kind: task.command.kind, brief: original.brief + '\n\nFILE OWNERSHIP: ' + (task.command.paths.join(', ') || 'Unspecified; do not assume other helpers can edit alongside you.') + '\nEdit only these outputs and their assigned private build/test files. Shared templates and references are read-only. Report required shared changes to the lead. Do not edit another helper\'s files.\nSupported exact check commands: ' + helperCheckCommands(run.config.verificationProfile).join('; ') + '. Do not use compound shell commands or unsupported arguments. Return a short summary, changed files, checks and remaining blockers.', originalBrief: original.number > 1 ? this.storage.attempts(run.id).find(a => a.taskId === task.id && a.number === 1)?.brief : undefined, roleInstructions: member.instructions, context: original.context, acceptance: original.acceptance, references: task.command.references, model: member.model, installedVersion: member.installedVersion, effort: member.effort ?? undefined, credential, route, windowsSandbox: 'elevated', allowedCommands: helperCheckCommands(run.config.verificationProfile), ...(routing ? { routing } : {}), signal: controller.signal })
        request.envAdditions.CHORUS_HELPER_OWNED_PATHS = JSON.stringify(task.command.paths)
        current = this.storage.attempts(run.id).find(a => a.id === original.id)!
        // A crash between OS spawn and identity publication must never look like a known unspawned attempt.
        this.storage.command(this.operation(run, 'helper-spawn-intent', { role: 'system' }), tx => { tx.writeAttempt({ ...current, cessation: 'unknown', version: current.version + 1 }, current.version); return { acknowledgment: {}, event: { attemptId: original.id } } })
        spawnedAt = this.now()
        helper = this.deps.executor.spawnHelper(original.id, { request, parser: adapter.createParser(), executionMs: run.config.executionMinutes * 60000, authorizeSpawn: authorize, onEvent: event => this.helperActivity(run.id, task.id, original.id, event), onCessationConfirmed: () => this.confirmAttemptCessation(run.id, original.id), onProcessObservation: (process, descendants) => {
          const freshRun = this.storage.getRun(run.id), fresh = this.storage.attempts(run.id).find(a => a.id === original.id)!
          teamAssert(!fresh.process || fresh.process.pid === process.pid && fresh.process.creationTime === process.creationTime && fresh.process.executable === process.executable, 'PROCESS_IDENTITY_CHANGED', 'Helper root identity cannot change.')
          this.storage.command(this.operation(freshRun, 'helper-process-observed', { role: 'system' }), tx => {
            tx.writeAttempt({ ...fresh, process, descendants, version: fresh.version + 1 }, fresh.version)
            return { acknowledgment: {}, event: { attemptId: fresh.id, process, descendants, retired: fresh.descendants.filter(p => !descendants.some(live => live.pid === p.pid && live.creationTime === p.creationTime)) } }
          })
        }, onTerminationIntent: intent => {
          try {
          const freshRun = this.storage.getRun(run.id), fresh = this.storage.attempts(run.id).find(a => a.id === original.id)!
          if (fresh.terminalIntent) return
          if (!['preparing', 'running'].includes(fresh.status)) {
            if (holdsSlot(fresh)) this.storage.command(this.operation(freshRun, 'helper-retirement-intent', { role: 'system' }), () => ({ acknowledgment: {}, event: { attemptId: fresh.id, intent } }))
            return
          }
          this.storage.command(this.operation(freshRun, 'termination-intent', { role: 'system' }), tx => { tx.writeAttempt(requestAttemptTermination(fresh, intent), fresh.version); return { acknowledgment: {}, event: { attemptId: fresh.id, intent } } })
          } catch (error) { this.blockRun(run.id, 'Termination intent could not be recorded; the owned process remains a recovery blocker.'); throw error }
        } })
        spawned = true
        clearTimeout(timer)
        this.track(helper.done.then(outcome => this.finishAttempt(run.id, task.id, original.id, outcome)).catch(() => this.blockRun(run.id, 'Helper outcome could not be recorded.')))
      } finally { credential = undefined }
      const process = await helper!.identified
      current = this.storage.attempts(run.id).find(a => a.id === original.id)!
      const liveRun = this.storage.getRun(run.id)
      try {
        authorize()
        const started = startAttempt(liveRun, current, process, spawnedAt)
        this.storage.command(this.operation(liveRun, 'helper-started', { role: 'system' }), tx => { tx.writeAttempt(started, current.version); return { acknowledgment: {}, event: { attemptId: original.id, process } } })
      } catch { await helper!.cancel('cancelled') }
      this.publish(run.id)
    } catch (error) {
      if (spawned) { await helper?.cancel('cancelled'); return }
      const snapshot = this.getSnapshot(run.id), attempt = snapshot.attempts.find(a => a.id === original.id)!, currentTask = snapshot.tasks.find(t => t.id === task.id)!
      if (['preparing', 'cancelling'].includes(attempt.status)) {
        const reason = fitUtf8(scrubSecrets(error instanceof Error ? error.message : 'Preparation or spawn authorization failed.'), 3500)
        const failed = failPreparation(snapshot.run, currentTask, attempt, this.now(), `${reason} This attempt was consumed.`)
        this.storage.command(this.operation(snapshot.run, 'preparation-failed', { role: 'system' }), tx => { tx.writeAttempt(failed.attempt, attempt.version); if (failed.task.version !== currentTask.version) tx.writeTask(failed.task, currentTask.version); return { acknowledgment: {}, event: { attemptId: original.id } } })
        this.publish(run.id); this.drain(run.id); this.schedule(run.id)
      }
    } finally { clearTimeout(timer); this.preparations.delete(original.id) }
  }
  private async finishAttempt(runId: string, taskId: string, attemptId: string, outcome: HelperProcessOutcome): Promise<void> {
    this.flushActivity(attemptId); this.activity.delete(attemptId)
    let snapshot = this.getSnapshot(runId), task = snapshot.tasks.find(t => t.id === taskId)!, attempt = snapshot.attempts.find(a => a.id === attemptId)!
    if (outcome.intent && !attempt.terminalIntent) attempt = requestAttemptTermination(attempt, outcome.intent)
    const settled = settleAttempt(snapshot.run, task, attempt, { generation: attempt.generation, attemptId, exitCode: outcome.exitCode, cessation: outcome.cessation, result: outcome.result ? { summary: outcome.result.summary, isError: outcome.result.isError, tests: [], ...(outcome.result.failure ? { failure: outcome.result.failure } : {}) } : null, permissionBlocked: outcome.permissionBlocked, protocolError: outcome.protocolError, now: this.now() })
    if (!settled.changed) return
    // Termination intent and terminal outcome may be one transaction when timeout originated in the executor.
    const persisted = snapshot.attempts.find(a => a.id === attemptId)!
    // Model Routing Phase 4b (K12, C3): a routed attempt that ends with OpenCode's generic provider error names its tier and
    // what to do; result.summary keeps the parser's text. Chorus never changes a helper's tier on its own.
    const failureText = (result: NonNullable<HelperProcessOutcome['result']>): string => persisted.routing && result.failure?.category === 'provider-error' ? `${result.summary} ${routedHelperFailureNote(persisted.routing)}` : result.summary
    const blocker = (outcome.permissionBlocked || outcome.protocolError) && persisted.blocker ? persisted.blocker : outcome.result?.failure && outcome.cessation === 'confirmed' && !outcome.intent ? failureText(outcome.result).slice(0, 3000) : settled.attempt.blocker
    const next = { ...settled.attempt, blocker, version: persisted.version + 1, process: outcome.process, descendants: outcome.descendants, usage: outcome.usage }
    if (blocker) settled.task.blocker = blocker
    const validating = next.status === 'succeeded' && settled.task.currentAttemptId === attemptId && snapshot.run.generation === next.generation
    this.storage.command(this.operation(snapshot.run, 'helper-exited', { role: 'system' }), tx => { tx.writeAttempt(next, persisted.version); if (settled.task.version !== task.version) tx.writeTask(validating ? { ...settled.task, status: 'running', blocker: 'Validating the isolated result.' } : settled.task, task.version); return { acknowledgment: {}, event: { attemptId, status: next.status, cessation: next.cessation } } })
    if (next.status === 'succeeded') {
      try {
        await this.deps.workspace.validateResult(snapshot.run, settled.task, next)
        snapshot = this.getSnapshot(runId); task = snapshot.tasks.find(t => t.id === taskId)!
        if (validating && task.currentAttemptId === attemptId && task.status === 'running' && snapshot.run.generation === next.generation) this.storage.command(this.operation(snapshot.run, 'result-validated', { role: 'system' }), tx => { tx.writeTask({ ...task, status: 'awaiting-review', blocker: null, version: task.version + 1, updatedAt: this.now() }, task.version); return { acknowledgment: {}, event: { attemptId } } })
      }
      catch (error) {
        snapshot = this.getSnapshot(runId); task = snapshot.tasks.find(t => t.id === taskId)!
        const reason = fitUtf8(scrubSecrets(error instanceof Error ? error.message : 'The isolated result failed workspace validation.'), 3500)
        if (task.currentAttemptId === attemptId && task.status === 'running' && snapshot.run.generation === next.generation) this.storage.command(this.operation(snapshot.run, 'result-validation-failed', { role: 'system' }), tx => { tx.writeTask({ ...task, status: 'blocked', blocker: reason, version: task.version + 1, updatedAt: this.now() }, task.version); return { acknowledgment: {}, event: { attemptId, reason } } })
      }
    }
    this.publish(runId); this.drain(runId); this.schedule(runId)
  }
  private confirmAttemptCessation(runId: string, attemptId: string): void {
    const snapshot = this.getSnapshot(runId), attempt = snapshot.attempts.find(a => a.id === attemptId)
    teamAssert(attempt && ['succeeded', 'failed', 'interrupted', 'timed-out', 'cancelled', 'permission-blocked'].includes(attempt.status), 'OUTCOME_PENDING', 'Record the terminal outcome before releasing its process reservation.')
    if (attempt.cessation === 'confirmed') return
    const task = snapshot.tasks.find(t => t.currentAttemptId === attempt.id)
    const reason = 'Owned processes are confirmed stopped. This attempt remains unsuccessful; an explicit counted revision is required.'
    this.storage.command(this.operation(snapshot.run, 'helper-cessation-confirmed', { role: 'system' }), tx => {
      tx.writeAttempt({ ...attempt, cessation: 'confirmed', version: attempt.version + 1, blocker: reason }, attempt.version)
      if (task?.status === 'blocked') tx.writeTask({ ...task, blocker: reason, version: task.version + 1, updatedAt: this.now() }, task.version)
      return { acknowledgment: {}, event: { attemptId } }
    })
    this.publish(runId); this.drain(runId); this.schedule(runId)
  }
  revise(runId: string, input: unknown, actor: TeamActor): TeamAcknowledgment {
    const command = teamReviseSchema.parse(input), snapshot = this.getSnapshot(runId)
    assertLeadAuthority(snapshot.run, this.leases.get(runId), actor, 'team_revise')
    const task = snapshot.tasks.find(t => t.id === command.taskId); teamAssert(task, 'UNKNOWN_TASK', 'Task does not belong to this run.')
    const acknowledgment = this.storage.command(this.operation(snapshot.run, 'revise', actor, command.clientRequestId, command), tx => {
      tx.writeTask(reviseTask(snapshot.run, task, snapshot.attempts, command.memberId, command.brief, this.now()), task.version)
      for (const integration of snapshot.integrations.filter(i => i.taskId === task.id && !['applied', 'applying', 'preparing', 'rejected'].includes(i.status))) tx.writeIntegration({ ...integration, status: 'rejected', blocker: 'Superseded by an explicit counted revision; evidence retained.', version: integration.version + 1, updatedAt: this.now() }, integration.version)
      return { acknowledgment: { taskId: task.id, nextAttempt: task.attemptCount + 1 }, event: { taskId: task.id, nextAttempt: task.attemptCount + 1 } }
    })
    this.publish(runId); this.schedule(runId); return acknowledgment
  }
  cancelTask(runId: string, input: unknown, actor: TeamActor): TeamAcknowledgment {
    const command = teamCancelSchema.parse(input), snapshot = this.getSnapshot(runId)
    assertLeadAuthority(snapshot.run, this.leases.get(runId), actor, 'team_cancel')
    const task = snapshot.tasks.find(t => t.id === command.taskId); teamAssert(task, 'UNKNOWN_TASK', 'Task does not belong to this run.')
    const attempt = snapshot.attempts.find(a => a.id === task.currentAttemptId)
    const acknowledgment = this.storage.command(this.operation(snapshot.run, 'cancel', actor, command.clientRequestId, command), tx => {
      teamAssert(!['completed', 'integrating'].includes(task.status), 'NOT_CANCELLABLE', 'Completed or applying work cannot be cancelled by this operation.')
      if (attempt && !['succeeded', 'failed', 'interrupted', 'timed-out', 'cancelled', 'permission-blocked'].includes(attempt.status)) tx.writeAttempt(requestAttemptTermination(attempt, 'cancelled'), attempt.version)
      tx.writeTask({ ...task, status: 'cancelled', version: task.version + 1, updatedAt: this.now(), blocker: null }, task.version)
      for (const integration of snapshot.integrations.filter(i => i.taskId === task.id && !['applied', 'applying', 'preparing', 'rejected'].includes(i.status))) tx.writeIntegration({ ...integration, status: 'rejected', blocker: 'Task cancelled; prepared evidence retained.', version: integration.version + 1, updatedAt: this.now() }, integration.version)
      return { acknowledgment: { taskId: task.id }, event: { taskId: task.id, reason: scrubSecrets(command.reason) } }
    })
    if (attempt) { this.preparations.get(attempt.id)?.abort(); this.track(this.deps.executor.cancelHelper(attempt.id).catch(() => this.blockRun(runId, 'Helper cancellation could not confirm cessation.'))) }
    this.publish(runId); return acknowledgment
  }
  async review(runId: string, input: unknown, actor: TeamActor): Promise<TeamAcknowledgment> {
    const command = teamReviewSchema.parse(input), snapshot = this.getSnapshot(runId)
    assertLeadAuthority(snapshot.run, this.leases.get(runId), actor, 'team_review')
    const replay = this.storage.acknowledgment(runId, 'review', command.clientRequestId, command)
    if (replay) return replay
    const task = snapshot.tasks.find(t => t.id === command.taskId), attempt = snapshot.attempts.find(a => a.id === command.attemptId)
    if (task?.command.kind === 'code') {
      teamAssert(this.deps.workspace.review, 'WORKSPACE_PROTOCOL_UNAVAILABLE', 'Code review requires the verified artifact/integration workspace protocol.')
      const result = await this.deps.workspace.review(snapshot.run, command, actor)
      this.publish(runId); this.drain(runId); this.schedule(runId)
      return result
    }
    teamAssert(task && task.status === 'awaiting-review' && attempt && attempt.taskId === task.id && task.currentAttemptId === attempt.id && attempt.status === 'succeeded' && attempt.cessation === 'confirmed', 'NOT_REVIEWABLE', 'Review requires the current stopped and validated successful attempt.')
    if (task.command.kind === 'analysis') {
      teamAssert(command.phase === 'artifact' && !command.reviewedSha && !command.integrationId, 'INVALID_REVIEW', 'Analysis review does not use a Git artifact SHA.')
      const acknowledgment = this.storage.command(this.operation(snapshot.run, 'review', actor, command.clientRequestId, command), tx => { tx.writeTask({ ...task, status: command.decision === 'accept' ? 'completed' : 'needs-revision', version: task.version + 1, updatedAt: this.now() }, task.version); return { acknowledgment: { decisionId: command.clientRequestId, taskId: task.id }, event: { review: command as unknown as TeamJson } } })
      this.publish(runId); this.schedule(runId); return acknowledgment
    }
    teamAssert(this.deps.workspace.review, 'WORKSPACE_PROTOCOL_UNAVAILABLE', 'Code review requires the verified artifact/integration workspace protocol.')
    return this.deps.workspace.review(snapshot.run, command, actor)
  }
  private async reviewMany(actor: Extract<TeamActor, { role: 'lead' }>, batch: ReturnType<typeof teamReviewManySchema.parse>): Promise<TeamAcknowledgment> {
    const runId = actor.runId, snapshot = this.getSnapshot(runId)
    const replay = this.storage.acknowledgment(runId, 'review-many', batch.clientRequestId, batch)
    if (replay) return replay
    const tasks = batch.reviews.map(r => snapshot.tasks.find(t => t.id === r.taskId))
    teamAssert(tasks.every(Boolean), 'UNKNOWN_TASK', 'Review task does not belong to this run.')
    let acknowledgment: TeamAcknowledgment
    if (tasks.every(t => t!.command.kind === 'code')) {
      teamAssert(this.deps.workspace.reviewMany, 'WORKSPACE_PROTOCOL_UNAVAILABLE', 'Batch code review requires the verified workspace protocol.')
      acknowledgment = await this.deps.workspace.reviewMany(snapshot.run, batch, actor)
    } else {
      teamAssert(tasks.every(t => t!.command.kind === 'analysis'), 'INVALID_REVIEW', 'Batch code and analysis reviews separately.')
      for (const command of batch.reviews) {
        if (this.storage.acknowledgment(runId, 'review', command.clientRequestId, command)) continue
        const task = snapshot.tasks.find(t => t.id === command.taskId)!, attempt = snapshot.attempts.find(a => a.id === command.attemptId)
        teamAssert(task.status === 'awaiting-review' && attempt?.taskId === task.id && task.currentAttemptId === attempt.id && attempt.status === 'succeeded' && attempt.cessation === 'confirmed', 'NOT_REVIEWABLE', 'Analysis review requires the current stopped successful attempt.')
        teamAssert(command.phase === 'artifact' && !command.reviewedSha && !command.integrationId && !command.verificationIds?.length, 'INVALID_REVIEW', 'Analysis review does not use a Git artifact or check references.')
      }
      this.authorizeLead(actor, 'team_review_many')
      acknowledgment = this.storage.command(this.operation(snapshot.run, 'review-many', actor, batch.clientRequestId, batch), () => {
        const reviews = batch.reviews.map(command => {
          const task = snapshot.tasks.find(t => t.id === command.taskId)!
          return this.storage.command(this.operation(snapshot.run, 'review', actor, command.clientRequestId, command), tx => {
            tx.writeTask({ ...task, status: command.decision === 'accept' ? 'completed' : 'needs-revision', version: task.version + 1, updatedAt: this.now() }, task.version)
            return { acknowledgment: { decisionId: command.clientRequestId, taskId: task.id }, event: { review: command as unknown as TeamJson } }
          })
        })
        return { acknowledgment: { reviews }, event: { taskIds: batch.reviews.map(r => r.taskId) } }
      })
    }
    this.publish(runId); this.drain(runId); this.schedule(runId); return acknowledgment
  }
  async integrate(runId: string, input: unknown, actor: TeamActor): Promise<TeamAcknowledgment> {
    const command = teamIntegrateSchema.parse(input), run = this.storage.getRun(runId)
    assertLeadAuthority(run, this.leases.get(runId), actor, 'team_integrate')
    teamAssert(this.deps.workspace.integrate, 'WORKSPACE_PROTOCOL_UNAVAILABLE', 'Integration requires the verified workspace protocol.')
    return this.deps.workspace.integrate(run, command, actor)
  }
  async decideIntegration(input: unknown, actor: TeamActor): Promise<TeamAcknowledgment> {
    this.user(actor); const command = teamIntegrationDecisionSchema.parse(input), run = this.storage.getRun(command.runId)
    teamAssert(this.deps.workspace.decideIntegration, 'WORKSPACE_PROTOCOL_UNAVAILABLE', 'Integration decisions require the verified workspace protocol.')
    return this.deps.workspace.decideIntegration(run, command, actor)
  }
  async wait(runId: string, taskIds: readonly string[], afterSequence: number, timeoutMs: number, signal: AbortSignal): Promise<TeamSnapshot> {
    teamAssert(timeoutMs >= 0 && timeoutMs <= TEAM_LIMITS.waitMs, 'INVALID_TIMEOUT', 'Wait timeout is out of range.')
    let snapshot = this.getSnapshot(runId, afterSequence)
    teamAssert(taskIds.every(id => snapshot.tasks.some(t => t.id === id)), 'UNKNOWN_TASK', 'Wait task does not belong to this run.')
    if (this.storage.actionableCursor(runId, taskIds) > afterSequence || timeoutMs === 0 || signal.aborted) return snapshot
    await new Promise<void>(resolve => {
      const finish = () => { clearTimeout(timer); unsubscribe(); signal.removeEventListener('abort', finish); resolve() }
      const unsubscribe = this.subscribe(next => { if (next.run.id === runId && this.storage.actionableCursor(runId, taskIds) > afterSequence) finish() })
      const timer = setTimeout(finish, timeoutMs); signal.addEventListener('abort', finish, { once: true })
      if (signal.aborted || this.storage.actionableCursor(runId, taskIds) > afterSequence) finish()
    })
    snapshot = this.getSnapshot(runId, afterSequence)
    return snapshot
  }
  /** Broker segments stay short; the stdio facade holds the single lead call open. */
  private async waitDecision(runId: string, command: ReturnType<typeof teamWaitSchema.parse>, signal: AbortSignal): Promise<{ snapshot: TeamSnapshot; wakeReason: string }> {
    const initial = this.getSnapshot(runId)
    teamAssert(command.taskIds.every(id => initial.tasks.some(t => t.id === id)), 'UNKNOWN_TASK', 'Wait task does not belong to this run.')
    teamAssert(command.verificationIds.every(id => this.storage.verificationEvents(runId, id).some(e => e.payload.verificationId === id)), 'UNKNOWN_CHECK', 'Wait verification ID does not belong to this run.')
    const reason = (): string | null => {
      const snapshot = this.getSnapshot(runId)
      if (!['active', 'preparing', 'finishing'].includes(snapshot.run.status)) return 'intervention'
      if (command.target === 'finish') {
        if (snapshot.run.finish?.status === 'blocked') return 'intervention'
        if (['cleaned', 'retained'].includes(snapshot.run.finish?.status ?? '')) return 'ready'
      } else if (command.target === 'checks') {
        // Inspect each selected ID independently; compact projections intentionally bound history.
        const states = command.verificationIds.map(id => compactTeamChecks(this.storage.verificationEvents(runId, id)).find(c => c.id === id)?.status)
        if (states.some(s => s === 'failed' || s === 'blocked')) return 'intervention'
        if (states.every(s => s === 'passed')) return 'ready'
      } else {
        const tasks = snapshot.tasks.filter(t => command.taskIds.includes(t.id))
        for (const task of tasks) {
          if (this.storage.actionableCursor(runId, [task.id], true) <= command.afterSequence) continue
          if (['failed', 'blocked', 'needs-revision', 'cancelled'].includes(task.status)) return 'intervention'
          if (['awaiting-review', 'awaiting-approval', 'completed'].includes(task.status)) return 'ready'
          if (snapshot.attempts.find(a => a.id === task.currentAttemptId)?.blocker && task.blocker !== 'Validating the isolated result.') return 'intervention'
        }
      }
      return null
    }
    let wakeReason = reason()
    if (!wakeReason && command.timeoutMs > 0 && !signal.aborted) await new Promise<void>(resolve => {
      let done = false
      const finish = () => { if (done) return; done = true; clearTimeout(timer); unsubscribe(); signal.removeEventListener('abort', finish); resolve() }
      const unsubscribe = this.subscribe(next => { if (next.run.id === runId) { wakeReason = reason(); if (wakeReason) finish() } })
      const timer = setTimeout(finish, Math.min(command.timeoutMs, TEAM_LIMITS.waitMs))
      signal.addEventListener('abort', finish, { once: true })
      wakeReason = reason(); if (wakeReason || signal.aborted) finish()
    })
    return { snapshot: this.getSnapshot(runId), wakeReason: signal.aborted ? 'cancelled' : wakeReason ?? reason() ?? 'timeout' }
  }
  async lifecycle(input: unknown, actor: TeamActor): Promise<TeamAcknowledgment> {
    this.user(actor); const command = teamLifecycleSchema.parse(input)
    teamAssert(!this.closing || command.action === 'stop', 'SHUTTING_DOWN', 'Only Stop is available during shutdown.')
    const replay = this.storage.acknowledgment(command.runId, command.action, command.clientRequestId, command)
    if (replay) return replay
    let snapshot = this.getSnapshot(command.runId), run = snapshot.run
    teamAssert(run.version === command.expectedVersion, 'STALE_VERSION', 'Run state changed; refresh before this action.')
    let recovery: Awaited<ReturnType<TeamServiceDependencies['workspace']['inspectRecovery']>> | undefined, priorLeadStopped = false
    if (command.action === 'resume' || command.action === 'recover') {
      priorLeadStopped = await this.deps.lead.stopped(run); recovery = await this.deps.workspace.inspectRecovery(run)
      await this.deps.validateMember(run.config.lead, 'lead')
      teamAssert(!run.finish || !['cleaned', 'retained'].includes(run.finish.status), 'RUN_ARCHIVED', 'This finished Team is an archive. Start a new Team from its result.')
      this.assertCombination(run.config.lead, 'lead')
      if (command.action === 'resume') for (const member of run.config.helpers) { await this.deps.validateMember(member, 'helper'); this.assertCombination(member) }
      const replayAfterInspection = this.storage.acknowledgment(command.runId, command.action, command.clientRequestId, command)
      if (replayAfterInspection) return replayAfterInspection
      snapshot = this.getSnapshot(run.id); run = snapshot.run
      teamAssert(!this.closing, 'SHUTTING_DOWN', 'Teams cannot resume during shutdown.')
      teamAssert(run.version === command.expectedVersion, 'STALE_VERSION', 'Run changed during recovery inspection.')
    }
    const next = transitionRun(run, command.action, { now: this.now(), bridgeReady: this.ready.get(run.id) === this.leases.get(run.id)?.epoch && this.ready.has(run.id), priorLeadStopped, ...recovery,
      drained: canFinishDraining(run, snapshot.attempts, snapshot.integrations), unfinished: snapshot.tasks.some(t => !['completed', 'cancelled'].includes(t.status)) || snapshot.integrations.some(i => !['applied', 'rejected'].includes(i.status)) })
    const acknowledgment = this.storage.command(this.operation(run, command.action, actor, command.clientRequestId, command), tx => {
      tx.updateRun(run.version, next)
      if (command.action === 'stop') {
        for (const attempt of snapshot.attempts.filter(a => !['succeeded', 'failed', 'interrupted', 'timed-out', 'cancelled', 'permission-blocked'].includes(a.status))) tx.writeAttempt(requestAttemptTermination(attempt, 'cancelled'), attempt.version)
        for (const task of snapshot.tasks.filter(t => t.status === 'queued')) tx.writeTask({ ...task, status: 'cancelled', version: task.version + 1, updatedAt: this.now() }, task.version)
      }
      return { acknowledgment: { runId: run.id, status: next.status, generation: next.generation }, event: { status: next.status } }
    })
    if (['paused', 'stopping', 'completed'].includes(next.status)) this.revoke(run.id)
    if (command.action === 'stop') {
      this.preparations.get(run.id)?.abort()
      for (const attempt of snapshot.attempts.filter(holdsSlot)) { this.preparations.get(attempt.id)?.abort(); this.track(this.deps.executor.cancelHelper(attempt.id).catch(() => this.blockRun(run.id, 'Helper cancellation could not confirm cessation.'))) }
      this.track(this.deps.lead.stop(run).then(stopped => { if (stopped) { this.stoppedLeads.add(run.id); this.drain(run.id, true) } }).catch(() => this.blockRun(run.id, 'Lead process cessation is unknown.')))
    } else if (command.action === 'resume' || command.action === 'recover') {
      try { const lease = this.issue(next, command.action === 'recover' ? 'recovery' : 'normal'); this.track(this.launchLead(next, lease).catch(() => this.blockRun(run.id, 'Lead replacement failed.'))) }
      catch { this.blockRun(run.id, 'Selected credentials could not be reauthorized.') }
    } else if (command.action === 'activate') this.schedule(run.id)
    this.publish(run.id); return acknowledgment
  }
  private drain(runId: string, leadStopped = false): void {
    leadStopped ||= this.stoppedLeads.has(runId)
    const snapshot = this.getSnapshot(runId), run = snapshot.run
    if (!canFinishDraining(run, snapshot.attempts, snapshot.integrations)) return
    if (run.status !== 'pausing' && !(run.status === 'stopping' && leadStopped)) return
    const next = transitionRun(run, run.status === 'pausing' ? 'drained' : 'stopped', { now: this.now(), drained: true, priorLeadStopped: leadStopped })
    this.storage.command(this.operation(run, 'run-drained', { role: 'system' }), tx => { tx.updateRun(run.version, next); return { acknowledgment: {}, event: { status: next.status } } })
    this.revoke(runId); this.publish(runId)
  }
  private blockRun(runId: string, reason: string): void {
    this.revoke(runId)
    try {
      const run = this.storage.getRun(runId)
      if (['stopped', 'completed'].includes(run.status)) return
      this.storage.command(this.operation(run, 'run-blocked', { role: 'system' }), tx => { tx.updateRun(run.version, { ...run, status: run.status === 'stopping' ? 'stopping' : 'blocked', blocker: scrubSecrets(reason), version: run.version + 1, updatedAt: this.now() }); return { acknowledgment: {}, event: { reason: scrubSecrets(reason) } } })
      this.publish(runId)
    } catch { this.unavailableRuns.set(runId, 'Team storage is unavailable or corrupt; this run is blocked and authorization is revoked.') }
  }
  /** App composition awaits this before closing storage. Unknown writers remain durable blockers. */
  async shutdown(): Promise<{ complete: boolean; blockedRunIds: string[] }> {
    this.closing = true
    for (const id of this.activity.keys()) this.flushActivity(id)
    const runs = this.storage.listRunIds()
    for (const runId of runs) this.revoke(runId)
    for (const runId of runs) {
      try {
        const snapshot = this.getSnapshot(runId), run = snapshot.run
        if (['stopped', 'completed'].includes(run.status)) continue
        const next = run.status === 'stopping' ? run : transitionRun(run, 'stop', { now: this.now() })
        this.storage.command(this.operation(run, 'shutdown-intent', { role: 'system' }), tx => {
          if (next !== run) tx.updateRun(run.version, next)
          for (const attempt of snapshot.attempts.filter(a => ['preparing', 'running'].includes(a.status))) tx.writeAttempt(requestAttemptTermination(attempt, 'cancelled'), attempt.version)
          for (const task of snapshot.tasks.filter(t => t.status === 'queued')) tx.writeTask({ ...task, status: 'cancelled', version: task.version + 1, updatedAt: this.now() }, task.version)
          return { acknowledgment: {}, event: { status: 'stopping' } }
        })
        this.preparations.get(runId)?.abort()
        for (const attempt of snapshot.attempts.filter(holdsSlot)) { this.preparations.get(attempt.id)?.abort(); this.track(this.deps.executor.cancelHelper(attempt.id).catch(() => this.blockRun(runId, 'Shutdown could not confirm helper cessation.'))) }
        this.track(this.deps.lead.stop(run).then(stopped => { if (stopped) { this.stoppedLeads.add(runId); this.drain(runId, true) } }).catch(() => this.blockRun(runId, 'Shutdown could not confirm lead cessation.')))
      } catch { this.unavailableRuns.set(runId, 'Team shutdown could not record state; authorization is revoked and recovery is required.') }
    }
    const deadline = Date.now() + 30000
    if (this.deps.workspace.settle) this.track(this.deps.workspace.settle())
    while (this.inFlight.size && Date.now() < deadline) await Promise.race([Promise.allSettled([...this.inFlight]), new Promise(resolve => setTimeout(resolve, 100))])
    const blockedRunIds = runs.filter(runId => { try { return !['stopped', 'completed'].includes(this.getSnapshot(runId).run.status) } catch { return true } })
    return { complete: blockedRunIds.length === 0 && this.inFlight.size === 0, blockedRunIds }
  }
  /** Passive history restoration. Workspace reconciliation is a later explicit recovery step. */
  restorePaused(): void {
    for (const runId of this.storage.listRunIds()) {
      this.revoke(runId)
      try {
      const snapshot = this.getSnapshot(runId), run = snapshot.run
      if (['stopped', 'completed'].includes(run.status)) continue
      this.storage.command(this.operation(run, 'boot-paused', { role: 'system' }), tx => {
        tx.updateRun(run.version, transitionRun(run, 'boot', { now: this.now() }))
        for (const attempt of snapshot.attempts.filter(a => !['succeeded', 'failed', 'interrupted', 'timed-out', 'cancelled', 'permission-blocked'].includes(a.status))) tx.writeAttempt({ ...attempt, status: 'interrupted', cessation: attempt.cessation === 'not-started' ? 'confirmed' : 'unknown', version: attempt.version + 1, endedAt: this.now(), blocker: 'Application restart interrupted this attempt; no process was relaunched.' }, attempt.version)
        return { acknowledgment: {}, event: { status: 'paused' } }
      })
      } catch { this.unavailableRuns.set(runId, 'Stored team state failed validation; this run is blocked without launch or credential resolution.') }
    }
  }
}

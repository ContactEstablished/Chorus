import { focusedTeamClaudeVersion, decisionWaitCodexVersion } from '../../shared/team'
import { randomUUID, createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { TeamService } from './teamService'
import { TeamBridgeService } from './teamBridgeService'
import { TeamWorkspaceService } from './teamWorkspaceService'
import { TeamRecoveryService } from './teamRecoveryService'
import { teamAssert, type TeamLease, type TeamCredentialFence } from './teamCore'
import { windowsHelperPlatform } from './helperProcess'
import { teamProcessIdentitySchema, teamToolSchemas, type TeamMember, type TeamRun, type TeamAttempt, type TeamCapabilities } from '../../shared/team'
import type { StorageService } from './storage'
import type { SessionManager } from './sessionManager'
import type { GitWorktreeManager } from './worktrees'
import type { CredentialVault } from './vault'
import type { McpServerRef, PtyLaunchRoute } from '../adapters/types'
import { helperRegistry } from '../adapters/helpers/registry'
import { verifiedHelperCombination, allowedHelperCombination, allowedLeadCombination } from '../adapters/helpers/evidence'
import { TeamMemberProfiles } from './teamMemberProfiles'
import { buildTeamLeadConfiguration } from '../adapters/teamLead'
import { verifyTeamConversation } from '../adapters/teamResume'
import { teamInstructions, teamHandoff } from './teamInstructionsCore'

type Identity = z.infer<typeof teamProcessIdentitySchema>
export interface TeamRuntimeDependencies {
  storage: StorageService; sessions: SessionManager; worktrees: GitWorktreeManager; vault: CredentialVault
  configDirectory: string; bridgeScript: string
  memory(projectId: string, lead: 'claude' | 'codex', sessionId: string, model: string): Promise<{ servers: readonly McpServerRef[]; instructions?: string }>
}

/** Production composition. Construction performs no decrypt, lease issue or process launch. */
export class TeamRuntime {
  readonly teams
  readonly service: TeamService
  readonly bridge: TeamBridgeService
  readonly workspace: TeamWorkspaceService
  readonly recovery: TeamRecoveryService
  readonly memberProfiles: TeamMemberProfiles
  private leases = new Map<string, TeamLease>()
  private bridges = new Map<string, { endpoint: string; token: string }>()
  private leadIdentities = new Map<string, Identity[]>()
  private scanning = new Map<string, Promise<void>>()
  private pollingLeads = new Set<string>()
  private handshakeTimers = new Set<ReturnType<typeof setTimeout>>()
  private stoppingLeads = new Set<string>()
  private leadStops = new Map<string, Promise<boolean>>()
  private leadCessationEvidence = new Map<string, { livePids: number[]; uncertain: boolean; inspectionFailed: boolean }>()
  private timer: ReturnType<typeof setInterval> | null = null
  constructor(private readonly deps: TeamRuntimeDependencies) {
    this.teams = deps.storage.createTeamStorage()
    this.memberProfiles = new TeamMemberProfiles(deps.storage, this.teams, deps.vault)
    deps.sessions.bindRestoreExclusion(id => this.teams.ownsLeadSession(id))
    this.bridge = new TeamBridgeService({ authorize: (a, op) => this.service.authorizeLead(a, op), dispatch: (a, op, input, signal) => this.service.dispatch(a, op, input, signal), handshake: a => this.service.markBridgeReady(a) })
    this.workspace = new TeamWorkspaceService({ storage: deps.storage, teams: this.teams, worktrees: deps.worktrees,
      assertAuthorized: (id, generation) => { const lease = this.leases.get(id); teamAssert(lease && !lease.revoked && lease.generation === generation, 'LEASE_REVOKED', 'Workspace authorization changed.') },
      authorizeLead: (a, op) => this.service.authorizeLead(a, op), writersStopped: a => this.attemptStopped(a), leadStopped: r => this.leadStopped(r),
      stopLead: r => this.stopLead(r), finalized: id => this.service.finishRetired(id),
      withLeadWriteLease: async (_run, work) => work() // Workspace service already serializes this run; lead contract forbids writes until apply settles.
    })
    this.recovery = new TeamRecoveryService({ storage: deps.storage, teams: this.teams, stopLead: run => this.stopLead(run), stopAttempt: attempt => this.stopOrphanAttempt(attempt), unavailable: (id, reason) => this.service.recordRestoreBlocker(id, reason) })
    this.workspace.bindRecoveryInspection(async runId => (await this.recovery.inspectRun(runId)).blockers.length > 0)
    this.service = new TeamService({ storage: this.teams, executor: deps.sessions, workspace: this.workspace,
      credentials: { inspect: m => this.inspectCredential(m), route: m => this.route(m), resolve: async (m, fence) => {
        teamAssert(JSON.stringify(this.inspectCredential(m)) === JSON.stringify(fence), 'CREDENTIAL_CHANGED', 'Credential relationship changed.')
        const result = await deps.vault.decryptForLaunch(fence.credentialId)
        teamAssert(result.ok, 'CREDENTIAL_UNAVAILABLE', 'Selected credential could not be decrypted.')
        teamAssert(!result.value.baseUrl || result.value.baseUrl.replace(/\/+$/, '') === this.route(m)?.baseUrl.replace(/\/+$/, ''), 'ROUTE_CHANGED', 'Credential route differs from verified provider route.')
        teamAssert(!result.value.extraHeaders || Object.keys(result.value.extraHeaders).length === 0, 'UNSUPPORTED_HEADERS', 'This helper route has no verified extra-header support.')
        return { envVarName: 'OPENROUTER_API_KEY', value: result.value.key, isSecret: true }
      } },
      validateProject: id => { const p = deps.storage.getProjectById(id); teamAssert(p && p.status !== 'archived', 'PROJECT_UNAVAILABLE', 'Choose an available project.') },
      validateMember: (m, role) => this.validateMember(m, role), autoActivate: true,
      lead: { launch: (run, lease, auth) => this.launchLead(run, lease, auth), stopped: r => this.leadStopped(r), stop: r => this.stopLead(r) },
      leaseIssued: lease => { this.leases.set(lease.runId, lease); this.bridges.set(lease.runId, this.bridge.issue(lease.runId, lease.generation, lease.epoch)) },
      leaseRevoked: id => { this.workspace.checks.cancelRun(id); this.leases.delete(id); this.bridges.delete(id); this.bridge.revoke(id) }
    })
    deps.sessions.onExit(sessionId => { for (const id of this.teams.listRunIds()) { try { const run = this.teams.getRun(id); if (run.leadSessionId === sessionId && !this.stoppingLeads.has(id)) this.service.leadExited(id) } catch { this.service.recordRestoreBlocker(id, 'Stored Team history is unavailable; authorization is revoked.') } } })
  }
  async start(): Promise<void> { await this.bridge.start(); this.timer = setInterval(() => { for (const id of this.pollingLeads) void this.scanLead(id).catch(() => {}) }, 3000); this.timer.unref() }
  async restorePaused(): Promise<void> {
    for (const id of this.teams.listRunIds()) {
      try { if (!await this.workspace.checks.recover(id)) this.service.recordRestoreBlocker(id, 'A previous verification process lacks confirmed cessation. Its workspace is retained.') }
      catch { this.service.recordRestoreBlocker(id, 'Verification recovery evidence is unavailable. No check was replayed.') }
    }
    await this.recovery.reconcileAll(); this.service.retireApprovalGates()
  }
  ownsWorkspacePath(cwd: string): boolean {
    const canonical = (value: string) => path.resolve(fs.realpathSync.native(value)).toLowerCase()
    const target = canonical(cwd)
    return this.teams.ownedWorktreeIds().some(id => { const row = this.deps.storage.getWorktreeById(id); if (!row) return false; const root = fs.existsSync(row.path) ? canonical(row.path) : path.resolve(row.path).toLowerCase(); return target === root || target.startsWith(root + path.sep) })
  }
  async capabilities(): Promise<TeamCapabilities> {
    const probes = await Promise.all(Object.values(helperRegistry).map(adapter => adapter.probe(AbortSignal.timeout(15000))))
    const options: TeamCapabilities['options'] = []
    for (const [key, harness, model] of [['claude-opus', 'claude', 'claude-opus-5-5'], ['claude', 'claude', 'sonnet'], ['codex', 'codex', 'gpt-6-astra'], ['codex-sol', 'codex', 'gpt-6.1-sol']] as const) {
      const probe = probes.find(p => p.id === harness)!
      const enabled = !!probe.executable && allowedLeadCombination({ id: harness, version: probe.version ?? '', model, authMode: 'subscription' })
      const measured = verifiedHelperCombination({ id: harness, version: probe.version ?? '', model, authMode: 'subscription' })
      options.push({ key, label: `${harness === 'claude' ? 'Claude' : 'Codex'} · ${model} · subscription`, lead: true, enabled, reason: enabled ? measured ? 'Verified; uses the current CLI-managed account.' : 'Compatibility pilot; uses the current CLI account. Actual model access is checked at launch.' : `CLI ${probe.version ?? 'unavailable'} needs a compatibility check. See the compatibility report.`, member: { id: randomUUID(), label: harness, harness, model, authMode: 'subscription', providerId: null, credentialProfileId: null, installedVersion: probe.version ?? 'unavailable', effort: key === 'claude-opus' || harness === 'codex' && decisionWaitCodexVersion(probe.version ?? '') ? 'medium' : null } })
    }
    const probe = probes.find(p => p.id === 'opencode')!
    for (const profile of this.deps.storage.listCredentialProfiles()) {
      const provider = this.deps.storage.getProviderConfigById(profile.providerId)
      if (provider?.authMode !== 'api_key' || provider.baseUrl?.replace(/\/+$/, '') !== 'https://openrouter.ai/api/v1') continue
      const enabled = !profile.unavailableSince && !!probe.executable && allowedHelperCombination({ id: 'opencode', version: probe.version ?? '', model: 'z-ai/glm-5.3', authMode: 'api_key', baseUrl: provider.baseUrl })
      options.push({ key: profile.id, label: `OpenRouter · GLM-5.3 · ${profile.label}`, lead: false, enabled, reason: enabled ? verifiedHelperCombination({ id: 'opencode', version: probe.version ?? '', model: 'z-ai/glm-5.3', authMode: 'api_key', baseUrl: provider.baseUrl }) ? 'Verified adapter/model; uses the selected stored credential.' : 'Compatibility pilot; uses the selected stored credential.' : 'Credential unavailable or installed opencode version is unverified.', member: { id: randomUUID(), label: profile.label, harness: 'opencode', model: 'z-ai/glm-5.3', authMode: 'api_key', providerId: provider.id, credentialProfileId: profile.id, installedVersion: probe.version ?? 'unavailable', effort: null } })
      options.push({ key: `${profile.id}-deepseek`, label: `OpenRouter · DeepSeek V4.1 Flash · ${profile.label}`, lead: false, enabled,
        reason: enabled ? 'Compatibility pilot; two slots may share this model and credential with independent task/worktree identities.' : 'Credential or CLI needs a compatibility check.',
        member: { id: randomUUID(), label: 'DeepSeek Flash', harness: 'opencode', model: 'deepseek/deepseek-v4.1-flash', customModel: true, authMode: 'api_key', providerId: provider.id, credentialProfileId: profile.id, installedVersion: probe.version ?? 'unavailable', effort: null } })
    }
    for (const profile of this.teams.listMemberProfiles()) {
      const credential = this.deps.storage.getCredentialProfileById(profile.credentialProfileId)
      const provider = credential ? this.deps.storage.getProviderConfigById(credential.providerId) : null
      if (!provider || !credential) continue
      const combination = { id: 'opencode' as const, version: probe.version ?? '', model: profile.model, authMode: 'api_key' as const, baseUrl: provider.baseUrl ?? undefined, customModel: true }
      const measured = verifiedHelperCombination(combination)
      const enabled = !credential.unavailableSince && !!probe.executable && provider.authMode === 'api_key' && allowedHelperCombination(combination)
      options.push({ key: profile.id, label: `${profile.label} · ${profile.model}${measured ? '' : ' · custom'}`, lead: false, enabled,
        reason: enabled ? (measured ? 'Verified model and adapter.' : 'Custom model: uses the tested OpenCode adapter; model behavior has not been verified by Chorus.') : 'Credential, OpenRouter route or installed OpenCode version is unavailable.',
        member: { id: randomUUID(), profileId: profile.id, customModel: !measured, label: profile.label, instructions: profile.instructions, harness: 'opencode', model: profile.model, authMode: 'api_key', providerId: provider.id, credentialProfileId: credential.id, installedVersion: probe.version ?? 'unavailable', effort: null } })
    }
    return { options, accountScope: 'Subscriptions use the account currently signed into each CLI. Saved OpenRouter members use your selected API credential. Custom models are selectable but are not claimed as verified.' }
  }
  private route(member: TeamMember): PtyLaunchRoute | undefined {
    if (member.authMode === 'subscription') return undefined
    const provider = member.providerId ? this.deps.storage.getProviderConfigById(member.providerId) : null
    teamAssert(provider && provider.authMode === 'api_key' && provider.baseUrl, 'PROVIDER_UNAVAILABLE', 'Selected API provider is unavailable.')
    return { providerKey: provider.id, providerName: provider.name, baseUrl: provider.baseUrl, modelId: member.model }
  }
  private inspectCredential(member: TeamMember): TeamCredentialFence | undefined {
    if (member.authMode === 'subscription') return undefined
    const profile = member.credentialProfileId ? this.deps.storage.getCredentialProfileById(member.credentialProfileId) : null
    const provider = member.providerId ? this.deps.storage.getProviderConfigById(member.providerId) : null
    teamAssert(profile && provider && profile.providerId === provider.id && !profile.unavailableSince && provider.authMode === 'api_key', 'CREDENTIAL_UNAVAILABLE', 'Selected provider and credential relationship is unavailable.')
    return { credentialId: profile.id, fingerprint: profile.fingerprintHash, providerId: provider.id, authMode: provider.authMode,
      routeIdentity: createHash('sha256').update(JSON.stringify([provider, profile.encryptedBlob.toString('base64')])).digest('hex') }
  }
  async validateMember(member: TeamMember, role: 'lead' | 'helper'): Promise<void> {
    teamAssert(role !== 'lead' || member.harness !== 'opencode', 'UNSUPPORTED_LEAD', 'Choose Claude or Codex as lead.')
    this.inspectCredential(member)
    const capability = await helperRegistry[member.harness].probe(AbortSignal.timeout(15000))
    teamAssert(role !== 'lead' || !member.customModel, 'UNSUPPORTED_LEAD', 'Custom API models are helpers; choose Claude or Codex as lead.')
    const combination = { id: member.harness, version: member.installedVersion, model: member.model, authMode: member.authMode, baseUrl: this.route(member)?.baseUrl, customModel: member.customModel }
    teamAssert(capability.version === member.installedVersion && !!capability.executable && (role === 'lead' ? allowedLeadCombination(combination) : allowedHelperCombination(combination)), 'UNVERIFIED_COMBINATION', 'Installed CLI, model or authentication route needs a compatibility check for this Team member.')
    teamAssert(member.effort === null || role === 'lead' && member.effort === 'medium' && (member.harness === 'claude' && focusedTeamClaudeVersion(member.installedVersion) || member.harness === 'codex' && decisionWaitCodexVersion(member.installedVersion)), 'UNVERIFIED_EFFORT', 'Explicit medium effort requires a qualified Claude or Codex lead; other overrides need verification.')
  }
  private journal(run: TeamRun, operation: string, payload: Record<string, import('./teamStorage').TeamJson>): void {
    this.teams.command({ runId: run.id, generation: run.generation, operation, actor: 'system', eventId: randomUUID(), now: new Date().toISOString() }, () => ({ acknowledgment: {}, event: payload }))
  }
  private async launchLead(run: TeamRun, _lease: TeamLease, auth: { assertAuthorized(): void; resolveCredential(): Promise<import('../adapters/types').ResolvedCredential | undefined> }): Promise<{ sessionId: string; replacementReason?: string }> {
    const worktree = run.integrationWorktreeId ? this.deps.storage.getWorktreeById(run.integrationWorktreeId) : null
    teamAssert(worktree && worktree.projectId === run.projectId && ['active', 'detached'].includes(worktree.status), 'WORKSPACE_UNAVAILABLE', 'Integration workspace is unavailable.')
    const bridge = this.bridges.get(run.id); teamAssert(bridge, 'BRIDGE_UNAVAILABLE', 'Run connection is unavailable.')
    const node = execFileSync('where.exe', ['node.exe'], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/).find(p => path.isAbsolute(p) && fs.existsSync(p))
    teamAssert(node && path.resolve(node).toLowerCase() !== path.resolve(process.execPath).toLowerCase() && fs.existsSync(this.deps.bridgeScript), 'NODE_UNAVAILABLE', 'Install native Node.js to run the Team bridge.')
    const sessionId = run.leadSessionId ?? randomUUID()
    const retainedSession = run.leadSessionId ? this.deps.storage.getSessionById(run.leadSessionId) : null
    if (run.leadSessionId) teamAssert(retainedSession && retainedSession.projectId === run.projectId && retainedSession.agent === run.config.lead.harness && path.resolve(retainedSession.cwd).toLowerCase() === path.resolve(worktree.path).toLowerCase(), 'SESSION_IDENTITY_CHANGED', 'Retained lead session ownership changed; replacement is blocked.')
    const lead = run.config.lead.harness as 'claude' | 'codex', memory = await this.deps.memory(run.projectId, lead, sessionId, run.config.lead.model)
    auth.assertAuthorized()
    const secretEnv: Record<string, string> = { CHORUS_TEAM_ENDPOINT: bridge.endpoint, CHORUS_TEAM_TOKEN: bridge.token }
    const servers = memory.servers.map(server => {
      for (const [name, value] of Object.entries(server.env ?? {})) { teamAssert(!name.startsWith('CHORUS_TEAM_') && !(name in secretEnv), 'MCP_ENV_CONFLICT', 'Memory environment conflicts with Team connection.'); secretEnv[name] = value }
      return { ...server, env: undefined, envPassthrough: [...(server.envPassthrough ?? []), ...Object.keys(server.env ?? {})] }
    })
    const config = buildTeamLeadConfiguration({ lead, worktree: worktree.path, configDirectory: path.join(this.deps.configDirectory, run.id, String(run.generation), randomUUID()), nodeExecutable: node, bridgeScript: this.deps.bridgeScript, otherServers: servers, verifiedVersion: run.config.lead.installedVersion, focused: run.config.leadContext === 'focused' })
    const credential = await auth.resolveCredential(); auth.assertAuthorized()
    const now = new Date().toISOString()
    const launchTimes: number[] = [], assignedConversationIds: string[] = []; let after = 0
    if (run.leadSessionId) for (;;) { const page = this.teams.events(run.id, after); if (!page.length) break; for (const event of page) { if (event.operation === 'lead-spawn-intent') launchTimes.push(Date.parse(event.at)); if (event.operation === 'lead-process' && typeof event.payload.conversationId === 'string') assignedConversationIds.push(event.payload.conversationId) }; after = page.at(-1)!.sequence }
    const verifiedConversation = !!retainedSession?.agentSessionId && verifyTeamConversation({ harness: lead, sessionId, conversationId: retainedSession.agentSessionId, cwd: worktree.path, launchTimes, assignedConversationIds })
    const replacementReason = run.leadSessionId && !verifiedConversation ? 'The previous CLI conversation pointer is missing or could not be verified for this workspace. A new conversation uses a bounded retained-task handoff.' : undefined
    if (replacementReason) this.journal(this.teams.getRun(run.id), 'lead-context-not-restored', { sessionId, previousConversationId: retainedSession?.agentSessionId ?? null, reason: replacementReason })
    if (!run.leadSessionId) this.deps.storage.createSession({ id: sessionId, projectId: run.projectId, agent: lead, cwd: worktree.path, status: 'exited', createdAt: now, name: `Team ${run.config.lead.label}`, worktreeId: worktree.id })
    const current = this.teams.getRun(run.id)
    this.teams.command({ runId: run.id, generation: run.generation, operation: 'lead-spawn-intent', actor: 'system', eventId: randomUUID(), now }, tx => { tx.updateRun(current.version, { ...current, leadSessionId: sessionId, version: current.version + 1, updatedAt: now }); return { acknowledgment: {}, event: { sessionId } } })
    this.deps.storage.activateWorktreeForSession(worktree.id, sessionId, worktree.path)
    this.deps.sessions.launch(lead, worktree.path, sessionId, { credential, launchSecretEnv: secretEnv, authorizeSpawn: auth.assertAuthorized, disableResumeFallback: true, requireInstructions: true, forceFreshConversation: !!replacementReason,
      instructions: teamInstructions(run, [memory.instructions, replacementReason ? teamHandoff(this.teams.snapshot(run.id)) : ''].filter(Boolean).join('\n')), conversationBoundary: replacementReason ? 'context-not-restored' : undefined,
      permissionMode: 'manual', teamLaunchArgs: [...config.args, ...(lead === 'claude' ? ['--model', run.config.lead.model, ...(run.config.lead.effort ? ['--effort', run.config.lead.effort] : []), '--disallowedTools', 'Agent,Task', '--allowedTools', ...Object.keys(teamToolSchemas).map(name => `mcp__chorus-team__${name}`)] : ['-m', run.config.lead.model, ...(run.config.lead.effort ? ['-c', `model_reasoning_effort="${run.config.lead.effort}"`] : []), '-c', 'features.multi_agent=false', '-c', 'windows.sandbox="elevated"', ...Object.keys(teamToolSchemas).flatMap(name => ['-c', `mcp_servers.chorus-team.tools.${name}.approval_mode="approve"`])])], envAdditions: { ...config.envAdditions, DISABLE_AUTOUPDATER: '1', PATHEXT: '.COM;.EXE;.BAT;.CMD' } })
    this.deps.storage.updateSessionStatus(sessionId, 'running', null)
    const pid = this.deps.sessions.ownedPtyPid(sessionId); teamAssert(pid, 'LEAD_IDENTITY_UNKNOWN', 'Lead process identity is unavailable.')
    const observed = await windowsHelperPlatform.inspect(pid, [])
    teamAssert(observed.root, 'LEAD_IDENTITY_UNKNOWN', 'Lead exited before its process identity was recorded.')
    this.leadIdentities.set(run.id, observed.identities); this.journal(run, 'lead-process', { sessionId, identities: observed.identities, conversationId: this.deps.storage.getSessionById(sessionId)?.agentSessionId ?? null })
    this.pollingLeads.add(run.id)
    const handshake = setTimeout(() => { this.handshakeTimers.delete(handshake); try { this.service.bridgeTimedOut(run.id, run.generation) } catch { /* Corrupt history is exposed by snapshot/boot guards. */ } }, 60000)
    this.handshakeTimers.add(handshake); handshake.unref()
    return { sessionId, ...(replacementReason ? { replacementReason } : {}) }
  }
  private identities(run: TeamRun): Identity[] | null {
    const cached = this.leadIdentities.get(run.id); if (cached) return cached
    let after = 0, latest: Identity[] | null = null
    for (;;) { const events = this.teams.events(run.id, after); if (!events.length) break; for (const event of events) { if (event.operation === 'lead-spawn-intent') latest = null; if (event.operation === 'lead-process') latest = z.array(teamProcessIdentitySchema).parse(event.payload.identities) }; after = events.at(-1)!.sequence }
    if (latest) this.leadIdentities.set(run.id, latest)
    return latest
  }
  private scanLead(runId: string): Promise<void> {
    const existing = this.scanning.get(runId); if (existing) return existing
    const work = (async () => { const run = this.teams.getRun(runId), known = this.identities(run); if (!known?.length) return
      const live = await windowsHelperPlatform.inspect(known[0].pid, known)
      teamAssert(!live.uncertain, 'UNKNOWN_WRITER', 'A lead process identity was reused or could not be verified.')
      const combined = [known[0], ...live.identities.filter(p => p.pid !== known[0].pid)]
      if (combined.length !== known.length || combined.some(p => !known.some(k => k.pid === p.pid && k.creationTime === p.creationTime))) {
        this.journal(run, 'lead-process', { sessionId: run.leadSessionId, identities: combined, retired: known.filter(p => !combined.some(live => live.pid === p.pid && live.creationTime === p.creationTime)) })
        this.leadIdentities.set(runId, combined)
      }
      if (!live.identities.length) this.pollingLeads.delete(runId)
    })()
    this.scanning.set(runId, work)
    void work.then(() => this.scanning.delete(runId), () => this.scanning.delete(runId))
    return work
  }
  async leadStopped(run: TeamRun): Promise<boolean> {
    if (!run.leadSessionId) return true
    if (this.leadCessationRecorded(run.id)) return true
    const known = this.identities(run); if (!known?.length) return false
    try {
      const observed = await windowsHelperPlatform.inspect(known[0].pid, known)
      this.leadCessationEvidence.set(run.id, { livePids: observed.identities.map(p => p.pid), uncertain: !!observed.uncertain, inspectionFailed: false })
      return !observed.uncertain && observed.identities.length === 0
    } catch { this.leadCessationEvidence.set(run.id, { livePids: [], uncertain: true, inspectionFailed: true }); return false }
  }
  stopLead(run: TeamRun): Promise<boolean> {
    const existing = this.leadStops.get(run.id); if (existing) return existing
    const work = this.performStopLead(run); this.leadStops.set(run.id, work)
    void work.then(() => this.leadStops.delete(run.id), () => this.leadStops.delete(run.id))
    return work
  }
  private async performStopLead(run: TeamRun): Promise<boolean> {
    if (!run.leadSessionId) return true
    if (this.leadCessationRecorded(run.id) && !this.deps.sessions.isRunning(run.leadSessionId)) return true
    this.pollingLeads.delete(run.id)
    this.stoppingLeads.add(run.id)
    try {
    this.journal(this.teams.getRun(run.id), 'lead-stop-intent', { sessionId: run.leadSessionId })
    await this.scanLead(run.id)
    const known = this.identities(run); if (!known?.length) return false
    try { await windowsHelperPlatform.stop(known) } catch { /* Final native identity inspection decides cessation. */ }
    this.deps.sessions.kill(run.leadSessionId)
    // Wait for SessionManager's exit fan-out before replacing this same session ID.
    // An OS exit alone can precede ConPTY's callback and would race the replacement row/hooks.
    const deadline = Date.now() + 5000
    while (this.deps.sessions.isRunning(run.leadSessionId) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25))
    if (this.deps.sessions.isRunning(run.leadSessionId)) {
      this.journal(this.teams.getRun(run.id), 'lead-stop-unconfirmed', { sessionId: run.leadSessionId, stage: 'pty-exit' })
      return false
    }
    // Native exit, ConPTY fan-out and descendant teardown are separate observations.
    // A transient inspection failure must not permanently strand a stopped lead.
    const cessationDeadline = Date.now() + 5000
    let stopped = false
    do {
      stopped = await this.leadStopped(run)
      if (stopped) break
      await new Promise(resolve => setTimeout(resolve, 100))
    } while (Date.now() < cessationDeadline)
    if (stopped) this.journal(this.teams.getRun(run.id), 'lead-stopped', { sessionId: run.leadSessionId })
    else this.journal(this.teams.getRun(run.id), 'lead-stop-unconfirmed', { sessionId: run.leadSessionId, stage: 'native-identities', evidence: this.leadCessationEvidence.get(run.id) ?? null })
    return stopped
    } finally { this.stoppingLeads.delete(run.id) }
  }
  private async attemptStopped(attempt: TeamAttempt): Promise<boolean> {
    if (['not-started', 'confirmed'].includes(attempt.cessation)) return true
    if (!attempt.process) return false
    try { const observed = await windowsHelperPlatform.inspect(attempt.process.pid, [attempt.process, ...attempt.descendants]); return !observed.uncertain && observed.identities.length === 0 } catch { return false }
  }
  private leadCessationRecorded(runId: string): boolean {
    const stopped = this.teams.latestEvent(runId, 'lead-stopped'), spawned = this.teams.latestEvent(runId, 'lead-spawn-intent')
    return !!stopped && !!spawned && stopped.sequence > spawned.sequence
  }
  private async stopOrphanAttempt(attempt: TeamAttempt): Promise<boolean> {
    if (['not-started', 'confirmed'].includes(attempt.cessation)) return true
    if (!attempt.process) return false
    try {
      const known = [attempt.process, ...attempt.descendants], observed = await windowsHelperPlatform.inspect(attempt.process.pid, known)
      if (observed.uncertain) return false
      if (!observed.identities.length) return true
      const combined = [...known]
      for (const identity of observed.identities) if (!combined.some(p => p.pid === identity.pid && p.creationTime === identity.creationTime)) combined.push(identity)
      const run = this.teams.getRun(attempt.runId)
      this.teams.command({ runId: run.id, generation: run.generation, operation: 'recovery-stop-helper-intent', actor: 'system', eventId: randomUUID(), now: new Date().toISOString() }, tx => {
        tx.writeAttempt({ ...attempt, descendants: combined.filter(p => p.pid !== attempt.process!.pid), version: attempt.version + 1 }, attempt.version)
        return { acknowledgment: {}, event: { attemptId: attempt.id, identities: combined } }
      })
      // A descendant may exit between Get-Process and Stop-Process. The final
      // identity observation, not the signal command's exit status, proves cessation.
      try { await windowsHelperPlatform.stop(combined) } catch { /* Inspect every retained identity below. */ }
      for (let poll = 0; poll < 3; poll++) {
        const after = await windowsHelperPlatform.inspect(attempt.process.pid, combined)
        if (after.uncertain) return false
        if (!after.identities.length) return true
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      return false
    } catch { return false }
  }
  async shutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer); this.timer = null
    for (const timer of this.handshakeTimers) clearTimeout(timer); this.handshakeTimers.clear()
    await this.service.shutdown()
    // Completed runs may keep a readable terminal until quit. Their children still belong to us.
    for (const id of this.teams.listRunIds()) try { const run = this.teams.getRun(id); if (run.leadSessionId && this.deps.sessions.isRunning(run.leadSessionId)) await this.stopLead(run) } catch { this.service.recordRestoreBlocker(id, 'Quit could not confirm Team lead cessation; recovery is required.') }
    await this.deps.sessions.disposeHelpers(); await Promise.allSettled([...this.scanning.values()]); await this.bridge.dispose()
  }
}

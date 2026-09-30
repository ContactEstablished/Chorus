import { randomUUID, createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { teamTestEvidenceSchema, type TeamReview, type TeamRun, type TeamTestEvidence } from '../../shared/team'
import type { TeamStorage, TeamAcknowledgment, TeamJson } from './teamStorage'
import { canonicalTeamPayload } from './teamStorage'
import { teamAssert } from './teamCore'
import { currentBranch, resolveMainRepoRoot, teamResolveCommit, teamStatus, teamGitOperationPending } from './git'
import { executeTeamCheck, teamCheckSpec, teamNativeCheckLaunch, type TeamCheck } from './teamChecks'
import { scrubSecrets } from './logger'
import { windowsHelperPlatform } from './helperProcess'
import { teamProcessIdentitySchema } from '../../shared/team'
import { z } from 'zod'

interface Dependencies {
  teams: TeamStorage
  assertAuthorized(runId: string, generation: number): void
  changed(runId: string): void
  workspaceId(cwd: string): string | null
}
export class TeamVerificationService {
  private controllers = new Map<string, { runId: string; controller: AbortController }>()
  constructor(private readonly deps: Dependencies) {}
  assertQuiescent(runId: string, cwd?: string): void {
    teamAssert(!this.deps.teams.unretiredVerificationStarts(runId, cwd).length, 'CHECK_OWNERSHIP_UNKNOWN', 'A prior project check is still running or its process cessation is unconfirmed; stop or recover it before more checks, integration, publication, or cleanup.')
  }
  cancelRun(runId: string): void { for (const entry of this.controllers.values()) if (entry.runId === runId) entry.controller.abort() }
  private journal(run: TeamRun, operation: string, payload: Record<string, TeamJson>): void {
    this.deps.teams.command({ runId: run.id, generation: run.generation, operation, actor: 'system', eventId: randomUUID(), now: new Date().toISOString() }, () => ({ acknowledgment: {}, event: payload }))
    this.deps.changed(run.id)
  }
  failQueued(run: TeamRun, verificationId: string, reason: string): void {
    this.journal(run, 'verification-failed', { verificationId, reason: scrubSecrets(reason).slice(0, 3000) })
  }
  preflight(cwd: string, run: TeamRun, command: TeamCheck): void {
    const spec = teamCheckSpec(run.config.verificationProfile, command)
    teamNativeCheckLaunch(cwd, spec)
    if (command !== 'node-test') {
      const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'))
      teamAssert(fs.existsSync(path.join(cwd, 'package-lock.json')), 'LOCKFILE_REQUIRED', 'npm checks require a committed package-lock.json for isolated dependencies.')
      if (command !== 'install') teamAssert(typeof pkg.scripts?.[command] === 'string', 'CHECK_UNAVAILABLE', `package.json has no ${command} script.`)
    }
  }
  evidence(runId: string, id: string): TeamTestEvidence | null {
    let after = 0
    for (;;) {
      const page = this.deps.teams.events(runId, after)
      const event = page.find(e => e.operation === 'verification-completed' && e.payload.verificationId === id)
      if (event) return event.payload.evidence as unknown as TeamTestEvidence
      if (!page.length) return null
      after = page.at(-1)!.sequence
    }
  }
  assertEvidence(run: TeamRun, tests: readonly TeamTestEvidence[]): void {
    if (!run.config.verificationProfile) return // Legacy manual evidence remains readable.
    for (const test of tests) {
      const recorded = test.verificationId ? this.evidence(run.id, test.verificationId) : null
      teamAssert(recorded && canonicalTeamPayload(recorded) === canonicalTeamPayload(test), 'UNRECORDED_CHECK', 'Use the exact evidence returned by a completed team_verify execution; a helper report is insufficient.')
    }
  }
  /** Resolve compact references within this run; never trust caller-supplied proof fields. */
  resolveReview(run: TeamRun, command: TeamReview): TeamReview {
    if (!command.verificationIds?.length) return command
    const tests = command.verificationIds.map(id => {
      const completed = this.deps.teams.verificationEvents(run.id, id).filter(e => e.operation === 'verification-completed').at(-1)
      teamAssert(completed?.payload.cessation === 'confirmed', 'UNRECORDED_CHECK', 'Verification ID must identify a completed, stopped check in this run.')
      const test = teamTestEvidenceSchema.parse(completed.payload.evidence)
      teamAssert(test.verificationId === id && test.outcome === 'passed' && test.exitCode === 0 && test.provenance === 'independent' && test.executionContext === 'integration'
        && test.testedSha === command.reviewedSha && !completed.payload.bootstrap && ['node --test', 'npm test', 'npm run typecheck', 'npm run build'].includes(test.command),
      'UNVERIFIED_TESTS', 'Verification references require passing independent acceptance checks at the exact reviewed commit; dependency installation is not acceptance.')
      return test
    })
    // Historical renderers read canonical evidence; replay hashes the original compact request.
    const { verificationIds: _ids, ...review } = command
    return { ...review, tests }
  }
  async run(run: TeamRun, cwd: string, expectedSha: string, command: TeamCheck, verificationId: string = randomUUID(), signal?: AbortSignal, bootstrap = false): Promise<TeamTestEvidence> {
    try { return await this.execute(run, cwd, expectedSha, command, verificationId, signal, bootstrap) }
    catch (error) {
      this.journal(run, 'verification-failed', { verificationId, reason: scrubSecrets(error instanceof Error ? error.message : 'Verification failed.').slice(0, 3000) })
      throw error
    }
  }
  private dependencyFingerprint(cwd: string): string {
    const files = ['package.json', 'package-lock.json', '.npmrc'].map(file => [file, fs.existsSync(path.join(cwd, file)) ? fs.readFileSync(path.join(cwd, file), 'utf8') : null])
    return createHash('sha256').update(JSON.stringify(files)).digest('hex')
  }
  private needsDependencyDirectory(cwd: string): boolean {
    const lock = JSON.parse(fs.readFileSync(path.join(cwd, 'package-lock.json'), 'utf8'))
    return Object.keys(lock.packages ?? {}).some(name => name.startsWith('node_modules/')) || Object.keys(lock.dependencies ?? {}).length > 0
  }
  private async execute(run: TeamRun, cwd: string, expectedSha: string, command: TeamCheck, verificationId: string, signal?: AbortSignal, bootstrap = false): Promise<TeamTestEvidence> {
    this.assertQuiescent(run.id, cwd)
    this.preflight(cwd, run, command)
    const spec = teamCheckSpec(run.config.verificationProfile, command), branch = await currentBranch(cwd), root = await resolveMainRepoRoot(cwd)
    const authorize = () => {
      this.deps.assertAuthorized(run.id, run.generation)
      teamAssert(['active', 'preparing', 'finishing'].includes(this.deps.teams.getRun(run.id).status), 'RUN_INACTIVE', 'Project verification was revoked.')
    }
    authorize()
    teamAssert(await teamResolveCommit(cwd, 'HEAD') === expectedSha && (await teamStatus(cwd)).clean && !await teamGitOperationPending(cwd), 'STALE_VERIFICATION', 'Verification requires the exact clean requested revision.')
    const controller = new AbortController(), abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort()
    this.controllers.set(verificationId, { runId: run.id, controller })
    const absentRoots = ['node_modules', 'out', 'dist', '.cache'].filter(root => !fs.existsSync(path.join(cwd, root)))
    try {
      const dependencyFingerprint = command !== 'node-test' ? this.dependencyFingerprint(cwd) : null
      if (dependencyFingerprint && command !== 'install') {
        const installed = this.deps.teams.latestDependencyInstallation(run.id, cwd)
        const evidence = installed?.completed?.payload.evidence as Record<string, TeamJson> | undefined
        if (this.needsDependencyDirectory(cwd) && !fs.existsSync(path.join(cwd, 'node_modules')) || installed?.started.payload.dependencyFingerprint !== dependencyFingerprint
          || installed.completed?.payload.cessation !== 'confirmed' || evidence?.outcome !== 'passed' || evidence.exitCode !== 0) {
          const prepared = await this.run(run, cwd, expectedSha, 'install', randomUUID(), controller.signal, true)
          teamAssert(prepared.outcome === 'passed', 'DEPENDENCIES_UNAVAILABLE', 'Dependencies could not be refreshed at the requested revision; inspect the recorded npm ci output.')
        }
      }
      authorize()
      teamAssert(await teamResolveCommit(cwd, 'HEAD') === expectedSha && (await teamStatus(cwd)).clean && !await teamGitOperationPending(cwd), 'STALE_VERIFICATION', 'Verification requires the exact clean requested revision.')
      // The requested check has not spawned while its owned dependency step runs.
      // Journal its start only once that prerequisite is finished, so boot can retire
      // the actual install process without inventing an unobserved parent process.
      this.journal(run, 'verification-started', { verificationId, command: spec.command, cwd, expectedSha, bootstrap, ...(command === 'install' ? { dependencyFingerprint } : {}) })
      const result = await executeTeamCheck(cwd, spec, { executionMs: run.config.executionMinutes * 60000, signal: controller.signal, authorize,
        observed: (process, descendants) => this.journal(run, 'verification-process', { verificationId, process, descendants }),
        retiring: (process, descendants) => this.journal(run, 'verification-retirement', { verificationId, reason: 'Command completed; retire positively identified background writers.', process, descendants }),
        intent: intent => this.journal(run, 'verification-termination', { verificationId, intent }) })
      const unchanged = await teamResolveCommit(cwd, 'HEAD') === expectedSha && (await teamStatus(cwd)).clean && await currentBranch(cwd) === branch && await resolveMainRepoRoot(cwd) === root
      const passed = result.exitCode === 0 && result.cessation === 'confirmed' && !result.intent && !result.protocolError && unchanged
      const evidence: TeamTestEvidence = { verificationId, command: spec.command, outcome: passed ? 'passed' : 'failed', exitCode: result.exitCode, executionContext: 'integration', testedSha: expectedSha,
        testSource: 'tracked', provenance: 'independent', sourcePaths: spec.sourcePaths, sourceDiffSha: expectedSha, output: scrubSecrets(result.output).slice(-12000) + (!unchanged ? '\nVerification changed tracked files or HEAD; evidence is rejected.' : '') }
      this.journal(run, 'verification-completed', { verificationId, evidence: evidence as unknown as TeamJson, cessation: result.cessation, bootstrap })
      const worktreeId = this.deps.workspaceId(cwd)
      const createdRoots = absentRoots.filter(root => fs.existsSync(path.join(cwd, root)))
      if (worktreeId && createdRoots.length) this.journal(run, 'workspace-disposable', { worktreeId, roots: createdRoots })
      teamAssert(result.cessation === 'confirmed', 'PROCESS_UNKNOWN', 'Verification processes are not confirmed stopped; preserve the workspace.')
      return evidence
    } finally { this.controllers.delete(verificationId); signal?.removeEventListener('abort', abort) }
  }
  requestAcknowledgment(verificationId: string): TeamAcknowledgment { return { verificationId, status: 'queued', next: 'Wait for this verification ID to pass, then submit verificationIds in team_review. Full logs are available through team_detail only when needed.' } }
  /** Boot retires journaled check processes without launching tools or replaying commands. */
  async recover(runId: string): Promise<boolean> {
    const run = this.deps.teams.getRun(runId), events = [] as ReturnType<TeamStorage['events']>
    let after = 0
    for (;;) { const page = this.deps.teams.events(runId, after); if (!page.length) break; events.push(...page); after = page.at(-1)!.sequence }
    let safe = true
    for (const start of events.filter(e => e.operation === 'verification-started')) {
      const id = start.payload.verificationId
      if (events.some(e => e.payload.verificationId === id && (e.operation === 'verification-retired' || e.operation === 'verification-completed' && e.payload.cessation === 'confirmed'))) continue
      const observed = events.filter(e => e.operation === 'verification-process' && e.payload.verificationId === id).at(-1)
      if (!observed) { safe = false; continue } // Preserve ambiguity, but still retire other proven owned checks.
      const root = teamProcessIdentitySchema.parse(observed.payload.process), descendants = z.array(teamProcessIdentitySchema).parse(observed.payload.descendants)
      try {
        const before = await windowsHelperPlatform.inspect(root.pid, [root, ...descendants])
        if (before.uncertain) safe = false
        this.journal(run, 'verification-recovery-stop', { verificationId: id!, process: root, descendants: before.identities.filter(p => p.pid !== root.pid) })
        try { await windowsHelperPlatform.stop(before.identities) } catch { /* Final inspection is authoritative. */ }
        const remaining = await windowsHelperPlatform.inspect(root.pid, [root, ...before.identities])
        if (remaining.uncertain || remaining.identities.length) { safe = false; continue }
        if (!before.uncertain) this.journal(run, 'verification-retired', { verificationId: id!, commandReplayed: false })
      } catch { safe = false }
    }
    for (const queued of events.filter(e => ['verify', 'verification-queued'].includes(e.operation))) {
      const id = queued.payload.verificationId
      if (typeof id === 'string' && !events.some(e => e.payload.verificationId === id && ['verification-started', 'verification-completed', 'verification-failed'].includes(e.operation))) {
        this.journal(run, 'verification-failed', { verificationId: id, reason: 'Queued verification was interrupted by restart; no requested command was spawned or replayed.' })
      }
    }
    return safe
  }
}

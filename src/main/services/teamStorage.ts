import type Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { and, asc, desc, eq, gt, max, sql } from 'drizzle-orm'
import { teamReviewSchema, type TeamReview } from '../../shared/team'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { z } from 'zod'
import * as tables from '../db/schema'
import { teamRuns, teamMembers, teamTasks, teamAttempts, teamEvents, teamIntegrations, teamPresets } from '../db/schema'
import { TEAM_LIMITS, teamRunSchema, teamTaskSchema, teamAttemptSchema, teamIntegrationSchema, teamMemberSchema, teamEventSchema, teamRunConfigSchema, teamCaptureReservationSchema, teamArtifactSchema, teamShaSchema, type TeamCaptureReservation, type TeamRun, type TeamTask, type TeamAttempt, type TeamIntegration, type TeamEvent, type TeamMember, type TeamRunConfig, type TeamSnapshot } from '../../shared/team'
import { teamAssert, TeamDomainError } from './teamCore'
import { scrubSecrets } from './logger'
import { teamMemberProfileSchema, type TeamMemberProfile } from '../../shared/teamProfiles'

export type TeamJson = null | boolean | number | string | TeamJson[] | { [key: string]: TeamJson }
export type TeamAcknowledgment = Record<string, TeamJson>
export function canonicalTeamPayload(value: unknown): string {
  const normalize = (v: unknown): unknown => {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (Array.isArray(v)) return v.map(normalize)
    if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, x]) => [k, normalize(x)]))
    throw new TeamDomainError('INVALID_PAYLOAD', 'Canonical requests must contain plain JSON values.')
  }
  return JSON.stringify(normalize(value))
}
export const hashTeamPayload = (value: unknown): string => createHash('sha256').update(canonicalTeamPayload(value)).digest('hex')
const json = (value: unknown): string => {
  const text = JSON.stringify(value)
  teamAssert(scrubSecrets(text) === text, 'SECRET_IN_RECORD', 'Team history cannot contain provider credential values.')
  return text
}
const parseJson = (text: string): unknown => {
  try { return JSON.parse(text) } catch { throw new TeamDomainError('CORRUPT_TEAM_STATE', 'Stored team JSON is invalid; this run is blocked.') }
}
function decode<T extends { id: string; version: number; status: string }>(row: { id: string; version: number; status: string; recordJson: string } | undefined, schema: z.ZodType<T>): T {
  teamAssert(row, 'NOT_FOUND', 'Team record was not found.')
  const result = schema.safeParse(parseJson(row.recordJson))
  teamAssert(result.success && result.data.id === row.id && result.data.version === row.version && result.data.status === row.status, 'CORRUPT_TEAM_STATE', 'Stored team state failed validation; this run is blocked.')
  return result.data
}
export interface TeamOperation {
  runId: string; operation: string; clientRequestId?: string; payload?: unknown; actor: TeamEvent['actor']; entityId?: string;
  generation: number; eventId: string; now: string
}

/** One connection owned by StorageService. Every mutation enters a synchronous SQLite transaction. */
export class TeamStorage {
  private readonly d: BetterSQLite3Database<typeof tables>
  constructor(private readonly db: Database.Database) { this.d = drizzle(db, { schema: tables }) }

  getRun(id: string): TeamRun {
    const row = this.d.select().from(teamRuns).where(eq(teamRuns.id, id)).get()
    const run = decode(row, teamRunSchema)
    teamAssert(row?.projectId === run.projectId && row.generation === run.generation && row.policyVersion === run.policyVersion && row.leadSessionId === run.leadSessionId && row.configJson === JSON.stringify(run.config) && row.integrationHead === run.integrationHead && row.integrationWorktreeId === run.integrationWorktreeId && row.baseSha === run.baseSha, 'CORRUPT_TEAM_STATE', 'Stored run identity does not match its snapshot.')
    return run
  }
  listRunIds(projectId?: string): string[] {
    return (projectId ? this.d.select({ id: teamRuns.id }).from(teamRuns).where(eq(teamRuns.projectId, projectId)).orderBy(asc(teamRuns.createdAt)).all() : this.d.select({ id: teamRuns.id }).from(teamRuns).orderBy(asc(teamRuns.createdAt)).all()).map(r => r.id)
  }
  ownsLeadSession(sessionId: string): boolean { return !!this.d.select({ id: teamRuns.id }).from(teamRuns).where(eq(teamRuns.leadSessionId, sessionId)).get() }
  /** Ownership columns remain protective even when a JSON snapshot is corrupt. */
  ownsWorktree(id: string): boolean {
    return !!(this.d.select({ id: teamRuns.id }).from(teamRuns).where(eq(teamRuns.integrationWorktreeId, id)).get()
      || this.d.select({ id: teamAttempts.id }).from(teamAttempts).where(eq(teamAttempts.worktreeId, id)).get()
      || this.d.select({ id: teamIntegrations.id }).from(teamIntegrations).where(eq(teamIntegrations.stagingWorktreeId, id)).get())
  }
  ownedWorktreeIds(): string[] {
    return [...new Set([
      ...this.d.select({ id: teamRuns.integrationWorktreeId }).from(teamRuns).all(),
      ...this.d.select({ id: teamAttempts.worktreeId }).from(teamAttempts).all(),
      ...this.d.select({ id: teamIntegrations.stagingWorktreeId }).from(teamIntegrations).all()
    ].flatMap(row => row.id ? [row.id] : []))]
  }
  latestEvent(runId: string, operation: string): TeamEvent | null {
    const row = this.d.select({ sequence: teamEvents.sequence }).from(teamEvents).where(and(eq(teamEvents.runId, runId), eq(teamEvents.operation, operation))).orderBy(desc(teamEvents.sequence)).get()
    return row ? this.events(runId, row.sequence - 1)[0] : null
  }
  members(runId: string): TeamMember[] {
    return this.d.select().from(teamMembers).where(eq(teamMembers.runId, runId)).all().map(row => {
      const value = teamMemberSchema.safeParse(parseJson(row.configJson))
      teamAssert(value.success && value.data.id === row.id && value.data.credentialProfileId === row.credentialProfileId, 'CORRUPT_TEAM_STATE', 'Stored member identity is invalid.')
      return value.data
    })
  }
  tasks(runId: string): TeamTask[] {
    return this.d.select().from(teamTasks).where(eq(teamTasks.runId, runId)).orderBy(asc(teamTasks.createdAt), asc(teamTasks.id)).all().map(row => {
      const value = decode(row, teamTaskSchema)
      teamAssert(value.runId === row.runId && value.command.kind === row.kind && value.attemptCount === row.attemptCount && value.currentAttemptId === row.currentAttemptId && row.commandJson === JSON.stringify(value.command), 'CORRUPT_TEAM_STATE', 'Stored task identity is invalid.')
      return value
    })
  }
  attempts(runId: string): TeamAttempt[] {
    return this.d.select().from(teamAttempts).where(eq(teamAttempts.runId, runId)).orderBy(asc(teamAttempts.taskId), asc(teamAttempts.number)).all().map(row => {
      const value = decode(row, teamAttemptSchema)
      teamAssert(value.runId === row.runId && value.taskId === row.taskId && value.number === row.number && value.memberId === row.memberId && value.generation === row.generation && value.worktreeId === row.worktreeId && value.baseSha === row.baseSha && JSON.stringify(value.artifact) === (row.artifactJson ?? 'null') && JSON.stringify(value.process) === (row.processJson ?? 'null') && JSON.stringify(value.result) === (row.resultJson ?? 'null'), 'CORRUPT_TEAM_STATE', 'Stored attempt identity is invalid.')
      return value
    })
  }
  integrations(runId: string): TeamIntegration[] {
    return this.d.select().from(teamIntegrations).where(eq(teamIntegrations.runId, runId)).orderBy(asc(teamIntegrations.createdAt)).all().map(row => {
      const value = decode(row, teamIntegrationSchema)
      teamAssert(value.runId === row.runId && value.taskId === row.taskId && value.attemptId === row.attemptId && value.preparationId === row.preparationId && value.artifactSha === row.artifactSha && value.expectedHead === row.expectedHead && value.resultSha === row.resultSha && value.policyVersion === row.policyVersion && value.stagingWorktreeId === row.stagingWorktreeId, 'CORRUPT_TEAM_STATE', 'Stored integration identity is invalid.')
      return value
    })
  }
  events(runId: string, afterSequence = 0): TeamEvent[] {
    return this.d.select().from(teamEvents).where(and(eq(teamEvents.runId, runId), gt(teamEvents.sequence, afterSequence))).orderBy(asc(teamEvents.sequence)).limit(TEAM_LIMITS.events + 1).all().map(row => teamEventSchema.parse({
      id: row.id, runId: row.runId, sequence: row.sequence, generation: row.generation, operation: row.operation,
      clientRequestId: row.clientRequestId, payloadHash: row.payloadHash, acknowledgment: row.acknowledgmentJson === null ? null : parseJson(row.acknowledgmentJson),
      actor: row.actor, entityId: row.entityId, payload: parseJson(row.payloadJson), at: row.at
    }))
  }
  snapshot(runId: string, afterSequence = 0): TeamSnapshot {
    const events = this.events(runId, afterSequence)
    const last = this.d.select({ sequence: teamEvents.sequence }).from(teamEvents).where(eq(teamEvents.runId, runId)).orderBy(desc(teamEvents.sequence)).get()
    return { run: this.getRun(runId), members: this.members(runId), tasks: this.tasks(runId), attempts: this.attempts(runId), integrations: this.integrations(runId), events: events.slice(0, TEAM_LIMITS.events), lastSequence: last?.sequence ?? 0, hasMoreEvents: events.length > TEAM_LIMITS.events }
  }
  /** Small check journal projection; process observations and activity never enter it. */
  verificationEvents(runId: string, verificationId?: string): TeamEvent[] {
    const rows = this.d.select().from(teamEvents).where(and(eq(teamEvents.runId, runId),
      sql`${teamEvents.operation} IN ('verify', 'verification-queued', 'verification-started', 'verification-completed', 'verification-failed')`,
      verificationId ? sql`json_extract(${teamEvents.payloadJson}, '$.verificationId') = ${verificationId}` : undefined))
      .orderBy(desc(teamEvents.sequence)).limit(64).all().reverse()
    return rows.map(row => teamEventSchema.parse({ id: row.id, runId: row.runId, sequence: row.sequence, generation: row.generation, operation: row.operation,
      clientRequestId: row.clientRequestId, payloadHash: row.payloadHash, acknowledgment: row.acknowledgmentJson ? parseJson(row.acknowledgmentJson) : null,
      actor: row.actor, entityId: row.entityId, payload: parseJson(row.payloadJson), at: row.at }))
  }
  /** The latest install attempt, including a failed attempt that invalidates older success. */
  latestDependencyInstallation(runId: string, cwd: string): { started: TeamEvent; completed: TeamEvent | null } | null {
    const row = this.d.select({ sequence: teamEvents.sequence }).from(teamEvents).where(and(eq(teamEvents.runId, runId), eq(teamEvents.operation, 'verification-started'),
      sql`json_extract(${teamEvents.payloadJson}, '$.command') = 'npm ci'`, sql`lower(json_extract(${teamEvents.payloadJson}, '$.cwd')) = lower(${cwd})`))
      .orderBy(desc(teamEvents.sequence)).get()
    if (!row) return null
    const started = this.events(runId, row.sequence - 1)[0]
    const completed = this.verificationEvents(runId, String(started.payload.verificationId)).find(event => event.operation === 'verification-completed') ?? null
    return { started, completed }
  }
  unretiredVerificationStarts(runId: string, cwd?: string): TeamEvent[] {
    const rows = this.db.prepare(`SELECT s.sequence FROM team_events s
      WHERE s.run_id = ? AND s.operation = 'verification-started'
      AND (? IS NULL OR lower(json_extract(s.payload_json, '$.cwd')) = lower(?))
      AND NOT EXISTS (SELECT 1 FROM team_events e WHERE e.run_id = s.run_id AND e.sequence > s.sequence
        AND json_extract(e.payload_json, '$.verificationId') = json_extract(s.payload_json, '$.verificationId')
        AND (e.operation = 'verification-retired' OR (e.operation = 'verification-completed' AND json_extract(e.payload_json, '$.cessation') = 'confirmed')))
      ORDER BY s.sequence`).all(runId, cwd ?? null, cwd ?? null) as Array<{ sequence: number }>
    return rows.map(row => this.events(runId, row.sequence - 1)[0])
  }
  /** Durable cursor excludes noisy activity/process observations and scopes task events. */
  actionableCursor(runId: string, taskIds: readonly string[] = [], decisionOnly = false): number {
    const ids = taskIds.length ? taskIds : this.tasks(runId).map(t => t.id)
    const row = this.db.prepare(`SELECT COALESCE(MAX(e.sequence), 0) AS cursor FROM team_events e
      WHERE e.run_id = ? AND e.operation NOT IN ('helper-activity', 'helper-identities', 'lead-identities', 'helper-process-observed', 'lead-process-observed', 'lead-process', 'verification-process', 'verification-output')
      AND (? = 0 OR e.operation IN ('result-validated', 'result-validation-failed', 'preparation-failed', 'helper-exited', 'helper-blocker', 'integration-prepared', 'integration-settled', 'integration-conflict', 'integration-failed', 'review', 'cancel'))
      AND (COALESCE(e.entity_id, json_extract(e.payload_json, '$.taskId'),
        (SELECT a.task_id FROM team_attempts a WHERE a.id = json_extract(e.payload_json, '$.attemptId')),
        (SELECT i.task_id FROM team_integrations i WHERE i.id = json_extract(e.payload_json, '$.integrationId'))) IS NULL
        OR COALESCE(e.entity_id, json_extract(e.payload_json, '$.taskId'),
        (SELECT a.task_id FROM team_attempts a WHERE a.id = json_extract(e.payload_json, '$.attemptId')),
        (SELECT i.task_id FROM team_integrations i WHERE i.id = json_extract(e.payload_json, '$.integrationId'))) IN (SELECT value FROM json_each(?)))`).get(runId, decisionOnly ? 1 : 0, JSON.stringify(ids)) as { cursor: number }
    return row.cursor
  }
  latestReview(runId: string, taskId: string, attemptId: string, phase: TeamReview['phase']): { id: string; review: TeamReview } | null {
    const row = this.d.select().from(teamEvents).where(and(eq(teamEvents.runId, runId), eq(teamEvents.operation, 'review'), eq(teamEvents.entityId, taskId), sql`json_extract(${teamEvents.payloadJson}, '$.review.attemptId') = ${attemptId}`, sql`json_extract(${teamEvents.payloadJson}, '$.review.phase') = ${phase}`)).orderBy(desc(teamEvents.sequence)).get()
    if (!row) return null
    const payload = z.object({ review: teamReviewSchema }).parse(parseJson(row.payloadJson))
    return { id: row.id, review: payload.review }
  }
  launchAcknowledgment(projectId: string, requestId: string, payload: unknown): TeamAcknowledgment | undefined {
    const old = this.d.select().from(teamRuns).where(and(eq(teamRuns.projectId, projectId), eq(teamRuns.launchRequestId, requestId))).get()
    if (!old) return undefined
    teamAssert(old.launchPayloadHash === hashTeamPayload(payload), 'REQUEST_CONFLICT', 'Launch request ID was reused for different content.')
    return z.record(z.string(), z.json()).parse(parseJson(old.launchAckJson))
  }
  acknowledgment(runId: string, operation: string, requestId: string, payload: unknown): TeamAcknowledgment | undefined {
    const old = this.d.select().from(teamEvents).where(and(eq(teamEvents.runId, runId), eq(teamEvents.operation, operation), eq(teamEvents.clientRequestId, requestId))).get()
    if (!old) return undefined
    teamAssert(old.payloadHash === hashTeamPayload(payload), 'REQUEST_CONFLICT', 'Request ID was reused for different content.')
    return z.record(z.string(), z.json()).parse(parseJson(old.acknowledgmentJson!))
  }
  reserveCapture(reservationInput: TeamCaptureReservation, expectedVersion: number, eventId: string): TeamAcknowledgment {
    const reservation = teamCaptureReservationSchema.parse(reservationInput), run = this.getRun(reservation.runId)
    teamAssert(reservation.ref === `refs/chorus/teams/${run.id}/artifacts/${reservation.attemptId}`, 'INVALID_CAPTURE_REF', 'Artifact ref must derive from its existing run and attempt.')
    return this.command({ runId: run.id, operation: 'capture-reserved', clientRequestId: reservation.attemptId, payload: reservation, actor: 'system', generation: run.generation, eventId, now: reservation.at }, tx => {
      const attempt = tx.snapshot().attempts.find(a => a.id === reservation.attemptId)
      teamAssert(attempt && attempt.version === expectedVersion && attempt.status === 'succeeded' && attempt.cessation === 'confirmed' && attempt.worktreeId !== null && attempt.baseSha === reservation.baseSha && !attempt.artifact, 'CAPTURE_NOT_READY', 'Capture requires the stopped successful attempt and its reserved workspace/base.')
      return { acknowledgment: { ...reservation }, event: { ...reservation } }
    })
  }
  captureReservation(runId: string, attemptId: string): TeamCaptureReservation | null {
    const row = this.d.select().from(teamEvents).where(and(eq(teamEvents.runId, runId), eq(teamEvents.operation, 'capture-reserved'), eq(teamEvents.clientRequestId, attemptId))).get()
    return row ? teamCaptureReservationSchema.parse(parseJson(row.payloadJson)) : null
  }
  recordCaptureObjects(reservation: TeamCaptureReservation, treeSha: string, commitSha: string, eventId: string, now: string, artifactInput?: unknown): TeamAcknowledgment {
    teamShaSchema.parse(treeSha); teamShaSchema.parse(commitSha)
    teamAssert(!this.noChangesCapture(reservation.runId, reservation.attemptId), 'IMMUTABLE_CAPTURE', 'A completed no-change capture cannot become a different artifact.')
    teamAssert(json(this.captureReservation(reservation.runId, reservation.attemptId)) === json(reservation), 'CAPTURE_IDENTITY_CHANGED', 'Capture reservation identity changed.')
    const artifact = artifactInput === undefined ? undefined : teamArtifactSchema.parse(artifactInput)
    if (artifact) teamAssert(artifact.id === reservation.attemptId && artifact.captureId === reservation.captureId && artifact.commitSha === commitSha && artifact.treeSha === treeSha && artifact.ref === reservation.ref && artifact.baseSha === reservation.baseSha && artifact.capturedAt === reservation.at, 'CAPTURE_IDENTITY_CHANGED', 'Capture metadata must match the reserved objects.')
    const run = this.getRun(reservation.runId), payload = { captureId: reservation.captureId, attemptId: reservation.attemptId, treeSha, commitSha, ref: reservation.ref, ...(artifact ? { artifact } : {}) }
    return this.command({ runId: run.id, operation: 'capture-objects', clientRequestId: reservation.captureId, payload, actor: 'system', generation: run.generation, eventId, now }, () => ({ acknowledgment: payload, event: payload }))
  }
  noChangesCapture(runId: string, attemptId: string): { attemptId: string; captureId: string; baseSha: string; treeSha: string; noChanges: true } | null {
    const reservation = this.captureReservation(runId, attemptId)
    if (!reservation) return null
    const row = this.d.select().from(teamEvents).where(and(eq(teamEvents.runId, runId), eq(teamEvents.operation, 'capture-no-changes'), eq(teamEvents.clientRequestId, reservation.captureId))).get()
    if (!row) return null
    const value = z.strictObject({ attemptId: z.string(), captureId: z.string(), baseSha: teamShaSchema, treeSha: teamShaSchema, noChanges: z.literal(true) }).parse(parseJson(row.payloadJson))
    teamAssert(value.attemptId === attemptId && value.captureId === reservation.captureId && value.baseSha === reservation.baseSha, 'CORRUPT_TEAM_STATE', 'No-change capture identity is invalid.')
    return value
  }
  completeNoChangesCapture(reservation: TeamCaptureReservation, treeSha: string, eventId: string, now: string): TeamAcknowledgment {
    teamShaSchema.parse(treeSha)
    teamAssert(json(this.captureReservation(reservation.runId, reservation.attemptId)) === json(reservation), 'CAPTURE_IDENTITY_CHANGED', 'No-change result must match its durable capture reservation.')
    const run = this.getRun(reservation.runId), payload = { attemptId: reservation.attemptId, captureId: reservation.captureId, baseSha: reservation.baseSha, treeSha, noChanges: true }
    return this.command({ runId: run.id, operation: 'capture-no-changes', clientRequestId: reservation.captureId, payload, actor: 'system', generation: run.generation, eventId, now }, tx => {
      const attempt = tx.snapshot().attempts.find(a => a.id === reservation.attemptId)
      const objects = this.d.select({ id: teamEvents.id }).from(teamEvents).where(and(eq(teamEvents.runId, run.id), eq(teamEvents.operation, 'capture-objects'), eq(teamEvents.clientRequestId, reservation.captureId))).get()
      teamAssert(attempt?.status === 'succeeded' && attempt.cessation === 'confirmed' && !attempt.artifact && !objects, 'CAPTURE_NOT_READY', 'No-change capture cannot replace published or journaled artifact objects.')
      return { acknowledgment: payload, event: payload }
    })
  }
  publishArtifact(runId: string, artifactInput: unknown, expectedVersion: number, eventId: string, now: string): TeamAcknowledgment {
    const artifact = teamArtifactSchema.parse(artifactInput), reservation = this.captureReservation(runId, artifact.id), run = this.getRun(runId)
    teamAssert(reservation && reservation.captureId === artifact.captureId && reservation.baseSha === artifact.baseSha && reservation.ref === artifact.ref && reservation.at === artifact.capturedAt, 'CAPTURE_IDENTITY_CHANGED', 'Artifact does not match its durable capture reservation.')
    const intended = this.d.select().from(teamEvents).where(and(eq(teamEvents.runId, runId), eq(teamEvents.operation, 'capture-objects'), eq(teamEvents.clientRequestId, artifact.captureId))).get()
    const values = intended ? z.strictObject({ captureId: z.string(), attemptId: z.string(), treeSha: z.string(), commitSha: z.string(), ref: z.string(), artifact: teamArtifactSchema.optional() }).parse(parseJson(intended.payloadJson)) : null
    teamAssert(values?.treeSha === artifact.treeSha && values.commitSha === artifact.commitSha && values.ref === artifact.ref, 'UNJOURNALED_ARTIFACT', 'Artifact objects must be journaled before ref/metadata publication.')
    if (values?.artifact) teamAssert(json(values.artifact) === json(artifact), 'CAPTURE_IDENTITY_CHANGED', 'Artifact differs from its journaled metadata.')
    return this.command({ runId, operation: 'capture-published', clientRequestId: artifact.captureId, payload: artifact, actor: 'system', generation: run.generation, eventId, now }, tx => {
      const attempt = tx.snapshot().attempts.find(a => a.id === artifact.id)
      teamAssert(attempt && attempt.version === expectedVersion && attempt.status === 'succeeded' && attempt.cessation === 'confirmed', 'CAPTURE_NOT_READY', 'Attempt changed before artifact publication.')
      tx.writeAttempt({ ...attempt, artifact, version: attempt.version + 1 }, attempt.version)
      return { acknowledgment: { artifactId: artifact.id, commitSha: artifact.commitSha }, event: { artifactId: artifact.id, captureId: artifact.captureId, commitSha: artifact.commitSha, ref: artifact.ref } }
    })
  }
  reserveWorkspace(operation: TeamOperation & { clientRequestId: string }, entity: { kind: 'run' | 'attempt' | 'integration'; id: string; worktreeId: string; expectedVersion: number }): TeamAcknowledgment {
    return this.command({ ...operation, operation: 'workspace-reserved', payload: entity }, tx => {
      const snapshot = tx.snapshot()
      teamAssert(snapshot.run.generation === operation.generation && ['preparing', 'active'].includes(snapshot.run.status), 'WORKSPACE_NOT_AUTHORIZED', 'Workspace reservation requires the current writable generation.')
      if (entity.kind === 'run') { teamAssert(snapshot.run.id === entity.id && snapshot.run.status === 'preparing' && !snapshot.run.integrationWorktreeId, 'WORKSPACE_ALREADY_LINKED', 'Run workspace is unavailable.'); tx.updateRun(entity.expectedVersion, { ...snapshot.run, integrationWorktreeId: entity.worktreeId, version: entity.expectedVersion + 1, updatedAt: operation.now }) }
      else if (entity.kind === 'attempt') { const attempt = snapshot.attempts.find(a => a.id === entity.id); teamAssert(attempt && attempt.status === 'preparing' && !attempt.terminalIntent && attempt.generation === snapshot.run.generation && !attempt.worktreeId, 'WORKSPACE_ALREADY_LINKED', 'Attempt workspace is unavailable.'); tx.writeAttempt({ ...attempt, worktreeId: entity.worktreeId, version: entity.expectedVersion + 1 }, entity.expectedVersion) }
      else { const integration = snapshot.integrations.find(i => i.id === entity.id); teamAssert(integration && integration.status === 'preparing' && !integration.stagingWorktreeId, 'WORKSPACE_ALREADY_LINKED', 'Integration workspace is unavailable.'); tx.writeIntegration({ ...integration, stagingWorktreeId: entity.worktreeId, version: entity.expectedVersion + 1, updatedAt: operation.now }, entity.expectedVersion) }
      return { acknowledgment: { operationId: operation.clientRequestId, ...entity }, event: { operationId: operation.clientRequestId, ...entity } }
    })
  }
  completeWorkspace(operation: TeamOperation & { clientRequestId: string }, result: { worktreeId: string; head: string }): TeamAcknowledgment {
    teamShaSchema.parse(result.head)
    const reservation = this.d.select().from(teamEvents).where(and(eq(teamEvents.runId, operation.runId), eq(teamEvents.operation, 'workspace-reserved'), eq(teamEvents.clientRequestId, operation.clientRequestId))).get()
    const payload = reservation ? z.object({ worktreeId: z.string() }).parse(parseJson(reservation.payloadJson)) : null
    teamAssert(payload?.worktreeId === result.worktreeId, 'WORKSPACE_NOT_RESERVED', 'Workspace must have durable ownership before Git effects.')
    return this.command({ ...operation, operation: 'workspace-completed', payload: result }, () => ({ acknowledgment: result, event: { operationId: operation.clientRequestId, ...result } }))
  }
  unfinishedOperations(runId: string): TeamEvent[] {
    const all = this.d.select().from(teamEvents).where(eq(teamEvents.runId, runId)).orderBy(asc(teamEvents.sequence)).all()
    const finished = new Set(all.filter(e => ['workspace-completed', 'capture-published', 'capture-no-changes'].includes(e.operation)).map(e => `${e.operation === 'capture-no-changes' ? 'capture-published' : e.operation}:${e.clientRequestId}`))
    return all.filter(e => e.operation === 'workspace-reserved' && !finished.has(`workspace-completed:${e.clientRequestId}`) || e.operation === 'capture-reserved' && !finished.has(`capture-published:${teamCaptureReservationSchema.parse(parseJson(e.payloadJson)).captureId}`)).map(row => teamEventSchema.parse({ id: row.id, runId: row.runId, sequence: row.sequence, generation: row.generation, operation: row.operation, clientRequestId: row.clientRequestId, payloadHash: row.payloadHash, acknowledgment: row.acknowledgmentJson ? parseJson(row.acknowledgmentJson) : null, actor: row.actor, entityId: row.entityId, payload: parseJson(row.payloadJson), at: row.at }))
  }
  createRun(runInput: TeamRun, requestId: string, payload: unknown, eventId: string): TeamAcknowledgment {
    const run = teamRunSchema.parse(runInput), payloadHash = hashTeamPayload(payload)
    return this.db.transaction(() => {
      const existing = this.d.select().from(teamRuns).where(and(eq(teamRuns.projectId, run.projectId), eq(teamRuns.launchRequestId, requestId))).get()
      if (existing) {
        teamAssert(existing.launchPayloadHash === payloadHash, 'REQUEST_CONFLICT', 'Launch request ID was reused for different content.')
        return z.record(z.string(), z.json()).parse(parseJson(existing.launchAckJson))
      }
      const acknowledgment = { runId: run.id }
      this.d.insert(teamRuns).values({ ...this.runColumns(run), launchRequestId: requestId, launchPayloadHash: payloadHash, launchAckJson: json(acknowledgment) }).run()
      for (const member of [run.config.lead, ...run.config.helpers]) this.d.insert(teamMembers).values({ id: member.id, runId: run.id, credentialProfileId: member.credentialProfileId, configJson: json(member) }).run()
      this.appendEvent({ runId: run.id, operation: 'run-created', actor: 'user', generation: run.generation, eventId, now: run.createdAt }, { status: run.status }, null, null, null)
      return acknowledgment
    }).immediate()
  }
  /** Original acknowledgment and the first domain change commit together. Never pass async work here. */
  command(operation: TeamOperation, change: (transaction: TeamTransaction) => { acknowledgment: TeamAcknowledgment; event: Record<string, TeamJson> }): TeamAcknowledgment {
    const payloadHash = operation.clientRequestId ? hashTeamPayload(operation.payload) : null
    return this.db.transaction(() => {
      if (operation.clientRequestId) {
        const old = this.d.select().from(teamEvents).where(and(eq(teamEvents.runId, operation.runId), eq(teamEvents.operation, operation.operation), eq(teamEvents.clientRequestId, operation.clientRequestId))).get()
        if (old) {
          teamAssert(old.payloadHash === payloadHash, 'REQUEST_CONFLICT', 'Request ID was reused for different content.')
          return z.record(z.string(), z.json()).parse(parseJson(old.acknowledgmentJson!))
        }
      }
      const run = this.getRun(operation.runId)
      teamAssert(run.generation === operation.generation || operation.actor === 'system', 'STALE_GENERATION', 'The run generation changed.')
      const result = change(new TeamTransaction(this, operation.runId))
      teamAssert(result && typeof result === 'object' && !('then' in result), 'ASYNC_TRANSACTION', 'Team transactions cannot contain awaited effects.')
      const acknowledgment = z.record(z.string(), z.json()).parse(result.acknowledgment)
      this.appendEvent(operation, result.event, operation.clientRequestId ?? null, payloadHash, operation.clientRequestId ? acknowledgment : null)
      return acknowledgment
    }).immediate()
  }
  private appendEvent(operation: TeamOperation, payload: Record<string, TeamJson>, requestId: string | null, payloadHash: string | null, acknowledgment: TeamAcknowledgment | null): void {
    const highest = this.d.select({ sequence: max(teamEvents.sequence) }).from(teamEvents).where(eq(teamEvents.runId, operation.runId)).get()?.sequence ?? 0
    const cleanPayload = JSON.parse(scrubSecrets(JSON.stringify(payload)))
    const event = teamEventSchema.parse({ id: operation.eventId, runId: operation.runId, sequence: highest + 1, generation: operation.generation, operation: operation.operation, actor: operation.actor, entityId: operation.entityId ?? null, clientRequestId: requestId, payloadHash, acknowledgment, payload: cleanPayload, at: operation.now })
    this.d.insert(teamEvents).values({ id: event.id, runId: event.runId, sequence: event.sequence, generation: event.generation, operation: event.operation, clientRequestId: event.clientRequestId, payloadHash: event.payloadHash, acknowledgmentJson: acknowledgment === null ? null : json(acknowledgment), actor: event.actor, entityId: event.entityId, payloadJson: json(event.payload), at: event.at }).run()
  }
  private runColumns(run: TeamRun) {
    return { id: run.id, projectId: run.projectId, leadSessionId: run.leadSessionId, status: run.status, generation: run.generation, version: run.version, policyVersion: run.policyVersion, configJson: json(run.config), baseSha: run.baseSha, integrationWorktreeId: run.integrationWorktreeId, integrationHead: run.integrationHead, recordJson: json(run), createdAt: run.createdAt, updatedAt: run.updatedAt }
  }
  private requireTransaction(): void { teamAssert(this.db.inTransaction, 'TRANSACTION_REQUIRED', 'Team state changes require an atomic event transaction.') }
  /** Internal transaction methods; all public callers receive the restricted scoped facade below. */
  updateRun(expectedVersion: number, value: TeamRun): void {
    this.requireTransaction(); const run = teamRunSchema.parse(value)
    teamAssert(run.version === expectedVersion + 1, 'INVALID_VERSION', 'Run version must advance once.')
    const before = this.getRun(run.id)
    teamAssert(before.projectId === run.projectId && json(before.config) === json(run.config) && before.createdAt === run.createdAt, 'IMMUTABLE_RUN', 'Run launch configuration is immutable.')
    teamAssert(!before.destination || json(before.destination) === json(run.destination), 'IMMUTABLE_DESTINATION', 'The recorded destination checkout, branch and HEAD cannot change.')
    teamAssert(this.d.update(teamRuns).set(this.runColumns(run)).where(and(eq(teamRuns.id, run.id), eq(teamRuns.version, expectedVersion))).run().changes === 1, 'STALE_VERSION', 'Run state changed.')
  }
  writeTask(value: TeamTask, expectedVersion?: number): void {
    this.requireTransaction(); const task = teamTaskSchema.parse(value)
    const row = { id: task.id, runId: task.runId, kind: task.command.kind, status: task.status, version: task.version, currentAttemptId: task.currentAttemptId, attemptCount: task.attemptCount, commandJson: json(task.command), recordJson: json(task), createdAt: task.createdAt, updatedAt: task.updatedAt }
    if (expectedVersion === undefined) { teamAssert(task.version === 1, 'INVALID_VERSION', 'New task starts at version one.'); this.d.insert(teamTasks).values(row).run() }
    else { teamAssert(task.version === expectedVersion + 1, 'INVALID_VERSION', 'Task version must advance once.'); teamAssert(this.d.update(teamTasks).set(row).where(and(eq(teamTasks.id, task.id), eq(teamTasks.runId, task.runId), eq(teamTasks.version, expectedVersion))).run().changes === 1, 'STALE_VERSION', 'Task state changed.') }
  }
  writeAttempt(value: TeamAttempt, expectedVersion?: number): void {
    this.requireTransaction(); const attempt = teamAttemptSchema.parse(value)
    const prior = expectedVersion === undefined ? undefined : this.attempts(attempt.runId).find(a => a.id === attempt.id)
    if (prior?.artifact) teamAssert(json(prior.artifact) === json(attempt.artifact), 'IMMUTABLE_ARTIFACT', 'Published attempt artifacts cannot change.')
    if (prior) teamAssert(prior.taskId === attempt.taskId && prior.memberId === attempt.memberId && prior.number === attempt.number && prior.generation === attempt.generation && prior.brief === attempt.brief && prior.context === attempt.context && json(prior.acceptance) === json(attempt.acceptance) && prior.baseSha === attempt.baseSha && (!prior.worktreeId || prior.worktreeId === attempt.worktreeId), 'IMMUTABLE_ATTEMPT', 'Attempt identity and instructions cannot change.')
    const row = { id: attempt.id, runId: attempt.runId, taskId: attempt.taskId, number: attempt.number, memberId: attempt.memberId, generation: attempt.generation, status: attempt.status, version: attempt.version, worktreeId: attempt.worktreeId, baseSha: attempt.baseSha, processJson: attempt.process === null ? null : json(attempt.process), resultJson: attempt.result === null ? null : json(attempt.result), artifactJson: attempt.artifact === null ? null : json(attempt.artifact), recordJson: json(attempt) }
    if (expectedVersion === undefined) { teamAssert(attempt.version === 1, 'INVALID_VERSION', 'New attempt starts at version one.'); this.d.insert(teamAttempts).values(row).run() }
    else { teamAssert(attempt.version === expectedVersion + 1, 'INVALID_VERSION', 'Attempt version must advance once.'); teamAssert(this.d.update(teamAttempts).set(row).where(and(eq(teamAttempts.id, attempt.id), eq(teamAttempts.runId, attempt.runId), eq(teamAttempts.version, expectedVersion))).run().changes === 1, 'STALE_VERSION', 'Attempt state changed.') }
  }
  writeIntegration(value: TeamIntegration, expectedVersion?: number): void {
    this.requireTransaction(); const integration = teamIntegrationSchema.parse(value)
    const prior = expectedVersion === undefined ? undefined : this.integrations(integration.runId).find(i => i.id === integration.id)
    if (prior) teamAssert(prior.taskId === integration.taskId && prior.attemptId === integration.attemptId && prior.preparationId === integration.preparationId && prior.artifactSha === integration.artifactSha && prior.expectedHead === integration.expectedHead && prior.policyVersion === integration.policyVersion && (!prior.resultSha || prior.resultSha === integration.resultSha) && (!prior.stagingWorktreeId || prior.stagingWorktreeId === integration.stagingWorktreeId), 'IMMUTABLE_PREPARATION', 'Repreparation requires a new integration/preparation identity; exact prepared content is immutable.')
    const row = { id: integration.id, runId: integration.runId, taskId: integration.taskId, attemptId: integration.attemptId, preparationId: integration.preparationId, artifactSha: integration.artifactSha, expectedHead: integration.expectedHead, resultSha: integration.resultSha, stagingWorktreeId: integration.stagingWorktreeId, status: integration.status, version: integration.version, policyVersion: integration.policyVersion, recordJson: json(integration), createdAt: integration.createdAt, updatedAt: integration.updatedAt }
    if (expectedVersion === undefined) { teamAssert(integration.version === 1, 'INVALID_VERSION', 'New integration starts at version one.'); this.d.insert(teamIntegrations).values(row).run() }
    else { teamAssert(integration.version === expectedVersion + 1, 'INVALID_VERSION', 'Integration version must advance once.'); teamAssert(this.d.update(teamIntegrations).set(row).where(and(eq(teamIntegrations.id, integration.id), eq(teamIntegrations.runId, integration.runId), eq(teamIntegrations.version, expectedVersion))).run().changes === 1, 'STALE_VERSION', 'Integration state changed.') }
  }
  savePreset(id: string, label: string, config: TeamRunConfig, now: string): void {
    const validated = teamRunConfigSchema.parse(config)
    teamAssert(label.trim().length > 0 && label.length <= 100, 'INVALID_PRESET', 'Preset label must contain 1–100 characters.')
    this.d.insert(teamPresets).values({ id, label: label.trim(), schemaVersion: 1, configJson: json(validated), createdAt: now, updatedAt: now }).onConflictDoUpdate({ target: teamPresets.id, set: { label: label.trim(), configJson: json(validated), updatedAt: now } }).run()
  }
  listPresets(): Array<{ id: string; label: string; version: number; config: TeamRunConfig }> {
    return this.d.select().from(teamPresets).orderBy(asc(teamPresets.label)).all().map(row => ({ id: row.id, label: row.label, version: row.version, config: teamRunConfigSchema.parse(parseJson(row.configJson)) }))
  }
  savePresetVersioned(id: string, expectedVersion: number | null, label: string, config: TeamRunConfig, now: string): void {
    this.db.transaction(() => {
      const old = this.d.select().from(teamPresets).where(eq(teamPresets.id, id)).get()
      teamAssert(old ? expectedVersion === old.version : expectedVersion === null, 'STALE_VERSION', 'Preset changed; refresh before saving.')
      this.savePreset(id, label, config, now)
      if (old) this.d.update(teamPresets).set({ version: old.version + 1 }).where(eq(teamPresets.id, id)).run()
    }).immediate()
  }
  deletePresetVersioned(id: string, expectedVersion: number): void {
    teamAssert(this.d.delete(teamPresets).where(and(eq(teamPresets.id, id), eq(teamPresets.version, expectedVersion))).run().changes === 1, 'STALE_VERSION', 'Preset changed; refresh before deleting.')
  }
  deletePreset(id: string): void { this.d.delete(teamPresets).where(eq(teamPresets.id, id)).run() }
  listMemberProfiles(): TeamMemberProfile[] {
    return (this.db.prepare('SELECT record_json FROM team_member_profiles').all() as { record_json: string }[])
      .map(row => teamMemberProfileSchema.parse(parseJson(row.record_json))).sort((a, b) => a.label.localeCompare(b.label))
  }
  saveMemberProfile(id: string, expectedVersion: number | null, build: (old: TeamMemberProfile | undefined) => TeamMemberProfile): void {
    this.db.transaction(() => {
      const old = this.listMemberProfiles().find(row => row.id === id)
      teamAssert(old ? old.version === expectedVersion : expectedVersion === null, 'STALE_VERSION', 'Member changed; refresh before saving.')
      const row = teamMemberProfileSchema.parse(build(old))
      teamAssert(row.id === id && row.version === (old?.version ?? 0) + 1, 'INVALID_VERSION', 'Member version must advance once.')
      this.db.prepare('INSERT INTO team_member_profiles(id,version,credential_profile_id,record_json) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,credential_profile_id=excluded.credential_profile_id,record_json=excluded.record_json')
        .run(row.id, row.version, row.credentialProfileId, json(row))
    }).immediate()
  }
  deleteMemberProfile(id: string, expectedVersion: number): void {
    teamAssert(this.db.prepare('DELETE FROM team_member_profiles WHERE id=? AND version=?').run(id, expectedVersion).changes === 1, 'STALE_VERSION', 'Member changed; refresh before deleting.')
  }
  countMemberProfilesForCredential(id: string): number {
    return (this.db.prepare('SELECT count(*) AS n FROM team_member_profiles WHERE credential_profile_id=?').get(id) as { n: number }).n
  }
}

export class TeamTransaction {
  constructor(private readonly storage: TeamStorage, readonly runId: string) {}
  snapshot(): TeamSnapshot { return this.storage.snapshot(this.runId) }
  updateRun(expectedVersion: number, value: TeamRun): void { teamAssert(value.id === this.runId, 'WRONG_RUN', 'Run scope mismatch.'); this.storage.updateRun(expectedVersion, value) }
  writeTask(value: TeamTask, expectedVersion?: number): void { teamAssert(value.runId === this.runId, 'WRONG_RUN', 'Task scope mismatch.'); this.storage.writeTask(value, expectedVersion) }
  writeAttempt(value: TeamAttempt, expectedVersion?: number): void { teamAssert(value.runId === this.runId, 'WRONG_RUN', 'Attempt scope mismatch.'); this.storage.writeAttempt(value, expectedVersion) }
  writeIntegration(value: TeamIntegration, expectedVersion?: number): void { teamAssert(value.runId === this.runId, 'WRONG_RUN', 'Integration scope mismatch.'); this.storage.writeIntegration(value, expectedVersion) }
}

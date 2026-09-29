import { z } from 'zod'
import { teamMemberProfileSaveSchema, teamMemberProfileDeleteSchema, type TeamMemberProfileList } from './teamProfiles'

export const TEAM_LIMITS = Object.freeze({ roster: 16, concurrency: 8, defaultConcurrency: 2, attempts: 3, preparationMs: 300000, defaultExecutionMinutes: 30, bodyBytes: 1048576, textBytes: 65536, dependencies: 32, paths: 128, events: 200, waitMs: 20000, outputBytes: 10485760 })
const utf8 = (limit: number, nonempty = false) => z.string().refine(s => (!nonempty || s.trim().length > 0) && new TextEncoder().encode(s).byteLength <= limit, `Text must fit ${limit} UTF-8 bytes.`)
export const teamIdSchema = z.uuid()
export const teamRequestIdSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/)
export const teamShaSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)
export const teamRunStatusSchema = z.enum(['preparing', 'active', 'pausing', 'paused', 'stopping', 'stopped', 'completed', 'recovering', 'blocked'])
export const teamTaskStatusSchema = z.enum(['queued', 'running', 'awaiting-review', 'needs-revision', 'awaiting-approval', 'integrating', 'completed', 'blocked', 'failed', 'cancelled'])
export const teamAttemptStatusSchema = z.enum(['preparing', 'running', 'cancelling', 'succeeded', 'failed', 'interrupted', 'timed-out', 'cancelled', 'permission-blocked'])
export const teamIntegrationStatusSchema = z.enum(['preparing', 'prepared', 'awaiting-approval', 'approved', 'applying', 'applied', 'rejected', 'conflict', 'interrupted', 'recovery-required'])
export type TeamRunStatus = z.infer<typeof teamRunStatusSchema>
export type TeamTaskStatus = z.infer<typeof teamTaskStatusSchema>
export type TeamAttemptStatus = z.infer<typeof teamAttemptStatusSchema>
export type TeamIntegrationStatus = z.infer<typeof teamIntegrationStatusSchema>

const memberFields = {
  id: teamIdSchema, label: z.string().trim().min(1).max(100), harness: z.enum(['claude', 'codex', 'opencode']),
  authMode: z.enum(['subscription', 'api_key']), providerId: teamIdSchema.nullable(), credentialProfileId: teamIdSchema.nullable(),
  model: z.string().trim().min(1).max(200), effort: z.string().trim().min(1).max(32).nullable(),
  installedVersion: z.string().trim().min(1).max(100),
  profileId: teamIdSchema.optional(), customModel: z.boolean().optional(), instructions: z.string().max(8000).optional()
}
export const teamMemberSchema = z.strictObject(memberFields).superRefine((v, ctx) => {
  if (v.authMode === 'api_key' && (!v.providerId || !v.credentialProfileId)) ctx.addIssue({ code: 'custom', message: 'API routing requires a provider and credential reference.' })
  if (v.authMode === 'subscription' && (v.providerId || v.credentialProfileId)) ctx.addIssue({ code: 'custom', message: 'Subscription routing uses the CLI current account only.' })
})
export const teamRunConfigSchema = z.strictObject({
  schemaVersion: z.literal(1), baseRevision: z.string().trim().min(1).max(1024),
  lead: teamMemberSchema.refine(v => v.harness !== 'opencode', 'Lead must be Claude or Codex.'),
  helpers: z.array(teamMemberSchema).min(1).max(TEAM_LIMITS.roster),
  concurrency: z.number().int().min(1).max(TEAM_LIMITS.concurrency).default(TEAM_LIMITS.defaultConcurrency),
  executionMinutes: z.number().int().min(5).max(240).default(TEAM_LIMITS.defaultExecutionMinutes),
  integrationPolicy: z.enum(['ask', 'lead-integrates']).default('lead-integrates')
}).superRefine((v, ctx) => {
  const ids = [v.lead.id, ...v.helpers.map(m => m.id)]
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'Roster member IDs must be unique, including the lead.' })
})
export type TeamMember = z.infer<typeof teamMemberSchema>
export type TeamRunConfig = z.infer<typeof teamRunConfigSchema>

export const teamDelegateSchema = z.strictObject({
  clientRequestId: teamRequestIdSchema, memberId: teamIdSchema, kind: z.enum(['code', 'analysis']),
  title: z.string().trim().min(1).max(200), brief: utf8(TEAM_LIMITS.textBytes, true), context: utf8(TEAM_LIMITS.textBytes).default(''),
  acceptance: z.array(utf8(4096, true)).min(1).max(32),
  paths: z.array(z.string().min(1).max(1024)).max(TEAM_LIMITS.paths).default([]).describe('Writable repository-relative files/directories owned by this task, including private build/test files. Exclude read-only references. Missing, wildcard or overlapping scopes serialize code work; separate deliverables need disjoint scopes.'),
  dependsOn: z.array(teamIdSchema).max(TEAM_LIMITS.dependencies).default([]).transform(ids => [...new Set(ids)].sort())
})
export const teamTestEvidenceSchema = z.strictObject({
  command: utf8(16384, true), outcome: z.enum(['passed', 'failed', 'blocked', 'not-run']), exitCode: z.number().int().nullable(),
  executionContext: z.enum(['helper', 'staging', 'integration', 'external']), testedSha: teamShaSchema.nullable(),
  testSource: z.enum(['tracked', 'new', 'modified', 'external', 'unknown']), provenance: z.enum(['helper-reported', 'lead-verified', 'independent']),
  sourcePaths: z.array(z.string().min(1).max(1024)).max(128).optional(), sourceDiffSha: teamShaSchema.nullable().optional(),
  output: utf8(16384)
})
export const teamReviewSchema = z.strictObject({
  clientRequestId: teamRequestIdSchema, taskId: teamIdSchema, attemptId: teamIdSchema,
  phase: z.enum(['artifact', 'prepared', 'integrated']), integrationId: teamIdSchema.optional(), reviewedSha: teamShaSchema.optional().describe('Artifact phase: attempt.artifact.commitSha. Prepared phase: integration.resultSha. Integrated phase: current verified integration HEAD.'),
  originalResultSha: teamShaSchema.optional().describe('Integrated phase: the prepared/promoted integration.resultSha, NOT the helper artifact commit SHA.'), verifiedHead: teamShaSchema.optional().describe('Integrated phase: the current clean integration worktree HEAD where tests ran.'), decision: z.enum(['accept', 'revise']),
  explanation: utf8(TEAM_LIMITS.textBytes, true), tests: z.array(teamTestEvidenceSchema).max(64)
}).superRefine((v, ctx) => {
  if (v.phase !== 'artifact' && (!v.integrationId || !v.reviewedSha)) ctx.addIssue({ code: 'custom', message: 'Integration review requires exact integration and SHA identity.' })
  if (v.phase === 'integrated' && (!v.originalResultSha || !v.verifiedHead || v.tests.length === 0)) ctx.addIssue({ code: 'custom', message: 'Integrated verification requires original result, current verified HEAD and test evidence.' })
})
export const teamReviseSchema = z.strictObject({ clientRequestId: teamRequestIdSchema, taskId: teamIdSchema, memberId: teamIdSchema, brief: utf8(TEAM_LIMITS.textBytes, true) })
export const teamIntegrateSchema = z.strictObject({
  action: z.enum(['prepare', 'apply']), clientRequestId: teamRequestIdSchema, taskId: teamIdSchema, attemptId: teamIdSchema,
  reviewedHead: teamShaSchema.describe('For BOTH prepare and apply: the accepted helper attempt.artifact.commitSha. Do not put integration.resultSha here.'), expectedIntegrationHead: teamShaSchema.describe('For prepare: the current integration HEAD. For apply: the selected integration.expectedHead.'), integrationId: teamIdSchema.optional()
}).refine(v => v.action !== 'apply' || !!v.integrationId, 'Apply requires integration identity.')
export const teamStatusSchema = z.strictObject({ taskId: teamIdSchema.optional(), afterSequence: z.number().int().nonnegative().default(0) })
export const teamWaitSchema = z.strictObject({ taskIds: z.array(teamIdSchema).max(200), afterSequence: z.number().int().nonnegative().default(0), timeoutMs: z.number().int().min(0).max(TEAM_LIMITS.waitMs).default(TEAM_LIMITS.waitMs) })
export const teamCancelSchema = z.strictObject({ clientRequestId: teamRequestIdSchema, taskId: teamIdSchema, reason: utf8(4096, true) })
export const teamToolSchemas = {
  team_roster: z.strictObject({}), team_delegate: teamDelegateSchema, team_status: teamStatusSchema, team_wait: teamWaitSchema,
  team_review: teamReviewSchema, team_revise: teamReviseSchema, team_integrate: teamIntegrateSchema, team_cancel: teamCancelSchema
} as const
export type TeamToolName = keyof typeof teamToolSchemas
export type TeamDelegate = z.infer<typeof teamDelegateSchema>
export type TeamReview = z.infer<typeof teamReviewSchema>
export type TeamRevise = z.infer<typeof teamReviseSchema>
export type TeamIntegrate = z.infer<typeof teamIntegrateSchema>
export const teamLaunchSchema = z.strictObject({ projectId: teamIdSchema, clientRequestId: teamRequestIdSchema, config: teamRunConfigSchema })
export const teamLifecycleSchema = z.strictObject({ runId: teamIdSchema, clientRequestId: teamRequestIdSchema, expectedVersion: z.number().int().positive(), action: z.enum(['activate', 'recover', 'pause', 'resume', 'stop', 'complete']) })
export const teamIntegrationDecisionSchema = z.strictObject({ runId: teamIdSchema, clientRequestId: teamRequestIdSchema, integrationId: teamIdSchema, expectedVersion: z.number().int().positive(), decision: z.enum(['approve', 'reject']) })

const timestamp = z.iso.datetime()
const version = z.number().int().positive()
export const teamRunSchema = z.strictObject({
  id: teamIdSchema, projectId: teamIdSchema, leadSessionId: teamIdSchema.nullable(), config: teamRunConfigSchema,
  status: teamRunStatusSchema, generation: version, version, policyVersion: version, baseSha: teamShaSchema.nullable(),
  integrationWorktreeId: teamIdSchema.nullable(), integrationHead: teamShaSchema.nullable(), createdAt: timestamp, updatedAt: timestamp,
  blocker: utf8(4096).nullable()
})
export const teamTaskSchema = z.strictObject({
  id: teamIdSchema, runId: teamIdSchema, command: teamDelegateSchema, status: teamTaskStatusSchema, version,
  currentAttemptId: teamIdSchema.nullable(), attemptCount: z.number().int().min(0).max(TEAM_LIMITS.attempts),
  readyAt: timestamp.nullable(), createdAt: timestamp, updatedAt: timestamp, blocker: utf8(4096).nullable()
})
export const teamProcessIdentitySchema = z.strictObject({ pid: z.number().int().positive(), creationTime: z.string().regex(/^\d+$/), executable: z.string().min(1).max(32768) })
export const teamUsageSchema = z.strictObject({ inputTokens: z.number().nonnegative().nullable(), outputTokens: z.number().nonnegative().nullable(), cachedTokens: z.number().nonnegative().nullable(), costUsd: z.number().nonnegative().nullable(), costKind: z.enum(['reported', 'list-price-estimate', 'unknown']), source: z.string().min(1).max(100) })
export const teamArtifactSchema = z.strictObject({
  id: teamIdSchema, captureId: teamIdSchema, baseSha: teamShaSchema, finalHelperHead: teamShaSchema, treeSha: teamShaSchema,
  commitSha: teamShaSchema, ref: z.string().min(1).max(1024), manifest: z.array(z.string().min(1).max(32768)).max(100000), capturedAt: timestamp
})
export const teamCaptureReservationSchema = z.strictObject({
  runId: teamIdSchema, attemptId: teamIdSchema, captureId: teamIdSchema, baseSha: teamShaSchema,
  ref: z.string().regex(/^refs\/chorus\/teams\/[a-f0-9-]+\/artifacts\/[a-f0-9-]+$/),
  authorName: z.literal('Chorus'), authorEmail: z.literal('chorus@localhost'), at: timestamp
})
export type TeamCaptureReservation = z.infer<typeof teamCaptureReservationSchema>
export const teamAttemptSchema = z.strictObject({
  id: teamIdSchema, taskId: teamIdSchema, runId: teamIdSchema, number: z.number().int().min(1).max(TEAM_LIMITS.attempts), memberId: teamIdSchema,
  generation: version, status: teamAttemptStatusSchema, version, baseSha: teamShaSchema.nullable(), worktreeId: teamIdSchema.nullable(),
  brief: utf8(TEAM_LIMITS.textBytes, true), context: utf8(TEAM_LIMITS.textBytes), acceptance: z.array(utf8(4096, true)).min(1).max(32),
  process: teamProcessIdentitySchema.nullable(), descendants: z.array(teamProcessIdentitySchema).max(4096), cessation: z.enum(['not-started', 'live', 'confirmed', 'unknown']),
  preparationDeadline: timestamp, executionDeadline: timestamp.nullable(), startedAt: timestamp.nullable(), endedAt: timestamp.nullable(),
  terminalIntent: z.enum(['cancelled', 'timed-out']).nullable(), result: z.strictObject({ summary: utf8(TEAM_LIMITS.bodyBytes), isError: z.boolean(), tests: z.array(teamTestEvidenceSchema).max(64) }).nullable(),
  artifact: teamArtifactSchema.nullable(), usage: z.array(teamUsageSchema).max(10000), blocker: utf8(4096).nullable()
})
export const teamApprovalBindingSchema = z.strictObject({ integrationId: teamIdSchema, preparationId: teamIdSchema, artifactSha: teamShaSchema, integrationHead: teamShaSchema, resultSha: teamShaSchema, policyVersion: version })
export const teamIntegrationSchema = z.strictObject({
  id: teamIdSchema, runId: teamIdSchema, taskId: teamIdSchema, attemptId: teamIdSchema, preparationId: teamIdSchema, artifactSha: teamShaSchema,
  expectedHead: teamShaSchema, resultSha: teamShaSchema.nullable(), stagingWorktreeId: teamIdSchema.nullable(), status: teamIntegrationStatusSchema,
  version, policyVersion: version, preparedReviewId: teamIdSchema.nullable(), approval: z.strictObject({ binding: teamApprovalBindingSchema, principal: z.string().min(1).max(200), decision: z.enum(['approve', 'reject']), at: timestamp }).nullable(),
  createdAt: timestamp, updatedAt: timestamp, blocker: utf8(4096).nullable()
})
export const teamEventSchema = z.strictObject({
  id: teamIdSchema, runId: teamIdSchema, sequence: version, generation: version, operation: z.string().min(1).max(100), entityId: teamIdSchema.nullable(),
  actor: z.enum(['user', 'lead', 'system']), clientRequestId: teamRequestIdSchema.nullable(), payloadHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  acknowledgment: z.record(z.string(), z.json()).nullable(), payload: z.record(z.string(), z.json()), at: timestamp
})
export type TeamRun = z.infer<typeof teamRunSchema>
export type TeamTask = z.infer<typeof teamTaskSchema>
export type TeamAttempt = z.infer<typeof teamAttemptSchema>
export type TeamIntegration = z.infer<typeof teamIntegrationSchema>
export type TeamEvent = z.infer<typeof teamEventSchema>
export const teamReviewQuerySchema = z.strictObject({ runId: teamIdSchema, integrationId: teamIdSchema, expectedVersion: version })
export const teamPreviewQuerySchema = teamReviewQuerySchema.extend({ path: z.string().min(1).max(32768), side: z.enum(['before', 'after']) })
export const teamReviewPacketSchema = z.strictObject({
  integration: teamIntegrationSchema, title: z.string(), explanation: z.string(), tests: z.array(teamTestEvidenceSchema),
  paths: z.array(z.string()), diff: z.string(), truncated: z.boolean()
})
export const teamFilePreviewSchema = z.strictObject({ path: z.string(), sha: teamShaSchema, kind: z.enum(['html', 'image', 'pdf', 'text', 'unavailable']), content: z.string(), note: z.string() })
export type TeamReviewPacket = z.infer<typeof teamReviewPacketSchema>
export type TeamFilePreview = z.infer<typeof teamFilePreviewSchema>
export type TeamApprovalBinding = z.infer<typeof teamApprovalBindingSchema>
export interface TeamSnapshot { run: TeamRun; members: TeamMember[]; tasks: TeamTask[]; attempts: TeamAttempt[]; integrations: TeamIntegration[]; events: TeamEvent[]; lastSequence: number; hasMoreEvents: boolean }

export const teamSnapshotSchema = z.strictObject({ run: teamRunSchema, members: z.array(teamMemberSchema), tasks: z.array(teamTaskSchema), attempts: z.array(teamAttemptSchema), integrations: z.array(teamIntegrationSchema), events: z.array(teamEventSchema).max(TEAM_LIMITS.events), lastSequence: z.number().int().nonnegative(), hasMoreEvents: z.boolean() })
export const teamProjectQuerySchema = z.strictObject({ projectId: teamIdSchema })
export const teamListSchema = z.strictObject({ runs: z.array(teamRunSchema), unavailable: z.array(z.strictObject({ runId: teamIdSchema, reason: utf8(4096, true) })) })
export const teamSnapshotQuerySchema = z.strictObject({ runId: teamIdSchema, afterSequence: z.number().int().nonnegative().default(0) })
export const teamPresetSchema = z.strictObject({ id: teamIdSchema, label: z.string().trim().min(1).max(100), version: z.number().int().positive(), config: teamRunConfigSchema })
export const teamPresetSaveSchema = z.strictObject({ projectId: teamIdSchema, id: teamIdSchema.optional(), expectedVersion: z.number().int().positive().nullable(), label: z.string().trim().min(1).max(100), config: teamRunConfigSchema })
export const teamPresetDeleteSchema = z.strictObject({ projectId: teamIdSchema, id: teamIdSchema, expectedVersion: z.number().int().positive() })
export const teamChangedSchema = z.strictObject({ runId: teamIdSchema, version: z.number().int().positive(), lastSequence: z.number().int().nonnegative() })
export const teamCapabilityOptionSchema = z.strictObject({ key: z.string(), label: z.string(), member: teamMemberSchema, lead: z.boolean(), enabled: z.boolean(), reason: z.string() })
export const teamCapabilitiesSchema = z.strictObject({ options: z.array(teamCapabilityOptionSchema), accountScope: z.string() })
export type TeamCapabilities = z.infer<typeof teamCapabilitiesSchema>
export type TeamPreset = z.infer<typeof teamPresetSchema>
export type TeamReply<T> = { ok: true; value: T } | { ok: false; code: string; message: string }
export type TeamJsonValue = null | boolean | number | string | TeamJsonValue[] | { [key: string]: TeamJsonValue }
export interface TeamApi {
  memberList(input: Record<string, never>): Promise<TeamReply<TeamMemberProfileList>>
  memberSave(input: z.infer<typeof teamMemberProfileSaveSchema>): Promise<TeamReply<TeamMemberProfileList>>
  memberDelete(input: z.infer<typeof teamMemberProfileDeleteSchema>): Promise<TeamReply<TeamMemberProfileList>>
  capabilities(input: z.infer<typeof teamProjectQuerySchema>): Promise<TeamReply<TeamCapabilities>>
  launch(input: z.infer<typeof teamLaunchSchema>): Promise<TeamReply<Record<string, TeamJsonValue>>>
  list(input: z.infer<typeof teamProjectQuerySchema>): Promise<TeamReply<z.infer<typeof teamListSchema>>>
  snapshot(input: z.infer<typeof teamSnapshotQuerySchema>): Promise<TeamReply<TeamSnapshot>>
  review(input: z.infer<typeof teamReviewQuerySchema>): Promise<TeamReply<TeamReviewPacket>>
  preview(input: z.infer<typeof teamPreviewQuerySchema>): Promise<TeamReply<TeamFilePreview>>
  control(input: z.infer<typeof teamLifecycleSchema>): Promise<TeamReply<Record<string, TeamJsonValue>>>
  decideIntegration(input: z.infer<typeof teamIntegrationDecisionSchema>): Promise<TeamReply<Record<string, TeamJsonValue>>>
  presetList(input: z.infer<typeof teamProjectQuerySchema>): Promise<TeamReply<TeamPreset[]>>
  presetSave(input: z.infer<typeof teamPresetSaveSchema>): Promise<TeamReply<TeamPreset[]>>
  presetDelete(input: z.infer<typeof teamPresetDeleteSchema>): Promise<TeamReply<TeamPreset[]>>
  onChanged(listener: (event: z.infer<typeof teamChangedSchema>) => void): () => void
}

/** Called in main only. Input mode preserves wire defaults/transforms for JSON-schema clients. */
export function teamMcpToolDescriptors(): Array<{ name: TeamToolName; description: string; inputSchema: Record<string, unknown>; annotations: { readOnlyHint: boolean; destructiveHint: boolean; openWorldHint: boolean } }> {
  return (Object.keys(teamToolSchemas) as TeamToolName[]).map(name => {
    const readOnly = ['team_roster', 'team_status', 'team_wait'].includes(name)
    return { name, description: `Chorus team operation: ${name.slice(5)}. Scope and authority come from this run's authenticated lead connection.`, inputSchema: z.toJSONSchema(teamToolSchemas[name], { io: 'input' }), annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, openWorldHint: false } }
  })
}

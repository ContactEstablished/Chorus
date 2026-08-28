import { describe, it, expect } from 'vitest'
import {
  agentActivitySchema,
  needsYouReasonSchema,
  sessionActivityEventSchema,
  sessionActivityListResponseSchema,
  sessionMemoryUsageSchema,
  sessionMemoryEventSchema,
  memoryUsageSummarySchema,
  memoryStatusSchema,
  memoryModeSchema,
  memoryAuthModeSchema,
  memoryGetRequestSchema,
  memoryStatusRequestSchema,
  memoryConfigureRequestSchema,
  memoryContainerRequestSchema,
  memoryContainerRemoveRequestSchema,
  memoryIndexResponseSchema,
  memoryLaunchEventSchema,
  memoryFreshnessRequestSchema,
  memoryFreshnessResponseSchema,
  memoryContainerStatusResponseSchema,
  memoryProvisionResponseSchema,
  memoryConfigureResponseSchema,
  memoryDisableRequestSchema,
  memoryDisableResponseSchema,
  memoryTestRequestSchema,
  memoryTestResponseSchema,
  memorySeedRequestSchema,
  memorySeedResponseSchema,
  memoryValidateRequestSchema,
  memoryValidateResponseSchema,
  launchProfileWireSchema,
  launchProfileListResponseSchema,
  launchProfileCreateRequestSchema,
  launchProfileCreateResponseSchema,
  launchProfileUpdateResponseSchema,
  launchProfileDeleteResponseSchema,
  councilRoleSchema,
  councilMemberWireSchema,
  councilMemberListResponseSchema,
  councilMemberCreateRequestSchema,
  councilMemberCreateResponseSchema,
  councilMemberUpdateRequestSchema,
  councilPickBriefRequestSchema,
  councilPickBriefResponseSchema,
  councilStartRequestSchema,
  councilStartResponseSchema,
  councilQuestionSummarySchema,
  councilCancelRequestSchema,
  councilCancelResponseSchema,
  councilOpenedEventSchema,
  councilProgressEventSchema,
  councilSummaryEventSchema,
  councilTranscriptRequestSchema,
  cliDetectRequestSchema,
  councilArbiterVerdictSchema,
  councilDocketRequestSchema,
  councilDocketResponseSchema,
  councilDocketRunSchema,
  councilFindingsResponseSchema,
  councilForgetRunRequestSchema,
  councilForgetRunResponseSchema,
  councilVerdictRequestSchema,
  councilVerdictResponseSchema,
  councilVerdictRowSchema,
  councilTranscriptResponseSchema,
  councilTranscriptTurnSchema,
  councilMemberUpdateResponseSchema,
  councilMemberDeleteResponseSchema,
  savedWorkspaceModeSchema,
  relaunchRequestSchema,
  relaunchResponseSchema,
  attributionSummaryRequestSchema,
  attributionSummaryResponseSchema,
  MANAGEMENT_AUTH_MODE,
  NO_HARNESS_ADAPTER_TYPE,
  agentKindSchema,
  tokensSourceBreakdownSchema,
  launchRequestSchema,
  launchResponseSchema,
  attachRequestSchema,
  attachResponseSchema,
  sessionInfoSchema,
  setTitleRequestSchema,
  layoutGetRequestSchema,
  layoutSetRequestSchema,
  launchContextRequestSchema,
  launchContextResponseSchema,
  pickableWorktreeSchema,
  suggestMode,
  projectsListSchema,
  projectAddResponseSchema,
  projectDeleteRequestSchema,
  projectDeleteResponseSchema,
  projectImpactSchema,
  projectReorderRequestSchema,
  projectSchema,
  projectSetStatusRequestSchema,
  projectSetStatusResponseSchema,
  projectSelectRequestSchema,
  projectUpdateRequestSchema,
  PROJECT_DESCRIPTION_MAX,
  restartRequestSchema,
  deleteSessionRequestSchema,
  viewStateSchema,
  viewGetRequestSchema,
  viewSetRequestSchema,
  worktreeSummarySchema,
  worktreeListRequestSchema,
  worktreeListResponseSchema,
  worktreeRemoveRequestSchema,
  worktreeDirtyFilesRequestSchema,
  dirtyRemovalAllowed,
  branchForceAllowed,
  worktreeDiffRequestSchema,
  worktreeDiffSummarySchema,
  worktreeDiffResponseSchema,
  providerConfigSchema,
  providerListRequestSchema,
  providerListResponseSchema,
  providerCreateRequestSchema,
  providerCreateResponseSchema,
  providerUpdateRequestSchema,
  providerUpdateResponseSchema,
  providerDeleteRequestSchema,
  providerDeleteResponseSchema,
  credentialProfileMetaSchema,
  credentialListRequestSchema,
  credentialListResponseSchema,
  credentialCreateRequestSchema,
  credentialCreateResponseSchema,
  credentialReplaceRequestSchema,
  credentialReplaceResponseSchema,
  credentialDeleteRequestSchema,
  credentialDeleteResponseSchema,
  credentialTestRequestSchema,
  credentialTestResponseSchema,
  effortLevelSchema,
  effortOptionSchema,
  modelCatalogEntrySchema,
  modelListRequestSchema,
  modelListResponseSchema,
  modelShortlistSetRequestSchema,
  modelShortlistSetResponseSchema,
  modelRefreshRequestSchema,
  modelRefreshResponseSchema,
  detectedCliSchema,
  cliDetectResponseSchema,
  adapterDescriptorSchema,
  adapterListRequestSchema,
  adapterListResponseSchema,
  mcpDescriptorSchema,
  IpcChannel,
  attentionClassSchema,
  attentionReportSchema,
  attentionSummaryRequestSchema,
  attentionSummaryResponseSchema,
  windowMaximizedSchema,
  AGENT_NAME_MAX,
  AGENT_DESCRIPTION_MAX,
  VOICE_FRAME_SAMPLES,
  VOICE_MAX_FRAME_SAMPLES,
  VOICE_SAMPLE_RATE,
  voiceCaptureStartResponseSchema,
  voiceCaptureStopRequestSchema,
  voiceCaptureStopResponseSchema,
  voiceDropReasonSchema,
  voiceFrameSchema,
  voiceStateEventSchema,
  voiceStateNameSchema,
  voiceTargetSchema,
  voiceHotkeyStatusSchema,
  voiceSettingsSchema,
  voiceSettingsSetRequestSchema,
  voiceSettingsResponseSchema,
  voiceModelStatusResponseSchema,
  voiceRefinementModeSchema,
  DEFAULT_VOICE_SETTINGS
} from './ipc'
import { parseShortstat } from '../main/services/git'
import { providerSecretRefusal, sanitizeTitle } from '../main/ipc'
// ⚠ THE REAL REGISTRY, not a fixture — see the `adapter:list` test below for
// what a fixture-only test let through.
import { staticRegistry } from '../main/adapters/registry'
import { NO_HARNESS_DESCRIPTOR } from '../main/adapters/noHarness'

const PID = '550e8400-e29b-41d4-a716-446655440000'
const PID2 = '7c9e6679-7425-40de-944b-e07fc1f90ae7'

// launchRequestSchema is the renderer->main boundary for session:launch
// (Task 1-4; project_id added in 1-5; workspace_mode added in 2-2). cwd is
// only min(1) here BY DESIGN: the absolute-path + exists checks are main-only
// (fs), exercised at runtime instead; the project_id FK-check likewise lives
// in main.
describe('launchRequestSchema', () => {
  it('accepts a valid {project_id, agent, cwd, workspace_mode} for both agent kinds', () => {
    for (const agent of ['claude', 'codex'] as const) {
      expect(
        launchRequestSchema.parse({
          project_id: PID,
          agent,
          cwd: 'C:\\Projects',
          workspace_mode: 'current-tree'
        })
      ).toEqual({
        project_id: PID,
        agent,
        cwd: 'C:\\Projects',
        workspace_mode: 'current-tree'
      })
    }
  })

  it('requires a uuid project_id', () => {
    expect(
      launchRequestSchema.safeParse({ agent: 'claude', cwd: 'C:\\Projects', workspace_mode: 'current-tree' })
        .success
    ).toBe(false)
    expect(
      launchRequestSchema.safeParse({
        project_id: 'not-a-uuid',
        agent: 'claude',
        cwd: 'C:\\Projects',
        workspace_mode: 'current-tree'
      }).success
    ).toBe(false)
  })

  it('rejects an empty cwd', () => {
    expect(
      launchRequestSchema.safeParse({ project_id: PID, agent: 'claude', cwd: '', workspace_mode: 'current-tree' })
        .success
    ).toBe(false)
  })

  it('rejects a missing cwd', () => {
    expect(
      launchRequestSchema.safeParse({ project_id: PID, agent: 'claude', workspace_mode: 'current-tree' })
        .success
    ).toBe(false)
  })

  it('rejects a missing or unknown agent', () => {
    expect(
      launchRequestSchema.safeParse({ project_id: PID, cwd: 'C:\\Projects', workspace_mode: 'current-tree' })
        .success
    ).toBe(false)
    expect(
      launchRequestSchema.safeParse({
        project_id: PID,
        agent: 'gemini',
        cwd: 'C:\\Projects',
        workspace_mode: 'current-tree'
      }).success
    ).toBe(false)
  })

  // Task 3-6: the launch payload gains a credential PROFILE ID — never a
  // key. Absent stays the first-class path (D33 clause 9), so both shapes
  // must parse; a non-uuid id must not.
  it('accepts an optional credential_profile_id — and stays backward compatible without it', () => {
    const base = { project_id: PID, agent: 'claude' as const, cwd: 'C:\\Projects', workspace_mode: 'current-tree' as const }
    expect(launchRequestSchema.parse(base)).toEqual(base)
    const withProfile = { ...base, credential_profile_id: PID2 }
    expect(launchRequestSchema.parse(withProfile)).toEqual(withProfile)
    expect(launchRequestSchema.safeParse({ ...base, credential_profile_id: 'not-a-uuid' }).success).toBe(false)
  })

  // v14: the session's authored name + note. Both optional — an untouched
  // payload is byte-identical to a pre-v14 one, the `effort`/`model` discipline.
  it('accepts an optional name + description, capped, and omitted by default', () => {
    const base = { project_id: PID, agent: 'claude' as const, cwd: 'C:\\Projects', workspace_mode: 'current-tree' as const }
    expect(launchRequestSchema.parse(base).name).toBeUndefined()
    expect(launchRequestSchema.parse(base).description).toBeUndefined()
    const named = { ...base, name: 'Bob', description: 'Bug Fix - Missing Color' }
    expect(launchRequestSchema.parse(named)).toEqual(named)
    // The caps are the boundary's job, so the dialog can render a counter
    // instead of the user discovering the limit as a failed write.
    expect(launchRequestSchema.safeParse({ ...base, name: 'a'.repeat(AGENT_NAME_MAX) }).success).toBe(true)
    expect(launchRequestSchema.safeParse({ ...base, name: 'a'.repeat(AGENT_NAME_MAX + 1) }).success).toBe(false)
    expect(
      launchRequestSchema.safeParse({ ...base, description: 'a'.repeat(AGENT_DESCRIPTION_MAX) }).success
    ).toBe(true)
    expect(
      launchRequestSchema.safeParse({ ...base, description: 'a'.repeat(AGENT_DESCRIPTION_MAX + 1) }).success
    ).toBe(false)
    // An empty string parses — main is what folds it to NULL, so the boundary
    // must not reject the shape the dialog can legitimately produce.
    expect(launchRequestSchema.safeParse({ ...base, name: '' }).success).toBe(true)
  })
})

describe('workspace modes (Task 2-2 / D22)', () => {
  it('launchRequestSchema accepts all three modes', () => {
    for (const workspace_mode of ['current-tree', 'new-worktree', 'existing-worktree'] as const) {
      expect(
        launchRequestSchema.safeParse({ project_id: PID, agent: 'claude', cwd: 'C:\\Projects', workspace_mode })
          .success
      ).toBe(true)
    }
  })

  it('workspace_mode is required and must be a known mode', () => {
    // missing: the mode ALWAYS travels explicitly — main never assumes one
    expect(
      launchRequestSchema.safeParse({ project_id: PID, agent: 'claude', cwd: 'C:\\Projects' }).success
    ).toBe(false)
    expect(
      launchRequestSchema.safeParse({
        project_id: PID,
        agent: 'claude',
        cwd: 'C:\\Projects',
        workspace_mode: 'read-only'
      }).success
    ).toBe(false)
  })

  it('existing-worktree accepts a uuid worktree_id AND (schema-level) none', () => {
    // Required-when-existing is enforced in main as an {ok:false} reason, not
    // by schema branching — both shapes parse here.
    expect(
      launchRequestSchema.safeParse({
        project_id: PID,
        agent: 'codex',
        cwd: 'C:\\Projects',
        workspace_mode: 'existing-worktree',
        worktree_id: PID2
      }).success
    ).toBe(true)
    expect(
      launchRequestSchema.safeParse({
        project_id: PID,
        agent: 'codex',
        cwd: 'C:\\Projects',
        workspace_mode: 'existing-worktree'
      }).success
    ).toBe(true)
    // a non-uuid worktree_id is still rejected at the boundary
    expect(
      launchRequestSchema.safeParse({
        project_id: PID,
        agent: 'codex',
        cwd: 'C:\\Projects',
        workspace_mode: 'existing-worktree',
        worktree_id: 'not-a-uuid'
      }).success
    ).toBe(false)
  })

  it('pickableWorktreeSchema round-trips a picker entry', () => {
    const w = {
      id: PID,
      branch: 'chorus/Chorus/abc123de',
      path: 'C:\\Projects\\ContactEstablished\\.chorus\\Chorus\\wt-abc123de',
      status: 'detached'
    }
    expect(pickableWorktreeSchema.parse(w)).toEqual(w)
    expect(pickableWorktreeSchema.safeParse({ id: 'nope', branch: 'b', path: 'p', status: 's' }).success).toBe(
      false
    )
  })

  it('launchContextResponseSchema accepts a null repoRoot + populated worktrees', () => {
    // The non-git shape (findings risk 3): repoRoot null, suggestion
    // current-tree, no pickable worktrees.
    expect(
      launchContextResponseSchema.safeParse({
        projectRoot: 'C:\\Projects\\Plain',
        recentCwds: [],
        repoRoot: null,
        liveSessionsInRepo: 0,
        suggestedMode: 'current-tree',
        worktrees: [],
        launchProfiles: [],
        lastLaunchProfileId: null,
        usedAgentNames: []
      }).success
    ).toBe(true)
    // The git shape with a populated picker list.
    const wt = { id: PID2, branch: 'chorus/Chorus/abc123de', path: 'C:\\wt-abc123de', status: 'active' }
    expect(
      launchContextResponseSchema.safeParse({
        projectRoot: 'C:\\Projects\\Chorus',
        recentCwds: ['C:\\Projects\\Chorus'],
        repoRoot: 'C:/Projects/Chorus',
        liveSessionsInRepo: 1,
        suggestedMode: 'new-worktree',
        worktrees: [wt],
        launchProfiles: [],
        lastLaunchProfileId: null,
        // v14: the names the dialog's suggestion must avoid.
        usedAgentNames: ['Bob']
      }).success
    ).toBe(true)
    // repoRoot is required-nullable: forgetting the key fails loudly
    expect(
      launchContextResponseSchema.safeParse({
        projectRoot: 'C:\\Projects\\Chorus',
        recentCwds: [],
        liveSessionsInRepo: 0,
        suggestedMode: 'current-tree',
        worktrees: []
      }).success
    ).toBe(false)
  })

  it('suggestMode: null repo or 0 live -> current-tree; >=1 live -> new-worktree', () => {
    expect(suggestMode(null, 0)).toBe('current-tree')
    expect(suggestMode(null, 3)).toBe('current-tree')
    expect(suggestMode('C:/Projects/Chorus', 0)).toBe('current-tree')
    expect(suggestMode('C:/Projects/Chorus', 1)).toBe('new-worktree')
    expect(suggestMode('C:/Projects/Chorus', 4)).toBe('new-worktree')
  })
})

describe('launchResponseSchema', () => {
  it('accepts an attach-style snapshot', () => {
    // title is required-nullable from 1b-1 on (a fresh launch carries null);
    // branch is required-nullable from 2-2 on, worktreeId from 2-3 on (a
    // current-tree launch: both null). `locked` is required from v16 on and is
    // FALSE rather than nullable — nothing can lock a session at launch, so
    // "unlocked" is a real answer here and there is no "unknown" to express.
    const snap = {
      sessionId: 'abc',
      buffer: 'x',
      status: 'running',
      exitCode: null,
      title: null,
      name: null,
      description: null,
      branch: null,
      worktreeId: null,
      locked: false
    }
    expect(launchResponseSchema.safeParse(snap).success).toBe(true)
  })

  it('accepts a structured validation failure', () => {
    expect(launchResponseSchema.safeParse({ ok: false, reason: 'nope' }).success).toBe(true)
  })
})

describe('attachRequestSchema', () => {
  it('requires the stable sessionId', () => {
    expect(attachRequestSchema.safeParse({ agent: 'claude' }).success).toBe(false)
    expect(attachRequestSchema.parse({ agent: 'claude', sessionId: PID })).toEqual({
      agent: 'claude',
      sessionId: PID
    })
  })

  it('strips unknown keys — the removed 1-4 attach gate never reaches main', () => {
    // Zod strips unknown keys: a stale client sending the 1-4 flag gets it
    // dropped at the boundary, never forwarded to the manager. (The flag's
    // name is built without the literal so the removal grep stays clean.)
    const staleFlag = ['resp', 'awn'].join('')
    const parsed = attachRequestSchema.parse({ agent: 'claude', sessionId: PID, [staleFlag]: true })
    expect(Object.keys(parsed).sort()).toEqual(['agent', 'sessionId'])
  })
})

describe('project_id threading (Task 1-5)', () => {
  it('layout:get requires a uuid project_id', () => {
    expect(layoutGetRequestSchema.parse({ project_id: PID })).toEqual({ project_id: PID })
    expect(layoutGetRequestSchema.safeParse({}).success).toBe(false)
    expect(layoutGetRequestSchema.safeParse({ project_id: 'x' }).success).toBe(false)
  })

  it('layout:set requires project_id and keeps the nullable-tree delete contract', () => {
    expect(layoutSetRequestSchema.parse({ project_id: PID, layout: null })).toEqual({
      project_id: PID,
      layout: null
    })
    const tree = {
      version: 1,
      root: { type: 'leaf', sessionId: 's1' }
    }
    expect(layoutSetRequestSchema.parse({ project_id: PID, layout: tree })).toEqual({
      project_id: PID,
      layout: tree
    })
    // missing project_id or malformed tree: rejected
    expect(layoutSetRequestSchema.safeParse({ layout: null }).success).toBe(false)
    expect(layoutSetRequestSchema.safeParse({ project_id: PID, layout: { version: 2 } }).success).toBe(
      false
    )
  })

  it('session:launch-context requires a uuid project_id', () => {
    expect(launchContextRequestSchema.parse({ project_id: PID })).toEqual({ project_id: PID })
    expect(launchContextRequestSchema.safeParse({}).success).toBe(false)
  })
})

describe('projectsListSchema', () => {
  it('accepts a list of projects with the active flag and a session count', () => {
    const list = [
      {
        id: PID,
        name: 'Chorus',
        root_path: 'C:\\Projects\\Chorus',
        color: '#3BCFAE',
        description: 'the app itself',
        status: 'active',
        color_seed: 0,
        active: true,
        sessionCount: 5
      },
      {
        id: PID2,
        name: 'Other',
        root_path: 'D:\\Other',
        color: null,
        description: null,
        status: 'archived',
        color_seed: 1,
        active: false,
        sessionCount: 0
      }
    ]
    expect(projectsListSchema.parse(list)).toEqual(list)
    expect(projectsListSchema.parse([])).toEqual([])
  })

  it('rejects malformed entries and a missing active flag', () => {
    expect(
      projectsListSchema.safeParse([
        {
          id: 'nope',
          name: 'x',
          root_path: 'C:\\x',
          color: null,
          description: null,
          status: 'active',
          color_seed: 0,
          active: true,
          sessionCount: 0
        }
      ]).success
    ).toBe(false)
    expect(
      projectsListSchema.safeParse([
        {
          id: PID,
          name: 'x',
          root_path: 'C:\\x',
          color: null,
          description: null,
          status: 'active',
          color_seed: 0,
          sessionCount: 0
        }
      ]).success
    ).toBe(false)
    expect(projectsListSchema.safeParse({}).success).toBe(false)
  })

  /* D80: sessionCount is REQUIRED, not optional. An absent count would let a
     rail item silently render nothing where the mock draws a number, which is
     the D76 failure mode (a missing fact indistinguishable from a real zero)
     one layer up. Main defaults projects with no sessions to 0 explicitly. */
  it('requires sessionCount, and requires it to be a non-negative integer', () => {
    const base = {
      id: PID,
      name: 'x',
      root_path: 'C:\\x',
      color: null,
      description: null,
      status: 'active',
      color_seed: 0,
      active: true
    }
    expect(projectsListSchema.safeParse([base]).success).toBe(false)
    expect(projectsListSchema.safeParse([{ ...base, sessionCount: 0 }]).success).toBe(true)
    expect(projectsListSchema.safeParse([{ ...base, sessionCount: -1 }]).success).toBe(false)
    expect(projectsListSchema.safeParse([{ ...base, sessionCount: 1.5 }]).success).toBe(false)
    expect(projectsListSchema.safeParse([{ ...base, sessionCount: '3' }]).success).toBe(false)
  })
})

describe('project add/select schemas', () => {
  it('project:add response is {project, reactivated_from} or {cancelled:true}', () => {
    const project = {
      id: PID,
      name: 'Chorus',
      root_path: 'C:\\Projects\\Chorus',
      color: '#3BCFAE',
      description: null,
      status: 'active',
      color_seed: 0
    }
    expect(projectAddResponseSchema.safeParse({ project, reactivated_from: null }).success).toBe(
      true
    )
    expect(projectAddResponseSchema.safeParse({ cancelled: true }).success).toBe(true)
    expect(projectAddResponseSchema.safeParse({ cancelled: false }).success).toBe(false)
  })

  /* v15: `root_path` is UNIQUE, so picking an archived project's folder returns
     THAT row rather than making a second one. `reactivated_from` is how the
     response says so — and it is REQUIRED, because a renderer that could forget
     to read it would silently un-archive a project on an "Add project" click.
     Null is the ordinary answer (a new project, or one already active); it is
     not an absent one. */
  it('requires reactivated_from on the added-project branch, and constrains it to the vocabulary', () => {
    const project = {
      id: PID,
      name: 'Chorus',
      root_path: 'C:\\Projects\\Chorus',
      color: '#3BCFAE',
      description: null,
      status: 'active',
      color_seed: 0
    }
    expect(projectAddResponseSchema.safeParse({ project }).success).toBe(false)
    expect(
      projectAddResponseSchema.safeParse({ project, reactivated_from: 'archived' }).success
    ).toBe(true)
    expect(projectAddResponseSchema.safeParse({ project, reactivated_from: 'hidden' }).success).toBe(
      true
    )
    expect(
      projectAddResponseSchema.safeParse({ project, reactivated_from: 'deleted' }).success
    ).toBe(false)
  })

  /**
   * ⚠ IT IS THE TUCKED ENUM, NOT THE FULL ONE. `'active'` is not a state you can
   * be reactivated FROM — a project that was already active reports `null` —
   * so admitting it would let a consumer switch on a case that cannot happen.
   * The field originally carried the full `ProjectStatus` enum and the compiler
   * caught it the moment something tried to render the value (F45).
   */
  it('refuses "active" as a reactivated_from — null is how that case is reported', () => {
    const project = {
      id: PID,
      name: 'Chorus',
      root_path: 'C:\\Projects\\Chorus',
      color: '#3BCFAE',
      description: null,
      status: 'active',
      color_seed: 0
    }
    expect(
      projectAddResponseSchema.safeParse({ project, reactivated_from: 'active' }).success
    ).toBe(false)
    expect(projectAddResponseSchema.safeParse({ project, reactivated_from: null }).success).toBe(
      true
    )
  })

  it('project:select requires a uuid project_id', () => {
    expect(projectSelectRequestSchema.parse({ project_id: PID })).toEqual({ project_id: PID })
    expect(projectSelectRequestSchema.safeParse({ project_id: 'x' }).success).toBe(false)
  })
})

/* The project-identity contract (migration v13). The colour regex is the piece
   that carries weight: the rail interpolates this string into an inline style,
   so anything the schema lets through is what the DOM will be handed. */
describe('project:update schema', () => {
  const ok = { project_id: PID, name: 'Chorus', color: '#3BCFAE', description: 'notes' }

  it('accepts a well-formed update and trims the name', () => {
    expect(projectUpdateRequestSchema.parse({ ...ok, name: '  Chorus  ' }).name).toBe('Chorus')
    expect(projectUpdateRequestSchema.safeParse({ ...ok, description: '' }).success).toBe(true)
  })

  it('rejects a name that is empty or only whitespace', () => {
    expect(projectUpdateRequestSchema.safeParse({ ...ok, name: '' }).success).toBe(false)
    expect(projectUpdateRequestSchema.safeParse({ ...ok, name: '   ' }).success).toBe(false)
  })

  it('rejects any colour that is not #RRGGBB — the CSS-injection boundary', () => {
    expect(projectUpdateRequestSchema.safeParse({ ...ok, color: '#3BCFAE' }).success).toBe(true)
    expect(projectUpdateRequestSchema.safeParse({ ...ok, color: '#3bcfae' }).success).toBe(true)
    expect(projectUpdateRequestSchema.safeParse({ ...ok, color: '#FFF' }).success).toBe(false)
    expect(projectUpdateRequestSchema.safeParse({ ...ok, color: 'red' }).success).toBe(false)
    expect(projectUpdateRequestSchema.safeParse({ ...ok, color: 'rgb(1,2,3)' }).success).toBe(false)
    expect(
      projectUpdateRequestSchema.safeParse({ ...ok, color: 'red; background: url(x)' }).success
    ).toBe(false)
    expect(projectUpdateRequestSchema.safeParse({ ...ok, color: '' }).success).toBe(false)
  })

  it('caps the description at PROJECT_DESCRIPTION_MAX', () => {
    const at = 'x'.repeat(PROJECT_DESCRIPTION_MAX)
    expect(projectUpdateRequestSchema.safeParse({ ...ok, description: at }).success).toBe(true)
    expect(projectUpdateRequestSchema.safeParse({ ...ok, description: at + 'x' }).success).toBe(
      false
    )
  })

  /* `color` is nullable on the ROW (a pre-v13 project never had one) but
     REQUIRED on the update — you cannot save the settings screen without a
     colour selected, and null would mean "go back to the index cycle", which
     no control on that screen offers. */
  it('requires a colour on the way in even though the row allows null', () => {
    expect(
      projectSchema.safeParse({
        ...ok,
        id: PID,
        root_path: 'C:\\x',
        color: null,
        status: 'active',
        color_seed: 0
      }).success
    ).toBe(true)
    expect(projectUpdateRequestSchema.safeParse({ ...ok, color: null }).success).toBe(false)
  })
})

/**
 * The project LIFECYCLE contract (migration v15 / D120). `status` and
 * `color_seed` are REQUIRED AND NON-NULLABLE on the row, which deviates from
 * the required-nullable rule `color` follows two fields above them — and the
 * deviation is the thing worth testing, because it is the part a later reader
 * would "fix".
 */
describe('projectSchema — status and color_seed (v15)', () => {
  const row = {
    id: PID,
    name: 'Chorus',
    root_path: 'C:\\Projects\\Chorus',
    color: null,
    description: null,
    status: 'active',
    color_seed: 0
  }

  it('accepts each of the three statuses and nothing else', () => {
    expect(projectSchema.safeParse({ ...row, status: 'active' }).success).toBe(true)
    expect(projectSchema.safeParse({ ...row, status: 'hidden' }).success).toBe(true)
    expect(projectSchema.safeParse({ ...row, status: 'archived' }).success).toBe(true)
    // `deleted` is NOT a status — it is the absence of the row. A vocabulary
    // that admitted it would invite a read site to render a project that the
    // delete transaction has already removed.
    expect(projectSchema.safeParse({ ...row, status: 'deleted' }).success).toBe(false)
    expect(projectSchema.safeParse({ ...row, status: '' }).success).toBe(false)
  })

  /* Required AND non-nullable, deliberately. After v15 every row has both, so
     null would encode a state that cannot be reached — and each renderer would
     then have to invent its own default for a value that is never absent. */
  it('rejects a missing or null status', () => {
    const { status: _status, ...withoutStatus } = row
    expect(projectSchema.safeParse(withoutStatus).success).toBe(false)
    expect(projectSchema.safeParse({ ...row, status: null }).success).toBe(false)
  })

  it('rejects a missing, null, negative or fractional color_seed', () => {
    const { color_seed: _seed, ...withoutSeed } = row
    expect(projectSchema.safeParse(withoutSeed).success).toBe(false)
    expect(projectSchema.safeParse({ ...row, color_seed: null }).success).toBe(false)
    expect(projectSchema.safeParse({ ...row, color_seed: -1 }).success).toBe(false)
    expect(projectSchema.safeParse({ ...row, color_seed: 1.5 }).success).toBe(false)
    expect(projectSchema.safeParse({ ...row, color_seed: '0' }).success).toBe(false)
    // Unbounded above: the seed is a stored count and wraps at the cycle.
    expect(projectSchema.safeParse({ ...row, color_seed: 4096 }).success).toBe(true)
  })

  /**
   * ⚠ `sort_order` MUST NOT BE ON THE WIRE. Main returns the list already
   * ordered and the renderer states the order it wants via `project:reorder`;
   * a position on the row would be a second authority on the same fact. Zod
   * strips unknown keys by default, so this asserts absence from the PARSED
   * output rather than a rejection — which is exactly the property that keeps
   * a renderer from ever reading one.
   */
  it('does not carry sort_order', () => {
    const parsed = projectSchema.parse({ ...row, sort_order: 7 })
    expect('sort_order' in parsed).toBe(false)
  })
})

/* The four lifecycle channels' payloads (D125). */
describe('project lifecycle schemas (D125)', () => {
  it('project:set-status takes a uuid and one of the three statuses', () => {
    expect(
      projectSetStatusRequestSchema.parse({ project_id: PID, status: 'archived' })
    ).toEqual({ project_id: PID, status: 'archived' })
    expect(
      projectSetStatusRequestSchema.safeParse({ project_id: PID, status: 'deleted' }).success
    ).toBe(false)
    expect(
      projectSetStatusRequestSchema.safeParse({ project_id: 'nope', status: 'hidden' }).success
    ).toBe(false)
  })

  /* ⚠ NULLABLE ON PURPOSE. Archiving your ONLY project leaves no active one —
     that is the honest state, and the empty rail describes it. A non-nullable
     field here would force main to invent a successor, and the only candidates
     left would be the archived projects it just retired. */
  it('project:set-status responds with a nullable active_project_id and a stopped count', () => {
    const project = {
      id: PID,
      name: 'Chorus',
      root_path: 'C:\\x',
      color: null,
      description: null,
      status: 'archived',
      color_seed: 0
    }
    expect(
      projectSetStatusResponseSchema.safeParse({
        project,
        active_project_id: null,
        sessions_stopped: 0
      }).success
    ).toBe(true)
    expect(
      projectSetStatusResponseSchema.safeParse({
        project,
        active_project_id: PID2,
        sessions_stopped: 3
      }).success
    ).toBe(true)
    // The count is a fact about what was stopped, not an optional nicety.
    expect(
      projectSetStatusResponseSchema.safeParse({ project, active_project_id: null }).success
    ).toBe(false)
    expect(
      projectSetStatusResponseSchema.safeParse({
        project,
        active_project_id: null,
        sessions_stopped: -1
      }).success
    ).toBe(false)
  })

  /**
   * ⚠ THE SCHEMA CHECKS SHAPE; THE HANDLER CHECKS THE PERMUTATION. A uuid
   * predicate looks like validation while waving through a well-formed id that
   * is not a project — so the real check lives in main, against
   * `listProjects()`'s actual ids. What Zod is for here is refusing an empty
   * list and a non-uuid element.
   */
  it('project:reorder takes a non-empty array of uuids', () => {
    expect(projectReorderRequestSchema.parse({ ordered_ids: [PID, PID2] }).ordered_ids).toEqual([
      PID,
      PID2
    ])
    expect(projectReorderRequestSchema.safeParse({ ordered_ids: [] }).success).toBe(false)
    expect(projectReorderRequestSchema.safeParse({ ordered_ids: ['nope'] }).success).toBe(false)
    expect(projectReorderRequestSchema.safeParse({ ordered_ids: PID }).success).toBe(false)
  })

  /* D123: `typed_name` is the confirmation itself, not a label. It is REQUIRED
     — an optional one would let a renderer bug delete a project by omission. */
  it('project:delete requires the typed name alongside the id', () => {
    expect(
      projectDeleteRequestSchema.parse({ project_id: PID, typed_name: 'Chorus' })
    ).toEqual({ project_id: PID, typed_name: 'Chorus' })
    expect(projectDeleteRequestSchema.safeParse({ project_id: PID }).success).toBe(false)
    // An empty string is a well-formed payload and a failed match: the equality
    // check in main is what refuses it, and it must be reached to do so.
    expect(projectDeleteRequestSchema.safeParse({ project_id: PID, typed_name: '' }).success).toBe(
      true
    )
  })

  it('project:delete reports what was ACTUALLY deleted, table by table', () => {
    const deleted = {
      council_messages: 12,
      council_runs: 2,
      attention_spans: 40,
      dispatches: 7,
      worktrees: 1,
      sessions: 5,
      pane_layouts: 1,
      // Task 6-3: an ENFORCED, never-null FK to projects(id) — the purge must
      // reach it or step 10 throws SQLITE_CONSTRAINT_FOREIGNKEY.
      project_memory: 1,
      settings: 2,
      projects: 1
    }
    expect(
      projectDeleteResponseSchema.safeParse({ deleted, active_project_id: PID2 }).success
    ).toBe(true)
    expect(projectDeleteResponseSchema.safeParse({ deleted, active_project_id: null }).success).toBe(
      true
    )
    // Every table is named. A partial object would let a soft pointer be
    // dropped from the purge and from the report in the same commit.
    const { settings: _s, ...missingSettings } = deleted
    expect(
      projectDeleteResponseSchema.safeParse({
        deleted: missingSettings,
        active_project_id: null
      }).success
    ).toBe(false)
  })

  it('project:impact carries the counts the confirmation states, plus the live refusal', () => {
    const impact = {
      project_id: PID,
      name: 'Chorus',
      sessions: 5,
      live_sessions: 1,
      worktrees: 2,
      council_runs: 3,
      transcript_turns: 57
    }
    expect(projectImpactSchema.parse(impact)).toEqual(impact)
    expect(projectImpactSchema.safeParse({ ...impact, live_sessions: -1 }).success).toBe(false)
    // `live_sessions` is a refusal, not a size — and it is required, because an
    // absent one would read as zero and let a live project be deleted.
    const { live_sessions: _l, ...withoutLive } = impact
    expect(projectImpactSchema.safeParse(withoutLive).success).toBe(false)
  })
})

describe('session:restart / session:delete (D16)', () => {
  it('restart requires a uuid sessionId', () => {
    expect(restartRequestSchema.parse({ sessionId: PID })).toEqual({ sessionId: PID })
    expect(restartRequestSchema.safeParse({}).success).toBe(false)
    expect(restartRequestSchema.safeParse({ sessionId: 'x' }).success).toBe(false)
  })

  it('delete requires a uuid sessionId', () => {
    expect(deleteSessionRequestSchema.parse({ sessionId: PID })).toEqual({ sessionId: PID })
    expect(deleteSessionRequestSchema.safeParse({}).success).toBe(false)
    expect(deleteSessionRequestSchema.safeParse({ sessionId: 'x' }).success).toBe(false)
  })
})

describe('session titles (Task 1b-1 / D18)', () => {
  it('set-title accepts a uuid sessionId and a 1..120-char title', () => {
    expect(setTitleRequestSchema.parse({ sessionId: PID, title: 'x' })).toEqual({
      sessionId: PID,
      title: 'x'
    })
    expect(setTitleRequestSchema.safeParse({ sessionId: PID, title: 'a'.repeat(120) }).success).toBe(
      true
    )
  })

  it('set-title rejects a missing/empty title, >120 chars, and a non-uuid sessionId', () => {
    expect(setTitleRequestSchema.safeParse({ sessionId: PID }).success).toBe(false)
    expect(setTitleRequestSchema.safeParse({ sessionId: PID, title: '' }).success).toBe(false)
    expect(setTitleRequestSchema.safeParse({ sessionId: PID, title: 'a'.repeat(121) }).success).toBe(
      false
    )
    expect(setTitleRequestSchema.safeParse({ sessionId: 'not-a-uuid', title: 'x' }).success).toBe(
      false
    )
  })

  it('sessionInfoSchema.title is required-nullable', () => {
    // createdAt + exitCode joined the shape in 1b-2 (card metadata), branch
    // in 2-2 (worktree label), locked in v16 (the card's padlock).
    const base = {
      id: PID,
      agent: 'claude',
      status: 'running',
      createdAt: '2026-07-19T12:00:00.000Z',
      exitCode: null,
      branch: null,
      name: null,
      description: null,
      locked: false
    }
    expect(sessionInfoSchema.safeParse({ ...base, title: null }).success).toBe(true)
    expect(sessionInfoSchema.safeParse({ ...base, title: 'fix the tests' }).success).toBe(true)
    // required in the object: a producer that forgets it fails loudly
    expect(sessionInfoSchema.safeParse(base).success).toBe(false)
  })

  it('attachResponseSchema.title is required-nullable', () => {
    const base = {
      sessionId: PID,
      buffer: '',
      status: 'exited',
      exitCode: 0,
      branch: null,
      worktreeId: null,
      name: null,
      description: null,
      locked: false
    }
    expect(attachResponseSchema.safeParse({ ...base, title: null }).success).toBe(true)
    expect(attachResponseSchema.safeParse({ ...base, title: 'npm run dev' }).success).toBe(true)
    expect(attachResponseSchema.safeParse(base).success).toBe(false)
  })

  it('branch is required-nullable on sessionInfoSchema AND attachResponseSchema (2-2)', () => {
    const info = {
      id: PID,
      agent: 'claude',
      status: 'running',
      title: null,
      createdAt: '2026-07-20T00:00:00.000Z',
      exitCode: null,
      name: null,
      description: null,
      locked: false
    }
    expect(sessionInfoSchema.safeParse({ ...info, branch: null }).success).toBe(true)
    expect(sessionInfoSchema.safeParse({ ...info, branch: 'chorus/Chorus/abc123de' }).success).toBe(true)
    // a producer that forgets branch fails the outbound parse loudly
    expect(sessionInfoSchema.safeParse(info).success).toBe(false)

    const attach = {
      sessionId: PID,
      buffer: '',
      status: 'running',
      exitCode: null,
      title: null,
      worktreeId: null,
      name: null,
      description: null,
      locked: false
    }
    expect(attachResponseSchema.safeParse({ ...attach, branch: null }).success).toBe(true)
    expect(attachResponseSchema.safeParse({ ...attach, branch: 'chorus/Chorus/abc123de' }).success).toBe(
      true
    )
    expect(attachResponseSchema.safeParse(attach).success).toBe(false)
  })

  it('sessionInfoSchema requires createdAt and exitCode (1b-2 card metadata)', () => {
    const full = {
      id: PID,
      agent: 'codex',
      status: 'exited',
      title: 'Chorus',
      createdAt: '2026-07-19T12:00:00.000Z',
      exitCode: 1,
      branch: null,
      name: 'Bob',
      description: 'Bug Fix - Missing Color',
      // v16: true here rather than false, so this round-trip proves the field
      // is CARRIED and not merely defaulted — `.parse()` returning the whole
      // object unchanged is the assertion, and a value equal to the default
      // would pass it either way.
      locked: true
    }
    expect(sessionInfoSchema.parse(full)).toEqual(full)
    const { createdAt: _createdAt, ...withoutCreatedAt } = full
    expect(sessionInfoSchema.safeParse(withoutCreatedAt).success).toBe(false)
    const { exitCode: _exitCode, ...withoutExitCode } = full
    expect(sessionInfoSchema.safeParse(withoutExitCode).success).toBe(false)
  })

  it('sanitizeTitle strips C0 controls + DEL and trims', () => {
    expect(sanitizeTitle('  hello world  ')).toBe('hello world')
    expect(sanitizeTitle('a\x1b[31mb\x07c\x7fd')).toBe('a[31mbcd')
    expect(sanitizeTitle('line\r\nbreak\ttab')).toBe('linebreaktab')
    // all-control input sanitizes to empty — the handler then no-ops
    expect(sanitizeTitle('\x00\x1b\x07 \r\n')).toBe('')
  })
})

/**
 * The plaintext-field guard on provider:create / provider:update. Every column
 * on that form lives in `provider_configs` unencrypted (D33 resolution e), so a
 * key typed into ANY of them is a key on disk.
 */
describe('provider form secret guard', () => {
  // ⚠ CONCATENATED, NEVER A WHOLE LITERAL — the logger.test.ts idiom. A
  // complete key shape written out in source would trip the G4 secret-grep
  // gate, which reads the same secret-patterns.json this guard does. Assembled
  // at runtime it is a real match for the test and invisible to the scanner.
  const OPENROUTER_KEY = 'sk-or-v1-' + '329a1b2c'.repeat(8)

  it('refuses a key in any of the four plaintext fields', () => {
    // The observed failure: an OpenRouter key typed into the env-var-NAME box.
    expect(providerSecretRefusal({ env_var_name: OPENROUTER_KEY })).toContain(
      'Environment variable name'
    )
    expect(providerSecretRefusal({ base_url: `https://x.test/${OPENROUTER_KEY}` })).toContain(
      'Base URL'
    )
    expect(
      providerSecretRefusal({ extra_headers_json: `{"Authorization":"${OPENROUTER_KEY}"}` })
    ).toContain('Extra headers')
    expect(providerSecretRefusal({ model: OPENROUTER_KEY })).toContain('Model')
  })

  it('points at the encrypted alternative rather than just saying no', () => {
    const reason = providerSecretRefusal({ env_var_name: OPENROUTER_KEY }) ?? ''
    expect(reason).toContain('PLAINTEXT')
    expect(reason).toContain('credential profile')
  })

  it('⚠ never echoes the matched value back', () => {
    // Quoting the key into a renderer string, a log line and possibly a
    // screenshot would reintroduce the exposure the refusal exists to prevent.
    const reason = providerSecretRefusal({ env_var_name: OPENROUTER_KEY }) ?? ''
    expect(reason).not.toContain(OPENROUTER_KEY)
    expect(reason).not.toContain('sk-or-v1-')
  })

  it('covers the other canonical key shapes, not just OpenRouter', () => {
    expect(providerSecretRefusal({ model: `sk-ant-${'a'.repeat(24)}` })).not.toBeNull()
    expect(providerSecretRefusal({ model: `sk-proj-${'a'.repeat(24)}` })).not.toBeNull()
    expect(providerSecretRefusal({ model: `ghp_${'A'.repeat(36)}` })).not.toBeNull()
    expect(providerSecretRefusal({ model: 'AKIA' + 'ABCDEFGHIJKLMNOP' })).not.toBeNull()
  })

  it('passes legitimate values through untouched', () => {
    // The false-positive set that matters: a real env var name, a real route
    // URL, and real namespaced model ids. Blocking any of these would make the
    // guard worse than the hole it closes.
    expect(
      providerSecretRefusal({
        env_var_name: 'OPENROUTER_API_KEY',
        base_url: 'https://openrouter.ai/api/v1',
        model: 'moonshotai/kimi-k3',
        extra_headers_json: '{"HTTP-Referer":"https://chorus.local"}'
      })
    ).toBeNull()
    expect(providerSecretRefusal({ model: 'deepseek/deepseek-v4-flash-0731' })).toBeNull()
    expect(providerSecretRefusal({ model: 'nvidia/Llama-3.1-Nemotron-70B-Instruct' })).toBeNull()
    expect(providerSecretRefusal({ model: 'z-ai/glm-5.2' })).toBeNull()
  })

  it('treats absent and cleared fields as clean (patch semantics)', () => {
    // undefined = unchanged, null = cleared. Only a string can carry a key.
    expect(providerSecretRefusal({})).toBeNull()
    expect(providerSecretRefusal({ env_var_name: null, base_url: null, model: null })).toBeNull()
    expect(providerSecretRefusal({ env_var_name: '' })).toBeNull()
  })
})

describe('view state (Task 1b-2 / D20)', () => {
  it('viewStateSchema accepts filmstrip/null and grid/<id>', () => {
    expect(viewStateSchema.parse({ mode: 'filmstrip', focusedSessionId: null })).toEqual({
      mode: 'filmstrip',
      focusedSessionId: null
    })
    expect(viewStateSchema.parse({ mode: 'grid', focusedSessionId: PID })).toEqual({
      mode: 'grid',
      focusedSessionId: PID
    })
  })

  it('viewStateSchema rejects an unknown mode and a missing focusedSessionId key', () => {
    expect(viewStateSchema.safeParse({ mode: 'mosaic', focusedSessionId: null }).success).toBe(false)
    // required-nullable, same discipline as title: forgetting the key fails
    // loudly rather than defaulting silently
    expect(viewStateSchema.safeParse({ mode: 'filmstrip' }).success).toBe(false)
  })

  it('view:get requires a uuid project_id', () => {
    expect(viewGetRequestSchema.parse({ project_id: PID })).toEqual({ project_id: PID })
    expect(viewGetRequestSchema.safeParse({}).success).toBe(false)
    expect(viewGetRequestSchema.safeParse({ project_id: 'x' }).success).toBe(false)
  })

  it('view:set requires a uuid project_id and a valid state', () => {
    const state = { mode: 'filmstrip', focusedSessionId: null }
    expect(viewSetRequestSchema.parse({ project_id: PID, state })).toEqual({
      project_id: PID,
      state
    })
    expect(viewSetRequestSchema.safeParse({ project_id: 'not-a-uuid', state }).success).toBe(false)
    expect(viewSetRequestSchema.safeParse({ project_id: PID }).success).toBe(false)
    expect(
      viewSetRequestSchema.safeParse({
        project_id: PID,
        state: { mode: 'nope', focusedSessionId: null }
      }).success
    ).toBe(false)
  })
})

describe('worktree cleanup channels (Task 2-3 / D26)', () => {
  const WT = '3f6c8f2e-9c6d-4d2c-9f2e-2d6f7a1b8c9d'

  it('worktree:list requires a uuid project_id', () => {
    expect(worktreeListRequestSchema.parse({ project_id: PID })).toEqual({ project_id: PID })
    expect(worktreeListRequestSchema.safeParse({ project_id: 'x' }).success).toBe(false)
  })

  it('worktreeRemoveRequestSchema accepts {worktreeId} alone, with deleteBranch, and with confirmation', () => {
    expect(worktreeRemoveRequestSchema.parse({ worktreeId: WT })).toEqual({ worktreeId: WT })
    expect(worktreeRemoveRequestSchema.parse({ worktreeId: WT, deleteBranch: true })).toEqual({
      worktreeId: WT,
      deleteBranch: true
    })
    expect(
      worktreeRemoveRequestSchema.parse({ worktreeId: WT, confirmation: 'C:\wt-3f6c8f2e' })
    ).toEqual({ worktreeId: WT, confirmation: 'C:\wt-3f6c8f2e' })
  })

  it('worktreeRemoveRequestSchema rejects a non-uuid worktreeId', () => {
    expect(worktreeRemoveRequestSchema.safeParse({ worktreeId: 'nope' }).success).toBe(false)
    expect(worktreeRemoveRequestSchema.safeParse({}).success).toBe(false)
  })

  it('worktreeSummarySchema round-trips a panel row', () => {
    const row = {
      id: WT,
      path: 'C:\Projects\ContactEstablished\.chorus\Chorus\wt-3f6c8f2e',
      branch: 'chorus/Chorus/3f6c8f2e',
      status: 'detached',
      clean: false,
      dirtyCount: 3,
      ahead: 1,
      behind: 0,
      isPruneCandidate: false
    }
    expect(worktreeSummarySchema.parse(row)).toEqual(row)
    expect(worktreeListResponseSchema.parse([])).toEqual([])
    expect(worktreeSummarySchema.safeParse({ ...row, id: 'not-a-uuid' }).success).toBe(false)
  })

  it('worktree:dirty-files requires a uuid worktreeId', () => {
    expect(worktreeDirtyFilesRequestSchema.parse({ worktreeId: WT })).toEqual({ worktreeId: WT })
    expect(worktreeDirtyFilesRequestSchema.safeParse({ worktreeId: 'x' }).success).toBe(false)
  })

  it('attachResponseSchema.worktreeId is required-nullable (2-3)', () => {
    const base = {
      sessionId: PID,
      buffer: '',
      status: 'exited',
      exitCode: 0,
      title: null,
      branch: null,
      name: null,
      description: null,
      locked: false
    }
    expect(attachResponseSchema.safeParse({ ...base, worktreeId: null }).success).toBe(true)
    expect(attachResponseSchema.safeParse({ ...base, worktreeId: WT }).success).toBe(true)
    // a producer that forgets it fails the outbound parse loudly
    expect(attachResponseSchema.safeParse(base).success).toBe(false)
  })

  it('dirtyRemovalAllowed: clean removes regardless of confirmation', () => {
    const wt = { path: 'C:\wt-x', clean: true }
    expect(dirtyRemovalAllowed(wt, undefined)).toBe(true)
    expect(dirtyRemovalAllowed(wt, 'anything')).toBe(true)
    expect(dirtyRemovalAllowed(wt, wt.path)).toBe(true)
  })

  it('dirtyRemovalAllowed: dirty removes only on the exactly-typed path', () => {
    const wt = { path: 'C:\wt-x', clean: false }
    expect(dirtyRemovalAllowed(wt, wt.path)).toBe(true)
    expect(dirtyRemovalAllowed(wt, 'C:\wt-y')).toBe(false)
    expect(dirtyRemovalAllowed(wt, undefined)).toBe(false)
    // case-sensitive exact match — the token names what is destroyed
    expect(dirtyRemovalAllowed(wt, 'c:\wt-x')).toBe(false)
  })
})

describe('worktree diff summary channel (Task 2-4)', () => {
  const SID = '8b3f0f6a-2b7a-4c1e-9d2f-5a6b7c8d9e0f'

  it('worktreeDiffRequestSchema requires a uuid sessionId', () => {
    expect(worktreeDiffRequestSchema.parse({ sessionId: SID })).toEqual({ sessionId: SID })
    expect(worktreeDiffRequestSchema.safeParse({ sessionId: 'x' }).success).toBe(false)
    expect(worktreeDiffRequestSchema.safeParse({}).success).toBe(false)
  })

  it('worktreeDiffSummarySchema accepts an all-int summary and rejects a float', () => {
    const summary = { filesChanged: 3, insertions: 12, deletions: 4, untracked: 1 }
    expect(worktreeDiffSummarySchema.parse(summary)).toEqual(summary)
    expect(
      worktreeDiffSummarySchema.safeParse({ ...summary, insertions: 1.5 }).success
    ).toBe(false)
  })

  it('worktreeDiffResponseSchema accepts a summary or null (no worktree)', () => {
    const summary = { filesChanged: 0, insertions: 0, deletions: 0, untracked: 0 }
    expect(worktreeDiffResponseSchema.parse(summary)).toEqual(summary)
    expect(worktreeDiffResponseSchema.parse(null)).toBeNull()
    expect(worktreeDiffResponseSchema.safeParse(undefined).success).toBe(false)
  })
})

describe('parseShortstat (Task 2-4 — pure, total; shapes verified vs git 2.50)', () => {
  const cases: Array<[string, { filesChanged: number; insertions: number; deletions: number }]> = [
    [' 3 files changed, 12 insertions(+), 4 deletions(-)', { filesChanged: 3, insertions: 12, deletions: 4 }],
    [' 1 file changed, 2 insertions(+)', { filesChanged: 1, insertions: 2, deletions: 0 }],
    // singular "insertion(+)" — the real observed shape on git 2.50
    [' 1 file changed, 1 insertion(+)', { filesChanged: 1, insertions: 1, deletions: 0 }],
    [' 2 files changed, 5 deletions(-)', { filesChanged: 2, insertions: 0, deletions: 5 }],
    [' 1 file changed, 1 deletion(-)', { filesChanged: 1, insertions: 0, deletions: 1 }],
    ['', { filesChanged: 0, insertions: 0, deletions: 0 }],
    ['not a shortstat', { filesChanged: 0, insertions: 0, deletions: 0 }]
  ]
  it.each(cases)('parses %j', (line, expected) => {
    expect(parseShortstat(line)).toEqual(expected)
  })
})

describe('branchForceAllowed (Task 3-1 / F21 — the -D gate)', () => {
  const wt = { branch: 'chorus/X/ab12' }

  it('licenses -D only on the exactly-typed branch name', () => {
    expect(branchForceAllowed(wt, 'chorus/X/ab12')).toBe(true)
  })

  it('rejects an absent, empty, or mismatched acknowledgment', () => {
    expect(branchForceAllowed(wt, undefined)).toBe(false)
    expect(branchForceAllowed(wt, '')).toBe(false)
    expect(branchForceAllowed(wt, 'chorus/X/ab13')).toBe(false)
  })

  it('F21 regression: the dirty-removal PATH token no longer licenses -D', () => {
    // The pre-fix handler computed forceBranch from req.confirmation === w.path.
    expect(branchForceAllowed(wt, 'C:\Projects\ContactEstablished\.chorus\X\wt-ab12')).toBe(false)
  })

  it('rejects an empty ack against an empty branch (population-4 adopted row)', () => {
    // Without the guard, '' === '' would license a force-delete of a nameless
    // branch — the standing dev fixture is exactly such a row.
    expect(branchForceAllowed({ branch: '' }, '')).toBe(false)
  })
})

describe('worktreeRemoveRequestSchema branchForceConfirmation (Task 3-1 / F21)', () => {
  const WT = '3f6c8f2e-9c6d-4d2c-9f2e-2d6f7a1b8c9d'

  it('accepts a payload carrying branchForceConfirmation', () => {
    expect(
      worktreeRemoveRequestSchema.parse({
        worktreeId: WT,
        deleteBranch: true,
        branchForceConfirmation: 'chorus/X/ab12'
      })
    ).toEqual({ worktreeId: WT, deleteBranch: true, branchForceConfirmation: 'chorus/X/ab12' })
  })

  it('still accepts one without it (backward compatible)', () => {
    expect(worktreeRemoveRequestSchema.parse({ worktreeId: WT })).toEqual({ worktreeId: WT })
    expect(
      worktreeRemoveRequestSchema.parse({ worktreeId: WT, confirmation: 'C:\wt-3f6c8f2e' })
    ).toEqual({ worktreeId: WT, confirmation: 'C:\wt-3f6c8f2e' })
  })
})

/* ------------------------------------------------------------------ */
/* Task 3-2: providers + credential vault (D33)                        */
/* ------------------------------------------------------------------ */

describe('provider channel schemas (Task 3-2)', () => {
  const PROVIDER_ID = '0f8f4b2a-7b9e-4f0e-8a1c-2d3e4f5a6b7c'
  const PROVIDER = {
    id: PROVIDER_ID,
    name: 'Anthropic',
    adapter_type: 'claude',
    auth_mode: 'api-key',
    env_var_name: null,
    base_url: 'https://api.anthropic.com',
    extra_headers_json: '{"x-org":"chorus"}',
    model: null,
    created_at: '2026-07-23T00:00:00.000Z'
  }

  it('providerConfigSchema round-trips base_url / extra_headers_json (documented non-secret)', () => {
    expect(providerConfigSchema.parse(PROVIDER)).toEqual(PROVIDER)
    // Required-NULLABLE discipline: absent nullable fields fail the parse.
    const { base_url: _omit, ...missingBaseUrl } = PROVIDER
    expect(providerConfigSchema.safeParse(missingBaseUrl).success).toBe(false)
  })

  it('providerCreateRequestSchema accepts a valid payload, rejects empty name/adapter_type/auth_mode', () => {
    expect(
      providerCreateRequestSchema.parse({
        name: 'Anthropic',
        adapter_type: 'claude',
        auth_mode: 'api-key',
        extra_headers_json: '{"x-org":"chorus"}'
      })
    ).toEqual({
      name: 'Anthropic',
      adapter_type: 'claude',
      auth_mode: 'api-key',
      extra_headers_json: '{"x-org":"chorus"}'
    })
    expect(providerCreateRequestSchema.safeParse({ name: '', adapter_type: 'claude', auth_mode: 'api-key' }).success).toBe(false)
    expect(providerCreateRequestSchema.safeParse({ name: 'A', adapter_type: '', auth_mode: 'api-key' }).success).toBe(false)
    expect(providerCreateRequestSchema.safeParse({ name: 'A', adapter_type: 'claude', auth_mode: '' }).success).toBe(false)
  })

  it('⚠ D84: adapter_type accepts the NO-HARNESS value, and it is NOT an AgentKind', () => {
    // The wire schema already permitted a non-agent value (z.string().min(1)),
    // which is why D84 needed no schema change and no migration. Both halves
    // are asserted together, because the whole ruling is that these two
    // vocabularies are DIFFERENT: a provider type is not an agent kind, and
    // agentKindSchema / staticRegistry must not widen (D34 Q5 / D63 Q1 / F25).
    expect(
      providerCreateRequestSchema.safeParse({
        name: 'OpenRouter',
        adapter_type: NO_HARNESS_ADAPTER_TYPE,
        auth_mode: 'api_key'
      }).success
    ).toBe(true)
    expect(agentKindSchema.safeParse(NO_HARNESS_ADAPTER_TYPE).success).toBe(false)
    // ⚠ MEMBERSHIP, NOT A HEADCOUNT — this used to pin the enum to exactly
    // ['claude','codex'] and D86 correctly broke it by adding 'kimi'. D84's
    // claim is that 'none' is not an agent kind, which stays true as the
    // registry grows; asserting the literal list here would make every future
    // adapter fail a test about the harness-less provider type.
    expect(agentKindSchema.options).not.toContain(NO_HARNESS_ADAPTER_TYPE)
    expect(agentKindSchema.options).toContain('claude')
    // It is a distinct class from the account-level auth mode — different
    // column, different vocabulary, and neither is the other.
    expect(NO_HARNESS_ADAPTER_TYPE).not.toBe(MANAGEMENT_AUTH_MODE)
  })

  it('providerUpdateRequestSchema: absent = unchanged, null = clear (nullable fields only)', () => {
    expect(providerUpdateRequestSchema.parse({ id: PROVIDER_ID })).toEqual({ id: PROVIDER_ID })
    expect(providerUpdateRequestSchema.parse({ id: PROVIDER_ID, base_url: null })).toEqual({ id: PROVIDER_ID, base_url: null })
    // null cannot clear a NON-nullable column.
    expect(providerUpdateRequestSchema.safeParse({ id: PROVIDER_ID, name: null }).success).toBe(false)
    expect(providerUpdateRequestSchema.safeParse({ id: 'nope' }).success).toBe(false)
  })

  it('providerDeleteRequestSchema requires a uuid id', () => {
    expect(providerDeleteRequestSchema.parse({ id: PROVIDER_ID })).toEqual({ id: PROVIDER_ID })
    expect(providerDeleteRequestSchema.safeParse({ id: 'nope' }).success).toBe(false)
  })

  it('provider list/create responses carry only non-secret provider metadata', () => {
    expect(providerListRequestSchema.parse({})).toEqual({})
    expect(providerListResponseSchema.parse([PROVIDER])).toEqual([PROVIDER])
    expect(providerCreateResponseSchema.parse({ ok: true, provider: PROVIDER })).toEqual({ ok: true, provider: PROVIDER })
    expect(providerCreateResponseSchema.parse({ ok: false, reason: 'r' })).toEqual({ ok: false, reason: 'r' })
    expect(providerUpdateResponseSchema.parse({ ok: true })).toEqual({ ok: true })
    expect(providerDeleteResponseSchema.parse({ ok: false, reason: 'in use' })).toEqual({ ok: false, reason: 'in use' })
  })
})

describe('credential channel schemas (Task 3-2 / D33 clause 3)', () => {
  const PROVIDER_ID = '0f8f4b2a-7b9e-4f0e-8a1c-2d3e4f5a6b7c'
  const PROFILE_ID = '1a2b3c4d-5e6f-4a5b-8c9d-0e1f2a3b4c5d'
  // Obviously-fake value of realistic SHAPE, concatenated so no literal full
  // key shape lands in this file for the G4 grep gate. Never a real credential.
  const fakeKey = 'sk-ant-api03-' + 'Ch0rusT3st'.repeat(5)

  it('credentialCreateRequestSchema accepts a valid payload incl. baseUrl/extraHeaders', () => {
    const req = {
      providerId: PROVIDER_ID,
      label: 'Work key',
      key: fakeKey,
      baseUrl: 'https://api.anthropic.com',
      extraHeaders: { 'x-org': 'chorus' }
    }
    expect(credentialCreateRequestSchema.parse(req)).toEqual(req)
  })

  it('credentialCreateRequestSchema rejects bad uuid / empty label / empty key / oversized key', () => {
    const base = { providerId: PROVIDER_ID, label: 'Work key', key: fakeKey }
    expect(credentialCreateRequestSchema.safeParse({ ...base, providerId: 'nope' }).success).toBe(false)
    expect(credentialCreateRequestSchema.safeParse({ ...base, label: '' }).success).toBe(false)
    expect(credentialCreateRequestSchema.safeParse({ ...base, key: '' }).success).toBe(false)
    expect(credentialCreateRequestSchema.safeParse({ ...base, key: 'k'.repeat(8193) }).success).toBe(false)
  })

  it('credentialReplaceRequestSchema requires a uuid id and a non-empty key', () => {
    expect(credentialReplaceRequestSchema.parse({ id: PROFILE_ID, key: fakeKey })).toEqual({ id: PROFILE_ID, key: fakeKey })
    expect(credentialReplaceRequestSchema.safeParse({ id: 'nope', key: fakeKey }).success).toBe(false)
    expect(credentialReplaceRequestSchema.safeParse({ id: PROFILE_ID, key: '' }).success).toBe(false)
  })

  it('credentialDeleteRequestSchema requires a uuid id', () => {
    expect(credentialDeleteRequestSchema.parse({ id: PROFILE_ID })).toEqual({ id: PROFILE_ID })
    expect(credentialDeleteRequestSchema.safeParse({}).success).toBe(false)
  })

  it('credentialCreateResponse returns ONLY an id — no key, no digest shape', () => {
    expect(credentialCreateResponseSchema.parse({ ok: true, id: PROFILE_ID })).toEqual({ ok: true, id: PROFILE_ID })
    expect(credentialCreateResponseSchema.parse({ ok: false, reason: 'r' })).toEqual({ ok: false, reason: 'r' })
    expect(credentialListRequestSchema.parse({})).toEqual({})
    expect(credentialReplaceResponseSchema.parse({ ok: true })).toEqual({ ok: true })
    expect(credentialDeleteResponseSchema.parse({ ok: true })).toEqual({ ok: true })
  })

  it('CLAUSE-3 STRUCTURAL TEST (F-5b flip): a raw DB row carrying digest/blob fields now THROWS the outbound parse', () => {
    // The clause-3 enforcement mechanism, proven on the parse: before F-5b,
    // zod silently STRIPPED the unknown keys and the raw row "passed" with its
    // secret fields dropped unnoticed. `.strict()` makes the loud failure the
    // design prose always promised: a handler returning an unprojected row
    // throws HERE, in main, before anything crosses the bridge.
    // (Digest column names are assembled so the literal word the shared-side
    // grep gate forbids never appears in this file.)
    const digestCamel = 'finger' + 'printHash'
    const digestSnake = 'finger' + 'print_hash'
    const rawRow = {
      id: PROFILE_ID,
      providerId: PROVIDER_ID,
      label: 'Work key',
      encryptedBlob: Buffer.from([1, 2, 3]),
      encrypted_blob: 'AAAA',
      [digestCamel]: 'a'.repeat(64),
      [digestSnake]: 'b'.repeat(64),
      createdAt: '2026-07-23T00:00:00.000Z',
      lastVerifiedAt: null,
      unavailableSince: null,
      reencryptedAt: null
    }
    expect(() => credentialProfileMetaSchema.parse(rawRow)).toThrow()
    // A clean meta object (exactly the projection toProfileMeta emits) still
    // parses — strictness must not break the legitimate wire shape.
    const clean = {
      id: PROFILE_ID,
      providerId: PROVIDER_ID,
      label: 'Work key',
      createdAt: '2026-07-23T00:00:00.000Z',
      lastVerifiedAt: null,
      unavailableSince: null
    }
    expect(credentialProfileMetaSchema.parse(clean)).toEqual(clean)
    expect(credentialListResponseSchema.parse([clean])).toEqual([clean])
  })

  it('credentialProfileMetaSchema carries neither key nor digest, and requires-nullable metadata', () => {
    const meta = {
      id: PROFILE_ID,
      providerId: PROVIDER_ID,
      label: 'Work key',
      createdAt: '2026-07-23T00:00:00.000Z',
      lastVerifiedAt: null,
      unavailableSince: '2026-07-23T01:00:00.000Z'
    }
    expect(credentialProfileMetaSchema.parse(meta)).toEqual(meta)
    const { unavailableSince: _omit, ...missing } = meta
    expect(credentialProfileMetaSchema.safeParse(missing).success).toBe(false)
    expect(credentialProfileMetaSchema.safeParse({ ...meta, label: '' }).success).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* Task 3-6: credential:test — ONE live probe, sanitized response        */
/* ------------------------------------------------------------------ */

describe('credential:test schemas (Task 3-6 / D33 resolution d)', () => {
  const PROFILE_ID = '1a2b3c4d-5e6f-4a5b-8c9d-0e1f2a3b4c5d'

  it('request requires a uuid profile id', () => {
    expect(credentialTestRequestSchema.parse({ id: PROFILE_ID })).toEqual({ id: PROFILE_ID })
    expect(credentialTestRequestSchema.safeParse({ id: 'nope' }).success).toBe(false)
    expect(credentialTestRequestSchema.safeParse({}).success).toBe(false)
  })

  it('response admits {ok:true} and {ok:false, reason} — and NOTHING else', () => {
    expect(credentialTestResponseSchema.parse({ ok: true })).toEqual({ ok: true })
    expect(credentialTestResponseSchema.parse({ ok: false, reason: 'sanitized' })).toEqual({
      ok: false,
      reason: 'sanitized'
    })
    // The key-set assertion, same discipline as the clause-3 meta test: the
    // response has NO field capable of carrying key material — not a body,
    // not a status detail, not an exception string. Asserted on the PARSE
    // OUTPUT, so a future field addition fails here first.
    expect(Object.keys(credentialTestResponseSchema.parse({ ok: true })).sort()).toEqual(['ok'])
    expect(Object.keys(credentialTestResponseSchema.parse({ ok: false, reason: 'r' })).sort()).toEqual([
      'ok',
      'reason'
    ])
  })
})

/* ------------------------------------------------------------------ */
/* Task 3a-4: model:list / model:refresh + the effort vocabulary        */
/* ------------------------------------------------------------------ */

describe('model:list / model:refresh schemas (Task 3a-4)', () => {
  const PROVIDER_ID = '6c052ee6-1eb3-4d7c-8aa3-832bd19dfd13'
  const PROFILE_ID = '1a2b3c4d-5e6f-4a5b-8c9d-0e1f2a3b4c5d'
  /** Assembled by concatenation so this file never holds a complete key
   *  shape for scripts/secret-grep.mjs. */
  const FAKE_KEY = 'sk-or-v1-' + '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

  const ENTRY = {
    modelId: 'moonshotai/kimi-k3',
    displayName: 'MoonshotAI: Kimi K3',
    contextLength: 1048576,
    expiresAt: null,
    missingSince: null,
    // D179: the model's own effort vocabulary. `null` is the fixture's default
    // because it is the honest answer for a row nobody has refreshed since
    // v22 — and a DIFFERENT answer from `[]`, asserted below.
    reasoningEfforts: null
  }

  it('the two channels are registered under their documented names', () => {
    expect(IpcChannel.ModelList).toBe('model:list')
    expect(IpcChannel.ModelRefresh).toBe('model:refresh')
  })

  it('model:list request requires a uuid provider id', () => {
    expect(modelListRequestSchema.parse({ provider_id: PROVIDER_ID })).toEqual({
      provider_id: PROVIDER_ID
    })
    expect(modelListRequestSchema.safeParse({ provider_id: 'nope' }).success).toBe(false)
    expect(modelListRequestSchema.safeParse({}).success).toBe(false)
  })

  it('model:list response round-trips, with freshness computed in MAIN', () => {
    const payload = {
      models: [ENTRY],
      refreshedAt: '2026-07-25T20:00:00.000Z',
      freshness: 'fresh' as const,
      shortlist: ['deepseek/deepseek-v4-pro']
    }
    expect(modelListResponseSchema.parse(payload)).toEqual(payload)
    // never / fresh / stale are THREE distinct wire values.
    for (const f of ['never', 'fresh', 'stale']) {
      expect(modelListResponseSchema.safeParse({ ...payload, freshness: f }).success).toBe(true)
    }
    expect(modelListResponseSchema.safeParse({ ...payload, freshness: 'unknown' }).success).toBe(false)
    // A never-refreshed provider carries a null timestamp AND an empty list.
    expect(
      modelListResponseSchema.parse({ models: [], refreshedAt: null, freshness: 'never', shortlist: [] })
    ).toEqual({ models: [], refreshedAt: null, freshness: 'never', shortlist: [] })
  })

  it('⚠ D85: the shortlist is REQUIRED and independent of the catalog', () => {
    // Required, not optional-with-a-default: a producer that forgets it fails
    // the outbound parse (the 1b-1 `title` discipline). An absent shortlist and
    // an empty one are different facts and the wire must not conflate them.
    expect(
      modelListResponseSchema.safeParse({ models: [], refreshedAt: null, freshness: 'never' }).success
    ).toBe(false)
    // ⚠ AND IT MAY NAME AN ID THE CATALOG DOES NOT CARRY. This is the whole
    // reason it is a flat array beside `models` rather than a flag on each
    // entry: a shortlisted model that a refresh stopped returning must not
    // vanish from the user's own list (D48/D56, v12).
    const out = modelListResponseSchema.parse({
      models: [],
      refreshedAt: null,
      freshness: 'never',
      shortlist: ['vendor/never-catalogued']
    })
    expect(out.shortlist).toEqual(['vendor/never-catalogued'])
    expect(out.models).toEqual([])
  })

  it('⚠ no response field can carry key material — asserted over the PARSE OUTPUT key set', () => {
    const out = modelListResponseSchema.parse({
      models: [ENTRY],
      refreshedAt: null,
      freshness: 'never',
      shortlist: []
    })
    expect(Object.keys(out).sort()).toEqual(['freshness', 'models', 'refreshedAt', 'shortlist'])
    expect(Object.keys(out.models[0]).sort()).toEqual([
      'contextLength',
      'displayName',
      'expiresAt',
      'missingSince',
      'modelId',
      'reasoningEfforts'
    ])
  })

  /**
   * D179. ⚠ THE THREE-ANSWER TEST, and it is the one that keeps the feature
   * honest: `null` (nobody has asked this provider), `[]` (it answered, and the
   * answer was none) and a populated list are three states, and the launch
   * dialog renders a control for exactly one of them. A schema that admitted
   * only "a list, possibly empty" would make the first two indistinguishable on
   * the wire, and the UI could not tell ignorance from knowledge.
   */
  it('⚠ D179: reasoningEfforts distinguishes null (unasked) from [] (none)', () => {
    const withNull = modelCatalogEntrySchema.parse({ ...ENTRY, reasoningEfforts: null })
    const withNone = modelCatalogEntrySchema.parse({ ...ENTRY, reasoningEfforts: [] })
    expect(withNull.reasoningEfforts).toBeNull()
    expect(withNone.reasoningEfforts).toEqual([])
    expect(modelCatalogEntrySchema.parse({ ...ENTRY, reasoningEfforts: ['high', 'xhigh'] })
      .reasoningEfforts).toEqual(['high', 'xhigh'])
    // REQUIRED-nullable, the house discipline: forgetting it fails loudly
    // rather than defaulting to a claim.
    const { reasoningEfforts: _drop, ...missing } = ENTRY
    expect(modelCatalogEntrySchema.safeParse(missing).success).toBe(false)
    // The charset guard — this string is written into another tool's config
    // file, so an effort with a space, a quote or an uppercase letter is a
    // refusal rather than a value that reaches disk.
    expect(modelCatalogEntrySchema.safeParse({ ...ENTRY, reasoningEfforts: ['HIGH'] }).success).toBe(
      false
    )
    expect(
      modelCatalogEntrySchema.safeParse({ ...ENTRY, reasoningEfforts: ['high effort'] }).success
    ).toBe(false)
  })

  it('⚠ D85: model:shortlist-set carries an id and a boolean — and no key-shaped field', () => {
    const req = { provider_id: PROVIDER_ID, model_id: 'deepseek/deepseek-v4-pro', shortlisted: true }
    expect(modelShortlistSetRequestSchema.parse(req)).toEqual(req)
    // .strict() on both arms — a smuggled field is a refusal, not a silent strip (F-5b).
    expect(modelShortlistSetRequestSchema.safeParse({ ...req, apiKey: FAKE_KEY }).success).toBe(false)
    expect(modelShortlistSetRequestSchema.safeParse({ ...req, model_id: '' }).success).toBe(false)
    expect(modelShortlistSetRequestSchema.safeParse({ ...req, provider_id: 'nope' }).success).toBe(false)
    // The response returns the list AFTER the write, so the renderer never
    // renders its own optimistic guess.
    const ok = modelShortlistSetResponseSchema.parse({ ok: true, shortlist: ['a/b'] })
    expect(Object.keys(ok).sort()).toEqual(['ok', 'shortlist'])
    expect(modelShortlistSetResponseSchema.safeParse({ ok: false, reason: 'gone' }).success).toBe(true)
    expect(modelShortlistSetResponseSchema.safeParse({ ok: true, shortlist: ['a'], key: FAKE_KEY }).success).toBe(false)
  })

  it('⚠ .strict() rejects a smuggled extra field rather than silently stripping it (F-5b)', () => {
    expect(
      modelCatalogEntrySchema.safeParse({ ...ENTRY, apiKey: FAKE_KEY }).success
    ).toBe(false)
    expect(
      modelListResponseSchema.safeParse({
        models: [],
        refreshedAt: null,
        freshness: 'never',
        credential: FAKE_KEY
      }).success
    ).toBe(false)
  })

  it('model:refresh request carries a PROFILE ID or null — never a key', () => {
    expect(
      modelRefreshRequestSchema.parse({ provider_id: PROVIDER_ID, credential_id: PROFILE_ID })
    ).toEqual({ provider_id: PROVIDER_ID, credential_id: PROFILE_ID })
    // null is the unauthenticated path — a shipped behaviour, not a fallback.
    expect(
      modelRefreshRequestSchema.parse({ provider_id: PROVIDER_ID, credential_id: null })
    ).toEqual({ provider_id: PROVIDER_ID, credential_id: null })
    // Absent is NOT the same as null: the renderer must be explicit.
    expect(modelRefreshRequestSchema.safeParse({ provider_id: PROVIDER_ID }).success).toBe(false)
    // And there is no field a key could ride in on.
    expect(
      modelRefreshRequestSchema.safeParse({
        provider_id: PROVIDER_ID,
        credential_id: null,
        key: FAKE_KEY
      }).data
    ).toEqual({ provider_id: PROVIDER_ID, credential_id: null })
  })

  it('⚠ the refresh response carries COUNTS, never lists of ids, and no key-bearing field', () => {
    const okPayload = {
      ok: true as const,
      added: 345,
      updated: 0,
      missing: 1,
      dropped: 0,
      refreshedAt: '2026-07-25T20:00:00.000Z'
    }
    expect(modelRefreshResponseSchema.parse(okPayload)).toEqual(okPayload)
    expect(Object.keys(modelRefreshResponseSchema.parse(okPayload)).sort()).toEqual([
      'added',
      'dropped',
      'missing',
      'ok',
      'refreshedAt',
      'updated'
    ])
    // The failure arm is a fixed sanitized reason and nothing else — no body,
    // no status detail, no list of the ids that failed.
    expect(Object.keys(modelRefreshResponseSchema.parse({ ok: false, reason: 'r' })).sort()).toEqual(
      ['ok', 'reason']
    )
    expect(
      modelRefreshResponseSchema.safeParse({ ...okPayload, missingIds: ['a'] }).success
    ).toBe(false)
    expect(modelRefreshResponseSchema.safeParse({ ...okPayload, added: -1 }).success).toBe(false)
  })
})

describe('the effort vocabulary (Task 3a-4)', () => {
  it('is exactly the four app-level positions PLAN §4 names', () => {
    expect(effortLevelSchema.options).toEqual(['fast', 'balanced', 'deep', 'max'])
    for (const bad of ['low', 'high', 'xhigh', 'ultra', 'Fast', '']) {
      expect(effortLevelSchema.safeParse(bad).success).toBe(false)
    }
  })

  it('⚠ effortOptionSchema accepts `args` and REJECTS the old `cliFlag` shape', () => {
    // So a stale producer fails loudly instead of silently emitting nothing.
    expect(
      effortOptionSchema.parse({ id: 'deep', label: 'Deep', args: ['--effort', 'high'] })
    ).toEqual({ id: 'deep', label: 'Deep', args: ['--effort', 'high'] })
    expect(
      effortOptionSchema.safeParse({ id: 'deep', label: 'Deep', cliFlag: '--effort high' }).success
    ).toBe(false)
    // An empty token array is not a mapping.
    expect(effortOptionSchema.safeParse({ id: 'deep', label: 'Deep', args: [] }).success).toBe(false)
    // And `id` is tightened to the four-level vocabulary.
    expect(
      effortOptionSchema.safeParse({ id: 'high', label: 'High', args: ['--effort', 'high'] }).success
    ).toBe(false)
  })

  it('the codex two-token form round-trips intact — the reason `args` is an array', () => {
    const codex = { id: 'deep' as const, label: 'Deep', args: ['-c', 'model_reasoning_effort="high"'] }
    expect(effortOptionSchema.parse(codex)).toEqual(codex)
  })

  it('session:launch gains an OPTIONAL effort, constrained to the four levels', () => {
    const base = {
      project_id: '985d547b-d152-4a07-9094-ddb8da56ef8f',
      agent: 'codex' as const,
      cwd: 'C:\\Projects\\Chorus',
      workspace_mode: 'current-tree' as const
    }
    // Absent is legal, and is what keeps a no-effort launch byte-identical.
    expect(launchRequestSchema.parse(base).effort).toBeUndefined()
    expect(launchRequestSchema.parse({ ...base, effort: 'max' }).effort).toBe('max')
    expect(launchRequestSchema.safeParse({ ...base, effort: 'high' }).success).toBe(false)
    expect(launchRequestSchema.safeParse({ ...base, effort: null }).success).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* Task 3-3: widened detect schema (D34f) + adapter:list               */
/* ------------------------------------------------------------------ */

describe('detectedCliSchema with D34(f) display fields (Task 3-3)', () => {
  const agentRow = {
    name: 'claude',
    found: true,
    path: 'C:\\Users\\dev\\bin\\claude.exe',
    version: '2.1.218 (Claude Code)',
    displayName: 'Claude Code',
    agentKind: 'claude'
  }
  const toolRow = {
    name: 'git',
    found: true,
    path: 'C:\\Program Files\\Git\\cmd\\git.exe',
    version: 'git version 2.50.0.windows.1',
    displayName: null,
    agentKind: null
  }
  const notFoundRow = {
    name: 'codex',
    found: false,
    path: null,
    version: null,
    displayName: 'Codex',
    agentKind: 'codex'
  }

  it('accepts an agent row, a plain-tool row, and a not-found agent row', () => {
    expect(detectedCliSchema.parse(agentRow)).toEqual(agentRow)
    expect(detectedCliSchema.parse(toolRow)).toEqual(toolRow)
    expect(detectedCliSchema.parse(notFoundRow)).toEqual(notFoundRow)
    expect(cliDetectResponseSchema.parse([agentRow, toolRow, notFoundRow])).toEqual([
      agentRow,
      toolRow,
      notFoundRow
    ])
  })

  it('REJECTS a row missing agentKind or displayName (required-nullable, the 1b-1 discipline)', () => {
    const { agentKind: _a, ...missingKind } = agentRow
    const { displayName: _d, ...missingName } = agentRow
    expect(detectedCliSchema.safeParse(missingKind).success).toBe(false)
    expect(detectedCliSchema.safeParse(missingName).success).toBe(false)
  })

  it('rejects an agentKind outside the wire vocabulary', () => {
    expect(detectedCliSchema.safeParse({ ...agentRow, agentKind: 'gemini' }).success).toBe(false)
  })
})

describe('adapter:list schemas (Task 3-3, coordinator addition beyond D34(f))', () => {
  const descriptorPayload = {
    id: 'claude',
    displayName: 'Claude Code',
    executionMode: 'pty',
    authMethods: [
      {
        type: 'subscription',
        label: 'Claude subscription (claude.ai account login)',
        requiredEnvVar: null,
        helpUrl: 'https://code.claude.com/docs/en/overview'
      },
      {
        type: 'api_key',
        label: 'Anthropic API key',
        requiredEnvVar: 'ANTHROPIC_API_KEY',
        helpUrl: 'https://code.claude.com/docs/en/settings'
      }
    ],
    capabilities: {
      interactiveTerminal: true,
      worktreeSafe: true,
      skills: true,
      subscriptionLogin: true,
      apiKey: true,
      reasoningEffort: {
        // 3a-4: `args` token array, not `cliFlag`.
        mode: 'static',
        levels: [{ id: 'deep', label: 'Deep', args: ['--effort', 'high'] }],
        // ⚠ 2026-08-14: `defaultLevelId` is OPTIONAL on the schema, so a fixture
        // that omitted it would round-trip fine and prove nothing. It is carried
        // here for the same reason `mechanism` and `dialect` are carried below —
        // an optional field with no fixture coverage is a field that can be
        // dropped from the schema without a single test noticing.
        defaultLevelId: 'deep'
      },
      permissionMode: {
        mode: 'static',
        levels: [{ id: 'auto', label: 'Auto', args: ['--permission-mode', 'auto'] }],
        defaultLevelId: 'auto'
      },
      sessionResume: null,
      // ⚠ `mechanism` IS THE DISCRIMINANT and the fixture carries it. It was
      // absent here while main's `McpDescriptor` had required it for a release,
      // which is exactly how the wire and the type drifted unnoticed.
      // ⚠ AND `dialect` IS THE SECOND FIELD OF THAT KIND (Task 6-5): zod strips
      // unknown keys silently, so a dialect that reached the wire without a
      // schema line would simply vanish between main and the renderer.
      mcp: {
        mode: 'static',
        mechanism: 'project-file',
        format: 'json',
        location: 'project',
        configPath: '.mcp.json',
        dialect: 'claude'
      },
      hooks: null,
      // ⚠ THE THIRD FIELD OF THAT KIND (Task 6a-1 / D148), and it is here
      // NON-NULL on purpose: a nullable schema entry is proven by a payload
      // that actually carries a descriptor, not by one that leaves it null and
      // would pass just as happily against a stripped key.
      instructions: { mode: 'static', mechanism: 'append-system-prompt-file' }
    }
  }

  it('round-trips a realistic adapter descriptor, null AND non-null descriptors alike', () => {
    expect(adapterDescriptorSchema.parse(descriptorPayload)).toEqual(descriptorPayload)
    const response = [
      descriptorPayload,
      {
        ...descriptorPayload,
        id: 'codex',
        displayName: 'Codex',
        capabilities: { ...descriptorPayload.capabilities, skills: false, reasoningEffort: null, mcp: null }
      }
    ]
    expect(adapterListResponseSchema.parse(response)).toEqual(response)
  })

  /**
   * ⚠ THE REAL REGISTRY THROUGH THE REAL SCHEMA, and it is the test whose
   * absence shipped an empty adapter dropdown.
   *
   * The fixture test above passed for the entire life of the defect, because a
   * fixture is written to match the schema — it can only ever prove the schema
   * agrees with itself. What it could not see was that `codexAdapter` had grown
   * an `mcp` descriptor (`{ mode: 'static', mechanism: 'launch-args' }`, Task
   * 6-2) that `mcpDescriptorSchema` could not carry: the schema was a flat
   * object demanding `format`, `location` and `configPath`, none of which exist
   * on the launch-args arm. `adapter:list` threw on its OUTBOUND parse, one bad
   * element rejected the whole array, and the provider form offered no adapter
   * at all — so no provider could be created.
   *
   * ⚠ IT MIRRORS `ipc.ts`'s HANDLER BODY EXACTLY, deliberately. A test that
   * built the payload its own way could agree with the schema while the handler
   * disagreed with both, which is the same two-declarations-of-one-fact trap
   * that caused the defect.
   */
  it('⚠ the REAL adapter registry satisfies the wire schema — fixtures cannot prove this', () => {
    const live = [
      ...Object.values(staticRegistry).map((adapter) => ({
        id: adapter.id,
        displayName: adapter.displayName,
        executionMode: adapter.executionMode,
        authMethods: adapter.getAuthMethods(),
        capabilities: adapter.getCapabilities()
      })),
      NO_HARNESS_DESCRIPTOR
    ]
    const result = adapterListResponseSchema.safeParse(live)
    // The failure is reported in full: "an adapter does not fit the wire" is
    // useless without WHICH adapter and WHICH field.
    expect(result.success, JSON.stringify(result.error?.issues, null, 2)).toBe(true)
    // Every adapter must survive, because the dropdown is all-or-nothing.
    expect(result.success && result.data.length).toBe(Object.keys(staticRegistry).length + 1)
  })

  /** codex is the descriptor the flat schema could not express. Pinned by id so
   *  a future adapter gaining `launch-args` is covered by the test above, and
   *  this one keeps naming the case that actually broke. */
  it('⚠ carries codex’s launch-args MCP descriptor, which has no file to name', () => {
    const codex = adapterListResponseSchema
      .parse([
        ...Object.values(staticRegistry).map((a) => ({
          id: a.id,
          displayName: a.displayName,
          executionMode: a.executionMode,
          authMethods: a.getAuthMethods(),
          capabilities: a.getCapabilities()
        })),
        NO_HARNESS_DESCRIPTOR
      ])
      .find((a) => a.id === 'codex')
    expect(codex?.capabilities.mcp).toEqual({ mode: 'static', mechanism: 'launch-args' })
  })

  /** The other half of the union still has to demand what a file adapter cannot
   *  do without — otherwise the fix would have bought coverage by giving up the
   *  constraint that made the schema worth having. */
  it('⚠ still REJECTS a file-based descriptor that cannot name its file', () => {
    const fileArm = {
      mode: 'static',
      mechanism: 'project-file',
      format: 'json',
      location: 'project',
      dialect: 'claude'
    }
    expect(mcpDescriptorSchema.safeParse(fileArm).success).toBe(false)
    expect(mcpDescriptorSchema.safeParse({ ...fileArm, configPath: null }).success).toBe(false)
    expect(mcpDescriptorSchema.safeParse({ ...fileArm, configPath: '.mcp.json' }).success).toBe(true)
    // An unknown mechanism has no arm and must not fall through to one.
    expect(mcpDescriptorSchema.safeParse({ mode: 'static', mechanism: 'telepathy' }).success).toBe(false)
  })

  /**
   * ⚠ TASK 6-5: A FILE DESCRIPTOR THAT DOES NOT NAME ITS DIALECT IS REFUSED,
   * on exactly the reasoning that made `configPath` required. `format: 'json'`
   * says the file is JSON and says nothing about the SHAPE — and 6-1 Finding 1
   * measured claude's and opencode's shapes as different in every part that
   * matters, with opencode's schema `additionalProperties: false`, so the wrong
   * shape is REJECTED by the CLI rather than tolerated. A descriptor that
   * cannot say which schema its bytes satisfy is the same bug `configPath`
   * closed, one field along.
   */
  it('⚠ REJECTS a file descriptor with no dialect, and an unknown dialect', () => {
    const named = {
      mode: 'static',
      mechanism: 'project-file',
      format: 'json',
      location: 'project',
      configPath: '.mcp.json'
    }
    expect(mcpDescriptorSchema.safeParse(named).success).toBe(false)
    expect(mcpDescriptorSchema.safeParse({ ...named, dialect: 'kimi' }).success).toBe(false)
    expect(mcpDescriptorSchema.safeParse({ ...named, dialect: 'claude' }).success).toBe(true)
    expect(mcpDescriptorSchema.safeParse({ ...named, dialect: 'opencode' }).success).toBe(true)
    // ⚠ AND THE LAUNCH-ARGS ARM STILL HAS NO DIALECT TO NAME — it writes no
    // file, so there is no schema for its bytes to satisfy.
    const argv = mcpDescriptorSchema.parse({ mode: 'static', mechanism: 'launch-args' })
    expect(argv).not.toHaveProperty('dialect')
  })

  it('rejects a descriptor missing required halves and a bad executionMode', () => {
    const { authMethods: _omit, ...noAuth } = descriptorPayload
    expect(adapterDescriptorSchema.safeParse(noAuth).success).toBe(false)
    expect(adapterDescriptorSchema.safeParse({ ...descriptorPayload, executionMode: 'pipe' }).success).toBe(false)
    expect(adapterListRequestSchema.parse({})).toEqual({})
  })
})

/* ------------------------------------------------------------------ */
/* Task 3a-2: attention capture (spec §5.3)                            */
/* ------------------------------------------------------------------ */

describe('IpcChannel — the two new attention channels', () => {
  it('are present and every channel string in the map is unique', () => {
    expect(IpcChannel.AttentionReport).toBe('attention:report')
    expect(IpcChannel.AttentionSummary).toBe('attention:summary')
    const values = Object.values(IpcChannel)
    expect(new Set(values).size).toBe(values.length)
  })
})

describe('attentionReportSchema — write-only inbound', () => {
  const report = {
    projectId: PID,
    sessionId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    view: 'workspace' as const,
    // ⚠ D95 / Task 3e-3 — A RESHAPE OF THIS PAYLOAD, NOT A NEW CHANNEL. Required
    // rather than optional: an absent field would let a renderer that predates
    // D95 look valid while contributing no attribution, and this schema's job is
    // to make the wire shape unambiguous. `IpcChannel` does not move.
    councilProjectId: null,
    overlayOpen: false
  }

  it('round-trips a realistic report', () => {
    expect(attentionReportSchema.parse(report)).toEqual(report)
  })

  it('D95: carries the council view’s project, and accepts null from every other view', () => {
    const inCouncil = { ...report, view: 'council' as const, councilProjectId: PID }
    expect(attentionReportSchema.parse(inCouncil).councilProjectId).toBe(PID)
    expect(attentionReportSchema.parse(report).councilProjectId).toBeNull()
    // A uuid, not free text — it names a project row.
    expect(attentionReportSchema.safeParse({ ...inCouncil, councilProjectId: 'proj-1' }).success).toBe(false)
    // Required, not optional.
    const { councilProjectId: _drop, ...missing } = report
    expect(attentionReportSchema.safeParse(missing).success).toBe(false)
  })

  it('ACCEPTS a null sessionId — chrome focus is the overhead bucket, not an error', () => {
    expect(attentionReportSchema.parse({ ...report, sessionId: null }).sessionId).toBeNull()
    expect(attentionReportSchema.parse({ ...report, projectId: null }).projectId).toBeNull()
  })

  it('accepts the council view (3b-4) and still rejects anything outside the three', () => {
    expect(attentionReportSchema.safeParse({ ...report, view: 'council' }).success).toBe(true)
    expect(attentionReportSchema.safeParse({ ...report, view: 'settings' }).success).toBe(true)
  })

  it('rejects a non-uuid sessionId, a bad view, and a missing field', () => {
    expect(attentionReportSchema.safeParse({ ...report, sessionId: 'sess-A' }).success).toBe(false)
    expect(attentionReportSchema.safeParse({ ...report, view: 'board' }).success).toBe(false)
    const { overlayOpen: _drop, ...missing } = report
    expect(attentionReportSchema.safeParse(missing).success).toBe(false)
  })

  it('is strict — an extra field is refused rather than silently stripped', () => {
    expect(attentionReportSchema.safeParse({ ...report, keystrokes: 42 }).success).toBe(false)
  })

  it('the class vocabulary is exactly the five of the focus-state table', () => {
    expect([...attentionClassSchema.options].sort()).toEqual([
      'blurred',
      'idle',
      'locked',
      'overhead',
      'pane'
    ])
  })
})

describe('attentionSummaryResponseSchema — the denominator, made structural', () => {
  const summary = {
    projectId: PID,
    from: '2026-07-25T00:00:00.000Z',
    to: '2026-07-25T23:59:59.000Z',
    byClass: { pane: 9, overhead: 5, blurred: 5, idle: 8, locked: 0 },
    samples: 27,
    tickSeconds: 15,
    expectedSamples: 30,
    missingSamples: 3,
    coveragePct: 90,
    bySession: [{ sessionId: 'sess-A', samples: 9 }],
    estimateBound: 'lower-bound' as const
  }

  it('round-trips a full, internally consistent summary', () => {
    const parsed = attentionSummaryResponseSchema.parse(summary)
    expect(parsed).toEqual(summary)
    // The accounting identity, asserted on the WIRE SHAPE and not only in the core.
    const sum = Object.values(parsed.byClass).reduce((a, b) => a + b, 0)
    expect(sum).toBe(parsed.samples)
  })

  it('NEGATIVE TEST — a denominator-less response FAILS TO PARSE', () => {
    // This is the Non-Goals bar made structural: "no attention number may ship
    // anywhere without its sample count and its coverage figure travelling in
    // the same object". A handler that drops one of these throws in main rather
    // than shipping a bare figure that will be believed.
    for (const missing of ['byClass', 'samples', 'expectedSamples', 'coveragePct', 'tickSeconds', 'estimateBound']) {
      const stripped: Record<string, unknown> = { ...summary }
      delete stripped[missing]
      expect(attentionSummaryResponseSchema.safeParse(stripped).success).toBe(false)
    }
  })

  it('there is NO `minutes` field, and adding one is refused by strict()', () => {
    expect('minutes' in summary).toBe(false)
    expect(
      attentionSummaryResponseSchema.safeParse({ ...summary, minutes: 6.75 }).success
    ).toBe(false)
  })

  it('byClass must carry ALL FIVE classes — a partial histogram cannot be checked', () => {
    const { locked: _drop, ...partial } = summary.byClass
    expect(
      attentionSummaryResponseSchema.safeParse({ ...summary, byClass: partial }).success
    ).toBe(false)
  })

  it('estimateBound is pinned to lower-bound — the bias direction cannot be relabelled', () => {
    expect(
      attentionSummaryResponseSchema.safeParse({ ...summary, estimateBound: 'exact' }).success
    ).toBe(false)
  })

  it('the request needs a uuid project and both window bounds', () => {
    const req = { project_id: PID, from: summary.from, to: summary.to }
    expect(attentionSummaryRequestSchema.parse(req)).toEqual(req)
    expect(attentionSummaryRequestSchema.safeParse({ ...req, project_id: 'p1' }).success).toBe(false)
    expect(attentionSummaryRequestSchema.safeParse({ project_id: PID, from: summary.from }).success).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* Task 3a-3: attribution:summary (D42) + the management auth mode     */
/* ------------------------------------------------------------------ */

describe('IpcChannel — the attribution channel (Task 3a-3)', () => {
  it('is present and every channel string in the map is still unique', () => {
    expect(IpcChannel.AttributionSummary).toBe('attribution:summary')
    const values = Object.values(IpcChannel)
    expect(new Set(values).size).toBe(values.length)
  })
})

describe('MANAGEMENT_AUTH_MODE — an account-level class, NOT an adapter auth method', () => {
  it('is the literal the provider row carries', () => {
    expect(MANAGEMENT_AUTH_MODE).toBe('management')
  })

  it('fits provider_configs.auth_mode with NO migration and NO wire-schema change', () => {
    // The whole storage ruling rests on auth_mode being an unconstrained
    // string on both sides. If a future edit tightens it to an enum, this test
    // fails and the ruling is revisited deliberately rather than discovered at
    // runtime by a launch that cannot be refused.
    const created = providerCreateRequestSchema.parse({
      name: 'OpenRouter admin',
      adapter_type: 'codex',
      auth_mode: MANAGEMENT_AUTH_MODE
    })
    expect(created.auth_mode).toBe('management')
    expect(
      providerUpdateRequestSchema.safeParse({ id: PID, auth_mode: MANAGEMENT_AUTH_MODE }).success
    ).toBe(true)
  })
})

describe('attributionSummaryResponseSchema — no percentage without its denominator (D55)', () => {
  const summary = {
    from: '2026-07-25T00:00:00.000Z',
    to: '2026-07-25T23:59:59.000Z',
    spendPct: 0.6,
    dispatchPct: 0.25,
    attributedUsd: 0.03,
    unattributedUsd: 0.02,
    gatewayTotalUsd: 0.05,
    totalDispatches: 4,
    attributedDispatches: 1,
    subscriptionDispatches: 2,
    tokensSourceBreakdown: { analytics: 1, analyticsDerived: 2, cliLogs: 1, apiUsage: 0, unknown: 0 },
    spendBasis: 'gateway-only' as const,
    managementKeyConfigured: true
  }

  it('round-trips a full summary, and the ratios agree with the counts it shipped', () => {
    const parsed = attributionSummaryResponseSchema.parse(summary)
    expect(parsed).toEqual(summary)
    // Checkable on the WIRE SHAPE, not only in the core — which is the point of
    // shipping the denominators at all.
    expect(parsed.attributedDispatches / parsed.totalDispatches).toBeCloseTo(parsed.dispatchPct!)
    expect(parsed.attributedUsd / parsed.gatewayTotalUsd!).toBeCloseTo(parsed.spendPct!)
  })

  it('NEGATIVE TEST — a denominator-less response FAILS TO PARSE', () => {
    for (const missing of [
      'attributedUsd',
      'unattributedUsd',
      'gatewayTotalUsd',
      'totalDispatches',
      'attributedDispatches',
      'subscriptionDispatches',
      'tokensSourceBreakdown',
      'spendBasis'
    ]) {
      const stripped: Record<string, unknown> = { ...summary }
      delete stripped[missing]
      expect(attributionSummaryResponseSchema.safeParse(stripped).success).toBe(false)
    }
  })

  it('⚠ NO FIELD CAN CARRY KEY MATERIAL — the parse output key set is pinned', () => {
    // The 3-2 discipline: assert the WHOLE key set, so a field capable of
    // carrying a key, a hash, or a profile id cannot be added without this
    // test failing. `.strict()` covers the other direction (an extra field is
    // refused rather than silently stripped, F-5b).
    expect(Object.keys(attributionSummaryResponseSchema.parse(summary)).sort()).toEqual([
      'attributedDispatches',
      'attributedUsd',
      'dispatchPct',
      'from',
      'gatewayTotalUsd',
      'managementKeyConfigured',
      'spendBasis',
      'spendPct',
      'subscriptionDispatches',
      'to',
      'tokensSourceBreakdown',
      'totalDispatches',
      'unattributedUsd'
    ])
    for (const smuggled of [
      { mintedKey: 'sk-or-v1-' + 'x'.repeat(40) },
      { key: 'sk-or-v1-' + 'x'.repeat(40) },
      { mintedKeyHash: 'a'.repeat(64) },
      { managementKey: 'sk-or-v1-' + 'x'.repeat(40) },
      { credentialProfileId: PID }
    ]) {
      expect(attributionSummaryResponseSchema.safeParse({ ...summary, ...smuggled }).success).toBe(false)
    }
  })

  it('accepts NULL ratios — an unknown percentage is a real answer, and it is not 0', () => {
    const unknown = {
      ...summary,
      spendPct: null,
      dispatchPct: null,
      unattributedUsd: null,
      gatewayTotalUsd: null,
      totalDispatches: 0,
      attributedDispatches: 0,
      managementKeyConfigured: false
    }
    expect(attributionSummaryResponseSchema.parse(unknown)).toEqual(unknown)
  })

  it('spendBasis is pinned to gateway-only — the scope cannot be relabelled', () => {
    // Subscription work contributes zero dollars BY DESIGN, not by omission,
    // and a consumer must not be able to render the dollar figure as though it
    // covered everything.
    expect(
      attributionSummaryResponseSchema.safeParse({ ...summary, spendBasis: 'all-spend' }).success
    ).toBe(false)
  })

  it('rejects a negative or fractional dispatch count', () => {
    expect(attributionSummaryResponseSchema.safeParse({ ...summary, totalDispatches: -1 }).success).toBe(false)
    expect(attributionSummaryResponseSchema.safeParse({ ...summary, totalDispatches: 1.5 }).success).toBe(false)
  })

  it('tokensSourceBreakdown requires all four buckets and is strict', () => {
    const { cliLogs: _drop, ...partial } = summary.tokensSourceBreakdown
    expect(tokensSourceBreakdownSchema.safeParse(partial).success).toBe(false)
    expect(
      tokensSourceBreakdownSchema.safeParse({ ...summary.tokensSourceBreakdown, guessed: 1 }).success
    ).toBe(false)
  })

  it('the request is ACCOUNT-scoped — it takes a window and nothing else', () => {
    const req = { from: summary.from, to: summary.to }
    expect(attributionSummaryRequestSchema.parse(req)).toEqual(req)
    // A minted key's spend has no project dimension, and neither does the
    // gateway total it is divided by — scoping one and not the other would
    // produce a ratio of two different things.
    expect(Object.keys(attributionSummaryRequestSchema.parse(req)).sort()).toEqual(['from', 'to'])
    expect(attributionSummaryRequestSchema.safeParse({ from: summary.from }).success).toBe(false)
  })
})

/* ================================================================== */
/* Task 3a-5 / D43: launch profiles                                    */
/* ================================================================== */

describe('launch profiles (Task 3a-5 / D43)', () => {
  const PROF = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
  const PROV = '6c052ee6-1eb3-4d7c-8aa3-832bd19dfd13'
  const CRED = '6a658a8f-b3a3-42f5-b318-f6efa11732ad'

  const wire = {
    id: PROF,
    label: 'OR/Kimi K3',
    agent: 'codex',
    provider_id: PROV,
    provider_name: 'OpenRouter',
    credential_profile_id: CRED,
    credential_label: 'A label',
    model: 'vendor/model',
    effort: 'deep',
    model_effort: null,
    permission_mode: null,
    workspace_mode: 'current-tree',
    env_json: null,
    disabled_reason: null,
    created_at: '2026-07-26T00:00:00.000Z',
    updated_at: '2026-07-26T00:00:00.000Z'
  }

  it('launchProfileWireSchema parses the full shape', () => {
    expect(launchProfileWireSchema.safeParse(wire).success).toBe(true)
  })

  /**
   * The KEY-SET assertion (the 3-2 discipline). Asserted over the PARSE
   * OUTPUT's full key set, not by spot-checking: a future field capable of
   * carrying key material has to break this test to get in.
   */
  it('carries a credential PROFILE ID and LABEL and nothing capable of holding a key', () => {
    const keys = Object.keys(launchProfileWireSchema.parse(wire)).sort()
    expect(keys).toEqual(
      [
        'agent',
        'created_at',
        'credential_label',
        'credential_profile_id',
        'disabled_reason',
        'effort',
        'env_json',
        'id',
        'label',
        'model',
        'model_effort',
        'permission_mode',
        'provider_id',
        'provider_name',
        'updated_at',
        'workspace_mode'
      ].sort()
    )
    for (const k of keys) {
      expect(k).not.toMatch(/key|secret|token|blob|fingerprint|password|value/i)
    }
  })

  it('effort is 3a-4 effortLevelSchema, IMPORTED - not a free string', () => {
    expect(launchProfileWireSchema.safeParse({ ...wire, effort: 'fast' }).success).toBe(true)
    expect(launchProfileWireSchema.safeParse({ ...wire, effort: null }).success).toBe(true)
    // 3a-4's four levels and no others: claude's CLI values are NOT the app's.
    expect(launchProfileWireSchema.safeParse({ ...wire, effort: 'high' }).success).toBe(false)
    expect(launchProfileWireSchema.safeParse({ ...wire, effort: 'xhigh' }).success).toBe(false)
  })

  /**
   * D179's other half, and the pair of assertions is the point: the words the
   * four-rung field REFUSES are exactly the words the model-vocabulary field
   * ACCEPTS, and vice versa. That is what makes them two fields rather than one
   * widened one — collapsing them would have to admit both sets everywhere, and
   * `deep` would become a legal thing to write into opencode's config.
   */
  it("D179: model_effort takes the MODEL's vocabulary, and never Chorus's four rungs", () => {
    expect(launchProfileWireSchema.safeParse({ ...wire, model_effort: 'xhigh' }).success).toBe(true)
    expect(launchProfileWireSchema.safeParse({ ...wire, model_effort: 'high' }).success).toBe(true)
    expect(launchProfileWireSchema.safeParse({ ...wire, model_effort: null }).success).toBe(true)
    // The charset guard, not a vocabulary: this value is written into another
    // tool's config file.
    expect(launchProfileWireSchema.safeParse({ ...wire, model_effort: 'Extra High' }).success).toBe(
      false
    )
    expect(launchProfileWireSchema.safeParse({ ...wire, model_effort: '' }).success).toBe(false)
  })

  it('a SAVED profile may not pin an existing worktree', () => {
    expect(savedWorkspaceModeSchema.safeParse('current-tree').success).toBe(true)
    expect(savedWorkspaceModeSchema.safeParse('new-worktree').success).toBe(true)
    expect(savedWorkspaceModeSchema.safeParse('existing-worktree').success).toBe(false)
    expect(
      launchProfileWireSchema.safeParse({ ...wire, workspace_mode: 'existing-worktree' }).success
    ).toBe(false)
  })

  it('required-nullable: forgetting a nullable key fails loudly (the house discipline)', () => {
    const { credential_profile_id: _drop, ...missing } = wire
    expect(launchProfileWireSchema.safeParse(missing).success).toBe(false)
  })

  it('launchProfileListResponseSchema parses a list and an empty list', () => {
    expect(launchProfileListResponseSchema.safeParse({ profiles: [] }).success).toBe(true)
    expect(launchProfileListResponseSchema.safeParse({ profiles: [wire] }).success).toBe(true)
  })

  it('create/update/delete responses admit both arms of the union', () => {
    expect(launchProfileCreateResponseSchema.safeParse({ ok: true, profile: wire }).success).toBe(
      true
    )
    expect(launchProfileCreateResponseSchema.safeParse({ ok: false, reason: 'nope' }).success).toBe(
      true
    )
    expect(launchProfileUpdateResponseSchema.safeParse({ ok: true, profile: wire }).success).toBe(
      true
    )
    expect(launchProfileDeleteResponseSchema.safeParse({ ok: true }).success).toBe(true)
    expect(launchProfileDeleteResponseSchema.safeParse({ ok: false, reason: 'nope' }).success).toBe(
      true
    )
  })

  it('create refuses an env_json over the wire cap', () => {
    expect(
      launchProfileCreateRequestSchema.safeParse({
        label: 'x',
        agent: 'codex',
        provider_id: PROV,
        credential_profile_id: CRED,
        model: null,
        effort: null,
        permission_mode: null,
        workspace_mode: 'current-tree',
        env_json: '{"A":"' + 'x'.repeat(5000) + '"}'
      }).success
    ).toBe(false)
  })

  /**
   * The mutual exclusion of launch_profile_id and credential_profile_id is
   * enforced in MAIN, not by schema branching - deliberately, so the refusal
   * has a place to say WHY. The schema must therefore ACCEPT both-present.
   */
  it('launchRequestSchema: profile-only, credential-only, neither, and BOTH all parse', () => {
    const base = {
      project_id: PID,
      agent: 'codex',
      cwd: 'C:\\Projects\\Chorus',
      workspace_mode: 'current-tree'
    }
    expect(launchRequestSchema.safeParse(base).success).toBe(true)
    expect(launchRequestSchema.safeParse({ ...base, launch_profile_id: PROF }).success).toBe(true)
    expect(launchRequestSchema.safeParse({ ...base, credential_profile_id: CRED }).success).toBe(
      true
    )
    // Both present: the SCHEMA accepts it; main authors the refusal.
    expect(
      launchRequestSchema.safeParse({
        ...base,
        launch_profile_id: PROF,
        credential_profile_id: CRED
      }).success
    ).toBe(true)
  })

  it('there is exactly ONE effort field on the launch payload (3a-4s), not a second', () => {
    const parsed = launchRequestSchema.parse({
      project_id: PID,
      agent: 'codex',
      cwd: 'C:\\X',
      workspace_mode: 'current-tree',
      effort: 'deep',
      launch_profile_id: PROF
    })
    expect(Object.keys(parsed).filter((k) => /effort/i.test(k))).toEqual(['effort'])
  })

  it('launchContextResponseSchema carries the picker rows and a nullable last-used ID', () => {
    const ctx = {
      projectRoot: 'C:\\Projects\\Chorus',
      recentCwds: [],
      repoRoot: null,
      liveSessionsInRepo: 0,
      suggestedMode: 'current-tree',
      worktrees: [],
      launchProfiles: [wire],
      lastLaunchProfileId: null,
      usedAgentNames: []
    }
    expect(launchContextResponseSchema.safeParse(ctx).success).toBe(true)
    expect(launchContextResponseSchema.safeParse({ ...ctx, lastLaunchProfileId: PROF }).success).toBe(
      true
    )
    // required-nullable: omitting it fails loudly rather than defaulting.
    const { lastLaunchProfileId: _d, ...missing } = ctx
    expect(launchContextResponseSchema.safeParse(missing).success).toBe(false)
  })

  it('relaunch admits a snapshot and an authored refusal', () => {
    expect(relaunchRequestSchema.safeParse({ sessionId: PROF }).success).toBe(true)
    expect(relaunchResponseSchema.safeParse({ ok: false, reason: 'no profile' }).success).toBe(true)
    expect(
      relaunchResponseSchema.safeParse({
        sessionId: PROF,
        buffer: '',
        status: 'running',
        exitCode: null,
        // Required-nullable, exactly as on attach/launch: the relaunched
        // session keeps its healed title unless the agent's own OSC replaces
        // it, and reports the worktree it came back in.
        title: 'Credential not re-supplied — relaunch from the dialog to re-enter it',
        branch: null,
        worktreeId: null,
        // v14: the AUTHORED identity survives a relaunch — same row, same name.
        name: 'Bob',
        description: null,
        // v16: and so does the LOCK, for the same reason — a relaunch reuses
        // the row, and a guard the user set must not be dropped by restarting
        // the agent it was protecting.
        locked: true
      }).success
    ).toBe(true)
  })

  it('the five channels exist and are namespaced', () => {
    expect(IpcChannel.LaunchProfileList).toBe('launch-profile:list')
    expect(IpcChannel.LaunchProfileCreate).toBe('launch-profile:create')
    expect(IpcChannel.LaunchProfileUpdate).toBe('launch-profile:update')
    expect(IpcChannel.LaunchProfileDelete).toBe('launch-profile:delete')
    expect(IpcChannel.SessionRelaunch).toBe('session:relaunch')
  })
})

describe('council members (Task 3b-2 / D62)', () => {
  const MEM = '9a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5e'
  const CRED = '6a658a8f-b3a3-42f5-b318-f6efa11732ad'

  const wire = {
    id: MEM,
    label: 'OpenRouter/kimi-k3',
    credentialProfileId: CRED,
    credentialLabel: 'A label',
    providerName: 'OpenRouter',
    model: null,
    resolvedModel: 'vendor/route-default',
    role: 'member',
    available: true,
    unavailableReason: null,
    maxTokens: null,
    defaultMaxTokens: 16_000,
    otherParamNames: []
  }

  it('councilRoleSchema is exactly member | arbiter — the ONE home for the vocabulary', () => {
    expect(councilRoleSchema.safeParse('member').success).toBe(true)
    expect(councilRoleSchema.safeParse('arbiter').success).toBe(true)
    expect(councilRoleSchema.safeParse('chair').success).toBe(false)
    expect(councilRoleSchema.safeParse('').success).toBe(false)
    // There is deliberately NO CHECK constraint on council_members.role — this
    // schema is the vocabulary, so widening it is never a migration.
    expect(councilRoleSchema.options).toEqual(['member', 'arbiter'])
  })

  it('councilMemberWireSchema parses the full shape', () => {
    expect(councilMemberWireSchema.safeParse(wire).success).toBe(true)
  })

  /**
   * The KEY-SET assertion (the 3-2 discipline), asserted over the PARSE
   * OUTPUT's full key set rather than by spot-checking: a future field capable
   * of carrying key material has to break this test to get in.
   */
  it('carries a credential PROFILE ID and LABEL and nothing capable of holding a key', () => {
    const keys = Object.keys(councilMemberWireSchema.parse(wire)).sort()
    expect(keys).toEqual(
      [
        'available',
        'credentialLabel',
        'credentialProfileId',
        'id',
        'label',
        'model',
        'providerName',
        'resolvedModel',
        'role',
        'unavailableReason',
        // The params PROJECTION. `params_json` itself still never round-trips —
        // these are the two things about it that cannot carry a pasted key: a
        // number, and a list of NAMES.
        'maxTokens',
        'defaultMaxTokens',
        'otherParamNames'
      ].sort()
    )
    /**
     * ⚠ TWO KEYS ARE EXEMPT FROM THE NAME HEURISTIC BELOW, AND THEY EARN IT
     * WITH A TYPE. `maxTokens` / `defaultMaxTokens` are OUTPUT-BUDGET COUNTS —
     * the other sense of the word entirely — so a name check written against
     * `access_token` fires on a pair of integers. They are asserted to BE
     * integers instead, which is the stronger guarantee: a `z.number().int()`
     * cannot hold a key whatever it is called, where a name can only ever be a
     * hint that one might.
     */
    const budgetCounts = ['maxTokens', 'defaultMaxTokens']
    const parsed = councilMemberWireSchema.parse({ ...wire, maxTokens: 4000 }) as Record<
      string,
      unknown
    >
    for (const k of budgetCounts) expect(typeof parsed[k]).toBe('number')
    expect(councilMemberWireSchema.safeParse({ ...wire, maxTokens: 'sk-or-v1-x' }).success).toBe(
      false
    )
    for (const k of keys.filter((k) => !budgetCounts.includes(k))) {
      expect(k).not.toMatch(/key|secret|token|blob|fingerprint|password|value/i)
    }
  })

  /**
   * The OTHER half of the projection: parameter NAMES may cross, VALUES may not.
   * The schema can only enforce the shape — that this is a list of strings with
   * a bound — and `toCouncilMemberWire` is what fills it from `Object.keys`.
   * Asserted here so the bound itself cannot be quietly removed.
   */
  it('bounds otherParamNames — a list of names, not an escape hatch', () => {
    expect(
      councilMemberWireSchema.safeParse({ ...wire, otherParamNames: ['temperature', 'top_p'] })
        .success
    ).toBe(true)
    expect(
      councilMemberWireSchema.safeParse({
        ...wire,
        otherParamNames: Array.from({ length: 33 }, (_, i) => `p${i}`)
      }).success
    ).toBe(false)
    expect(
      councilMemberWireSchema.safeParse({ ...wire, otherParamNames: [{ temperature: 0.2 }] }).success
    ).toBe(false)
  })

  /**
   * Patch semantics for the field the settings form writes. `maxTokens` is a
   * SEPARATE patch key from `paramsJson` because the renderer cannot see the
   * other parameters to rebuild them — main merges. Absent, null and a number
   * are three different instructions and the schema has to admit all three.
   */
  it('councilMemberUpdateRequestSchema takes maxTokens as its own patch field', () => {
    const id = MEM
    expect(councilMemberUpdateRequestSchema.safeParse({ id }).success).toBe(true)
    expect(councilMemberUpdateRequestSchema.safeParse({ id, maxTokens: 16000 }).success).toBe(true)
    expect(councilMemberUpdateRequestSchema.safeParse({ id, maxTokens: null }).success).toBe(true)
    // Both together is legal — replace the others, then set the budget on top.
    expect(
      councilMemberUpdateRequestSchema.safeParse({
        id,
        paramsJson: '{"temperature":0.2}',
        maxTokens: 16000
      }).success
    ).toBe(true)
    // A float is not a token count.
    expect(councilMemberUpdateRequestSchema.safeParse({ id, maxTokens: 1.5 }).success).toBe(false)
    expect(councilMemberUpdateRequestSchema.safeParse({ id, maxTokens: '16000' }).success).toBe(
      false
    )
  })

  /**
   * ⚠ THE HEADLINE RULING, ENFORCED BY THE WIRE CONTRACT ITSELF. The route has
   * ONE home (`provider_configs`, D48) and is reached through the credential,
   * so there is no `baseUrl` and no `providerId` on a member — not on the row,
   * not on the wire. `.strict()` makes an attempt to re-add one FAIL rather
   * than be silently stripped. The roadmap's own Phase 3b line still says a
   * member is "credential profile + base URL + model id + role + params"; this
   * test is where that superseded phrasing gets refused.
   */
  it('⚠ has NO baseUrl and NO providerId, and .strict() refuses an attempt to add one', () => {
    const keys = Object.keys(councilMemberWireSchema.parse(wire))
    expect(keys).not.toContain('baseUrl')
    expect(keys).not.toContain('base_url')
    expect(keys).not.toContain('providerId')
    expect(keys).not.toContain('provider_id')
    expect(councilMemberWireSchema.safeParse({ ...wire, baseUrl: 'https://x/v1' }).success).toBe(false)
    expect(councilMemberWireSchema.safeParse({ ...wire, providerId: CRED }).success).toBe(false)
  })

  /**
   * ⚠ `model` AND `resolvedModel` ARE TWO FIELDS ON PURPOSE (D56). The raw
   * column says whether this member CHOSE a model; the resolved value says what
   * it will actually speak on. Collapsing them would make "NULL, inheriting"
   * and "explicitly set to the route default" indistinguishable — which is
   * exactly how a back-write into rank 1 gets written by someone reading the
   * UI, and exactly what D48 exists to prevent.
   */
  it('⚠ model and resolvedModel are SEPARATE fields — a NULL column can still resolve', () => {
    const parsed = councilMemberWireSchema.parse(wire)
    expect(parsed.model).toBeNull()
    expect(parsed.resolvedModel).toBe('vendor/route-default')
    // Rank 1 set: both carry the member's own choice.
    const own = councilMemberWireSchema.parse({ ...wire, model: 'v/own', resolvedModel: 'v/own' })
    expect(own.model).toBe('v/own')
    // Rank 3: nothing to resolve to at all.
    expect(
      councilMemberWireSchema.safeParse({ ...wire, model: null, resolvedModel: null }).success
    ).toBe(true)
  })

  it('an unavailable member is a SHAPE, not an absence — available:false + a reason', () => {
    expect(
      councilMemberWireSchema.safeParse({
        ...wire,
        available: false,
        unavailableReason:
          "Credential profile 'A label' is unavailable: decryption failed. Re-enter the credential in Settings."
      }).success
    ).toBe(true)
  })

  it('required-nullable: forgetting a nullable key fails loudly (the house discipline)', () => {
    const { unavailableReason: _drop, ...missing } = wire
    expect(councilMemberWireSchema.safeParse(missing).success).toBe(false)
    const { resolvedModel: _drop2, ...missing2 } = wire
    expect(councilMemberWireSchema.safeParse(missing2).success).toBe(false)
  })

  it('the wire refuses an unknown role', () => {
    expect(councilMemberWireSchema.safeParse({ ...wire, role: 'moderator' }).success).toBe(false)
  })

  it('councilMemberListResponseSchema parses a list and an empty list', () => {
    expect(councilMemberListResponseSchema.safeParse({ members: [] }).success).toBe(true)
    expect(councilMemberListResponseSchema.safeParse({ members: [wire] }).success).toBe(true)
  })

  it('create/update/delete responses admit both arms of the union', () => {
    expect(councilMemberCreateResponseSchema.safeParse({ ok: true, member: wire }).success).toBe(true)
    expect(councilMemberCreateResponseSchema.safeParse({ ok: false, reason: 'nope' }).success).toBe(
      true
    )
    expect(councilMemberUpdateResponseSchema.safeParse({ ok: true, member: wire }).success).toBe(true)
    expect(councilMemberDeleteResponseSchema.safeParse({ ok: true }).success).toBe(true)
    expect(councilMemberDeleteResponseSchema.safeParse({ ok: false, reason: 'nope' }).success).toBe(
      true
    )
  })

  /** ⚠ NOT NULLABLE, and with no providerId beside it: a council member ALWAYS
   *  authenticates, so D33 clause 9's route-without-credential case — which is
   *  exactly why `launch_profiles` needs both columns — does not reach here. */
  it('create REQUIRES a credential and offers no route field at all', () => {
    const req = {
      label: 'A member',
      credentialProfileId: CRED,
      model: null,
      role: 'member',
      paramsJson: null
    }
    expect(councilMemberCreateRequestSchema.safeParse(req).success).toBe(true)
    expect(
      councilMemberCreateRequestSchema.safeParse({ ...req, credentialProfileId: null }).success
    ).toBe(false)
    const { credentialProfileId: _drop, ...noCred } = req
    expect(councilMemberCreateRequestSchema.safeParse(noCred).success).toBe(false)
    // A NULL model is a REAL CHOICE — "inherit this route's default" (D56).
    expect(councilMemberCreateRequestSchema.safeParse({ ...req, model: null }).success).toBe(true)
  })

  it('create refuses a paramsJson over the wire cap', () => {
    expect(
      councilMemberCreateRequestSchema.safeParse({
        label: 'x',
        credentialProfileId: CRED,
        model: null,
        role: 'member',
        paramsJson: '{"a":"' + 'x'.repeat(5000) + '"}'
      }).success
    ).toBe(false)
  })

  it('update is a PATCH: every field but the id is optional', () => {
    expect(councilMemberUpdateRequestSchema.safeParse({ id: MEM }).success).toBe(true)
    expect(councilMemberUpdateRequestSchema.safeParse({ id: MEM, label: 'renamed' }).success).toBe(
      true
    )
    // null CLEARS the member's own model, dropping it back to the route default.
    expect(councilMemberUpdateRequestSchema.safeParse({ id: MEM, model: null }).success).toBe(true)
    expect(councilMemberUpdateRequestSchema.safeParse({ id: MEM, role: 'arbiter' }).success).toBe(
      true
    )
    expect(councilMemberUpdateRequestSchema.safeParse({ id: MEM, role: 'chair' }).success).toBe(false)
  })

  it('the four channels exist and are namespaced', () => {
    expect(IpcChannel.CouncilMemberList).toBe('council-member:list')
    expect(IpcChannel.CouncilMemberCreate).toBe('council-member:create')
    expect(IpcChannel.CouncilMemberUpdate).toBe('council-member:update')
    expect(IpcChannel.CouncilMemberDelete).toBe('council-member:delete')
  })
})

describe('council run channels (Task 3b-3 / D64(2), D67)', () => {
  const RUN = '9ba9b0da-cecd-4960-815d-f36166cf8c00'
  const MEMBER = '3f7c1e2a-9b04-4d5e-8a11-6c2d0e9f4b73'
  /** A minimal at-a-glance row, so the response fixtures below stay about the
   *  thing each of them is testing. */
  const SUMMARY = [
    {
      index: 0,
      question: 'Should orphan runs remain visible?',
      path: 'structural' as const,
      state: 'agreed' as const,
      votes: [
        { label: 'CR GLM (5.2)', verdict: 'AGREE' as const },
        { label: 'CR Kimi (k3)', verdict: 'AGREE' as const }
      ],
      silent: []
    }
  ]

  it('the four channels exist and are namespaced', () => {
    expect(IpcChannel.CouncilPickBrief).toBe('council:pick-brief')
    expect(IpcChannel.CouncilStart).toBe('council:start')
    expect(IpcChannel.CouncilCancel).toBe('council:cancel')
    expect(IpcChannel.CouncilProgress).toBe('council:progress')
  })

  it('⚠ 3b-4: council:start carries the brief PATH, and brief_text was REPLACED', () => {
    expect(
      councilStartRequestSchema.safeParse({ project_id: null, brief_path: 'C:\\docs\\x.md' }).success
    ).toBe(true)
    // ⚠ THE BREAKING HALF, ASSERTED RATHER THAN ASSUMED (D68(4)). 3b-3 required
    // `brief_text` and main never opened the path; carrying both would leave the
    // renderer holding the authoritative input, which would make main's path
    // validation decorative. A request still sending the text does not parse.
    expect(
      councilStartRequestSchema.safeParse({
        project_id: null,
        brief_path: 'C:\\docs\\x.md',
        brief_text: '1. Is this sound?'
      }).success
    ).toBe(false)
  })

  it('rejects an unknown field — .strict(), like every sibling', () => {
    expect(
      councilStartRequestSchema.safeParse({
        project_id: null,
        brief_path: 'C:\\docs\\x.md',
        credential_profile_id: MEMBER
      }).success
    ).toBe(false)
  })

  it('the brief picker follows project:add — a path, or a STRUCTURED cancel', () => {
    expect(councilPickBriefRequestSchema.safeParse({}).success).toBe(true)
    expect(councilPickBriefResponseSchema.safeParse({ path: 'C:\\docs\\brief.md' }).success).toBe(true)
    expect(councilPickBriefResponseSchema.safeParse({ cancelled: true }).success).toBe(true)
    // `cancelled: false` is not a shape — the union has two arms, not a flag.
    expect(councilPickBriefResponseSchema.safeParse({ cancelled: false }).success).toBe(false)
    // ⚠ NO SECOND PATH ON THE WIRE ANYWHERE: the findings path is DERIVED in
    // main from the validated brief path, so there is no request field able to
    // carry a renderer-chosen write target.
    expect(
      councilPickBriefResponseSchema.safeParse({ path: 'C:\\docs\\brief.md', findings_path: 'C:\\evil.md' })
        .success
    ).toBe(false)
  })

  it('⚠ D55: cost_usd CANNOT be read without its denominator', () => {
    const accounting = {
      membersPlanned: 4,
      membersAnswered: 3,
      membersRefused: 1,
      turnsAnswered: 6,
      turnsRefused: 1,
      usageReported: 3,
      usageAbsent: 1,
      tokensIn: 1000,
      tokensOut: 500,
      tokensCached: null
    }
    expect(
      councilStartResponseSchema.safeParse({
        ok: true,
        run_id: RUN,
        findings: '# Findings',
        findings_path: 'C:\\docs\\brief-Findings.md',
        findings_error: null,
        question_summary: SUMMARY,
        accounting,
        cost_usd: 0.004,
        cost_is_provisional: false
      }).success
    ).toBe(true)
    // The whole point: a total travelling alone does not parse. Everything else
    // it needs is present, so `accounting` is the ONLY reason this fails.
    expect(
      councilStartResponseSchema.safeParse({
        ok: true,
        run_id: RUN,
        findings: '# Findings',
        findings_path: null,
        findings_error: null,
        question_summary: SUMMARY,
        cost_usd: 0.004,
        cost_is_provisional: false
      }).success
    ).toBe(false)
  })

  it('⚠ a NULL findings path travels with the reason it is null', () => {
    const base = {
      ok: true,
      run_id: RUN,
      findings: '# Findings',
      question_summary: SUMMARY,
      accounting: {
        membersPlanned: 3,
        membersAnswered: 3,
        membersRefused: 0,
        turnsAnswered: 6,
        turnsRefused: 0,
        usageReported: 3,
        usageAbsent: 0,
        tokensIn: 10,
        tokensOut: 5,
        tokensCached: null
      },
      cost_usd: 0.001,
      cost_is_provisional: false
    }
    // Written: a path and no error.
    expect(
      councilStartResponseSchema.safeParse({
        ...base,
        findings_path: 'C:\\docs\\brief-Findings.md',
        findings_error: null
      }).success
    ).toBe(true)
    // Not written: no path, and the reason travels with the absence.
    expect(
      councilStartResponseSchema.safeParse({
        ...base,
        findings_path: null,
        findings_error: 'The findings could not be written beside the brief.'
      }).success
    ).toBe(true)
    // Both fields are REQUIRED, so an "ok" response can never be silent about
    // where the file went.
    expect(councilStartResponseSchema.safeParse({ ...base, findings_path: null }).success).toBe(false)
  })

  it('⚠ accepts a NULL cost and NULL token totals — "not reported" is not zero', () => {
    expect(
      councilStartResponseSchema.safeParse({
        ok: true,
        run_id: RUN,
        findings: '# Findings',
        accounting: {
          membersPlanned: 3,
          membersAnswered: 3,
          membersRefused: 0,
          turnsAnswered: 6,
          turnsRefused: 0,
          usageReported: 0,
          usageAbsent: 3,
          tokensIn: null,
          tokensOut: null,
          tokensCached: null
        },
        findings_path: null,
        findings_error: 'The findings could not be written beside the brief.',
        question_summary: SUMMARY,
        cost_usd: null,
        cost_is_provisional: true
      }).success
    ).toBe(true)
  })

  /* ---- the at-a-glance strip (question_summary) -------------------------- */

  it('⚠ question_summary is REQUIRED on an ok response — the glance cannot go silently missing', () => {
    const base = {
      ok: true,
      run_id: RUN,
      findings: '# Findings',
      findings_path: 'C:\\docs\\brief-Findings.md',
      findings_error: null,
      accounting: {
        membersPlanned: 3,
        membersAnswered: 3,
        membersRefused: 0,
        turnsAnswered: 6,
        turnsRefused: 0,
        usageReported: 6,
        usageAbsent: 0,
        tokensIn: 10,
        tokensOut: 5,
        tokensCached: null
      },
      cost_usd: 0.001,
      cost_is_provisional: false
    }
    expect(councilStartResponseSchema.safeParse({ ...base, question_summary: SUMMARY }).success).toBe(
      true
    )
    expect(councilStartResponseSchema.safeParse(base).success).toBe(false)
  })

  it('⚠ D55: a question state cannot travel without the votes and silences it was counted from', () => {
    const full = {
      index: 0,
      question: 'Should orphan runs remain visible?',
      path: 'structural' as const,
      state: 'split' as const,
      votes: [
        { label: 'CR GLM (5.2)', verdict: 'AGREE' as const },
        { label: 'CR Kimi (k3)', verdict: 'DISAGREE' as const }
      ],
      silent: ['CR Qwen (3-coder)']
    }
    expect(councilQuestionSummarySchema.safeParse(full).success).toBe(true)
    // A state with no roster behind it is the bare number D55 forbids.
    const { votes: _votes, ...noVotes } = full
    expect(councilQuestionSummarySchema.safeParse(noVotes).success).toBe(false)
    const { silent: _silent, ...noSilent } = full
    expect(councilQuestionSummarySchema.safeParse(noSilent).success).toBe(false)
  })

  it('⚠ `not-measured` and `model-judged` are first-class values, not absences', () => {
    expect(
      councilQuestionSummarySchema.safeParse({
        index: 3,
        question: 'Q4',
        path: 'model-judged',
        state: 'not-measured',
        // Nothing was countable — and the empty arrays SAY that, rather than the
        // field being omitted and the reader inferring it.
        votes: [],
        silent: ['CR GLM (5.2)', 'CR Kimi (k3)']
      }).success
    ).toBe(true)
  })

  it('rejects an invented state or verdict token — the vocabulary is closed', () => {
    const base = {
      index: 0,
      question: 'Q1',
      path: 'structural',
      state: 'agreed',
      votes: [{ label: 'CR GLM (5.2)', verdict: 'AGREE' }],
      silent: []
    }
    expect(councilQuestionSummarySchema.safeParse(base).success).toBe(true)
    expect(councilQuestionSummarySchema.safeParse({ ...base, state: 'passed' }).success).toBe(false)
    expect(
      councilQuestionSummarySchema.safeParse({ ...base, path: 'human-judged' }).success
    ).toBe(false)
    expect(
      councilQuestionSummarySchema.safeParse({
        ...base,
        votes: [{ label: 'CR GLM (5.2)', verdict: 'ACCEPT' }]
      }).success
    ).toBe(false)
  })

  /* ---- F41: the cost cannot travel without saying whether it settled ----- */

  it('⚠ cost_is_provisional is REQUIRED — a known-low cost cannot look authoritative', () => {
    const base = {
      ok: true,
      run_id: RUN,
      findings: '# Findings',
      findings_path: 'C:\\docs\\brief-Findings.md',
      findings_error: null,
      question_summary: SUMMARY,
      accounting: {
        membersPlanned: 3,
        membersAnswered: 3,
        membersRefused: 0,
        turnsAnswered: 6,
        turnsRefused: 0,
        usageReported: 6,
        usageAbsent: 0,
        tokensIn: 10,
        tokensOut: 5,
        tokensCached: null
      },
      cost_usd: 0.0395
    }
    // ⚠ THE WHOLE POINT: a figure with no settled/provisional marker does not
    // parse. Before F41 the response carried exactly this shape and the number
    // was believed — it was 49% low.
    expect(councilStartResponseSchema.safeParse(base).success).toBe(false)
    expect(
      councilStartResponseSchema.safeParse({ ...base, cost_is_provisional: false }).success
    ).toBe(true)
    expect(
      councilStartResponseSchema.safeParse({ ...base, cost_is_provisional: true }).success
    ).toBe(true)
  })

  it('⚠ a NULL cost still declares its settlement state — "not reported" is not "settled"', () => {
    // A cost that could not be read at all is a different fact from one that
    // settled; both must still say which they are, so neither can be inferred.
    const base = {
      ok: true,
      run_id: RUN,
      findings: '# Findings',
      findings_path: null,
      findings_error: 'The findings could not be written beside the brief.',
      question_summary: SUMMARY,
      accounting: {
        membersPlanned: 3,
        membersAnswered: 3,
        membersRefused: 0,
        turnsAnswered: 6,
        turnsRefused: 0,
        usageReported: 0,
        usageAbsent: 6,
        tokensIn: null,
        tokensOut: null,
        tokensCached: null
      },
      cost_usd: null
    }
    expect(councilStartResponseSchema.safeParse(base).success).toBe(false)
    expect(
      councilStartResponseSchema.safeParse({ ...base, cost_is_provisional: true }).success
    ).toBe(true)
  })

  it('⚠ the summary broadcast carries its run id — a strip cannot be painted by another window’s run', () => {
    expect(
      councilSummaryEventSchema.safeParse({ runId: RUN, questions: SUMMARY }).success
    ).toBe(true)
    // No run id means no way to tell whose run this is, and both broadcasts
    // reach every window.
    expect(councilSummaryEventSchema.safeParse({ questions: SUMMARY }).success).toBe(false)
    expect(
      councilSummaryEventSchema.safeParse({ runId: 'not-a-uuid', questions: SUMMARY }).success
    ).toBe(false)
  })

  it('⚠ the summary channel carries NO model prose — there is nowhere on it to put any', () => {
    // The payload is verdict tokens, labels and the brief's own questions. A
    // `delta` here would be raw stream text arriving on a channel with no scrub
    // seam behind it, so the shape refuses one.
    expect(
      councilSummaryEventSchema.safeParse({ runId: RUN, questions: SUMMARY, delta: 'model text' })
        .success
    ).toBe(false)
  })

  it('the failure arm carries a reason and nothing else', () => {
    expect(councilStartResponseSchema.safeParse({ ok: false, reason: 'No arbiter.' }).success).toBe(true)
    expect(
      councilStartResponseSchema.safeParse({ ok: false, reason: 'No arbiter.', findings: 'x' }).success
    ).toBe(false)
  })

  it('cancel takes a run id and answers what the run was DOING, not a boolean', () => {
    expect(councilCancelRequestSchema.safeParse({ run_id: RUN }).success).toBe(true)
    expect(councilCancelRequestSchema.safeParse({ run_id: 'not-a-uuid' }).success).toBe(false)
    for (const stage of ['deliberating', 'settling', 'unknown']) {
      expect(councilCancelResponseSchema.safeParse({ stage }).success).toBe(true)
    }
    expect(councilCancelResponseSchema.safeParse({ stage: 'finished' }).success).toBe(false)
  })

  it('⚠ the OLD `cancelled` boolean no longer parses — the reply is one field, not two', () => {
    // It was replaced, not widened, and this is the assertion that says so. Two
    // fields would have been exactly `cancelled === (stage === 'deliberating')`:
    // two homes for one fact with no rule about which wins when they disagree.
    //
    // The boolean itself was the defect. `false` was documented as "there was no
    // such live run — a race the user cannot see", and it was returned for the
    // whole settle-and-reconcile tail of every run: seconds during which the
    // deliberation had ended, the `council:start` invoke was still outstanding,
    // and the user was looking at a locked surface that answered a Cancel click
    // with nothing whatsoever.
    expect(councilCancelResponseSchema.safeParse({ cancelled: false }).success).toBe(false)
    expect(
      councilCancelResponseSchema.safeParse({ stage: 'settling', cancelled: false }).success
    ).toBe(false)
  })

  it('⚠ the opened event carries the run id and NOTHING else', () => {
    // It exists to make Cancel reachable, and a run id is the one fact the
    // renderer cannot derive while `council:start` is still in flight. Anything
    // more on it — a brief path, a roster, a cost — would be a second home for
    // something the renderer either already knows or is told properly elsewhere.
    expect(councilOpenedEventSchema.safeParse({ runId: RUN }).success).toBe(true)
    expect(councilOpenedEventSchema.safeParse({ runId: 'not-a-uuid' }).success).toBe(false)
    expect(councilOpenedEventSchema.safeParse({ runId: RUN, brief_path: 'C:\\b.md' }).success).toBe(
      false
    )
  })

  it('the progress event carries the five fields the view needs, and no key material', () => {
    expect(
      councilProgressEventSchema.safeParse({
        runId: RUN,
        phase: 'critique',
        round: 1,
        memberId: MEMBER,
        delta: 'some scrubbed text'
      }).success
    ).toBe(true)
    // memberId is nullable: the synthesis has no member to attribute.
    expect(
      councilProgressEventSchema.safeParse({
        runId: RUN,
        phase: 'synthesis',
        round: 3,
        memberId: null,
        delta: 'x'
      }).success
    ).toBe(true)
  })

  it('the phase vocabulary is exactly the five the core defines', () => {
    for (const phase of ['positions', 'critique', 'arbitration', 'synthesis', 'done']) {
      expect(
        councilProgressEventSchema.safeParse({ runId: RUN, phase, round: 0, memberId: null, delta: '' })
          .success
      ).toBe(true)
    }
    expect(
      councilProgressEventSchema.safeParse({
        runId: RUN,
        phase: 'deliberation',
        round: 0,
        memberId: null,
        delta: ''
      }).success
    ).toBe(false)
  })
})

describe('council:transcript (D97 / Task 3e-4) — the read path, and its bound', () => {
  const RUN = '9ba9b0da-cecd-4960-815d-f36166cf8c00'
  const MEMBER = '3f7c1e2a-9b04-4d5e-8a11-6c2d0e9f4b73'
  const turn = { member_id: MEMBER, phase: 'critique', round: 1, text: 'objection noted' }

  it('the request is a run id and only a run id', () => {
    expect(councilTranscriptRequestSchema.safeParse({ run_id: RUN }).success).toBe(true)
    expect(councilTranscriptRequestSchema.safeParse({ run_id: 'not-a-uuid' }).success).toBe(false)
    expect(councilTranscriptRequestSchema.safeParse({}).success).toBe(false)
    // ⚠ READ-ONLY BY SHAPE. There is no field here that a later edit could grow
    // into a write — no `delete`, no `limit` a caller controls, nothing but the
    // id of the run to read.
    expect(councilTranscriptRequestSchema.safeParse({ run_id: RUN, delete: true }).success).toBe(false)
  })

  it('round-trips a stored run: turns in order, with the count and the cap', () => {
    const res = councilTranscriptResponseSchema.safeParse({
      run_id: RUN,
      turns: [turn],
      total_turns: 1,
      truncated: false,
      chars: turn.text.length,
      cap_chars: 1_000_000
    })
    expect(res.success).toBe(true)
  })

  it('⚠ `total_turns` is REQUIRED — a returned count may never travel without it (D55)', () => {
    expect(
      councilTranscriptResponseSchema.safeParse({
        run_id: RUN,
        turns: [turn],
        truncated: false,
        chars: 1,
        cap_chars: 1_000_000
      }).success
    ).toBe(false)
    // Same for the cap: a `chars` figure alone says nothing about whether it hit
    // a limit, which is exactly the shape D55 forbids.
    expect(
      councilTranscriptResponseSchema.safeParse({
        run_id: RUN,
        turns: [turn],
        total_turns: 1,
        truncated: false,
        chars: 1
      }).success
    ).toBe(false)
  })

  it('a truncated read is a legal, self-describing response — not an error', () => {
    expect(
      councilTranscriptResponseSchema.safeParse({
        run_id: RUN,
        turns: [turn],
        total_turns: 13,
        truncated: true,
        chars: 1_000_000,
        cap_chars: 1_000_000
      }).success
    ).toBe(true)
  })

  it('an empty transcript is a fact, not a failure', () => {
    expect(
      councilTranscriptResponseSchema.safeParse({
        run_id: RUN,
        turns: [],
        total_turns: 0,
        truncated: false,
        chars: 0,
        cap_chars: 1_000_000
      }).success
    ).toBe(true)
  })

  it('⚠ `phase` is a STRING, not the progress enum — history must stay readable', () => {
    // A row written by an earlier build with a phase this one does not know must
    // not make an entire paid run unreadable. The renderer falls back to the raw
    // string; a strict enum here would throw the whole response away.
    expect(
      councilTranscriptTurnSchema.safeParse({ ...turn, phase: 'deliberation' }).success
    ).toBe(true)
    expect(councilTranscriptTurnSchema.safeParse({ ...turn, phase: '' }).success).toBe(false)
  })

  it('⚠ `member_id` is a STRING, not a uuid FK claim — a transcript outlives its member (D62)', () => {
    expect(councilTranscriptTurnSchema.safeParse({ ...turn, member_id: 'deleted-member' }).success).toBe(
      true
    )
    // Nullable: the orchestrator's own framing has no member to attribute.
    expect(councilTranscriptTurnSchema.safeParse({ ...turn, member_id: null }).success).toBe(true)
  })

  it('rejects a turn with an unknown field, so the wire shape cannot drift', () => {
    expect(councilTranscriptTurnSchema.safeParse({ ...turn, tokens_out: 12 }).success).toBe(false)
  })
})

describe('window controls (Task 3c-2 / D74) — the phase\'s ONE IPC exception', () => {
  it('names exactly the four channels the exception allows, and no more', () => {
    expect(IpcChannel.WindowMinimize).toBe('window:minimize')
    expect(IpcChannel.WindowToggleMaximize).toBe('window:toggle-maximize')
    expect(IpcChannel.WindowClose).toBe('window:close')
    expect(IpcChannel.WindowMaximizedChanged).toBe('window:maximized-changed')

    // ⚠ THE BOUND ITSELF, ASSERTED RATHER THAN TRUSTED. Phase-3c-Overview.md
    // fixes the count at 56: a fifth window channel means the scope moved, and
    // this is the cheapest place to find that out.
    //
    // ⚠ THE WINDOW ASSERTION IS THE INVARIANT; THE TOTAL IS THE TRIPWIRE, and
    // only the tripwire moved. 56 -> 57 is Task 3d-2 adding
    // `model:shortlist-set` (D85) — Phase 3d work, which is NOT under Phase
    // 3c's purity contract, so the contract is intact rather than spent. The
    // count is updated DELIBERATELY here, in the one place that would have
    // caught it, rather than being loosened to `toBeGreaterThanOrEqual` — which
    // is what would actually destroy this test, because a fifth window channel
    // would then slip through with the total still "passing".
    //
    // ⚠ 57 -> 58 IS `council:transcript`, AND IT IS THE ONLY CHANNEL PHASE 3e
    // ADDS. D97 declared it in `Phase-3e-Overview.md` BEFORE the phase's first
    // task ran, with the count stated in advance — the same discipline as the
    // 3d-2 raise above. Every other 3e task holds at 58, and the window
    // assertion is untouched, which is the invariant this test is really for.
    //
    // ⚠ 58 -> 59 IS `project:update`, the project-identity work (migration v13:
    // per-project name, colour and description, edited on their own screen).
    // The projects table had no colour or description column and no channel
    // that could write one — `project:add` creates a row from a folder path and
    // `project:select` only persists which row is active — so this could not
    // ride an existing payload the way D80's `sessionCount` did. Raised here,
    // deliberately, in the one place that would have caught it; the window
    // assertion above is still four, which is what this test is really for.
    //
    // ⚠ 59 -> 60 IS `council:summary` — the at-a-glance strip, broadcast once
    // when the positions round closes so the glance lands four phases before the
    // findings do. It could NOT ride `council:progress`: that event fires per
    // text delta, hundreds of times a run, and its `delta` is contractually
    // scrubbed model text. Attaching a summary there would mean either repeating
    // the whole vector on every delta or making a field meaningful on one
    // arbitrary event and empty on the rest. Raised here, deliberately, in the
    // one place that would have caught it; the window assertion above is still
    // four, which is what this test is really for.
    const windowChannels = Object.values(IpcChannel).filter((c) => c.startsWith('window:'))
    expect(windowChannels).toHaveLength(4)
    // 60 → 63 → 64: the Docket's three (D112–D115) plus `council:verdict`
    // (D106), each declared in `ipc.ts` before the code landed. The line below
    // was 60 → 63: the Docket's three, declared in `ipc.ts` before the
    // code landed per D74/D80. This assertion is the tally that actually holds —
    // the prose counts in `ipc.ts` had drifted to "58" because 3c-2's four window
    // channels landed after 3e-4 wrote that line and nobody moved it.
    //
    // ⚠ 64 → 68: Phase 3h's FOUR project-lifecycle channels (D125), declared in
    // `ipc.ts` before the code landed. THIS ASSERTION HAS A TWIN — the one at
    // the foot of this file, in the `cli:detect` block — and moving one without
    // the other ships a green suite with a dead tripwire, which the map's own
    // comment calls worse than no tally.
    //
    // ⚠ 68 → 70 IS THE HOOK LISTENER'S PAIR — `session:activity` (event) and
    // `session:activity-list` (cold read). They are TWO because they answer two
    // different questions: the event reports a CHANGE and the list reports the
    // CURRENT SET, and a renderer that reloads mid-session needs the second or
    // it shows a stale green for an agent that is actually waiting.
    //
    // ⚠ NEITHER RIDES AN EXISTING PAYLOAD, and that was checked rather than
    // assumed. `layout:get`'s session rows were the tempting host — D80's
    // `sessionCount` precedent — but those rows are the sessions TABLE, and
    // activity is in-memory state that is deliberately never persisted. Putting
    // a volatile fact in the durable shape is how the two stop being
    // distinguishable at the call site.
    //
    // ⚠ 70 → 71 IS `council:opened`, AND IT IS A CHANNEL THAT COULD NOT RIDE
    // ANYTHING ELSE EITHER. It answers "this run exists and can now be
    // cancelled", and the two candidates to carry it both fail on TIMING rather
    // than on taste: the `council:start` RESPONSE does not resolve until the
    // deliberation is over, which is ~15 minutes after the answer is needed, and
    // the first `council:progress` delta waits on a member's first token, which
    // for a reasoning model is minutes. Until it existed, `Cancel run` was
    // disabled for the opening minutes of every run over a council that was
    // live, spending, and abortable in main — the surface's only exit was
    // restarting the app. Raised here, deliberately, in the one place that would
    // have caught it; the window assertion above is still four, which is what
    // this test is really for.
    //
    // ⚠ THE TWO RAISES ABOVE LANDED ON SEPARATE BRANCHES AND MET IN A MERGE,
    // which is exactly the case a count tripwire is worst at: both sides were
    // individually green at 70 and 69, and only the sum is right. 71.
    //
    // ⚠ 71 → 82 IS A SUM ACROSS A MERGE, AND IT IS THE SECOND TIME THIS EXACT
    // TRAP HAS BEEN SPRUNG — read the paragraph directly above, which describes
    // the first. Task 6-3's five memory channels and v17's six landed on
    // branches that could not see each other; each side's twin pair was
    // internally consistent (76/76 and 77/77) and BOTH were wrong for the merged
    // map. 71 + 5 + 6 = 82. Neither branch's number survives, and taking either
    // one on faith is how a real channel goes uncounted.
    //
    // ⚠ 71 → 76 IS TASK 6-3'S FIVE MEMORY CHANNELS — `memory:get`,
    // `memory:configure`, `memory:disable`, `memory:status`, `memory:test`.
    // FIVE, NOT SIX: an earlier draft of the task doc said six and the spec's
    // own table lists five, which is the authority. `memory:seed` and
    // `memory:validate` are Task 6-4's and are deliberately ABSENT rather than
    // stubbed — a stub channel is a channel this count has to explain.
    //
    // ⚠ `memory:get` AND `memory:status` ARE TWO CHANNELS ON PURPOSE and the
    // reason is the `model:list` / `model:refresh` split: they answer the same
    // SHAPE for two different callers, and only one of them is safe to call
    // repeatedly. Folding them into one would put a settings-form read and a
    // status-chip poll behind a single handler, which is how the chip ends up
    // calling something that decrypts.
    //
    // ⚠ 76 → 78 IS TASK 6-4's `memory:seed` AND `memory:validate` — the two
    // 6-3 deliberately did NOT stub. `seed` WRITES to the graph and `validate`
    // reads a count; both are clicks, neither belongs on a timer.
    //
    // ⚠ 78 → 86 IS EIGHT CHANNELS FROM THREE UNRELATED GROUPS THAT MET IN ONE
    // MERGE — counted separately here so a later change to one does not read as
    // licence to move the others:
    //
    //   +2 THE PROJECT ATTENTION ROLL-UP — `project:attention` (pushed) and
    //      `project:attention-list` (cold read). TWO, and the split is the same
    //      event/cold-read pairing `session:activity` + `session:activity-list`
    //      already carries, for the same reason: the pushed channel reports only
    //      CHANGES, so a renderer that has just reloaded — or a project sitting
    //      on a session that failed in a PREVIOUS APP RUN, which has never had a
    //      transition in this process at all — needs a read that reports the
    //      present. Folding them into one would mean either polling the push or
    //      starting every reload with the rail dark.
    //
    //   +2 THE CONTEXT RING — `session:context` (event) and
    //      `session:context-list` (cold read). TWO, for the identical reason the
    //      activity pair above is two, and they earn their place by the same
    //      test: `layout:get`'s session rows were again the tempting host and
    //      again the wrong one, because a context reading is main's in-memory
    //      state and is never a column. The rule from the activity note holds —
    //      a volatile fact in the durable shape stops being distinguishable at
    //      the call site.
    //
    //   +4 THE AGENT LOCK — `session:set-locked`, plus `agent-lock:pin-status` /
    //      `pin-set` / `pin-clear`. The toggle could not ride `session:set-title`
    //      or any other session mutation: it CARRIES A SECRET on the unlock path
    //      and must be write-only inbound (D33 clause 3), and folding that into
    //      a general-purpose session patch is how a PIN ends up in a payload
    //      that something later decides to log. The three PIN channels are a
    //      status/set/clear triad on the `credential:*` model — and there is
    //      deliberately NO pin-get, which is the whole posture: the digest has
    //      no read path, so the fourth channel that would complete a CRUD set
    //      must never exist.
    //
    // ⚠ AND 86 IS ITSELF A SUM RE-COUNTED AT THE MERGE, FOR THE FOURTH TIME —
    // THREE BRANCHES IN FLIGHT AT ONCE THIS ROUND, NOT TWO. Task 6-4 raised
    // this to 78, v17 raised it to 84, and the attention roll-up raised it to
    // 80, each on a branch that could not see the others. 71 + 5 + 2 + 6 + 2 =
    // 86 and NOT ONE of the three branches carried the right number.
    //
    // The rule below is not advice — it is the only procedure that has ever
    // produced the correct value here: re-count `IpcChannel` after the merge,
    // never add your own delta to whatever the file said when you branched.
    // Note the shape of the failure, because it is what makes it invisible:
    // every branch was internally consistent and green on its own, and the
    // count is the one fact in this file that no single branch can know.
    //
    // ⚠ 104 → 107 IS TASK 5-4'S THREE VOICE-SETTINGS CHANNELS —
    // `voice:settings-get`, `voice:settings-set`, `voice:model-status`.
    // RE-COUNTED from the merged tree with the AST, not deltaed from 104.
    // All three are invoke-shaped, so the three-category identity moves on the
    // handle column only:
    //
    //     107 = 94 ipcMain.handle(  +  12 main→renderer events  +  1 send
    //
    // measured against this tree with the AST after the handlers were added.
    //
    // ⚠ 107 → 108 IS TASK 6b-1'S ONE `session:memory` CHANNEL, re-counted from
    // the merged tree with the AST rather than added to 107. It is an EVENT
    // (main→renderer), so the three-category identity moves on the event
    // column only:
    //
    //     108 = 94 ipcMain.handle(  +  13 main→renderer events  +  1 send
    //
    // There is deliberately NO `session:memory-list` cold read — see the
    // channel's own note in ipc.ts.
    //
    // ⚠ 101 → 104 IS TASK 5-3'S THREE ACTIVATION/TARGET CHANNELS —
    // `voice:target-set`, `voice:target`, `voice:hotkey-status`. RE-COUNTED
    // from the merged tree with the AST, not deltaed from 101.
    //
    // ⚠ 97 → 101 IS TASK 5-1'S FOUR VOICE CHANNELS — `voice:capture-start`,
    // `voice:capture-frame`, `voice:capture-stop`, `voice:state`. RE-COUNTED
    // from the merged tree with the AST, not deltaed from 97.
    //
    // ⚠ AND 101 IS THE FIRST VALUE OF THIS COUNT THAT IS NOT `handle() +
    // events`. `voice:capture-frame` is renderer→main and SEND-shaped, so it is
    // never handled. The reconciliation is now three-category:
    //
    //     101 = 89 ipcMain.handle(  +  11 main→renderer events  +  1 send
    //
    // All three numbers were measured against this tree, and the sum closes
    // exactly. It is written here because the two-category identity held for 97
    // channels and the next person to check it would find it off by one with no
    // explanation in the file. The `voice:capture-frame` definition in `ipc.ts`
    // carries the same note at the source.
    //
    // ⚠ 110 → 111 (D181): `voice:overlay-move`, the SECOND send-shaped
    // renderer→main channel, so the third category is now 2 and the
    // reconciliation reads 111 = 89 handle( + 11 events + 2 sends.
    //
    // ⚠ 111 → 113, BY TWO CHANNELS THAT LANDED IN PARALLEL AND BOTH WROTE
    // "111 → 112" IN THIS FILE. Recorded together because the merge is
    // exactly where one of them would otherwise have lost its reason:
    //
    //  · D190 `session:prompts` — the prompt-recall read. HANDLE-shaped (it
    //    answers with a value), so it lands in the first category.
    //  · D182 `fleet:snapshot` — who is reachable and each pane's current
    //    peer address. A main→renderer EVENT, pushed on change.
    //
    // The window invariant above is untouched — still exactly four window
    // channels — and this line remains the tripwire it was built to be
    // rather than the thing under test.
    expect(Object.keys(IpcChannel)).toHaveLength(113)
  })

  /* Task 6b-1: asserted by NAME as well as by count — a count alone stays
     green through a rename, which is precisely the drift the tally exists to
     catch (the D125 rule directly below). */
  it('carries the one session:memory channel Task 6b-1 declared — and no cold-read twin', () => {
    expect(IpcChannel.SessionMemory).toBe('session:memory')
    // ⚠ The ABSENCE is the decision (see the channel's note): a missing memory
    // counter is not wrong, it is absent, and its durable answer is on the row.
    expect(Object.values(IpcChannel)).not.toContain('session:memory-list')
  })

  /* D190: asserted by NAME as well as by count, on the 6b-1 reasoning — a
     count alone stays green through a rename. */
  it('carries the one session:prompts channel D190 declared', () => {
    expect(IpcChannel.SessionPrompts).toBe('session:prompts')
    // No cold-read twin and no event, and the ABSENCE is the decision: the
    // history lives in main memory, so an open modal is always reading the
    // current value and a push would only duplicate it.
    expect(Object.values(IpcChannel)).not.toContain('session:prompts-list')
    expect(Object.values(IpcChannel)).not.toContain('session:prompt')
  })

  /* Task 6b-2 (D169): the launch-time reachability event, asserted by NAME for
     the same reason its 6b-1 sibling is — a count alone stays green through a
     rename. */
  it('carries the one memory:launch channel Task 6b-2 declared', () => {
    expect(IpcChannel.MemoryLaunch).toBe('memory:launch')
    // ⚠ IT IS NOT A FIELD ON `memory:status`, AND MUST NOT BECOME ONE.
    // `memory:status` is a pollable pure read of storage; this is a live
    // observation with main-memory lifetime. Folding it in would also mean the
    // user only learns the graph was down if they happen to open Project
    // Settings — which is F90 exactly.
    expect(IpcChannel.MemoryStatus).toBe('memory:status')
    // No cold-read twin, on 6b-1's reasoning: a launch that happened before this
    // renderer existed is not one this window can honestly report on.
    expect(Object.values(IpcChannel)).not.toContain('memory:launch-list')
  })

  /* D125: declared before the code, and asserted by NAME as well as by count.
     A count alone would stay green if a later task renamed one of the four —
     which is precisely the drift the tally exists to catch. */
  it('carries exactly the four project-lifecycle channels D125 declared', () => {
    // ⚠ THE ATTENTION PAIR IS EXCLUDED HERE, NOT ADDED TO THE LIFECYCLE FOUR,
    // and the exclusion is the honest classification rather than a way to keep
    // this test green. D125's four are LIFECYCLE — they create, destroy and
    // reorder the project row itself. `project:attention` and its cold read
    // never touch that row: they report a derivation of SESSION state that
    // happens to be grouped by project, and they are the `session:activity`
    // family's siblings in everything but their prefix. Folding them into the
    // lifecycle tally would make this assertion mean "channels that start with
    // `project:`", which is the string check it was written to be more than.
    const rollup = ['project:attention', 'project:attention-list']
    const lifecycle = Object.values(IpcChannel).filter(
      (c) => c.startsWith('project:') && c !== 'project:add' && c !== 'project:list' &&
        c !== 'project:select' && c !== 'project:update' && !rollup.includes(c)
    )
    expect(lifecycle.sort()).toEqual([
      'project:delete',
      'project:impact',
      'project:reorder',
      'project:set-status'
    ])
    expect(new Set(lifecycle).size).toBe(4)
    // And the whole `project:` family is those four plus the four that existed
    // before, plus the attention pair — ten, and no fifth lifecycle channel
    // snuck in beside them.
    expect(Object.values(IpcChannel).filter((c) => c.startsWith('project:'))).toHaveLength(10)
  })

  it('every channel string in the map is still unique', () => {
    const values = Object.values(IpcChannel)
    expect(new Set(values).size).toBe(values.length)
  })

  it('carries the maximized flag as a plain boolean, in both directions', () => {
    // Toggle's RESULT and the event's BODY are the same shape on purpose —
    // one fact, one schema, so the two cannot drift apart.
    expect(windowMaximizedSchema.safeParse({ maximized: true }).success).toBe(true)
    expect(windowMaximizedSchema.safeParse({ maximized: false }).success).toBe(true)
    expect(windowMaximizedSchema.parse({ maximized: true })).toEqual({ maximized: true })
  })

  it('rejects a missing, wrongly-typed, or coercible flag', () => {
    expect(windowMaximizedSchema.safeParse({}).success).toBe(false)
    // ⚠ No coercion: 'true' and 1 are the shapes a sloppy caller sends, and a
    // string that parsed would make the restore icon depend on truthiness.
    expect(windowMaximizedSchema.safeParse({ maximized: 'true' }).success).toBe(false)
    expect(windowMaximizedSchema.safeParse({ maximized: 1 }).success).toBe(false)
    expect(windowMaximizedSchema.safeParse({ maximized: null }).success).toBe(false)
    expect(windowMaximizedSchema.safeParse(null).success).toBe(false)
  })

  it('is .strict() — an unknown key fails loudly rather than being stripped (F-5b)', () => {
    expect(windowMaximizedSchema.safeParse({ maximized: true, bounds: { x: 0 } }).success).toBe(
      false
    )
  })
})

/* ================================================================== *\
 * The Docket — council:docket / :findings / :forget-run (D112–D115)   *
\* ================================================================== */

describe('the Docket channels', () => {
  it('are present and every channel string in the map is still unique', () => {
    expect(IpcChannel.CouncilDocket).toBe('council:docket')
    expect(IpcChannel.CouncilFindings).toBe('council:findings')
    expect(IpcChannel.CouncilForgetRun).toBe('council:forget-run')
    const values = Object.values(IpcChannel)
    expect(new Set(values).size).toBe(values.length)
  })
})

describe('councilDocketRunSchema — the row that refuses to invent numbers', () => {
  const RUN = 'c06874ad-1eb3-4d7c-8aa3-832bd19dfd13'

  const row = {
    run_id: RUN,
    label: 'CouncilCase-3f.0-Exhibits.md',
    brief_path: 'C:\\Projects\\Chorus\\docs\\CouncilCase-3f.0-Exhibits.md',
    status: 'complete',
    started_at: '2026-08-01T10:00:00.000Z',
    ended_at: '2026-08-01T10:21:04.000Z',
    duration_ms: 1_264_000,
    turns: 48,
    tokens_in: 190_000,
    tokens_out: 24_000,
    tokens_are_partial: false,
    turns_with_tokens: 48,
    cost_floor_usd: 1.089,
    has_findings: true,
    verdict_digest: '1 revise · 2 approved · 3 of 3 ruled'
  }

  it('accepts a complete row', () => {
    expect(councilDocketRunSchema.safeParse(row).success).toBe(true)
  })

  /* ---- D76: absent must be expressible, and must not become zero -------- */

  it('⚠ accepts NULL tokens, duration and cost — a run that reported none', () => {
    // The states this has to carry: a crash with no `ended_at`, a provider that
    // returned no usage, a run that never recorded a cost. None of them are zero.
    const absent = {
      ...row,
      ended_at: null,
      duration_ms: null,
      tokens_in: null,
      tokens_out: null,
      cost_floor_usd: null,
      has_findings: false
    }
    expect(councilDocketRunSchema.safeParse(absent).success).toBe(true)
  })

  it('⚠ requires the nullable fields to be PRESENT — an omitted key is not an absence', () => {
    // Without this, a handler that forgot to set `tokens_in` would produce
    // `undefined`, which renders as nothing and is indistinguishable from an
    // honest null. The difference is whether main looked.
    const { tokens_in: _omitted, ...missing } = row
    expect(councilDocketRunSchema.safeParse(missing).success).toBe(false)
  })

  it('rejects a negative duration or cost', () => {
    expect(councilDocketRunSchema.safeParse({ ...row, duration_ms: -1 }).success).toBe(false)
    expect(councilDocketRunSchema.safeParse({ ...row, cost_floor_usd: -0.5 }).success).toBe(false)
  })

  it('rejects a fractional turn count', () => {
    expect(councilDocketRunSchema.safeParse({ ...row, turns: 1.5 }).success).toBe(false)
  })

  /* ---- history is not constrained by today's vocabulary ---------------- */

  it('⚠ takes `status` as a free string, so one unknown stored value cannot kill a Docket', () => {
    // `councilTranscriptTurnSchema`'s reasoning for `phase`, with more force: these
    // rows were written by whatever build was running at the time. A strict enum
    // would make an entire project's history unreadable to protect a label.
    expect(councilDocketRunSchema.safeParse({ ...row, status: 'abandoned' }).success).toBe(true)
    expect(councilDocketRunSchema.safeParse({ ...row, status: 'some-future-state' }).success).toBe(
      true
    )
  })

  it('is .strict()', () => {
    expect(councilDocketRunSchema.safeParse({ ...row, case_id: RUN }).success).toBe(false)
  })

  it('the response carries an array, and an empty history is valid', () => {
    expect(councilDocketResponseSchema.safeParse({ runs: [] }).success).toBe(true)
    expect(councilDocketResponseSchema.safeParse({ runs: [row] }).success).toBe(true)
  })

  it('the request takes a project id and nothing else', () => {
    expect(councilDocketRequestSchema.safeParse({ project_id: RUN }).success).toBe(true)
    expect(councilDocketRequestSchema.safeParse({ project_id: 'not-a-uuid' }).success).toBe(false)
    // ⚠ No path, no case id, no filter. `project_id` is the only key there is.
    expect(
      councilDocketRequestSchema.safeParse({ project_id: RUN, brief_path: 'x.md' }).success
    ).toBe(false)
  })
})

describe('councilFindingsResponseSchema — an absent document is a response, not a throw', () => {
  const RUN = 'c06874ad-1eb3-4d7c-8aa3-832bd19dfd13'

  it('carries the text when the document was read', () => {
    const ok = { run_id: RUN, path: 'C:\\docs\\x-Findings.md', text: '# Findings', reason: null }
    expect(councilFindingsResponseSchema.safeParse(ok).success).toBe(true)
  })

  it('⚠ keeps the PATH beside the reason when the file is gone', () => {
    // "We looked and found nothing" is only actionable if it says where. A branch
    // switch or a rename is the ordinary case, not an exceptional one.
    const gone = {
      run_id: RUN,
      path: 'C:\\docs\\x-Findings.md',
      text: null,
      reason: 'That findings document is no longer at the path this run recorded.'
    }
    expect(councilFindingsResponseSchema.safeParse(gone).success).toBe(true)
  })

  it('carries a null path for a run that never recorded one', () => {
    const never = { run_id: RUN, path: null, text: null, reason: 'This run wrote no findings.' }
    expect(councilFindingsResponseSchema.safeParse(never).success).toBe(true)
  })

  it('is .strict() and requires every field to be stated', () => {
    expect(
      councilFindingsResponseSchema.safeParse({ run_id: RUN, path: null, text: null }).success
    ).toBe(false)
  })
})

describe('councilForgetRunResponseSchema — D109 reports what it purged', () => {
  const RUN = 'c06874ad-1eb3-4d7c-8aa3-832bd19dfd13'

  it('reports the run and its turn count', () => {
    expect(councilForgetRunResponseSchema.safeParse({ forgot: true, turns: 16 }).success).toBe(true)
  })

  it('⚠ expresses "there was no such run" without it being an error', () => {
    // A double-click, or a second window that got there first. `council:cancel`'s
    // existing precedent: a race the user cannot see is not a failure to report.
    expect(councilForgetRunResponseSchema.safeParse({ forgot: false, turns: 0 }).success).toBe(true)
  })

  it('the request takes a run id — ⚠ no path is reachable from this channel', () => {
    expect(councilForgetRunRequestSchema.safeParse({ run_id: RUN }).success).toBe(true)
    expect(
      councilForgetRunRequestSchema.safeParse({ run_id: RUN, findings_path: 'C:\\x.md' }).success
    ).toBe(false)
  })
})

/* ================================================================== *\
 * The Verdict strip — council:verdict (D106)                         *
\* ================================================================== */

describe('councilVerdictRowSchema — two facts, two sources, neither faked', () => {
  const consensus = {
    index: 0,
    question: 'Should orphan runs stay visible?',
    path: 'structural' as const,
    state: 'split' as const,
    votes: [
      { label: 'Kimi', verdict: 'AGREE' as const },
      { label: 'GLM', verdict: 'DISAGREE' as const }
    ],
    silent: ['Qwen']
  }
  const row = { index: 0, question: 'Should orphan runs stay visible?', consensus, verdict: 'APPROVED' }

  it('accepts a ruled question', () => {
    expect(councilVerdictRowSchema.safeParse(row).success).toBe(true)
  })

  it('⚠ carries the members SPLITTING while the arbiter APPROVED', () => {
    // The case the two-field shape exists to express. A single reconciled state
    // could not say this, and it is the most informative thing a council reports.
    const parsed = councilVerdictRowSchema.parse(row)
    expect(parsed.consensus.state).toBe('split')
    expect(parsed.verdict).toBe('APPROVED')
  })

  it('⚠ accepts `unparsed` — asked, and this question got no ruling', () => {
    expect(councilVerdictRowSchema.safeParse({ ...row, verdict: 'unparsed' }).success).toBe(true)
  })

  it('⚠ accepts NULL — never asked, which is every run predating D106', () => {
    expect(councilVerdictRowSchema.safeParse({ ...row, verdict: null }).success).toBe(true)
  })

  it('⚠ refuses a sixth verdict value, unlike the free-string status beside it', () => {
    // `status` and `phase` are free strings because they are history written by
    // older builds. This one is produced by a parser in THIS build that already
    // refuses anything outside the vocabulary, so a stray value here is a bug.
    expect(councilVerdictRowSchema.safeParse({ ...row, verdict: 'PROBABLY-FINE' }).success).toBe(
      false
    )
    expect(councilVerdictRowSchema.safeParse({ ...row, verdict: 'AGREE' }).success).toBe(false)
  })

  it('covers the whole five-state vocabulary and nothing else', () => {
    for (const v of [
      'APPROVED',
      'APPROVED-WITH-REVISIONS',
      'REVISE',
      'REJECTED',
      'INSUFFICIENT-INFORMATION'
    ]) {
      expect(councilArbiterVerdictSchema.safeParse(v).success).toBe(true)
    }
    expect(councilArbiterVerdictSchema.options).toHaveLength(5)
  })

  it('is .strict()', () => {
    expect(councilVerdictRowSchema.safeParse({ ...row, cost: 1 }).success).toBe(false)
  })
})

describe('councilVerdictResponseSchema — the strip carries its own denominator', () => {
  const RUN = 'c06874ad-1eb3-4d7c-8aa3-832bd19dfd13'
  const base = { run_id: RUN, rows: [], ruled: 0, total: 0, arbiter_asked: false, reason: null }

  it('⚠ requires `ruled` AND `total` — D106 forbids a bare count', () => {
    expect(councilVerdictResponseSchema.safeParse({ ...base, ruled: 4, total: 6 }).success).toBe(
      true
    )
    const { total: _dropped, ...noDenominator } = base
    expect(councilVerdictResponseSchema.safeParse(noDenominator).success).toBe(false)
  })

  it('⚠ distinguishes "never asked" from "asked and silent" on its own field', () => {
    // arbiter_asked:false with ruled:0 is a run predating D106.
    // arbiter_asked:true with ruled:0 is an arbiter that ignored the instruction.
    expect(
      councilVerdictResponseSchema.safeParse({ ...base, arbiter_asked: false, ruled: 0 }).success
    ).toBe(true)
    expect(
      councilVerdictResponseSchema.safeParse({ ...base, arbiter_asked: true, ruled: 0 }).success
    ).toBe(true)
  })

  it('carries a reason for a strip that could not be built at all', () => {
    const gone = { ...base, reason: 'That brief could not be read.' }
    expect(councilVerdictResponseSchema.safeParse(gone).success).toBe(true)
  })

  it('the request takes a run id and nothing else', () => {
    expect(councilVerdictRequestSchema.safeParse({ run_id: RUN }).success).toBe(true)
    expect(councilVerdictRequestSchema.safeParse({ run_id: RUN, brief: 'x.md' }).success).toBe(false)
  })
})

describe('cliDetectRequestSchema — the refresh flag (CLI staleness)', () => {
  it('accepts the empty request every existing caller already sends', () => {
    expect(cliDetectRequestSchema.safeParse({}).success).toBe(true)
    expect(cliDetectRequestSchema.parse({}).refresh).toBeUndefined()
  })

  it('accepts an explicit refresh', () => {
    expect(cliDetectRequestSchema.parse({ refresh: true }).refresh).toBe(true)
    expect(cliDetectRequestSchema.parse({ refresh: false }).refresh).toBe(false)
  })

  it('⚠ takes no tool name, path or flag — it widens WHEN, never WHAT', () => {
    // The probe is a fixed `where.exe` + `--version` over a hardcoded tool list.
    // A field here naming a command would turn a cache-control flag into an
    // arbitrary-execution primitive.
    expect(cliDetectRequestSchema.safeParse({ refresh: true, tool: 'claude' }).success).toBe(false)
    expect(cliDetectRequestSchema.safeParse({ command: 'calc.exe' }).success).toBe(false)
  })

  it('rejects a coercible flag rather than treating truthiness as intent', () => {
    expect(cliDetectRequestSchema.safeParse({ refresh: 'true' }).success).toBe(false)
    expect(cliDetectRequestSchema.safeParse({ refresh: 1 }).success).toBe(false)
  })

  it('⚠ adds no channel — the count still holds at 86', () => {
    // A `cli:redetect` sibling would have taken the map to 65 to express a
    // boolean, with an identical response and an identical handler.
    //
    // ⚠ THE SECOND OF THE TWO TRIPWIRES. Its twin is in the `IpcChannel`
    // describe block far above; both were 64 and both moved to 68 together for
    // Phase 3h's D125 exception, then to 70 together for the hook listener's
    // `session:activity` + `session:activity-list`, then to 71 together for
    // `council:opened` (the reasoning for all of them is written out at the
    // twin, which is the one place it belongs), then to 76 together for Task
    // 6-3's five `memory:*` channels, then to 78 for Task 6-4's `memory:seed` +
    // `memory:validate`, and now to 86 for v17's context-ring pair, the
    // agent-lock four and the project attention roll-up's pair — three groups
    // that arrived in one merge. If you are here to change one number, change
    // the other in the same commit — one at 86 and one at 78 is a failed gate,
    // not a rounding error.
    //
    // ⚠ 71 WAS A SUM, NOT A RAISE. The activity pair and `council:opened` were
    // built on separate branches and met in a merge: each side's twin pair was
    // internally consistent (70/70 and 69/69) and both were WRONG for the merged
    // map. A count tripwire cannot catch that on either branch — only here.
    //
    // ⚠ AND IT HAPPENED AGAIN AT 86, WITH THREE BRANCHES AT ONCE — see the
    // twin. Task 6-4, v17 and the attention roll-up each raised this on a
    // branch that could not see the other two, landing at 78, 84 and 80; the
    // merged map is 86 and not one of the three numbers was right. Three times
    // is not bad luck: this number is a SUM over every branch in flight, and
    // the only safe way to move it is to re-count after the merge rather than
    // to add your own delta to whatever the file said before you branched.
    //
    // ⚠ THE NOTES ABOVE ARE KEPT RATHER THAN TRIMMED AS HISTORY, because the
    // recurrence is the finding. Each occurrence was written up by a branch
    // that believed it was recording a one-off.
    //
    // ⚠ 97 → 101: Task 5-1's four `voice:*` channels, re-counted from the merged
    // tree rather than added to 97. See the twin above for the three-category
    // reconciliation this task introduces — `voice:capture-frame` is the app's
    // first send-shaped renderer→main channel, so `handles + events` no longer
    // equals the total on its own.
    //
    // ⚠ 104 → 107: Task 5-4's three `voice:settings-*` / `voice:model-status`
    // channels, re-counted from the merged tree with the AST.
    //
    // ⚠ 107 → 108: Task 6b-1's one `session:memory` channel, re-counted from
    // the merged tree with the AST. No cold-read twin, by decision.
    //
    // ⚠ 109 → 110: Task 6b-3's one `memory:freshness` channel. 6b-2 added
    // `memory:launch` (108 → 109) and 6b-3 adds ONE — its `started` /
    // `waited_ms` facts ride 6b-2's existing event rather than a second one.
    //
    // ⚠ 110 → 111: D181's one `voice:overlay-move` channel — the dictation
    // overlay's drag, send-shaped like `voice:capture-frame` and for the same
    // reasons.
    //
    // ⚠ 111 → 113: two channels, landed in parallel on separate branches.
    //
    // D190's `session:prompts` — the prompt-recall read. No cold-read twin
    // and no event: main owns the ring, so the modal reads it fresh each time
    // it opens and there is nothing to push.
    //
    // D182's `fleet:snapshot` — who is reachable and each pane's current peer
    // address, pushed on change and deduplicated in main like
    // `project:attention`. ONE channel, not two, and deliberately NO
    // cold-read sibling: a renderer that has not yet heard from the poll must
    // render `unknown` rather than anything remembered, so a cold read would
    // have nothing honest to return and would invite a caller to cache it.
    expect(Object.keys(IpcChannel)).toHaveLength(113)
  })
})

/* ------------------------------------------------------------------ */
/* Phase 6 / Task 6-3: the memory channels                             */
/* ------------------------------------------------------------------ */

describe('memory:* schemas (Task 6-3)', () => {
  const MPID = '33333333-3333-4333-8333-333333333333'

  const status = {
    configured: true,
    mode: 'existing' as const,
    auth_mode: 'none' as const,
    host: '127.0.0.1',
    port: 7688,
    database_name: 'neo4j',
    schema_version: 0,
    last_seeded_at: null,
    updated_at: '2026-08-08T00:00:00.000Z'
  }

  it('memoryStatusSchema parses the full shape', () => {
    expect(memoryStatusSchema.safeParse(status).success).toBe(true)
  })

  /**
   * ⚠ THE KEY-SET ASSERTION (the 3-2 discipline), and the single most important
   * test in this task. Asserted over the PARSE OUTPUT's full key set rather than
   * by spot-checking: a future field capable of carrying key material has to
   * break this test to get in. `project_memory` has no password column, but this
   * is what stops one arriving on the WIRE — including by way of a bolt URI,
   * which is a string that can embed `user:pass@`.
   */
  it('carries host and port and NOTHING capable of holding a key — not even a URI', () => {
    const keys = Object.keys(memoryStatusSchema.parse(status)).sort()
    expect(keys).toEqual(
      [
        'auth_mode',
        'configured',
        'database_name',
        'host',
        'last_seeded_at',
        'mode',
        'port',
        'schema_version',
        'updated_at'
      ].sort()
    )
    for (const k of keys) {
      expect(k).not.toMatch(/key|secret|token|blob|fingerprint|password|value/i)
    }
    // ⚠ AND THE EXTRA ARM THIS PAYLOAD NEEDS THAT A LAUNCH PROFILE DOES NOT.
    // A bolt URI is the one string in this design that can carry a credential
    // inline, so `uri` is barred by name as well as by the loop above.
    for (const k of keys) {
      expect(k).not.toMatch(/uri|url|dsn|connection_string/i)
    }
  })

  it('is strict — an extra field is a parse failure, not a silent passenger', () => {
    expect(memoryStatusSchema.safeParse({ ...status, bolt_uri: 'bolt://h:7687' }).success).toBe(
      false
    )
    expect(memoryStatusSchema.safeParse({ ...status, password: 'x' }).success).toBe(false)
    expect(memoryStatusSchema.safeParse({ ...status, credential_profile_id: MPID }).success).toBe(
      false
    )
  })

  it('refuses the smuggled shapes by name', () => {
    for (const smuggled of [
      { bolt_uri: 'bolt://neo4j:pw@127.0.0.1:7687' },
      { password: 'hunter2' },
      { auth_value: 'hunter2' },
      { encrypted_blob: 'AAAA' },
      { key: 'sk-or-v1-' + 'x'.repeat(40) }
    ]) {
      expect(memoryStatusSchema.safeParse({ ...status, ...smuggled }).success).toBe(false)
    }
  })

  it('an UNCONFIGURED project is a real answer with nulls, not an absent one', () => {
    const none = {
      configured: false,
      mode: null,
      auth_mode: null,
      host: null,
      port: null,
      database_name: null,
      schema_version: 0,
      last_seeded_at: null,
      updated_at: null
    }
    expect(memoryStatusSchema.safeParse(none).success).toBe(true)
    // required-nullable: omitting a field fails loudly rather than defaulting.
    const { host: _drop, ...missing } = none
    expect(memoryStatusSchema.safeParse(missing).success).toBe(false)
  })

  it('has no last_tested_at / last_test_ok — Connected is EARNED, never stored', () => {
    // D126: `Connected` comes from an OBSERVED read, never from a written file
    // or a persisted flag. A stored flag would claim connectivity the app has
    // not seen since it started.
    expect(memoryStatusSchema.safeParse({ ...status, last_tested_at: 'x' }).success).toBe(false)
    expect(memoryStatusSchema.safeParse({ ...status, last_test_ok: true }).success).toBe(false)
  })

  it('port is a positive integer or null — never 0', () => {
    expect(memoryStatusSchema.safeParse({ ...status, port: 0 }).success).toBe(false)
    expect(memoryStatusSchema.safeParse({ ...status, port: -1 }).success).toBe(false)
    expect(memoryStatusSchema.safeParse({ ...status, port: 7687.5 }).success).toBe(false)
    expect(memoryStatusSchema.safeParse({ ...status, port: null }).success).toBe(true)
  })

  it('admits the FULL mode vocabulary — the refusal is authored in the service', () => {
    // A one-value enum would refuse `local-docker` with a Zod parse failure,
    // which is a stack trace where a sentence belongs — and would have to be
    // widened at Stage 5 anyway. `resolveLaunchProfile`'s precedent.
    for (const mode of ['local-docker', 'existing', 'aura']) {
      expect(memoryModeSchema.safeParse(mode).success).toBe(true)
    }
    expect(memoryModeSchema.safeParse('sqlite').success).toBe(false)
    for (const am of ['none', 'credential']) {
      expect(memoryAuthModeSchema.safeParse(am).success).toBe(true)
    }
    expect(memoryAuthModeSchema.safeParse('basic').success).toBe(false)
  })

  it('configure takes a bounded uri string and the full vocabulary', () => {
    const req = {
      project_id: MPID,
      mode: 'existing',
      auth_mode: 'none',
      bolt_uri: 'bolt://127.0.0.1:7688',
      database_name: 'neo4j'
    }
    expect(memoryConfigureRequestSchema.safeParse(req).success).toBe(true)
    // Unbounded strings do not cross this bridge.
    expect(
      memoryConfigureRequestSchema.safeParse({ ...req, bolt_uri: 'b'.repeat(513) }).success
    ).toBe(false)
    // ⚠ AND ZOD DOES NOT REFUSE INLINE CREDENTIALS — `memoryConfigCore` does,
    // with a reason a user can act on. This assertion records that division of
    // labour so nobody reads the boundary as the guard.
    expect(
      memoryConfigureRequestSchema.safeParse({ ...req, bolt_uri: 'bolt://u:p@h:7687' }).success
    ).toBe(true)
  })

  it('configure never admits a credential KEY — an id at most (D33 clause 2)', () => {
    const parsed = memoryConfigureRequestSchema.parse({
      project_id: MPID,
      mode: 'existing',
      auth_mode: 'none',
      bolt_uri: 'bolt://127.0.0.1:7688',
      database_name: 'neo4j'
    })
    for (const k of Object.keys(parsed)) {
      expect(k).not.toMatch(/key|secret|token|password|blob/i)
    }
  })

  it('every response is an ok/reason union — refusals are never thrown', () => {
    expect(memoryConfigureResponseSchema.safeParse({ ok: false, reason: 'r' }).success).toBe(true)
    expect(memoryConfigureResponseSchema.safeParse({ ok: true, memory: status }).success).toBe(true)
    expect(memoryDisableResponseSchema.safeParse({ ok: true, removed: false }).success).toBe(true)
    expect(memoryDisableResponseSchema.safeParse({ ok: false, reason: 'r' }).success).toBe(true)
    expect(memoryTestResponseSchema.safeParse({ ok: false, reason: 'r' }).success).toBe(true)
  })

  it('memory:test carries the VALUE the database returned, not a bare ok', () => {
    // A bare {ok:true} would be indistinguishable from a handshake that
    // succeeded against a database the app cannot read — which the 6-1 D4 pass
    // measured happening on every failing row of its connect matrix.
    expect(memoryTestResponseSchema.safeParse({ ok: true, probe: 1 }).success).toBe(true)
    expect(memoryTestResponseSchema.safeParse({ ok: true }).success).toBe(false)
  })

  it('every memory request is keyed by a uuid project id', () => {
    for (const schema of [
      memoryGetRequestSchema,
      memoryStatusRequestSchema,
      memoryDisableRequestSchema,
      memoryTestRequestSchema
    ]) {
      expect(schema.safeParse({ project_id: MPID }).success).toBe(true)
      expect(schema.safeParse({ project_id: 'not-a-uuid' }).success).toBe(false)
    }
  })

  it('the memory channels are NAMED, not merely counted', () => {
    // A count alone would stay green if a later task renamed one — the D125
    // discipline, applied to this phase's own group. Five landed in 6-3; 6-4
    // added the two it had deliberately left out rather than stubbed; 6a-2
    // added `memory:index`, the eighth; 6a-4's provisioner added five, for 13;
    // 6b-2 added `memory:launch`, the fourteenth — and the ONLY event in this
    // group, every other one being an invoke; 6b-3 added `memory:freshness`,
    // the fifteenth, an invoke like all the rest.
    const memoryChannels = Object.values(IpcChannel)
      .filter((c) => c.startsWith('memory:'))
      .sort()
    expect(memoryChannels).toEqual([
      'memory:configure',
      'memory:container-remove',
      'memory:container-start',
      'memory:container-status',
      'memory:container-stop',
      'memory:disable',
      'memory:freshness',
      'memory:get',
      'memory:index',
      'memory:launch',
      'memory:provision',
      'memory:seed',
      'memory:status',
      'memory:test',
      'memory:validate'
    ])
  })

  it('⚠ the five lifecycle channels are SEPARATE, not one action-carrying channel', () => {
    // An `{action: 'start'|'stop'|'remove'}` field would put the typed
    // confirmation behind a branch of a shared handler — a guard inside an if
    // is precisely the shape that gets walked past. Only ONE of these carries a
    // confirmation, and it is the only one whose request schema is not just a
    // project id.
    expect(memoryContainerRequestSchema.safeParse({ project_id: MPID }).success).toBe(true)
    expect(
      memoryContainerRemoveRequestSchema.safeParse({ project_id: MPID }).success
    ).toBe(false)
    expect(
      memoryContainerRemoveRequestSchema.safeParse({ project_id: MPID, typed_name: 'chorus-x' })
        .success
    ).toBe(true)
    // An empty typed name is not a confirmation.
    expect(
      memoryContainerRemoveRequestSchema.safeParse({ project_id: MPID, typed_name: '' }).success
    ).toBe(false)
  })

  /* ─────────────────── Task 6b-3 (D170) ────────────────────────────────── */

  it('6b-3: the index response carries head_sha, and REJECTS it being missing', () => {
    const base = {
      ok: true as const,
      workspace_instance_id: `pj:${MPID}`,
      repo_id: 'a92099d934dd95548e59525b7231fd4b5f5d5f6f',
      files_seen: 468,
      directories: 37,
      commits_linked: 200,
      commits_skipped_beyond_limit: 41,
      paths_skipped_unparseable: 0,
      files_marked_missing: 0,
      elapsed_ms: 3006
    }
    // A 40-hex head, and null for a project with no git history: both are real
    // answers on the wire.
    expect(
      memoryIndexResponseSchema.safeParse({
        ...base,
        head_sha: '1c146036edcec92aae29cbc0b146ffd6d2db5305'
      }).success
    ).toBe(true)
    expect(memoryIndexResponseSchema.safeParse({ ...base, head_sha: null }).success).toBe(true)
    // ⚠ REQUIRED-NULLABLE, NEVER OPTIONAL. `z.object` strips unknown keys, so a
    // producer that forgot this field would ship a payload that parsed cleanly
    // and rendered nothing. Making it required turns that silence into a loud
    // failure in MAIN, where it is diagnosable.
    expect(memoryIndexResponseSchema.safeParse(base).success).toBe(false)
  })

  it('6b-3: the launch event carries started and waited_ms, both required', () => {
    const base = {
      project_id: MPID,
      session_id: '44444444-4444-4444-8444-444444444444',
      agent: 'claude',
      reachable: true,
      at: '2026-08-21T10:41:00.000Z'
    }
    expect(memoryLaunchEventSchema.safeParse({ ...base, started: true, waited_ms: 4296 }).success).toBe(
      true
    )
    // ⚠ NULL, NOT 0, WHEN NOTHING WAS WAITED FOR. Zero would read as "answered
    // instantly"; null says the question does not apply, which is what lets the
    // *Last launch* line omit its clause rather than print "0.0s".
    expect(memoryLaunchEventSchema.safeParse({ ...base, started: false, waited_ms: null }).success).toBe(
      true
    )
    expect(memoryLaunchEventSchema.safeParse({ ...base, started: true }).success).toBe(false)
    expect(memoryLaunchEventSchema.safeParse({ ...base, waited_ms: null }).success).toBe(false)
    // A negative wait is not a wait.
    expect(
      memoryLaunchEventSchema.safeParse({ ...base, started: true, waited_ms: -1 }).success
    ).toBe(false)
  })

  it('6b-3: the freshness pair round-trips, and every field is required-nullable', () => {
    expect(memoryFreshnessRequestSchema.safeParse({ project_id: MPID }).success).toBe(true)

    const fresh = {
      ok: true as const,
      last_indexed_head: '1c146036edcec92aae29cbc0b146ffd6d2db5305',
      last_indexed_at: '2026-08-21T10:41:00.000Z',
      head_sha: '1c146036edcec92aae29cbc0b146ffd6d2db5305',
      stale: false
    }
    expect(memoryFreshnessResponseSchema.safeParse(fresh).success).toBe(true)
    // Never indexed, and no git history: both are real answers, not errors.
    expect(
      memoryFreshnessResponseSchema.safeParse({
        ok: true,
        last_indexed_head: null,
        last_indexed_at: null,
        head_sha: null,
        stale: false
      }).success
    ).toBe(true)
    expect(memoryFreshnessResponseSchema.safeParse({ ok: false, reason: 'no' }).success).toBe(true)

    // Each field omitted in turn must fail — the required-nullable discipline,
    // asserted per field rather than once, because one optional slipping in is
    // exactly how a field vanishes on the wire in silence.
    for (const key of ['last_indexed_head', 'last_indexed_at', 'head_sha', 'stale']) {
      const partial: Record<string, unknown> = { ...fresh }
      delete partial[key]
      expect(memoryFreshnessResponseSchema.safeParse(partial).success).toBe(false)
    }
  })

  it('⚠ the provision response reports ADOPTION, and carries no http port', () => {
    const parsed = memoryProvisionResponseSchema.safeParse({
      ok: true,
      container_name: 'chorus-x-11111111',
      volume_name: 'chorus-x-11111111-data',
      bolt_port: 7690,
      container_id: 'sha256deadbeef',
      adopted: true,
      probe: 1
    })
    expect(parsed.success).toBe(true)
    // ⚠ NO `http_port` IN THE PAYLOAD AT ALL. The Neo4j browser port is never
    // published, so there is nothing to report — and a nullable field would
    // invite a later task to start publishing one.
    expect(JSON.stringify(parsed)).not.toContain('http_port')
  })

  it('⚠ container status states "no container" and "container gone" as real answers', () => {
    // Both are required-nullable rather than optional: a producer must SAY
    // there is no container, not omit the field and let the renderer guess.
    for (const payload of [
      {
        ok: true,
        container_name: null,
        exists: false,
        running: false,
        state: null,
        status: null,
        published_at: null
      },
      {
        ok: true,
        container_name: 'chorus-x-11111111',
        exists: false,
        running: false,
        state: null,
        status: null,
        published_at: null
      }
    ]) {
      expect(memoryContainerStatusResponseSchema.safeParse(payload).success).toBe(true)
    }
    // Omitting them is NOT the same as stating null.
    expect(
      memoryContainerStatusResponseSchema.safeParse({ ok: true, exists: false, running: false })
        .success
    ).toBe(false)
  })

  it('the day-report channels are NAMED, not merely counted (D153)', () => {
    // Same D125 discipline. Three landed together: one that COLLECTS (slow,
    // spawns git, may call a model) and two that only READ.
    const dayChannels = Object.values(IpcChannel)
      .filter((c) => c.startsWith('day:'))
      .sort()
    expect(dayChannels).toEqual([
      'day:generate',
      'day:list',
      'day:read',
      'day:summarizer-get',
      'day:summarizer-set'
    ])
  })
})

/** Task 6b-1: a well-formed memory-usage roll-up, shared by the `memory:validate`
 *  cases below and the `memoryUsageSummarySchema` cases after them. */
const USAGE = {
  reads: 12,
  writes: 3,
  sessions: 4,
  since: '2026-08-20T09:15:00.000Z',
  readFirst: 3,
  inconclusive: 1,
  shellFirst: 2,
  text: '12 successful memory reads · 3 memory writes across 4 Claude Code sessions observed since 2026-08-20',
  breakdownText: '3 read-first · 1 inconclusive · 2 shell-first of the same 4 Claude Code sessions'
}

describe('memory:seed / memory:validate (Task 6-4)', () => {
  const MPID = '44444444-4444-4444-8444-444444444444'

  it('seed reports the version it moved FROM as well as TO', () => {
    // A bare "seeded" would not say whether anything happened.
    const ok = {
      ok: true,
      from_version: 0,
      to_version: 1,
      applied: ['identity-constraints-and-indexes'],
      cache_was_stale: false,
      cached_version: 0
    }
    expect(memorySeedResponseSchema.safeParse(ok).success).toBe(true)
    // The second seed is a no-op and says so with an empty list, not an error.
    expect(
      memorySeedResponseSchema.safeParse({ ...ok, from_version: 1, applied: [] }).success
    ).toBe(true)
    expect(memorySeedResponseSchema.safeParse({ ok: false, reason: 'r' }).success).toBe(true)
  })

  /**
   * ⚠ THE CACHE-VS-GRAPH DISAGREEMENT IS REPORTED, NOT PAPERED OVER. The graph
   * is the authority on its own version and SQLite only caches it, so the two
   * can legitimately differ — a graph restored from a dump, or reached by a
   * second Chorus install. Surfacing it is what demonstrates which one wins.
   */
  it('seed carries the cache disagreement rather than hiding it', () => {
    const stale = {
      ok: true,
      from_version: 0,
      to_version: 1,
      applied: ['identity-constraints-and-indexes'],
      cache_was_stale: true,
      cached_version: 7
    }
    expect(memorySeedResponseSchema.safeParse(stale).success).toBe(true)
    const { cache_was_stale: _d, ...missing } = stale
    // Required, not optional: an omitted flag would default to "agreed".
    expect(memorySeedResponseSchema.safeParse(missing).success).toBe(false)
  })

  it('applied carries migration NAMES, not raw Cypher', () => {
    const parsed = memorySeedResponseSchema.parse({
      ok: true,
      from_version: 0,
      to_version: 1,
      applied: ['identity-constraints-and-indexes'],
      cache_was_stale: false,
      cached_version: 0
    })
    if (!parsed.ok) throw new Error('expected ok')
    for (const a of parsed.applied) expect(a).not.toMatch(/CREATE |MATCH |MERGE /)
  })

  /** ⚠ THE PAIR AND ITS DENOMINATOR, ALWAYS (D55). */
  it('validate never carries a numerator without its denominator', () => {
    const ok = {
      ok: true,
      with_source: 43,
      total: 512,
      text: '43 of 512',
      affected: [{ id: 'm-1', content: 'x', written_via: 'mcp' }],
      affected_total: 469,
      usage: USAGE // Task 6b-1: required on both branches
    }
    expect(memoryValidateResponseSchema.safeParse(ok).success).toBe(true)
    // Drop the denominator and it must fail rather than render a bare count.
    const { total: _t, ...noTotal } = ok
    expect(memoryValidateResponseSchema.safeParse(noTotal).success).toBe(false)
    const { text: _x, ...noText } = ok
    expect(memoryValidateResponseSchema.safeParse(noText).success).toBe(false)
  })

  it('an empty graph is a real answer — "0 of 0"', () => {
    expect(
      memoryValidateResponseSchema.safeParse({
        ok: true,
        with_source: 0,
        total: 0,
        text: '0 of 0',
        affected: [],
        affected_total: 0,
        usage: USAGE
      }).success
    ).toBe(true)
  })

  /**
   * ⚠ `affected_total` IS SEPARATE FROM `affected.length` SO A TRUNCATED LIST
   * CAN SAY SO. A bounded list rendered bare looks complete — D55 one level down.
   */
  it('the affected list can be shorter than the number it describes', () => {
    const truncated = {
      ok: true,
      with_source: 43,
      total: 512,
      text: '43 of 512',
      affected: Array.from({ length: 50 }, (_v, i) => ({
        id: `m-${i}`,
        content: 'x',
        written_via: 'mcp'
      })),
      affected_total: 469,
      usage: USAGE
    }
    const parsed = memoryValidateResponseSchema.parse(truncated)
    if (!parsed.ok) throw new Error('expected ok')
    expect(parsed.affected.length).toBeLessThan(parsed.affected_total)
  })

  it('both requests are keyed by a uuid project id', () => {
    for (const schema of [memorySeedRequestSchema, memoryValidateRequestSchema]) {
      expect(schema.safeParse({ project_id: MPID }).success).toBe(true)
      expect(schema.safeParse({ project_id: 'nope' }).success).toBe(false)
    }
  })

  it('neither response carries anything capable of holding a key', () => {
    const parsed = memoryValidateResponseSchema.parse({
      ok: true,
      with_source: 1,
      total: 2,
      text: '1 of 2',
      affected: [],
      affected_total: 1,
      usage: USAGE
    })
    for (const k of Object.keys(parsed)) {
      expect(k).not.toMatch(/key|secret|token|password|blob|uri/i)
    }
  })

  /* ── Task 6b-1 (D168): `usage` on BOTH branches ───────────────────────── */

  it('⚠ memory:validate carries `usage` on BOTH branches, and rejects a response missing it on either', () => {
    // The counters are a local SQLite read that is true with the graph down;
    // hanging them off `ok: true` would let a stopped container erase a number
    // that has nothing to do with the container.
    const okRes = { ok: true, with_source: 1, total: 2, text: '1 of 2', affected: [], affected_total: 1, usage: USAGE }
    const refused = { ok: false, reason: 'graph unreachable', usage: USAGE }
    expect(memoryValidateResponseSchema.safeParse(okRes).success).toBe(true)
    expect(memoryValidateResponseSchema.safeParse(refused).success).toBe(true)
    const { usage: _u1, ...okNoUsage } = okRes
    const { usage: _u2, ...refusedNoUsage } = refused
    expect(memoryValidateResponseSchema.safeParse(okNoUsage).success).toBe(false)
    expect(memoryValidateResponseSchema.safeParse(refusedNoUsage).success).toBe(false)
  })
})


describe('session:memory — the per-session counters on the wire (Task 6b-1 / D168 / D173)', () => {
  const BASE = { reads: 2, writes: 0, readBeforeExplore: true, readInconclusive: false, shellFirst: false }

  it('accepts the five-field shape', () => {
    expect(sessionMemoryUsageSchema.safeParse(BASE).success).toBe(true)
    expect(sessionMemoryEventSchema.safeParse({ sessionId: 'sess-1', usage: BASE }).success).toBe(true)
  })

  it('rejects a negative count and a fractional count', () => {
    expect(sessionMemoryUsageSchema.safeParse({ ...BASE, reads: -1 }).success).toBe(false)
    expect(sessionMemoryUsageSchema.safeParse({ ...BASE, writes: 1.5 }).success).toBe(false)
  })

  it.each(['readBeforeExplore', 'readInconclusive', 'shellFirst'] as const)(
    '⚠ rejects a payload missing %s — all three flags are REQUIRED, not optional',
    (flag) => {
      // `z.object` strips unknown keys, so an OMITTED field vanishes silently
      // (D143(f)); for `readInconclusive` a silent strip would leave
      // `readBeforeExplore === false` with no third state — exactly the silent
      // verdict D173 removed. Requiring it makes the producer throw in main.
      const { [flag]: _dropped, ...without } = BASE
      expect(sessionMemoryUsageSchema.safeParse(without).success).toBe(false)
    }
  )

  it('rejects an empty sessionId on the event', () => {
    expect(sessionMemoryEventSchema.safeParse({ sessionId: '', usage: BASE }).success).toBe(false)
  })

  it('⚠ carries NO string field — the structural form of "no tool name crosses the bridge"', () => {
    const parsed = sessionMemoryUsageSchema.parse({ ...BASE, tool_name: 'Read', name: 'x' })
    for (const v of Object.values(parsed)) expect(typeof v).not.toBe('string')
    expect(Object.keys(parsed).sort()).toEqual(
      ['readBeforeExplore', 'readInconclusive', 'reads', 'shellFirst', 'writes'].sort()
    )
  })
})

describe('memoryUsageSummarySchema — the roll-up with its denominator (D55 / D173)', () => {
  it('accepts the full summary', () => {
    expect(memoryUsageSummarySchema.safeParse(USAGE).success).toBe(true)
  })

  it.each(['sessions', 'readFirst', 'inconclusive', 'shellFirst', 'text', 'since'] as const)(
    'rejects a summary missing %s',
    (field) => {
      const { [field]: _dropped, ...without } = USAGE
      expect(memoryUsageSummarySchema.safeParse(without).success).toBe(false)
    }
  )

  it('allows a null `since` (counters not installed) and a null breakdown (nothing to show)', () => {
    expect(
      memoryUsageSummarySchema.safeParse({ ...USAGE, since: null, breakdownText: null }).success
    ).toBe(true)
  })

  it('rejects a negative or fractional count anywhere', () => {
    expect(memoryUsageSummarySchema.safeParse({ ...USAGE, sessions: -1 }).success).toBe(false)
    expect(memoryUsageSummarySchema.safeParse({ ...USAGE, readFirst: 0.5 }).success).toBe(false)
  })
})

describe('session:activity — the reason on the live record (Task 4-1 / D145)', () => {
  const BASE = { sessionId: 'sess-1', activity: 'needs-you' as const, since: 1786615200000 }

  it.each(['permission', 'stopped', 'notice'])('accepts reason %s', (reason) => {
    expect(sessionActivityEventSchema.safeParse({ ...BASE, reason }).success).toBe(true)
  })

  it('accepts null — a working agent has no reason', () => {
    const parsed = sessionActivityEventSchema.parse({
      ...BASE,
      activity: 'working',
      reason: null
    })
    expect(parsed.reason).toBeNull()
  })

  it('rejects a reason outside the vocabulary', () => {
    expect(sessionActivityEventSchema.safeParse({ ...BASE, reason: 'urgent' }).success).toBe(false)
    expect(sessionActivityEventSchema.safeParse({ ...BASE, reason: '' }).success).toBe(false)
    expect(needsYouReasonSchema.safeParse('working').success).toBe(false)
  })

  it('⚠ REQUIRED AND NULLABLE, NOT OPTIONAL — a producer that forgets throws in MAIN', () => {
    // D143(f): `z.object` STRIPS unknown keys rather than rejecting them, so a
    // field the producer sets and the schema omits vanishes on the wire in
    // silence. The inverse is what this pins — omitting `reason` must FAIL at
    // the parse in `ipc.ts`, loudly and where it is diagnosable, rather than
    // shipping a reasonless Inbox.
    expect(sessionActivityEventSchema.safeParse(BASE).success).toBe(false)
    expect(sessionActivityEventSchema.safeParse({ ...BASE, reason: undefined }).success).toBe(false)
  })

  it('⚠ `reason` SURVIVES A parse() ROUND-TRIP — the other half of D143(f)', () => {
    // Asserting the field is PRESENT after parsing, not merely that parsing
    // succeeded: a schema missing the key would strip it and still return ok.
    const parsed = sessionActivityEventSchema.parse({ ...BASE, reason: 'permission' })
    expect(parsed).toEqual({ ...BASE, reason: 'permission' })
    expect(Object.keys(parsed).sort()).toEqual(['activity', 'reason', 'sessionId', 'since'])
  })

  it('the cold read carries it too — the snapshot must not disagree with the stream', () => {
    const parsed = sessionActivityListResponseSchema.parse({
      activities: [
        { ...BASE, reason: 'stopped' },
        { sessionId: 'sess-2', activity: 'working', since: 1786615200001, reason: null }
      ]
    })
    expect(parsed.activities.map((a) => a.reason)).toEqual(['stopped', null])
  })

  it('⚠ agentActivitySchema is UNCHANGED — the filmstrip learns no fourth case', () => {
    // The reason is a SEPARATE field precisely so the lights keep deriving from
    // two states. A reason leaking into this enum is the scope violation.
    expect(agentActivitySchema.options).toEqual(['working', 'needs-you'])
    expect(agentActivitySchema.safeParse('permission').success).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* Phase 5 / Task 5-1: the voice channels and the frame envelope       */
/* ------------------------------------------------------------------ */

describe('voice:* channels (Task 5-1)', () => {
  const CAPTURE = '55555555-5555-4555-8555-555555555555'

  it('declares exactly the channels Tasks 5-1, 5-3 and 5-4 said they would', () => {
    // Asserted BY NAME as well as by count, the D125 discipline: a count alone
    // stays green if a later task renames one, which is the drift a tally exists
    // to catch. 5-1 declared four; 5-3 declared three more; 5-4 declared the
    // three settings channels — a dedicated `voice:*` group, NOT a generic
    // key/value bag (VoicePlan §8.4); D181 added `voice:overlay-move` for the
    // overlay's drag — and no others.
    const voice = Object.values(IpcChannel).filter((c) => c.startsWith('voice:'))
    expect(voice.sort()).toEqual([
      'voice:capture-frame',
      'voice:capture-start',
      'voice:capture-stop',
      'voice:hotkey-status',
      'voice:model-status',
      'voice:overlay-move',
      'voice:settings-get',
      'voice:settings-set',
      'voice:state',
      'voice:target',
      'voice:target-set'
    ])
  })

  it('validates the target and hotkey-status payloads', () => {
    const CAP = '55555555-5555-4555-8555-555555555555'
    expect(voiceTargetSchema.safeParse({ sessionId: CAP, title: 'claude · api' }).success).toBe(true)
    // Null in both directions is meaningful: no pane focused, no ring shown.
    expect(voiceTargetSchema.safeParse({ sessionId: null, title: null }).success).toBe(true)
    expect(voiceTargetSchema.safeParse({ sessionId: 'nope', title: null }).success).toBe(false)
    // ⚠ STRICT — the ring payload must never grow a transcript field.
    expect(voiceTargetSchema.safeParse({ sessionId: CAP, title: null, text: 'hi' }).success).toBe(false)

    expect(
      voiceHotkeyStatusSchema.safeParse({ available: true, chord: 'Ctrl+Shift+Space', reason: null }).success
    ).toBe(true)
    // Unavailable is a SUPPORTED state, not an error: click-to-talk is unaffected.
    expect(
      voiceHotkeyStatusSchema.safeParse({
        available: false,
        chord: 'Ctrl+Shift+Space',
        reason: 'Error: The specified module could not be found.'
      }).success
    ).toBe(true)
    // Task 5-4: turned OFF in settings is a third state — no chord at all, and
    // the reason says it was a choice rather than a failure.
    expect(
      voiceHotkeyStatusSchema.safeParse({
        available: false,
        chord: null,
        reason: 'push-to-talk is turned off in settings'
      }).success
    ).toBe(true)
  })

  it('keeps the wire constants at the values the worklet duplicates', () => {
    // The worklet CANNOT import — a worklet module is loaded by URL into a scope
    // with no module resolution — so it carries its own copy of the frame size.
    // `capture.ts` asserts main's reply against its own constant at start, and
    // this pins the constant itself so the two cannot drift silently.
    expect(VOICE_SAMPLE_RATE).toBe(16_000)
    expect(VOICE_FRAME_SAMPLES).toBe(1_024)
    expect(VOICE_MAX_FRAME_SAMPLES).toBe(4_096)
    // The ceiling is headroom over the real frame size, not a second frame size.
    expect(VOICE_MAX_FRAME_SAMPLES).toBeGreaterThan(VOICE_FRAME_SAMPLES)
    // 1024 is a whole number of Web Audio render quanta (128 samples).
    expect(VOICE_FRAME_SAMPLES % 128).toBe(0)
  })

  it('carries only the states the phase can actually reach so far', () => {
    // D76 one layer down: a state is declared when something can produce it.
    // 5-1 shipped four and recorded that `failed` had no producer yet; 5-2 gave
    // it one (the whisper child process) and added `ready-for-review`, which
    // means "main holds a transcript" rather than "a review UI exists" — D160
    // makes v1 direct-to-prompt with no composer. 5-3 added `inserted`; 5-4
    // added `refining`, and with it the VoicePlan §9 machine is complete.
    expect(voiceStateNameSchema.options).toEqual([
      'ready',
      'listening',
      'finalizing',
      'refining',
      'ready-for-review',
      'inserted',
      'failed'
    ])
    // ⚠ 5-3 MADE `inserted` THE NORMAL TERMINAL STATE AND `ready-for-review`
    // THE RECOVERY ONE. D160 is direct-to-prompt, so the happy path ends with
    // the transcript written to the target; a transcript that is merely HELD
    // means the target died (VoicePlan §7.3). `refining` (5-4) sits between
    // `finalizing` and the write, and ONLY a network mode ever enters it.
    expect(voiceStateNameSchema.options).toContain('refining')
  })

  it('keeps the drop reasons a closed enum', () => {
    // The renderer must never be handed a cause string main composed — a composed
    // string is where a payload detail leaks into the UI and then into a log.
    expect(voiceDropReasonSchema.options.slice().sort()).toEqual([
      'bad-sample-rate',
      'bad-sequence',
      'capture-full',
      'length-mismatch',
      'malformed',
      'queue-full',
      'stale-session'
    ])
    // capture-full (5-2) is deliberately NOT a synonym for queue-full: one
    // means the speaker kept going, the other means the consumer stalled.
    expect(voiceDropReasonSchema.options).toContain('capture-full')
  })

  const frame = {
    captureId: CAPTURE,
    seq: 0,
    sampleRate: VOICE_SAMPLE_RATE,
    sampleCount: VOICE_FRAME_SAMPLES,
    samples: new Int16Array(VOICE_FRAME_SAMPLES)
  }

  it('accepts a well-formed frame envelope', () => {
    expect(voiceFrameSchema.safeParse(frame).success).toBe(true)
  })

  it('pins the sample rate as a literal, so a 48 kHz frame cannot reach main', () => {
    // The silent failure this prevents: 48 kHz audio handed to a transcriber
    // expecting 16 kHz does not error, it just transcribes badly.
    expect(voiceFrameSchema.safeParse({ ...frame, sampleRate: 48_000 }).success).toBe(false)
    expect(voiceFrameSchema.safeParse({ ...frame, sampleRate: 16_001 }).success).toBe(false)
  })

  it('refuses a payload that is not an Int16Array', () => {
    expect(
      voiceFrameSchema.safeParse({ ...frame, samples: [0, 1, 2] as unknown as Int16Array }).success
    ).toBe(false)
    expect(
      voiceFrameSchema.safeParse({
        ...frame,
        samples: new Float32Array(VOICE_FRAME_SAMPLES) as unknown as Int16Array
      }).success
    ).toBe(false)
  })

  it('caps sampleCount so a hostile declaration cannot be taken seriously', () => {
    expect(voiceFrameSchema.safeParse({ ...frame, sampleCount: 2_147_483_647 }).success).toBe(false)
    expect(voiceFrameSchema.safeParse({ ...frame, sampleCount: 0 }).success).toBe(false)
  })

  it('is strict, so an extra field cannot ride along on a bulk channel', () => {
    expect(voiceFrameSchema.safeParse({ ...frame, transcript: 'hello' }).success).toBe(false)
  })

  it('DELIBERATELY does not element-validate the samples — a declared position', () => {
    // NOT A D1 EXEMPTION. The envelope is fully validated; the payload is length-
    // and type-checked. An Int16Array's elements are Int16 by construction, so a
    // per-element schema could not fail meaningfully, and running one 1,024 times
    // per frame at ~16 frames/second would cost more than the transcription. What
    // CAN be wrong is the envelope, and it is checked.
    const loud = new Int16Array(VOICE_FRAME_SAMPLES)
    loud.fill(32767)
    loud[0] = -32768
    expect(voiceFrameSchema.safeParse({ ...frame, samples: loud }).success).toBe(true)
  })

  it('does not catch a sampleCount that disagrees with the payload length', () => {
    // Stated here as well as in voiceCore.test.ts, because this is the seam
    // between the two halves of the validation: Zod checks the fields
    // independently, `admitFrame` checks that they agree.
    const lying = { ...frame, sampleCount: 512, samples: new Int16Array(VOICE_FRAME_SAMPLES) }
    expect(voiceFrameSchema.safeParse(lying).success).toBe(true)
  })

  it('validates the start response, refusal included', () => {
    expect(
      voiceCaptureStartResponseSchema.safeParse({
        started: true,
        captureId: CAPTURE,
        sampleRate: VOICE_SAMPLE_RATE,
        frameSamples: VOICE_FRAME_SAMPLES,
        refusal: null
      }).success
    ).toBe(true)
    expect(
      voiceCaptureStartResponseSchema.safeParse({
        started: false,
        captureId: null,
        sampleRate: VOICE_SAMPLE_RATE,
        frameSamples: VOICE_FRAME_SAMPLES,
        refusal: 'already-capturing'
      }).success
    ).toBe(true)
    // The refusal vocabulary is closed, for the same reason the drop reasons are.
    expect(
      voiceCaptureStartResponseSchema.safeParse({
        started: false,
        captureId: null,
        sampleRate: VOICE_SAMPLE_RATE,
        frameSamples: VOICE_FRAME_SAMPLES,
        refusal: 'because I said so'
      }).success
    ).toBe(false)
  })

  it('validates the stop request and response', () => {
    expect(voiceCaptureStopRequestSchema.safeParse({ captureId: CAPTURE }).success).toBe(true)
    expect(voiceCaptureStopRequestSchema.safeParse({ captureId: 'nope' }).success).toBe(false)
    expect(
      voiceCaptureStopResponseSchema.safeParse({
        stopped: true,
        framesAdmitted: 78,
        framesDropped: 0
      }).success
    ).toBe(true)
  })

  it('validates the state event and refuses anything it did not declare', () => {
    const event = {
      state: 'listening' as const,
      captureId: CAPTURE,
      framesAdmitted: 78,
      framesDropped: 3,
      queued: 2,
      queueMax: 1875,
      lastDropReason: 'queue-full' as const,
      keepingUp: false,
      transcriptChars: 0,
      level: 0.12,
      message: null,
      refinement: null
    }
    expect(voiceStateEventSchema.safeParse(event).success).toBe(true)
    // Task 5-4: the refinement outcome is a CLOSED enum beside a closed mode.
    expect(
      voiceStateEventSchema.safeParse({ ...event, refinement: { mode: 'cleanup', outcome: 'refined' } }).success
    ).toBe(true)
    expect(
      voiceStateEventSchema.safeParse({ ...event, refinement: { mode: 'verbatim', outcome: 'verbatim' } }).success
    ).toBe(true)
    expect(
      voiceStateEventSchema.safeParse({ ...event, refinement: { mode: 'cleanup', outcome: 'improved' } }).success
    ).toBe(false)
    // ⚠ AND IT CANNOT CARRY THE REFINED TEXT EITHER — strict, like its parent.
    expect(
      voiceStateEventSchema.safeParse({
        ...event,
        refinement: { mode: 'cleanup', outcome: 'refined', text: 'Fix the parser.' }
      }).success
    ).toBe(false)
    // STRICT, AND THAT IS WHAT KEEPS AUDIO OFF THIS CHANNEL. A future edit that
    // attaches samples, a transcript or a device label to the state event fails
    // here rather than shipping.
    expect(voiceStateEventSchema.safeParse({ ...event, samples: [1, 2] }).success).toBe(false)
    expect(voiceStateEventSchema.safeParse({ ...event, transcript: 'hello' }).success).toBe(false)
    expect(voiceStateEventSchema.safeParse({ ...event, deviceLabel: 'fifine' }).success).toBe(false)
    // The meter is a bounded number, and out-of-range is refused.
    expect(voiceStateEventSchema.safeParse({ ...event, level: 1.5 }).success).toBe(false)
    expect(voiceStateEventSchema.safeParse({ ...event, level: -0.1 }).success).toBe(false)
    // ⚠ 5-2 ADDS A transcriptChars COUNT AND STILL NO TEXT. The transcript does
    // not cross this bridge; a field carrying it must fail here rather than ship.
    expect(voiceStateEventSchema.safeParse({ ...event, transcriptChars: 26 }).success).toBe(true)
    expect(voiceStateEventSchema.safeParse({ ...event, text: 'hello' }).success).toBe(false)
    expect(voiceStateEventSchema.safeParse({ ...event, originalTranscript: 'x' }).success).toBe(false)
    // A drop reason outside the enum is refused.
    expect(voiceStateEventSchema.safeParse({ ...event, lastDropReason: 'slow' }).success).toBe(false)
  })

  it('accepts the idle state, where there is no capture and nothing dropped', () => {
    expect(
      voiceStateEventSchema.safeParse({
        state: 'ready',
        captureId: null,
        framesAdmitted: 0,
        framesDropped: 0,
        queued: 0,
        queueMax: 1875,
        lastDropReason: null,
        keepingUp: true,
        transcriptChars: 0,
        level: 0,
        message: null,
        refinement: null
      }).success
    ).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/* Phase 5 / Task 5-4: voice settings and refinement                   */
/* ------------------------------------------------------------------ */

describe('voice settings schemas (Task 5-4)', () => {
  const PROFILE = '66666666-6666-4666-8666-666666666666'

  it('has three refinement modes with Clean up as the default and Verbatim as the floor', () => {
    expect(voiceRefinementModeSchema.options).toEqual(['verbatim', 'cleanup', 'organize'])
    expect(DEFAULT_VOICE_SETTINGS.refinement).toBe('cleanup')
    // ⚠ VERBATIM IS ONE SETTING CHANGE AWAY FROM ANY OTHER STATE — a mode, not
    // a separate feature. And the defaults dial nothing: no refiner is set.
    expect(voiceRefinementModeSchema.safeParse('verbatim').success).toBe(true)
    expect(DEFAULT_VOICE_SETTINGS.refiner).toBeNull()
  })

  it('accepts the defaults, and the defaults are D159 / VoicePlan §7 / §2', () => {
    expect(voiceSettingsSchema.safeParse(DEFAULT_VOICE_SETTINGS).success).toBe(true)
    expect(DEFAULT_VOICE_SETTINGS.model).toBe('base.en')
    expect(DEFAULT_VOICE_SETTINGS.activation).toBe('hold')
    expect(DEFAULT_VOICE_SETTINGS.hotkey).toBe('ScrollLock')
    expect(DEFAULT_VOICE_SETTINGS.autoStop).toBe(true)
    expect(DEFAULT_VOICE_SETTINGS.inputDeviceId).toBeNull()
  })

  it('offers exactly base.en and small.en (D159) — never tiny or medium', () => {
    expect(voiceSettingsSchema.safeParse({ ...DEFAULT_VOICE_SETTINGS, model: 'small.en' }).success).toBe(true)
    expect(voiceSettingsSchema.safeParse({ ...DEFAULT_VOICE_SETTINGS, model: 'tiny.en' }).success).toBe(false)
    expect(voiceSettingsSchema.safeParse({ ...DEFAULT_VOICE_SETTINGS, model: 'medium.en' }).success).toBe(false)
  })

  it('lets the hotkey be turned OFF (null) and bounds it, but leaves parsing to main', () => {
    expect(voiceSettingsSchema.safeParse({ ...DEFAULT_VOICE_SETTINGS, hotkey: null }).success).toBe(true)
    // The wire accepts any short string; `parseChord` in main is the judge, and
    // an unparseable chord comes back as ok:false rather than as a Zod error.
    expect(voiceSettingsSchema.safeParse({ ...DEFAULT_VOICE_SETTINGS, hotkey: 'Ctrl+F8' }).success).toBe(true)
    expect(voiceSettingsSchema.safeParse({ ...DEFAULT_VOICE_SETTINGS, hotkey: 'x'.repeat(61) }).success).toBe(false)
  })

  it('a refiner is a profile POINTER plus a model id — nullable together, never a key', () => {
    expect(
      voiceSettingsSchema.safeParse({
        ...DEFAULT_VOICE_SETTINGS,
        refiner: { credentialProfileId: PROFILE, modelId: 'anthropic/claude-haiku-4.5' }
      }).success
    ).toBe(true)
    expect(voiceSettingsSchema.safeParse({ ...DEFAULT_VOICE_SETTINGS, refiner: { credentialProfileId: PROFILE } }).success).toBe(false)
    expect(voiceSettingsSchema.safeParse({ ...DEFAULT_VOICE_SETTINGS, refiner: { modelId: 'x' } }).success).toBe(false)
    // ⚠ STRICT: no field can carry key material.
    expect(
      voiceSettingsSchema.safeParse({
        ...DEFAULT_VOICE_SETTINGS,
        refiner: { credentialProfileId: PROFILE, modelId: 'x', apiKey: 'sk-or-…' }
      }).success
    ).toBe(false)
    expect(voiceSettingsSchema.safeParse({ ...DEFAULT_VOICE_SETTINGS, apiKey: 'sk-or-…' }).success).toBe(false)
  })

  it('validates the set request and the response envelope', () => {
    expect(voiceSettingsSetRequestSchema.safeParse({ settings: DEFAULT_VOICE_SETTINGS }).success).toBe(true)
    expect(voiceSettingsSetRequestSchema.safeParse({ settings: { model: 'base.en' } }).success).toBe(false)
    expect(
      voiceSettingsResponseSchema.safeParse({ ok: true, reason: null, settings: DEFAULT_VOICE_SETTINGS }).success
    ).toBe(true)
    // ok:false carries a reason AND the unchanged stored settings.
    expect(
      voiceSettingsResponseSchema.safeParse({
        ok: false,
        reason: 'That hotkey could not be understood.',
        settings: DEFAULT_VOICE_SETTINGS
      }).success
    ).toBe(true)
  })

  it('reports model status with the exact byte size and a closed state', () => {
    expect(
      voiceModelStatusResponseSchema.safeParse({
        models: [
          { id: 'base.en', bytes: 147_964_211, state: 'ready' },
          { id: 'small.en', bytes: 487_614_201, state: 'missing' }
        ]
      }).success
    ).toBe(true)
    expect(
      voiceModelStatusResponseSchema.safeParse({ models: [{ id: 'base.en', bytes: 1, state: 'downloading' }] }).success
    ).toBe(false)
  })
})

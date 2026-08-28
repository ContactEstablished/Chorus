import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IpcChannel,
  type AdapterListResponse,
  type CouncilPickBriefResponse,
  type CouncilStartRequest,
  type CouncilStartResponse,
  type CouncilCancelRequest,
  type CouncilCancelResponse,
  type CouncilTranscriptRequest,
  type CouncilTranscriptResponse,
  type CouncilDocketRequest,
  type CouncilDocketResponse,
  type CouncilFindingsRequest,
  type CouncilFindingsResponse,
  type CouncilForgetRunRequest,
  type CouncilForgetRunResponse,
  type CouncilVerdictRequest,
  type CouncilVerdictResponse,
  type CouncilOpenedEvent,
  type CouncilProgressEvent,
  type CouncilSummaryEvent,
  type AttachRequest,
  type AttachResponse,
  type AttentionReport,
  type AttentionSummary,
  type AttributionSummary,
  type CliDetectResponse,
  type CredentialCreateRequest,
  type CredentialCreateResponse,
  type CredentialDeleteResponse,
  type CredentialListResponse,
  type CredentialReplaceRequest,
  type CredentialReplaceResponse,
  type CredentialTestResponse,
  type LaunchRequest,
  type LaunchResponse,
  type LaunchContextResponse,
  type LayoutGetResponse,
  type LayoutSetRequest,
  type ModelListResponse,
  type ModelRefreshResponse,
  type ModelShortlistSetResponse,
  type LaunchProfileListResponse,
  type LaunchProfileCreateRequest,
  type LaunchProfileCreateResponse,
  type LaunchProfileUpdateRequest,
  type LaunchProfileUpdateResponse,
  type LaunchProfileDeleteResponse,
  type CouncilMemberListResponse,
  type CouncilMemberCreateRequest,
  type CouncilMemberCreateResponse,
  type CouncilMemberUpdateRequest,
  type CouncilMemberUpdateResponse,
  type CouncilMemberDeleteResponse,
  type RelaunchResponse,
  type ProjectAddResponse,
  type ProjectDeleteResponse,
  type MemoryGetResponse,
  type DayReport,
  type DayReportListResponse,
  type DaySummarizer,
  type DaySummarizerGetResponse,
  type MemoryStatusResponse,
  type MemoryConfigureResponse,
  type MemoryDisableResponse,
  type MemoryTestResponse,
  type MemorySeedResponse,
  type MemoryIndexResponse,
  type MemoryFreshnessResponse,
  type MemoryProvisionResponse,
  type MemoryContainerStatusResponse,
  type MemoryContainerRemoveResponse,
  type MemoryValidateResponse,
  type MemoryModeWire,
  type MemoryAuthModeWire,
  type ProjectImpact,
  type ProjectsList,
  type ProjectSetStatusRequest,
  type ProjectSetStatusResponse,
  type ProjectUpdateRequest,
  type ProjectUpdateResponse,
  type ProviderCreateRequest,
  type ProviderCreateResponse,
  type ProviderDeleteResponse,
  type ProviderListResponse,
  type ProviderUpdateRequest,
  type ProviderUpdateResponse,
  type RestartResponse,
  type SessionActivityEvent,
  type SessionActivityListResponse,
  type ProjectAttentionList,
  type SessionContextEvent,
  type SessionContextListResponse,
  type SessionMemoryEvent,
  type MemoryLaunchEvent,
  type SessionSetLockedRequest,
  type SessionSetLockedResponse,
  type AgentLockPinStatus,
  type AgentLockPinMutateResponse,
  type SessionDataEvent,
  type SessionExitEvent,
  type SessionRestoredEvent,
  type ViewState,
  type WindowMaximized,
  type WorktreeListResponse,
  type WorktreeRemoveRequest,
  type WorktreeRemoveResponse,
  type WorktreeDirtyFilesResponse,
  type WorktreeDiffSummary,
  type VoiceCaptureStartResponse,
  type VoiceCaptureStopResponse,
  type VoiceFrame,
  type VoiceStateEvent,
  type VoiceTarget,
  type VoiceHotkeyStatus,
  type VoiceSettings,
  type VoiceSettingsResponse,
  type VoiceModelStatusResponse,
  type PromptsResponse
} from '../shared/ipc'

/**
 * Narrow, typed surface exposed to the renderer. No generic ipcRenderer
 * passthrough — only these session operations exist.
 *
 * NOTE: no Zod here. The preload runs under the page CSP (no unsafe-eval),
 * which Zod's compiled parsers violate (EvalError). All validation happens in
 * the main process: renderer -> main payloads are parsed in the IPC handlers,
 * and main -> renderer events are validated in main before sending.
 */
const chorusApi = {
  attachSession: (request: AttachRequest): Promise<AttachResponse> =>
    ipcRenderer.invoke(IpcChannel.SessionAttach, request),

  launch: (request: LaunchRequest): Promise<LaunchResponse> =>
    ipcRenderer.invoke(IpcChannel.SessionLaunch, request),

  getLaunchContext: (projectId: string): Promise<LaunchContextResponse> =>
    ipcRenderer.invoke(IpcChannel.SessionLaunchContext, { project_id: projectId }),

  restartSession: (sessionId: string): Promise<RestartResponse> =>
    ipcRenderer.invoke(IpcChannel.SessionRestart, { sessionId }),

  deleteSession: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.SessionDelete, { sessionId }),

  setSessionTitle: (sessionId: string, title: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.SessionSetTitle, { sessionId, title }),

  /** ⚠ `refresh: true` RE-PROBES THE MACHINE instead of reusing the boot memo.
   *  The launch dialog sends it on open: a CLI upgraded in a terminal since
   *  startup leaves the memo advertising a version that is no longer installed,
   *  and an agent installed since startup stays invisible without it. */
  detectClis: (refresh = false): Promise<CliDetectResponse> =>
    ipcRenderer.invoke(IpcChannel.CliDetect, refresh ? { refresh: true } : {}),

  /* Task 3-3: static adapter declarations (auth methods + capabilities). */
  listAdapters: (): Promise<AdapterListResponse> => ipcRenderer.invoke(IpcChannel.AdapterList, {}),

  getLayout: (projectId: string): Promise<LayoutGetResponse> =>
    ipcRenderer.invoke(IpcChannel.LayoutGet, { project_id: projectId }),

  setLayout: (request: LayoutSetRequest): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.LayoutSet, request),

  getViewState: (projectId: string): Promise<ViewState> =>
    ipcRenderer.invoke(IpcChannel.ViewGet, { project_id: projectId }),

  setViewState: (projectId: string, state: ViewState): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.ViewSet, { project_id: projectId, state }),

  addProject: (): Promise<ProjectAddResponse> => ipcRenderer.invoke(IpcChannel.ProjectAdd, {}),

  listProjects: (): Promise<ProjectsList> => ipcRenderer.invoke(IpcChannel.ProjectList, {}),

  selectProject: (projectId: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.ProjectSelect, { project_id: projectId }),

  /** Save a project's identity (name + colour + description) from the project
   *  settings screen. Main validates and normalises; the response carries the
   *  row AS STORED, which is what the caller should trust over its own form. */
  updateProject: (request: ProjectUpdateRequest): Promise<ProjectUpdateResponse> =>
    ipcRenderer.invoke(IpcChannel.ProjectUpdate, request),

  /* Phase 3h / D125 — the four lifecycle channels. Thin passthroughs, like
     everything else here: NO Zod in the preload (it runs under a CSP that makes
     Zod throw EvalError, and the failure mode is silent). Main validates. */

  /** Hide, archive, or restore a project to active. Archiving STOPS its live
   *  agents and may move the active project — the response says which. */
  setProjectStatus: (request: ProjectSetStatusRequest): Promise<ProjectSetStatusResponse> =>
    ipcRenderer.invoke(IpcChannel.ProjectSetStatus, request),

  /**
   * State the rail's order — every project id, in the new order.
   *
   * ⚠ THE CALLER MUST PASS A PLAIN `string[]` (D14). An array read off a Pinia
   * store is a Vue Proxy, and `invoke` rejects it with "An object could not be
   * cloned" at RUNTIME, with no compile-time signal — the types are identical.
   * This signature cannot enforce that; the caller in `stores/project.ts`
   * builds a fresh array and says so.
   */
  reorderProjects: (orderedIds: string[]): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.ProjectReorder, { ordered_ids: orderedIds }),

  /** The counts a delete confirmation states before it happens (D123/D109). */
  projectImpact: (projectId: string): Promise<ProjectImpact> =>
    ipcRenderer.invoke(IpcChannel.ProjectImpact, { project_id: projectId }),

  /** Purge a project. `typedName` must equal the stored name exactly — main
   *  checks, and rejects otherwise. Irreversible; touches no file on disk. */
  deleteProject: (projectId: string, typedName: string): Promise<ProjectDeleteResponse> =>
    ipcRenderer.invoke(IpcChannel.ProjectDelete, {
      project_id: projectId,
      typed_name: typedName
    }),

  /* ---- Phase 6 / Task 6-3: memory -------------------------------------
   *
   * ⚠ NO ZOD HERE, AND IT IS NOT AN OVERSIGHT. Zod in the preload throws
   * `EvalError` under this app's CSP and SILENTLY DROPS the event — validation
   * lives in main (D1). These are thin forwarders and nothing else.
   *
   * ⚠ EVERY ARGUMENT IS A PRIMITIVE, so the object built here is a plain one.
   * Passing a reactive Pinia value straight through would fail structured clone
   * with "An object could not be cloned" and no compile-time signal (D14).
   */

  /** The settings form's read. */
  getMemory: (projectId: string): Promise<MemoryGetResponse> =>
    ipcRenderer.invoke(IpcChannel.MemoryGet, { project_id: projectId }),

  /** ⚠ THE CHIP'S READ — a PURE read in main: it decrypts nothing and opens no
   *  bolt session. Pollable, which is not a reason to poll it. */
  memoryStatus: (projectId: string): Promise<MemoryStatusResponse> =>
    ipcRenderer.invoke(IpcChannel.MemoryStatus, { project_id: projectId }),

  configureMemory: (
    projectId: string,
    mode: MemoryModeWire,
    authMode: MemoryAuthModeWire,
    boltUri: string,
    databaseName: string
  ): Promise<MemoryConfigureResponse> =>
    ipcRenderer.invoke(IpcChannel.MemoryConfigure, {
      project_id: projectId,
      mode,
      auth_mode: authMode,
      bolt_uri: boltUri,
      database_name: databaseName
    }),

  /** ⚠ REMOVES THE CONFIG, NOT THE GRAPH. No Neo4j data is destroyed. */
  disableMemory: (projectId: string): Promise<MemoryDisableResponse> =>
    ipcRenderer.invoke(IpcChannel.MemoryDisable, { project_id: projectId }),

  /** ⚠ ONE live connect, and only ever from a click (D58). */
  testMemory: (projectId: string): Promise<MemoryTestResponse> =>
    ipcRenderer.invoke(IpcChannel.MemoryTest, { project_id: projectId }),

  /** ⚠ IT WRITES. A click, never a boot hook or a timer (D58). */
  seedMemory: (projectId: string): Promise<MemorySeedResponse> =>
    ipcRenderer.invoke(IpcChannel.MemorySeed, { project_id: projectId }),

  /** The provenance count — always the pair and its denominator (D55). */
  validateMemory: (projectId: string): Promise<MemoryValidateResponse> =>
    ipcRenderer.invoke(IpcChannel.MemoryValidate, { project_id: projectId }),

  /** Task 6a-2: walk this project's files and recent commits into the graph's
   *  structural namespace. User-initiated; slow enough to need a pending state
   *  (it spawns git and writes in batches). */
  indexMemory: (projectId: string): Promise<MemoryIndexResponse> =>
    ipcRenderer.invoke(IpcChannel.MemoryIndex, { project_id: projectId }),

  /** Task 6b-3 (D170(b)): how fresh the structural index is — the commit the
   *  graph was built at, its age, and whether the checkout has moved since.
   *  User-initiated (the settings screen's mount, and after an index); never a
   *  timer. Same zero-Zod forwarder shape as every sibling here. */
  memoryFreshness: (projectId: string): Promise<MemoryFreshnessResponse> =>
    ipcRenderer.invoke(IpcChannel.MemoryFreshness, { project_id: projectId }),

  /* ─────────────────── Task 6a-4: the provisioner ────────────────────────
   *
   * ⚠ THIN FORWARDERS, AND NOTHING ELSE — no validation here (Zod under this
   * app's CSP throws `EvalError` in preload and silently drops the event; D1),
   * no defaulting, no branching. Main validates; this only carries.
   *
   * ⚠ EVERY ARGUMENT IS A PRIMITIVE, so the object built here is a plain one.
   * A reactive Pinia value passed straight through would fail structured clone
   * with "An object could not be cloned" and no compile-time signal (D14). */

  /** ⚠ SLOW ON FIRST USE: it may pull ~600 MB. Callers must render a pending
   *  state rather than awaiting it inside a click handler that looks instant. */
  provisionMemory: (projectId: string): Promise<MemoryProvisionResponse> =>
    ipcRenderer.invoke(IpcChannel.MemoryProvision, { project_id: projectId }),

  memoryContainerStatus: (projectId: string): Promise<MemoryContainerStatusResponse> =>
    ipcRenderer.invoke(IpcChannel.MemoryContainerStatus, { project_id: projectId }),

  memoryContainerStart: (projectId: string): Promise<MemoryContainerStatusResponse> =>
    ipcRenderer.invoke(IpcChannel.MemoryContainerStart, { project_id: projectId }),

  memoryContainerStop: (projectId: string): Promise<MemoryContainerStatusResponse> =>
    ipcRenderer.invoke(IpcChannel.MemoryContainerStop, { project_id: projectId }),

  /** ⚠ `typedName` IS THE CONFIRMATION AND MAIN CHECKS IT. Passing it from here
   *  is carrying the user's typing, not enforcing anything — the gate lives in
   *  main precisely so a caller that skipped the dialog cannot skip the check
   *  (the `project:delete` D123 precedent). */
  memoryContainerRemove: (
    projectId: string,
    typedName: string
  ): Promise<MemoryContainerRemoveResponse> =>
    ipcRenderer.invoke(IpcChannel.MemoryContainerRemove, {
      project_id: projectId,
      typed_name: typedName
    }),

  /* ───────────────────────── Day report (D153) ───────────────────────── */

  /**
   * Collect one local calendar day of work across every active project.
   *
   * ⚠ THE ZONE COMES FROM HERE, THE RENDERER, because the day being asked
   * about is the one on the USER's clock. Note the sign flip: JavaScript's
   * `getTimezoneOffset()` returns minutes WEST of UTC (+240 for New York in
   * August) and every other party in this feature — git, ISO-8601, the stored
   * column — counts minutes EAST. Negating here means the wire only ever
   * carries the one convention.
   *
   * ⚠ SLOW. It spawns several git processes per repository and may call a
   * model. Callers must render a pending state rather than awaiting it inside
   * a click handler that looks synchronous.
   */
  generateDayReport: (date: string, summarize: boolean): Promise<DayReport> =>
    ipcRenderer.invoke(IpcChannel.DayReportGenerate, {
      date,
      utcOffsetMinutes: -new Date().getTimezoneOffset(),
      summarize
    }),

  /** A stored day, or null when it was never captured. Pure read — spawns
   *  nothing and costs nothing. */
  readDayReport: (date: string): Promise<DayReport | null> =>
    ipcRenderer.invoke(IpcChannel.DayReportRead, { date }),

  /** Dates that have a stored report, newest first. */
  listDayReports: (): Promise<DayReportListResponse> =>
    ipcRenderer.invoke(IpcChannel.DayReportList),

  /** Which credential profile + model write the prose, or null. */
  getDaySummarizer: (): Promise<DaySummarizerGetResponse> =>
    ipcRenderer.invoke(IpcChannel.DayReportSummarizerGet),

  /** Choose the summarizer, or clear it with null. Returns what was STORED. */
  setDaySummarizer: (summarizer: DaySummarizer | null): Promise<DaySummarizerGetResponse> =>
    ipcRenderer.invoke(IpcChannel.DayReportSummarizerSet, { summarizer }),

  writeSession: (sessionId: string, data: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.SessionWrite, { sessionId, data }),

  /** D191: the prompts a human has sent this session this run, newest first.
   *  Fetched when the recall modal opens — there is no push event, because
   *  main holds the ring and a fresh read is always current. */
  sessionPrompts: (sessionId: string): Promise<PromptsResponse> =>
    ipcRenderer.invoke(IpcChannel.SessionPrompts, { sessionId }),

  resizeSession: (sessionId: string, cols: number, rows: number): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.SessionResize, { sessionId, cols, rows }),

  killSession: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.SessionKill, { sessionId }),

  /* Task 2-3: worktree cleanup (D26). */
  listWorktrees: (projectId: string): Promise<WorktreeListResponse> =>
    ipcRenderer.invoke(IpcChannel.WorktreeList, { project_id: projectId }),

  removeWorktree: (req: WorktreeRemoveRequest): Promise<WorktreeRemoveResponse> =>
    ipcRenderer.invoke(IpcChannel.WorktreeRemove, req),

  getWorktreeDirtyFiles: (worktreeId: string): Promise<WorktreeDirtyFilesResponse> =>
    ipcRenderer.invoke(IpcChannel.WorktreeDirtyFiles, { worktreeId }),

  /* Task 2-4: read-only diff summary for the pane header. */
  getWorktreeDiffSummary: (sessionId: string): Promise<WorktreeDiffSummary | null> =>
    ipcRenderer.invoke(IpcChannel.WorktreeDiffSummary, { sessionId }),

  /* Task 3-2: providers + credential vault (D33). The key crosses the bridge
   *  ONCE, inbound, inside create/replace requests; no forwarder ever returns
   *  key material or a key digest (the outbound schemas in main enforce it). */
  listProviders: (): Promise<ProviderListResponse> =>
    ipcRenderer.invoke(IpcChannel.ProviderList, {}),

  createProvider: (request: ProviderCreateRequest): Promise<ProviderCreateResponse> =>
    ipcRenderer.invoke(IpcChannel.ProviderCreate, request),

  updateProvider: (request: ProviderUpdateRequest): Promise<ProviderUpdateResponse> =>
    ipcRenderer.invoke(IpcChannel.ProviderUpdate, request),

  deleteProvider: (providerId: string): Promise<ProviderDeleteResponse> =>
    ipcRenderer.invoke(IpcChannel.ProviderDelete, { id: providerId }),

  listCredentials: (): Promise<CredentialListResponse> =>
    ipcRenderer.invoke(IpcChannel.CredentialList, {}),

  createCredential: (request: CredentialCreateRequest): Promise<CredentialCreateResponse> =>
    ipcRenderer.invoke(IpcChannel.CredentialCreate, request),

  replaceCredential: (request: CredentialReplaceRequest): Promise<CredentialReplaceResponse> =>
    ipcRenderer.invoke(IpcChannel.CredentialReplace, request),

  deleteCredential: (credentialId: string): Promise<CredentialDeleteResponse> =>
    ipcRenderer.invoke(IpcChannel.CredentialDelete, { id: credentialId }),

  /* Task 3-6: ONE live auth probe, fired only by the Test-key button. The
   *  response is a boolean + sanitized message — never key material. */
  testCredential: (credentialId: string): Promise<CredentialTestResponse> =>
    ipcRenderer.invoke(IpcChannel.CredentialTest, { id: credentialId }),

  /* Task 3a-4: the cached model list for one provider, plus its freshness.
   *  A PURE READ — no network call, no decryption. Freshness is computed in
   *  main; the renderer does no date arithmetic. */
  listModels: (providerId: string): Promise<ModelListResponse> =>
    ipcRenderer.invoke(IpcChannel.ModelList, { provider_id: providerId }),

  /* Task 3a-4: ONE live GET <base_url>/models, fired ONLY by the Refresh
   *  button — the app's SECOND key-bearing call (D33 resolution (d)'s
   *  carve-out, widened by exactly this one). `credentialId` is a PROFILE ID
   *  or null; null is the unauthenticated path, which is a shipped behaviour
   *  and not a fallback. A key never crosses this bridge in either
   *  direction. */
  refreshModels: (providerId: string, credentialId: string | null): Promise<ModelRefreshResponse> =>
    ipcRenderer.invoke(IpcChannel.ModelRefresh, {
      provider_id: providerId,
      credential_id: credentialId
    }),

  /* D85: the model shortlist. ⚠ NOTE WHAT THIS ONE IS NOT — unlike the
   *  refresher directly above it, this carries NO credential, makes NO network
   *  call and cannot spend a cent. It is a local write of the user's own
   *  choice, and it sits here beside its noisy neighbour precisely so a reader
   *  sees the difference. */
  setModelShortlisted: (
    providerId: string,
    modelId: string,
    shortlisted: boolean
  ): Promise<ModelShortlistSetResponse> =>
    ipcRenderer.invoke(IpcChannel.ModelShortlistSet, {
      provider_id: providerId,
      model_id: modelId,
      shortlisted
    }),

  /* Task 3a-5 / D43: launch profiles. Zero-Zod typed forwarders, like every
   *  other channel — a preload Zod import throws EvalError under CSP and
   *  silently drops events (D1). Every one of these carries IDS AND LABELS
   *  ONLY; no key crosses this bridge in either direction. */
  listLaunchProfiles: (): Promise<LaunchProfileListResponse> =>
    ipcRenderer.invoke(IpcChannel.LaunchProfileList, {}),
  createLaunchProfile: (
    request: LaunchProfileCreateRequest
  ): Promise<LaunchProfileCreateResponse> =>
    ipcRenderer.invoke(IpcChannel.LaunchProfileCreate, request),
  updateLaunchProfile: (
    request: LaunchProfileUpdateRequest
  ): Promise<LaunchProfileUpdateResponse> =>
    ipcRenderer.invoke(IpcChannel.LaunchProfileUpdate, request),
  deleteLaunchProfile: (id: string): Promise<LaunchProfileDeleteResponse> =>
    ipcRenderer.invoke(IpcChannel.LaunchProfileDelete, { id }),

  /* Task 3b-2 / D62: council members. Zero-Zod typed forwarders, like every
   *  other channel — a preload Zod import throws EvalError under CSP and
   *  silently drops events (D1). Every one of these carries IDS AND LABELS
   *  ONLY; no key crosses this bridge in either direction, and NO BASE URL and
   *  NO PROVIDER ID does either — a member names its route by naming a
   *  credential (D48). None of them makes an API call or spends anything. */
  listCouncilMembers: (): Promise<CouncilMemberListResponse> =>
    ipcRenderer.invoke(IpcChannel.CouncilMemberList, {}),
  createCouncilMember: (
    request: CouncilMemberCreateRequest
  ): Promise<CouncilMemberCreateResponse> =>
    ipcRenderer.invoke(IpcChannel.CouncilMemberCreate, request),
  updateCouncilMember: (
    request: CouncilMemberUpdateRequest
  ): Promise<CouncilMemberUpdateResponse> =>
    ipcRenderer.invoke(IpcChannel.CouncilMemberUpdate, request),
  deleteCouncilMember: (id: string): Promise<CouncilMemberDeleteResponse> =>
    ipcRenderer.invoke(IpcChannel.CouncilMemberDelete, { id }),

  /* Task 3a-5 / D53: relaunch a session healed to `exited` because it held a
   *  credential. ⚠ This is a USER GESTURE and the only launch-credential
   *  decrypt 3a-5 adds — restore stays decision (b) and decrypts nothing. */
  relaunchSession: (sessionId: string): Promise<RelaunchResponse> =>
    ipcRenderer.invoke(IpcChannel.SessionRelaunch, { sessionId }),

  /* Task 3a-2: attention capture (spec §5.3). `reportAttention` is write-only
   *  inbound and EDGE-TRIGGERED — App.vue sends only when one of the four
   *  reported facts actually changes, never on a timer. The clock itself lives
   *  in main; the renderer has none. */
  reportAttention: (report: AttentionReport): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.AttentionReport, report),

  /* No `minutes` comes back — the response carries samples + byClass +
   *  expectedSamples + coveragePct, and minutes are derived from them. */
  getAttentionSummary: (projectId: string, from: string, to: string): Promise<AttentionSummary> =>
    ipcRenderer.invoke(IpcChannel.AttentionSummary, { project_id: projectId, from, to }),

  /* Task 3a-3: "% of spend attributed" (D42). Account-scoped, not
   *  project-scoped — a minted key's spend has no project dimension. No
   *  percentage comes back without its denominators, and NO FIELD ON THIS
   *  RESPONSE CAN CARRY KEY MATERIAL: not the minted key, not its hash, not the
   *  management key. Main's outbound .parse is what enforces both. */
  getAttributionSummary: (from: string, to: string): Promise<AttributionSummary> =>
    ipcRenderer.invoke(IpcChannel.AttributionSummary, { from, to }),

  /** Task 3b-4: the native brief picker. Main runs the dialog; the renderer
   *  never enumerates the filesystem itself and there is no `fs` on this side
   *  of the bridge. Cancel comes back as `{ cancelled: true }`. */
  pickCouncilBrief: (): Promise<CouncilPickBriefResponse> =>
    ipcRenderer.invoke(IpcChannel.CouncilPickBrief, {}),

  /** Task 3b-3, amended by 3b-4: run a council deliberation. ⚠ It carries the
   *  brief's PATH; main opens it, validates it and derives the findings path
   *  from it. Nothing on this request or its response can carry key material in
   *  either direction. */
  startCouncilRun: (req: CouncilStartRequest): Promise<CouncilStartResponse> =>
    ipcRenderer.invoke(IpcChannel.CouncilStart, req),

  cancelCouncilRun: (req: CouncilCancelRequest): Promise<CouncilCancelResponse> =>
    ipcRenderer.invoke(IpcChannel.CouncilCancel, req),

  /** D97 / Task 3e-4: read a stored run's transcript. READ-ONLY — there is no
   *  companion that writes or deletes, and no Zod here (it throws `EvalError`
   *  under this app's CSP and silently drops events; validation lives in main,
   *  on both sides of this call). */
  getCouncilTranscript: (req: CouncilTranscriptRequest): Promise<CouncilTranscriptResponse> =>
    ipcRenderer.invoke(IpcChannel.CouncilTranscript, req),

  /** The Docket (D112–D115): one project's council history, newest first. Takes a
   *  project id and nothing else — `case_id` does not exist yet and a folder path
   *  may never be a join key (CR-3f.1 A1). */
  getCouncilDocket: (req: CouncilDocketRequest): Promise<CouncilDocketResponse> =>
    ipcRenderer.invoke(IpcChannel.CouncilDocket, req),

  /** A stored run's findings document, read off disk by main. ⚠ The sibling of
   *  `getCouncilTranscript`: that one returns what the members SAID, this one
   *  what the council DECIDED. A missing file comes back as a stated reason with
   *  the path it looked in, never as a rejected promise. */
  getCouncilFindings: (req: CouncilFindingsRequest): Promise<CouncilFindingsResponse> =>
    ipcRenderer.invoke(IpcChannel.CouncilFindings, req),

  /** "Remove from Docket" (D109) — ⚠ THE ONLY COUNCIL WRITE ON THIS BRIDGE, and
   *  it deletes DATABASE ROWS ONLY. It takes a run id; no path is reachable from
   *  it, and the findings document on disk is left where it is. */
  forgetCouncilRun: (req: CouncilForgetRunRequest): Promise<CouncilForgetRunResponse> =>
    ipcRenderer.invoke(IpcChannel.CouncilForgetRun, req),

  /** The Verdict strip (D106): what the members concluded and what the arbiter
   *  ruled, per question. ⚠ DERIVED FROM STORED TURNS ON EVERY READ — no column
   *  holds it, which is why it needed no migration. */
  getCouncilVerdict: (req: CouncilVerdictRequest): Promise<CouncilVerdictResponse> =>
    ipcRenderer.invoke(IpcChannel.CouncilVerdict, req),

  /** "A run exists and can now be cancelled", fired once at the mint.
   *
   *  ⚠ IT IS THE ONLY THING THAT MAKES CANCEL REACHABLE EARLY IN A RUN.
   *  `startCouncilRun` above does not resolve until the deliberation is over, so
   *  the run id on its response is minutes too late to cancel with; the first
   *  progress delta waits on a member's first token, which is itself minutes.
   *  Same register/return-the-unsubscribe shape as every other listener here. */
  onCouncilOpened: (callback: (event: CouncilOpenedEvent) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: CouncilOpenedEvent): void => {
      callback(payload)
    }
    ipcRenderer.on(IpcChannel.CouncilOpened, listener)
    return () => ipcRenderer.removeListener(IpcChannel.CouncilOpened, listener)
  },

  /** Live deliberation deltas. The text is already SCRUBBED — it comes from
   *  main's `SessionOutput`, never from the raw model stream. */
  onCouncilProgress: (callback: (event: CouncilProgressEvent) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: CouncilProgressEvent): void => {
      callback(payload)
    }
    ipcRenderer.on(IpcChannel.CouncilProgress, listener)
    return () => ipcRenderer.removeListener(IpcChannel.CouncilProgress, listener)
  },

  /** The at-a-glance vector, once, when the positions round closes. Same
   *  register/return-the-unsubscribe shape as every other listener here — and no
   *  Zod on this side either, for the CSP reason above: it throws `EvalError`
   *  under this app's policy and silently drops the event. Main validates on the
   *  way out. */
  onCouncilSummary: (callback: (event: CouncilSummaryEvent) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: CouncilSummaryEvent): void => {
      callback(payload)
    }
    ipcRenderer.on(IpcChannel.CouncilSummary, listener)
    return () => ipcRenderer.removeListener(IpcChannel.CouncilSummary, listener)
  },

  onSessionData: (callback: (event: SessionDataEvent) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: SessionDataEvent): void => {
      callback(payload)
    }
    ipcRenderer.on(IpcChannel.SessionData, listener)
    return () => ipcRenderer.removeListener(IpcChannel.SessionData, listener)
  },

  onSessionExit: (callback: (event: SessionExitEvent) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: SessionExitEvent): void => {
      callback(payload)
    }
    ipcRenderer.on(IpcChannel.SessionExit, listener)
    return () => ipcRenderer.removeListener(IpcChannel.SessionExit, listener)
  },

  onSessionRestored: (callback: (event: SessionRestoredEvent) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: SessionRestoredEvent): void => {
      callback(payload)
    }
    ipcRenderer.on(IpcChannel.SessionRestored, listener)
    return () => ipcRenderer.removeListener(IpcChannel.SessionRestored, listener)
  },

  /* The agent's own account of what it is doing, off the hook listener. Same
   * zero-Zod forwarder shape as its three siblings above (D1: a preload Zod
   * import throws EvalError under the page CSP and silently drops events —
   * both directions are validated in MAIN instead). */
  onSessionActivity: (callback: (event: SessionActivityEvent) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: SessionActivityEvent): void => {
      callback(payload)
    }
    ipcRenderer.on(IpcChannel.SessionActivity, listener)
    return () => ipcRenderer.removeListener(IpcChannel.SessionActivity, listener)
  },

  getSessionActivities: (): Promise<SessionActivityListResponse> =>
    ipcRenderer.invoke(IpcChannel.SessionActivityList),

  /* The rail's per-project roll-up. Same zero-Zod forwarder shape as its
   * siblings above (D1) — main validates both directions. The payload is the
   * COMPLETE list of lit projects every time, so the renderer replaces its map
   * rather than merging, and a project going quiet clears by absence. */
  onProjectAttention: (callback: (event: ProjectAttentionList) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: ProjectAttentionList): void => {
      callback(payload)
    }
    ipcRenderer.on(IpcChannel.ProjectAttention, listener)
    return () => ipcRenderer.removeListener(IpcChannel.ProjectAttention, listener)
  },

  getProjectAttention: (): Promise<ProjectAttentionList> =>
    ipcRenderer.invoke(IpcChannel.ProjectAttentionList),
  /* v16: context-window usage, and the agent lock. Same zero-Zod forwarder
   * shape as everything above (D1: a preload Zod import throws EvalError under
   * the page CSP and silently drops events — validated in MAIN instead). */
  onSessionContext: (callback: (event: SessionContextEvent) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: SessionContextEvent): void => {
      callback(payload)
    }
    ipcRenderer.on(IpcChannel.SessionContext, listener)
    return () => ipcRenderer.removeListener(IpcChannel.SessionContext, listener)
  },

  getSessionContexts: (): Promise<SessionContextListResponse> =>
    ipcRenderer.invoke(IpcChannel.SessionContextList),

  /* Task 6b-1 (D168): the memory-usage counter. Same zero-Zod forwarder shape
   * as every sibling above (D1: a preload Zod import throws EvalError under the
   * page CSP and silently drops events — validated in MAIN instead). No cold
   * read, by decision — see `IpcChannel.SessionMemory`. */
  onSessionMemory: (callback: (event: SessionMemoryEvent) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: SessionMemoryEvent): void => {
      callback(payload)
    }
    ipcRenderer.on(IpcChannel.SessionMemory, listener)
    return () => ipcRenderer.removeListener(IpcChannel.SessionMemory, listener)
  },

  /* Task 6b-2 (D169): did the graph answer when this session launched, and was
   * the memory contract therefore sent? Same zero-Zod forwarder shape as every
   * sibling above (D1: a preload Zod import throws EvalError under the page CSP
   * and silently drops events — validated in MAIN instead). No cold read: the
   * fact has main-memory lifetime by design, and a launch that happened before
   * a renderer reload is not a launch this window can honestly report on. */
  onMemoryLaunch: (callback: (event: MemoryLaunchEvent) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: MemoryLaunchEvent): void => {
      callback(payload)
    }
    ipcRenderer.on(IpcChannel.MemoryLaunch, listener)
    return () => ipcRenderer.removeListener(IpcChannel.MemoryLaunch, listener)
  },

  /** ⚠ THE PIN TRAVELS AS A PARAMETER AND IS NEVER RETURNED. Write-only
   *  inbound, the `createCredential` posture (D33 clause 3) in its small
   *  shape — main verifies and answers with a refusal or a boolean. */
  setSessionLocked: (req: SessionSetLockedRequest): Promise<SessionSetLockedResponse> =>
    ipcRenderer.invoke(IpcChannel.SessionSetLocked, req),

  getAgentLockPinStatus: (): Promise<AgentLockPinStatus> =>
    ipcRenderer.invoke(IpcChannel.AgentLockPinStatus),

  setAgentLockPin: (pin: string): Promise<AgentLockPinMutateResponse> =>
    ipcRenderer.invoke(IpcChannel.AgentLockPinSet, { pin }),

  clearAgentLockPin: (): Promise<AgentLockPinMutateResponse> =>
    ipcRenderer.invoke(IpcChannel.AgentLockPinClear),

  /* Task 3c-2 / D74: window controls. `frame: false` took the native buttons
   * away, so these four forwarders are how the titlebar asks main to do what
   * the OS chrome used to do. Zero-Zod like every other forwarder here (a
   * preload Zod import throws EvalError under the page CSP and silently drops
   * events — D1). They carry a single boolean and nothing else. */
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke(IpcChannel.WindowMinimize),

  /** Returns the NEW state, so the titlebar's icon settles on the click that
   *  caused it rather than waiting a frame for the event below. */
  toggleMaximizeWindow: (): Promise<WindowMaximized> =>
    ipcRenderer.invoke(IpcChannel.WindowToggleMaximize),

  closeWindow: (): Promise<void> => ipcRenderer.invoke(IpcChannel.WindowClose),

  /** ⚠ The event the restore icon actually depends on. The maximized state
   *  changes by routes the renderer never sees — double-click, Win+↑, Win+↓,
   *  OS snap — and without this subscription the icon desyncs from the window.
   *  Returns its own unsubscribe, the `onSessionData` pattern, so the consumer
   *  can release it on unmount (F13). */
  onWindowMaximizedChanged: (callback: (event: WindowMaximized) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: WindowMaximized): void => {
      callback(payload)
    }
    ipcRenderer.on(IpcChannel.WindowMaximizedChanged, listener)
    return () => ipcRenderer.removeListener(IpcChannel.WindowMaximizedChanged, listener)
  },

  /* ══════════════════ Voice capture (Phase 5, Task 5-1) ══════════════════
   * Same zero-Zod forwarder shape as everything above (D1: a preload Zod import
   * throws EvalError under the page CSP and silently drops events — validated in
   * MAIN instead). */
  startVoiceCapture: (): Promise<VoiceCaptureStartResponse> =>
    ipcRenderer.invoke(IpcChannel.VoiceCaptureStart),

  /**
   * ⚠ `send`, NOT `invoke`, AND IT IS THE ONLY FORWARDER IN THIS FILE THAT IS.
   * At ~16 frames/second an `invoke` would allocate a promise and await a
   * main-process round trip per frame, for a reply nobody reads. It returns
   * `void` for the same reason: there is nothing to await, and a signature that
   * returned a promise would invite a caller to await one.
   *
   * ⚠ THE FRAME MUST BE A REAL `Int16Array`, NOT A REACTIVE PROXY AROUND ONE
   * (D14). `capture.ts` builds one fresh per frame and calls straight through to
   * here. A frame that has been parked in a Pinia store and forwarded from there
   * fails structured clone with "An object could not be cloned" — at runtime,
   * with NO compile-time signal, which is why this is written at the boundary
   * rather than only at the producer.
   */
  sendVoiceFrame: (frame: VoiceFrame): void => {
    ipcRenderer.send(IpcChannel.VoiceCaptureFrame, frame)
  },

  stopVoiceCapture: (captureId: string): Promise<VoiceCaptureStopResponse> =>
    ipcRenderer.invoke(IpcChannel.VoiceCaptureStop, { captureId }),

  /** Returns its own unsubscribe, the `onSessionData` pattern, so the consumer
   *  can release it on unmount (F13). */
  onVoiceState: (callback: (event: VoiceStateEvent) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: VoiceStateEvent): void => {
      callback(payload)
    }
    ipcRenderer.on(IpcChannel.VoiceState, listener)
    return () => ipcRenderer.removeListener(IpcChannel.VoiceState, listener)
  },

  /* ══ Voice activation and targeting (Task 5-3) ══ */

  /** Report which pane holds DOM focus, so a capture started by the GLOBAL
   *  hotkey knows what to aim at. See the channel's note for why this is a push
   *  from the renderer and not a read of `focusedSessionId`. */
  setVoiceTarget: (sessionId: string | null, title: string | null): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.VoiceTargetSet, { sessionId, title }),

  /** Which pane wears the dictation ring. Pushed from MAIN, because main owns
   *  the target for the capture's lifetime — the ring must show what will
   *  actually be written to. Returns its own unsubscribe (F13). */
  onVoiceTarget: (callback: (event: VoiceTarget) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: VoiceTarget): void => {
      callback(payload)
    }
    ipcRenderer.on(IpcChannel.VoiceTarget, listener)
    return () => ipcRenderer.removeListener(IpcChannel.VoiceTarget, listener)
  },

  /** Is push-to-talk available? A `false` is a supported state, not an error —
   *  click-to-talk is a peer route and is unaffected either way. */
  getVoiceHotkeyStatus: (): Promise<VoiceHotkeyStatus> =>
    ipcRenderer.invoke(IpcChannel.VoiceHotkeyStatus),

  /**
   * Drag the dictation overlay (D181). `dx`/`dy` are how far the POINTER has
   * travelled since the gesture began, not since the last message — see the
   * channel's note for why cumulative is what makes a dropped update harmless.
   *
   * ⚠ THE SECOND `send` ON THIS BRIDGE, after `sendVoiceFrame`, and for the
   * same reasons: pointer-rate, latest-wins, no reply anyone reads.
   */
  moveVoiceOverlay: (dx: number, dy: number, start: boolean): void => {
    ipcRenderer.send(IpcChannel.VoiceOverlayMove, { dx, dy, start })
  },

  /* ══ Voice settings (Task 5-4) — a dedicated group, not a key/value bag ══ */

  /** The whole voice settings object (or the defaults). */
  getVoiceSettings: (): Promise<VoiceSettingsResponse> =>
    ipcRenderer.invoke(IpcChannel.VoiceSettingsGet),

  /** Replace the voice settings. Returns what was STORED, and ok:false with a
   *  reason when main refused (an unparseable hotkey). Applied live. */
  setVoiceSettings: (settings: VoiceSettings): Promise<VoiceSettingsResponse> =>
    ipcRenderer.invoke(IpcChannel.VoiceSettingsSet, { settings }),

  /** Which whisper models are on disk, with their exact sizes. */
  getVoiceModelStatus: (): Promise<VoiceModelStatusResponse> =>
    ipcRenderer.invoke(IpcChannel.VoiceModelStatus)
}

export type ChorusApi = typeof chorusApi

contextBridge.exposeInMainWorld('chorus', chorusApi)

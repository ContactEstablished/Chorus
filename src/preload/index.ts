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
  type ProjectsList,
  type ProjectUpdateRequest,
  type ProjectUpdateResponse,
  type ProviderCreateRequest,
  type ProviderCreateResponse,
  type ProviderDeleteResponse,
  type ProviderListResponse,
  type ProviderUpdateRequest,
  type ProviderUpdateResponse,
  type RestartResponse,
  type SessionDataEvent,
  type SessionExitEvent,
  type SessionRestoredEvent,
  type ViewState,
  type WindowMaximized,
  type WorktreeListResponse,
  type WorktreeRemoveRequest,
  type WorktreeRemoveResponse,
  type WorktreeDirtyFilesResponse,
  type WorktreeDiffSummary
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

  detectClis: (): Promise<CliDetectResponse> => ipcRenderer.invoke(IpcChannel.CliDetect, {}),

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

  writeSession: (sessionId: string, data: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.SessionWrite, { sessionId, data }),

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
  }
}

export type ChorusApi = typeof chorusApi

contextBridge.exposeInMainWorld('chorus', chorusApi)

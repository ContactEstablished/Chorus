import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IpcChannel,
  type AttachRequest,
  type AttachResponse,
  type CliDetectResponse,
  type LaunchRequest,
  type LaunchResponse,
  type LaunchContextResponse,
  type LayoutGetResponse,
  type LayoutSetRequest,
  type ProjectAddResponse,
  type ProjectsList,
  type RestartResponse,
  type SessionDataEvent,
  type SessionExitEvent,
  type SessionRestoredEvent,
  type ViewState
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

  writeSession: (sessionId: string, data: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.SessionWrite, { sessionId, data }),

  resizeSession: (sessionId: string, cols: number, rows: number): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.SessionResize, { sessionId, cols, rows }),

  killSession: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.SessionKill, { sessionId }),

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
  }
}

export type ChorusApi = typeof chorusApi

contextBridge.exposeInMainWorld('chorus', chorusApi)

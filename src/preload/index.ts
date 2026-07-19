import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IpcChannel,
  type AgentKind,
  type AttachResponse,
  type CliDetectResponse,
  type LayoutGetResponse,
  type SessionDataEvent,
  type SessionExitEvent
} from '../shared/ipc'

/**
 * Narrow, typed surface exposed to the renderer. No generic ipcRenderer
 * passthrough — only these six session operations exist.
 *
 * NOTE: no Zod here. The preload runs under the page CSP (no unsafe-eval),
 * which Zod's compiled parsers violate (EvalError). All validation happens in
 * the main process: renderer -> main payloads are parsed in the IPC handlers,
 * and main -> renderer events are validated in main before sending.
 */
const chorusApi = {
  attachSession: (agent: AgentKind): Promise<AttachResponse> =>
    ipcRenderer.invoke(IpcChannel.SessionAttach, { agent }),

  detectClis: (): Promise<CliDetectResponse> => ipcRenderer.invoke(IpcChannel.CliDetect, {}),

  getLayout: (): Promise<LayoutGetResponse> => ipcRenderer.invoke(IpcChannel.LayoutGet, {}),

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
  }
}

export type ChorusApi = typeof chorusApi

contextBridge.exposeInMainWorld('chorus', chorusApi)

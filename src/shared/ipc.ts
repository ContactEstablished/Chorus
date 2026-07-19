import { z } from 'zod'

/**
 * IPC contract between renderer and main.
 *
 * Every payload crossing the boundary is described here with a Zod schema.
 * Main parses all renderer -> main payloads before acting on them.
 */

export const IpcChannel = {
  /** invoke: attach to (or lazily start) an agent's session */
  SessionAttach: 'session:attach',
  /** invoke: keyboard input from the renderer -> PTY stdin */
  SessionWrite: 'session:write',
  /** invoke: terminal geometry change -> pty.resize */
  SessionResize: 'session:resize',
  /** invoke: kill a live session's PTY process tree */
  SessionKill: 'session:kill',
  /** event (main -> renderer): PTY output chunk */
  SessionData: 'session:data',
  /** event (main -> renderer): PTY process exited */
  SessionExit: 'session:exit',
  /** invoke: report which agent/tool CLIs are installed */
  CliDetect: 'cli:detect',
  /** invoke: fetch the persisted pane layout for the current project */
  LayoutGet: 'layout:get'
} as const

export const sessionStatusSchema = z.enum(['running', 'exited'])
export type SessionStatus = z.infer<typeof sessionStatusSchema>

/** Agent CLIs Chorus can run. One live session per kind in this phase. */
export const agentKindSchema = z.enum(['claude', 'codex'])
export type AgentKind = z.infer<typeof agentKindSchema>

export const attachRequestSchema = z.object({
  agent: agentKindSchema
})
export type AttachRequest = z.infer<typeof attachRequestSchema>

export const attachResponseSchema = z.object({
  sessionId: z.string().min(1),
  /** replay of recent output so a reloaded renderer repaints the screen */
  buffer: z.string(),
  status: sessionStatusSchema,
  exitCode: z.number().int().nullable()
})
export type AttachResponse = z.infer<typeof attachResponseSchema>

export const writeRequestSchema = z.object({
  sessionId: z.string().min(1),
  data: z.string()
})
export type WriteRequest = z.infer<typeof writeRequestSchema>

export const resizeRequestSchema = z.object({
  sessionId: z.string().min(1),
  cols: z.number().int().min(1).max(1000),
  rows: z.number().int().min(1).max(1000)
})
export type ResizeRequest = z.infer<typeof resizeRequestSchema>

export const killRequestSchema = z.object({
  sessionId: z.string().min(1)
})
export type KillRequest = z.infer<typeof killRequestSchema>

export const sessionDataEventSchema = z.object({
  sessionId: z.string().min(1),
  data: z.string()
})
export type SessionDataEvent = z.infer<typeof sessionDataEventSchema>

export const sessionExitEventSchema = z.object({
  sessionId: z.string().min(1),
  exitCode: z.number().int()
})
export type SessionExitEvent = z.infer<typeof sessionExitEventSchema>

export const cliDetectRequestSchema = z.object({})
export type CliDetectRequest = z.infer<typeof cliDetectRequestSchema>

export const detectedCliSchema = z.object({
  name: z.string().min(1),
  found: z.boolean(),
  /** resolved location on disk (the .exe or the npm shim), null when not found */
  path: z.string().nullable(),
  /** first line of `<tool> --version`; 'unknown' when the tool exists but the probe failed */
  version: z.string().nullable()
})
export type DetectedCli = z.infer<typeof detectedCliSchema>

export const cliDetectResponseSchema = z.array(detectedCliSchema)
export type CliDetectResponse = z.infer<typeof cliDetectResponseSchema>

export const layoutGetRequestSchema = z.object({})
export type LayoutGetRequest = z.infer<typeof layoutGetRequestSchema>

/** One pane slot in the fixed left-to-right split. Also the shape stored in pane_layouts. */
export const paneSchema = z.object({
  slot: z.number().int().min(0),
  agent: agentKindSchema
})
export type Pane = z.infer<typeof paneSchema>

export const layoutGetResponseSchema = z.array(paneSchema)
export type LayoutGetResponse = z.infer<typeof layoutGetResponseSchema>

import { z } from 'zod'

/**
 * IPC contract between renderer and main.
 *
 * Every payload crossing the boundary is described here with a Zod schema.
 * Main parses all renderer -> main payloads before acting on them.
 */

export const IpcChannel = {
  /** invoke: attach to (or lazily start) the singleton session */
  SessionAttach: 'session:attach',
  /** invoke: keyboard input from the renderer -> PTY stdin */
  SessionWrite: 'session:write',
  /** invoke: terminal geometry change -> pty.resize */
  SessionResize: 'session:resize',
  /** event (main -> renderer): PTY output chunk */
  SessionData: 'session:data',
  /** event (main -> renderer): PTY process exited */
  SessionExit: 'session:exit'
} as const

export const sessionStatusSchema = z.enum(['running', 'exited'])
export type SessionStatus = z.infer<typeof sessionStatusSchema>

export const attachRequestSchema = z.object({})
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

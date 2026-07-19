import { z } from 'zod'
import type { LayoutNode } from './layout'

/**
 * IPC contract between renderer and main.
 *
 * Every payload crossing the boundary is described here with a Zod schema.
 * Main parses all renderer -> main payloads before acting on them.
 * (D1: .parse() is called only in the main process — never in preload or
 * renderer, whose CSP forbids the eval Zod compiles parsers with.)
 */

export const IpcChannel = {
  /** invoke: attach to (or lazily start) an agent's session */
  SessionAttach: 'session:attach',
  /** invoke: create a session row + spawn its PTY (launch dialog) */
  SessionLaunch: 'session:launch',
  /** invoke: project root + recent cwds for the launch dialog */
  SessionLaunchContext: 'session:launch-context',
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
  LayoutGet: 'layout:get',
  /** invoke: persist the current pane layout tree (ratio write-back) */
  LayoutSet: 'layout:set'
} as const

export const sessionStatusSchema = z.enum(['running', 'exited'])
export type SessionStatus = z.infer<typeof sessionStatusSchema>

/** Agent CLIs Chorus can run. N concurrent sessions per kind (Task 1-4). */
export const agentKindSchema = z.enum(['claude', 'codex'])
export type AgentKind = z.infer<typeof agentKindSchema>

export const attachRequestSchema = z.object({
  agent: agentKindSchema,
  /** Stable sessions-row id (Task 1-2). Required from Task 1-4 on: attach is
   *  reattach-existing-only and never spawns for an unknown id. */
  sessionId: z.uuid(),
  /** Restart chrome ONLY (Task 1-4): permit respawning a known, exited
   *  session under the same row id. A plain view attach (mount/remount)
   *  leaves it dead — without this gate, Vue remounts resurrect killed
   *  sessions (found at runtime in 1-4). */
  respawn: z.boolean().optional()
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

/**
 * session:launch request. `cwd` is only min(1) here BY DESIGN: the absolute-
 * path + exists checks touch the filesystem and live in the main-process
 * handler, where they are the security boundary — never in a shared schema.
 */
export const launchRequestSchema = z.object({
  agent: agentKindSchema,
  cwd: z.string().min(1)
})
export type LaunchRequest = z.infer<typeof launchRequestSchema>

/** Launch outcome: the attach-style snapshot of the new session, or a
 *  structured validation failure the dialog shows inline. */
export const launchResponseSchema = z.union([
  attachResponseSchema,
  z.object({ ok: z.literal(false), reason: z.string() })
])
export type LaunchResponse = z.infer<typeof launchResponseSchema>

export const launchContextRequestSchema = z.object({})
export type LaunchContextRequest = z.infer<typeof launchContextRequestSchema>

export const launchContextResponseSchema = z.object({
  projectRoot: z.string().min(1),
  /** recent launch cwds, newest first, deduped, capped at 10 in main */
  recentCwds: z.array(z.string())
})
export type LaunchContextResponse = z.infer<typeof launchContextResponseSchema>

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

/**
 * Persisted pane layout: an owned binary split tree (D9 / CR-1.2). Leaves
 * bind a stable sessions-row id, never an agent kind. The discriminated union
 * on `type` stops an internal node masquerading as a leaf; the tuple enforces
 * exactly-2 children at the schema boundary; ratios are bounded on read.
 */
const layoutLeafSchema = z.object({
  type: z.literal('leaf'),
  sessionId: z.string().min(1)
})

export const layoutNodeSchema: z.ZodType<LayoutNode> = z.lazy(() =>
  z.discriminatedUnion('type', [
    layoutLeafSchema,
    z.object({
      type: z.enum(['row', 'column']),
      ratio: z.number().min(0.05).max(0.95),
      children: z.tuple([layoutNodeSchema, layoutNodeSchema])
    })
  ])
)

export const layoutJsonSchema = z.object({
  version: z.literal(1),
  root: layoutNodeSchema
})

/** layout:set payload — the full layout tree, or null to clear it (Task 1-4:
 *  empty layouts are legal; main deletes the pane_layouts row — the row's
 *  ABSENCE is the empty signal, never a null-root wrapper). Parsed in main
 *  only (D1); ratios are re-clamped there before persist (council D9). */
export const layoutSetRequestSchema = layoutJsonSchema.nullable()
export type LayoutSetRequest = z.infer<typeof layoutSetRequestSchema>

export const sessionInfoSchema = z.object({
  id: z.string().min(1),
  agent: agentKindSchema,
  status: sessionStatusSchema
})
export type SessionInfo = z.infer<typeof sessionInfoSchema>

export const layoutGetResponseSchema = z.object({
  /** null when the project has no pane_layouts row (fresh DB or last pane
   *  closed): the renderer shows the empty state (Task 1-4). */
  layout: layoutJsonSchema.nullable(),
  sessions: z.array(sessionInfoSchema)
})
export type LayoutGetResponse = z.infer<typeof layoutGetResponseSchema>

/**
 * Pre-1-2 persisted layout shape (flat slot/agent array). Parsed only by the
 * storage lazy legacy-conversion read path; never crosses IPC.
 */
export const legacyPaneSchema = z.object({
  slot: z.number().int().min(0),
  agent: agentKindSchema
})
export type LegacyPane = z.infer<typeof legacyPaneSchema>
export const legacyFlatLayoutSchema = z.array(legacyPaneSchema)

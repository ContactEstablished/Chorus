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
  /** invoke: project root + recent cwds + repo context (workspace modes, 2-2)
   *  for the launch dialog */
  SessionLaunchContext: 'session:launch-context',
  /** invoke: keyboard input from the renderer -> PTY stdin */
  SessionWrite: 'session:write',
  /** invoke: terminal geometry change -> pty.resize */
  SessionResize: 'session:resize',
  /** invoke: kill a live session's PTY process tree */
  SessionKill: 'session:kill',
  /** invoke: relaunch a session under its existing row id (D16 Q4: THE one
   *  restart path — in-run and post-restart alike; attach never spawns) */
  SessionRestart: 'session:restart',
  /** invoke: delete an exited session's row (pane close; rejects live sessions) */
  SessionDelete: 'session:delete',
  /** invoke: persist a session's captured title (OSC 0/2 or first-line fallback) */
  SessionSetTitle: 'session:set-title',
  /** event (main -> renderer): PTY output chunk */
  SessionData: 'session:data',
  /** event (main -> renderer): PTY process exited */
  SessionExit: 'session:exit',
  /** event (main -> renderer): restore engine relaunched this session (badge) */
  SessionRestored: 'session:restored',
  /** invoke: report which agent/tool CLIs are installed */
  CliDetect: 'cli:detect',
  /** invoke: fetch the persisted pane layout for a project */
  LayoutGet: 'layout:get',
  /** invoke: persist the current pane layout tree (ratio write-back) */
  LayoutSet: 'layout:set',
  /** invoke: read a project's persisted view state (mode + focused session) */
  ViewGet: 'view:get',
  /** invoke: persist a project's view state */
  ViewSet: 'view:set',
  /** invoke: native directory picker -> find-or-create a project (main only) */
  ProjectAdd: 'project:add',
  /** invoke: all projects with the active flag derived from settings */
  ProjectList: 'project:list',
  /** invoke: persist the active project, lazy-restore it, retitle the window */
  ProjectSelect: 'project:select'
} as const

export const sessionStatusSchema = z.enum(['running', 'exited'])
export type SessionStatus = z.infer<typeof sessionStatusSchema>

/** Agent CLIs Chorus can run. N concurrent sessions per kind (Task 1-4). */
export const agentKindSchema = z.enum(['claude', 'codex'])
export type AgentKind = z.infer<typeof agentKindSchema>

export const attachRequestSchema = z.object({
  agent: agentKindSchema,
  /** Stable sessions-row id (Task 1-2). Attach is a PURE VIEW BINDING with no
   *  spawn path at all (Task 1-5/D16: the 1-4 attach-time relaunch gate is
   *  gone — all relaunch goes through session:restart or the restore engine). */
  sessionId: z.uuid()
})
export type AttachRequest = z.infer<typeof attachRequestSchema>

export const attachResponseSchema = z.object({
  sessionId: z.string().min(1),
  /** replay of recent output so a reloaded renderer repaints the screen */
  buffer: z.string(),
  status: sessionStatusSchema,
  exitCode: z.number().int().nullable(),
  /** Restore engine found the row's cwd gone (D16 clause 3): the pane renders
   *  its own "Working directory not found" chrome — never a sentinel exit code. */
  cwdMissing: z.boolean().optional(),
  /** The restore engine has this id queued for a staggered relaunch: the pane
   *  shows a restoring spinner instead of transient exited chrome. */
  restorePending: z.boolean().optional(),
  /** The restore engine relaunched this session and no pane has attached
   *  since: the first attach to report it wears the transient "new
   *  conversation" badge (consumed on report — exactly one badge per relaunch,
   *  immune to how late the pane mounts). */
  restored: z.boolean().optional(),
  /** 1b-1: seed the header on attach. Required-NULLABLE (not .optional()) so a
   *  producer that forgets it fails the outbound parse loudly. */
  title: z.string().nullable(),
  /** 2-2: the session's worktree branch, or null for current-tree sessions.
   *  Required-nullable, same discipline as title. Resolved in main from the
   *  WORKTREES side (worktrees.session_id — F18 resolution a), so a
   *  crash-window NULL sessions.worktree_id never hides the label. */
  branch: z.string().nullable()
})
export type AttachResponse = z.infer<typeof attachResponseSchema>

/* ------------------------------------------------------------------ */
/* Task 2-2: workspace modes (D22 + D26f)                              */
/* ------------------------------------------------------------------ */

/** The three workspace modes a launch can run in (D22; read-only deferred to
 *  Phase 3+). The mode ALWAYS travels explicitly in the launch payload — main
 *  computes a suggestion for the dialog and validates the chosen mode at
 *  launch, but never silently substitutes one mode for another. */
export const workspaceModeSchema = z.enum(['current-tree', 'new-worktree', 'existing-worktree'])
export type WorkspaceMode = z.infer<typeof workspaceModeSchema>

/** A worktree the existing-worktree picker can offer: `detached`, or `active`
 *  with no live owning session (main computes attachability — the picker is a
 *  view of main's verdict, never its own authority). */
export const pickableWorktreeSchema = z.object({
  id: z.uuid(),
  branch: z.string(),
  path: z.string(),
  status: z.string()
})
export type PickableWorktree = z.infer<typeof pickableWorktreeSchema>

/** The D26(f) suggestion rule, factored pure for the unit test: a non-git
 *  project root offers only current-tree; ≥1 OTHER live session already
 *  writing the same repo flips the dialog DEFAULT to new-worktree; anything
 *  else stays current-tree. A suggestion only — the chosen mode is
 *  re-validated against the actual cwd at launch. */
export function suggestMode(repoRoot: string | null, liveSessionsInRepo: number): WorkspaceMode {
  if (repoRoot === null) return 'current-tree'
  return liveSessionsInRepo >= 1 ? 'new-worktree' : 'current-tree'
}

/**
 * session:launch request. `cwd` is only min(1) here BY DESIGN: the absolute-
 * path + exists checks touch the filesystem and live in the main-process
 * handler, where they are the security boundary — never in a shared schema.
 */
export const launchRequestSchema = z.object({
  /** Task 1-5: every handler resolves the project per-request (validated here
   *  as a uuid, FK-checked against the projects table in main). */
  project_id: z.uuid(),
  agent: agentKindSchema,
  cwd: z.string().min(1),
  /** 2-2: the chosen workspace mode — REQUIRED, always explicit (D22). */
  workspace_mode: workspaceModeSchema,
  /** The existing-worktree pick. Required-when-existing is enforced in MAIN
   *  (an {ok:false} inline reason), not by schema branching; absent/ignored
   *  for current-tree and new-worktree. */
  worktree_id: z.uuid().optional()
})
export type LaunchRequest = z.infer<typeof launchRequestSchema>

/** Launch outcome: the attach-style snapshot of the new session, or a
 *  structured validation failure the dialog shows inline. */
export const launchResponseSchema = z.union([
  attachResponseSchema,
  z.object({ ok: z.literal(false), reason: z.string() })
])
export type LaunchResponse = z.infer<typeof launchResponseSchema>

export const launchContextRequestSchema = z.object({ project_id: z.uuid() })
export type LaunchContextRequest = z.infer<typeof launchContextRequestSchema>

export const launchContextResponseSchema = z.object({
  projectRoot: z.string().min(1),
  /** recent launch cwds, newest first, deduped, capped at 10 in main */
  recentCwds: z.array(z.string()),
  /** 2-2: git toplevel of projectRoot (resolveRepoRoot's forward-slash form);
   *  null when the project root is not inside a git repo — the dialog then
   *  offers only current-tree (findings risk 3). */
  repoRoot: z.string().nullable(),
  /** 2-2: OTHER live sessions whose cwd resolves to repoRoot (D26f). */
  liveSessionsInRepo: z.number().int(),
  /** 2-2: main's dialog default (D26f) — a suggestion, never an override. */
  suggestedMode: workspaceModeSchema,
  /** 2-2: attachable worktrees for the existing-worktree picker. */
  worktrees: z.array(pickableWorktreeSchema)
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

export const layoutGetRequestSchema = z.object({ project_id: z.uuid() })
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

/** layout:set payload — the target project plus the full layout tree, or a
 *  null tree to clear it (Task 1-4: empty layouts are legal; main deletes the
 *  pane_layouts row — the row's ABSENCE is the empty signal, never a null-root
 *  wrapper). Parsed in main only (D1); ratios are re-clamped there before
 *  persist (council D9). */
export const layoutSetRequestSchema = z.object({
  project_id: z.uuid(),
  layout: layoutJsonSchema.nullable()
})
export type LayoutSetRequest = z.infer<typeof layoutSetRequestSchema>

export const sessionInfoSchema = z.object({
  id: z.string().min(1),
  agent: agentKindSchema,
  status: sessionStatusSchema,
  /** 1b-1: required-nullable, same discipline as attachResponseSchema.title —
   *  every view reads the title from the same round-trip. */
  title: z.string().nullable(),
  /** 1b-2: SessionRow.created_at (ISO text) passes through so filmstrip cards
   *  can compute elapsed-since-launch. */
  createdAt: z.string(),
  /** 1b-2: exit code for the card status dot (exited-ok vs exited-error) —
   *  cards never attach, so this row is their ONLY status source. */
  exitCode: z.number().int().nullable(),
  /** 2-2: worktree branch for card/pane labels, null for current-tree
   *  sessions. Required-nullable, same discipline as title. */
  branch: z.string().nullable()
})
export type SessionInfo = z.infer<typeof sessionInfoSchema>

export const layoutGetResponseSchema = z.object({
  /** null when the project has no pane_layouts row (fresh DB or last pane
   *  closed): the renderer shows the empty state (Task 1-4). */
  layout: layoutJsonSchema.nullable(),
  sessions: z.array(sessionInfoSchema)
})
export type LayoutGetResponse = z.infer<typeof layoutGetResponseSchema>

/* ------------------------------------------------------------------ */
/* Task 1b-2: per-project view state (D20)                             */
/* ------------------------------------------------------------------ */

export const viewModeSchema = z.enum(['filmstrip', 'grid'])
export type ViewMode = z.infer<typeof viewModeSchema>

/** Per-project workspace view state (D20): which renderer is active and which
 *  session the filmstrip focuses. `focusedSessionId` is a nullable string
 *  ONLY — never FK-checked against sessions. It legitimately outlives its
 *  session (F4); views resolve staleness by falling back to the first leaf.
 *  Schema validity ≠ liveness. */
export const viewStateSchema = z.object({
  mode: viewModeSchema,
  focusedSessionId: z.string().nullable()
})
export type ViewState = z.infer<typeof viewStateSchema>

export const viewGetRequestSchema = z.object({ project_id: z.uuid() })
export type ViewGetRequest = z.infer<typeof viewGetRequestSchema>

export const viewSetRequestSchema = z.object({
  project_id: z.uuid(),
  state: viewStateSchema
})
export type ViewSetRequest = z.infer<typeof viewSetRequestSchema>

/* ------------------------------------------------------------------ */
/* Task 1-5: project tabs + D16 restore contract                       */
/* ------------------------------------------------------------------ */

/** A projects-table row as it crosses IPC (snake_case root_path, matching the
 *  DB column; main maps its internal ProjectRecord). */
export const projectSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  root_path: z.string()
})
export type Project = z.infer<typeof projectSchema>

/** project:add — the renderer sends nothing; main runs the native directory
 *  picker (D3: dialog.showOpenDialog never leaves the main process). */
export const projectAddRequestSchema = z.object({})
export type ProjectAddRequest = z.infer<typeof projectAddRequestSchema>

export const projectAddResponseSchema = z.union([
  z.object({ project: projectSchema }),
  z.object({ cancelled: z.literal(true) })
])
export type ProjectAddResponse = z.infer<typeof projectAddResponseSchema>

export const projectsListSchema = z.array(
  projectSchema.extend({ active: z.boolean() })
)
export type ProjectsList = z.infer<typeof projectsListSchema>

export const projectSelectRequestSchema = z.object({ project_id: z.uuid() })
export type ProjectSelectRequest = z.infer<typeof projectSelectRequestSchema>

/** session:restart {sessionId} — D16 clause 4: read row -> re-validate cwd ->
 *  launch path under the SAME row id (no row creation); 'running' is written
 *  only after the spawn succeeds. One path for in-run and post-restart. */
export const restartRequestSchema = z.object({ sessionId: z.uuid() })
export type RestartRequest = z.infer<typeof restartRequestSchema>

export const restartResponseSchema = z.union([
  attachResponseSchema,
  z.object({ ok: z.literal(false), reason: z.string() })
])
export type RestartResponse = z.infer<typeof restartResponseSchema>

/** session:delete {sessionId} — pane close, after kill/exit completes. Main
 *  rejects the delete while the session is live in the manager. */
export const deleteSessionRequestSchema = z.object({ sessionId: z.uuid() })
export type DeleteSessionRequest = z.infer<typeof deleteSessionRequestSchema>

/** session:set-title {sessionId, title} — the ONE title write path (1b-1/D18).
 *  max(120) bounds the wire size; main additionally strips control characters
 *  and no-ops on an empty post-sanitize result. */
export const setTitleRequestSchema = z.object({
  sessionId: z.uuid(),
  title: z.string().min(1).max(120)
})
export type SetTitleRequest = z.infer<typeof setTitleRequestSchema>

/** Restore engine relaunched this session (auto-restore only — a manual
 *  Restart badges from its own return path). The pane re-attaches and wears
 *  the transient "new conversation" badge when the attach comes back running. */
export const sessionRestoredEventSchema = z.object({ sessionId: z.string().min(1) })
export type SessionRestoredEvent = z.infer<typeof sessionRestoredEventSchema>

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

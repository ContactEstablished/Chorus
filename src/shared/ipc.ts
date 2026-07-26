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
  /** invoke: static adapter declarations — capabilities + auth methods. No
   *  probing; cli:detect owns installation state. */
  AdapterList: 'adapter:list',
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
  ProjectSelect: 'project:select',
  /** invoke: list a project's worktrees for the retained-worktree panel (2-3) */
  WorktreeList: 'worktree:list',
  /** invoke: remove a worktree through the D26 gates (typed token if dirty) */
  WorktreeRemove: 'worktree:remove',
  /** invoke: fresh git status --porcelain lines for one worktree (2-3) */
  WorktreeDirtyFiles: 'worktree:dirty-files',
  /** invoke: read-only {filesChanged, insertions, deletions, untracked} for a
   *  session's worktree (2-4); null for current-tree sessions */
  WorktreeDiffSummary: 'worktree:diff-summary',
  /** invoke: list provider configs (plaintext, non-secret metadata only) */
  ProviderList: 'provider:list',
  /** invoke: create a provider config */
  ProviderCreate: 'provider:create',
  /** invoke: update a provider config's non-secret fields */
  ProviderUpdate: 'provider:update',
  /** invoke: delete a provider config; refuses while profiles reference it */
  ProviderDelete: 'provider:delete',
  /** invoke: list credential profile METADATA — never key material (D33 c3) */
  CredentialList: 'credential:list',
  /** invoke: store a plaintext key; WRITE-ONLY INBOUND — returns only an id */
  CredentialCreate: 'credential:create',
  /** invoke: replace a profile's key by id; write-only inbound */
  CredentialReplace: 'credential:replace',
  /** invoke: delete a credential profile by id */
  CredentialDelete: 'credential:delete',
  /** invoke: ONE live auth probe, user-initiated only (D33 resolution d —
   *  "at your request" is load-bearing). Never at boot, launch, on a timer,
   *  or on profile creation. Returns a boolean + sanitized message. */
  CredentialTest: 'credential:test',
  /** invoke: read the cached model list for one provider + its freshness.
   *  PURE READ — makes NO network call and decrypts nothing. */
  ModelList: 'model:list',
  /** invoke: ONE live GET <base_url>/models, user-initiated only. The SECOND
   *  key-bearing call in the app — D33 resolution (d)'s carve-out, widened by
   *  exactly this call (Task 3a-4). Never at boot, launch, on a timer, on
   *  settings-open, or on profile creation. A success is NOT proof of
   *  authentication and does NOT write last_verified_at: this endpoint answers
   *  200 with no key at all. */
  ModelRefresh: 'model:refresh',
  /** invoke: WRITE-ONLY INBOUND — the renderer's edge-triggered report of the
   *  four facts main cannot see (active project, which terminal host holds DOM
   *  focus, which view is up, whether an overlay owns the keyboard). Returns
   *  void; there is no read-back. Fire-and-forget, so main never throws at it. */
  AttentionReport: 'attention:report',
  /** invoke: attention-minutes for a project over a window — ALWAYS with its
   *  denominator. See attentionSummaryResponseSchema: there is no `minutes`
   *  field, by design. */
  AttentionSummary: 'attention:summary',
  /** invoke: "% of spend attributed" (D42) over a window — ALWAYS with the
   *  counts and dollars it was computed from (D55). Carries NO key material of
   *  any kind: not the minted key, not its hash, not the management key. */
  AttributionSummary: 'attribution:summary',
  /** invoke: the saved launch profiles, resolved and ordered by label in main.
   *  PURE READ — decrypts nothing. Carries a credential PROFILE ID and its
   *  LABEL and nothing else. */
  LaunchProfileList: 'launch-profile:list',
  /** invoke: save a launch profile (D43's (agent x route x model) triple). */
  LaunchProfileCreate: 'launch-profile:create',
  /** invoke: patch a launch profile. A RENAME IS A PURE UI EVENT with zero
   *  downstream consequences — every pointer stores the immutable id (D43). */
  LaunchProfileUpdate: 'launch-profile:update',
  /** invoke: delete a launch profile. Sessions hold a SOFT pointer, so no
   *  guard is needed here; the fail-safe predicate absorbs the dangling id. */
  LaunchProfileDelete: 'launch-profile:delete',
  /** invoke: the saved council members, resolved and ordered by label in main.
   *  PURE READ — decrypts nothing, calls nothing, spends nothing. Carries a
   *  credential PROFILE ID and its LABEL and nothing else. */
  CouncilMemberList: 'council-member:list',
  /** invoke: save a council member. A member names a ROUTE BY NAMING A
   *  CREDENTIAL (D48/D56): there is no base URL and no provider id on this
   *  channel, because there is none on the row. */
  CouncilMemberCreate: 'council-member:create',
  /** invoke: patch a council member. A RENAME IS A PURE UI EVENT with zero
   *  downstream consequences — every pointer stores the immutable id (D43). */
  CouncilMemberUpdate: 'council-member:update',
  /** invoke: delete a council member. Runs and messages hold SOFT pointers
   *  (D62), so no guard is needed here — a transcript stays true once the
   *  member that spoke it is gone. */
  CouncilMemberDelete: 'council-member:delete',
  /** invoke: relaunch a session that was healed to `exited` because it held a
   *  credential (D53).
   *
   *  ⚠ THE ONLY LAUNCH-CREDENTIAL DECRYPT ADDED BY TASK 3a-5, and it happens
   *  because a HUMAN CLICKED SOMETHING. Restore stays decision (b): there is no
   *  unattended boot-time resolution of a launch credential, and this channel
   *  is not reachable from any boot path, timer, restore path or retry. That
   *  distance is the entire security argument (D49/F26). */
  SessionRelaunch: 'session:relaunch',
  /** invoke: open the native picker for a brief `.md`. Main-side
   *  `dialog.showOpenDialog` (the `project:add` precedent), cancel returning a
   *  structured no-op rather than an error. ⚠ A CONVENIENCE, NOT A BOUNDARY —
   *  `council:start` re-validates whatever comes back. */
  CouncilPickBrief: 'council:pick-brief',
  /**
   * invoke: run a council deliberation over a brief and return its findings.
   *
   * ⚠ IT CARRIES THE BRIEF'S **PATH**, AND MAIN IS WHAT OPENS IT (3b-4).
   * `brief_text` was REMOVED rather than deprecated (D68(4)): two sources of
   * truth for what the council deliberated on, with the renderer controlling
   * the authoritative one, would have made the path validation decorative.
   * The findings `.md` path is DERIVED from it in main and never supplied.
   *
   * ⚠ THE FOURTH KEY-BEARING CALL PATH, admitted on D58's terms exactly as
   * `api:probe` was: user-initiated only — no boot hook, no timer, no restore
   * path, no retry — reusing `resolveCredential` rather than forking it, so the
   * management refusal still sits BEFORE decryption. D60 remains the invariant
   * and not the count.
   */
  CouncilStart: 'council:start',
  /** invoke: cancel a running deliberation. The run's minted key is still read
   *  back and revoked — an abandoned run leaving a live funded key is the
   *  failure mode 3a-3's ledger exists for. */
  CouncilCancel: 'council:cancel',
  /** event (main -> renderer): one scrubbed delta from one member's stream.
   *  ⚠ ITS TEXT COMES FROM `SessionOutput`'s `onText`, never from the raw
   *  stream — see `councilService.driveMember`. */
  CouncilProgress: 'council:progress'
} as const

/**
 * Task 3a-3: the `provider_configs.auth_mode` value marking an ACCOUNT-LEVEL
 * credential rather than a way to launch an agent.
 *
 * ⚠ THIS IS DELIBERATELY NOT AN `AuthMethodDefinition.type`, and that is the
 * whole point. Widening the adapter auth union would make "Management key"
 * appear in the launch picker as a way to run codex — semantically false, and
 * it would push the highest-privilege credential in the app toward the exact
 * launch path this task exists to keep it away from. Instead the value lives
 * here, on the wire contract, where `auth_mode` already is an unconstrained
 * string on both sides (no migration, no wire-schema change), and:
 *
 *  - `LaunchDialog.vue` already filters `provider.auth_mode === 'api_key'`, so
 *    a management row is invisible to the launch picker FOR FREE;
 *  - `resolveCredential` in main refuses it outright, because main never trusts
 *    the renderer and a filter in the dialog is not a guarantee.
 */
export const MANAGEMENT_AUTH_MODE = 'management'

export const sessionStatusSchema = z.enum(['running', 'exited'])
export type SessionStatus = z.infer<typeof sessionStatusSchema>

/** Agent CLIs Chorus can run. N concurrent sessions per kind (Task 1-4). */
export const agentKindSchema = z.enum(['claude', 'codex'])
export type AgentKind = z.infer<typeof agentKindSchema>

/**
 * Task 3a-4: the app-level effort vocabulary — PLAN §4's Fast / Balanced /
 * Deep / Max slider. ONE vocabulary, shared by the wire, both adapters, and
 * (later) 3a-5's `launch_profiles.effort`.
 *
 * Declared this early in the file because both `launchRequestSchema` and
 * `effortOptionSchema` consume it, and a second copy would be a second home
 * for the same fact.
 *
 * Four normalized levels cannot cover every vendor's ladder, and stretching
 * them to try would make "Deep" mean different distances on different
 * adapters — claude's `xhigh` and codex's `none`/`minimal`/`ultra` are
 * deliberately unreachable from the slider. The raw `extra_args` override is
 * what reaches the rest (PLAN §4), which is why it is rank 1 of the effort
 * precedence order.
 */
export const effortLevelSchema = z.enum(['fast', 'balanced', 'deep', 'max'])
export type EffortLevel = z.infer<typeof effortLevelSchema>

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
  branch: z.string().nullable(),
  /** 2-3: the owning worktree row's id, or null for current-tree sessions.
   *  Required-nullable, same discipline as branch. The pane close flow acts by
   *  worktree id (clean-removal offer / dirty detach); resolved row-side
   *  exactly like branch (F18a). */
  worktreeId: z.string().nullable()
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
  worktree_id: z.uuid().optional(),
  /** Task 3-6: the BYOK pick — a credential PROFILE ID, never a key (D33
   *  clause 2/Q2: main resolves and decrypts server-side only). Absent is
   *  the first-class subscription/ambient path (D33 clause 9). */
  credential_profile_id: z.uuid().optional(),
  /** Task 3a-4: the app-level effort level for THIS launch. Optional, and
   *  absent means Chorus emits no effort argument at all — the CLI's own
   *  default, which is what makes a no-effort launch byte-identical to a
   *  pre-3a-4 one.
   *
   *  Task 3a-5 persists it on `launch_profiles.effort` and PREFILLS THIS SAME
   *  FIELD from the chosen profile — there is deliberately NO second effort
   *  field on this payload. If the payload carries one, THE PAYLOAD WINS,
   *  because it is what the user is looking at; the profile is the default. */
  effort: effortLevelSchema.optional(),
  /** Task 3a-5 / D43: launch from a saved profile.
   *
   *  ⚠ MUTUALLY EXCLUSIVE with credential_profile_id — both present is refused
   *  in MAIN with an authored reason, deliberately NOT by schema branching, so
   *  the refusal has a place to say why. ONE resolver, ONE source of truth for
   *  the credential.
   *
   *  The division of authority: the PROFILE supplies the credential, route,
   *  model, effort, permission mode and env; the PAYLOAD still supplies
   *  `agent`, `cwd` and `workspace_mode`, because the user may change all three
   *  after picking a profile and because `cwd` is the SECURITY BOUNDARY main
   *  validates itself — a stored row is untrusted input like any other. */
  launch_profile_id: z.uuid().optional()
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

/* ------------------------------------------------------------------ */
/* Task 3a-5 / D43: launch profiles                                     */
/* ------------------------------------------------------------------ */

/** ⚠ A SAVED profile may not pin a transient worktree row. `existing-worktree`
 *  names a specific `worktrees` row that may be gone by the next launch, so it
 *  is a launch-time choice, never a stored one. Deliberately a SUBSET of
 *  workspaceModeSchema rather than a second copy. */
export const savedWorkspaceModeSchema = z.enum(['current-tree', 'new-worktree'])
export type SavedWorkspaceMode = z.infer<typeof savedWorkspaceModeSchema>

/**
 * One launch profile on the wire.
 *
 * ⚠ Carries a credential PROFILE ID and its LABEL and NOTHING ELSE. There is no
 * field here capable of holding key material, and `src/shared/ipc.test.ts`
 * asserts that over the parse output's KEY SET (the 3-2 discipline) rather than
 * by spot-checking.
 *
 * `disabled_reason` is computed in MAIN by resolveLaunchProfile. An unlaunchable
 * profile is SHOWN and DISABLED with its reason, never filtered out: a launch
 * profile is a row the USER NAMED, and hiding it is a worse experience than
 * explaining it. (This deliberately differs from 3-6's `eligibleProfiles`,
 * which hides unavailable CREDENTIAL profiles — those are plumbing.)
 */
export const launchProfileWireSchema = z.object({
  id: z.uuid(),
  label: z.string().min(1).max(120),
  agent: agentKindSchema,
  provider_id: z.uuid().nullable(),
  provider_name: z.string().max(120).nullable(),
  credential_profile_id: z.uuid().nullable(),
  credential_label: z.string().max(120).nullable(),
  /** The RESOLVED model (profile -> route -> null), so the renderer never
   *  re-implements 3a-4's precedence table and cannot create a second home. */
  model: z.string().max(200).nullable(),
  /** 3a-4's effortLevelSchema, IMPORTED — not z.string(), and not a second
   *  enum. A parallel effort vocabulary is exactly the two-homes failure D48
   *  exists to prevent. */
  effort: effortLevelSchema.nullable(),
  permission_mode: z.string().max(40).nullable(),
  workspace_mode: savedWorkspaceModeSchema,
  env_json: z.string().max(4096).nullable(),
  disabled_reason: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string()
})
export type LaunchProfileWire = z.infer<typeof launchProfileWireSchema>

export const launchProfileListResponseSchema = z.object({
  profiles: z.array(launchProfileWireSchema)
})
export type LaunchProfileListResponse = z.infer<typeof launchProfileListResponseSchema>

export const launchProfileCreateRequestSchema = z.object({
  label: z.string().min(1).max(120),
  agent: agentKindSchema,
  provider_id: z.uuid().nullable(),
  credential_profile_id: z.uuid().nullable(),
  model: z.string().min(1).max(200).nullable(),
  effort: effortLevelSchema.nullable(),
  permission_mode: z.string().min(1).max(40).nullable(),
  workspace_mode: savedWorkspaceModeSchema,
  /** NON-SECRET string->string additions. Main runs every VALUE through
   *  scrubSecrets and REFUSES if it carries a known key shape — the
   *  extra_headers_json precedent. A key belongs in a credential. */
  env_json: z.string().max(4096).nullable()
})
export type LaunchProfileCreateRequest = z.infer<typeof launchProfileCreateRequestSchema>

export const launchProfileCreateResponseSchema = z.union([
  z.object({ ok: z.literal(true), profile: launchProfileWireSchema }),
  z.object({ ok: z.literal(false), reason: z.string() })
])
export type LaunchProfileCreateResponse = z.infer<typeof launchProfileCreateResponseSchema>

/** Patch semantics: absent = unchanged; null = clear; a value = set. */
export const launchProfileUpdateRequestSchema = z.object({
  id: z.uuid(),
  label: z.string().min(1).max(120).optional(),
  model: z.string().min(1).max(200).nullable().optional(),
  effort: effortLevelSchema.nullable().optional(),
  permission_mode: z.string().min(1).max(40).nullable().optional(),
  workspace_mode: savedWorkspaceModeSchema.optional(),
  credential_profile_id: z.uuid().nullable().optional(),
  env_json: z.string().max(4096).nullable().optional()
})
export type LaunchProfileUpdateRequest = z.infer<typeof launchProfileUpdateRequestSchema>

export const launchProfileUpdateResponseSchema = z.union([
  z.object({ ok: z.literal(true), profile: launchProfileWireSchema }),
  z.object({ ok: z.literal(false), reason: z.string() })
])
export type LaunchProfileUpdateResponse = z.infer<typeof launchProfileUpdateResponseSchema>

export const launchProfileDeleteRequestSchema = z.object({ id: z.uuid() })
export type LaunchProfileDeleteRequest = z.infer<typeof launchProfileDeleteRequestSchema>

export const launchProfileDeleteResponseSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), reason: z.string() })
])
export type LaunchProfileDeleteResponse = z.infer<typeof launchProfileDeleteResponseSchema>

/* ------------------------------------------------------------------ */
/* Phase 3b / Task 3b-2 (D62): council members                          */
/* ------------------------------------------------------------------ */

/**
 * The two things a member can be. `arbiter` breaks a deadlock; `member` argues.
 *
 * ⚠ THE VOCABULARY LIVES HERE AND NOWHERE ELSE. There is deliberately NO
 * `CHECK` constraint on `council_members.role` — that would put the list in two
 * places and make widening it a MIGRATION, which is exactly how `auth_mode` and
 * `status` are already handled. Main validates against this schema on the way
 * in AND on the way out, so a hand-edited row cannot render as a legal role.
 */
export const councilRoleSchema = z.enum(['member', 'arbiter'])
export type CouncilRole = z.infer<typeof councilRoleSchema>

/**
 * One council member on the wire.
 *
 * ⚠ IDS AND LABELS ONLY. There is no field here capable of holding key
 * material, and `src/shared/ipc.test.ts` asserts that over the parse output's
 * KEY SET (the 3-2 discipline) rather than by spot-checking. `.strict()` makes
 * it loud: zod would otherwise silently STRIP an unknown key, letting a raw row
 * pass with its extra columns dropped unnoticed.
 *
 * ⚠ NO `baseUrl` AND NO `providerId`, MIRRORING THE ROW. The route has ONE home
 * (D48) and is reached through the credential; `providerName` is here purely so
 * the list can say which route a member speaks on, and it is a NAME, not a
 * route. Adding either field back is the change a reviewer must refuse.
 *
 * ⚠ NO `paramsJson` EITHER — deliberately WRITE-ONLY INBOUND. A member's
 * parameters are user-authored free text and therefore the field most able to
 * carry a pasted key; main refuses one that matches a known key shape at write
 * time, and never echoes the value back into the DOM.
 *
 * `model` is the RAW COLUMN and `resolvedModel` is D56's answer. Both are on
 * the wire on purpose: the UI has to be able to show that a NULL model column
 * INHERITS the route's default rather than being empty, and a single field
 * would make those two facts indistinguishable — which is precisely how a
 * "helpful" back-write into rank 1 gets written by someone reading the UI.
 */
export const councilMemberWireSchema = z
  .object({
    id: z.uuid(),
    label: z.string().min(1).max(120),
    credentialProfileId: z.uuid(),
    credentialLabel: z.string().max(120).nullable(),
    providerName: z.string().max(120).nullable(),
    /** D56 RANK 1 — the raw column, NULL when this member inherits. */
    model: z.string().max(200).nullable(),
    /** D56 RESOLVED — rank 1 > the route's rank 2 > null. COMPUTED IN MAIN and
     *  NEVER WRITTEN BACK to the row (that is the second home D48 forbids). */
    resolvedModel: z.string().max(200).nullable(),
    role: councilRoleSchema,
    /** False when the member cannot deliberate — a management route, a missing
     *  or unavailable credential. The row is still SHOWN and EXPLAINED. */
    available: z.boolean(),
    /** Main's authored, LABEL-ONLY reason. Never a URL, an env var name, or a
     *  key fragment — the `vaultCore.failureMessage` vocabulary. */
    unavailableReason: z.string().nullable()
  })
  .strict()
export type CouncilMemberWire = z.infer<typeof councilMemberWireSchema>

export const councilMemberListRequestSchema = z.object({})
export type CouncilMemberListRequest = z.infer<typeof councilMemberListRequestSchema>

export const councilMemberListResponseSchema = z.object({
  members: z.array(councilMemberWireSchema)
})
export type CouncilMemberListResponse = z.infer<typeof councilMemberListResponseSchema>

export const councilMemberCreateRequestSchema = z.object({
  label: z.string().min(1).max(120),
  /** ⚠ NOT NULLABLE, and there is no `providerId` beside it. A council member
   *  ALWAYS AUTHENTICATES — D33 clause 9's route-without-credential case does
   *  not reach here — so the credential is the one pointer, and the route is
   *  derived from it. */
  credentialProfileId: z.uuid(),
  /** D56 rank 1. NULL means "inherit this route's default", which is a real
   *  choice and not an absence. */
  model: z.string().min(1).max(200).nullable(),
  role: councilRoleSchema,
  /** NON-SECRET JSON object of member parameters (temperature, top_p, …).
   *  Main REFUSES any value carrying a known key shape — the
   *  `extra_headers_json` precedent. Never echoed back. */
  paramsJson: z.string().max(4096).nullable()
})
export type CouncilMemberCreateRequest = z.infer<typeof councilMemberCreateRequestSchema>

export const councilMemberCreateResponseSchema = z.union([
  z.object({ ok: z.literal(true), member: councilMemberWireSchema }),
  z.object({ ok: z.literal(false), reason: z.string() })
])
export type CouncilMemberCreateResponse = z.infer<typeof councilMemberCreateResponseSchema>

/** Patch semantics: absent = unchanged; null = clear; a value = set. */
export const councilMemberUpdateRequestSchema = z.object({
  id: z.uuid(),
  label: z.string().min(1).max(120).optional(),
  credentialProfileId: z.uuid().optional(),
  model: z.string().min(1).max(200).nullable().optional(),
  role: councilRoleSchema.optional(),
  paramsJson: z.string().max(4096).nullable().optional()
})
export type CouncilMemberUpdateRequest = z.infer<typeof councilMemberUpdateRequestSchema>

export const councilMemberUpdateResponseSchema = z.union([
  z.object({ ok: z.literal(true), member: councilMemberWireSchema }),
  z.object({ ok: z.literal(false), reason: z.string() })
])
export type CouncilMemberUpdateResponse = z.infer<typeof councilMemberUpdateResponseSchema>

export const councilMemberDeleteRequestSchema = z.object({ id: z.uuid() })
export type CouncilMemberDeleteRequest = z.infer<typeof councilMemberDeleteRequestSchema>

export const councilMemberDeleteResponseSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), reason: z.string() })
])
export type CouncilMemberDeleteResponse = z.infer<typeof councilMemberDeleteResponseSchema>

export const relaunchRequestSchema = z.object({ sessionId: z.string().min(1) })
export type RelaunchRequest = z.infer<typeof relaunchRequestSchema>

/**
 * Same union SHAPE as restartResponseSchema, and deliberately its OWN schema
 * rather than an alias: the two verbs differ in meaning — restart means "same
 * configuration, NO credential"; relaunch means "same configuration, credential
 * RE-RESOLVED because you asked" — and they will diverge before they converge.
 */
export const relaunchResponseSchema = z.union([
  attachResponseSchema,
  z.object({ ok: z.literal(false), reason: z.string() })
])
export type RelaunchResponse = z.infer<typeof relaunchResponseSchema>

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
  worktrees: z.array(pickableWorktreeSchema),
  /** Task 3a-5: the picker's rows, resolved and ordered by label in MAIN.
   *  They ride in on the existing launch-context call — no fifth round trip. */
  launchProfiles: z.array(launchProfileWireSchema),
  /** Task 3a-5: the PER-PROJECT last-used pointer, or null when there is none
   *  or when it DANGLES (the profile was deleted). Computed in MAIN: the
   *  renderer never derives a default and never persists one, and a dangling
   *  pointer resolves to "no default" rather than to a fuzzy label match. */
  lastLaunchProfileId: z.uuid().nullable()
})
export type LaunchContextResponse = z.infer<typeof launchContextResponseSchema>

/* ------------------------------------------------------------------ */
/* Task 2-3: cleanup flows + retained-worktree panel (D26 clauses 5-8) */
/* ------------------------------------------------------------------ */

export const worktreeListRequestSchema = z.object({ project_id: z.uuid() })
export type WorktreeListRequest = z.infer<typeof worktreeListRequestSchema>

/** One row for the retained-worktree panel (risk 6 columns + prune
 *  surfacing). `isPruneCandidate` is recomputed LIVE at list time (2-1's
 *  reconcile never persists surface findings): the directory is gone while
 *  the row/git metadata remains (population 2), or the entry is a surfaced
 *  orphan directory (population 5, nil-uuid sentinel id). `ahead`/`behind`
 *  are -1 when not computable — adopted rows carry empty branch/base_branch
 *  and an empty ref fails rev-list (the panel renders — instead). */
export const worktreeSummarySchema = z.object({
  id: z.uuid(),
  path: z.string(),
  branch: z.string(),
  status: z.string(),
  clean: z.boolean(),
  dirtyCount: z.number().int(),
  ahead: z.number().int(),
  behind: z.number().int(),
  isPruneCandidate: z.boolean()
})
export type WorktreeSummary = z.infer<typeof worktreeSummarySchema>

export const worktreeListResponseSchema = z.array(worktreeSummarySchema)
export type WorktreeListResponse = z.infer<typeof worktreeListResponseSchema>

export const worktreeRemoveRequestSchema = z.object({
  worktreeId: z.uuid(),
  /** opt-in ONLY (D26 Q4) — default false; branches are never auto-deleted. */
  deleteBranch: z.boolean().optional(),
  /** required to equal the worktree path for a DIRTY removal (D26 clause 6).
   *  It licenses nothing else — F21 split the -D escalation off into its own
   *  token below. */
  confirmation: z.string().optional(),
  /** F21: a SEPARATE acknowledgment from `confirmation`, required before main
   *  will ever pass `force: true` to branchDelete. D26(j) said "the same typed
   *  confirmation"; that overloaded one token to license two different
   *  destructions — uncommitted FILES (confirmation, naming the path) and
   *  unmerged COMMITS (this, naming the branch). They are now distinct, so
   *  neither can stand in for the other. */
  branchForceConfirmation: z.string().optional()
})
export type WorktreeRemoveRequest = z.infer<typeof worktreeRemoveRequestSchema>

export const worktreeRemoveResponseSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), reason: z.string() })
])
export type WorktreeRemoveResponse = z.infer<typeof worktreeRemoveResponseSchema>

export const worktreeDirtyFilesRequestSchema = z.object({ worktreeId: z.uuid() })
export type WorktreeDirtyFilesRequest = z.infer<typeof worktreeDirtyFilesRequestSchema>

export const worktreeDirtyFilesResponseSchema = z.array(z.string())
export type WorktreeDirtyFilesResponse = z.infer<typeof worktreeDirtyFilesResponseSchema>

/** The D26 clause-6 confirmation gate, factored pure for the unit test (the
 *  worktree:remove handler is the authority; the panel mirrors it). A clean
 *  worktree removes without confirmation; a dirty one removes only when the
 *  typed token exactly matches its path. */
export function dirtyRemovalAllowed(
  wt: { path: string; clean: boolean },
  confirmation: string | undefined
): boolean {
  if (wt.clean) return true
  return confirmation === wt.path
}

/** The F21 branch-force gate, factored pure for the unit test (the
 *  worktree:remove handler is the authority). `-D` destroys unmerged commits,
 *  so it is licensed ONLY by an acknowledgment naming the BRANCH — never by
 *  the dirty-removal path token, and never by its absence. The empty-branch
 *  guard is load-bearing: adopted rows (population 4) are born with
 *  `branch = ''`, and without it an empty-string ack would be `'' === ''` —
 *  licensing a force-delete of a nameless branch. */
export function branchForceAllowed(
  wt: { branch: string },
  ack: string | undefined
): boolean {
  if (wt.branch === '') return false
  return ack === wt.branch
}

/* ------------------------------------------------------------------ */
/* Task 2-4: diff summary (read-only; F18a worktree resolution)        */
/* ------------------------------------------------------------------ */

export const worktreeDiffRequestSchema = z.object({ sessionId: z.uuid() })
export type WorktreeDiffRequest = z.infer<typeof worktreeDiffRequestSchema>

/** `{filesChanged, insertions, deletions}` come from `git diff --shortstat
 *  HEAD` in the worktree (tracked changes vs HEAD); `untracked` counts `??`
 *  lines in `git status --porcelain`. Read-only — the channel never stages,
 *  commits, merges, or removes anything. */
export const worktreeDiffSummarySchema = z.object({
  filesChanged: z.number().int(),
  insertions: z.number().int(),
  deletions: z.number().int(),
  untracked: z.number().int()
})
export type WorktreeDiffSummary = z.infer<typeof worktreeDiffSummarySchema>

/** null when the session has no worktree (current-tree), the worktree row is
 *  gone, or its directory no longer exists — the pane shows no counts. */
export const worktreeDiffResponseSchema = worktreeDiffSummarySchema.nullable()
export type WorktreeDiffResponse = z.infer<typeof worktreeDiffResponseSchema>

/* ------------------------------------------------------------------ */
/* Task 3-2: providers + credential vault (D33)                        */
/*                                                                     */
/* The security shape of this surface is the deliverable:              */
/*  1. WRITE-ONLY INBOUND — `key` exists on exactly two request        */
/*     schemas (create/replace) and on NO response schema. A handler   */
/*     that forgets fails the OUTBOUND parse loudly instead of leaking */
/*     quietly (D33 clause 3).                                         */
/*  2. THE SALTED KEY DIGEST NEVER LEAVES MAIN (D33 resolution b) — no       */
/*     schema here admits the digest column; duplicate disambiguation is the */
/*     mandatory label's job.                                                */
/*  3. No masked preview, no hint, no length — clause 3 admits no      */
/*     exception.                                                      */
/* ------------------------------------------------------------------ */

/** A provider_configs row as it crosses IPC: NON-SECRET metadata only (D33
 *  resolution e documents base_url / extra_headers_json as non-secret; the
 *  credential envelope's own values override them at launch). snake_case
 *  column names on the wire, same convention as projectSchema.root_path.
 *  Nullable fields are required-nullable (the house discipline since 1b-1). */
export const providerConfigSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(120),
  adapter_type: z.string().min(1).max(60),
  auth_mode: z.string().min(1).max(60),
  env_var_name: z.string().max(120).nullable(),
  base_url: z.string().max(2048).nullable(),
  extra_headers_json: z.string().max(8192).nullable(),
  /** D48 (migration v6): the route's DEFAULT model id. Nullable — a
   *  subscription route has no model to name. NOT a catalog entry: one
   *  hand-entered scalar per route, no list, no fetch, no refresh. */
  model: z.string().max(200).nullable(),
  created_at: z.string()
})
export type ProviderConfig = z.infer<typeof providerConfigSchema>

export const providerListRequestSchema = z.object({})
export type ProviderListRequest = z.infer<typeof providerListRequestSchema>

export const providerListResponseSchema = z.array(providerConfigSchema)
export type ProviderListResponse = z.infer<typeof providerListResponseSchema>

export const providerCreateRequestSchema = z.object({
  name: z.string().min(1).max(120),
  /** Plain TEXT this task (3-2) — nothing validates it against an adapter
   *  registry until Task 3-3. */
  adapter_type: z.string().min(1).max(60),
  auth_mode: z.string().min(1).max(60),
  env_var_name: z.string().min(1).max(120).optional(),
  base_url: z.string().min(1).max(2048).optional(),
  /** Plaintext and documented non-secret — main runs it through scrubSecrets
   *  and REFUSES if it carries a known key shape (spec §6.4). */
  extra_headers_json: z.string().min(1).max(8192).optional(),
  /** D48: the route's default model id (optional; hand-entered). */
  model: z.string().min(1).max(200).optional()
})
export type ProviderCreateRequest = z.infer<typeof providerCreateRequestSchema>

export const providerCreateResponseSchema = z.union([
  z.object({ ok: z.literal(true), provider: providerConfigSchema }),
  z.object({ ok: z.literal(false), reason: z.string() })
])
export type ProviderCreateResponse = z.infer<typeof providerCreateResponseSchema>

/** Patch semantics: absent = unchanged; null = clear (nullable fields only);
 *  a value = set. Non-nullable columns reject null outright. */
export const providerUpdateRequestSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(120).optional(),
  adapter_type: z.string().min(1).max(60).optional(),
  auth_mode: z.string().min(1).max(60).optional(),
  env_var_name: z.string().min(1).max(120).nullable().optional(),
  base_url: z.string().min(1).max(2048).nullable().optional(),
  extra_headers_json: z.string().min(1).max(8192).nullable().optional(),
  model: z.string().min(1).max(200).nullable().optional()
})
export type ProviderUpdateRequest = z.infer<typeof providerUpdateRequestSchema>

export const providerUpdateResponseSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), reason: z.string() })
])
export type ProviderUpdateResponse = z.infer<typeof providerUpdateResponseSchema>


export const providerDeleteRequestSchema = z.object({ id: z.uuid() })
export type ProviderDeleteRequest = z.infer<typeof providerDeleteRequestSchema>

export const providerDeleteResponseSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), reason: z.string() })
])
export type ProviderDeleteResponse = z.infer<typeof providerDeleteResponseSchema>

/** D33 clause 3 — the shape that leaves main. There is NO encrypted_blob and
 *  NO key-digest column here, and that absence is the enforcement mechanism:
 *  every credential handler outbound-parses through this schema, so a handler
 *  that returns a raw row fails loudly instead of leaking quietly. Adding a
 *  secret-bearing field to this schema is the one change reviewers must refuse.
 *  F-5b (D36 chore): `.strict()` makes "fails loudly" literal — zod's default
 *  silently STRIPS unknown keys, which would let a raw row pass with its
 *  digest/blob dropped unnoticed; strict throws on them instead. */
export const credentialProfileMetaSchema = z
  .object({
    id: z.uuid(),
    providerId: z.uuid(),
    label: z.string().min(1).max(120),
    createdAt: z.string(),
    lastVerifiedAt: z.string().nullable(),
    unavailableSince: z.string().nullable()
  })
  .strict()
export type CredentialProfileMetaWire = z.infer<typeof credentialProfileMetaSchema>

export const credentialListRequestSchema = z.object({})
export type CredentialListRequest = z.infer<typeof credentialListRequestSchema>

export const credentialListResponseSchema = z.array(credentialProfileMetaSchema)
export type CredentialListResponse = z.infer<typeof credentialListResponseSchema>

export const credentialCreateRequestSchema = z.object({
  providerId: z.uuid(),
  label: z.string().min(1).max(120),
  /** The plaintext key. This is the ONLY field in the entire IPC surface that
   *  ever carries key material, and it travels in ONE direction. There is no
   *  corresponding response field, by design. Bounded to keep a pathological
   *  payload from becoming a memory event; 8 KiB is far above any real key and
   *  far below anything worth worrying about. */
  key: z.string().min(1).max(8192),
  baseUrl: z.string().min(1).max(2048).optional(),
  /** Encrypted into the envelope alongside the key — correct by construction. */
  extraHeaders: z.record(z.string(), z.string().max(2048)).optional()
})
export type CredentialCreateRequest = z.infer<typeof credentialCreateRequestSchema>

/** create returns ONLY the new id (write-only inbound, D33 clause 3); failure
 *  is the inline-failure idiom Task 2-2 established, so the future dialog
 *  renders refusals without an exception path. */
export const credentialCreateResponseSchema = z.union([
  z.object({ ok: z.literal(true), id: z.uuid() }),
  z.object({ ok: z.literal(false), reason: z.string() })
])
export type CredentialCreateResponse = z.infer<typeof credentialCreateResponseSchema>

export const credentialReplaceRequestSchema = z.object({
  id: z.uuid(),
  key: z.string().min(1).max(8192),
  baseUrl: z.string().min(1).max(2048).optional(),
  extraHeaders: z.record(z.string(), z.string().max(2048)).optional()
})
export type CredentialReplaceRequest = z.infer<typeof credentialReplaceRequestSchema>

export const credentialReplaceResponseSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), reason: z.string() })
])
export type CredentialReplaceResponse = z.infer<typeof credentialReplaceResponseSchema>

export const credentialDeleteRequestSchema = z.object({ id: z.uuid() })
export type CredentialDeleteRequest = z.infer<typeof credentialDeleteRequestSchema>

export const credentialDeleteResponseSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), reason: z.string() })
])
export type CredentialDeleteResponse = z.infer<typeof credentialDeleteResponseSchema>

/** Task 3-6: the test-key probe (D33 resolution d). Request is a profile id;
 *  the response is a boolean plus a SANITIZED message — no response body, no
 *  exception text, no field capable of carrying key material (the unit test
 *  asserts the key set, same discipline as this file's meta schema). */
export const credentialTestRequestSchema = z.object({ id: z.uuid() })
export type CredentialTestRequest = z.infer<typeof credentialTestRequestSchema>

export const credentialTestResponseSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), reason: z.string() })
])
export type CredentialTestResponse = z.infer<typeof credentialTestResponseSchema>

/* ------------------------------------------------------------------ */
/* Task 3a-4: the model catalog (migration v9)                         */
/*                                                                     */
/* ⚠ A LIST OF WHAT EXISTS, NOT AN AUTHORITY. Nothing on this wire can  */
/* instruct main to change a route's default model: there is no field   */
/* for it, in either direction, and that absence is the enforcement.    */
/* The precedence order is launch_profiles.model (3a-5) >              */
/* provider_configs.model (v6, D48) > nothing; model_catalog is not in  */
/* it. See the v9 migration comment in storage.ts.                      */
/* ------------------------------------------------------------------ */

/** The three freshness states, COMPUTED IN MAIN. The renderer does no date
 *  arithmetic — a renderer-side threshold would be a second home for the
 *  policy. `'never'` is a third state, not a flavour of `'stale'`. */
export const catalogFreshnessSchema = z.enum(['never', 'fresh', 'stale'])
export type CatalogFreshnessWire = z.infer<typeof catalogFreshnessSchema>

/** One catalogued model. `.strict()` for the F-5b reason: zod otherwise
 *  STRIPS unknown keys silently, which would let a raw row pass with extra
 *  columns dropped unnoticed. There is no field here capable of carrying key
 *  material, and adding one is the change reviewers must refuse. */
export const modelCatalogEntrySchema = z
  .object({
    modelId: z.string().min(1).max(200),
    displayName: z.string().max(200),
    /** Stored and DISPLAYED, never reasoned over (explicit non-goal). */
    contextLength: z.number().int().nullable(),
    expiresAt: z.string().nullable(),
    /** Set once when a refresh stops seeing the id; never moved while it stays
     *  missing; cleared when it returns. The row is never deleted. */
    missingSince: z.string().nullable()
  })
  .strict()
export type ModelCatalogEntry = z.infer<typeof modelCatalogEntrySchema>

export const modelListRequestSchema = z.object({ provider_id: z.uuid() })
export type ModelListRequest = z.infer<typeof modelListRequestSchema>

export const modelListResponseSchema = z
  .object({
    models: z.array(modelCatalogEntrySchema),
    /** MAX(refreshed_at) over the provider's rows; null = never refreshed. */
    refreshedAt: z.string().nullable(),
    freshness: catalogFreshnessSchema
  })
  .strict()
export type ModelListResponse = z.infer<typeof modelListResponseSchema>

/** `credential_id` is a PROFILE ID or null — never a key. Null is the
 *  unauthenticated path, a shipped behaviour rather than a fallback. */
export const modelRefreshRequestSchema = z.object({
  provider_id: z.uuid(),
  credential_id: z.uuid().nullable()
})
export type ModelRefreshRequest = z.infer<typeof modelRefreshRequestSchema>

/** ⚠ COUNTS, NEVER LISTS OF IDS in the failure path, and no field capable of
 *  carrying key material (D42/D55: a telemetry number never ships without its
 *  denominator, enforced by the outbound schema). `.strict()` on both arms. */
export const modelRefreshResponseSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      added: z.number().int().nonnegative(),
      updated: z.number().int().nonnegative(),
      missing: z.number().int().nonnegative(),
      /** Rows the provider sent that failed ingest validation. */
      dropped: z.number().int().nonnegative(),
      refreshedAt: z.string()
    })
    .strict(),
  z.object({ ok: z.literal(false), reason: z.string() }).strict()
])
export type ModelRefreshResponse = z.infer<typeof modelRefreshResponseSchema>

/* ------------------------------------------------------------------ */
/* Task 3a-2: attention capture (Mission Control spec §5.3)            */
/*                                                                     */
/* The honesty shape of this surface is the deliverable:               */
/*  1. There is NO `minutes` FIELD. Minutes are DERIVED by the caller  */
/*     from `samples x tickSeconds`, so it is structurally impossible  */
/*     to obtain a number without having been handed its denominator.  */
/*  2. `byClass`, `expectedSamples` and `coveragePct` are REQUIRED —   */
/*     a denominator-less response fails the outbound .parse in main   */
/*     rather than shipping a bare figure (the D33 clause-3 move,      */
/*     applied to a different kind of dangerous value).                */
/*  3. `estimateBound` states the direction of the bias as a FIELD, so */
/*     a consumer rendering this record cannot render the number       */
/*     without the qualifier travelling beside it.                     */
/* ------------------------------------------------------------------ */

/** Mirrors `AttentionClass` in main/services/attentionCore.ts — the classifier
 *  owns the vocabulary, this is its wire form (the adapters/types.ts pattern). */
export const attentionClassSchema = z.enum(['pane', 'overhead', 'blurred', 'idle', 'locked'])
export type AttentionClassWire = z.infer<typeof attentionClassSchema>

/**
 * attention:report — the renderer's half of §5.3's first clause. Sent only on a
 * real edge (see renderer/src/attention/reporter.ts), never on a timer.
 *
 * `sessionId` is deliberately NOT FK-checked in main, exactly as `view:set`'s
 * `focusedSessionId` is not (F4): a report can legitimately name a session main
 * has just seen exit, and throwing would break a fire-and-forget send.
 */
export const attentionReportSchema = z
  .object({
    /** The active project, or null — nothing to attribute to (table row 12). */
    projectId: z.uuid().nullable(),
    /** The session whose TERMINAL HOST holds DOM focus; null for chrome
     *  (tab bar, header buttons, filmstrip cards, splitter, body). */
    sessionId: z.uuid().nullable(),
    /** ⚠ WIDENED BY 3b-4 TO CARRY `council`, and reporting it as `settings`
     *  would have been the cheaper lie. Every non-workspace view classifies as
     *  `overhead` (attentionCore.classify) — the CLASS would have been right
     *  either way, but this field is a fact about where the user was, and a
     *  telemetry field that is confidently wrong is worse than one that is
     *  coarse. The class vocabulary is untouched, so there is no migration. */
    view: z.enum(['workspace', 'settings', 'council']),
    /** Launch dialog / command palette / worktree panel. Checked BEFORE
     *  sessionId in classify(): an overlay can own the keyboard while a
     *  terminal underneath still holds DOM focus. */
    overlayOpen: z.boolean()
  })
  .strict()
export type AttentionReport = z.infer<typeof attentionReportSchema>

export const attentionSummaryRequestSchema = z.object({
  project_id: z.uuid(),
  /** ISO instants bounding the window. Spans OVERLAPPING it are returned. */
  from: z.string().min(1),
  to: z.string().min(1)
})
export type AttentionSummaryRequest = z.infer<typeof attentionSummaryRequestSchema>

/** All five classes are REQUIRED. A histogram missing a class is a histogram
 *  that cannot be checked against the accounting identity, so it does not
 *  parse. `.strict()` for the F-5b reason: zod silently STRIPS unknown keys. */
export const attentionByClassSchema = z
  .object({
    pane: z.number().int().nonnegative(),
    overhead: z.number().int().nonnegative(),
    blurred: z.number().int().nonnegative(),
    idle: z.number().int().nonnegative(),
    locked: z.number().int().nonnegative()
  })
  .strict()
export type AttentionByClass = z.infer<typeof attentionByClassSchema>

/** Per-session pane samples. `samples`, not minutes — same rule, one level in. */
export const attentionSessionSamplesSchema = z
  .object({
    sessionId: z.string().min(1),
    samples: z.number().int().nonnegative()
  })
  .strict()

export const attentionSummaryResponseSchema = z
  .object({
    projectId: z.uuid(),
    from: z.string(),
    to: z.string(),
    /** THE DENOMINATOR — required, and it sums to `samples`. */
    byClass: attentionByClassSchema,
    samples: z.number().int().nonnegative(),
    /** The cadence samples are expressed in. Minutes = samples x this / 60. */
    tickSeconds: z.number().int().positive(),
    /** Ticks the sampler SHOULD have produced across the window the returned
     *  spans envelope; divergence means the app was down or suspended. */
    expectedSamples: z.number().int().nonnegative(),
    missingSamples: z.number().int().nonnegative(),
    coveragePct: z.number().min(0),
    /** Pane samples per session. Overhead is byClass.overhead — it has no
     *  session by construction (§5.3's per-project bucket). */
    bySession: z.array(attentionSessionSamplesSchema),
    /** ALWAYS 'lower-bound'. Attention is undercounted BY CONSTRUCTION: a long
     *  read past 60 s of no input stops counting, and work done outside the
     *  Chorus window is `blurred` rather than attributed. Present as a field so
     *  the qualifier cannot be separated from the number. */
    estimateBound: z.literal('lower-bound')
  })
  .strict()
export type AttentionSummary = z.infer<typeof attentionSummaryResponseSchema>

/* ------------------------------------------------------------------ */
/* Task 3a-3: "% of spend attributed" (D42, Mission Control spec §5.1) */
/*                                                                     */
/* The honesty shape of this surface is, again, the deliverable — and  */
/* D55 binds it exactly as it bound 3a-2:                              */
/*  1. NEITHER RATIO MAY BE READ ALONE. `attributedUsd`,               */
/*     `gatewayTotalUsd`, `attributedDispatches`, `totalDispatches`    */
/*     and `subscriptionDispatches` are ALL REQUIRED, so a             */
/*     denominator-less response fails the outbound .parse in main     */
/*     rather than shipping a bare percentage that will be believed.   */
/*  2. `spendBasis` states the SCOPE of the dollar figure as a FIELD,  */
/*     so a consumer cannot render the number without the qualifier    */
/*     travelling beside it — 3a-2's `estimateBound` move, applied to  */
/*     the other honesty gap D42 names.                                */
/*  3. `tokensSourceBreakdown` says how many rows' tokens were         */
/*     MEASURED versus DERIVED (§8). A derived number labelled as      */
/*     derived is fine; labelled as measured it is not.                */
/*  4. NO FIELD CAN CARRY KEY MATERIAL. There is no key, no hash, no   */
/*     label, no profile id — and `.strict()` means one cannot be      */
/*     added by accident, because zod silently STRIPS unknown keys     */
/*     (F-5b) and a stripped field is an invisible one.                */
/* ------------------------------------------------------------------ */

export const attributionSummaryRequestSchema = z.object({
  /** ISO instants bounding the window. Dispatches STARTED inside it count. */
  from: z.string().min(1),
  to: z.string().min(1)
})
export type AttributionSummaryRequest = z.infer<typeof attributionSummaryRequestSchema>

/** How each row's token numbers were obtained. Sums to the row count that had
 *  any attribution attempted, so the derived share is checkable rather than
 *  asserted. */
export const tokensSourceBreakdownSchema = z
  .object({
    analytics: z.number().int().nonnegative(),
    analyticsDerived: z.number().int().nonnegative(),
    cliLogs: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative()
  })
  .strict()
export type TokensSourceBreakdown = z.infer<typeof tokensSourceBreakdownSchema>

export const attributionSummaryResponseSchema = z
  .object({
    from: z.string(),
    to: z.string(),
    /** attributedUsd / gatewayTotalUsd. NULL when the total is unknown or
     *  zero — never 0, never NaN. */
    spendPct: z.number().nullable(),
    /** attributedDispatches / totalDispatches. NULL on a zero-dispatch
     *  window — never 0. */
    dispatchPct: z.number().nullable(),
    /* ---- THE DENOMINATORS. All required. ---- */
    attributedUsd: z.number(),
    unattributedUsd: z.number().nullable(),
    gatewayTotalUsd: z.number().nullable(),
    totalDispatches: z.number().int().nonnegative(),
    attributedDispatches: z.number().int().nonnegative(),
    /** ⚠ COUNTED, NEVER PRICED. A flat-rate subscription has no honest
     *  $/token rate, and inventing one would fabricate precisely the number
     *  D42 wants made visible. */
    subscriptionDispatches: z.number().int().nonnegative(),
    tokensSourceBreakdown: tokensSourceBreakdownSchema,
    /** ALWAYS 'gateway-only'. The dollar figure can see OpenRouter spend and
     *  nothing else; subscription work contributes zero dollars BY DESIGN,
     *  not by omission. Present as a field so the qualifier cannot be
     *  separated from the number. */
    spendBasis: z.literal('gateway-only'),
    /** Whether a management key is configured at all. Without one, `spendPct`
     *  is null for a reason a caller would otherwise have to guess at. */
    managementKeyConfigured: z.boolean()
  })
  .strict()
export type AttributionSummary = z.infer<typeof attributionSummaryResponseSchema>

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
  version: z.string().nullable(),
  /** D34(f): adapter-supplied label for agent entries; null for plain tool
   *  probes (git/docker/node). Required-nullable so a producer that forgets it
   *  fails the outbound parse (the 1b-1 `title` discipline). */
  displayName: z.string().nullable(),
  /** D34(f): the AgentKind when this row IS an agent; null when it is a plain
   *  tool. A TYPED value rather than the `agent: boolean` flag D34(f) sketched
   *  — the renderer needs an AgentKind for the launch payload, and a boolean
   *  would force a cast at exactly the boundary this refactor exists to type. */
  agentKind: agentKindSchema.nullable()
})
export type DetectedCli = z.infer<typeof detectedCliSchema>

export const cliDetectResponseSchema = z.array(detectedCliSchema)
export type CliDetectResponse = z.infer<typeof cliDetectResponseSchema>

/* ------------------------------------------------------------------ */
/* Task 3-3: adapter declarations on the wire (D34)                    */
/*                                                                     */
/* cli:detect stays the INSTALLATION probe (found / path / version,    */
/* plus D34(f) display data). adapter:list is the STATIC DECLARATION   */
/* (id, displayName, executionMode, auth methods, capabilities) — a    */
/* coordinator addition beyond D34(f), so Task 3-4's provider form     */
/* renders auth methods from the wire instead of hardcoding them in a  */
/* Vue file (the coupling D34(f) exists to remove, one layer up).      */
/* These schemas mirror src/main/adapters/types.ts; descriptors use    */
/* required-nullable for the "declared but absent" case, matching the  */
/* interface's `| null`.                                               */
/* ------------------------------------------------------------------ */

export const descriptorModeSchema = z.enum(['static', 'dynamic'])
export type DescriptorModeWire = z.infer<typeof descriptorModeSchema>

/**
 * Task 3a-4 — ⚠ `cliFlag: string` was REPLACED by `args: string[]`, not
 * supplemented. A single string cannot express what either installed CLI
 * needs: claude 2.1.218 wants `['--effort', 'high']` and codex 0.145.0 wants
 * `['-c', 'model_reasoning_effort="high"']`. A whitespace split breaks the
 * moment a value needs quoting — and codex's values ARE TOML-quoted — while
 * the alternative, a per-adapter `switch` in `buildLaunch`, would put the
 * mapping in TWO homes in the task whose headline output is a one-home ruling.
 *
 * The replacement was free at execution: grep-verified 2026-07-25, `cliFlag`
 * had ZERO producers and zero real consumers — it appeared only in the type,
 * this schema, and two test fixtures. (`ResumeDescriptor.cliFlag` below is a
 * DIFFERENT field on a different descriptor and is out of scope.)
 *
 * `id` is tightened to the four-level vocabulary, which is what makes the
 * descriptor itself the mapping table.
 */
export const effortOptionSchema = z.object({
  id: effortLevelSchema,
  label: z.string(),
  /** The EXACT argv tokens this level contributes. A flag+value pair and a
   *  `-c key=value` override are the same thing at this level of abstraction,
   *  which is why this is a token ARRAY and not a string. */
  args: z.array(z.string()).min(1)
})
export type EffortOptionWire = z.infer<typeof effortOptionSchema>

export const effortDescriptorSchema = z.object({
  mode: descriptorModeSchema,
  levels: z.array(effortOptionSchema)
})

export const mcpDescriptorSchema = z.object({
  mode: descriptorModeSchema,
  format: z.enum(['json', 'toml', 'yaml']),
  location: z.enum(['project', 'home', 'custom']),
  configPath: z.string().nullable()
})

export const hooksDescriptorSchema = z.object({
  mode: descriptorModeSchema,
  mechanism: z.enum(['http_listener', 'script', 'file_watch'])
})

export const resumeDescriptorSchema = z.object({
  mode: descriptorModeSchema,
  cliFlag: z.string().nullable()
})

export const agentCapabilitiesSchema = z.object({
  interactiveTerminal: z.boolean(),
  worktreeSafe: z.boolean(),
  skills: z.boolean(),
  subscriptionLogin: z.boolean(),
  apiKey: z.boolean(),
  reasoningEffort: effortDescriptorSchema.nullable(),
  sessionResume: resumeDescriptorSchema.nullable(),
  mcp: mcpDescriptorSchema.nullable(),
  hooks: hooksDescriptorSchema.nullable()
})
export type AgentCapabilitiesWire = z.infer<typeof agentCapabilitiesSchema>

export const authMethodDefinitionSchema = z.object({
  type: z.enum(['subscription', 'api_key']),
  label: z.string(),
  /** The env var the api_key method injects into (the DEFAULT — a provider's
   *  env_var_name overrides it, D34(e)); null for subscription methods. */
  requiredEnvVar: z.string().nullable(),
  helpUrl: z.string().nullable()
})
export type AuthMethodDefinitionWire = z.infer<typeof authMethodDefinitionSchema>

/** One adapter's static declaration. NO installation state (that is
 *  cli:detect's job) and no secret-adjacent field anywhere. */
export const adapterDescriptorSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  executionMode: z.enum(['pty', 'api']),
  authMethods: z.array(authMethodDefinitionSchema),
  capabilities: agentCapabilitiesSchema
})
export type AdapterDescriptor = z.infer<typeof adapterDescriptorSchema>

export const adapterListRequestSchema = z.object({})
export type AdapterListRequest = z.infer<typeof adapterListRequestSchema>

export const adapterListResponseSchema = z.array(adapterDescriptorSchema)
export type AdapterListResponse = z.infer<typeof adapterListResponseSchema>

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


/* ------------------------------------------------------------------ */
/* Task 3b-3: the council run                                          */
/* ------------------------------------------------------------------ */

/**
 * ⚠ THE PATH IS AUTHORITATIVE AND `brief_text` IS GONE — Task 3b-4 REPLACED it,
 * it did not widen around it (D68(4)).
 *
 * 3b-3 shipped both: a `brief_path` LABEL main never opened, beside the
 * `brief_text` that was the real input. Keeping the text alongside the path
 * would leave two sources of truth for what the council deliberated on, and the
 * one the renderer controls would be the one that counts — which would make the
 * path validation in `councilService.validateBriefPath` decorative. Main opens
 * the path itself, and there is nothing else on this request for it to read.
 *
 * Nothing here can carry key material in either direction: a run names no
 * credential at all, because a member already names its own.
 */
export const councilStartRequestSchema = z
  .object({
    project_id: z.uuid().nullable(),
    /** ⚠ VALIDATED IN MAIN, NEVER TRUSTED HERE. `min(1).max(1024)` is a bound on
     *  the string, not a security check — absolute, local, `.md`, existing, a
     *  regular file and under the size cap are all decided in main, because a
     *  renderer-supplied path main opens is an arbitrary-file-read primitive. */
    brief_path: z.string().min(1).max(1024)
  })
  .strict()
export type CouncilStartRequest = z.infer<typeof councilStartRequestSchema>

/* --- The brief picker: the `project:add` precedent, exactly ---------- */

export const councilPickBriefRequestSchema = z.object({}).strict()
export type CouncilPickBriefRequest = z.infer<typeof councilPickBriefRequestSchema>

/** Cancel is a STRUCTURED NO-OP, not an error — the `project:add` shape. The
 *  path that comes back is still re-validated by `council:start`: the dialog is
 *  a convenience, never the boundary. */
export const councilPickBriefResponseSchema = z.union([
  z.object({ path: z.string().min(1).max(1024) }).strict(),
  z.object({ cancelled: z.literal(true) }).strict()
])
export type CouncilPickBriefResponse = z.infer<typeof councilPickBriefResponseSchema>

/**
 * ⚠ D55, ENFORCED BY THE SCHEMA RATHER THAN BY DISCIPLINE. `cost_usd` cannot be
 * read without the counts it is a cost OF: how many members were planned, how
 * many answered, how many refused, and for how many the provider actually
 * reported usage. A response carrying a total alone does not parse.
 *
 * Every token field is nullable for the reason `TokenUsage`'s are: "not
 * reported" and "zero" are different facts, and a zero that means the first is
 * the confident-looking number D55 exists to forbid.
 */
export const councilAccountingSchema = z
  .object({
    membersPlanned: z.number().int().nonnegative(),
    membersAnswered: z.number().int().nonnegative(),
    membersRefused: z.number().int().nonnegative(),
    /** ⚠ TURNS, not members — a four-member council runs eight turns across its
     *  four phases, and reporting the second as the first is a denominator
     *  nobody can read. Both ship, separately named. */
    turnsAnswered: z.number().int().nonnegative(),
    turnsRefused: z.number().int().nonnegative(),
    usageReported: z.number().int().nonnegative(),
    usageAbsent: z.number().int().nonnegative(),
    tokensIn: z.number().nullable(),
    tokensOut: z.number().nullable(),
    tokensCached: z.number().nullable()
  })
  .strict()
export type CouncilAccounting = z.infer<typeof councilAccountingSchema>

export const councilStartResponseSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      run_id: z.uuid(),
      /** The findings TEXT, so the view can render it without reading a file. */
      findings: z.string(),
      /** ⚠ DERIVED IN MAIN FROM THE BRIEF PATH, never supplied by the renderer.
       *  NULL when the write failed — never a path that does not exist. */
      findings_path: z.string().nullable(),
      /** The reason beside the null, so an absent file is never an absent
       *  explanation. NULL when the file was written. */
      findings_error: z.string().nullable(),
      /** ⚠ REQUIRED, so the number below can never travel alone. */
      accounting: councilAccountingSchema,
      /** From the minted key's own usage figure — the provider computes it, so
       *  there is one number and one authority. NULL when it could not be read,
       *  never 0. */
      cost_usd: z.number().nullable()
    })
    .strict(),
  z.object({ ok: z.literal(false), reason: z.string() }).strict()
])
export type CouncilStartResponse = z.infer<typeof councilStartResponseSchema>

export const councilCancelRequestSchema = z.object({ run_id: z.uuid() }).strict()
export type CouncilCancelRequest = z.infer<typeof councilCancelRequestSchema>

/** `cancelled: false` means there was no such live run — a race the user cannot
 *  see, and not an error. */
export const councilCancelResponseSchema = z.object({ cancelled: z.boolean() }).strict()
export type CouncilCancelResponse = z.infer<typeof councilCancelResponseSchema>

/** The broadcast, following `session:data` exactly. `delta` is SCRUBBED text
 *  from `SessionOutput`'s `onText`. */
export const councilProgressEventSchema = z
  .object({
    runId: z.uuid(),
    phase: z.enum(['positions', 'critique', 'arbitration', 'synthesis', 'done']),
    round: z.number().int().nonnegative(),
    memberId: z.string().nullable(),
    delta: z.string()
  })
  .strict()
export type CouncilProgressEvent = z.infer<typeof councilProgressEventSchema>

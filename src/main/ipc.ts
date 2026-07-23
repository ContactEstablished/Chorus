import { BrowserWindow, dialog, ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import fs from 'node:fs'
import path from 'node:path'
import { logger, scrubSecrets } from './services/logger'
import {
  IpcChannel,
  layoutSetRequestSchema,
  attachRequestSchema,
  launchRequestSchema,
  launchResponseSchema,
  launchContextRequestSchema,
  launchContextResponseSchema,
  writeRequestSchema,
  resizeRequestSchema,
  killRequestSchema,
  sessionDataEventSchema,
  sessionExitEventSchema,
  sessionRestoredEventSchema,
  cliDetectRequestSchema,
  layoutGetRequestSchema,
  layoutGetResponseSchema,
  projectAddRequestSchema,
  projectAddResponseSchema,
  projectsListSchema,
  projectSelectRequestSchema,
  restartRequestSchema,
  restartResponseSchema,
  deleteSessionRequestSchema,
  setTitleRequestSchema,
  agentKindSchema,
  suggestMode,
  viewGetRequestSchema,
  viewSetRequestSchema,
  viewStateSchema,
  worktreeListRequestSchema,
  worktreeListResponseSchema,
  worktreeRemoveRequestSchema,
  worktreeRemoveResponseSchema,
  worktreeDirtyFilesRequestSchema,
  worktreeDirtyFilesResponseSchema,
  worktreeDiffRequestSchema,
  worktreeDiffResponseSchema,
  dirtyRemovalAllowed,
  branchForceAllowed,
  providerListRequestSchema,
  providerListResponseSchema,
  providerCreateRequestSchema,
  providerCreateResponseSchema,
  providerUpdateRequestSchema,
  providerUpdateResponseSchema,
  providerDeleteRequestSchema,
  providerDeleteResponseSchema,
  credentialListRequestSchema,
  credentialListResponseSchema,
  credentialCreateRequestSchema,
  credentialCreateResponseSchema,
  credentialReplaceRequestSchema,
  credentialReplaceResponseSchema,
  credentialDeleteRequestSchema,
  credentialDeleteResponseSchema,
  type AttachResponse,
  type CliDetectResponse,
  type CredentialCreateResponse,
  type CredentialDeleteResponse,
  type CredentialListResponse,
  type CredentialReplaceResponse,
  type LaunchResponse,
  type LaunchContextResponse,
  type LayoutGetResponse,
  type PickableWorktree,
  type Project,
  type ProjectAddResponse,
  type ProjectsList,
  type ProviderConfig,
  type ProviderCreateResponse,
  type ProviderDeleteResponse,
  type ProviderListResponse,
  type ProviderUpdateResponse,
  type RestartResponse,
  type ViewState,
  type WorktreeDiffSummary,
  type WorktreeRemoveResponse,
  type WorktreeSummary
} from '../shared/ipc'
import { collectSessionIds } from '../shared/layout'
import { detectClis } from './services/cliDetect'
import {
  resolveRepoRoot,
  currentBranch,
  aheadBehind,
  listWorktrees,
  diffShortstat,
  statusPorcelain
} from './services/git'
import type { SessionManager } from './services/sessionManager'
import type { ProjectRecord, StorageService } from './services/storage'
import type { CredentialVault } from './services/vault'
import { worktreeRootFor, type GitWorktreeManager } from './services/worktrees'
import type { NewProviderConfigRow, ProviderConfigRow, WorktreeRow } from './db/schema'

/** Soft cap on panes per project (spec §6/§12): bounds how many agent
 *  processes one project can hold; launches beyond it are rejected. */
const LAUNCH_PANE_CAP = 16

/** Map the internal record onto the IPC wire shape (snake_case root_path). */
function toWireProject(p: ProjectRecord): Project {
  return { id: p.id, name: p.name, root_path: p.rootPath }
}

/** Map a provider row onto the IPC wire shape (snake_case columns). Explicit
 *  construction, same discipline as toWireProject — a spread would silently
 *  re-admit any column a future migration adds. */
function toWireProvider(row: ProviderConfigRow): ProviderConfig {
  return {
    id: row.id,
    name: row.name,
    adapter_type: row.adapterType,
    auth_mode: row.authMode,
    env_var_name: row.envVarName,
    base_url: row.baseUrl,
    extra_headers_json: row.extraHeadersJson,
    created_at: row.createdAt
  }
}

/** Task 3-2 / spec §6.4: the refusal shared by provider:create and
 *  provider:update when extra_headers_json carries a known key shape. */
const PROVIDER_HEADERS_SECRET_REFUSAL =
  'Extra headers look like they contain a credential (a known key shape matched). ' +
  'Provider headers are stored in PLAINTEXT — put the credential on a credential profile instead, where it is encrypted.'

/** spec §6.4: run incoming extra_headers_json through scrubSecrets; if the
 *  scrub would CHANGE the text, a known key shape is present. Turns the
 *  documented "provider headers are non-secret" assumption into an enforced
 *  one, using the canonical pattern list Task 3-1 shipped. */
function headersContainSecret(extraHeadersJson: string | null | undefined): boolean {
  if (extraHeadersJson === undefined || extraHeadersJson === null) return false
  return scrubSecrets(extraHeadersJson) !== extraHeadersJson
}

/** Strip C0 control chars + DEL from a captured title; titles are raw terminal
 *  output. Returns the trimmed remainder (possibly empty — the caller rejects
 *  an empty result rather than writing a blank title). */
export function sanitizeTitle(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\x00-\x1F\x7F]/g, '').trim()
}

/**
 * Register all IPC handlers. Every renderer payload is Zod-parsed before use;
 * a payload that fails validation rejects the invoke and never reaches the PTY.
 *
 * Task 1-5: no closure over a single project — every project-scoped handler
 * resolves `project_id` from its parsed request and FK-checks it against the
 * projects table (schema validity ≠ existence) before touching anything.
 *
 * Task 2-2: the GitWorktreeManager is threaded in from index.ts (the single
 * instance constructed for the boot reconcile) — session:launch's new-worktree
 * path is its first caller.
 *
 * Task 3-2: the CredentialVault is threaded in the same way (D33). The
 * credential:* handlers are WRITE-ONLY inbound — the plaintext key arrives on
 * credential:create / credential:replace and no response ever carries key
 * material or a fingerprint; the outbound .parse on every provider and
 * credential handler is what makes that structural rather than aspirational.
 */
export function registerIpc(
  sessions: SessionManager,
  storage: StorageService,
  worktrees: GitWorktreeManager,
  vault: CredentialVault
): void {
  function requireProject(projectId: string): ProjectRecord {
    const p = storage.getProjectById(projectId)
    if (!p) throw new Error(`Unknown project_id: ${projectId}`)
    return p
  }

  /** F17: git reports forward-slash paths and Windows is case-insensitive —
   *  every path comparison goes through this key (worktrees.ts's pathKey is
   *  the reference; duplicated here because main/ipc may not reach into that
   *  module's private helper). */
  function pathKey(p: string): string {
    return path.win32.normalize(p).toLowerCase()
  }

  /** F18 resolution (a) — decided at 2-2 execution: the branch label resolves
   *  from the WORKTREES side (worktrees.session_id, the authoritative pointer
   *  per D26(a)), never from sessions.worktree_id. The crash window between
   *  `git worktree add` and activation leaves sessions.worktree_id NULL while
   *  the row side is already set, and re-owning a worktree leaves the previous
   *  owner's sessions.worktree_id stale — row-side resolution renders the
   *  correct label in both cases. Task 2-4's diff summary MUST resolve the
   *  worktree the identical way. */
  function worktreeForSession(sessionId: string, projectId: string): WorktreeRow | null {
    return storage.getWorktreesForProject(projectId).find((w) => w.sessionId === sessionId) ?? null
  }

  function branchForSession(sessionId: string, projectId: string): string | null {
    return worktreeForSession(sessionId, projectId)?.branch ?? null
  }

  ipcMain.handle(IpcChannel.SessionAttach, (_event, payload): AttachResponse => {
    const { sessionId } = attachRequestSchema.parse(payload)
    // The sessionId is a sessions DB row id; the row supplies the persisted
    // exit state and cwd for the manager-unknown path below.
    const row = storage.getSessionById(sessionId)
    if (!row) throw new Error(`Unknown sessionId: ${sessionId}`)
    // 2-2: the branch label resolves row-side (F18a) — see worktreeForSession.
    // 2-3: the owning worktree row's id rides along for the close flow.
    const wt = worktreeForSession(row.id, row.projectId)
    const branch = wt?.branch ?? null
    const worktreeId = wt?.id ?? null
    const snap = sessions.attach(sessionId)
    if (snap) {
      // Live in the manager. The restored flag lets a pane that mounted after
      // the session:restored event still wear the badge — consumed here, so
      // exactly one attach reports it per restore relaunch. The snapshot has
      // no title of its own; the row is the source (1b-1).
      return sessions.consumeRestoredBadge(sessionId)
        ? { ...snap, title: row.title, branch, worktreeId, restored: true }
        : { ...snap, title: row.title, branch, worktreeId }
    }
    // Unknown to the SessionManager (row from a previous app run, or a session
    // the restore engine has not reached yet): attach never spawns — report
    // the row's persisted exit state plus the restore chrome signals.
    return {
      sessionId: row.id,
      buffer: '',
      status: 'exited',
      exitCode: row.exitCode,
      title: row.title,
      branch,
      worktreeId,
      ...(sessions.isRestorePending(sessionId) ? { restorePending: true } : {}),
      ...(!fs.existsSync(row.cwd) ? { cwdMissing: true } : {})
    }
  })

  ipcMain.handle(IpcChannel.SessionLaunch, async (_event, payload): Promise<LaunchResponse> => {
    const req = launchRequestSchema.parse(payload)
    const p = requireProject(req.project_id)
    // Security boundary: cwd must be absolute and exist. Main-only, before
    // any row is created or PTY spawned; the renderer is never trusted.
    if (!path.isAbsolute(req.cwd) || !fs.existsSync(req.cwd)) {
      return { ok: false, reason: `Directory not found or not absolute: ${req.cwd}` }
    }
    // Soft pane cap (spec §6): a pathological layout cannot fork dozens of
    // agent processes. Panes = layout leaves for this project. Applies to
    // every mode — a worktree launch adds a pane too.
    const layout = storage.getPaneLayout(p.id)
    const paneCount = layout ? collectSessionIds(layout.root).length : 0
    if (paneCount >= LAUNCH_PANE_CAP) {
      return { ok: false, reason: `Pane cap reached (${LAUNCH_PANE_CAP} per project)` }
    }

    // 2-2 (D22/D26f): the chosen workspace_mode is authoritative. Main
    // validates it and returns {ok:false} inline on any failure — NEVER a
    // silent fallback to another mode.
    if (req.workspace_mode === 'new-worktree') {
      // The mode is validated against the ACTUAL cwd, not the (project-root)
      // suggestion — the dialog's default may be stale for a typed cwd.
      const repoRoot = await resolveRepoRoot(req.cwd)
      if (repoRoot === null) {
        return { ok: false, reason: `Not a git repository: ${req.cwd}` }
      }
      const baseBranch = await currentBranch(repoRoot)
      // F16 (FKs enforced): the sessions row MUST exist before createWorktree
      // inserts its journal row carrying session_id — row-before-worktree is
      // mandatory, not stylistic. cwd starts as req.cwd; activation rewrites
      // it to the worktree path in the same transaction as both pointers.
      const row = storage.createSession({
        id: randomUUID(),
        projectId: p.id,
        agent: req.agent,
        cwd: req.cwd,
        status: 'running',
        exitCode: null,
        createdAt: new Date().toISOString()
      })
      let wt: WorktreeRow
      try {
        wt = await worktrees.createWorktree(row.id, repoRoot, baseBranch) // DB-first journal (2-1)
      } catch (err) {
        // createWorktree deletes its own journal row on every failure branch,
        // so deleting the never-surfaced session row cannot trip the F16 FK
        // (no leaf, no pane ever saw it — pure debris). Do NOT reorder.
        storage.deleteSession(row.id)
        return {
          ok: false,
          reason: `Worktree creation failed: ${err instanceof Error ? err.message : String(err)}`
        }
      }
      // Resolution (a): both pointers + status='active' + session cwd →
      // worktree path, in ONE synchronous transaction.
      storage.activateWorktreeForSession(wt.id, row.id, wt.path)
      const snap = sessions.launch(req.agent, wt.path, row.id) // spawn IN the worktree
      storage.pushRecentCwd(req.cwd)
      return launchResponseSchema.parse({
        ...snap,
        title: row.title,
        branch: wt.branch,
        worktreeId: wt.id
      })
    }

    if (req.workspace_mode === 'existing-worktree') {
      // Attachability is enforced here, independently of what the picker
      // offered: the row must exist, belong to THIS project, be in a settled
      // state, not be owned by a live session, and still be on disk.
      const wt = req.worktree_id ? storage.getWorktreeById(req.worktree_id) : null
      if (!wt) return { ok: false, reason: 'Select an existing worktree to attach' }
      if (wt.projectId !== p.id) {
        return { ok: false, reason: 'That worktree belongs to another project' }
      }
      if (wt.status !== 'detached' && wt.status !== 'active') {
        return { ok: false, reason: `That worktree is not attachable (status: ${wt.status})` }
      }
      if (wt.sessionId !== null && sessions.isRunning(wt.sessionId)) {
        return { ok: false, reason: 'That worktree is in use by a live session' }
      }
      if (!fs.existsSync(wt.path)) {
        return { ok: false, reason: `Worktree directory is gone: ${wt.path}` }
      }
      const row = storage.createSession({
        id: randomUUID(),
        projectId: p.id,
        agent: req.agent,
        cwd: wt.path,
        status: 'running',
        exitCode: null,
        createdAt: new Date().toISOString()
      })
      storage.activateWorktreeForSession(wt.id, row.id, wt.path) // re-own, one txn
      const snap = sessions.launch(req.agent, wt.path, row.id)
      return launchResponseSchema.parse({
        ...snap,
        title: row.title,
        branch: wt.branch,
        worktreeId: wt.id
      })
    }

    // current-tree — the pre-2-2 launch path, unchanged.
    const row = storage.createSession({
      id: randomUUID(),
      projectId: p.id,
      agent: req.agent,
      cwd: req.cwd,
      status: 'running',
      exitCode: null,
      createdAt: new Date().toISOString()
    })
    const snap = sessions.launch(req.agent, req.cwd, row.id)
    storage.pushRecentCwd(req.cwd)
    // Fresh row: title is NULL until a capture event lands (1b-1).
    return launchResponseSchema.parse({ ...snap, title: row.title, branch: null, worktreeId: null })
  })

  ipcMain.handle(
    IpcChannel.SessionLaunchContext,
    async (_event, payload): Promise<LaunchContextResponse> => {
      const req = launchContextRequestSchema.parse(payload)
      const p = requireProject(req.project_id)
      // 2-2 (D26f): repo context for the workspace-mode default, computed in
      // main against the PROJECT ROOT (the dialog's default cwd — a typed cwd
      // change does not re-fetch; main re-validates the chosen mode against
      // the actual cwd at launch). resolveRepoRoot never throws: a non-git
      // project root yields null (findings risk 3) → current-tree only.
      const repoRoot = await resolveRepoRoot(p.rootPath)

      let liveSessionsInRepo = 0
      let pickable: PickableWorktree[] = []
      if (repoRoot !== null) {
        const repoKey = pathKey(repoRoot)
        // OTHER live sessions writing the same MAIN tree: iterate the
        // project's rows and ask the manager (isRunning — no SessionManager
        // API growth; exited rows never count). A live session inside a
        // WORKTREE does NOT match repoRoot: --show-toplevel there returns the
        // worktree's OWN toplevel, so already-isolated agents are excluded —
        // the intended D22 semantics, do not "fix" with --git-common-dir.
        for (const row of storage.getSessionsForProject(p.id)) {
          if (!sessions.isRunning(row.id)) continue
          const rowRoot = await resolveRepoRoot(row.cwd)
          if (rowRoot !== null && pathKey(rowRoot) === repoKey) liveSessionsInRepo++
        }
        // Pickable: detached, or active with no live owning session.
        pickable = storage
          .getWorktreesForProject(p.id)
          .filter((w) => pathKey(w.repoRoot) === repoKey)
          .filter(
            (w) =>
              w.status === 'detached' ||
              (w.status === 'active' && !(w.sessionId !== null && sessions.isRunning(w.sessionId)))
          )
          .map(
            (w): PickableWorktree => ({ id: w.id, branch: w.branch, path: w.path, status: w.status })
          )
      }

      // Outbound parse re-filters recent cwds to strings: the renderer never
      // trusts raw disk contents.
      return launchContextResponseSchema.parse({
        projectRoot: p.rootPath,
        recentCwds: storage.getRecentCwds(),
        repoRoot,
        liveSessionsInRepo,
        suggestedMode: suggestMode(repoRoot, liveSessionsInRepo),
        worktrees: pickable
      })
    }
  )

  ipcMain.handle(IpcChannel.SessionRestart, (_event, payload): RestartResponse => {
    const { sessionId } = restartRequestSchema.parse(payload)
    // D16 clause 4: one path for in-run and post-restart restarts. Read the
    // row, re-validate cwd, spawn via the launch path under the SAME row id
    // (no row creation), write 'running' only after the spawn succeeds.
    const row = storage.getSessionById(sessionId)
    if (!row) return { ok: false, reason: `Unknown sessionId: ${sessionId}` }
    if (sessions.isRunning(sessionId)) {
      return { ok: false, reason: 'Session is still running — kill it before restarting' }
    }
    if (!fs.existsSync(row.cwd)) {
      return { ok: false, reason: `Working directory not found: ${row.cwd}` }
    }
    const agent = agentKindSchema.parse(row.agent)
    try {
      const snap = sessions.launch(agent, row.cwd, row.id)
      storage.updateSessionStatus(sessionId, 'running', null)
      return restartResponseSchema.parse({
        ...snap,
        title: row.title,
        branch: branchForSession(row.id, row.projectId),
        worktreeId: worktreeForSession(row.id, row.projectId)?.id ?? null
      })
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IpcChannel.SessionDelete, (_event, payload): void => {
    const { sessionId } = deleteSessionRequestSchema.parse(payload)
    // Pane close ordering is kill -> awaited exit -> leaf removed -> delete;
    // a live PTY must never lose its row (the invisible-process guard's twin:
    // no PTY may exist that no pane can reach).
    if (sessions.isRunning(sessionId)) {
      throw new Error(`Refusing to delete live session: ${sessionId} (kill it first)`)
    }
    // 2-3 (F16/F18): detach any worktree this session owns BEFORE deleting the
    // row, keyed off the AUTHORITATIVE worktrees side (worktrees.session_id —
    // D26(a)), never sessions.worktree_id alone: crash windows and re-owns
    // leave that pointer NULL/stale while the enforced FK still bites.
    // detachWorktree clears BOTH pointers in ONE transaction (resolution a).
    // This step is LOAD-BEARING, not tidiness: better-sqlite3 enforces FKs
    // (default RESTRICT), so deleteSession throws while any worktrees row
    // references this session. The handler only ever DETACHES — the
    // remove-when-clean offer is renderer UX and runs before this call.
    const row = storage.getSessionById(sessionId)
    if (row) {
      for (const w of storage.getWorktreesForProject(row.projectId)) {
        if (w.sessionId === sessionId) storage.detachWorktree(w.id)
      }
    }
    storage.deleteSession(sessionId)
  })

  /* ------------------------------------------------------------------ */
  /* Task 2-3: worktree cleanup channels (D26 clauses 5-8, Q4, (i), (j)) */
  /* ------------------------------------------------------------------ */

  ipcMain.handle(IpcChannel.WorktreeList, async (_event, payload): Promise<WorktreeSummary[]> => {
    const { project_id } = worktreeListRequestSchema.parse(payload)
    const p = requireProject(project_id)

    // F19 (2-3): the panel must surface what the table does not know about.
    // Same union scan the boot reconcile now runs — adopt managed worktrees
    // with a git entry but no row (population 4, the boot reconcile's own
    // rule applied to post-boot discoveries) and collect orphan directories
    // (population 5) for informational surfacing. Rows from the table alone
    // would leave a fresh/external worktree invisible here.
    const orphanDirs: string[] = []
    const repoRoot = await resolveRepoRoot(p.rootPath)
    if (repoRoot !== null) {
      try {
        const managedRoot = worktreeRootFor(repoRoot)
        const managedKey = pathKey(managedRoot)
        const gitEntries = (await listWorktrees(repoRoot)).filter((e) =>
          pathKey(e.path).startsWith(`${managedKey}\\`)
        )
        const rowKeys = new Set(storage.getWorktreesForProject(p.id).map((r) => pathKey(r.path)))
        for (const entry of gitEntries) {
          if (rowKeys.has(pathKey(entry.path))) continue
          // Population 4b (git metadata for a vanished dir, no row): the boot
          // reconcile logs it as a prune candidate; nothing here to act on.
          if (!fs.existsSync(entry.path)) continue
          storage.createWorktreeRow({
            id: randomUUID(),
            projectId: p.id,
            sessionId: null,
            path: path.win32.normalize(entry.path),
            branch: entry.branch ?? '',
            baseBranch: '',
            repoRoot,
            status: 'detached',
            createdAt: new Date().toISOString()
          })
          logger.info(`[worktrees] list: found untracked worktree ${entry.path}; adopted as detached`)
          rowKeys.add(pathKey(entry.path))
        }
        const entryKeys = new Set(gitEntries.map((e) => pathKey(e.path)))
        if (fs.existsSync(managedRoot)) {
          for (const d of fs.readdirSync(managedRoot, { withFileTypes: true })) {
            if (!d.isDirectory()) continue
            const dir = path.join(managedRoot, d.name)
            if (!entryKeys.has(pathKey(dir)) && !rowKeys.has(pathKey(dir))) orphanDirs.push(dir)
          }
        }
      } catch (err) {
        logger.warn({ err }, '[worktrees] list: repo scan failed; listing table rows only')
      }
    }

    const out: WorktreeSummary[] = []
    for (const w of storage.getWorktreesForProject(p.id)) {
      const dirGone = !fs.existsSync(w.path)
      // A status read can fail on a row whose dir lost its git metadata (P3);
      // treat it as DIRTY so removal still requires the typed token — the
      // protective default, and the panel stays loadable.
      const dirty = dirGone ? [] : await worktrees.getDirtyFiles(w.path).catch(() => ['(unreadable)'])
      // Adopted rows carry branch/baseBranch '' — an empty ref fails
      // rev-list, so skip git there; -1/-1 tells the panel to render —
      // instead of counts (also for prune candidates and git read failures).
      const { ahead, behind } =
        dirGone || w.branch === '' || w.baseBranch === ''
          ? { ahead: -1, behind: -1 }
          : await aheadBehind(w.repoRoot, w.branch, w.baseBranch).catch(() => ({
              ahead: -1,
              behind: -1
            }))
      out.push({
        id: w.id,
        path: w.path,
        branch: w.branch,
        status: w.status,
        clean: !dirGone && dirty.length === 0,
        dirtyCount: dirty.length,
        ahead,
        behind,
        isPruneCandidate: dirGone // population-2 surfacing (dir gone, git meta may remain)
      })
    }
    // Population 5 (orphan directories): surfaced INFORMATIONALLY with the
    // nil-uuid sentinel (no row exists). Reconcile never auto-deletes them —
    // they may be agent output, not debris — and the panel gives them no
    // action affordance (removal would be bespoke recursive fs deletion,
    // the data-loss surface D26(i) rejected for worktree removal).
    for (const dir of orphanDirs) {
      out.push({
        id: '00000000-0000-0000-0000-000000000000',
        path: dir,
        branch: '',
        status: 'orphan-dir',
        clean: true,
        dirtyCount: 0,
        ahead: -1,
        behind: -1,
        isPruneCandidate: true
      })
    }
    return worktreeListResponseSchema.parse(out)
  })

  ipcMain.handle(IpcChannel.WorktreeDirtyFiles, async (_event, payload): Promise<string[]> => {
    const { worktreeId } = worktreeDirtyFilesRequestSchema.parse(payload)
    const w = storage.getWorktreeById(worktreeId)
    if (!w || !fs.existsSync(w.path)) return []
    return worktreeDirtyFilesResponseSchema.parse(await worktrees.getDirtyFiles(w.path))
  })

  // Task 2-4: READ-ONLY diff summary for the pane header. Worktree resolution
  // goes through worktreeForSession (worktrees.session_id, F18 resolution a) —
  // the IDENTICAL path as the branch label, so the two can never disagree
  // about whether a session is in a worktree (a crash-window promote leaves
  // sessions.worktree_id NULL while the row-side pointer stands). No staging,
  // no commit, no merge, no removal, no --force: git diff + git status only.
  ipcMain.handle(
    IpcChannel.WorktreeDiffSummary,
    async (_event, payload): Promise<WorktreeDiffSummary | null> => {
      const { sessionId } = worktreeDiffRequestSchema.parse(payload)
      const row = storage.getSessionById(sessionId)
      if (!row) return null
      const wt = worktreeForSession(sessionId, row.projectId)
      if (!wt || !fs.existsSync(wt.path)) return null
      const stat = await diffShortstat(wt.path)
      const untracked = (await statusPorcelain(wt.path)).filter((l) => l.startsWith('??')).length
      return worktreeDiffResponseSchema.parse({ ...stat, untracked })
    }
  )

  ipcMain.handle(IpcChannel.WorktreeRemove, async (_event, payload): Promise<WorktreeRemoveResponse> => {
    const req = worktreeRemoveRequestSchema.parse(payload)
    const w = storage.getWorktreeById(req.worktreeId)
    if (!w) return worktreeRemoveResponseSchema.parse({ ok: false, reason: 'Worktree not found' })
    // The owning session must not be live (D26 clause 8: removal sequences
    // after the process tree has exited).
    if (w.sessionId && sessions.isRunning(w.sessionId)) {
      return worktreeRemoveResponseSchema.parse({
        ok: false,
        reason: 'Kill the owning session before removing its worktree'
      })
    }
    // LIVE cleanliness re-check (D26 clause 6): the renderer's fresh read
    // narrows the race window; this re-check closes it. Never trust the
    // panel's list-time clean flag — it may be hours stale.
    const dirGone = !fs.existsSync(w.path)
    const clean =
      dirGone || (await worktrees.getDirtyFiles(w.path).catch(() => ['(unreadable)'])).length === 0
    if (!dirtyRemovalAllowed({ path: w.path, clean }, req.confirmation)) {
      return worktreeRemoveResponseSchema.parse({
        ok: false,
        reason: 'Type the worktree path to confirm removing uncommitted work'
      })
    }
    try {
      await worktrees.removeWorktree(w.id, {
        deleteBranch: req.deleteBranch,
        // D26(i): --force reaches git ONLY here — the gated dirty-removal
        // path, after the live re-check AND the typed token. Every other
        // caller passes forceDirty: false.
        forceDirty: !clean,
        // D26(j) as amended by F21: -D escalation is licensed by its OWN
        // acknowledgment naming the branch. The dirty-removal token no longer
        // reaches this decision — a main-side gate, so the escalation is
        // unreachable regardless of what any renderer sends.
        forceBranch: branchForceAllowed(w, req.branchForceConfirmation)
      })
    } catch (err) {
      // A genuine removal failure leaves the row journaled 'removing' —
      // revert so the panel keeps offering it. (A branch-deletion refusal
      // deletes the row inside removeWorktree first, making this a no-op
      // there; the surfaced message still reaches the user.)
      storage.updateWorktreeStatus(w.id, 'detached')
      return worktreeRemoveResponseSchema.parse({
        ok: false,
        reason: err instanceof Error ? err.message : String(err)
      })
    }
    return worktreeRemoveResponseSchema.parse({ ok: true })
  })

  /* ------------------------------------------------------------------ */
  /* Task 3-2: providers + credential vault (D33)                        */
  /* ------------------------------------------------------------------ */

  ipcMain.handle(IpcChannel.ProviderList, (_event, payload): ProviderListResponse => {
    providerListRequestSchema.parse(payload ?? {})
    return providerListResponseSchema.parse(storage.listProviderConfigs().map(toWireProvider))
  })

  ipcMain.handle(IpcChannel.ProviderCreate, (_event, payload): ProviderCreateResponse => {
    const req = providerCreateRequestSchema.parse(payload)
    // spec §6.4: provider-level headers are PLAINTEXT (documented non-secret,
    // D33 resolution e) — a credential pasted here defeats the design. Refuse
    // and redirect the user to a credential profile, where it is encrypted.
    if (headersContainSecret(req.extra_headers_json)) {
      return providerCreateResponseSchema.parse({
        ok: false,
        reason: PROVIDER_HEADERS_SECRET_REFUSAL
      })
    }
    const row = storage.createProviderConfig({
      id: randomUUID(),
      name: req.name,
      adapterType: req.adapter_type,
      authMode: req.auth_mode,
      envVarName: req.env_var_name ?? null,
      baseUrl: req.base_url ?? null,
      extraHeadersJson: req.extra_headers_json ?? null,
      createdAt: new Date().toISOString()
    })
    return providerCreateResponseSchema.parse({ ok: true, provider: toWireProvider(row) })
  })

  ipcMain.handle(IpcChannel.ProviderUpdate, (_event, payload): ProviderUpdateResponse => {
    const req = providerUpdateRequestSchema.parse(payload)
    if (!storage.getProviderConfigById(req.id)) {
      return providerUpdateResponseSchema.parse({ ok: false, reason: 'Provider not found' })
    }
    if (headersContainSecret(req.extra_headers_json)) {
      return providerUpdateResponseSchema.parse({
        ok: false,
        reason: PROVIDER_HEADERS_SECRET_REFUSAL
      })
    }
    // Patch semantics: absent = unchanged; null = clear; a value = set.
    const patch: Partial<Omit<NewProviderConfigRow, 'id' | 'createdAt'>> = {}
    if (req.name !== undefined) patch.name = req.name
    if (req.adapter_type !== undefined) patch.adapterType = req.adapter_type
    if (req.auth_mode !== undefined) patch.authMode = req.auth_mode
    if (req.env_var_name !== undefined) patch.envVarName = req.env_var_name
    if (req.base_url !== undefined) patch.baseUrl = req.base_url
    if (req.extra_headers_json !== undefined) patch.extraHeadersJson = req.extra_headers_json
    storage.updateProviderConfig(req.id, patch)
    return providerUpdateResponseSchema.parse({ ok: true })
  })

  ipcMain.handle(IpcChannel.ProviderDelete, (_event, payload): ProviderDeleteResponse => {
    const { id } = providerDeleteRequestSchema.parse(payload)
    const existing = storage.getProviderConfigById(id)
    if (!existing) {
      return providerDeleteResponseSchema.parse({ ok: false, reason: 'Provider not found' })
    }
    // F16: credential_profiles.provider_id REFERENCES provider_configs(id) is
    // ENFORCED (default RESTRICT) — count-and-refuse BEFORE SQLite can throw,
    // never reverse-engineer a caught SQLITE_CONSTRAINT_FOREIGNKEY into a user
    // message (the failure mode Task 2-3 already paid for once).
    const referencing = storage.countCredentialProfilesForProvider(id)
    if (referencing > 0) {
      return providerDeleteResponseSchema.parse({
        ok: false,
        reason: `Provider '${existing.name}' still has ${referencing} credential profile${referencing === 1 ? '' : 's'} — delete ${referencing === 1 ? 'it' : 'them'} first`
      })
    }
    storage.deleteProviderConfig(id)
    return providerDeleteResponseSchema.parse({ ok: true })
  })

  ipcMain.handle(IpcChannel.CredentialList, (_event, payload): CredentialListResponse => {
    credentialListRequestSchema.parse(payload ?? {})
    // Two independent barriers keep key material off the wire: toProfileMeta's
    // explicit construction inside the vault, then this OUTBOUND parse — a
    // handler returning a raw row (blob, fingerprint) fails loudly HERE.
    return credentialListResponseSchema.parse(vault.listProfiles())
  })

  // credential:create is NEVER logged — not at any level, behind any flag
  // (D33 redaction rule 4). The plaintext key enters exactly here, travels
  // renderer -> main once, and no response field ever carries it back.
  ipcMain.handle(IpcChannel.CredentialCreate, (_event, payload): CredentialCreateResponse => {
    const req = credentialCreateRequestSchema.parse(payload)
    if (!storage.getProviderConfigById(req.providerId)) {
      return credentialCreateResponseSchema.parse({ ok: false, reason: 'Provider not found' })
    }
    const result = vault.createProfile({
      providerId: req.providerId,
      label: req.label,
      key: req.key,
      baseUrl: req.baseUrl,
      extraHeaders: req.extraHeaders
    })
    return credentialCreateResponseSchema.parse(
      result.ok ? { ok: true, id: result.value.id } : { ok: false, reason: result.message }
    )
  })

  // credential:replace — same write-only discipline as create; never logged.
  ipcMain.handle(IpcChannel.CredentialReplace, (_event, payload): CredentialReplaceResponse => {
    const req = credentialReplaceRequestSchema.parse(payload)
    const result = vault.replaceProfile(req.id, {
      key: req.key,
      baseUrl: req.baseUrl,
      extraHeaders: req.extraHeaders
    })
    return credentialReplaceResponseSchema.parse(
      result.ok ? { ok: true } : { ok: false, reason: result.message }
    )
  })

  ipcMain.handle(IpcChannel.CredentialDelete, (_event, payload): CredentialDeleteResponse => {
    const { id } = credentialDeleteRequestSchema.parse(payload)
    if (!storage.getCredentialProfileById(id)) {
      return credentialDeleteResponseSchema.parse({ ok: false, reason: 'Credential profile not found' })
    }
    vault.deleteProfile(id)
    return credentialDeleteResponseSchema.parse({ ok: true })
  })

  ipcMain.handle(IpcChannel.SessionSetTitle, (_event, payload): void => {
    const { sessionId, title } = setTitleRequestSchema.parse(payload)
    // Titles are raw terminal output: strip controls, re-bound, and never
    // persist a blank — an empty post-sanitize result is a silent no-op.
    const clean = sanitizeTitle(title).slice(0, 120)
    if (clean.length === 0) return
    storage.updateSessionTitle(sessionId, clean)
    // Write cadence is the debounce's observable: ~1 line per settle, never
    // one per TUI redraw. Titles are terminal output, not secrets.
    logger.info(`[title] persisted ${sessionId}: ${JSON.stringify(clean)}`)
  })

  ipcMain.handle(IpcChannel.CliDetect, (_event, payload): Promise<CliDetectResponse> => {
    cliDetectRequestSchema.parse(payload ?? {})
    return detectClis()
  })

  ipcMain.handle(IpcChannel.LayoutGet, (_event, payload): LayoutGetResponse => {
    const req = layoutGetRequestSchema.parse(payload)
    const p = requireProject(req.project_id)
    // Session data rides the layout:get response (no new channel). Outbound
    // parse keeps the boundary schema-checked in both directions. 2-2: the
    // branch label joins the rows here — resolved from the WORKTREES side
    // (worktrees.session_id, F18a) in a single pass over the project's
    // worktree rows, NOT per-row lookups via sessions.worktree_id.
    const branchBySession = new Map<string, string>()
    for (const w of storage.getWorktreesForProject(p.id)) {
      if (w.sessionId !== null) branchBySession.set(w.sessionId, w.branch)
    }
    return layoutGetResponseSchema.parse({
      layout: storage.getPaneLayout(p.id),
      sessions: storage
        .getSessionsForProject(p.id)
        .map((row) => ({ ...row, branch: branchBySession.get(row.id) ?? null }))
    })
  })

  ipcMain.handle(IpcChannel.LayoutSet, (_event, payload): void => {
    // layoutSetRequestSchema enforces shape + ratio bounds at the boundary;
    // savePaneLayout normalizes again on write (clamp + dedupe) — defense in
    // depth per council D9. A null tree means the last pane closed: DELETE the
    // row — its absence is the empty signal. Per project, as 1-4 established.
    const req = layoutSetRequestSchema.parse(payload)
    const p = requireProject(req.project_id)
    if (req.layout === null) {
      storage.clearPaneLayout(p.id)
      return
    }
    storage.savePaneLayout(p.id, req.layout)
  })

  ipcMain.handle(IpcChannel.ViewGet, (_event, payload): ViewState => {
    const req = viewGetRequestSchema.parse(payload)
    const p = requireProject(req.project_id)
    // D20: filmstrip is the DEFAULT, applied when no row exists — this is what
    // makes existing DBs open in the filmstrip on first post-1b boot. Outbound
    // parse keeps the boundary schema-checked (storage already collapses
    // corrupt rows to null, so the default covers them too).
    return viewStateSchema.parse(
      storage.getViewState(p.id) ?? { mode: 'filmstrip', focusedSessionId: null }
    )
  })

  ipcMain.handle(IpcChannel.ViewSet, (_event, payload): void => {
    const req = viewSetRequestSchema.parse(payload)
    const p = requireProject(req.project_id)
    // focusedSessionId is deliberately NOT FK-checked (F4): it legitimately
    // outlives its session; views resolve staleness by first-leaf fallback.
    storage.setViewState(p.id, req.state)
  })

  ipcMain.handle(IpcChannel.ProjectAdd, async (_event, payload): Promise<ProjectAddResponse> => {
    projectAddRequestSchema.parse(payload ?? {})
    // D3: the native picker runs in main; the renderer never enumerates
    // directories itself. Cancel is a structured no-op, not an error.
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || !result.filePaths[0]) {
      return projectAddResponseSchema.parse({ cancelled: true })
    }
    const project = storage.getOrCreateProject(result.filePaths[0])
    return projectAddResponseSchema.parse({ project: toWireProject(project) })
  })

  ipcMain.handle(IpcChannel.ProjectList, (_event): ProjectsList => {
    const activeId = storage.getActiveProjectId()
    return projectsListSchema.parse(
      storage.listProjects().map((p) => ({ ...toWireProject(p), active: p.id === activeId }))
    )
  })

  ipcMain.handle(IpcChannel.ProjectSelect, (_event, payload): void => {
    const req = projectSelectRequestSchema.parse(payload)
    const p = requireProject(req.project_id)
    storage.setActiveProjectId(p.id)
    BrowserWindow.getAllWindows()[0]?.setTitle(p.name)
    // Lazy restore (D16): relaunch this project's persisted 'running' rows
    // now — never before its first activation. restore() is idempotent within
    // a run (live-guarded, healed rows stay healed), so re-selects are cheap.
    void sessions.restore(p.id)
  })

  ipcMain.handle(IpcChannel.SessionWrite, (_event, payload) => {
    const { sessionId, data } = writeRequestSchema.parse(payload)
    sessions.write(sessionId, data)
  })

  ipcMain.handle(IpcChannel.SessionResize, (_event, payload) => {
    const { sessionId, cols, rows } = resizeRequestSchema.parse(payload)
    sessions.resize(sessionId, cols, rows)
  })

  ipcMain.handle(IpcChannel.SessionKill, (_event, payload) => {
    const { sessionId } = killRequestSchema.parse(payload)
    sessions.kill(sessionId)
  })

  // Outbound events are validated here in main (the preload cannot run Zod
  // under the page CSP), so both directions of the boundary stay schema-checked.
  sessions.onData((sessionId, data) => {
    const event = sessionDataEventSchema.parse({ sessionId, data })
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IpcChannel.SessionData, event)
    }
  })

  sessions.onExit((sessionId, exitCode) => {
    const event = sessionExitEventSchema.parse({ sessionId, exitCode })
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IpcChannel.SessionExit, event)
    }
  })

  sessions.onRestored((sessionId) => {
    const event = sessionRestoredEventSchema.parse({ sessionId })
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IpcChannel.SessionRestored, event)
    }
  })
}

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { extname } from 'node:path'
import type { TeamStorage } from './teamStorage'
import type { StorageService } from './storage'
import { teamAssert } from './teamCore'
import { teamDiff } from './git'
import type { TeamFilePreview, TeamReviewPacket } from '../../shared/team'

const exec = promisify(execFile)
type Query = { runId: string; integrationId: string; expectedVersion: number }
function context(teams: TeamStorage, storage: StorageService, q: Query) {
  const run = teams.getRun(q.runId)
  const integration = teams.integrations(run.id).find(i => i.id === q.integrationId)
  teamAssert(integration && integration.version === q.expectedVersion, 'STALE_VERSION', 'This result changed. Reopen its review before deciding.')
  teamAssert(integration.resultSha, 'PREVIEW_UNAVAILABLE', 'This result has not been prepared yet.')
  const workspace = run.integrationWorktreeId ? storage.getWorktreeById(run.integrationWorktreeId) : null
  teamAssert(workspace && workspace.projectId === run.projectId, 'WORKSPACE_UNAVAILABLE', 'The retained review workspace is unavailable.')
  return { integration, cwd: workspace.path }
}

/** Review evidence is fetched directly; it must never depend on history pagination. */
export async function readTeamReview(teams: TeamStorage, storage: StorageService, q: Query): Promise<TeamReviewPacket> {
  const { integration, cwd } = context(teams, storage, q)
  const task = teams.tasks(q.runId).find(t => t.id === integration.taskId)
  const review = teams.latestReview(q.runId, integration.taskId, integration.attemptId, 'prepared')
  const exact = review?.id === integration.preparedReviewId && review.review.reviewedSha === integration.resultSha && review.review.integrationId === integration.id
  const diff = await teamDiff(cwd, integration.expectedHead, integration.resultSha!)
  context(teams, storage, q)
  return { integration, title: task?.command.title ?? 'Prepared changes', explanation: exact ? review.review.explanation : 'No lead review is available for this exact prepared result.', tests: exact ? review.review.tests : [], paths: diff.paths, diff: diff.text, truncated: diff.truncated }
}

/** Read an immutable regular Git blob, never the mutable checkout or a symlink target. */
export async function readTeamFile(cwd: string, sha: string, file: string): Promise<TeamFilePreview> {
  const unavailable = (note: string): TeamFilePreview => ({ path: file, sha, kind: 'unavailable', content: '', note })
  teamAssert(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(sha) && !file.includes('\0'), 'INVALID_REQUEST', 'Invalid preview identity.')
  const options = { cwd, windowsHide: true, timeout: 15000, maxBuffer: 8 * 1024 * 1024, encoding: 'buffer' as const }
  const tree = await exec('git', ['--literal-pathspecs', 'ls-tree', '-z', sha, '--', file], options)
  const entry = tree.stdout.toString('utf8').split('\0').find(e => e.slice(e.indexOf('\t') + 1) === file)
  if (!entry) return unavailable('This file does not exist in this version (added or deleted).')
  const match = /^(100644|100755) blob ([a-f0-9]+)\t/.exec(entry)
  if (!match) return unavailable('Only regular files can be previewed. Links and submodules are not opened.')
  const size = await exec('git', ['cat-file', '-s', match[2]], options)
  if (Number(size.stdout.toString()) > 8 * 1024 * 1024) return unavailable('This file exceeds the 8 MiB preview limit.')
  const { stdout: bytes } = await exec('git', ['cat-file', 'blob', match[2]], options)
  const extension = extname(file).toLowerCase()
  const images: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' }
  if (images[extension]) return { path: file, sha, kind: 'image', content: `data:${images[extension]};base64,${bytes.toString('base64')}`, note: '' }
  if (extension === '.pdf') return { path: file, sha, kind: 'pdf', content: bytes.toString('base64'), note: '' }
  if (bytes.includes(0)) return unavailable('Binary file: no readable preview is available.')
  return { path: file, sha, kind: ['.html', '.htm'].includes(extension) ? 'html' : 'text', content: bytes.toString('utf8'), note: ['.html', '.htm'].includes(extension) ? 'Static layout preview. Scripts and external resources are disabled; interactive behavior is not verified here.' : '' }
}

export async function readTeamPreview(teams: TeamStorage, storage: StorageService, q: Query & { path: string; side: 'before' | 'after' }): Promise<TeamFilePreview> {
  const { integration, cwd } = context(teams, storage, q)
  const diff = await teamDiff(cwd, integration.expectedHead, integration.resultSha!)
  teamAssert(diff.paths.includes(q.path), 'INVALID_REQUEST', 'Choose a changed file from this review.')
  const preview = await readTeamFile(cwd, q.side === 'before' ? integration.expectedHead : integration.resultSha!, q.path)
  context(teams, storage, q)
  return preview
}

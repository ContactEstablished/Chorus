/**
 * Task 6-4 (Phase 6 Stage 3) — provenance, which is ADVISORY AND THEREFORE
 * MEASURED.
 *
 * PURE: no driver, no storage, no electron. The queries are strings here and are
 * asserted as strings in the test — a pure core cannot execute Cypher, and
 * pretending otherwise is how a core stops being pure.
 *
 * ⚠ STATE THE LIMIT BEFORE THE ANSWER: CHORUS CANNOT ENFORCE PROVENANCE. Agents
 * write through MCP with a Cypher tool, so nothing stops one creating a
 * `:Memory` with no source and no session. What ships instead is the move
 * `attributionCore`'s *"% of spend attributed"* already makes — convert an
 * unenforceable rule into a measured one (D126 Q2).
 *
 * ⚠ AND F49's LIMIT IS SHARPER, SO IT IS WRITTEN WHERE A READER WILL MEET IT.
 * The write tool takes ARBITRARY Cypher, so the same tool can bulk-modify,
 * poison, relabel or `DETACH DELETE` memories **and the provenance edges this
 * module counts**. The number below is computed from data that tool can rewrite:
 * **a corrupted graph can report itself healthy.** Per-container isolation
 * bounds the blast radius to one project and does nothing inside it.
 * Backup/export/restore is Stage 5 and **F49 gates it** — no project graph may
 * be presented as durable memory until export and restore exist and have been
 * exercised. This is a measurement, not an integrity guarantee.
 *
 * Identity rules live in `docs/Features/Foundation/Phase-6-IdentityModel.md`,
 * settled before any of this was written.
 */

/** Which path wrote a node. The first question a provenance audit asks, and it
 *  cannot be reconstructed later — so every node carries it. */
export const WRITTEN_VIA = ['mcp', 'app', 'skill'] as const
export type WrittenVia = (typeof WRITTEN_VIA)[number]

/**
 * ⚠ THERE IS NO `confidence` FIELD, IN ANY FORM (D94.3, ratified by CR-6.0 Q1).
 * Self-reported LLM confidence is uncalibrated, not comparable across models,
 * and **will be read as rigor** — the failure D55 legislated against. What
 * replaces it is `assertedBy` (who said so) and a DERIVED `corroborations` count
 * of independent `:SUPPORTED_BY` sources (how many things back it up). Both are
 * facts; a self-graded number is not.
 */
export interface MemoryRecord {
  readonly id: string
  readonly content: string
  readonly chorusProjectId: string
  readonly writtenVia: WrittenVia
  /** Model id + adapter id — WHO asserted this, not how sure they claimed to be. */
  readonly assertedBy: { readonly modelId: string; readonly adapterId: string } | null
  readonly validFrom: string
  /** NULL means "currently believed". Indexed, so "what do we believe now" is a
   *  seek rather than a scan (D94.4). Set on the OLD node when a new one
   *  SUPERSEDES it. */
  readonly validTo: string | null
}

/* ─── Identity ───────────────────────────────────────────────────────── */

/**
 * `wt:<worktreeId>` or `pj:<projectId>` — identity model §2.
 *
 * ⚠ THE PREFIX IS NOT DECORATION. `sessions.worktree_id` is NULLABLE and is NULL
 * for a session in the project's own checkout, which is the COMMONEST case, so
 * two id spaces have to live in one property. They must be un-collidable BY
 * CONSTRUCTION, not by the assumption that two UUID generators never meet.
 */
export function workspaceInstanceId(input: {
  worktreeId: string | null
  projectId: string
}): string {
  return input.worktreeId ? `wt:${input.worktreeId}` : `pj:${input.projectId}`
}

/**
 * Choose one repository identity when a repo has several root commits.
 *
 * ⚠ LEXICOGRAPHICALLY SMALLEST, NOT "EARLIEST", AND THAT IS A DELIBERATE
 * DEVIATION FROM THE SPEC (identity model §3(i)). Commit dates are user-settable,
 * can be identical across two roots, and `git rev-list --max-parents=0` does not
 * document its output order — so a date-based rule is not guaranteed to give two
 * machines the same answer, which is the ONE property this identifier exists to
 * have. Sorting SHAs as strings is total, deterministic and machine-independent.
 *
 * Returns null for a repository with no commits, or for a project that is not a
 * git repository at all — both real states rather than errors, and both simply
 * mean no `:Commit` node may be written (identity model §3(ii)).
 */
export function selectRepoId(rootShas: readonly string[]): string | null {
  const cleaned = rootShas.map((s) => s.trim().toLowerCase()).filter((s) => /^[0-9a-f]{7,64}$/.test(s))
  if (cleaned.length === 0) return null
  return [...cleaned].sort()[0]
}

export type NormalizeResult =
  | { readonly ok: true; readonly relPath: string }
  | { readonly ok: false; readonly reason: string }

/** Separators to `/`, NFC, and no trailing slash. */
function canonical(p: string): string {
  return p.normalize('NFC').replace(/\\/g, '/').replace(/\/+$/, '')
}

/**
 * An absolute path, expressed relative to its own workspace instance root —
 * identity model §4.
 *
 * ⚠ CASE IS PRESERVED IN THE RESULT, NOT FOLDED, AND THAT IS A DECLARED LIMIT.
 * git is case-sensitive; NTFS is case-insensitive by default. Folding would
 * merge two files git considers distinct — silent data loss. Preserving means
 * two spellings of one file on Windows can create two `:File` nodes. Both are
 * wrong in some direction, and a declared limit beats a hidden one.
 *
 * ⚠ THE ROOT PREFIX, HOWEVER, IS MATCHED CASE-INSENSITIVELY, and the asymmetry
 * is deliberate rather than sloppy. The root comes from Chorus's own database
 * (`worktrees.path` / `projects.root_path`) while the path comes from an agent,
 * and on Windows the two can legitimately disagree on the drive letter's case
 * (`c:\` vs `C:\`). Refusing on that would reject a correct path for a reason
 * the user cannot see. The SEGMENTS keep whatever case they arrived with.
 */
export function normalizeRelPath(absPath: string, instanceRoot: string): NormalizeResult {
  const path = canonical(absPath)
  const root = canonical(instanceRoot)

  if (path === '') return { ok: false, reason: 'A file needs a path.' }
  if (root === '') return { ok: false, reason: 'The workspace has no root path recorded.' }

  const lowerPath = path.toLowerCase()
  const lowerRoot = root.toLowerCase()

  if (lowerPath === lowerRoot) {
    return { ok: false, reason: 'That is the workspace root itself, not a file inside it.' }
  }
  if (!lowerPath.startsWith(lowerRoot + '/')) {
    // ⚠ REFUSED, NOT CLAMPED. A path outside its instance root is not
    // repository-relative, and silently clamping it INVENTS AN IDENTITY — two
    // different files would land on one node.
    return {
      ok: false,
      reason: 'That file is outside this workspace, so it has no path relative to it.'
    }
  }

  const rest = path.slice(root.length + 1)
  const segments: string[] = []
  for (const seg of rest.split('/')) {
    if (seg === '' || seg === '.') continue // a leading './' or a doubled slash
    if (seg === '..') {
      // Refused rather than resolved: a path that climbs out of its own root is
      // not describable in this identity space, and resolving it here would
      // quietly key a file to a workspace it does not belong to.
      return {
        ok: false,
        reason: 'That path steps outside the workspace, so it cannot be recorded against it.'
      }
    }
    segments.push(seg)
  }

  if (segments.length === 0) {
    return { ok: false, reason: 'That is the workspace root itself, not a file inside it.' }
  }
  return { ok: true, relPath: segments.join('/') }
}

/* ─── Writing a memory ───────────────────────────────────────────────── */

/**
 * The parameters for a `:Memory` write. **Parameters, never an interpolated
 * string** — memory content is agent-authored text, and concatenating it into
 * Cypher is an injection site by construction.
 *
 * `assertedBy` is flattened to two scalars because Neo4j properties cannot hold
 * a map; a nested object would be silently rejected at write time.
 */
export function memoryWriteParams(record: MemoryRecord): Record<string, unknown> {
  return {
    id: record.id,
    content: record.content,
    chorusProjectId: record.chorusProjectId,
    writtenVia: record.writtenVia,
    assertedByModel: record.assertedBy?.modelId ?? null,
    assertedByAdapter: record.assertedBy?.adapterId ?? null,
    validFrom: record.validFrom,
    validTo: record.validTo
  }
}

/* ─── The queries ────────────────────────────────────────────────────── */

/**
 * ⚠ THE DENOMINATOR IS CURRENT MEMORIES ONLY — `chorusProjectId = $projectId`
 * AND `validTo IS NULL`. A superseded memory's provenance is HISTORY and cannot
 * be repaired, so including it would inflate the denominator with rows no action
 * can move. This has to be stated in the UI copy too, because *"43 of 512"* is a
 * different claim depending on what 512 counts (D55).
 */
const CURRENT_MEMORIES = `MATCH (m:Memory {chorusProjectId: $projectId})\nWHERE m.validTo IS NULL`

/**
 * ⚠ WHAT "SOURCED" MEANS, AND THE SESSION EDGE ALONE DOES NOT COUNT. D126's
 * third unasked finding: *"a Chorus-written session node is not provenance"* —
 * if agents can ignore, relabel or delete it, counting it as a source
 * MANUFACTURES A FALSE DENOMINATOR. `SUPPORTED_BY` is the load-bearing half;
 * `PRODUCED` is attribution. Both are required.
 *
 * The `SUPPORTED_BY` target must be a `:File` or `:Commit` **that exists in the
 * graph** — an edge to a dangling node would be a citation to nothing.
 */
const HAS_SUPPORT = `EXISTS { MATCH (m)-[:SUPPORTED_BY]->(src) WHERE src:File OR src:Commit }`
const HAS_SESSION = `EXISTS { MATCH (:AgentSession)-[:PRODUCED]->(m) }`

export const PROVENANCE_QUERIES = {
  /** The denominator. */
  total: `${CURRENT_MEMORIES}\nRETURN count(m) AS total`,

  /** The numerator — both conditions, never just the session edge. */
  withSource: `${CURRENT_MEMORIES}\n  AND ${HAS_SUPPORT}\n  AND ${HAS_SESSION}\nRETURN count(m) AS withSource`,

  /**
   * The affected-node list: which memories are missing provenance, so the number
   * points at something. Bounded, and the caller renders its own denominator
   * when it is (D55 one level down).
   */
  affected: `${CURRENT_MEMORIES}\n  AND (NOT ${HAS_SUPPORT} OR NOT ${HAS_SESSION})\nRETURN m.id AS id, m.content AS content, m.writtenVia AS writtenVia\nORDER BY m.id\nLIMIT $limit`
} as const

/** How many affected rows a single validate call will return. Bounded because a
 *  graph with 50 000 unsourced memories must not send 50 000 rows across the
 *  bridge to render a list nobody scrolls. */
export const AFFECTED_LIMIT = 50

/* ─── The report ─────────────────────────────────────────────────────── */

/**
 * ⚠ RE-EXPORTED FROM `shared/`, NOT DEFINED HERE, AND THE MOVE IS THE DECISION.
 * These three are the user-facing WORDING, and the renderer shows them — but the
 * renderer may not import main-process code. `shared/provenance.ts` is where a
 * sentence both sides read has to live (the `projectLifecycle.ts` precedent,
 * which exists because this repo has no `.vue` tests, so a sentence assembled in
 * a template is unreachable by the suite). Re-exported so this module remains
 * the one place a caller in main needs to look.
 */
export { completeness, affectedLabel, PROVENANCE_DISCLAIMER, type Completeness } from '../../shared/provenance'


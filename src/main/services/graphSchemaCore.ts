/**
 * Task 6-4 (Phase 6 Stage 3) — the GRAPH's own migration ledger.
 *
 * PURE: no driver, no storage, no electron. Plan §9's reason, not a style rule.
 *
 * ⚠ THE GRAPH IS THE AUTHORITY ON ITS OWN VERSION; `project_memory.schema_version`
 * IS A CACHE. The same graph can be restored from a dump or reached by a second
 * Chorus install, so a version kept only in SQLite would claim a schema the graph
 * does not have. The seeder therefore ALWAYS re-reads the graph first and writes
 * the cache ONLY after a successful apply (plan §8).
 *
 * The in-graph ledger deliberately mirrors `schema_migrations` so there is ONE
 * mental model: a `(:ChorusSchema {id:'chorus', version})` singleton plus one
 * `(:ChorusMigration {version, name, appliedAt, checksum})` per applied step.
 *
 * ⚠ NO APOC, ANYWHERE. Measured absent from `neo4j:5-community` — the 6-1 D4
 * pass ran `SHOW PROCEDURES … STARTS WITH 'apoc'` and got 0. Requiring it would
 * mean an extra `NEO4J_PLUGINS` variable and a download at container start.
 * `Plan.md` §10's provision flow installs it reflexively; that is not inherited.
 * "Zero required APOC procedures" is an acceptance criterion, not an assumption.
 *
 * ⚠ EVERY STATEMENT IN THIS FILE WAS APPLIED AGAINST THE REAL IMAGE BEFORE BEING
 * HARDCODED (5.26.29, `_verify/6-4-probe-constraints.mjs`) — composite-property
 * constraint syntax changed across Neo4j majors, and CLAUDE.md's standing rule is
 * not to trust training-data memory for it. All ten parsed, and re-applying all
 * ten produced zero failures.
 */

export interface GraphMigration {
  readonly version: number
  readonly name: string
  /** Every statement idempotent. Asserted over the LIST by the test, not
   *  per-call — a statement added in 2027 that forgets `IF NOT EXISTS` must fail
   *  in CI rather than on a half-migrated graph. */
  readonly statements: readonly string[]
}

/**
 * Seed v1 — written against `Phase-6-IdentityModel.md`, NOT against the spec's
 * original list.
 *
 * ⚠ `(repo, path)` AND `(repo, fqn)` ARE GONE, AND THE REASON IS WORTH KEEPING.
 * D94(a) corrected `Plan.md`'s bare `File.path` uniqueness because it breaks on
 * git worktrees — Chorus's own core feature — and on any project holding more
 * than one repository. That reasoning was right and its fix was still
 * insufficient (D126): the repository half was an ABSOLUTE PATH
 * (`worktrees.repo_root`) and the path half was worktree-ambiguous. The identity
 * model is the third version of this key and the first grounded in a field
 * Chorus actually owns (`worktrees.id` / `projects.id`).
 */
export const GRAPH_MIGRATIONS: readonly GraphMigration[] = [
  {
    version: 1,
    name: 'identity-constraints-and-indexes',
    statements: [
      `CREATE CONSTRAINT project_id_unique IF NOT EXISTS FOR (p:Project) REQUIRE p.id IS UNIQUE`,
      // Identity = workspace instance + normalized repository-relative path.
      // Measured biting correctly: the same relPath under two different
      // workspace instances BOTH succeed (the worktree case), a repeat of one
      // pair is refused with Neo.ClientError.Schema.ConstraintValidationFailed.
      `CREATE CONSTRAINT file_identity IF NOT EXISTS FOR (f:File) REQUIRE (f.workspaceInstanceId, f.relPath) IS UNIQUE`,
      `CREATE CONSTRAINT class_identity IF NOT EXISTS FOR (c:Class) REQUIRE (c.workspaceInstanceId, c.fqn) IS UNIQUE`,
      // ⚠ `repoId` IS A REPOSITORY identity, not an instance one, because commits
      // are shared by every worktree of one repository — keying them per instance
      // would duplicate each commit N times and break SUPPORTED_BY corroboration
      // across worktrees. It is the root-commit SHA; see the identity model §3.
      `CREATE CONSTRAINT commit_identity IF NOT EXISTS FOR (c:Commit) REQUIRE (c.repoId, c.sha) IS UNIQUE`,
      `CREATE CONSTRAINT memory_id_unique IF NOT EXISTS FOR (m:Memory) REQUIRE m.id IS UNIQUE`,
      `CREATE CONSTRAINT session_id_unique IF NOT EXISTS FOR (s:AgentSession) REQUIRE s.id IS UNIQUE`,
      // `validTo` indexed so "what do we currently believe" is the indexable
      // `WHERE m.validTo IS NULL` rather than a scan (D94.4).
      `CREATE INDEX memory_current IF NOT EXISTS FOR (m:Memory) ON (m.validTo)`,
      `CREATE INDEX memory_project IF NOT EXISTS FOR (m:Memory) ON (m.chorusProjectId)`,
      // ⚠ NOT REDUNDANT WITH `file_identity`'s BACKING INDEX, AND THIS WAS
      // MEASURED RATHER THAN ASSUMED. The obvious cleanup is to drop it because
      // the constraint already indexes (workspaceInstanceId, relPath) with
      // workspaceInstanceId leading. EXPLAIN refutes it: with this index the
      // lookup plans as NodeIndexSeek; without it, NodeByLabelScan + Filter.
      // Removing it would turn every per-workspace query into a full label scan
      // and would look like a tidy-up in review.
      `CREATE INDEX file_workspace IF NOT EXISTS FOR (f:File) ON (f.workspaceInstanceId)`,
      `CREATE FULLTEXT INDEX memory_text IF NOT EXISTS FOR (m:Memory) ON EACH [m.content]`
    ]
  },
  /**
   * v2 (Task 6a-2) — the structural namespace `index-codebase` writes into.
   *
   * ⚠ ALL FOUR STATEMENTS WERE APPLIED AGAINST A REAL `neo4j:5-community`
   * BEFORE BEING HARDCODED, exactly as v1's ten were, because composite
   * constraint syntax has changed across Neo4j majors and CLAUDE.md forbids
   * trusting recall for it. Probe: `_verify/6a-2/probe-v2-constraints.mjs`,
   * output in `probe-v2-output.txt`, measured against **5.26.29** on
   * 2026-08-15. All four applied, re-applying produced **zero** failures, and
   * `directory_identity` was proven to BITE: `pj:A + src/main` twice is
   * refused with `Neo.ClientError.Schema.ConstraintValidationFailed`, while
   * `pj:A` and `pj:B` sharing `src/main` are both accepted — which is the
   * whole point of keying on the workspace instance. Three `MERGE`s of one
   * directory produced one node, so the indexer's actual write path is
   * idempotent under the constraint and not merely its `CREATE` cousin.
   */
  {
    version: 2,
    name: 'code-structure-identity',
    statements: [
      // Same key as :File, for the same reason — a directory exists per
      // workspace instance, and an absolute path is never key material.
      `CREATE CONSTRAINT directory_identity IF NOT EXISTS FOR (d:Directory) REQUIRE (d.workspaceInstanceId, d.relPath) IS UNIQUE`,
      // The structural namespace is queried per project far more often than per
      // instance ("what is in this project"), and `file_workspace`'s own
      // measurement showed Neo4j will NOT use a composite constraint index for
      // a leading-property-only lookup here.
      `CREATE INDEX file_project IF NOT EXISTS FOR (f:File) ON (f.chorusProjectId)`,
      `CREATE INDEX directory_workspace IF NOT EXISTS FOR (d:Directory) ON (d.workspaceInstanceId)`,
      // "Which files has this repo's history touched" is the second question
      // the index exists to answer, and it scans without this.
      `CREATE INDEX commit_repo IF NOT EXISTS FOR (c:Commit) ON (c.repoId)`
    ]
  },
  /**
   * v3 (Task 10.2-2) — the symbol layer. Reverses the `:Class`/`:Method`/`CALLS`
   * exclusion D149 made for `index-codebase` v1, on the evidence of D201: given a
   * question the graph could answer completely, codex used the index and ran no
   * repository search at all.
   *
   * ⚠ ALL SEVEN STATEMENTS WERE APPLIED AGAINST A REAL `neo4j:5-community`
   * BEFORE BEING HARDCODED, as v1's ten and v2's four were — composite
   * constraint AND relationship-property-index syntax both changed across Neo4j
   * majors and CLAUDE.md forbids trusting recall for them. Probe:
   * `_verify/10.2-2/probe-v3.sh`, measured against **5.26.29** on 2026-09-13.
   * All seven applied; re-applying all seven produced **zero** failures; and
   * `symbol_identity` was proven to BITE — a repeated `(workspaceInstanceId,
   * symbolId)` is refused, the same `symbolId` under a SECOND workspace instance
   * is accepted, and three `MERGE`s of one symbol produced one node.
   *
   * ⚠ `(:Class)`'s `class_identity` constraint FROM v1 IS LEFT EXACTLY AS IT IS —
   * dormant, never written to, neither revived nor dropped. `:Symbol` carries
   * `kind: 'class'` instead. A future reader who sees `class_identity` and
   * assumes `:Class` is live will write nodes nothing queries.
   *
   * ⚠ THE KEY IS `symbolId`, NOT `fqn` (D202). A TypeScript `fqn` is ambiguous
   * across overloads and anonymous default exports, and would have to embed the
   * path to be unique anyway — at which point it is `symbolId` with a worse name.
   * Grammar: `<relPath>#<qualifiedName>:<kind>[@<ordinal>]`.
   *
   * ⚠ NOTHING WRITES A `:Symbol` YET. 10.2-3 supplies the extractor; this
   * migration exists first because a symbol keyed wrongly cannot be re-keyed
   * without deleting nodes, and D149(b) forbids the indexer from deleting.
   */
  {
    version: 3,
    name: 'symbol-layer-identity',
    statements: [
      // Same shape as :File and :Directory — per workspace instance, and the
      // path-bearing half is repository-relative. Proven to bite; see above.
      `CREATE CONSTRAINT symbol_identity IF NOT EXISTS FOR (s:Symbol) REQUIRE (s.workspaceInstanceId, s.symbolId) IS UNIQUE`,
      // Not redundant with the constraint's backing index, for the reason
      // `file_workspace` records: Neo4j will not use a composite index for a
      // leading-property-only lookup, and "everything in this instance" is a
      // per-instance question.
      `CREATE INDEX symbol_workspace IF NOT EXISTS FOR (s:Symbol) ON (s.workspaceInstanceId)`,
      // ⚠ THE ENTRY POINT FOR `find_callers`, AND IT IS LOAD-BEARING — MEASURED.
      // EXPLAIN with this index plans `NodeIndexSeek RANGE INDEX s:Symbol(name)`;
      // dropped, the same query degenerates to a Filter on `s.name`. Removing it
      // would look like a tidy-up in review and would turn every callers lookup
      // into a scan.
      `CREATE INDEX symbol_name IF NOT EXISTS FOR (s:Symbol) ON (s.name)`,
      `CREATE INDEX symbol_project IF NOT EXISTS FOR (s:Symbol) ON (s.chorusProjectId)`,
      // "Every symbol defined in this file" — `impact_of`'s first hop.
      `CREATE INDEX symbol_file IF NOT EXISTS FOR (s:Symbol) ON (s.workspaceInstanceId, s.relPath)`,
      // ⚠ RELATIONSHIP property indexes. D203 filters every read on the edge's
      // run stamp, so the stamp is a predicate on the hot path rather than
      // decoration. The `FOR ()-[r:TYPE]-() ON (r.prop)` form was probed: both
      // created as RANGE / RELATIONSHIP indexes on 5.26.29.
      //
      // ⚠ `DEFINED_IN` gets NO such index, deliberately: `symbolId` embeds
      // `relPath`, so a symbol that moves file is a DIFFERENT node rather than
      // the same node with a different edge, and the edge cannot go stale
      // independently of the symbol that owns it.
      `CREATE INDEX calls_run IF NOT EXISTS FOR ()-[r:CALLS]-() ON (r.lastIndexedAt)`,
      `CREATE INDEX references_run IF NOT EXISTS FOR ()-[r:REFERENCES]-() ON (r.lastIndexedAt)`
    ]
  }
]

/** The highest version this build knows how to produce. */
export const LATEST_GRAPH_VERSION: number = GRAPH_MIGRATIONS.reduce(
  (max, m) => (m.version > max ? m.version : max),
  0
)

export type PendingResult =
  | { readonly ok: true; readonly pending: readonly GraphMigration[] }
  | { readonly ok: false; readonly reason: string }

/**
 * Which migrations still have to run against a graph currently at `current`.
 *
 * ⚠ IT REFUSES A VERSION FROM THE FUTURE, AND THIS IS THE CASE A REVIEWER SKIPS.
 * A graph at v4 read by code that knows v1–v3 is a graph written by a NEWER
 * CHORUS. Returning `[]` would silently pretend compatibility and then let this
 * build write to a schema it does not understand — which is how a graph gets
 * corrupted by the half of the app that believed it was up to date. The refusal
 * is a sentence the caller renders.
 */
export function pendingMigrations(current: number): PendingResult {
  if (!Number.isInteger(current) || current < 0) {
    return { ok: false, reason: 'The graph reported a schema version that is not a whole number.' }
  }
  if (current > LATEST_GRAPH_VERSION) {
    return {
      ok: false,
      reason: `This memory graph was set up by a newer version of Chorus (its schema is version ${current}; this build knows version ${LATEST_GRAPH_VERSION}). Update Chorus before using it, so it is not written to with an older schema.`
    }
  }
  return { ok: true, pending: GRAPH_MIGRATIONS.filter((m) => m.version > current) }
}

/**
 * A stable checksum over a migration's statements, so a step whose CONTENT was
 * edited after it shipped is detectable rather than silently re-applied as
 * though it were the same step. Mirrors `schema_migrations`'s intent one layer
 * over.
 *
 * ⚠ FNV-1a RATHER THAN A CRYPTO HASH, DELIBERATELY: this is a change detector,
 * not a security boundary, and the pure core must not reach for `node:crypto`.
 * Stated so nobody later mistakes it for tamper-proofing — an agent with the
 * Cypher tool can rewrite the ledger node anyway (F49).
 */
export function migrationChecksum(m: GraphMigration): string {
  let h = 0x811c9dc5
  for (const s of m.statements) {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 0x01000193) >>> 0
    }
    // A separator, so ['ab','c'] and ['a','bc'] cannot hash alike.
    h ^= 0x1f
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/**
 * The ledger write for one applied step: the `:ChorusMigration` row and the
 * `:ChorusSchema` singleton, both idempotent.
 *
 * ⚠ PARAMETERISED, NOT INTERPOLATED. `name` and `checksum` are ours today, but a
 * Cypher string built by concatenation is an injection site the moment anything
 * user-authored reaches it, and the graph's own ledger is the last place that
 * should be possible. The caller passes `versionNodeParams` alongside.
 */
export const VERSION_NODE_CYPHER = `
MERGE (mig:ChorusMigration {version: $version})
  ON CREATE SET mig.name = $name, mig.appliedAt = $appliedAt, mig.checksum = $checksum
MERGE (s:ChorusSchema {id: 'chorus'})
  SET s.version = $version
`.trim()

export function versionNodeParams(
  m: GraphMigration,
  appliedAt: string
): { version: number; name: string; appliedAt: string; checksum: string } {
  return { version: m.version, name: m.name, appliedAt, checksum: migrationChecksum(m) }
}

/** Read the graph's own version. Returns 0 for a graph that has never been
 *  seeded — `MERGE`-free, because a READ must not create the node it is asking
 *  about. */
export const READ_VERSION_CYPHER = `MATCH (s:ChorusSchema {id: 'chorus'}) RETURN s.version AS version`

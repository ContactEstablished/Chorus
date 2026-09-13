import { describe, it, expect } from 'vitest'
import {
  GRAPH_MIGRATIONS,
  LATEST_GRAPH_VERSION,
  READ_VERSION_CYPHER,
  VERSION_NODE_CYPHER,
  migrationChecksum,
  pendingMigrations,
  versionNodeParams
} from './graphSchemaCore'

/**
 * Task 6-4's schema ledger. The headline cases are the all-idempotent assertion
 * over the LIST (so a statement added later cannot forget it) and the refusal of
 * a version from the future (the case a reviewer skips, and the one that
 * corrupts a graph).
 */

describe('graphSchemaCore — every statement is idempotent', () => {
  /**
   * ⚠ ASSERTED OVER THE LIST, NOT PER CALL. A migration added in 2027 that
   * forgets `IF NOT EXISTS` fails here, in CI, rather than on somebody's
   * half-migrated graph — which is the correct failure mode for something that
   * runs before the feature is usable.
   */
  it('every statement in every migration carries IF NOT EXISTS', () => {
    for (const m of GRAPH_MIGRATIONS) {
      for (const s of m.statements) {
        expect(s, `v${m.version} "${m.name}": ${s}`).toMatch(/IF NOT EXISTS/)
      }
    }
  })

  it('the count of IF NOT EXISTS equals the statement count', () => {
    const statements = GRAPH_MIGRATIONS.flatMap((m) => m.statements)
    const withGuard = statements.filter((s) => s.includes('IF NOT EXISTS'))
    expect(withGuard.length).toBe(statements.length)
    expect(statements.length).toBeGreaterThan(0)
  })

  it('no statement requires APOC — measured absent from the image', () => {
    // 6-1's D4 pass ran SHOW PROCEDURES … STARTS WITH 'apoc' and got 0.
    // "Zero required APOC procedures" is an acceptance criterion.
    for (const s of GRAPH_MIGRATIONS.flatMap((m) => m.statements)) {
      expect(s.toLowerCase()).not.toContain('apoc')
    }
  })

  it('no statement uses an absolute path or a repo_root as key material', () => {
    // D126 demotes absolute paths to fallback metadata. The identity model's
    // `AtWrite` fields must never appear in a constraint.
    for (const s of GRAPH_MIGRATIONS.flatMap((m) => m.statements)) {
      expect(s).not.toMatch(/repoRoot|repo_root|absPath|AtWrite/)
      expect(s).not.toMatch(/[A-Za-z]:\\/)
    }
  })

  it('no statement carries a confidence property (D94.3, ratified by CR-6.0)', () => {
    for (const s of GRAPH_MIGRATIONS.flatMap((m) => m.statements)) {
      expect(s.toLowerCase()).not.toContain('confidence')
    }
  })

  it('versions are unique, positive and ascending', () => {
    const versions = GRAPH_MIGRATIONS.map((m) => m.version)
    expect(new Set(versions).size).toBe(versions.length)
    expect([...versions].sort((a, b) => a - b)).toEqual(versions)
    for (const v of versions) expect(v).toBeGreaterThan(0)
  })

  it('LATEST_GRAPH_VERSION is derived, not restated', () => {
    expect(LATEST_GRAPH_VERSION).toBe(Math.max(...GRAPH_MIGRATIONS.map((m) => m.version)))
  })

  /* Task 6a-2 — graph migration v2, the structural namespace. */

  /**
   * ⚠ RETITLED BY TASK 10.2-2, NOT SILENTLY EDITED. This case was named "the
   * graph is at version 2" and asserted `LATEST_GRAPH_VERSION === 2`. The schema
   * MOVED to 3; the assertion did not become wrong, it became a different claim.
   * What 6a-2 actually owns is that v2 exists and is the code-structure step, so
   * that is what stays here — the ceiling claim now lives in the 10.2-2 block
   * below, where a future version bump will find it.
   */
  it('6a-2: v2 is the code-structure migration', () => {
    const v2 = GRAPH_MIGRATIONS.find((m) => m.version === 2)
    expect(v2?.name).toBe('code-structure-identity')
  })

  it('6a-2, amended by 10.2-2: a graph at v1 is offered v2 AND v3, in order', () => {
    // Was `toEqual([2])` while v2 was the ceiling. A graph at v1 is now owed two
    // steps, and the ORDER matters: pendingMigrations must hand them back
    // ascending or a v3 constraint could be applied before v2's exists.
    const r = pendingMigrations(1)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.pending.map((m) => m.version)).toEqual([2, 3])
      expect(r.pending[0].name).toBe('code-structure-identity')
      expect(r.pending[1].name).toBe('symbol-layer-identity')
    }
  })

  it('6a-2: v2 keys :Directory exactly as :File is keyed, and adds no memory label', () => {
    const v2 = GRAPH_MIGRATIONS.find((m) => m.version === 2)!.statements.join('\n')
    // A directory exists per workspace instance; an absolute path is never key
    // material. Proven to BITE against neo4j 5.26.29 before being hardcoded —
    // see the migration's own note and _verify/6a-2/probe-v2-output.txt.
    expect(v2).toContain('(d.workspaceInstanceId, d.relPath) IS UNIQUE')
    // The structural namespace only: the label boundary is the safety argument
    // for one graph rather than two databases (D147(c)).
    expect(v2).not.toMatch(/:Memory/)
    expect(v2).not.toMatch(/SUPPORTED_BY/)
  })

  it('6a-2: every v2 statement is IF NOT EXISTS, which is what makes re-apply safe', () => {
    const v2 = GRAPH_MIGRATIONS.find((m) => m.version === 2)!
    for (const st of v2.statements) expect(st).toContain('IF NOT EXISTS')
  })
})

describe('graphSchemaCore — the identity model is the one in the seed', () => {
  const v1 = GRAPH_MIGRATIONS[0].statements.join('\n')

  it('keys :File on workspace instance + relative path, never (repo, path)', () => {
    expect(v1).toContain('(f.workspaceInstanceId, f.relPath) IS UNIQUE')
    // The two superseded keys, barred by name so a copy-forward fails loudly.
    expect(v1).not.toContain('f.repo,')
    expect(v1).not.toContain('(f.repo')
  })

  it('keys :Class the same way', () => {
    expect(v1).toContain('(c.workspaceInstanceId, c.fqn) IS UNIQUE')
  })

  it('keys :Commit on a REPOSITORY identity, not a workspace instance', () => {
    // Commits are shared by every worktree of one repo; keying them per
    // instance would duplicate each commit N times and break SUPPORTED_BY
    // corroboration across worktrees.
    expect(v1).toContain('(c.repoId, c.sha) IS UNIQUE')
    expect(v1).not.toMatch(/Commit\) REQUIRE c\.sha IS UNIQUE/)
  })

  it('indexes validTo so "current" is a seek rather than a scan', () => {
    expect(v1).toContain('FOR (m:Memory) ON (m.validTo)')
  })

  it('keeps the file_workspace index — measured NOT redundant', () => {
    // EXPLAIN showed that dropping it turns a workspaceInstanceId lookup from a
    // NodeIndexSeek into a NodeByLabelScan + Filter. This assertion exists so
    // the "obvious" cleanup fails a test instead of passing review.
    expect(v1).toContain('FOR (f:File) ON (f.workspaceInstanceId)')
  })
})

describe('graphSchemaCore — pendingMigrations', () => {
  it('a fresh graph (0) has every migration pending', () => {
    const r = pendingMigrations(0)
    expect(r.ok).toBe(true)
    expect(r.ok && r.pending.length).toBe(GRAPH_MIGRATIONS.length)
  })

  it('a fully-seeded graph has nothing pending — the second seed is a no-op', () => {
    const r = pendingMigrations(LATEST_GRAPH_VERSION)
    expect(r.ok).toBe(true)
    expect(r.ok && r.pending).toEqual([])
  })

  it('mid-list returns only what is above it', () => {
    // Written to survive the list growing: assert the property, not a number.
    for (const m of GRAPH_MIGRATIONS) {
      const r = pendingMigrations(m.version)
      expect(r.ok).toBe(true)
      if (!r.ok) continue
      expect(r.pending.every((p) => p.version > m.version)).toBe(true)
      expect(r.pending.length).toBe(GRAPH_MIGRATIONS.filter((x) => x.version > m.version).length)
    }
  })

  /**
   * ⚠ THE CASE A REVIEWER SKIPS, AND THE ONE THAT CORRUPTS A GRAPH. A graph
   * ahead of this build was written by a NEWER Chorus. Returning [] would
   * silently pretend compatibility and then let this build write to a schema it
   * does not understand.
   */
  it('REFUSES a version from the future rather than returning an empty list', () => {
    const r = pendingMigrations(LATEST_GRAPH_VERSION + 1)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toMatch(/newer version of Chorus/)
    // It states both numbers — the graph's and this build's — because "too new"
    // without them is not actionable (D55's habit, one field over).
    expect(r.reason).toContain(String(LATEST_GRAPH_VERSION + 1))
    expect(r.reason).toContain(String(LATEST_GRAPH_VERSION))
  })

  it('refuses a nonsense version rather than coercing it', () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(pendingMigrations(bad).ok).toBe(false)
    }
  })
})

describe('graphSchemaCore — the ledger write', () => {
  it('is parameterised, never interpolated', () => {
    // A Cypher string built by concatenation is an injection site the moment
    // anything user-authored reaches it, and the ledger is the last place that
    // should be possible.
    expect(VERSION_NODE_CYPHER).toContain('$version')
    expect(VERSION_NODE_CYPHER).toContain('$name')
    expect(VERSION_NODE_CYPHER).toContain('$checksum')
    expect(VERSION_NODE_CYPHER).toContain('$appliedAt')
    expect(VERSION_NODE_CYPHER).not.toMatch(/\$\{/)
  })

  it('MERGEs both the migration row and the singleton', () => {
    expect(VERSION_NODE_CYPHER).toContain('MERGE (mig:ChorusMigration {version: $version})')
    expect(VERSION_NODE_CYPHER).toContain(`MERGE (s:ChorusSchema {id: 'chorus'})`)
  })

  it('the READ does not create the node it is asking about', () => {
    // A read that MERGEd would report a version it had just invented.
    expect(READ_VERSION_CYPHER).toContain('MATCH')
    expect(READ_VERSION_CYPHER).not.toContain('MERGE')
    expect(READ_VERSION_CYPHER).not.toContain('CREATE')
  })

  it('params carry the derived checksum, not a caller-supplied one', () => {
    const m = GRAPH_MIGRATIONS[0]
    const p = versionNodeParams(m, '2026-08-08T00:00:00.000Z')
    expect(p).toEqual({
      version: m.version,
      name: m.name,
      appliedAt: '2026-08-08T00:00:00.000Z',
      checksum: migrationChecksum(m)
    })
  })
})

describe('graphSchemaCore — the checksum detects an edited step', () => {
  it('is stable for the same statements', () => {
    const m = GRAPH_MIGRATIONS[0]
    expect(migrationChecksum(m)).toBe(migrationChecksum({ ...m }))
  })

  it('changes when a statement changes', () => {
    const m = GRAPH_MIGRATIONS[0]
    const edited = { ...m, statements: [...m.statements, 'CREATE INDEX x IF NOT EXISTS FOR (n:N) ON (n.p)'] }
    expect(migrationChecksum(edited)).not.toBe(migrationChecksum(m))
  })

  it('is not fooled by a statement boundary moving', () => {
    // ['ab','c'] and ['a','bc'] must not hash alike — hence the separator.
    const a = { version: 1, name: 'n', statements: ['ab', 'c'] }
    const b = { version: 1, name: 'n', statements: ['a', 'bc'] }
    expect(migrationChecksum(a)).not.toBe(migrationChecksum(b))
  })

  it('is 8 hex characters', () => {
    expect(migrationChecksum(GRAPH_MIGRATIONS[0])).toMatch(/^[0-9a-f]{8}$/)
  })
})

/**
 * Task 10.2-2 — graph migration v3, the `:Symbol` layer.
 *
 * ⚠ These assert on STRUCTURE, not on prose. Five self-matching gates landed
 * across Phases 10.1 and 10.2 (F120, F123), every one of them a check that
 * matched the comment documenting the rule it was checking. Each case below
 * reads `statements` — the array the migration actually applies — never the
 * file's text.
 */
describe('graphSchemaCore — v3, the symbol layer (Task 10.2-2)', () => {
  const v3 = () => GRAPH_MIGRATIONS.find((m) => m.version === 3)!
  const v3Text = () => v3().statements.join('\n')

  it('v3 exists, is the symbol layer, and is the ceiling', () => {
    expect(v3().name).toBe('symbol-layer-identity')
    expect(LATEST_GRAPH_VERSION).toBe(3)
  })

  it('a graph already at v2 is offered EXACTLY the v3 entry', () => {
    const r = pendingMigrations(2)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.pending.map((m) => m.version)).toEqual([3])
      expect(r.pending[0].name).toBe('symbol-layer-identity')
    }
  })

  it('every v3 statement is IF NOT EXISTS, which is what makes re-apply safe', () => {
    // Re-apply was measured: all seven applied twice against neo4j 5.26.29 with
    // zero failures (_verify/10.2-2/probe-v3-output.txt).
    for (const st of v3().statements) expect(st).toContain('IF NOT EXISTS')
  })

  it('⚠ keys :Symbol on (workspaceInstanceId, symbolId) and NEVER on fqn (D202)', () => {
    expect(v3Text()).toContain('(s.workspaceInstanceId, s.symbolId) IS UNIQUE')
    // fqn was v1's guess at this key. Using it would collide across overloads
    // and anonymous default exports.
    expect(v3Text()).not.toMatch(/\bfqn\b/)
  })

  it('⚠ leaves the dormant :Class constraint alone — neither revived nor dropped', () => {
    // class_identity has existed since v1 and has never been written to. v3 must
    // not touch it; :Symbol carries kind: 'class' instead. A v3 that mentioned
    // :Class would signal that the label is live, and it is not.
    expect(v3Text()).not.toMatch(/:Class\b/)
    // ...and v1 still owns it, so this task removed nothing.
    const v1Text = GRAPH_MIGRATIONS.find((m) => m.version === 1)!.statements.join('\n')
    expect(v1Text).toContain('class_identity')
  })

  it('stays inside the structural namespace — no memory label, no provenance edge', () => {
    // D147(c): the label boundary is the entire safety argument for one graph
    // rather than two databases.
    expect(v3Text()).not.toMatch(/:Memory/)
    expect(v3Text()).not.toMatch(/SUPPORTED_BY/)
    expect(v3Text().toLowerCase()).not.toContain('confidence')
  })

  it('indexes the CALLS/REFERENCES run stamp that D203 filters on', () => {
    // The stamp is a predicate on the hot path, not decoration. Both were probed
    // as RANGE / RELATIONSHIP indexes on 5.26.29.
    expect(v3Text()).toContain('FOR ()-[r:CALLS]-() ON (r.lastIndexedAt)')
    expect(v3Text()).toContain('FOR ()-[r:REFERENCES]-() ON (r.lastIndexedAt)')
    // ⚠ DEFINED_IN deliberately has none: symbolId embeds relPath, so a symbol
    // that moves file is a different node, and the edge cannot go stale on its
    // own. If someone adds one, this is where they explain why.
    expect(v3Text()).not.toMatch(/DEFINED_IN/)
  })

  it('⚠ carries symbol_name, which EXPLAIN measured load-bearing', () => {
    // With it: NodeIndexSeek RANGE INDEX s:Symbol(name). Without it the same
    // find_callers query degenerates to a Filter on s.name. It reads like a
    // redundant index and is not one — the same trap file_workspace records.
    expect(v3Text()).toContain('CREATE INDEX symbol_name IF NOT EXISTS FOR (s:Symbol) ON (s.name)')
  })
})

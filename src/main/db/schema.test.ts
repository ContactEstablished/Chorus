import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getTableColumns } from 'drizzle-orm'
import { sessions } from './schema'

/**
 * The DDL/schema drift guard (Task 4a-1).
 *
 * ⚠ THIS TEST EXISTS BECAUSE THE TWO HALVES OF A COLUMN LIVE IN DIFFERENT
 * FILES AND NOTHING ELSE COMPARES THEM. `schema.ts` declares the Drizzle
 * column; `storage.ts`'s hand-rolled MIGRATIONS array declares the SQL that
 * actually creates it (D7 kept the migration engine hand-rolled). A typo in
 * either one type-checks perfectly and fails at RUNTIME, as `no such column`,
 * out of whichever query happens to touch it first — v10's `launch_profile_id`
 * and v14's `name`/`description` both had to be hand-checked for exactly this.
 *
 * ⚠ IT READS `storage.ts` AS TEXT RATHER THAN IMPORTING IT, AND THAT IS FORCED
 * RATHER THAN LAZY. `storage.ts` imports better-sqlite3, whose native binding
 * is built for the Electron ABI while Vitest runs under Node — the import
 * itself would throw before a single assertion ran (see vitest.config.ts).
 * `schema.ts` imports only drizzle-orm/sqlite-core, which is pure JS, so the
 * declaration half CAN be imported for real.
 */

const STORAGE_SRC = readFileSync(join(__dirname, '..', 'services', 'storage.ts'), 'utf8')

/** The MIGRATIONS array's source text, sliced out by its declaration. */
function migrationsSource(): string {
  const start = STORAGE_SRC.indexOf('const MIGRATIONS: string[] = [')
  expect(start, 'MIGRATIONS array not found in storage.ts').toBeGreaterThan(-1)
  const end = STORAGE_SRC.indexOf('\n]', start)
  expect(end, 'MIGRATIONS array has no closing bracket').toBeGreaterThan(start)
  return STORAGE_SRC.slice(start, end)
}

describe('sessions.agent_session_id (v19, Phase 4a)', () => {
  it('declares the Drizzle column under the exact DB name the DDL uses', () => {
    // Character for character, in both directions: the property name is what
    // application code writes, the `name` is what SQLite sees.
    expect(sessions.agentSessionId.name).toBe('agent_session_id')
    expect(migrationsSource()).toContain('ALTER TABLE sessions ADD COLUMN agent_session_id TEXT;')
  })

  it('is nullable with no default — every pre-v19 row reads NULL and means it', () => {
    // Overview §6: no backfill. A NOT NULL or a DEFAULT would put a value on
    // rows that have no conversation behind them, and a read site could not
    // tell that value from a real pointer.
    expect(sessions.agentSessionId.notNull).toBe(false)
    expect(sessions.agentSessionId.hasDefault).toBe(false)
  })

  it('carries no FK and no index in its migration', () => {
    // The agent's transcript store is not a table Chorus owns, and the only
    // read is by primary key on a row already fetched for other reasons.
    const ddl = migrationsSource()
    const stmt = ddl.slice(ddl.indexOf('ALTER TABLE sessions ADD COLUMN agent_session_id'))
    const line = stmt.slice(0, stmt.indexOf(';') + 1)
    expect(line).not.toMatch(/REFERENCES/i)
    expect(line).not.toMatch(/NOT NULL/i)
    expect(line).not.toMatch(/DEFAULT/i)
    expect(ddl).not.toMatch(/CREATE INDEX[^;]*agent_session_id/i)
  })

  it('is added by exactly one migration', () => {
    // Two ALTERs adding the same column would make the second one throw on a
    // database that had applied the first — the failure lands at boot, on the
    // machine that upgraded, not here.
    const hits = migrationsSource().match(/ADD COLUMN agent_session_id/g) ?? []
    expect(hits).toHaveLength(1)
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
 * Task 6b-1 (D168, amended by D173): the v21 memory-usage counters — five
 * columns, one migration entry — and the aggregate's denominator, pinned as
 * SOURCE TEXT because `storage.ts` cannot load under Vitest (see the header).
 * ═══════════════════════════════════════════════════════════════════════════ */

const V21_COLUMNS = [
  ['memoryReads', 'memory_reads'],
  ['memoryWrites', 'memory_writes'],
  ['memoryReadFirst', 'memory_read_first'],
  ['memoryReadInconclusive', 'memory_read_inconclusive'],
  ['memoryShellFirst', 'memory_shell_first']
] as const

describe('sessions.memory_* (v21, Phase 6b / D168 amended by D173) — five columns, one entry', () => {
  it.each(V21_COLUMNS)('%s declares the Drizzle column under the exact DB name the DDL uses', (prop, db) => {
    expect(sessions[prop].name).toBe(db)
    expect(migrationsSource()).toContain(`ALTER TABLE sessions ADD COLUMN ${db} INTEGER NOT NULL DEFAULT 0;`)
  })

  it.each(V21_COLUMNS)('%s is NOT NULL WITH a default of 0 — the opposite ruling to v19, and zero is the truth', (prop) => {
    // v19's `agent_session_id` took NULL-with-no-default because "no conversation
    // to go back to" is an absence. A session that made no graph calls really
    // did make ZERO of them: 0 is the measurement, not a sentinel — and every
    // pre-v21 row reads 0 truthfully because the aggregate excludes it by date.
    expect(sessions[prop].notNull).toBe(true)
    expect(sessions[prop].hasDefault).toBe(true)
    expect(sessions[prop].default).toBe(0)
  })

  it.each(V21_COLUMNS)('%s is added by exactly one migration', (_prop, db) => {
    // Two ALTERs adding the same column would make the second throw on a
    // database that had applied the first — at boot, on the upgrading machine.
    const hits = migrationsSource().match(new RegExp(`ADD COLUMN ${db} `, 'g')) ?? []
    expect(hits).toHaveLength(1)
  })

  it('⚠ all five live in ONE migration entry (v21), not two', () => {
    // Splitting the three D168 columns from the two D173 ones would claim v22
    // as well, and nothing has ever run against a three-column v21. One entry =
    // one template literal: every ALTER sits between the same pair of backticks.
    const ddl = migrationsSource()
    const first = ddl.indexOf('ADD COLUMN memory_reads ')
    const last = ddl.indexOf('ADD COLUMN memory_shell_first ')
    expect(first).toBeGreaterThan(-1)
    expect(last).toBeGreaterThan(first)
    const between = ddl.slice(first, last)
    expect(between).not.toContain('`') // no template-literal boundary between them
  })

  it('the v21 entry carries no FK and no index', () => {
    const ddl = migrationsSource()
    const start = ddl.indexOf('ADD COLUMN memory_reads ')
    const entry = ddl.slice(ddl.lastIndexOf('`', start), ddl.indexOf('`', start))
    expect(entry).not.toMatch(/REFERENCES/i)
    expect(entry).not.toMatch(/CREATE INDEX/i)
    expect(ddl).not.toMatch(/CREATE INDEX[^;]*memory_/i)
  })

  it('⚠ the drift guard pins the `sessions` column count at 19, counted from this tree', () => {
    // 14 at a3ba6f9 (AST-counted), plus the five v21 columns. A sixth column
    // added later cannot arrive unnoticed — exactly as `ipc.test.ts` pins
    // `IpcChannel`'s count. Re-count from the merged tree when it moves; never
    // delta a prose number.
    expect(Object.keys(getTableColumns(sessions))).toHaveLength(19)
    for (const [prop] of V21_COLUMNS) expect(Object.keys(getTableColumns(sessions))).toContain(prop)
  })
})

/**
 * ⚠ THE AGGREGATE'S DENOMINATOR IS PINNED HERE, BY SOURCE TEXT, BECAUSE THERE IS
 * NOWHERE ELSE TO PIN IT. `storage.ts` imports better-sqlite3 (Electron ABI), so
 * it cannot be imported under Vitest and there is no `storage.test.ts`. A
 * source-text assertion proves the predicate is WRITTEN; the runtime drive's
 * codex control case proves it WORKS.
 */
function projectMemoryUsageSource(): string {
  const start = STORAGE_SRC.indexOf('getProjectMemoryUsage(projectId: string)')
  expect(start, 'getProjectMemoryUsage not found in storage.ts').toBeGreaterThan(-1)
  // The accessor ends where the next method's banner begins.
  const end = STORAGE_SRC.indexOf('/* v16: the agent lock', start)
  expect(end, 'the v16 lock banner that follows getProjectMemoryUsage was not found').toBeGreaterThan(start)
  return STORAGE_SRC.slice(start, end)
}

describe('getProjectMemoryUsage — K is FILTERED, not only labelled (D55 / D173 Q2)', () => {
  it('⚠ filters by project_id — the scope the sentence claims', () => {
    expect(projectMemoryUsageSource()).toContain('project_id = ?')
  })

  it("⚠ filters `agent = 'claude'` — a pane Chorus cannot instrument is never counted as measured non-use", () => {
    // D173 Q2, verbatim: "Codex sessions must not be counted as measured
    // non-use merely because no equivalent hook instrument exists." Every
    // non-claude adapter declares `hooks: null` (codex.ts, grok.ts, kimi.ts,
    // opencode.ts), so its rows can only ever read 0 for a reason that has
    // nothing to do with the agent's behaviour. Without THIS assertion, deleting
    // `AND agent = 'claude'` is an invisible change that inflates K forever —
    // and the sentence in `shared/provenance.ts` would still say "Claude Code".
    // The filter and the label are ONE change, never two.
    expect(projectMemoryUsageSource()).toContain("agent = 'claude'")
  })

  it('⚠ filters created_at >= the v21 floor — after the instrument existed', () => {
    expect(projectMemoryUsageSource()).toContain('created_at >= ?')
  })

  it('all three predicates sit in ONE WHERE clause, ANDed', () => {
    // Asserted individually above so removing one cannot hide under the others;
    // asserted together here so none can migrate to a different query.
    expect(projectMemoryUsageSource()).toMatch(
      /WHERE project_id = \? AND agent = 'claude' AND created_at >= \?/
    )
  })

  it('contains no JOIN — so COUNT(*) stays a count of sessions', () => {
    expect(projectMemoryUsageSource()).not.toMatch(/\bJOIN\b/i)
  })

  it('selects all three breakdown sums in the SAME statement as COUNT(*)', () => {
    // The breakdown can never be rendered against a denominator from a
    // different scan: P, I and S are summed over the rows K counts.
    const src = projectMemoryUsageSource()
    const whereStart = src.indexOf('WHERE project_id')
    const selectStart = src.lastIndexOf('SELECT', whereStart)
    const select = src.slice(selectStart, whereStart)
    expect(select).toContain('COUNT(*)')
    expect(select).toContain('SUM(memory_read_first)')
    expect(select).toContain('SUM(memory_read_inconclusive)')
    expect(select).toContain('SUM(memory_shell_first)')
    expect(select).toContain('SUM(memory_reads)')
    expect(select).toContain('SUM(memory_writes)')
  })

  it('reads the floor from schema_migrations for MEMORY_COUNTERS_VERSION, which is the literal 21', () => {
    // A historical constant, not `MIGRATIONS.length`: the version that
    // introduced the counters never moves, while the array length moves on every
    // unrelated schema change.
    expect(STORAGE_SRC).toMatch(/const MEMORY_COUNTERS_VERSION = 21\b/)
    expect(projectMemoryUsageSource()).toContain('FROM schema_migrations WHERE version = ?')
    expect(projectMemoryUsageSource()).toContain('.get(MEMORY_COUNTERS_VERSION)')
    expect(projectMemoryUsageSource()).not.toContain('MIGRATIONS.length')
  })
})

describe('setSessionMemoryUsage — monotonic MAX(), per receipt', () => {
  function setterSource(): string {
    const start = STORAGE_SRC.indexOf('setSessionMemoryUsage(')
    expect(start).toBeGreaterThan(-1)
    const end = STORAGE_SRC.indexOf('getProjectMemoryUsage(projectId: string)', start)
    return STORAGE_SRC.slice(start, end)
  }

  it.each(V21_COLUMNS)('%s is written with MAX(column, ?) — never `= ?` and never `+ 1`', (_prop, db) => {
    const src = setterSource()
    // The exact spelling, whitespace-tolerant:
    expect(src).toMatch(new RegExp(`${db}\\s*=\\s*MAX\\(${db},\\s*\\?\\)`))
    expect(src).not.toMatch(new RegExp(`${db}\\s*=\\s*\\?`))
    expect(src).not.toMatch(new RegExp(`${db}\\s*\\+\\s*1`))
  })
})

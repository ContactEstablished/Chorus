import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
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

/**
 * 3f-0 — read the measured figures for the size/cost runs.
 *
 * ⚠ READ-ONLY, AND IT OPENS THE DB READ-ONLY. It is safe to run while Chorus is
 * running; SQLite permits concurrent readers.
 *
 * ⚠ MUST BE RUN UNDER ELECTRON, NOT PLAIN NODE. `better-sqlite3` here is built
 * against Electron's ABI, so `node read-run.mjs` fails with a module-version
 * error that looks like a broken install and is not one:
 *
 *   ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe \
 *     docs/Features/Foundation/Investigations/3f-0-SizeCost/read-run.mjs
 *
 * Prints, per run: the totals that go in RESULTS.md §3, and the PER-PHASE input
 * token split that answers §4's cost half without a second paid run.
 */
import Database from 'better-sqlite3'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DB_PATH = join(homedir(), 'AppData', 'Roaming', 'chorus', 'chorus.db')
const db = new Database(DB_PATH, { readonly: true, fileMustExist: true })

const runs = db
  .prepare(
    `SELECT id, status, started_at, ended_at, tokens_in, tokens_out, cost_usd, brief_path
       FROM council_runs
      WHERE brief_path LIKE '%3f-0-SizeCost%'
      ORDER BY started_at`
  )
  .all()

if (runs.length === 0) {
  console.log('No 3f-0 runs recorded yet. Run a variant through the council first.')
  process.exit(0)
}

for (const r of runs) {
  const variant = /case-([A-D])\.md$/.exec(r.brief_path)?.[1] ?? '?'
  const secs =
    r.ended_at && r.started_at
      ? Math.round((Date.parse(r.ended_at) - Date.parse(r.started_at)) / 1000)
      : null
  console.log('='.repeat(72))
  console.log(
    `variant ${variant}  ·  ${r.id.slice(0, 8)}  ·  ${r.status}  ·  ${secs === null ? '?' : `${Math.floor(secs / 60)}m ${secs % 60}s`}`
  )
  console.log(
    `  tokens_in ${r.tokens_in ?? '—'}   tokens_out ${r.tokens_out ?? '—'}   cost_usd $${r.cost_usd ?? '—'}`
  )

  /** ⚠ THIS IS THE §4 ANSWER, AND IT COSTS NOTHING. The arbiter's share of
   *  input is a fact already stored per turn — no second run is needed to learn
   *  what the members-only arm would have saved. */
  const byPhase = db
    .prepare(
      `SELECT phase, COUNT(*) turns, SUM(tokens_in) tin, SUM(tokens_out) tout
         FROM council_messages WHERE run_id = ? GROUP BY phase ORDER BY MIN(round), phase`
    )
    .all(r.id)
  console.log('  per phase:')
  let arbiterIn = 0
  let totalIn = 0
  for (const p of byPhase) {
    console.log(
      `    ${String(p.phase).padEnd(12)} turns ${String(p.turns).padStart(2)}   in ${String(p.tin ?? 0).padStart(8)}   out ${String(p.tout ?? 0).padStart(7)}`
    )
    totalIn += p.tin ?? 0
    if (p.phase === 'arbitration' || p.phase === 'synthesis') arbiterIn += p.tin ?? 0
  }
  if (totalIn > 0) {
    console.log(
      `    → arbiter share of INPUT tokens: ${arbiterIn} / ${totalIn} = ${((arbiterIn / totalIn) * 100).toFixed(1)}%`
    )
  }

  const refusals = db
    .prepare(
      `SELECT member_id, phase, round, substr(content,1,160) c FROM council_messages
        WHERE run_id = ? AND (content LIKE '%exceeded%' OR content LIKE '%could not%' OR content LIKE '%refus%')`
    )
    .all(r.id)
  if (refusals.length > 0) {
    console.log('  ⚠ possible refusals / truncations:')
    for (const x of refusals)
      console.log(`    ${x.phase} r${x.round} ${String(x.member_id).slice(0, 8)}: ${x.c}`)
  }
}
db.close()

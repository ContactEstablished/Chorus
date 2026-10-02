import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
const require = createRequire(import.meta.url), evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'chorus-local-checks-'))
const bundle = path.resolve('_verify', `local-checks-${Date.now()}.cjs`)
await require('esbuild').build({ stdin: { contents: "export { createExtendedFixture } from './scripts/team-extended-fixture'; export { installTeamLocalChecks, boundedTeamGroups } from './scripts/team-local-check-fixture';", resolveDir: process.cwd(), loader: 'ts' }, outfile: bundle, bundle: true, platform: 'node', format: 'cjs', packages: 'external' })
try {
  const { createExtendedFixture, installTeamLocalChecks, boundedTeamGroups } = require(bundle), fixture = createExtendedFixture(evidence), bounded = process.argv.includes('--bounded-assignments')
  const acceptance = fixture.frozen.filter(f => f.includes('acceptance')).map(f => [f, fs.readFileSync(path.join(evidence, f), 'utf8')])
  installTeamLocalChecks(evidence, fixture, 'extended', bounded)
  const names = []
  for (const [i, paths] of [null, ...(bounded ? boundedTeamGroups(fixture.groups) : fixture.groups)].entries()) {
    const result = spawnSync(process.execPath, ['helper-check.cjs'], { cwd: evidence, env: { ...process.env, CHORUS_HELPER_OWNED_PATHS: paths ? JSON.stringify(paths) : '' }, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
    fs.writeFileSync(path.join(evidence, `condition-${i}.log`), result.stdout + result.stderr)
    assert.equal(result.status, 1, 'Stubs must fail the selected acceptance tests')
    names.push(result.stdout.split(/\r?\n/).filter(line => /^(not )?ok \d+ - /.test(line) && !line.includes('# SKIP')).map(line => line.replace(/^(not )?ok \d+ - /, '')))
  }
  assert.equal(names[0].length, 194)
  assert.deepEqual(names.slice(1).flat().sort(), [...names[0]].sort(), 'Local checks must partition the entire frozen suite with no gaps or duplicates')
  for (const [file, content] of acceptance) assert.equal(fs.readFileSync(path.join(evidence, file), 'utf8'), content)
  const report = { passed: true, bounded, full: names[0].length, assignments: names.slice(1).map(n => n.length), acceptanceUnchanged: true, evidence }
  fs.writeFileSync(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2))
} finally { fs.unlinkSync(bundle) }

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url), root = process.cwd()
const index = process.argv.indexOf('--profile')
const sourceProfile = index >= 0 ? path.resolve(process.argv[index + 1]) : path.join(process.env.APPDATA, 'chorus-app')
if (!fs.existsSync(path.join(sourceProfile, 'chorus.db'))) throw Error('Specify the existing Chorus profile with --profile; its database is read only.')
const evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'chorus-team-pilot-'))
fs.mkdirSync(path.join(evidence, 'profile'))
if (fs.existsSync(path.join(sourceProfile, 'Local State'))) fs.copyFileSync(path.join(sourceProfile, 'Local State'), path.join(evidence, 'profile', 'Local State'))
const bundle = path.join(root, '_verify', `team-pilot-${Date.now()}.cjs`)
await require('esbuild').build({ entryPoints: ['scripts/verify-team-pilot.ts'], outfile: bundle, bundle: true, platform: 'node', format: 'cjs', packages: 'external' })
const workloadIndex = process.argv.indexOf('--workload'), workload = workloadIndex < 0 ? 'small' : process.argv[workloadIndex + 1]
if (!['small', 'substantial', 'long', 'extended'].includes(workload)) throw Error('Choose small, substantial, long or extended workload.')
const contextIndex = process.argv.indexOf('--context'), context = contextIndex < 0 ? 'standard' : process.argv[contextIndex + 1]
if (!['focused', 'standard'].includes(context)) throw Error('Choose focused or standard context.')
const leadIndex = process.argv.indexOf('--lead'), lead = leadIndex < 0 ? 'claude-opus' : process.argv[leadIndex + 1]
if (!['claude-opus', 'codex', 'codex-sol'].includes(lead)) throw Error('Choose claude-opus, codex or codex-sol lead.')
if (lead !== 'claude-opus' && context !== 'standard') throw Error('Codex comparisons require standard context.')
const env = { ...process.env, CHORUS_TEAM_PILOT_LEAD: lead, CHORUS_TEAM_PILOT_EVIDENCE: evidence, CHORUS_TEAM_PILOT_SOURCE_DB: path.join(sourceProfile, 'chorus.db'), CHORUS_TEAM_PILOT_CONTEXT: context, CHORUS_TEAM_PILOT_WORKLOAD: workload, CHORUS_TEAM_PILOT_HELPERS: process.argv.includes('--one-helper') ? '1' : '2', CHORUS_TEAM_PILOT_SOLO: process.argv.includes('--solo') ? '1' : '' }; delete env.ELECTRON_RUN_AS_NODE
const log = fs.openSync(path.join(evidence, 'pilot.log'), 'w')
const child = spawn(require('electron'), [bundle, `--user-data-dir=${path.join(evidence, 'profile')}`], { cwd: root, env, windowsHide: true, stdio: ['ignore', log, log] })
console.log(JSON.stringify({ evidence, pid: child.pid }))
const [code] = await once(child, 'close'); fs.closeSync(log); fs.unlinkSync(bundle)
const report = path.join(evidence, code === 0 ? 'report.json' : 'failure.json')
const recorded = fs.existsSync(report) ? JSON.parse(fs.readFileSync(report, 'utf8')) : { passed: false, code, evidence, error: 'Pilot did not produce a report.' }
console.log(JSON.stringify(recorded, null, 2))
process.exitCode = code === 0 && recorded.passed === true ? 0 : 1

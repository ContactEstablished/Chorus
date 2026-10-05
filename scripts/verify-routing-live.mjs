// Model Routing Phase 0 (spike B) runner. Spends a few cents of real OpenRouter
// credit. Reads the installed Chorus database read-only, copies only the
// OpenRouter credential into disposable storage, and runs the probe in a
// windowless Electron main so the production vault can decrypt it.
// Usage: node scripts/verify-routing-live.mjs [--profile <chorus user-data dir>] [--pricing | --council]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url), root = process.cwd()
const index = process.argv.indexOf('--profile')
const sourceProfile = index >= 0 ? path.resolve(process.argv[index + 1]) : path.join(process.env.APPDATA, 'chorus-app')
if (!fs.existsSync(path.join(sourceProfile, 'chorus.db'))) throw Error('Specify the existing Chorus profile with --profile; its database is read only.')
const evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'chorus-routing-live-'))
fs.mkdirSync(path.join(evidence, 'profile'))
if (fs.existsSync(path.join(sourceProfile, 'Local State'))) fs.copyFileSync(path.join(sourceProfile, 'Local State'), path.join(evidence, 'profile', 'Local State'))
const bundle = path.join(root, '_verify', `routing-live-${Date.now()}.cjs`)
await require('esbuild').build({ entryPoints: ['scripts/verify-routing-live.ts'], outfile: bundle, bundle: true, platform: 'node', format: 'cjs', packages: 'external' })
const env = { ...process.env, CHORUS_ROUTING_EVIDENCE: evidence, CHORUS_ROUTING_SOURCE_DB: path.join(sourceProfile, 'chorus.db'), CHORUS_ROUTING_PRICING: process.argv.includes('--pricing') ? '1' : '', CHORUS_ROUTING_COUNCIL: process.argv.includes('--council') ? '1' : '' }; delete env.ELECTRON_RUN_AS_NODE
const log = fs.openSync(path.join(evidence, 'probe.log'), 'w')
const child = spawn(require('electron'), [bundle, `--user-data-dir=${path.join(evidence, 'profile')}`], { cwd: root, env, windowsHide: true, stdio: ['ignore', log, log] })
const [code] = await once(child, 'close'); fs.closeSync(log); fs.unlinkSync(bundle)
const reportPath = path.join(evidence, 'report.json')
const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : { passed: false, code, error: 'The probe produced no report.' }
console.log(JSON.stringify({ evidence, code, ...report }, null, 2))
process.exitCode = report.passed ? 0 : 1

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'chorus-team-memory-app-'))
const bundle = path.resolve('_verify', `team-memory-app-${Date.now()}.cjs`)
await require('esbuild').build({ entryPoints: ['scripts/verify-team-memory-app.ts'], outfile: bundle, bundle: true, platform: 'node', format: 'cjs', packages: 'external' })
const env = { ...process.env, CHORUS_TEAM_MEMORY_APP_EVIDENCE: evidence }; delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL
if (!env.CHORUS_TEAM_MEMORY_APP_URI) throw Error('Provide the URI of an isolated, test-owned Neo4j instance')
const log = fs.openSync(path.join(evidence, 'app.log'), 'w')
const child = spawn(require('electron'), [bundle], { cwd: process.cwd(), env, windowsHide: true, stdio: ['ignore', log, log] })
console.log(JSON.stringify({ evidence, pid: child.pid }))
const [code] = await once(child, 'close'); fs.closeSync(log)
const reportPath = path.join(evidence, 'report.json')
const passed = code === 0 && fs.existsSync(reportPath) && !fs.existsSync(path.join(evidence, 'failure.json'))
console.log(fs.existsSync(reportPath) ? fs.readFileSync(reportPath, 'utf8') : JSON.stringify({ passed: false, code, evidence }))
process.exitCode = passed ? 0 : 1

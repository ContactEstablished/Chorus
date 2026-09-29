import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { once } from 'node:events'
const require = createRequire(import.meta.url), root = process.cwd()
const evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'chorus-team-production-'))
const bundle = path.join(root, '_verify', `team-production-${Date.now()}.cjs`)
await require('esbuild').build({ entryPoints: ['scripts/verify-team-production.ts'], outfile: bundle, bundle: true, platform: 'node', format: 'cjs', packages: 'external' })
const env = { ...process.env, CHORUS_TEAM_PRODUCTION_EVIDENCE: evidence, CHORUS_TEAM_PRODUCTION_LEAD: process.argv[2] ?? 'claude', CHORUS_TEAM_PRODUCTION_MCP: process.argv[3] === 'mcp' ? '1' : process.argv[3] === 'neo4j' ? 'neo4j' : '' }; delete env.ELECTRON_RUN_AS_NODE
const log = fs.openSync(path.join(evidence, 'app.log'), 'w')
const child = spawn(require('electron'), [bundle], { cwd: root, env, windowsHide: true, stdio: ['ignore', log, log] })
console.log(JSON.stringify({ evidence, pid: child.pid, lead: env.CHORUS_TEAM_PRODUCTION_LEAD }))
const [code] = await once(child, 'close'); fs.closeSync(log); fs.unlinkSync(bundle)
const report = path.join(evidence, code === 0 ? 'report.json' : 'failure.json')
console.log(fs.existsSync(report) ? fs.readFileSync(report, 'utf8') : JSON.stringify({ code, evidence, error: 'No report' })); process.exitCode = code ?? 1

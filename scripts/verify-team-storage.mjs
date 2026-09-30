import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'
const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'chorus-team-storage-'))
const bundle = path.join(root, '_verify', `team-storage-${Date.now()}.cjs`)
await require('esbuild').build({ entryPoints: [path.join(root, 'scripts/verify-team-storage.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'cjs', packages: 'external' })
const env = { ...process.env, CHORUS_TEAM_STORAGE_EVIDENCE: evidence }; delete env.ELECTRON_RUN_AS_NODE
const child = spawn(require('electron'), [bundle], { cwd: root, env, windowsHide: true, stdio: 'ignore' })
const timer = setTimeout(() => child.kill(), 600000)
const [code] = await once(child, 'close'); clearTimeout(timer)
const reportPath = path.join(evidence, code === 0 ? 'report.json' : 'failure.json')
console.log(fs.existsSync(reportPath) ? fs.readFileSync(reportPath, 'utf8') : JSON.stringify({ code, evidence, error: 'Native verifier did not produce a report.' }))
fs.unlinkSync(bundle)
process.exitCode = code === 0 ? 0 : 1

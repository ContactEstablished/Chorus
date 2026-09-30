import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { once } from 'node:events'
const require = createRequire(import.meta.url), root = process.cwd()
const evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'chorus-team-app-'))
const apiProfile = process.argv.includes('--api-profile')
const liveTeamCredential = process.argv.includes('--team-credential')
const credentialSource = liveTeamCredential ? path.join(process.env.APPDATA, 'chorus-app') : apiProfile ? fs.readFileSync(path.join(root,'_verify','phase11-council-profile.txt'),'utf8').trim() : null
if (credentialSource) {
  if (!liveTeamCredential && (!path.resolve(credentialSource).startsWith(path.resolve(os.tmpdir())+path.sep) || !path.basename(credentialSource).startsWith('chorus-team-council-'))) throw Error('API verification requires the selected disposable council profile')
  fs.mkdirSync(path.join(evidence,'profile'))
  fs.copyFileSync(path.join(credentialSource,'Local State'),path.join(evidence,'profile','Local State'))
}
const bundle = path.join(root, '_verify', `team-app-${Date.now()}.cjs`)
await require('esbuild').build({ entryPoints: ['scripts/verify-team-app.ts'], outfile: bundle, bundle: true, platform: 'node', format: 'cjs', packages: 'external' })
const env = { ...process.env, CHORUS_TEAM_APP_EVIDENCE: evidence, CHORUS_TEAM_APP_HISTORY: process.argv.includes('--history') ? '1' : '', CHORUS_TEAM_APP_CREDENTIAL_REFUSAL: process.argv.includes('--credential-refusal') ? '1' : '' }; delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL
if (credentialSource) env.CHORUS_TEAM_APP_CREDENTIAL_SOURCE = path.join(credentialSource,'chorus.db')
else delete env.CHORUS_TEAM_APP_CREDENTIAL_SOURCE
const log = fs.openSync(path.join(evidence, 'app.log'), 'w')
const child = spawn(require('electron'), [bundle, `--user-data-dir=${path.join(evidence, 'profile')}`], { cwd: root, env, windowsHide: true, stdio: ['ignore', log, log] })
console.log(JSON.stringify({ evidence, pid: child.pid }))
await once(child, 'close'); fs.closeSync(log); fs.unlinkSync(bundle)
const resultName = process.env.CHORUS_TEAM_APP_PREPARE_ONLY === '1' ? 'fixture-prepared.json' : 'report.json'
const resultPath = path.join(evidence, resultName), failurePath = path.join(evidence, 'failure.json')
const result = fs.existsSync(resultPath) ? JSON.parse(fs.readFileSync(resultPath, 'utf8')) : fs.existsSync(failurePath) ? JSON.parse(fs.readFileSync(failurePath, 'utf8')) : { passed: false, error: 'Application did not produce a completion report.', evidence }
const success = process.env.CHORUS_TEAM_APP_PREPARE_ONLY === '1' ? result.fixturePrepared === true : result.passed === true
console.log(JSON.stringify(result, null, 2)); process.exitCode = success ? 0 : 1

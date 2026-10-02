import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
const require = createRequire(import.meta.url), evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'chorus-team-revision-'))
const bundle = path.resolve('_verify', `team-revision-${Date.now()}.cjs`)
await require('esbuild').build({ stdin: { contents: `import { app } from 'electron'; import fs from 'node:fs'; import path from 'node:path'; import { verifyTeamRevision } from './scripts/verify-team-revision'; const evidence=process.env.CHORUS_REVISION_EVIDENCE!; app.setPath('userData',path.join(evidence,'profile')); app.whenReady().then(async()=>{try{const assertions=await verifyTeamRevision(evidence);fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({passed:true,assertions,evidence}));app.exit(0)}catch(e){fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({passed:false,message:String(e),stack:e.stack,evidence}));app.exit(1)}})`, resolveDir: process.cwd(), loader: 'ts' }, outfile: bundle, bundle: true, platform: 'node', format: 'cjs', packages: 'external' })
const env = { ...process.env, CHORUS_REVISION_EVIDENCE: evidence }; delete env.ELECTRON_RUN_AS_NODE
const child = spawn(require('electron'), [bundle], { env, windowsHide: true, stdio: 'ignore' })
console.log(JSON.stringify({ evidence, pid: child.pid }))
const [code] = await once(child, 'close')
const report = path.join(evidence, 'report.json'), result = fs.existsSync(report) ? JSON.parse(fs.readFileSync(report, 'utf8')) : { passed: false, code, evidence }
console.log(JSON.stringify(result, null, 2)); fs.unlinkSync(bundle); process.exitCode = code === 0 && result.passed ? 0 : 1

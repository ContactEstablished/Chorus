import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { once } from 'node:events'
const require = createRequire(import.meta.url), root = process.cwd()
const evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'chorus-team-recovery-'))
const bundle = path.join(root, '_verify', `team-recovery-${Date.now()}.cjs`)
await require('esbuild').build({ entryPoints: ['scripts/verify-team-recovery.ts'], outfile: bundle, bundle: true, platform: 'node', format: 'cjs', packages: 'external' })
const phases = ['reserved', 'workspace-intent', 'workspace', 'lead-unready', 'attempt-reserved', 'helper-running', 'helper-reused', 'helper-unknown', 'dirty', 'missing-workspace', 'capture-reserved', 'capture-objects', 'artifact-ref', 'prepared-ref', 'approval-accepted', 'applying-base', 'applying-result', 'credential-deleted', 'credential-rotated', 'credential-route', 'unknown-ref', 'corrupt']
const results = []
try {
  for (const phase of phases) {
    const directory = path.join(evidence, phase); fs.mkdirSync(directory)
    for (const mode of ['seed', 'recover']) {
      const env = { ...process.env, CHORUS_TEAM_RECOVERY_EVIDENCE: directory, CHORUS_TEAM_RECOVERY_PHASE: phase, CHORUS_TEAM_RECOVERY_MODE: mode }; delete env.ELECTRON_RUN_AS_NODE
      const child = spawn(require('electron'), [bundle], { cwd: root, env, windowsHide: true, stdio: 'ignore' })
      const timer = setTimeout(() => child.kill(), 120000)
      const [code] = await once(child, 'close'); clearTimeout(timer)
      if (code !== (mode === 'seed' ? 73 : 0)) throw Error(`${phase}/${mode} exited ${code}: ${fs.existsSync(path.join(directory, 'failure.json')) ? fs.readFileSync(path.join(directory, 'failure.json'), 'utf8') : directory}`)
    }
    results.push(JSON.parse(fs.readFileSync(path.join(directory, 'report.json'), 'utf8')))
    console.log(`${phase}: passed`)
  }
  const report = { passed: true, phases: results, assertions: results.reduce((n, r) => n + r.assertions, 0), evidence, at: new Date().toISOString() }
  fs.writeFileSync(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2))
} catch (error) { fs.writeFileSync(path.join(evidence, 'failure.json'), JSON.stringify({ message: String(error) })); console.error(String(error), evidence); process.exitCode = 1 }
finally { fs.unlinkSync(bundle) }

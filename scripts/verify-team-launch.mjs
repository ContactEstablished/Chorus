// Sanitized native discovery diagnostic using the production environment composer.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
const require = createRequire(import.meta.url)
const evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'chorus-team-launch-'))
const bundle = path.resolve('_verify', `team-launch-${Date.now()}.cjs`)
await require('esbuild').build({ entryPoints: ['src/main/adapters/env.ts'], outfile: bundle, bundle: true, platform: 'node', format: 'cjs' })
const { composeChildEnv } = require(bundle)
const results = []
try {
  for (const mode of ['ordinary', 'solo-fixture', 'team']) {
    const env = composeChildEnv({ parentEnv: process.env, requiredEnvVars: [], envAdditions: mode === 'ordinary' ? {} : { PATHEXT: '.COM;.EXE;.BAT;.CMD' }, secretEnv: mode === 'team' ? { CHORUS_TEAM_TOKEN: 'non-secret-diagnostic-placeholder' } : {} })
    const child = spawnSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-Command', 'Get-Command node,git -ErrorAction SilentlyContinue | Select-Object Name,Source | ConvertTo-Json -Compress'], { env, encoding: 'utf8', windowsHide: true, timeout: 15000 })
    results.push({ mode, pathPresent: Object.keys(env).some(k => k.toUpperCase() === 'PATH'), exitCode: child.status, discovery: child.stdout.trim(), error: child.error?.message ?? null })
  }
  const passed = results.every(r => r.pathPresent && r.exitCode === 0 && /node.exe/i.test(r.discovery) && /git.exe/i.test(r.discovery))
  const report = { passed, evidence, nodeVersion: process.version, results }
  fs.writeFileSync(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2)); process.exitCode = passed ? 0 : 1
} finally { fs.unlinkSync(bundle) }

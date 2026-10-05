// Model Routing Task 4b-2 (ImplementationSpec-4b-2, overview C18): the main-process Team routing harness.
// Bundles scripts/verify-routing-team.ts into _verify/ and runs it in a WINDOWLESS Electron host against a throwaway
// database and routing store under %TEMP%\chorus-routing-team-*. Zero cost: no helper, lead or OpenCode process, no
// request, no paid call. Prints one line per check (T1-T16) and, last, `PASS (16 checks)` (exit 0) or
// `FAIL (k of 16 checks)` (exit 1). The bundle and the whole evidence directory are deleted on every exit path;
// nothing is written anywhere else. T15 is completed here (the child's own stdout and stderr are scanned too) and
// T16 is decided here (the child exited 0 and everything it left is gone).
// Usage: node scripts/verify-routing-team.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TOTAL = 16
const evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'chorus-routing-team-'))
const bundle = path.join(ROOT, '_verify', `routing-team-${process.pid}.cjs`)
const FAKE_KEY = 'sk-or-v1-' + 'f'.repeat(64) // the driver's fake decrypt value; the child must never print it
const patterns = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'main', 'services', 'secret-patterns.json'), 'utf8')).patterns.map((p) => ({ name: p.name, re: new RegExp(p.source) }))
const redact = (text) => { let out = String(text).split(FAKE_KEY).join('[redacted]'); for (const { re } of patterns) out = out.replace(new RegExp(re.source, 'g'), '[redacted]'); return out }

let checks = [], code = null, output = '', failure = null
try {
  await require('esbuild').build({ entryPoints: [path.join(ROOT, 'scripts', 'verify-routing-team.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'error' })
  const env = { ...process.env, CHORUS_ROUTING_TEAM_EVIDENCE: evidence }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(require('electron'), [bundle], { cwd: ROOT, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', (c) => { output += c }); child.stderr.on('data', (c) => { output += c })
  const timer = setTimeout(() => child.kill(), 300000)
  ;[code] = await once(child, 'close'); clearTimeout(timer)
  const report = path.join(evidence, 'report.json'), failed = path.join(evidence, 'failure.json')
  if (fs.existsSync(report)) checks = JSON.parse(fs.readFileSync(report, 'utf8')).checks
  if (fs.existsSync(failed)) failure = JSON.parse(fs.readFileSync(failed, 'utf8'))
} catch (err) {
  failure = { message: err instanceof Error ? err.message : String(err) }
} finally {
  // T15, completed: the child's own output holds no key material either.
  const t15 = checks.find((c) => c.name.startsWith('T15 '))
  if (t15) {
    const hits = [output.includes(FAKE_KEY) ? 'the child output contains the fake key' : null, ...patterns.filter(({ re }) => re.test(output)).map(({ name }) => `the child output matches the ${name} pattern`)].filter(Boolean)
    t15.ok = t15.ok && hits.length === 0
    t15.detail = { ...t15.detail, childOutputHits: hits }
  }
  const gone = []
  for (const target of [bundle, evidence]) {
    try { fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); if (fs.existsSync(target)) throw new Error('it still exists') }
    catch (err) { gone.push(`${target} was not deleted (${err instanceof Error ? err.message : String(err)})`) }
  }
  const left = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('chorus-routing-team-'))
  checks.push({ name: 'T16 cleanup', ok: code === 0 && failure === null && gone.length === 0 && left.length === 0, detail: { exitCode: code, failure, notDeleted: gone, leftInTemp: left } })
}
for (const c of checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.ok ? '' : ` — ${redact(JSON.stringify(c.detail))}`}`)
const failed = checks.filter((c) => !c.ok).length + Math.max(0, TOTAL - checks.length)
console.log(failed === 0 && checks.length === TOTAL ? `PASS (${TOTAL} checks)` : `FAIL (${failed} of ${TOTAL} checks)`)
process.exitCode = failed === 0 && checks.length === TOTAL ? 0 : 1

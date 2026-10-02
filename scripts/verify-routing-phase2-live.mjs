// Model Routing Phase 2 live check (Task 2-3, MR-G1, MR-G7). SPENDS REAL OPENROUTER
// CREDIT: one observer tick (a free GET), then one real refresh (a free GET, two
// zero-cost preflights, and a cache probe limited to 2 endpoints and capped at
// $0.025 of estimate), asserting a total spend of at most $0.03. Run it ONCE, from
// the repository root, after Tasks 2-1 to 2-3 pass their tests.
//
// It reads the installed Chorus database READ-ONLY and copies only the OpenRouter
// API credential (its encrypted blob and provider row) plus `Local State` (the
// OSCrypt key that blob needs) into a throwaway profile under %TEMP%; the windowless
// Electron main (verify-routing-phase2-live.ts) decrypts it there through the
// production vault. The key is never printed or written: it exists only inside
// RoutingService, and leaves only in the Authorization header.
//
// ⚠ THE DECRYPTABLE COPY NEVER OUTLIVES THE RUN. `<evidence>/routing-live.db*` (the
// credential blob) and `<evidence>/profile` (the OSCrypt key) are deleted, in that
// order, then the bundle, each removal independent of the others, on a normal exit,
// a failure, a timeout and Ctrl+C / Ctrl+Break / a closed console. Each is checked
// afterwards; anything that survived is printed and the exit code is 1 regardless of
// the report. A startup sweep also removes the decryptable parts of any earlier
// evidence directory. report.json, probe.log and routing/ (public endpoint metadata)
// are kept.
//
// Usage: node scripts/verify-routing-phase2-live.mjs [--profile <chorus user-data dir>]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const root = process.cwd()
const EVIDENCE_PREFIX = 'chorus-routing-phase2-'
const RUN_TIMEOUT_MS = 300_000

const remove = (target) => fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })

/** The decryptable parts of an evidence directory, most sensitive first: the database copy, then the profile. */
function decryptablePaths(dir) {
  let names = []
  try {
    names = fs.readdirSync(dir)
  } catch {
    return []
  }
  const databases = names.filter((n) => n.startsWith('routing-live.db')).map((n) => path.join(dir, n))
  return [...databases, path.join(dir, 'profile')]
}

/** Removes each path in its own try/catch; returns the paths that still exist afterwards. */
function removeEach(paths) {
  for (const target of paths) {
    try {
      remove(target)
    } catch (error) {
      console.error(`could not remove ${target}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return paths.filter((p) => fs.existsSync(p))
}

// 6. Startup sweep: the decryptable parts of every earlier evidence directory (reports, logs and routing/ are kept).
const sweepLeftovers = []
let staleRemoved = 0
let staleDirectories = 0
for (const entry of fs.readdirSync(os.tmpdir(), { withFileTypes: true })) {
  if (!entry.isDirectory() || !entry.name.startsWith(EVIDENCE_PREFIX)) continue
  const stale = decryptablePaths(path.join(os.tmpdir(), entry.name)).filter((p) => fs.existsSync(p))
  if (stale.length === 0) continue
  staleDirectories += 1
  const left = removeEach(stale)
  staleRemoved += stale.length - left.length
  sweepLeftovers.push(...left)
}
console.log(`startup sweep: removed ${staleRemoved} stale decryptable path(s) (database copies and profiles) from ${staleDirectories} earlier evidence director(ies)`)
for (const p of sweepLeftovers) console.error(`startup sweep: could not remove ${p}`)

// 2. Source profile; its database is opened read-only by the Electron main.
const index = process.argv.indexOf('--profile')
const sourceProfile = index >= 0 ? path.resolve(process.argv[index + 1]) : path.join(process.env.APPDATA ?? '', 'chorus-app')
const sourceDb = path.join(sourceProfile, 'chorus.db')
if (!fs.existsSync(sourceDb)) throw Error(`No chorus.db in ${sourceProfile}; specify the existing Chorus profile with --profile.`)

// 3. The evidence directory. Everything that can fail after it exists runs inside the try below.
const evidence = fs.mkdtempSync(path.join(os.tmpdir(), EVIDENCE_PREFIX))
const profile = path.join(evidence, 'profile')
const bundle = path.join(root, '_verify', `routing-phase2-live-${process.pid}.cjs`)
const log = fs.createWriteStream(path.join(evidence, 'probe.log'))
log.on('error', (error) => {
  console.error(`probe.log could not be written: ${error instanceof Error ? error.message : String(error)}`)
})

let child = null
/** Kills the Electron child and every process under it, by the child's own PID (never by process name). */
function killChildTree() {
  if (child === null || child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  } else {
    child.kill()
  }
}

let cleaned = null
/** Idempotent and synchronous: the database copy, then the profile, then the bundle, each independently. */
function cleanup() {
  if (cleaned !== null) return cleaned
  const decryptableLeft = removeEach(decryptablePaths(evidence))
  const bundleLeft = removeEach([bundle])
  cleaned = { decryptableCopyRemoved: decryptableLeft.length === 0, bundleRemoved: bundleLeft.length === 0, leftovers: [...decryptableLeft, ...bundleLeft] }
  return cleaned
}

// 3 (signals). Ctrl+C, Ctrl+Break and a closed console: kill the tree, clean up synchronously, exit 1.
for (const signal of ['SIGINT', 'SIGBREAK', 'SIGHUP']) {
  process.on(signal, () => {
    console.error(`${signal}: stopping the run and removing the decryptable copy`)
    killChildTree()
    const result = cleanup()
    console.error(JSON.stringify({ evidence, interrupted: signal, ...result }, null, 2))
    process.exit(1)
  })
}

let code = null
let timedOut = false
let runError = null
try {
  // 3 (continued). The throwaway profile with the OSCrypt key, inside the try so a failure here is cleaned up too.
  fs.mkdirSync(profile)
  if (fs.existsSync(path.join(sourceProfile, 'Local State'))) {
    fs.copyFileSync(path.join(sourceProfile, 'Local State'), path.join(profile, 'Local State'))
  }

  // 4. Bundle the Electron main.
  await require('esbuild').build({
    entryPoints: ['scripts/verify-routing-phase2-live.ts'],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external'
  })

  // 5. Windowless Electron on the throwaway profile; output echoed live and logged.
  const env = { ...process.env, CHORUS_ROUTING_EVIDENCE: evidence, CHORUS_ROUTING_SOURCE_DB: sourceDb }
  delete env.ELECTRON_RUN_AS_NODE
  child = spawn(require('electron'), [bundle, `--user-data-dir=${profile}`], {
    cwd: root,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout.on('data', (chunk) => {
    process.stdout.write(chunk)
    log.write(chunk)
  })
  child.stderr.on('data', (chunk) => {
    process.stderr.write(chunk)
    log.write(chunk)
  })
  const closed = once(child, 'close')
  // A hung run has its whole tree killed (no report means passed: false); close is still awaited before cleanup.
  const timer = setTimeout(() => {
    timedOut = true
    killChildTree()
  }, RUN_TIMEOUT_MS)
  try {
    ;[code] = await closed
  } finally {
    clearTimeout(timer)
  }
} catch (error) {
  // esbuild, the profile copy or the spawn failed: reported below, after the cleanup, never thrown past it.
  runError = error instanceof Error ? error.message : String(error)
  if (child !== null && child.exitCode === null && child.signalCode === null && child.pid !== undefined) {
    const closedAfterKill = once(child, 'close').catch(() => undefined)
    killChildTree()
    let waitTimer = null
    await Promise.race([closedAfterKill, new Promise((resolve) => (waitTimer = setTimeout(resolve, 10_000)))])
    clearTimeout(waitTimer)
  }
} finally {
  // 6. The decryptable copy and the bundle never outlive the run. The log is closed first, with a bounded wait.
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 2000)
    try {
      log.end(() => {
        clearTimeout(timer)
        resolve()
      })
    } catch {
      clearTimeout(timer)
      resolve()
    }
  })
  cleanup()
}

// 7. Summary from the report, plus the cleanup outcome.
const reportPath = path.join(evidence, 'report.json')
let report = { passed: false, error: 'The Electron main produced no report.' }
if (fs.existsSync(reportPath)) {
  try {
    report = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
  } catch {
    report = { passed: false, error: 'report.json could not be parsed.' }
  }
}
const leftovers = [...cleaned.leftovers, ...sweepLeftovers]
console.log(
  JSON.stringify(
    {
      evidence,
      code,
      ...(timedOut ? { timedOut: true } : {}),
      ...(runError !== null ? { runError } : {}),
      passed: report.passed === true,
      estimateUsd: report.estimateUsd ?? null,
      spentUsd: report.spentUsd ?? null,
      checks: report.checks ?? [],
      ...(report.error ? { error: report.error } : {}),
      decryptableCopyRemoved: cleaned.decryptableCopyRemoved,
      bundleRemoved: cleaned.bundleRemoved,
      evidenceFiles: fs.readdirSync(evidence).sort()
    },
    null,
    2
  )
)
if (leftovers.length > 0) {
  for (const p of leftovers) console.error(`LEFTOVER (remove it by hand): ${p}`)
  process.exitCode = 1
} else {
  process.exitCode = report.passed === true ? 0 : 1
}

// Model Routing Phase 2, Task 2-4 (MR-G1, MR-G5): a zero-cost CDP drive of the BUILT app.
//
// What it checks (ImplementationSpec-2-4, D1-D17): every routing:* channel answers through
// window.chorus.routing with plain-object payloads written in the page; settings round-trip
// through storage.ts and reject unknown keys and refine failures; designating an unknown
// credential is refused and not stored; NO_SNAPSHOT, UNKNOWN_MODEL and INVALID_REQUEST come
// back as fixed codes; a refresh with an unknown credential is refused before any progress
// event; a Proxy payload is rejected by the bridge ("could not be cloned"), the D14 failure
// this drive exists to catch; no clone error otherwise; and no OpenRouter request was made
// (requestsSinceStart 0, and no snapshot.json under <profile>/routing after exit, where the
// profile's own chorus.db shows the drive's writes landed in the throwaway profile).
//
// It spends nothing: no credential, no key, no OpenRouter request.
//
// Prerequisite: `npx electron-vite build` (the drive loads out/; dev never rebuilds MAIN on
// edit, so a stale build would test stale main code; C24). The drive refuses a stale build.
//
// Process safety: it launches its OWN app with a throwaway --user-data-dir under the OS temp
// directory and a free CDP port, never 9222 and never the user's profile, and it stops only
// that child, by its own handle (`taskkill /pid <its own pid> /F` as the last resort, never by
// name). The profile is deleted at the end, and also on Ctrl+C / Ctrl+Break (then exit 1).
//
// Usage (from anywhere): node scripts/verify-routing-ipc.mjs
// Last line: `PASS (n checks)` (exit 0) or `FAIL (k of n checks)` (exit 1).
import fs from 'node:fs'
import os from 'node:os'
import net from 'node:net'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ── Hand-written expectations (never computed by the code under test) ──
/** A copy of DEFAULT_ROUTING_SETTINGS (src/shared/routing.ts), as verify-routing-ranker.mjs holds its own. */
const DEFAULTS = {
  minUptimePct: 99.5,
  readmitUptimePct: 99.6,
  outageGuard5mPct: 95,
  unknownQuantPolicy: 'firstPartyAndVerified',
  smoothingWindow: 6,
  stableMinObservations: 3,
  observationMaxAgeDays: 7,
  snapshotMaxAgeMinutes: 60,
  budgetMinTps: 30,
  budgetMedianFraction: 0.5,
  tierWeights: { budget: 0.3, balanced: 0.5, fast: 1.0 },
  tieRatio: 1.01,
  fallbackCount: 2,
  dataCollection: 'deny'
}
const SLUG = 'deepseek/deepseek-v4.1-flash'
const DISPLAY_NAME = 'DeepSeek V4.1 Flash'
/** A valid UUID that names no credential. */
const UUID0 = '00000000-0000-4000-8000-000000000000'
const NOT_FOUND = 'The routing credential was not found.'
const UNDESIGNATED = { enabled: true, credentialProfileId: null }

const CHECKS = [
  'D1 models', 'D2 status dormant', 'D3 settings defaults', 'D4 settings round-trip', 'D5 settings rejected',
  'D6 observation default', 'D7 unknown credential refused', 'D8 observation disabled', 'D9 no snapshot',
  'D10 unknown model and bad profile', 'D11 refresh refused, no events', 'D12 malformed requests',
  'D13 Proxy rejected by the bridge', 'D14 no OpenRouter request', 'D15 no renderer errors',
  'D16 throwaway DB, no snapshot file', 'D17 no key material', 'cleanup'
]
const results = new Map()
const record = (name, detail) => {
  if (results.has(name)) return
  const ok = detail === null
  results.set(name, ok)
  console.log(ok ? `ok ${name}` : `FAIL ${name}: ${String(detail).slice(0, 400)}`)
}
function finish() {
  if (interrupted) return // the interrupt handler exits 1 once the profile is deleted
  const failed = CHECKS.filter((name) => results.get(name) !== true).length
  console.log(failed === 0 ? `PASS (${CHECKS.length} checks)` : `FAIL (${failed} of ${CHECKS.length} checks)`)
  process.exitCode = failed === 0 ? 0 : 1
}

// ── 2. Freshness ──
const MAIN_BUNDLE = path.join(ROOT, 'out', 'main', 'index.js')
const PRELOAD_BUNDLE = path.join(ROOT, 'out', 'preload', 'index.js')
function staleReason() {
  if (!fs.existsSync(MAIN_BUNDLE) || !fs.existsSync(PRELOAD_BUNDLE)) return 'out/main/index.js or out/preload/index.js is missing'
  const servicesDir = path.join(ROOT, 'src', 'main', 'services')
  const coresDir = path.join(ROOT, 'src', 'main', 'routing')
  const sources = [
    ...fs.readdirSync(servicesDir).filter((name) => /^routing.*\.ts$/.test(name)).map((name) => path.join(servicesDir, name)),
    ...fs.readdirSync(coresDir).filter((name) => name.endsWith('.ts')).map((name) => path.join(coresDir, name)),
    path.join(ROOT, 'src', 'shared', 'routing.ts'),
    path.join(ROOT, 'src', 'main', 'index.ts'),
    path.join(ROOT, 'src', 'preload', 'index.ts')
  ]
  const newest = sources.reduce((best, file) => {
    const mtime = fs.statSync(file).mtimeMs
    return mtime > best.mtime ? { file, mtime } : best
  }, { file: '', mtime: 0 })
  if (fs.statSync(MAIN_BUNDLE).mtimeMs < newest.mtime) return `out/main/index.js is older than ${path.relative(ROOT, newest.file)}`
  if (!fs.readFileSync(MAIN_BUNDLE, 'utf8').includes('routing:refresh')) return 'out/main/index.js has no routing:refresh'
  if (!fs.readFileSync(PRELOAD_BUNDLE, 'utf8').includes('routing:progress')) return 'out/preload/index.js has no routing:progress'
  return null
}
const stale = staleReason()
if (stale !== null) {
  console.log(`# ${stale}`)
  console.log('FAIL build is stale: run npx electron-vite build')
  process.exit(1)
}

// ── 3. Launch: a free port, a throwaway profile, the built app ──
const server = net.createServer()
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const port = server.address().port
await new Promise((resolve) => server.close(resolve))
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chorus-routing-ipc-'))
const logPath = path.join(profile, 'app.log')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
const logFd = fs.openSync(logPath, 'w')
const child = spawn(
  require('electron'),
  ['.', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'],
  { cwd: ROOT, env, windowsHide: true, stdio: ['ignore', logFd, logFd] }
)
console.log(`# launched pid=${child.pid} port=${port} profile=${profile}`)
let childExit = null
const exited = new Promise((resolve) => {
  child.on('exit', (code, signal) => {
    childExit = { code, signal }
    resolve()
  })
})
child.on('error', (err) => {
  childExit = childExit ?? { code: null, signal: null, error: err.message }
})
const waitExit = (ms) => Promise.race([exited, sleep(ms)])

/**
 * The last resort, by this child's own PID and only while it is still running (never by name,
 * and without /T: Chromium's helper processes exit with their main process).
 */
function killOwnChild() {
  if (childExit !== null || child.pid === undefined) return
  try {
    execFileSync('taskkill', ['/pid', String(child.pid), '/F'], { stdio: 'ignore', windowsHide: true })
  } catch {
    // Already gone.
  }
}
let logClosed = false
function closeLog() {
  if (logClosed) return
  logClosed = true
  try {
    fs.closeSync(logFd)
  } catch {
    // Already closed.
  }
}
/** Best effort, with retries: the app's helper processes may hold a file for a moment after exit. Returns the last error, or null. */
async function deleteProfile() {
  let lastError = null
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      fs.rmSync(profile, { recursive: true, force: true })
      return fs.existsSync(profile) ? 'still present' : null
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      await sleep(1_000)
    }
  }
  return lastError
}
/** Ctrl+C / Ctrl+Break: stop our own child, delete the throwaway profile, exit 1. */
let interrupted = false
async function onInterrupt(signal) {
  if (interrupted) return
  interrupted = true
  console.log(`# ${signal}: stopping pid ${child.pid} and deleting ${profile}`)
  killOwnChild()
  await waitExit(5_000)
  closeLog()
  const error = await deleteProfile()
  if (error !== null) console.log(`# the throwaway profile was not deleted: ${error}`)
  process.exit(1)
}
process.on('SIGINT', () => void onInterrupt('SIGINT'))
process.on('SIGBREAK', () => void onInterrupt('SIGBREAK'))
process.on('exit', killOwnChild)

// ── 4. Connect ──
let socket = null
let sequence = 0
const pending = new Map()
function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`CDP timed out: ${method}`))
    }, 30_000)
    pending.set(id, { resolve, reject, timer })
    socket.send(JSON.stringify({ id, method, params }))
  })
}
/** Runtime.evaluate of an async IIFE that returns plain JSON. */
async function evaluate(expression) {
  const reply = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text)
  return reply.result.value
}
/** Every value the page hands back, for D17. */
const responseTexts = []
/** Runs `body` inside an async IIFE in the page, with `routing` bound to window.chorus.routing. */
async function page(body) {
  const value = await evaluate(`(async () => { const routing = window.chorus.routing; ${body} })()`)
  responseTexts.push(JSON.stringify(value) ?? 'undefined')
  return value
}

async function connect() {
  let target = null
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline && childExit === null) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      target = list.find((t) => t.type === 'page' && t.url.includes('renderer/index.html')) ?? null
      if (target) break
    } catch {
      // Not listening yet.
    }
    await sleep(500)
  }
  if (!target) throw new Error(childExit !== null ? `the app exited early (${JSON.stringify(childExit)})` : 'no renderer/index.html page within 60 s')
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', () => reject(new Error('CDP socket error')), { once: true })
  })
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    const item = pending.get(message.id)
    if (!item) return
    pending.delete(message.id)
    clearTimeout(item.timer)
    if (message.error) item.reject(new Error(message.error.message))
    else item.resolve(message.result)
  })
  socket.addEventListener('close', () => {
    for (const item of pending.values()) {
      clearTimeout(item.timer)
      item.reject(new Error('CDP socket closed'))
    }
    pending.clear()
  })
  // The bridge is there once the preload has run; wait for the page to finish loading too.
  const ready = Date.now() + 30_000
  while (Date.now() < ready) {
    const state = await evaluate(
      `(async () => ({ bridge: typeof window.chorus === 'object' && window.chorus !== null && typeof window.chorus.routing === 'object', loaded: document.readyState === 'complete' }))()`
    ).catch(() => null)
    if (state && state.bridge && state.loaded) return
    await sleep(500)
  }
  throw new Error('window.chorus.routing never appeared (stale preload?)')
}

// ── Assertion helpers (each returns null on success, else a detail string) ──
const show = (value) => JSON.stringify(value)
const refused = (reply, code, message) => {
  if (!reply || reply.ok !== false || reply.code !== code) return `expected ${code}, got ${show(reply)}`
  if (message !== undefined && reply.message !== message) return `expected message ${show(message)}, got ${show(reply.message)}`
  return null
}
const okValue = (reply, expected) => {
  if (!reply || reply.ok !== true) return `expected ok, got ${show(reply)}`
  if (expected !== undefined && !isDeepStrictEqual(reply.value, expected)) return `expected ${show(expected)}, got ${show(reply.value)}`
  return null
}
const first = (...details) => details.find((d) => d !== null) ?? null

async function runChecks() {
  // 5. Watchers.
  await page(`
    window.__routingErrors = []
    window.addEventListener('unhandledrejection', (event) => { window.__routingErrors.push(String(event.reason)) })
    window.__routingEvents = 0
    window.__routingUnsub = routing.onProgress(() => { window.__routingEvents++ })
    return true`)

  // 6. Checks. Every payload is an object literal written in the page.
  const defaultsLiteral = JSON.stringify(DEFAULTS)

  const d1 = await page(`return await routing.models({})`)
  record('D1 models', first(
    okValue(d1),
    d1?.value?.models?.some((m) => isDeepStrictEqual(m, { slug: SLUG, displayName: DISPLAY_NAME })) ? null : `no ${SLUG} in ${show(d1?.value)}`
  ))

  const d2 = await page(`return await routing.status({})`)
  {
    const o = d2?.value?.observer
    const m = d2?.value?.models?.find((x) => x.model === SLUG)
    record('D2 status dormant', first(
      okValue(d2),
      o?.state === 'dormant' && o?.dormantReason === 'undesignated' ? null : `observer ${show(o)}`,
      o?.nextTickAt !== null && o?.nextTickAt !== undefined && o?.lastTickAt === null ? null : `ticks ${show(o)}`,
      m && m.snapshotFetchedAt === null && m.observations === 0 && m.cacheVerified === 0 && m.busy === false ? null : `model ${show(m)}`,
      d2?.value?.requestsSinceStart === 0 ? null : `requestsSinceStart ${show(d2?.value?.requestsSinceStart)}`
    ))
  }

  const d3 = await page(`return await routing.settingsGet({})`)
  record('D3 settings defaults', okValue(d3, DEFAULTS))

  const d4 = await page(`
    const defaults = ${defaultsLiteral}
    const set = await routing.settingsSet({ settings: { ...defaults, minUptimePct: 99.4 } })
    const read = await routing.settingsGet({})
    const restored = await routing.settingsSet({ settings: defaults })
    const after = await routing.settingsGet({})
    return { set, read, restored, after }`)
  record('D4 settings round-trip', first(
    okValue(d4?.set, { ...DEFAULTS, minUptimePct: 99.4 }),
    okValue(d4?.read, { ...DEFAULTS, minUptimePct: 99.4 }),
    okValue(d4?.restored, DEFAULTS),
    okValue(d4?.after, DEFAULTS)
  ))

  const d5 = await page(`
    const defaults = ${defaultsLiteral}
    const bogus = await routing.settingsSet({ settings: { ...defaults, bogus: 1 } })
    const refine = await routing.settingsSet({ settings: { ...defaults, readmitUptimePct: 99 } })
    const unwrapped = await routing.settingsSet(defaults)
    const after = await routing.settingsGet({})
    return { bogus, refine, unwrapped, after }`)
  record('D5 settings rejected', first(
    refused(d5?.bogus, 'INVALID_REQUEST'),
    refused(d5?.refine, 'INVALID_REQUEST'),
    refused(d5?.unwrapped, 'INVALID_REQUEST'),
    okValue(d5?.after, DEFAULTS)
  ))

  const d6 = await page(`return await routing.observationGet({})`)
  record('D6 observation default', okValue(d6, UNDESIGNATED))

  const d7 = await page(`
    const set = await routing.observationSet({ enabled: true, credentialProfileId: '${UUID0}' })
    const after = await routing.observationGet({})
    return { set, after }`)
  record('D7 unknown credential refused', first(refused(d7?.set, 'CREDENTIAL_REFUSED', NOT_FOUND), okValue(d7?.after, UNDESIGNATED)))

  const d8 = await page(`
    const set = await routing.observationSet({ enabled: false, credentialProfileId: null })
    const status = await routing.status({})
    const restored = await routing.observationSet({ enabled: true, credentialProfileId: null })
    const after = await routing.observationGet({})
    return { set, status, restored, after }`)
  record('D8 observation disabled', first(
    okValue(d8?.set, { enabled: false, credentialProfileId: null }),
    okValue(d8?.status),
    d8?.status?.value?.observer?.dormantReason === 'disabled' ? null : `observer ${show(d8?.status?.value?.observer)}`,
    okValue(d8?.restored, UNDESIGNATED),
    okValue(d8?.after, UNDESIGNATED)
  ))

  const d9 = await page(`return await routing.tiers({ model: '${SLUG}', profile: 'interactive', effort: 'low', credentialProfileId: null })`)
  record('D9 no snapshot', refused(d9, 'NO_SNAPSHOT'))

  const d10 = await page(`
    const unknown = await routing.tiers({ model: 'other/model', profile: 'interactive', effort: 'low', credentialProfileId: null })
    const batch = await routing.tiers({ model: '${SLUG}', profile: 'batch', effort: 'low', credentialProfileId: null })
    return { unknown, batch }`)
  record('D10 unknown model and bad profile', first(refused(d10?.unknown, 'UNKNOWN_MODEL'), refused(d10?.batch, 'INVALID_REQUEST')))

  const d11 = await page(`
    const reply = await routing.refresh({ model: '${SLUG}', credentialProfileId: '${UUID0}', profile: 'interactive', effort: 'low' })
    await new Promise((resolve) => setTimeout(resolve, 500))
    return { reply, events: window.__routingEvents }`)
  record('D11 refresh refused, no events', first(
    refused(d11?.reply, 'CREDENTIAL_REFUSED', NOT_FOUND),
    d11?.events === 0 ? null : `progress events ${show(d11?.events)}`
  ))

  const d12 = await page(`
    const text = await routing.models('text')
    const extra = await routing.status({ extra: 1 })
    return { text, extra }`)
  record('D12 malformed requests', first(refused(d12?.text, 'INVALID_REQUEST'), refused(d12?.extra, 'INVALID_REQUEST')))

  // Negative control: a Proxy (what a Pinia/Vue reactive object is) must be refused by the bridge
  // before main is reached. A reply of any kind (even an error code) would mean main saw it.
  const d13 = await page(`
    try {
      const reply = await routing.status(new Proxy({}, {}))
      return { rejected: false, reply }
    } catch (error) {
      return { rejected: true, message: String(error && error.message ? error.message : error) }
    }`)
  if (d13?.rejected === true) console.log(`# D13 rejection: ${String(d13.message).slice(0, 300)}`)
  record('D13 Proxy rejected by the bridge', d13?.rejected === true && /could not be cloned/.test(d13.message)
    ? null
    : `expected a rejection containing "could not be cloned", got ${show(d13)}`)

  const d14 = await page(`return await routing.status({})`)
  record('D14 no OpenRouter request', first(
    okValue(d14),
    d14?.value?.requestsSinceStart === 0 ? null : `requestsSinceStart ${show(d14?.value?.requestsSinceStart)}`
  ))

  const d15 = await page(`
    const errors = window.__routingErrors
    if (typeof window.__routingUnsub === 'function') window.__routingUnsub()
    return { present: Array.isArray(errors), errors: Array.isArray(errors) ? errors : null, events: window.__routingEvents }`)
  record('D15 no renderer errors', d15?.present !== true
    ? 'the watchers are gone (the page reloaded during the drive)'
    : d15.errors.length === 0 ? null : `unhandled rejections: ${show(d15.errors)}`)
}

/** D16: absent, or no snapshot.json anywhere beneath. */
function findSnapshots(dir) {
  if (!fs.existsSync(dir)) return []
  const found = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) found.push(...findSnapshots(full))
    else if (entry.name === 'snapshot.json') found.push(full)
  }
  return found
}

/** D17: the canonical key shapes (the scrubber's and the secret-grep gate's one list). */
function keyMaterialDetail() {
  const { patterns } = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'main', 'services', 'secret-patterns.json'), 'utf8'))
  const compiled = patterns.map((p) => ({ name: p.name, re: new RegExp(p.source) }))
  // Positive control, assembled by concatenation: the patterns must be able to match at all.
  const control = 'sk-or-v1-' + '0123456789abcdef'.repeat(2)
  if (!compiled.some(({ re }) => re.test(control))) return 'the secret patterns match nothing (control failed)'
  if (responseTexts.length < 15) return `only ${responseTexts.length} responses collected`
  for (const text of responseTexts) {
    const hit = compiled.find(({ re }) => re.test(text))
    if (hit) return `a response matches the ${hit.name} pattern`
  }
  return null
}

// ── Run ──
let setupError = null
try {
  await connect()
  await runChecks()
} catch (err) {
  setupError = err instanceof Error ? err.message : String(err)
  console.log(`FAIL drive: ${setupError}`)
}

// ── 7. Shutdown: Browser.close is fire-and-forget (it never answers); then this child only ──
try {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id: ++sequence, method: 'Browser.close' }))
} catch {
  // The app may already be closing.
}
await waitExit(5_000)
if (childExit === null) {
  console.log('# the app did not exit within 5 s of Browser.close; child.kill()')
  child.kill()
  await waitExit(5_000)
}
if (childExit === null) {
  console.log(`# still running; taskkill /pid ${child.pid} /F`)
  killOwnChild()
  await waitExit(5_000)
}
console.log(`# app exited ${show(childExit)}`)
try {
  socket?.close()
} catch {
  // Already closed.
}

// ── 8. After exit: D16, D17, then delete the throwaway profile ──
if (childExit === null) {
  record('D16 throwaway DB, no snapshot file', 'the app is still running')
} else {
  // chorus.db in the throwaway profile proves the drive's writes (D4, D8) landed there, not in a real profile.
  const snapshots = findSnapshots(path.join(profile, 'routing'))
  record('D16 throwaway DB, no snapshot file', first(
    fs.existsSync(path.join(profile, 'chorus.db')) ? null : 'no chorus.db in the throwaway profile',
    snapshots.length === 0 ? null : `found ${snapshots.map((f) => path.relative(profile, f)).join(', ')}`
  ))
}
record('D17 no key material', keyMaterialDetail())
for (const name of CHECKS) if (name !== 'cleanup' && !results.has(name)) record(name, setupError === null ? 'not run' : `not run (${setupError})`)

if ([...results.values()].includes(false) && fs.existsSync(logPath)) {
  // The app log holds no credential (the profile has none); its tail is the fastest diagnosis.
  const tail = fs.readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean).slice(-30)
  for (const line of tail) console.log(`# log| ${line.slice(0, 300)}`)
}
closeLog()
await sleep(1_000) // let the app's helper processes release the profile
const cleanupError = await deleteProfile()
record('cleanup', cleanupError === null ? null : `the throwaway profile was not deleted: ${cleanupError}`)

// ── 9. ──
finish()

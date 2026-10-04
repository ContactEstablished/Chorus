// Model Routing Task 3-4 (MR-G1, MR-G4, MR-G5): a zero-cost CDP drive of the BUILT app through
// Settings → Model routing (ImplementationSpec-3-4, checks U1-U15 and cleanup).
//
// What it checks: the "Model routing" nav row opens the section; in an empty throwaway profile the
// inspector shows one model, two profiles and the fixed-effort caption, no credential (the hint,
// a disabled Refresh with its reason, the cost statement), every card in its no-snapshot state, no
// table, and observation on but undesignated (U1-U5). It turns observation off and on, and the
// data-collection opt-in on and off, through the real checkboxes, and reads back what main stored
// (U6, U7: the renderer-to-main payloads of the real UI, D14 / MR-G5). It then seeds a snapshot
// (the golden fixture, re-dated to five minutes ago) into the throwaway profile, re-enters the
// section, and checks the cards against main's own routing:tiers reply, the Nitro card, the age
// line and notes, and the providers table (U8-U11; tier ORDER is compared with main, never with a
// golden list, because time-of-day prices move it, C18). Finally: no OpenRouter request was made
// (U12), Refresh stays unavailable (U13), no renderer exception, console error or unhandled
// rejection after navigation began (U14, with positive controls), and no key material in any
// response or the page text (U15, with a positive control).
//
// It spends nothing: no credential, no key, no OpenRouter request (requestsSinceStart stays 0).
//
// Prerequisite: `npx electron-vite build` (the drive loads out/; dev never rebuilds MAIN on edit,
// so a stale build would test stale code). The drive refuses a stale build.
//
// Process safety: it launches its OWN app with a throwaway --user-data-dir under the OS temp
// directory and a free CDP port, never 9222 and never the user's profile (%APPDATA%\chorus*), and
// it stops only that child, by its own handle (`taskkill /pid <its own pid> /F` as the last
// resort, never by name). The profile and the esbuild seed bundle are deleted at the end, and also
// on Ctrl+C / Ctrl+Break (then exit 1). It leaves only three PNGs in _verify/routing-settings-ui/.
//
// Usage (from anywhere): node scripts/verify-routing-settings-ui.mjs
// Last line: `PASS (16 checks)` (exit 0) or `FAIL (k of 16 checks)` (exit 1).
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
const OUT = path.join(ROOT, '_verify', 'routing-settings-ui')
const PNGS = ['empty-state.png', 'seeded-cards.png', 'seeded-providers.png']
const FIXTURE = path.join(ROOT, 'src', 'main', 'routing', '__fixtures__', 'endpoints-deepseek-v4.1-flash-2026-10-02.json')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ── Hand-written expectations (ImplementationSpec-3-4; never computed by the code under test) ──
/** A copy of DEFAULT_ROUTING_SETTINGS (src/shared/routing.ts), as verify-routing-ipc.mjs holds its own. */
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
const PREVIEW_NOTE = 'Launches use a tier only when you choose it in the launch dialog. Team helpers do not use tiers yet.'
const EFFORT_CAPTION = 'Ranked for reasoning effort "low", fixed in this preview.'
const NO_CREDENTIAL_HINT = 'Add an OpenRouter API-key credential under Providers & keys first.'
const NO_CREDENTIAL_OPTION = 'No OpenRouter API-key credential'
const REFRESH_TITLE_NEEDS_CREDENTIAL = 'Choose a model and an OpenRouter API-key credential first.'
const COST =
  'A refresh fetches the endpoint list and checks account eligibility (both free), then may spend up to about $0.05 of OpenRouter credit verifying prompt caching. The estimate is shown before anything is spent.'
const NO_SNAPSHOT_REASON = 'No endpoint numbers for this model yet. Refresh to rank it.'
const OBSERVE_UNDESIGNATED = 'On, but nothing is recorded until you choose a credential.'
const OBSERVE_OFF = 'Off. Chorus makes no background requests.'
const NITRO_LABEL = 'Nitro — unfiltered provider routing'
const AMBER = 'rgb(245, 158, 11)'
const NITRO_LIKELY = 'Likely: Together (together) · 223 tok/s'
const NITRO_WARNING = 'Likely provider: Together (together), quantization not declared.'
const NOTES = [
  'Account guardrails were not checked; a pinned endpoint may be refused.',
  'Data-policy removals were not checked.',
  'Limited history: 14 of 14 eligible endpoints have fewer than 3 speed observations.'
]
const SHOW_ALL = 'Show all providers (14 eligible · 18 excluded)'
const ALIBABA_STATUS =
  'Excluded: uptime 97.18% < 99.5%; currently degraded (5m uptime 92.3%); status -2; quantization not declared'
const RANKED = ['budget', 'balanced', 'fast']

const CHECKS = [
  'U1 nav and section', 'U2 inspector inputs', 'U3 no credential', 'U4 no snapshot', 'U5 observation default',
  'U6 observation off and on', 'U7 data collection round trip', 'U8 seeded tiers match main', 'U9 Nitro card',
  'U10 age and notes', 'U11 providers table', 'U12 stored data, no request', 'U13 refresh stays unavailable',
  'U14 no renderer errors', 'U15 no key material', 'cleanup'
]
const results = new Map()
const record = (name, detail) => {
  if (results.has(name)) return
  const ok = detail === null
  results.set(name, ok)
  console.log(ok ? `ok ${name}` : `FAIL ${name}: ${String(detail).slice(0, 700)}`)
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
const RENDERER_HTML = path.join(ROOT, 'out', 'renderer', 'index.html')
const RENDERER_ASSETS = path.join(ROOT, 'out', 'renderer', 'assets')
/** The newest of `files` by mtime; throws (with the path) for a missing one. */
function newestOf(files) {
  return files.reduce((best, file) => {
    const mtime = fs.statSync(file).mtimeMs
    return mtime > best.mtime ? { file, mtime } : best
  }, { file: '', mtime: 0 })
}
function staleReason() {
  if (!fs.existsSync(MAIN_BUNDLE) || !fs.existsSync(PRELOAD_BUNDLE)) return 'out/main/index.js or out/preload/index.js is missing'
  const servicesDir = path.join(ROOT, 'src', 'main', 'services')
  const coresDir = path.join(ROOT, 'src', 'main', 'routing')
  const mainSources = [
    ...fs.readdirSync(servicesDir).filter((name) => /^routing.*\.ts$/.test(name)).map((name) => path.join(servicesDir, name)),
    ...fs.readdirSync(coresDir).filter((name) => name.endsWith('.ts')).map((name) => path.join(coresDir, name)),
    path.join(ROOT, 'src', 'shared', 'routing.ts'),
    path.join(ROOT, 'src', 'main', 'index.ts'),
    path.join(ROOT, 'src', 'preload', 'index.ts')
  ]
  const newestMain = newestOf(mainSources)
  if (fs.statSync(MAIN_BUNDLE).mtimeMs < newestMain.mtime) return `out/main/index.js is older than ${path.relative(ROOT, newestMain.file)}`
  if (!fs.readFileSync(MAIN_BUNDLE, 'utf8').includes('routing:refresh')) return 'out/main/index.js has no routing:refresh'
  const preloadText = fs.readFileSync(PRELOAD_BUNDLE, 'utf8')
  if (!preloadText.includes('routing:progress')) return 'out/preload/index.js has no routing:progress'
  if (!preloadText.includes('routing:credentials')) return 'out/preload/index.js has no routing:credentials'

  if (!fs.existsSync(RENDERER_HTML)) return 'out/renderer/index.html is missing'
  const assets = fs.existsSync(RENDERER_ASSETS)
    ? fs.readdirSync(RENDERER_ASSETS).filter((name) => name.endsWith('.js')).map((name) => path.join(RENDERER_ASSETS, name))
    : []
  if (assets.length === 0) return 'out/renderer/assets has no .js file'
  const routingComponents = path.join(ROOT, 'src', 'renderer', 'src', 'components', 'routing')
  const rendererSources = [
    path.join(ROOT, 'src', 'renderer', 'src', 'views', 'SettingsRouting.vue'),
    path.join(ROOT, 'src', 'renderer', 'src', 'views', 'SettingsView.vue'),
    ...fs.readdirSync(routingComponents).filter((name) => name.endsWith('.vue')).map((name) => path.join(routingComponents, name)),
    path.join(ROOT, 'src', 'renderer', 'src', 'stores', 'routing.ts'),
    path.join(ROOT, 'src', 'shared', 'routingView.ts'),
    path.join(ROOT, 'src', 'shared', 'routing.ts')
  ]
  for (const file of rendererSources) if (!fs.existsSync(file)) return `${path.relative(ROOT, file)} is missing`
  const newestSource = newestOf(rendererSources)
  if (newestOf(assets).mtime < newestSource.mtime) return `the newest out/renderer/assets/*.js is older than ${path.relative(ROOT, newestSource.file)}`
  if (!assets.some((file) => fs.readFileSync(file, 'utf8').includes(PREVIEW_NOTE))) return `no out/renderer/assets/*.js contains "${PREVIEW_NOTE}"`
  return null
}
const stale = staleReason()
if (stale !== null) {
  console.log(`# ${stale}`)
  console.log('FAIL build is stale: run npx electron-vite build')
  process.exit(1)
}

// ── 3. Seed helpers: the Phase 1 parser and the Phase 2 file writers, bundled with esbuild ──
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })
const SEED_BUNDLE = path.join(OUT, `seed-${process.pid}.cjs`)
function deleteSeedBundle() {
  try {
    fs.rmSync(SEED_BUNDLE, { force: true })
  } catch {
    // Retried by the cleanup sweep.
  }
}
process.on('exit', deleteSeedBundle)
let seed
try {
  await require('esbuild').build({
    stdin: {
      contents: [
        "export { parseEndpointsResponse, extractObservations } from './src/main/routing/endpointsCore'",
        "export { modelDirName, snapshotFileText, observationsFileText } from './src/main/routing/storeCore'"
      ].join('\n'),
      resolveDir: ROOT,
      loader: 'ts',
      sourcefile: 'routing-settings-seed.ts'
    },
    outfile: SEED_BUNDLE,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    logLevel: 'warning'
  })
  seed = require(SEED_BUNDLE)
} catch (err) {
  deleteSeedBundle()
  console.log(`FAIL drive: the seed bundle could not be built: ${err instanceof Error ? err.message : String(err)}`)
  console.log(`FAIL (${CHECKS.length} of ${CHECKS.length} checks)`)
  process.exit(1)
}
deleteSeedBundle() // loaded; the file is not needed any more

// ── 4. Launch: a free port, a throwaway profile, the built app ──
const server = net.createServer()
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const port = server.address().port
await new Promise((resolve) => server.close(resolve))
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chorus-routing-settings-'))
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
/** Ctrl+C / Ctrl+Break: stop our own child, delete the throwaway profile and the bundle, exit 1. */
let interrupted = false
async function onInterrupt(signal) {
  if (interrupted) return
  interrupted = true
  console.log(`# ${signal}: stopping pid ${child.pid} and deleting ${profile}`)
  killOwnChild()
  await waitExit(5_000)
  closeLog()
  deleteSeedBundle()
  const error = await deleteProfile()
  if (error !== null) console.log(`# the throwaway profile was not deleted: ${error}`)
  process.exit(1)
}
process.on('SIGINT', () => void onInterrupt('SIGINT'))
process.on('SIGBREAK', () => void onInterrupt('SIGBREAK'))
process.on('exit', killOwnChild)

// ── Connect ──
let socket = null
let sequence = 0
const pending = new Map()
/** Runtime.exceptionThrown and console.error events from the page (U14). */
const rendererErrors = []
function onEvent(method, params) {
  if (method === 'Runtime.exceptionThrown') {
    const details = params?.exceptionDetails
    rendererErrors.push(`exception: ${details?.exception?.description ?? details?.text ?? 'unknown'}`)
  } else if (method === 'Runtime.consoleAPICalled' && params?.type === 'error') {
    rendererErrors.push(`console.error: ${(params.args ?? []).map((a) => a.value ?? a.description ?? a.type).join(' ')}`)
  }
}
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
/** Runtime.evaluate of an expression that returns plain JSON (awaited when it is a promise). */
async function evaluate(expression) {
  const reply = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text)
  return reply.result.value
}
/** Every value the page's routing calls hand back, for U15. */
const responseTexts = []
/** Runs `body` inside an async IIFE in the page, with `routing` bound to window.chorus.routing. Payloads are object literals written here. */
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
    if (message.id === undefined) {
      if (typeof message.method === 'string') onEvent(message.method, message.params)
      return
    }
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
    if (state && state.bridge && state.loaded) {
      await cdp('Runtime.enable')
      return
    }
    await sleep(500)
  }
  throw new Error('window.chorus.routing never appeared (stale preload?)')
}

// ── 5. DOM helpers ──
/** Polls `expression` every 200 ms until it is truthy; false after `ms`. */
async function waitFor(expression, ms) {
  const deadline = Date.now() + ms
  for (;;) {
    const value = await evaluate(`(() => { try { return Boolean(${expression}) } catch { return false } })()`).catch(() => false)
    if (value) return true
    if (Date.now() >= deadline) return false
    await sleep(200)
  }
}
/** A one-line summary of what the page shows, for a missing element. */
async function domSummary() {
  const summary = await evaluate(
    `(() => ({ text: ((document.body && document.body.innerText) || '').replace(/\\s+/g, ' ').trim().slice(0, 240), nav: Array.from(document.querySelectorAll('[data-settings-nav]')).map((e) => e.getAttribute('data-settings-nav')), section: document.querySelectorAll('[data-routing-section]').length }))()`
  ).catch((err) => ({ error: err.message }))
  return `DOM ${JSON.stringify(summary)}`
}
async function mustWaitFor(expression, ms, what) {
  if (!(await waitFor(expression, ms))) throw new Error(`${what} did not appear within ${ms / 1000} s; ${await domSummary()}`)
}
const present = (selector) => `document.querySelector(${JSON.stringify(selector)}) !== null`
/** `element.click()`: a checkbox click toggles it and fires `input` and `change`. */
async function click(selector) {
  const done = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true })()`)
  if (!done) throw new Error(`nothing to click at ${selector}; ${await domSummary()}`)
}
/** Sets `.value` and dispatches bubbling `input` and `change` (team-member-ui-checks.mjs:7-10). */
async function choose(selector, value) {
  const done = await evaluate(
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true })()`
  )
  if (!done) throw new Error(`nothing to choose at ${selector}; ${await domSummary()}`)
}
/** The app's own transient overlays (App.vue): the ~2.75 s startup splash and the ~2 s "Saved" mark that U6/U7 trigger. */
const OVERLAYS_GONE = `document.querySelector('[data-testid="startup-splash"], [data-testid="saved-flash"]') === null`
/**
 * Waits for the transient overlays to finish (a picture of the section, not of the splash), scrolls
 * the settings column (to the top, or `selector` to the top of the view) and writes OUT/<name>.
 */
async function shot(name, selector) {
  if (!(await waitFor(OVERLAYS_GONE, 10_000))) console.log(`# ${name}: an overlay was still showing after 10 s`)
  await evaluate(
    selector === undefined
      ? `(() => { const c = document.querySelector('.set-content'); if (c) c.scrollTop = 0; return true })()`
      : `(() => { document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: 'start' }); return true })()`
  )
  await evaluate('document.fonts.ready.then(() => true)')
  await sleep(400)
  const { data } = await cdp('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64'))
}

/** Runs in the page: one plain-JSON reading of the section's data attributes. */
function pageState() {
  const q = (selector) => document.querySelector(selector)
  const t = (el) => (el ? el.textContent : null)
  const all = (root, selector) => Array.from(root.querySelectorAll(selector))
  const select = (selector) => {
    const el = q(selector)
    if (!el) return null
    return {
      value: el.value,
      disabled: el.disabled,
      options: Array.from(el.options).map((o) => ({ value: o.value, text: o.text, selected: o.selected, disabled: o.disabled }))
    }
  }
  const box = (selector) => {
    const el = q(selector)
    return el ? { checked: el.checked, disabled: el.disabled } : null
  }
  const nav = q('[data-settings-nav="routing"]')
  const section = q('[data-routing-section]')
  const refresh = q('[data-routing-refresh]')
  const toggle = q('[data-routing-providers-toggle]')
  return {
    nav: nav ? { text: nav.textContent, on: nav.classList.contains('set-nav-item-on') } : null,
    loaded: section ? section.getAttribute('data-routing-loaded') : null,
    title: section ? t(section.querySelector('h1')) : null,
    previewNote: t(q('[data-routing-preview-note]')),
    error: t(q('[data-routing-error]')),
    model: select('[data-routing-model]'),
    profile: select('[data-routing-profile]'),
    credential: select('[data-routing-credential]'),
    effort: t(q('[data-routing-effort]')),
    noCredential: t(q('[data-routing-no-credential]')),
    refresh: refresh ? { text: refresh.textContent, disabled: refresh.disabled, title: refresh.getAttribute('title') } : null,
    cost: t(q('[data-routing-cost]')),
    age: t(q('[data-routing-age]')),
    stale: t(q('[data-routing-stale]')),
    progress: q('[data-routing-progress]') !== null,
    refreshError: t(q('[data-routing-refresh-error]')),
    tiersError: t(q('[data-routing-tiers-error]')),
    cards: all(document, '[data-routing-tier]').map((c) => {
      const style = getComputedStyle(c)
      return {
        tier: c.getAttribute('data-routing-tier'),
        state: c.getAttribute('data-routing-tier-state'),
        primary: t(c.querySelector('[data-routing-primary]')),
        fallbacks: t(c.querySelector('[data-routing-fallbacks]')),
        reason: t(c.querySelector('[data-routing-reason]')),
        nitroClass: c.classList.contains('routing-card-nitro'),
        label: t(c.querySelector('[data-routing-nitro-label]')),
        likely: t(c.querySelector('[data-routing-nitro-likely]')),
        warning: t(c.querySelector('[data-routing-nitro-warning]')),
        borderLeftWidth: style.borderLeftWidth,
        borderLeftColor: style.borderLeftColor
      }
    }),
    notes: all(document, '[data-routing-note]').map(t),
    toggle: toggle ? t(toggle) : null,
    rows: all(document, '[data-routing-provider-row]').map((r) => ({
      tag: r.getAttribute('data-tag'),
      eligible: r.getAttribute('data-eligible'),
      status: t(r.querySelector('[data-col="status"]'))
    })),
    observe: box('[data-routing-observe]'),
    observeCredential: select('[data-routing-observe-credential]'),
    observeState: t(q('[data-routing-observe-state]')),
    observeWarning: t(q('[data-routing-observe-warning]')),
    observeHint: t(q('[data-routing-observe-hint]')),
    dataCollection: box('[data-routing-data-collection]')
  }
}
const readState = () => evaluate(`(${pageState.toString()})()`)

// ── Assertion helpers (each returns null on success, else a detail string) ──
const show = (value) => JSON.stringify(value)
const eq = (label, actual, expected) => (isDeepStrictEqual(actual, expected) ? null : `${label}: expected ${show(expected)}, got ${show(actual)}`)
const that = (label, condition, got) => (condition ? null : got === undefined ? label : `${label} (got ${show(got)})`)
const okValue = (label, reply, expected) => {
  if (!reply || reply.ok !== true) return `${label}: expected ok, got ${show(reply)}`
  if (expected !== undefined && !isDeepStrictEqual(reply.value, expected)) return `${label}: expected ${show(expected)}, got ${show(reply.value)}`
  return null
}
/** Every failing detail, not only the first. */
const every = (...details) => {
  const failed = details.flat().filter((d) => d !== null)
  return failed.length === 0 ? null : failed.join('; ')
}
async function check(name, fn) {
  try {
    record(name, await fn())
  } catch (err) {
    record(name, err instanceof Error ? err.message : String(err))
  }
}
const card = (state, tier) => state.cards.find((c) => c.tier === tier) ?? null

// ── Positive controls for U14: each watcher must catch a known error, or "no error" proves nothing ──
const PROBE_CONSOLE = '__routing_settings_console_probe__'
const PROBE_THROW = '__routing_settings_exception_probe__'
const PROBE_REJECT = '__routing_settings_rejection_probe__'
const hookControl = { console: false, exception: false, rejection: false }
async function installWatchers() {
  await evaluate(`(() => {
    window.__routingSettingsErrors = []
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason
      window.__routingSettingsErrors.push(String(reason && reason.message ? reason.message : reason))
    })
    console.error(${JSON.stringify(PROBE_CONSOLE)})
    setTimeout(() => { throw new Error(${JSON.stringify(PROBE_THROW)}) }, 0)
    Promise.reject(new Error(${JSON.stringify(PROBE_REJECT)}))
    return true
  })()`)
  for (let i = 0; i < 30; i++) {
    const rejections = await evaluate('window.__routingSettingsErrors.slice()')
    hookControl.console = rendererErrors.some((e) => e.includes(PROBE_CONSOLE))
    hookControl.exception = rendererErrors.some((e) => e.includes(PROBE_THROW))
    hookControl.rejection = rejections.some((e) => e.includes(PROBE_REJECT))
    if (hookControl.console && hookControl.exception && hookControl.rejection) break
    await sleep(100)
  }
  console.log(`# U14 controls: ${show(hookControl)}`)
}
async function clearErrors() {
  rendererErrors.length = 0
  await evaluate('(() => { window.__routingSettingsErrors.length = 0; return true })()')
}

// ── Shared between the checks and the after-exit checks ──
let fetchedAt = null
let bodyText = null
let pageRejections = null
let tiersReply = null

async function runChecks() {
  await installWatchers()

  // 6. Navigate: the rail's Settings button, then the Model routing row.
  await mustWaitFor(present('button[aria-label="Open settings"]'), 30_000, 'the Open settings button')
  await clearErrors()
  await click('button[aria-label="Open settings"]')
  await mustWaitFor(present('[data-settings-nav="routing"]'), 15_000, 'the Model routing nav row')
  await click('[data-settings-nav="routing"]')
  await mustWaitFor(present('[data-routing-section][data-routing-loaded="true"]'), 15_000, 'the loaded routing section')
  await sleep(750) // the tiers request follows the load; NO_SNAPSHOT leaves the cards as they are

  // 7. The empty throwaway profile.
  await check('U1 nav and section', async () => {
    const s = await readState()
    return every(
      eq('nav row', s.nav, { text: 'Model routing', on: true }),
      eq('h1', s.title, 'Model routing'),
      eq('[data-routing-preview-note]', s.previewNote, PREVIEW_NOTE)
    )
  })

  await check('U2 inspector inputs', async () => {
    const s = await readState()
    const details = [
      eq('[data-routing-model]', s.model, {
        value: SLUG,
        disabled: false,
        options: [{ value: SLUG, text: DISPLAY_NAME, selected: true, disabled: false }]
      }),
      eq('[data-routing-profile] options', s.profile?.options.map((o) => [o.value, o.text]), [['interactive', 'Interactive'], ['helper', 'Team helper']]),
      eq('[data-routing-profile] value', s.profile?.value, 'interactive'),
      eq('[data-routing-effort]', s.effort, EFFORT_CAPTION)
    ]
    // The profile select goes through its store action (a tiers request) and back, with no error.
    await choose('[data-routing-profile]', 'helper')
    await sleep(600)
    const helper = await readState()
    await choose('[data-routing-profile]', 'interactive')
    await sleep(600)
    const back = await readState()
    details.push(
      eq('profile after choosing helper', helper.profile?.value, 'helper'),
      eq('[data-routing-tiers-error] after choosing helper', helper.tiersError, null),
      eq('profile after choosing interactive', back.profile?.value, 'interactive'),
      eq('[data-routing-tiers-error] after choosing interactive', back.tiersError, null)
    )
    return every(details)
  })

  await check('U3 no credential', async () => {
    const s = await readState()
    return every(
      eq('[data-routing-credential] disabled', s.credential?.disabled, true),
      eq('[data-routing-credential] enabled options', s.credential?.options.filter((o) => !o.disabled), []),
      eq('[data-routing-credential] options', s.credential?.options.map((o) => o.text), [NO_CREDENTIAL_OPTION]),
      eq('[data-routing-no-credential]', s.noCredential, NO_CREDENTIAL_HINT),
      eq('[data-routing-refresh]', s.refresh, { text: 'Refresh', disabled: true, title: REFRESH_TITLE_NEEDS_CREDENTIAL }),
      eq('[data-routing-cost]', s.cost, COST)
    )
  })

  await check('U4 no snapshot', async () => {
    const s = await readState()
    const details = [eq('cards', s.cards.map((c) => c.tier), ['budget', 'balanced', 'fast', 'nitro'])]
    for (const tier of RANKED) {
      const c = card(s, tier)
      details.push(eq(`${tier} card`, c && [c.state, c.reason], ['no-snapshot', NO_SNAPSHOT_REASON]))
    }
    details.push(
      eq('nitro state', card(s, 'nitro')?.state, 'no-snapshot'),
      eq('[data-routing-providers-toggle]', s.toggle, null),
      eq('[data-routing-age]', s.age, null),
      eq('[data-routing-tiers-error]', s.tiersError, null)
    )
    await shot('empty-state.png')
    return every(details)
  })

  await check('U5 observation default', async () => {
    const s = await readState()
    return every(
      eq('[data-routing-observe] checked', s.observe?.checked, true),
      eq('[data-routing-observe-state]', s.observeState, OBSERVE_UNDESIGNATED),
      eq('[data-routing-observe-hint]', s.observeHint, NO_CREDENTIAL_HINT)
    )
  })

  const observeSettled = (checked) =>
    `(() => { const el = document.querySelector('[data-routing-observe]'); return el !== null && el.checked === ${checked} && !el.disabled })()`
  await check('U6 observation off and on', async () => {
    await click('[data-routing-observe]')
    const offSettled = await waitFor(observeSettled(false), 10_000)
    await waitFor(`document.querySelector('[data-routing-observe-state]')?.textContent === ${JSON.stringify(OBSERVE_OFF)}`, 3_000)
    const off = await page('return await routing.observationGet({})')
    const offState = await readState()
    await click('[data-routing-observe]')
    const onSettled = await waitFor(observeSettled(true), 10_000)
    await waitFor(`document.querySelector('[data-routing-observe-state]')?.textContent === ${JSON.stringify(OBSERVE_UNDESIGNATED)}`, 3_000)
    const on = await page('return await routing.observationGet({})')
    const onState = await readState()
    return every(
      that('the box settled unchecked and enabled', offSettled),
      okValue('stored after off', off, { enabled: false, credentialProfileId: null }),
      eq('[data-routing-observe-state] off', offState.observeState, OBSERVE_OFF),
      that('the box settled checked and enabled', onSettled),
      okValue('stored after on', on, { enabled: true, credentialProfileId: null }),
      eq('[data-routing-observe] on', onState.observe?.checked, true),
      eq('[data-routing-observe-state] on', onState.observeState, OBSERVE_UNDESIGNATED),
      eq('[data-routing-error]', onState.error, null)
    )
  })

  const dataCollectionSettled = (checked) =>
    `(() => { const el = document.querySelector('[data-routing-data-collection]'); return el !== null && el.checked === ${checked} && !el.disabled })()`
  await check('U7 data collection round trip', async () => {
    const before = await readState()
    await click('[data-routing-data-collection]')
    const allowSettled = await waitFor(dataCollectionSettled(true), 10_000)
    const allow = await page('return await routing.settingsGet({})')
    const allowState = await readState()
    await click('[data-routing-data-collection]')
    const denySettled = await waitFor(dataCollectionSettled(false), 10_000)
    const deny = await page('return await routing.settingsGet({})')
    const denyState = await readState()
    return every(
      eq('[data-routing-data-collection] at first', before.dataCollection, { checked: false, disabled: false }),
      that('the box settled checked and enabled', allowSettled),
      okValue('stored after on', allow, { ...DEFAULTS, dataCollection: 'allow' }),
      eq('[data-routing-data-collection] on', allowState.dataCollection?.checked, true),
      that('the box settled unchecked and enabled', denySettled),
      okValue('stored after off', deny, DEFAULTS),
      eq('[data-routing-data-collection] off', denyState.dataCollection?.checked, false),
      eq('[data-routing-error]', denyState.error, null)
    )
  })

  // 8. Seed: the golden fixture's endpoints, re-dated to five minutes ago in whole seconds (never in
  // the future, or routing:tiers answers INVALID_TIME). No cache or account file: no credential.
  fetchedAt = new Date(Math.floor(Date.now() / 1000) * 1000 - 300_000).toISOString()
  const endpoints = seed.parseEndpointsResponse(JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))).endpoints
  const modelDir = path.join(profile, 'routing', seed.modelDirName(SLUG))
  fs.mkdirSync(modelDir, { recursive: true })
  const writeAtomic = (file, text) => {
    const temp = `${file}.seed-${process.pid}.tmp`
    fs.writeFileSync(temp, text)
    fs.renameSync(temp, file)
  }
  writeAtomic(path.join(modelDir, 'snapshot.json'), seed.snapshotFileText(SLUG, { fetchedAt, endpoints }))
  writeAtomic(path.join(modelDir, 'observations.json'), seed.observationsFileText(SLUG, seed.extractObservations({ fetchedAt, endpoints })))
  console.log(`# seeded ${endpoints.length} endpoint rows, fetchedAt ${fetchedAt}`)

  // 9. Re-enter: the v-if chain remounts the section, which reloads it (C17).
  await click('[data-settings-nav="voice"]')
  await mustWaitFor(`document.querySelector('[data-routing-section]') === null`, 10_000, 'the routing section unmounting')
  await click('[data-settings-nav="routing"]')
  await mustWaitFor(present('[data-routing-section][data-routing-loaded="true"]'), 15_000, 'the reloaded routing section')
  await mustWaitFor(present('[data-routing-tier="budget"][data-routing-tier-state="ranked"]'), 15_000, 'the ranked Budget card')
  await sleep(300)

  // 10. The seeded snapshot.
  await check('U8 seeded tiers match main', async () => {
    tiersReply = await page(`return await routing.tiers({ model: '${SLUG}', profile: 'interactive', effort: 'low', credentialProfileId: null })`)
    const s = await readState()
    const details = [okValue('routing:tiers', tiersReply)]
    if (tiersReply?.ok === true) {
      const order = []
      for (const tier of RANKED) {
        const c = card(s, tier)
        const selection = tiersReply.value.tiers[tier]
        if (selection === null) {
          details.push(`main ranked nothing for ${tier}`)
          continue
        }
        const [primary, ...rest] = selection.endpoints
        order.push(`${tier} ${selection.endpoints.join(' > ')}`)
        details.push(
          eq(`${tier} state`, c?.state, 'ranked'),
          eq(`${tier} [data-routing-primary]`, c?.primary, primary),
          eq(`${tier} [data-routing-fallbacks]`, c?.fallbacks, rest.length === 0 ? 'No fallback available.' : `Fallbacks: ${rest.join(', ')}`)
        )
      }
      console.log(`# U8 main's order at ${tiersReply.value.computedAt}: ${order.join('; ')}`)
    }
    return every(details)
  })

  await check('U9 Nitro card', async () => {
    const nitro = card(await readState(), 'nitro')
    return every(
      that('a Nitro card', nitro !== null),
      eq('[data-routing-nitro-label]', nitro?.label, NITRO_LABEL),
      eq('class routing-card-nitro', nitro?.nitroClass, true),
      eq('border-left-width', nitro?.borderLeftWidth, '2px'),
      eq('border-left-color', nitro?.borderLeftColor, AMBER),
      eq('[data-routing-nitro-likely]', nitro?.likely, NITRO_LIKELY),
      eq('[data-routing-nitro-warning]', nitro?.warning, NITRO_WARNING)
    )
  })

  await check('U10 age and notes', async () => {
    const s = await readState()
    const details = [
      that('[data-routing-age] reads Updated 5-9 min ago', typeof s.age === 'string' && /^Updated [5-9] min ago$/.test(s.age), s.age),
      eq('[data-routing-stale]', s.stale, null),
      eq('[data-routing-note]', s.notes, NOTES),
      eq('[data-routing-note] against the U8 reply warnings', s.notes, tiersReply?.ok === true ? tiersReply.value.warnings : null)
    ]
    await shot('seeded-cards.png', '[data-routing-refresh]') // the age line, the cards and the notes
    return every(details)
  })

  await check('U11 providers table', async () => {
    const before = await readState()
    await click('[data-routing-providers-toggle]')
    await waitFor(`document.querySelectorAll('[data-routing-provider-row]').length > 0`, 5_000)
    await sleep(200)
    const s = await readState()
    const details = [
      eq('toggle', before.toggle, SHOW_ALL),
      eq('rows before the toggle', before.rows.length, 0),
      eq('rows', s.rows.length, 32),
      eq('data-eligible', s.rows.map((r) => r.eligible), [...Array(14).fill('true'), ...Array(18).fill('false')]),
      eq('alibaba status', s.rows.find((r) => r.tag === 'alibaba')?.status, ALIBABA_STATUS)
    ]
    await shot('seeded-providers.png', '[data-routing-providers-toggle]')
    return every(details)
  })

  await check('U12 stored data, no request', async () => {
    const status = await page('return await routing.status({})')
    const model = status?.value?.models?.find((m) => m.model === SLUG)
    return every(
      okValue('routing:status', status),
      eq('requestsSinceStart', status?.value?.requestsSinceStart, 0),
      eq('snapshotFetchedAt', model?.snapshotFetchedAt, fetchedAt),
      eq('observations', model?.observations, 32)
    )
  })

  await check('U13 refresh stays unavailable', async () => {
    const s = await readState()
    bodyText = await evaluate('document.body.innerText')
    return every(eq('[data-routing-refresh] disabled', s.refresh?.disabled, true), eq('[data-routing-progress]', s.progress, false))
  })

  // Read before shutdown: the page's own unhandled rejections since step 6.
  pageRejections = await evaluate('Array.isArray(window.__routingSettingsErrors) ? window.__routingSettingsErrors.slice() : null')
}

/** U15: the canonical key shapes (the scrubber's and the secret-grep gate's one list). */
function keyMaterialDetail() {
  const { patterns } = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'main', 'services', 'secret-patterns.json'), 'utf8'))
  const compiled = patterns.map((p) => ({ name: p.name, re: new RegExp(p.source) }))
  // Positive control, assembled by concatenation: the patterns must be able to match at all.
  const control = 'sk-or-v1-' + '0123456789abcdef'.repeat(2)
  if (!compiled.some(({ re }) => re.test(control))) return 'the secret patterns match nothing (control failed)'
  if (typeof bodyText !== 'string' || bodyText.length === 0) return 'the page text was not read at U13'
  if (responseTexts.length < 6) return `only ${responseTexts.length} responses collected`
  for (const [label, text] of [['the page text', bodyText], ...responseTexts.map((t, i) => [`response ${i + 1}`, t])]) {
    const hit = compiled.find(({ re }) => re.test(text))
    if (hit) return `${label} matches the ${hit.name} pattern`
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

// ── 11. Shutdown: Browser.close is fire-and-forget (it never answers); then this child only ──
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

if (setupError === null) {
  record('U14 no renderer errors', every(
    that('the console.error control was caught', hookControl.console),
    that('the exception control was caught', hookControl.exception),
    that('the unhandled-rejection control was caught', hookControl.rejection),
    that('the page watcher survived the drive (no reload)', Array.isArray(pageRejections), pageRejections),
    that('no error mentions "could not be cloned"', ![...rendererErrors, ...(pageRejections ?? [])].some((e) => /could not be cloned/.test(e))),
    eq('renderer errors since navigation', rendererErrors, []),
    eq('unhandled rejections since navigation', pageRejections, [])
  ))
  record('U15 no key material', keyMaterialDetail())
}
for (const name of CHECKS) if (name !== 'cleanup' && !results.has(name)) record(name, setupError === null ? 'not run' : `not run (${setupError})`)

if ([...results.values()].includes(false) && fs.existsSync(logPath)) {
  // The app log holds no credential (the profile has none); its tail is the fastest diagnosis.
  const tail = fs.readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean).slice(-30)
  for (const line of tail) console.log(`# log| ${line.slice(0, 300)}`)
}

// ── cleanup: the profile, the seed bundle, and nothing in OUT but the three PNGs ──
closeLog()
await sleep(1_000) // let the app's helper processes release the profile
const cleanupError = await deleteProfile()
deleteSeedBundle()
for (const entry of fs.readdirSync(OUT)) {
  if (!PNGS.includes(entry)) fs.rmSync(path.join(OUT, entry), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
const left = fs.readdirSync(OUT).sort()
record('cleanup', every(
  cleanupError === null ? null : `the throwaway profile was not deleted: ${cleanupError}`,
  that('the seed bundle is gone', !fs.existsSync(SEED_BUNDLE)),
  eq(`${path.relative(ROOT, OUT)} holds`, left, [...PNGS].sort())
))

finish()

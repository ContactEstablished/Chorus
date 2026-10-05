// Model Routing Task 4b-4: zero-cost CDP drive of the built Team dialog (TU1-TU15).
// Only probe-only, short-lived Claude/OpenCode stubs are reachable. No Launch or Refresh click.
// Two app runs use an isolated profile/home and a fixture git repository. Cleanup owns only its PID.
import fs from 'node:fs'
import os from 'node:os'
import net from 'node:net'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { createHash, randomBytes, randomUUID } from 'node:crypto'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, '_verify', 'routing-team-ui')
const PNGS = ['team-tiers-fresh.png', 'team-tiers-stale.png']
const FIXTURE = path.join(ROOT, 'src/main/routing/__fixtures__/endpoints-deepseek-v4.1-flash-2026-10-02.json')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const SLUG = 'deepseek/deepseek-v4.1-flash', NITRO_ID = SLUG + ':nitro', GLM = 'z-ai/glm-5.3'
const GATEWAY = 'https://openrouter.ai/api/v1'
const KEY = 'sk-or-v1-' + randomBytes(32).toString('hex')
const PROVIDER = { name: 'OpenRouter (team drive)', adapter_type: 'opencode', auth_mode: 'api_key', base_url: GATEWAY, model: SLUG }
const CREDENTIAL_LABEL = 'Routing team drive key'
const PROJECT_NAME = 'routing-team-ui-repo'
const CLAUDE_STUB_VERSION = '2.1.278 (Claude Code)'
const OPENCODE_STUB_VERSION = '1.18.34'
const PRESET_LABEL = 'Routing team drive preset', PRE4B_LABEL = 'Pre-4b preset'
// Strings copied by hand from ImplementationSpecs 4b-1 to 4b-3.
const TIER_VALUES = ['budget', 'balanced', 'fast', 'nitro', 'default']
const TIER_TEXTS = ['Budget', 'Balanced', 'Fast', 'Nitro — unfiltered provider routing', 'OpenRouter default']
const DEFAULT_DESC = 'Chorus sends no routing: OpenRouter picks the provider for each request, as before. The data-collection setting is not sent.'
const STALE_REASON = 'Refresh first: the numbers are older than 60 min.'
const BALANCED_HINT = 'Refresh to use Balanced.'
const CAPTION_LOW = 'Ranked for a Team helper at reasoning effort "low". Each attempt checks its tier again on the latest numbers.'
const tierLabel = (n) => `Routing tier for helper ${n}`
const GLM_REFUSAL = 'Helper "GLM helper": Model routing does not know this helper\'s model.'
const LAUNCH_REFUSAL_CODE = 'ROUTING_REFUSED'
const INVALID = { ok: false, code: 'INVALID_REQUEST', message: 'Team operation failed. Refresh the current state and retry.' }
const CHECKS = [
  'TU1 setup, isolation and stubs', 'TU2 bootstrap, project and capabilities', 'TU3 dropdowns only on routable slots',
  'TU4 K10 defaults', 'TU5 fresh numbers enable ranked tiers', 'TU6 Balanced through the select',
  'TU7 preset carries tier names only', 'TU8 presets restore tiers', 'TU9 stale numbers fall back with a hint',
  'TU10 main refuses a tier on GLM-5.3', 'TU11 main rejects routing objects and Claude tiers',
  'TU12 nothing launched', 'TU13 no request or renderer error', 'TU14 no key material', 'TU15 cleanup and MR-G3'
]
const SECRET_PATTERNS = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/main/services/secret-patterns.json'), 'utf8')).patterns.map(
  (p) => ({ name: p.name, re: new RegExp(p.source) })
)
function redact(text) {
  let out = String(text).split(KEY).join('[redacted]')
  for (const { re } of SECRET_PATTERNS) out = out.replace(new RegExp(re.source, 'g'), '[redacted]')
  return out
}
const results = new Map()
const record = (name, detail) => {
  if (results.has(name)) return
  const ok = detail === null
  results.set(name, ok)
  console.log(ok ? `ok ${name}` : `FAIL ${name}: ${redact(detail).slice(0, 1500)}`)
}
let interrupted = false
function finish() {
  if (interrupted) return
  const failed = CHECKS.filter((name) => results.get(name) !== true).length
  console.log(failed === 0 ? 'PASS (15 checks)' : `FAIL (${failed} of 15 checks)`)
  process.exitCode = failed === 0 ? 0 : 1
}
const MAIN_BUNDLE = path.join(ROOT, 'out/main/index.js')
const PRELOAD_BUNDLE = path.join(ROOT, 'out/preload/index.js')
const RENDERER_HTML = path.join(ROOT, 'out/renderer/index.html')
const RENDERER_ASSETS = path.join(ROOT, 'out/renderer/assets')
function newestOf(files) {
  return files.reduce((best, file) => {
    const mtime = fs.statSync(file).mtimeMs
    return mtime > best.mtime ? { file, mtime } : best
  }, { file: '', mtime: 0 })
}
function staleReason() {
  if (!fs.existsSync(MAIN_BUNDLE) || !fs.existsSync(PRELOAD_BUNDLE)) return 'main or preload bundle is missing'
  const src = (...parts) => path.join(ROOT, 'src', ...parts)
  const filesIn = (dir, pattern) => fs.readdirSync(dir).filter((name) => pattern.test(name)).map((name) => path.join(dir, name))
  const mainSources = [
    ...filesIn(src('main/services'), /^(team|routing).*\.ts$/), ...filesIn(src('main/routing'), /\.ts$/),
    ...filesIn(src('main/adapters/helpers'), /\.ts$/), src('main/routing/model-registry.json'),
    src('shared/team.ts'), src('shared/teamProfiles.ts'), src('shared/routing.ts'),
    src('main/ipc.ts'), src('main/index.ts'), src('preload/index.ts')
  ]
  const newestMain = newestOf(mainSources)
  if (fs.statSync(MAIN_BUNDLE).mtimeMs < newestMain.mtime) return `main bundle is older than ${path.relative(ROOT, newestMain.file)}`
  const mainText = fs.readFileSync(MAIN_BUNDLE, 'utf8')
  for (const needle of ['helper-routing-resolved', "Model routing does not know this helper's model."]) {
    if (!mainText.includes(needle)) return `main bundle has no ${needle}`
  }
  if (!fs.existsSync(RENDERER_HTML)) return 'renderer HTML is missing'
  const assets = fs.existsSync(RENDERER_ASSETS) ? filesIn(RENDERER_ASSETS, /\.js$/) : []
  if (assets.length === 0) return 'renderer assets are missing'
  const rendererSources = [
    src('renderer/src/components/TeamLaunchDialog.vue'), src('renderer/src/components/LaunchDialog.vue'),
    ...filesIn(src('renderer/src/components/routing'), /\.vue$/), src('renderer/src/stores/routingTeam.ts'),
    src('renderer/src/stores/team.ts'), src('shared/routingView.ts'), src('shared/routing.ts'),
    src('shared/team.ts'), src('shared/teamProfiles.ts')
  ]
  const newestRenderer = newestOf(rendererSources)
  if (newestOf(assets).mtime < newestRenderer.mtime) return `renderer bundle is older than ${path.relative(ROOT, newestRenderer.file)}`
  const texts = assets.map((file) => fs.readFileSync(file, 'utf8'))
  for (const needle of ['Ranked for a Team helper at reasoning effort', 'Routing tier for helper ']) {
    if (!texts.some((text) => text.includes(needle))) return `renderer assets have no ${needle}`
  }
  return null
}

let TMP = null, USER_DATA, HOME_DIR, XDG_STATE, XDG_DATA, STUB_DIR, CAPTURES, REPO, DB_PATH, MODEL_DIR, seed, ENDPOINTS
let run = null
const logPaths = []
const STUB_SCRIPTS = []
const SEED_BUNDLE = path.join(OUT, `seed-${process.pid}.cjs`)
const appEnv = { ...process.env }
const samePath = (a, b) => typeof a === 'string' && typeof b === 'string' && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
const envKeysOf = (env, name) => Object.keys(env).filter((k) => k.toUpperCase() === name)
function setEnv(env, name, value) {
  for (const key of envKeysOf(env, name)) delete env[key]
  env[name] = value
}
const envGet = (env, name) => env[envKeysOf(env, name)[0]]
function deleteSeedBundle() {
  try { fs.rmSync(SEED_BUNDLE, { force: true }) } catch { /* retried during cleanup */ }
}
async function deleteTmp() {
  if (TMP === null) return null
  let error = null
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      fs.rmSync(TMP, { recursive: true, force: true })
      return fs.existsSync(TMP) ? 'still present' : null
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      await sleep(1000)
    }
  }
  return error
}
process.on('exit', deleteSeedBundle)
process.on('SIGINT', () => void onInterrupt('SIGINT'))
process.on('SIGBREAK', () => void onInterrupt('SIGBREAK'))

const REAL_STATE_PATHS = [path.join(os.homedir(), '.local/state/opencode/model.json')]
const realXdgState = envGet(process.env, 'XDG_STATE_HOME')
if (realXdgState) REAL_STATE_PATHS.push(path.join(realXdgState, 'opencode/model.json'))
const readBytesOrAbsent = (file) => fs.existsSync(file) ? fs.readFileSync(file) : 'absent'
let REAL_STATE_BASELINE, WORKTREES_BASELINE, STATUS_BASELINE, STATUS_HASHES_BASELINE
const GIT_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0' }
const git = (...args) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', windowsHide: true, env: GIT_ENV, timeout: 60_000 })
const fixtureGit = (...args) => execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8', windowsHide: true, env: appEnv, timeout: 60_000 })
const gitStatus = () => git('status', '--porcelain=v1', '-z', '--untracked-files=all')
function statusPaths(text) {
  const tokens = text.split('\0')
  const paths = []
  for (let i = 0; i < tokens.length; i++) {
    const entry = tokens[i]
    if (entry.length < 4) continue
    paths.push(entry.slice(3))
    if (/[RC]/.test(entry.slice(0, 2)) && i + 1 < tokens.length) paths.push(tokens[++i])
  }
  return paths
}
/** SHA-256 of a repository path's content ('absent', or 'directory' for a nested repository listed as one entry). */
function contentHash(relative) {
  const file = path.join(ROOT, relative)
  try {
    const stat = fs.statSync(file)
    if (stat.isDirectory()) return 'directory'
    return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  } catch {
    return 'absent'
  }
}
const hashesOf = (paths) => Object.fromEntries([...new Set(paths)].sort().map((p) => [p, contentHash(p)]))
function listCaptures() {
  return CAPTURES && fs.existsSync(CAPTURES) ? fs.readdirSync(CAPTURES).filter((name) => /^(claude|opencode)-\d+-\d+-[0-9a-f]{8}\.json$/.test(name)).sort() : []
}
const readCapture = (name) => JSON.parse(fs.readFileSync(path.join(CAPTURES, name), 'utf8'))
function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err?.code !== 'ESRCH'
  }
}
/**
 * What `pid` is now: 'gone', 'stub' (its command line names THIS run's stub script), 'other' (a
 * reused pid: counts as gone) or 'unknown' (the query failed: treated as still running). Win32_Process
 * is queried BY ProcessId — a CommandLine-substring filter would match the querying process itself.
 */
function stubProcessState(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return 'gone'
  if (!isAlive(pid)) return 'gone'
  let commandLine = ''
  try {
    commandLine = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`],
      { encoding: 'utf8', windowsHide: true, timeout: 60_000 }
    ).trim()
  } catch {
    return 'unknown'
  }
  if (commandLine.length === 0) return isAlive(pid) ? 'unknown' : 'gone'
  const norm = (s) => s.toLowerCase().replace(/\//g, '\\')
  return STUB_SCRIPTS.some((script) => norm(commandLine).includes(norm(script))) ? 'stub' : 'other'
}
/** Still this run's stub (a pid whose command line no longer names the stub counts as gone). */
const stubRunning = (pid) => {
  const state = stubProcessState(pid)
  return state === 'stub' || state === 'unknown'
}
/**
 * C44: the direct stub kill (TU12's last resort, the cleanup sweep, the sweep when run 2 never ran,
 * Ctrl+C): pid-targeted, and only when Win32_Process confirms the stub's command line, so a reused
 * pid is never touched. Returns what happened.
 */
function lastResortKill(pid) {
  const state = stubProcessState(pid)
  if (state === 'gone') return 'already gone'
  if (state === 'other') return 'pid reused by another process; left alone (counts as gone)'
  if (state === 'unknown') return 'the Win32_Process query failed; left alone'
  try {
    execFileSync('taskkill', ['/pid', String(pid), '/F'], { stdio: 'ignore', windowsHide: true })
    return 'killed by taskkill'
  } catch {
    return 'taskkill failed'
  }
}
function stubLastResort() {
  const outcomes = []
  for (const name of listCaptures()) {
    let pid = null
    try {
      pid = readCapture(name).pid
    } catch {
      continue
    }
    if (isAlive(pid)) outcomes.push(`${pid}: ${lastResortKill(pid)}`)
  }
  return outcomes
}
function assertNotInterrupted() {
  if (interrupted) throw new Error('interrupted')
}
async function freePort() {
  for (;;) {
    const server = net.createServer()
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const port = server.address().port
    await new Promise((resolve) => server.close(resolve))
    if (port !== 9222) return port
  }
}
async function startRun(name) {
  assertNotInterrupted()
  const port = await freePort()
  assertNotInterrupted()
  const logPath = path.join(TMP, `app-${name}.log`)
  logPaths.push(logPath)
  const logFd = fs.openSync(logPath, 'w')
  const child = spawn(
    require('electron'),
    ['.', `--user-data-dir=${USER_DATA}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'],
    { cwd: ROOT, env: appEnv, windowsHide: true, stdio: ['ignore', logFd, logFd] }
  )
  const r = { name, child, port, logFd, logClosed: false, childExit: null, exited: null, spawnError: null }
  // The child's exit is tracked ONLY from 'exit': an 'error' (a failed spawn or a failed child.kill())
  // must never look like an exit, or stopRun would skip its taskkill escalation.
  r.exited = new Promise((resolve) => {
    child.on('exit', (code, signal) => {
      r.childExit = { code, signal }
      resolve()
    })
  })
  child.on('error', (err) => {
    r.spawnError = err.message
  })
  run = r
  console.log(`# ${name}: launched pid=${child.pid} port=${port}`)
  return r
}
/** Resolves when `r` exits or after `ms`, whichever is first; the timer is cleared either way. */
async function waitExit(r, ms) {
  let timer = null
  await Promise.race([r.exited, new Promise((resolve) => { timer = setTimeout(resolve, ms) })])
  clearTimeout(timer)
}
/** The last resort, by this child's own PID and only while it is still running (never by name; no /T). */
function killOwnChild(r = run) {
  if (r === null || r.childExit !== null || r.child.pid === undefined) return
  try {
    execFileSync('taskkill', ['/pid', String(r.child.pid), '/F'], { stdio: 'ignore', windowsHide: true })
  } catch {
    // Already gone.
  }
}
function closeLog(r) {
  if (r === null || r.logClosed) return
  r.logClosed = true
  try {
    fs.closeSync(r.logFd)
  } catch {
    // Already closed.
  }
}

/**
 * Ctrl+C / Ctrl+Break (registered right after mkdtemp): stop our own child, the stubs we caused
 * (C44), delete the root and the bundle, exit 1. Every step is guarded, so one failure cannot skip
 * the deletion or the exit.
 */
async function onInterrupt(signal) {
  if (interrupted) return
  interrupted = true
  try {
    console.log(`# ${signal}: stopping the app and deleting ${TMP}`)
    killOwnChild()
    if (run !== null) await waitExit(run, 5_000)
    closeLog(run)
    for (const line of stubLastResort()) console.log(`# stub ${line}`)
  } catch (err) {
    console.log(`# interrupt cleanup: ${err instanceof Error ? err.message : String(err)}`)
  }
  try {
    deleteSeedBundle()
    const error = await deleteTmp()
    if (error !== null) console.log(`# the throwaway root was not deleted: ${error}`)
  } finally {
    process.exit(1)
  }
}
process.on('exit', () => killOwnChild())

// ── CDP ──
let socket = null
let sequence = 0
const pending = new Map()
/** Runtime.exceptionThrown and console.error events from the page (TU13). */
const rendererErrors = []
function onEvent(method, params) {
  if (method === 'Runtime.exceptionThrown') {
    const details = params?.exceptionDetails
    rendererErrors.push(`exception: ${details?.exception?.description ?? details?.text ?? 'unknown'}`)
  } else if (method === 'Runtime.consoleAPICalled' && params?.type === 'error') {
    rendererErrors.push(`console.error: ${(params.args ?? []).map((a) => a.value ?? a.description ?? a.type).join(' ')}`)
  }
}
/** S5: a dead socket rejects at once, rather than after a 30 s timeout per call. */
function cdp(method, params = {}) {
  if (socket === null || socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error(`CDP socket is not open (${method})`))
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
/** `fn` (a self-contained function) called in the page with JSON arguments, as an expression string. */
const expr = (fn, ...args) => `(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(', ')})`
const call = (fn, ...args) => evaluate(expr(fn, ...args))
/** Every value the page's chorus/routing calls hand back, for TU14. */
const responseTexts = []
/** Runs `body` inside an async IIFE in the page, with `chorus` and `routing` bound. Payloads are object literals written here. */
async function page(body) {
  const value = await evaluate(`(async () => { const chorus = window.chorus; const routing = window.chorus.routing; const team = window.chorus.team; ${body} })()`)
  responseTexts.push(JSON.stringify(value) ?? 'undefined')
  return value
}
const J = (value) => JSON.stringify(value)
/** Rejects and clears every outstanding CDP call (a closed socket, or the end of a run). */
function clearPending(reason) {
  for (const item of pending.values()) {
    clearTimeout(item.timer)
    item.reject(new Error(reason))
  }
  pending.clear()
}
/** The CDP target is THIS checkout's built renderer (out/renderer/index.html as a file URL), nothing else. */
function isOwnRenderer(target) {
  if (target?.type !== 'page' || typeof target.url !== 'string') return false
  try {
    const url = new URL(target.url)
    if (url.protocol !== 'file:') return false
    url.hash = ''
    url.search = ''
    return samePath(fileURLToPath(url), RENDERER_HTML)
  } catch {
    return false
  }
}

async function connect() {
  socket = null
  clearPending('CDP reconnect')
  let target = null
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline && run.childExit === null) {
    assertNotInterrupted()
    try {
      const list = await (await fetch(`http://127.0.0.1:${run.port}/json/list`, { signal: AbortSignal.timeout(5_000) })).json()
      target = list.find(isOwnRenderer) ?? null
      if (target) break
    } catch {
      // Not listening yet.
    }
    await sleep(500)
  }
  if (!target) {
    throw new Error(
      run.childExit !== null
        ? `the app exited early (${JSON.stringify(run.childExit)})`
        : `no ${path.relative(ROOT, RENDERER_HTML)} page within 60 s${run.spawnError ? ` (spawn error: ${run.spawnError})` : ''}`
    )
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  socket = ws
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', () => reject(new Error('CDP socket error')), { once: true })
  })
  ws.addEventListener('message', (event) => {
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
  ws.addEventListener('close', () => clearPending('CDP socket closed'))
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

/** Shutdown: Browser.close is fire-and-forget (it never answers); then child.kill() on its own handle; then taskkill by its own pid. */
async function stopRun(r) {
  if (r === null) return
  try {
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id: ++sequence, method: 'Browser.close' }))
  } catch {
    // The app may already be closing.
  }
  await waitExit(r, 5_000)
  if (r.childExit === null) {
    console.log(`# ${r.name}: the app did not exit within 5 s of Browser.close; child.kill()`)
    r.child.kill()
    await waitExit(r, 5_000)
  }
  if (r.childExit === null) {
    console.log(`# ${r.name}: still running; taskkill /pid ${r.child.pid} /F`)
    killOwnChild(r)
    await waitExit(r, 5_000)
  }
  console.log(`# ${r.name}: app exited ${JSON.stringify(r.childExit)}`)
  try {
    socket?.close()
  } catch {
    // Already closed.
  }
  socket = null
  clearPending('the run ended') // no CDP timer outlives its run, so the process can exit promptly
  closeLog(r)
}
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
    `(() => ({ text: ((document.body && document.body.innerText) || '').replace(/\\s+/g, ' ').trim().slice(0, 300), dialog: document.querySelector('.overlay-panel.launch') !== null, routing: document.querySelector('[data-routing-launch]') !== null, error: (document.querySelector('.launch .overlay-error') || {}).textContent || null }))()`
  ).catch((err) => ({ error: err.message }))
  return `DOM ${JSON.stringify(summary)}`
}
async function mustWaitFor(expression, ms, what) {
  if (!(await waitFor(expression, ms))) throw new Error(`${what} did not appear within ${ms / 1000} s; ${await domSummary()}`)
}
const present = (selector) => `document.querySelector(${JSON.stringify(selector)}) !== null`
const absent = (selector) => `document.querySelector(${JSON.stringify(selector)}) === null`
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
  const failed = details.flat().filter((d) => d !== null && d !== undefined)
  return failed.length === 0 ? null : failed.join('; ')
}
async function check(name, fn) {
  if (interrupted) return // S6: the interrupt handler is stopping everything
  try {
    record(name, await fn())
  } catch (err) {
    record(name, err instanceof Error ? err.message : String(err))
  }
}

async function setup() {
  const stale = staleReason()
  if (stale !== null) throw new Error(`build is stale: run npx electron-vite build (${stale})`)
  fs.rmSync(OUT, { recursive: true, force: true })
  fs.mkdirSync(OUT, { recursive: true })
  await require('esbuild').build({
    stdin: {
      contents: "export { parseEndpointsResponse, extractObservations } from './src/main/routing/endpointsCore'\nexport { modelDirName, snapshotFileText, observationsFileText } from './src/main/routing/storeCore'",
      resolveDir: ROOT, loader: 'ts', sourcefile: 'routing-team-ui-seed.ts'
    },
    outfile: SEED_BUNDLE, bundle: true, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'warning'
  })
  seed = require(SEED_BUNDLE)
  deleteSeedBundle()
  ENDPOINTS = seed.parseEndpointsResponse(JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))).endpoints
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'chorus-routing-team-ui-'))
  USER_DATA = path.join(TMP, 'profile'); HOME_DIR = path.join(TMP, 'home')
  XDG_STATE = path.join(TMP, 'xdg-state'); XDG_DATA = path.join(TMP, 'xdg-data')
  STUB_DIR = path.join(TMP, 'stub'); CAPTURES = path.join(STUB_DIR, 'captures'); REPO = path.resolve(TMP, 'repo')
  DB_PATH = path.join(USER_DATA, 'chorus.db'); MODEL_DIR = path.join(USER_DATA, 'routing', seed.modelDirName(SLUG))
  for (const dir of [USER_DATA, HOME_DIR, path.join(HOME_DIR, 'AppData/Roaming'), path.join(HOME_DIR, 'AppData/Local'), XDG_STATE, XDG_DATA, STUB_DIR, CAPTURES, REPO]) fs.mkdirSync(dir, { recursive: true })
  console.log(`# throwaway root ${TMP}`)
  for (const name of ['claude', 'opencode']) {
    const script = path.join(STUB_DIR, `${name}-stub.cjs`)
    STUB_SCRIPTS.push(script)
    fs.writeFileSync(path.join(STUB_DIR, `${name}.cmd`), `@ECHO off\r\nnode "%~dp0\\${name}-stub.cjs" %*\r\n`)
    const version = name === 'claude' ? CLAUDE_STUB_VERSION : OPENCODE_STUB_VERSION
    fs.writeFileSync(script, [
      "'use strict'", "const fs = require('node:fs')", "const path = require('node:path')", "const { randomBytes } = require('node:crypto')",
      `const name = ${JSON.stringify(name)}`, 'const argv = process.argv.slice(2)',
      "const file = path.join(__dirname, 'captures', name + '-' + process.pid + '-' + Date.now() + '-' + randomBytes(4).toString('hex') + '.json')",
      "fs.writeFileSync(file + '.tmp', JSON.stringify({ name, pid: process.pid, argv, at: new Date().toISOString() }))",
      "fs.renameSync(file + '.tmp', file)",
      "if (argv.length === 1 && argv[0] === '--version') {",
      `  process.stdout.write(${JSON.stringify(version + '\n')})`,
      name === 'claude' ? "} else if (argv.length === 1 && argv[0] === '--help') {" : "} else if (argv.length === 2 && argv[0] === 'run' && argv[1] === '--help') {",
      name === 'claude' ? "  process.stdout.write('Usage: claude [options] [command] [prompt]\\n  --output-format <format>  (stub)\\n')" : "  process.stderr.write('opencode run [message..]\\n\\n  --format  (stub)\\n')",
      '} else { process.exitCode = 1 }', ''
    ].join('\n'))
  }
  const selfTest = (name, args) => execFileSync(process.execPath, [path.join(STUB_DIR, `${name}-stub.cjs`), ...args], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000 })
  const selfDetail = every(
    eq('Claude stub version', selfTest('claude', ['--version']), CLAUDE_STUB_VERSION + '\n'),
    eq('OpenCode stub version', selfTest('opencode', ['--version']), OPENCODE_STUB_VERSION + '\n'),
    eq('OpenCode help stdout', selfTest('opencode', ['run', '--help']), '')
  )
  if (selfDetail !== null) throw new Error(selfDetail)
  for (const name of fs.readdirSync(CAPTURES)) fs.rmSync(path.join(CAPTURES, name))
  if (fs.readdirSync(CAPTURES).length !== 0) throw new Error('stub self-test captures were not cleared')
  for (const name of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME']) {
    for (const key of envKeysOf(appEnv, name)) delete appEnv[key]
  }
  setEnv(appEnv, 'USERPROFILE', HOME_DIR); setEnv(appEnv, 'HOME', HOME_DIR)
  setEnv(appEnv, 'HOMEDRIVE', HOME_DIR.slice(0, 2)); setEnv(appEnv, 'HOMEPATH', HOME_DIR.slice(2))
  setEnv(appEnv, 'XDG_STATE_HOME', XDG_STATE); setEnv(appEnv, 'XDG_DATA_HOME', XDG_DATA)
  const PATH_KEY = Object.keys(appEnv).find((k) => k.toUpperCase() === 'PATH')
  if (PATH_KEY === undefined) throw new Error('the app environment has no PATH')
  const AGENT_CLIS = ['claude', 'codex', 'kimi', 'opencode', 'grok']
  const SHIM_EXTS = ['', '.exe', '.cmd', '.bat', '.com', '.ps1']
  const holdsAgentCli = (dir) => AGENT_CLIS.some((name) => SHIM_EXTS.some((ext) => fs.existsSync(path.join(dir, name + ext))))
  const entries = appEnv[PATH_KEY].split(';').filter((d) => d.trim() !== '')
  const kept = entries.filter((d) => !holdsAgentCli(d))
  appEnv[PATH_KEY] = [STUB_DIR, ...kept].join(';')
  console.log(`# composed PATH: removed ${entries.length - kept.length} of ${entries.length} directories that hold an agent CLI`)
  if (!samePath(appEnv[PATH_KEY].split(';')[0], STUB_DIR)) throw new Error('stub directory is not first on PATH')
  for (const name of [...AGENT_CLIS, 'node', 'git']) {
    let candidates = [], found = true
    try {
      candidates = execFileSync('where.exe', [name], { env: appEnv, cwd: ROOT, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000 }).split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    } catch (err) {
      if (err.status !== 1) throw new Error(`preflight where.exe ${name} failed unexpectedly`)
      found = false
    }
    if (['claude', 'opencode'].includes(name)) {
      if (!found || candidates.length === 0 || candidates.some((p) => !samePath(path.dirname(p), STUB_DIR) || /\.exe$/i.test(p)) || !samePath(candidates.find((p) => /\.(cmd|bat)$/i.test(p)), path.join(STUB_DIR, `${name}.cmd`))) throw new Error(`preflight ${name} is not exclusively the stub`)
    } else if (['codex', 'kimi', 'grok'].includes(name)) {
      if (found) throw new Error(`preflight ${name} is still resolvable`)
    } else if (!found || !candidates.some((p) => /\.exe$/i.test(p))) throw new Error(`preflight ${name} has no executable`)
    console.log(`# preflight ${name}: ${found ? candidates.length + ' candidate(s)' : 'not found'}`)
  }
  fixtureGit('init', '-q', '-b', 'main')
  fixtureGit('config', 'core.autocrlf', 'false')
  fs.writeFileSync(path.join(REPO, 'README.md'), 'routing team drive fixture\n')
  fixtureGit('add', 'README.md')
  fixtureGit('-c', 'user.name=Chorus Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Fixture')
  if (!/^[0-9a-f]{40}$/.test(fixtureGit('rev-parse', 'HEAD').trim()) || fixtureGit('rev-list', '--count', 'HEAD').trim() !== '1') throw new Error('fixture repository does not have exactly one commit')
  REAL_STATE_BASELINE = REAL_STATE_PATHS.map((file) => ({ file, bytes: readBytesOrAbsent(file) }))
  WORKTREES_BASELINE = git('worktree', 'list', '--porcelain'); STATUS_BASELINE = gitStatus()
  STATUS_HASHES_BASELINE = hashesOf(statusPaths(STATUS_BASELINE))
  console.log(`# baselines: ${REAL_STATE_BASELINE.map((s) => `${s.file} ${s.bytes === 'absent' ? 'absent' : s.bytes.length + ' bytes'}`).join('; ')}; ${Object.keys(STATUS_HASHES_BASELINE).length} dirty or untracked paths content hashed`)
}

const TEAM_DIALOG = '[aria-labelledby="team-launch-title"]'
async function guardedClick(scope, text) {
  const result = await call((selector, wanted) => {
    const el = Array.from(document.querySelectorAll(selector)).find((e) => e.textContent.trim() === wanted)
    if (!el) return { clicked: false, why: 'no element with the exact text' }
    if (el.disabled) return { clicked: false, why: 'the element is disabled' }
    if (['Launch team', 'Preparing lead…'].includes(el.textContent.trim()) || el.matches('.launch-foot .overlay-btn-primary') || el.closest('.launch-foot')) return { clicked: false, why: 'Launch controls are forbidden' }
    el.click()
    return { clicked: true }
  }, scope, text)
  if (!result?.clicked) throw new Error(`guarded click refused ${scope} ${text}: ${show(result)}`)
}
async function choose(selector, value) {
  const result = await call((selector, value) => {
    const el = document.querySelector(selector)
    if (!el) return { ok: false, why: 'missing element' }
    if (el.disabled) return { ok: false, why: 'disabled element' }
    if (el.tagName === 'SELECT') {
      const option = Array.from(el.options).find((o) => o.value === value)
      if (!option || option.disabled) return { ok: false, why: 'missing or disabled option' }
    }
    el.value = value
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return { ok: true, value: el.value }
  }, selector, value)
  if (!result?.ok || result.value !== value) throw new Error(`choose ${selector}: ${show(result)}`)
  await sleep(200)
}
async function openTeam() {
  if (!(await evaluate(present(TEAM_DIALOG)))) {
    if (!(await evaluate(present('.overlay-panel.launch')))) await guardedClick('.empty-cta', 'Launch an Agent')
    await mustWaitFor(present('.overlay-panel.launch'), 30_000, 'launch dialog')
    await guardedClick('.overlay-panel.launch .launch-head button', 'Team session')
  }
  await mustWaitFor(`(() => { const d = document.querySelector(${J(TEAM_DIALOG)}); return d && !d.querySelector('p[role="status"]') && d.querySelector('select[aria-label="Helper 1"]') && d.querySelector('fieldset[data-routing-helpers-busy="false"]') })()`, 30_000, 'ready Team dialog')
}
async function closeTeam() {
  await guardedClick(`${TEAM_DIALOG} header button`, 'Back')
  await mustWaitFor(`${absent(TEAM_DIALOG)} && ${present('.overlay-panel.launch')}`, 10_000, 'Back to launch dialog')
}
async function readTeam() {
  return await call(() => {
    const d = document.querySelector('[aria-labelledby="team-launch-title"]')
    if (!d) return null
    const text = (el) => el ? el.textContent.trim() : null
    const button = (name) => Array.from(d.querySelectorAll('button')).find((el) => text(el) === name)
    return {
      loading: !!d.querySelector('p[role="status"]'), busy: d.querySelector('fieldset[data-routing-helpers-busy]')?.getAttribute('data-routing-helpers-busy') ?? null,
      rows: Array.from(d.querySelectorAll('fieldset[data-routing-helpers-busy] > .row')).map((row) => {
        const helper = row.querySelector('select[aria-label^="Helper "]'), root = row.querySelector('[data-routing-helper-tier]'), select = root?.querySelector('select[data-routing-helper-select]')
        return { label: helper?.getAttribute('aria-label') ?? null, value: helper?.value ?? null, tier: root ? {
          selected: root.getAttribute('data-routing-helper-selected'), busy: root.getAttribute('data-routing-helper-busy'),
          value: select?.value ?? null, disabled: select?.disabled ?? null, label: select?.getAttribute('aria-label') ?? null,
          options: Array.from(select?.options ?? []).map((o) => ({ value: o.value, text: text(o), disabled: o.disabled, title: o.title })),
          hint: text(root.querySelector('[data-routing-helper-hint]'))
        } : null }
      }),
      captions: Array.from(d.querySelectorAll('[data-routing-helper-caption]')).map(text), unavailable: text(d.querySelector('[data-routing-helper-unavailable]')),
      helperSelects: d.querySelectorAll('select[aria-label^="Helper "]').length, saveDisabled: button('Save preset')?.disabled ?? null,
      launchDisabled: button('Launch team')?.disabled ?? null, error: text(d.querySelector('p.error[role="alert"]')),
      leadContext: Array.from(d.querySelectorAll('label')).some((l) => l.firstChild?.textContent.trim() === 'Lead context' && l.querySelector('select'))
    }
  })
}
async function shot(name) {
  await mustWaitFor(`document.querySelector('[data-testid="startup-splash"], [data-testid="saved-flash"]') === null`, 10_000, 'overlays to disappear')
  await evaluate(`(() => { document.querySelector('fieldset[data-routing-helpers-busy]')?.scrollIntoView({ block: 'start' }); return true })()`)
  await evaluate('document.fonts.ready.then(() => true)')
  await sleep(400)
  const { data } = await cdp('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64'))
}
const PROBE_CONSOLE = '__routing_team_console_probe__'
const PROBE_THROW = '__routing_team_exception_probe__'
const PROBE_REJECT = '__routing_team_rejection_probe__'
const hookControl = { console: false, exception: false, rejection: false }
async function installWatchers() {
  rendererErrors.length = 0
  await evaluate(`(() => {
    window.__routingTeamErrors = []
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason
      window.__routingTeamErrors.push(String(reason && reason.message ? reason.message : reason))
    })
    console.error(${JSON.stringify(PROBE_CONSOLE)})
    setTimeout(() => { throw new Error(${JSON.stringify(PROBE_THROW)}) }, 0)
    Promise.reject(new Error(${JSON.stringify(PROBE_REJECT)}))
    return true
  })()`)
  for (let i = 0; i < 30; i++) {
    const rejections = await evaluate('window.__routingTeamErrors.slice()')
    hookControl.console = rendererErrors.some((e) => e.includes(PROBE_CONSOLE))
    hookControl.exception = rendererErrors.some((e) => e.includes(PROBE_THROW))
    hookControl.rejection = rejections.some((e) => e.includes(PROBE_REJECT))
    if (hookControl.console && hookControl.exception && hookControl.rejection) break
    await sleep(100)
  }
  console.log(`# TU13 controls: ${show(hookControl)}`)
}
async function clearErrors() {
  rendererErrors.length = 0
  await evaluate('(() => { window.__routingTeamErrors.length = 0; return true })()')
}
let SEED_PROJECT = null, PROJECT = randomUUID(), PA = null, CA = null, PRESET = null, PRE4B = null
let FRESH_AT = null, STALE_AT = null, bodyText = null, pageRejections = null, firstRows = null, addedRow = null
const T = () => page(`return await routing.tiers({ model: ${J(SLUG)}, profile: 'helper', effort: 'low', credentialProfileId: ${J(CA)} })`)
const wholeSecondsAgo = (ms) => new Date(Math.floor(Date.now() / 1000) * 1000 - ms).toISOString()
function writeAtomic(file, text) {
  const temp = `${file}.seed-${process.pid}.tmp`
  fs.writeFileSync(temp, text)
  fs.renameSync(temp, file)
}
function writeSnapshot(fetchedAt) {
  fs.mkdirSync(MODEL_DIR, { recursive: true })
  writeAtomic(path.join(MODEL_DIR, 'snapshot.json'), seed.snapshotFileText(SLUG, { fetchedAt, endpoints: ENDPOINTS }))
}
function freshTiers(reply) {
  return every(okValue('routing:tiers', reply), eq('tiers profile', reply?.value?.profile, 'helper'), eq('tiers stale', reply?.value?.stale, false),
    ...['budget', 'balanced', 'fast'].map((tier) => that(`${tier} exists in main reply`, reply?.value?.tiers?.[tier] != null)))
}
function choice(row, selected, hint = null) {
  return every(that('tier element exists', row?.tier != null), eq('selected tier', row?.tier?.selected, selected), eq('select value', row?.tier?.value, selected), eq('hint', row?.tier?.hint, hint))
}
function options(row, stale = false) {
  return every(eq('tier option values', row?.tier?.options?.map((o) => o.value), TIER_VALUES),
    eq('tier option texts', row?.tier?.options?.map((o, i) => o.text), TIER_TEXTS.map((text, i) => stale && i < 3 ? text + ' — ' + STALE_REASON : text)),
    eq('tier option disabled', row?.tier?.options?.map((o) => o.disabled), [stale, stale, stale, false, false]),
    ...(stale ? [eq('ranked titles', row?.tier?.options?.slice(0, 3).map((o) => o.title), [STALE_REASON, STALE_REASON, STALE_REASON])] : []),
    eq('default title', row?.tier?.options?.[4]?.title, DEFAULT_DESC), eq('tier busy', row?.tier?.busy, 'false'), eq('tier select disabled', row?.tier?.disabled, false))
}
function noRouting(value) {
  return value === null || typeof value !== 'object' || !Object.hasOwn(value, 'routing') && Object.values(value).every(noRouting)
}
async function watcherDetail() {
  pageRejections = await evaluate('Array.isArray(window.__routingTeamErrors) ? window.__routingTeamErrors.slice() : null')
  return every(that('console control caught', hookControl.console), that('exception control caught', hookControl.exception), that('rejection control caught', hookControl.rejection),
    that('page watcher survived without reload', Array.isArray(pageRejections), pageRejections), eq('renderer errors', rendererErrors, []), eq('unhandled rejections', pageRejections, []),
    that('no clone error', ![...rendererErrors, ...(pageRejections ?? [])].some((s) => /could not be cloned/.test(s))))
}
async function runBootstrap() {
  const details = []
  const projects = await page('return await chorus.listProjects()'), active = projects.filter((p) => p.active)
  SEED_PROJECT = active[0]?.id ?? null
  details.push(eq('run 1 active projects', active.length, 1), that('run 1 project root is ROOT', samePath(active[0]?.root_path, ROOT), active[0]))
  const provider = await page(`return await chorus.createProvider(${J(PROVIDER)})`)
  PA = provider?.ok === true ? provider.provider.id : null
  details.push(that('provider created', PA !== null, provider))
  const credential = await page(`return await chorus.createCredential({ providerId: ${J(PA)}, label: ${J(CREDENTIAL_LABEL)}, key: ${J(KEY)} })`)
  CA = credential?.ok === true ? credential.id : null
  details.push(that('credential created', CA !== null, credential))
  details.push(eq('routing credentials', await page('return await routing.credentials({})'), { ok: true, value: { credentials: [{ id: CA, label: CREDENTIAL_LABEL, providerName: PROVIDER.name }] } }))
  const status = await page('return await routing.status({})')
  details.push(okValue('run 1 status', status), eq('run 1 requests', status?.value?.requestsSinceStart, 0))
  return every(details)
}
async function seedBetweenRuns() {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(DB_PATH)
  const details = []
  try {
    const migrations = db.prepare('SELECT COUNT(*) AS n, MAX(version) AS v FROM schema_migrations').get()
    details.push(eq('migrations before run 2', [migrations.n, migrations.v], [28, 28]))
    details.push(eq('archive seed project changes', Number(db.prepare("UPDATE projects SET status = 'archived' WHERE id = ?").run(SEED_PROJECT).changes), 1))
    details.push(eq('fixture project insert changes', Number(db.prepare("INSERT INTO projects (id, name, root_path, created_at, status, sort_order, color_seed) VALUES (?, ?, ?, ?, 'active', 1, 1)").run(PROJECT, PROJECT_NAME, REPO, new Date().toISOString()).changes), 1))
    details.push(eq('active project setting changes', Number(db.prepare("INSERT INTO settings (key, value) VALUES ('active_project_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(PROJECT).changes), 1))
  } finally { db.close() }
  FRESH_AT = wholeSecondsAgo(300_000)
  writeSnapshot(FRESH_AT)
  writeAtomic(path.join(MODEL_DIR, 'observations.json'), seed.observationsFileText(SLUG, seed.extractObservations({ fetchedAt: FRESH_AT, endpoints: ENDPOINTS })))
  console.log(`# seeded ${ENDPOINTS.length} endpoint rows at ${FRESH_AT}`)
  return every(details)
}
async function runCapabilities() {
  const projects = await page('return await chorus.listProjects()'), active = projects.filter((p) => p.active)
  const context = await page(`return await chorus.getLaunchContext(${J(PROJECT)})`)
  const caps = await page(`return await team.capabilities({ projectId: ${J(PROJECT)} })`)
  const option = (key) => caps?.value?.options?.find((o) => o.key === key)
  const claude = option('claude'), glm = option(CA), nitro = option(CA + '-deepseek'), standard = option(CA + '-deepseek-standard')
  const details = [eq('run 2 active projects', active.length, 1), eq('run 2 active project', active[0]?.id, PROJECT),
    that('fixture root active', samePath(active[0]?.root_path, REPO), active[0]), eq('seed project archived', projects.find((p) => p.id === SEED_PROJECT)?.status, 'archived'),
    that('launch context is fixture', samePath(context?.projectRoot, REPO), context), okValue('capabilities', caps),
    eq('Claude capabilities', claude && { lead: claude.lead, enabled: claude.enabled, helperEnabled: claude.helperEnabled }, { lead: true, enabled: true, helperEnabled: true }),
    eq('Claude member', claude && { model: claude.member.model, effort: claude.member.effort, installedVersion: claude.member.installedVersion }, { model: 'sonnet', effort: null, installedVersion: CLAUDE_STUB_VERSION }),
    eq('GLM enabled', glm?.enabled, true), eq('GLM member', glm && { harness: glm.member.harness, model: glm.member.model, authMode: glm.member.authMode, credentialProfileId: glm.member.credentialProfileId, effort: glm.member.effort, installedVersion: glm.member.installedVersion }, { harness: 'opencode', model: GLM, authMode: 'api_key', credentialProfileId: CA, effort: null, installedVersion: OPENCODE_STUB_VERSION }),
    eq('Nitro member', nitro && { enabled: nitro.enabled, model: nitro.member.model, customModel: nitro.member.customModel, effort: nitro.member.effort }, { enabled: true, model: NITRO_ID, customModel: true, effort: 'low' }),
    eq('standard member', standard && { enabled: standard.enabled, model: standard.member.model, effort: standard.member.effort }, { enabled: true, model: SLUG, effort: 'low' }),
    ...['codex', 'codex-sol'].map((key) => eq(key + ' absent', option(key) && { enabled: option(key).enabled, installedVersion: option(key).member.installedVersion }, { enabled: false, installedVersion: 'unavailable' })),
    that('only stub or unavailable versions', caps?.value?.options?.every((o) => [CLAUDE_STUB_VERSION, OPENCODE_STUB_VERSION, 'unavailable'].includes(o.member.installedVersion)))
  ]
  details.push(freshTiers(await T()))
  return every(details)
}
async function runChecks() {
  await installWatchers()
  const capsDetail = await runCapabilities()
  record(CHECKS[1], every(bootstrapDetail, seedDetail, capsDetail))
  if (capsDetail !== null) throw new Error('run 2 project/capability invariants failed; dialog drive refused')
  await clearErrors()
  await check(CHECKS[2], async () => {
    await openTeam()
    const first = await readTeam(); firstRows = first.rows
    const details = [eq('initial rows', first.rows.length, 2), eq('initial helpers', first.rows.map((r) => r.value), [CA + '-deepseek', CA + '-deepseek']),
      eq('helper selects', first.helperSelects, 2), that('both tier elements present', first.rows.every((r) => r.tier !== null)), eq('first tier aria-label', first.rows[0]?.tier?.label, tierLabel(1)), options(first.rows[0])]
    await guardedClick(`${TEAM_DIALOG} fieldset button`, 'Add helper')
    const added = await readTeam(); addedRow = added.rows[2]
    details.push(eq('added rows', added.rows.length, 3), eq('added helper', addedRow?.value, CA + '-deepseek'), that('added tier element', addedRow?.tier !== null))
    await choose('select[aria-label="Helper 3"]', 'claude')
    details.push(eq('Claude has no tier', (await readTeam()).rows[2]?.tier, null))
    await choose('select[aria-label="Helper 3"]', CA)
    const glm = await readTeam()
    details.push(eq('GLM has no tier', glm.rows[2]?.tier, null), eq('GLM not busy', glm.busy, 'false'), eq('three helper selects', glm.helperSelects, 3), eq('no unavailable', glm.unavailable, null), eq('Lead context present', glm.leadContext, true))
    return every(details)
  })
  await check(CHECKS[3], async () => {
    const details = [choice(firstRows?.[0], 'nitro'), choice(firstRows?.[1], 'nitro'), choice(addedRow, 'nitro')]
    await choose('select[aria-label="Helper 2"]', CA + '-deepseek-standard')
    const d = await readTeam()
    return every(details, choice(d.rows[1], 'default'), choice(d.rows[0], 'nitro'))
  })
  await check(CHECKS[4], async () => {
    const tiers = await T(), d = await readTeam()
    const detail = every(freshTiers(tiers), options(d.rows[0]), options(d.rows[1]), eq('fresh hints', d.rows.slice(0, 2).map((r) => r.tier?.hint), [null, null]),
      eq('captions', d.captions, [CAPTION_LOW]), eq('fieldset busy', d.busy, 'false'), eq('Launch enabled (read only)', d.launchDisabled, false))
    await shot(PNGS[0])
    return detail
  })
  await check(CHECKS[5], async () => {
    await choose('select[aria-label="Routing tier for helper 1"]', 'balanced')
    const d = await readTeam()
    return every(choice(d.rows[0], 'balanced'), choice(d.rows[1], 'default'), eq('GLM tier absent', d.rows[2]?.tier, null))
  })
  await check(CHECKS[6], async () => {
    await choose('input[aria-label="Preset name"]', PRESET_LABEL)
    await guardedClick(`${TEAM_DIALOG} details button`, 'Save preset')
    await mustWaitFor(`Array.from(document.querySelector('select[aria-label="Team preset"]').options).some((o) => o.textContent.trim().startsWith(${J(PRESET_LABEL + ' · v1')}))`, 10_000, 'saved preset option')
    const reply = await page(`return await team.presetList({ projectId: ${J(PROJECT)} })`), presets = reply?.value?.filter((p) => p.label === PRESET_LABEL) ?? []
    PRESET = presets[0]?.id ?? null
    const config = presets[0]?.config, helpers = config?.helpers
    return every(eq('dialog error', (await readTeam()).error, null), okValue('preset list', reply), eq('preset list length', reply?.value?.length, 1), eq('matching presets', presets.length, 1), eq('preset version', presets[0]?.version, 1),
      eq('preset tiers', helpers?.map((h) => h.routingTier ?? null), ['balanced', null, null]), that('default slots omit routingTier', helpers?.length === 3 && !Object.hasOwn(helpers[1], 'routingTier') && !Object.hasOwn(helpers[2], 'routingTier')),
      eq('preset models', helpers?.map((h) => h.model), [NITRO_ID, SLUG, GLM]), eq('preset credentials', helpers?.map((h) => h.credentialProfileId), [CA, CA, CA]),
      that('no routing object at any depth', config !== undefined && noRouting(config)), eq('preset Claude lead', config && { harness: config.lead.harness, installedVersion: config.lead.installedVersion }, { harness: 'claude', installedVersion: CLAUDE_STUB_VERSION }),
      that('non-focused lead omits leadContext', config !== undefined && !Object.hasOwn(config, 'leadContext')), await watcherDetail())
  })
  await check(CHECKS[7], async () => {
    const reply = await page(`const caps = await team.capabilities({ projectId: ${J(PROJECT)} }); const o = (key) => caps.value.options.find((o) => o.key === key); return await team.presetSave({ projectId: ${J(PROJECT)}, expectedVersion: null, label: ${J(PRE4B_LABEL)}, config: { schemaVersion: 1, baseRevision: 'HEAD', lead: { ...o('claude').member, id: crypto.randomUUID() }, helpers: [{ ...o(${J(CA + '-deepseek')}).member, id: crypto.randomUUID(), label: 'DeepSeek Flash Nitro - helper 1' }], concurrency: 2, executionMinutes: 30, integrationPolicy: 'lead-integrates' } })`)
    PRE4B = reply?.value?.find((p) => p.label === PRE4B_LABEL)?.id ?? null
    if (!PRE4B || !PRESET) throw new Error('preset IDs unavailable')
    await closeTeam(); await openTeam()
    await choose('select[aria-label="Team preset"]', PRE4B)
    const old = await readTeam()
    await choose('select[aria-label="Team preset"]', PRESET)
    const restored = await readTeam()
    return every(okValue('pre-4b save', reply), eq('pre-4b rows', old.rows.length, 1), eq('pre-4b model', old.rows[0]?.value, CA + '-deepseek'), choice(old.rows[0], 'default'),
      eq('restored helpers', restored.rows.map((r) => r.value), [CA + '-deepseek', CA + '-deepseek-standard', CA]), choice(restored.rows[0], 'balanced'), choice(restored.rows[1], 'default'), eq('restored GLM tier', restored.rows[2]?.tier, null), eq('restored busy', restored.busy, 'false'))
  })
  await check(CHECKS[8], async () => {
    STALE_AT = wholeSecondsAgo(2 * 3_600_000); writeSnapshot(STALE_AT)
    const tiers = await T()
    await closeTeam(); await openTeam(); await choose('select[aria-label="Team preset"]', PRESET)
    const d = await readTeam()
    const detail = every(okValue('stale tiers', tiers), eq('main stale', tiers?.value?.stale, true), choice(d.rows[0], 'default', BALANCED_HINT), options(d.rows[0], true), choice(d.rows[1], 'default'), options(d.rows[1], true),
      eq('stale GLM tier', d.rows[2]?.tier, null), eq('stale captions', d.captions, [CAPTION_LOW]), eq('stale busy', d.busy, 'false'))
    await shot(PNGS[1])
    return detail
  })
  await check(CHECKS[9], async () => {
    const reply = await page(`const caps = await team.capabilities({ projectId: ${J(PROJECT)} }); const o = (key) => caps.value.options.find((o) => o.key === key); return await team.launch({ projectId: ${J(PROJECT)}, clientRequestId: 'routing-team-ui-tu10', config: { schemaVersion: 1, baseRevision: 'HEAD', lead: { ...o('claude').member, id: crypto.randomUUID() }, helpers: [{ ...o(${J(CA)}).member, id: crypto.randomUUID(), label: 'GLM helper', routingTier: 'balanced' }], concurrency: 2, executionMinutes: 30, integrationPolicy: 'lead-integrates' } })`)
    return every(eq('GLM tier refusal', reply, { ok: false, code: LAUNCH_REFUSAL_CODE, message: GLM_REFUSAL }), eq('no run after GLM', await page(`return await team.list({ projectId: ${J(PROJECT)} })`), { ok: true, value: { runs: [], unavailable: [] } }))
  })
  await check(CHECKS[10], async () => {
    const replies = await page(`const caps = await team.capabilities({ projectId: ${J(PROJECT)} }); const o = (key) => caps.value.options.find((o) => o.key === key); const lead = { ...o('claude').member, id: crypto.randomUUID() }; const config = (helper) => ({ schemaVersion: 1, baseRevision: 'HEAD', lead, helpers: [helper], concurrency: 2, executionMinutes: 30, integrationPolicy: 'lead-integrates' }); const a = await team.launch({ projectId: ${J(PROJECT)}, clientRequestId: 'routing-team-ui-tu11-object', config: config({ ...o(${J(CA + '-deepseek')}).member, id: crypto.randomUUID(), label: 'Nitro helper', routing: { tier: 'balanced', model: ${J(SLUG)}, sentModelId: ${J(SLUG)}, provider: { order: ['streamlake/fp8'], allow_fallbacks: false }, endpoints: ['streamlake/fp8'], snapshotFetchedAt: ${J(FRESH_AT)}, computedAt: ${J(FRESH_AT)} } }) }); const b = await team.launch({ projectId: ${J(PROJECT)}, clientRequestId: 'routing-team-ui-tu11-claude', config: config({ ...o('claude').member, id: crypto.randomUUID(), label: 'Claude helper', routingTier: 'balanced' }) }); return [a, b]`)
    return every(eq('strict schema refusals', replies, [INVALID, INVALID]), eq('still no run', await page(`return await team.list({ projectId: ${J(PROJECT)} })`), { ok: true, value: { runs: [], unavailable: [] } }))
  })
  await check(CHECKS[12], async () => {
    const status = await page('return await routing.status({})')
    bodyText = await evaluate('document.body.innerText')
    return every(okValue('routing status', status), eq('requestsSinceStart', status?.value?.requestsSinceStart, 0), await watcherDetail())
  })
}

async function nothingLaunched() {
  const { DatabaseSync } = await import('node:sqlite'), db = new DatabaseSync(DB_PATH)
  const details = []
  try {
    const migrations = db.prepare('SELECT COUNT(*) AS n, MAX(version) AS v FROM schema_migrations').get()
    details.push(eq('migrations after exit', [migrations.n, migrations.v], [28, 28]))
    for (const table of ['team_runs', 'team_tasks', 'team_attempts', 'team_events', 'sessions']) details.push(eq(table + ' rows', db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0))
    details.push(eq('preset rows', db.prepare('SELECT COUNT(*) AS n FROM team_presets').get().n, 2), eq('stored preset tiers', JSON.parse(db.prepare('SELECT config_json FROM team_presets WHERE label = ?').get(PRESET_LABEL)?.config_json ?? 'null')?.helpers?.map((h) => h.routingTier ?? null), ['balanced', null, null]))
  } finally { db.close() }
  const files = listCaptures(), captures = files.map(readCapture)
  details.push(eq('capture files are complete', fs.readdirSync(CAPTURES).sort(), files))
  for (const name of ['claude', 'opencode']) {
    const records = captures.filter((c) => c.name === name), help = name === 'claude' ? ['--help'] : ['run', '--help']
    details.push(that(name + ' only probed', records.length > 0 && records.every((c) => isDeepStrictEqual(c.argv, ['--version']) || isDeepStrictEqual(c.argv, help))),
      that(name + ' version probe reached stub', records.some((c) => isDeepStrictEqual(c.argv, ['--version']))), that(name + ' help probe reached stub', records.some((c) => isDeepStrictEqual(c.argv, help))))
  }
  const alive = [...new Set(captures.map((c) => c.pid))].filter(stubRunning)
  const outcomes = alive.map((pid) => `${pid}: ${lastResortKill(pid)}`)
  details.push(alive.length === 0 ? null : `stub processes outlived a call (${outcomes.join('; ')})`, that('no Team worktree root', !fs.existsSync(path.join(TMP, '.chorus'))),
    eq('fixture worktree count', fixtureGit('worktree', 'list', '--porcelain').split(/\r?\n/).filter((s) => s.startsWith('worktree ')).length, 1))
  const status = gitStatus(), hashes = hashesOf([...Object.keys(STATUS_HASHES_BASELINE), ...statusPaths(status)])
  details.push(eq('user repository worktrees', git('worktree', 'list', '--porcelain'), WORKTREES_BASELINE), eq('user repository status', status.split('\0'), STATUS_BASELINE.split('\0')), eq('user repository content hashes', hashes, STATUS_HASHES_BASELINE))
  console.log(`# TU12: ${captures.length} probe-only captures; ${Object.keys(hashes).length} repository paths compared by SHA-256`)
  return every(details)
}
async function noKeyMaterial() {
  const scanInto = (into, label, text) => {
    if (typeof text !== 'string' || text.length === 0) return
    if (text.includes(KEY)) into.push(`${label} contains the routing credential's key`)
    for (const { name, re } of SECRET_PATTERNS) if (re.test(text)) into.push(`${label} matches the ${name} pattern`)
  }
  const hits = [], scan = (label, text) => scanInto(hits, label, text)
  const control = 'sk-or-v1-' + '0123456789abcdef'.repeat(2), scratch = []
  scanInto(scratch, 'scratch', `planted ${KEY} here`)
  const details = [that('secret patterns match sample', SECRET_PATTERNS.some(({ re }) => re.test(control))), eq('scan finds planted key', scratch, ["scratch contains the routing credential's key", 'scratch matches the openrouter pattern'])]
  const { DatabaseSync } = await import('node:sqlite'), db = new DatabaseSync(DB_PATH)
  try {
    details.push(that('encrypted credential exists', db.prepare('SELECT length(encrypted_blob) AS n FROM credential_profiles WHERE id = ?').get(CA)?.n > 0))
    for (const [i, row] of db.prepare('SELECT config_json FROM team_presets').all().entries()) scan(`preset config ${i + 1}`, row.config_json)
  } finally { db.close() }
  details.push(that('page text was read', typeof bodyText === 'string' && bodyText.length > 0), that('at least 15 responses', responseTexts.length >= 15, responseTexts.length), eq('two app logs', logPaths.length, 2))
  scan('page text', bodyText)
  responseTexts.forEach((text, i) => scan(`in-page response ${i + 1}`, text))
  for (const file of logPaths) {
    details.push(that(path.basename(file) + ' exists', fs.existsSync(file)))
    if (fs.existsSync(file)) scan(path.basename(file), fs.readFileSync(file, 'utf8'))
  }
  for (const name of fs.readdirSync(CAPTURES)) scan(`capture ${name}`, fs.readFileSync(path.join(CAPTURES, name), 'utf8'))
  for (const file of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) {
    if (!fs.existsSync(file)) continue
    const bytes = fs.readFileSync(file)
    for (const encoding of ['utf8', 'utf16le']) details.push(that(path.basename(file) + ' contains no plaintext key in ' + encoding, !bytes.includes(Buffer.from(KEY, encoding))))
  }
  console.log(`# TU14 scanned page text, ${responseTexts.length} responses, both app logs, every capture, preset JSON and database bytes`)
  return every(details, hits)
}

let bootstrapDetail = 'run 1 bootstrap did not complete', seedDetail = 'between-runs seed did not complete', setupError = null, run2Ran = false
try {
  await setup()
  record(CHECKS[0], null)
} catch (err) {
  console.log(`FAIL ${CHECKS[0]}: ${redact(err instanceof Error ? err.message : String(err))}`)
  deleteSeedBundle()
  const cleanup = await deleteTmp()
  if (cleanup !== null) console.log(`# setup cleanup: ${redact(cleanup)}`)
  console.log('FAIL (15 of 15 checks)')
  process.exit(1)
}
try {
  const run1 = await startRun('run1')
  try { await connect(); bootstrapDetail = await runBootstrap() } finally { await stopRun(run1) }
  if (run1.childExit === null) throw new Error('run 1 is still running')
  if (bootstrapDetail !== null) throw new Error(`bootstrap failed: ${bootstrapDetail}`)
  assertNotInterrupted()
  seedDetail = await seedBetweenRuns()
  if (seedDetail !== null) throw new Error(`between-runs setup failed: ${seedDetail}`)
  assertNotInterrupted()
  const run2 = await startRun('run2')
  try { await connect(); run2Ran = true; await runChecks() } finally { await stopRun(run2) }
} catch (err) {
  setupError = err instanceof Error ? err.message : String(err)
  console.log(`FAIL drive: ${redact(setupError)}`)
  if (run !== null && run.childExit === null) await stopRun(run)
}
if (interrupted) await new Promise(() => {}) // interrupt handler owns cleanup and exit
if (!results.has(CHECKS[1])) record(CHECKS[1], every(bootstrapDetail, seedDetail, setupError))
if (run2Ran && run?.childExit !== null) {
  await check(CHECKS[11], nothingLaunched)
  await check(CHECKS[13], noKeyMaterial)
}
for (const name of CHECKS.slice(0, 14)) if (!results.has(name)) record(name, setupError ? `not run (${setupError})` : 'not run')
if ([...results.values()].includes(false)) {
  for (const file of logPaths) {
    if (!fs.existsSync(file)) continue
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).slice(-30)) console.log(`# ${path.basename(file)}| ${redact(line).slice(0, 300)}`)
  }
}
const cleanupDetails = []
try {
  cleanupDetails.push(that('decoy XDG state stays empty', fs.readdirSync(XDG_STATE).length === 0), that('decoy XDG data stays empty', fs.readdirSync(XDG_DATA).length === 0))
  for (const { file, bytes } of REAL_STATE_BASELINE) {
    const now = readBytesOrAbsent(file)
    cleanupDetails.push(that(file + ' unchanged', bytes === 'absent' ? now === 'absent' : now !== 'absent' && now.equals(bytes)))
  }
} catch (err) { cleanupDetails.push(err instanceof Error ? err.message : String(err)) }
await sleep(1000)
for (const line of stubLastResort()) console.log(`# stub ${redact(line)}`)
const cleanupError = await deleteTmp()
deleteSeedBundle()
cleanupDetails.push(cleanupError === null ? null : `throwaway root was not deleted: ${cleanupError}`, that('seed bundle is gone', !fs.existsSync(SEED_BUNDLE)), eq('OUT contains exactly the two PNGs', fs.readdirSync(OUT).sort(), [...PNGS].sort()))
record(CHECKS[14], every(cleanupDetails))
finish()

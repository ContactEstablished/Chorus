// Model Routing Task 4a-5 (MR-G1, MR-G3, MR-G4, MR-G5, MR-G6): a zero-cost CDP drive of the BUILT
// app through the launch dialog's routing section (ImplementationSpec-4a-5, checks L1-L19 and cleanup).
//
// What it checks: the app detects a STUB `opencode` (an npm-shaped shim first on the app's PATH that
// answers `--version` with 1.18.33 and otherwise records its argv and environment beside itself and
// stays alive) (L2). The dialog's routing section appears only for an OpenCode launch on a routable
// OpenRouter API-key credential with a registry model (L3), a `:nitro` id takes its base model's
// efforts (L4), Balanced is preselected on a fresh seed and the section is styled by settings.css
// (L5). Launches reach the stub with the provider object main itself computed (L6, L7, compared
// with main's own routing:tiers reply), relaunch re-applies the persisted selection on a stale
// snapshot without a re-rank (L8), stale ranked cards are disabled with their reason (L9) and main
// refuses a forced stale tier (L10). Nitro with an effort carries `:nitro`, the declared variants,
// data_collection deny and the MR-D25 state write (L11); OpenRouter default carries no content but
// still gets the state write (L12); a directly picked `:nitro` id with an effort declares only its
// variants (K13, L13). No OpenRouter request (L14), every stub stopped (L15), routing_json and v28 in
// the throwaway database (L16), the user's home and repository untouched (L17), no key material
// (L18) and no renderer error (L19), each with positive controls where "nothing" is the answer.
//
// It spends nothing: no Refresh click, no model:refresh, no key test, no real OpenCode (K11). The
// fake keys are built at run time and exist only in this process, the throwaway profile's encrypted
// rows and the stub's captures under the throwaway root.
//
// Two app runs (C36): run 1 bootstraps the providers, credentials, launch profile and shortlist over
// the real IPC; the catalog row with reasoning efforts can only be written by model:refresh, a live
// call, so it is seeded with node:sqlite between the runs; run 2 drives the dialog.
//
// Prerequisite: `npx electron-vite build` (the drive loads out/; dev never rebuilds MAIN on edit, so a
// stale build would test stale code). The drive refuses a stale build.
//
// Process safety: it launches its OWN app with a throwaway --user-data-dir, a throwaway
// USERPROFILE/HOME and decoy XDG_STATE_HOME/XDG_DATA_HOME under %TEMP%\chorus-routing-launch-*, on a
// free CDP port (never 9222), and stops only that child: CDP Browser.close, then child.kill() on the
// child's own handle, then `taskkill /pid <its own pid> /F` as the last resort, never by name. Stubs
// are stopped through the app (killSession) and confirmed by pid. The drive's direct stub kills (L15's
// last resort, the cleanup sweep, the sweep when run 2 never started, and Ctrl+C) are all pid-targeted
// and happen only after Win32_Process, queried BY ProcessId, names this run's stub script on the
// command line; the stub also exits on its own once its script is deleted or after 30 minutes. Every
// launch is Solo, one slot, Current tree, OpenCode on the drive's own credential, in the seeded
// project, and launchSolo asserts all of that in the same evaluation that clicks Launch. The throwaway
// root and the esbuild seed bundle are deleted at the end, and also on Ctrl+C / Ctrl+Break (then exit
// 1). It leaves only three PNGs in _verify/routing-launch/.
//
// Usage (from anywhere): node scripts/verify-routing-launch.mjs
// Last line: `PASS (20 checks)` (exit 0) or `FAIL (k of 20 checks)` (exit 1).
import fs from 'node:fs'
import os from 'node:os'
import net from 'node:net'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { createHash, randomBytes } from 'node:crypto'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, '_verify', 'routing-launch')
const PNGS = ['launch-fresh.png', 'launch-nitro.png', 'launch-stale.png']
const FIXTURE = path.join(ROOT, 'src', 'main', 'routing', '__fixtures__', 'endpoints-deepseek-v4.1-flash-2026-10-02.json')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ── Fixtures and constants (hand-written; never computed by the code under test) ──
const SLUG = 'deepseek/deepseek-v4.1-flash', NITRO_ID = SLUG + ':nitro'
const GATEWAY = 'https://openrouter.ai/api/v1'
const EFFORTS = ['low', 'medium', 'high'] // seeded catalog efforts of SLUG
const VARIANTS = Object.fromEntries(EFFORTS.map((e) => [e, { reasoning: { effort: e } }]))
const KEY_A = 'sk-or-v1-' + randomBytes(32).toString('hex') // built at run time; no key-shaped literal in the file
const KEY_B = 'sk-or-v1-' + randomBytes(32).toString('hex')
const PROVIDER_A = { name: 'OpenRouter (routing drive)', adapter_type: 'opencode', auth_mode: 'api_key', base_url: GATEWAY, model: SLUG }
const PROVIDER_B = { name: 'Other gateway (routing drive)', adapter_type: 'opencode', auth_mode: 'api_key', base_url: 'https://gateway.example.invalid/api/v1', model: SLUG }
const PROFILE = { label: 'Routed drive profile', agent: 'opencode', model: null, effort: null, model_effort: null, permission_mode: null, workspace_mode: 'current-tree', env_json: null } // + provider_id, credential_profile_id
const STATE_SEED = { recent: [], favorite: [], variant: { ['openrouter/' + SLUG]: 'high', ['openrouter/' + NITRO_ID]: 'default', 'openrouter/z-ai/glm-5.3': 'high' } }
const STALE_REASON = 'Refresh first: the numbers are older than 60 min.'
const DEFAULT_DESC = 'Chorus sends no routing: OpenRouter picks the provider for each request, as before. The data-collection setting is not sent.'
// Copied verbatim from ImplementationSpec-4a-1 (`staleSnapshotMessage(60)`, code SNAPSHOT_STALE).
const STALE_REFUSAL = 'The endpoint snapshot for this model is more than 60 minutes old. Refresh first.'
// ImplementationSpec-4a-4 strings, copied by hand.
const CAPTION_NO_EFFORT = 'Ranked for an interactive session with no reasoning effort set.'
const CAPTION_LOW = 'Ranked for an interactive session at reasoning effort "low".'
const STALE_TEXT = 'Older than 60 min. Refresh before relying on these numbers.'
const BALANCED_HINT = 'Refresh to use Balanced.'
// The Phase 3 cost text (ImplementationSpec-3-3), the Refresh button's title when it is enabled.
const REFRESH_COST =
  'A refresh fetches the endpoint list and checks account eligibility (both free), then may spend up to about $0.05 of OpenRouter credit verifying prompt caching. The estimate is shown before anything is spent.'
const CREDENTIAL_A_LABEL = 'Routing drive key'
const CREDENTIAL_B_LABEL = 'Other drive key'
const DISPLAY_NAME = 'DeepSeek V4.1 Flash'
const STUB_VERSION = '1.18.33'
const CHOICES = ['budget', 'balanced', 'fast', 'nitro', 'default']
const RANKED = ['budget', 'balanced', 'fast']

const CHECKS = [
  'L1 bootstrap', 'L2 stub is OpenCode 1.18.33', 'L3 section only when eligible', 'L4 nitro id takes base efforts',
  'L5 balanced preselected on a fresh seed', 'L6 balanced launch (bare credential)', 'L7 remembered choice, profile launch',
  'L8 relaunch re-applies the selection', 'L9 stale seed in the dialog', 'L10 main refuses a forced stale tier',
  'L11 nitro launch with an effort', 'L12 OpenRouter default launch', 'L13 picked nitro id with an effort (K13)',
  'L14 no OpenRouter request', 'L15 stub processes', 'L16 database after exit', 'L17 home and repository untouched',
  'L18 no key material', 'L19 no renderer errors', 'cleanup'
]

// ── Secret patterns (the scrubber's and the secret-grep gate's one list) ──
const SECRET_PATTERNS = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'main', 'services', 'secret-patterns.json'), 'utf8')).patterns.map(
  (p) => ({ name: p.name, re: new RegExp(p.source) })
)
/** Every fake key and every secret-pattern match replaced; applied to everything this drive prints. */
function redact(text) {
  let out = String(text)
  for (const key of [KEY_A, KEY_B]) out = out.split(key).join('[redacted]')
  for (const { re } of SECRET_PATTERNS) out = out.replace(new RegExp(re.source, 'g'), '[redacted]')
  return out
}

const results = new Map()
const record = (name, detail) => {
  if (results.has(name)) return
  const ok = detail === null
  results.set(name, ok)
  console.log(ok ? `ok ${name}` : `FAIL ${name}: ${redact(String(detail)).slice(0, 1500)}`)
}
let interrupted = false
function finish() {
  if (interrupted) return // the interrupt handler exits 1 once the throwaway root is deleted
  const failed = CHECKS.filter((name) => results.get(name) !== true).length
  console.log(failed === 0 ? `PASS (${CHECKS.length} checks)` : `FAIL (${failed} of ${CHECKS.length} checks)`)
  process.exitCode = failed === 0 ? 0 : 1
}

// ── 1. Freshness ──
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
  const src = (...parts) => path.join(ROOT, 'src', ...parts)
  const servicesDir = src('main', 'services')
  const coresDir = src('main', 'routing')
  const mainSources = [
    ...fs.readdirSync(servicesDir).filter((name) => /^routing.*\.ts$/.test(name)).map((name) => path.join(servicesDir, name)),
    ...fs.readdirSync(coresDir).filter((name) => name.endsWith('.ts')).map((name) => path.join(coresDir, name)),
    src('main', 'routing', 'model-registry.json'), // bundled into main; L3 and L4 depend on it
    src('shared', 'routing.ts'), src('shared', 'ipc.ts'), src('main', 'ipc.ts'), src('main', 'index.ts'),
    src('main', 'services', 'storage.ts'), src('main', 'services', 'sessionManager.ts'), src('main', 'db', 'schema.ts'),
    src('main', 'adapters', 'opencode.ts'), src('main', 'adapters', 'opencodeVariantState.ts'),
    src('main', 'adapters', 'opencodeVariantStateCore.ts'), src('main', 'adapters', 'types.ts'), src('preload', 'index.ts')
  ]
  for (const file of mainSources) if (!fs.existsSync(file)) return `${path.relative(ROOT, file)} is missing`
  const newestMain = newestOf(mainSources)
  if (fs.statSync(MAIN_BUNDLE).mtimeMs < newestMain.mtime) return `out/main/index.js is older than ${path.relative(ROOT, newestMain.file)}`
  const mainText = fs.readFileSync(MAIN_BUNDLE, 'utf8')
  for (const needle of ['routing:launch-preferences', 'routing_tier', 'routing_json', 'OPENCODE_CONFIG_CONTENT']) {
    if (!mainText.includes(needle)) return `out/main/index.js has no ${needle}`
  }
  if (!fs.readFileSync(PRELOAD_BUNDLE, 'utf8').includes('routing:launch-preferences')) return 'out/preload/index.js has no routing:launch-preferences'

  if (!fs.existsSync(RENDERER_HTML)) return 'out/renderer/index.html is missing'
  const assets = fs.existsSync(RENDERER_ASSETS)
    ? fs.readdirSync(RENDERER_ASSETS).filter((name) => name.endsWith('.js')).map((name) => path.join(RENDERER_ASSETS, name))
    : []
  if (assets.length === 0) return 'out/renderer/assets has no .js file'
  const routingComponents = src('renderer', 'src', 'components', 'routing')
  const rendererSources = [
    src('renderer', 'src', 'components', 'LaunchDialog.vue'),
    ...fs.readdirSync(routingComponents).filter((name) => name.endsWith('.vue')).map((name) => path.join(routingComponents, name)),
    src('renderer', 'src', 'stores', 'routingLaunch.ts'),
    src('shared', 'routingView.ts'),
    src('shared', 'routing.ts')
  ]
  for (const file of rendererSources) if (!fs.existsSync(file)) return `${path.relative(ROOT, file)} is missing`
  const newestSource = newestOf(rendererSources)
  if (newestOf(assets).mtime < newestSource.mtime) return `the newest out/renderer/assets/*.js is older than ${path.relative(ROOT, newestSource.file)}`
  if (!assets.some((file) => fs.readFileSync(file, 'utf8').includes(DEFAULT_DESC))) return `no out/renderer/assets/*.js contains "${DEFAULT_DESC}"`
  return null
}
const stale = staleReason()
if (stale !== null) {
  console.log(`# ${stale}`)
  console.log('FAIL build is stale: run npx electron-vite build')
  process.exit(1)
}

// ── 2. Seed helpers: the Phase 1 parser and the Phase 2 file writers, bundled with esbuild ──
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
      sourcefile: 'routing-launch-seed.ts'
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
const ENDPOINTS = seed.parseEndpointsResponse(JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))).endpoints

// ── 3. The throwaway root, the stub and the app's environment ──
let run = null // the current app run: { name, child, port, logFd, logClosed, childExit, exited, spawnError }
const logPaths = []
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'chorus-routing-launch-'))
// N5: from here on, Ctrl+C / Ctrl+Break stops what the drive started and deletes the root (onInterrupt, below).
process.on('SIGINT', () => void onInterrupt('SIGINT'))
process.on('SIGBREAK', () => void onInterrupt('SIGBREAK'))
const USER_DATA = path.join(TMP, 'profile')
const HOME_DIR = path.join(TMP, 'home')
const XDG_STATE = path.join(TMP, 'xdg-state')
const XDG_DATA = path.join(TMP, 'xdg-data')
const STUB_DIR = path.join(TMP, 'stub')
const STUB_CMD = path.join(STUB_DIR, 'opencode.cmd')
const STUB_SCRIPT = path.join(STUB_DIR, 'opencode-stub.cjs')
const CAPTURES = path.join(STUB_DIR, 'captures')
const HOME_STATE = path.join(HOME_DIR, '.local', 'state', 'opencode', 'model.json')
const MCP_FILE = path.join(USER_DATA, 'mcp', 'opencode.json')
const DB_PATH = path.join(USER_DATA, 'chorus.db')
const MODEL_DIR = path.join(USER_DATA, 'routing', seed.modelDirName(SLUG))
// The throwaway home must look like a profile: Electron resolves app.getPath('appData') as
// <USERPROFILE>\AppData\Roaming and throws "Failed to get 'appData' path" when it is missing
// (measured 2026-10-04, Electron 43.1.1). Anything the app writes under appData then lands here too.
const HOME_APPDATA = [path.join(HOME_DIR, 'AppData', 'Roaming'), path.join(HOME_DIR, 'AppData', 'Local')]
for (const dir of [USER_DATA, HOME_DIR, ...HOME_APPDATA, XDG_STATE, XDG_DATA, STUB_DIR, CAPTURES]) fs.mkdirSync(dir, { recursive: true })
console.log(`# throwaway root ${TMP}`)

/** Best effort, with retries: the app's helper processes may hold a file for a moment after exit. Returns the last error, or null. */
async function deleteTmp() {
  let lastError = null
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      fs.rmSync(TMP, { recursive: true, force: true })
      return fs.existsSync(TMP) ? 'still present' : null
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      await sleep(1_000)
    }
  }
  return lastError
}

// C37: the stub. The shim is npm's two-line shape (CRLF), which parseNpmShim reads as a node script,
// so the app spawns `node <stub>` with no cmd.exe. `--version` and `run --help` answer and record
// nothing; any other call records argv and env BESIDE ITSELF (the credentialed child env offers no
// channel for a capture path) and stays alive until it is killed. S7: it can never outlive the drive
// for long either — it exits once its own script is gone (the drive deletes the root on every exit
// path) or after 30 minutes, whichever comes first. It does not watch its parent.
fs.writeFileSync(STUB_CMD, '@ECHO off\r\nnode "%~dp0\\opencode-stub.cjs" %*\r\n')
fs.writeFileSync(
  STUB_SCRIPT,
  [
    "'use strict'",
    '// Model Routing Task 4a-5 (C37): a stand-in for opencode. It runs no agent and makes no request.',
    "const fs = require('node:fs')",
    "const path = require('node:path')",
    'const argv = process.argv.slice(2)',
    "if (argv.length === 1 && argv[0] === '--version') {",
    `  process.stdout.write(${JSON.stringify(STUB_VERSION + '\n')})`,
    "} else if (argv.length === 2 && argv[0] === 'run' && argv[1] === '--help') {",
    "  process.stdout.write('opencode stub: run [message..]\\n')",
    '} else {',
    "  const dir = path.join(__dirname, 'captures')",
    '  fs.mkdirSync(dir, { recursive: true })',
    // Unique per process, never just the pid: Windows reuses a killed stub's pid within one run, and a
    // pid-only name let the next capture overwrite the old file and read as "no new capture" (0.9.1).
    "  const file = path.join(dir, process.pid + '-' + Date.now() + '-' + require('crypto').randomBytes(4).toString('hex') + '.json')",
    "  const temp = file + '.tmp'",
    '  fs.writeFileSync(temp, JSON.stringify({ pid: process.pid, argv, cwd: process.cwd(), env: { ...process.env }, at: new Date().toISOString() }))',
    '  fs.renameSync(temp, file)',
    "  process.stdout.write('opencode stub: recorded\\r\\n')",
    '  const started = Date.now()',
    '  setInterval(() => {',
    '    if (!fs.existsSync(__filename) || Date.now() - started > 30 * 60 * 1000) process.exit(0)',
    '  }, 5000)',
    '}',
    ''
  ].join('\n')
)

/** Windows environment names are case-insensitive: every casing of `name`. */
const envKeysOf = (env, name) => Object.keys(env).filter((k) => k.toUpperCase() === name)
function setEnv(env, name, value) {
  for (const key of envKeysOf(env, name)) delete env[key]
  env[name] = value
}
function envGet(env, name) {
  const key = envKeysOf(env ?? {}, name)[0]
  return key === undefined ? undefined : env[key]
}

// C38: the app's environment.
const appEnv = { ...process.env }
for (const name of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME']) {
  for (const key of envKeysOf(appEnv, name)) delete appEnv[key]
}
setEnv(appEnv, 'USERPROFILE', HOME_DIR)
setEnv(appEnv, 'HOME', HOME_DIR)
setEnv(appEnv, 'HOMEDRIVE', HOME_DIR.slice(0, 2))
setEnv(appEnv, 'HOMEPATH', HOME_DIR.slice(2))
setEnv(appEnv, 'XDG_STATE_HOME', XDG_STATE)
setEnv(appEnv, 'XDG_DATA_HOME', XDG_DATA)
const PATH_KEY = Object.keys(appEnv).find((k) => k.toUpperCase() === 'PATH') // its own key: a second PATH beside Path is ambiguous
if (PATH_KEY === undefined) appEnv.Path = STUB_DIR
else appEnv[PATH_KEY] = `${STUB_DIR};${appEnv[PATH_KEY]}`

/** Separators and case normalised (Windows paths are case-insensitive). */
const samePath = (a, b) => typeof a === 'string' && typeof b === 'string' && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()

/** A setup failure before run 1: every check failed, the root and the bundle deleted, exit 1. */
async function abortDrive(reason) {
  console.log(`FAIL drive: ${reason}`)
  deleteSeedBundle()
  const error = await deleteTmp()
  if (error !== null) console.log(`# the throwaway root was not deleted: ${error}`)
  console.log(`FAIL (${CHECKS.length} of ${CHECKS.length} checks)`)
  process.exit(1)
}

// Preflight: the stub must win over any real opencode (a real `.exe` anywhere on PATH would, cliDetect.ts pickSpawnable).
{
  let candidates = []
  try {
    const out = execFileSync('where.exe', ['opencode'], { env: appEnv, cwd: ROOT, encoding: 'utf8', windowsHide: true })
    candidates = out.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0)
  } catch (err) {
    await abortDrive(`preflight: where.exe opencode failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  const exes = candidates.filter((c) => c.toLowerCase().endsWith('.exe'))
  const firstShim = candidates.find((c) => /\.(cmd|bat)$/i.test(c)) ?? null
  if (exes.length > 0) await abortDrive(`preflight: where.exe opencode lists an .exe (${exes.join(', ')}), which would win over the stub`)
  if (!samePath(firstShim, STUB_CMD)) await abortDrive(`preflight: the first opencode .cmd/.bat on the app's PATH is ${firstShim}, not the stub`)
  console.log(`# preflight: where.exe opencode lists ${candidates.length} candidate(s), no .exe; the first .cmd is the stub`)
}

// Baselines: the user's real OpenCode state (read with the drive's own, real environment) and the repository.
const REAL_STATE_PATHS = [path.join(os.homedir(), '.local', 'state', 'opencode', 'model.json')]
const realXdgState = envGet(process.env, 'XDG_STATE_HOME')
if (realXdgState) REAL_STATE_PATHS.push(path.join(realXdgState, 'opencode', 'model.json'))
const readBytesOrAbsent = (file) => (fs.existsSync(file) ? fs.readFileSync(file) : 'absent')
const REAL_STATE_BASELINE = REAL_STATE_PATHS.map((file) => ({ file, bytes: readBytesOrAbsent(file) }))
// S1: GIT_OPTIONAL_LOCKS=0 so `git status` never takes the user's index lock (it would refresh the index otherwise).
const GIT_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0' }
const git = (...args) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', windowsHide: true, env: GIT_ENV, timeout: 60_000 })
const gitStatus = () => git('status', '--porcelain=v1', '-z', '--untracked-files=all')
/** The paths a `--porcelain=v1 -z` listing names (a rename or copy also names its source). */
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
const WORKTREES_BASELINE = git('worktree', 'list', '--porcelain')
const STATUS_BASELINE = gitStatus()
const STATUS_HASHES_BASELINE = hashesOf(statusPaths(STATUS_BASELINE))
console.log(
  `# baselines: ${REAL_STATE_BASELINE.map((s) => `${s.file} ${s.bytes === 'absent' ? 'absent' : `${s.bytes.length} bytes`}`).join('; ')}; ` +
    `${WORKTREES_BASELINE.split(/\r?\n/).filter((l) => l.startsWith('worktree ')).length} worktree(s); ` +
    `${Object.keys(STATUS_HASHES_BASELINE).length} dirty or untracked path(s), content hashed`
)

// ── Stub captures ──
// Function declarations (hoisted), because the interrupt handler may need them.
function listCaptures() {
  return fs.existsSync(CAPTURES) ? fs.readdirSync(CAPTURES).filter((name) => /^\d+-\d+-[0-9a-f]{8}\.json$/.test(name)).sort() : []
}
function readCapture(name) {
  return JSON.parse(fs.readFileSync(path.join(CAPTURES, name), 'utf8'))
}
/** `JSON.parse(capture.env.OPENCODE_CONFIG_CONTENT)`, or null when the capture carries none. */
function contentOf(capture) {
  const text = envGet(capture?.env, 'OPENCODE_CONFIG_CONTENT')
  return typeof text === 'string' ? JSON.parse(text) : null
}
/** Alive unless the OS says there is no such process (EPERM means it exists). */
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
  return norm(commandLine).includes(norm(STUB_SCRIPT)) ? 'stub' : 'other'
}
/** Still this run's stub (a pid whose command line no longer names the stub counts as gone). */
const stubRunning = (pid) => {
  const state = stubProcessState(pid)
  return state === 'stub' || state === 'unknown'
}
/**
 * C44: the direct stub kill (L15's last resort, the cleanup sweep, the sweep when run 2 never ran,
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

// ── The app runs: a free port, the throwaway profile, the built app ──
/** S6: stop between phases once Ctrl+C has been pressed (the handler is already stopping everything). */
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
/** Runtime.exceptionThrown and console.error events from the page (L19). */
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
/** Every value the page's chorus/routing calls hand back, for L18. */
const responseTexts = []
/** Runs `body` inside an async IIFE in the page, with `chorus` and `routing` bound. Payloads are object literals written here. */
async function page(body) {
  const value = await evaluate(`(async () => { const chorus = window.chorus; const routing = window.chorus.routing; ${body} })()`)
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

// ── DOM helpers ──
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
    `(() => ({ text: ((document.body && document.body.innerText) || '').replace(/\\s+/g, ' ').trim().slice(0, 300), dialog: document.querySelector('.overlay-panel.launch') !== null, routing: document.querySelector('[data-routing-launch]') !== null, error: (document.querySelector('.launch .overlay-error') || {}).textContent || null }))()`
  ).catch((err) => ({ error: err.message }))
  return `DOM ${JSON.stringify(summary)}`
}
async function mustWaitFor(expression, ms, what) {
  if (!(await waitFor(expression, ms))) throw new Error(`${what} did not appear within ${ms / 1000} s; ${await domSummary()}`)
}
const present = (selector) => `document.querySelector(${JSON.stringify(selector)}) !== null`
const absent = (selector) => `document.querySelector(${JSON.stringify(selector)}) === null`
async function click(selector) {
  const done = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true })()`)
  if (!done) throw new Error(`nothing to click at ${selector}; ${await domSummary()}`)
}
/** Sets `.value` and dispatches bubbling `input` and `change` (team-member-ui-checks.mjs:7-10): v-model needs the event. */
async function choose(selector, value) {
  const done = await evaluate(
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true })()`
  )
  if (!done) throw new Error(`nothing to choose at ${selector}; ${await domSummary()}`)
}
/** In the page: click the first `selector` whose trimmed text is `text`. */
function inPageClickText(selector, text) {
  const el = Array.from(document.querySelectorAll(selector)).find((e) => e.textContent.trim() === text)
  if (!el) return false
  el.click()
  return true
}
async function clickText(selector, text) {
  if (!(await call(inPageClickText, selector, text))) throw new Error(`no ${selector} reads "${text}"; ${await domSummary()}`)
}
/** The app's own transient overlays (App.vue): the startup splash and the "Saved" mark. */
const OVERLAYS_GONE = `document.querySelector('[data-testid="startup-splash"], [data-testid="saved-flash"]') === null`
/** Waits for the overlays, scrolls the routing section to the top of the dialog body and writes OUT/<name>. */
async function shot(name) {
  if (!(await waitFor(OVERLAYS_GONE, 10_000))) console.log(`# ${name}: an overlay was still showing after 10 s`)
  await evaluate(`(() => { const s = document.querySelector('[data-routing-launch]'); if (s) s.scrollIntoView({ block: 'start' }); return true })()`)
  await evaluate('document.fonts.ready.then(() => true)')
  await sleep(400)
  const { data } = await cdp('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64'))
}

// ── Dialog helpers (the dialog markup has no test hooks for these, so they select by text) ──
const DIALOG = '.overlay-panel.launch'
/** In the page: the selected launch-profile chip's text, or null when the dialog has no chips. */
function inPageProfileChip() {
  const chip = document.querySelector('.launch .launch-chip.launch-chip-on')
  return chip ? chip.textContent.trim() : null
}
/** The model list of the chosen route (shortlist [SLUG, NITRO_ID]) has arrived. */
const MODEL_LIST_LOADED = `(() => { const s = document.querySelector('[data-launch-model]'); return s !== null && Array.from(s.options).some((o) => o.value === ${JSON.stringify(NITRO_ID)}) })()`
async function openDialog() {
  if (await evaluate(present(DIALOG))) return
  await mustWaitFor(`${present('.empty-cta')} || ${present('button[aria-label="New agent"]')}`, 30_000, 'a New session / New agent button')
  await evaluate(`(() => { const el = document.querySelector('.empty-cta') || document.querySelector('button[aria-label="New agent"]'); el.click(); return true })()`)
  await mustWaitFor(present(DIALOG), 10_000, 'the launch dialog')
  await mustWaitFor(`document.querySelectorAll('.overlay-panel.launch .launch-agent').length > 0`, 10_000, 'the agent cards')
  await sleep(300)
  const chip = await call(inPageProfileChip)
  if (chip !== null && chip !== 'No profile') await mustWaitFor(MODEL_LIST_LOADED, 10_000, `the model list of the preselected profile "${chip}"`)
}
async function pickAgent(name) {
  const done = await evaluate(
    `(() => { const card = Array.from(document.querySelectorAll('.launch .launch-agent')).find((e) => (e.querySelector('.launch-agent-name') || {}).textContent?.trim() === ${JSON.stringify(name)}); if (!card || card.disabled) return false; card.click(); return true })()`
  )
  if (!done) throw new Error(`no enabled ${name} agent card; ${await domSummary()}`)
  await mustWaitFor(`(() => { const c = document.querySelector('.launch .launch-agent.overlay-card-selected .launch-agent-name'); return c !== null && c.textContent.trim() === ${JSON.stringify(name)} })()`, 5_000, `the ${name} card selected`)
}
async function pickAuth(label) {
  await clickText('.launch .overlay-segment', label)
  await mustWaitFor(`Array.from(document.querySelectorAll('.launch .overlay-segment-alt-on')).some((e) => e.textContent.trim() === ${JSON.stringify(label)})`, 5_000, `the ${label} auth segment on`)
}
/** The `select.launch-select` whose option values include `id`. */
async function pickCredential(id) {
  await mustWaitFor(`Array.from(document.querySelectorAll('select.launch-select')).some((s) => Array.from(s.options).some((o) => o.value === ${JSON.stringify(id)}))`, 5_000, 'the credential select')
  const done = await evaluate(
    `(() => { const el = Array.from(document.querySelectorAll('select.launch-select')).find((s) => Array.from(s.options).some((o) => o.value === ${JSON.stringify(id)})); if (!el) return false; el.value = ${JSON.stringify(id)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return el.value === ${JSON.stringify(id)} })()`
  )
  if (!done) throw new Error(`could not choose credential ${id}; ${await domSummary()}`)
}
async function pickProfile(label) {
  await clickText('.launch .launch-chip', label)
  await mustWaitFor(`(${inPageProfileChip.toString()})() === ${JSON.stringify(label)}`, 5_000, `the "${label}" chip on`)
  if (label !== 'No profile') await mustWaitFor(MODEL_LIST_LOADED, 10_000, `the model list of "${label}"`)
}
async function ensureProfileChip() {
  if ((await call(inPageProfileChip)) !== PROFILE.label) await pickProfile(PROFILE.label)
}
/** `null` = the route-default option (its value is null, which a string assignment cannot select). */
async function pickModel(value) {
  await mustWaitFor(MODEL_LIST_LOADED, 10_000, 'the model list')
  if (value === null) {
    await evaluate(
      `(() => { const el = document.querySelector('[data-launch-model]'); el.selectedIndex = 0; el.dispatchEvent(new Event('change', { bubbles: true })); return true })()`
    )
    await mustWaitFor(`document.querySelector('[data-launch-model]').selectedIndex === 0`, 5_000, 'the route default selected')
  } else {
    await choose('[data-launch-model]', value)
    await mustWaitFor(`document.querySelector('[data-launch-model]').value === ${JSON.stringify(value)}`, 5_000, `${value} selected`)
  }
}
async function pickEffort(label) {
  await clickText('[data-launch-model-effort]', label)
  await mustWaitFor(`Array.from(document.querySelectorAll('[data-launch-model-effort].overlay-segment-on')).some((e) => e.textContent.trim() === ${JSON.stringify(label)})`, 5_000, `the ${label} effort on`)
}
async function routingReady() {
  await mustWaitFor(present('[data-routing-launch][data-routing-launch-ready="true"]'), 10_000, 'the ready routing section')
}
async function pickTier(choice) {
  await click(`[data-routing-launch] input[data-routing-radio][value="${choice}"]`)
  await mustWaitFor(present(`[data-routing-launch][data-routing-choice-selected="${choice}"]`), 5_000, `${choice} selected`)
}
/** In the page: a plain-JSON reading of the routing section. */
function inPageReadRouting() {
  const s = document.querySelector('[data-routing-launch]')
  if (!s) return { present: false }
  const t = (el) => (el ? el.textContent : null)
  const refresh = s.querySelector('[data-routing-refresh]')
  return {
    present: true,
    ready: s.getAttribute('data-routing-launch-ready'),
    selected: s.getAttribute('data-routing-choice-selected'),
    caption: t(s.querySelector('[data-routing-caption]')),
    hint: t(s.querySelector('[data-routing-launch-hint]')),
    stale: t(s.querySelector('[data-routing-stale]')),
    age: t(s.querySelector('[data-routing-age]')),
    refresh: refresh ? { text: refresh.textContent, disabled: refresh.disabled, title: refresh.getAttribute('title') } : null,
    defaultDescription: t(s.querySelector('[data-routing-default-description]')),
    choices: Array.from(s.querySelectorAll('[data-routing-choice]')).map((c) => {
      const radio = c.querySelector('input[data-routing-radio]')
      return {
        choice: c.getAttribute('data-routing-choice'),
        checked: radio ? radio.checked : null,
        disabled: radio ? radio.disabled : null,
        dataDisabled: c.getAttribute('data-routing-disabled'),
        disabledReason: t(c.querySelector('[data-routing-disabled-reason]')),
        primary: t(c.querySelector('[data-routing-primary]'))
      }
    })
  }
}
const readRouting = () => call(inPageReadRouting)
const choiceOf = (reading, choice) => (reading.choices ?? []).find((c) => c.choice === choice) ?? null

/**
 * In the page: whether settings.css actually styles the routing section (the 4a-4 deviation: the
 * dialog's own `<style src="settings.css">` was omitted, and the rules reach it globally through
 * App.vue -> SettingsView.vue). Reads the page's own stylesheets for the unscoped `.set-card` and
 * `.set-hint-warn` rules, the computed style of a real `.set-card` and `.set-hint-warn` in the
 * section, the two tokens those rules use as the browser resolves them, and two NEGATIVE controls:
 * the same tags with no class, in the same containers.
 */
function inPageSettingsCss() {
  const section = document.querySelector('[data-routing-launch]')
  if (!section) return { error: 'no [data-routing-launch]' }
  const card = section.querySelector('[data-routing-choice="budget"].set-card')
  const hint = section.querySelector('[data-routing-nitro-warning].set-hint-warn')
  if (!card || !hint) return { error: 'no budget .set-card or Nitro .set-hint-warn in the section' }
  const rules = { '.set-card': [], '.set-hint-warn': [] }
  for (const sheet of Array.from(document.styleSheets)) {
    let list
    try {
      list = sheet.cssRules
    } catch {
      continue
    }
    for (const rule of Array.from(list)) {
      if (rule.selectorText === '.set-card' || rule.selectorText === '.set-hint-warn') {
        rules[rule.selectorText].push({
          sheet: (sheet.href || 'inline').split('/').pop(),
          overflow: rule.style.overflow,
          border: rule.style.getPropertyValue('border'),
          background: rule.style.getPropertyValue('background'),
          fontSize: rule.style.fontSize,
          lineHeight: rule.style.lineHeight,
          color: rule.style.getPropertyValue('color')
        })
      }
    }
  }
  const pick = (el, props) => {
    const cs = getComputedStyle(el)
    return Object.fromEntries(props.map((p) => [p, cs[p]]))
  }
  const CARD = ['overflowX', 'overflowY', 'borderTopWidth', 'borderTopStyle', 'backgroundColor']
  const HINT = ['fontSize', 'lineHeight', 'color']
  const token = (prop, value) => {
    const probe = document.createElement('div')
    probe.style[prop] = value
    section.appendChild(probe)
    const resolved = getComputedStyle(probe)[prop]
    probe.remove()
    return resolved
  }
  const bareCard = document.createElement('section')
  card.parentElement.appendChild(bareCard)
  const bareHint = document.createElement('p')
  hint.parentElement.appendChild(bareHint)
  const out = {
    rules,
    card: pick(card, CARD),
    bareCard: pick(bareCard, CARD),
    hint: pick(hint, HINT),
    bareHint: pick(bareHint, HINT),
    surfaceInset: token('backgroundColor', 'var(--color-surface-inset)'),
    attentionText: token('color', 'var(--color-state-attention-text)')
  }
  bareCard.remove()
  bareHint.remove()
  return out
}

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
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/
const isEmptyDir = (dir) => fs.existsSync(dir) && fs.readdirSync(dir).length === 0
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
/** The home state file still holds exactly what the drive seeded (MR-D25 wrote nothing). */
function stateIsSeed(label) {
  const bytes = readBytesOrAbsent(HOME_STATE)
  return that(`${label}: the home state file still equals the seed`, bytes !== 'absent' && SEED_BYTES !== null && bytes.equals(SEED_BYTES), bytes === 'absent' ? 'absent' : bytes.toString('utf8'))
}
function stateEquals(label, expected) {
  try {
    return eq(`${label}: the home state file`, readJson(HOME_STATE), expected)
  } catch (err) {
    return `${label}: the home state file could not be read: ${err instanceof Error ? err.message : String(err)}`
  }
}
function mcpAgentBuild(label, expected) {
  try {
    const file = readJson(MCP_FILE)
    return every(eq(`${label}: opencode.json agent.build`, file?.agent?.build, expected), that(`${label}: opencode.json has no top-level provider key`, !Object.hasOwn(file ?? {}, 'provider')))
  } catch (err) {
    return `${label}: ${path.relative(TMP, MCP_FILE)} could not be read: ${err instanceof Error ? err.message : String(err)}`
  }
}
function contentEquals(label, capture, expected) {
  let content
  try {
    content = contentOf(capture)
  } catch (err) {
    return `${label}: OPENCODE_CONFIG_CONTENT is not JSON: ${err instanceof Error ? err.message : String(err)}`
  }
  return content === null ? `${label}: no OPENCODE_CONFIG_CONTENT` : eq(label, content, expected)
}

// ── Run state shared between the checks and the after-exit checks ──
let PROJECT = null, PROJECT_ROOT = null, PA = null, PB = null, CA = null, CB = null, LP = null
let FRESH_AT = null, STALE_AT = null, SEED_BYTES = null
let RELAUNCH_AT = null, RUN2_START = null, RUN2_END = null, L6_TIERS_AT = null
const S = {} // S1..S5: session ids
const P = {} // P1, P2, P2r, P3, P4, P5: captures
const STARTED = [] // every session id this drive started
let bodyText = null
let pageRejections = null

const T = (effort) =>
  page(`return await routing.tiers({ model: ${J(SLUG)}, profile: 'interactive', effort: ${J(effort)}, credentialProfileId: ${J(CA)} })`)
const sessionList = async () => (await page(`return (await chorus.getLayout(${J(PROJECT)})).sessions.map((s) => ({ id: s.id, status: s.status }))`)) ?? []
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
async function waitNewCaptures(before, ms) {
  const deadline = Date.now() + ms
  for (;;) {
    const fresh = listCaptures().filter((name) => !before.includes(name))
    if (fresh.length > 0 || Date.now() >= deadline) return fresh
    await sleep(200)
  }
}

/**
 * B1, in the page, in ONE evaluation: read what the open dialog would launch and click Launch only
 * when every expectation holds, so nothing can change between the check and the click. `expect` is
 * `{ agent, credentialId, profile }` (`profile` null for a bare-credential launch). Returns
 * `{ clicked, failures, seen }`; with any failure nothing is clicked.
 */
function inPageGuardedLaunch(expect) {
  const text = (el) => (el ? el.textContent.trim() : null)
  const panel = document.querySelector('.overlay-panel.launch')
  if (!panel) return { clicked: false, failures: ['no open launch dialog'], seen: null }
  const credentialSelect =
    Array.from(panel.querySelectorAll('select.launch-select')).find((s) => Array.from(s.options).some((o) => o.value === expect.credentialId)) ?? null
  const button = panel.querySelector('.launch-foot .overlay-btn-primary')
  const seen = {
    agents: Array.from(panel.querySelectorAll('.launch-agent.overlay-card-selected')).map((e) => text(e.querySelector('.launch-agent-name'))),
    auth: Array.from(panel.querySelectorAll('.overlay-segment-alt-on')).map(text),
    credential: credentialSelect ? credentialSelect.value : null,
    profileChip: text(panel.querySelector('.launch-chip.launch-chip-on')),
    preset: Array.from(panel.querySelectorAll('[data-launch-preset].overlay-card-selected')).map((e) => text(e.querySelector('.launch-mode-name'))),
    count: Array.from(panel.querySelectorAll('[data-launch-count].overlay-segment-on')).map(text),
    plan: Array.from(panel.querySelectorAll('.launch-plan-row')).map((r) => ({ agent: text(r.querySelector('.launch-plan-name')), target: text(r.querySelector('.launch-plan-target')) })),
    launchEnabled: button !== null && !button.disabled
  }
  const failures = []
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  if (!same(seen.agents, [expect.agent])) failures.push(`the selected agent card is ${JSON.stringify(seen.agents)}, not ${expect.agent}`)
  if (!same(seen.auth, ['api key'])) failures.push(`the selected auth segment is ${JSON.stringify(seen.auth)}, not api key`)
  if (seen.credential !== expect.credentialId) failures.push(`the credential select holds ${JSON.stringify(seen.credential)}, not the expected credential`)
  if (expect.profile === null) {
    if (seen.profileChip !== null && seen.profileChip !== 'No profile') failures.push(`the launch profile chip ${JSON.stringify(seen.profileChip)} is on; a bare-credential launch expects none`)
  } else if (seen.profileChip !== expect.profile) failures.push(`the launch profile chip on is ${JSON.stringify(seen.profileChip)}, not ${JSON.stringify(expect.profile)}`)
  if (!same(seen.preset, ['Solo'])) failures.push(`the preset is ${JSON.stringify(seen.preset)}, not Solo`)
  if (!same(seen.count, ['1'])) failures.push(`the count is ${JSON.stringify(seen.count)}, not 1`)
  if (!same(seen.plan, [{ agent: expect.agent, target: 'Current tree' }])) failures.push(`the plan is ${JSON.stringify(seen.plan)}, not one ${expect.agent} row on Current tree`)
  if (!seen.launchEnabled) failures.push('the Launch button is not enabled')
  if (failures.length > 0) return { clicked: false, failures, seen }
  button.click()
  return { clicked: true, failures, seen }
}

/**
 * C39, B1: a Solo, one-slot, Current tree launch of `expect.agent` on `expect.credentialId` (and the
 * launch profile `expect.profile`, or none) from the open dialog. Clicks the Workspace section's
 * Current tree card when that section exists, then checks everything and clicks Launch in ONE page
 * evaluation (inPageGuardedLaunch); a failed expectation throws without clicking, after proving no
 * session and no stub appeared. Then waits for the dialog to close, one new session id and one new
 * capture. Returns `{ sessionId, capture }`.
 */
async function launchSolo(expect) {
  await evaluate(
    `(() => { const section = Array.from(document.querySelectorAll('.launch .launch-section')).find((s) => { const l = s.querySelector(':scope > .overlay-label'); return l !== null && l.textContent.trim() === 'Workspace' }); if (!section) return 'none'; const card = Array.from(section.querySelectorAll('.overlay-card')).find((c) => (c.querySelector('.launch-mode-name') || {}).textContent?.trim() === 'Current tree'); if (card) card.click(); return 'clicked' })()`
  )
  await sleep(200)
  const idsBefore = (await sessionList()).map((s) => s.id)
  const capturesBefore = listCaptures()
  await waitFor(`(() => { const b = document.querySelector('.launch-foot .overlay-btn-primary'); return b !== null && !b.disabled })()`, 10_000)
  const guarded = await call(inPageGuardedLaunch, expect)
  if (!guarded.clicked) {
    await sleep(1_000)
    const idsAfter = (await sessionList()).map((s) => s.id)
    const capturesAfter = listCaptures()
    throw new Error(
      `launch refused before any click: ${guarded.failures.join('; ')}; seen ${show(guarded.seen)}; ` +
        `sessions ${idsBefore.length} -> ${idsAfter.length}, stub captures ${capturesBefore.length} -> ${capturesAfter.length}`
    )
  }
  const deadline = Date.now() + 20_000
  let dialogGone = false, newIds = [], newCaptures = []
  for (;;) {
    dialogGone = await evaluate(absent(DIALOG))
    newIds = (await sessionList()).map((s) => s.id).filter((id) => !idsBefore.includes(id))
    newCaptures = listCaptures().filter((name) => !capturesBefore.includes(name))
    if ((dialogGone && newIds.length > 0 && newCaptures.length > 0) || Date.now() >= deadline) break
    await sleep(200)
  }
  STARTED.push(...newIds.filter((id) => !STARTED.includes(id)))
  if (!(dialogGone && newIds.length === 1 && newCaptures.length === 1)) {
    throw new Error(`the launch did not complete as one session and one stub: ${show({ dialogGone, newSessions: newIds.length, newCaptures: newCaptures.length })}; ${await domSummary()}`)
  }
  return { sessionId: newIds[0], capture: readCapture(newCaptures[0]) }
}

/** Stops a session through the app and confirms by pid (C44). Returns null or a detail; never throws. */
async function killAndConfirm(sessionId, pid) {
  try {
    await page(`await chorus.killSession(${J(sessionId)}); return true`)
    const deadline = Date.now() + 10_000
    let status = null
    let alive = true
    for (;;) {
      status = (await sessionList()).find((s) => s.id === sessionId)?.status ?? null
      alive = isAlive(pid)
      if ((status !== 'running' && !alive) || Date.now() >= deadline) break
      await sleep(250)
    }
    // A pid that is alive but no longer names the stub was reused by another process: the stub is gone.
    if (alive) alive = stubRunning(pid)
    return status !== 'running' && !alive ? null : `killSession(${sessionId}): status ${status}, stub pid ${pid} ${alive ? 'still alive' : 'gone'}`
  } catch (err) {
    return `killSession(${sessionId}) failed: ${err instanceof Error ? err.message : String(err)}`
  }
}

// ── Positive controls for L19: each watcher must catch a known error, or "no error" proves nothing ──
const PROBE_CONSOLE = '__routing_launch_console_probe__'
const PROBE_THROW = '__routing_launch_exception_probe__'
const PROBE_REJECT = '__routing_launch_rejection_probe__'
const hookControl = { console: false, exception: false, rejection: false }
async function installWatchers() {
  rendererErrors.length = 0
  await evaluate(`(() => {
    window.__routingLaunchErrors = []
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason
      window.__routingLaunchErrors.push(String(reason && reason.message ? reason.message : reason))
    })
    console.error(${JSON.stringify(PROBE_CONSOLE)})
    setTimeout(() => { throw new Error(${JSON.stringify(PROBE_THROW)}) }, 0)
    Promise.reject(new Error(${JSON.stringify(PROBE_REJECT)}))
    return true
  })()`)
  for (let i = 0; i < 30; i++) {
    const rejections = await evaluate('window.__routingLaunchErrors.slice()')
    hookControl.console = rendererErrors.some((e) => e.includes(PROBE_CONSOLE))
    hookControl.exception = rendererErrors.some((e) => e.includes(PROBE_THROW))
    hookControl.rejection = rejections.some((e) => e.includes(PROBE_REJECT))
    if (hookControl.console && hookControl.exception && hookControl.rejection) break
    await sleep(100)
  }
  console.log(`# L19 controls: ${show(hookControl)}`)
}
async function clearErrors() {
  rendererErrors.length = 0
  await evaluate('(() => { window.__routingLaunchErrors.length = 0; return true })()')
}

// ── Run 1: the bootstrap over the real IPC (L1's first half) ──
async function runBootstrap() {
  const details = []
  const projects = await page('return await chorus.listProjects()')
  const active = (projects ?? []).filter((p) => p.active)
  details.push(eq('active projects', active.length, 1))
  PROJECT = active[0]?.id ?? null
  const ctx = await page(`return await chorus.getLaunchContext(${J(PROJECT)})`)
  PROJECT_ROOT = ctx?.projectRoot ?? null
  details.push(that('the active project root is the repository', samePath(PROJECT_ROOT, ROOT), PROJECT_ROOT))

  const pa = await page(`return await chorus.createProvider(${J(PROVIDER_A)})`)
  const pb = await page(`return await chorus.createProvider(${J(PROVIDER_B)})`)
  PA = pa?.ok === true ? pa.provider.id : null
  PB = pb?.ok === true ? pb.provider.id : null
  details.push(that('provider:create A ok', PA !== null, pa), that('provider:create B ok', PB !== null, pb))
  const ca = await page(`return await chorus.createCredential({ providerId: ${J(PA)}, label: ${J(CREDENTIAL_A_LABEL)}, key: ${J(KEY_A)} })`)
  const cb = await page(`return await chorus.createCredential({ providerId: ${J(PB)}, label: ${J(CREDENTIAL_B_LABEL)}, key: ${J(KEY_B)} })`)
  CA = ca?.ok === true ? ca.id : null
  CB = cb?.ok === true ? cb.id : null
  details.push(that('credential:create A ok', CA !== null, ca), that('credential:create B ok', CB !== null, cb))

  const routable = await page('return await routing.credentials({})')
  details.push(eq('routing:credentials (B refused)', routable, { ok: true, value: { credentials: [{ id: CA, label: CREDENTIAL_A_LABEL, providerName: PROVIDER_A.name }] } }))

  const lp = await page(`return await chorus.createLaunchProfile(${J({ ...PROFILE, provider_id: PA, credential_profile_id: CA })})`)
  LP = lp?.ok === true ? lp.profile.id : null
  details.push(
    that('launch-profile:create ok', LP !== null, lp),
    eq('launch profile wire', lp?.profile && { model: lp.profile.model, credential_profile_id: lp.profile.credential_profile_id, disabled_reason: lp.profile.disabled_reason }, { model: SLUG, credential_profile_id: CA, disabled_reason: null })
  )
  const s1 = await page(`return await chorus.setModelShortlisted(${J(PA)}, ${J(SLUG)}, true)`)
  const s2 = await page(`return await chorus.setModelShortlisted(${J(PA)}, ${J(NITRO_ID)}, true)`)
  details.push(eq('shortlist after the first add', s1, { ok: true, shortlist: [SLUG] }), eq('shortlist', s2, { ok: true, shortlist: [SLUG, NITRO_ID] }))
  const status = await page('return await routing.status({})')
  details.push(okValue('routing:status', status), eq('requestsSinceStart (run 1)', status?.value?.requestsSinceStart, 0))
  return every(details)
}

/** Between the runs (C36): L1's database half, the catalog row, the fresh snapshot and the home state seed. */
async function seedBetweenRuns() {
  let db = null
  const details = []
  try {
    const { DatabaseSync } = await import('node:sqlite') // Node 22's built-in, as src/main/db/schema.test.ts uses
    db = new DatabaseSync(DB_PATH)
    const migrations = db.prepare('SELECT COUNT(*) AS n, MAX(version) AS v FROM schema_migrations').get()
    details.push(eq('schema_migrations COUNT(*), MAX(version)', [migrations?.n, migrations?.v], [28, 28]))
    const column = db.prepare('PRAGMA table_info(sessions)').all().find((c) => c.name === 'routing_json')
    details.push(that('sessions has routing_json', column !== undefined))
    const now = new Date().toISOString()
    const insert = db
      .prepare(
        'INSERT INTO model_catalog (provider_id, model_id, display_name, context_length, expires_at, first_seen_at, refreshed_at, missing_since, reasoning_efforts) VALUES (?, ?, ?, NULL, NULL, ?, ?, NULL, ?)'
      )
      .run(PA, SLUG, DISPLAY_NAME, now, now, '["low","medium","high"]')
    details.push(eq('model_catalog rows inserted', Number(insert.changes), 1))
  } catch (err) {
    details.push(`the throwaway chorus.db could not be read or seeded: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    db?.close()
  }
  // The fresh snapshot: the golden fixture re-dated to five minutes ago in whole seconds (never in the future).
  FRESH_AT = wholeSecondsAgo(300_000)
  writeSnapshot(FRESH_AT)
  writeAtomic(path.join(MODEL_DIR, 'observations.json'), seed.observationsFileText(SLUG, seed.extractObservations({ fetchedAt: FRESH_AT, endpoints: ENDPOINTS })))
  console.log(`# seeded ${ENDPOINTS.length} endpoint rows, fetchedAt ${FRESH_AT}`)
  // MR-D25 lands in the throwaway home; its seed holds an entry for each model this drive launches.
  fs.mkdirSync(path.dirname(HOME_STATE), { recursive: true })
  fs.writeFileSync(HOME_STATE, JSON.stringify(STATE_SEED))
  SEED_BYTES = fs.readFileSync(HOME_STATE)
  return every(details)
}

// ── Run 2: the dialog (L2-L14) ──
async function runChecks() {
  await installWatchers()

  await check('L2 stub is OpenCode 1.18.33', async () => {
    const clis = await page('return await chorus.detectClis(true)')
    const row = (clis ?? []).find((c) => c.name === 'opencode') ?? null
    await clearErrors() // L19 counts from the dialog's first open
    await openDialog()
    const versionShown = `(() => { const card = Array.from(document.querySelectorAll('.launch .launch-agent')).find((e) => (e.querySelector('.launch-agent-name') || {}).textContent?.trim() === 'opencode'); return card ? card.querySelector('.launch-agent-ver').textContent.trim() : null })()`
    await waitFor(`${versionShown} === ${JSON.stringify(STUB_VERSION)}`, 10_000)
    return every(
      eq('detectClis(true) opencode found/version', row && [row.found, row.version], [true, STUB_VERSION]),
      that('detectClis(true) opencode path is the stub', samePath(row?.path, STUB_CMD), row?.path),
      eq('the opencode card version', await evaluate(versionShown), STUB_VERSION)
    )
  })

  await check('L3 section only when eligible', async () => {
    await openDialog()
    const details = []
    const chip = await call(inPageProfileChip)
    details.push(that('no profile is preselected', chip === null || chip === 'No profile', chip))
    // A found non-opencode agent card selected: no section.
    const selectedName = await evaluate(`(() => { const c = document.querySelector('.launch .launch-agent.overlay-card-selected .launch-agent-name'); return c ? c.textContent.trim() : null })()`)
    let other = selectedName !== null && selectedName !== 'opencode' ? selectedName : null
    if (other === null) {
      other = await evaluate(
        `(() => { const card = Array.from(document.querySelectorAll('.launch .launch-agent')).find((e) => !e.disabled && (e.querySelector('.launch-agent-name') || {}).textContent?.trim() !== 'opencode'); if (!card) return null; card.click(); return card.querySelector('.launch-agent-name').textContent.trim() })()`
      )
      await sleep(500)
    }
    if (other === null) console.log('# L3: no found non-opencode agent; that step is skipped')
    else details.push(that(`no [data-routing-launch] with ${other} selected`, await evaluate(absent('[data-routing-launch]'))))
    // opencode on subscription: no section.
    await pickAgent('opencode')
    await sleep(500)
    details.push(
      that('the subscription auth segment is on', await evaluate(`Array.from(document.querySelectorAll('.launch .overlay-segment-alt-on')).some((e) => e.textContent.trim() === 'subscription')`)),
      that('no [data-routing-launch] for opencode on subscription', await evaluate(absent('[data-routing-launch]')))
    )
    // The routable credential first: the section appears and is ready, which also proves the store's
    // four free reads have landed (`loaded`), so the absence below cannot be a store still loading (N4).
    await pickAuth('api key')
    await pickCredential(CA)
    details.push(that('the section is ready on the routable credential', await waitFor(present('[data-routing-launch][data-routing-launch-ready="true"]'), 10_000)))
    // An API-key credential that routing refuses (C41): the section goes, stays gone, and no "unavailable" line.
    await pickCredential(CB)
    const gone = await waitFor(absent('[data-routing-launch]'), 5_000)
    await sleep(1_000)
    details.push(
      that('the section disappears on the non-routable credential', gone),
      that('the section stays absent on the non-routable credential', await evaluate(absent('[data-routing-launch]'))),
      that('no [data-routing-unavailable] on the non-routable credential', await evaluate(absent('[data-routing-unavailable]')))
    )
    // Back to the routable credential for L4: the section returns, ready.
    await pickCredential(CA)
    details.push(that('the section is ready again on the routable credential', await waitFor(present('[data-routing-launch][data-routing-launch-ready="true"]'), 10_000)))
    return every(details)
  })

  await check('L4 nitro id takes base efforts', async () => {
    await pickModel(NITRO_ID)
    await waitFor(`${absent('[data-routing-launch]')} && ${present('[data-launch-model-effort]')}`, 5_000)
    const nitro = await evaluate(
      `(() => ({ section: document.querySelector('[data-routing-launch]') !== null, efforts: Array.from(document.querySelectorAll('[data-launch-model-effort]')).map((e) => e.textContent.trim()) }))()`
    )
    await pickModel(null)
    const back = await waitFor(present('[data-routing-launch][data-routing-launch-ready="true"]'), 10_000)
    return every(
      eq('[data-routing-launch] for the :nitro id', nitro.section, false),
      eq('[data-launch-model-effort] for the :nitro id', nitro.efforts, ['Low', 'Medium', 'High']),
      that('the section is back and ready on the route default', back)
    )
  })

  await check('L5 balanced preselected on a fresh seed', async () => {
    await routingReady()
    const r = await readRouting()
    const details = [
      eq('data-routing-choice-selected', r.selected, 'balanced'),
      eq('choices', (r.choices ?? []).map((c) => c.choice), CHOICES),
      eq('checked radios', (r.choices ?? []).filter((c) => c.checked).map((c) => c.choice), ['balanced']),
      eq('disabled radios', (r.choices ?? []).filter((c) => c.disabled !== false).map((c) => c.choice), []),
      eq('[data-routing-launch-hint]', r.hint, null),
      eq('[data-routing-caption]', r.caption, CAPTION_NO_EFFORT),
      that('[data-routing-age] reads Updated 5-9 min ago', typeof r.age === 'string' && /^Updated [5-9] min ago$/.test(r.age), r.age),
      eq('[data-routing-stale]', r.stale, null),
      eq('[data-routing-refresh]', r.refresh, { text: 'Refresh', disabled: false, title: REFRESH_COST }), // never clicked: it would spend
      eq('[data-routing-default-description]', r.defaultDescription, DEFAULT_DESC)
    ]
    const tiers = await T(null)
    details.push(okValue('routing:tiers', tiers))
    if (tiers?.ok === true) {
      for (const tier of RANKED) {
        const selection = tiers.value.tiers[tier]
        details.push(selection === null ? `main ranked nothing for ${tier}` : eq(`${tier} [data-routing-primary]`, choiceOf(r, tier)?.primary, selection.endpoints[0]))
      }
      console.log(`# L5 main's order at ${tiers.value.computedAt}: ${RANKED.map((t) => `${t} ${tiers.value.tiers[t]?.endpoints.join(' > ')}`).join('; ')}`)
    }
    // 4a-4 shipped without the dialog's own `<style src="settings.css">` (I7): prove settings.css styles the section anyway.
    const css = await call(inPageSettingsCss)
    if (css.error) details.push(`settings.css probe: ${css.error}`)
    else {
      const cardRule = css.rules['.set-card'][0] ?? null
      const hintRule = css.rules['.set-hint-warn'][0] ?? null
      console.log(
        `# L5 settings.css: .set-card rule in ${cardRule?.sheet} (${css.rules['.set-card'].length} rule(s)); budget card ${show(css.card)} vs classless control ${show(css.bareCard)}; ` +
          `Nitro .set-hint-warn ${show(css.hint)} vs classless control ${show(css.bareHint)}; tokens surface-inset ${css.surfaceInset}, attention-text ${css.attentionText}`
      )
      details.push(
        eq('unscoped .set-card rules in the page', css.rules['.set-card'].length, 1),
        eq('unscoped .set-hint-warn rules in the page', css.rules['.set-hint-warn'].length, 1),
        that('the .set-card rule is settings.css (overflow hidden, 1px border, surface-inset background)', cardRule !== null && cardRule.overflow === 'hidden' && /^1px solid var\(--color-border-inset\)$/.test(cardRule.border) && cardRule.background.includes('var(--color-surface-inset)'), cardRule),
        that('the .set-hint-warn rule is settings.css (10px, 1.4, attention text)', hintRule !== null && hintRule.fontSize === '10px' && hintRule.lineHeight === '1.4' && hintRule.color.includes('var(--color-state-attention-text)'), hintRule),
        eq('budget .set-card computed', css.card, { overflowX: 'hidden', overflowY: 'hidden', borderTopWidth: '1px', borderTopStyle: 'solid', backgroundColor: css.surfaceInset }),
        that('the surface-inset token resolves to a colour', css.surfaceInset !== 'rgba(0, 0, 0, 0)' && css.surfaceInset !== '', css.surfaceInset),
        // The app's global reset gives every element `border: 0 solid`, so the control's style is solid at 0px.
        eq('classless section control', { ...css.bareCard, borderTopStyle: undefined }, { overflowX: 'visible', overflowY: 'visible', borderTopWidth: '0px', borderTopStyle: undefined, backgroundColor: 'rgba(0, 0, 0, 0)' }),
        eq('Nitro .set-hint-warn computed', css.hint, { fontSize: '10px', lineHeight: '14px', color: css.attentionText }),
        that('the classless <p> control differs in size and colour', css.bareHint.fontSize !== '10px' && css.bareHint.color !== css.attentionText, css.bareHint)
      )
    }
    await shot('launch-fresh.png')
    return every(details)
  })

  await check('L6 balanced launch (bare credential)', async () => {
    const bal = await T(null)
    if (bal?.ok !== true || !bal.value.tiers.balanced) throw new Error(`routing:tiers: ${show(bal)}`)
    const { sessionId, capture } = await launchSolo({ agent: 'opencode', credentialId: CA, profile: null })
    S.S1 = sessionId
    P.P1 = capture
    const details = []
    try {
      L6_TIERS_AT = bal.value.computedAt
      console.log(`# L6 routing:tiers computedAt ${bal.value.computedAt}; the stub started at ${capture.at}`)
      details.push(
        eq('P1.argv', capture.argv, ['-m', 'openrouter/' + SLUG]),
        contentEquals('content(P1)', capture, { provider: { openrouter: { models: { [SLUG]: { options: { provider: bal.value.tiers.balanced.provider } } } } } }),
        that('P1 OPENROUTER_API_KEY is the routing credential\'s key', envGet(capture.env, 'OPENROUTER_API_KEY') === KEY_A),
        that('P1 USERPROFILE is the throwaway home', samePath(envGet(capture.env, 'USERPROFILE'), HOME_DIR), envGet(capture.env, 'USERPROFILE')),
        that('no XDG_STATE_HOME in P1.env', envGet(capture.env, 'XDG_STATE_HOME') === undefined),
        that('no OPENCODE_CONFIG in P1.env (no effort, no memory)', envGet(capture.env, 'OPENCODE_CONFIG') === undefined),
        that('P1.cwd is the project root', samePath(capture.cwd, PROJECT_ROOT), capture.cwd),
        stateIsSeed('L6')
      )
    } finally {
      details.push(await killAndConfirm(sessionId, capture.pid))
    }
    return every(details)
  })

  await check('L7 remembered choice, profile launch', async () => {
    const prefs = await page('return await routing.launchPreferences({})')
    const details = [eq('routing:launch-preferences', prefs, { ok: true, value: { lastChoiceByModel: { [SLUG]: 'balanced' } } })]
    await openDialog()
    await pickProfile(PROFILE.label)
    await routingReady()
    const r = await readRouting()
    details.push(eq('data-routing-choice-selected (remembered)', r.selected, 'balanced'), eq('[data-routing-launch-hint]', r.hint, null))
    const bal2 = await T(null)
    if (bal2?.ok !== true || !bal2.value.tiers.balanced) throw new Error(`routing:tiers: ${show(bal2)}`)
    const { sessionId, capture } = await launchSolo({ agent: 'opencode', credentialId: CA, profile: PROFILE.label })
    S.S2 = sessionId
    P.P2 = capture
    try {
      details.push(
        eq('P2.argv', capture.argv, ['-m', 'openrouter/' + SLUG]),
        contentEquals('content(P2)', capture, { provider: { openrouter: { models: { [SLUG]: { options: { provider: bal2.value.tiers.balanced.provider } } } } } })
      )
    } finally {
      details.push(await killAndConfirm(sessionId, capture.pid))
    }
    return every(details)
  })

  await check('L8 relaunch re-applies the selection', async () => {
    if (!S.S2 || !P.P2) throw new Error('no S2 to relaunch')
    STALE_AT = wholeSecondsAgo(2 * 3_600_000)
    writeSnapshot(STALE_AT)
    console.log(`# L8 re-seeded the snapshot with fetchedAt ${STALE_AT}`)
    const tiers = await T(null)
    const details = [okValue('routing:tiers on the stale seed', tiers), eq('routing:tiers stale', tiers?.value?.stale, true)]
    const before = listCaptures()
    RELAUNCH_AT = Date.now()
    const reply = await page(`return await chorus.relaunchSession(${J(S.S2)})`)
    details.push(that('relaunchSession(S2) is not { ok: false }', reply !== null && typeof reply === 'object' && reply.ok !== false, reply?.reason))
    const fresh = await waitNewCaptures(before, 20_000)
    if (fresh.length !== 1) {
      details.push(`expected one new capture after the relaunch, found ${fresh.length}`)
      return every(details)
    }
    const capture = readCapture(fresh[0])
    P.P2r = capture
    try {
      details.push(
        that('P2r has a new pid', capture.pid !== P.P2.pid, capture.pid),
        eq('P2r.argv', capture.argv, P.P2.argv),
        that('content(P2) is present', contentOf(P.P2) !== null),
        that('content(P2r) is present', contentOf(capture) !== null),
        eq('content(P2r) equals content(P2)', contentOf(capture), contentOf(P.P2)),
        stateIsSeed('L8')
      )
    } finally {
      details.push(await killAndConfirm(S.S2, capture.pid))
    }
    return every(details)
  })

  await check('L9 stale seed in the dialog', async () => {
    await openDialog()
    await ensureProfileChip()
    await routingReady()
    const r = await readRouting()
    const details = []
    for (const tier of RANKED) {
      const c = choiceOf(r, tier)
      details.push(eq(`${tier} [radio disabled, disabled reason, data-routing-disabled]`, c && [c.disabled, c.disabledReason, c.dataDisabled], [true, STALE_REASON, 'true']))
    }
    for (const choice of ['nitro', 'default']) details.push(eq(`${choice} radio disabled`, choiceOf(r, choice)?.disabled, false))
    details.push(
      eq('[data-routing-stale]', r.stale, STALE_TEXT),
      eq('data-routing-choice-selected', r.selected, 'default'),
      eq('[data-routing-launch-hint]', r.hint, BALANCED_HINT)
    )
    const pick = (reading) => ({ selected: reading.selected, hint: reading.hint, choices: reading.choices })
    await click('[data-routing-launch] [data-routing-choice="balanced"] [data-routing-reason]')
    await sleep(400)
    details.push(eq('after a click on the disabled Balanced card', pick(await readRouting()), pick(r)))
    await shot('launch-stale.png')
    return every(details)
  })

  await check('L10 main refuses a forced stale tier', async () => {
    const idsBefore = (await sessionList()).map((s) => s.id)
    const capturesBefore = listCaptures()
    const reply = await page(
      `return await chorus.launch({ project_id: ${J(PROJECT)}, agent: 'opencode', cwd: ${J(PROJECT_ROOT)}, workspace_mode: 'current-tree', credential_profile_id: ${J(CA)}, routing_tier: 'balanced' })`
    )
    if (reply && reply.ok !== false && typeof reply.sessionId === 'string') STARTED.push(reply.sessionId)
    await sleep(1_000)
    return every(
      eq('session:launch reply', reply, { ok: false, reason: STALE_REFUSAL }),
      eq('session ids', (await sessionList()).map((s) => s.id), idsBefore),
      eq('captures', listCaptures(), capturesBefore),
      stateIsSeed('L10')
    )
  })

  await check('L11 nitro launch with an effort', async () => {
    await openDialog() // the L9 dialog is still open
    await ensureProfileChip()
    await pickEffort('Low')
    await routingReady()
    const r = await readRouting()
    const details = [eq('[data-routing-caption]', r.caption, CAPTION_LOW)]
    await pickTier('nitro')
    await shot('launch-nitro.png')
    const { sessionId, capture } = await launchSolo({ agent: 'opencode', credentialId: CA, profile: PROFILE.label })
    S.S3 = sessionId
    P.P3 = capture
    try {
      details.push(
        eq('P3.argv', capture.argv, ['-m', 'openrouter/' + NITRO_ID]),
        contentEquals('content(P3)', capture, { provider: { openrouter: { models: { [NITRO_ID]: { options: { provider: { data_collection: 'deny' } }, variants: VARIANTS } } } } }),
        that('P3 OPENCODE_CONFIG is the profile\'s mcp/opencode.json', samePath(envGet(capture.env, 'OPENCODE_CONFIG'), MCP_FILE), envGet(capture.env, 'OPENCODE_CONFIG')),
        mcpAgentBuild('L11', { model: 'openrouter/' + NITRO_ID, variant: 'low' }),
        stateEquals('L11', { ...STATE_SEED, variant: { ...STATE_SEED.variant, ['openrouter/' + NITRO_ID]: 'low' } }),
        that('TMP/xdg-state is empty', isEmptyDir(XDG_STATE)),
        that('TMP/xdg-data is empty', isEmptyDir(XDG_DATA))
      )
    } finally {
      details.push(await killAndConfirm(sessionId, capture.pid))
    }
    return every(details)
  })

  await check('L12 OpenRouter default launch', async () => {
    const prefs = await page('return await routing.launchPreferences({})')
    const details = [okValue('routing:launch-preferences after Nitro', prefs, { lastChoiceByModel: { [SLUG]: 'nitro' } })]
    await openDialog()
    await ensureProfileChip()
    await routingReady()
    const r = await readRouting()
    details.push(eq('data-routing-choice-selected (remembered Nitro)', r.selected, 'nitro'), eq('[data-routing-launch-hint]', r.hint, null))
    await pickEffort('Medium')
    await routingReady()
    await pickTier('default')
    const { sessionId, capture } = await launchSolo({ agent: 'opencode', credentialId: CA, profile: PROFILE.label })
    S.S4 = sessionId
    P.P4 = capture
    try {
      details.push(
        eq('P4.argv', capture.argv, ['-m', 'openrouter/' + SLUG]),
        that('no OPENCODE_CONFIG_CONTENT in P4.env', envGet(capture.env, 'OPENCODE_CONFIG_CONTENT') === undefined),
        mcpAgentBuild('L12', { model: 'openrouter/' + SLUG, variant: 'medium' }),
        stateEquals('L12', { ...STATE_SEED, variant: { ...STATE_SEED.variant, ['openrouter/' + SLUG]: 'medium', ['openrouter/' + NITRO_ID]: 'low' } })
      )
    } finally {
      details.push(await killAndConfirm(sessionId, capture.pid))
    }
    const after = await page('return await routing.launchPreferences({})')
    details.push(okValue('routing:launch-preferences after OpenRouter default', after, { lastChoiceByModel: { [SLUG]: 'default' } }))
    await openDialog()
    await ensureProfileChip()
    await routingReady()
    const again = await readRouting()
    details.push(eq('data-routing-choice-selected (remembered default)', again.selected, 'default'), eq('[data-routing-launch-hint] (remembered default)', again.hint, null))
    await clickText('.launch-foot .overlay-btn-ghost', 'Cancel')
    details.push(that('the dialog closed on Cancel', await waitFor(absent(DIALOG), 5_000)))
    return every(details)
  })

  await check('L13 picked nitro id with an effort (K13)', async () => {
    await openDialog()
    await ensureProfileChip()
    await pickModel(NITRO_ID)
    const gone = await waitFor(absent('[data-routing-launch]'), 5_000)
    await pickEffort('High')
    const details = [that('no [data-routing-launch] for the picked :nitro id', gone && (await evaluate(absent('[data-routing-launch]'))))]
    const { sessionId, capture } = await launchSolo({ agent: 'opencode', credentialId: CA, profile: PROFILE.label })
    S.S5 = sessionId
    P.P5 = capture
    try {
      details.push(
        eq('P5.argv', capture.argv, ['-m', 'openrouter/' + NITRO_ID]),
        contentEquals('content(P5) (variants, no options)', capture, { provider: { openrouter: { models: { [NITRO_ID]: { variants: VARIANTS } } } } }),
        mcpAgentBuild('L13', { model: 'openrouter/' + NITRO_ID, variant: 'high' }),
        stateEquals('L13', { recent: [], favorite: [], variant: { ['openrouter/' + SLUG]: 'medium', ['openrouter/' + NITRO_ID]: 'high', 'openrouter/z-ai/glm-5.3': 'high' } })
      )
    } finally {
      details.push(await killAndConfirm(sessionId, capture.pid))
    }
    const prefs = await page('return await routing.launchPreferences({})')
    details.push(okValue('routing:launch-preferences (an unrouted launch records nothing)', prefs, { lastChoiceByModel: { [SLUG]: 'default' } }))
    return every(details)
  })

  await check('L14 no OpenRouter request', async () => {
    const status = await page('return await routing.status({})')
    bodyText = await evaluate('document.body.innerText')
    return every(okValue('routing:status', status), eq('requestsSinceStart', status?.value?.requestsSinceStart, 0))
  })
}

/** Run 2's end: every session this drive started is stopped through the app, confirmed by pid. */
async function stopStartedSessions() {
  const pidOf = new Map([[S.S1, P.P1], [S.S2, P.P2r ?? P.P2], [S.S3, P.P3], [S.S4, P.P4], [S.S5, P.P5]].filter(([id, c]) => id && c).map(([id, c]) => [id, c.pid]))
  const sessions = await sessionList()
  for (const id of STARTED) {
    const status = sessions.find((s) => s.id === id)?.status
    if (status === 'running') {
      const detail = await killAndConfirm(id, pidOf.get(id) ?? -1)
      if (detail !== null) console.log(`# ${redact(detail)}`)
    }
  }
}

// ── Run ──
let setupError = null
let run2Ran = false
// L1 has two halves; each stays a failure until it has actually completed (N2).
let l1Run1Detail = 'run 1 did not complete its bootstrap'
let l1SeedDetail = 'the between-runs seed did not complete (no catalog row, snapshot or home state seed)'
try {
  // Run 1 (bootstrap).
  const run1 = await startRun('run1')
  try {
    await connect()
    l1Run1Detail = await runBootstrap()
  } finally {
    await stopRun(run1)
  }
  if (run1.childExit === null) throw new Error('run 1 is still running')
  assertNotInterrupted()
  l1SeedDetail = await seedBetweenRuns()
  record('L1 bootstrap', every(l1Run1Detail, l1SeedDetail))

  // S2: run 2 launches agents in the seeded project, so it must be THIS checkout.
  if (!samePath(PROJECT_ROOT, ROOT)) throw new Error(`the seeded project root is ${PROJECT_ROOT}, not this checkout (${ROOT}); run 2 refused`)
  assertNotInterrupted()

  // Run 2 (checks).
  RUN2_START = Date.now()
  const run2 = await startRun('run2')
  try {
    await connect()
    run2Ran = true
    await runChecks()
    await stopStartedSessions().catch((err) => console.log(`# stopping the started sessions failed: ${err instanceof Error ? err.message : String(err)}`))
    pageRejections = await evaluate('Array.isArray(window.__routingLaunchErrors) ? window.__routingLaunchErrors.slice() : null').catch(() => null)
  } finally {
    await stopRun(run2)
    RUN2_END = Date.now()
  }
} catch (err) {
  setupError = err instanceof Error ? err.message : String(err)
  console.log(`FAIL drive: ${redact(setupError)}`)
  if (run !== null && run.childExit === null) await stopRun(run)
}
if (!results.has('L1 bootstrap')) record('L1 bootstrap', every(l1Run1Detail, l1SeedDetail, setupError === null ? null : `(${setupError})`))
// S6: after an interrupt, go no further; the handler deletes the root and exits 1 (it holds the loop open).
if (interrupted) await new Promise((resolve) => setTimeout(resolve, 120_000))

// ── After exit: L15-L19 ──
const ALL_CAPTURES = ['P1', 'P2', 'P2r', 'P3', 'P4', 'P5']
if (run2Ran) {
  await check('L15 stub processes', async () => {
    const files = listCaptures()
    const captures = files.map(readCapture)
    const pids = captures.map((c) => c.pid)
    const known = ALL_CAPTURES.map((k) => P[k]?.pid ?? null)
    const alive = pids.filter((pid) => stubRunning(pid)) // a pid now naming another process was reused: gone
    const outcomes = alive.map((pid) => `${pid}: ${lastResortKill(pid)}`)
    return every(
      eq('capture files', files.length, 6),
      eq('capture pids are P1, P2, P2r, P3, P4, P5', [...pids].sort((a, b) => a - b), [...known].sort((a, b) => a - b)),
      alive.length === 0 ? null : `stub pid(s) still alive after the app exited (last resort: ${outcomes.join('; ')})`
    )
  })

  await check('L16 database after exit', async () => {
    let db = null
    try {
      const { DatabaseSync } = await import('node:sqlite')
      db = new DatabaseSync(DB_PATH)
      const details = []
      const migrations = db.prepare('SELECT COUNT(*) AS n, MAX(version) AS v FROM schema_migrations').get()
      details.push(eq('schema_migrations COUNT(*), MAX(version)', [migrations?.n, migrations?.v], [28, 28]))
      const rowOf = (id) => (id ? db.prepare('SELECT routing_json FROM sessions WHERE id = ?').get(id) : undefined)
      const KEYS = ['computedAt', 'endpoints', 'model', 'provider', 'sentModelId', 'snapshotFetchedAt', 'tier']
      const inRun2 = (iso) => typeof iso === 'string' && ISO.test(iso) && Date.parse(iso) >= RUN2_START && Date.parse(iso) <= RUN2_END
      for (const [key, capture] of [['S1', P.P1], ['S2', P.P2]]) {
        const row = rowOf(S[key])
        if (!row || typeof row.routing_json !== 'string') {
          details.push(`${key}: routing_json is ${show(row?.routing_json ?? row)}`)
          continue
        }
        const sel = JSON.parse(row.routing_json)
        const provider = contentOf(capture)?.provider?.openrouter?.models?.[SLUG]?.options?.provider
        details.push(
          eq(`${key} keys`, Object.keys(sel).sort(), KEYS),
          eq(`${key} tier, model, sentModelId`, [sel.tier, sel.model, sel.sentModelId], ['balanced', SLUG, SLUG]),
          that(`${key} provider equals content(${key === 'S1' ? 'P1' : 'P2'})'s`, provider !== undefined && isDeepStrictEqual(sel.provider, provider), sel.provider),
          eq(`${key} endpoints equal provider.order`, sel.endpoints, sel.provider?.order),
          eq(`${key} snapshotFetchedAt`, sel.snapshotFetchedAt, FRESH_AT),
          that(`${key} computedAt is an ISO time within run 2`, inRun2(sel.computedAt), sel.computedAt)
        )
        if (key === 'S1') console.log(`# L16 S1 computedAt ${sel.computedAt} (main, at launch); L6's routing:tiers computedAt ${L6_TIERS_AT}`)
        if (key === 'S2') {
          details.push(that('S2 computedAt is earlier than the relaunch (no re-resolve, no rewrite)', RELAUNCH_AT !== null && Date.parse(sel.computedAt) < RELAUNCH_AT, { computedAt: sel.computedAt, relaunchAt: RELAUNCH_AT && new Date(RELAUNCH_AT).toISOString() }))
          console.log(`# L16 S2 computedAt ${sel.computedAt}; relaunch at ${RELAUNCH_AT && new Date(RELAUNCH_AT).toISOString()}`)
        }
      }
      const s3 = rowOf(S.S3)
      if (!s3 || typeof s3.routing_json !== 'string') details.push(`S3: routing_json is ${show(s3?.routing_json ?? s3)}`)
      else {
        const { computedAt, ...rest } = JSON.parse(s3.routing_json)
        details.push(
          eq('S3 selection', rest, { tier: 'nitro', model: SLUG, sentModelId: NITRO_ID, provider: { data_collection: 'deny' }, endpoints: [], snapshotFetchedAt: null }),
          that('S3 computedAt is an ISO time within run 2', inRun2(computedAt), computedAt)
        )
      }
      for (const key of ['S4', 'S5']) {
        const row = rowOf(S[key])
        details.push(row ? eq(`${key} routing_json`, row.routing_json, null) : `${key}: no session row`)
      }
      return every(details)
    } finally {
      db?.close()
    }
  })

  await check('L17 home and repository untouched', async () => {
    const hint = ' (an OpenCode TUI running during the drive may have written its own state)'
    const details = REAL_STATE_BASELINE.map(({ file, bytes }) => {
      const now = readBytesOrAbsent(file)
      const same = bytes === 'absent' ? now === 'absent' : now !== 'absent' && now.equals(bytes)
      return same ? null : `${file} changed${hint}`
    })
    // S1: the listing alone cannot see a further edit to an already-dirty file, so every path the
    // baseline or the current listing names is compared by content too.
    const status = gitStatus()
    const hashes = hashesOf([...Object.keys(STATUS_HASHES_BASELINE), ...statusPaths(status)])
    const changed = Object.keys(hashes).filter((p) => hashes[p] !== (STATUS_HASHES_BASELINE[p] ?? 'not listed at the start'))
    details.push(
      eq('git worktree list --porcelain', git('worktree', 'list', '--porcelain'), WORKTREES_BASELINE),
      eq('git status --porcelain=v1 -z --untracked-files=all', status.split('\0'), STATUS_BASELINE.split('\0')),
      changed.length === 0 ? null : `content changed since the start: ${changed.join(', ')}`
    )
    console.log(`# L17 compared ${Object.keys(hashes).length} dirty or untracked path(s) by SHA-256`)
    return every(details)
  })

  await check('L18 no key material', async () => {
    const scanInto = (into, label, text) => {
      if (typeof text !== 'string' || text.length === 0) return
      if (text.includes(KEY_A)) into.push(`${label} contains the routing credential's key`)
      if (text.includes(KEY_B)) into.push(`${label} contains the other credential's key`)
      const pattern = SECRET_PATTERNS.find(({ re }) => re.test(text))
      if (pattern) into.push(`${label} matches the ${pattern.name} pattern`)
    }
    const hits = []
    const scan = (label, text) => scanInto(hits, label, text)
    // Positive controls: the patterns match a concatenated sample; the REAL scan reports KEY_A planted
    // in a scratch string (into a scratch list, by name and by pattern); the key is where it is expected.
    const control = 'sk-or-v1-' + '0123456789abcdef'.repeat(2)
    const details = [that('the secret patterns match a sample (control)', SECRET_PATTERNS.some(({ re }) => re.test(control)))]
    const scratch = []
    scanInto(scratch, 'scratch', `planted ${KEY_A} here`)
    details.push(
      eq('the scan reports a planted key (control)', scratch, ["scratch contains the routing credential's key", 'scratch matches the openrouter pattern'])
    )
    const captures = listCaptures().map((name) => ({ name, capture: readCapture(name) }))
    details.push(
      that('six captures to scan', captures.length === 6, captures.length),
      that("every capture's OPENROUTER_API_KEY is the routing credential's key (control)", captures.length > 0 && captures.every(({ capture }) => envGet(capture.env, 'OPENROUTER_API_KEY') === KEY_A))
    )
    if (typeof bodyText !== 'string' || bodyText.length === 0) details.push('the page text was not read at L14')
    else scan('the page text', bodyText)
    responseTexts.forEach((text, i) => scan(`in-page response ${i + 1}`, text))
    details.push(that('in-page responses collected', responseTexts.length >= 20, responseTexts.length))
    for (const logPath of logPaths) scan(path.basename(logPath), fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '')
    scan('mcp/opencode.json', fs.existsSync(MCP_FILE) ? fs.readFileSync(MCP_FILE, 'utf8') : '')
    for (const { name, capture } of captures) {
      scan(`capture ${name} argv`, JSON.stringify(capture.argv))
      scan(`capture ${name} cwd`, capture.cwd)
      for (const [key, value] of Object.entries(capture.env ?? {})) if (key.toUpperCase() !== 'OPENROUTER_API_KEY') scan(`capture ${name} env ${key}`, String(value))
    }
    console.log(`# L18 scanned the page text, ${responseTexts.length} responses, ${logPaths.length} app logs, mcp/opencode.json and ${captures.length} captures`)
    return every(details, hits)
  })

  record('L19 no renderer errors', every(
    that('the console.error control was caught', hookControl.console),
    that('the exception control was caught', hookControl.exception),
    that('the unhandled-rejection control was caught', hookControl.rejection),
    that('the page watcher survived the drive (no reload)', Array.isArray(pageRejections), pageRejections),
    that('no error mentions "could not be cloned"', ![...rendererErrors, ...(pageRejections ?? [])].some((e) => /could not be cloned/.test(e))),
    eq('renderer errors since the dialog first opened', rendererErrors, []),
    eq('unhandled rejections since the dialog first opened', pageRejections, [])
  ))
} else {
  // Stubs this drive caused are still its responsibility, even when run 2 never got going.
  for (const line of stubLastResort()) console.log(`# stub ${line}`)
}
for (const name of CHECKS) if (name !== 'cleanup' && !results.has(name)) record(name, setupError === null ? 'not run' : `not run (${setupError})`)

if ([...results.values()].includes(false)) {
  // The logs hold no key (L18 says so); every line is still redacted before it is printed.
  for (const logPath of logPaths) {
    if (!fs.existsSync(logPath)) continue
    const tail = fs.readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean).slice(-30)
    for (const line of tail) console.log(`# ${path.basename(logPath)}| ${redact(line).slice(0, 300)}`)
  }
}

// ── cleanup: the throwaway root, the seed bundle, and nothing in OUT but the three PNGs ──
await sleep(1_000) // let the app's helper processes release the profile
const leftovers = stubLastResort() // normally nothing: every stub was stopped and confirmed
for (const line of leftovers) console.log(`# stub ${line}`)
const cleanupError = await deleteTmp()
deleteSeedBundle()
for (const entry of fs.readdirSync(OUT)) {
  if (!PNGS.includes(entry)) fs.rmSync(path.join(OUT, entry), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
const left = fs.readdirSync(OUT).sort()
record('cleanup', every(
  cleanupError === null ? null : `the throwaway root was not deleted: ${cleanupError}`,
  that('the seed bundle is gone', !fs.existsSync(SEED_BUNDLE)),
  eq(`${path.relative(ROOT, OUT)} holds`, left, [...PNGS].sort())
))

finish()

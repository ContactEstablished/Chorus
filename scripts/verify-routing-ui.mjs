// Model Routing Task 3-3: the isolated visual harness for the routing inspector's
// presentational components (ImplementationSpec-3-3, checks H1-H15).
//
// What it checks: RoutingTierCards, RoutingProviderTable and RoutingRefreshStatus,
// mounted from their real .vue files, render every state of the Phase 1 golden
// TierResult and its variants (no snapshot, nothing eligible, the Budget floor,
// Nitro passing, and the refresh running, done, failed and cooling down) with the
// exact Task 3-2 strings; the Nitro card's amber edge; the table's rows and its
// inner scroll at 900 px; that a disabled Refresh emits nothing; and isolation (no
// console error, no window.chorus, no network request, no sideways page scroll).
//
// Zero cost: it spends nothing, uses no credential and no Chorus profile, and
// starts no Chorus instance. The TierResults are computed here in Node from the
// esbuild-bundled Phase 1 cores (C16); the page builds its view models with the
// real routingView functions. The offscreen Electron child records and cancels
// every http, https, ws and wss request, and only that child (by its own handle)
// is ever stopped. It leaves only the eleven PNGs in _verify/routing-ui/.
//
// Usage: node scripts/verify-routing-ui.mjs   (from any directory)
// Last line: PASS (15 checks) with exit 0, or FAIL (k of 15 checks) with exit 1.
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, '_verify', 'routing-ui')
const CHECK_IDS = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8', 'H9', 'H10', 'H11', 'H12', 'H13', 'H14', 'H15']
const PNG_OF = {
  H1: 'cards.png', H5: 'providers.png', H6: 'no-snapshot.png', H7: 'empty.png', H8: 'budget-floor.png',
  H9: 'nitro-passes.png', H10: 'progress-running.png', H11: 'progress-done.png', H12: 'progress-failed.png',
  H13: 'cooldown.png', H15: 'narrow.png'
}
const CHILD_TIMEOUT_MS = 180_000

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })

// ── 3. States, computed in Node from the bundled cores (C16) ──
async function writeStates() {
  const coresFile = path.join(OUT, 'cores.cjs')
  await require('esbuild').build({
    stdin: {
      contents: [
        "export { computeTiers } from './src/main/routing/routingCore'",
        "export { parseEndpointsResponse, extractObservations } from './src/main/routing/endpointsCore'",
        "export { bundledModelRegistry, findModel } from './src/main/routing/registryCore'",
        "export { DEFAULT_ROUTING_SETTINGS } from './src/shared/routing'"
      ].join('\n'),
      resolveDir: ROOT,
      loader: 'ts',
      sourcefile: 'routing-ui-cores.ts'
    },
    outfile: coresFile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    logLevel: 'warning'
  })
  const cores = require(coresFile)

  // The Phase 1 golden input (ImplementationSpec-1-3), built as routingView.test.ts builds it.
  const fixture = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'src/main/routing/__fixtures__/endpoints-deepseek-v4.1-flash-2026-10-02.json'), 'utf8')
  )
  const SLUG = 'deepseek/deepseek-v4.1-flash'
  const MODEL = cores.findModel(cores.bundledModelRegistry(), SLUG)
  if (MODEL === null) throw new Error(`the bundled registry has no ${SLUG}`)
  const CHECKED_AT = '2026-10-02T09:15:39Z'
  const NOW = '2026-10-02T09:20:00Z'
  const snapshotOf = (json) => ({ fetchedAt: json.fetchedAt, endpoints: cores.parseEndpointsResponse(json).endpoints })
  const CACHE = Object.fromEntries(
    Object.entries(fixture.cacheVerified).map(([tag, verified]) => [tag, { verified, checkedAt: CHECKED_AT }])
  )
  const tiersFor = (settings, snapshot) =>
    cores.computeTiers({
      model: MODEL,
      snapshot,
      history: cores.extractObservations(snapshot),
      account: { guardrailRemoved: fixture.guardrailRemoved, dataPolicyRemoved: fixture.dataPolicyDenyRemoved, checkedAt: CHECKED_AT },
      cache: CACHE,
      profile: 'interactive',
      effort: 'low',
      settings,
      now: NOW
    })

  const D = cores.DEFAULT_ROUTING_SETTINGS
  const golden = snapshotOf(fixture)
  const nitroJson = structuredClone(fixture)
  const together = nitroJson.data.endpoints.find((e) => e.tag === 'together')
  if (together === undefined) throw new Error('the fixture has no together row')
  together.quantization = 'fp8'

  const settingsOf = {
    golden: D,
    empty: { ...D, minUptimePct: 100, readmitUptimePct: 100 },
    floor130: { ...D, budgetMinTps: 130 },
    floor1000: { ...D, budgetMinTps: 1000 },
    nitroPass: D
  }
  const states = {}
  for (const [name, settings] of Object.entries(settingsOf)) {
    states[name] = { result: tiersFor(settings, name === 'nitroPass' ? snapshotOf(nitroJson) : golden), settings }
  }
  fs.writeFileSync(path.join(OUT, 'states.json'), JSON.stringify(states))
}

// ── 4. The fixture page ──
function writeFixture() {
  fs.writeFileSync(
    path.join(OUT, 'index.html'),
    `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:"><title>Routing UI harness</title></head><body><div id="app"></div><script type="module" src="/fixture.ts"></script></body></html>\n`
  )
  fs.writeFileSync(
    path.join(OUT, 'fixture.css'),
    `/* Harness host only. main.css pins html, body and #app to the viewport with
   overflow: hidden, because the app scrolls inside .set-content. Here the
   document is the scroller, so anything that overflows sideways shows in
   document.documentElement.scrollWidth (H15) instead of being clipped away. */
html, body, #app { height: auto; min-height: 100%; overflow: visible; }
/* The page scrollbar as settings.css draws .set-content's. */
html::-webkit-scrollbar { width: 10px; height: 10px; }
html::-webkit-scrollbar-track { background: transparent; }
html::-webkit-scrollbar-thumb { background: var(--color-border-badge); border-radius: 5px; border: 3px solid transparent; background-clip: padding-box; }
.fx-host { padding: 22px 32px; }
/* SettingsRouting's root is max-w-4xl (56rem, Task 3-4). */
.fx-page { max-width: 56rem; }
`
  )
  fs.writeFileSync(
    path.join(OUT, 'fixture.ts'),
    `// @ts-nocheck: generated by scripts/verify-routing-ui.mjs; built by vite, never type-checked.
import { createApp, h, reactive } from 'vue'
import '../../src/renderer/src/assets/main.css'
import '../../src/renderer/src/assets/settings.css'
import './fixture.css'
import RoutingTierCards from '../../src/renderer/src/components/routing/RoutingTierCards.vue'
import RoutingProviderTable from '../../src/renderer/src/components/routing/RoutingProviderTable.vue'
import RoutingRefreshStatus from '../../src/renderer/src/components/routing/RoutingRefreshStatus.vue'
import {
  ROUTING_REFRESH_COST_TEXT, cooldownRemainingSeconds, nitroCardView, providerTableView, refreshButtonView,
  refreshProgressView, resultNotes, snapshotAgeView, tierCardViews
} from '../../src/shared/routingView'
import states from './states.json'

const NOW_MS = Date.parse('2026-10-02T09:20:00Z')
const SLUG = 'deepseek/deepseek-v4.1-flash'

// Table RV14's event fixtures (ImplementationSpec-3-2), built as routingView.test.ts builds them.
const R1 = '11111111-1111-4111-8111-111111111111'
const AT = '2026-10-02T09:20:00Z'
const base = { refreshId: R1, model: SLUG, at: AT }
const Q1_ORDER = [
  'atlas-cloud/fp8', 'morph/fp8', 'makora/fp8', 'streamlake/fp8', 'deepinfra/fp8', 'venice/fp8', 'gmicloud/fp8',
  'baidu/fp8', 'parasail/fp8', 'nextbit/fp8', 'novita/fp8', 'baseten/fp8', 'siliconflow/fp8', 'baseten/fast'
]
const outcome = (removed) => ({ attempted: true, removed, issue: null, failure: null })
const E_ENDPOINTS = { ...base, stage: 'endpoints', fetchedAt: AT, endpointRows: 33, tags: 32, rejectedRows: 0 }
const E_PREFLIGHT = { ...base, stage: 'preflight', checkedAt: AT, guardrails: outcome(['deepseek']), dataPolicy: outcome(['deepseek']) }
const E_PLAN = {
  ...base, stage: 'probe-plan', planned: Q1_ORDER.map((tag) => ({ tag, estimateUsd: 0.0035 })),
  estimateUsd: 0.0493873956, capUsd: 0.05, fresh: [], notProbed: []
}
const E_PROBES = Q1_ORDER.map((tag, index) => ({
  ...base, stage: 'probe', tag, outcome: 'verified', failure: null, calls: 3, costUsd: 0.0015,
  spentUsd: Number((0.0015 * (index + 1)).toFixed(6))
}))
const E_DONE = {
  ...base, stage: 'done', estimateUsd: 0.0493873956, spentUsd: 0.021, probed: [...Q1_ORDER], notProbed: [], accountEligibility: 'checked'
}
const E_FAILED = {
  ...base, stage: 'failed', code: 'FETCH_FAILED', failure: 'provider-error', message: 'OpenRouter returned an error.', spentUsd: 0
}
const FULL = [E_ENDPOINTS, E_PREFLIGHT, E_PLAN, ...E_PROBES, E_DONE]

/** Cards, notes, table and age for one computed TierResult, by the real view functions. */
function tiersView(name) {
  const { result, settings } = states[name]
  const age = snapshotAgeView(result.snapshotFetchedAt, NOW_MS, settings.snapshotMaxAgeMinutes)
  return {
    cards: tierCardViews(result, settings),
    nitro: nitroCardView(result, SLUG),
    notes: resultNotes(result),
    table: providerTableView(result),
    ageText: age.text,
    staleText: age.staleText
  }
}
const button = (phase, cooldownSeconds) => refreshButtonView({ phase, cooldownSeconds, canRefresh: true })
const idle = { button: button('idle', 0), progress: refreshProgressView([], 'idle'), error: null }

const VIEWS = {
  golden: { ...tiersView('golden'), ...idle },
  'no-snapshot': {
    cards: tierCardViews(null, states.golden.settings),
    nitro: nitroCardView(null, SLUG),
    notes: [],
    table: null,
    ageText: null,
    staleText: null,
    ...idle
  },
  empty: { ...tiersView('empty'), ...idle },
  floor130: { ...tiersView('floor130'), ...idle },
  floor1000: { ...tiersView('floor1000'), ...idle },
  'nitro-pass': { ...tiersView('nitroPass'), ...idle },
  running: {
    ...tiersView('golden'),
    button: button('running', 0),
    progress: refreshProgressView([E_ENDPOINTS, E_PREFLIGHT, E_PLAN, ...E_PROBES.slice(0, 3)], 'running'),
    error: null
  },
  done: { ...tiersView('golden'), button: button('done', 0), progress: refreshProgressView(FULL, 'done'), error: null },
  cooldown: {
    ...tiersView('golden'),
    // A refresh that ended 18 s before NOW_MS: 42 s of the 60 s cooldown remain.
    button: button('done', cooldownRemainingSeconds(NOW_MS - 18_000, NOW_MS)),
    progress: refreshProgressView(FULL, 'done'),
    error: null
  },
  failed: { ...tiersView('golden'), button: button('failed', 0), progress: refreshProgressView([E_FAILED], 'failed'), error: null }
}

const view = reactive({ state: 'golden' })
window.__show = (name) => {
  if (!Object.hasOwn(VIEWS, name)) throw new Error('unknown fixture state ' + name)
  view.state = name
}
window.__refreshClicks = 0

createApp({
  render() {
    const v = VIEWS[view.state]
    // Keyed by state: every switch remounts the components, so the table starts collapsed (K7).
    return h('main', { class: 'fx-host', 'data-fixture-state': view.state }, [
      h('div', { class: 'set-page fx-page', key: view.state }, [
        h(RoutingRefreshStatus, {
          button: v.button,
          costText: ROUTING_REFRESH_COST_TEXT,
          progress: v.progress,
          ageText: v.ageText,
          staleText: v.staleText,
          error: v.error,
          onRefresh: () => { window.__refreshClicks += 1 }
        }),
        h(RoutingTierCards, { cards: v.cards, nitro: v.nitro, notes: v.notes }),
        h(RoutingProviderTable, { table: v.table })
      ])
    ])
  }
}).mount('#app')
`
  )
}

// ── 6. The offscreen Electron runner (serialised into OUT/runner.cjs) ──
// Every expected string below is written by hand from ImplementationSpec-3-3 and
// ImplementationSpec-3-2; none is imported from the code under test.
function runner() {
  const { app, BrowserWindow, session } = require('electron')
  const fs = require('node:fs')
  const path = require('node:path')

  const OUT = process.env.CHORUS_ROUTING_UI_OUT
  const AMBER = 'rgb(245, 158, 11)'
  const LIMITED_14 = 'Limited history: 14 of 14 eligible endpoints have fewer than 3 speed observations.'
  const COST =
    'A refresh fetches the endpoint list and checks account eligibility (both free), then may spend up to about $0.05 of OpenRouter credit verifying prompt caching. The estimate is shown before anything is spent.'
  const L_ENDPOINTS = 'Endpoints: 33 rows, 32 tags'
  const L_ACCOUNT = 'Account: guardrails removed deepseek; data policy removed deepseek'
  const L_PLAN = 'Cache probe: 14 endpoints, estimated $0.0494 (cap $0.05)'
  const CAVEATS = [
    'An estimate: OpenRouter chooses the endpoint for each request, so actual routing may differ.',
    "Requests may be billed at a provider's priority-tier price.",
    "Your account's guardrails still apply."
  ]
  const PROBE = '__routing_ui_console_probe__'

  const results = []
  const consoleErrors = []
  const requests = []
  const chorusTypes = []
  let win = null

  app.disableHardwareAcceleration()
  app.setPath('userData', path.join(OUT, 'profile'))

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const ev = (code) => win.webContents.executeJavaScript(code, true)
  async function waitFor(code, label, ms = 10_000) {
    for (let waited = 0; waited < ms; waited += 50) {
      if (await ev(code)) return
      await sleep(50)
    }
    throw new Error(`timed out waiting for ${label}`)
  }

  // Runs in the page: one plain-JSON reading of every routing data attribute.
  function pageSnapshot() {
    const t = (el) => (el ? el.textContent : null)
    const all = (root, sel) => Array.from(root.querySelectorAll(sel))
    const cards = all(document, '[data-routing-tier]').map((c) => ({
      tier: c.getAttribute('data-routing-tier'),
      state: c.getAttribute('data-routing-tier-state'),
      text: c.textContent,
      primary: t(c.querySelector('[data-routing-primary]')),
      fallbacks: t(c.querySelector('[data-routing-fallbacks]')),
      reason: t(c.querySelector('[data-routing-reason]')),
      cardNotes: all(c, '[data-routing-card-note]').map(t),
      label: t(c.querySelector('[data-routing-nitro-label]')),
      likely: t(c.querySelector('[data-routing-nitro-likely]')),
      warning: t(c.querySelector('[data-routing-nitro-warning]')),
      caveats: all(c, '[data-routing-nitro-caveat]').map(t),
      borderLeftWidth: getComputedStyle(c).borderLeftWidth,
      borderLeftColor: getComputedStyle(c).borderLeftColor
    }))
    const rows = all(document, '[data-routing-provider-row]').map((r) => {
      const cells = {}
      for (const cell of all(r, '[data-col]')) cells[cell.getAttribute('data-col')] = cell.textContent
      const status = r.querySelector('[data-col="status"]')
      return {
        tag: r.getAttribute('data-tag'),
        eligible: r.getAttribute('data-eligible'),
        cells,
        statusClass: status ? (status.classList.contains('set-row-ok') ? 'ok' : status.classList.contains('set-row-warn') ? 'warn' : '') : null,
        timeOfDay: r.querySelector('[data-routing-time-of-day]') !== null,
        cacheVerified: r.querySelector('[data-routing-cache-verified]') !== null
      }
    })
    const toggle = document.querySelector('[data-routing-providers-toggle]')
    const refresh = document.querySelector('[data-routing-refresh]')
    const progress = document.querySelector('[data-routing-progress]')
    const box = document.querySelector('.routing-providers')
    const host = document.querySelector('[data-fixture-state]')
    return {
      state: host ? host.getAttribute('data-fixture-state') : null,
      cards,
      limitedChips: all(document, '[data-routing-limited]').length,
      notes: document.querySelector('[data-routing-notes]') ? all(document, '[data-routing-note]').map(t) : [],
      toggle: toggle ? { text: toggle.textContent, expanded: toggle.getAttribute('aria-expanded') } : null,
      rows,
      refresh: refresh ? { text: refresh.textContent, disabled: refresh.disabled, title: refresh.getAttribute('title') } : null,
      cost: t(document.querySelector('[data-routing-cost]')),
      age: t(document.querySelector('[data-routing-age]')),
      progress: progress ? { state: progress.getAttribute('data-routing-progress-state'), lines: all(progress, '[data-routing-progress-line]').map(t) } : null,
      estimate: t(document.querySelector('[data-routing-estimate]')),
      spent: t(document.querySelector('[data-routing-spent]')),
      clicks: window.__refreshClicks,
      chorusType: typeof window.chorus,
      buttons: all(document, 'button').map((b) => b.getAttribute('type') + ':' + (b.hasAttribute('data-routing-refresh') ? 'refresh' : b.hasAttribute('data-routing-providers-toggle') ? 'toggle' : 'other')),
      tabindexed: all(document, '[tabindex]').length,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      box: box ? { scrollWidth: box.scrollWidth, clientWidth: box.clientWidth } : null
    }
  }

  async function snap() {
    const s = await ev(`(${pageSnapshot.toString()})()`)
    chorusTypes.push(s.chorusType)
    return s
  }

  async function show(name) {
    await ev(`window.__show(${JSON.stringify(name)})`)
    await waitFor(`document.querySelector('[data-fixture-state]')?.getAttribute('data-fixture-state') === ${JSON.stringify(name)}`, `state ${name}`)
    await ev('document.fonts.ready.then(() => true)')
    await sleep(120)
  }

  /** Scrolls (to the top, or `selector` to the middle of the view) and writes the PNG. */
  async function shot(file, selector) {
    await ev(
      selector === undefined
        ? 'window.scrollTo(0, 0)'
        : `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: 'center' })`
    )
    await sleep(250)
    fs.writeFileSync(path.join(OUT, file), (await win.capturePage()).toPNG())
  }

  async function toggleTable() {
    await ev(`document.querySelector('[data-routing-providers-toggle]').click()`)
    await waitFor(`document.querySelectorAll('[data-routing-provider-row]').length > 0`, 'the provider rows')
    await sleep(80)
  }

  /** A real mouse click (input events), so a disabled button is tested as a user meets it. */
  async function mouseClick(selector) {
    const at = await ev(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      el.scrollIntoView({ block: 'center' })
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
    })()`)
    await sleep(80)
    win.webContents.sendInputEvent({ type: 'mouseMove', x: at.x, y: at.y })
    win.webContents.sendInputEvent({ type: 'mouseDown', x: at.x, y: at.y, button: 'left', clickCount: 1 })
    win.webContents.sendInputEvent({ type: 'mouseUp', x: at.x, y: at.y, button: 'left', clickCount: 1 })
    await sleep(300)
  }

  const j = (v) => JSON.stringify(v)
  function eq(label, actual, expected) {
    if (j(actual) !== j(expected)) throw new Error(`${label}: expected ${j(expected)}, got ${j(actual)}`)
  }
  function ok(label, condition, got) {
    if (!condition) throw new Error(got === undefined ? label : `${label} (got ${j(got)})`)
  }
  const rowOf = (s, tag) => {
    const row = s.rows.find((r) => r.tag === tag)
    if (row === undefined) throw new Error(`no row ${tag}`)
    return row
  }
  async function check(name, fn) {
    try {
      const detail = await fn()
      results.push({ name, ok: true, detail: detail || '' })
    } catch (err) {
      results.push({ name, ok: false, detail: String((err && err.message) || err) })
    }
  }

  async function main() {
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
      (details, callback) => {
        requests.push(details.url)
        callback({ cancel: true })
      }
    )
    win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false }
    })
    win.webContents.on('console-message', (event, legacyLevel, legacyMessage) => {
      const level = event && typeof event.level === 'string' ? event.level : legacyLevel
      const message = event && typeof event.message === 'string' ? event.message : legacyMessage
      if (level === 'error' || level === 3) consoleErrors.push(String(message))
    })
    await win.loadFile(path.join(OUT, 'dist', 'index.html'))
    await waitFor(`typeof window.__show === 'function' && document.querySelector('[data-fixture-state="golden"]') !== null`, 'the fixture to mount', 20_000)
    await ev('document.fonts.ready.then(() => true)')

    // The console hook's own control: a known error must arrive, or "no console error" proves nothing.
    await ev(`console.error(${JSON.stringify(PROBE)})`)
    for (let i = 0; i < 60 && !consoleErrors.includes(PROBE); i++) await sleep(50)
    const consoleHookWorks = consoleErrors.includes(PROBE)
    consoleErrors.splice(0, consoleErrors.length, ...consoleErrors.filter((m) => m !== PROBE))

    await check('H1 golden cards', async () => {
      await show('golden')
      await shot('cards.png')
      const s = await snap()
      eq('tiers', s.cards.map((c) => c.tier), ['budget', 'balanced', 'fast', 'nitro'])
      eq('states', s.cards.map((c) => c.state), ['ranked', 'ranked', 'ranked', 'likely'])
      eq('primaries', s.cards.slice(0, 3).map((c) => c.primary), ['deepinfra/fp8', 'deepinfra/fp8', 'venice/fp8'])
      eq('Budget fallbacks', s.cards[0].fallbacks, 'Fallbacks: streamlake/fp8, gmicloud/fp8')
      eq('Budget reason', s.cards[0].reason, 'First of 12 endpoints at or above the 45.3 tok/s Budget floor, scored mostly on price.')
      ok('the Budget card text contains $0.0165/M blended', s.cards[0].text.includes('$0.0165/M blended'), s.cards[0].text)
      ok('the Fast card text contains 186 tok/s', s.cards[2].text.includes('186 tok/s'), s.cards[2].text)
      eq('[data-routing-limited] chips', s.limitedChips, 3)
      // MR-D21: the only buttons are Refresh and the toggle, and nothing is made focusable.
      eq('buttons', s.buttons, ['button:refresh', 'button:toggle'])
      eq('[tabindex] elements', s.tabindexed, 0)
    })

    await check('H2 Nitro card', async () => {
      const s = await snap()
      const nitro = s.cards[3]
      eq('Nitro tier', nitro.tier, 'nitro')
      eq('label', nitro.label, 'Nitro — unfiltered provider routing')
      eq('border-left-width', nitro.borderLeftWidth, '2px')
      eq('border-left-color', nitro.borderLeftColor, AMBER)
      for (const card of s.cards.slice(0, 3)) ok(`the ${card.tier} card has no amber left edge`, card.borderLeftColor !== AMBER, card.borderLeftColor)
      eq('likely', nitro.likely, 'Likely: Together (together) · 223 tok/s')
      eq('warning', nitro.warning, 'Likely provider: Together (together), quantization not declared.')
      eq('caveats', nitro.caveats, CAVEATS)
      return `Budget border-left ${s.cards[0].borderLeftWidth} ${s.cards[0].borderLeftColor}`
    })

    await check('H3 notes', async () => {
      const s = await snap()
      eq('[data-routing-note]', s.notes, [LIMITED_14])
    })

    await check('H4 table collapsed', async () => {
      const s = await snap()
      eq('toggle', s.toggle, { text: 'Show all providers (14 eligible · 18 excluded)', expanded: 'false' })
      eq('rows', s.rows.length, 0)
    })

    await check('H5 table open', async () => {
      await toggleTable()
      await shot('providers.png', '[data-routing-providers-toggle]')
      const s = await snap()
      eq('toggle', s.toggle, { text: 'Hide providers', expanded: 'true' })
      eq('rows', s.rows.length, 32)
      eq('data-eligible', s.rows.map((r) => r.eligible), [...Array(14).fill('true'), ...Array(18).fill('false')])
      const deepinfra = rowOf(s, 'deepinfra/fp8')
      eq(
        'deepinfra/fp8 uptime…latency',
        ['uptime', 'input', 'output', 'cache', 'blended', 'speed', 'latency'].map((col) => deepinfra.cells[col]),
        ['99.96%', '$0.140/M', '$0.420/M', '$0.00420/M', '$0.0165/M', '63 tok/s', '1.43 s']
      )
      eq('deepinfra/fp8 status', deepinfra.cells.status, 'Eligible')
      eq('deepinfra/fp8 status class', deepinfra.statusClass, 'ok')
      ok('the baseten/fp8 provider cell contains 2 endpoints', rowOf(s, 'baseten/fp8').cells.provider.includes('2 endpoints'), rowOf(s, 'baseten/fp8').cells.provider)
      eq('baseten/fast status', rowOf(s, 'baseten/fast').cells.status, 'Eligible · below the Budget floor')
      const alibaba = rowOf(s, 'alibaba')
      eq('alibaba status', alibaba.cells.status, 'Excluded: uptime 97.18% < 99.5%; currently degraded (5m uptime 92.3%); status -2; quantization not declared')
      eq('alibaba status class', alibaba.statusClass, 'warn')
      ok('alibaba has [data-routing-time-of-day]', alibaba.timeOfDay)
      ok('together has [data-routing-cache-verified]', rowOf(s, 'together').cacheVerified)
      eq('buttons with the table open', s.buttons, ['button:refresh', 'button:toggle'])
      eq('[tabindex] elements', s.tabindexed, 0)
    })

    await check('H6 no snapshot', async () => {
      await show('no-snapshot')
      await shot('no-snapshot.png')
      const s = await snap()
      eq('tiers', s.cards.map((c) => c.tier), ['budget', 'balanced', 'fast', 'nitro'])
      eq('states', s.cards.map((c) => c.state), ['no-snapshot', 'no-snapshot', 'no-snapshot', 'no-snapshot'])
      for (const card of s.cards.slice(0, 3)) eq(`${card.tier} reason`, card.reason, 'No endpoint numbers for this model yet. Refresh to rank it.')
      eq('Nitro warning', s.cards[3].warning, 'Unfiltered: OpenRouter picks the provider. Refresh to see which one is likely.')
      eq('[data-routing-nitro-likely]', s.cards[3].likely, null)
      eq('toggle', s.toggle, null)
      eq('[data-routing-age]', s.age, null)
    })

    await check('H7 nothing eligible', async () => {
      await show('empty')
      await shot('empty.png')
      const s = await snap()
      eq('states', s.cards.map((c) => c.state), ['empty', 'empty', 'empty', 'likely'])
      for (const card of s.cards.slice(0, 3)) eq(`${card.tier} reason`, card.reason, 'No provider meets the uptime and precision rules right now.')
      eq('Nitro warning', s.cards[3].warning, 'Likely provider: Together (together), uptime 99.96% < 100%, quantization not declared.')
      eq('notes', s.notes, ['Budget: no eligible endpoints.', 'Balanced: no eligible endpoints.', 'Fast: no eligible endpoints.'])
    })

    await check('H8 Budget floor', async () => {
      await show('floor130')
      await shot('budget-floor.png')
      const a = await snap()
      eq('floor130 tier', a.cards[0].tier, 'budget')
      eq('floor130 Budget note', a.cards[0].cardNotes, ['12 eligible endpoints are below the 130 tok/s Budget floor.'])
      eq('floor130 Budget fallbacks', a.cards[0].fallbacks, 'Fallbacks: baidu/fp8')
      await show('floor1000')
      const b = await snap()
      eq('floor1000 tiers', b.cards.slice(0, 3).map((c) => c.tier), ['budget', 'balanced', 'fast'])
      eq('floor1000 Budget state', b.cards[0].state, 'empty')
      eq('floor1000 Budget reason', b.cards[0].reason, 'All 14 eligible endpoints are below the 1000 tok/s Budget floor.')
      eq('floor1000 Balanced and Fast states', [b.cards[1].state, b.cards[2].state], ['ranked', 'ranked'])
    })

    await check('H9 Nitro passes', async () => {
      await show('nitro-pass')
      await shot('nitro-passes.png')
      const s = await snap()
      eq('Nitro tier', s.cards[3].tier, 'nitro')
      eq('Nitro warning', s.cards[3].warning, 'Unfiltered, but the likely provider currently passes the uptime and precision rules.')
    })

    await check('H10 refresh running', async () => {
      await show('running')
      await shot('progress-running.png')
      const s = await snap()
      ok('a progress list', s.progress !== null)
      eq('lines', s.progress.lines, [L_ENDPOINTS, L_ACCOUNT, L_PLAN, 'Probing caches: 3 of 14 (spent $0.0045 so far)'])
      eq('[data-routing-estimate]', s.estimate, 'Estimated $0.0494')
      eq('[data-routing-spent]', s.spent, null)
      eq('button', [s.refresh.text, s.refresh.disabled], ['Refreshing…', true])
    })

    await check('H11 refresh done', async () => {
      await show('done')
      await shot('progress-done.png')
      const s = await snap()
      ok('a progress list', s.progress !== null)
      eq('lines', s.progress.lines, [L_ENDPOINTS, L_ACCOUNT, L_PLAN, 'Probing caches: 14 of 14', 'Done. Spent $0.021 of an estimated $0.0494.'])
      eq('[data-routing-spent]', s.spent, 'Spent $0.021')
      eq('button', [s.refresh.text, s.refresh.disabled], ['Refresh', false])
    })

    await check('H12 refresh failed', async () => {
      await show('failed')
      await shot('progress-failed.png')
      const s = await snap()
      ok('a progress list', s.progress !== null)
      eq('lines', s.progress.lines, ['Failed: OpenRouter returned an error. Spent $0.00.'])
      eq('data-routing-progress-state', s.progress.state, 'failed')
    })

    await check('H13 cooldown', async () => {
      await show('cooldown')
      const before = await snap()
      eq('__refreshClicks before', before.clicks, 0)
      await mouseClick('[data-routing-refresh]')
      await shot('cooldown.png')
      const s = await snap()
      eq('button', [s.refresh.text, s.refresh.disabled], ['Refresh again in 42 s', true])
      eq('__refreshClicks after a click', s.clicks, 0)
    })

    await check('H14 refresh click', async () => {
      await show('golden')
      await mouseClick('[data-routing-refresh]')
      await waitFor('window.__refreshClicks >= 1', 'the refresh event', 3_000).catch(() => {})
      await sleep(200)
      const s = await snap()
      eq('button', [s.refresh.text, s.refresh.disabled], ['Refresh', false])
      eq('title', s.refresh.title, COST)
      eq('[data-routing-cost]', s.cost, COST)
      eq('[data-routing-age]', s.age, 'Updated 15 min ago')
      eq('__refreshClicks after one click', s.clicks, 1)
    })

    await check('H15 isolation and widths', async () => {
      await show('golden')
      await toggleTable()
      const wide = await snap()
      win.setSize(900, 900)
      await waitFor('window.innerWidth <= 900', 'the 900 px resize')
      await sleep(250)
      // The box must really scroll: a visibly overflowing box also has scrollWidth > clientWidth,
      // and overflow: hidden takes a programmatic scrollLeft that no user could produce.
      const box = await ev(`(() => {
        const box = document.querySelector('.routing-providers')
        box.scrollLeft = 40
        const moved = box.scrollLeft
        box.scrollLeft = 0
        return { moved, overflowX: getComputedStyle(box).overflowX }
      })()`)
      await shot('narrow.png', '[data-routing-providers-toggle]')
      const narrow = await snap()
      // A composite check: every failing assertion is reported, not only the first.
      const failures = []
      const soft = (fn) => {
        try {
          fn()
        } catch (err) {
          failures.push(err.message)
        }
      }
      soft(() => ok('the console hook caught its control error', consoleHookWorks))
      soft(() => eq('console errors', consoleErrors, []))
      soft(() => ok('typeof window.chorus was read', chorusTypes.length > 0))
      soft(() => eq('typeof window.chorus in every reading', [...new Set(chorusTypes)], ['undefined']))
      soft(() => eq('recorded network requests', requests, []))
      soft(() => ok(`no sideways page scroll at ${wide.innerWidth} px`, wide.scrollWidth <= wide.innerWidth, { scrollWidth: wide.scrollWidth, innerWidth: wide.innerWidth }))
      soft(() => ok(`no sideways page scroll at ${narrow.innerWidth} px`, narrow.scrollWidth <= narrow.innerWidth, { scrollWidth: narrow.scrollWidth, innerWidth: narrow.innerWidth }))
      soft(() => eq('rows at 900 px', narrow.rows.length, 32))
      soft(() => ok('the provider grid is wider than its box at 900 px', narrow.box !== null && narrow.box.scrollWidth > narrow.box.clientWidth, narrow.box))
      soft(() => ok('the provider box scrolls sideways itself', box.moved > 0 && (box.overflowX === 'auto' || box.overflowX === 'scroll'), box))
      if (failures.length > 0) throw new Error(failures.join('; '))
      return `innerWidth ${wide.innerWidth}: page ${wide.scrollWidth}; innerWidth ${narrow.innerWidth}: page ${narrow.scrollWidth}, grid box ${narrow.box.clientWidth} scrolling ${narrow.box.scrollWidth} (overflow-x ${box.overflowX}); ${chorusTypes.length} readings`
    })
  }

  function finish() {
    process.stdout.write(JSON.stringify({ results }) + '\n', () => app.quit())
  }

  app
    .whenReady()
    .then(main)
    .catch((err) => {
      results.push({ name: 'runner', ok: false, detail: String((err && err.stack) || err) })
    })
    .then(finish)
}

// ── Main ──
const runnerFile = path.join(OUT, 'runner.cjs')
let results = null
let failure = null
try {
  await writeStates()
  writeFixture()
  const { build } = await import('vite')
  const vue = (await import('@vitejs/plugin-vue')).default
  const tailwindcss = (await import('@tailwindcss/vite')).default
  await build({
    configFile: false,
    root: OUT,
    base: './',
    plugins: [vue(), tailwindcss()],
    build: { outDir: 'dist', emptyOutDir: true },
    logLevel: 'warn'
  })
  fs.writeFileSync(runnerFile, `'use strict'\n;(${runner.toString()})()\n`)

  const env = { ...process.env, CHORUS_ROUTING_UI_OUT: OUT }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(require('electron'), [runnerFile], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (d) => { stdout += d })
  child.stderr.on('data', (d) => { stderr += d })
  let timedOut = false
  const code = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      timedOut = true
      child.kill() // our own child, by its handle; never by process name
    }, CHILD_TIMEOUT_MS)
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve(`spawn error: ${err.message}`)
    })
    child.on('close', (exitCode) => {
      clearTimeout(timer)
      resolve(exitCode)
    })
  })
  const line = stdout.split(/\r?\n/).reverse().find((l) => l.startsWith('{"results"'))
  if (line === undefined) {
    failure = `the runner printed no result line (exit ${timedOut ? `${code}, killed after ${CHILD_TIMEOUT_MS / 1000} s` : code})`
    const tail = stderr.trim().split(/\r?\n/).slice(-15)
    if (tail.length > 0 && tail[0] !== '') console.log(['runner stderr (tail):', ...tail.map((l) => '  ' + l)].join('\n'))
  } else {
    results = JSON.parse(line).results
  }
} catch (err) {
  failure = `harness error: ${(err && err.message) || err}`
}

// ── 7. Report, then leave only the PNGs ──
const runnerError = results?.find((r) => r.name === 'runner')
const outcomes = CHECK_IDS.map((id) => {
  const r = results?.find((x) => x.name.split(' ')[0] === id)
  if (r !== undefined) return { ...r }
  return { name: id, ok: false, detail: failure ?? (runnerError ? `not run: ${runnerError.detail}` : 'not run') }
})
for (const o of outcomes) {
  const png = PNG_OF[o.name.split(' ')[0]]
  if (o.ok && png !== undefined && !fs.existsSync(path.join(OUT, png))) {
    o.ok = false
    o.detail = `${png} was not written`
  }
}

for (const entry of fs.readdirSync(OUT)) {
  if (!entry.endsWith('.png')) fs.rmSync(path.join(OUT, entry), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
const leftover = fs.readdirSync(OUT).filter((entry) => !entry.endsWith('.png'))
if (leftover.length > 0) {
  const h15 = outcomes[outcomes.length - 1]
  h15.ok = false
  h15.detail = `could not remove ${leftover.join(', ')} from ${OUT}` + (h15.detail ? `; ${h15.detail}` : '')
}

for (const o of outcomes) console.log(o.ok ? `ok ${o.name}${o.detail ? ` (${o.detail})` : ''}` : `FAIL ${o.name}: ${o.detail}`)
const failed = outcomes.filter((o) => !o.ok).length
console.log(failed === 0 ? `PASS (${CHECK_IDS.length} checks)` : `FAIL (${failed} of ${CHECK_IDS.length} checks)`)
process.exitCode = failed === 0 ? 0 : 1

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
const option = name => { const at = process.argv.indexOf(name); return at < 0 ? undefined : process.argv[at + 1] }
const repetitions = Number(option('--repetitions') ?? 3)
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10) throw Error('Repetitions must be 1–10.')
const workloads = option('--workload') ? [option('--workload')] : ['small', 'substantial']
if (workloads.some(w => !['small', 'substantial', 'long', 'extended'].includes(w))) throw Error('Unknown workload.')
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'chorus-team-benchmark-')), runs = []
const conditions = option('--conditions') ? option('--conditions').split(',') : ['lead-only', 'team-1', 'team-2']
if (!conditions.length || new Set(conditions).size !== conditions.length || conditions.some(c => !['lead-only', 'team-1', 'team-2'].includes(c))) throw Error('Unknown or repeated condition.')
const leads = (option('--leads') ?? 'claude-opus').split(',')
if (!leads.length || new Set(leads).size !== leads.length || leads.some(l => !['claude-opus', 'codex', 'codex-sol'].includes(l))) throw Error('Unknown or repeated lead.')
const context = option('--context') ?? (leads.some(l => l.startsWith('codex')) ? 'standard' : 'focused')
if (!['focused', 'standard'].includes(context)) throw Error('Unknown context.')
if (context === 'focused' && leads.some(l => l.startsWith('codex'))) throw Error('Codex comparisons require standard context.')
const sourceHash = () => {
  const hash = createHash('sha256').update(execFileSync('git', ['rev-parse', 'HEAD'])).update(execFileSync('git', ['diff', '--binary', 'HEAD', '--', 'src', 'resources/teamBridge.cjs', 'scripts/verify-team-pilot.ts', 'scripts/verify-team-pilot.mjs', 'scripts/team-codex-audit.ts']))
  for (const file of ['src/main/services/teamChecks.ts', 'src/main/services/teamCompletionService.ts', 'src/main/services/teamStatusCore.ts', 'src/main/services/teamVerificationService.ts', 'scripts/verify-team-pilot.ts', 'scripts/verify-team-pilot.mjs', 'scripts/team-long-fixture.ts', 'scripts/team-extended-fixture.ts', 'scripts/team-local-check-fixture.ts', 'src/main/services/teamLeadUsageCore.ts']) hash.update(file).update(fs.readFileSync(file))
  hash.update(fs.readFileSync('scripts/team-codex-audit.ts')).update(fs.readFileSync('scripts/benchmark-team-dependability.mjs'))
  return hash.digest('hex')
}
const frozenSource = sourceHash()
const nativeVersions = () => Object.fromEntries([...new Set([...leads.map(lead => lead.startsWith('codex') ? 'codex' : 'claude'), 'opencode'])].map(cli => [cli, execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `${cli} --version`], { encoding: 'utf8', windowsHide: true, timeout: 30000 }).trim()]))
const frozenVersions = nativeVersions()
const assertFrozen = () => {
  if (sourceHash() !== frozenSource || JSON.stringify(nativeVersions()) !== JSON.stringify(frozenVersions)) throw Error('Source or CLI version changed during benchmark. Recorded trials remain in runs.json; do not combine different builds or clients.')
}
console.log(JSON.stringify({ output, workloads, repetitions, leads, conditions, sourceHash: frozenSource, cliVersions: frozenVersions }))
const diagnosticFlags = ['--helper-low', '--local-checks', '--bounded-assignments'].filter(flag => process.argv.includes(flag))
// Rotating condition order, isolated fixtures, identical effort/checks, one live run at a time.
trials: for (const workload of workloads) for (const [leadIndex, lead] of leads.entries()) for (let repeat = 0; repeat < repetitions; repeat++) {
  const rotate = (repeat + leadIndex) % conditions.length
  const order = [...conditions.slice(rotate), ...conditions.slice(0, rotate)]
  for (const condition of order) {
    assertFrozen()
    const args = ['scripts/verify-team-pilot.mjs', '--lead', lead, '--workload', workload, '--context', context, ...diagnosticFlags, ...(condition === 'lead-only' ? ['--solo'] : condition === 'team-1' ? ['--one-helper'] : []), ...(option('--profile') ? ['--profile', option('--profile')] : [])]
    const child = spawn(process.execPath, args, { cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = '', evidence = null
    child.stdout.on('data', chunk => { stdout += chunk; if (!evidence) { try { evidence = JSON.parse(stdout.split('\n')[0]).evidence; console.log(JSON.stringify({ workload, repeat: repeat + 1, condition, evidence })) } catch {} } })
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8000) })
    const [code] = await once(child, 'close')
    assertFrozen()
    const reportPath = evidence && path.join(evidence, 'report.json')
    const report = reportPath && fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : { passed: false, message: stderr || stdout.slice(-8000), evidence }
    runs.push({ workload, repeat: repeat + 1, condition, ...report, requestedLeadKey: lead, exitCode: code })
    fs.writeFileSync(path.join(output, 'runs.json'), JSON.stringify(runs, null, 2))
    console.log(JSON.stringify({ condition, workload, repeat: repeat + 1, passed: report.passed, seconds: report.elapsedSeconds, retries: report.retries ?? 0 }))
    if (!report.passed || code !== 0) { fs.writeFileSync(path.join(output, 'stopped.json'), JSON.stringify({ reason: 'Diagnose the failed condition before spending further trials.', completedTrials: runs.length, plannedTrials: workloads.length * leads.length * repetitions * conditions.length }, null, 2)); break trials }
  }
}
const median = values => { const sorted = values.filter(Number.isFinite).sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null }
const groups = workloads.flatMap(workload => leads.flatMap(lead => conditions.map(condition => {
  const trials = runs.filter(r => r.workload === workload && r.condition === condition && r.requestedLeadKey === lead), passed = trials.filter(r => r.passed && r.exitCode === 0)
  return { workload, lead, condition, executions: trials.length, passes: passed.length, failures: trials.length - passed.length, comparisonValid: trials.length === repetitions && trials.every(r => r.passed && r.exitCode === 0 && (!lead.startsWith('codex') || r.comparisonValid === true)), medianObservedSeconds: median(trials.map(r => r.elapsedSeconds)), medianPassingSeconds: median(passed.map(r => r.elapsedSeconds)),
    leadUsageRecordedTrials: trials.filter(r => r.leadUsage).length, medianLeadInputTokens: median(trials.map(r => r.leadUsage?.inputTokens)), medianLeadTotalTokens: median(trials.map(r => r.leadUsage?.totalTokens)), medianLeadOutputTokens: median(trials.map(r => r.leadUsage?.outputTokens)), medianLeadCacheReadTokens: median(trials.map(r => r.leadUsage?.cacheReadTokens)), medianLeadCacheCreationTokens: median(trials.map(r => r.leadUsage?.cacheCreationTokens)),
    helperKnownReportedUsd: trials.reduce((sum, r) => sum + (r.helperReportedUsd?.knownUsd ?? 0), 0), subscriptionBilledUsd: null, totalBilledUsd: null, retries: trials.reduce((sum, r) => sum + (r.retries ?? 0), 0), retainedWorktrees: trials.reduce((sum, r) => sum + (r.cleanup?.retainedWorktreeIds?.length ?? 0), 0) }
})))
const gain = (baseline, team) => Number.isFinite(baseline) && baseline > 0 && Number.isFinite(team) ? 100 * (baseline - team) / baseline : null
const comparisons = workloads.flatMap(workload => leads.flatMap(lead => conditions.filter(c => c !== 'lead-only').map(condition => {
  const baseline = groups.find(g => g.workload === workload && g.lead === lead && g.condition === 'lead-only'), team = groups.find(g => g.workload === workload && g.lead === lead && g.condition === condition)
  const valid = !!baseline?.comparisonValid && !!team?.comparisonValid
  const selected = c => runs.filter(r => r.workload === workload && r.requestedLeadKey === lead && r.condition === c)
  const cost = (trials, bound) => { const values = trials.map(r => r.condition === 'lead-only' ? r.leadApiEquivalentUsd?.[bound] : r.totalApiEquivalentPlusHelperReportedUsd?.[bound]); return values.length && values.every(Number.isFinite) ? median(values) : null }
  return { workload, lead, condition, valid, observedTimeReductionPercent: valid ? gain(baseline.medianPassingSeconds, team.medianPassingSeconds) : null, leadOutputTokenReductionPercent: valid ? gain(baseline.medianLeadOutputTokens, team.medianLeadOutputTokens) : null, leadTotalTokenReductionPercent: valid ? gain(baseline.medianLeadTotalTokens, team.medianLeadTotalTokens) : null, apiEquivalentPlusHelperReportedCostReductionPercent: valid ? { low: gain(cost(selected('lead-only'), 'low'), cost(selected(condition), 'high')), high: gain(cost(selected('lead-only'), 'high'), cost(selected(condition), 'low')) } : null, subscriptionBilledCostReductionPercent: null }
})))
fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ groups, comparisons, runs, sourceHash: frozenSource, cliVersions: frozenVersions, leadContext: context, diagnosticFlags, methodology: 'Sequential rotating condition order within each lead; explicit medium effort; frozen source/CLI versions and independent acceptance. Compare a team only with its own lead baseline. Timings include coordination and final checks. Failed/censored trials retained. Native Codex cached input/reasoning output are subsets, not additional tokens. CLI helper costs are reports, not reconciled billing; subscription billing remains unknown. No cross-model token sum is a cost estimate.', output }, null, 2))
console.log(JSON.stringify({ groups, comparisons, output }, null, 2))
process.exitCode = runs.every(r => r.passed && r.exitCode === 0 && (!r.requestedLeadKey.startsWith('codex') || r.comparisonValid === true)) ? 0 : 1

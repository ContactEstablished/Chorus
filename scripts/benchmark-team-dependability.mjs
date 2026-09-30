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
const context = option('--context') ?? 'focused'
if (!['focused', 'standard'].includes(context)) throw Error('Unknown context.')
const sourceHash = () => {
  const hash = createHash('sha256').update(execFileSync('git', ['diff', '--binary', 'HEAD', '--', 'src', 'resources/teamBridge.cjs', 'scripts/verify-team-pilot.ts', 'scripts/verify-team-pilot.mjs']))
  for (const file of ['src/main/services/teamChecks.ts', 'src/main/services/teamCompletionService.ts', 'src/main/services/teamStatusCore.ts', 'src/main/services/teamVerificationService.ts', 'scripts/verify-team-pilot.ts', 'scripts/verify-team-pilot.mjs', 'scripts/team-long-fixture.ts', 'scripts/team-extended-fixture.ts', 'src/main/services/teamLeadUsageCore.ts']) hash.update(file).update(fs.readFileSync(file))
  return hash.digest('hex')
}
const frozenSource = sourceHash()
console.log(JSON.stringify({ output, workloads, repetitions }))
// Rotating condition order, isolated fixtures, identical effort/checks, one live run at a time.
for (const workload of workloads) for (let repeat = 0; repeat < repetitions; repeat++) {
  const order = [...conditions.slice(repeat % conditions.length), ...conditions.slice(0, repeat % conditions.length)]
  for (const condition of order) {
    if (sourceHash() !== frozenSource) throw Error('Source changed during benchmark. Recorded trials remain in runs.json; do not combine different builds.')
    const args = ['scripts/verify-team-pilot.mjs', '--workload', workload, '--context', context, ...(condition === 'lead-only' ? ['--solo'] : condition === 'team-1' ? ['--one-helper'] : []), ...(option('--profile') ? ['--profile', option('--profile')] : [])]
    const child = spawn(process.execPath, args, { cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = '', evidence = null
    child.stdout.on('data', chunk => { stdout += chunk; if (!evidence) { try { evidence = JSON.parse(stdout.split('\n')[0]).evidence; console.log(JSON.stringify({ workload, repeat: repeat + 1, condition, evidence })) } catch {} } })
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8000) })
    const [code] = await once(child, 'close')
    if (sourceHash() !== frozenSource) throw Error('Source changed during a trial; trial output is retained but the comparison is invalid.')
    const reportPath = evidence && path.join(evidence, 'report.json')
    const report = reportPath && fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : { passed: false, message: stderr || stdout.slice(-8000), evidence }
    runs.push({ workload, repeat: repeat + 1, condition, exitCode: code, ...report })
    fs.writeFileSync(path.join(output, 'runs.json'), JSON.stringify(runs, null, 2))
    console.log(JSON.stringify({ condition, workload, repeat: repeat + 1, passed: report.passed, seconds: report.elapsedSeconds, retries: report.retries ?? 0 }))
  }
}
const median = values => { const sorted = values.filter(Number.isFinite).sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null }
const groups = workloads.flatMap(workload => conditions.map(condition => {
  const trials = runs.filter(r => r.workload === workload && r.condition === condition), passed = trials.filter(r => r.passed && r.exitCode === 0)
  return { workload, condition, executions: trials.length, passes: passed.length, failures: trials.length - passed.length, medianObservedSeconds: median(trials.map(r => r.elapsedSeconds)), medianPassingSeconds: median(passed.map(r => r.elapsedSeconds)),
    leadUsageRecordedTrials: trials.filter(r => r.leadUsage).length, medianLeadOutputTokens: median(trials.map(r => r.leadUsage?.outputTokens)), medianLeadCacheReadTokens: median(trials.map(r => r.leadUsage?.cacheReadTokens)), medianLeadCacheCreationTokens: median(trials.map(r => r.leadUsage?.cacheCreationTokens)),
    helperKnownReportedUsd: trials.reduce((sum, r) => sum + (r.helperReportedUsd?.knownUsd ?? 0), 0), subscriptionBilledUsd: null, totalBilledUsd: null, retries: trials.reduce((sum, r) => sum + (r.retries ?? 0), 0), retainedWorktrees: trials.reduce((sum, r) => sum + (r.cleanup?.retainedWorktreeIds?.length ?? 0), 0) }
}))
fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ groups, runs, sourceHash: frozenSource, leadContext: context, methodology: 'Sequential rotating condition order; medium-effort Opus; frozen source and independent acceptance; timings include coordination and final checks. Failed/censored trials retained. CLI helper costs are reports, not reconciled billing; subscription billing remains unknown. No cross-model token sum is a cost estimate.', output }, null, 2))
console.log(JSON.stringify({ groups, output }, null, 2))
process.exitCode = runs.every(r => r.passed && r.exitCode === 0) ? 0 : 1

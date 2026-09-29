import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { HelperLaunchRequest, HelperEvent, HelperEventParser, HelperUsage } from '../adapters/helpers/types'
import { composeHelperEnv } from '../adapters/helpers/common'
import { createSessionOutput } from './sessionOutput'
import { scrubSecrets } from './logger'
import { TEAM_LIMITS, type TeamAttempt } from '../../shared/team'

type ProcessIdentity = NonNullable<TeamAttempt['process']>
const execFileAsync = promisify(execFile)
export interface HelperProcessPlatform {
  inspect(rootPid: number, known: readonly ProcessIdentity[]): Promise<{ identities: ProcessIdentity[]; root: ProcessIdentity | null; uncertain?: boolean }>
  stop(identities: readonly ProcessIdentity[]): Promise<void>
}
const identityScript = String.raw`
$ErrorActionPreference='Stop'
$all=@(Get-CimInstance Win32_Process)
$ids=[System.Collections.Generic.HashSet[int]]::new()
$observed=@{}
$uncertain=$false
foreach($id in $inputData.roots) {
 $p=Get-Process -Id $id -ErrorAction SilentlyContinue
 $expected=@($inputData.known | Where-Object { $_.pid -eq $id })
 if($p -and ($expected.Count -eq 0 -or ($p.StartTime.ToFileTimeUtc().ToString() -eq $expected[0].creationTime -and $p.Path -eq $expected[0].executable))) { [void]$ids.Add([int]$id); $observed[[int]$id]=@{pid=[int]$id;creationTime=$p.StartTime.ToFileTimeUtc().ToString();executable=$p.Path} } elseif($p) { $uncertain=$true }
}
do { $changed=$false; foreach($p in $all) {
 if($ids.Contains([int]$p.ParentProcessId) -and -not $ids.Contains([int]$p.ProcessId)) {
  $parent=$observed[[int]$p.ParentProcessId]
  $created=$p.CreationDate.ToFileTimeUtc().ToString()
  # A recycled parent PID can appear on an unrelated, older process. It is not a descendant.
  if([long]$created -lt [long]$parent.creationTime) { continue }
  $live=Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue
  if(-not $live) { continue }
  # CIM creation timestamps have microsecond precision; native identity retains all 100ns ticks.
  $nativeCreated=$live.StartTime.ToFileTimeUtc()
  if([Math]::Abs($nativeCreated-[long]$created) -gt 9) { $uncertain=$true; continue }
  if(-not $live.Path) { throw 'Unknown executable identity' }
  [void]$ids.Add([int]$p.ProcessId)
  $observed[[int]$p.ProcessId]=@{pid=[int]$p.ProcessId;creationTime=$nativeCreated.ToString();executable=$live.Path}
  $changed=$true
 }
} } while($changed)
$result=@(foreach($id in $ids) {
 $p=Get-Process -Id $id -ErrorAction SilentlyContinue
 if($p) { $expected=$observed[$id]; if(-not $expected.executable) { throw 'Unknown executable identity' }; if($p.StartTime.ToFileTimeUtc().ToString() -eq $expected.creationTime -and $p.Path -eq $expected.executable) { $expected } else { $uncertain=$true } }
})
ConvertTo-Json -Depth 5 -Compress -InputObject @{identities=$result;uncertain=$uncertain}
`
/** All command substitutions below contain validated numeric IDs or base64 JSON, never user shell text. */
export const windowsHelperPlatform: HelperProcessPlatform = {
  async inspect(rootPid, known) {
    const roots = [...new Set([rootPid, ...known.map(p => p.pid)])]
    if (roots.some(p => !Number.isSafeInteger(p) || p <= 0)) throw Error('Invalid owned process ID.')
    const encoded = Buffer.from(JSON.stringify({ roots, known }), 'utf8').toString('base64')
    const script = `$inputData=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')) | ConvertFrom-Json;` + identityScript
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024 })
    const observed = JSON.parse(stdout), rows: unknown = observed.identities
    if (!Array.isArray(rows) || rows.length > 4096 || rows.some(p => !p || !Number.isSafeInteger(p.pid) || !/^\d+$/.test(p.creationTime) || typeof p.executable !== 'string')) throw Error('Invalid process inspection result.')
    const identities = rows as ProcessIdentity[]
    return { identities, root: identities.find(p => p.pid === rootPid) ?? null, uncertain: observed.uncertain === true }
  },
  async stop(identities) {
    if (!identities.length) return
    const encoded = Buffer.from(JSON.stringify(identities), 'utf8').toString('base64')
    // Root exit can close one child between observation and signal. Continue with
    // the remaining independently verified identities instead of abandoning the batch.
    const script = `$ErrorActionPreference='Stop'; $failed=$false; $owned=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')) | ConvertFrom-Json; foreach($identity in $owned) { try { $p=Get-Process -Id $identity.pid -ErrorAction SilentlyContinue; if($p -and $p.StartTime.ToFileTimeUtc().ToString() -eq $identity.creationTime -and $p.Path -eq $identity.executable) { Stop-Process -InputObject $p -Force -ErrorAction Stop } } catch { $failed=$true } }; if($failed) { throw 'One or more process signals raced exit or were unavailable; final identity inspection is required.' }`
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 10000, maxBuffer: 65536 })
  }
}
export interface HelperProcessOutcome {
  exitCode: number | null; cessation: 'confirmed' | 'unknown'; result: Extract<HelperEvent, { type: 'result' }> | null;
  permissionBlocked: boolean; protocolError: boolean; intent: 'cancelled' | 'timed-out' | null; process: ProcessIdentity | null; descendants: ProcessIdentity[]
  usage: HelperUsage[]
}
export interface HelperProcessOptions {
  request: HelperLaunchRequest; parser: HelperEventParser; executionMs: number; onEvent(event: HelperEvent): void;
  platform?: HelperProcessPlatform; parentEnv?: NodeJS.ProcessEnv; pollMs?: number;
  /** Synchronous final authority check, called after environment construction and immediately before OS spawn. */
  authorizeSpawn(): void
  onTerminationIntent?(intent: 'cancelled' | 'timed-out'): void
  /** A terminal unknown outcome may later acquire positive cessation evidence. Never promotes its result. */
  onCessationConfirmed?(): void
  /** Commit active identities before forgetting positively observed exited descendants. */
  onProcessObservation?(process: ProcessIdentity, descendants: ProcessIdentity[]): void
}
export class HelperProcess {
  readonly done: Promise<HelperProcessOutcome>
  readonly identified: Promise<ProcessIdentity>
  private readonly child: ReturnType<typeof spawn>
  private readonly platform: HelperProcessPlatform
  private identities = new Map<string, ProcessIdentity>()
  private root: ProcessIdentity | null = null
  private rootExited = false
  private inspectionUnknown = false
  private scanInFlight: Promise<ProcessIdentity[]> | null = null
  private latestLive: ProcessIdentity[] = []
  private terminalResult: HelperProcessOutcome['result'] = null
  private usage: HelperUsage[] = []
  private permissionBlocked = false
  private protocolError = false
  private intent: HelperProcessOutcome['intent'] = null
  private finished = false
  private disposed = false
  private reconciliation: ReturnType<typeof setInterval> | null = null
  private cessationPublished = false
  private outputBytes = 0
  private output: ReturnType<typeof createSessionOutput>
  private readonly polling: ReturnType<typeof setInterval>
  private readonly deadline: ReturnType<typeof setTimeout>
  constructor(private readonly options: HelperProcessOptions) {
    if (process.platform !== 'win32' && !options.platform) throw Error('Helper process ownership is currently verified on Windows only.')
    this.platform = options.platform ?? windowsHelperPlatform
    this.output = createSessionOutput({ secrets: Object.values(options.request.secretEnv), maxChars: 16384, flushMs: 50, onText: text => this.emit({ type: 'activity', category: 'stderr', text }) })
    const env = composeHelperEnv(options.parentEnv ?? process.env, options.request)
    // Nothing asynchronous can intervene between this fence and spawn.
    try {
      options.authorizeSpawn()
      this.child = spawn(options.request.executable, options.request.args, { cwd: options.request.cwd, env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (error) { this.output.dispose(); throw error }
    finally { for (const name of Object.keys(options.request.secretEnv)) delete env[name]; options.request.secretEnv = {} }
    this.child.stdout!.on('data', chunk => {
      if (!this.countOutput(chunk.length)) return
      this.events(options.parser.push(chunk))
    })
    this.child.stderr!.on('data', chunk => { if (this.countOutput(chunk.length)) this.output.ingest(chunk.toString('utf8')) })
    this.child.on('error', () => { this.protocolError = true; this.emit({ type: 'protocol-error', reason: 'Helper spawn or process transport failed.' }) })
    this.child.once('exit', () => { this.rootExited = true })
    this.child.stdin!.on('error', () => { /* Process close is the authoritative outcome; never log input. */ })
    this.identified = this.scan().then(() => {
      if (!this.root) throw Error('Helper process identity could not be established.')
      return { ...this.root }
    })
    // Callers observe identified; this handler prevents an early rejection becoming unhandled.
    void this.identified.catch(() => { this.inspectionUnknown = true })
    this.polling = setInterval(() => { void this.scan() }, options.pollMs ?? 2000)
    this.deadline = setTimeout(() => { void this.cancel('timed-out').catch(() => { this.protocolError = true }) }, options.executionMs)
    this.done = new Promise(resolve => this.child.once('close', (exitCode) => {
      this.rootExited = true
      void this.finish(exitCode).then(resolve)
    }))
    this.child.stdin!.end(options.request.stdin)
    options.request.stdin = ''
  }
  private countOutput(bytes: number): boolean {
    this.outputBytes += bytes
    if (this.outputBytes <= TEAM_LIMITS.outputBytes) return true
    if (!this.protocolError) { this.protocolError = true; this.emit({ type: 'protocol-error', reason: 'Helper output exceeded 10 MiB.' }); void this.terminateOwned() }
    return false
  }
  private emit(event: HelperEvent): void {
    const clean = (text: string) => scrubSecrets(this.output.scrubOnce(text))
    const sanitized = event.type === 'activity' ? { ...event, text: clean(event.text), category: clean(event.category) }
      : event.type === 'result' ? { ...event, summary: clean(event.summary) }
        : event.type === 'permission-blocked' || event.type === 'protocol-error' ? { ...event, reason: clean(event.reason) }
          : event.type === 'started' ? { ...event, sessionId: event.sessionId ? clean(event.sessionId) : null } : event
    try { this.options.onEvent(sanitized) } catch { this.protocolError = true; void this.terminateOwned() }
  }
  private events(events: HelperEvent[]): void {
    for (const event of events) {
      if (event.type === 'result') this.terminalResult = { ...event, summary: scrubSecrets(this.output.scrubOnce(event.summary)) }
      if (event.type === 'permission-blocked') this.permissionBlocked = true
      if (event.type === 'usage' && this.usage.length < 10000) this.usage.push({ ...event.usage })
      if (event.type === 'protocol-error') { this.protocolError = true; void this.terminateOwned() }
      this.emit(event)
    }
  }
  private scan(): Promise<ProcessIdentity[]> {
    if (this.scanInFlight) return this.scanInFlight
    if (!this.child.pid) { this.inspectionUnknown = true; return Promise.resolve([]) }
    this.scanInFlight = this.platform.inspect(this.child.pid, [...this.identities.values()]).then(({ identities, root, uncertain }) => {
      if (uncertain) throw Error('Owned process identity is uncertain or reused.')
      if (!this.root && root && !this.rootExited) this.root = root
      // A recycled root PID cannot authorize collecting or killing its unrelated descendants.
      if (root && this.root && (root.creationTime !== this.root.creationTime || root.executable !== this.root.executable)) throw Error('Owned root PID was reused.')
      const matching = identities.filter(p => {
        const known = [...this.identities.values()].find(k => k.pid === p.pid)
        return !known || (known.creationTime === p.creationTime && known.executable === p.executable)
      })
      const retained = this.root ? [this.root, ...matching.filter(p => p.pid !== this.root!.pid)] : matching
      if (this.root && (retained.length !== this.identities.size || retained.some(p => !this.identities.has(`${p.pid}:${p.creationTime}`)))) this.options.onProcessObservation?.({ ...this.root }, retained.filter(p => p.pid !== this.root!.pid).map(p => ({ ...p })))
      // Only an unambiguous native observation can retire a descendant. Keep the
      // root identity until whole-tree cessation so a recycled root is never adopted.
      this.identities = new Map(retained.map(p => [`${p.pid}:${p.creationTime}`, p]))
      this.latestLive = matching
      this.inspectionUnknown = false
      return matching
    }).catch(() => { this.inspectionUnknown = true; return this.latestLive }).finally(() => { this.scanInFlight = null })
    return this.scanInFlight
  }
  async cancel(intent: 'cancelled' | 'timed-out' = 'cancelled'): Promise<void> {
    if (!this.intent) {
      try { this.options.onTerminationIntent?.(intent) } catch (error) { this.protocolError = true; throw error }
      this.intent = intent
    }
    await this.terminateOwned()
    this.publishConfirmedCessation()
  }
  private async terminateOwned(): Promise<void> {
    const live = await this.scan()
    if (!this.root || this.inspectionUnknown) return
    // Root first prevents new native commands; creation identity is rechecked before each stop.
    const ordered = [...live].sort((a, b) => Number(b.pid === this.root!.pid) - Number(a.pid === this.root!.pid))
    try { await this.platform.stop(ordered) } catch { /* A child may exit while the signal command is running. */ }
    await this.scan() // Only the final identity observation establishes cessation.
  }
  inspect(): { process: ProcessIdentity | null; descendants: ProcessIdentity[]; cessation: 'live' | 'confirmed' | 'unknown'; intent: HelperProcessOutcome['intent'] } {
    return { process: this.root ? { ...this.root } : null, descendants: [...this.identities.values()].filter(p => p.pid !== this.root?.pid).map(p => ({ ...p })), cessation: this.inspectionUnknown || !this.root ? 'unknown' : this.rootExited && this.latestLive.length === 0 ? 'confirmed' : 'live', intent: this.intent }
  }
  private publishConfirmedCessation(): void {
    if (this.disposed || !this.finished || this.cessationPublished || this.inspect().cessation !== 'confirmed') return
    // A failed durable write must remain retryable; do not release ownership first.
    this.options.onCessationConfirmed?.()
    this.cessationPublished = true
    if (this.reconciliation) clearInterval(this.reconciliation)
    this.reconciliation = null
  }
  private async finish(exitCode: number | null): Promise<HelperProcessOutcome> {
    clearInterval(this.polling); clearTimeout(this.deadline)
    this.events(this.options.parser.finish()); this.output.flush()
    await this.identified.catch(() => undefined)
    const until = Date.now() + 5000
    do {
      await this.scan()
      if (!this.latestLive.length && !this.inspectionUnknown) break
      await new Promise(resolve => setTimeout(resolve, 100))
    } while (Date.now() < until)
    const state = this.inspect()
    this.finished = true
    const outcome: HelperProcessOutcome = { exitCode, cessation: state.cessation === 'confirmed' ? 'confirmed' : 'unknown', result: this.terminalResult, permissionBlocked: this.permissionBlocked, protocolError: this.protocolError, intent: this.intent, process: state.process, descendants: state.descendants, usage: this.usage }
    this.output.dispose()
    this.output = createSessionOutput({ secrets: [], maxChars: 0, flushMs: 50, onText() {} })
    this.options.parser = { push: () => [], finish: () => [] }
    // Remove closures retaining request credentials/prompt/parser once the process has settled.
    this.options.request.secretEnv = {}; this.options.request.stdin = ''
    if (outcome.cessation === 'unknown' && !this.disposed) {
      this.reconciliation = setInterval(() => { void this.scan().then(() => this.publishConfirmedCessation()).catch(() => {}) }, 3000)
      this.reconciliation.unref()
    } else if (outcome.cessation === 'confirmed') this.cessationPublished = true
    return outcome
  }
  async dispose(): Promise<void> {
    try { if (!this.finished || this.inspect().cessation !== 'confirmed') await this.cancel(); this.publishConfirmedCessation() }
    finally { this.disposed = true; clearInterval(this.polling); clearTimeout(this.deadline); if (this.reconciliation) clearInterval(this.reconciliation); this.reconciliation = null; this.output.dispose() }
  }
}

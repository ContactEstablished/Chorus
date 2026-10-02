import { defaultTeamHelperModel } from '../src/shared/teamProfiles'
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { StorageService } from '../src/main/services/storage'
import { CredentialVault } from '../src/main/services/vault'
import { GitWorktreeManager } from '../src/main/services/worktrees'
import { TeamWorkspaceService } from '../src/main/services/teamWorkspaceService'
import { HelperProcess } from '../src/main/services/helperProcess'
import { reserveNextAttempt, startAttempt, settleAttempt } from '../src/main/services/teamCore'
import { opencodeHelper } from '../src/main/adapters/helpers/opencode'
import { composeHelperEnv } from '../src/main/adapters/helpers/common'
import { teamFixtureRun, teamFixtureTask } from '../src/main/services/teamTestFixtures'
import { copyFixtureCredential } from './team-fixture-credential'
import { createExtendedFixture } from './team-extended-fixture'
import { createLongFixture } from './team-long-fixture'
import { installTeamLocalChecks } from './team-local-check-fixture'

const evidence = process.env.CHORUS_TEAM_PILOT_EVIDENCE!
app.setPath('userData', path.join(evidence, 'profile'))
const write = (name: string, value: unknown) => fs.writeFileSync(path.join(evidence, name), JSON.stringify(value, null, 2))
app.whenReady().then(async () => {
  const owner = new StorageService(path.join(evidence, 'helper-only.db')), teams = owner.createTeamStorage()
  let helper: HelperProcess | undefined
  try {
    const root = path.join(evidence, 'source'); fs.mkdirSync(root)
    const workload = process.env.CHORUS_TEAM_PILOT_WORKLOAD === 'long' ? 'long' : 'extended'
    const fixture = workload === 'long' ? createLongFixture(root) : createExtendedFixture(root); installTeamLocalChecks(root, fixture, workload)
    const frozen = fixture.frozen.map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')])
    const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true }).trim()
    git('init', '-qb', 'main'); git('config', 'core.autocrlf', 'false'); git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Independent helper fixture')
    const base = git('rev-parse', 'HEAD'), profileId = copyFixtureCredential(process.env.CHORUS_TEAM_PILOT_SOURCE_DB!, owner)
    const probe = await opencodeHelper.probe(new AbortController().signal); assert.equal(probe.version, '1.18.33')
    const { project } = owner.getOrCreateProject(root), initial = teamFixtureRun(), profile = owner.getCredentialProfileById(profileId)!
    initial.config.helpers = [{ ...initial.config.helpers[0], label: 'DeepSeek helper diagnostic', harness: 'opencode', model: defaultTeamHelperModel, effort: 'low', authMode: 'api_key', providerId: profile.providerId, credentialProfileId: profileId, installedVersion: probe.version!, customModel: true }]
    const run = { ...initial, projectId: project.id, status: 'preparing' as const, baseSha: null, integrationHead: null, integrationWorktreeId: null, config: { ...initial.config, verificationProfile: 'npm-project' as const } }
    teams.createRun(run, 'helper-only', {}, randomUUID())
    const op = (operation: string) => ({ runId: run.id, generation: 1, actor: 'system' as const, operation, eventId: randomUUID(), now: new Date().toISOString() })
    const workspace = new TeamWorkspaceService({ storage: owner, teams, worktrees: new GitWorktreeManager(owner), assertAuthorized() {}, authorizeLead() {}, writersStopped: async () => !helper || helper.inspect().cessation === 'confirmed' })
    const ready = await workspace.prepareRun(run, new AbortController().signal), current = teams.getRun(run.id)
    teams.command(op('activate'), tx => { tx.updateRun(current.version, { ...current, status: 'active', baseSha: base, integrationHead: base, version: current.version + 1 }); return { acknowledgment: {}, event: {} } })
    const task = teamFixtureTask(), group = fixture.groups[0]
    task.command = { ...task.command, paths: group, references: fixture.references, brief: 'Implement the complete data subsystem specified in SPEC.md, preserving the independent job subsystem. Read the committed acceptance files; all data contracts, errors, immutability and prototype-safe properties apply. Use native read/glob/grep and only the listed standalone checks. Run npm test for the owned data acceptance tests, then npm run typecheck and npm run build. No shell probes or scratch files. Return a short summary and checks.', acceptance: ['All original data tests pass; only the owned implementation files change.'] }
    teams.command(op('task'), tx => { tx.writeTask(task); return { acknowledgment: {}, event: {} } })
    const active = teams.getRun(run.id), reserved = reserveNextAttempt(active, [task], [], randomUUID(), new Date().toISOString())!
    teams.command(op('reserve'), tx => { tx.writeAttempt(reserved.attempt); tx.writeTask(reserved.task, task.version); return { acknowledgment: {}, event: {} } })
    const isolated = await workspace.prepareAttempt(active, reserved.attempt, new AbortController().signal)
    const credential = await new CredentialVault(owner).decryptForLaunch(profileId); assert(credential.ok)
    const request = opencodeHelper.buildExecution({ attemptId: reserved.attempt.id, cwd: isolated.cwd, kind: 'code', model: defaultTeamHelperModel, installedVersion: probe.version!, effort: 'low', brief: task.command.brief + '\nFILE OWNERSHIP: ' + group.join(', '), references: fixture.references, acceptance: task.command.acceptance, allowedCommands: ['npm test', 'npm run typecheck', 'npm run build'], credential: { envVarName: 'OPENROUTER_API_KEY', value: credential.value.key, isSecret: true }, route: { providerKey: 'openrouter', providerName: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', modelId: defaultTeamHelperModel }, signal: new AbortController().signal })
    request.envAdditions.CHORUS_HELPER_OWNED_PATHS = JSON.stringify(group)
    credential.value.key = ''
    const cap = process.env.CHORUS_TEAM_PILOT_HELPER_CAP === '64000' || request.envAdditions.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX === '64000' ? 64000 : 32000
    if (cap === 64000 && !request.envAdditions.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX) {
      // Diagnostic-only wrapper: keep production environment policy unchanged.
      // HelperProcess observes and retires this root plus the native CLI subtree.
      const wrapper = path.join(evidence, 'native-cap.cjs')
      fs.writeFileSync(wrapper, `const{spawn}=require('node:child_process');const child=spawn(process.argv[2],process.argv.slice(3),{env:{...process.env,OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX:'64000'},stdio:'inherit',windowsHide:true});child.on('error',()=>process.exit(1));child.on('exit',code=>process.exit(code??1));`)
      const native = request.executable
      request.executable = execFileSync('where.exe', ['node.exe'], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/)[0]
      request.args = [wrapper, native, ...request.args]
    }
    const startedAt = Date.now()
    helper = new HelperProcess({ request, parser: opencodeHelper.createParser(), executionMs: 600000, authorizeSpawn() {}, onEvent: event => fs.appendFileSync(path.join(evidence, 'helper.jsonl'), JSON.stringify(event) + '\n') })
    const identity = await helper.identified, pending = teams.attempts(run.id)[0]
    teams.command(op('started'), tx => { tx.writeAttempt(startAttempt(active, pending, identity, new Date().toISOString()), pending.version); return { acknowledgment: {}, event: {} } })
    const outcome = await helper.done; await helper.retireCompleted()
    write('outcome.json', { workload, ownedFiles: group.length, cap, elapsedSeconds: (Date.now() - startedAt) / 1000, ...outcome })
    const attempt = teams.attempts(run.id)[0], state = helper.inspect(), settled = settleAttempt(active, teams.tasks(run.id)[0], attempt, { attemptId: attempt.id, generation: 1, exitCode: outcome.exitCode, cessation: state.cessation === 'confirmed' ? 'confirmed' : 'unknown', result: outcome.result ? { summary: outcome.result.summary, isError: outcome.result.isError, ...(outcome.result.failure ? { failure: outcome.result.failure } : {}), tests: [] } : null, permissionBlocked: outcome.permissionBlocked, protocolError: outcome.protocolError, now: new Date().toISOString() })
    teams.command(op('settled'), tx => { tx.writeAttempt({ ...settled.attempt, usage: outcome.usage }, attempt.version); tx.writeTask(settled.task, settled.task.version - 1); return { acknowledgment: {}, event: {} } })
    assert.equal(settled.attempt.status, 'succeeded', settled.attempt.result?.summary)
    await workspace.validateResult(active, settled.task, settled.attempt)
    const captured = teams.attempts(run.id)[0]; assert(captured.artifact)
    const node = execFileSync('where.exe', ['node.exe'], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/)[0]
    const acceptance = execFileSync(node, ['helper-check.cjs'], { cwd: isolated.cwd, env: composeHelperEnv(process.env, { envAdditions: { CHORUS_HELPER_OWNED_PATHS: JSON.stringify(group) }, secretEnv: {} }), encoding: 'utf8', windowsHide: true, timeout: 30000 })
    fs.writeFileSync(path.join(evidence, 'independent-acceptance.log'), acceptance)
    const independentTests = Number(acceptance.match(/# pass (\d+)/)?.[1]); assert(independentTests > 0); assert.match(acceptance, /# fail 0/)
    for (const [file, hash] of frozen) assert.equal(createHash('sha256').update(fs.readFileSync(path.join(isolated.cwd, file))).digest('hex'), hash)
    await workspace.review(active, { clientRequestId: randomUUID(), taskId: task.id, attemptId: attempt.id, phase: 'artifact', reviewedSha: captured.artifact.commitSha, decision: 'accept', explanation: 'Independent original data acceptance passed; ownership and frozen inputs checked.', tests: [] }, { role: 'lead', runId: run.id, generation: 1, epoch: 'diagnostic-controller' })
    write('report.json', { passed: true, condition: 'helper-only', workload, ownedFiles: group.length, cap, model: defaultTeamHelperModel, version: probe.version, effort: 'low', elapsedSeconds: (Date.now() - startedAt) / 1000, independentTests, captured: true, reviewed: true, cessation: state.cessation, usage: outcome.usage, evidence, limitation: 'One data assignment; no model lead, combined job acceptance, publication or efficiency comparison.' })
  } catch (error) { write('failure.json', { passed: false, message: String(error), evidence }); process.exitCode = 1 }
  finally { write('snapshot.json', teams.listRunIds().map(id => teams.snapshot(id))); await helper?.dispose(); owner.close(); app.exit(Number(process.exitCode ?? 0)) }
}).catch(error => { write('failure.json', { passed: false, message: String(error), evidence }); app.exit(1) })

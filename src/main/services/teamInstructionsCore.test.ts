import { describe, expect, it } from 'vitest'
import { teamInstructions } from './teamInstructionsCore'
import { teamFixtureRun } from './teamTestFixtures'
describe('Team lead instructions', () => {
  it('uses one long decision wait for qualified Codex and retains short waits for legacy leads', () => {
    const run = teamFixtureRun(); run.config.lead.harness = 'codex'; run.config.lead.model = 'gpt-6.1-sol'; run.config.lead.installedVersion = 'codex-cli 0.159.0'
    expect(teamInstructions(run)).toContain('choose timeoutMs 900000')
    run.config.lead.installedVersion = 'codex-cli 0.160.0'
    expect(teamInstructions(run)).toContain('choose timeoutMs 900000')
    expect(teamInstructions(run)).toContain('"yield_time_ms": 120000')
    run.config.lead.installedVersion = 'codex-cli 0.155.1'
    expect(teamInstructions(run)).toContain('choose timeoutMs 20000')
    run.config.lead.installedVersion = 'codex-cli 0.160.1'
    expect(teamInstructions(run)).toContain('choose timeoutMs 20000')
  })
  it('uses the long decision wait for exactly the qualified Claude leads', () => {
    const run = teamFixtureRun()
    for (const version of ['2.1.285 (Claude Code)', '2.1.286 (Claude Code)', '2.1.289 (Claude Code)']) { run.config.lead.installedVersion = version; expect(teamInstructions(run)).toContain('choose timeoutMs 900000') }
    for (const version of ['2.1.278 (Claude Code)', '2.1.288 (Claude Code)', '2.1.290 (Claude Code)']) { run.config.lead.installedVersion = version; expect(teamInstructions(run)).toContain('choose timeoutMs 20000') }
  })
  it('requires complete independent deliverables and automatic serial integration even for legacy ask runs', () => {
    const run = teamFixtureRun(); run.config.integrationPolicy = 'ask'
    const text = teamInstructions(run)
    expect(text).toContain('Geometry practice test and a Geometry cheat sheet can run in parallel')
    expect(text).toContain('Do not copy an existing specification')
    expect(text).toContain('Chorus supplies sandbox/check/capture rules')
    expect(text).toContain('submit verificationIds')
    expect(text).toContain('private build/test folders')
    expect(text).toContain('apply immediately without requesting human approval')
    expect(text).toContain('do not create a carry or recarry helper task')
    expect(text).toContain('OpenCode analysis helpers cannot run shell commands')
    expect(text).not.toContain('wait for user approval under ask policy')
  })
  it('preserves memory instructions and binds roster, review evidence and the cooperative write lease', () => {
    const run = teamFixtureRun(), text = teamInstructions(run, 'MEMORY CONTRACT')
    expect(text).toContain('MEMORY CONTRACT'); expect(text).toContain(run.config.helpers[0].id)
    expect(text).toContain('maximum three attempts'); expect(text).toContain('do not write')
    expect(text).toContain('independently test'); expect(text).toContain('test source paths')
    expect(text).toContain('not an OS lock'); expect(text).not.toContain('CHORUS_TEAM_TOKEN')
  })
  it('keeps Nitro guidance and compact evidence explicit for the qualified Codex lead', () => {
    const run = teamFixtureRun()
    run.config.lead.harness = 'codex'; run.config.lead.installedVersion = 'codex-cli 0.159.3'
    run.config.helpers[0].harness = 'opencode'; run.config.helpers[0].model = 'deepseek/deepseek-v4.1-flash:nitro'
    const text = teamInstructions(run, '')
    expect(text).toContain('small coherent assignments')
    expect(text).toContain('reuseReviewed true')
    expect(text).toContain('reviewed-equivalent receipt')
    expect(text).toContain('"yield_time_ms": 120000')
    expect(text).toContain('never start a duplicate Team wait')
    expect(text).toContain('independently test')
  })
  it('renders one physical Codex line and labels recovery authority', () => {
    const run = teamFixtureRun(); run.config.lead.harness = 'codex'; run.status = 'recovering'
    const text = teamInstructions(run, 'memory\ncontract')
    expect(text).not.toMatch(/[\r\n]/); expect(text).toContain('RECOVERY ONLY'); expect(text).toContain('no delegation or integration')
    expect(text).toContain('chorus-team tools permit inspection only')
    expect(text).toContain('explicitly user-authorized local Git checkpoint')
    expect(text).toContain('commit only the authorized retained files, preserving their contents')
    expect(text).toContain('Do not resume automatically')
    expect(text).not.toContain('Pausing/recovery permit inspection only')
  })
})

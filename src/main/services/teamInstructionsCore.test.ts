import { describe, expect, it } from 'vitest'
import { teamInstructions } from './teamInstructionsCore'
import { teamFixtureRun } from './teamTestFixtures'
describe('Team lead instructions', () => {
  it('requires complete independent deliverables and automatic serial integration even for legacy ask runs', () => {
    const run = teamFixtureRun(); run.config.integrationPolicy = 'ask'
    const text = teamInstructions(run)
    expect(text).toContain('Geometry practice test and a Geometry cheat sheet can run in parallel')
    expect(text).toContain('self-contained brief')
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

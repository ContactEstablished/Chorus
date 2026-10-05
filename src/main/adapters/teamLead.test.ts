import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { allowedLeadCombination, allowedHelperCombination } from './helpers/evidence'
import { buildTeamLeadConfiguration } from './teamLead'
import { teamRunConfigSchema } from '../../shared/team'
import { teamFixtureRun } from '../services/teamTestFixtures'

const roots: string[] = []
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chorus-team-lead-test-'))
  roots.push(root)
  const worktree = path.join(root, 'repo'); fs.mkdirSync(worktree)
  return { lead: 'claude' as const, worktree, configDirectory: path.join(root, 'external'), nodeExecutable: process.execPath, bridgeScript: path.join(root, 'bridge.cjs'), verifiedVersion: '2.1.278 (Claude Code)' }
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
describe('team lead external MCP configuration', () => {
  it.each(['codex-cli 0.159.0', 'codex-cli 0.159.3', 'codex-cli 0.160.0'])('limits Codex long waits and Sol admission to exact qualified lead %s, preserving helper gates', verifiedVersion => {
    const input = { ...fixture(), lead: 'codex' as const, verifiedVersion, otherServers: [{ name: 'memory', command: 'node', args: [] }] }
    const result = buildTeamLeadConfiguration(input)
    expect(result.args).toContain('mcp_servers.chorus-team.tool_timeout_sec=930')
    expect(result.args).toContain('check_for_update_on_startup=false')
    expect(result.args).toContain('--no-daemon')
    expect(result.args.join(' ')).not.toContain('mcp_servers.memory.tool_timeout_sec')
    expect(result.generatedPaths).toEqual([])
    for (const model of ['gpt-6-astra', 'gpt-6.1-sol']) expect(allowedLeadCombination({ id: 'codex', version: input.verifiedVersion, model, authMode: 'subscription' })).toBe(true)
    const sol = { id: 'codex' as const, version: input.verifiedVersion, model: 'gpt-6.1-sol', authMode: 'subscription' as const }
    expect(allowedHelperCombination(sol)).toBe(false)
    expect(allowedHelperCombination({ ...sol, model: 'gpt-6-astra' })).toBe(verifiedVersion === 'codex-cli 0.159.0')
    expect(allowedLeadCombination({ ...sol, version: 'codex-cli 0.155.1' })).toBe(false)
    expect(allowedLeadCombination({ ...sol, version: 'codex-cli 0.160.1' })).toBe(false)
    expect(allowedLeadCombination({ ...sol, version: 'codex-cli 0.159.4' })).toBe(false)
    expect(() => buildTeamLeadConfiguration({ ...input, verifiedVersion: 'codex-cli 0.159.4' })).toThrow(/compatibility/)
    expect(allowedLeadCombination({ ...sol, model: 'gpt-6-sol' })).toBe(false)
    expect(allowedLeadCombination({ ...sol, authMode: 'api_key' })).toBe(false)
    expect(buildTeamLeadConfiguration({ ...input, verifiedVersion: 'codex-cli 0.155.1' }).args).not.toContain('mcp_servers.chorus-team.tool_timeout_sec=930')
  })
  it('focuses the current Claude pilot while keeping explicit project memory and old launches intact', () => {
    const input = fixture()
    const result = buildTeamLeadConfiguration({ ...input, verifiedVersion: '2.1.285 (Claude Code)', focused: true, otherServers: [{ name: 'memory', command: 'node', args: [] }] })
    expect(result.args).toEqual(expect.arrayContaining(['--strict-mcp-config', '--disable-slash-commands']))
    expect(result.args).not.toContain('--setting-sources')
    expect(JSON.parse(fs.readFileSync(result.generatedPaths[0], 'utf8')).mcpServers.memory).toBeDefined()
    const other = fixture()
    expect(buildTeamLeadConfiguration(other).args).not.toContain('--disable-slash-commands')
    expect(() => buildTeamLeadConfiguration({ ...fixture(), focused: true })).toThrow(/current compatibility/)
  })
  it.each(['2.1.286 (Claude Code)', '2.1.289 (Claude Code)'])('admits the exact new lead pilot %s with bounded waits, without admitting new helper or future versions', verifiedVersion => {
    const result = buildTeamLeadConfiguration({ ...fixture(), verifiedVersion, focused: true })
    expect(result.args).toEqual(expect.arrayContaining(['--strict-mcp-config', '--disable-slash-commands']))
    expect(result.envAdditions).toEqual({ CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS: '0' })
    expect(JSON.parse(fs.readFileSync(result.generatedPaths[0], 'utf8')).mcpServers['chorus-team'].timeout).toBe(930000)
    const member = { id: 'claude' as const, version: verifiedVersion, model: 'claude-opus-5-5', authMode: 'subscription' as const }
    expect(allowedLeadCombination(member)).toBe(true)
    expect(allowedHelperCombination({ ...member, model: 'sonnet' })).toBe(false)
    const config = teamFixtureRun().config
    expect(teamRunConfigSchema.safeParse({ ...config, leadContext: 'focused', lead: { ...config.lead, installedVersion: verifiedVersion } }).success).toBe(true)
    // Exact strings only: the unadmitted neighbours between and after the qualified versions stay closed.
    for (const version of ['2.1.287 (Claude Code)', '2.1.288 (Claude Code)', '2.1.290 (Claude Code)']) {
      expect(() => buildTeamLeadConfiguration({ ...fixture(), verifiedVersion: version, focused: true })).toThrow()
      expect(() => buildTeamLeadConfiguration({ ...fixture(), verifiedVersion: version })).toThrow(/compatibility/)
      expect(allowedLeadCombination({ ...member, version })).toBe(false)
      const refused = teamRunConfigSchema.safeParse({ ...config, leadContext: 'focused', lead: { ...config.lead, installedVersion: version } })
      expect(refused.success).toBe(false)
      expect(refused.error?.issues.map(issue => issue.message).join(' ')).toContain('requires the Claude 2.1.285, 2.1.286 or 2.1.289 pilot')
    }
  })
  it('writes Claude placeholders outside Git, includes other servers, and refuses overwrite', () => {
    const input = fixture()
    const result = buildTeamLeadConfiguration({ ...input, otherServers: [{ name: 'memory', command: 'node', args: ['memory.js'], env: { NEO4J_PASSWORD: '${NEO4J_PASSWORD}' } }] })
    const config = JSON.parse(fs.readFileSync(result.generatedPaths[0], 'utf8'))
    expect(config.mcpServers['chorus-team'].env.CHORUS_TEAM_TOKEN).toBe('${CHORUS_TEAM_TOKEN}')
    expect(config.mcpServers.memory).toBeDefined()
    expect(fs.readdirSync(input.worktree)).toEqual([])
    expect(() => buildTeamLeadConfiguration(input)).toThrow()
  })
  it('uses Codex variable names only without writing config files', () => {
    const input = fixture()
    const result = buildTeamLeadConfiguration({ ...input, lead: 'codex', verifiedVersion: 'codex-cli 0.155.1' })
    expect(result.generatedPaths).toEqual([])
    expect(result.args.join(' ')).toContain('env_vars=["CHORUS_TEAM_ENDPOINT","CHORUS_TEAM_TOKEN"]')
    expect(result.args).toContain('mcp_servers.chorus-team.required=true')
    expect(fs.existsSync(input.configDirectory)).toBe(false)
  })
  it('rejects worktree config, duplicate server and secret literals', () => {
    const input = fixture()
    expect(() => buildTeamLeadConfiguration({ ...input, verifiedVersion: 'unknown' })).toThrow(/compatibility/)
    expect(() => buildTeamLeadConfiguration({ ...input, configDirectory: path.join(input.worktree, 'config') })).toThrow(/outside/)
    expect(() => buildTeamLeadConfiguration({ ...input, otherServers: [{ name: 'chorus-team', command: 'node', args: [] }] })).toThrow(/Duplicate/)
    expect(() => buildTeamLeadConfiguration({ ...input, otherServers: [{ name: 'memory', command: 'node', args: [], env: { PASSWORD: 'literal-secret' } }] })).toThrow(/placeholders/)
  })
})

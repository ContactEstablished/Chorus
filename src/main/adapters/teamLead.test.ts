import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { allowedLeadCombination, allowedHelperCombination } from './helpers/evidence'
import { buildTeamLeadConfiguration } from './teamLead'

const roots: string[] = []
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chorus-team-lead-test-'))
  roots.push(root)
  const worktree = path.join(root, 'repo'); fs.mkdirSync(worktree)
  return { lead: 'claude' as const, worktree, configDirectory: path.join(root, 'external'), nodeExecutable: process.execPath, bridgeScript: path.join(root, 'bridge.cjs'), verifiedVersion: '2.1.278 (Claude Code)' }
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
describe('team lead external MCP configuration', () => {
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
  it('admits the exact new lead pilot with bounded waits, without admitting new helper or future versions', () => {
    const result = buildTeamLeadConfiguration({ ...fixture(), verifiedVersion: '2.1.286 (Claude Code)', focused: true })
    expect(result.envAdditions).toEqual({ CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS: '0' })
    expect(JSON.parse(fs.readFileSync(result.generatedPaths[0], 'utf8')).mcpServers['chorus-team'].timeout).toBe(930000)
    const member = { id: 'claude' as const, version: '2.1.286 (Claude Code)', model: 'claude-opus-5-5', authMode: 'subscription' as const }
    expect(allowedLeadCombination(member)).toBe(true)
    expect(allowedHelperCombination({ ...member, model: 'sonnet' })).toBe(false)
    expect(() => buildTeamLeadConfiguration({ ...fixture(), verifiedVersion: '2.1.287 (Claude Code)', focused: true })).toThrow()
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

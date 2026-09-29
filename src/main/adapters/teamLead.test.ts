import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
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

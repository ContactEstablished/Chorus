import fs from 'node:fs'
import path from 'node:path'
import { renderMcpLaunchArgs } from './mcpConfigCore'
import type { McpServerRef } from './types'
import { verifiedLeadVersion } from './helpers/evidence'

export interface TeamLeadConfiguration {
  args: string[]
  generatedPaths: string[]
  /** Names only; values must be supplied by main under the run lease. */
  requiredEnvVars: readonly string[]
}
export interface TeamLeadConfigurationInput {
  lead: 'claude' | 'codex'
  worktree: string
  configDirectory: string
  nodeExecutable: string
  bridgeScript: string
  otherServers?: readonly McpServerRef[]
  /** Installed-version probe evidence, not a model catalog capability. */
  verifiedVersion: string
}

const TEAM_ENV = ['CHORUS_TEAM_ENDPOINT', 'CHORUS_TEAM_TOKEN'] as const
function outside(parent: string, target: string): boolean {
  const relative = path.relative(parent, target)
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
}

/** Per-launch external configuration only. Never invoke the ordinary project-file writer. */
export function buildTeamLeadConfiguration(input: TeamLeadConfigurationInput): TeamLeadConfiguration {
  if (!verifiedLeadVersion(input.lead, input.verifiedVersion)) throw new Error('Team lead requires matching installed-version compatibility evidence.')
  if (![input.worktree, input.configDirectory, input.nodeExecutable, input.bridgeScript].every(path.isAbsolute)) throw new Error('Team launch paths must be absolute.')
  const worktree = fs.realpathSync(input.worktree)
  // Resolve existing parent before mkdir so a junction cannot redirect generated config into Git.
  let ancestor = input.configDirectory
  while (!fs.existsSync(ancestor)) {
    const next = path.dirname(ancestor)
    if (next === ancestor) throw new Error('No valid configuration ancestor.')
    ancestor = next
  }
  const resolved = path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, input.configDirectory))
  if (!outside(worktree, resolved)) throw new Error('Team configuration must be outside its worktree.')
  const servers = [...(input.otherServers ?? [])]
  if (servers.some((server) => server.name === 'chorus-team')) throw new Error('Duplicate chorus-team MCP server.')
  if (new Set(servers.map((s) => s.name)).size !== servers.length || servers.some((s) => !/^[A-Za-z0-9_-]+$/.test(s.name))) throw new Error('Invalid or duplicate MCP server name.')
  servers.push({ name: 'chorus-team', command: input.nodeExecutable, args: [input.bridgeScript], envPassthrough: TEAM_ENV })
  if (input.lead === 'codex') {
    if (servers.some((s) => s.env && Object.keys(s.env).length > 0)) throw new Error('Codex team MCP values must be supplied through named environment variables.')
    return { args: [...renderMcpLaunchArgs(servers), '-c', 'mcp_servers.chorus-team.required=true'], generatedPaths: [], requiredEnvVars: TEAM_ENV }
  }
  const mcpServers: Record<string, unknown> = {}
  for (const server of servers) {
    const env: Record<string, string> = { ...server.env }
    for (const name of server.envPassthrough ?? []) {
      if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error('Invalid MCP environment variable name.')
      env[name] = '${' + name + '}'
    }
    // Values in externally supplied servers are placeholders only for this path.
    if (Object.values(env).some((v) => !/^\$\{[A-Z][A-Z0-9_]*\}$/.test(v))) throw new Error('Team MCP configuration accepts environment placeholders only.')
    mcpServers[server.name] = { command: server.command, args: [...server.args], ...(Object.keys(env).length ? { env } : {}) }
  }
  fs.mkdirSync(resolved, { recursive: true })
  if (!outside(worktree, fs.realpathSync(resolved))) throw new Error('Team configuration path changed into a worktree.')
  const configPath = path.join(resolved, 'team-mcp.json')
  fs.writeFileSync(configPath, JSON.stringify({ mcpServers }), { flag: 'wx', mode: 0o600 })
  return { args: ['--mcp-config', configPath], generatedPaths: [configPath], requiredEnvVars: TEAM_ENV }
}

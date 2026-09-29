import { tomlBasicString } from '../mcpConfigCore'
import { helperLaunch, probeHelper } from './common'
import { createHelperParser } from './parser'
import type { HelperAdapter } from './types'

export const codexHelper: HelperAdapter = {
  id: 'codex',
  probe: (signal) => probeHelper('codex', signal),
  createParser: () => createHelperParser('codex'),
  buildExecution(input) {
    const launch = helperLaunch('codex', input)
    if (process.platform === 'win32' && !input.windowsSandbox) throw new Error('Select a verified installed Windows sandbox implementation.')
    launch.args.push('exec', '--ignore-user-config', '--ignore-rules', '--json', '--ephemeral',
      '--sandbox', input.kind === 'analysis' ? 'read-only' : 'workspace-write',
      '-c', 'approval_policy="never"', '--disable', 'multi_agent', '--model', input.model)
    if (input.windowsSandbox) launch.args.push('-c', `windows.sandbox=${tomlBasicString(input.windowsSandbox)}`)
    if (input.effort) {
      if (!/^[a-z][a-z0-9_-]{0,31}$/.test(input.effort)) throw new Error('Invalid Codex effort.')
      launch.args.push('-c', `model_reasoning_effort=${tomlBasicString(input.effort)}`)
    }
    if (input.credential && input.route) {
      const url = new URL(input.route.baseUrl)
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Invalid selected Responses API route.')
      // Fixed private provider key prevents user configuration names becoming TOML paths.
      launch.args.push('-c', 'model_provider="chorus_helper"',
        '-c', `model_providers.chorus_helper.name=${tomlBasicString(input.route.providerName)}`,
        '-c', `model_providers.chorus_helper.base_url=${tomlBasicString(url.toString().replace(/\/+$/, ''))}`,
        '-c', `model_providers.chorus_helper.env_key=${tomlBasicString(input.credential.envVarName)}`,
        '-c', 'model_providers.chorus_helper.wire_api="responses"')
    }
    launch.args.push('-')
    return launch
  }
}

import { helperLaunch, probeHelper } from './common'
import { createHelperParser } from './parser'
import type { HelperAdapter } from './types'
import { normalizeTeamModel } from '../../../shared/teamProfiles'

export const opencodeHelper: HelperAdapter = {
  id: 'opencode',
  probe: (signal) => probeHelper('opencode', signal),
  createParser: () => createHelperParser('opencode'),
  buildExecution(input) {
    const launch = helperLaunch('opencode', input)
    if (!input.credential || input.credential.envVarName !== 'OPENROUTER_API_KEY' || input.route?.baseUrl.replace(/\/+$/, '') !== 'https://openrouter.ai/api/v1') {
      throw new Error('This opencode helper requires the verified OpenRouter API route.')
    }
    const model = `openrouter/${normalizeTeamModel(input.model)}`
    launch.args.push('run', '--pure', '--format', 'json', '--model', model)
    if (input.effort) {
      if (!/^[a-z][a-z0-9_-]{0,31}$/.test(input.effort)) throw new Error('Invalid opencode variant.')
      launch.args.push('--variant', input.effort)
    }
    const bash: Record<string, string> = { '*': 'deny' }
    if (input.kind === 'code') for (const command of input.allowedCommands ?? []) {
      if (!command.trim() || /[\r\n]/.test(command)) throw new Error('Invalid opencode command permission.')
      bash[command] = 'allow'
    }
    launch.envAdditions = {
      OPENCODE_DISABLE_AUTOUPDATE: 'true', OPENCODE_DISABLE_LSP_DOWNLOAD: 'true',
      OPENCODE_CONFIG_CONTENT: JSON.stringify({ share: 'disabled', provider: { openrouter: { models: { [normalizeTeamModel(input.model)]: {} } } }, permission: {
        '*': 'deny', read: 'allow', glob: 'allow', grep: 'allow',
        edit: input.kind === 'analysis' ? 'deny' : 'allow', bash,
        task: 'deny', question: 'deny', external_directory: 'deny'
      } })
    }
    return launch
  }
}

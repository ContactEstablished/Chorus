import { helperLaunch, probeHelper } from './common'
import { createHelperParser } from './parser'
import type { HelperAdapter } from './types'

export const claudeHelper: HelperAdapter = {
  id: 'claude',
  probe: (signal) => probeHelper('claude', signal),
  createParser: () => createHelperParser('claude'),
  buildExecution(input) {
    const launch = helperLaunch('claude', input)
    launch.envAdditions.DISABLE_AUTOUPDATER = '1'
    if (input.credential && (input.credential.envVarName !== 'ANTHROPIC_API_KEY' || input.route?.baseUrl.replace(/\/+$/, '') !== 'https://api.anthropic.com')) {
      throw new Error('This Claude helper API route has not been verified.')
    }
    launch.args.push('-p', '--output-format', 'stream-json', '--verbose', '--model', input.model,
      '--permission-mode', input.kind === 'analysis' ? 'dontAsk' : 'acceptEdits',
      '--permission-prompts', 'none', '--strict-mcp-config', '--setting-sources', '',
      '--disallowedTools', 'Agent,Task', '--tools', input.kind === 'analysis' ? 'Read,Glob,Grep' : 'Read,Glob,Grep,Edit,Write,Bash')
    if (input.kind === 'code' && input.allowedCommands?.length) {
      if (input.allowedCommands.some((c) => !c.trim() || /[\r\n()]/.test(c))) throw new Error('Invalid native Claude command allow rule.')
      launch.args.push('--allowedTools', ...input.allowedCommands.map((command) => `Bash(${command})`))
    }
    if (input.effort) {
      if (!['low', 'medium', 'high', 'xhigh', 'max'].includes(input.effort)) throw new Error('Unsupported Claude effort.')
      launch.args.push('--effort', input.effort)
    }
    return launch
  }
}

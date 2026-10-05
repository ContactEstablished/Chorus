import { helperLaunch, probeHelper } from './common'
import { createHelperParser } from './parser'
import type { HelperAdapter } from './types'
import { defaultTeamHelperModel, isDeepSeekFlashHelperModel, normalizeTeamModel } from '../../../shared/teamProfiles'

export const opencodeHelper: HelperAdapter = {
  id: 'opencode',
  probe: (signal) => probeHelper('opencode', signal),
  createParser: () => createHelperParser('opencode'),
  buildExecution(input) {
    const launch = helperLaunch('opencode', input)
    if (!input.credential || input.credential.envVarName !== 'OPENROUTER_API_KEY' || input.route?.baseUrl.replace(/\/+$/, '') !== 'https://openrouter.ai/api/v1') {
      throw new Error('This opencode helper requires the verified OpenRouter API route.')
    }
    const modelId = normalizeTeamModel(input.model)
    const model = `openrouter/${modelId}`
    // Nitro is a routing alias absent from the native model catalog. Without an
    // explicit variant, OpenCode silently drops --variant low for this ID.
    const modelOptions = input.installedVersion === '1.18.33' && modelId === defaultTeamHelperModel
      ? { variants: { low: { reasoning: { effort: 'low' } } } } : {}
    const measuredCodeHelper = input.kind === 'code' && input.installedVersion === '1.18.33' && isDeepSeekFlashHelperModel(input.model) && input.effort === 'low'
    launch.args.push('run', '--pure', '--format', 'json', '--model', model)
    if (measuredCodeHelper) launch.args.push('--agent', 'build')
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
      // Native request probe and ten-file/131-test completion, 2026-10-01:
      // this model needed 41,822 reasoning tokens before its first edit. The
      // client's default 32,000 cap exhausted generation before useful output.
      ...(measuredCodeHelper ? { OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX: '64000' } : {}),
      OPENCODE_CONFIG_CONTENT: JSON.stringify({ share: 'disabled', ...(measuredCodeHelper ? { agent: { build: { prompt: 'CHORUS BOUNDED HELPER. Complete the assigned implementation and its checks inside the current owned worktree. Read the committed references and preserve files outside declared ownership. Use native read/glob/grep for discovery; never use shell discovery, Git, version probes, external scratch paths or nested agents. IMPORTANT NATIVE PATH CONTRACT: on this installed OpenCode version, read/write/edit/glob/grep accept workspace-relative paths, verified by native execution. Their generic descriptions requesting absolute paths are misleading for this runtime. Use repository-relative filePath/path arguments such as expression.cjs or src/file.ts; never reconstruct or copy an absolute worktree path. Read an existing file before editing it. Bash is only for the exact standalone check commands listed in the assignment, with no extra flags, redirects, pipes, filters or chaining. A denied probe makes the attempt fail even if later edits pass; do not probe forbidden commands. Implement the complete committed contract, run the allowed checks, and return a concise result with any blockers. Do not stage or commit; Chorus captures files after you exit.' } } } : {}), provider: { openrouter: { models: { [modelId]: modelOptions } } }, permission: {
        '*': 'deny', read: 'allow', glob: 'allow', grep: 'allow',
        edit: input.kind === 'analysis' ? 'deny' : 'allow', bash,
        task: 'deny', question: 'deny', external_directory: 'deny'
      } })
    }
    return launch
  }
}

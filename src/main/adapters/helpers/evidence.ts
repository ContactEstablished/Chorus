import { focusedTeamClaudeVersion, decisionWaitCodexVersion, codexTeamLeadModels } from '../../../shared/team'
import type { HelperCapabilities, HelperId } from './types'
import { teamModelSchema } from '../../../shared/teamProfiles'

/** Measured by Task 11-1 on Windows. A new binary/model/auth route is not inherited support. */
export const VERIFIED_HELPER_VERSIONS: Readonly<Record<HelperId, string>> = Object.freeze({
  claude: '2.1.278 (Claude Code)', codex: 'codex-cli 0.155.1', opencode: '1.18.31'
})
/** Explicit compatibility-pilot versions; never silently accept an arbitrary future CLI. */
export const PILOT_HELPER_VERSIONS: Readonly<Record<HelperId, string>> = Object.freeze({ claude: '2.1.285 (Claude Code)', codex: 'codex-cli 0.159.0', opencode: '1.18.33' })
export const supportedHelperVersion = (id: HelperId, version: string): boolean => version === VERIFIED_HELPER_VERSIONS[id] || version === PILOT_HELPER_VERSIONS[id]
export function allowedLeadCombination(input: HelperCombination): boolean {
  return input.id !== 'opencode' && (supportedHelperVersion(input.id, input.version) || input.id === 'claude' && focusedTeamClaudeVersion(input.version)) && input.authMode === 'subscription' && !input.baseUrl
    && (input.id === 'claude' ? ['sonnet', 'claude-sonnet-5', 'opus', 'claude-opus-5-5'].includes(input.model) : input.model === 'gpt-6-astra' || decisionWaitCodexVersion(input.version) && (codexTeamLeadModels as readonly string[]).includes(input.model))
}
export interface HelperCombination {
  id: HelperId
  version: string
  authMode: 'subscription' | 'api_key'
  model: string
  baseUrl?: string
}
export function verifiedHelperCombination(input: HelperCombination): boolean {
  if (input.version !== VERIFIED_HELPER_VERSIONS[input.id]) return false
  if (input.id === 'claude') return input.authMode === 'subscription' && !input.baseUrl && ['sonnet', 'claude-sonnet-5'].includes(input.model)
  if (input.id === 'codex') return input.authMode === 'subscription' && !input.baseUrl && input.model === 'gpt-6-astra'
  return input.authMode === 'api_key' && input.baseUrl?.replace(/\/+$/, '') === 'https://openrouter.ai/api/v1' && ['z-ai/glm-5.3', 'openrouter/z-ai/glm-5.3'].includes(input.model)
}
/** A user-selected custom OpenRouter model may use the measured adapter without claiming model verification. */
export function allowedHelperCombination(input: HelperCombination & { customModel?: boolean }): boolean {
  return verifiedHelperCombination(input) || (supportedHelperVersion(input.id, input.version)
    && (input.id === 'opencode' ? input.authMode === 'api_key' && input.baseUrl?.replace(/\/+$/, '') === 'https://openrouter.ai/api/v1'
      && (input.customModel === true || ['z-ai/glm-5.3', 'openrouter/z-ai/glm-5.3', 'deepseek/deepseek-v4.1-flash'].includes(input.model)) && teamModelSchema.safeParse(input.model).success
      : input.authMode === 'subscription' && !input.baseUrl && (input.id === 'claude' ? ['sonnet', 'claude-sonnet-5'].includes(input.model) : input.model === 'gpt-6-astra')))
}
export function applyVerifiedHelperEvidence(capabilities: HelperCapabilities): HelperCapabilities {
  if (capabilities.version !== VERIFIED_HELPER_VERSIONS[capabilities.id] || capabilities.structured.status !== 'verified') return capabilities
  const verified = (reason: string) => ({ status: 'verified' as const, reason: `2026-09-20, ${capabilities.version}: ${reason}` })
  const model = capabilities.id === 'claude' ? 'claude-sonnet-5' : capabilities.id === 'codex' ? 'gpt-6-astra' : 'OpenRouter z-ai/glm-5.3'
  return {
    ...capabilities,
    subscription: capabilities.id === 'opencode' ? capabilities.subscription : verified(`${model}; current CLI-managed account only, no account switching.`),
    apiKey: capabilities.id === 'opencode' ? verified(`${model}; selected OpenRouter credential only.`) : { status: 'unverified', reason: 'Native API-key variants have not been proved and remain disabled.' },
    analysis: verified(`${model}; native read-only tools/sandbox, unchanged isolated worktree.`),
    code: verified(`${model}; structured edit plus native and independent node:test evidence.`),
    cancellation: verified('Owned root and observed descendant identities ceased; fixture writer stopped. Runtime must repeat identity checks, never infer exit from kill success.'),
    nativeSubagents: verified('Native agent tools disabled by the measured launch policy. This is not isolation against arbitrary programs spawned through permitted shell tools.')
  }
}
export function verifiedLeadVersion(lead: 'claude' | 'codex', version: string): boolean {
  return supportedHelperVersion(lead, version) || lead === 'claude' && focusedTeamClaudeVersion(version)
}

import { focusedTeamClaudeVersion, decisionWaitCodexVersion, codexTeamLeadModels } from '../../../shared/team'
import type { HelperCapabilities, HelperId } from './types'
import { isDeepSeekFlashHelperModel, teamModelSchema } from '../../../shared/teamProfiles'

/** Measured by Task 11-1 on Windows. A new binary/model/auth route is not inherited support. */
export const VERIFIED_HELPER_VERSIONS: Readonly<Record<HelperId, string>> = Object.freeze({
  claude: '2.1.278 (Claude Code)', codex: 'codex-cli 0.155.1', opencode: '1.18.31'
})
/** OpenCode helper versions measured natively at zero cost (loopback stand-in, placeholder key):
 * 1.18.33, and 1.18.34 on 2026-10-04, whose helper requests matched 1.18.33's request for request
 * when the same builder output ran on both binaries (low effort, 64,000 max_tokens, build agent,
 * :nitro low variant, relative native paths). Admission and the measured route key on this list. */
export const MEASURED_OPENCODE_HELPER_VERSIONS: readonly string[] = Object.freeze(['1.18.33', '1.18.34'])
export const measuredOpencodeHelperVersion = (version: string | undefined): boolean => version !== undefined && MEASURED_OPENCODE_HELPER_VERSIONS.includes(version)
/** Explicit compatibility-pilot versions; never silently accept an arbitrary future CLI. */
export const PILOT_HELPER_VERSIONS: Readonly<Record<HelperId, readonly string[]>> = Object.freeze({ claude: Object.freeze(['2.1.285 (Claude Code)']), codex: Object.freeze(['codex-cli 0.159.0']), opencode: MEASURED_OPENCODE_HELPER_VERSIONS })
export const supportedHelperVersion = (id: HelperId, version: string): boolean => version === VERIFIED_HELPER_VERSIONS[id] || PILOT_HELPER_VERSIONS[id].includes(version)
/** Native loopback request evidence on each measured OpenCode version: this exact variant sends
 * reasoning.effort=low for DeepSeek Flash. No other overrides are admitted. */
export const allowedHelperEffort = (id: HelperId, version: string, model: string, effort: string | null): boolean => effort === null || id === 'opencode' && measuredOpencodeHelperVersion(version) && isDeepSeekFlashHelperModel(model) && effort === 'low'
export const defaultHelperEffort = (id: HelperId, version: string, model: string): 'low' | null => allowedHelperEffort(id, version, model, 'low') ? 'low' : null
export function allowedLeadCombination(input: HelperCombination): boolean {
  return input.id !== 'opencode' && verifiedLeadVersion(input.id, input.version) && input.authMode === 'subscription' && !input.baseUrl
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
      && (input.customModel === true || ['z-ai/glm-5.3', 'openrouter/z-ai/glm-5.3'].includes(input.model) || isDeepSeekFlashHelperModel(input.model)) && teamModelSchema.safeParse(input.model).success
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
  return supportedHelperVersion(lead, version) || (lead === 'claude' ? focusedTeamClaudeVersion(version) : decisionWaitCodexVersion(version))
}

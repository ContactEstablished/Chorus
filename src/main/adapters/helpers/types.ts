import type { PtyLaunchRoute, ResolvedCredential } from '../types'
import type { RoutingLaunchSelection } from '../../../shared/routing'

export type HelperId = 'claude' | 'codex' | 'opencode'
export type EvidenceStatus = 'verified' | 'unsupported' | 'unverified'
export interface CapabilityEvidence {
  status: EvidenceStatus
  reason: string
}
export interface HelperCapabilities {
  id: HelperId
  executable: string | null
  version: string | null
  structured: CapabilityEvidence
  subscription: CapabilityEvidence
  apiKey: CapabilityEvidence
  analysis: CapabilityEvidence
  code: CapabilityEvidence
  cancellation: CapabilityEvidence
  nativeSubagents: CapabilityEvidence
}
export interface HelperExecutionInput {
  attemptId: string
  cwd: string
  kind: 'code' | 'analysis'
  brief: string
  /** Immutable first assignment, supplied on counted revisions. */
  originalBrief?: string
  roleInstructions?: string
  context?: string
  acceptance?: readonly string[]
  references?: readonly string[]
  model: string
  /** Version resolved and authorized by the runtime immediately before dispatch. */
  installedVersion?: string
  effort?: string
  credential?: ResolvedCredential
  route?: PtyLaunchRoute
  /** Required on Windows when isolating Codex from user configuration. */
  windowsSandbox?: 'elevated' | 'unelevated'
  /** Explicit native command allow rules; never shell command construction. */
  allowedCommands?: readonly string[]
  /** Model Routing Phase 4b (K3, K6): this attempt's resolved selection, set by main (TeamService) only and read only by
   * the OpenCode helper. Absent = unrouted: the request is byte-identical to before. */
  routing?: RoutingLaunchSelection
  signal: AbortSignal
}
export interface HelperLaunchRequest {
  executable: string
  args: string[]
  cwd: string
  envAdditions: Record<string, string>
  secretEnv: Record<string, string>
  stdin: string
  parserKind: HelperId
  permission: { mode: string; cooperative: boolean; nativeDelegation: 'disabled' | 'unverified' }
}
export interface HelperUsage {
  inputTokens: number | null
  outputTokens: number | null
  cachedTokens: number | null
  costUsd: number | null
  costKind: 'reported' | 'list-price-estimate' | 'unknown'
  source: string
  cacheCreationTokens?: number | null
  reasoningTokens?: number | null
  totalTokens?: number | null
  recordId?: string
  accounting?: 'delta' | 'cumulative' | 'unknown'
}
export type HelperEvent =
  | { type: 'started'; sessionId: string | null }
  | { type: 'activity'; text: string; category: string }
  | { type: 'usage'; usage: HelperUsage }
  | { type: 'permission-blocked'; reason: string }
  | { type: 'result'; summary: string; isError: boolean; failure?: { category: 'generation-truncated' | 'provider-error' | 'unsuccessful-finish'; finishReason: string | null } }
  | { type: 'protocol-error'; reason: string }

/** Parser output is transient, untrusted text. Executor must scrub before retaining/emitting. */
export interface HelperEventParser {
  push(chunk: Uint8Array | string): HelperEvent[]
  finish(): HelperEvent[]
}
export interface HelperAdapter {
  id: HelperId
  probe(signal: AbortSignal): Promise<HelperCapabilities>
  buildExecution(input: HelperExecutionInput): HelperLaunchRequest
  createParser(): HelperEventParser
}

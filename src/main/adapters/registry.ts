import type { AgentKind } from '../../shared/ipc' // TYPE-ONLY (D34(b))
import { claudeAdapter } from './claude'
import { codexAdapter } from './codex'
import { UnknownAgentError, type AgentAdapter } from './types'

/**
 * The static registry. Typed `Record<AgentKind, AgentAdapter>` so the compiler
 * enforces exact coverage of the wire vocabulary: adding a kind to
 * agentKindSchema without adding an adapter here is a BUILD failure, and vice
 * versa. That is the property D34(b) preserved when it rejected deriving
 * AgentKind from this object (which would have made the two trivially
 * agree while letting them agree on the wrong thing).
 *
 * Frozen deliberately. Phase 6 adds register() behind a Map-backed registry
 * that merges static + runtime entries; getAdapter's signature does not change.
 */
export const staticRegistry: Readonly<Record<AgentKind, AgentAdapter>> = Object.freeze({
  claude: claudeAdapter,
  codex: codexAdapter
})

/** Lookup by an ARBITRARY string — the persisted `sessions.agent` value, which
 *  is a TEXT column and can hold anything (a hand-edited row, a downgrade
 *  after a kind was added). The widening cast is the honest expression of
 *  that: the input genuinely is not known to be an AgentKind. */
export function getAdapter(id: string): AgentAdapter | undefined {
  return (staticRegistry as Record<string, AgentAdapter | undefined>)[id]
}

export function getAdapterOrThrow(id: string): AgentAdapter {
  const adapter = getAdapter(id)
  if (!adapter) throw new UnknownAgentError(id)
  return adapter
}

import type { AgentKind } from '../../shared/ipc' // TYPE-ONLY (D34(b))
import { claudeAdapter } from './claude'
import { codexAdapter } from './codex'
import { kimiAdapter } from './kimi'
import { opencodeAdapter } from './opencode'
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
 *
 * ⚠ D86 (Task 3d-3): TWO ENTRIES BECAME THREE. D34 Q5 froze this at two for
 * Phase 3 and D63 Q1 re-affirmed it; Phase 3d owns the lift and this is it,
 * recorded as a numbered decision rather than performed as an edit.
 *
 * ⚠ D90 (2026-07-28): THREE BECAME FOUR — `opencode`, the harness behind the
 * launch dialog's OpenRouter card. Same rule, same widen-together discipline
 * as D86: `agentKindSchema` gained the id in the SAME change.
 *
 * ⚠ THE ONE RULE THE LIFT HAD TO OBEY: this object and `agentKindSchema` widen
 * TOGETHER. F25's defect is that `layout:get`'s filter treats membership HERE
 * as proof of validity THERE, so a kind in one and not the other passes the
 * filter and then fails the outbound parse. The `Record<AgentKind, …>` type is
 * what makes that impossible to get wrong by accident — it is a build failure
 * in both directions — and it is exactly why D34(b) rejected deriving AgentKind
 * from this object instead.
 */
export const staticRegistry: Readonly<Record<AgentKind, AgentAdapter>> = Object.freeze({
  claude: claudeAdapter,
  codex: codexAdapter,
  kimi: kimiAdapter,
  opencode: opencodeAdapter
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

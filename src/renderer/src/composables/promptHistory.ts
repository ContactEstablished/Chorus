import { readonly, ref } from 'vue'

/**
 * THE PROMPT-RECALL MODAL'S TRIGGER (D191) — a pane's header button asks for
 * "what have I asked this agent", and App renders the overlay.
 *
 * ⚠ A MODULE-LEVEL REF RATHER THAN AN EVENT CHAIN, for the reason
 * `savedFlash.ts` states and one more of its own. The button lives in
 * `TerminalPane`, which is mounted by `GridRenderer` or `FilmstripRenderer`,
 * so an emit would have to be forwarded through two components that have no
 * interest in the fact. The extra reason: the overlay is a SCRIM over the
 * whole window, and a scrim rendered from inside a pane would be a fixed
 * element owned by a component that can be unmounted while it is open —
 * filmstrip remounts `TerminalPane` on every focus swap.
 *
 * ⚠ IT HOLDS NO PROMPTS. The list is fetched from main when the overlay
 * mounts, because main owns the ring and a fresh read is always current;
 * caching it here would add a second copy that can go stale and a second place
 * to clear when a session's row is deleted.
 */

export interface PromptHistoryTarget {
  readonly sessionId: string
  /** What to call the pane in the header — the agent label plus its session
   *  name, already composed by the caller, which is the only place that knows
   *  both. */
  readonly label: string
}

const target = ref<PromptHistoryTarget | null>(null)

export function openPromptHistory(sessionId: string, label: string): void {
  target.value = { sessionId, label }
}

export function closePromptHistory(): void {
  target.value = null
}

export function usePromptHistory(): { promptHistoryTarget: Readonly<typeof target> } {
  return { promptHistoryTarget: readonly(target) }
}

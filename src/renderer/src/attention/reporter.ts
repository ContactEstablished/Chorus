import type { AttentionReport } from '../../../shared/ipc'

/**
 * The renderer's half of Mission Control §5.3's first clause, factored PURE so
 * Vitest's `environment: 'node'` can test it: no DOM, no Vue, no window.
 *
 * The renderer answers exactly one question main cannot: WHICH TERMINAL HOLDS
 * DOM FOCUS. Main answers the other: does this window have the OS's keyboard
 * focus right now. Neither is sufficient alone, and `classify()` requires both.
 *
 * ⚠ WHY NOT `viewStore.focusedSessionId`, which already exists: it is the wrong
 * instrument, for three separately verified reasons. (1) It SURVIVES blur,
 * minimize and process exit — it is persisted state telling the filmstrip which
 * pane to render full-size next boot, deliberately durable, where attention
 * needs an instantaneous fact. (2) GRID MODE NEVER UPDATES IT: TerminalPane
 * emits `focus` from a real textarea listener and FilmstripRenderer forwards
 * it, but LayoutRenderer binds no `@focus`, so the emit is dropped — a tracker
 * reading it would attribute an entire grid-mode session to whichever pane was
 * last focused in the filmstrip, which is CONFIDENTLY WRONG and therefore worse
 * than missing. (3) It is never FK-checked (F4) and legitimately names a
 * deleted session. The DOM-focus walk in App.vue is mode-agnostic by
 * construction, which is the whole point.
 */
export interface AttentionReportFacts {
  readonly projectId: string | null
  readonly sessionId: string | null
  readonly view: 'workspace' | 'settings'
  readonly overlayOpen: boolean
}

/**
 * ⚠ D14 — the payload must be a PLAIN OBJECT OF PRIMITIVES. A Pinia/reactive
 * value is a Vue Proxy, and Electron's structured clone rejects it at RUNTIME
 * with no compile-time signal ("An object could not be cloned"). This function
 * exists so there is exactly one place that shape is constructed, and
 * reporter.test.ts asserts the prototype so the trap is caught in CI rather
 * than in a runtime dump. Callers must read `.value` off any computed BEFORE
 * calling; if a field ever becomes store-sourced it needs
 * JSON.parse(JSON.stringify(...)).
 */
export function buildReport(facts: AttentionReportFacts): AttentionReport {
  return {
    projectId: facts.projectId,
    sessionId: facts.sessionId,
    view: facts.view,
    overlayOpen: facts.overlayOpen
  }
}

/**
 * EDGE-TRIGGERED, never polled: a report is sent only when one of the four
 * reported facts actually changes. On a normal working minute that is a handful
 * of messages rather than 240 — the renderer contributes no clock of its own.
 */
export function shouldReport(prev: AttentionReport | null, next: AttentionReport): boolean {
  if (prev === null) return true
  return (
    prev.projectId !== next.projectId ||
    prev.sessionId !== next.sessionId ||
    prev.view !== next.view ||
    prev.overlayOpen !== next.overlayOpen
  )
}

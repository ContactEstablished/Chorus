/**
 * How long ago a recalled prompt was sent (D191).
 *
 * Pure and unit-tested for the same reason `projectSwitcher.ts` is: there are
 * no .vue tests in this project, so any logic worth asserting has to live
 * outside the component.
 *
 * ⚠ RELATIVE, NEVER A CLOCK TIME. The question the modal answers is "what am I
 * waiting on", and "4m ago" answers it at a glance where "21:43" makes the
 * reader do arithmetic. The prompt history is also a within-run record — it is
 * never old enough for a date to be the more useful form.
 */
export function formatPromptAge(iso: string, now: Date): string {
  const then = Date.parse(iso)
  // An unparseable stamp is a bug somewhere upstream, but a row whose TEXT is
  // intact is still worth showing — so this degrades to no age rather than to
  // `NaN` on screen or a thrown render.
  if (Number.isNaN(then)) return ''

  const seconds = Math.round((now.getTime() - then) / 1000)
  // Clock skew or a stamp from the same millisecond both land here. "just now"
  // is true for both and is never wrong by more than the rounding.
  if (seconds < 45) return 'just now'

  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  return `${Math.round(hours / 24)}d ago`
}

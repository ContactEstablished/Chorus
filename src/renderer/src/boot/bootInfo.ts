/**
 * The three boot facts the splash renders, parsed out of the renderer URL's
 * query string.
 *
 * ⚠ WHY A QUERY STRING AND NOT AN IPC CHANNEL. Every one of these is a
 * WRITE-ONCE BOOT CONSTANT that main already knows before the window exists and
 * that can never change while the window lives — the opposite of what the typed
 * `chorus.*` bridge is for. Routing them through it would mean a channel, a Zod
 * pair, a preload forwarder and a renderer round-trip so the splash could ask a
 * question whose answer was fixed before it was mounted, and the splash would
 * still have to render before the answer arrived. Main stamps them onto the URL
 * it loads instead (`src/main/index.ts`), and they are simply present on the
 * first frame.
 *
 * ⚠ IT IS STILL UNTRUSTED INPUT AND IS PARSED AS SUCH. A query string is
 * user-editable in a way an IPC payload is not, so nothing here trusts a value:
 * the count is clamped to a sane range and the two strings are length-capped
 * and rendered as text (never as markup). The failure mode of a bad value is a
 * splash that omits a line — never a crash and never a wrong number.
 *
 * D76 discipline is enforced HERE rather than in the template: an absent,
 * malformed, or zero value resolves to the same "nothing to say" state, so the
 * splash cannot render a placeholder or a zero even if main sends a broken one.
 */

export interface BootInfo {
  /**
   * How many sessions the D16 restore engine is relaunching for the ACTIVE
   * project — the restore set's size, fixed at the moment the plan was made.
   *
   * 0 means a cold boot with nothing to bring back, and the splash then draws
   * NO boot line at all (D76: never render a zero).
   */
  restoringSessions: number
  /** App version for the footer, e.g. `0.1.0`. Null = omit the footer. */
  version: string | null
  /** Platform for the footer, e.g. `windows x64`. Null = omit the footer. */
  platform: string | null
}

/** A restore run can never exceed SessionManager's RESTORE_CAP (16). Anything
 *  larger is a malformed URL, not a big workspace, so it is refused rather than
 *  displayed — the splash saying "restoring 9,001 sessions" would be a lie the
 *  D16 engine could not make true. */
const MAX_RESTORING = 16

/** Long enough for any real version or platform string, short enough that a
 *  padded query cannot push the splash's layout around. */
const MAX_LABEL = 40

function label(raw: string | null): string | null {
  if (raw === null) return null
  const trimmed = raw.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_LABEL) return null
  return trimmed
}

/**
 * Parse `location.search`. Total: every malformed input resolves to the
 * omit-this-line state, so this never throws and never needs a caller-side
 * guard.
 */
export function parseBootInfo(search: string): BootInfo {
  const params = new URLSearchParams(search)

  const rawCount = params.get('restoring')
  // ⚠ `Number.parseInt` is deliberately NOT used: it reads "3abc" as 3 and
  // "16.9" as 16, so a corrupted value would render as a confident number.
  // `Number()` rejects both outright, which is the behaviour D76 wants.
  const parsed = rawCount === null || rawCount.trim() === '' ? NaN : Number(rawCount)
  const restoringSessions =
    Number.isInteger(parsed) && parsed > 0 && parsed <= MAX_RESTORING ? parsed : 0

  return {
    restoringSessions,
    version: label(params.get('v')),
    platform: label(params.get('platform'))
  }
}

/**
 * The boot line's copy, or null when there is nothing true to say.
 *
 * Split out from the component so the pluralisation and the D76 zero-rule are
 * unit-testable without a DOM — this repo has no component-test harness (D77),
 * so any logic worth proving has to live outside the `.vue` file.
 */
export function bootLine(info: BootInfo): string | null {
  if (info.restoringSessions <= 0) return null
  const n = info.restoringSessions
  return `restoring ${n} session${n === 1 ? '' : 's'}`
}

/** The footer's copy, or null when main supplied neither half. Both halves are
 *  required: "chorus v0.1.0 · " with a dangling separator is worse than no
 *  footer, and a bare platform says nothing about Chorus. */
export function footerLine(info: BootInfo): string | null {
  if (!info.version || !info.platform) return null
  return `chorus v${info.version} · ${info.platform}`
}

/**
 * The status bar's version marker — `v0.1.2`, or null when there is no version
 * to state.
 *
 * ⚠ IT SHARES THE `v` PREFIX WITH `footerLine` ON PURPOSE. The splash already
 * renders `chorus v0.1.2 · windows x64`, and the same application formatting its
 * own version two different ways on two surfaces is the kind of small
 * inconsistency that makes a user doubt which number is real — which is
 * precisely the doubt this marker exists to remove.
 *
 * ⚠ AND IT DOES NOT NEED THE PLATFORM, UNLIKE THE FOOTER. That is why this is a
 * separate function rather than a reuse: `footerLine` returns null when the
 * platform is missing, because a splash footer reading "chorus v0.1.2 · " with a
 * dangling separator is worse than none. The status bar states one fact, so a
 * missing platform must not suppress it.
 *
 * Null in, null out (D76): an absent or malformed version renders NOTHING. A
 * bare `v` or a `vunknown` in the corner of the window would be worse than
 * silence — it is a version marker whose whole job is to be trustworthy.
 */
export function versionLabel(info: BootInfo): string | null {
  return info.version ? `v${info.version}` : null
}

import { buildSummaryPrompt, SUMMARY_SYSTEM_PROMPT, type DayEvidence } from './dayReportCore'

/**
 * The day report's prose half (D153) — the one to three sentences that tie a
 * day's bullets together.
 *
 * ⚠ THE PROSE IS A CONVENIENCE OVER THE EVIDENCE, NEVER A GATE ON IT. Every
 * failure path here returns a REASON alongside a null summary, and the caller
 * renders the report anyway. A day's work must never become unreadable because
 * a key expired, a model 500'd, or the machine is offline — the bullets are
 * the durable artifact and they are produced entirely without this module.
 *
 * ⚠ AND IT IS THE ONLY PART OF THIS FEATURE THAT LEAVES THE MACHINE. What it
 * sends is `buildSummaryPrompt`'s output: commit subjects, file PATHS, and
 * harvested symbol NAMES. No file content, no diff text, no credentials, and
 * nothing about which agent did what — that last one because the evidence
 * genuinely does not contain it.
 */

export interface DaySummaryDeps {
  /** One completion. Returns the model's text. Implemented in `ipc.ts` over
   *  the shared `createApiSession` primitive (D45(2)) so the day report uses
   *  the same transport, caps and refusal channel as the council rather than a
   *  second HTTP client that would drift from it. */
  readonly complete: (systemPrompt: string, userPrompt: string) => Promise<string>
}

export interface DaySummaryResult {
  readonly summary: string | null
  /** Null on success, or when no summarizer was asked for. A human-readable
   *  sentence otherwise — it is shown in the UI, so it never carries a stack
   *  trace, a URL or a key. */
  readonly error: string | null
}

/** Hard ceiling on the prose. The model is asked for 1–3 sentences; this is
 *  the guard for when it answers with an essay, and it truncates rather than
 *  rejecting because three good sentences followed by rambling is still worth
 *  three good sentences. */
const MAX_SUMMARY_CHARS = 1200

/** Strip the shapes a model reaches for despite being told not to: a leading
 *  heading, a wrapping code fence, or a bulleted list where a paragraph was
 *  asked for. Cosmetic, and cheaper than a retry. */
export function tidySummary(raw: string): string {
  let text = raw.trim()
  // A fenced block, with or without a language tag.
  const fence = /^```[a-zA-Z]*\n([\s\S]*?)\n?```$/.exec(text)
  if (fence && fence[1]) text = fence[1].trim()
  // A markdown heading on the first line.
  text = text.replace(/^#{1,6}\s+.*\n+/, '')
  // Leading bullet markers, line by line — the bullets already exist below it.
  text = text
    .split('\n')
    .map((l) => l.replace(/^\s*[-*•]\s+/, ''))
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return text.length > MAX_SUMMARY_CHARS ? `${text.slice(0, MAX_SUMMARY_CHARS - 1)}…` : text
}

/**
 * Ask for the tie-together sentence. TOTAL — it does not throw.
 */
export async function summarizeDay(
  evidence: DayEvidence,
  deps: DaySummaryDeps | null
): Promise<DaySummaryResult> {
  if (deps === null) {
    return {
      summary: null,
      error: 'No summarizer model is configured, so this report has no written summary.'
    }
  }

  // Nothing happened; there is nothing to tie together, and a model asked to
  // summarise an empty day will invent one.
  if (evidence.repos.length === 0) {
    return { summary: null, error: null }
  }

  try {
    const text = await deps.complete(SUMMARY_SYSTEM_PROMPT, buildSummaryPrompt(evidence))
    const tidied = tidySummary(text)
    if (tidied === '') {
      return { summary: null, error: 'The summarizer returned an empty response.' }
    }
    return { summary: tidied, error: null }
  } catch (err) {
    // The message is shown to the user, so it is deliberately plain. The
    // underlying error is not re-thrown: the report is already complete
    // without it.
    const reason = err instanceof Error ? err.message : String(err)
    return { summary: null, error: `The written summary could not be generated: ${reason}` }
  }
}

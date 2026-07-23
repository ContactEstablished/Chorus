import pino from 'pino'
import secretPatterns from './secret-patterns.json'

/**
 * Main-process logger with a redacting serializer (D30 / PLAN §6).
 *
 * TWO mechanisms, because one is not enough:
 *  1. `redact` covers STRUCTURED fields by path — it can only match keys it
 *     was told about, and only in objects.
 *  2. `scrubSecrets` covers FREE TEXT — an interpolated message, an Error
 *     message, a stack frame. pino's redact never sees these, and an
 *     interpolated key is the likeliest real-world leak. It is applied to
 *     every string argument of every log call via pino's `hooks.logMethod`
 *     (signature verified against the installed pino 10.3.1 typings, D4),
 *     and to serialized Error `message`/`stack` via `serializers.err`
 *     (F24 — logMethod scrubs string args only, so a `{ err }` object would
 *     otherwise emit both verbatim).
 *
 * Scope note: this scrubs LOG RECORDS ONLY. It does not touch PTY output, the
 * session ring buffer, or session:data — whether that stream is scrubbed is
 * CR-3.0's open question and is deliberately not decided here.
 */

/** Field names whose values are never printed, wherever they appear. Wildcard
 *  prefixes cover nesting; add to this list as the vault lands. */
export const REDACT_PATHS: string[] = [
  'apiKey',
  '*.apiKey',
  'key',
  '*.key',
  'token',
  '*.token',
  'secret',
  '*.secret',
  'password',
  '*.password',
  'encryptedBlob',
  '*.encryptedBlob',
  'env.ANTHROPIC_API_KEY',
  'env.OPENAI_API_KEY',
  'env.GEMINI_API_KEY',
  'env.OPENROUTER_API_KEY',
  // Task 3-2 (D33): the vault's credential-bearing field names. The
  // snake_case twins cover raw DB rows (column names) — a logged row is the
  // likeliest accidental path. extraHeaders is redacted wholesale rather than
  // per-header: header NAMES are not worth preserving in a log if the cost is
  // reasoning about which values are secret.
  'plaintextKey',
  '*.plaintextKey',
  'fingerprintHash',
  '*.fingerprintHash',
  'fingerprint_hash',
  '*.fingerprint_hash',
  'encrypted_blob',
  '*.encrypted_blob',
  'extraHeaders',
  '*.extraHeaders'
]

export const SCRUB_PLACEHOLDER = '[redacted]'

/** The canonical key-shape list (secret-patterns.json, colocated) compiled for
 *  the scrubber. ORDER MATTERS: the generic `sk-[A-Za-z0-9]{32,}` comes AFTER
 *  the more specific sk-ant- / sk-or-v1- / sk-proj- patterns in the shared
 *  list — keep it that way, or a specific key could be partially matched and
 *  leave a recognizable prefix behind. */
const SECRET_PATTERNS: RegExp[] = secretPatterns.patterns.map(
  (p) => new RegExp(p.source, 'g')
)

/** Replace every known key shape in a free-text string. Pure and total. */
export function scrubSecrets(text: string): string {
  let out = text
  for (const re of SECRET_PATTERNS) out = out.replace(re, SCRUB_PLACEHOLDER)
  return out
}

/**
 * F24 (D36 chore): wrap pino's standard err serializer so a
 * `logger.error({ err }, …)` call emits the Error's message and stack
 * SCRUBBED — `hooks.logMethod` only sees string arguments, so without this
 * the serialized Error object bypassed the free-text scrub entirely (D33
 * redaction item 3). The std serializer already folds `cause` chains into
 * `message`/`stack` (pino-std-serializers 2.4 typings, D4-verified), so
 * scrubbing those two fields covers the chain. Exported for direct unit
 * testing; wired into the pino options below as `serializers.err`.
 */
export function scrubbedErrSerializer(err: Error): Record<string, unknown> {
  const serialized = pino.stdSerializers.err(err)
  return {
    ...serialized,
    message: scrubSecrets(serialized.message),
    stack: scrubSecrets(serialized.stack)
  }
}

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: { paths: REDACT_PATHS, censor: SCRUB_PLACEHOLDER },
  serializers: {
    // F24: the { err } path — see scrubbedErrSerializer above.
    err: scrubbedErrSerializer
  },
  formatters: {
    // Keep the level as a readable string rather than pino's numeric default;
    // these logs are read by humans in a dev console far more often than by
    // machines.
    level: (label) => ({ level: label })
  },
  hooks: {
    // The free-text half. pino's redact never inspects the message, so every
    // call routes its string arguments through the scrub before emission.
    // (pino 10.3.1: logMethod(args, method, level) must invoke
    // method.apply(this, newArgs) — verified in pino.d.ts, D4.)
    logMethod(args, method) {
      const scrubbed = args.map((a) => (typeof a === 'string' ? scrubSecrets(a) : a))
      return method.apply(this, scrubbed as Parameters<typeof method>)
    }
  }
})

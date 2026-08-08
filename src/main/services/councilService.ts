import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { buildMintRequest } from './attributionCore'
import secretPatterns from './secret-patterns.json'
import { createApiSession, type TokenUsage } from './apiSession'
import {
  assembleRun,
  computeRunAccounting,
  nextAction,
  routeAcceptsMintedKey,
  summariseState,
  type AssemblyCandidate,
  type CouncilAction,
  type CouncilPhase,
  type CouncilState,
  type CouncilTranscriptEntry,
  type PlannedMember,
  type PlannedRun,
  type QuestionSummary,
  type RunAccounting,
  type TurnRecord
} from './councilCore'
import { logger } from './logger'
import type { CouncilRole, CouncilRunStage } from '../../shared/ipc'
import type { OpenRouterKeyClient } from './openrouterKeys'
import { createSessionOutput } from './sessionOutput'
import {
  COUNCIL_RUN_ABANDONED,
  COUNCIL_RUN_CANCELLED,
  COUNCIL_RUN_COMPLETE,
  COUNCIL_RUN_FAILED,
  COUNCIL_RUN_RUNNING,
  type StorageService
} from './storage'

/**
 * Task 3b-3: the council orchestrator — I/O ONLY.
 *
 * ⚠ IT CONTAINS NO `if` THAT DECIDES WHAT HAPPENS NEXT IN THE DELIBERATION.
 * Every such decision is `councilCore.nextAction`'s, and this file's whole job
 * is to perform the actions it returns, persist the results, and feed them
 * back. The branches below are all about I/O outcomes — a mint failed, a stream
 * refused, the user cancelled — never about what the council should ask next.
 *
 * ⚠ IT ALSO OWNS NO TRANSPORT AND NO SCRUBBER. Every request goes through
 * `createApiSession` (D45(2)/D63 Q1) and every byte of model text goes through
 * `createSessionOutput().ingest()` (D63 Q4/(d)). A "just for the arbiter"
 * client is the shape this fails in: it looks like reasonable specialization
 * and it forks the one mechanism the whole app's api mode is being built on.
 *
 * ── THE MONEY, IN ONE PLACE ──────────────────────────────────────────────
 * One minted OpenRouter key per RUN (D64(2)), created before the first request
 * and destroyed after the last one, on EVERY exit path. Every member's request
 * carries that key rather than the member's own credential, so the run has a
 * single bounded spend surface. Read usage back, THEN revoke — always in that
 * order, because revocation is a `DELETE` and a deleted key's usage may no
 * longer be readable (3a-3).
 */

/* ------------------------------------------------------------------ */
/* Tunables — argued, not chosen                                       */
/* ------------------------------------------------------------------ */

/**
 * ⚠ A PRE-AUTHORIZATION CEILING, NOT A BUDGET, AND THE ARITHMETIC IS BELOW.
 *
 * OpenRouter pre-authorizes each request against the key's REMAINING limit and
 * refuses it outright before doing any work (measured 2026-07-25, Task 3a-3):
 *
 *   402 Payment Required: This request requires more credits, or fewer
 *   max_tokens. You requested up to 65536 tokens, but can only afford 46666.
 *
 * That implies ≈$0.0000107 per allocated output token at the model 3a-3
 * measured — a frontier rate, far above what this task's drive models charge.
 * The cap must therefore clear the run's COMBINED max output allocation, since
 * `remaining` shrinks as the run proceeds and the LAST request must still
 * pre-authorize.
 *
 * ⚠ RAISED $1.00 → $5.00 → $10.00 ON 2026-07-26, EACH TIME WITH THE ARITHMETIC
 * REDONE RATHER THAN THE NUMBER NUDGED, because the council's roster moved to
 * real frontier models and then its arbiter's allowance doubled.
 *
 * **$5.00 → $10.00 is the arbiter's 32,000-token allowance, priced.** At $25/M
 * out, one arbiter request now pre-authorizes 32,000 × $25/M = **$0.80**, and
 * the arbiter takes TWO turns (arbitration, then synthesis) — so $1.60 of
 * pre-authorization has to remain available at the LAST of them, on top of
 * everything the members already spent. Measured against the real run this is
 * sized from: it billed **$0.5586** with the arbiter at 16,000, and the arbiter
 * was ~90% of that. Doubling its allowance puts a realistic run near $1.00 and a
 * worst case near $3.00. $10.00 clears that ≈3×, which is the same headroom
 * ratio $5.00 gave the previous configuration — the ratio is the argument, not
 * the number.
 *
 * The rates below are MEASURED, from OpenRouter's own free and unauthenticated
 * `GET /api/v1/models` on 2026-07-26 — not remembered:
 *
 *   moonshotai/kimi-k3        $3.00/M in · $15.00/M out   ⚠ reasoning
 *   z-ai/glm-5.2              $0.67/M in ·  $2.10/M out   ⚠ reasoning
 *   qwen/qwen3-coder          $0.30/M in ·  $1.00/M out
 *   anthropic/claude-opus-5   $5.00/M in · $25.00/M out   ⚠ reasoning  (ARBITER)
 *
 *   worst case per request : the ARBITER's 32,000 × $25.00/M
 *                          = $0.80   ← the priciest participant, twice per run
 *   worst case per run     : 3 members × 2 turns at 16,000 + arbiter × 2 turns
 *                            at 32,000, every one spending its whole allocation
 *                          ≈ $2.20 output + ≈$0.40 input ≈ $2.60
 *   realistic run          : ≈$1.00, extrapolated from the $0.5586 measured at
 *                            the arbiter's previous 16,000 allowance
 *
 * $10.00 clears the worst case ≈4×, and the headroom is what keeps `remaining`
 * above the NEXT request's pre-authorization all the way to the last turn.
 * **At $1.00 it did not:** a single 16,000-token arbiter request pre-authorized
 * 40% of that whole cap, so the run would have taken a 402 part-way through —
 * after paying for everything before it.
 *
 * ⚠ THE HONEST LIMIT OF THIS NUMBER: IT CLEARS THE SHIPPED FOUR-PARTICIPANT
 * ROSTER, NOT `MAX_COUNCIL_PARTICIPANTS`. Twelve participants across four rounds
 * is ≈50 requests, and at $0.80 each that is ≈$40 — four times this cap. **A
 * large council on frontier models WILL 402**, and that is left as a loud
 * failure rather than papered over with a bigger number, because a cap sized to
 * the worst imaginable council is a cap that has stopped bounding anything.
 * Raise it deliberately if that council is ever configured — not from whoever
 * next hits the refusal.
 *
 * ⚠ AND F34 IS WHY THE HEADROOM IS NOT WASTE — IT NOW APPLIES TO THREE OF THE
 * FOUR. `kimi-k3`, `glm-5.2` and `claude-opus-5` are all REASONING models, and
 * OpenRouter bills reasoning tokens as OUTPUT tokens. Measured in Task 3b-1 on
 * kimi-k3 itself: a probe capped at 60 returned exactly 60 output tokens with an
 * EMPTY answer. `createApiSession` yields only `delta.content` by design, so
 * that spend is invisible in the transcript while being charged in full. The cap
 * must clear the reasoning budget PLUS the answer, not merely "the answer".
 *
 * What this number bounds is the worst case of ONE orphaned key, and that worst
 * case is bounded twice more: by `expires_at`, and by the boot reconcile — which
 * as of D66 can finally see a council run at all. **Raising it to $5.00 raises
 * the blast radius of one abandoned key from $1 to $5, and that is the real cost
 * of this change, stated rather than buried.**
 */
export const COUNCIL_MINT_LIMIT_USD = 10.0

/** `expires_at` = mint + this. Shorter than a dispatch's 12 h because a council
 *  run is minutes, not a working session. The third orphan defence and the
 *  weakest of the three (D4 obligation 5 could not confirm OpenRouter stops
 *  honouring a key at that instant), so nothing here leans on it. */
export const COUNCIL_MINT_TTL_MS = 60 * 60 * 1000

/**
 * ⚠ THE ONLY REQUEST PARAMETER THIS SERVICE SENDS, AND THE DECISION IS STATED
 * RATHER THAN IMPLIED (`ImplementationSpec-3b-2.md` §8 left it open).
 *
 * `createApiSession` builds its body from exactly four things — `model`,
 * `messages`, `stream`, and an optional `max_tokens`. There is no channel for
 * `temperature`, `top_p` or anything else, and opening one means editing
 * `apiSession.ts`, which this task must leave byte-identical. So:
 *
 *   · `max_tokens` from a member's `params_json` IS honoured, clamped to the
 *     bounds below — it is the one parameter F34 makes consequential;
 *   · every OTHER key in `params_json` is stored, read, and DELIBERATELY NOT
 *     SENT. Widening that needs a transport change, which is a raise.
 *
 * Silently dropping them would be the wrong half of that: the log line in
 * `driveMember` names them, so a user who set `temperature` learns it did
 * nothing instead of believing it did something.
 *
 * ── THE DEFAULT IS ROLE-AWARE, AND A LIVE RUN IS WHY (2026-08-06) ─────────
 *
 * ⚠ THE OLD DEFAULT WAS A SINGLE 1200, AND IT WAS THE ONE NUMBER THE TWO
 * CEILING RAISES BELOW NEVER MOVED. Every measurement in this file was taken
 * against members whose `params_json` SET `max_tokens` — so the fallback was
 * never in the sample, and it kept a value chosen when a turn was 700 tokens.
 *
 * **Measured: a council of three reasoning models (`deepseek/deepseek-v4-flash`,
 * `moonshotai/kimi-k3`, `minimax/minimax-m3`), every member with
 * `params_json = NULL`, returned `tokens_out: 1200` EXACTLY on all three
 * positions turns and NO VISIBLE CONTENT — "the model returned an empty answer
 * (its output budget may have gone to reasoning)" three times, 0 of 3 answered,
 * the run failed on the refusal floor, and it billed $0.028 for reasoning
 * tokens nobody ever read.** A reasoning model spends the allowance on thought
 * FIRST; 1200 was consumed before a single visible token was emitted.
 *
 * So the fallback now lands where the CEILING docstring below already says the
 * operating point is — 16,000 for a member, 32,000 for the arbiter, because the
 * arbiter writes the document. It is still only a FALLBACK: a member's own
 * `max_tokens` still wins and is still clamped to the bounds below.
 *
 * ⚠ AND IT INHERITS THE CEILING'S COUPLING WHOLE. These are defaults for the
 * numbers that docstring calls coupled to `COUNCIL_MINT_LIMIT_USD` and
 * `COUNCIL_TURN_TIMEOUT_MS` — which is exactly why the fallback rises to a value
 * those two were already sized for, rather than to a new one.
 */
export const MAX_OUTPUT_TOKENS_DEFAULT_MEMBER = 16_000
export const MAX_OUTPUT_TOKENS_DEFAULT_ARBITER = 32_000

/** The fallback for a member that names no `max_tokens` of its own. EXPORTED
 *  because `ipc.ts` puts it on the wire: the settings form shows it as the
 *  placeholder behind an empty field, and a renderer that hardcoded either
 *  number would be a second home for it. */
export function defaultMaxOutputTokens(role: CouncilRole): number {
  return role === 'arbiter' ? MAX_OUTPUT_TOKENS_DEFAULT_ARBITER : MAX_OUTPUT_TOKENS_DEFAULT_MEMBER
}

/**
 * ⚠ RAISED TWICE ON MEASURED EVIDENCE, AND THE SECOND RAISE IS BECAUSE THE FIRST
 * ONE DID NOT FINISH THE JOB (both 2026-07-26).
 *
 * **4,000 → 16,000.** The cheap-fixture dogfood run returned EXACTLY 700 output
 * tokens on four of its eight turns — the members' configured `max_tokens` — and
 * the arbiter's synthesis stopped mid-sentence, so the findings document never
 * reached its rulings, risks or action items (F38). A cap a turn hits exactly is
 * a cap that truncated it.
 *
 * **16,000 → 32,000.** The frontier-roster run then hit 16,000 EXACTLY on BOTH
 * arbiter turns and truncated again — mid-sentence, ~95% through instead of ~5%.
 * The document grew 7,316 → 32,510 bytes (larger than the externally-produced
 * findings it is measured against) but the ceiling was still the binding
 * constraint, not the model. **Raising it moved the truncation; it did not
 * remove it, and the second raise is an attempt to, not a proof that it did.**
 *
 * ⚠ NEITHER NUMBER IS ARBITRARY — EACH IS READ OFF THE ROSTER. From OpenRouter's
 * free, unauthenticated `GET /api/v1/models` on 2026-07-26,
 * `top_provider.max_completion_tokens`: `anthropic/claude-opus-5` (the ARBITER)
 * **128,000**, `z-ai/glm-5.2` 131,072, `qwen/qwen3-coder` **65,536**, and
 * `moonshotai/kimi-k3` **UNSTATED — OpenRouter publishes no limit for it at
 * all**, which is its own risk. 32,000 clears the smallest published limit on
 * the roster (qwen's 65,536) with room, and sits well inside the arbiter's own.
 *
 * ⚠ IT IS A CLAMP, NOT A REQUEST, and the per-member `params_json` is what
 * actually binds. The arbiter is set to 32,000 because it writes the document;
 * the members stay at 16,000 because measurement says they do not need more —
 * the largest member answer observed was 11,796 output tokens.
 *
 * ⚠ AND IT IS COUPLED TO TWO OTHER NUMBERS. Raising it without raising
 * COUNCIL_MINT_LIMIT_USD produces a 402 part-way through a paid-for run; raising
 * it without raising COUNCIL_TURN_TIMEOUT_MS times out the reasoning models that
 * needed the room. Both have happened, live, in that order. **Do not move this
 * one alone.**
 */
const MAX_OUTPUT_TOKENS_CEILING = 32_000
const MAX_OUTPUT_TOKENS_FLOOR = 200

/**
 * ⚠ THE COUNCIL DECLARES ITS OWN DEADLINE INSTEAD OF INHERITING THE TRANSPORT'S,
 * AND A LIVE RUN IS WHY (2026-07-26).
 *
 * `apiSession.ts` defaults to `RESPONSE_TIMEOUT_MS = 120_000` and its own
 * docstring names the risk exactly: *"a reasoning model's FIRST token can
 * legitimately take a minute"*, and the bound covers **the whole cycle**, not
 * the gap between chunks. That default was measured against 700-token turns.
 *
 * **Measured after the ceiling rose to 16,000 and the roster moved to frontier
 * models: `moonshotai/kimi-k3` and `z-ai/glm-5.2` — both REASONING models —
 * BOTH returned `The response exceeded its time limit and was stopped.` on the
 * positions round, while `qwen/qwen3-coder` (non-reasoning) answered in 1,479
 * output tokens well inside the limit.** Two of three members lost, the refusal
 * floor tripped, and the run aborted having paid for what it did get. **Raising
 * the output ceiling without raising the deadline is what produced that: the two
 * knobs are coupled, and only one of them was moved.**
 *
 * ⚠ IT IS SET HERE, NOT IN `apiSession.ts`. The transport's 120 s is right for a
 * caller that wants a quick answer, and a future interactive chat pane is that
 * caller. The council is the one that hands a reasoning model a 16,000-token
 * allowance and should therefore be the one that waits for it — so the default
 * stays where it is and this overrides it, rather than every consumer inheriting
 * the council's patience.
 *
 * ⚠ RAISED 10 → 15 MINUTES WHEN THE ARBITER'S ALLOWANCE DOUBLED TO 32,000.
 * Generation time scales with tokens produced, so doubling the allowance roughly
 * doubles the turn — and the arbiter's 16,000-token turns already ran several
 * minutes each in the measured run. Leaving the deadline at 10 while doubling
 * the output is the SAME mistake as the first raise, one configuration later.
 * **These two numbers move together or the run dies at the more expensive end.**
 *
 * The cost of being wrong in this direction is bounded and visible: positions
 * and critique are issued as CONCURRENT batches, so a run's worst case is four
 * sequential waits (positions → critique → arbitration → synthesis), not eight —
 * ≈60 minutes — and `cancel()` aborts every in-flight member at once.
 */
const COUNCIL_TURN_TIMEOUT_MS = 15 * 60 * 1000

/** The transcript ring per member. Generous — a position is prose, not a log. */
const MEMBER_BUFFER_CHARS = 200_000
const MEMBER_FLUSH_MS = 50

/**
 * F41's reconcile budget: how many analytics reads, and how far apart.
 *
 * ⚠ SIZED AGAINST THE MEASURED LAG, NOT GUESSED. The provider had not posted the
 * final generation 0.3s after the stream closed; it had posted the whole run by
 * the time `queryGatewayTotal` was asked minutes later. Six reads at 2s spans
 * ~10s of settling, which is spent AFTER the key is already revoked and after
 * the findings are already written — the run is over and nothing is at risk. The
 * cost of overrunning it is a figure labelled provisional, not a wrong figure.
 */
const COST_RECONCILE_ATTEMPTS = 6
const COST_RECONCILE_INTERVAL_MS = 2_000

/** ⚠ INJECTED-CLOCK FRIENDLY: `now()` is already a dep so the module stays
 *  testable; this is the only wait in the file and it exists solely to let the
 *  provider's ledger catch up. */
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * ⚠ A RUNAWAY GUARD, NOT A PROTOCOL RULE. If `nextAction` ever returns `ask`
 * for something already answered, the loop below would spin forever making
 * billable calls. This bounds that, and it bounds nothing else: the protocol's
 * own round structure is the core's business and is expected to terminate well
 * inside it. Exceeding this is a BUG, and it aborts loudly rather than
 * completing quietly with whatever it had.
 */
const MAX_PROTOCOL_STEPS = 24

/** The cap's arithmetic above assumes a bounded council. Stated as a refusal so
 *  the assumption is checkable rather than implied. */
export const MAX_COUNCIL_PARTICIPANTS = 12

/**
 * ⚠ A COST BOUND WEARING A FILE-SIZE HAT. A brief is a document; a multi-megabyte
 * file is either a mistake or an attack on the cost envelope, because EVERY
 * MEMBER PAYS INPUT TOKENS FOR EVERY BYTE and three of the four phases carry the
 * brief. The number is the one `council:start` already enforced as a string
 * length in 3b-3, kept deliberately so the boundary did not move when the input
 * changed from text to a path. For calibration: the largest real brief in this
 * repo is 36 KB.
 */
export const MAX_BRIEF_BYTES = 200_000

/* ------------------------------------------------------------------ */
/* The brief's path — A SECURITY BOUNDARY, and it lives in MAIN        */
/* ------------------------------------------------------------------ */

export type BriefPathCheck =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly reason: string }

/**
 * ⚠ A RENDERER-SUPPLIED PATH THAT MAIN OPENS IS AN ARBITRARY-FILE-READ
 * PRIMITIVE. The dialog is a convenience; THIS is the boundary, and it re-checks
 * everything the dialog was supposed to guarantee because the renderer can call
 * `council:start` with any string at all.
 *
 * ⚠ NO REFUSAL ECHOES THE PATH. Not the supplied one and certainly not the
 * resolved one: a resolved relative path would leak main's cwd, and a message
 * naming a fragment the caller did not supply is a message that tells an
 * attacker something. The user knows which file they just chose; the refusal
 * only has to say what is wrong with it.
 *
 * The order is `ImplementationSpec-3b-4.md` §1's, each returning before the next
 * is attempted, and the filesystem is not touched until the cheap refusals are
 * exhausted.
 *
 * ⚠ `noun` AND `sizeNote` EXIST SO THE DOCKET CAN REUSE THIS RATHER THAN COPY IT
 * (D112). `council:findings` re-validates a path it recorded itself before
 * reading it back, which is the same primitive with a different word in front of
 * it — and a security boundary with two implementations is the two-homes hazard
 * this codebase keeps ruling against. The defaults reproduce every original
 * refusal string byte-for-byte, so the brief path's behaviour and its tests are
 * untouched; only the caller that passes a different noun sees different prose.
 */
export function validateBriefPath(
  raw: string,
  noun = 'brief',
  sizeNote = 'Every council member pays input tokens for every byte of it.'
): BriefPathCheck {
  const refuse = (reason: string): BriefPathCheck => ({ ok: false, reason })

  if (typeof raw !== 'string' || raw.trim() === '') return refuse(`No ${noun} was chosen.`)
  // 1. A relative path resolves against MAIN's cwd, which is not the user's
  //    mental model and is a different directory in dev and in a packaged build.
  if (!isAbsolute(raw)) return refuse(`A ${noun} must be an absolute path.`)
  // 2. Before the filesystem is touched. Node throws on an embedded NUL, and a
  //    thrown error is a worse refusal than a named one.
  if (raw.includes('\0')) return refuse('That path contains a null byte.')
  // 3. ⚠ ALSO BEFORE THE FILESYSTEM. `statSync` on a UNC path can block on SMB
  //    for as long as the network takes, so a hostile path would be a hang
  //    rather than a refusal. A network share is a different trust surface than
  //    a local file and this feature has no reason to read one.
  if (isUncPath(raw)) return refuse(`A ${noun} must be a local path, not a network share.`)
  // 4. Narrow by construction: the feature reads briefs.
  if (extname(raw).toLowerCase() !== '.md') return refuse(`A ${noun} must be a .md file.`)

  // ⚠ NORMALIZE, THEN RE-CHECK — checking before normalizing checks the wrong
  // string. A `..` that resolves to a real .md file is fine and the NORMALIZED
  // path is what everything downstream uses; a `..` that resolves to something
  // else is caught here rather than opened.
  const path = resolve(raw)
  if (!isAbsolute(path) || path.includes('\0') || isUncPath(path)) {
    return refuse('That path does not resolve to a local absolute path.')
  }
  if (extname(path).toLowerCase() !== '.md') return refuse('That path does not resolve to a .md file.')

  let size: number
  try {
    // 5. ⚠ `statSync().isFile()`, NOT `existsSync` — which passes a DIRECTORY.
    //    That is the `session:launch` cwd check's own lesson, paid for once.
    const stat = statSync(path)
    if (!stat.isFile()) return refuse('That path is not a file.')
    size = stat.size
  } catch {
    // ⚠ NOT noun-interpolated, unlike the refusals above. "That file does not
    // exist, or cannot be read" is already true of a brief and of a findings
    // document, and both callers render the PATH beside it — so the noun would
    // add nothing a reader does not already have on screen, at the cost of
    // rewording three passing tests.
    return refuse('That file does not exist, or cannot be read.')
  }
  // 6. The cost bound.
  if (size > MAX_BRIEF_BYTES) {
    return refuse(
      `That ${noun} is ${Math.round(size / 1024)} KB; the limit is ${Math.round(MAX_BRIEF_BYTES / 1024)} KB. ` +
        sizeNote
    )
  }
  return { ok: true, path }
}

/** `\\server\share` and `//server/share`. Kept separate from the checks above
 *  so both the raw and the normalized form can ask the same question. */
function isUncPath(candidate: string): boolean {
  return /^[\\/]{2}/.test(candidate)
}

/**
 * ⚠ THE FINDINGS PATH IS COMPUTED, NEVER SUPPLIED — and that is the whole
 * security argument of this task, not a convenience.
 *
 * A second renderer-supplied path would be an arbitrary-file-WRITE primitive,
 * which is strictly worse than the read one above: a read leaks, a write
 * destroys. Deriving the output from the one validated input removes that
 * primitive as a CLASS rather than guarding it, so there is one boundary to get
 * right instead of two.
 *
 * `extname` rather than the literal `'.md'` so a `BRIEF.MD` loses its extension
 * too — `basename(p, '.md')` is case-sensitive on the suffix and would emit
 * `BRIEF.MD-Findings.md`.
 */
export function findingsPathFor(briefPath: string): string {
  return join(dirname(briefPath), `${basename(briefPath, extname(briefPath))}-Findings.md`)
}

/**
 * ⚠ THE OVERWRITE RULING, MADE EXPLICITLY (spec §6 left it open): CHORUS NEVER
 * OVERWRITES A FINDINGS FILE. It suffixes — `-Findings-2.md`, `-Findings-3.md` —
 * and the first free name wins.
 *
 * The two rejected alternatives, and why:
 *  · OVERWRITE silently destroys the record §4 exists to keep. A second council
 *    on the same brief is exactly when you want to compare the two, and it is
 *    the one moment the old file is deleted.
 *  · REFUSE THE RUN when the file exists is worse than it sounds, because by
 *    the time findings exist the deliberation is already paid for. Throwing away
 *    a completed run over a filename is the D67(b) mistake in a different suit.
 *
 * Returns NULL when even the suffixes are exhausted, so the caller reports a
 * failure rather than picking a name by improvisation. `taken` is injected so
 * the ruling is testable without a filesystem.
 */
export function nextFreeFindingsPath(
  briefPath: string,
  taken: (candidate: string) => boolean
): string | null {
  const first = findingsPathFor(briefPath)
  if (!taken(first)) return first
  const stem = first.slice(0, -'.md'.length)
  for (let n = 2; n <= 99; n++) {
    const candidate = `${stem}-${n}.md`
    if (!taken(candidate)) return candidate
  }
  return null
}

/* ------------------------------------------------------------------ */
/* The sanitization pre-pass (D63(f))                                  */
/* ------------------------------------------------------------------ */

/** ⚠ A HIT NAMES ITS PATTERN AND ITS LINE AND NOTHING ELSE. There is no field
 *  here for the matched text, deliberately — a shape that cannot carry the
 *  secret cannot leak it into a log, a refusal or the view. */
export interface BriefSecretHit {
  readonly pattern: string
  /** 1-based, so it matches what the user's editor shows. */
  readonly line: number
}

/**
 * Scan a brief for known credential shapes BEFORE any member sees it.
 *
 * ⚠ WHY THE SCRUBBER CANNOT DO THIS. `SessionOutput`'s scrubber exact-matches
 * REGISTERED values — the run's minted key — and a key a user typed into their
 * own brief was never registered with anything. So the brief is scanned by
 * SHAPE, using `secret-patterns.json`: the SAME file `logger.ts` compiles for
 * `scrubSecrets` and `scripts/secret-grep.mjs` reads for the G4 gate. Authoring
 * a second list here would let the gate and the sanitizer test different shapes,
 * which is the exact drift that file's header exists to prevent. ZERO new
 * pattern literals live in this file.
 *
 * ⚠ AND THE CLAIM IT LICENSES IS BOUNDED. It catches known shapes. It cannot
 * catch a credential that looks like prose, a partial key, or a shape no pattern
 * covers — which is why the sentence the UI ships says exactly that and never
 * says the brief is safe.
 */
export function scanBriefForSecrets(text: string): readonly BriefSecretHit[] {
  const hits: BriefSecretHit[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    for (const pattern of secretPatterns.patterns) {
      // Compiled per line rather than once with /g: a `g` regex carries
      // `lastIndex` between calls, and a stateful matcher in a loop skips
      // matches. Cheap enough — six patterns over a document, once per run.
      if (new RegExp(pattern.source).test(lines[i])) {
        hits.push({ pattern: pattern.name, line: i + 1 })
      }
    }
  }
  return hits
}

/**
 * ⚠ THE HIT RULING, MADE EXPLICITLY (spec §6 left it open): A HIT REFUSES THE
 * RUN. It does not redact and proceed.
 *
 * Redacting would quietly change the text several models are about to reason
 * about — corrupting the deliberation — and it would bury the warning under a
 * run that appears to have worked. A user who wrote a key into a brief needs to
 * know BEFORE five models read it and before a transcript of it is persisted.
 *
 * The message names the PATTERN and the LINE. It never names the value: a
 * refusal that echoes the secret it found is a leak wearing a warning's clothes,
 * and this string reaches both a log file and the view.
 */
export function describeSecretHits(hits: readonly BriefSecretHit[]): string {
  const where = hits.map((h) => `line ${h.line} (${h.pattern})`).join(', ')
  return (
    `This brief looks like it contains a credential, so the run was refused before any model read it: ` +
    `${where}. Remove it from the brief and run again. ` +
    `The value itself is deliberately not shown here — this message is written to the log.`
  )
}

/* ------------------------------------------------------------------ */
/* Deps                                                                */
/* ------------------------------------------------------------------ */

/** What the pre-flight learned about one member's route. ⚠ NO KEY MATERIAL:
 *  the plaintext this resolution decrypted is dropped at the call site. */
export interface MemberRoute {
  readonly baseUrl: string
  /** Non-secret metadata, carried so the credential handed to the transport is
   *  shaped honestly rather than with an invented variable name. */
  readonly envVarName: string
}

/** ⚠ THE ID AND NOTHING ELSE. A run's existence is the one fact the renderer
 *  cannot derive for itself while `council:start` is still in flight. */
export interface CouncilOpenedEvent {
  readonly runId: string
}

export interface CouncilProgressEvent {
  readonly runId: string
  readonly phase: CouncilPhase
  readonly round: number
  readonly memberId: string | null
  /** ⚠ SCRUBBED. It comes from `SessionOutput`'s `onText`, never from the raw
   *  stream — see `driveMember`. */
  readonly delta: string
}

/** ⚠ NO MODEL PROSE ON THIS ONE, and that is a property of its contents rather
 *  than of a filter: verdict tokens from a closed enum, member labels, and the
 *  brief's own enumerated questions. Nothing here came out of a stream, so
 *  nothing here needs the scrub seam `delta` above depends on. */
export interface CouncilSummaryEvent {
  readonly runId: string
  readonly questions: readonly QuestionSummary[]
}

export interface CouncilServiceDeps {
  readonly storage: StorageService
  /** ⚠ THE SAME CLIENT `DispatchAttribution` HOLDS, threaded from `index.ts`.
   *  Not a second one: a second client means a second management-key path, and
   *  the management key's decrypt-per-use discipline has exactly one home. */
  readonly keys: OpenRouterKeyClient
  readonly hasManagementKey: () => boolean
  /**
   * ⚠ `ipc.ts`'s OWN `resolveCredential`, REUSED AND NEVER FORKED — all five
   * ordered refusals, with the management refusal still sitting BEFORE
   * decryption (D58/D60).
   *
   * It returns only the ROUTE, because the route is the only thing this service
   * needs from it. The credential it decrypts is DISCARDED at the call site:
   * every request carries the run's minted key instead, so the member's own key
   * is decrypted and thrown away. That is deliberate and it is the price of not
   * forking the refusal ladder — the alternative is a second, shorter ladder
   * that drifts from the first.
   */
  readonly resolveMemberRoute: (
    credentialProfileId: string
  ) => Promise<{ ok: true; route: MemberRoute | null } | { ok: false; reason: string }>
  /**
   * "This run exists and can now be cancelled." Called ONCE, from the same step
   * that writes the ledger row and puts the run in `live`.
   *
   * ⚠ IT IS NOT A CONVENIENCE. Until it existed the renderer learned a run's id
   * only from the first progress delta, and a reasoning model's first token can
   * take minutes — so for the opening minutes of every run the run was live and
   * spending in here while the button that aborts it was disabled for want of a
   * name. Injected rather than reached for, like `emitProgress`: this file owns
   * no BrowserWindow and must not learn about one.
   */
  readonly emitOpened: (event: CouncilOpenedEvent) => void
  readonly emitProgress: (event: CouncilProgressEvent) => void
  /** The at-a-glance vector, emitted ONCE per run when the positions round
   *  closes. Injected rather than reached for, like `emitProgress` — this file
   *  owns no BrowserWindow and must not learn about one. */
  readonly emitSummary: (event: CouncilSummaryEvent) => void
  /** The gateway the minted key authenticates against. Injected so the pure
   *  core never learns a URL and this file never hard-codes a second one. */
  readonly gatewayBaseUrl: string
  readonly now?: () => Date
}

export type CouncilStartResult =
  | {
      readonly ok: true
      readonly runId: string
      readonly findings: string
      /** The per-question glance, computed by the core from the same verdict
       *  vector the findings document is assembled from. */
      readonly questionSummary: readonly QuestionSummary[]
      readonly accounting: RunAccounting
      readonly costUsd: number | null
      /** ⚠ TRUE MEANS THE FIGURE IS KNOWN-LOW, not merely unconfirmed: it is
       *  `readUsage`'s early read, which omits the run's final turn by
       *  construction. See `reconcileCost`. */
      readonly costIsProvisional: boolean
      /** Where the findings actually landed, or NULL when the write failed —
       *  never a path that does not exist. */
      readonly findingsPath: string | null
      /** ⚠ THE REASON BESIDE THE NULL, on D55's principle one layer over: an
       *  absent path with no explanation is the same unreadable fact as a cost
       *  with no denominator. NULL when the write succeeded. */
      readonly findingsError: string | null
    }
  | { readonly ok: false; readonly reason: string }

export interface CouncilService {
  /** ⚠ THE PATH IS THE INPUT, AND MAIN IS WHAT OPENS IT (3b-4). 3b-3 took brief
   *  TEXT from the renderer; that is gone, not deprecated. */
  start(input: { projectId: string | null; briefPath: string }): Promise<CouncilStartResult>
  /**
   * ⚠ IT RETURNS THE RUN'S STAGE, NOT A BOOLEAN, AND THE BOOLEAN IT REPLACED WAS
   * A DEFECT. `false` used to mean "no such live run — a race the user cannot
   * see"; that claim was wrong for the whole settle-and-reconcile tail, which is
   * seconds of wall clock during which the run has left `live`, the user's
   * `council:start` invoke is still outstanding, and the surface is locked. The
   * user could see it perfectly well: they clicked Cancel on a council that
   * looked hung and nothing happened at all.
   *
   *   `deliberating` — live, and now aborted. The only stage a cancel acts on.
   *   `settling`     — the deliberation is over and the key is being revoked and
   *                    read back. Nothing to cancel; the run closes itself.
   *   `unknown`      — no record either way.
   *
   * ⚠ AND IT STILL REFUSES TO BE A FORCE-CLEAR. `settling` is deliberately NOT a
   * licence for the renderer to drop its in-flight flag: the invoke is about to
   * resolve with real findings, and a surface unlocked early can start a second
   * paid deliberation over the top of the first.
   */
  cancel(runId: string): CouncilRunStage
  /**
   * `app 'before-quit'`. ⚠ SYNCHRONOUS AND HONEST ABOUT ITS LIMITS: it aborts
   * every in-flight request and marks the run abandoned, but it CANNOT complete
   * a network revoke — `before-quit` does not await, and the process is about to
   * die. The ledger row therefore stays OPEN, which is exactly what makes the
   * boot reconcile the backstop for this one path (D66). Claiming a quit-time
   * revocation here would be claiming something the runtime cannot deliver.
   */
  abandonOpenRunsOnQuit(): void
}

interface LiveRun {
  readonly runId: string
  readonly controller: AbortController
  cancelled: boolean
}

export function createCouncilService(deps: CouncilServiceDeps): CouncilService {
  const now = deps.now ?? ((): Date => new Date())
  const live = new Map<string, LiveRun>()
  /**
   * Runs whose deliberation has ENDED but whose `start` has not returned yet —
   * the settle-and-reconcile tail.
   *
   * ⚠ A SECOND CONTAINER RATHER THAN A STAGE FIELD ON `LiveRun`, and both halves
   * of that are deliberate.
   *
   *  · `live.delete` MUST still happen where it happens. It runs in the protocol
   *    loop's `finally`, with no `await` between it and `settle(…, liveRun.cancelled)`
   *    below — which is precisely what stops a cancel arriving in that instant
   *    from re-flagging a COMPLETED run as cancelled after `settle` has read the
   *    flag. Keeping the run in `live` with a stage field would reopen that.
   *  · `abandonOpenRunsOnQuit` iterates `live` and marks what it finds ABANDONED.
   *    A settling run is not abandoned — it is finished, and its key is already
   *    revoked or being revoked — so quitting must not overwrite its status. It
   *    cannot, because that loop structurally cannot see this set.
   */
  const settling = new Set<string>()

  /* ---------------------------------------------------------------- */

  async function start(input: {
    projectId: string | null
    briefPath: string
  }): Promise<CouncilStartResult> {
    // ── 0. The file boundary and the pre-pass. ────────────────────────────
    // ⚠ FIRST, AND THAT ORDERING IS THE CLAIM. Everything here happens with
    // nothing minted, nothing spent, no row written and no model having seen a
    // byte — which is what makes "refused before any model read it" a fact
    // about the control flow rather than a sentence in a message.
    const checked = validateBriefPath(input.briefPath)
    if (!checked.ok) return { ok: false, reason: checked.reason }

    let briefText: string
    try {
      briefText = readFileSync(checked.path, 'utf8')
    } catch (err) {
      // The path statted a moment ago; losing it here is a race or a permission
      // problem, and either way the user gets a sentence rather than a throw.
      logger.error({ err }, '[council] the brief could not be read after validation')
      return { ok: false, reason: 'That brief could not be read.' }
    }

    const hits = scanBriefForSecrets(briefText)
    if (hits.length > 0) {
      const reason = describeSecretHits(hits)
      // Safe to log: `describeSecretHits` carries pattern names and line
      // numbers and structurally cannot carry the matched value.
      logger.warn(`[council] ${reason}`)
      return { ok: false, reason }
    }

    if (!deps.hasManagementKey()) {
      return {
        ok: false,
        reason:
          'A council run needs an OpenRouter management key to mint the capped key that bounds its spend. Add one in Settings.'
      }
    }

    // ── 1. Assembly. PURE, and before anything is spent or created. ───────
    const assembly = assembleRun(loadCandidates(), briefText, deps.gatewayBaseUrl)
    if (!assembly.ok) return { ok: false, reason: assembly.reason }
    const run = assembly.run
    const participants = [...run.members, run.arbiter]
    if (participants.length > MAX_COUNCIL_PARTICIPANTS) {
      return {
        ok: false,
        reason: `A council is limited to ${MAX_COUNCIL_PARTICIPANTS} participants; this one has ${participants.length}.`
      }
    }

    // ── 2. Pre-flight: resolve every route BEFORE minting. ────────────────
    // ⚠ ORDER MATTERS AND IT IS ABOUT MONEY. Every refusal below happens with
    // nothing minted and nothing spent. Discovering a bad route after the mint
    // would leave a funded key to clean up for a run that never began.
    const routes = new Map<string, MemberRoute>()
    for (const member of participants) {
      const resolved = await deps.resolveMemberRoute(member.credentialProfileId)
      if (!resolved.ok) {
        return { ok: false, reason: `Council member '${member.label}': ${resolved.reason}` }
      }
      if (resolved.route === null) {
        return { ok: false, reason: `Council member '${member.label}' has no base URL to send a request to.` }
      }
      // ⚠ RE-CHECKED AGAINST THE EFFECTIVE ROUTE, not the provider row.
      // A credential envelope may override the provider's base URL (D33(e)), so
      // the URL assembly saw and the URL the request goes to are not guaranteed
      // to be the same one. The minted key is only valid at the gateway, and
      // this is the check that sees what will actually be dialled.
      if (!routeAcceptsMintedKey(resolved.route.baseUrl, deps.gatewayBaseUrl)) {
        return {
          ok: false,
          reason:
            `Council member '${member.label}' resolves to a route outside the OpenRouter gateway, so it cannot use ` +
            `the single capped key that bounds this run's spend.`
        }
      }
      routes.set(member.memberId, resolved.route)
    }

    // ── 3. Mint. ONE key for the whole run (D64(2)). ──────────────────────
    const runId = randomUUID()
    const mintedAt = now()
    const request = buildMintRequest({
      owner: { kind: 'council', runId },
      limitUsd: COUNCIL_MINT_LIMIT_USD,
      now: mintedAt,
      ttlMs: COUNCIL_MINT_TTL_MS
    })
    if (!request.ok) {
      // The refusal path that guarantees no uncapped council key can exist.
      return { ok: false, reason: `Could not start the run: ${request.reason}` }
    }
    const minted = await deps.keys.mint(request.body)
    if (!minted.ok) {
      // ⚠ A MINT FAILURE REFUSES THE RUN — it does NOT degrade to the members'
      // own keys. That is the deliberate opposite of `mintForDispatch`, and the
      // boundary is exact: there, attribution is telemetry over a launch that
      // must not be blocked; here, the minted key IS the spend bound, so running
      // without it would be running unbounded.
      return { ok: false, reason: `Could not start the run: ${minted.reason}` }
    }
    if (minted.value.limit === null || !(minted.value.limit > 0)) {
      // A mint that came back WITHOUT a limit is a mint we do not trust — the
      // cap is the whole blast-radius bound. Revoke and refuse.
      logger.error('[council] OpenRouter returned a key with no positive limit; revoking immediately')
      await revokeQuietly(minted.value.hash)
      return { ok: false, reason: 'Could not start the run: the provider returned a key with no spend limit.' }
    }
    const mintedKey = minted.value.key

    // The write-ahead ledger row. `revoked_at` NULL IS the open-row predicate
    // the boot reconcile queries — the same definition v8 uses, deliberately,
    // and as of D66 actually read.
    deps.storage.createCouncilRun({
      id: runId,
      projectId: input.projectId,
      // ⚠ THE NORMALIZED PATH, not the string the renderer sent. The row, the
      // findings file's location and the boundary check all read the same one.
      briefPath: checked.path,
      findingsPath: null,
      status: COUNCIL_RUN_RUNNING,
      startedAt: mintedAt.toISOString(),
      endedAt: null,
      mintedKeyHash: minted.value.hash,
      mintedKeyLimit: minted.value.limit,
      mintedAt: mintedAt.toISOString(),
      revokedAt: null,
      tokensIn: null,
      tokensOut: null,
      tokensCached: null,
      costUsd: null
    })
    logger.info(
      `[council] run ${runId} opened · ${run.members.length} member(s) + 1 arbiter · key capped at $${minted.value.limit}`
    )

    const controller = new AbortController()
    const liveRun: LiveRun = { runId, controller, cancelled: false }
    live.set(runId, liveRun)
    // ⚠ THE EARLIEST INSTANT THE RENDERER CAN BE TOLD, AND IT IS TOLD HERE
    // RATHER THAN ON THE RESPONSE BECAUSE THE RESPONSE ARRIVES AFTER THE RUN.
    // `council:start` is one invoke that does not resolve until the deliberation
    // is over; until this broadcast the renderer's only source for the id was the
    // first progress delta, which waits on a member's first token. Cancel was
    // therefore disabled for the opening minutes of every run — over a run that
    // was live, spending, and abortable right here. Emitted AFTER `live.set` so
    // the id is never announced before `cancel` could act on it.
    deps.emitOpened({ runId })

    const turns: TurnRecord[] = []
    let transcript: readonly CouncilTranscriptEntry[] = []
    /** Guards the one-per-run rule on the at-a-glance broadcast below. */
    let summaryEmitted = false
    let outcome:
      | { kind: 'complete'; findings: string; summary: readonly QuestionSummary[] }
      | { kind: 'abort'; reason: string } = {
      kind: 'abort',
      reason: 'The run ended without reaching a conclusion.'
    }

    try {
      // ── 4. The protocol loop. EVERY decision below is the core's. ───────
      for (let step = 0; step < MAX_PROTOCOL_STEPS; step++) {
        // ⚠ `runId` and `startedAt` are PROVENANCE the core renders and cannot
        // derive: it has no clock and no uuid source (D68(2)). Both are already
        // on the ledger row above, so the findings file and the DB agree by
        // construction rather than by two independent stamps.
        const state: CouncilState = {
          run,
          transcript,
          cancelled: liveRun.cancelled,
          runId,
          startedAt: mintedAt.toISOString()
        }
        // ⚠ BEFORE `nextAction`, AND ONCE PER RUN. The vector is a function of
        // the answered POSITIONS, so it is available the moment that round
        // closes — four phases and the better part of the run's wall-clock
        // before the findings exist. Emitting here rather than after the asks
        // means the user gets the glance at the earliest instant it is true.
        //
        // ⚠ AND IT NEVER FIRES A SECOND TIME. Positions do not change once their
        // round is behind us, so a re-emit could only ever repeat itself — but
        // the flag is what makes that a guarantee instead of an observation, and
        // it is what stops a strip from appearing to "update" across critique
        // and arbitration when nothing about it has moved.
        if (!summaryEmitted) {
          const questions = summariseState(state)
          if (questions.length > 0) {
            summaryEmitted = true
            deps.emitSummary({ runId, questions })
          }
        }
        const actions = nextAction(state)
        const terminal = actions.find((a): a is Extract<CouncilAction, { kind: 'complete' | 'abort' }> =>
          a.kind !== 'ask'
        )
        if (terminal) {
          outcome =
            terminal.kind === 'complete'
              ? { kind: 'complete', findings: terminal.findings, summary: terminal.summary }
              : terminal
          break
        }
        const asks = actions.filter((a): a is Extract<CouncilAction, { kind: 'ask' }> => a.kind === 'ask')
        if (asks.length === 0) {
          outcome = { kind: 'abort', reason: 'The protocol returned no next step.' }
          break
        }

        // ⚠ THE BLIND ROUND, MADE REAL. Every ask in this batch is issued
        // concurrently, so no member's request can contain another's answer —
        // none of those answers exists yet. Awaiting them in sequence and
        // feeding each into the next is precisely what the array shape exists
        // to make impossible to do by accident.
        const results = await Promise.all(
          asks.map((ask) => driveMember(ask, run, routes, mintedKey, liveRun))
        )
        // ⚠ PERSISTED IMMEDIATELY, INCLUDING THE REFUSALS. A batch that is held
        // in memory until the run ends is a batch a cancel or a crash loses —
        // and the transcript is the only artefact that can show a run was
        // partial. Written here rather than inside `driveMember` so every DB
        // write in this file lives on one path.
        for (const result of results) persistTurn(runId, result)
        transcript = [...transcript, ...results.map((r) => r.entry)]
        turns.push(...results.map((r) => r.record))
      }
    } catch (err) {
      // A protocol-loop throw must still reach the `finally` below, which is
      // the only thing standing between a crash and a live funded key.
      logger.error({ err }, `[council] run ${runId} failed mid-deliberation`)
      outcome = { kind: 'abort', reason: 'The run failed part-way through.' }
    } finally {
      // ⚠ THE HANDOVER, AND IT IS ONE SYNCHRONOUS STEP ON PURPOSE. The delete
      // has to stay exactly here — there is no `await` between it and
      // `settle(…, liveRun.cancelled)` below, which is what stops a cancel
      // arriving in this instant from re-flagging a run `settle` has already
      // read as complete. The add is what stops the same instant reading as
      // "no such run": for as long as this set holds the id, the run's
      // `council:start` invoke is still outstanding and `cancel` says so.
      live.delete(runId)
      settling.add(runId)
    }

    // ⚠ EVERYTHING BELOW RUNS UNDER `settling`, INCLUDING BOTH RETURNS. Wrapped
    // rather than deleted at each `return` because a third return added later
    // would silently leak an id into the set forever, and the failure would be a
    // cancel that reports `settling` for a run that ended three hours ago.
    try {
      // ── 5. Read usage back, THEN revoke. ALWAYS in that order. ──────────
      const provisionalUsd = await settle(runId, minted.value.hash, liveRun.cancelled, outcome.kind)

      // ── 5b. F41: the SETTLED cost, once the provider's ledger has caught up.
      // ⚠ AFTER THE REVOKE, DELIBERATELY — see `reconcileCost`. The key is already
      // gone by the time this runs, so the ~10s worst case is spent on a dead key
      // rather than holding a live funded one open for a nicer number.
      const reconciled = await reconcileCost(minted.value.hash, mintedAt)
      // ⚠ THE LARGER OF THE TWO LOWER BOUNDS. `readUsage` and analytics are the
      // same ledger read at two moments; neither is complete this early, so the
      // bigger reading is simply the tighter bound. Taking one source on principle
      // would discard a strictly better number for a tidier story.
      const costUsd =
        reconciled === null ? provisionalUsd : Math.max(reconciled, provisionalUsd ?? 0)
      // ⚠⚠ ALWAYS TRUE AT RUN END, AND THAT IS THE HONEST ANSWER RATHER THAN A
      // PLACEHOLDER. Run `ecf6856d` showed analytics is still short by the final
      // turn at this point, so there is no reading available here that can be
      // called complete. The flag says "at least this much", the view says so too,
      // and the deferred reconcile that can say more is not built yet.
      const costIsProvisional = true
      if (costUsd !== null && costUsd !== provisionalUsd) {
        // Persist the tighter bound. Same column — not a second one, which would
        // leave two costs for one run and no rule about which is true.
        try {
          deps.storage.updateCouncilRun(runId, { costUsd })
        } catch (err) {
          logger.error({ err }, `[council] run ${runId} reconciled cost could not be persisted`)
        }
      }
      logger.info(
        `[council] run ${runId} cost is a LOWER BOUND of $${costUsd} ` +
          `(readUsage $${provisionalUsd}, analytics $${reconciled}); ` +
          `the provider's ledger had not settled the final turn`
      )

      const accounting = computeRunAccounting({ membersPlanned: participants.length, turns })
      logger.info(
        `[council] run ${runId} ${outcome.kind === 'complete' ? 'complete' : 'aborted'} · ` +
          `${accounting.membersAnswered}/${accounting.membersPlanned} members answered · ${accounting.membersRefused} refused · ` +
          `${accounting.turnsAnswered} turn(s) answered, ${accounting.turnsRefused} refused · ` +
          `usage reported for ${accounting.usageReported}, absent for ${accounting.usageAbsent} · ` +
          `cost ${costUsd === null ? 'UNKNOWN' : '$' + costUsd}`
      )

      if (outcome.kind === 'abort') return { ok: false, reason: outcome.reason }

      // ── 6. The findings file, beside the brief and nowhere else. ──────────
      // ⚠ AFTER THE REVOKE, DELIBERATELY. A full disk or a read-only directory
      // must never sit between a live funded key and its revocation; the findings
      // text is already in hand and travels back on the response either way.
      const written = writeFindings(runId, checked.path, outcome.findings)
      return {
        ok: true,
        runId,
        findings: outcome.findings,
        questionSummary: outcome.summary,
        accounting,
        costUsd,
        costIsProvisional,
        ...written
      }
    } finally {
      // The invoke is returning NOW, so the run stops being "settling" in the
      // same tick the renderer's promise resolves. There is no instant in which
      // the surface is unlocked and a cancel would still report `settling`.
      settling.delete(runId)
    }
  }

  /**
   * ⚠ THE ONE AND ONLY FINDINGS WRITE IN THIS FILE, and its path was DERIVED
   * from the validated brief path — never supplied by anyone.
   *
   * It never throws and never overwrites: a run that deliberated successfully
   * and then could not write a file still returns its findings, with the
   * failure named rather than swallowed.
   */
  function writeFindings(
    runId: string,
    briefPath: string,
    findings: string
  ): { findingsPath: string | null; findingsError: string | null } {
    const target = nextFreeFindingsPath(briefPath, (candidate) => existsSync(candidate))
    if (target === null) {
      return {
        findingsPath: null,
        findingsError:
          'There are already 99 findings files beside this brief, so Chorus stopped rather than overwrite one.'
      }
    }
    try {
      writeFileSync(target, findings, 'utf8')
    } catch (err) {
      logger.error({ err }, `[council] could not write the findings file for run ${runId}`)
      return {
        findingsPath: null,
        findingsError:
          'The findings could not be written beside the brief. They are shown here and stored in the run transcript.'
      }
    }
    try {
      deps.storage.updateCouncilRun(runId, { findingsPath: target })
    } catch (err) {
      // The file is on disk; a ledger write failing does not un-write it.
      logger.error({ err }, `[council] findings written but the run row could not record the path`)
    }
    logger.info(`[council] run ${runId} findings written to ${target}`)
    return { findingsPath: target, findingsError: null }
  }

  /* ---------------------------------------------------------------- */

  /**
   * Drive ONE member's turn. The sequence is `ImplementationSpec-3b-3.md` §4's,
   * and three things it gets right would break under a rearrangement:
   *
   *  · `output.flush()` BEFORE persisting, or the scrubber's held carry — the
   *    partial tail it withholds in case it is the prefix of a secret — never
   *    reaches the transcript;
   *  · `handle.dispose()` in a `finally`, or a member that throws mid-stream
   *    leaves an HTTP request running and spending;
   *  · ONE `SessionOutput` PER MEMBER. A scrubber holds a carry across chunk
   *    boundaries, so sharing one across members would interleave two streams
   *    through one carry and corrupt both.
   */
  async function driveMember(
    ask: Extract<CouncilAction, { kind: 'ask' }>,
    run: PlannedRun,
    routes: ReadonlyMap<string, MemberRoute>,
    mintedKey: string,
    liveRun: LiveRun
  ): Promise<{ entry: CouncilTranscriptEntry; record: TurnRecord }> {
    const member = [...run.members, run.arbiter].find((m) => m.memberId === ask.memberId)
    const route = routes.get(ask.memberId)
    if (!member || !route) {
      // Unreachable: the core only asks members assembly planned. Recorded as a
      // refusal rather than thrown, because a transcript that is missing a turn
      // is worse than one that says the turn failed.
      return refusal(ask, 'This member could not be resolved for the run.')
    }

    let refused: string | null = null
    let usage: TokenUsage | null = null
    const handle = createApiSession(
      {
        sessionId: `${liveRun.runId}:${member.memberId}:${ask.phase}:${ask.round}`,
        modelId: member.model,
        // ⚠ THE MINTED KEY, NOT THE MEMBER'S OWN. This is what gives the run one
        // bounded spend surface. The member's credential was decrypted during
        // the pre-flight — for its refusals and for its route — and discarded
        // there; `envVarName` below is the only thing that survived it, and it
        // is not secret.
        credential: { envVarName: route.envVarName, value: mintedKey, isSecret: true }
      },
      {
        baseUrl: route.baseUrl,
        maxOutputTokens: resolveMaxOutputTokens(member),
        // ⚠ COUPLED TO `MAX_OUTPUT_TOKENS_CEILING`. A member allowed 16,000
        // output tokens cannot also be held to the transport's 120 s default —
        // measured, not predicted: two reasoning members timed out on exactly
        // that combination.
        maxWallClockMs: COUNCIL_TURN_TIMEOUT_MS,
        // Session-scoped external abort: cancelling the RUN aborts every member
        // at once without this loop tracking each handle (D63 Q3's note).
        signal: liveRun.controller.signal,
        // D63(g): both facts arrive on the FACTORY's contract, never through the
        // text stream — a refusal or a usage total yielded as text would flow
        // through the scrubber and be rendered as though the model had said it.
        onUsage: (u) => {
          usage = u
        },
        onRefusal: (r) => {
          refused = r
        },
        // ⚠ THE F39 INSTRUMENT (D96, Task 3e-1). A DIAGNOSTIC — it changes no
        // bound. It exists because F39's question ("is kimi pathological, or is
        // the 4 MB cap too small for a model that streams its chain of
        // thought?") has two opposite fixes and was UNANSWERABLE from outside:
        // the byte count was compared to the cap and then discarded.
        //
        // ⚠ EVERY TURN LOGS, NOT ONLY THE CAPPED ONES, and that is what makes
        // this a measurement rather than an anecdote — the capped figure is
        // read AGAINST the largest successful one. Logged at `warn` when the
        // cap fired so it surfaces without a filter, `info` otherwise.
        //
        // ⚠ THE LABEL IS THE MEMBER'S, THE PHASE'S AND THE ROUND'S — never the
        // route, the env var name or any key material — and NO STREAM CONTENT
        // APPEARS HERE. Model output can carry a credential; a diagnostic that
        // leaked one would be worse than the defect it measures.
        onStreamBytes: ({ bytes, capBytes, capped }) => {
          const where = `${member.label} · ${ask.phase} · round ${ask.round}`
          if (capped) {
            logger.warn(
              `[council] stream CAPPED: ${where} — ${bytes} bytes against a ${capBytes} byte cap`
            )
          } else {
            logger.info(`[council] stream bytes: ${where} — ${bytes} of ${capBytes} allowed`)
          }
        }
      }
    )

    // ⚠ THE SEAM (D45(1)/D46/D63 Q4). The factory emits raw text; THIS scrubs
    // it, with the run's minted key registered as a secret. Omitting that
    // registration leaves a wired-but-inert seam that passes every structural
    // check — which is why 3b-1's drive 5 planted a secret and asserted the
    // INGESTED text came back redacted.
    //
    // Honest coverage wording (F27, sharpened by D63 Q4): Chorus redacts
    // registered exact values on ingest; it cannot redact values an agent
    // derives, and it cannot redact content it was asked to read.
    const output = createSessionOutput({
      secrets: [mintedKey],
      maxChars: MEMBER_BUFFER_CHARS,
      flushMs: MEMBER_FLUSH_MS,
      // ⚠ THE PROGRESS BROADCAST'S ONLY SOURCE. Wiring it to the raw stream
      // instead would bypass the seam at the last possible moment, which is
      // exactly where it would be least visible in review.
      onText: (delta) =>
        deps.emitProgress({
          runId: liveRun.runId,
          phase: ask.phase,
          round: ask.round,
          memberId: member.memberId,
          delta
        })
    })

    try {
      await handle.send(ask.prompt)
      for await (const chunk of handle.receive()) output.ingest(chunk)
      output.flush()
    } catch (err) {
      logger.error({ err }, `[council] member ${member.memberId} failed mid-stream`)
      refused = refused ?? 'The response stream failed.'
    } finally {
      await handle.dispose()
      output.dispose()
    }

    if (refused !== null) return refusal(ask, refused, usage)
    if (output.buffer.trim() === '') {
      // ⚠ F34's SIGNATURE, AND IT LOOKS EXACTLY LIKE A BROKEN TRANSPORT. A
      // reasoning model can consume the entire output cap on reasoning tokens
      // and emit no `delta.content` at all — billed in full, answer empty. It is
      // recorded as a refusal with its own wording so the transcript says which
      // of the two happened.
      return refusal(ask, 'The model returned an empty answer (its output budget may have gone to reasoning).', usage)
    }
    return {
      entry: {
        memberId: member.memberId,
        round: ask.round,
        phase: ask.phase,
        content: output.buffer,
        outcome: 'answered'
      },
      record: { memberId: member.memberId, outcome: 'answered', usage }
    }
  }

  function refusal(
    ask: Extract<CouncilAction, { kind: 'ask' }>,
    reason: string,
    usage: TokenUsage | null = null
  ): { entry: CouncilTranscriptEntry; record: TurnRecord } {
    // ⚠ PERSISTED LIKE ANY OTHER TURN. A council that ran with three of five
    // members must SAY so in its own transcript; an absent row is an absence
    // nobody downstream can distinguish from a smaller council.
    return {
      entry: { memberId: ask.memberId, round: ask.round, phase: ask.phase, content: reason, outcome: 'refused' },
      record: { memberId: ask.memberId, outcome: 'refused', usage }
    }
  }

  /* ---------------------------------------------------------------- */

  /**
   * Read the key's usage, then revoke it, then close the ledger row.
   *
   * ⚠ NEVER THROWS, because it is called from a path that has already decided
   * the run's outcome. A settle failure leaves `revoked_at` NULL, which is not a
   * loss — it is the open-row predicate, and the boot reconcile is the backstop
   * (bounded meanwhile by the key's own cap).
   */
  /**
   * F41 — the settled cost, read from analytics AFTER the key is gone.
   *
   * ⚠ WHY THIS EXISTS AT ALL, since `settle` already returns a number: that
   * number is read ~0.3s after the final stream closes and is short by the run's
   * largest turn. Measured twice, on two rosters that share no model:
   *   opus-5 roster  : reported $0.20085, true $0.41696 — gap $0.21611 vs a
   *                    synthesis turn of $0.21716
   *   gpt-5.6 roster : reported $0.03951, true $0.05545 — gap $0.01595 vs a
   *                    synthesis turn of $0.01683
   * The gap IS the last turn, both times. Confirmed independently against
   * `queryGatewayTotal` over the window containing both runs: $0.475002 against
   * $0.47245 derived from stored tokens, while the app had reported $0.24036.
   *
   * ⚠ IT DOES NOT DELAY THE REVOKE, AND THAT ORDERING IS THE WHOLE REASON IT IS
   * SHAPED THIS WAY. Polling the key's own `usage` until it settled would have
   * been simpler and would have held a live funded key open while we waited —
   * trading the property `settle` is built around for a nicer number. Analytics
   * answers for a deleted key, so the key dies on schedule and the ledger is
   * read afterwards.
   *
   * ⚠⚠ IT NEVER CLAIMS THE FIGURE IS COMPLETE, AND THAT IS A CORRECTION WRITTEN
   * FROM A FAILED EXPERIMENT RATHER THAN FROM CAUTION. The first version of this
   * function stopped as soon as two consecutive reads agreed and reported the
   * result as settled. Run `ecf6856d` proved that wrong: it "settled" at
   * $0.03357 against $0.04797 derived from the run's own stored tokens — short
   * by $0.01440 against a final turn of $0.01513. **Two equal reads mean the
   * number is not moving right now; they do not mean everything has been
   * posted.** Analytics lags at least as long as `readUsage` does, so NO amount
   * of polling inside a run's own lifetime can establish completeness, and a
   * longer timeout would only make the same false claim more slowly.
   *
   * What this returns is therefore a LOWER BOUND, and the caller labels it as
   * one. The real fix is a deferred reconcile that runs long after the response
   * — the `dispatchAttribution.backfillPendingTokens` shape — and it is not
   * built yet.
   */
  async function reconcileCost(hash: string, mintedAt: Date): Promise<number | null> {
    let best: number | null = null
    for (let attempt = 0; attempt < COST_RECONCILE_ATTEMPTS; attempt++) {
      if (attempt > 0) await delay(COST_RECONCILE_INTERVAL_MS)
      // The window opens at the mint and closes NOW — the same (from, to) shape
      // `queryTokensQuietly` uses for a minted key.
      const result = await deps.keys.queryKeyCost(hash, mintedAt, now())
      if (!result.ok) {
        logger.debug(`[council] cost reconcile attempt ${attempt + 1} failed: ${result.reason}`)
        continue
      }
      const value = result.value
      if (value === null) continue // no row posted yet — that is not zero
      // ⚠ THE MAXIMUM, NOT THE LAST. Both sources under-report while the ledger
      // catches up, so the largest reading seen is the tightest lower bound —
      // and a later read can only ever be larger.
      if (best === null || value > best) best = value
    }
    return best
  }

  async function settle(
    runId: string,
    hash: string,
    cancelled: boolean,
    outcomeKind: 'complete' | 'abort'
  ): Promise<number | null> {
    let costUsd: number | null = null
    try {
      // 1. READ FIRST, always. Revocation is a DELETE and whether usage survives
      //    it is UNDOCUMENTED (D4 obligation 6); reading first makes the
      //    question irrelevant.
      const usage = await deps.keys.readUsage(hash)
      costUsd = usage.ok ? usage.value.usageUsd : null
      if (!usage.ok) logger.warn(`[council] usage read failed; revoking anyway: ${usage.reason}`)

      // 2. Revoke. This matters more than the number above.
      const revoked = await deps.keys.revoke(hash)
      const status = cancelled
        ? COUNCIL_RUN_CANCELLED
        : outcomeKind === 'complete'
          ? COUNCIL_RUN_COMPLETE
          : COUNCIL_RUN_FAILED
      deps.storage.updateCouncilRun(runId, {
        status,
        endedAt: new Date().toISOString(),
        costUsd,
        // ⚠ NULL ON A FAILED REVOKE, DELIBERATELY. "We called revoke" and "the
        // key is gone" are different claims, and writing a timestamp for the
        // first would tell the boot reconcile there is nothing left to do.
        revokedAt: revoked.ok ? new Date().toISOString() : null
      })
      if (!revoked.ok) {
        logger.error(`[council] revoke FAILED for run ${runId}; the ledger row stays open: ${revoked.reason}`)
      }
    } catch (err) {
      logger.error({ err }, `[council] settle failed for run ${runId}; the ledger row stays open`)
    }
    return costUsd
  }

  async function revokeQuietly(hash: string): Promise<void> {
    const result = await deps.keys.revoke(hash)
    if (!result.ok) {
      logger.error(`[council] could not revoke a key we cannot use; the boot reconcile will catch it: ${result.reason}`)
    }
  }

  /**
   * One transcript row. `member_id` is carried even for a refusal — the row's
   * whole value is saying WHICH member did not answer.
   *
   * ⚠ THE TOKEN COLUMNS TAKE `null` WHEN THE PROVIDER REPORTED NOTHING, NEVER 0
   * (D55). A zero here would be indistinguishable from a genuinely zero-token
   * turn, and every total computed from the column downstream would be quietly
   * wrong in the cheap direction.
   */
  function persistTurn(
    runId: string,
    result: { entry: CouncilTranscriptEntry; record: TurnRecord }
  ): void {
    try {
      deps.storage.appendCouncilMessage({
        id: randomUUID(),
        runId,
        memberId: result.entry.memberId,
        round: result.entry.round,
        phase: result.entry.phase,
        content: result.entry.content,
        tokensIn: result.record.usage?.tokensIn ?? null,
        tokensOut: result.record.usage?.tokensOut ?? null,
        createdAt: new Date().toISOString()
      })
    } catch (err) {
      // A transcript write must never take down a run that is already spending.
      logger.error({ err }, `[council] could not persist a turn for run ${runId}`)
    }
  }

  /** Every saved member, widened with the two rows assembly needs. Rows in,
   *  decisions out — the policy is all in `assembleRun`. */
  function loadCandidates(): AssemblyCandidate[] {
    return deps.storage.listCouncilMembers().map((member) => {
      const credential = deps.storage.getCredentialProfileById(member.credentialProfileId)
      const provider = credential ? deps.storage.getProviderConfigById(credential.providerId) : null
      return {
        member: {
          id: member.id,
          label: member.label,
          credentialProfileId: member.credentialProfileId,
          model: member.model,
          role: member.role,
          paramsJson: member.paramsJson
        },
        provider: provider
          ? { id: provider.id, name: provider.name, authMode: provider.authMode, model: provider.model }
          : null,
        credential: credential
          ? {
              id: credential.id,
              providerId: credential.providerId,
              label: credential.label,
              unavailableSince: credential.unavailableSince
            }
          : null,
        baseUrl: provider?.baseUrl ?? null
      }
    })
  }

  /** `max_tokens` from `params_json`, clamped. A member that asks for a million
   *  gets the ceiling, not a 402 — the pre-authorization refuses the whole
   *  request, so an out-of-range parameter would take the run down rather than
   *  degrade it. */
  function resolveMaxOutputTokens(member: PlannedMember): number {
    const raw = member.params.max_tokens
    // ⚠ THE FALLBACK READS THE ROLE, and the arbiter's is larger because it
    // writes the findings document. A member that sets its own value still
    // wins — this is a default, never an override.
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      return defaultMaxOutputTokens(member.role)
    }
    return Math.min(MAX_OUTPUT_TOKENS_CEILING, Math.max(MAX_OUTPUT_TOKENS_FLOOR, Math.floor(raw)))
  }

  /* ---------------------------------------------------------------- */

  return {
    start,

    cancel(runId: string): CouncilRunStage {
      const target = live.get(runId)
      if (!target) {
        // ⚠ THE TWO NON-LIVE ANSWERS ARE NOT THE SAME ANSWER, and collapsing
        // them into one `false` is what made a visible window look like a hang.
        // A settling run is finishing normally and its invoke will resolve
        // within seconds; an unknown one is a run this process has no record of.
        // The renderer says different things about them, so this has to know
        // which it is.
        if (settling.has(runId)) {
          logger.info(`[council] cancel for run ${runId} arrived while it was settling; nothing to abort`)
          return 'settling'
        }
        logger.info(`[council] cancel for run ${runId} found no live or settling run`)
        return 'unknown'
      }
      target.cancelled = true
      // The session-scoped signal aborts every in-flight member at once; each
      // member's own `finally` still calls dispose(), which is the sole
      // cancellation mechanism (D63 Q3) and the only thing that clears the
      // deadline timer.
      target.controller.abort()
      logger.info(`[council] run ${runId} cancelled by the user`)
      return 'deliberating'
    },

    abandonOpenRunsOnQuit(): void {
      for (const target of live.values()) {
        target.cancelled = true
        target.controller.abort()
        try {
          // Status only. `revoked_at` is deliberately NOT written: nothing here
          // can revoke, and a revocation timestamp for a key that still exists
          // would tell the boot reconcile to leave it alone.
          deps.storage.updateCouncilRun(target.runId, {
            status: COUNCIL_RUN_ABANDONED,
            endedAt: new Date().toISOString()
          })
        } catch {
          // Quitting. The ledger row is already open; that is the backstop.
        }
        logger.warn(`[council] run ${target.runId} abandoned at quit; its key is left to the boot reconcile`)
      }
      live.clear()
    }
  }
}

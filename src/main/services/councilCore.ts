import type { CouncilRole } from '../../shared/ipc'
import {
  resolveCouncilMember,
  type CouncilCredentialRowLite,
  type CouncilProviderRowLite,
  type MemberRowLite
} from './councilMembers'

/**
 * Task 3b-3: the PURE half of a council run — run assembly and the deliberation
 * protocol, expressed as a state machine.
 *
 * No `electron`, no `fetch`, no storage, NO CLOCK (time is a parameter). The
 * precedents are `attributionCore.ts` ↔ `dispatchAttribution.ts`,
 * `modelCatalogCore.ts` ↔ `modelCatalog.ts`, `restore.ts` ↔ `sessionManager.ts`
 * and — closest of all — `councilMembers.ts`, whose shape this file continues.
 *
 * ⚠ EVERY POLICY DECISION LIVES HERE, AND `councilService.ts` DECIDES NOTHING.
 * The service performs the actions this module returns, persists the results and
 * feeds them back. That boundary is not tidiness: a deliberation protocol is
 * exactly the kind of logic that needs exhaustive, cheap, network-free tests,
 * and every branch that leaks into the service becomes a branch only a billable
 * live run can exercise.
 *
 * ⚠ `nextAction` RETURNS AN ARRAY, AND THAT IS WHAT MAKES A BLIND ROUND
 * EXPRESSIBLE. Every member in one returned batch is asked simultaneously and
 * none of them can see another's answer, because none of the answers exists yet
 * when the batch is handed out. Blindness is therefore a property of the SHAPE
 * rather than of a comment asking the implementer to be careful — the service
 * could not leak one member's position into another's prompt without changing
 * this signature.
 */

/* ------------------------------------------------------------------ */
/* 1. Vocabulary                                                       */
/* ------------------------------------------------------------------ */

export type CouncilPhase = 'positions' | 'critique' | 'arbitration' | 'synthesis' | 'done'

/**
 * What the orchestrator should do next.
 *
 * `ask` carries its own `prompt`, fully assembled. The service never composes
 * one: a prompt IS the protocol, and a service that builds prompts is a service
 * that decides what the deliberation asks.
 */
export type CouncilAction =
  | {
      readonly kind: 'ask'
      readonly memberId: string
      readonly phase: CouncilPhase
      readonly round: number
      readonly prompt: string
    }
  | { readonly kind: 'complete'; readonly findings: string }
  | { readonly kind: 'abort'; readonly reason: string }

/** How one member's turn ended. ⚠ A REFUSAL IS A RESULT, NOT AN ABSENCE — it is
 *  persisted with its round and phase like any other message, so a partial
 *  council reads as partial rather than as a smaller council. */
export type TurnOutcome = 'answered' | 'refused'

/** One persisted turn, as the core sees it. Mirrors a `council_messages` row
 *  minus its ids and timestamps, which are the service's business. */
export interface CouncilTranscriptEntry {
  /** NULL for orchestrator-authored framing and for the synthesis, which have
   *  no member to attribute (the schema's own reasoning). */
  readonly memberId: string | null
  readonly round: number
  readonly phase: CouncilPhase
  readonly content: string
  readonly outcome: TurnOutcome
}

export interface CouncilState {
  readonly run: PlannedRun
  readonly transcript: readonly CouncilTranscriptEntry[]
  /** Set by the service when the user cancels. The core still decides what a
   *  cancelled run DOES — the service only reports the fact. */
  readonly cancelled: boolean
  /** ⚠ PROVENANCE, AND IT ARRIVES AS DATA BECAUSE THE CORE HAS NO CLOCK AND NO
   *  UUID SOURCE (D68(2)). The findings document has to say which run produced
   *  it and when; both facts are the service's to know and this module's to
   *  render. `startedAt` is an ISO-8601 string — a `Date` would be a second
   *  formatting authority, and the run row already stores this exact string. */
  readonly runId: string
  readonly startedAt: string
}

/* ------------------------------------------------------------------ */
/* 2. Run assembly (spec §2)                                           */
/* ------------------------------------------------------------------ */

/**
 * A member that survived assembly. `model` is NON-NULL here: a member whose
 * model cannot be resolved cannot be asked anything, so it is refused at
 * assembly rather than carried as a nullable field nobody downstream can act on.
 *
 * ⚠ `model` IS RESOLVED, NEVER PERSISTED. D48/D56: the route's default lives in
 * `provider_configs` and copying it onto the member row is how the second home
 * D48 forbids gets created by accident.
 */
export interface PlannedMember {
  readonly memberId: string
  /** Carried so every refusal downstream can name the member the USER named.
   *  A refusal citing a uuid is a refusal nobody can act on. */
  readonly label: string
  readonly credentialProfileId: string
  readonly model: string
  readonly role: CouncilRole
  readonly params: Readonly<Record<string, unknown>>
}

export interface PlannedRun {
  /** Role `member`. At least two — see the refusal below for why. */
  readonly members: readonly PlannedMember[]
  readonly arbiter: PlannedMember
  readonly briefText: string
}

/** Everything assembly needs to know about one saved member. The provider and
 *  credential arrive as the same structural views `councilMembers.ts` defines,
 *  so D56's precedence order keeps its single home. */
export interface AssemblyCandidate {
  readonly member: MemberRowLite
  readonly provider: CouncilProviderRowLite | null
  readonly credential: CouncilCredentialRowLite | null
  /**
   * The route's endpoint (`provider_configs.base_url`, D48's one home). Carried
   * beside `provider` rather than on it because `CouncilProviderRowLite` belongs
   * to `councilMembers.ts` and this task does not own that file.
   */
  readonly baseUrl: string | null
}

export type RunAssembly =
  | { readonly ok: true; readonly run: PlannedRun }
  | { readonly ok: false; readonly reason: string }

/**
 * ⚠ WHY THE MINTED KEY CONSTRAINS WHICH ROUTES MAY PARTICIPATE.
 *
 * D64(2) bounds a run with ONE minted OpenRouter key, and every member's request
 * carries THAT key rather than the member's own stored credential — which is
 * what gives the run a single bounded spend surface. An OpenRouter-minted key
 * authenticates against OpenRouter and nowhere else, so a member pointed at a
 * different endpoint physically cannot use it.
 *
 * There are three things to do about that and two of them are wrong. Silently
 * DROPPING the member produces findings whose provenance nobody can
 * reconstruct. Silently falling back to that member's OWN key un-bounds the
 * run's spend — the single thing the mint exists to prevent, undone invisibly.
 * So the run is REFUSED, by label, at assembly.
 *
 * The comparison is by HOST, not by full URL: a path difference
 * (`/api/v1` vs `/api/v1/`) is not a different provider. A proxy in front of
 * OpenRouter on another host IS refused, which is the conservative direction —
 * the alternative is sending a key to a host we cannot show is the gateway.
 *
 * ⚠ THIS IS NOT D42's QUESTION AND MUST NOT BE CONFUSED WITH IT. D42 forbids
 * keying ATTRIBUTION STRATEGY on the gateway or on "does this carry a base_url";
 * the discriminator there is auth mode. This asks something else entirely — "can
 * this endpoint accept the key we are about to send it?" — which is a fact about
 * the endpoint and can only be answered by looking at it.
 */
export function routeAcceptsMintedKey(routeBaseUrl: string | null, gatewayBaseUrl: string): boolean {
  if (routeBaseUrl === null || routeBaseUrl.trim() === '') return false
  try {
    return new URL(routeBaseUrl).host === new URL(gatewayBaseUrl).host
  } catch {
    // An unparseable URL is not a match. It is also not a crash: assembly must
    // produce a refusal a user can read, not an exception.
    return false
  }
}

/**
 * Turn saved members plus a brief into a run, or into ONE authored refusal.
 *
 * ⚠ EVERY REFUSAL IS BY LABEL AND NONE OF THEM IS SILENT. The rule under all of
 * them: a council that quietly ran with three of five members produces findings
 * nobody can interpret, and the transcript would not show the absence. So a
 * member that cannot participate refuses the RUN — it is never dropped from it.
 *
 * The order below is deliberate: per-member eligibility is checked before the
 * shape of the council, so a user with one broken credential is told which
 * credential rather than being told the council is the wrong size.
 */
export function assembleRun(
  candidates: readonly AssemblyCandidate[],
  briefText: string,
  gatewayBaseUrl: string
): RunAssembly {
  if (briefText.trim() === '') {
    return { ok: false, reason: 'A council needs a brief to deliberate on.' }
  }
  // ⚠ D67 Q3, AND IT IS A PRODUCT CONSTRAINT RATHER THAN A CONVENIENCE. Without
  // enumerated questions there is nothing to diff, so every disagreement becomes
  // a model's opinion about prose instead of a computed fact — and the core
  // cannot preserve a dissent it was never able to detect. Refused here, before
  // anything is minted, so the cost of a malformed brief is a sentence rather
  // than a run.
  if (parseBriefQuestions(briefText).length === 0) {
    return {
      ok: false,
      reason:
        'This brief has no numbered questions. A council compares the members’ answers question by question, ' +
        'so the brief needs a numbered list (“1. …”, “2. …”) for them to answer.'
    }
  }
  if (candidates.length === 0) {
    return { ok: false, reason: 'No council members are configured. Add some in Settings first.' }
  }

  const planned: PlannedMember[] = []
  for (const candidate of candidates) {
    // Resolution — including BOTH halves of the eligibility question already
    // authored in 3b-2: the management refusal and the unavailable-credential
    // refusal. Reused, never re-expressed: `resolveCouncilMember` is where D56's
    // precedence order and that refusal vocabulary live.
    //
    // ⚠ THIS IS THE MANAGEMENT REFUSAL'S THIRD CALL SITE (D62), after
    // `validateMemberShape` at create and `resolveCouncilMember` at resolve. D62
    // requires it to fire in the run-assembly path too, because a route's
    // `auth_mode` is unconstrained TEXT that can change under a saved member.
    const resolution = resolveCouncilMember(candidate.member, candidate.provider, candidate.credential)
    if (!resolution.ok) {
      return { ok: false, reason: `Council member '${candidate.member.label}': ${resolution.reason}` }
    }
    const resolved = resolution.member
    if (resolved.model === null) {
      return {
        ok: false,
        reason: `Council member '${candidate.member.label}' has no model, and its route has no default. Give it one in Settings.`
      }
    }
    if (!routeAcceptsMintedKey(candidate.baseUrl, gatewayBaseUrl)) {
      return {
        ok: false,
        reason:
          `Council member '${candidate.member.label}' is not on the OpenRouter gateway, so it cannot use the ` +
          `single capped key that bounds this run's spend. Every member of a council must share one route.`
      }
    }
    planned.push({
      memberId: resolved.memberId,
      label: candidate.member.label,
      credentialProfileId: resolved.credentialProfileId,
      model: resolved.model,
      role: resolved.role,
      params: resolved.params
    })
  }

  const arbiters = planned.filter((m) => m.role === 'arbiter')
  const members = planned.filter((m) => m.role === 'member')

  // ⚠ ZERO OR TWO ARBITERS IS A REFUSAL, NOT A DEFAULT-PICK. Choosing one for
  // the user would make the run's authority arbitrary and invisible — and the
  // arbiter is the member whose output the findings are built from.
  if (arbiters.length === 0) {
    return { ok: false, reason: 'This council has no arbiter. Mark exactly one member as the arbiter.' }
  }
  if (arbiters.length > 1) {
    return {
      ok: false,
      reason: `This council has ${arbiters.length} arbiters (${arbiters.map((a) => `'${a.label}'`).join(', ')}). Mark exactly one.`
    }
  }
  // One member plus an arbiter is not a council — it is a review, and
  // disagreement detection has nothing to detect.
  if (members.length < 2) {
    return {
      ok: false,
      reason: `A council needs at least two members besides the arbiter; this one has ${members.length}.`
    }
  }

  return { ok: true, run: { members, arbiter: arbiters[0], briefText } }
}

/* ------------------------------------------------------------------ */
/* 3. Cost accounting — D55's denominator, computed here               */
/* ------------------------------------------------------------------ */

/** One member's reported usage, as the transport handed it over (`onUsage`).
 *  All three fields nullable for the reason `TokenUsage` says: "not reported"
 *  and "zero" are different facts. */
export interface ReportedUsage {
  readonly tokensIn: number | null
  readonly tokensOut: number | null
  readonly tokensCached: number | null
}

/**
 * ⚠ D55, AND THIS IS WHERE IT BITES FOR A COUNCIL. A run reporting `cost_usd`
 * must also carry what that cost is a cost OF: how many members answered, how
 * many refused, and whether usage was reported or absent. A total with an
 * unknown denominator is the confident-looking number D55 exists to prevent.
 *
 * ⚠ AND A ZERO THAT MEANS "NOT REPORTED" IS FORBIDDEN. A member whose stream
 * ended without a usage frame contributes to `usageAbsent` and to NOTHING else;
 * if no member reported usage at all, the token totals stay NULL rather than
 * summing to a tidy 0. 3b-1's drive 3 is the live precedent — an aborted call
 * delivered no usage frame, so its cost was genuinely unknown and the report
 * said so.
 */
export interface RunAccounting {
  readonly membersPlanned: number
  /**
   * ⚠ DISTINCT MEMBERS, NOT TURNS — AND THE DISTINCTION WAS FOUND THE HONEST
   * WAY, by reading a live drive's output. The first build counted turns here
   * and reported `membersAnswered: 8` against `membersPlanned: 4`, which is not
   * a denominator, it is a riddle. A council of four does not have eight
   * members, and a reader who has to work out that the eight are really turns
   * across four phases is exactly the reader D55 exists to protect.
   *
   * Both facts are worth having, so both ship, separately named.
   */
  readonly membersAnswered: number
  /** Distinct members that refused at least once. A member can answer in one
   *  phase and refuse in another, so this and `membersAnswered` may overlap —
   *  they are two questions, not two halves of one. */
  readonly membersRefused: number
  readonly turnsAnswered: number
  readonly turnsRefused: number
  readonly usageReported: number
  readonly usageAbsent: number
  readonly tokensIn: number | null
  readonly tokensOut: number | null
  readonly tokensCached: number | null
}

export interface TurnRecord {
  readonly memberId: string
  readonly outcome: TurnOutcome
  /** NULL when the provider reported none — never a fabricated zero. */
  readonly usage: ReportedUsage | null
}

export function computeRunAccounting(input: {
  readonly membersPlanned: number
  readonly turns: readonly TurnRecord[]
}): RunAccounting {
  const answeredMembers = new Set<string>()
  const refusedMembers = new Set<string>()
  let turnsAnswered = 0
  let turnsRefused = 0
  let usageReported = 0
  let usageAbsent = 0
  // Kept as `null` until something real arrives, so "nobody reported" cannot be
  // rendered as "zero tokens".
  let tokensIn: number | null = null
  let tokensOut: number | null = null
  let tokensCached: number | null = null
  const add = (total: number | null, value: number | null): number | null =>
    value === null ? total : (total ?? 0) + value

  for (const turn of input.turns) {
    if (turn.outcome === 'answered') {
      turnsAnswered++
      answeredMembers.add(turn.memberId)
    } else {
      turnsRefused++
      refusedMembers.add(turn.memberId)
    }
    if (turn.usage === null) {
      usageAbsent++
      continue
    }
    usageReported++
    tokensIn = add(tokensIn, turn.usage.tokensIn)
    tokensOut = add(tokensOut, turn.usage.tokensOut)
    tokensCached = add(tokensCached, turn.usage.tokensCached)
  }

  return {
    membersPlanned: input.membersPlanned,
    membersAnswered: answeredMembers.size,
    membersRefused: refusedMembers.size,
    turnsAnswered,
    turnsRefused,
    usageReported,
    usageAbsent,
    tokensIn,
    tokensOut,
    tokensCached
  }
}

/* ------------------------------------------------------------------ */
/* 4. The brief's enumerated questions (D67 Q3)                        */
/* ------------------------------------------------------------------ */

/**
 * ⚠ THE COUNCIL RULED THAT BRIEFS MUST CARRY ENUMERATED QUESTIONS, AND THE
 * MECHANISM IT SPECIFIED DOES NOT EXIST.
 *
 * CR-3b.1 action item 12 asked for *"a Zod validation that `brief.questions` is
 * a non-empty array"*. There is no such object: `council:start` carries brief
 * TEXT, deliberately, because the brief's file and its structure belong to Task
 * 3b-4. The RULING is honoured here — a brief whose questions cannot be found
 * refuses the run — by parsing the text, which is what the ruling actually needs
 * (D67 correction (a)).
 *
 * Why questions have to be enumerable at all: without them there is nothing to
 * diff, and every disagreement becomes a model's opinion about prose rather than
 * a computed fact. That is Q3's whole argument, and it is upstream of Q5's
 * guarantee — the core cannot preserve a dissent it could not detect.
 *
 * The grammar is deliberately forgiving of formatting and strict about shape: a
 * line beginning with a number, then `.` or `)`, then text. Markdown emphasis
 * and list markers around it are tolerated because a brief is written by a human
 * in an editor, not emitted by a serializer.
 *
 * ⚠ AND IT IS SCOPED TO THE QUESTIONS SECTION — D68(1), MEASURED RATHER THAN
 * REASONED ABOUT. The first build scanned the WHOLE document, which was correct
 * against the short synthetic briefs above and wrong against every brief this
 * feature exists to read. Run over the project's own council briefs it returned
 * 21 and 23 "questions", not one of the first twelve of which was a question:
 * they were §6's constraints list, §7's weighted rubric and §4's binding
 * rulings. The damage is not cosmetic — members would be asked for an
 * AGREE/DISAGREE/QUALIFY verdict on *"Windows-only v1."*, the disagreement
 * vector and the dissent appendix would be computed over that noise, and every
 * member pays input tokens for all of it on every round.
 */
export function parseBriefQuestions(briefText: string): readonly string[] {
  const questions: string[] = []
  // ⚠ THE FALLBACK IS THE WHOLE DOCUMENT, NOT AN EMPTY LIST. A brief with no
  // questions heading is the synthetic short brief the protocol was tested on
  // and the shape a user writes first; scoping it to nothing would refuse those
  // runs outright. A brief that HAS the heading is taken at its word — if its
  // questions section is empty, `assembleRun` refuses with a sentence the user
  // can act on rather than silently deliberating over the rubric instead.
  for (const rawLine of (questionsSectionOf(briefText) ?? briefText).split('\n')) {
    // A leading list marker or blockquote is stripped; the NUMBER is what
    // matters, and it must still be at the start of the remaining text.
    const line = rawLine.trim().replace(/^[>\-*+\s]+/, '')
    const match = /^(\d{1,2})[.)]\s+(.+)$/.exec(line)
    if (!match) continue
    // Strip markdown emphasis and any trailing colon-label so two spellings of
    // the same question do not read as two questions.
    const text = match[2].replace(/\*\*/g, '').trim()
    if (text.length >= 8) questions.push(text)
  }
  return questions
}

const HEADING = /^(#{1,6})\s+(.*)$/

/**
 * Is this heading the brief's questions section?
 *
 * ⚠ THE SUBJECT IS WHAT COUNTS, NOT THE WHOLE LINE, and the reason is a real
 * heading in this repo: every council brief carries
 * *"## 4. Binding prior rulings — constraints on your answer, not open
 * questions"*, which a naive `/questions/i` test matches and which is the one
 * section that is explicitly NOT the questions. So the section number is
 * stripped, the qualifier after an em-dash or a colon is dropped, and the word
 * has to appear in what remains — the heading's actual subject.
 */
function isQuestionsHeading(headingText: string): boolean {
  const subject = headingText
    // "8. " / "3.1 " — a section number is not part of the subject.
    .replace(/^\s*\d+(?:\.\d+)*[.)]?\s+/, '')
    .replace(/[*_`]/g, '')
    // Everything after an em-dash, en-dash or colon is a qualifier on the
    // subject, and a qualifier is where the false positive lives.
    .split(/[—–:]/)[0]
  return /\bquestions\b/i.test(subject)
}

/**
 * The text under the FIRST questions heading, down to the next heading at the
 * same level or shallower — so `###` subsections inside it are included and the
 * next `##` ends it. NULL when the brief has no such heading.
 */
function questionsSectionOf(briefText: string): string | null {
  const lines = briefText.split('\n')
  let start = -1
  let level = 0
  for (let i = 0; i < lines.length; i++) {
    const heading = HEADING.exec(lines[i])
    if (!heading || !isQuestionsHeading(heading[2])) continue
    start = i + 1
    level = heading[1].length
    break
  }
  if (start === -1) return null

  let end = lines.length
  for (let i = start; i < lines.length; i++) {
    const heading = HEADING.exec(lines[i])
    if (heading && heading[1].length <= level) {
      end = i
      break
    }
  }
  return lines.slice(start, end).join('\n')
}

/* ------------------------------------------------------------------ */
/* 5. The protocol — CR-3b.1 / D67                                     */
/*                                                                     */
/* Ruled by council 2026-07-26 and implemented AS CORRECTED. The six   */
/* coordinator corrections are in D67; the two load-bearing ones are   */
/* marked at their sites below.                                        */
/*                                                                     */
/*   positions (round 0) — every member, blind, concurrently           */
/*   critique  (round 1) — every survivor, seeing the others           */
/*                         ANONYMISED                                  */
/*   arbitration (round 2) — the arbiter, attributed, with the         */
/*                         core-computed disagreement vector           */
/*   synthesis (round 3) — the arbiter, with the core's dissent list   */
/*   done                                                              */
/* ------------------------------------------------------------------ */

export type Verdict = 'AGREE' | 'DISAGREE' | 'QUALIFY'
const VERDICTS: readonly Verdict[] = ['AGREE', 'DISAGREE', 'QUALIFY']

/** How a question's disagreement was established. ⚠ CARRIED INTO THE OUTPUT,
 *  per D67 Q3: a computed disagreement and a model's impression of one are
 *  different facts and must not be rendered as the same one. */
export type DetectionPath = 'structural' | 'model-judged'

export interface QuestionDisagreement {
  readonly index: number
  readonly question: string
  readonly path: DetectionPath
  /** True only when the path is `structural` AND the verdicts actually differ.
   *  A `model-judged` question carries `false` here — the core did not detect
   *  it, and saying otherwise would be claiming a measurement it does not have. */
  readonly disagrees: boolean
  /** memberId → verdict, for members that answered parseably. */
  readonly verdicts: ReadonlyMap<string, Verdict>
  /** memberIds whose answer carried no parseable verdict for this question. */
  readonly nonCompliant: readonly string[]
}

/**
 * Pull one verdict token per question out of a member's position.
 *
 * ⚠ A MISSING TOKEN IS A QUESTION-LEVEL REFUSAL, NOT A GLOBAL ONE (D67 Q3).
 * The member's prose is still preserved and still reaches the arbiter; only the
 * structural signal for that one question is unavailable. Killing a whole
 * member's contribution because a cheap model dropped a token on question 4
 * would discard exactly the diversity the council exists for.
 *
 * The expected shape is `Q<n>: <VERDICT>` on its own line, which is what
 * `buildPositionsPrompt` asks for.
 */
export function parseVerdicts(content: string): ReadonlyMap<number, Verdict> {
  const out = new Map<number, Verdict>()
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim().replace(/^[>\-*+\s]+/, '').replace(/\*\*/g, '')
    const match = /^Q(\d{1,2})\s*[:.\-]\s*([A-Za-z]+)/.exec(line)
    if (!match) continue
    const index = Number(match[1]) - 1
    const token = match[2].toUpperCase()
    if (index < 0) continue
    const verdict = VERDICTS.find((v) => v === token)
    // ⚠ FIRST TOKEN WINS. A member that restates its verdict later (in a summary
    // section, say) must not be able to silently overwrite the answer the
    // disagreement vector was computed from.
    if (verdict && !out.has(index)) out.set(index, verdict)
  }
  return out
}

/**
 * The disagreement vector — a COMPUTED fact wherever it can be, and honestly
 * labelled where it cannot.
 *
 * A question is `structural` when at least two members produced a parseable
 * verdict for it; `disagrees` is then simply "those verdicts are not all the
 * same". Fewer than two parseable verdicts leaves nothing to diff, so the
 * question falls to `model-judged`: the arbiter is given the prose and the
 * output says the detection was weaker there (D67 Q3, hybrid 3C).
 */
export function computeDisagreement(input: {
  readonly questions: readonly string[]
  readonly positions: readonly { readonly memberId: string; readonly content: string }[]
}): readonly QuestionDisagreement[] {
  const parsed = input.positions.map((p) => ({ memberId: p.memberId, verdicts: parseVerdicts(p.content) }))
  return input.questions.map((question, index) => {
    const verdicts = new Map<string, Verdict>()
    const nonCompliant: string[] = []
    for (const p of parsed) {
      const verdict = p.verdicts.get(index)
      if (verdict === undefined) nonCompliant.push(p.memberId)
      else verdicts.set(p.memberId, verdict)
    }
    if (verdicts.size < 2) {
      return { index, question, path: 'model-judged', disagrees: false, verdicts, nonCompliant }
    }
    const distinct = new Set(verdicts.values())
    return { index, question, path: 'structural', disagrees: distinct.size > 1, verdicts, nonCompliant }
  })
}

/** One preserved disagreement. ⚠ `path` IS THE COUNCIL'S OWN CONTRIBUTION
 *  (D67 Q5): a reader must be able to weigh a computed disagreement differently
 *  from a section parsed out of critique prose. */
export interface DissentEntry {
  readonly path: 'structural' | 'critique'
  readonly source: string
  readonly memberIds: readonly string[]
  readonly text: string
}

/**
 * Pull the labelled objection sections out of one critique.
 *
 * ⚠ NOT NLP, NOT A MODEL, NOT EMBEDDINGS — a string matcher keyed on the format
 * `buildCritiquePrompts` asks for. A member that ignores the format yields
 * nothing here, and that is a KNOWN limitation rather than a hidden one (D67,
 * risk R3): structural dissents are always captured because they are computed;
 * critique dissents depend on format compliance, which is a prompt instruction
 * and never a code guarantee.
 */
export function parseCritiqueSections(content: string): readonly string[] {
  const sections: string[] = []
  let current: string[] | null = null
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim().replace(/^[>\-*+\s]+/, '').replace(/\*\*/g, '')
    const header = /^(DISAGREE|OBJECTION|MISSED)\s*:?\s*(.*)$/i.exec(line)
    if (header) {
      if (current && current.join(' ').trim() !== '') sections.push(current.join(' ').trim())
      current = header[2].trim() === '' ? [] : [header[2].trim()]
      continue
    }
    // Any other labelled header ends the section — an objection must not absorb
    // the agreement paragraph that follows it.
    if (/^(AGREE|CHANGED|POSITION|SUMMARY)\s*:?/i.test(line)) {
      if (current && current.join(' ').trim() !== '') sections.push(current.join(' ').trim())
      current = null
      continue
    }
    if (current !== null && line !== '') current.push(line)
  }
  if (current && current.join(' ').trim() !== '') sections.push(current.join(' ').trim())
  return sections
}

/**
 * ⚠ THE FEATURE'S WHOLE VALUE LIVES IN THIS FUNCTION (D67 Q5, ruling 5C).
 *
 * The dissent list is built BY THE CORE, from the transcript, before the arbiter
 * is ever asked to synthesize. The arbiter may add narrative to any entry; it
 * cannot remove one, because removal is not a thing it is able to do — the list
 * is assembled here and appended by `assembleFindingsDocument` regardless of
 * what the arbiter returns.
 *
 * That is what makes "dissents preserved" a fact about the code rather than a
 * promise about a prompt. 5A (ask the arbiter nicely) is unenforceable; 5B
 * (require a `dissents` array and re-ask when it is empty) is satisfiable by a
 * sycophantic arbiter returning a compliant-looking empty array on the second
 * try. Only 5C survives a badly-behaved arbiter.
 */
export function extractDissentEntries(input: {
  readonly disagreement: readonly QuestionDisagreement[]
  readonly transcript: readonly CouncilTranscriptEntry[]
  readonly labelFor: (memberId: string) => string
}): readonly DissentEntry[] {
  const entries: DissentEntry[] = []

  for (const question of input.disagreement) {
    if (!question.disagrees) continue
    const byVerdict = new Map<Verdict, string[]>()
    for (const [memberId, verdict] of question.verdicts) {
      const bucket = byVerdict.get(verdict) ?? []
      bucket.push(memberId)
      byVerdict.set(verdict, bucket)
    }
    const breakdown = [...byVerdict.entries()]
      .map(([verdict, ids]) => `${verdict}: ${ids.map(input.labelFor).join(', ')}`)
      .join(' · ')
    entries.push({
      path: 'structural',
      source: `Q${question.index + 1}`,
      memberIds: [...question.verdicts.keys()],
      text: `${question.question} — ${breakdown}`
    })
  }

  for (const entry of input.transcript) {
    if (entry.phase !== 'critique' || entry.outcome !== 'answered' || entry.memberId === null) continue
    for (const section of parseCritiqueSections(entry.content)) {
      entries.push({
        path: 'critique',
        // `R1`, not `Critique R1`: the renderer already prefixes the provenance
        // path, and the first live run rendered "[Critique — Critique R1]".
        source: `R${entry.round}`,
        memberIds: [entry.memberId],
        text: `${input.labelFor(entry.memberId)}: ${section}`
      })
    }
  }

  return entries
}

/** The core's own dissent section, rendered. Provenance-labelled per D67 Q5. */
function renderDissents(entries: readonly DissentEntry[]): string {
  if (entries.length === 0) {
    return '## Dissents preserved\n\n_None — the council was observed to agree on every enumerated question, and no objection was raised in the critique round._'
  }
  const lines = entries.map(
    (e) => `- [${e.path === 'structural' ? 'Structural' : 'Critique'} — ${e.source}] ${e.text}`
  )
  return `## Dissents preserved\n\n${lines.join('\n')}`
}

/**
 * Whether the arbiter's own synthesis mentions each structural dissent.
 *
 * ⚠ AN OBSERVATION, NOT A GATE — AND THIS IS D67 CORRECTION (b), THE ONE THAT
 * MATTERS MOST.
 *
 * CR-3b.1's pseudocode ABORTED the run when this returned false. That would
 * discard a completed, fully-paid-for deliberation — every member answered,
 * every critique landed, the arbiter ruled — on the strength of a string check
 * the findings' own risk R7 admits is fragile in exactly the false-negative
 * direction that would trigger it. And it is redundant: the same findings'
 * code-enforces item 9 says the core appends its dissent section
 * unconditionally, which it does. If the guarantee already holds, the abort
 * protects nothing and costs everything.
 *
 * So the result is RECORDED instead. An arbiter that elided a dissent is itself
 * a finding about that arbiter, and it is surfaced in the document rather than
 * being converted into a lost run.
 */
export function dissentsElided(synthesisText: string, entries: readonly DissentEntry[]): readonly string[] {
  const haystack = synthesisText.toLowerCase()
  return entries
    .filter((e) => e.path === 'structural')
    .filter((e) => !haystack.includes(e.source.toLowerCase()))
    .map((e) => e.source)
}

/* ------------------------------------------------------------------ */
/* 6. Prompts — built HERE, never in the service (a prompt IS the      */
/*    protocol)                                                        */
/* ------------------------------------------------------------------ */

function buildPositionsPrompt(briefText: string, questions: readonly string[]): string {
  const list = questions.map((q, i) => `Q${i + 1}. ${q}`).join('\n')
  return (
    `${briefText}\n\n---\n\n` +
    `You are one member of an independent review council. You are answering BLIND: ` +
    `you cannot see the other members' answers, and they cannot see yours.\n\n` +
    `Answer each question below. For EACH one, begin a line with the question number ` +
    `and one verdict token, exactly in this form:\n\n` +
    `Q1: AGREE\nQ2: DISAGREE\nQ3: QUALIFY\n\n` +
    `Use AGREE if you support the proposal in the question, DISAGREE if you oppose it, ` +
    `and QUALIFY if you support it only under a condition you must then state. ` +
    `After each verdict line, give your reasoning in prose.\n\n` +
    `The questions:\n${list}\n\n` +
    `If you believe the questions miss something important, add a final section headed ` +
    `"UNPROMPTED OBSERVATION" and say what.`
  )
}

/**
 * ⚠ ANONYMISED (D67 Q1, ruling 1B). The other members' positions arrive as
 * "Position A / B / C" with no label and no model id. The core keeps the mapping
 * — the transcript records `memberId` on every row — so the findings still
 * attribute everything. Only the PROMPT is anonymous.
 *
 * What that buys: it removes the passive form of deference, where a member sees
 * a name it recognises as authoritative and softens. It does not, and does not
 * claim to, stop a model that actively tries to identify its peers from style.
 */
function buildCritiquePrompt(
  self: string,
  positions: readonly { readonly memberId: string; readonly content: string }[]
): string {
  const others = positions.filter((p) => p.memberId !== self)
  const rendered = others
    .map((p, i) => `### Position ${String.fromCharCode(65 + i)}\n\n${p.content}`)
    .join('\n\n')
  return (
    `You are one member of an independent review council. Below are the other members' ` +
    `positions on the same brief, with their identities removed. Judge them on their content.\n\n` +
    `${rendered}\n\n---\n\n` +
    `For EACH position, respond using these exact section labels, one per line:\n\n` +
    `AGREE: <what you agree with>\n` +
    `DISAGREE: <what you disagree with, and why>\n` +
    `MISSED: <anything the position did not consider>\n\n` +
    `Then finish with:\n\nCHANGED: <has your own position changed, and why or why not>\n\n` +
    `⚠ Use the DISAGREE and MISSED labels literally. An objection written without its ` +
    `label may not reach the findings document.`
  )
}

function renderDisagreementVector(disagreement: readonly QuestionDisagreement[], labelFor: (id: string) => string): string {
  return disagreement
    .map((q) => {
      if (q.path === 'model-judged') {
        return `Q${q.index + 1}: NOT MEASURED (too few members answered in the required form) — judge it from the prose.`
      }
      const votes = [...q.verdicts.entries()].map(([id, v]) => `${labelFor(id)}=${v}`).join(', ')
      return `Q${q.index + 1}: ${q.disagrees ? 'MEMBERS DISAGREE' : 'members agree'} — ${votes}`
    })
    .join('\n')
}

function buildArbitrationPrompt(state: CouncilState, disagreement: readonly QuestionDisagreement[]): string {
  const labelFor = makeLabelFor(state.run)
  const positions = state.transcript
    .filter((e) => e.phase === 'positions' && e.outcome === 'answered' && e.memberId !== null)
    .map((e) => `### ${labelFor(e.memberId as string)} — position\n\n${e.content}`)
    .join('\n\n')
  const critiques = state.transcript
    .filter((e) => e.phase === 'critique' && e.outcome === 'answered' && e.memberId !== null)
    .map((e) => `### ${labelFor(e.memberId as string)} — critique\n\n${e.content}`)
    .join('\n\n')
  const anyDisagreement = disagreement.some((q) => q.disagrees)

  return (
    `${state.run.briefText}\n\n---\n\n` +
    `You are the ARBITER of this review council. Unlike the members, you see who said what.\n\n` +
    `## The members' positions\n\n${positions}\n\n` +
    `## The members' critiques of each other\n\n${critiques}\n\n` +
    `## What the orchestrator MEASURED (not an opinion — a count of their verdict tokens)\n\n` +
    `${renderDisagreementVector(disagreement, labelFor)}\n\n---\n\n` +
    `Rule on each question in turn, with your reasoning.\n\n` +
    (anyDisagreement
      ? `Where the members disagreed, say which position is better supported and why — and if the ` +
        `minority position is right, say so plainly.`
      : // D67 Q4, ruling 4A: the arbiter runs even on unanimity, and THIS is the
        // job it does there. The project's own CR-3b.0 was 3-of-3 unanimous on
        // four of five questions and still shipped four compile errors.
        `⚠ The members AGREED on every measured question. That is not the same as being right. ` +
        `They all read the same brief, so they share its blind spots. Say whether this agreement ` +
        `is warranted, and what the council collectively missed.`)
  )
}

function buildSynthesisPrompt(state: CouncilState, dissents: readonly DissentEntry[]): string {
  const labelFor = makeLabelFor(state.run)
  const ruling = state.transcript.find((e) => e.phase === 'arbitration' && e.outcome === 'answered')
  const positions = state.transcript
    .filter((e) => e.phase === 'positions' && e.outcome === 'answered' && e.memberId !== null)
    .map((e) => `### ${labelFor(e.memberId as string)}\n\n${e.content}`)
    .join('\n\n')

  return (
    `You are the ARBITER of this review council, writing its findings.\n\n` +
    `## The brief\n\n${state.run.briefText}\n\n` +
    `## The members' positions\n\n${positions}\n\n` +
    `## Your own ruling\n\n${ruling?.content ?? '(none)'}\n\n` +
    `## Disagreements the orchestrator recorded\n\n${renderDissents(dissents)}\n\n---\n\n` +
    `Write the findings document. Include per-member positions, a synthesis with your ruling ` +
    `per question, risks with mitigations, and action items that are each checkable.\n\n` +
    `⚠ You MAY add narrative context to any disagreement above — say whether you think it is ` +
    `well-founded. You MUST NOT drop one. Refer to each by its source tag (Q1, Q2, …) so a ` +
    `reader can match your commentary to the record.`
  )
}

function makeLabelFor(run: PlannedRun): (memberId: string) => string {
  const labels = new Map<string, string>()
  for (const member of [...run.members, run.arbiter]) labels.set(member.memberId, member.label)
  return (memberId) => labels.get(memberId) ?? memberId
}

/* ------------------------------------------------------------------ */
/* 7. The findings document                                            */
/* ------------------------------------------------------------------ */

/**
 * ⚠ THE CORE'S DISSENT SECTION IS APPENDED UNCONDITIONALLY (D67 Q5 / code-
 * enforces item 9). Not "when the arbiter forgot" — always. A reader sees the
 * arbiter's narrative AND the raw record, and the guarantee does not depend on
 * any check having been right.
 *
 * ⚠ AND A PARTIAL RUN SAYS SO IN ITS OWN FIRST LINE (D67 Q6). A council that
 * ran with two of three members must not read as a two-member council that
 * agreed.
 */
export function assembleFindingsDocument(input: {
  readonly synthesis: string
  readonly dissents: readonly DissentEntry[]
  readonly disagreement: readonly QuestionDisagreement[]
  readonly run: PlannedRun
  readonly transcript: readonly CouncilTranscriptEntry[]
  readonly elided: readonly string[]
  /** ⚠ PARAMETERS, NOT AMBIENT FACTS. This module has no clock and no uuid
   *  source, and growing one to write a header would trade the property that
   *  makes every branch here testable for two lines of convenience. */
  readonly runId: string
  readonly startedAt: string
}): string {
  const labelFor = makeLabelFor(input.run)
  const refusals = input.transcript.filter((e) => e.outcome === 'refused')
  const planned = input.run.members.length
  const answeredIds = new Set(
    input.transcript
      .filter((e) => e.phase === 'positions' && e.outcome === 'answered' && e.memberId !== null)
      .map((e) => e.memberId as string)
  )

  const header =
    answeredIds.size < planned
      ? `> ⚠ **PARTIAL RUN — ${answeredIds.size} of ${planned} members completed.**\n>\n` +
        refusals
          .map(
            (r) =>
              `> - ${r.memberId === null ? 'the orchestrator' : labelFor(r.memberId)} refused at **${r.phase}** (round ${r.round}): ${r.content}`
          )
          .join('\n') +
        `\n>\n> These findings are the output of a council that did not fully convene. Read them as such.`
      : `> Council of ${planned} members plus an arbiter. All members completed.`

  const measurement = input.disagreement
    .map(
      (q) =>
        `- **Q${q.index + 1}** — detection: \`${q.path}\`${q.path === 'structural' ? ` · ${q.disagrees ? 'members disagreed' : 'members agreed'}` : ' · not measured'}` +
        (q.nonCompliant.length > 0
          ? ` · no verdict token from: ${q.nonCompliant.map(labelFor).join(', ')}`
          : '')
    )
    .join('\n')

  const elidedNote =
    input.elided.length === 0
      ? ''
      : `\n\n> ⚠ **The arbiter's synthesis did not refer to ${input.elided.join(', ')}.** ` +
        `The disagreement is preserved below regardless — the section is generated from the ` +
        `transcript, not by the arbiter. That the arbiter passed over it is recorded because it ` +
        `is itself worth knowing.`

  return (
    `${header}\n\n${STANDING_CAVEAT}\n\n${input.synthesis}\n\n---\n\n` +
    `## How disagreement was detected\n\n${measurement}\n\n` +
    `_\`structural\` means the orchestrator compared the members' own verdict tokens and counted ` +
    `the difference. \`model-judged\` means too few members answered in the required form, so the ` +
    `arbiter judged it from prose — a weaker signal, labelled rather than hidden._${elidedNote}\n\n` +
    `${renderDissents(input.dissents)}\n\n` +
    `${renderProvenance(input)}\n`
  )
}

/**
 * ⚠ MANDATORY, AND `ImplementationSpec-3b-4.md` §3.2 SAYS WHY IN ONE SENTENCE:
 * *"The file must say so, or a later reader will cite it as verification."*
 *
 * The evidence is this project's own and it is not hypothetical. CR-3b.0 was
 * 3-of-3 unanimous on four of five questions, its rulings were sound, and the
 * verbatim TypeScript it shipped had four compile errors — because it had the
 * brief and not the repo. A findings file is the output of models reading a
 * document; nothing in this pipeline compiles, runs or tests anything it says.
 *
 * It sits directly under the run header, ABOVE the synthesis, because a caveat
 * a reader reaches after the conclusions is a caveat that arrives too late.
 */
const STANDING_CAVEAT =
  '> ⚠ **These findings are model deliberation, not verified fact.** Every claim below was ' +
  'produced by language models reading the brief. Nothing here was compiled, executed or tested, ' +
  'and no model in this council could see the repository. This project’s own CR-3b.0 was ' +
  'unanimous, its rulings were sound, and the code it shipped had four compile errors. Verify ' +
  'anything you are about to rely on.'

/**
 * ⚠ D68(2) / spec §3.1: *"A findings file whose authorship cannot be
 * reconstructed is not usable as a record."*
 *
 * Every participant is listed WITH ITS MODEL and with what it actually did —
 * including the ones that refused, because a council of four that answered with
 * three is a different document from a council of three, and the roster is the
 * only place that distinction survives once the prose is written.
 */
function renderProvenance(input: {
  readonly run: PlannedRun
  readonly transcript: readonly CouncilTranscriptEntry[]
  readonly runId: string
  readonly startedAt: string
}): string {
  const outcomeOf = (memberId: string): string => {
    const turns = input.transcript.filter((e) => e.memberId === memberId)
    if (turns.length === 0) return 'never asked'
    const answered = turns.filter((t) => t.outcome === 'answered').length
    const refused = turns.filter((t) => t.outcome === 'refused').length
    if (refused === 0) return `answered ${answered} turn${answered === 1 ? '' : 's'}`
    if (answered === 0) return `refused ${refused} turn${refused === 1 ? '' : 's'}`
    return `answered ${answered}, refused ${refused}`
  }
  const row = (m: PlannedMember, role: string): string =>
    `| ${m.label} | ${role} | \`${m.model}\` | ${outcomeOf(m.memberId)} |`

  return (
    `## Provenance\n\n` +
    `- **Run id:** \`${input.runId}\`\n` +
    `- **Started:** ${input.startedAt}\n\n` +
    `| Member | Role | Model | Turns |\n|---|---|---|---|\n` +
    `${[...input.run.members.map((m) => row(m, 'member')), row(input.run.arbiter, 'arbiter')].join('\n')}\n`
  )
}

/* ------------------------------------------------------------------ */
/* 8. nextAction — the state machine                                   */
/* ------------------------------------------------------------------ */

const PHASE_ROUND: Record<Exclude<CouncilPhase, 'done'>, number> = {
  positions: 0,
  critique: 1,
  arbitration: 2,
  synthesis: 3
}

function answeredIn(state: CouncilState, phase: CouncilPhase): readonly { memberId: string; content: string }[] {
  return state.transcript
    .filter((e) => e.phase === phase && e.outcome === 'answered' && e.memberId !== null)
    .map((e) => ({ memberId: e.memberId as string, content: e.content }))
}

function hasTurn(state: CouncilState, phase: CouncilPhase): boolean {
  return state.transcript.some((e) => e.phase === phase)
}

/**
 * ⚠ PURE, AND HOLDING NO STATE BETWEEN CALLS — which is D67 correction (c).
 * CR-3b.1's pseudocode computed the disagreement vector during the positions →
 * critique transition and then referenced it two branches later. Nothing carries
 * across a call to this function; the transcript is the only memory, so the
 * vector is RECOMPUTED from it every time. That is cheap, and it is the property
 * that makes every branch below testable by handing it a state object.
 */
export function nextAction(state: CouncilState): readonly CouncilAction[] {
  if (state.cancelled) {
    return [{ kind: 'abort', reason: 'The run was cancelled.' }]
  }

  const questions = parseBriefQuestions(state.run.briefText)
  const positions = answeredIn(state, 'positions')

  // ── Phase: positions. One batch, every member, blind. ────────────────────
  if (!hasTurn(state, 'positions')) {
    return state.run.members.map((member) => ({
      kind: 'ask' as const,
      memberId: member.memberId,
      phase: 'positions' as const,
      round: PHASE_ROUND.positions,
      prompt: buildPositionsPrompt(state.run.briefText, questions)
    }))
  }

  // ⚠ THE REFUSAL FLOOR, ENFORCED BY THE CODE AND NOT BY A PROMPT (D67 Q6).
  // Checked at every phase boundary, and it is the SAME floor assembly applies
  // before the run starts: one member plus an arbiter is a review, not a
  // council, and disagreement detection with one data point is meaningless.
  if (positions.length < 2) {
    return [
      {
        kind: 'abort',
        reason: `Only ${positions.length} of ${state.run.members.length} members answered; a council needs at least two.`
      }
    ]
  }

  const disagreement = computeDisagreement({ questions, positions })

  // ── Phase: critique. Every survivor, seeing the others ANONYMISED. ───────
  if (!hasTurn(state, 'critique')) {
    return positions.map((p) => ({
      kind: 'ask' as const,
      memberId: p.memberId,
      phase: 'critique' as const,
      round: PHASE_ROUND.critique,
      prompt: buildCritiquePrompt(p.memberId, positions)
    }))
  }

  const labelFor = makeLabelFor(state.run)
  const dissents = extractDissentEntries({ disagreement, transcript: state.transcript, labelFor })

  // ── Phase: arbitration. The arbiter, alone, attributed. ──────────────────
  if (!hasTurn(state, 'arbitration')) {
    return [
      {
        kind: 'ask',
        memberId: state.run.arbiter.memberId,
        phase: 'arbitration',
        round: PHASE_ROUND.arbitration,
        prompt: buildArbitrationPrompt(state, disagreement)
      }
    ]
  }
  if (answeredIn(state, 'arbitration').length === 0) {
    // ⚠ NO FALLBACK ARBITER (D67 Q6). The user configured exactly one, and
    // promoting a member into the role would silently change what the run was.
    return [{ kind: 'abort', reason: 'The arbiter refused at arbitration; the run cannot produce findings.' }]
  }

  // ── Phase: synthesis. ────────────────────────────────────────────────────
  if (!hasTurn(state, 'synthesis')) {
    return [
      {
        kind: 'ask',
        memberId: state.run.arbiter.memberId,
        phase: 'synthesis',
        round: PHASE_ROUND.synthesis,
        prompt: buildSynthesisPrompt(state, dissents)
      }
    ]
  }
  const synthesis = answeredIn(state, 'synthesis')[0]
  if (synthesis === undefined) {
    return [{ kind: 'abort', reason: 'The arbiter refused at synthesis; the run cannot produce findings.' }]
  }

  // ⚠ NO ABORT HERE, DELIBERATELY — D67 correction (b). An elided dissent is
  // recorded in the document, not converted into a lost run.
  return [
    {
      kind: 'complete',
      findings: assembleFindingsDocument({
        synthesis: synthesis.content,
        dissents,
        disagreement,
        run: state.run,
        transcript: state.transcript,
        elided: dissentsElided(synthesis.content, dissents),
        runId: state.runId,
        startedAt: state.startedAt
      })
    }
  ]
}

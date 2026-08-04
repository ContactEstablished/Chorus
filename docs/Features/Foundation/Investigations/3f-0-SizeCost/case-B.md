---
case_id: 3a91c6d4-77e2-4b18-9f05-6ce1b0a2d7f4
project: Chorus
phase: 3f
opened: 2026-08-01
purpose: size/cost instrument — the SAME case is run at four pack sizes
---

# CR-3f.1 — Where the Docket's truth lives

> **⚠ ANSWER THE QUESTIONS IN SECTION 4. DO NOT REVIEW THIS DOCUMENT.** This is a case put to the
> council, not a design document submitted for critique. Do not comment on its structure, length,
> completeness or wording. Every question in §4 requires a `Qn: AGREE | DISAGREE | QUALIFY` verdict
> token on its own line, followed by your reasoning.
>
> **⚠ KEEP EACH ANSWER UNDER 400 WORDS.** This case is also a measurement instrument: it is run
> several times with different amounts of source code attached, and the comparison is only valid if
> answer length stays roughly constant. Be decisive rather than exhaustive.

---

## 1. Context

**Chorus** is a local-first Windows desktop app (Electron · Vue 3 · TypeScript · SQLite) for running
several AI coding agents in parallel terminal panes. It has a native multi-model Council Review
feature — you are it.

A feature now being designed gives the council a **per-project history**, called the **Docket**. The
design so far:

- A **Case** is a markdown document with mandatory headings, stored **in the project's own
  repository** at `docs/council/<slug>/case.md`, and therefore committed to git and shared with
  whoever clones the repo.
- Each **Run** of that case writes `runs/<timestamp>/findings.md` beneath it.
- The **database** separately records every run: cost, token counts, timings, and the full
  transcript of what each member said.
- A case carries a `case_id` UUID in its own frontmatter, so its identity survives a folder rename
  or a clone onto another machine.

**⚠ THE PROBLEM THIS CASE EXISTS TO SETTLE: there are now two stores, and they can disagree.** The
database knows about runs; the repository holds the documents. A case folder can arrive on a machine
by `git pull` with **no database row behind it**. A database row can survive a case folder being
deleted by hand. Neither store is wrong; they answer different questions.

---

## 2. The three candidate positions

**(A) The database is the Docket.** The view lists rows from the `council_runs` table. A case folder
with no run row is simply not shown. Simple, fast, and the view can never show something it has no
metadata for — but a colleague's case, pulled from git, is invisible until someone runs it locally.

**(B) The filesystem is the Docket.** The view scans `docs/council/*/case.md` and shows every case
it finds, attaching run metadata from the database where a row exists. Nothing on disk is ever
hidden — but the view now depends on a directory scan on every open, and a case that has never run
has no cost, no verdict and no transcript to show.

**(C) Reconcile both, and label the difference.** The view shows the union: cases from disk, runs
from the database, and any case with no local run row is rendered in a distinct "never run here"
state. Most honest, most code, and it introduces a third thing the user must understand.

---

## 3. Binding prior rulings — constraints on your answer, not open questions

These are settled decisions in this project. **Do not re-litigate them.** An answer that requires
overturning one of them is out of scope; say so and answer within the constraint.

1. **Cases live in the repository.** Storing them in private application data was considered and
   rejected: the findings must be readable by the coding agents working in that repo.
2. **Transcripts are kept indefinitely**, with the growth arithmetic done — roughly 38 MB/year at a
   pessimistic four runs per week. A background purge was explicitly declined.
3. **No number without its denominator.** A count derived from partial data must carry the
   denominator that makes it honest.
4. **Refuse, never degrade.** Where a property cannot be guaranteed, refuse with an actionable
   message rather than proceeding with a weaker guarantee.
5. **Deleting is two actions** — "Remove from Docket" purges database rows and keeps the files;
   "Delete case" also removes the folder, behind a confirmation naming the path.
6. **The deliberation protocol itself is closed.** Four phases, blind first round, unconditional
   preservation of dissent.

---

## 4. Questions — answer each one; do not review this document

Each answer must begin with a verdict token on its own line, exactly in the form `Q1: AGREE`,
`Q1: DISAGREE` or `Q1: QUALIFY`, followed by your reasoning in prose. Use **QUALIFY** when you
support the proposal only under a condition you must then state. **Keep each answer under 400
words.**

1. Position (C) is correct: the Docket must show the union of both stores and render a case with no
   local run row in a visibly distinct state, rather than hiding it or inventing metadata for it.

2. The `case_id` UUID in the case's frontmatter should be the sole identity used to join a case to
   its runs, and the folder path should never be used as a fallback key even when the frontmatter is
   missing or malformed.

3. A case folder that is present on disk but whose `case_id` matches no database row should be
   openable and re-runnable from the Docket, rather than being read-only until someone runs it.

4. When the database holds a run whose case folder has been deleted from disk, that run should
   remain visible in the Docket as an orphan with its cost and transcript intact, rather than being
   hidden or purged automatically.

5. The Docket view should perform its directory scan **once per project selection** and cache the
   result for the session, rather than re-scanning every time the view is opened.

6. Two different machines running the same case will produce different `runs/<timestamp>/` folders
   that git will merge without conflict, and this is acceptable — the alternative of a single
   canonical findings file per case would be worse.

---

## 5. What a useful answer looks like

- A verdict token for every question, on its own line, before the prose.
- Where you disagree, say what you would do **instead**, concretely enough to build.
- Where you believe a question rests on a false premise, say which premise and why — but check §3
  first, because several premises are settled rulings rather than assumptions.
- **Under 400 words per answer.** Decisiveness is worth more here than coverage.

---

## 6. Exhibits

The following files are attached in full, identically for every member. Cite them by exhibit number and line.

### Exhibit 1 — `src/main/services/councilCore.ts` (lines 1–1306, 58854 bytes)

```ts
   1  import type { CouncilRole } from '../../shared/ipc'
   2  import {
   3    resolveCouncilMember,
   4    type CouncilCredentialRowLite,
   5    type CouncilProviderRowLite,
   6    type MemberRowLite
   7  } from './councilMembers'
   8  
   9  /**
  10   * Task 3b-3: the PURE half of a council run — run assembly and the deliberation
  11   * protocol, expressed as a state machine.
  12   *
  13   * No `electron`, no `fetch`, no storage, NO CLOCK (time is a parameter). The
  14   * precedents are `attributionCore.ts` ↔ `dispatchAttribution.ts`,
  15   * `modelCatalogCore.ts` ↔ `modelCatalog.ts`, `restore.ts` ↔ `sessionManager.ts`
  16   * and — closest of all — `councilMembers.ts`, whose shape this file continues.
  17   *
  18   * ⚠ EVERY POLICY DECISION LIVES HERE, AND `councilService.ts` DECIDES NOTHING.
  19   * The service performs the actions this module returns, persists the results and
  20   * feeds them back. That boundary is not tidiness: a deliberation protocol is
  21   * exactly the kind of logic that needs exhaustive, cheap, network-free tests,
  22   * and every branch that leaks into the service becomes a branch only a billable
  23   * live run can exercise.
  24   *
  25   * ⚠ `nextAction` RETURNS AN ARRAY, AND THAT IS WHAT MAKES A BLIND ROUND
  26   * EXPRESSIBLE. Every member in one returned batch is asked simultaneously and
  27   * none of them can see another's answer, because none of the answers exists yet
  28   * when the batch is handed out. Blindness is therefore a property of the SHAPE
  29   * rather than of a comment asking the implementer to be careful — the service
  30   * could not leak one member's position into another's prompt without changing
  31   * this signature.
  32   */
  33  
  34  /* ------------------------------------------------------------------ */
  35  /* 1. Vocabulary                                                       */
  36  /* ------------------------------------------------------------------ */
  37  
  38  export type CouncilPhase = 'positions' | 'critique' | 'arbitration' | 'synthesis' | 'done'
  39  
  40  /**
  41   * What the orchestrator should do next.
  42   *
  43   * `ask` carries its own `prompt`, fully assembled. The service never composes
  44   * one: a prompt IS the protocol, and a service that builds prompts is a service
  45   * that decides what the deliberation asks.
  46   */
  47  export type CouncilAction =
  48    | {
  49        readonly kind: 'ask'
  50        readonly memberId: string
  51        readonly phase: CouncilPhase
  52        readonly round: number
  53        readonly prompt: string
  54      }
  55    | { readonly kind: 'complete'; readonly findings: string }
  56    | { readonly kind: 'abort'; readonly reason: string }
  57  
  58  /** How one member's turn ended. ⚠ A REFUSAL IS A RESULT, NOT AN ABSENCE — it is
  59   *  persisted with its round and phase like any other message, so a partial
  60   *  council reads as partial rather than as a smaller council. */
  61  export type TurnOutcome = 'answered' | 'refused'
  62  
  63  /** One persisted turn, as the core sees it. Mirrors a `council_messages` row
  64   *  minus its ids and timestamps, which are the service's business. */
  65  export interface CouncilTranscriptEntry {
  66    /** NULL for orchestrator-authored framing and for the synthesis, which have
  67     *  no member to attribute (the schema's own reasoning). */
  68    readonly memberId: string | null
  69    readonly round: number
  70    readonly phase: CouncilPhase
  71    readonly content: string
  72    readonly outcome: TurnOutcome
  73  }
  74  
  75  export interface CouncilState {
  76    readonly run: PlannedRun
  77    readonly transcript: readonly CouncilTranscriptEntry[]
  78    /** Set by the service when the user cancels. The core still decides what a
  79     *  cancelled run DOES — the service only reports the fact. */
  80    readonly cancelled: boolean
  81    /** ⚠ PROVENANCE, AND IT ARRIVES AS DATA BECAUSE THE CORE HAS NO CLOCK AND NO
  82     *  UUID SOURCE (D68(2)). The findings document has to say which run produced
  83     *  it and when; both facts are the service's to know and this module's to
  84     *  render. `startedAt` is an ISO-8601 string — a `Date` would be a second
  85     *  formatting authority, and the run row already stores this exact string. */
  86    readonly runId: string
  87    readonly startedAt: string
  88  }
  89  
  90  /* ------------------------------------------------------------------ */
  91  /* 2. Run assembly (spec §2)                                           */
  92  /* ------------------------------------------------------------------ */
  93  
  94  /**
  95   * A member that survived assembly. `model` is NON-NULL here: a member whose
  96   * model cannot be resolved cannot be asked anything, so it is refused at
  97   * assembly rather than carried as a nullable field nobody downstream can act on.
  98   *
  99   * ⚠ `model` IS RESOLVED, NEVER PERSISTED. D48/D56: the route's default lives in
 100   * `provider_configs` and copying it onto the member row is how the second home
 101   * D48 forbids gets created by accident.
 102   */
 103  export interface PlannedMember {
 104    readonly memberId: string
 105    /** Carried so every refusal downstream can name the member the USER named.
 106     *  A refusal citing a uuid is a refusal nobody can act on. */
 107    readonly label: string
 108    readonly credentialProfileId: string
 109    readonly model: string
 110    readonly role: CouncilRole
 111    readonly params: Readonly<Record<string, unknown>>
 112  }
 113  
 114  export interface PlannedRun {
 115    /** Role `member`. At least two — see the refusal below for why. */
 116    readonly members: readonly PlannedMember[]
 117    readonly arbiter: PlannedMember
 118    readonly briefText: string
 119  }
 120  
 121  /** Everything assembly needs to know about one saved member. The provider and
 122   *  credential arrive as the same structural views `councilMembers.ts` defines,
 123   *  so D56's precedence order keeps its single home. */
 124  export interface AssemblyCandidate {
 125    readonly member: MemberRowLite
 126    readonly provider: CouncilProviderRowLite | null
 127    readonly credential: CouncilCredentialRowLite | null
 128    /**
 129     * The route's endpoint (`provider_configs.base_url`, D48's one home). Carried
 130     * beside `provider` rather than on it because `CouncilProviderRowLite` belongs
 131     * to `councilMembers.ts` and this task does not own that file.
 132     */
 133    readonly baseUrl: string | null
 134  }
 135  
 136  export type RunAssembly =
 137    | { readonly ok: true; readonly run: PlannedRun }
 138    | { readonly ok: false; readonly reason: string }
 139  
 140  /**
 141   * ⚠ WHY THE MINTED KEY CONSTRAINS WHICH ROUTES MAY PARTICIPATE.
 142   *
 143   * D64(2) bounds a run with ONE minted OpenRouter key, and every member's request
 144   * carries THAT key rather than the member's own stored credential — which is
 145   * what gives the run a single bounded spend surface. An OpenRouter-minted key
 146   * authenticates against OpenRouter and nowhere else, so a member pointed at a
 147   * different endpoint physically cannot use it.
 148   *
 149   * There are three things to do about that and two of them are wrong. Silently
 150   * DROPPING the member produces findings whose provenance nobody can
 151   * reconstruct. Silently falling back to that member's OWN key un-bounds the
 152   * run's spend — the single thing the mint exists to prevent, undone invisibly.
 153   * So the run is REFUSED, by label, at assembly.
 154   *
 155   * The comparison is by HOST, not by full URL: a path difference
 156   * (`/api/v1` vs `/api/v1/`) is not a different provider. A proxy in front of
 157   * OpenRouter on another host IS refused, which is the conservative direction —
 158   * the alternative is sending a key to a host we cannot show is the gateway.
 159   *
 160   * ⚠ THIS IS NOT D42's QUESTION AND MUST NOT BE CONFUSED WITH IT. D42 forbids
 161   * keying ATTRIBUTION STRATEGY on the gateway or on "does this carry a base_url";
 162   * the discriminator there is auth mode. This asks something else entirely — "can
 163   * this endpoint accept the key we are about to send it?" — which is a fact about
 164   * the endpoint and can only be answered by looking at it.
 165   */
 166  export function routeAcceptsMintedKey(routeBaseUrl: string | null, gatewayBaseUrl: string): boolean {
 167    if (routeBaseUrl === null || routeBaseUrl.trim() === '') return false
 168    try {
 169      return new URL(routeBaseUrl).host === new URL(gatewayBaseUrl).host
 170    } catch {
 171      // An unparseable URL is not a match. It is also not a crash: assembly must
 172      // produce a refusal a user can read, not an exception.
 173      return false
 174    }
 175  }
 176  
 177  /**
 178   * Turn saved members plus a brief into a run, or into ONE authored refusal.
 179   *
 180   * ⚠ EVERY REFUSAL IS BY LABEL AND NONE OF THEM IS SILENT. The rule under all of
 181   * them: a council that quietly ran with three of five members produces findings
 182   * nobody can interpret, and the transcript would not show the absence. So a
 183   * member that cannot participate refuses the RUN — it is never dropped from it.
 184   *
 185   * The order below is deliberate: per-member eligibility is checked before the
 186   * shape of the council, so a user with one broken credential is told which
 187   * credential rather than being told the council is the wrong size.
 188   */
 189  export function assembleRun(
 190    candidates: readonly AssemblyCandidate[],
 191    briefText: string,
 192    gatewayBaseUrl: string
 193  ): RunAssembly {
 194    if (briefText.trim() === '') {
 195      return { ok: false, reason: 'A council needs a brief to deliberate on.' }
 196    }
 197    // ⚠ D67 Q3, AND IT IS A PRODUCT CONSTRAINT RATHER THAN A CONVENIENCE. Without
 198    // enumerated questions there is nothing to diff, so every disagreement becomes
 199    // a model's opinion about prose instead of a computed fact — and the core
 200    // cannot preserve a dissent it was never able to detect. Refused here, before
 201    // anything is minted, so the cost of a malformed brief is a sentence rather
 202    // than a run.
 203    if (parseBriefQuestions(briefText).length === 0) {
 204      return {
 205        ok: false,
 206        reason:
 207          'This brief has no numbered questions. A council compares the members’ answers question by question, ' +
 208          'so the brief needs a numbered list (“1. …”, “2. …”) for them to answer.'
 209      }
 210    }
 211    if (candidates.length === 0) {
 212      return { ok: false, reason: 'No council members are configured. Add some in Settings first.' }
 213    }
 214  
 215    const planned: PlannedMember[] = []
 216    for (const candidate of candidates) {
 217      // Resolution — including BOTH halves of the eligibility question already
 218      // authored in 3b-2: the management refusal and the unavailable-credential
 219      // refusal. Reused, never re-expressed: `resolveCouncilMember` is where D56's
 220      // precedence order and that refusal vocabulary live.
 221      //
 222      // ⚠ THIS IS THE MANAGEMENT REFUSAL'S THIRD CALL SITE (D62), after
 223      // `validateMemberShape` at create and `resolveCouncilMember` at resolve. D62
 224      // requires it to fire in the run-assembly path too, because a route's
 225      // `auth_mode` is unconstrained TEXT that can change under a saved member.
 226      const resolution = resolveCouncilMember(candidate.member, candidate.provider, candidate.credential)
 227      if (!resolution.ok) {
 228        return { ok: false, reason: `Council member '${candidate.member.label}': ${resolution.reason}` }
 229      }
 230      const resolved = resolution.member
 231      if (resolved.model === null) {
 232        return {
 233          ok: false,
 234          reason: `Council member '${candidate.member.label}' has no model, and its route has no default. Give it one in Settings.`
 235        }
 236      }
 237      if (!routeAcceptsMintedKey(candidate.baseUrl, gatewayBaseUrl)) {
 238        return {
 239          ok: false,
 240          reason:
 241            `Council member '${candidate.member.label}' is not on the OpenRouter gateway, so it cannot use the ` +
 242            `single capped key that bounds this run's spend. Every member of a council must share one route.`
 243        }
 244      }
 245      planned.push({
 246        memberId: resolved.memberId,
 247        label: candidate.member.label,
 248        credentialProfileId: resolved.credentialProfileId,
 249        model: resolved.model,
 250        role: resolved.role,
 251        params: resolved.params
 252      })
 253    }
 254  
 255    const arbiters = planned.filter((m) => m.role === 'arbiter')
 256    const members = planned.filter((m) => m.role === 'member')
 257  
 258    // ⚠ ZERO OR TWO ARBITERS IS A REFUSAL, NOT A DEFAULT-PICK. Choosing one for
 259    // the user would make the run's authority arbitrary and invisible — and the
 260    // arbiter is the member whose output the findings are built from.
 261    if (arbiters.length === 0) {
 262      return { ok: false, reason: 'This council has no arbiter. Mark exactly one member as the arbiter.' }
 263    }
 264    if (arbiters.length > 1) {
 265      return {
 266        ok: false,
 267        reason: `This council has ${arbiters.length} arbiters (${arbiters.map((a) => `'${a.label}'`).join(', ')}). Mark exactly one.`
 268      }
 269    }
 270    // One member plus an arbiter is not a council — it is a review, and
 271    // disagreement detection has nothing to detect.
 272    if (members.length < 2) {
 273      return {
 274        ok: false,
 275        reason: `A council needs at least two members besides the arbiter; this one has ${members.length}.`
 276      }
 277    }
 278  
 279    return { ok: true, run: { members, arbiter: arbiters[0], briefText } }
 280  }
 281  
 282  /* ------------------------------------------------------------------ */
 283  /* 3. Cost accounting — D55's denominator, computed here               */
 284  /* ------------------------------------------------------------------ */
 285  
 286  /** One member's reported usage, as the transport handed it over (`onUsage`).
 287   *  All three fields nullable for the reason `TokenUsage` says: "not reported"
 288   *  and "zero" are different facts. */
 289  export interface ReportedUsage {
 290    readonly tokensIn: number | null
 291    readonly tokensOut: number | null
 292    readonly tokensCached: number | null
 293  }
 294  
 295  /**
 296   * ⚠ D55, AND THIS IS WHERE IT BITES FOR A COUNCIL. A run reporting `cost_usd`
 297   * must also carry what that cost is a cost OF: how many members answered, how
 298   * many refused, and whether usage was reported or absent. A total with an
 299   * unknown denominator is the confident-looking number D55 exists to prevent.
 300   *
 301   * ⚠ AND A ZERO THAT MEANS "NOT REPORTED" IS FORBIDDEN. A member whose stream
 302   * ended without a usage frame contributes to `usageAbsent` and to NOTHING else;
 303   * if no member reported usage at all, the token totals stay NULL rather than
 304   * summing to a tidy 0. 3b-1's drive 3 is the live precedent — an aborted call
 305   * delivered no usage frame, so its cost was genuinely unknown and the report
 306   * said so.
 307   */
 308  export interface RunAccounting {
 309    readonly membersPlanned: number
 310    /**
 311     * ⚠ DISTINCT MEMBERS, NOT TURNS — AND THE DISTINCTION WAS FOUND THE HONEST
 312     * WAY, by reading a live drive's output. The first build counted turns here
 313     * and reported `membersAnswered: 8` against `membersPlanned: 4`, which is not
 314     * a denominator, it is a riddle. A council of four does not have eight
 315     * members, and a reader who has to work out that the eight are really turns
 316     * across four phases is exactly the reader D55 exists to protect.
 317     *
 318     * Both facts are worth having, so both ship, separately named.
 319     */
 320    readonly membersAnswered: number
 321    /** Distinct members that refused at least once. A member can answer in one
 322     *  phase and refuse in another, so this and `membersAnswered` may overlap —
 323     *  they are two questions, not two halves of one. */
 324    readonly membersRefused: number
 325    readonly turnsAnswered: number
 326    readonly turnsRefused: number
 327    readonly usageReported: number
 328    readonly usageAbsent: number
 329    readonly tokensIn: number | null
 330    readonly tokensOut: number | null
 331    readonly tokensCached: number | null
 332  }
 333  
 334  export interface TurnRecord {
 335    readonly memberId: string
 336    readonly outcome: TurnOutcome
 337    /** NULL when the provider reported none — never a fabricated zero. */
 338    readonly usage: ReportedUsage | null
 339  }
 340  
 341  export function computeRunAccounting(input: {
 342    readonly membersPlanned: number
 343    readonly turns: readonly TurnRecord[]
 344  }): RunAccounting {
 345    const answeredMembers = new Set<string>()
 346    const refusedMembers = new Set<string>()
 347    let turnsAnswered = 0
 348    let turnsRefused = 0
 349    let usageReported = 0
 350    let usageAbsent = 0
 351    // Kept as `null` until something real arrives, so "nobody reported" cannot be
 352    // rendered as "zero tokens".
 353    let tokensIn: number | null = null
 354    let tokensOut: number | null = null
 355    let tokensCached: number | null = null
 356    const add = (total: number | null, value: number | null): number | null =>
 357      value === null ? total : (total ?? 0) + value
 358  
 359    for (const turn of input.turns) {
 360      if (turn.outcome === 'answered') {
 361        turnsAnswered++
 362        answeredMembers.add(turn.memberId)
 363      } else {
 364        turnsRefused++
 365        refusedMembers.add(turn.memberId)
 366      }
 367      if (turn.usage === null) {
 368        usageAbsent++
 369        continue
 370      }
 371      usageReported++
 372      tokensIn = add(tokensIn, turn.usage.tokensIn)
 373      tokensOut = add(tokensOut, turn.usage.tokensOut)
 374      tokensCached = add(tokensCached, turn.usage.tokensCached)
 375    }
 376  
 377    return {
 378      membersPlanned: input.membersPlanned,
 379      membersAnswered: answeredMembers.size,
 380      membersRefused: refusedMembers.size,
 381      turnsAnswered,
 382      turnsRefused,
 383      usageReported,
 384      usageAbsent,
 385      tokensIn,
 386      tokensOut,
 387      tokensCached
 388    }
 389  }
 390  
 391  /* ------------------------------------------------------------------ */
 392  /* 4. The brief's enumerated questions (D67 Q3)                        */
 393  /* ------------------------------------------------------------------ */
 394  
 395  /**
 396   * ⚠ THE COUNCIL RULED THAT BRIEFS MUST CARRY ENUMERATED QUESTIONS, AND THE
 397   * MECHANISM IT SPECIFIED DOES NOT EXIST.
 398   *
 399   * CR-3b.1 action item 12 asked for *"a Zod validation that `brief.questions` is
 400   * a non-empty array"*. There is no such object: `council:start` carries brief
 401   * TEXT, deliberately, because the brief's file and its structure belong to Task
 402   * 3b-4. The RULING is honoured here — a brief whose questions cannot be found
 403   * refuses the run — by parsing the text, which is what the ruling actually needs
 404   * (D67 correction (a)).
 405   *
 406   * Why questions have to be enumerable at all: without them there is nothing to
 407   * diff, and every disagreement becomes a model's opinion about prose rather than
 408   * a computed fact. That is Q3's whole argument, and it is upstream of Q5's
 409   * guarantee — the core cannot preserve a dissent it could not detect.
 410   *
 411   * The grammar is deliberately forgiving of formatting and strict about shape: a
 412   * line beginning with a number, then `.` or `)`, then text. Markdown emphasis
 413   * and list markers around it are tolerated because a brief is written by a human
 414   * in an editor, not emitted by a serializer.
 415   *
 416   * ⚠ AND IT IS SCOPED TO THE QUESTIONS SECTION — D68(1), MEASURED RATHER THAN
 417   * REASONED ABOUT. The first build scanned the WHOLE document, which was correct
 418   * against the short synthetic briefs above and wrong against every brief this
 419   * feature exists to read. Run over the project's own council briefs it returned
 420   * 21 and 23 "questions", not one of the first twelve of which was a question:
 421   * they were §6's constraints list, §7's weighted rubric and §4's binding
 422   * rulings. The damage is not cosmetic — members would be asked for an
 423   * AGREE/DISAGREE/QUALIFY verdict on *"Windows-only v1."*, the disagreement
 424   * vector and the dissent appendix would be computed over that noise, and every
 425   * member pays input tokens for all of it on every round.
 426   */
 427  export function parseBriefQuestions(briefText: string): readonly string[] {
 428    const questions: string[] = []
 429    // ⚠ THE FALLBACK IS THE WHOLE DOCUMENT, NOT AN EMPTY LIST. A brief with no
 430    // questions heading is the synthetic short brief the protocol was tested on
 431    // and the shape a user writes first; scoping it to nothing would refuse those
 432    // runs outright. A brief that HAS the heading is taken at its word — if its
 433    // questions section is empty, `assembleRun` refuses with a sentence the user
 434    // can act on rather than silently deliberating over the rubric instead.
 435    for (const rawLine of (questionsSectionOf(briefText) ?? briefText).split('\n')) {
 436      // A leading list marker or blockquote is stripped; the NUMBER is what
 437      // matters, and it must still be at the start of the remaining text.
 438      const line = rawLine.trim().replace(/^[>\-*+\s]+/, '')
 439      const match = /^(\d{1,2})[.)]\s+(.+)$/.exec(line)
 440      if (!match) continue
 441      // Strip markdown emphasis and any trailing colon-label so two spellings of
 442      // the same question do not read as two questions.
 443      const text = match[2].replace(/\*\*/g, '').trim()
 444      if (text.length >= 8) questions.push(text)
 445    }
 446    return questions
 447  }
 448  
 449  const HEADING = /^(#{1,6})\s+(.*)$/
 450  
 451  /**
 452   * Is this heading the brief's questions section?
 453   *
 454   * ⚠ THE SUBJECT IS WHAT COUNTS, NOT THE WHOLE LINE, and the reason is a real
 455   * heading in this repo: every council brief carries
 456   * *"## 4. Binding prior rulings — constraints on your answer, not open
 457   * questions"*, which a naive `/questions/i` test matches and which is the one
 458   * section that is explicitly NOT the questions. So the section number is
 459   * stripped, the qualifier after an em-dash or a colon is dropped, and the word
 460   * has to appear in what remains — the heading's actual subject.
 461   */
 462  function isQuestionsHeading(headingText: string): boolean {
 463    const subject = headingText
 464      // "8. " / "3.1 " — a section number is not part of the subject.
 465      .replace(/^\s*\d+(?:\.\d+)*[.)]?\s+/, '')
 466      .replace(/[*_`]/g, '')
 467      // Everything after an em-dash, en-dash or colon is a qualifier on the
 468      // subject, and a qualifier is where the false positive lives.
 469      .split(/[—–:]/)[0]
 470    return /\bquestions\b/i.test(subject)
 471  }
 472  
 473  /**
 474   * The text under the FIRST questions heading, down to the next heading at the
 475   * same level or shallower — so `###` subsections inside it are included and the
 476   * next `##` ends it. NULL when the brief has no such heading.
 477   */
 478  function questionsSectionOf(briefText: string): string | null {
 479    const lines = briefText.split('\n')
 480    let start = -1
 481    let level = 0
 482    for (let i = 0; i < lines.length; i++) {
 483      const heading = HEADING.exec(lines[i])
 484      if (!heading || !isQuestionsHeading(heading[2])) continue
 485      start = i + 1
 486      level = heading[1].length
 487      break
 488    }
 489    if (start === -1) return null
 490  
 491    let end = lines.length
 492    for (let i = start; i < lines.length; i++) {
 493      const heading = HEADING.exec(lines[i])
 494      if (heading && heading[1].length <= level) {
 495        end = i
 496        break
 497      }
 498    }
 499    return lines.slice(start, end).join('\n')
 500  }
 501  
 502  /* ------------------------------------------------------------------ */
 503  /* 5. The protocol — CR-3b.1 / D67                                     */
 504  /*                                                                     */
 505  /* Ruled by council 2026-07-26 and implemented AS CORRECTED. The six   */
 506  /* coordinator corrections are in D67; the two load-bearing ones are   */
 507  /* marked at their sites below.                                        */
 508  /*                                                                     */
 509  /*   positions (round 0) — every member, blind, concurrently           */
 510  /*   critique  (round 1) — every survivor, seeing the others           */
 511  /*                         ANONYMISED                                  */
 512  /*   arbitration (round 2) — the arbiter, attributed, with the         */
 513  /*                         core-computed disagreement vector           */
 514  /*   synthesis (round 3) — the arbiter, with the core's dissent list   */
 515  /*   done                                                              */
 516  /* ------------------------------------------------------------------ */
 517  
 518  export type Verdict = 'AGREE' | 'DISAGREE' | 'QUALIFY'
 519  const VERDICTS: readonly Verdict[] = ['AGREE', 'DISAGREE', 'QUALIFY']
 520  
 521  /** How a question's disagreement was established. ⚠ CARRIED INTO THE OUTPUT,
 522   *  per D67 Q3: a computed disagreement and a model's impression of one are
 523   *  different facts and must not be rendered as the same one. */
 524  export type DetectionPath = 'structural' | 'model-judged'
 525  
 526  export interface QuestionDisagreement {
 527    readonly index: number
 528    readonly question: string
 529    readonly path: DetectionPath
 530    /** True only when the path is `structural` AND the verdicts actually differ.
 531     *  A `model-judged` question carries `false` here — the core did not detect
 532     *  it, and saying otherwise would be claiming a measurement it does not have. */
 533    readonly disagrees: boolean
 534    /** memberId → verdict, for members that answered parseably. */
 535    readonly verdicts: ReadonlyMap<string, Verdict>
 536    /** memberIds whose answer carried no parseable verdict for this question. */
 537    readonly nonCompliant: readonly string[]
 538  }
 539  
 540  /**
 541   * Pull one verdict token per question out of a member's position.
 542   *
 543   * ⚠ A MISSING TOKEN IS A QUESTION-LEVEL REFUSAL, NOT A GLOBAL ONE (D67 Q3).
 544   * The member's prose is still preserved and still reaches the arbiter; only the
 545   * structural signal for that one question is unavailable. Killing a whole
 546   * member's contribution because a cheap model dropped a token on question 4
 547   * would discard exactly the diversity the council exists for.
 548   *
 549   * The expected shape is `Q<n>: <VERDICT>` on its own line, which is what
 550   * `buildPositionsPrompt` asks for.
 551   */
 552  export function parseVerdicts(content: string): ReadonlyMap<number, Verdict> {
 553    const out = new Map<number, Verdict>()
 554    for (const rawLine of content.split('\n')) {
 555      const line = rawLine.trim().replace(/^[>\-*+\s]+/, '').replace(/\*\*/g, '')
 556      const match = /^Q(\d{1,2})\s*[:.\-]\s*([A-Za-z]+)/.exec(line)
 557      if (!match) continue
 558      const index = Number(match[1]) - 1
 559      const token = match[2].toUpperCase()
 560      if (index < 0) continue
 561      const verdict = VERDICTS.find((v) => v === token)
 562      // ⚠ FIRST TOKEN WINS. A member that restates its verdict later (in a summary
 563      // section, say) must not be able to silently overwrite the answer the
 564      // disagreement vector was computed from.
 565      if (verdict && !out.has(index)) out.set(index, verdict)
 566    }
 567    return out
 568  }
 569  
 570  /**
 571   * The disagreement vector — a COMPUTED fact wherever it can be, and honestly
 572   * labelled where it cannot.
 573   *
 574   * A question is `structural` when at least two members produced a parseable
 575   * verdict for it; `disagrees` is then simply "those verdicts are not all the
 576   * same". Fewer than two parseable verdicts leaves nothing to diff, so the
 577   * question falls to `model-judged`: the arbiter is given the prose and the
 578   * output says the detection was weaker there (D67 Q3, hybrid 3C).
 579   */
 580  export function computeDisagreement(input: {
 581    readonly questions: readonly string[]
 582    readonly positions: readonly { readonly memberId: string; readonly content: string }[]
 583  }): readonly QuestionDisagreement[] {
 584    const parsed = input.positions.map((p) => ({ memberId: p.memberId, verdicts: parseVerdicts(p.content) }))
 585    return input.questions.map((question, index) => {
 586      const verdicts = new Map<string, Verdict>()
 587      const nonCompliant: string[] = []
 588      for (const p of parsed) {
 589        const verdict = p.verdicts.get(index)
 590        if (verdict === undefined) nonCompliant.push(p.memberId)
 591        else verdicts.set(p.memberId, verdict)
 592      }
 593      if (verdicts.size < 2) {
 594        return { index, question, path: 'model-judged', disagrees: false, verdicts, nonCompliant }
 595      }
 596      const distinct = new Set(verdicts.values())
 597      return { index, question, path: 'structural', disagrees: distinct.size > 1, verdicts, nonCompliant }
 598    })
 599  }
 600  
 601  /** One preserved disagreement. ⚠ `path` IS THE COUNCIL'S OWN CONTRIBUTION
 602   *  (D67 Q5): a reader must be able to weigh a computed disagreement differently
 603   *  from a section parsed out of critique prose. */
 604  export interface DissentEntry {
 605    readonly path: 'structural' | 'critique'
 606    readonly source: string
 607    readonly memberIds: readonly string[]
 608    readonly text: string
 609  }
 610  
 611  /**
 612   * Pull the labelled objection sections out of one critique.
 613   *
 614   * ⚠ NOT NLP, NOT A MODEL, NOT EMBEDDINGS — a string matcher keyed on the format
 615   * `buildCritiquePrompts` asks for. A member that ignores the format yields
 616   * nothing here, and that is a KNOWN limitation rather than a hidden one (D67,
 617   * risk R3): structural dissents are always captured because they are computed;
 618   * critique dissents depend on format compliance, which is a prompt instruction
 619   * and never a code guarantee.
 620   */
 621  export function parseCritiqueSections(content: string): readonly string[] {
 622    const sections: string[] = []
 623    let current: string[] | null = null
 624    const close = (): void => {
 625      if (current === null) return
 626      const body = current.join(' ').trim()
 627      // ⚠ THE ONLY THING THIS DROPS IS A LABEL THAT SAID THERE WAS NOTHING TO
 628      // SAY. See `statesNoObjection` — closed list, whole body, keeps on doubt.
 629      if (body !== '' && !statesNoObjection(body)) sections.push(body)
 630    }
 631    for (const rawLine of content.split('\n')) {
 632      const line = rawLine.trim().replace(/^[>\-*+\s]+/, '').replace(/\*\*/g, '')
 633      const header = /^(DISAGREE|OBJECTION|MISSED)\s*:?\s*(.*)$/i.exec(line)
 634      if (header) {
 635        close()
 636        current = header[2].trim() === '' ? [] : [header[2].trim()]
 637        continue
 638      }
 639      // Any other labelled header ends the section — an objection must not absorb
 640      // the agreement paragraph that follows it.
 641      if (/^(AGREE|CHANGED|POSITION|SUMMARY)\s*:?/i.test(line)) {
 642        close()
 643        current = null
 644        continue
 645      }
 646      if (current !== null && line !== '') current.push(line)
 647    }
 648    close()
 649    return sections
 650  }
 651  
 652  /**
 653   * A `DISAGREE:` label whose body says there is nothing to disagree with.
 654   *
 655   * ⚠ THE FAILURE MODE OF THIS FUNCTION IS WORSE THAN THE NOISE IT REMOVES, SO
 656   * IT IS BUILT TO FAIL TOWARD KEEPING (ImplementationSpec-3e-2 §2). Dissent
 657   * preservation is the one property this feature exists to guarantee; a matcher
 658   * tuned to be quiet would trade it for tidiness. Precision may improve here,
 659   * recall may not be spent on it.
 660   *
 661   * Two properties make that safe, and both are asserted by tests:
 662   *
 663   *  1. **A CLOSED LIST.** Not a heuristic, not a length threshold, not a
 664   *     sentiment guess — an enumeration of the forms that mean "nothing".
 665   *  2. **MATCHED AGAINST THE WHOLE BODY.** `DISAGREE: None` is dropped;
 666   *     `DISAGREE: None of the three addressed back-pressure` is KEPT, because
 667   *     the body is not the sentinel — it merely starts with it. When this
 668   *     function cannot tell, the answer is `false` and the dissent survives.
 669   *
 670   * Measured on the dogfood run: two of nine "dissents" challenged nothing. This
 671   * catches the mechanically certain ones and deliberately leaves the rest — a
 672   * body reading "nothing substantive" stays in the record, because deciding that
 673   * one needs to read prose, and reading prose is what the arbiter is for.
 674   */
 675  export function statesNoObjection(section: string): boolean {
 676    const body = section
 677      .trim()
 678      .toLowerCase()
 679      .replace(/^[\s"'`([]+/, '')
 680      .replace(/[\s"'`)\].!;:,—–-]+$/, '')
 681      .trim()
 682    return NON_OBJECTION_BODIES.has(body)
 683  }
 684  
 685  /** ⚠ ADD TO THIS LIST ONLY WITH A REAL TRANSCRIPT IN HAND. Every entry is a
 686   *  form that cannot mean anything but "no objection" ON ITS OWN — which is why
 687   *  `statesNoObjection` matches the entire body against it and not a prefix. */
 688  const NON_OBJECTION_BODIES: ReadonlySet<string> = new Set([
 689    'none',
 690    'no',
 691    'n/a',
 692    'na',
 693    'nil',
 694    'nothing',
 695    'none at all',
 696    'no objection',
 697    'no objections',
 698    'no disagreement',
 699    'no disagreements',
 700    'no concerns',
 701    'nothing to add',
 702    'nothing further',
 703    'i agree',
 704    'agreed'
 705  ])
 706  
 707  /**
 708   * ⚠ THE FEATURE'S WHOLE VALUE LIVES IN THIS FUNCTION (D67 Q5, ruling 5C).
 709   *
 710   * The dissent list is built BY THE CORE, from the transcript, before the arbiter
 711   * is ever asked to synthesize. The arbiter may add narrative to any entry; it
 712   * cannot remove one, because removal is not a thing it is able to do — the list
 713   * is assembled here and appended by `assembleFindingsDocument` regardless of
 714   * what the arbiter returns.
 715   *
 716   * That is what makes "dissents preserved" a fact about the code rather than a
 717   * promise about a prompt. 5A (ask the arbiter nicely) is unenforceable; 5B
 718   * (require a `dissents` array and re-ask when it is empty) is satisfiable by a
 719   * sycophantic arbiter returning a compliant-looking empty array on the second
 720   * try. Only 5C survives a badly-behaved arbiter.
 721   */
 722  export function extractDissentEntries(input: {
 723    readonly disagreement: readonly QuestionDisagreement[]
 724    readonly transcript: readonly CouncilTranscriptEntry[]
 725    readonly labelFor: (memberId: string) => string
 726  }): readonly DissentEntry[] {
 727    const entries: DissentEntry[] = []
 728  
 729    for (const question of input.disagreement) {
 730      if (!question.disagrees) continue
 731      const byVerdict = new Map<Verdict, string[]>()
 732      for (const [memberId, verdict] of question.verdicts) {
 733        const bucket = byVerdict.get(verdict) ?? []
 734        bucket.push(memberId)
 735        byVerdict.set(verdict, bucket)
 736      }
 737      const breakdown = [...byVerdict.entries()]
 738        .map(([verdict, ids]) => `${verdict}: ${ids.map(input.labelFor).join(', ')}`)
 739        .join(' · ')
 740      entries.push({
 741        path: 'structural',
 742        source: `Q${question.index + 1}`,
 743        memberIds: [...question.verdicts.keys()],
 744        text: `${question.question} — ${breakdown}`
 745      })
 746    }
 747  
 748    for (const entry of input.transcript) {
 749      if (entry.phase !== 'critique' || entry.outcome !== 'answered' || entry.memberId === null) continue
 750      for (const section of parseCritiqueSections(entry.content)) {
 751        entries.push({
 752          path: 'critique',
 753          // `R1`, not `Critique R1`: the renderer already prefixes the provenance
 754          // path, and the first live run rendered "[Critique — Critique R1]".
 755          source: `R${entry.round}`,
 756          memberIds: [entry.memberId],
 757          text: `${input.labelFor(entry.memberId)}: ${section}`
 758        })
 759      }
 760    }
 761  
 762    return entries
 763  }
 764  
 765  /** The body of the core's dissent section — provenance-labelled per D67 Q5, and
 766   *  the one place a dissent line is formatted. */
 767  function renderDissentLines(entries: readonly DissentEntry[]): string {
 768    if (entries.length === 0) {
 769      return '_None — the council was observed to agree on every enumerated question, and no objection was raised in the critique round._'
 770    }
 771    return entries
 772      .map((e) => `- [${e.path === 'structural' ? 'Structural' : 'Critique'} — ${e.source}] ${e.text}`)
 773      .join('\n')
 774  }
 775  
 776  /**
 777   * The section as the SYNTHESIS PROMPT carries it — byte-identical to what 3b-*
 778   * shipped, deliberately.
 779   *
 780   * ⚠ THE ARBITER'S INPUT IS PROTOCOL AND THE PROTOCOL IS CLOSED (D67). F40's fix
 781   * is allowed to reach a heading in the DOCUMENT or the prompt's instruction
 782   * about one; it is not a licence to start editing what the arbiter is shown, so
 783   * this call site is left exactly as it was and `git diff` says so.
 784   */
 785  function renderDissentsForPrompt(entries: readonly DissentEntry[]): string {
 786    return `## Dissents preserved\n\n${renderDissentLines(entries)}`
 787  }
 788  
 789  /**
 790   * Whether the arbiter's synthesis already opened a section of its own by this
 791   * name.
 792   *
 793   * ⚠ ANCHORED TO A HEADING, AND THAT ANCHOR IS THE ENTIRE CARE IN THIS FUNCTION
 794   * (ImplementationSpec-3e-2 §1a). A member quoting the phrase in prose — "the
 795   * dissents preserved section shows…" — is not a heading. Matching that would
 796   * demote the document's ONLY copy of the section to a subsection of nothing,
 797   * turning F40's cosmetic defect into a real one.
 798   *
 799   * `^##` with whitespace after it, so `###` and deeper do not match; trailing
 800   * text on the heading line does, because `## Dissents preserved (and why)` is
 801   * still the arbiter opening that section. Case-insensitive: two sections about
 802   * the same thing are the defect, not two identical strings.
 803   */
 804  export function synthesisCarriesDissentHeading(synthesisText: string): boolean {
 805    return /^##[ \t]+dissents preserved\b/im.test(synthesisText)
 806  }
 807  
 808  /**
 809   * The section as the DOCUMENT carries it — F40, and the two changes 3e-2 makes.
 810   *
 811   * ⚠ WHAT DID **NOT** CHANGE: this section is still appended UNCONDITIONALLY by
 812   * `assembleFindingsDocument`, from the transcript, whatever the arbiter wrote.
 813   * That is D67 Q5 ruling 5C and it is the whole enforceability argument —
 814   * removing it hands dissent preservation back to the arbiter's goodwill, which
 815   * is ruling 5A and was explicitly rejected. **Only the rendering adapts.**
 816   *
 817   * 1. **F40 — one heading by that name, never two.** The arbiter writes its own
 818   *    `## Dissents preserved` (the prompt shows it one, so it imitates it), and
 819   *    the core then appended a second peer heading. When the synthesis already
 820   *    carries one, the core's becomes a SUBSECTION that says whose record it is.
 821   *    Nothing is suppressed: the same lines, one level down, plus a sentence
 822   *    explaining the relationship.
 823   *
 824   * 2. **Per-member attribution, ABOVE the list rather than below it** (spec §2's
 825   *    safest available fix). The dogfood run produced nine dissents of which one
 826   *    talkative member wrote six, and a flat list of nine reads as breadth of
 827   *    disagreement when it is depth from one member. This drops nothing — it
 828   *    counts what is there, which is the opposite of tuning a matcher quiet.
 829   */
 830  function renderDissentsForDocument(input: {
 831    readonly entries: readonly DissentEntry[]
 832    readonly labelFor: (memberId: string) => string
 833    readonly synthesisCarriesHeading: boolean
 834  }): string {
 835    const heading = input.synthesisCarriesHeading
 836      ? `### Dissents preserved — the orchestrator's record\n\n` +
 837        `_The synthesis above opened its own \`## Dissents preserved\`. This is the orchestrator's, ` +
 838        `generated from the transcript and appended whatever the arbiter chose to write — the same ` +
 839        `guarantee, rendered one level down so the document has one heading by that name instead of ` +
 840        `two (F40)._`
 841      : '## Dissents preserved'
 842    const attribution = renderDissentAttribution(input.entries, input.labelFor)
 843    return `${heading}\n\n${attribution}${renderDissentLines(input.entries)}`
 844  }
 845  
 846  /** ⚠ D55 ONE LAYER DOWN: a count of dissents without the per-member split is a
 847   *  number without its denominator. Empty when there is nothing to attribute. */
 848  function renderDissentAttribution(
 849    entries: readonly DissentEntry[],
 850    labelFor: (memberId: string) => string
 851  ): string {
 852    if (entries.length === 0) return ''
 853    const structural = entries.filter((e) => e.path === 'structural').length
 854    const critique = entries.filter((e) => e.path === 'critique')
 855    const byMember = new Map<string, number>()
 856    for (const e of critique) {
 857      const id = e.memberIds[0]
 858      if (id === undefined) continue
 859      byMember.set(id, (byMember.get(id) ?? 0) + 1)
 860    }
 861    const split = [...byMember.entries()]
 862      .sort((a, b) => b[1] - a[1] || labelFor(a[0]).localeCompare(labelFor(b[0])))
 863      .map(([id, n]) => `${labelFor(id)} ${n}`)
 864      .join(' · ')
 865    const shape =
 866      critique.length === 0
 867        ? ''
 868        : `, from ${byMember.size} member${byMember.size === 1 ? '' : 's'} — ${split}`
 869    return (
 870      `_${entries.length} preserved: ${structural} structural ` +
 871      `(computed from the members' own verdict tokens) · ${critique.length} from critique prose` +
 872      `${shape}._\n\n` +
 873      `_⚠ Read the per-member split before reading breadth into the total: several objections from ` +
 874      `one member is one member disagreeing repeatedly, not several members disagreeing. Nothing is ` +
 875      `dropped to make the total smaller._\n\n`
 876    )
 877  }
 878  
 879  /**
 880   * Whether the arbiter's own synthesis mentions each structural dissent.
 881   *
 882   * ⚠ AN OBSERVATION, NOT A GATE — AND THIS IS D67 CORRECTION (b), THE ONE THAT
 883   * MATTERS MOST.
 884   *
 885   * CR-3b.1's pseudocode ABORTED the run when this returned false. That would
 886   * discard a completed, fully-paid-for deliberation — every member answered,
 887   * every critique landed, the arbiter ruled — on the strength of a string check
 888   * the findings' own risk R7 admits is fragile in exactly the false-negative
 889   * direction that would trigger it. And it is redundant: the same findings'
 890   * code-enforces item 9 says the core appends its dissent section
 891   * unconditionally, which it does. If the guarantee already holds, the abort
 892   * protects nothing and costs everything.
 893   *
 894   * So the result is RECORDED instead. An arbiter that elided a dissent is itself
 895   * a finding about that arbiter, and it is surfaced in the document rather than
 896   * being converted into a lost run.
 897   */
 898  export function dissentsElided(synthesisText: string, entries: readonly DissentEntry[]): readonly string[] {
 899    const haystack = synthesisText.toLowerCase()
 900    return entries
 901      .filter((e) => e.path === 'structural')
 902      .filter((e) => !haystack.includes(e.source.toLowerCase()))
 903      .map((e) => e.source)
 904  }
 905  
 906  /* ------------------------------------------------------------------ */
 907  /* 6. Prompts — built HERE, never in the service (a prompt IS the      */
 908  /*    protocol)                                                        */
 909  /* ------------------------------------------------------------------ */
 910  
 911  function buildPositionsPrompt(briefText: string, questions: readonly string[]): string {
 912    const list = questions.map((q, i) => `Q${i + 1}. ${q}`).join('\n')
 913    return (
 914      `${briefText}\n\n---\n\n` +
 915      `You are one member of an independent review council. You are answering BLIND: ` +
 916      `you cannot see the other members' answers, and they cannot see yours.\n\n` +
 917      `Answer each question below. For EACH one, begin a line with the question number ` +
 918      `and one verdict token, exactly in this form:\n\n` +
 919      `Q1: AGREE\nQ2: DISAGREE\nQ3: QUALIFY\n\n` +
 920      `Use AGREE if you support the proposal in the question, DISAGREE if you oppose it, ` +
 921      `and QUALIFY if you support it only under a condition you must then state. ` +
 922      `After each verdict line, give your reasoning in prose.\n\n` +
 923      `The questions:\n${list}\n\n` +
 924      `If you believe the questions miss something important, add a final section headed ` +
 925      `"UNPROMPTED OBSERVATION" and say what.`
 926    )
 927  }
 928  
 929  /**
 930   * ⚠ ANONYMISED (D67 Q1, ruling 1B). The other members' positions arrive as
 931   * "Position A / B / C" with no label and no model id. The core keeps the mapping
 932   * — the transcript records `memberId` on every row — so the findings still
 933   * attribute everything. Only the PROMPT is anonymous.
 934   *
 935   * What that buys: it removes the passive form of deference, where a member sees
 936   * a name it recognises as authoritative and softens. It does not, and does not
 937   * claim to, stop a model that actively tries to identify its peers from style.
 938   */
 939  function buildCritiquePrompt(
 940    self: string,
 941    positions: readonly { readonly memberId: string; readonly content: string }[]
 942  ): string {
 943    const others = positions.filter((p) => p.memberId !== self)
 944    const rendered = others
 945      .map((p, i) => `### Position ${String.fromCharCode(65 + i)}\n\n${p.content}`)
 946      .join('\n\n')
 947    return (
 948      `You are one member of an independent review council. Below are the other members' ` +
 949      `positions on the same brief, with their identities removed. Judge them on their content.\n\n` +
 950      `${rendered}\n\n---\n\n` +
 951      `For EACH position, respond using these exact section labels, one per line:\n\n` +
 952      `AGREE: <what you agree with>\n` +
 953      `DISAGREE: <what you disagree with, and why>\n` +
 954      `MISSED: <anything the position did not consider>\n\n` +
 955      `Then finish with:\n\nCHANGED: <has your own position changed, and why or why not>\n\n` +
 956      `⚠ Use the DISAGREE and MISSED labels literally. An objection written without its ` +
 957      `label may not reach the findings document.`
 958    )
 959  }
 960  
 961  function renderDisagreementVector(disagreement: readonly QuestionDisagreement[], labelFor: (id: string) => string): string {
 962    return disagreement
 963      .map((q) => {
 964        if (q.path === 'model-judged') {
 965          return `Q${q.index + 1}: NOT MEASURED (too few members answered in the required form) — judge it from the prose.`
 966        }
 967        const votes = [...q.verdicts.entries()].map(([id, v]) => `${labelFor(id)}=${v}`).join(', ')
 968        return `Q${q.index + 1}: ${q.disagrees ? 'MEMBERS DISAGREE' : 'members agree'} — ${votes}`
 969      })
 970      .join('\n')
 971  }
 972  
 973  function buildArbitrationPrompt(state: CouncilState, disagreement: readonly QuestionDisagreement[]): string {
 974    const labelFor = makeLabelFor(state.run)
 975    const positions = state.transcript
 976      .filter((e) => e.phase === 'positions' && e.outcome === 'answered' && e.memberId !== null)
 977      .map((e) => `### ${labelFor(e.memberId as string)} — position\n\n${e.content}`)
 978      .join('\n\n')
 979    const critiques = state.transcript
 980      .filter((e) => e.phase === 'critique' && e.outcome === 'answered' && e.memberId !== null)
 981      .map((e) => `### ${labelFor(e.memberId as string)} — critique\n\n${e.content}`)
 982      .join('\n\n')
 983    const anyDisagreement = disagreement.some((q) => q.disagrees)
 984  
 985    return (
 986      `${state.run.briefText}\n\n---\n\n` +
 987      `You are the ARBITER of this review council. Unlike the members, you see who said what.\n\n` +
 988      `## The members' positions\n\n${positions}\n\n` +
 989      `## The members' critiques of each other\n\n${critiques}\n\n` +
 990      `## What the orchestrator MEASURED (not an opinion — a count of their verdict tokens)\n\n` +
 991      `${renderDisagreementVector(disagreement, labelFor)}\n\n---\n\n` +
 992      `Rule on each question in turn, with your reasoning.\n\n` +
 993      (anyDisagreement
 994        ? `Where the members disagreed, say which position is better supported and why — and if the ` +
 995          `minority position is right, say so plainly.`
 996        : // D67 Q4, ruling 4A: the arbiter runs even on unanimity, and THIS is the
 997          // job it does there. The project's own CR-3b.0 was 3-of-3 unanimous on
 998          // four of five questions and still shipped four compile errors.
 999          `⚠ The members AGREED on every measured question. That is not the same as being right. ` +
1000          `They all read the same brief, so they share its blind spots. Say whether this agreement ` +
1001          `is warranted, and what the council collectively missed.`)
1002    )
1003  }
1004  
1005  function buildSynthesisPrompt(state: CouncilState, dissents: readonly DissentEntry[]): string {
1006    const labelFor = makeLabelFor(state.run)
1007    const ruling = state.transcript.find((e) => e.phase === 'arbitration' && e.outcome === 'answered')
1008    const positions = state.transcript
1009      .filter((e) => e.phase === 'positions' && e.outcome === 'answered' && e.memberId !== null)
1010      .map((e) => `### ${labelFor(e.memberId as string)}\n\n${e.content}`)
1011      .join('\n\n')
1012  
1013    return (
1014      `You are the ARBITER of this review council, writing its findings.\n\n` +
1015      `## The brief\n\n${state.run.briefText}\n\n` +
1016      `## The members' positions\n\n${positions}\n\n` +
1017      `## Your own ruling\n\n${ruling?.content ?? '(none)'}\n\n` +
1018      `## Disagreements the orchestrator recorded\n\n${renderDissentsForPrompt(dissents)}\n\n---\n\n` +
1019      `Write the findings document. Include per-member positions, a synthesis with your ruling ` +
1020      `per question, risks with mitigations, and action items that are each checkable.\n\n` +
1021      `⚠ You MAY add narrative context to any disagreement above — say whether you think it is ` +
1022      `well-founded. You MUST NOT drop one. Refer to each by its source tag (Q1, Q2, …) so a ` +
1023      `reader can match your commentary to the record.`
1024    )
1025  }
1026  
1027  function makeLabelFor(run: PlannedRun): (memberId: string) => string {
1028    const labels = new Map<string, string>()
1029    for (const member of [...run.members, run.arbiter]) labels.set(member.memberId, member.label)
1030    return (memberId) => labels.get(memberId) ?? memberId
1031  }
1032  
1033  /* ------------------------------------------------------------------ */
1034  /* 7. The findings document                                            */
1035  /* ------------------------------------------------------------------ */
1036  
1037  /**
1038   * ⚠ THE CORE'S DISSENT SECTION IS APPENDED UNCONDITIONALLY (D67 Q5 / code-
1039   * enforces item 9). Not "when the arbiter forgot" — always. A reader sees the
1040   * arbiter's narrative AND the raw record, and the guarantee does not depend on
1041   * any check having been right.
1042   *
1043   * ⚠ F40 (3e-2) CHANGED HOW THAT SECTION IS RENDERED AND NOT WHETHER IT IS.
1044   * `renderDissentsForDocument` demotes its heading to a subsection when the
1045   * arbiter already wrote one by the same name, so the document carries one
1046   * `## Dissents preserved` rather than two. The append itself is untouched — the
1047   * condition governs a heading level, never the presence of the lines.
1048   *
1049   * ⚠ AND A PARTIAL RUN SAYS SO IN ITS OWN FIRST LINE (D67 Q6). A council that
1050   * ran with two of three members must not read as a two-member council that
1051   * agreed.
1052   */
1053  export function assembleFindingsDocument(input: {
1054    readonly synthesis: string
1055    readonly dissents: readonly DissentEntry[]
1056    readonly disagreement: readonly QuestionDisagreement[]
1057    readonly run: PlannedRun
1058    readonly transcript: readonly CouncilTranscriptEntry[]
1059    readonly elided: readonly string[]
1060    /** ⚠ PARAMETERS, NOT AMBIENT FACTS. This module has no clock and no uuid
1061     *  source, and growing one to write a header would trade the property that
1062     *  makes every branch here testable for two lines of convenience. */
1063    readonly runId: string
1064    readonly startedAt: string
1065  }): string {
1066    const labelFor = makeLabelFor(input.run)
1067    const refusals = input.transcript.filter((e) => e.outcome === 'refused')
1068    const planned = input.run.members.length
1069    const answeredIds = new Set(
1070      input.transcript
1071        .filter((e) => e.phase === 'positions' && e.outcome === 'answered' && e.memberId !== null)
1072        .map((e) => e.memberId as string)
1073    )
1074  
1075    const header =
1076      answeredIds.size < planned
1077        ? `> ⚠ **PARTIAL RUN — ${answeredIds.size} of ${planned} members completed.**\n>\n` +
1078          refusals
1079            .map(
1080              (r) =>
1081                `> - ${r.memberId === null ? 'the orchestrator' : labelFor(r.memberId)} refused at **${r.phase}** (round ${r.round}): ${r.content}`
1082            )
1083            .join('\n') +
1084          `\n>\n> These findings are the output of a council that did not fully convene. Read them as such.`
1085        : `> Council of ${planned} members plus an arbiter. All members completed.`
1086  
1087    const measurement = input.disagreement
1088      .map(
1089        (q) =>
1090          `- **Q${q.index + 1}** — detection: \`${q.path}\`${q.path === 'structural' ? ` · ${q.disagrees ? 'members disagreed' : 'members agreed'}` : ' · not measured'}` +
1091          (q.nonCompliant.length > 0
1092            ? ` · no verdict token from: ${q.nonCompliant.map(labelFor).join(', ')}`
1093            : '')
1094      )
1095      .join('\n')
1096  
1097    const elidedNote =
1098      input.elided.length === 0
1099        ? ''
1100        : `\n\n> ⚠ **The arbiter's synthesis did not refer to ${input.elided.join(', ')}.** ` +
1101          `The disagreement is preserved below regardless — the section is generated from the ` +
1102          `transcript, not by the arbiter. That the arbiter passed over it is recorded because it ` +
1103          `is itself worth knowing.`
1104  
1105    return (
1106      `${header}\n\n${STANDING_CAVEAT}\n\n${input.synthesis}\n\n---\n\n` +
1107      `## How disagreement was detected\n\n${measurement}\n\n` +
1108      `_\`structural\` means the orchestrator compared the members' own verdict tokens and counted ` +
1109      `the difference. \`model-judged\` means too few members answered in the required form, so the ` +
1110      `arbiter judged it from prose — a weaker signal, labelled rather than hidden._${elidedNote}\n\n` +
1111      `${renderDissentsForDocument({
1112        entries: input.dissents,
1113        labelFor,
1114        synthesisCarriesHeading: synthesisCarriesDissentHeading(input.synthesis)
1115      })}\n\n` +
1116      `${renderProvenance(input)}\n`
1117    )
1118  }
1119  
1120  /**
1121   * ⚠ MANDATORY, AND `ImplementationSpec-3b-4.md` §3.2 SAYS WHY IN ONE SENTENCE:
1122   * *"The file must say so, or a later reader will cite it as verification."*
1123   *
1124   * The evidence is this project's own and it is not hypothetical. CR-3b.0 was
1125   * 3-of-3 unanimous on four of five questions, its rulings were sound, and the
1126   * verbatim TypeScript it shipped had four compile errors — because it had the
1127   * brief and not the repo. A findings file is the output of models reading a
1128   * document; nothing in this pipeline compiles, runs or tests anything it says.
1129   *
1130   * It sits directly under the run header, ABOVE the synthesis, because a caveat
1131   * a reader reaches after the conclusions is a caveat that arrives too late.
1132   */
1133  const STANDING_CAVEAT =
1134    '> ⚠ **These findings are model deliberation, not verified fact.** Every claim below was ' +
1135    'produced by language models reading the brief. Nothing here was compiled, executed or tested, ' +
1136    'and no model in this council could see the repository. This project’s own CR-3b.0 was ' +
1137    'unanimous, its rulings were sound, and the code it shipped had four compile errors. Verify ' +
1138    'anything you are about to rely on.'
1139  
1140  /**
1141   * ⚠ D68(2) / spec §3.1: *"A findings file whose authorship cannot be
1142   * reconstructed is not usable as a record."*
1143   *
1144   * Every participant is listed WITH ITS MODEL and with what it actually did —
1145   * including the ones that refused, because a council of four that answered with
1146   * three is a different document from a council of three, and the roster is the
1147   * only place that distinction survives once the prose is written.
1148   */
1149  function renderProvenance(input: {
1150    readonly run: PlannedRun
1151    readonly transcript: readonly CouncilTranscriptEntry[]
1152    readonly runId: string
1153    readonly startedAt: string
1154  }): string {
1155    const outcomeOf = (memberId: string): string => {
1156      const turns = input.transcript.filter((e) => e.memberId === memberId)
1157      if (turns.length === 0) return 'never asked'
1158      const answered = turns.filter((t) => t.outcome === 'answered').length
1159      const refused = turns.filter((t) => t.outcome === 'refused').length
1160      if (refused === 0) return `answered ${answered} turn${answered === 1 ? '' : 's'}`
1161      if (answered === 0) return `refused ${refused} turn${refused === 1 ? '' : 's'}`
1162      return `answered ${answered}, refused ${refused}`
1163    }
1164    const row = (m: PlannedMember, role: string): string =>
1165      `| ${m.label} | ${role} | \`${m.model}\` | ${outcomeOf(m.memberId)} |`
1166  
1167    return (
1168      `## Provenance\n\n` +
1169      `- **Run id:** \`${input.runId}\`\n` +
1170      `- **Started:** ${input.startedAt}\n\n` +
1171      `| Member | Role | Model | Turns |\n|---|---|---|---|\n` +
1172      `${[...input.run.members.map((m) => row(m, 'member')), row(input.run.arbiter, 'arbiter')].join('\n')}\n`
1173    )
1174  }
1175  
1176  /* ------------------------------------------------------------------ */
1177  /* 8. nextAction — the state machine                                   */
1178  /* ------------------------------------------------------------------ */
1179  
1180  const PHASE_ROUND: Record<Exclude<CouncilPhase, 'done'>, number> = {
1181    positions: 0,
1182    critique: 1,
1183    arbitration: 2,
1184    synthesis: 3
1185  }
1186  
1187  function answeredIn(state: CouncilState, phase: CouncilPhase): readonly { memberId: string; content: string }[] {
1188    return state.transcript
1189      .filter((e) => e.phase === phase && e.outcome === 'answered' && e.memberId !== null)
1190      .map((e) => ({ memberId: e.memberId as string, content: e.content }))
1191  }
1192  
1193  function hasTurn(state: CouncilState, phase: CouncilPhase): boolean {
1194    return state.transcript.some((e) => e.phase === phase)
1195  }
1196  
1197  /**
1198   * ⚠ PURE, AND HOLDING NO STATE BETWEEN CALLS — which is D67 correction (c).
1199   * CR-3b.1's pseudocode computed the disagreement vector during the positions →
1200   * critique transition and then referenced it two branches later. Nothing carries
1201   * across a call to this function; the transcript is the only memory, so the
1202   * vector is RECOMPUTED from it every time. That is cheap, and it is the property
1203   * that makes every branch below testable by handing it a state object.
1204   */
1205  export function nextAction(state: CouncilState): readonly CouncilAction[] {
1206    if (state.cancelled) {
1207      return [{ kind: 'abort', reason: 'The run was cancelled.' }]
1208    }
1209  
1210    const questions = parseBriefQuestions(state.run.briefText)
1211    const positions = answeredIn(state, 'positions')
1212  
1213    // ── Phase: positions. One batch, every member, blind. ────────────────────
1214    if (!hasTurn(state, 'positions')) {
1215      return state.run.members.map((member) => ({
1216        kind: 'ask' as const,
1217        memberId: member.memberId,
1218        phase: 'positions' as const,
1219        round: PHASE_ROUND.positions,
1220        prompt: buildPositionsPrompt(state.run.briefText, questions)
1221      }))
1222    }
1223  
1224    // ⚠ THE REFUSAL FLOOR, ENFORCED BY THE CODE AND NOT BY A PROMPT (D67 Q6).
1225    // Checked at every phase boundary, and it is the SAME floor assembly applies
1226    // before the run starts: one member plus an arbiter is a review, not a
1227    // council, and disagreement detection with one data point is meaningless.
1228    if (positions.length < 2) {
1229      return [
1230        {
1231          kind: 'abort',
1232          reason: `Only ${positions.length} of ${state.run.members.length} members answered; a council needs at least two.`
1233        }
1234      ]
1235    }
1236  
1237    const disagreement = computeDisagreement({ questions, positions })
1238  
1239    // ── Phase: critique. Every survivor, seeing the others ANONYMISED. ───────
1240    if (!hasTurn(state, 'critique')) {
1241      return positions.map((p) => ({
1242        kind: 'ask' as const,
1243        memberId: p.memberId,
1244        phase: 'critique' as const,
1245        round: PHASE_ROUND.critique,
1246        prompt: buildCritiquePrompt(p.memberId, positions)
1247      }))
1248    }
1249  
1250    const labelFor = makeLabelFor(state.run)
1251    const dissents = extractDissentEntries({ disagreement, transcript: state.transcript, labelFor })
1252  
1253    // ── Phase: arbitration. The arbiter, alone, attributed. ──────────────────
1254    if (!hasTurn(state, 'arbitration')) {
1255      return [
1256        {
1257          kind: 'ask',
1258          memberId: state.run.arbiter.memberId,
1259          phase: 'arbitration',
1260          round: PHASE_ROUND.arbitration,
1261          prompt: buildArbitrationPrompt(state, disagreement)
1262        }
1263      ]
1264    }
1265    if (answeredIn(state, 'arbitration').length === 0) {
1266      // ⚠ NO FALLBACK ARBITER (D67 Q6). The user configured exactly one, and
1267      // promoting a member into the role would silently change what the run was.
1268      return [{ kind: 'abort', reason: 'The arbiter refused at arbitration; the run cannot produce findings.' }]
1269    }
1270  
1271    // ── Phase: synthesis. ────────────────────────────────────────────────────
1272    if (!hasTurn(state, 'synthesis')) {
1273      return [
1274        {
1275          kind: 'ask',
1276          memberId: state.run.arbiter.memberId,
1277          phase: 'synthesis',
1278          round: PHASE_ROUND.synthesis,
1279          prompt: buildSynthesisPrompt(state, dissents)
1280        }
1281      ]
1282    }
1283    const synthesis = answeredIn(state, 'synthesis')[0]
1284    if (synthesis === undefined) {
1285      return [{ kind: 'abort', reason: 'The arbiter refused at synthesis; the run cannot produce findings.' }]
1286    }
1287  
1288    // ⚠ NO ABORT HERE, DELIBERATELY — D67 correction (b). An elided dissent is
1289    // recorded in the document, not converted into a lost run.
1290    return [
1291      {
1292        kind: 'complete',
1293        findings: assembleFindingsDocument({
1294          synthesis: synthesis.content,
1295          dissents,
1296          disagreement,
1297          run: state.run,
1298          transcript: state.transcript,
1299          elided: dissentsElided(synthesis.content, dissents),
1300          runId: state.runId,
1301          startedAt: state.startedAt
1302        })
1303      }
1304    ]
1305  }
1306  
```

